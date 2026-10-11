# Local synthetic review evidence — 2026-10-11

The five positive cases passed local server assertions. Three additional negative
protocol probes passed without mutation. The actual focused MCP and web capture
routes/services ran against in-process synthetic fixtures. **All five positive
and three negative signed-in ChatGPT cases remain Not run.** No current demo was
recorded, viewed or hosted, and no reviewer account or credentials were created.

The sanitized [JSON report](synthetic-review-2026-10-11.json) binds the public
manifest and MCP declaration to the actual worktree: HEAD at execution,
65 loaded source file hashes, their aggregate, and the four-file harness hash.
The deliberately replaced default Prisma module is excluded from loaded-source
provenance. A commit alone does not identify the uncommitted worktree. Source,
harness and manifest stability were checked during execution; rerun after edits.

| Case | Local assertion                                                                                                                         | Host case status                                    |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| P1   | One Inbox capture; same-key retry returns the same ID without a task or inferred date                                                   | Not run                                             |
| P2   | UTC due/scheduled/overdue set includes completed due-today task; excludes undated completed and foreign task                            | Not run                                             |
| P3   | Actual 45-minute low-energy plan returns three tasks totaling 40 minutes; render uses the exact ordered IDs and matches structured plan | Not run                                             |
| P4   | Complete/reopen exact first returned plan ID; final status next and completion time cleared                                             | Not run                                             |
| P5   | Schedule exact second returned plan ID tomorrow at 09:00 UTC; omitted due date preserved; equivalent timestamp retry is unchanged       | Not run                                             |
| N1   | Forced unsupported `delete_task` call returns `TOOL_NOT_FOUND` without mutation                                                         | Not run; natural-language no-tool behavior untested |
| N2   | Forced user selector rejected; foreign synthetic task ID returns `RESOURCE_NOT_FOUND_OR_FORBIDDEN` without mutation                     | Not run; natural-language no-tool behavior untested |
| N3   | Forced unsupported `send_email` call returns `TOOL_NOT_FOUND` without mutation                                                          | Not run; natural-language no-tool behavior untested |

The web path also accepts an edited capture title once, preserves raw capture
context, keeps inferred dates absent, and returns the same task on a repeat
acceptance. Replaying capture after acceptance returns its original capture.
Pending Inbox becomes empty. Injected MCP-context acceptance returns 403;
a different synthetic user's capture read returns 404. A read-only MCP scope
cannot capture and causes no mutation.

The UTC fixture freezes its calendar date at October 11, 2026. Open samples set
both `estimateMinutes` and `effortScore` to 15/15/10 and low energy. Current source
budgets from `effortScore`, with a default of 30; an estimate alone does not
establish budgeting. IDs are generated through canonical fixture services and
then used from returned structured results, never selected by title or assumed
ranking.

## Reproduce safely

Use supported Node 22 and the installed lockfile dependencies:

```sh
NODE_ENV=test node scripts/review/run-synthetic-review.mjs
node --test scripts/review/synthetic-review-acceptance.test.mjs
node --test scripts/review/reset-review-safety.test.mjs
```

The runner has no production mode or endpoint/database/credential arguments.
It rejects production mode and unsafe inherited URLs before loading source. Its
child receives only an allowlisted environment and an empty temporary `.env`,
uses no database client, and permits sockets only to its own ephemeral literal
loopback listener. A deliberate external-network probe is blocked. Raw service
logs, headers, tokens, environment values and error stacks are withheld. Some
sandboxes require approval to bind even this local listener; an `EPERM` result
is a blocked run, not a passing case.

The **18 harness tests passed**, including safety failures, injected-secret
non-inheritance, actual route assertions and two identical reports apart from
execution time. The **63 reset tests passed offline**, including local database
proof/account/enrollment checks before mutations and UTC fixture fields. No real
reset or database connection ran. The reset is a separate local-only fixture
tool, not hosted reviewer provisioning; see [demo-account-runbook.md](demo-account-runbook.md).

The harness explicitly chooses tool names and arguments. Its auth verifier, web
user context and persistence adapter are fixture seams. It does not prove OAuth,
JWT, revocation, SQL locks/rollback/concurrency, real sign-in, host model routing,
no-tool refusals, actual ChatGPT component rendering or accessibility. Separate
regression evidence is in [verification-2026-10-11.md](verification-2026-10-11.md).
The independent reviewer inspected the harness and found no actionable issue,
with these limits retained. The final host/demo/portal gates remain in
[public-readiness-2026-10-11.md](public-readiness-2026-10-11.md).
