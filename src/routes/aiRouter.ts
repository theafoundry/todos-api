import { Router, Request, Response, NextFunction } from "express";
import { AiPlannerService } from "../services/aiService";
import {
  IAiSuggestionStore,
  InMemoryAiSuggestionStore,
  AiSuggestionSlot,
} from "../services/aiSuggestionStore";
import {
  validateApplySuggestionInput,
  validateBreakdownTodoInput,
  validateCritiqueTaskInput,
  validateDecisionAssistDismissInput,
  validateDecisionAssistLatestQuery,
  validateDecisionAssistStubInput,
  validateFeedbackSummaryQuery,
  validateInsightsQuery,
  validatePlanFromGoalInput,
  validateSuggestionListQuery,
  validateSuggestionStatusInput,
} from "../validation/aiValidation";
import {
  DecisionAssistSurface,
  validateDecisionAssistOutput,
} from "../validation/aiContracts";
import { validateId } from "../validation/validation";
import { ITodoService } from "../interfaces/ITodoService";
import { config } from "../config";
import { IProjectService } from "../interfaces/IProjectService";
import * as decisionAssistTelemetry from "../services/decisionAssistTelemetry";
import { evaluateDecisionAssistThrottle } from "../services/decisionAssistThrottle";
import {
  AiQuotaService,
  buildLimitsByPlan,
  buildInsightsRecommendation,
  UserPlan,
} from "../services/aiQuotaService";
import {
  HOME_FOCUS_SURFACE,
  TASK_DRAWER_SURFACE,
  ON_CREATE_SURFACE,
  TODAY_PLAN_SURFACE,
  TODO_BOUND_TYPE,
  TODO_BOUND_SURFACES,
  normalizeHomeFocusEnvelope,
  normalizeTodoBoundEnvelope,
  normalizeTodayPlanEnvelope,
  parsePlanTasks,
  buildThrottleAbstainEnvelope,
  parseOptionalTopN,
  findLatestPendingDecisionAssistSuggestion,
  findLatestPendingHomeFocusSuggestion,
  findLatestPendingTodayPlanSuggestion,
  NormalizedHomeFocusEnvelope,
  NormalizedHomeFocusSuggestion,
  NormalizedTodoBoundEnvelope,
  NormalizedTodoBoundSuggestion,
  NormalizedTodayPlanEnvelope,
  NormalizedTodayPlanSuggestion,
} from "../services/aiNormalizationService";
import {
  applyHomeFocusSuggestion,
  applyTodoBoundSuggestion,
  applyTodayPlanSuggestions,
} from "../services/aiApplyService";
import { validateDismissable } from "../services/aiDismissService";
import { SuggestionApplyOrchestrator } from "../services/suggestionApplyOrchestrator";
import { DecisionAssistGuards } from "../services/decisionAssistGuards";

export { UserPlan } from "../services/aiQuotaService";

interface AiRouterDeps {
  aiPlannerService?: AiPlannerService;
  suggestionStore?: IAiSuggestionStore;
  todoService: ITodoService;
  aiDailySuggestionLimit?: number;
  aiDailySuggestionLimitByPlan?: Partial<Record<UserPlan, number>>;
  resolveAiUserPlan?: (userId: string) => Promise<UserPlan>;
  resolveAiUserId: (req: Request, res: Response) => string | null;
  projectService?: IProjectService;
  decisionAssistEnabled?: boolean;
  persistencePrisma?: import("@prisma/client").PrismaClient;
}

