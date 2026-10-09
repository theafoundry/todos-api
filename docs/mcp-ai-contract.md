# MCP / Agent API Contract

Version: 1.2.1 — surface `agent_accessibility_v2`

This document is the authoritative reference for all agent-accessible and MCP-exposed actions in the Todos API. It covers authentication, error types, every read and write action, the AI-tool surface, the recommendation schema, dry-run mode, and decision-source tracking.

---

## 1. Overview

The agent/MCP API surface is a thin, machine-oriented layer over the existing task and project services. It is available at the `/agent` base path and exposes two kinds of entry points:

- **Agent actions** — JSON-in / JSON-out POST endpoints under `/agent/read/` (read-only) and `/agent/write/` (mutating). Consumed directly by server-side agents.
- **MCP tool protocol** — The same actions wrapped as MCP tools, served via `/mcp`. Consumed by MCP-compatible AI clients such as Claude Desktop.

All responses share a common envelope:

```jsonc
// success
{
  "ok": true,
  "action": "<action-name>",
  "readOnly": true | false,
  "data": { /* action-specific payload */ },
  "trace": {
    "requestId": "string",
    "actor": "string",
    "idempotencyKey": "string?",
    "timestamp": "ISO-8601 string",
    "replayed": "boolean?"
  }
}

// error
{
  "ok": false,
  "action": "<action-name>",
  "error": {
    "code": "string",
    "message": "string",
    "retryable": true | false,
    "hint": "string?",
    "details": "object?"
  },
  "trace": { "requestId": "...", "actor": "...", "timestamp": "..." }
}
```

---

## 2. Authentication

Authentication is Bearer-token based and is required when the server is configured with MCP auth.

Direct `/agent` requests use an ordinary application access token, including the
access token issued to an enrolled runner. Scoped MCP credentials are accepted
by `/mcp` or `/mcp/app` according to their resource binding, rather than by
application REST or direct `/agent` endpoints. The scope requirements below
apply to MCP tool execution. See [remote MCP authentication](remote-mcp-auth.md)
for token-class, resource and revocation rules.

### Request headers

| Header | Required | Description |
|---|---|---|
| `Authorization` | When auth configured | `Bearer <access-token>` |
| `X-Agent-Name` | Optional | Logical agent identifier recorded in trace logs |
| `X-Agent-Request-Id` | Optional | Caller-supplied correlation ID echoed in responses |
| `Idempotency-Key` | Optional | Durable retry guard for supported create/planner-apply actions |

### Scopes

| Scope | Grants |
|---|---|
| `tasks.read` | Read-only task actions |
| `tasks.write` | Mutating task actions (create, update, complete, archive, delete, subtasks, move) |
| `projects.read` | Read-only project actions |
| `projects.write` | Mutating project actions (create, update, rename, delete, archive) |

Planner actions (`plan_project`, `ensure_next_action`, `weekly_review`) require `projects.read + tasks.read` for `mode: "suggest"` and additionally `tasks.write` for `mode: "apply"`.

---

## 3. Error Codes

All errors follow the structured error shape above. The `retryable` field indicates whether the caller can safely retry the same request.

### Agent surface error codes

| Code | HTTP | Retryable | Description |
|---|---|---|---|
| `INVALID_INPUT` | 400 | No | The action input failed schema or semantic validation |
| `AUTH_REQUIRED` | 401 | No | No bearer token was supplied |
| `INVALID_TOKEN` | 401 | No | The supplied bearer token is not valid |
| `TOKEN_EXPIRED` | 401 | No | The token has expired; refresh and retry |
| `RESOURCE_NOT_FOUND_OR_FORBIDDEN` | 404 | No | The referenced entity does not exist or belongs to a different user |
| `PROJECTS_NOT_CONFIGURED` | 501 | No | The project service is not enabled on this server |
| `PROJECT_NAME_CONFLICT` | 409 | No | A project with that name already exists |
| `INVALID_HEADING_FOR_PROJECT` | 400 | No | The heading does not belong to the specified project |
| `INVALID_TASK_DEPENDENCY` | 400 | No | One or more dependency task IDs are invalid |
| `IDEMPOTENCY_CONFLICT` | 409 | No | The idempotency key was previously used with different input |
| `CONFLICT` | 409 | No | Generic conflict (e.g. concurrent modification) |
| `NOT_CONFIGURED` | 501 | No | A required server capability is not configured |
| `INTERNAL_ERROR` | 500 | Yes | Unexpected server error; inspect logs for the request ID |

