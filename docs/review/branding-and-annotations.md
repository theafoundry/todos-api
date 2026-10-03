# Branding and write-annotation assessment

Assessed October 3, 2026 against deployed application source
`0335614086f2a4ab587464e81037348b6486c193`. This is a source assessment, not
authenticated acceptance, a portal decision or a production change.

## Write annotations and actual effects

All seven native tools advertise `destructiveHint: false`,
`idempotentHint: true` and `openWorldHint: false`. Capture, complete and
reschedule advertise `readOnlyHint: false`; list, plan, render and the app-only
opener advertise `readOnlyHint: true`. See
[appContract.ts](../../src/mcp/appContract.ts).

| Tool              | Actual effect                                                                                                                                                                                                 | Assessment before submission                                                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `capture_task`    | Adds an inbox capture using an opaque idempotency key. It does not directly create a scheduled task or infer a persisted date.                                                                                | A false destructive hint is consistent with an additive operation; authenticate and scan the actual implementation before accepting it.                       |
| `complete_task`   | Sets completion on one contextual task. Shared lifecycle persistence changes status to `done` and sets `completedAt`; reopening clears completion, sets a completed task to `next`, and clears `completedAt`. | This overwrites existing state. Reopening does **not** restore a prior waiting or in-progress status. Undo alone does not establish a false destructive hint. |
| `reschedule_task` | Sends only the explicitly supplied scheduled/due fields; either can be cleared with `null`. Persistence also reconciles status/completion fields and updates the modification timestamp.                      | This can overwrite or remove existing dates. Returned previous dates and idempotency do not by themselves establish a false destructive hint.                 |

Source paths: [appTools.ts](../../src/mcp/appTools.ts),
[captureService.ts](../../src/services/captureService.ts),
[prismaTodoService.ts](../../src/services/prismaTodoService.ts),
[taskLifecycle.ts](../../src/domains/tasks/taskLifecycle.ts).
With a consistent existing lifecycle state, rescheduling keeps completion values
unchanged; inconsistent older state may be normalized by shared persistence.

The current [correct-annotation guideline](https://developers.openai.com/plugins/plugin-guidelines#correct-annotation)
requires assessment of overwriting writes and explicitly says undo alone is
insufficient. Complete/reschedule therefore need an explicit pre-submission
disposition; the current false hints are **not signed off** by this preparation.
The source contains no deletion tool, but absence of deletion is not sufficient
to establish that these overwrites are non-destructive. Idempotency is a separate
property from read-only or destructive effects.

The package cannot override server annotations. Any required annotation change
needs reviewed server source, affected tests, deployment approval and a fresh
portal tool scan. This task changes none of those production contracts. It does
not establish an exploit or a completed review decision.

## Submission-facing naming gaps

The public package, skill, main React landing/auth screens and public policy
headers/footer already use **Planwren by Thea Foundry**. The following hosted
copy still uses Todos and remains a separate source/acceptance gap:

| Surface                     | Concrete residual copy                                                                                                                                      | Source                                                                                 |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Today Plan widget           | Eyebrow `Todos`; link `Open in Todos`                                                                                                                       | [todayPlanResource.ts](../../src/mcp/todayPlanResource.ts), lines 166 and 190          |
| Widget connection/errors    | `Your Todos connection expired`; `Todos did not return a result`; `Todos could not complete that action`; invalid-plan and invalid-planning-settings errors | Same source, lines 255, 302, 309, 473 and 486                                          |
| Widget status/fallback      | `Plan made from Todos`; `Plan refreshed from Todos`; `Open Todos from its web app if this link is blocked`                                                  | Same source, lines 515, 572 and 622                                                    |
| MCP metadata                | Renderer description ends with `authoritative Todos state`; resource description says `authoritative Todos day plan`                                        | [appContract.ts](../../src/mcp/appContract.ts), line 270; widget source, line 25       |
| OAuth login/signup/consent  | `your Todos account`; `connect ... to Todos`; `wants access to your Todos account`                                                                          | [mcpOAuthPages.ts](../../src/mcp/mcpOAuthPages.ts), lines 163–164, 199–200 and 259–260 |
| OAuth verified-email errors | `The linked Todos account needs a verified email address`; `Verify the email address on this Todos account`                                                 | [mcpPublicRouter.ts](../../src/routes/mcpPublicRouter.ts), lines 487 and 526           |

These are copy gaps, not identities that must change with the public name. They
were inventoried without rewriting hosted widget, OAuth pages or tool metadata.
Actual captures must show the existing labels accurately; do not replace them
through image editing or claim a complete hosted rebrand.

## Intentional compatibility identities

Preserve these until a separately reviewed compatibility migration exists:

- Exact OAuth issuer, native MCP resource/audience and UI domain:
  `https://todos.theafoundry.com`; canonical OAuth/token/UserInfo and
  `https://todos.theafoundry.com/mcp/app` URLs.
- Server identity `todos-native-app`, component URI
  `ui://todos/today-plan/v1.html`, and resource/app identity `todos-today-plan`.
- Six conversational tool names, app-only `open_today_plan`, schemas, task IDs,
  scope declarations, source filenames and sealed canonical fixtures.
- Developer package `plugins/todos`, its local marketplace registration,
  historical reviewer assets and the repository's existing slug.

Support copy explaining that existing connections may still be listed as Todos,
and email copy explaining “Planwren (previously Todos),” intentionally describe
history; they are not stale product labels to erase. The ICS producer identifier
`Todos App` is an export compatibility identity, not a ChatGPT listing label.

Public-package/review headings and current listing text have no remaining
unqualified Todos product-name gap. Review materials now distinguish the hosted
copy gaps above from compatibility identifiers and historical evidence. A
future hosted-copy repair must preserve those identities and receive its own
source, test and deployment review before the submission record is updated.
