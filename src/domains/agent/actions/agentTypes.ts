/**
 * agentTypes.ts — Canonical type definitions shared between agentExecutor.ts
 * and the domain-scoped action handler files.
 *
 * These were originally declared inside agentExecutor.ts. Extracting them here
 * allows action handler files to import AgentActionName / AgentExecutionContext
 * / AgentExecutionResult without creating a circular dependency.
 */

export type AgentActionName =
  | "list_tasks"
  | "search_tasks"
  | "get_task"
  | "get_project"
  | "create_task"
  | "update_task"
  | "complete_task"
  | "archive_task"
  | "delete_task"
  | "add_subtask"
  | "update_subtask"
  | "delete_subtask"
  | "list_projects"
  | "create_project"
  | "update_project"
  | "rename_project"
  | "delete_project"
  | "move_task_to_project"
  | "archive_project"
  | "list_today"
  | "list_next_actions"
  | "list_waiting_on"
  | "list_upcoming"
  | "list_stale_tasks"
  | "list_projects_without_next_action"
  | "review_projects"
  | "plan_project"
  | "ensure_next_action"
  | "weekly_review"
  | "decide_next_work"
  | "analyze_project_health"
  | "analyze_work_graph"
  | "analyze_task_quality"
  | "find_duplicate_tasks"
  | "find_stale_items"
  | "taxonomy_cleanup_suggestions"
  | "plan_today"
  | "break_down_task"
  | "suggest_next_actions"
  | "weekly_review_summary"
  | "triage_capture_item"
  | "triage_inbox"
  | "list_audit_log"
  | "get_availability_windows"
  | "create_follow_up_for_waiting_task"
  | "claim_job_run"
  | "complete_job_run"
  | "fail_job_run"
  | "get_job_run_status"
  | "list_job_runs"
  | "list_failed_actions"
  | "record_failed_action"
  | "resolve_failed_action"
  | "get_agent_config"
  | "update_agent_config"
  | "replay_job_run"
  | "simulate_plan"
  | "record_metric"
  | "list_metrics"
  | "metrics_summary"
  | "record_recommendation_feedback"
  | "list_recommendation_feedback"
  | "feedback_summary"
  | "set_day_context"
  | "get_day_context"
  | "weekly_executive_summary"
  | "capture_inbox_item"
  | "list_inbox_items"
  | "suggest_capture_route"
  | "promote_inbox_item"
  | "evaluate_daily_plan"
  | "evaluate_weekly_system"
  | "record_learning_recommendation"
  | "list_learning_recommendations"
  | "apply_learning_recommendation"
  | "list_friction_patterns"
  | "get_action_policies"
  | "update_action_policy"
  | "prewarm_home_focus"
  | "send_task_reminder"
  | "run_data_retention"
  | "list_areas"
  | "get_area"
  | "create_area"
  | "update_area"
  | "list_goals"
  | "get_goal"
  | "create_goal"
  | "update_goal"
  | "list_routines"
  | "generate_morning_brief"
  | "project_health_intervention"
  | "get_day_plan"
  | "create_day_plan"
  | "update_day_plan_task"
  | "finalize_day_plan"
  | "review_day_plan"
  | "record_job_narration";

export interface AgentExecutionContext {
  userId: string;
  requestId: string;
  /** Bounded untrusted display label. Never used as identity. */
  actor: string;
  /** Stable audit identity derived from full/authenticated source. */
  agentId?: string;
  surface: "agent" | "mcp";
  idempotencyKey?: string;
  effectiveDate?: string;
  timezone?: string;
}

export type AgentSuccessEnvelope = {
  ok: true;
  action: AgentActionName | "manifest";
  readOnly: boolean;
  data: Record<string, unknown>;
  trace: Record<string, unknown>;
};

export type AgentErrorEnvelope = {
  ok: false;
  action: AgentActionName;
  readOnly: boolean;
  error: {
    code: string;
    message: string;
    retryable: boolean;
    hint?: string;
    details?: Record<string, unknown>;
  };
  trace: Record<string, unknown>;
};

export type AgentExecutionResult = {
  status: number;
  body: AgentSuccessEnvelope | AgentErrorEnvelope;
};

/**
 * Actions that participate in idempotent planner apply mode.
 * Referenced by plan_project and ensure_next_action handlers.
 */
export const IDEMPOTENT_PLANNER_APPLY_ACTIONS = new Set<AgentActionName>([
  "plan_project",
  "ensure_next_action",
  "weekly_review",
]);
