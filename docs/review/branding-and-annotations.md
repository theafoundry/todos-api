# Candidate branding, write annotations and timestamp retries

Status: authorized source repairs are under review on the public-submission
candidate. Exact candidate HEAD and final check results belong to the preparation
handoff and [package-validation.json](package-validation.json). Production still
serves `0335614086f2a4ab587464e81037348b6486c193`; the candidate repairs are not
production or authenticated ChatGPT acceptance evidence.

## Production baseline and candidate disposition

| Property                                     | Production source `03356140`                                            | Repaired candidate                                               |
| -------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `complete_task.destructiveHint`              | `false`                                                                 | `true`                                                           |
| `reschedule_task.destructiveHint`            | `false`                                                                 | `true`                                                           |
| Other native tool destructive hints          | `false`                                                                 | Unchanged `false`                                                |
| Complete/reschedule read-only hint           | `false`                                                                 | Unchanged `false`                                                |
| Idempotent/open-world hints                  | `true` / `false`                                                        | Unchanged `true` / `false`                                       |
| Reschedule equality                          | Raw requested timestamp string compared with canonical persisted string | Supplied timestamps normalized before comparison and persistence |
| Submission-facing widget/OAuth/metadata copy | Residual Todos labels                                                   | Planwren labels; stable compatibility identities preserved       |

The [current annotation guideline](https://developers.openai.com/plugins/plugin-guidelines#correct-annotation)
requires overwriting effects to be identified accurately; undo alone does not
justify a false destructive hint. The candidate therefore explicitly identifies
complete/reopen and reschedule as writes with potentially destructive effects.
This changes annotation metadata, not the task operations' authority or scopes.
Portal confirmation of the repaired live metadata remains pending after an
approved deployment and scan.

## Actual write effects

| Tool              | Effect and limits                                                                                                                                                                                                                                                                |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `capture_task`    | Adds an inbox capture with an opaque idempotency key. It does not directly create a scheduled task or persist a date inferred from text. Its additive operation keeps `destructiveHint: false`.                                                                                  |
| `complete_task`   | Sets completion on one contextual task. Completion changes status to `done` and sets `completedAt`; reopening a completed task sets `next` and clears `completedAt`. It does not restore a previous waiting/in-progress status. The candidate uses `destructiveHint: true`.      |
| `reschedule_task` | Sends only supplied scheduled/due fields; either may be cleared explicitly with `null`. An actual write may reconcile lifecycle state through shared persistence. The candidate uses `destructiveHint: true` and compares normalized instants to avoid unnecessary retry writes. |

Source: [appContract.ts](../../src/mcp/appContract.ts),
[appTools.ts](../../src/mcp/appTools.ts),
[captureService.ts](../../src/services/captureService.ts),
[prismaTodoService.ts](../../src/services/prismaTodoService.ts), and
[taskLifecycle.ts](../../src/domains/tasks/taskLifecycle.ts).

Idempotency and destructive effects describe different properties. A repeated
request can be a no-op while the initial request still overwrites task state.
The candidate does not add full lifecycle undo, deletion, cross-account access,
project writes, new grants or broader permissions.

## Equivalent timestamp retry repair

The production implementation can treat an equivalent timestamp spelling as a
change because it compares the incoming text with a canonical persisted ISO
string. For example, `2026-10-04T09:00:00Z`,
`2026-10-04T09:00:00.000Z`, and `2026-10-04T05:00:00-04:00` identify the same
instant.

The candidate normalizes supplied non-null timestamps using the existing
`iso()` conversion before comparing and passing an actual update. Equivalent
instants return `changed: false`, skip `update_task`, and avoid modification-time
churn. A genuinely different instant still updates the requested field.
Omitted fields preserve existing values and are excluded from the update
payload; explicit `null` clears only the selected date. Clearing an already-null
field is also a no-op. No-op retries do not run shared persistence/lifecycle
normalization. Invalid non-null dates fail with an argument error rather than
being normalized into an unintended clear operation.

These are candidate behavior expectations to verify with focused isolated tests
and, later, the dedicated synthetic review account. Final recorded verification results
are authoritative; this assessment itself is not a test result. Actual
ChatGPT session and mutation acceptance remain pending.

## Hosted product copy repair

The candidate updates submission-facing text in the Today Plan widget, OAuth
login/signup/consent and verified-email errors, plus the renderer/resource
metadata descriptions, to **Planwren**. This includes the visible eyebrow,
“Open in Planwren,” connection/error/status text and account consent copy.
The main React landing/auth screens, policy identity and public package already
use Planwren by Thea Foundry.

Production at `03356140` still has the older hosted labels and false write hints.
Current public captures and discovery JSON describe that baseline. Candidate
local/synthetic previews must be labeled with their actual source and cannot
prove hosted deployment or signed-in ChatGPT acceptance. New public and actual
ChatGPT captures are required after any separately approved deployment.

## Narrow contract verification

Historical Phase 1/2 fixtures remain immutable. The current extensions snapshot
has only the intended two destructive-hint flips and two metadata-description
branding replacements. Contract checks must assert the expected old values and
apply explicit literal approved deltas, then compare whole definitions. They
must continue rejecting unrelated annotation, schema, scope, security-scheme,
UI visibility, entrypoint, resource, CSP and display-mode drift. No broad field
stripping, weakened assertion or additional tool is part of the repair.

## Compatibility identities preserved

- Exact OAuth issuer and UI domain remain `https://todos.theafoundry.com`.
  The native MCP resource/audience remains
  `https://todos.theafoundry.com/mcp/app`; OAuth/token/UserInfo URLs remain
  canonical.
- Server `todos-native-app`, component URI `ui://todos/today-plan/v1.html` and
  app/resource identity `todos-today-plan` remain stable.
- Six conversational tool names, app-only `open_today_plan`, task IDs, input/
  output schemas and existing application/identity scopes remain stable.
- The developer package `plugins/todos`, local marketplace registration,
  historical reviewer assets, repository slug and source filenames remain.

Support explanations that existing connections may still be listed as Todos,
and historical “Planwren (previously Todos)” copy remain accurate. The ICS
producer identifier `Todos App` is an export compatibility identity. These
identities and explanations are distinct from the hosted product labels repaired
in the candidate.

## Remaining release/review gates

Complete exact-head isolated verification and source review, then use the
owner-approved draft-PR workflow. Merge and production deployment require
separate approval. After deployment, verify exact served SHA, new public copy and
live tool hints, then rescan the portal and execute the synthetic-account
ChatGPT/session/accessibility matrix. Publisher/domain verification, account
provisioning, credentials and the genuine recording remain pending. No portal
upload, real-user task mutation or completed acceptance is implied here.
