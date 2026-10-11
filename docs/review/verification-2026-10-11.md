# Planwren candidate verification — 2026-10-11

This is sanitized local verification evidence for `codex/planwren-public-readiness`, based on `59158d060dc038bfd18e9a1991a5727ae5299e3d`. The final commit is identified in the companion handoff. These results do not establish deployment, authenticated ChatGPT acceptance, reviewer account access, portal scans or publication approval.

| Check                                | Final result                                                                                                     |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Backend unit/coverage                | 32 suites, 678 tests passed; coverage ratchet passed                                                             |
| MCP regression                       | 8 suites, 277 tests passed                                                                                       |
| PostgreSQL auth boundary and capture | 2 suites, 87 tests passed against disposable PostgreSQL 18, synthetic fixtures only                              |
| Full React suite                     | 166 files, 1,926 passed, 4 intentional skips, using 2 workers                                                    |
| Focused changed client flows         | 8 files, 108 tests passed                                                                                        |
| Fast UI                              | 190 passed, 100 intentional skips, isolated loopback port 4217                                                   |
| Rendered mobile diagnostics          | Initial Chromium/WebKit matrix 4/4 passed at 320×400 and 390×844; settled screenshots independently viewed       |
| Build/static                         | Backend build, all three React builds, backend TypeScript, repository formatting and diff whitespace passed      |
| Tool/UI metadata                     | Generated metadata matches the unchanged checked-in fixture                                                      |
| Plugin evaluation                    | 6 deterministic cases passed                                                                                     |
| Public-package validators            | 43 Node and 22 Python tests passed; safe extraction, source hashes and reproducibility verified                  |
| Dependencies                         | React audit: 0 advisories after allowed-range source-map-js patch; backend runtime: 36 moderate, 0 high/critical |
| Preservation                         | Original private package/bindings, schema/migrations, CI/production workflows and workflow guards unchanged      |

Coverage exceeds all stored baselines: statements 41.72% (baseline 37.56%), branches 32.97% (27.95%), functions 39.65% (35.12%), lines 42.94% (38.75%). Tests ran with supported Node 22.22.1. Existing tests and source timeouts were not weakened.

Final regression reruns address documented host contention. A default full React run passed 1,925 tests but timed out in an unchanged SectionHeader test; a contended four-worker attempt was interrupted, and the final complete two-worker run passed. Initial MCP runs encountered an unchanged intermittent socket-hangup case; the final full rerun passed. A contended PostgreSQL run had 10-second hook timeouts and cascading synthetic fixture collisions; after clean reset the same assertions passed with a 30-second CLI timeout. Screenshot refinements encountered harness navigation/lazy-image timeouts; the initial complete 4/4 run and viewed settled screenshots remain the qualified evidence. No claim is made that those refinement attempts passed.

An independent Codex reviewer inspected the final source changes, publisher/retention/readiness claims, exact ZIP and representative settled screenshots. It found no actionable source or package defect. It separately ran OAuth service, package/archive, affected frontend and TypeScript checks, and confirmed that private identity, token boundaries, workflow/schema files and compiled assets were preserved. This is a code review, not an external security certification.

Public inspection covered website, privacy, terms, support, app/auth pages, `/healthz`, `/readyz`, protected-resource discovery, OAuth/OIDC discovery, UserInfo rejection without a bearer token, and stateless `tools/list`. All four listing URLs returned meaningful public pages. UserInfo returned the expected 401; GET `/mcp/app` returned the expected 405 and tools/list returned six model-visible tools plus the app-only opener. Production health matched the base SHA; the existing production-release/CI/visual/secret-scan runs were successful. These checks created no grants, credentials, sessions, tasks or account mutations.

The exact public ZIP contains 8 files, is 114,633 bytes, and has SHA256 `7a624df9a1c58bf61d2d9ca639f1f397ff5c9d95743cb3418eeb7eafad7a00ff`. Structural validation passes; `metadataComplete:false` accurately preserves the pending commerce and demo fields. The five positive and three negative host review cases remain **Not run**. No current authenticated demo exists or was viewed.

Detailed local logs, HTTP records and screenshots are retained outside candidate source in the task's `evidence/` directory. Raw synthetic OAuth fixture logs are excluded from public materials. Generated build files were restored/removed, and only owned preview/browser/disposable database resources were stopped. The companion handoff records the final secret scan, commit and artifact inventory.

See [public-readiness-2026-10-11.md](public-readiness-2026-10-11.md) for blockers and [public-package-validation-2026-10-11.json](public-package-validation-2026-10-11.json) for the machine-readable package inventory.
