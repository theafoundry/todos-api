# Public Planwren package validation

These two JSON files are unchanged public schema snapshots fetched on 2026-10-03:

- [Agent Plugins 1.0.0 manifest schema](https://agent-plugins.org/schemas/1.0.0/plugin.schema.json)
- [Agent Plugins 1.0.0 MCP schema](https://agent-plugins.org/schemas/1.0.0/mcp.schema.json)

`provenance.json` records their source URLs and SHA-256 hashes. They are validation inputs outside the plugin ZIP; the ZIP declares the public schema URLs. Ajv's existing draft 2020-12 implementation validates these snapshots. Existing `js-yaml` parses the skill metadata with its JSON schema; neither utility adds a dependency or fetches resources at runtime.

The schema alone does not define directory readiness. The utilities additionally apply the current [OpenAI submission field reference](https://developers.openai.com/plugins/deploy/submission), [submission error reference](https://developers.openai.com/plugins/deploy/submission-errors), and [skill metadata guidance](https://developers.openai.com/plugins/build/skills). They check final listing limits, the four publisher URLs, five positive and three negative proposed review cases, icon budgets/dimensions/contrast, the skill contract, and MCP dependency alignment.

This package's narrower local policy allows one fixed remote MCP endpoint and six existing tools; it excludes app mappings, lifecycle hooks, shell commands, environment variables, auth headers, executable files, symlinks, credentials, local paths, expanded permissions, unused assets, and compatibility overlays. Static Fold SVGs allow only `svg`, `g`, `rect`, `path`, `title`, and `desc`, with no external references or processing instructions. PNG validation checks chunk CRCs, dimensions, complete decompression, and scanline filters. A local 1,024-byte path limit supplements the documented 20-segment limit.

Screenshots and `demo_recording_url` are intentionally rejected for this candidate until the separate authenticated acceptance and recording gates are completed. Passing these utilities confirms package structure and bytes, not publisher verification, domain verification, dashboard scans, reviewer-account access, authenticated ChatGPT acceptance, upload, submission, or publication. Future approved assets require updating the local package policy.

Run from the linked worktree with the repository's supported Node version:

```sh
node scripts/validate-planwren-public-package.mjs
node --test scripts/review/planwren-public-package.test.mjs
PYTHONDONTWRITEBYTECODE=1 python3 scripts/review/test-planwren-public-package.py
python3 scripts/build-planwren-public-package.py --output /tmp/planwren-public-0.2.0.zip
python3 scripts/build-planwren-public-package.py --verify /tmp/planwren-public-0.2.0.zip
```

Use `--package PATH` to validate a different extracted copy when building or verifying. The ZIP builder uses sorted regular files, fixed timestamps, fixed permissions and compression, then checks archive paths, collisions, entry types, counts and sizes. Comments and extra metadata are excluded by local policy. It compares every file against validated source hashes and validates a safely extracted copy. Focused tests exercise malformed assets/metadata, unsafe archives, byte tampering and byte-for-byte reproducibility. The archive has `plugin.json`, `mcp.json`, `assets/` and `skills/` at its root, with no enclosing directory or repository files.
