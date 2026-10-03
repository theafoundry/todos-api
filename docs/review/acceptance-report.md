# Planwren submission acceptance record

Status: authorized annotation, timestamp-retry and hosted-Planwren repairs are
under candidate source review. Production remains the verified earlier Fold
release. Publisher/domain, portal and actual signed-in ChatGPT acceptance remain
pending; no repaired-source deployment is claimed.

## Exact source and release identity

| Field                            | Recorded value                                                                            |
| -------------------------------- | ----------------------------------------------------------------------------------------- |
| Deployed application SHA         | `0335614086f2a4ab587464e81037348b6486c193`                                                |
| Merge SHA                        | `937ccec55467813d25faa40e164c6fd77a65aab6`                                                |
| Reviewed and merged trees        | Identical                                                                                 |
| Merged PR                        | [#1094](https://github.com/theafoundry/todos-api/pull/1094)                               |
| Production workflow              | [37097991144](https://github.com/theafoundry/todos-api/actions/runs/37097991144), success |
| Provider deployment              | `fecb1a60-55b4-4a95-af3e-c913f321fda6`                                                    |
| Public website                   | `https://www.planwren.com`                                                                |
| Canonical MCP                    | `https://todos.theafoundry.com/mcp/app`                                                   |
| Canonical OAuth issuer/UI domain | `https://todos.theafoundry.com`                                                           |
| Public-package source            | Separate local preparation branch; final commit recorded in the handoff                   |

The public-package/runtime candidate is separate from the already-deployed
application SHA. Exact candidate HEAD and final repaired-source results are
recorded in the candidate handoff and [package-validation.json](package-validation.json).
Source repair and draft-PR approval do not authorize merge/deployment or prove
portal acceptance. All release facts below are dated observations, not a guarantee of
future production state.

## Verified Fold release evidence

The October 3, 2026 release record, completed at 05:06 UTC by Codex on
`greyhound.local`, establishes:

- PR CI passed 12 jobs, with 3 skips, at the exact reviewed source.
- Master CI passed 17 jobs, with 1 skip, and UI Visual passed its job at the
  merge SHA. [PR CI](https://github.com/theafoundry/todos-api/actions/runs/37097462935),
  [master CI](https://github.com/theafoundry/todos-api/actions/runs/37097759683),
  [UI Visual](https://github.com/theafoundry/todos-api/actions/runs/37097759664).
- Production completed through the controlled workflow; migration was a no-op.
- Both public origins served the exact reviewed SHA with trusted HTTPS.
- Public release acceptance passed 275 HTTP assertions across 84 requests and
  206 browser assertions across 16 scenes, two icon galleries and two cache
  activations. It checked deployed Fold bytes/references, public light/dark and
  tiny-icon rendering, and removal of the prior service-worker cache.
- Independent source review passed 15 checks. The dirty primary checkout's
  unrelated user files were preserved; no account/task mutation occurred.

The source preparation checks recorded for that Fold release passed backend
TypeScript/build, repository formatting, 538 unit tests, coverage, 1,616 React
suite tests, the final six BrandMark tests, three frontend builds, UI fast
(81 passed/35 expected skips), four visual smoke tests, plugin validation and
154 local placement assertions. Optional Stylelint retained 125 baseline
violations with zero introduced. These are local/CI source and visual results,
not authenticated ChatGPT acceptance.

See [release-evidence.json](release-evidence.json) for the sanitized summary.
New package-validation results belong to the current preparation handoff and
must not be substituted for these deployment facts.

## Historical evidence disposition

The October 2 audit observed an older production SHA and 404s for candidate
policy/support/domain-challenge/demo resources. That is a historical observation,
not the current deployment identity. Fresh public page/discovery checks on October 3 at 12:59:47 UTC confirm
Privacy, Terms and Support return 200 on both public origins with Planwren/Thea
Foundry identity. The old policy 404s are superseded. The historical synthetic
MP4 and configured challenge also return 200. The challenge body was not
displayed or compared with the portal token, so OpenAI domain verification
remains pending; page availability and trusted TLS do not satisfy it.

[August 12 ChatGPT OAuth/plan/mutation evidence](https://github.com/theafoundry/todos-api/pull/1074#issuecomment-5272324021)
belongs to an earlier implementation. The retained MP4, SRT and SVGs in
`assets/` are a synthetic illustrated walkthrough with historical Todos
branding. Neither establishes authenticated acceptance of the current deployed
Planwren source. The old candidate's CI/license/dependency and optional visual
findings are historical; current release CI links above are authoritative for
that release.

## Current public/package evidence

The fresh [public-evidence.json](public-evidence.json) records 18 unauthenticated
HTTPS GET checks with trusted TLS, expected statuses and response hashes. Health
reports the exact deployed SHA; canonical protected-resource/OAuth/OIDC discovery
preserves the issuer, PKCE S256, refresh grant and native resource scopes.
UserInfo returns the expected unauthenticated 401 Bearer challenge. GET on
`/mcp/app` returns expected 405; this is not proof of authenticated transport
acceptance. No registration, login, grant or task operation was performed.

Earlier package preparation, before the current runtime repair, passed backend
TypeScript, formatting, 538 unit
tests, coverage ratchet, 137 MCP tests, UI fast (81 passed/35 expected skips),
and the app/landing/auth builds. These predecessor results are retained in
the preparation records. Final candidate verification must be recorded against
the new exact HEAD by the candidate handoff. These checks use isolated
loopback data and do not establish authenticated hosted acceptance.

Record public screenshots with their actual host/source/date and label any isolated
synthetic rendering as synthetic. A successful public HTTP check does not test
login, refresh token rotation, account linking, or a task mutation.

Fresh stateless MCP discovery at approximately 13:09 UTC passed
`review:widget`: six model-visible tools, the app-only opener, inline/fullscreen
metadata, canonical UI domain and empty CSP. See
[live-mcp-evidence.json](live-mcp-evidence.json). This is public metadata
evidence, not a signed-in ChatGPT session or authenticated task call.

The initial optional `eval:plugin` run passed five of six trials because its
legacy whole-catalog assertion expected six definitions. The earlier authorized
test-only follow-up passed six trials, 26 guard tests and all 25 deterministic
trials across five suites before the current runtime changes. The original
failure remains historical evidence. Historical Phase 1/2 fixtures stay immutable;
new candidate checks apply only explicit approved annotation/description deltas
and compare whole definitions. Final rerun results are recorded separately.

## Authorized candidate repairs — not deployed

The new candidate:

- Sets `destructiveHint: true` for complete/reopen and reschedule, preserving
  other hints, tool identities, schemas, scopes and security schemes.
- Normalizes supplied reschedule timestamps before comparing and writing.
  Equivalent instants return `changed: false` without another update or
  modification-time churn; omission preserves fields and explicit null clears
  only the selected date.
- Replaces submission-facing Todos copy in widget, OAuth flow and two metadata
  descriptions with Planwren while preserving canonical compatibility names.

These are candidate source changes under review, not live/public acceptance
results. Complete/reopen still does not restore a prior waiting/in-progress
status. See [branding-and-annotations.md](branding-and-annotations.md).

Production `03356140` retains the older false write hints and hosted Todos copy.
The existing public GET/MCP evidence describes that production baseline. After
separately approved merge/deployment, record the new served SHA, fresh true hints
and public copy, portal rescan and actual authenticated QA before replacing
pending gates with results. Local/synthetic captures must carry the actual
candidate source identity and cannot satisfy those hosted checks.

No account was provisioned or reset, no OAuth grant created, no portal draft
uploaded, and no submission made during preparation. The working developer
package is preserved; `plugins/planwren-public` is the distinct public package.

## Pending gate matrix

| Gate                                                | Status / evidence needed                                                                                 |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Publisher/business verification                     | Pending actual portal verification                                                                       |
| OpenAI domain verification                          | Pending actual challenge/portal result; DNS and TLS are insufficient                                     |
| Dedicated synthetic review account                  | Pending separate authorization, provisioning and credential verification                                 |
| Public package portal scan                          | Pending upload authorization, scan and canonical comparison                                              |
| Annotation assessment                               | Candidate true hints under source review; pending approved deployment, live confirmation and portal scan |
| Real OAuth PKCE/code/cancel and identity            | Pending actual signed-in flow on synthetic account                                                       |
| Refresh/expiry/revoke/replay/reconnect              | Pending separately authorized synthetic-session QA                                                       |
| ChatGPT inline/panel and fullscreen                 | Pending actual container evidence                                                                        |
| Complete/undo/refresh/reschedule/capture            | Pending authoritative results on synthetic fixtures                                                      |
| Boundary and adversarial cases                      | Pending actual signed-in cases in test matrix                                                            |
| Component accessibility in ChatGPT                  | Pending keyboard, zoom, narrow/mobile, light/dark, reduced motion and assistive-tech evidence            |
| Optional custom-UI screenshots / required recording | Pending genuine current authenticated captures                                                           |
| Final submission approval                           | Pending owner review of completed materials/evidence                                                     |

**Brand consistency:** candidate hosted copy is updated to Planwren, but
production still has the baseline Todos labels. Exact-source deployment and
actual signed-in confirmation remain pending.

## Recording new results

Use [test-cases.md](test-cases.md). Every result needs the exact deployed SHA,
UTC timestamp, operator, environment, sanitized artifact path/hash and outcome.
Retain failures as failures. Do not mark a pending case passed from a synthetic
preview, unit test or historical screenshot. If source changes, assess and rerun
affected checks. Do not include credentials, account identifiers, private task
content or OAuth artifacts in public evidence.