### MCP surface error codes

| Code | HTTP | Retryable | Description |
|---|---|---|---|
| `MCP_INVALID_REQUEST` | 400 | No | Request payload does not conform to the MCP tool contract |
| `MCP_UNAUTHENTICATED` | 401 | No | No valid bearer token present |
| `MCP_INVALID_TOKEN` | 401 | No | Bearer token is not a valid MCP access token |
| `MCP_AUTH_EXPIRED` | 401 | No | MCP access token has expired; re-link the account |
| `MCP_FORBIDDEN` | 403 | No | Token lacks the required scope for this action |
| `MCP_INSUFFICIENT_SCOPE` | 403 | No | Token scopes insufficient for the requested operation |
| `RESOURCE_NOT_FOUND_OR_FORBIDDEN` | 404 | No | Entity not found or not owned by the authenticated user |
| `MCP_CONFLICT` | 409 | No | Conflict; fetch current state and retry |
| `MCP_NOT_CONFIGURED` | 501 | No | Required server capability not enabled |
| `MCP_INTERNAL_ERROR` | 500 | Yes | Internal server error; retry with the same request ID |

---

## 4. Read Actions

All read actions require at minimum `tasks.read` or `projects.read` depending on the domain. They do not mutate state and will never appear in write audit logs.

### `list_tasks`

List tasks for the authenticated user with rich filtering.

**Scope:** `tasks.read`
**Path:** `POST /agent/read/list_tasks`

**Input fields (all optional):**

| Field | Type | Description |
|---|---|---|
| `completed` | boolean | Filter by completion state |
| `priority` | `low\|medium\|high\|urgent` | Filter by priority |
| `status` | taskStatus or taskStatus[] | Filter by one or more statuses |
| `category` | string | Filter by category label |
| `project` | string | Filter by project name (fuzzy) |
| `projectId` | uuid | Filter by exact project ID |
| `unsorted` | boolean | Return only tasks not assigned to a project |
| `archived` | boolean | Include or exclude archived tasks |
| `tags` | string[] | Filter by tags (up to 25) |
| `context` | string[] | Filter by context values |
| `energy` | energy or energy[] | Filter by energy level |
| `dueDateFrom/To/After/Before` | ISO-8601 | Due date range filters |
| `dueDateIsNull` | boolean | Tasks without a due date |
| `startDateFrom/To` | ISO-8601 | Start date range |
| `scheduledDateFrom/To` | ISO-8601 | Scheduled date range |
| `reviewDateFrom/To` | ISO-8601 | Review date range |
| `updatedBefore/After` | ISO-8601 | Updated-at range |
| `sortBy` | `order\|createdAt\|updatedAt\|dueDate\|priority\|title` | Sort field |
| `sortOrder` | `asc\|desc` | Sort direction |
| `page` | integer ≥ 1 | Page number |
| `limit` | integer 1–100 | Page size |

**Output:** `{ tasks: Todo[] }`

---

### `search_tasks`

Full-text search across tasks. Same filters as `list_tasks`, but `search` is required.

**Scope:** `tasks.read`
**Path:** `POST /agent/read/search_tasks`

**Required input:** `search` (string, max 200 chars)
**Output:** `{ tasks: Todo[] }`

---

### `get_task`

Fetch a single task by ID.

**Scope:** `tasks.read`
**Path:** `POST /agent/read/get_task`

**Input:** `{ id: uuid }`
**Output:** `{ task: Todo }`

---

### `get_project`

Fetch a single project by ID.

**Scope:** `projects.read`
**Path:** `POST /agent/read/get_project`

