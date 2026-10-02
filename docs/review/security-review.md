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

Audit date: 2026-10-02

The previous candidate's production lockfile now reports 8 high findings and
29 moderate findings. The August 13 audit is historical and does not describe
the current advisory database.

The source refresh updates Nodemailer to 10.0.13, Axios to 1.20.0,
`brace-expansion` to 5.0.12, and `fast-uri` to 4.1.5. Scoped overrides update
Prisma's `deepmerge-ts` and `mysql2` dependencies while keeping Prisma 7.8.0.
Nodemailer 10's Node 20 minimum is compatible with the project's supported
Node range; its existing transport API and Prisma's plain-object config merge
were checked locally.

After the refresh, `npm run audit:prod` passes its high-severity gate with
33 moderate findings and no high or critical findings. The React client audit
reports no findings after compatible Vite/Vitest and transitive lock updates.
The remaining production moderate advisories remain open; this report does
not treat a passing high-severity gate as a clean audit or external security
acceptance.

Do not mark this review complete while an applicable high or critical finding
remains unmitigated.
