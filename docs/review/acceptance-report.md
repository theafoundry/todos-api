# Phase 4B acceptance report

Status: source verified locally; remote CI, hosted and authenticated acceptance pending

## Candidate identity

- PR: [#1075](https://github.com/theafoundry/todos-api/pull/1075)
- Branch: `codex/chatgpt-native-phase4-review`
- Merged source basis: `393c324d650bb87df489ec21f6c0ac7e73383d66` (`master`)
- Previous review candidate: `8e1e21aef198531d9cc71ee04cfd148920e1e67a`
- Refreshed candidate full commit SHA: recorded in the refreshed PR description;
  resolve locally with `git rev-parse HEAD` on this branch
- Deployment URL: `https://todos.theafoundry.com`
- Deployment ID and timestamp: pending
- Deployment reports the exact candidate SHA: pending
- Root lockfile SHA-256:
  `0ff56d56a1d95b5e77c6f2ec7beda4bfeba2652feaac0fac18c29c7064e37b94`
- Client lockfile SHA-256:
  `37b1f8fe998a079fdfd0b8bec8341ef21799d26612a954d395f2fa2031aa507c`

## Evidence boundary

On October 2, 2026, production was serving the `master` source basis above,
with `/healthz` returning 200 and that exact SHA. The earlier audit reported
database readiness healthy; this source refresh did not query the production
database or repeat `/readyz`. The review candidate's
Privacy, Terms, Support, domain challenge, and demo resources returned 404.
Production has not been established as hosting the refreshed candidate.

The [August 12 ChatGPT OAuth and task-flow evidence](https://github.com/theafoundry/todos-api/pull/1074#issuecomment-5272324021)
is historical evidence for an earlier implementation. It does not establish
acceptance against the refreshed candidate. The versioned MP4 is a synthetic
illustrated walkthrough, not fresh authenticated acceptance evidence.

All hosted, portal, and authenticated client checks below remain pending until
they are exercised against a deployment reporting the exact final candidate
SHA. Local checks must be recorded separately and cannot satisfy those gates.

## Local source verification

Verified on October 2, 2026 by Codex on greyhound, using Node 22.22.1 and
Python 3.10.20. The final commit and tested tree are recorded in the PR
description; generated bundles and screenshots are excluded from the change.

| Check                                                      | Result                                                                                             |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Clean root `npm ci` with CI loopback placeholder           | Pass, including Prisma generation and lifecycle build                                              |
| Backend TypeScript/build and repository formatting         | Pass                                                                                               |
| Architecture/harness guards and cleanup report             | Pass; one existing TODO/FIXME warning                                                              |
| Repaired workflow Actionlint and all workflow YAML parsing | Pass                                                                                               |
| `npm run test:unit`                                        | 480 passed                                                                                         |
| `npm run test:mcp`                                         | 123 passed                                                                                         |
| `npm run test:integration`                                 | 229 passed on isolated rerun                                                                       |
| `npm run test:coverage:check`                              | Pass: statements 39.54%, branches 30.04%, functions 38.02%, lines 40.72%                           |
| React Vitest                                               | 1,615 passed, 4 existing skips                                                                     |
| React app/landing/auth builds                              | Pass                                                                                               |
| `CI=1 npm run test:ui:fast`                                | 51 passed, 35 existing skips                                                                       |
| `npm run eval:all`                                         | 25/25 across five suites                                                                           |
| Python Ruff, Mypy, Pytest                                  | Pass; 14 tests                                                                                     |
| Prisma schema, metadata equality, plugin package           | Pass                                                                                               |
| Production audit high-severity gate                        | Pass: 0 high/critical, 33 moderate remain                                                          |
| Full client dependency audit                               | 0 findings                                                                                         |
| Local public HTTP acceptance                               | Pass: challenge, discovery, OAuth metadata, UserInfo challenge, policies, six-tool/widget metadata |

Integration uses a disposable PostgreSQL 18 cluster on loopback port 55475 and
`todos_review_test`; CI uses its PostgreSQL 16 service. The first concurrent
run had one asynchronous feedback-email spy assertion fail; the isolated
rerun passed. Existing nonfatal audit writes also reveal inherited migration
drift: `agent_action_audits.agent_id`/`narration` are in the schema without a
corresponding migration. No schema or migration was added for that unrelated
finding.

The optional full `npm run test:ui` run failed four visual cases: three absent
Linux screenshot baselines and an existing `.auth-card` selector that no
longer matches the React auth page. Generated macOS screenshots were excluded;
no baselines, tests, assertions or thresholds were weakened. The scheduled
UI workflow retains its existing explicit fast-suite fallback when no
baseline directories exist. Visual qualification remains pending.

Harness failure alerts still lack token binding/declared issue-write access
and pass no explicit body to the GitHub CLI. No alerts were executed or access
expanded. The organization Gitleaks license is a separate hosted check
blocker; it is not evidence of a secret finding.

Sanitized local logs live under `/tmp/todos-review-*.log`; audit summaries are
`/tmp/todos-review-audit-after.json` and
`/tmp/todos-review-client-audit-after.json`. Loopback HTTP acceptance used
`/tmp/todos-review-loopback-acceptance.cjs` with compiled `createApp`,
in-memory tasks, fail-closed mock auth, and a synthetic domain token. The
harness asserts the Prisma singleton is not loaded. No hosted account reset,
real authentication, external provider request or user task mutation occurred.

Local verification must use isolated test data, explicit loopback configuration,
and in-memory services or a dedicated local test database. It must not connect
to the production database, reset a hosted account, or mutate a user's tasks.
Mock authentication verifies local route behavior only; it does not establish
real account linking, ChatGPT interoperability, or portal readiness.

## Hosted checks

- [ ] Exact domain challenge
- [ ] Privacy, Terms, and Support pages
- [ ] Protected-resource discovery
- [ ] OAuth authorization-server discovery
- [ ] OpenID configuration and UserInfo challenge
- [ ] PKCE code flow and cancellation paths
- [ ] Refresh rotation, expiry, revoke, replay, and relink
- [ ] Wrong audience and insufficient scope
- [ ] Six-tool surface and Today Plan resource
- [ ] `ui.domain` and exact empty CSP
- [ ] Legacy `/mcp` compatibility

## Portal checks

- [ ] Draft created without selecting Submit for Review
- [ ] Domain verified
- [ ] Scan Tools completed
- [ ] Portal scan canonically equivalent to committed metadata
- [ ] Submission text, URLs, annotations, and demo credentials verified

## Client checks

- [ ] MCP Inspector discovery and all six tools
- [ ] ChatGPT developer-mode connection
- [ ] Five positive reviewer cases
- [ ] Negative, unsupported, ambiguous, and prompt-injection cases
- [ ] Today Plan widget, mutation confirmation, auth expiry, and relink
- [ ] Keyboard, screen reader, reduced motion, contrast, responsive, 200% zoom

## Evidence

Add sanitized evidence paths with date and operator. Do not add secrets or
review credentials.

## Merge gate

Do not merge until all applicable items above pass against the exact candidate
SHA. If the candidate changes, rerun affected checks and update evidence.