**Input:** `{ id: uuid }`
**Output:** `{ project: Project }`

---

### `list_projects`

List projects with optional status/cadence filters.

**Scope:** `projects.read`
**Path:** `POST /agent/read/list_projects`

**Input fields (all optional):** `status`, `archived`, `reviewCadence`
**Output:** `{ projects: Project[] }`

---

### `list_today`

Tasks scheduled or due today.

**Scope:** `tasks.read`
**Path:** `POST /agent/read/list_today`

**Input:** `{ includeOverdue?: boolean (default true), includeCompleted?: boolean (default false) }`
**Output:** `{ tasks: Todo[] }`

---

### `list_next_actions`

Next-action tasks, optionally filtered by project, context, or energy.

**Scope:** `tasks.read`
**Path:** `POST /agent/read/list_next_actions`

**Input:** `{ projectId?, context?, energy?, limit? }`
**Output:** `{ tasks: Todo[] }`

---

### `list_waiting_on`

Tasks in `waiting` status.

**Scope:** `tasks.read`
**Path:** `POST /agent/read/list_waiting_on`

**Input:** `{ projectId? }`
**Output:** `{ tasks: Todo[] }`

---

### `list_upcoming`

Tasks due or scheduled within a window.

**Scope:** `tasks.read`
**Path:** `POST /agent/read/list_upcoming`

**Input:** `{ days?: integer (default 7), includeScheduled?: boolean (default true), includeDue?: boolean (default true) }`
**Output:** `{ tasks: Todo[] }`

---

### `list_stale_tasks`

Tasks not updated in N days.

**Scope:** `tasks.read`
**Path:** `POST /agent/read/list_stale_tasks`

**Input:** `{ daysSinceUpdate?: integer (default 30), completed?: boolean (default false) }`
**Output:** `{ tasks: Todo[] }`

---

### `list_projects_without_next_action`

Active projects that have no task in `next` or `in_progress` status.

**Scope:** `projects.read + tasks.read`
**Path:** `POST /agent/read/list_projects_without_next_action`

**Input:** `{ includeOnHold?: boolean (default false) }`
**Output:** `{ projects: Project[] }`

---

### `review_projects`

Projects due for periodic review.

**Scope:** `projects.read`
**Path:** `POST /agent/read/review_projects`

**Input:** `{ dueForReviewOnly?: boolean (default true) }`
**Output:** `{ projects: Project[] }`

---

### `decide_next_work`

Suggest the best next task to work on given constraints.

**Scope:** `projects.read + tasks.read`
**Path:** `POST /agent/read/decide_next_work`

**Input:** `{ availableMinutes?, energy?, context?, mode?: "suggest"|"apply" }`
**Output:** `{ decision: object }`

---

### `analyze_project_health`

Return health metrics for a specific project.

**Scope:** `projects.read + tasks.read`
**Path:** `POST /agent/read/analyze_project_health`

**Input:** `{ projectId: uuid }`
**Output:** `{ health: object }`

---

### `analyze_work_graph`

Return the dependency graph for tasks in a project.

**Scope:** `projects.read + tasks.read`
**Path:** `POST /agent/read/analyze_work_graph`

**Input:** `{ projectId: uuid }`
**Output:** `{ graph: object }`

---

## 5. Write Actions

Write actions mutate state and are recorded in the audit log. They require write scopes.

### `create_task`

Create a new task.

**Scope:** `tasks.write`
**Path:** `POST /agent/write/create_task`
**Idempotency:** Supported via `Idempotency-Key` header
**Dry-run:** Pass `dryRun: true` to preview without side effects (see Section 8)

**Input fields:**

