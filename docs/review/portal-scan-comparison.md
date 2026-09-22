# Portal scan comparison

Status: pending portal scan

The canonical local contract is
`test/fixtures/mcp-app-metadata.phase2.json`. `npm run review:metadata`
regenerates the same structure and fails on any byte-level drift from the
committed, Prettier-formatted JSON.

After deploying the exact candidate commit:

1. Create or update the draft app in the OpenAI Apps portal.
2. Run **Scan Tools** against `https://todos.theafoundry.com/mcp/app`.
3. Export or capture the scanned tool and resource metadata.
4. Save a sanitized contract-only JSON export and run
   `npm run review:portal-scan -- path/to/export.json`.
5. Compare tool names, titles, descriptions, input/output schemas,
   annotations, security schemes, `_meta`, server instructions, resource
   metadata, `ui.domain`, and CSP with the committed snapshot.
6. Attach screenshots or a sanitized export below.

## Allowed environment substitutions

None are currently expected in the scanned contract. Timestamps, portal record
IDs, and portal display chrome are evidence metadata and are excluded from the
contract comparison. A hostname difference is not allowed: `ui.domain` and the
review deployment must both be `https://todos.theafoundry.com`.

## Result

- Candidate SHA: pending
- Scan date: pending
- Operator: pending
- Portal app/version: pending
- Canonical equivalence: pending
- Evidence paths: pending
- Differences and disposition: pending
