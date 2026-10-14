import { randomUUID } from "crypto";
import { Request, Response, Router } from "express";
import { AuthService } from "../services/authService";
import { agentAuthMiddleware } from "../middleware/agentAuthMiddleware";
import { getAgentRequestContext } from "../agent/agentContext";
import { AgentActionName, AgentExecutor } from "../agent/agentExecutor";
import { AgentJobRunService } from "../services/agentJobRunService";
import type { AiProviderAdmissionService } from "../services/aiProviderAdmissionService";
import { createAgentRunQueue } from "../domains/agent/runs/agentRunQueue";

interface AgentRouterDeps {
  agentExecutor: AgentExecutor;
  authService?: AuthService;
  jobRunService?: AgentJobRunService;
  providerAdmissionService?: AiProviderAdmissionService;
}

function getAgentUserId(req: Request): string {
  return req.user?.userId || "default-user";
}

function buildExecutionContext(req: Request) {
  const requestContext = getAgentRequestContext(req);
  return {
    userId: getAgentUserId(req),
    requestId: requestContext.requestId,
    actor: requestContext.actor,
    agentId: requestContext.agentId,
    idempotencyKey: requestContext.idempotencyKey,
    surface: "agent" as const,
  };
}

function createAgentActionHandler(
  agentExecutor: AgentExecutor,
  action: AgentActionName,
) {
  return async (req: Request, res: Response) => {
    const result = await agentExecutor.execute(
      action,
      req.body,
      buildExecutionContext(req),
    );
    res.status(result.status).json(result.body);
  };
}

