# Security review

Status: pending external acceptance

## Automated baseline

- [ ] TypeScript and unit/MCP suites pass.
- [ ] Wrong-audience access token is rejected at `/mcp/app`.
- [ ] Missing scope returns an MCP `mcp/www_authenticate` challenge.
- [ ] Authorization codes are single-use and PKCE-bound.
- [ ] Refresh tokens rotate and replay of the prior token is rejected.
- [ ] Malformed and expired JWTs fail closed.
- [ ] OAuth `state` is preserved exactly through success, cancellation, and
      failures.
- [ ] Duplicate authorization callbacks do not produce a second usable code.
- [ ] Clock-skew behavior is bounded and documented.
- [ ] Challenge token is exact, text-only, no-store, and absent when unconfigured.
- [ ] Public policy pages do not expose secrets or private reviewer data.

## Manual adversarial cases

- [ ] Cancel at login and at consent; no grant is created.
- [ ] Modify `state`, `redirect_uri`, `resource`, scope, verifier, and client ID.
- [ ] Exchange an expired authorization code.
- [ ] Exchange an expired, revoked, and already-rotated refresh token.
- [ ] Replay an approved callback and an already-used authorization code.
- [ ] Send JWTs with malformed segments, wrong algorithm, wrong signature,
      missing claims, future `nbf`, old `exp`, and wrong audience.
- [ ] Put prompt injection, HTML, and Unicode controls in task titles; outputs
      remain sanitized and task content never becomes instruction.
- [ ] Confirm `/mcp/app` cannot fall through to the legacy `/mcp` contract.

## Dependency audit

Audit date: 2026-08-13

Before the Phase 4B lockfile refresh, the production audit reported 36 findings:
1 low, 27 moderate, and 8 high. The direct high-risk package was Nodemailer;
other high findings were transitive.

Phase 4B updates Nodemailer, Express Rate Limit, and pins fixed transitive
versions for Axios, Hono, `ip-address`, and other vulnerable parser/runtime
packages. After the refresh, `npm run audit:prod` reports 20 moderate findings
and no high or critical findings. The remaining moderate findings are in the
Sentry/OpenTelemetry chain and the Prisma CLI/tooling chain; neither is used to
parse MCP tool inputs or authorize requests. They remain tracked for normal
framework upgrades.

Do not mark this review complete while an applicable high or critical finding
remains unmitigated.
