# Planwren security and annotation review

Status: current release/source evidence recorded; authenticated and portal
security acceptance remain pending. This preparation creates no credentials,
accounts, grants or expanded persistent access.

## Evidence already available

The deployed Fold release's exact-source PR/master CI, secret scanning, backend
unit suite and coverage passed. Source SHA and workflow links are in
[acceptance-report.md](acceptance-report.md). These tests use isolated data and
do not establish production OAuth/ChatGPT interoperability.

Fresh October 3 public GET evidence confirms canonical OAuth/OIDC discovery,
PKCE S256 and refresh grants advertised, the native protected resource's three
task/project scopes, and unauthenticated UserInfo returning a Bearer challenge.
It does not exercise code exchange, token rotation/replay, authenticated claims,
revocation or account linking. The existing public domain challenge is configured
but has not been compared with the actual portal token for this submission.

Public stateless MCP discovery also passed with six model-visible tools and the
app-only opener; see [live-mcp-evidence.json](live-mcp-evidence.json). The optional
plugin evaluation initially exposed a stale whole-catalog six-tool assumption.
The authorized test-only repair now passes all six trials while pinning the
reviewed six conversational definitions and strictly validating the app-only
opener; 26 guard tests (25 rejection cases and one acceptance case) pass. The initial failure remains historical
and no production contract, fixture or threshold was changed.

## Tool annotation assessment — pending

The native contract explicitly publishes read-only/destructive/open-world
booleans. Six tools are model-visible; `open_today_plan` is app-only. The source
currently sets `destructiveHint: false` for `complete_task` and
`reschedule_task`, which change an existing task's completion/scheduling state.

Current [plugin guidelines](https://developers.openai.com/plugins/plugin-guidelines)
say overwriting writes require a destructive-effect assessment and that undo
alone does not justify a false hint. Assess these actual operations and the
portal scan before submitting. This is a review gate, not a demonstrated exploit
or a backend change performed by the public-package preparation. The package
cannot override live server annotations. In particular, reopening completion
sets a completed task to `next` and clears `completedAt`, rather than restoring
its prior waiting/in-progress state; rescheduling can explicitly clear dates.
See [branding-and-annotations.md](branding-and-annotations.md) for exact effects. Any required server repair needs its
own reviewed change and affected tests.

The current guidelines say annotation justifications are no longer required,
while some submission error/MCP review references still discuss them. Retain
an explanation of behavior for a portal finding, but do not invent an unsupported
package justification field. The actual portal result is authoritative.

## Automated source baseline to attach

- [x] Current preparation checks passed TypeScript, repository formatting,
      538 unit tests, coverage ratchet, 137 MCP tests, UI fast (81 passed/35
      expected skips), and app/landing/auth builds. Final commit and logs are
      recorded in the preparation handoff; these are isolated local tests.
- [x] Metadata snapshot equality and public package/ZIP validation passed; see
      [package-validation.json](package-validation.json).
- [ ] Confirm wrong-audience, missing-scope, expired/malformed token and identity-only
      access cases remain covered by isolated MCP/OAuth tests.
- [ ] Record any current dependency audit separately; do not reuse the October 2
      advisory counts as a current audit.
- [x] Public package/archive inspection and validation found no credentials, hooks,
      local app references, development paths or unneeded permissions.
- [ ] Review the public privacy policy's accuracy for collected data, purposes,
      recipients, retention and user controls before submission.

## Authenticated adversarial/session acceptance — pending

- [ ] PKCE-bound, single-use code exchange; cancel login and consent safely.
- [ ] State, redirect URI, resource, scope, verifier and client binding.
- [ ] Expired authorization code and duplicate callback rejection.
- [ ] Refresh rotation and rejection of expired, revoked or replayed old tokens.
- [ ] Malformed JWT, wrong algorithm/signature, missing claims, future `nbf`, old
      `exp`, wrong issuer/audience and bounded clock skew fail closed.
- [ ] Authenticated UserInfo returns only appropriate verified identity claims.
- [ ] Identity-only/insufficient-scope tokens do not expose tasks or mutate them.
- [ ] Synthetic prompt-injection/HTML/Unicode task content remains data and safe
      output; no instruction embedded in a title is executed.
- [ ] Native `/mcp/app` retains its contract rather than falling through to legacy
      `/mcp`; no cross-account access.
- [ ] Reconnect and recovery do not replay capture/complete/reschedule writes.

Run these only after separate authorization with the dedicated synthetic account
and an isolated, controlled operator procedure. Use
[test-cases.md](test-cases.md) and retain sanitized outcomes; never publish OAuth
codes, bearer/refresh tokens, account identifiers or passwords.

## Historical dependency evidence

The October 2 source refresh reported a passing production high-severity gate
with zero high/critical findings and 33 moderate findings, and a clean client
audit at that time. The earlier candidate had different advisory counts. These
are historical results, not a fresh assessment of this package or the current
advisory database. A passing high-severity gate is not a clean audit or external
security acceptance. No security gate is waived by this document.
