import type { IPlannerService } from "../interfaces/IPlannerService";
import type { IProjectService } from "../interfaces/IProjectService";
import type { ITodoService } from "../interfaces/ITodoService";
import type { DecideNextWorkResult } from "../types/plannerTypes";
import { Priority } from "../types";
import { config } from "../config";
import {
  DecisionAssistOutput,
  DecisionAssistSurface,
  validateDecisionAssistOutput,
} from "../validation/aiContracts";
import { randomUUID } from "crypto";
import { PlannerService } from "./plannerService";
import { sanitizeText } from "./contentSanitizer";
import { callAiProvider } from "./aiProviderClient";

export interface CritiqueTaskInput {
  title: string;
  description?: string;
  dueDate?: Date;
  priority?: Priority;
}

export interface CritiqueTaskOutput {
  qualityScore: number;
  improvedTitle: string;
  improvedDescription?: string;
  suggestions: string[];
}

export interface PlanFromGoalInput {
  goal: string;
  targetDate?: Date;
  maxTasks: number;
}

export interface PlanTaskSuggestion {
  title: string;
  description: string;
  priority: Priority;
  dueDate?: Date;
}

export interface PlanFromGoalOutput {
  goal: string;
  summary: string;
  tasks: PlanTaskSuggestion[];
}

export interface BreakdownTodoInput {
  title: string;
  description?: string;
  notes?: string;
  priority?: Priority;
  maxSubtasks: number;
}

export interface BreakdownSubtaskSuggestion {
  title: string;
}

export interface BreakdownTodoOutput {
  summary: string;
  subtasks: BreakdownSubtaskSuggestion[];
}

export interface AiGenerationContext {
  rejectionSignals?: string[];
  acceptanceSignals?: string[];
}

export interface DecisionAssistStubInput {
  surface: DecisionAssistSurface;
  todoId?: string;
  title?: string;
  description?: string;
  notes?: string;
  goal?: string;
  topN?: 3 | 5;
  timeZone?: string;
  anchorDateISO?: string;
  todoCandidates?: Array<{
    id: string;
    title: string;
    dueDate?: string;
    priority?: Priority;
    createdAt?: string;
    updatedAt?: string;
    projectId?: string;
    projectName?: string;
    category?: string;
    hasSubtasks?: boolean;
    notesPresent?: boolean;
  }>;
}

interface AiProvider {
  generateJson<T>(systemPrompt: string, userPrompt: string): Promise<T>;
}

interface GenerateDecisionAssistContext {
  userId?: string;
}

interface AiPlannerServiceDeps {
  provider?: AiProvider;
  plannerService?: IPlannerService;
  todoService?: ITodoService;
  projectService?: IProjectService;
}

const ACTION_VERBS = new Set([
  "define",
  "draft",
  "review",
  "build",
  "write",
  "design",
  "prepare",
  "schedule",
  "ship",
  "publish",
  "launch",
  "test",
  "fix",
  "plan",
  "create",
  "update",
  "complete",
]);

function startsWithActionVerb(title: string): boolean {
  const firstWord = title.trim().split(/\s+/)[0]?.toLowerCase();
  return !!firstWord && ACTION_VERBS.has(firstWord);
}

