# Assistant MCP

Thin remote MCP layer for connecting registered Todos app users from ChatGPT, Claude, or similar assistant clients.

## What This Layer Does

- keeps `/agent` as the internal task-oriented capability surface
- exposes `/mcp` as the broad legacy remote adapter and `/mcp/app` as the
  focused ChatGPT-native profile with an optional Today Plan component
- reuses the shared internal agent executor instead of duplicating todo or project rules
- requires every MCP call to resolve to a concrete authenticated app user

This is the public connector layer. The internal machine-facing contract still lives in `docs/agent-accessibility.md`.

## Public Endpoints

Runtime endpoints:

- `GET /mcp`
  SSE-style stream endpoint for remote MCP clients that expect long-lived transport.
- `POST /mcp`
  Streamable HTTP JSON-RPC endpoint for MCP methods and tool calls.
- `POST /mcp/app`
  Stateless SDK-backed Streamable HTTP endpoint advertising six model tools:
  `list_today`, `plan_today`, `capture_task`, `complete_task`, and
  `reschedule_task` from Phase 1 plus Phase 2's `render_today_plan`. An additional
  app-only `open_today_plan` opens the Today Plan conversation panel.
- `GET /.well-known/oauth-protected-resource`
  OAuth protected-resource metadata for remote clients.
- `GET /.well-known/oauth-protected-resource/mcp/app`
  Protected-resource metadata whose resource identifier is the exact
  `/mcp/app` endpoint.
- `GET /.well-known/oauth-authorization-server`
  Authorization server metadata.
- `GET /.well-known/openid-configuration`
  OIDC discovery advertising `openid`, `email`, and UserInfo for verified
  workspace-domain identity.
- `GET|POST /oauth/userinfo`
  Audience-bound verified-email identity for access tokens carrying both
  identity scopes. These scopes never authorize Todos tools.
- `POST /oauth/register`
  Dynamic client registration for public PKCE clients.
- `GET /oauth/authorize`
  Browser-based user sign-in and consent page.
- `POST /oauth/token`
  Authorization code exchange for an MCP bearer token.
- `POST /oauth/revoke`
  First-pass OAuth token/session revocation for remote connectors.
- `GET /auth/mcp/sessions`
  Signed-in app route for listing active MCP assistant sessions.
- `POST /auth/mcp/sessions/revoke`
  Signed-in app route for revoking one assistant session or revoking all MCP sessions.
- `GET /healthz`
  Liveness signal for the deployed service.
- `GET /readyz`
  Readiness signal, including database reachability.

Detailed auth and scope behavior lives in `docs/remote-mcp-auth.md`.

## Supported Tools

The `/mcp/app` profile is a separately versioned public contract. It uses
strict public input/output DTOs, per-tool OAuth schemes, 60-minute
resource-audience-bound access tokens, tool-result authorization challenges,
and a committed metadata snapshot. The broad `/mcp` contract below remains
available for existing connectors.

Phase 2 introduced `render_today_plan` with the versioned MCP Apps
resource `ui://todos/today-plan/v1.html`. The render handler reruns the same
canonical planner inputs and intersects its fresh authorized result with the
ordered task IDs from `plan_today`; it does not accept client-provided display
fields. The self-contained component calls `complete_task`, `reschedule_task`,
and `plan_today` through the portable MCP Apps bridge, while the five data and
action tools remain complete in text-only clients. Its CSP allows no direct
network or external static-resource origins.

The Plugin Extension adds an app-only, read-only `open_today_plan` thread
entrypoint on the same resource. It accepts only `{}` and returns a setup state
with the authenticated account's server-authoritative date and timezone. Opening
does not run the planner or mutate tasks. The user supplies available minutes
and energy in the component before calling the existing `plan_today` flow.
Original model-tool metadata and schemas remain unchanged, including the strict
`render_today_plan` contract. Both inline and fullscreen display modes are
advertised; ordinary model renders retain their inline default. See
[Plugin Extensions](plugin-extensions.md) for the host contract and acceptance
checks. Current metadata is captured in
`test/fixtures/mcp-app-metadata.extensions.json`; historical Phase 1/2 snapshots
remain unchanged.

