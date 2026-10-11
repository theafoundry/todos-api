// =============================================================================
// prioritiesBriefRouter.ts — GET /ai/priorities-brief
// Generates an opinionated HTML priorities digest using the configured LLM.
// Response is cached per-user for 4 hours and served stale-while-refresh.
// =============================================================================

import { Router, Request, Response } from "express";
import { callLlm, LlmProviderNotConfiguredError } from "../services/llmService";
import { AiProviderAdmissionError } from "../services/aiProviderAdmissionService";
import { BriefGenerationCache } from "../services/briefGenerationCache";
import { ITodoService } from "../interfaces/ITodoService";
import { IProjectService } from "../interfaces/IProjectService";

interface PrioritiesBriefRouterDeps {
  todoService: ITodoService;
  projectService?: IProjectService;
  resolveUserId: (req: Request, res: Response) => string | null;
}

interface CacheEntry {
  html: string;
  generatedAt: string;
  expiresAt: number;
}

const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

function getCacheResponse(
  entry: CacheEntry,
  {
    cached,
    isStale,
    refreshInFlight,
  }: {
    cached: boolean;
    isStale: boolean;
    refreshInFlight: boolean;
  },
) {
  return {
    html: entry.html,
    generatedAt: entry.generatedAt,
    expiresAt: new Date(entry.expiresAt).toISOString(),
    cached,
    isStale,
    refreshInFlight,
  };
}