function cap(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function daysUntil(date: Date): number {
  const now = Date.now();
  const diff = date.getTime() - now;
  return Math.ceil(diff / (24 * 60 * 60 * 1000));
}

export function critiqueTaskDeterministic(
  input: CritiqueTaskInput,
  context?: AiGenerationContext,
): CritiqueTaskOutput {
  const suggestions: string[] = [];
  let score = 100;
  let improvedTitle = input.title.trim();
  let improvedDescription = input.description?.trim();
  const rejectionSignals = (context?.rejectionSignals || []).map((signal) =>
    signal.toLowerCase(),
  );
  const needsSpecificity = rejectionSignals.some(
    (signal) =>
      signal.includes("generic") ||
      signal.includes("vague") ||
      signal.includes("specific"),
  );

  if (improvedTitle.length < 12) {
    score -= 15;
    suggestions.push(
      "Make the title more specific so it is understandable out of context",
    );
  }

  if (!startsWithActionVerb(improvedTitle)) {
    score -= 10;
    suggestions.push("Start the title with a clear action verb");
    improvedTitle = `Complete ${improvedTitle}`;
  }

  if (!improvedDescription) {
    score -= 20;
    suggestions.push(
      "Add acceptance criteria in the description to define done status",
    );
    improvedDescription =
      "Definition of done: clear output produced, reviewed, and shared with stakeholders.";
  } else if (improvedDescription.length < 30) {
    score -= 10;
    suggestions.push("Expand the description with success criteria");
  }

  if (!input.dueDate) {
    score -= 15;
    suggestions.push("Set a due date to improve execution priority");
  } else {
    const remainingDays = daysUntil(input.dueDate);
    if (remainingDays <= 1 && input.priority !== "high") {
      score -= 10;
      suggestions.push(
        "Task is due soon, consider raising priority to high or splitting scope",
      );
    }
  }

  if (!input.priority || input.priority === "medium") {
    score -= 5;
    suggestions.push(
      "Assign explicit priority (high/medium/low) based on business impact",
    );
  }

  if (needsSpecificity) {
    suggestions.unshift(
      "Make outcomes concrete: include owner, measurable result, and deadline",
    );
    improvedDescription = improvedDescription
      ? `${improvedDescription} Include owner, measurable result, and deadline.`
      : "Definition of done: include owner, measurable result, and deadline.";
  }

  return {
    qualityScore: cap(score, 0, 100),
    improvedTitle,
    improvedDescription,
    suggestions,
  };
}

function distributeDueDates(
  startDate: Date,
  targetDate: Date,
  count: number,
): Array<Date | undefined> {
  if (count <= 0) return [];
  const msGap = targetDate.getTime() - startDate.getTime();
  if (msGap <= 0) return Array.from({ length: count }, () => undefined);
  const step = msGap / count;
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(startDate.getTime() + step * (index + 1));
    return date;
  });
}

function buildTaskTemplate(
  goal: string,
): Omit<PlanTaskSuggestion, "dueDate">[] {
  return [
    {
      title: `Define scope for: ${goal}`,
      description:
        "Clarify success criteria, constraints, and stakeholders for this goal.",
      priority: "high",
    },
    {
      title: `Break down execution plan for: ${goal}`,
      description:
        "Create milestones with measurable checkpoints and clear ownership.",
      priority: "high",
    },
    {
      title: `Execute core work for: ${goal}`,
      description:
        "Deliver the highest-impact implementation tasks first to reduce risk.",
      priority: "high",
    },
    {
      title: `Review and QA for: ${goal}`,
      description:
        "Validate quality, test edge cases, and confirm readiness for release.",
      priority: "medium",
    },
    {
      title: `Publish update and retrospective for: ${goal}`,
      description:
        "Communicate outcomes, capture lessons learned, and document next steps.",
      priority: "medium",
    },
  ];
}

export function planFromGoalDeterministic(
  input: PlanFromGoalInput,
  context?: AiGenerationContext,
): PlanFromGoalOutput {
  const rejectionSignals = (context?.rejectionSignals || []).map((signal) =>
    signal.toLowerCase(),
  );
  const needsSpecificity = rejectionSignals.some(
    (signal) =>
      signal.includes("generic") ||
      signal.includes("vague") ||
      signal.includes("specific"),
  );
  const baseTasks = buildTaskTemplate(input.goal).slice(0, input.maxTasks);
  const dueDates = input.targetDate
    ? distributeDueDates(new Date(), input.targetDate, baseTasks.length)
    : [];

  const tasks = baseTasks.map((task, index) => ({
    ...task,
    description: needsSpecificity
      ? `${task.description} Assign owner, metric, and date for this step.`
      : task.description,
    dueDate: dueDates[index],
  }));

  return {
    goal: input.goal,
    summary: needsSpecificity
      ? `Execution plan with ${tasks.length} specific steps generated for "${input.goal}".`
      : `Execution plan with ${tasks.length} steps generated for "${input.goal}".`,
    tasks,
  };
}

