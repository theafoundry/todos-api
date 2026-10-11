# Public Planwren package validation

The vendored Agent Plugins 1.0.0 manifest and MCP schema snapshots were retrieved
on October 3, 2026. `provenance.json` records their official URLs and SHA-256
hashes. They are validation inputs outside the public ZIP. The ZIP declares the
public schema URLs, and existing Ajv/js-yaml dependencies validate the manifest,
MCP configuration and skill YAML without runtime network requests.

The current [submission reference](https://developers.openai.com/plugins/deploy/submission)
was retrieved October 11, 2026 by the parent task. The supplied Plugin Creator
submission skill was also read. The official portable schema does not itself
establish directory readiness or publisher verification.

The validator checks listing limits, four canonical HTTPS listing URLs, exactly
five positive/three negative case expectations for this single-server package,
semantic version, starter prompts, skill tools/dependency, images and safe file
inventory. Unknown publishing identity, countries, commerce and demo metadata may
remain absent in a draft and are reported as `preparationGaps`. Selected identities
must agree across `author.name` and `developerName`. Supported current metadata
includes a recording URL, commerce declaration, country allowlist and optional
localized text; local syntax validation does not verify URL playback, business
identity, language quality or portal country support. Only owner-confirmed facts
and actually verified evidence may be written into the real manifest.

This Planwren package deliberately uses only PNG icons and a 256px logo minimum
to satisfy the supplied preparation skill as well as current portal requirements.
The current official portal guide also permits JPEG, WebP and SVG, with square
icons at least 48px. PNG-only and 256px are this package's narrower choices, not
claims about portal restrictions. All images are at most 5 MiB; PNG CRCs,
dimensions, compression payload and scanline filters are checked. The utility's
standalone SVG inspector remains defensive, but SVG files are outside this
public package inventory. Optional authenticated screenshots remain absent for
this draft.

The package has one fixed remote MCP endpoint and six existing conversational
tools. Local policy excludes app mappings, hidden compatibility overlays,
lifecycle hooks, shell commands, environment variables, auth headers, executable
files, symlinks, credentials, local paths, expanded permissions and unused assets.
The archive builder uses sorted regular files, fixed timestamps/permissions and
standard-library ZIP encoding. It checks archive counts, sizes, paths, collisions,
entry types, comments and extra metadata, compares every source hash, safely
extracts the ZIP and validates the extracted copy. Focused tests cover hostile
metadata, credentials, invalid assets, archive tampering and reproducibility.

```sh
node scripts/validate-planwren-public-package.mjs
node --test scripts/review/planwren-public-package.test.mjs
PYTHONDONTWRITEBYTECODE=1 python3 scripts/review/test-planwren-public-package.py
python3 scripts/build-planwren-public-package.py --output .local/publication/planwren-public-0.3.0-draft.zip
python3 scripts/build-planwren-public-package.py --verify .local/publication/planwren-public-0.3.0-draft.zip
```

Passing confirms structure and exact bytes. `metadataComplete` means required
preparation values are present, not that their real-world facts were verified.
It cannot complete owner/business/domain verification, policy coverage,
authentication, reviewer access, host cases, recording review, metadata/skill/tool
scans, legal attestations, upload, submission, approval or publication.