export function createPrioritiesBriefRouter({
  todoService,
  projectService,
  resolveUserId,
}: PrioritiesBriefRouterDeps): Router {
  const router = Router();
  const cache = new BriefGenerationCache(generateBriefEntry);

  async function generateBriefEntry(userId: string): Promise<CacheEntry> {
    const [todosResult, projectsResult] = await Promise.allSettled([
      todoService.findAll(userId, { completed: false }),
      projectService ? projectService.findAll(userId) : Promise.resolve([]),
    ]);

    const todos = todosResult.status === "fulfilled" ? todosResult.value : [];
    const projects =
      projectsResult.status === "fulfilled" ? projectsResult.value : [];

    const todayISO = new Date().toISOString().split("T")[0];

    const taskLines = (Array.isArray(todos) ? todos : [])
      .slice(0, 40)
      .map((t: any) => {
        const parts: string[] = [
          `"${String(t.title || "").replace(/"/g, "'")}"`,
        ];
        if (t.priority) parts.push(`priority:${t.priority}`);
        if (t.dueDate) parts.push(`due:${String(t.dueDate).split("T")[0]}`);
        if (t.estimateMinutes) parts.push(`est:${t.estimateMinutes}m`);
        if (t.waitingOn)
          parts.push(`waiting_on:${String(t.waitingOn).slice(0, 60)}`);
        if (t.status) parts.push(`status:${t.status}`);
        if (t.category)
          parts.push(`project:${String(t.category).slice(0, 40)}`);
        return `- ${parts.join(" ")}`;
      })
      .join("\n");

    // Build a map of descendant open-task counts so parent projects
    // that contain only child-project tasks aren't flagged as empty.
    const projectList = Array.isArray(projects) ? projects : [];
    const PATH_SEP = " / ";
    const descendantOpenCounts = new Map<string, number>();
    for (const p of projectList) {
      const name = String(p.name || "");
      const open = Number(p.openTaskCount ?? p.taskCount ?? 0);
      if (!name) continue;
      // Walk up the path segments and accumulate counts on ancestors.
      const segments = name.split(PATH_SEP);
      for (let i = 1; i < segments.length; i++) {
        const ancestor = segments.slice(0, i).join(PATH_SEP);
        descendantOpenCounts.set(
          ancestor,
          (descendantOpenCounts.get(ancestor) || 0) + open,
        );
      }
    }

    const projectLines = projectList
      .map((p: any) => {
        const open = Number(p.openTaskCount ?? p.taskCount ?? 0);
        const descendantOpen =
          descendantOpenCounts.get(String(p.name || "")) || 0;
        const totalOpen = open + descendantOpen;
        const parts: string[] = [
          `"${String(p.name || "").replace(/"/g, "'")}"`,
        ];
        parts.push(`area:${p.area ?? "none"}`);
        parts.push(`open_tasks:${totalOpen}`);
        if (descendantOpen > 0) {
          parts.push(`(includes ${descendantOpen} in child projects)`);
        }
        if (p.goal) parts.push(`goal:${String(p.goal).slice(0, 80)}`);
        return `- ${parts.join(" ")}`;
      })
      .join("\n");

    const systemPrompt = `You are a personal productivity assistant generating an HTML priorities digest.
Output ONLY the inner HTML — no outer wrapper, no markdown fences, no explanation.
Use only these CSS classes (already defined in the app's stylesheet):

  .lbl             — section label: <div class="lbl">Section title</div>  (use sentence case for all labels)
  .urgent          — red urgent banner:
                     <div class="urgent"><div class="dot-lg r"></div><div><strong>Date — Task.</strong> One sentence context.</div></div>
  .warn            — amber warning:
                     <div class="warn"><div class="dot-lg a"></div><div><strong>Project has 0 tasks.</strong> One sentence.</div></div>
  .track           — 3-column grid: <div class="track"><div>col1</div><div>col2</div><div>col3</div></div>
  .col-head.now    — amber header:  <div class="col-head now">This week</div>
  .col-head.soon   — blue header:   <div class="col-head soon">Next 14 days</div>
  .col-head.after  — gray header:   <div class="col-head after">Later</div>
  .col-body        — column body:   <div class="col-body">...</div>
  .item            — row in column: <div class="item"><div class="dot r"></div>Task title (Xm)</div>
  dot colors:        r=red  a=amber  g=green  b=blue  p=purple
  .card            — single action: <div class="card"><div class="row"><span class="rn">&#8594;</span><div>
                     <div class="rt">Task title</div><div class="rb">2-3 sentences reasoning.</div></div></div></div>

Output structure (omit a section if nothing to show):
1. Urgent banners — .urgent per task that is overdue OR has priority=urgent AND is due within 7 days of today. Max 3.
   Never show a task as urgent if its due date is more than 7 days from today, even if it has priority=urgent.
   Include the due date and one concrete reason why it matters.
2. Three-column track with label "What to do across three tracks" —
   put ALL open tasks in This week / Next 14 days / Later.
   Use "Later" as the third column header (not a specific month name).
   Tasks with no due date: place in "This week" if priority is high/urgent, otherwise "Later".
   Append "(no due date)" after the task title for dateless tasks.
3. Warn card — only for projects with open_tasks:0 that do NOT have child projects with tasks. Max 2.
   If there are no warnings, omit the entire section including any labels.
4. Single most impactful card — pick ONE task, write opinionated 2-3 sentence reasoning.
   Name the actual dependency or risk. Be direct. Do not hedge.
   If there are no open tasks, omit this section entirely — do not render an empty card.

Rules:
- Use actual task titles. Use actual due dates. Name who is blocking it.
- Do not fabricate tasks or projects. Only use the data provided.
- Estimate labels in .item rows: use the est value from the task data if provided, formatted as (30m) or (1h). Do not invent estimates.
- Today is ${todayISO}.`;

    const userPrompt = `Open tasks:\n${taskLines || "(none)"}\n\nProjects:\n${projectLines || "(none)"}`;

    const html = await callLlm({
      systemPrompt,
      userPrompt,
      maxTokens: 1500,
      temperature: 0.3,
    });
    const generatedAt = new Date().toISOString();

    return {
      html,
      generatedAt,
      expiresAt: Date.now() + CACHE_TTL_MS,
    };
  }

  function startBackgroundRefresh(userId: string) {
    cache.refreshInBackground(userId, (error) => {
      console.error("priorities-brief background refresh error:", error);
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
    console.error("priorities-brief error:", error);
    return res
      .status(500)
      .json({ error: "Failed to generate priorities brief" });
  }

  router.get("/priorities-brief", async (req: Request, res: Response) => {
    try {
      const userId = resolveUserId(req, res);
      if (!userId) return;

      const cached = cache.get(userId);
      if (cached && cached.expiresAt > Date.now()) {
        return res.json(
          getCacheResponse(cached, {
            cached: true,
            isStale: false,
            refreshInFlight: cache.hasInFlight(userId),
          }),
        );
      }

      if (cached) {
        startBackgroundRefresh(userId);
        return res.json(
          getCacheResponse(cached, {
            cached: true,
            isStale: true,
            refreshInFlight: cache.hasInFlight(userId),
          }),
        );
      }

      const freshEntry = await cache.generate(userId);
      if (res.destroyed || res.writableEnded) return;
      return res.json(
        getCacheResponse(freshEntry, {
          cached: false,
          isStale: false,
          refreshInFlight: false,
        }),
      );
    } catch (err) {
      return sendGenerationError(err, res);
    }
  });

  router.post(
    "/priorities-brief/refresh",
    async (req: Request, res: Response) => {
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
    },
  );

  return router;
}
