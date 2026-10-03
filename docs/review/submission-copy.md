# Planwren submission copy

Status: prepared draft for the authorized repaired candidate; no portal upload
or submission has occurred. The candidate is not deployed. Review credentials,
authenticated screenshots and the final recording remain pending.

## Name and publisher

- Display name: **Planwren**
- Publisher: **Thea Foundry**
- Category: **Productivity**
- Brand: coral Fold mark (`#E17055`) with cream (`#FFFCF5`) and ink (`#2D1F1A`)

## Short description

Plan and act on today's tasks

## Detailed description

Planwren is a personal planning workspace by Thea Foundry. Connect your account
to see work due or overdue today and build a realistic plan from your available
time and energy. View the plan in an interactive Today Plan component, capture
a new task, complete or reopen a task already shown, and reschedule work using
your account's date and timezone.

Planwren accesses the connected person's account. It does not delete tasks,
create projects, access another person's account, send messages, or make
purchases. Task changes return the server's authoritative state; the app does
not guess task identifiers from titles.

## Starter prompts

- “Plan my day. I have two hours and medium energy.”
- “What is due or overdue today?”
- “Capture: call the dentist tomorrow.”

## Public references

| Field          | Value                                                     |
| -------------- | --------------------------------------------------------- |
| Website        | `https://www.planwren.com`                                |
| Privacy        | `https://www.planwren.com/privacy`                        |
| Terms          | `https://www.planwren.com/terms`                          |
| Support        | `https://www.planwren.com/support`                        |
| Support email  | `hello@theafoundry.com`                                   |
| Remote MCP     | `https://todos.theafoundry.com/mcp/app`                   |
| OAuth issuer   | `https://todos.theafoundry.com`                           |
| Coral Fold SVG | `https://www.planwren.com/brand/fold-coral.svg?v=fold-v1` |
| App icon       | `https://www.planwren.com/app/icon-512.png?v=fold-v1`     |

The public brand and website use Planwren. Existing protocol identifiers and
the canonical OAuth issuer retain the `todos.theafoundry.com` origin; this
package does not migrate OAuth, MCP, resource identifiers, or account grants.
Current production is `0335614086f2a4ab587464e81037348b6486c193` and retains
older hosted Todos labels and false complete/reschedule destructive hints.
The authorized candidate changes hosted copy to Planwren, those hints to true,
and normalizes equivalent reschedule timestamp retries. Exact candidate HEAD
and results are in the candidate handoff; no repaired deployment is claimed here.

## Reviewer notes

Use the dedicated synthetic reviewer account supplied through the portal's
protected credential field once it has been separately authorized, created,
verified, and tested. Account provisioning and credential handoff have not been
performed during package preparation. The account must work without MFA, SMS,
email confirmation during review, VPN, or private-network access.

Begin with “Plan my day. I have two hours and medium energy.” Verify the textual
plan and the Today Plan component use the same date, budget, energy, and ordered
task IDs. Test inline and fullscreen views, complete and undo a synthetic task,
refresh the plan, then disconnect and reconnect. Follow
[reviewer-guide.md](reviewer-guide.md) and record results in
[test-cases.md](test-cases.md).

## Screenshot and recording status

Public-page and isolated synthetic previews may support design review. They do
not establish authenticated ChatGPT acceptance. Any final custom-UI screenshots
and the required recording must be captured from the actual signed-in ChatGPT session using
the dedicated synthetic account, with no credentials or tokens visible.

The existing
`https://todos.theafoundry.com/review/todos-chatgpt-demo-v1.mp4` is a historical
illustrated walkthrough with synthetic data and earlier Todos branding. It is
not the final Planwren recording or acceptance evidence for the deployed source.
Do not attach it as the final submission demo. The August 12, 2026 evidence at
[PR #1074](https://github.com/theafoundry/todos-api/pull/1074#issuecomment-5272324021)
also belongs to an earlier implementation.

## Submission gate

Package preparation does not authorize portal upload, account creation,
credential grants, or directory submission. Before submission, complete
publisher/domain verification, credential checks, the authenticated test matrix,
a current authenticated recording, genuine custom-UI screenshots if included,
and final owner approval. Follow the
current official workflow recorded in [README.md](README.md).

The candidate write effects, normalized timestamp behavior and hosted-copy
changes are described in [branding-and-annotations.md](branding-and-annotations.md).
Completion undo means reopening, not restoration of a prior lifecycle status.
Stable issuer, resource and server identities remain compatibility names.
Verify new live source, annotations and branding after an approved deployment
before recording final authenticated acceptance or submitting this draft.