function truncateTaskTitle(value: string, maxLength = 180): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength - 1).trimEnd()}…`;
}

export function breakdownTodoDeterministic(
  input: BreakdownTodoInput,
  context?: AiGenerationContext,
): BreakdownTodoOutput {
  const rejectionSignals = (context?.rejectionSignals || []).map((signal) =>
    signal.toLowerCase(),
  );
  const needsSpecificity = rejectionSignals.some(
    (signal) =>
      signal.includes("generic") ||
      signal.includes("vague") ||
      signal.includes("specific"),
  );

  const base = [
    `Define done criteria for: ${input.title}`,
    `Collect inputs and dependencies for: ${input.title}`,
    `Execute core work for: ${input.title}`,
    `Review quality and edge cases for: ${input.title}`,
    `Close out and communicate status for: ${input.title}`,
  ];

  const subtasks = base.slice(0, input.maxSubtasks).map((title) => ({
    title: needsSpecificity
      ? truncateTaskTitle(`${title} (owner + metric + due date)`)
      : truncateTaskTitle(title),
  }));

  return {
    summary: `Generated ${subtasks.length} implementation subtasks.`,
    subtasks,
  };
}

class OpenAiCompatibleProvider implements AiProvider {
  async generateJson<T>(systemPrompt: string, userPrompt: string): Promise<T> {
    const content = await callAiProvider({
      operation: "planner_json",
      systemPrompt,
      userPrompt,
      json: true,
      temperature: 0.2,
    });
    return JSON.parse(content) as T;
  }
}

function parseCritiqueOutput(value: unknown): CritiqueTaskOutput | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (
    typeof v.qualityScore !== "number" ||
    typeof v.improvedTitle !== "string" ||
    !Array.isArray(v.suggestions)
  ) {
    return null;
  }

  return {
    qualityScore: cap(v.qualityScore, 0, 100),
    improvedTitle: v.improvedTitle,
    improvedDescription:
      typeof v.improvedDescription === "string"
        ? v.improvedDescription
        : undefined,
    suggestions: v.suggestions
      .filter((item): item is string => typeof item === "string")
      .slice(0, 8),
  };
}

function parsePlanOutput(value: unknown): PlanFromGoalOutput | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (
    typeof v.goal !== "string" ||
    typeof v.summary !== "string" ||
    !Array.isArray(v.tasks)
  ) {
    return null;
  }

  const tasks: PlanTaskSuggestion[] = [];
  for (const task of v.tasks) {
    if (!task || typeof task !== "object") {
      continue;
    }
    const t = task as Record<string, unknown>;
    if (
      typeof t.title !== "string" ||
      typeof t.description !== "string" ||
      (t.priority !== "low" && t.priority !== "medium" && t.priority !== "high")
    ) {
      continue;
    }

    const dueDate =
      typeof t.dueDate === "string" && !Number.isNaN(Date.parse(t.dueDate))
        ? new Date(t.dueDate)
        : undefined;

    tasks.push({
      title: t.title,
      description: t.description,
      priority: t.priority as Priority,
      dueDate,
    });
  }

  if (tasks.length === 0) return null;

  return {
    goal: v.goal,
    summary: v.summary,
    tasks,
  };
}

function parseBreakdownOutput(value: unknown): BreakdownTodoOutput | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.subtasks)) {
    return null;
  }

  const subtasks: BreakdownSubtaskSuggestion[] = [];
  for (const subtask of v.subtasks) {
    if (!subtask || typeof subtask !== "object") {
      continue;
    }
    const s = subtask as Record<string, unknown>;
    if (typeof s.title !== "string") {
      continue;
    }
    const title = truncateTaskTitle(s.title);
    if (!title) {
      continue;
    }
    subtasks.push({ title });
  }

  if (subtasks.length === 0) {
    return null;
  }

  return {
    summary:
      typeof v.summary === "string" && v.summary.trim().length > 0
        ? v.summary
        : `Generated ${subtasks.length} implementation subtasks.`,
    subtasks,
  };
}

function deriveDueDateSuggestion(title?: string): string | undefined {
  if (!title) {
    return undefined;
  }
  const normalized = title.toLowerCase();
  if (normalized.includes("today")) {
    return new Date().toISOString();
  }
  if (normalized.includes("tomorrow")) {
    return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  }
  return undefined;
}

function toEpoch(value?: string): number {
  if (!value) return Infinity;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? Infinity : date.getTime();
}

function priorityWeight(priority?: string): number {
  const value = String(priority || "").toLowerCase();
  if (value === "high") return 3;
  if (value === "medium") return 2;
  return 1;
}

function startOfToday(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function daysSince(value?: string): number {
  if (!value) return Infinity;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return Infinity;
  return Math.max(0, Math.floor((Date.now() - parsed.getTime()) / 86400000));
}

type HomeFocusCandidate = NonNullable<
  DecisionAssistStubInput["todoCandidates"]
>[number];

function getHomeFocusDueBucket(candidate: HomeFocusCandidate): number {
  if (!candidate.dueDate) return 4;
  const dueDate = new Date(candidate.dueDate);
  if (Number.isNaN(dueDate.getTime())) return 4;
  const today = startOfToday();
  const dueDay = startOfToday(dueDate);
  const dayDiff = Math.floor(
    (dueDay.getTime() - today.getTime()) / (24 * 60 * 60 * 1000),
  );
  if (dayDiff < 0) return 0;
  if (dayDiff === 0) return 1;
  if (dayDiff === 1) return 2;
  if (dayDiff <= 3) return 3;
  return 4;
}

function getHomeFocusConfidence(
  candidate: HomeFocusCandidate,
  dueBucket: number,
): number {
  if (dueBucket === 0) return 0.91;
  if (dueBucket === 1) return 0.87;
  if (dueBucket === 2) return 0.82;
  if (dueBucket === 3) return 0.78;
  if (priorityWeight(candidate.priority) >= 3) return 0.74;
  if (daysSince(candidate.updatedAt || candidate.createdAt) >= 14) return 0.69;
  return 0.62;
}

function buildHomeFocusSummary(
  candidate: HomeFocusCandidate,
  dueBucket: number,
): string {
  const projectName = candidate.projectName || candidate.category || "";
  if (dueBucket === 0) {
    return projectName
      ? `This is overdue in ${projectName} and should be resolved before more work slips.`
      : "This is overdue and should be resolved before more work slips.";
  }
  if (dueBucket === 1) {
    return projectName
      ? `This is due today in ${projectName}, so it is the safest focus pick.`
      : "This is due today, so it is the safest focus pick.";
  }
  if (dueBucket === 2 || dueBucket === 3) {
    return projectName
      ? `This is due soon in ${projectName} and is at risk of slipping if ignored.`
      : "This is due soon and is at risk of slipping if ignored.";
  }
  if (priorityWeight(candidate.priority) >= 3) {
    return projectName
      ? `This is a high-priority task in ${projectName} and deserves focused attention next.`
      : "This is high priority and deserves focused attention next.";
  }
  if (daysSince(candidate.updatedAt || candidate.createdAt) >= 14) {
    return projectName
      ? `This has been quiet in ${projectName} for a while and looks ready for a decision.`
      : "This has been quiet for a while and looks ready for a decision.";
  }
  if (candidate.hasSubtasks) {
    return "This already has structure, which makes it a good focus candidate.";
  }
  if (candidate.notesPresent) {
    return "This already has context captured, so it should be quick to resume.";
  }
  return projectName
    ? `This is an active task in ${projectName} with clear enough context to move forward.`
    : "This is an active task with clear enough context to move forward.";
}

function buildHomeFocusSuggestions(
  input: DecisionAssistStubInput,
): DecisionAssistOutput {
  const requestId = randomUUID();
  const candidates = Array.isArray(input.todoCandidates)
    ? input.todoCandidates.filter((item) => item.id && item.title)
    : [];
  if (!candidates.length) {
    return validateDecisionAssistOutput({
      requestId,
      surface: "home_focus",
      must_abstain: true,
      suggestions: [],
    });
  }

  const selected = [...candidates]
    .sort((a, b) => {
      const dueBucketA = getHomeFocusDueBucket(a);
      const dueBucketB = getHomeFocusDueBucket(b);
      if (dueBucketA !== dueBucketB) return dueBucketA - dueBucketB;

      const priorityDelta =
        priorityWeight(b.priority) - priorityWeight(a.priority);
      if (priorityDelta !== 0) return priorityDelta;

      const staleDelta =
        daysSince(b.updatedAt || b.createdAt) -
        daysSince(a.updatedAt || a.createdAt);
      if (staleDelta !== 0) return staleDelta;

      const projectDelta =
        Number(!!b.projectName || !!b.category) -
        Number(!!a.projectName || !!a.category);
      if (projectDelta !== 0) return projectDelta;

      return String(a.title || "").localeCompare(String(b.title || ""));
    })
    .slice(0, Math.min(input.topN || 3, 3));

  return validateDecisionAssistOutput({
    requestId,
    surface: "home_focus",
    must_abstain: selected.length === 0,
    suggestions: selected.map((candidate, index) => {
      const dueBucket = getHomeFocusDueBucket(candidate);
      const summary = buildHomeFocusSummary(candidate, dueBucket);
      return {
        type: "focus_task",
        confidence: getHomeFocusConfidence(candidate, dueBucket),
        rationale: summary,
        payload: {
          taskId: candidate.id,
          todoId: candidate.id,
          projectId: candidate.projectId,
          title: candidate.title,
          summary,
          reason: summary,
          source: "deterministic",
        },
        suggestionId: `home-focus-${index + 1}-${candidate.id}`,
      };
    }),
  });
}

function confidenceFromPlannerImpact(
  impact?: DecideNextWorkResult["recommendedTasks"][number]["impact"],
): number {
  switch (impact) {
    case "high":
      return 0.84;
    case "medium":
      return 0.76;
    default:
      return 0.68;
  }
}

function buildHomeFocusSuggestionsFromPlanner(
  result: DecideNextWorkResult,
  topN?: 3 | 5,
): DecisionAssistOutput {
  const requestId = randomUUID();
  const selected = Array.isArray(result.recommendedTasks)
    ? result.recommendedTasks.slice(0, Math.min(topN || 3, 3))
    : [];

  return validateDecisionAssistOutput({
    requestId,
    surface: "home_focus",
    must_abstain: selected.length === 0,
    suggestions: selected.map((recommendation, index) => {
      const summary = String(recommendation.reason || "").trim();
      return {
        type: "focus_task",
        confidence: confidenceFromPlannerImpact(recommendation.impact),
        rationale: summary,
        payload: {
          taskId: recommendation.taskId,
          todoId: recommendation.taskId,
          projectId: recommendation.projectId || undefined,
          title: recommendation.title,
          summary,
          reason: summary,
          source: "deterministic",
        },
        suggestionId: `home-focus-planner-${index + 1}-${recommendation.taskId}`,
      };
    }),
  });
}

function estimateTodoMinutes(
  title: string,
  mode: "quick" | "deep" | "balanced",
): number {
  const words =
    String(title || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean).length || 1;
  const base = Math.max(15, Math.min(120, words * 9));
  if (mode === "quick")
    return Math.max(10, Math.min(30, Math.round(base * 0.6)));
  if (mode === "deep")
    return Math.max(45, Math.min(150, Math.round(base * 1.35)));
  return base;
}

export function generateDecisionAssistStubOutput(
  input: DecisionAssistStubInput,
): DecisionAssistOutput {
  const surface = input.surface;
  const requestId = randomUUID();
  const suggestions: DecisionAssistOutput["suggestions"] = [];

  if (surface === "home_focus") {
    return buildHomeFocusSuggestions(input);
  }

  if (surface === "on_create" || surface === "task_drawer") {
    const title = input.title?.trim() || "Untitled task";
    const dueDateISO = deriveDueDateSuggestion(title);
    const todoId = typeof input.todoId === "string" ? input.todoId.trim() : "";
    const targetTodoPayload = todoId ? { todoId } : {};

    suggestions.push({
      type: "rewrite_title",
      confidence: 0.74,
      rationale: "Shorten ambiguity and make the task immediately actionable.",
      payload: {
        ...targetTodoPayload,
        title: startsWithActionVerb(title) ? title : `Draft ${title}`,
      },
    });

    if (/urgent|asap/i.test(title)) {
      suggestions.push({
        type: "set_priority",
        confidence: 0.72,
        rationale: "Urgency language suggests a higher execution priority.",
        payload: {
          ...targetTodoPayload,
          priority: "high",
        },
      });
    }

    suggestions.push({
      type: "propose_next_action",
      confidence: 0.77,
      rationale: "Next-action phrasing lowers start friction.",
      payload: {
        ...targetTodoPayload,
        title: `Define first concrete step for: ${title}`,
      },
    });

    if (dueDateISO) {
      suggestions.push({
        type: "set_due_date",
        confidence: 0.71,
        rationale: "Detected explicit timing language in task text.",
        payload: { ...targetTodoPayload, dueDateISO },
      });
    } else {
      suggestions.push({
        type: "ask_clarification",
        confidence: 0.56,
        rationale: "Due date signal is unclear and should be user-confirmed.",
        payload: {
          ...targetTodoPayload,
          question: "Should this task have a due date?",
          choices: ["Today", "This week", "No due date"],
        },
      });
    }
  }

  if (surface === "today_plan") {
    const goal = input.goal?.trim() || "";
    const goalLower = goal.toLowerCase();
    const todoCandidates = Array.isArray(input.todoCandidates)
      ? input.todoCandidates
          .map((item) => ({
            id: String(item?.id || "").trim(),
            title: String(item?.title || "").trim(),
            dueDate: item?.dueDate,
            priority: item?.priority,
            createdAt: item?.createdAt,
            updatedAt: item?.updatedAt,
          }))
          .filter((item) => item.id && item.title)
      : [];

    if (
      goalLower.includes("abstain") ||
      !Array.isArray(todoCandidates) ||
      todoCandidates.length === 0
    ) {
      return validateDecisionAssistOutput({
        requestId,
        surface,
        must_abstain: true,
        suggestions: [],
        planPreview: {
          topN: input.topN || 3,
          items: [],
        },
      });
    }

    const mode: "quick" | "deep" | "balanced" = goalLower.includes("quick")
      ? "quick"
      : goalLower.includes("deep") || goalLower.includes("focus")
        ? "deep"
        : "balanced";
    const now = Date.now();
    const ranked = [...todoCandidates].sort((a, b) => {
      const dueA = toEpoch(a.dueDate);
      const dueB = toEpoch(b.dueDate);
      const dueScoreA = dueA === Infinity ? Infinity : Math.max(0, dueA - now);
      const dueScoreB = dueB === Infinity ? Infinity : Math.max(0, dueB - now);
      const recencyA = toEpoch(a.updatedAt || a.createdAt);
      const recencyB = toEpoch(b.updatedAt || b.createdAt);
      const prioA = priorityWeight(a.priority);
      const prioB = priorityWeight(b.priority);
      if (mode === "quick") {
        const quickA = estimateTodoMinutes(a.title, "quick");
        const quickB = estimateTodoMinutes(b.title, "quick");
        if (quickA !== quickB) return quickA - quickB;
        if (dueScoreA !== dueScoreB) return dueScoreA - dueScoreB;
        if (prioA !== prioB) return prioB - prioA;
        return recencyB - recencyA;
      }
      if (mode === "deep") {
        const deepA = estimateTodoMinutes(a.title, "deep");
        const deepB = estimateTodoMinutes(b.title, "deep");
        if (deepA !== deepB) return deepB - deepA;
        if (prioA !== prioB) return prioB - prioA;
        if (dueScoreA !== dueScoreB) return dueScoreA - dueScoreB;
        return recencyB - recencyA;
      }
      if (dueScoreA !== dueScoreB) return dueScoreA - dueScoreB;
      if (prioA !== prioB) return prioB - prioA;
      return recencyB - recencyA;
    });

    const topN =
      input.topN || (ranked.length >= 5 && mode !== "balanced" ? 5 : 3);
    const selected = ranked.slice(0, Math.min(topN, ranked.length));
    const planItems = selected.map((todo, index) => ({
      todoId: String(todo.id),
      rank: index + 1,
      timeEstimateMin:
        mode === "quick"
          ? estimateTodoMinutes(todo.title, "quick")
          : mode === "deep" && index === 0
            ? estimateTodoMinutes(todo.title, "deep")
            : estimateTodoMinutes(todo.title, "balanced"),
      rationale:
        mode === "quick"
          ? "Quick-win candidate with low setup cost."
          : mode === "deep" && index === 0
            ? "Primary focus block for deep work."
            : "Urgency and priority alignment for today.",
    }));

    for (const item of planItems) {
      const todo = selected.find((entry) => String(entry.id) === item.todoId);
      if (!todo) continue;
      if (item.rank <= 2) {
        const due = new Date();
        due.setDate(due.getDate() + item.rank);
        due.setHours(9 + item.rank, 0, 0, 0);
        suggestions.push({
          type: "set_due_date",
          confidence: 0.8 - item.rank * 0.04,
          rationale: "Assign a concrete deadline for today's execution.",
          payload: { todoId: item.todoId, dueDateISO: due.toISOString() },
        });
      }
      if (priorityWeight(todo.priority) < 3 && item.rank === 1) {
        suggestions.push({
          type: "set_priority",
          confidence: 0.77,
          rationale: "Top ranked item should be elevated for focus.",
          payload: { todoId: item.todoId, priority: "high" },
        });
      }
      if (item.rank <= 2) {
        suggestions.push({
          type: "propose_next_action",
          confidence: 0.7,
          rationale: "Define the first concrete step before context switching.",
          payload: {
            todoId: item.todoId,
            text: `Start: ${String(todo.title || "").slice(0, 80)} and draft first deliverable.`,
          },
        });
      }
    }

    if (planItems[0]) {
      suggestions.push({
        type: "split_subtasks",
        confidence: 0.68,
        rationale: "Split one larger item into scoped execution steps.",
        payload: {
          todoId: planItems[0].todoId,
          subtasks: [
            { title: "Outline deliverable", order: 1 },
            { title: "Execute focused work block", order: 2 },
            { title: "Review and close loop", order: 3 },
          ],
        },
      });
    }

    return validateDecisionAssistOutput({
      requestId,
      surface,
      must_abstain: false,
      suggestions,
      planPreview: {
        topN,
        items: planItems,
      },
    });
  }

  return validateDecisionAssistOutput({
    requestId,
    surface,
    must_abstain: false,
    suggestions,
  });
}

export class AiPlannerService {
  private readonly provider?: AiProvider;
  private readonly plannerService?: IPlannerService;

  constructor(deps: AiPlannerServiceDeps = {}) {
    this.provider =
      deps.provider ||
      (config.aiProviderEnabled ? new OpenAiCompatibleProvider() : undefined);
    this.plannerService =
      deps.plannerService ||
      (deps.todoService
        ? new PlannerService({
            todoService: deps.todoService,
            projectService: deps.projectService,
          })
        : undefined);
  }

  async critiqueTask(
    input: CritiqueTaskInput,
    context?: AiGenerationContext,
    promptOverride?: string,
  ): Promise<CritiqueTaskOutput> {
    const fallback = critiqueTaskDeterministic(input, context);
    if (!this.provider) {
      return fallback;
    }

    const systemPrompt =
      promptOverride ||
      "You are an execution coach. Return JSON with: qualityScore (0-100), improvedTitle, improvedDescription, suggestions (string[]). Keep suggestions actionable and concrete with owners, measurable outcomes, and deadlines where possible.";

    try {
      const contextBlock =
        context &&
        (context.rejectionSignals?.length || context.acceptanceSignals?.length)
          ? {
              rejectionSignals: context.rejectionSignals || [],
              acceptanceSignals: context.acceptanceSignals || [],
            }
          : undefined;
      const response = await this.provider.generateJson<unknown>(
        systemPrompt,
        JSON.stringify({
          title: sanitizeText(input.title),
          description: sanitizeText(input.description || ""),
          dueDate: input.dueDate?.toISOString(),
          priority: input.priority || "medium",
          context: contextBlock,
        }),
      );
      return parseCritiqueOutput(response) || fallback;
    } catch (error) {
      console.warn(
        "AI provider critique failed, using deterministic fallback",
        error,
      );
      return fallback;
    }
  }

  async planFromGoal(
    input: PlanFromGoalInput,
    context?: AiGenerationContext,
  ): Promise<PlanFromGoalOutput> {
    const fallback = planFromGoalDeterministic(input, context);
    if (!this.provider) {
      return fallback;
    }

    try {
      const contextBlock =
        context &&
        (context.rejectionSignals?.length || context.acceptanceSignals?.length)
          ? {
              rejectionSignals: context.rejectionSignals || [],
              acceptanceSignals: context.acceptanceSignals || [],
            }
          : undefined;
      const response = await this.provider.generateJson<unknown>(
        "You are an execution planner. Return JSON with: goal, summary, tasks[]. Each task must include title, description, priority(low|medium|high), optional dueDate ISO string. Prefer concrete, measurable tasks.",
        JSON.stringify({
          goal: sanitizeText(input.goal),
          targetDate: input.targetDate?.toISOString(),
          maxTasks: input.maxTasks,
          context: contextBlock,
        }),
      );

      const parsed = parsePlanOutput(response);
      if (!parsed) {
        return fallback;
      }

      return {
        ...parsed,
        tasks: parsed.tasks.slice(0, input.maxTasks),
      };
    } catch (error) {
      console.warn(
        "AI provider plan failed, using deterministic fallback",
        error,
      );
      return fallback;
    }
  }

  async breakdownTodoIntoSubtasks(
    input: BreakdownTodoInput,
    context?: AiGenerationContext,
  ): Promise<BreakdownTodoOutput> {
    const fallback = breakdownTodoDeterministic(input, context);
    if (!this.provider) {
      return fallback;
    }

    try {
      const contextBlock =
        context &&
        (context.rejectionSignals?.length || context.acceptanceSignals?.length)
          ? {
              rejectionSignals: context.rejectionSignals || [],
              acceptanceSignals: context.acceptanceSignals || [],
            }
          : undefined;
      const response = await this.provider.generateJson<unknown>(
        "You decompose a task into execution subtasks. Return JSON with: summary, subtasks[{title}]. Titles must be concise and action-oriented.",
        JSON.stringify({
          title: sanitizeText(input.title),
          description: sanitizeText(input.description || ""),
          notes: sanitizeText(input.notes || ""),
          priority: input.priority || "medium",
          maxSubtasks: input.maxSubtasks,
          context: contextBlock,
        }),
      );
      const parsed = parseBreakdownOutput(response);
      if (!parsed) {
        return fallback;
      }
      return {
        ...parsed,
        subtasks: parsed.subtasks.slice(0, input.maxSubtasks),
      };
    } catch (error) {
      console.warn(
        "AI provider breakdown failed, using deterministic fallback",
        error,
      );
      return fallback;
    }
  }

  async generateDecisionAssistStub(
    input: DecisionAssistStubInput,
    context: GenerateDecisionAssistContext = {},
  ): Promise<DecisionAssistOutput> {
    if (input.surface === "home_focus") {
      if (this.plannerService && context.userId) {
        try {
          const decision = await this.plannerService.decideNextWork({
            userId: context.userId,
            mode: "suggest",
          });
          if (
            decision.recommendedTasks.length > 0 ||
            !Array.isArray(input.todoCandidates) ||
            input.todoCandidates.length === 0
          ) {
            return buildHomeFocusSuggestionsFromPlanner(decision, input.topN);
          }
        } catch (error) {
          console.warn(
            "Planner-backed home focus failed, using deterministic fallback",
            error,
          );
        }
      }
    }

    return generateDecisionAssistStubOutput(input);
  }

  /**
   * Generate a personalized morning brief narrative.
   * Falls back to deterministic template when AI is disabled or fails.
   */
  async generateMorningBrief(input: {
    tasks: Array<{
      title: string;
      priority?: string;
      estimatedMinutes?: number;
    }>;
    insightSummary?: {
      completionVelocity?: number;
      streakDays?: number;
      overcommitmentRatio?: number;
    };
    tone?: string;
    dayMode?: string;
    allowProvider?: boolean;
  }): Promise<{ brief: string; deterministic: boolean }> {
    const taskSummary = input.tasks
      .slice(0, 5)
      .map((t, i) => `${i + 1}. ${t.title}`)
      .join("; ");
    const taskCount = input.tasks.length;

    // Deterministic fallback
    const toneLabel =
      input.tone === "urgent"
        ? "Let's make today count."
        : input.tone === "playful"
          ? "Here's your game plan for today!"
          : "Here's your focus for today.";
    const streakNote =
      input.insightSummary?.streakDays && input.insightSummary.streakDays >= 3
        ? ` You're on a ${input.insightSummary.streakDays}-day streak — keep the momentum.`
        : "";
    const overcommitNote =
      input.insightSummary?.overcommitmentRatio &&
      input.insightSummary.overcommitmentRatio > 1.5
        ? " You've been taking on more than you finish recently — today's plan is lighter."
        : "";
    const deterministicBrief = `${toneLabel} You have ${taskCount} task${taskCount === 1 ? "" : "s"} lined up: ${taskSummary}.${streakNote}${overcommitNote}`;

    if (!this.provider || input.allowProvider === false) {
      return { brief: deterministicBrief, deterministic: true };
    }

    try {
      const response = await this.provider.generateJson<{ brief: string }>(
        `You are a personal productivity coach. Write a 2-4 sentence morning brief in a ${input.tone || "calm"} tone. Reference the user's tasks, streaks, and energy patterns. Be concise and actionable.`,
        JSON.stringify({
          taskCount,
          topTasks: sanitizeText(taskSummary),
          insights: input.insightSummary ?? {},
          dayMode: input.dayMode ?? "normal",
        }),
      );
      const brief =
        typeof response === "object" && response && "brief" in response
          ? String((response as { brief: string }).brief)
          : deterministicBrief;
      return { brief, deterministic: false };
    } catch {
      return { brief: deterministicBrief, deterministic: true };
    }
  }
}
