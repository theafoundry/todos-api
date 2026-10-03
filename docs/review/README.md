# Planwren public submission preparation

This directory contains versioned submission copy, reviewer instructions and
acceptance records for Planwren by Thea Foundry. The deployed application source
is `0335614086f2a4ab587464e81037348b6486c193`, merged by
[PR #1094](https://github.com/theafoundry/todos-api/pull/1094) as
`937ccec55467813d25faa40e164c6fd77a65aab6` with an identical tree.

**Status:** public package and review materials are prepared locally.
No portal upload, submission, reviewer-account provisioning or authenticated
ChatGPT acceptance has occurred during this task. A public release is not
proof of app-directory review acceptance.

## Package boundary

- `plugins/todos` remains the existing working **developer-only** package.
  Its `apps` reference is not the public submission configuration.
- `plugins/planwren-public` is the separate portable public package, with
  root `plugin.json` and `mcp.json`, Planwren/Fold assets, and remote MCP
  `https://todos.theafoundry.com/mcp/app`.
- The canonical OAuth issuer and component domain remain
  `https://todos.theafoundry.com`. No API, OAuth, account or domain migration is
  part of preparing this package.
- Public-package icons use the deployed Fold asset bytes. Final listing
  screenshots remain pending genuine signed-in capture; historical or local
  previews are not final authenticated evidence.

## Current official workflow

Checked October 3, 2026 against the official [package guide](https://developers.openai.com/plugins/build/plugins),
[submission workflow/fields](https://developers.openai.com/plugins/deploy/submission),
[submission validation reference](https://developers.openai.com/plugins/deploy/submission-errors),
[MCP review requirements](https://developers.openai.com/plugins/deploy/app-review),
[authentication guide](https://developers.openai.com/plugins/build/auth) and
[testing guide](https://developers.openai.com/plugins/deploy/connect-chatgpt).

After separate approval, the workflow is: choose the owning organization/project
and verified Thea Foundry developer identity; upload the complete ZIP in the
Plugins dashboard; resolve Metadata & Skills findings; connect the single remote
MCP, complete domain verification/authentication and inspect the scan; supply
protected review credentials, exactly five positive/three negative cases and an
accessible genuine recording; obtain final approval to submit. Directory
publication occurs separately after OpenAI review approval. None of those portal
or account steps were executed here.

The portable root manifests declare Agent Plugins 1.0.0 schemas. OpenAI listing,
review and publication metadata lives under `extensions.com.openai`; OAuth
configuration is discovered from the server, so no client credentials belong in
the ZIP. A valid local ZIP does not prove portal validation, publisher/domain
verification or approval for publication.

## Evidence inventory

| Document                                                             | Purpose                                                                     |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| [branding-and-annotations.md](branding-and-annotations.md)           | Actual write effects, hosted naming gaps and compatibility identities       |
| [public-package.md](public-package.md)                               | Portable package, exact brand provenance and reproduction                   |
| [package-validation.json](package-validation.json)                   | Current local checks, ZIP identity and resolved historical failure          |
| [submission-copy.md](submission-copy.md)                             | Draft Planwren name, descriptions, prompts and public references            |
| [reviewer-guide.md](reviewer-guide.md)                               | Connection, five positive cases, component and session QA                   |
| [test-cases.md](test-cases.md)                                       | Explicit result matrix; submission cases separate from broader QA           |
| [acceptance-report.md](acceptance-report.md)                         | Current deployment identity, dated verified evidence and pending gates      |
| [release-evidence.json](release-evidence.json)                       | Sanitized point-in-time Fold release summary                                |
| [public-evidence.json](public-evidence.json)                         | Fresh October 3 read-only HTTPS status, hashes, policies and discovery      |
| [demo-account-runbook.md](demo-account-runbook.md)                   | Dedicated synthetic account and safe, separately authorized fixture reset   |
| [screenshot-and-recording-plan.md](screenshot-and-recording-plan.md) | Genuine listing captures, historical asset labels and evidence requirements |
| [demo-video-script.txt](demo-video-script.txt)                       | Script for the future authenticated Planwren recording                      |
| [portal-scan-comparison.md](portal-scan-comparison.md)               | Comparison with the canonical MCP tool/resource contract                    |
| [security-review.md](security-review.md)                             | Automated baseline, remaining annotation/security assessment and manual QA  |
| [accessibility-review.md](accessibility-review.md)                   | Public/component accessibility evidence boundaries and remaining checks     |

[live-mcp-evidence.json](live-mcp-evidence.json) separately records fresh
stateless public MCP tool/resource discovery. It does not call authenticated
task tools.

## Safe deterministic checks

Run supported Node 22 and repository checks in the isolated task worktree.
Use explicit loopback test configuration for install/build lifecycle hooks and
unit suites; do not load a production database URL from an environment file.

```bash
node scripts/validate-planwren-public-package.mjs
python3 scripts/build-planwren-public-package.py --output /tmp/planwren-public-0.2.0.zip
npm run review:metadata
npm run test:mcp
npm run eval:plugin
```

The authorized test-only follow-up repaired the stale whole-catalog expectation
in `eval:plugin`. All six trials now pass, with 26 guard tests (25 rejection cases and one acceptance case). The
six conversational definitions remain pinned to the sealed Phase 2 snapshot;
the sole app-only opener must keep its read-only scopes, input and thread UI
metadata. No production tool or OAuth contract changed. See
[branding-and-annotations.md](branding-and-annotations.md) for the concrete
hosted-copy inventory and unresolved write-annotation assessment.

The read-only public discovery, policy, OAuth-metadata and unauthenticated
UserInfo checks can be run against the canonical host:

```bash
REVIEW_BASE_URL=https://todos.theafoundry.com npm run review:discovery
REVIEW_BASE_URL=https://todos.theafoundry.com npm run review:oauth
REVIEW_BASE_URL=https://todos.theafoundry.com npm run review:userinfo
REVIEW_BASE_URL=https://todos.theafoundry.com npm run review:policies
REVIEW_BASE_URL=https://todos.theafoundry.com npm run review:widget
```

`review:widget` checks public MCP discovery, tool/resource metadata and the
self-contained widget contract. It does not execute authenticated task tools.
`review:oauth` checks advertised PKCE/refresh support, not a real code exchange.
`review:userinfo` checks the unauthenticated challenge, not authenticated claims.
The combined `review:acceptance` additionally requires the exact privately
supplied domain challenge token; it must not be reported as passed when that
challenge has not been provisioned and checked.

`review:reset` is destructive for one identified account. It may run only after
separate authorization and the synthetic-account checks in the runbook. Never
commit passwords, OAuth artifacts, tokens, challenge values or revealing
screenshots. This preparation task does not perform resets or grants.

## Remaining submission gates

1. Publisher/business and domain verification in the actual OpenAI workflow.
2. Separately authorized dedicated synthetic account, protected credentials and
   reliable sign-in without interactive verification barriers.
3. Current portal scan compared to the deployed contract, including tool
   annotation assessment; complete/reschedule `destructiveHint: false` needs
   explicit review against current guidance. The currently served widget still
   visibly says Todos; include OAuth connection screens and MCP descriptions in
   the hosted-copy review while preserving compatibility identities.
4. Actual signed-in ChatGPT inline/panel and fullscreen QA, complete/undo,
   refresh, reconnect and security/boundary/accessibility cases against the
   recorded deployed SHA.
5. An accessible authenticated recording with captions and sanitized
   release/session evidence; genuine custom-UI screenshots if included.
6. Owner approval before portal upload or submission, and publication only
   through the approved review workflow.

Every pass needs an artifact, exact source SHA, date and operator. Local tests,
synthetic previews and the August historical walkthrough stay labeled by their
actual scope. If the deployed source changes, rerun affected checks before
carrying forward results.
