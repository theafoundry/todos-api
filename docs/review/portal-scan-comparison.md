# Planwren portal scan comparison

Status: pending portal upload authorization and scan. Local package/contract
validation is separate from portal validation.

The canonical local contract is
`test/fixtures/mcp-app-metadata.extensions.json`. `npm run review:metadata`
regenerates the same structure and fails on byte-level drift from the committed,
Prettier-formatted JSON. The deployed contract contains six model-visible tools
plus `open_today_plan` with app-only visibility and a thread entrypoint.

After separate approval for portal upload and a verified dedicated synthetic
review account:

1. Follow the current official submission workflow with the prepared public
   `plugins/planwren-public` package, not the developer-only `plugins/todos`
   package or its app-reference configuration.
2. Scan the remote MCP `https://todos.theafoundry.com/mcp/app` using the actual
   supported portal scan step. Record the current deployed SHA first.
3. Export/capture the scanned tool and resource metadata without credentials,
   tokens or account data.
4. Save the sanitized contract-only JSON and run
   `npm run review:portal-scan -- path/to/export.json`.
5. Compare tool names, titles, descriptions, input/output schemas, annotations,
   security schemes, `_meta`, server instructions, resource metadata, component
   entrypoint/display modes, `ui.domain` and CSP against the committed snapshot.
6. Assess annotations against current guidance, including the deployed
   `complete_task` and `reschedule_task` `destructiveHint: false` values.
   Record the assessment; this preparation does not change server annotations
   or assert a proven regression.
7. Attach sanitized evidence and record every discrepancy before proceeding.

## Allowed environment substitutions

None are expected within the scanned canonical contract. Timestamps, portal
record IDs and portal chrome are evidence metadata and excluded from contract
comparison. The marketing website is `https://www.planwren.com`; the issuer,
resource audience and `ui.domain` remain `https://todos.theafoundry.com`.
A brand change is not permission to substitute a hostname or widen CSP.

## Result

- Deployed application SHA: `0335614086f2a4ab587464e81037348b6486c193`
- Public package source commit: recorded in final local preparation handoff
- Scan UTC date/operator: pending
- Portal app/version: pending
- Canonical equivalence: pending
- Annotation assessment: pending
- Sanitized evidence paths/hashes: pending
- Differences and disposition: pending