## Local Plugin Installation

The Phase 3 installable package lives at `plugins/todos`. It uses ChatGPT's
registered-app mapping for the deployed `https://todos.theafoundry.com/mcp/app`
connection and does not copy the MCP runtime or Today Plan component into the
package. The package contains the `today-planning` workflow skill, a composer
icon, logo, and a screenshot rendered from the real component with synthetic
task data.

First register `https://todos.theafoundry.com/mcp/app` in ChatGPT developer
mode. Copy the resulting `plugin_asdk_app_...` ID, then generate the local app
mapping. The generated file is ignored because the registered ID belongs to a
specific ChatGPT environment.

The generated mapping derives the canonical `dev-...` app key from the
registered ID. This keeps the mapping aligned with ChatGPT's developer-mode
package shape and avoids a friendly-name collision with an older registration
named `todos`. The key is package plumbing only; the product and plugin remain
named Todos.

From a clean repository checkout, configure, validate, and install the package
as a local Codex marketplace:

```bash
npm run configure:plugin-app -- plugin_asdk_app_<registered-id>
npm run validate:plugin
codex plugin marketplace add .
codex plugin add todos@personal
```

Confirm discovery with `codex plugin list`. The development surface supports
an uninstall/reinstall check with:

```bash
codex plugin remove todos@personal
codex plugin add todos@personal
```

The manifest points to the generated `.app.json`. Do not replace it with a
direct remote URL in `.mcp.json`: `.mcp.json` is for an MCP server distributed
inside a plugin, while this package uses an already deployed and registered
remote app. `plugins/todos/.app.json` stays ignored so a live app ID cannot be
committed accidentally. Run the configuration command again whenever the
registered app ID changes.

The current plugin manifest supports three starter prompts, so it carries the
first three approved prompts. The fourth approved prompt—“Help me work through
today's plan one task at a time.”—is the `today-planning` skill's default
prompt. This package is for local/developer installation only; Phase 3 does not
submit or publish it publicly.

The public MCP adapter is generated from the current agent manifest and exposes
the same underlying action catalog, filtered by token scopes. As of `v1.6.0`,
the runtime manifest advertises 92 actions.

Current public tool categories:

- Task reads
  - `list_tasks`
  - `search_tasks`
  - `get_task`
  - `list_today`
  - `list_next_actions`
  - `list_waiting_on`
  - `list_upcoming`
  - `list_stale_tasks`
- Task writes
  - `create_task`
  - `update_task`
  - `complete_task`
  - `archive_task`
  - `delete_task`
  - `move_task_to_project`
- Subtasks
  - `add_subtask`
  - `update_subtask`
  - `delete_subtask`
- Project reads and writes
  - `list_projects`
  - `get_project`
  - `create_project`
  - `update_project`
  - `rename_project`
  - `delete_project`
  - `archive_project`
  - `list_projects_without_next_action`
  - `review_projects`
  - `suggest_next_actions`
- Planner and review workflows
  - `plan_project`
  - `ensure_next_action`
  - `weekly_review`
  - `plan_today`
  - `simulate_plan`
  - `decide_next_work`
  - `analyze_project_health`
  - `analyze_work_graph`
  - `analyze_task_quality`
  - `break_down_task`
  - `find_duplicate_tasks`
  - `find_stale_items`
  - `taxonomy_cleanup_suggestions`
  - `weekly_review_summary`
  - `weekly_executive_summary`
  - `evaluate_daily_plan`
  - `evaluate_weekly_system`
- Inbox and capture
  - `capture_inbox_item`
  - `list_inbox_items`
  - `promote_inbox_item`
  - `triage_capture_item`
  - `triage_inbox`
  - `create_follow_up_for_waiting_task`
