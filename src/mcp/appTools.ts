import { PrismaClient } from "@prisma/client";
import { AgentExecutor } from "../agent/agentExecutor";
import { AgentExecutionContext } from "../domains/agent/actions/agentTypes";
import { IProjectService } from "../interfaces/IProjectService";
import { findNativeAppTool, NativeAppToolName } from "./appContract";

export const DEFAULT_MCP_APP_TIMEZONE = "America/New_York";

export class NativeAppToolError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
    readonly hint?: string,
  ) {
    super(message);
  }
}

export function isValidIanaTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch (_error) {
    return false;
  }
}

export function formatCalendarDate(value: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export async function resolveNativeAppTimezone(input: {
  userId: string;
  sessionId?: string;
  prisma?: PrismaClient;
  serverDefault?: string;
}): Promise<string> {
  const serverDefault = input.serverDefault ?? DEFAULT_MCP_APP_TIMEZONE;
  if (!isValidIanaTimezone(serverDefault)) {
    throw new Error("Configured MCP app timezone is not a valid IANA timezone");
  }
  if (!input.prisma) return serverDefault;

  const [enrollment, session] = await Promise.all([
    input.prisma.agentEnrollment.findUnique({
      where: { userId: input.userId },
      select: { timezone: true },
    }),
    input.sessionId
      ? input.prisma.mcpAssistantSession.findUnique({
          where: { id: input.sessionId },
          select: { timezone: true },
        })
      : Promise.resolve(null),
  ]);
  const candidates = [enrollment?.timezone, session?.timezone, serverDefault];
  return candidates.find((value): value is string =>
    Boolean(value && isValidIanaTimezone(value)),
  )!;
}

function iso(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new NativeAppToolError(
      "INTERNAL_CONTRACT_ERROR",
      "The canonical service returned an unexpected result.",
      true,
    );
  }
  return value as Record<string, unknown>;
}

function executionData(result: Awaited<ReturnType<AgentExecutor["execute"]>>) {
  if (!result.body.ok) {
    throw new NativeAppToolError(
      result.body.error.code,
      result.body.error.message,
      result.body.error.retryable,
      result.body.error.hint,
    );
  }
  return { data: result.body.data, trace: result.body.trace };
}

async function projectMap(
  userId: string,
  projectService?: IProjectService,
): Promise<Map<string, { id: string; name: string }>> {
  if (!projectService) return new Map();
  const projects = await projectService.findAll(userId);
  return new Map(projects.map((project) => [project.id, project]));
}

function nativeTask(
  raw: unknown,
  projects: Map<string, { id: string; name: string }>,
  effectiveDate: string,
  timezone: string,
) {
  const task = asRecord(raw);
  const dueDate = iso(task.dueDate);
  const projectId = typeof task.projectId === "string" ? task.projectId : null;
  const project = projectId ? projects.get(projectId) : undefined;
  return {
    id: String(task.id),
    title: String(task.title),
    status: task.status,
    completed: Boolean(task.completed),
    dueDate,
    scheduledDate: iso(task.scheduledDate),
    priority: task.priority ?? null,
    estimateMinutes:
      typeof task.estimatedMinutes === "number"
        ? task.estimatedMinutes
        : typeof task.estimateMinutes === "number"
          ? task.estimateMinutes
          : null,
    energy: task.energy ?? null,
    overdue:
      !task.completed &&
      dueDate !== null &&
      formatCalendarDate(new Date(dueDate), timezone) < effectiveDate,
    project: project ? { id: project.id, name: project.name } : null,
  };
}

export interface NativeAppToolRuntime {
  agentExecutor: AgentExecutor;
  projectService?: IProjectService;
  prisma?: PrismaClient;
  userId: string;
  sessionId?: string;
  requestId: string;
  actor: string;
}

