// =============================================================================
// focusBriefRouter.ts — GET /ai/focus-brief
// Generates a structured focus brief using server-computed panels and LLM output.
// Response is cached per-user for 4 hours and served stale-while-refresh.
// =============================================================================

import { Router, Request, Response } from "express";
import { callLlm, LlmProviderNotConfiguredError } from "../services/llmService";
import { AiProviderAdmissionError } from "../services/aiProviderAdmissionService";
import { BriefGenerationCache } from "../services/briefGenerationCache";
import { config } from "../config";
import { ITodoService } from "../interfaces/ITodoService";
import { IProjectService } from "../interfaces/IProjectService";
import {
  FocusBriefResponse,
  LlmFocusOutput,
  PanelData,
  PanelProvenance,
  PanelType,
  RankedPanel,
  WhatNextPanelData,
} from "../types/focusBrief";
import {
  computeTodayAgenda,
  computeUnsorted,
  computeDueSoon,
  computeBacklogHygiene,
  computeProjectsToNudge,
  computeTrackOverview,
  computeRescueMode,
} from "../services/focusBriefService";

interface Deps {
  todoService: ITodoService;
  projectService?: IProjectService;
  resolveUserId: (req: Request, res: Response) => string | null;
}

interface CacheEntry {
  brief: FocusBriefResponse;
  expiresAt: number;
}

const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

type DeterministicKey = Exclude<PanelType, "whatNext"> | "todayAgenda";

// Static provenance metadata for each deterministic panel type
const DETERMINISTIC_PROVENANCE: Record<
  DeterministicKey,
  Pick<PanelProvenance, "method" | "filter" | "promptIntent" | "logic">
> = {
  todayAgenda: {
    method: "date-match",
    filter: "dueDate=today OR scheduledDate=today OR doDate=today OR overdue",
    promptIntent: "Show what needs attention today",
    logic:
      "Tasks due/scheduled today plus overdue tasks, sorted by priority then due date",
  },
  unsorted: {
    method: "inbox-filter",
    filter: "status=inbox OR no-project",
    promptIntent: "Surface tasks that have not been triaged",
    logic: "Tasks without a project or with inbox status",
  },
  dueSoon: {
    method: "due-date-window",
    filter: "dueDate within 7 days",
    promptIntent: "Show upcoming deadlines grouped by day",
    logic: "Tasks with due date in next 7 days, grouped by relative label",
  },
  backlogHygiene: {
    method: "staleness-check",
    filter: "updatedAt older than 30 days AND not completed",
    promptIntent: "Identify tasks that have gone stale",
    logic: "Open tasks not updated in 30+ days, sorted by staleness descending",
  },
  projectsToNudge: {
    method: "project-health-scan",
    filter: "projects with overdue or due-soon tasks",
    promptIntent: "Surface projects that need attention",
    logic:
      "Projects with overdue, waiting, or due-soon task counts above threshold",
  },
  trackOverview: {
    method: "rolling-window-buckets",
    filter: "dueDate grouped into thisWeek / next14Days / later",
    promptIntent: "Give a runway view of upcoming work",
    logic: "Tasks bucketed by due date into three time horizons",
  },
  rescueMode: {
    method: "overload-detector",
    filter: "openCount and overdueCount aggregation",
    promptIntent: "Detect when the user is overwhelmed",
    logic:
      "Counts open and overdue tasks; triggers if overdue ratio exceeds threshold",
  },
};

function buildLlmProvenance(
  generatedAt: string,
  cacheStatus: PanelProvenance["cacheStatus"],
  cacheExpiresAt: string,
  freshness: PanelProvenance["freshness"],
  todoCount: number,
  projectCount: number,
): PanelProvenance {
  return {
    source: "ai",
    model: config.aiProviderModel,
    temperature: 0.3,
    maxTokens: 1500,
    generatedAt,
    cacheStatus,
    cacheExpiresAt,
    freshness,
    inputSummary: `${todoCount} open tasks, ${projectCount} projects`,
    promptIntent: "Rank panels and surface urgent items with AI reasoning",
  };
}

function buildDeterministicProvenance(
  key: DeterministicKey,
  generatedAt: string,
  cacheStatus: PanelProvenance["cacheStatus"],
  cacheExpiresAt: string,
  freshness: PanelProvenance["freshness"],
  dataBreakdown: Record<string, number>,
  itemsShown: number,
): PanelProvenance {
  const staticInfo = DETERMINISTIC_PROVENANCE[key];
  const breakdownStr = Object.entries(dataBreakdown)
    .map(([k, v]) => `${k}: ${v}`)
    .join(" · ");
  return {
    source: "deterministic",
    generatedAt,
    cacheStatus,
    cacheExpiresAt,
    freshness,
    dataBreakdown: breakdownStr,
    itemsShown: `${itemsShown}`,
    ...staticInfo,
  };
}

