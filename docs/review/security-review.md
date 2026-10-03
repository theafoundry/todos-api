# Planwren security and annotation review

Status: authorized annotation, timestamp-retry and hosted-copy repairs are
under candidate source review. Production remains the earlier Fold release;
authenticated and portal security acceptance remain pending. No credentials,
accounts, grants or expanded persistent access are created by these repairs.

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
The earlier authorized test-only follow-up passed all six trials and 26 guard
tests before the current runtime repairs. The initial failure is retained as
historical evidence. Final exact-head results for the new candidate belong to
[package-validation.json](package-validation.json) and the preparation handoff.

## Candidate write annotations and retry behavior

The repaired candidate sets `destructiveHint: true` on `complete_task` and
`reschedule_task`, accurately identifying writes that overwrite existing
completion/scheduling state. Read-only/idempotent/open-world hints, scopes,
security schemes and tool names remain unchanged. Production source
`0335614086f2a4ab587464e81037348b6486c193` still advertises false hints until a
separately approved deployment.

Current [plugin guidelines](https://developers.openai.com/plugins/plugin-guidelines)
explain that undo alone does not justify a false destructive hint. Reopening a
completed task sets `next` and clears `completedAt`; it does not restore a prior
waiting/in-progress status. Rescheduling can overwrite or explicitly clear dates.
Idempotency is distinct from those effects.

The candidate normalizes timestamp spellings before comparison/persistence so
an equivalent instant returns `changed: false` without another update or
modification-time churn. Omitted date fields remain untouched; explicit null
clears only the selected field. This is an isolated source repair, not proof of
real ChatGPT retry or refresh/reconnect behavior.

See [branding-and-annotations.md](branding-and-annotations.md) for exact effects,
Planwren hosted-copy changes and compatibility identities. Historical Phase 1/2
fixtures stay immutable; current contract checks allow only explicit approved
annotation/description deltas and still compare whole definitions. Exact-head
verification, future live metadata confirmation and portal rescan remain gates.

The guidelines say annotation justifications are no longer required, while some
submission error/MCP references still discuss them. Keep accurate behavior
explanations available for portal findings without inventing an unsupported
package field. The actual portal result remains authoritative.

## Earlier preparation evidence and new candidate verification

The following results precede the current runtime/branding candidate. They
remain dated evidence, not final repaired-head results:

- [x] Earlier preparation checks passed TypeScript, repository formatting,
      538 unit tests, coverage ratchet, 137 MCP tests, UI fast (81 passed/35
      expected skips), and app/landing/auth builds. Final commit and logs are
      recorded for that earlier preparation; these are isolated local tests.
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

The new candidate needs affected isolated tests for both destructive-hint
changes, equivalent timestamp/no-op/null/omission behavior, hosted Planwren copy
and unchanged compatibility identities, plus required repository checks. The handoff
records exact candidate HEAD and final outcomes; no new pass is asserted here.

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