async function executeNativeDayPlan(input: {
  args: Record<string, unknown>;
  runtime: NativeAppToolRuntime;
  timezone: string;
  effectiveDate: string;
  context: AgentExecutionContext;
}) {
  const projects = await projectMap(
    input.runtime.userId,
    input.runtime.projectService,
  );
  const result = executionData(
    await input.runtime.agentExecutor.execute(
      "plan_today",
      {
        date: input.args.date,
        availableMinutes: input.args.availableMinutes,
        energy: input.args.energy,
      },
      input.context,
    ),
  );
  const plan = asRecord(result.data.plan);
  const tasks = Array.isArray(plan.recommendedTasks)
    ? plan.recommendedTasks
    : [];
  return {
    date: input.effectiveDate,
    timezone: input.timezone,
    availableMinutes: Number(
      plan.availableMinutes ?? input.args.availableMinutes,
    ),
    energy: input.args.energy,
    tasks: tasks.map((task, index) => {
      const record = asRecord(task);
      const explanation = asRecord(record.explanation ?? {});
      return {
        ...nativeTask(record, projects, input.effectiveDate, input.timezone),
        rank: Number(explanation.rank ?? index + 1),
        reason: String(explanation.whyIncluded ?? "Selected for today's plan."),
      };
    }),
    totalMinutes: Number(plan.totalMinutes ?? 0),
    remainingMinutes: Number(plan.remainingMinutes ?? 0),
    warnings: [] as string[],
  };
}

export function buildNativeAppSuccessText(
  name: NativeAppToolName,
  output: Record<string, unknown>,
): string {
  if (name === "open_today_plan") {
    return `Today Plan is ready for ${String(output.date)} in ${String(output.timezone)}. Choose your available minutes and energy to create a plan.`;
  }
  const tasks = Array.isArray(output.tasks) ? output.tasks : [];
  if (name === "list_today") {
    const overdue = tasks.filter(
      (task) => asRecord(task).overdue === true,
    ).length;
    const suffix = overdue > 0 ? `, including ${overdue} overdue` : "";
    return `Found ${tasks.length} ${tasks.length === 1 ? "task" : "tasks"} for ${String(output.date)}${suffix}.`;
  }
  if (name === "plan_today" || name === "render_today_plan") {
    return `Planned ${tasks.length} ${tasks.length === 1 ? "task" : "tasks"} across ${Number(output.totalMinutes)} of ${Number(output.availableMinutes)} available minutes.`;
  }
  if (name === "capture_task") {
    const capture = asRecord(output.capture);
    return output.created === false
      ? `Already captured “${String(capture.text)}”; no duplicate was created.`
      : `Captured “${String(capture.text)}” in your inbox.`;
  }

  const task = asRecord(output.task);
  if (name === "complete_task") {
    if (output.changed === false) {
      return `“${String(task.title)}” was already ${task.completed === true ? "complete" : "open"}.`;
    }
    return task.completed === true
      ? `Marked “${String(task.title)}” complete.`
      : `Reopened “${String(task.title)}”.`;
  }
  return output.changed === false
    ? `“${String(task.title)}” already had the requested dates.`
    : `Rescheduled “${String(task.title)}”.`;
}