- Agent control plane and operations
  - `claim_job_run`
  - `complete_job_run`
  - `fail_job_run`
  - `get_job_run_status`
  - `list_job_runs`
  - `record_failed_action`
  - `list_failed_actions`
  - `resolve_failed_action`
  - `get_agent_config`
  - `update_agent_config`
  - `replay_job_run`
  - `record_metric`
  - `list_metrics`
  - `metrics_summary`
  - `record_recommendation_feedback`
  - `list_recommendation_feedback`
  - `feedback_summary`
  - `get_action_policies`
  - `update_action_policy`
- Day context and learning loops
  - `get_availability_windows`
  - `set_day_context`
  - `get_day_context`
  - `prewarm_home_focus`
  - `record_learning_recommendation`
  - `list_learning_recommendations`
  - `apply_learning_recommendation`
  - `list_friction_patterns`

`tools/list` only returns tools allowed by the current token scopes.

For the planner write-capable tools, `tools/list` exposes the minimum scopes
needed to run the default `mode: "suggest"` behavior, plus mode-scoped
requirements for `apply`.

Planner runtime details live in `docs/planner-runtime.md`.

## Auth and Scope Model

- browser-based account linking reuses the app's existing user auth
- connector tokens are MCP-scoped bearer tokens, not app session tokens
- supported scopes:
  - `tasks.read`
  - `tasks.write`
  - `projects.read`
  - `projects.write`
- write tools are denied unless the token carries the matching write scope
- `plan_project`, `ensure_next_action`, and `weekly_review` are mode-aware:
  - `mode: "suggest"` requires `projects.read` + `tasks.read`
  - `mode: "apply"` additionally requires `tasks.write`
- `decide_next_work`, `analyze_project_health`, and `analyze_work_graph` are
  read-only planner analysis tools:
  - they require `projects.read` + `tasks.read`
  - they do not mutate in the current runtime
- no MCP path trusts caller-provided user IDs for authorization

## Planner Runtime

The planner MCP tools now route through a dedicated internal planner runtime:

- `PlannerService` is the public facade for planner operations
- `ProjectPlanningEngine` powers project plans and next-action derivation
- `ReviewEngine` powers weekly-review findings and project-health analysis
- `DecisionEngine` powers next-work ranking
- `WorkGraphEngine` powers dependency and blocked/unblocked analysis

Those engines reuse the canonical task/project services underneath, so MCP
connectors do not get a parallel business-logic path.

## Protocol Shape

- `/mcp` supports both:
  - `GET` for SSE-style connector transport
  - `POST` for stateless Streamable HTTP JSON-RPC
- implemented MCP methods:
  - `initialize`
  - `ping`
  - `tools/list`
  - `tools/call`
  - `notifications/initialized`
- `/mcp/app` additionally implements static `resources/list` and
  `resources/read` for the versioned Today Plan resource

## Error Shape

Protocol-level failures return JSON-RPC errors with structured `error.data`.

Tool-level failures return:

- `result.isError = true`
- `result.structuredContent.error` with machine-usable details

Stable auth and authorization codes include:

- `MCP_UNAUTHENTICATED`
- `MCP_INVALID_TOKEN`
- `MCP_AUTH_EXPIRED`
- `MCP_AUTH_REVOKED`
- `MCP_INVALID_SESSION`
- `MCP_INSUFFICIENT_SCOPE`
- `RESOURCE_NOT_FOUND_OR_FORBIDDEN`

## Observability and Safety

The public MCP layer adds:

- request IDs
- user-scoped tool execution
- structured auth and scope-denial logs
- latency logging for `/mcp` calls
- body-size limits and HTTP timeouts
- rate limiting on public OAuth and discovery endpoints

The delegated internal agent execution still emits its own action trace with `surface: "mcp"`.

## Idempotency