| Field | Required | Type | Description |
|---|---|---|---|
| `title` | Yes | string (max 500) | Task title |
| `status` | No | taskStatus (default `next`) | Initial status |
| `priority` | No | priority | Priority level |
| `description` | No | string | Long-form description |
| `projectId` | No | uuid | Parent project |
| `dueDate` | No | ISO-8601 | Due date |
| `startDate` | No | ISO-8601 | Start date |
| `scheduledDate` | No | ISO-8601 | Scheduled date |
| `tags` | No | string[] | Tags |
| `context` | No | string | Context label |
| `energy` | No | energy | Required energy |
| `estimateMinutes` | No | integer | Time estimate |
| `waitingOn` | No | string | Waiting-on description |
| `notes` | No | string | Free-form notes |
| `source` | No | taskSource | Origin of the task |
| `recurrence` | No | todoRecurrence | Recurrence rule |
| `dryRun` | No | boolean | Preview mode; returns `DryRunResult` instead of creating |

**Output:** `{ task: Todo }` or `DryRunResult` when `dryRun: true`
**Status:** 201 on creation, 200 on dry-run

---

### `update_task`

Update fields on an existing task.

**Scope:** `tasks.write`
**Path:** `POST /agent/write/update_task`
**Dry-run:** Pass `dryRun: true` to preview without side effects (see Section 8)

**Input:** `{ id: uuid, ...updateFields, dryRun?: boolean }`

All fields from `create_task` (except `title` requirement) plus `order`, `completed`, `archived`.

**Output:** `{ task: Todo }` or `DryRunResult` when `dryRun: true`

---

### `complete_task`

Mark a task complete (or incomplete).

**Scope:** `tasks.write`
**Path:** `POST /agent/write/complete_task`

**Input:** `{ id: uuid, completed?: boolean (default true) }`
**Output:** `{ task: Todo }`

---

### `archive_task`

Archive or un-archive a task.

**Scope:** `tasks.write`
**Path:** `POST /agent/write/archive_task`

**Input:** `{ id: uuid, archived: boolean }`
**Output:** `{ task: Todo }`

---

### `delete_task`

Delete or archive a task.

**Scope:** `tasks.write`
**Path:** `POST /agent/write/delete_task`

**Input:** `{ id: uuid, hardDelete?: boolean (default false) }`
**Output:** `{ deleted: boolean, archived: boolean, taskId: uuid }`

---

### `add_subtask`

Add a subtask to an existing task.

**Scope:** `tasks.write`
**Path:** `POST /agent/write/add_subtask`

**Input:** `{ taskId: uuid, title: string }`
**Output:** `{ subtask: Subtask }` (status 201)

---

### `update_subtask`

Update a subtask.

**Scope:** `tasks.write`
**Path:** `POST /agent/write/update_subtask`

**Input:** `{ taskId: uuid, subtaskId: uuid, title?, completed?, order? }`
**Output:** `{ subtask: Subtask }`

---

### `delete_subtask`

Delete a subtask.

**Scope:** `tasks.write`
**Path:** `POST /agent/write/delete_subtask`

**Input:** `{ taskId: uuid, subtaskId: uuid }`
**Output:** `{ deleted: true, taskId, subtaskId }`

---

### `move_task_to_project`

Move a task to a different project (or remove from project).

**Scope:** `tasks.write`
**Path:** `POST /agent/write/move_task_to_project`

**Input:** `{ taskId: uuid, projectId: uuid | null }`
**Output:** `{ task: Todo }`

---

### `create_project`

Create a new project.

**Scope:** `projects.write`
**Path:** `POST /agent/write/create_project`
**Idempotency:** Supported

**Input:** `{ name: string (required), description?, status?, priority?, area?, goal?, targetDate?, reviewCadence?, archived? }`
**Output:** `{ project: Project }` (status 201)

---

### `update_project`

Update a project's fields.

**Scope:** `projects.write`
**Path:** `POST /agent/write/update_project`

**Input:** `{ id: uuid, ...fields }`
**Output:** `{ project: Project }`

---

### `rename_project`

Rename a project.

**Scope:** `projects.write`
**Path:** `POST /agent/write/rename_project`

**Input:** `{ id: uuid, name: string }`
**Output:** `{ project: Project }`

---

### `delete_project`

Delete or archive a project.

**Scope:** `projects.write`
**Path:** `POST /agent/write/delete_project`