function buildSystemPrompt(todayISO: string): string {
  return `You are a personal productivity assistant. Today is ${todayISO}.

Analyze the user's open tasks and projects and return a JSON object (no markdown fences, no explanation — raw JSON only) with this exact shape:

{
  "rightNow": {
    "narrative": "2-3 sentence paragraph summarizing the user's most urgent situation. Weave in task names, deadlines, and stakes. Write as prose, not a list. Example: 'Your contractor quote for the todo app is overdue — this blocks the project timeline. The AWS study plan and garage sort are both due April 10th, but the contractor call is the bottleneck.'",
    "urgentItems": [
      { "title": "task title", "dueDate": "YYYY-MM-DD", "reason": "one sentence" }
    ],
    "topRecommendation": {
      "title": "task title",
      "taskId": "task id string",
      "reasoning": "2-3 sentences. Be direct. Name the actual risk or dependency."
    }
  },
  "whatNext": [
    {
      "id": "task id",
      "title": "task title",
      "reason": "why this matters right now",
      "impact": "low|medium|high",
      "effort": "e.g. 30m, 2h, half-day"
    }
  ],
  "panelRanking": [
    { "type": "dueSoon|unsorted|backlogHygiene|projectsToNudge|trackOverview|rescueMode|whatNext", "reason": "why this panel is relevant" }
  ]
}

Rules:
- narrative: 2-3 sentence paragraph synthesizing the urgency situation. Mention actual task names and dates. Write as prose — do NOT list tasks. If nothing is urgent, write something encouraging like "No fires today. Good time to get ahead on..."
- urgentItems: tasks that are overdue OR have priority=urgent AND due within 7 days. Max 3. These are metadata for transparency, not displayed as a list.
- topRecommendation: the single most impactful task. Omit (null) if no open tasks.
- whatNext: 3-5 high-impact task recommendations ordered by impact. Use actual task ids and titles.
- panelRanking: ordered list of all panel types relevant to the user's situation. Include "whatNext" as a panel type.
- Do not fabricate tasks or projects. Only use data provided.
- Return null for topRecommendation if there are no open tasks.`;
}

function buildUserPrompt(todos: any[], projects: any[], today: Date): string {
  const todayISO = today.toISOString().split("T")[0];
  const taskLines = todos
    .slice(0, 40)
    .map((t: any) => {
      const parts: string[] = [
        `id:${t.id}`,
        `"${String(t.title || "").replace(/"/g, "'")}"`,
      ];
      if (t.priority) parts.push(`priority:${t.priority}`);
      if (t.dueDate) parts.push(`due:${String(t.dueDate).split("T")[0]}`);
      if (t.estimateMinutes) parts.push(`est:${t.estimateMinutes}m`);
      if (t.status) parts.push(`status:${t.status}`);
      if (t.waitingOn)
        parts.push(`waiting_on:${String(t.waitingOn).slice(0, 60)}`);
      if (t.category) parts.push(`project:${String(t.category).slice(0, 40)}`);
      return `- ${parts.join(" ")}`;
    })
    .join("\n");

  const projectLines = (Array.isArray(projects) ? projects : [])
    .map((p: any) => {
      const parts: string[] = [`"${String(p.name || "").replace(/"/g, "'")}"`];
      parts.push(`open_tasks:${p.openTaskCount ?? p.taskCount ?? 0}`);
      if (p.goal) parts.push(`goal:${String(p.goal).slice(0, 80)}`);
      return `- ${parts.join(" ")}`;
    })
    .join("\n");

  return `Today: ${todayISO}\n\nOpen tasks:\n${taskLines || "(none)"}\n\nProjects:\n${projectLines || "(none)"}`;
}

async function generateLlmOutput(
  todos: any[],
  projects: any[],
  today: Date,
): Promise<LlmFocusOutput> {
  const todayISO = today.toISOString().split("T")[0];
  const systemPrompt = buildSystemPrompt(todayISO);
  const userPrompt = buildUserPrompt(todos, projects, today);

  const raw = await callLlm({
    systemPrompt,
    userPrompt,
    maxTokens: 1500,
    temperature: 0.3,
  });

  // Strip markdown fences if present
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();

  return JSON.parse(cleaned) as LlmFocusOutput;
}