Durable idempotency is implemented through an optional `idempotencyKey` tool
argument on:

- `create_task`
- `create_project`
- `plan_project` when `mode="apply"`
- `ensure_next_action` when `mode="apply"`
- `weekly_review` when `mode="apply"`

Current behavior:

- same key + same input => replay the original success response
- same key + different input => structured conflict error
- production/runtime storage is durable across restarts and multiple app instances
- idempotency records expire after 30 days

Current limitation:

- `delete_project` unassigns tasks by default unless `moveTasksToProjectId` is supplied
- project archiving is metadata-only in this pass; archived projects remain listable

## Deployment and Connector Validation

Deployment and beta-verification runbooks live in:

- `docs/ops/railway-remote-mcp-deploy.md`
- `docs/ops/connector-smoke-checklist.md`

Those docs also record what remains manual from this sandboxed environment.

## Current Limitations

- revocation/session management exists as API routes, but there is still no polished in-app assistant management UI
- idempotency is implemented for `create_task`, `create_project`, and the planner apply flows that can create duplicate tasks on retry
- persisted audit records are lightweight operational traces, not a full analytics platform
- the public deployment and real ChatGPT/Claude connector validation must be completed from a networked environment with Railway access
- the MCP catalog is broader than the end-user UI today; some control-plane and evaluation tools are intended for trusted agents and automation flows more than for conversational end-user prompting

## Manifest action index (mechanical doc-sync)

This section lists every action name from `src/agent/agent-manifest.json` so `npm run check:architecture` can verify this document stays aligned with the manifest. Update this list when actions change.

- `add_subtask`
- `analyze_project_health`
- `analyze_task_quality`
- `analyze_work_graph`
- `apply_learning_recommendation`
- `archive_project`
- `archive_task`
- `break_down_task`
- `capture_inbox_item`
- `claim_job_run`
- `complete_job_run`
- `complete_task`
- `create_area`
- `create_follow_up_for_waiting_task`
- `create_goal`
- `create_project`
- `create_task`
- `decide_next_work`
- `delete_project`
- `delete_subtask`
- `delete_task`
- `ensure_next_action`
- `evaluate_daily_plan`
- `evaluate_weekly_system`
- `fail_job_run`
- `feedback_summary`
- `find_duplicate_tasks`
- `find_stale_items`
- `generate_morning_brief`
- `get_action_policies`
- `get_agent_config`
- `get_area`
- `get_availability_windows`
- `get_day_context`
- `get_goal`
- `get_job_run_status`
- `get_project`
- `get_task`
- `list_areas`
- `list_audit_log`
- `list_failed_actions`
- `list_friction_patterns`
- `list_goals`
- `list_inbox_items`
- `list_job_runs`
- `list_learning_recommendations`
- `list_metrics`
- `list_next_actions`
- `list_projects`
- `list_projects_without_next_action`
- `list_recommendation_feedback`
- `list_routines`
- `list_stale_tasks`
- `list_tasks`
- `list_today`
- `list_upcoming`
- `list_waiting_on`
- `metrics_summary`
- `move_task_to_project`
- `plan_project`
- `plan_today`
- `prewarm_home_focus`
- `project_health_intervention`
- `promote_inbox_item`
- `record_failed_action`
- `record_learning_recommendation`
- `record_metric`
- `record_recommendation_feedback`
- `rename_project`
- `replay_job_run`
- `resolve_failed_action`
- `review_projects`
- `run_data_retention`
- `search_tasks`
- `send_task_reminder`
- `set_day_context`
- `simulate_plan`
- `suggest_capture_route`
- `suggest_next_actions`
- `taxonomy_cleanup_suggestions`
- `triage_capture_item`
- `triage_inbox`
- `update_action_policy`
- `update_agent_config`
- `update_area`
- `update_goal`
- `update_project`
- `update_subtask`
- `update_task`
- `weekly_executive_summary`
- `weekly_review`
- `weekly_review_summary`