**Input:** `{ id: uuid, moveTasksToProjectId?: uuid | null, archiveInstead?: boolean }`
**Output:** `{ deleted: boolean, archived: boolean, projectId: uuid }`

---

### `archive_project`

Archive or un-archive a project.

**Scope:** `projects.write`
**Path:** `POST /agent/write/archive_project`

**Input:** `{ id: uuid, archived: boolean }`
**Output:** `{ project: Project }`

---

### `plan_project`

Generate or apply a task plan for a project.

**Scope (suggest):** `projects.read + tasks.read`
**Scope (apply):** `projects.read + tasks.read + tasks.write`
**Path:** `POST /agent/write/plan_project`
**Idempotency:** Supported in `mode: "apply"`

**Input:** `{ projectId: uuid, goal?, constraints?: string[], mode?: "suggest"|"apply" (default "suggest") }`
**Output:** `{ plan: object }`

---

### `ensure_next_action`

Ensure a project has at least one next-action task; optionally create one.

**Scope (suggest):** `projects.read + tasks.read`
**Scope (apply):** `projects.read + tasks.read + tasks.write`
**Path:** `POST /agent/write/ensure_next_action`
**Idempotency:** Supported in `mode: "apply"`

**Input:** `{ projectId: uuid, mode?: "suggest"|"apply" }`
**Output:** `{ result: object }`

---

### `weekly_review`

Perform or preview a weekly review across all projects and tasks.

**Scope (suggest):** `projects.read + tasks.read`
**Scope (apply):** `projects.read + tasks.read + tasks.write`
**Path:** `POST /agent/write/weekly_review`
**Idempotency:** Supported in `mode: "apply"`

**Input:** `{ mode?: "suggest"|"apply", includeArchived?: boolean (default false) }`
**Output:** `{ review: object }`

---

## 6. AI Tool Surface

The following AI-focused tools are added as part of the AI evaluation and recommendation pipeline. They are read-only analysis tools that return `Recommendation[]` payloads conforming to the schema in Section 7.

### `find_stale_items`

Identifies tasks that have not been updated recently and may need attention or archiving.

**Scope:** `tasks.read`
**Output:** `Recommendation[]` with `proposedAction: "archive" | "review" | "discard"`

---

### `analyze_task_quality`

Evaluates task titles and descriptions for clarity, actionability, and completeness.

**Scope:** `tasks.read`
**Output:** `Recommendation[]` with `proposedAction: "update" | "review"`

---

### `find_duplicate_tasks`

Detects potentially duplicate or overlapping tasks across projects.

**Scope:** `tasks.read`
**Output:** `Recommendation[]` with `proposedAction: "merge" | "discard"`

---

### `taxonomy_cleanup_suggestions`

Suggests normalization of tags, categories, and context labels for consistency.

**Scope:** `tasks.read`
**Output:** `Recommendation[]` with `proposedAction: "update"`

---

## 7. Recommendation Schema

All AI tool responses return items conforming to the `Recommendation` type defined in `src/ai/recommendationSchema.ts`. Schema version is `"1"`.

```typescript
interface Recommendation {
  id: string;                              // Stable recommendation ID
  kind: string;                            // Tool-specific category label
  confidence: number;                      // 0.0 – 1.0
  why: string;                             // Human-readable rationale
  proposedAction: ProposedAction;          // "create"|"update"|"archive"|"merge"|"review"|"discard"
  entityRefs: string[];                    // Task/project IDs this applies to
  warnings: string[];                      // Non-fatal notices, e.g. "duplicate detected"
  dryRunPatch: Record<string, unknown> | null;  // Populated when dryRun: true
  schemaVersion: "1";
}
```

The `why` field contains a human-readable rationale for the recommendation. It is NOT raw model chain-of-thought; it must be a concise sentence suitable for display in a UI.

Use `makeRecommendation(partial)` to construct a validated instance and `validateRecommendation(r)` to narrow an unknown value at runtime.

---

## 8. Dry-Run Mode

Write actions that support dry-run will preview proposed changes without side effects when `dryRun: true` is passed in the input.