function assembleBrief(
  llmOutput: LlmFocusOutput,
  todos: any[],
  projects: any[],
  today: Date,
  cached: boolean,
  isStale: boolean,
  expiresAt: number,
  generatedAt: string,
): FocusBriefResponse {
  const todayAgenda = computeTodayAgenda(todos, today);
  const cacheExpiresAt = new Date(expiresAt).toISOString();
  const cacheStatus: PanelProvenance["cacheStatus"] = cached
    ? isStale
      ? "stale"
      : "hit"
    : "miss";
  const freshness: PanelProvenance["freshness"] = cached
    ? isStale
      ? "stale"
      : "cached"
    : "fresh";

  // Compute all server-side panels
  const unsortedData = computeUnsorted(todos);
  const dueSoonData = computeDueSoon(todos, today);
  const backlogHygieneData = computeBacklogHygiene(todos, today);
  const projectsToNudgeData = computeProjectsToNudge(projects, todos, today);
  const trackOverviewData = computeTrackOverview(todos, today);
  const rescueModeData = computeRescueMode(todos, today);

  const panelMap = new Map<PanelType, PanelData>([
    ["unsorted", unsortedData],
    ["dueSoon", dueSoonData],
    ["backlogHygiene", backlogHygieneData],
    ["projectsToNudge", projectsToNudgeData],
    ["trackOverview", trackOverviewData],
    ["rescueMode", rescueModeData],
  ]);

  // Build whatNext panel from LLM output
  const whatNextPanel: WhatNextPanelData = {
    type: "whatNext",
    items: llmOutput.whatNext ?? [],
  };
  panelMap.set("whatNext", whatNextPanel);

  // Precompute provenance for deterministic panels
  const deterministicProvenanceMap = new Map<DeterministicKey, PanelProvenance>(
    [
      [
        "unsorted",
        buildDeterministicProvenance(
          "unsorted",
          generatedAt,
          cacheStatus,
          cacheExpiresAt,
          freshness,
          { items: unsortedData.items.length },
          unsortedData.items.length,
        ),
      ],
      [
        "dueSoon",
        buildDeterministicProvenance(
          "dueSoon",
          generatedAt,
          cacheStatus,
          cacheExpiresAt,
          freshness,
          {
            groups: dueSoonData.groups.length,
            items: dueSoonData.groups.reduce((s, g) => s + g.items.length, 0),
          },
          dueSoonData.groups.reduce((s, g) => s + g.items.length, 0),
        ),
      ],
      [
        "backlogHygiene",
        buildDeterministicProvenance(
          "backlogHygiene",
          generatedAt,
          cacheStatus,
          cacheExpiresAt,
          freshness,
          { items: backlogHygieneData.items.length },
          backlogHygieneData.items.length,
        ),
      ],
      [
        "projectsToNudge",
        buildDeterministicProvenance(
          "projectsToNudge",
          generatedAt,
          cacheStatus,
          cacheExpiresAt,
          freshness,
          { projects: projectsToNudgeData.items.length },
          projectsToNudgeData.items.length,
        ),
      ],
      [
        "trackOverview",
        buildDeterministicProvenance(
          "trackOverview",
          generatedAt,
          cacheStatus,
          cacheExpiresAt,
          freshness,
          {
            thisWeek: trackOverviewData.columns.thisWeek.length,
            next14Days: trackOverviewData.columns.next14Days.length,
            later: trackOverviewData.columns.later.length,
          },
          trackOverviewData.columns.thisWeek.length +
            trackOverviewData.columns.next14Days.length +
            trackOverviewData.columns.later.length,
        ),
      ],
      [
        "rescueMode",
        buildDeterministicProvenance(
          "rescueMode",
          generatedAt,
          cacheStatus,
          cacheExpiresAt,
          freshness,
          {
            open: rescueModeData.openCount,
            overdue: rescueModeData.overdueCount,
          },
          rescueModeData.openCount,
        ),
      ],
    ],
  );

  const llmProvenance = buildLlmProvenance(
    generatedAt,
    cacheStatus,
    cacheExpiresAt,
    freshness,
    todos.length,
    projects.length,
  );

  // Build ranked panels using LLM ranking
  const ranking = llmOutput.panelRanking ?? [];
  const rankedPanels: RankedPanel[] = [];
  const seen = new Set<PanelType>();

  for (const entry of ranking) {
    const data = panelMap.get(entry.type);
    if (data && !seen.has(entry.type)) {
      const provenance: PanelProvenance =
        entry.type === "whatNext"
          ? llmProvenance
          : (deterministicProvenanceMap.get(entry.type as DeterministicKey) ??
            llmProvenance);
      rankedPanels.push({
        type: entry.type,
        reason: entry.reason,
        data,
        provenance,
        ...(entry.type === "whatNext" ? { agentId: "orla" as const } : {}),
      });
      seen.add(entry.type);
    }
  }

  // Append any panels not mentioned by LLM ranking
  for (const [type, data] of panelMap) {
    if (!seen.has(type)) {
      const provenance: PanelProvenance =
        type === "whatNext"
          ? llmProvenance
          : (deterministicProvenanceMap.get(type as DeterministicKey) ??
            llmProvenance);
      rankedPanels.push({
        type,
        reason: "",
        data,
        provenance,
        ...(type === "whatNext" ? { agentId: "orla" as const } : {}),
      });
    }
  }

  const todayAgendaProvenance = buildDeterministicProvenance(
    "todayAgenda",
    generatedAt,
    cacheStatus,
    cacheExpiresAt,
    freshness,
    { items: todayAgenda.length },
    todayAgenda.length,
  );

  return {
    pinned: {
      rightNow: {
        ...(llmOutput.rightNow ?? {
          narrative: "",
          urgentItems: [],
          topRecommendation: null,
        }),
        agentId: "finn" as const,
      },
      todayAgenda,
      rightNowProvenance: llmProvenance,
      todayAgendaProvenance,
    },
    rankedPanels,
    generatedAt,
    expiresAt: cacheExpiresAt,
    cached,
    isStale,
  };
}