export function createAgentRouter({
  agentExecutor,
  authService,
  jobRunService,
  providerAdmissionService,
}: AgentRouterDeps): Router {
  const router = Router();

  router.get("/manifest", (req: Request, res: Response) => {
    const requestContext = getAgentRequestContext(req);
    res.json({
      ok: true,
      action: "manifest",
      readOnly: true,
      data: {
        manifest: agentExecutor.getRuntimeManifest(Boolean(authService)),
      },
      trace: {
        requestId: requestContext.requestId,
        actor: requestContext.actor,
        ...(requestContext.idempotencyKey
          ? { idempotencyKey: requestContext.idempotencyKey }
          : {}),
        timestamp: new Date().toISOString(),
      },
    });
  });

  if (authService) {
    router.use(agentAuthMiddleware(authService, providerAdmissionService));
  }

  router.post(
    "/read/list_tasks",
    createAgentActionHandler(agentExecutor, "list_tasks"),
  );
  router.post(
    "/read/search_tasks",
    createAgentActionHandler(agentExecutor, "search_tasks"),
  );
  router.post(
    "/read/get_task",
    createAgentActionHandler(agentExecutor, "get_task"),
  );
  router.post(
    "/read/get_project",
    createAgentActionHandler(agentExecutor, "get_project"),
  );
  router.post(
    "/read/list_projects",
    createAgentActionHandler(agentExecutor, "list_projects"),
  );
  router.post(
    "/read/list_today",
    createAgentActionHandler(agentExecutor, "list_today"),
  );
  router.post(
    "/read/list_next_actions",
    createAgentActionHandler(agentExecutor, "list_next_actions"),
  );
  router.post(
    "/read/list_waiting_on",
    createAgentActionHandler(agentExecutor, "list_waiting_on"),
  );
  router.post(
    "/read/list_upcoming",
    createAgentActionHandler(agentExecutor, "list_upcoming"),
  );
  router.post(
    "/read/list_stale_tasks",
    createAgentActionHandler(agentExecutor, "list_stale_tasks"),
  );
  router.post(
    "/read/list_projects_without_next_action",
    createAgentActionHandler(
      agentExecutor,
      "list_projects_without_next_action",
    ),
  );
  router.post(
    "/read/review_projects",
    createAgentActionHandler(agentExecutor, "review_projects"),
  );
  router.post(
    "/read/decide_next_work",
    createAgentActionHandler(agentExecutor, "decide_next_work"),
  );
  router.post(
    "/read/analyze_project_health",
    createAgentActionHandler(agentExecutor, "analyze_project_health"),
  );
  router.post(
    "/read/analyze_work_graph",
    createAgentActionHandler(agentExecutor, "analyze_work_graph"),
  );
  router.post(
    "/write/create_task",
    createAgentActionHandler(agentExecutor, "create_task"),
  );
  router.post(
    "/write/update_task",
    createAgentActionHandler(agentExecutor, "update_task"),
  );
  router.post(
    "/write/complete_task",
    createAgentActionHandler(agentExecutor, "complete_task"),
  );
  router.post(
    "/write/archive_task",
    createAgentActionHandler(agentExecutor, "archive_task"),
  );
  router.post(
    "/write/delete_task",
    createAgentActionHandler(agentExecutor, "delete_task"),
  );
  router.post(
    "/write/add_subtask",
    createAgentActionHandler(agentExecutor, "add_subtask"),
  );
  router.post(
    "/write/update_subtask",
    createAgentActionHandler(agentExecutor, "update_subtask"),
  );
  router.post(
    "/write/delete_subtask",
    createAgentActionHandler(agentExecutor, "delete_subtask"),
  );
  router.post(
    "/write/create_project",
    createAgentActionHandler(agentExecutor, "create_project"),
  );
  router.post(
    "/write/update_project",
    createAgentActionHandler(agentExecutor, "update_project"),
  );
  router.post(
    "/write/rename_project",
    createAgentActionHandler(agentExecutor, "rename_project"),
  );
  router.post(
    "/write/delete_project",
    createAgentActionHandler(agentExecutor, "delete_project"),
  );
  router.post(
    "/write/move_task_to_project",
    createAgentActionHandler(agentExecutor, "move_task_to_project"),
  );
  router.post(
    "/write/archive_project",
    createAgentActionHandler(agentExecutor, "archive_project"),
  );
  router.post(
    "/write/plan_project",
    createAgentActionHandler(agentExecutor, "plan_project"),
  );
  router.post(
    "/write/ensure_next_action",
    createAgentActionHandler(agentExecutor, "ensure_next_action"),
  );
  router.post(
    "/write/weekly_review",
    createAgentActionHandler(agentExecutor, "weekly_review"),
  );
  router.post(
    "/write/prewarm_home_focus",
    createAgentActionHandler(agentExecutor, "prewarm_home_focus"),
  );
  router.post(
    "/write/send_task_reminder",
    createAgentActionHandler(agentExecutor, "send_task_reminder"),
  );

  // H3: Areas & Goals
  router.post(
    "/read/list_areas",
    createAgentActionHandler(agentExecutor, "list_areas"),
  );
  router.post(
    "/read/get_area",
    createAgentActionHandler(agentExecutor, "get_area"),
  );
  router.post(
    "/write/create_area",
    createAgentActionHandler(agentExecutor, "create_area"),
  );
  router.post(
    "/write/update_area",
    createAgentActionHandler(agentExecutor, "update_area"),
  );
  router.post(
    "/read/list_goals",
    createAgentActionHandler(agentExecutor, "list_goals"),
  );
  router.post(
    "/read/get_goal",
    createAgentActionHandler(agentExecutor, "get_goal"),
  );
  router.post(
    "/write/create_goal",
    createAgentActionHandler(agentExecutor, "create_goal"),
  );
  router.post(
    "/write/update_goal",
    createAgentActionHandler(agentExecutor, "update_goal"),
  );

  // H3: Morning brief & Project health intervention
  router.post(
    "/write/generate_morning_brief",
    createAgentActionHandler(agentExecutor, "generate_morning_brief"),
  );
  router.post(
    "/write/project_health_intervention",
    createAgentActionHandler(agentExecutor, "project_health_intervention"),
  );

  // H3: Routines & Retention
  router.post(
    "/read/list_routines",
    createAgentActionHandler(agentExecutor, "list_routines"),
  );
  router.post(
    "/write/run_data_retention",
    createAgentActionHandler(agentExecutor, "run_data_retention"),
  );

  // Anti-entropy
  router.post(
    "/read/analyze_task_quality",
    createAgentActionHandler(agentExecutor, "analyze_task_quality"),
  );
  router.post(
    "/read/find_duplicate_tasks",
    createAgentActionHandler(agentExecutor, "find_duplicate_tasks"),
  );
  router.post(
    "/read/find_stale_items",
    createAgentActionHandler(agentExecutor, "find_stale_items"),
  );
  router.post(
    "/read/taxonomy_cleanup_suggestions",
    createAgentActionHandler(agentExecutor, "taxonomy_cleanup_suggestions"),
  );

  // Planning
  router.post(
    "/read/plan_today",
    createAgentActionHandler(agentExecutor, "plan_today"),
  );
  router.post(
    "/read/break_down_task",
    createAgentActionHandler(agentExecutor, "break_down_task"),
  );
  router.post(
    "/read/suggest_next_actions",
    createAgentActionHandler(agentExecutor, "suggest_next_actions"),
  );
  router.post(
    "/read/weekly_review_summary",
    createAgentActionHandler(agentExecutor, "weekly_review_summary"),
  );

  // Inbox namespace: capture, list, promote
  router.post(
    "/write/capture_inbox_item",
    createAgentActionHandler(agentExecutor, "capture_inbox_item"),
  );
  router.post(
    "/read/list_inbox_items",
    createAgentActionHandler(agentExecutor, "list_inbox_items"),
  );
  router.post(
    "/read/suggest_capture_route",
    createAgentActionHandler(agentExecutor, "suggest_capture_route"),
  );
  router.post(
    "/write/promote_inbox_item",
    createAgentActionHandler(agentExecutor, "promote_inbox_item"),
  );

  // Triage / audit / availability
  router.post(
    "/write/triage_capture_item",
    createAgentActionHandler(agentExecutor, "triage_capture_item"),
  );
  router.post(
    "/write/triage_inbox",
    createAgentActionHandler(agentExecutor, "triage_inbox"),
  );
  router.post(
    "/read/list_audit_log",
    createAgentActionHandler(agentExecutor, "list_audit_log"),
  );
  router.post(
    "/read/get_availability_windows",
    createAgentActionHandler(agentExecutor, "get_availability_windows"),
  );

  // Issue #316: follow-up for waiting tasks
  router.post(
    "/write/create_follow_up_for_waiting_task",
    createAgentActionHandler(
      agentExecutor,
      "create_follow_up_for_waiting_task",
    ),
  );

  // Issue #314: server-side job-run locking
  router.post(
    "/write/claim_job_run",
    createAgentActionHandler(agentExecutor, "claim_job_run"),
  );
  router.post(
    "/write/complete_job_run",
    createAgentActionHandler(agentExecutor, "complete_job_run"),
  );
  router.post(
    "/write/fail_job_run",
    createAgentActionHandler(agentExecutor, "fail_job_run"),
  );
  router.post(
    "/read/get_job_run_status",
    createAgentActionHandler(agentExecutor, "get_job_run_status"),
  );
  router.post(
    "/read/list_job_runs",
    createAgentActionHandler(agentExecutor, "list_job_runs"),
  );

  // Issue #320: dead-letter store
  router.post(
    "/write/record_failed_action",
    createAgentActionHandler(agentExecutor, "record_failed_action"),
  );
  router.post(
    "/read/list_failed_actions",
    createAgentActionHandler(agentExecutor, "list_failed_actions"),
  );
  router.post(
    "/write/resolve_failed_action",
    createAgentActionHandler(agentExecutor, "resolve_failed_action"),
  );

  // Issues #329–#332: control plane, replay, simulate, metrics
  router.get(
    "/read/get_agent_config",
    createAgentActionHandler(agentExecutor, "get_agent_config"),
  );
  router.post(
    "/write/update_agent_config",
    createAgentActionHandler(agentExecutor, "update_agent_config"),
  );
  router.post(
    "/write/replay_job_run",
    createAgentActionHandler(agentExecutor, "replay_job_run"),
  );
  router.get(
    "/read/simulate_plan",
    createAgentActionHandler(agentExecutor, "simulate_plan"),
  );
  router.post(
    "/write/record_metric",
    createAgentActionHandler(agentExecutor, "record_metric"),
  );
  router.get(
    "/read/list_metrics",
    createAgentActionHandler(agentExecutor, "list_metrics"),
  );
  router.get(
    "/read/metrics_summary",
    createAgentActionHandler(agentExecutor, "metrics_summary"),
  );

  // Issues #334, #336, #337: feedback, day context, executive summary
  router.post(
    "/write/record_recommendation_feedback",
    createAgentActionHandler(agentExecutor, "record_recommendation_feedback"),
  );
  router.get(
    "/read/list_recommendation_feedback",
    createAgentActionHandler(agentExecutor, "list_recommendation_feedback"),
  );
  router.get(
    "/read/feedback_summary",
    createAgentActionHandler(agentExecutor, "feedback_summary"),
  );
  router.post(
    "/write/set_day_context",
    createAgentActionHandler(agentExecutor, "set_day_context"),
  );
  router.get(
    "/read/get_day_context",
    createAgentActionHandler(agentExecutor, "get_day_context"),
  );
  router.get(
    "/read/weekly_executive_summary",
    createAgentActionHandler(agentExecutor, "weekly_executive_summary"),
  );

  // Evaluation endpoints (#349, #350)
  router.post(
    "/read/evaluate_daily_plan",
    createAgentActionHandler(agentExecutor, "evaluate_daily_plan"),
  );
  router.post(
    "/read/evaluate_weekly_system",
    createAgentActionHandler(agentExecutor, "evaluate_weekly_system"),
  );

  // Learning recommendation endpoints (#351)
  router.post(
    "/write/record_learning_recommendation",
    createAgentActionHandler(agentExecutor, "record_learning_recommendation"),
  );
  router.post(
    "/read/list_learning_recommendations",
    createAgentActionHandler(agentExecutor, "list_learning_recommendations"),
  );
  router.post(
    "/write/apply_learning_recommendation",
    createAgentActionHandler(agentExecutor, "apply_learning_recommendation"),
  );

  // Friction patterns (#338)
  router.post(
    "/read/list_friction_patterns",
    createAgentActionHandler(agentExecutor, "list_friction_patterns"),
  );

  // Action policies (#339)
  router.get(
    "/read/get_action_policies",
    createAgentActionHandler(agentExecutor, "get_action_policies"),
  );
  router.post(
    "/write/update_action_policy",
    createAgentActionHandler(agentExecutor, "update_action_policy"),
  );

  router.post(
    "/write/record_job_narration",
    createAgentActionHandler(agentExecutor, "record_job_narration"),
  );

  // -------------------------------------------------------------------------
  // Async run endpoints — enqueue agent actions and return 202 Accepted.
  // The run executes outside the HTTP request cycle.
  // -------------------------------------------------------------------------
  if (jobRunService) {
    const runQueue = createAgentRunQueue({ agentExecutor, jobRunService });

    router.post("/runs", async (req: Request, res: Response) => {
      const { action, params } = req.body;
      if (!action || typeof action !== "string") {
        return res
          .status(400)
          .json({ error: "Missing required field: action" });
      }

      const userId = getAgentUserId(req);
      const requestContext = getAgentRequestContext(req);
      const runId = randomUUID();

      const { claimed, run } = await jobRunService.claimRun(
        userId,
        action,
        runId,
      );
      if (!claimed) {
        return res.status(409).json({ error: "Run already claimed" });
      }

      runQueue.enqueue({
        runId,
        userId,
        action,
        params: params || {},
        requestId: requestContext.requestId,
        actor: requestContext.actor,
      });

      res.status(202).json({
        ok: true,
        runId,
        status: "running",
        action,
        trace: {
          requestId: requestContext.requestId,
          timestamp: new Date().toISOString(),
        },
      });
    });

    router.get("/runs/:runId", async (req: Request, res: Response) => {
      const userId = getAgentUserId(req);
      const { runId } = req.params;

      // Find run by checking all runs for the user with this runId as periodKey
      const runs = await jobRunService.listRuns(userId, { limit: 100 });
      const run = runs.find((r) => r.periodKey === runId);

      if (!run) {
        return res.status(404).json({ error: "Run not found" });
      }

      res.json({
        ok: true,
        run: {
          id: run.id,
          runId: run.periodKey,
          action: run.jobName,
          status: run.status,
          retryCount: run.retryCount,
          startedAt: run.claimedAt?.toISOString(),
          completedAt: run.completedAt?.toISOString() || null,
          failedAt: run.failedAt?.toISOString() || null,
          errorMessage: run.errorMessage || null,
          result: run.metadata || null,
        },
      });
    });
  }

  return router;
}