export function createAiRouter({
  aiPlannerService,
  suggestionStore = new InMemoryAiSuggestionStore(),
  todoService,
  aiDailySuggestionLimit,
  aiDailySuggestionLimitByPlan,
  resolveAiUserPlan,
  resolveAiUserId,
  projectService,
  decisionAssistEnabled = config.aiDecisionAssistEnabled,
  persistencePrisma,
}: AiRouterDeps): Router {
  const router = Router();
  const runtimeAiPlannerService =
    aiPlannerService ||
    new AiPlannerService({
      todoService,
      projectService,
    });

  // Per-user AI opt-out guard — blocks all /ai/* endpoints when aiOptOut is true
  if (persistencePrisma) {
    router.use(async (req: Request, res: Response, next: NextFunction) => {
      const userId = resolveAiUserId(req, res);
      if (!userId) return;
      try {
        const cfg = await persistencePrisma.agentConfig.findUnique({
          where: { userId },
          select: { aiOptOut: true },
        });
        if (cfg?.aiOptOut) {
          return res
            .status(403)
            .json({ error: "AI features disabled for your account" });
        }
      } catch {
        // Config not found = defaults = not opted out
      }
      next();
    });
  }

  const limitsByPlan = buildLimitsByPlan({
    aiDailySuggestionLimit,
    aiDailySuggestionLimitByPlan,
  });

  const quotaService = new AiQuotaService({
    suggestionStore,
    limitsByPlan,
    resolveUserPlan: resolveAiUserPlan,
  });

  const guards = new DecisionAssistGuards({
    quotaService,
    suggestionStore,
    decisionAssistEnabled: decisionAssistEnabled ?? false,
  });

  // Thin HTTP adapters that delegate to the guards service.
  // These translate guard results into HTTP responses.
  const enforceDailyQuota = async (userId: string, res: Response) => {
    const exceeded = await guards.checkQuota(userId);
    if (exceeded) {
      res.status(429).json({
        error: "Daily AI suggestion limit reached",
        usage: exceeded,
      });
      return false;
    }
    return true;
  };

  const reserveDailySuggestion = async (userId: string, res: Response) => {
    const admitted = await quotaService.reserveSuggestion(userId);
    if (!admitted.slot) {
      res.status(429).json({
        error: "Daily AI suggestion limit reached",
        usage: admitted.usage,
      });
    }
    return admitted.slot;
  };

  const releaseDailySuggestion = async (slot?: AiSuggestionSlot) => {
    if (!slot) return;
    try {
      await quotaService.releaseSuggestion(slot);
    } catch {
      // A failed release retains the slot, so admission remains conservative.
      console.error("AI suggestion reservation release failed");
    }
  };

  const ensureDecisionAssistFeatureEnabled = (res: Response): boolean => {
    if (guards.isFeatureEnabled()) return true;
    res.status(403).json({ error: "Decision assist disabled" });
    return false;
  };

  const shouldThrottleDecisionAssist = (
    userId: string,
    surface: DecisionAssistSurface,
  ) => guards.evaluateThrottle(userId, surface);

  const isExplicitDecisionAssistRequest = (req: Request): boolean =>
    guards.isExplicitRequest(req.header("x-ai-explicit-request"));

  const emitDecisionAssistTelemetrySafe = (
    event: decisionAssistTelemetry.DecisionAssistTelemetryEvent,
  ) => guards.emitTelemetry(event);

  // ── Routes ──

  /**
   * @openapi
   * /ai/decision-assist/stub:
   *   post:
   *     tags:
   *       - AI
   *     summary: Generate contract-validated stub suggestions for Decision Assist surfaces
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Structured Decision Assist suggestions
   *       400:
   *         description: Validation error
   */
  router.post(
    "/decision-assist/stub",
    async (req: Request, res: Response, next: NextFunction) => {
      let slot: AiSuggestionSlot | undefined;
      try {
        const userId = resolveAiUserId(req, res);
        if (!userId) return;
        if (!(await enforceDailyQuota(userId, res))) return;

        const input = validateDecisionAssistStubInput(req.body);
        const shouldBypassThrottle = isExplicitDecisionAssistRequest(req);
        if (input.surface === TASK_DRAWER_SURFACE) {
          if (!ensureDecisionAssistFeatureEnabled(res)) return;
          if (!input.todoId) {
            return res
              .status(400)
              .json({ error: "todoId is required for task_drawer surface" });
          }
        }
        if (input.surface === ON_CREATE_SURFACE && input.todoId) {
          if (!ensureDecisionAssistFeatureEnabled(res)) return;
        }
        if (input.surface === TODAY_PLAN_SURFACE) {
          if (!ensureDecisionAssistFeatureEnabled(res)) return;
        }
        if (input.surface === HOME_FOCUS_SURFACE) {
          if (!ensureDecisionAssistFeatureEnabled(res)) return;
        }
        if (
          (input.surface === TASK_DRAWER_SURFACE ||
            (input.surface === ON_CREATE_SURFACE && input.todoId)) &&
          input.todoId
        ) {
          const todo = await todoService.findById(userId, input.todoId);
          if (!todo) {
            return res.status(404).json({ error: "Todo not found" });
          }
        }
        if (!shouldBypassThrottle) {
          const throttle = await shouldThrottleDecisionAssist(
            userId,
            input.surface,
          );
          if (throttle.throttled) {
            const output = validateDecisionAssistOutput(
              buildThrottleAbstainEnvelope(input.surface, input.topN),
            );
            return res.json({
              ...output,
              suggestionId: `throttle-${input.surface}-${Date.now()}`,
            });
          }
        }
        const admittedSlot = await reserveDailySuggestion(userId, res);
        if (!admittedSlot) return;
        slot = admittedSlot;
        const output = validateDecisionAssistOutput(
          await runtimeAiPlannerService.generateDecisionAssistStub(input, {
            userId,
          }),
        );

        const suggestion = await quotaService.saveSuggestion(slot, {
          userId,
          type:
            input.surface === "today_plan" ? "plan_from_goal" : "task_critic",
          input: {
            ...input,
          },
          output: output as unknown as Record<string, unknown>,
        });
        slot = undefined;

        emitDecisionAssistTelemetrySafe({
          eventName: "ai_suggestion_generated",
          surface: input.surface,
          aiSuggestionDbId: suggestion.id,
          suggestionId:
            typeof output.requestId === "string" ? output.requestId : undefined,
          todoId: input.todoId,
          suggestionCount: output.suggestions.length,
        });

        res.json({
          ...output,
          suggestionId: suggestion.id,
        });
      } catch (error) {
        next(error);
      } finally {
        await releaseDailySuggestion(slot);
      }
    },
  );

  /**
   * @openapi
   * /ai/task-critic:
   *   post:
   *     tags:
   *       - AI
   *     summary: Improve clarity and execution quality of a task
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Task critique with suggested improvements
   *       400:
   *         description: Validation error
   */
  router.post(
    "/task-critic",
    async (req: Request, res: Response, next: NextFunction) => {
      let slot: AiSuggestionSlot | undefined;
      try {
        const userId = resolveAiUserId(req, res);
        if (!userId) return;
        if (!(await enforceDailyQuota(userId, res))) return;

        const input = validateCritiqueTaskInput(req.body);
        const feedbackContext = await quotaService.getFeedbackContext(userId);

        // Eval prompt override — only enabled via env flag
        // Read from body field, not header (headers can't contain newlines)
        const promptOverride =
          config.enableEvalPromptOverride === true
            ? (req.body.__evalPromptOverride as string | undefined)
            : undefined;

        const admittedSlot = await reserveDailySuggestion(userId, res);
        if (!admittedSlot) return;
        slot = admittedSlot;
        const result = await runtimeAiPlannerService.critiqueTask(
          input,
          feedbackContext,
          promptOverride,
        );

        const suggestion = await quotaService.saveSuggestion(slot, {
          userId,
          type: "task_critic",
          input: {
            ...input,
            dueDate: input.dueDate?.toISOString(),
          },
          output: {
            ...result,
          },
        });
        slot = undefined;

        res.json({
          ...result,
          suggestionId: suggestion.id,
        });
      } catch (error) {
        next(error);
      } finally {
        await releaseDailySuggestion(slot);
      }
    },
  );

  /**
   * @openapi
   * /ai/plan-from-goal:
   *   post:
   *     tags:
   *       - AI
   *     summary: Generate a practical execution plan from a goal statement
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Generated plan and task suggestions
   *       400:
   *         description: Validation error
   */
  router.post(
    "/plan-from-goal",
    async (req: Request, res: Response, next: NextFunction) => {
      let slot: AiSuggestionSlot | undefined;
      try {
        const userId = resolveAiUserId(req, res);
        if (!userId) return;
        if (!(await enforceDailyQuota(userId, res))) return;

        const input = validatePlanFromGoalInput(req.body);
        const feedbackContext = await quotaService.getFeedbackContext(userId);
        const admittedSlot = await reserveDailySuggestion(userId, res);
        if (!admittedSlot) return;
        slot = admittedSlot;
        const result = await runtimeAiPlannerService.planFromGoal(
          input,
          feedbackContext,
        );

        const suggestion = await quotaService.saveSuggestion(slot, {
          userId,
          type: "plan_from_goal",
          input: {
            ...input,
            targetDate: input.targetDate?.toISOString(),
          },
          output: {
            ...result,
            tasks: result.tasks.map((task) => ({
              ...task,
              dueDate: task.dueDate?.toISOString(),
            })),
          },
        });
        slot = undefined;

        res.json({
          ...result,
          suggestionId: suggestion.id,
        });
      } catch (error) {
        next(error);
      } finally {
        await releaseDailySuggestion(slot);
      }
    },
  );

  /**
   * @openapi
   * /ai/usage:
   *   get:
   *     tags:
   *       - AI
   *     summary: Get daily AI usage and remaining quota
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Usage summary
   */
  router.get(
    "/usage",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const userId = resolveAiUserId(req, res);
        if (!userId) return;

        const usage = await quotaService.getUsage(userId);
        res.json(usage);
      } catch (error) {
        next(error);
      }
    },
  );

  /**
   * @openapi
   * /ai/insights:
   *   get:
   *     tags:
   *       - AI
   *     summary: Get AI quality and usage insights with recommendation
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: days
   *         schema:
   *           type: integer
   *           minimum: 1
   *           maximum: 90
   *         description: Rolling lookback window in days (default 7)
   *     responses:
   *       200:
   *         description: AI insights summary
   */
  router.get(
    "/insights",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const userId = resolveAiUserId(req, res);
        if (!userId) return;

        const { days } = validateInsightsQuery(req.query);
        const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        const [usage, generatedCount, feedbackSummary] = await Promise.all([
          quotaService.getUsage(userId),
          suggestionStore.countByUserSince(userId, since),
          suggestionStore.summarizeFeedbackByUserSince(userId, since, 3),
        ]);

        const ratedCount =
          feedbackSummary.acceptedCount + feedbackSummary.rejectedCount;
        const acceptanceRate =
          ratedCount > 0
            ? Math.round((feedbackSummary.acceptedCount / ratedCount) * 100)
            : null;
        const topRejectedReason = feedbackSummary.rejectedReasons[0]?.reason;
        const recommendation = buildInsightsRecommendation({
          plan: usage.plan,
          usageRemaining: usage.remaining,
          usageLimit: usage.limit,
          generatedCount,
          topRejectedReason,
        });

        res.json({
          periodDays: days,
          since: since.toISOString(),
          usageToday: usage,
          generatedCount,
          ratedCount,
          acceptedCount: feedbackSummary.acceptedCount,
          rejectedCount: feedbackSummary.rejectedCount,
          acceptanceRate,
          topAcceptedReasons: feedbackSummary.acceptedReasons,
          topRejectedReasons: feedbackSummary.rejectedReasons,
          recommendation,
        });
      } catch (error) {
        next(error);
      }
    },
  );

  /**
   * @openapi
   * /ai/feedback-summary:
   *   get:
   *     tags:
   *       - AI
   *     summary: Aggregate accepted/rejected AI feedback reasons
   *     security:
   *       - bearerAuth: []
   */
  router.get(
    "/feedback-summary",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const userId = resolveAiUserId(req, res);
        if (!userId) return;

        const { days, reasonLimit } = validateFeedbackSummaryQuery(req.query);
        const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        const summary = await suggestionStore.summarizeFeedbackByUserSince(
          userId,
          since,
          reasonLimit,
        );

        res.json({
          days,
          reasonLimit,
          since: since.toISOString(),
          acceptedCount: summary.acceptedCount,
          rejectedCount: summary.rejectedCount,
          totalRated: summary.acceptedCount + summary.rejectedCount,
          acceptedReasons: summary.acceptedReasons,
          rejectedReasons: summary.rejectedReasons,
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    "/suggestions",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const userId = resolveAiUserId(req, res);
        if (!userId) return;

        const { limit } = validateSuggestionListQuery(req.query);
        const records = await suggestionStore.listByUser(userId, limit);
        res.json(records);
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    "/suggestions/latest",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const userId = resolveAiUserId(req, res);
        if (!userId) return;
        if (!ensureDecisionAssistFeatureEnabled(res)) return;

        const { todoId, surface } = validateDecisionAssistLatestQuery(
          req.query,
        );
        const isTodoBound = TODO_BOUND_SURFACES.has(surface);
        const isTodayPlan = surface === TODAY_PLAN_SURFACE;
        const isHomeFocus = surface === HOME_FOCUS_SURFACE;
        if (!isTodoBound && !isTodayPlan && !isHomeFocus) {
          return res.status(400).json({
            error:
              "surface must be on_create, task_drawer, today_plan, or home_focus",
          });
        }

        const latest = isTodoBound
          ? await findLatestPendingDecisionAssistSuggestion(
              suggestionStore,
              userId,
              String(todoId || ""),
              surface,
            )
          : isTodayPlan
            ? await findLatestPendingTodayPlanSuggestion(
                suggestionStore,
                userId,
              )
            : await findLatestPendingHomeFocusSuggestion(
                suggestionStore,
                userId,
              );
        if (!latest) {
          const throttle = await shouldThrottleDecisionAssist(userId, surface);
          if (throttle.throttled) {
            return res.json({
              aiSuggestionId: "",
              status: "pending",
              outputEnvelope: buildThrottleAbstainEnvelope(
                surface,
                parseOptionalTopN(
                  typeof req.query.topN === "string"
                    ? Number.parseInt(req.query.topN, 10)
                    : undefined,
                ),
              ),
            });
          }
          return res.status(204).end();
        }

        try {
          const outputEnvelope = isTodoBound
            ? normalizeTodoBoundEnvelope(
                latest.output,
                String(todoId || ""),
                surface,
              )
            : isTodayPlan
              ? normalizeTodayPlanEnvelope(latest.output)
              : normalizeHomeFocusEnvelope(latest.output);
          emitDecisionAssistTelemetrySafe({
            eventName: "ai_suggestion_viewed",
            surface,
            aiSuggestionDbId: latest.id,
            suggestionId:
              typeof outputEnvelope.requestId === "string"
                ? outputEnvelope.requestId
                : undefined,
            todoId: isTodoBound ? String(todoId || "") : undefined,
            suggestionCount: outputEnvelope.suggestions.length,
          });
          return res.json({
            aiSuggestionId: latest.id,
            status: latest.status,
            outputEnvelope,
          });
        } catch {
          return res.json({
            aiSuggestionId: latest.id,
            status: latest.status,
            outputEnvelope: {
              requestId: `safe-empty-${latest.id}`,
              surface,
              must_abstain: true,
              planPreview:
                surface === TODAY_PLAN_SURFACE
                  ? { topN: 3, items: [] }
                  : undefined,
              suggestions: [],
            },
          });
        }
      } catch (error) {
        next(error);
      }
    },
  );

  /**
   * @openapi
   * /ai/todos/{id}/breakdown:
   *   post:
   *     tags:
   *       - AI
   *     summary: Generate and create subtasks for an existing todo
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Breakdown generated and subtasks created
   *       404:
   *         description: Todo not found
   *       409:
   *         description: Todo already has subtasks
   */
  router.post(
    "/todos/:id/breakdown",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const userId = resolveAiUserId(req, res);
        if (!userId) return;

        const id = String(req.params.id);
        validateId(id);
        const { maxSubtasks, force } = validateBreakdownTodoInput(req.body);

        const todo = await todoService.findById(userId, id);
        if (!todo) {
          return res.status(404).json({ error: "Todo not found" });
        }

        const existingCount = Array.isArray(todo.subtasks)
          ? todo.subtasks.length
          : 0;
        if (existingCount > 0 && !force) {
          return res.status(409).json({
            error: "Todo already has subtasks. Pass force=true to add more.",
            existingSubtasks: existingCount,
          });
        }

        const feedbackContext = await quotaService.getFeedbackContext(userId);
        const breakdown =
          await runtimeAiPlannerService.breakdownTodoIntoSubtasks(
            {
              title: todo.title,
              description: todo.description,
              notes: todo.notes,
              priority: todo.priority ?? undefined,
              maxSubtasks,
            },
            feedbackContext,
          );

        if (
          !Array.isArray(breakdown.subtasks) ||
          breakdown.subtasks.length < 1
        ) {
          return res
            .status(400)
            .json({ error: "Generated breakdown contains no subtasks" });
        }

        const createdSubtasks = [];
        for (const item of breakdown.subtasks.slice(0, maxSubtasks)) {
          const subtask = await todoService.createSubtask(userId, id, {
            title: item.title,
          });
          if (subtask) {
            createdSubtasks.push(subtask);
          }
        }

        res.json({
          todoId: id,
          summary: breakdown.summary,
          createdCount: createdSubtasks.length,
          subtasks: createdSubtasks,
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.put(
    "/suggestions/:id/status",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const userId = resolveAiUserId(req, res);
        if (!userId) return;

        const id = String(req.params.id);
        validateId(id);
        const { status, reason } = validateSuggestionStatusInput(req.body);

        const updated = await suggestionStore.updateStatus(userId, id, status, {
          reason: reason || null,
          source: "manual_status_update",
          updatedAt: new Date().toISOString(),
        });
        if (!updated) {
          return res.status(404).json({ error: "Suggestion not found" });
        }

        res.json(updated);
      } catch (error) {
        next(error);
      }
    },
  );

  /**
   * @openapi
   * /ai/suggestions/{id}/apply:
   *   post:
   *     tags:
   *       - AI
   *     summary: Apply a generated plan suggestion and create todos
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Suggestion applied and todos created
   *       400:
   *         description: Invalid suggestion payload/type
   *       404:
   *         description: Suggestion not found
   *       409:
   *         description: Suggestion already handled
   */
  const applyOrchestrator = new SuggestionApplyOrchestrator({
    todoService,
    projectService,
    suggestionStore,
    decisionAssistEnabled: decisionAssistEnabled ?? false,
  });

  router.post(
    "/suggestions/:id/apply",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const userId = resolveAiUserId(req, res);
        if (!userId) return;

        const id = String(req.params.id);
        validateId(id);
        const { reason, suggestionId, confirmed, selectedTodoIds } =
          validateApplySuggestionInput(req.body);

        const suggestion = await suggestionStore.getById(userId, id);
        if (!suggestion) {
          return res.status(404).json({ error: "Suggestion not found" });
        }
        if (suggestion.status === "rejected") {
          return res
            .status(409)
            .json({ error: "Cannot apply a rejected suggestion" });
        }

        const result = await applyOrchestrator.apply(userId, suggestion, {
          reason,
          suggestionId,
          confirmed,
          selectedTodoIds,
        });

        if (!result.ok) {
          return res.status(result.status).json({ error: result.error });
        }

        // Emit telemetry for applied suggestions
        const inputSurface =
          typeof suggestion.input?.surface === "string"
            ? suggestion.input.surface
            : "";
        if (inputSurface) {
          emitDecisionAssistTelemetrySafe({
            eventName: "ai_suggestion_applied",
            surface: inputSurface as DecisionAssistSurface,
            aiSuggestionDbId: id,
            suggestionId: suggestionId || undefined,
            suggestionCount: result.appliedTodoIds.length,
            selectedTodoIdsCount:
              selectedTodoIds?.length || result.appliedTodoIds.length,
          });
        }

        return res.json(result.body);
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    "/suggestions/:id/dismiss",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const userId = resolveAiUserId(req, res);
        if (!userId) return;
        if (!ensureDecisionAssistFeatureEnabled(res)) return;

        const id = String(req.params.id);
        validateId(id);
        validateDecisionAssistDismissInput(req.body);

        const suggestion = await suggestionStore.getById(userId, id);
        if (!suggestion) {
          return res.status(404).json({ error: "Suggestion not found" });
        }

        const dismissValidation = validateDismissable(suggestion);
        if (!dismissValidation.ok) {
          return res
            .status(dismissValidation.status)
            .json({ error: dismissValidation.error });
        }
        const inputSurface = dismissValidation.surface;

        // Schema-constrained behavior: dismissing any card rejects the whole suggestion set.
        const updated = await suggestionStore.updateStatus(
          userId,
          id,
          "rejected",
          {
            source: `${inputSurface}_dismiss`,
            updatedAt: new Date().toISOString(),
          },
        );
        if (!updated) {
          return res.status(404).json({ error: "Suggestion not found" });
        }

        emitDecisionAssistTelemetrySafe({
          eventName: "ai_suggestion_dismissed",
          surface: inputSurface,
          aiSuggestionDbId: id,
          suggestionCount: Array.isArray(updated.output?.suggestions)
            ? updated.output.suggestions.length
            : undefined,
          todoId:
            typeof updated.input?.todoId === "string"
              ? updated.input.todoId
              : undefined,
        });

        return res.status(204).end();
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