export function createFocusBriefRouter({
  todoService,
  projectService,
  resolveUserId,
}: Deps): Router {
  const router = Router();
  const cache = new BriefGenerationCache(generateEntry);

  async function generateEntry(userId: string): Promise<CacheEntry> {
    const today = new Date();

    const [todosResult, projectsResult] = await Promise.allSettled([
      todoService.findAll(userId, { completed: false }),
      projectService ? projectService.findAll(userId) : Promise.resolve([]),
    ]);

    const todos = todosResult.status === "fulfilled" ? todosResult.value : [];
    const projects =
      projectsResult.status === "fulfilled" ? projectsResult.value : [];

    const llmOutput = await generateLlmOutput(todos, projects, today);
    const generatedAt = new Date().toISOString();
    const expiresAt = Date.now() + CACHE_TTL_MS;

    const brief = assembleBrief(
      llmOutput,
      todos,
      projects,
      today,
      false,
      false,
      expiresAt,
      generatedAt,
    );

    return { brief, expiresAt };
  }

  function startBackgroundRefresh(userId: string) {
    cache.refreshInBackground(userId, (error) => {
      console.error("focus-brief background refresh error:", error);
    });
  }

  function sendGenerationError(error: unknown, res: Response) {
    if (res.destroyed || res.writableEnded) return;
    if (error instanceof AiProviderAdmissionError) {
      const retryAt = error.retryAt ? Date.parse(error.retryAt) : NaN;
      if (Number.isFinite(retryAt) && retryAt > Date.now()) {
        res.setHeader(
          "Retry-After",
          String(Math.ceil((retryAt - Date.now()) / 1000)),
        );
      }
      return res.status(error.statusCode).json({
        error: error.message,
        code: error.code,
        ...(error.retryAt ? { retryAt: error.retryAt } : {}),
      });
    }
    if (error instanceof LlmProviderNotConfiguredError) {
      return res.status(503).json({ error: error.message });
    }
    console.error("focus-brief error:", error);
    return res.status(500).json({ error: "Failed to generate focus brief" });
  }

  router.get("/focus-brief", async (req: Request, res: Response) => {
    try {
      const userId = resolveUserId(req, res);
      if (!userId) return;

      const cached = cache.get(userId);

      if (cached && cached.expiresAt > Date.now()) {
        const response: FocusBriefResponse = {
          ...cached.brief,
          cached: true,
          isStale: false,
        };
        return res.json(response);
      }

      if (cached) {
        startBackgroundRefresh(userId);
        const response: FocusBriefResponse = {
          ...cached.brief,
          cached: true,
          isStale: true,
        };
        return res.json(response);
      }

      const freshEntry = await cache.generate(userId);
      if (res.destroyed || res.writableEnded) return;
      return res.json(freshEntry.brief);
    } catch (err) {
      return sendGenerationError(err, res);
    }
  });

  router.post("/focus-brief/refresh", async (req: Request, res: Response) => {
    try {
      const userId = resolveUserId(req, res);
      if (!userId) return;

      const existing = cache.get(userId);
      if (!existing && !cache.hasInFlight(userId)) {
        return res.json({ ok: true, refreshInFlight: false });
      }

      if (existing) cache.markStale(userId);
      await cache.generate(userId);
      if (res.destroyed || res.writableEnded) return;
      return res.json({ ok: true, refreshInFlight: false });
    } catch (err) {
      return sendGenerationError(err, res);
    }
  });

  return router;
}
