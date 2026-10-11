# Planwren public listing draft

Prepared October 11, 2026 from source `59158d060dc038bfd18e9a1991a5727ae5299e3d`
in the isolated `codex/planwren-public-readiness` worktree. The public-upload copy
is version `0.3.0`. This is preparation material, not a portal upload, submission,
approved release, or recorded demo.

## Selected identity and availability

The owner selected **Thea Foundry LLC** as the intended verified business
publisher and **all available countries**. The manifest records that name in
`author.name` and `extensions.com.openai.interface.developerName`; an explicit
`publication.countries: []` removes country restrictions. Actual business and
domain verification in the target portal remain unverified. Existing public
pages use the Thea Foundry brand; the owner must confirm its relationship to the
selected legal publisher when resolving policy coverage.

The owner selected free core capture, review and planning at launch, with paid
tiers deferred until post-launch measurement. The manifest declares
`review.commerce:false` and describes the absence of purchase, payment or checkout
flows. Hosted backend AI is to remain disabled until hard cost budgets exist;
this draft does not claim production settings were changed.
No rights or policy attestation has been inferred from source access.

## Listing fields

- Display name: **Planwren** (8 characters).
- Category: **Productivity**.
- Subtitle: **Capture now, plan a calmer day** (30 characters, including spaces and punctuation).
- Detailed description: 1234 characters; the maximum is 4000.
- Publisher name: **Thea Foundry LLC** (16 characters).

Planwren offers free core capture, review, and daily planning. It helps you save actions while chatting in ChatGPT, then come back to a calm, simple workspace to review and plan. Capture an idea or action into Inbox without deciding its full organization on the spot. In the Planwren web app, review saved captures, edit their titles, and accept the ones you want into Tasks. Use Inbox, Today, and Tasks to keep capture, daily work, and your task list easy to find.

Back in ChatGPT, list your own due, scheduled, and overdue tasks, then build a realistic day plan from your available time and energy. View the returned plan in the interactive Today Plan, complete or reopen a task already shown, and reschedule a known task using your account date and timezone. A capture stays an Inbox item until you review it; words such as tomorrow in captured text do not automatically schedule a task.

The connection accesses your own Planwren account. Its six conversational tools do not delete tasks, send messages, make purchases, manage projects, or access another person’s account. Task changes use exact identifiers from prior results and report the state confirmed by the service. Review and full editing happen in the Planwren web app.

## Starter prompts

- Capture: call the dentist tomorrow.
- Plan my day. I have two hours and medium energy.
- What is due or overdue today?

These three prompts are distinct after whitespace normalization, single-line,
under 128 characters each, and contain no app mentions.

## Public URLs and protocol identity

| Listing field | URL                              | Status                                                                                                            |
| ------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Website       | https://www.planwren.com         | Root's current read-only check reports a public page; inspect the rendered product copy in the readiness report.  |
| Support       | https://www.planwren.com/support | Root's current check reports public support/contact content; delivery to the contact address has not been tested. |
| Privacy       | https://www.planwren.com/privacy | Accessible policy; coverage and owner decisions remain incomplete.                                                |
| Terms         | https://www.planwren.com/terms   | Accessible terms; legal applicability and owner attestations remain pending.                                      |

The portable MCP declaration is `https://todos.theafoundry.com/mcp/app`.
The OAuth issuer and UI resource identity remain on `todos.theafoundry.com`.
The broader legacy `/mcp` connection is separate and is not bundled into this
public upload. The original private `plugins/todos` source and bindings are
unchanged.

## Release notes draft

Initial public Planwren package draft: capture actions from ChatGPT into Inbox, review them in the web workspace, and plan a realistic day using time and energy. Includes the focused remote MCP connection, six existing conversational tools, Today Planning skill, and approved Fold icons as PNGs. Intended publisher: Thea Foundry LLC. Country availability: all available countries. Core capture, review, and planning are free, with no purchase or checkout flow. Authenticated review access and a verified demo recording remain pending.

Candidate service/client improvements: single-use authorization codes and transactional refresh rotation prevent duplicate exchanges; detected reuse of a rotated refresh token requires reconnecting that assistant session. Clients must serialize refreshes and retain the latest token. Capture retries retain their safe, repeatable behavior. Mobile users can revoke assistants through Profile and settings → Connected assistants; desktop users use Settings → Integrations. Onboarding and public pages now describe the capture, Inbox review and planning flow accurately, with visible privacy, terms and support links.

## Recording and access

The five positive and three negative cases are drafted in the package and
[test-cases.md](test-cases.md). Their signed-in ChatGPT executions are **Not run**.
Local regression tests are separate evidence and cannot pass these host cases.

[demo-video-script.txt](demo-video-script.txt) gives a capture-first walkthrough,
including actual web Inbox review, the five supported cases, and three boundaries.
A currently authorized synthetic account and working development connection are
needed before rehearsing writes. No account was created, no credentials were
issued, and no real production task was changed during preparation.

`review.demo_recording_url` is absent. The repository's historical
`todos-chatgpt-demo-v1.mp4` is an illustrated synthetic walkthrough with earlier
branding, not a current recorded Planwren acceptance demo. It was not viewed or
approved for this draft and must not be attached as evidence. A final recording
must show real interactions against the chosen source, be played back, and be
hosted at a reviewer-accessible URL before that field is populated.

Reviewer credentials, exact login/workspace details and access instructions must
be supplied only through protected portal fields after separately authorized
provisioning and access testing. These materials and the ZIP contain none.