export async function executeNativeAppTool(
  name: NativeAppToolName,
  rawArguments: unknown,
  runtime: NativeAppToolRuntime,
) {
  const definition = findNativeAppTool(name);
  if (!definition) {
    throw new NativeAppToolError("TOOL_NOT_FOUND", `Unknown tool: ${name}`);
  }
  const parsed = definition.inputSchema.safeParse(rawArguments ?? {});
  if (!parsed.success) {
    throw new NativeAppToolError(
      "INVALID_ARGUMENT",
      parsed.error.issues.map((issue) => issue.message).join("; "),
      false,
      "Correct the tool arguments and retry.",
    );
  }
  const args = parsed.data as Record<string, unknown>;
  const timezone = await resolveNativeAppTimezone({
    userId: runtime.userId,
    sessionId: runtime.sessionId,
    prisma: runtime.prisma,
    serverDefault:
      process.env.TODOS_DEFAULT_TIMEZONE || DEFAULT_MCP_APP_TIMEZONE,
  });
  const effectiveDate =
    typeof args.date === "string"
      ? args.date
      : formatCalendarDate(new Date(), timezone);
  if (name === "open_today_plan") {
    return { state: "setup" as const, date: effectiveDate, timezone };
  }
  const context: AgentExecutionContext = {
    userId: runtime.userId,
    requestId: runtime.requestId,
    actor: runtime.actor,
    surface: "mcp",
    timezone,
    effectiveDate,
  };
  if (name === "list_today") {
    const projects = await projectMap(runtime.userId, runtime.projectService);
    const result = executionData(
      await runtime.agentExecutor.execute(
        "list_today",
        {
          includeOverdue: args.includeOverdue ?? true,
          includeCompleted: args.includeCompleted ?? false,
        },
        context,
      ),
    );
    const tasks = Array.isArray(result.data.tasks) ? result.data.tasks : [];
    return {
      date: effectiveDate,
      timezone,
      tasks: tasks.map((task) =>
        nativeTask(task, projects, effectiveDate, timezone),
      ),
    };
  }

  if (name === "plan_today" || name === "render_today_plan") {
    const freshPlan = await executeNativeDayPlan({
      args,
      runtime,
      timezone,
      effectiveDate,
      context,
    });
    if (name === "plan_today") return freshPlan;

    const requestedTaskIds = Array.from(
      new Set((args.taskIds as string[]) ?? []),
    );
    const freshById = new Map(
      freshPlan.tasks.map((task) => [task.id, task] as const),
    );
    const tasks = requestedTaskIds
      .flatMap((taskId) => {
        const task = freshById.get(taskId);
        return task ? [task] : [];
      })
      .map((task, index) => ({ ...task, rank: index + 1 }));
    const omittedCount = requestedTaskIds.length - tasks.length;
    const requestedSet = new Set(requestedTaskIds);
    const authoritativeOrder = freshPlan.tasks
      .filter((task) => requestedSet.has(task.id))
      .map((task) => task.id);
    const renderedOrder = tasks.map((task) => task.id);
    const orderChanged = authoritativeOrder.some(
      (taskId, index) => taskId !== renderedOrder[index],
    );
    const warnings = [...freshPlan.warnings];
    if (omittedCount > 0) {
      warnings.push(
        `${omittedCount} selected ${omittedCount === 1 ? "task was" : "tasks were"} omitted because the authoritative plan changed. Refresh the plan to review current work.`,
      );
    }
    if (orderChanged) {
      warnings.push(
        "The authoritative plan order changed after this plan was prepared. Refresh to review the latest order.",
      );
    }
    const totalMinutes = tasks.reduce(
      (sum, task) => sum + (task.estimateMinutes ?? 0),
      0,
    );
    return {
      ...freshPlan,
      tasks,
      totalMinutes,
      remainingMinutes: freshPlan.availableMinutes - totalMinutes,
      warnings,
    };
  }

  if (name === "capture_task") {
    context.idempotencyKey = String(args.idempotencyKey);
    const result = executionData(
      await runtime.agentExecutor.execute(
        "capture_inbox_item",
        { text: args.text, source: "api" },
        context,
      ),
    );
    const item = asRecord(result.data.item);
    return {
      capture: {
        id: String(item.id),
        text: String(item.text),
        lifecycle: "new" as const,
        capturedAt: iso(item.capturedAt)!,
      },
      created: result.trace.replayed !== true,
    };
  }

  const projects = await projectMap(runtime.userId, runtime.projectService);
  const beforeResult = executionData(
    await runtime.agentExecutor.execute(
      "get_task",
      { id: args.taskId },
      context,
    ),
  );
  const before = asRecord(beforeResult.data.task);

  if (name === "complete_task") {
    const completed =
      args.completed === undefined ? true : Boolean(args.completed);
    const changed = Boolean(before.completed) !== completed;
    const after = changed
      ? executionData(
          await runtime.agentExecutor.execute(
            "complete_task",
            { id: args.taskId, completed },
            context,
          ),
        ).data.task
      : before;
    return {
      task: nativeTask(after, projects, effectiveDate, timezone),
      changed,
    };
  }

  const previousScheduledDate = iso(before.scheduledDate);
  const previousDueDate = iso(before.dueDate);
  const requestedScheduledDate =
    args.scheduledDate === undefined
      ? previousScheduledDate
      : args.scheduledDate;
  const requestedDueDate =
    args.dueDate === undefined ? previousDueDate : args.dueDate;
  const changed =
    requestedScheduledDate !== previousScheduledDate ||
    requestedDueDate !== previousDueDate;
  const after = changed
    ? executionData(
        await runtime.agentExecutor.execute(
          "update_task",
          {
            id: args.taskId,
            ...(args.scheduledDate !== undefined
              ? { scheduledDate: args.scheduledDate }
              : {}),
            ...(args.dueDate !== undefined ? { dueDate: args.dueDate } : {}),
          },
          context,
        ),
      ).data.task
    : before;
  return {
    task: nativeTask(after, projects, effectiveDate, timezone),
    changed,
    previousScheduledDate,
    previousDueDate,
    timezone,
  };
}