**Currently supported:** `create_task`, `update_task`

### Request

```json
{ "title": "Draft spec", "priority": "high", "dryRun": true }
```

### Response

The `data` field contains a `DryRunResult` instead of the created/updated entity:

```typescript
interface DryRunResult {
  dryRun: true;
  proposedChanges: DryRunPatch[];
}

interface DryRunPatch {
  operation: "create" | "update" | "delete";
  entityKind: "task" | "project" | "capture" | "area" | "goal";
  entityId?: string;       // Populated for update/delete
  fields: Record<string, unknown>;
}
```

**Example response:**

```json
{
  "ok": true,
  "action": "create_task",
  "readOnly": false,
  "data": {
    "dryRun": true,
    "proposedChanges": [
      {
        "operation": "create",
        "entityKind": "task",
        "fields": { "title": "Draft spec", "status": "next", "priority": "high" }
      }
    ]
  },
  "trace": { ... }
}
```

Dry-run responses use HTTP 200 (not 201) and do not create audit records for the underlying entity change.

---

## 9. Decision Source / Rationale Tracking

All AI-initiated write operations must supply a `RationaleMetadata` payload so that every mutation is traceable to its origin.

```typescript
// src/ai/decisionSource.ts

type DecisionSource =
  | "manual"                // Human-initiated through the UI
  | "ai-suggestion-accepted" // AI recommended; user accepted
  | "deterministic-rule"    // Rule-based automation (no model involved)
  | "import";               // Bulk import

interface RationaleMetadata {
  decisionSource: DecisionSource;
  rationale?: string;        // One-sentence explanation (required for AI sources)
  modelVersion?: string;     // e.g. "claude-sonnet-4-6" — AI-generated writes only
  entityRefs?: string[];     // Entity IDs that informed the decision
}
```

### Recording rationale in audit logs

Use `AgentAuditService.logWithRationale()` to emit an audit record that includes rationale:

```typescript
await auditService.logWithRationale(
  { userId, requestId, actor, surface },
  "create_task",
  "success",
  {
    decisionSource: "ai-suggestion-accepted",
    rationale: "Task consolidates two duplicate inbox items",
    modelVersion: "claude-sonnet-4-6",
    entityRefs: ["task-abc", "task-def"],
  },
);
```

The `metadata` JSON column in `AgentActionAudit` will contain the full `RationaleMetadata` alongside the standard `ts` timestamp field.

### When to supply rationale

| Origin | `decisionSource` | `modelVersion` required |
|---|---|---|
| User clicks "accept suggestion" in UI | `ai-suggestion-accepted` | Yes |
| Background rule fires (e.g. auto-archive) | `deterministic-rule` | No |
| Bulk import operation | `import` | No |
| Manual user action via standard API | `manual` | No |

---

## 10. Idempotency

The following actions support the `Idempotency-Key` request header:

| Action | Notes |
|---|---|
| `create_task` | Full response replayed for matching key + input |
| `create_project` | Full response replayed for matching key + input |
| `plan_project` | Only active in `mode: "apply"` |
| `ensure_next_action` | Only active in `mode: "apply"` |
| `weekly_review` | Only active in `mode: "apply"` |

When replaying, the `trace.replayed` field is set to `true` and `trace.originalRequestId` contains the request ID of the first successful execution.

A `IDEMPOTENCY_CONFLICT` (409) is returned if the same key is reused with different input.

---

## 11. Pagination

`list_tasks` and `search_tasks` support cursor-less offset pagination:

- `page` (integer ≥ 1, default 1)
- `limit` (integer 1–100, default 50)

There is no pagination for project list endpoints.

---

## 12. Type Reference

### `TaskStatus`

`inbox | next | in_progress | waiting | scheduled | someday | done | cancelled`

### `Priority`

`low | medium | high | urgent`

### `Energy`

`low | medium | high`

### `ProjectStatus`

`active | on_hold | completed | archived`

### `ReviewCadence`

`weekly | biweekly | monthly | quarterly`

### `TaskSource`

`manual | chat | email | import | automation`
