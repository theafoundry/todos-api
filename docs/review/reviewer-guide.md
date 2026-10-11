# Planwren reviewer guide draft

Prepared October 11, 2026 for public package `0.3.0`, from baseline source
`59158d060dc038bfd18e9a1991a5727ae5299e3d`. Host review cases and reviewer sign-in
have not been executed during this preparation. Use the final candidate's exact
source and the exact saved package version when a separately authorized review
session is available.

## Product flow

Planwren captures actions from a conversation so the user can review later and
plan a realistic day. In the focused ChatGPT connection, `capture_task` creates
an Inbox capture. In the web app, **Inbox** displays saved intentions and lets the
user edit the title and **Accept to Tasks**. **Today** and **Tasks** are the other
primary sections. Accepting a capture and editing its organization happen in the
web app, not through this package's six conversational tools.

The conversational tools are `capture_task`, `list_today`, `plan_today`,
`render_today_plan`, `complete_task`, and `reschedule_task`. The app-only
`open_today_plan` entrypoint opens plan setup; it is not a seventh model-visible
capability. No deletion, messaging, purchases, project administration or
cross-account access is exposed by the focused connection.

## Connection and access dependencies

The package declares one remote HTTPS MCP server at
`https://todos.theafoundry.com/mcp/app`. The server's existing OAuth discovery and
PKCE flow provide authentication; the ZIP has no client credentials, token
headers, local commands, or private app bindings. The canonical issuer and UI
resource identity are preserved for compatibility.

To revoke an assistant, use **Settings → Integrations** on desktop or
**Profile and settings → Connected assistants** on the phone layout. A failed
revocation shows an error and refreshes the session list before offering a retry;
verify the selected session disappears after a successful operation. Detected
reuse of an old refresh token also revokes that assistant session and requires
reconnection. Clients must serialize refresh requests and retain the newest token.

Review requires a dedicated synthetic account containing the fixture data below,
with the permissions and access needed by every case. That account is not
provisioned by these notes. Provide its actual login URL, workspace if applicable,
credentials and steps in the secure portal fields, never in the ZIP or listing.
Verify the reviewer can sign in immediately without needing the owner's mailbox,
phone, MFA approval, private network or additional configuration. Keep access and
sample data available for subsequent review.

Creating/resetting an account, changing grants and making live task writes need
separate authorization. Do not use a real person's production account. The existing
`review:reset` script is not an implicit authorization to run it.

## Proposed synthetic fixture

Let **D** be the date returned by `list_today` in the synthetic account's
configured timezone. Create these samples only in an authorized local/synthetic
environment and record their actual returned IDs; never invent IDs in the
conversation.

| Sample                  | State and purpose                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------ |
| Review sample A         | Open, low energy, 15-minute estimate, due on D.                                                              |
| Review sample B         | Open, low energy, 15-minute estimate, scheduled on D; preserve a distinct due date for the reschedule check. |
| Review sample C         | Open, low energy, 10-minute estimate, overdue from D−1.                                                      |
| Review completed sample | Completed on D; used only by the include-completed read case.                                                |
| Fresh capture text      | No initial Inbox capture with “call the dentist tomorrow.”; P1 creates it.                                   |

The 45-minute plan should have at least two returned tasks for P4/P5. Do not hard-code
the rank: assert IDs against the actual returned order. If the fixture does not
produce at least two tasks, repair the synthetic fixture before executing the
mutations. Task titles containing injected instructions belong to a separate
security fixture and remain untrusted data.

## Execute and record

1. Read the exact cases in [test-cases.md](test-cases.md) and the package metadata.
2. Run P1 in a fresh conversation, then view the capture in web Inbox. Verify that
   its date phrase did not silently schedule a task. If showing the full product
   loop, edit its title and accept it into Tasks in the web app, then inspect the
   single resulting task and preserved capture text.
3. Run P2, then begin a fresh planning conversation for P3 so the agent must obtain
   the authoritative account date and timezone. Compare the text and Today Plan
   component's date, budget, energy and ordered IDs.
4. In P3's context, run P4 and P5 against only synthetic tasks. Preserve any host
   confirmations and record authoritative `changed` flags and dates. Undo means
   reopening to `next`, not restoration of the previous lifecycle state.
5. Run N1–N3 and confirm that they produce no Planwren tool calls or mutations.
6. Cover the additional auth, isolation, retry, empty/error and accessibility checks
   listed in the test matrix. Current local results do not establish host QA.
7. Record each result as Passed, Failed, Blocked or Not run, with UTC time, source,
   package version, surface, sanitized actual tool calls/results and an artifact.

Capture failures as failures and fix them before submission. Do not replace an
error with an optimistic success claim. The recording script is preparation
material until real interactions are captured, played back, sanitized and hosted.
