# Planwren public-upload draft

Prepared October 11, 2026 from baseline source `59158d060dc038bfd18e9a1991a5727ae5299e3d`.
The separate package is `plugins/planwren-public`, name `planwren`, version
`0.3.0`. The current archive is a **validated draft**, not ready to submit while
reviewer access, host review, policy coverage, commerce and a verified recording
remain incomplete. It has not been uploaded, submitted or published.

## Current deliverable

Local ZIP: [.local/publication/planwren-public-0.3.0-draft.zip](../../.local/publication/planwren-public-0.3.0-draft.zip).
The ignored `.local` folder holds the generated deliverable, not public source or
credentials. The ZIP is 114633 bytes and its SHA-256 is
`7a624df9a1c58bf61d2d9ca639f1f397ff5c9d95743cb3418eeb7eafad7a00ff`.

The eight entries are root `plugin.json`, `mcp.json`, four approved PNG icons,
`skills/today-planning/SKILL.md` and its `agents/openai.yaml`. The archive contains
no enclosing directory, root `.app.json`, `apps` declarations, compatibility
manifest, private integration ID, auth header, credential, executable or repository
source. `plugins/todos` has no tracked diff; its original private identity and
bindings were not copied or modified.

The one remote MCP is `https://todos.theafoundry.com/mcp/app`. The broader legacy
`/mcp` is separate. Canonical OAuth issuer, UI resource and server identifiers
remain intact; this package does not migrate accounts or grants. OAuth configuration
is discovered from the existing service, not supplied as secrets in the ZIP.

## Metadata

The capture-first subtitle is **Capture now, plan a calmer day**, exactly 30
characters. The detailed description is 1177 characters. Three unique starter
prompts contain 35, 48 and 29 characters. All fit current listing limits and have
no mentions or unsupported controls. All four required listing HTTPS URL fields
are present; their accessible content and policy gaps are reported in
[public-readiness-2026-10-11.md](public-readiness-2026-10-11.md).

The owner selected **Thea Foundry LLC** and **all available countries**.
`author.name` and `developerName` agree. `publication.countries: []` deliberately
removes availability restrictions. This records the intended publisher, not proof
of portal business verification. Commerce and `demo_recording_url` remain absent;
no translations, screenshots, reviewer credentials or attestations are invented.

Exactly five positive and three negative cases are embedded as reproducible
expectations with setup, natural prompts, expected tools/arguments and observable
results. Signed-in ChatGPT executions are **Not run**. Reviewer credentials and
actual sign-in/workspace instructions belong only in protected portal fields.

## Icon provenance and verification

The light PNGs retain the approved source bytes from the original public copy,
matching the canonical Fold branding. Both dark icons reuse the exact
`client-react/public/brand/app-icon-dark-1024.png` bytes; no redesign or rerun of the
brand generator touched the private package. Actual light/composer/dark assets
were viewed: the cream Fold silhouette remains clear on coral and ink tiles,
with no small lettering. Machine inspection verifies square dimensions, PNG
signature/chunks/CRC/payload and size below 5 MiB.

| Asset                    | Dimensions  | Bytes | SHA-256                                                            |
| ------------------------ | ----------- | ----- | ------------------------------------------------------------------ |
| `logo.png`               | 512 × 512   | 18421 | `33f2d3f35b2696deae48fb78bab8b9c9d7393890bbb4b897b8433c59cfe24a03` |
| `composer-icon.png`      | 256 × 256   | 7382  | `963716e9178ab7e82f421bca51968fb12f876af30e77c7ca4e2ccf2325431fc3` |
| `logo-dark.png`          | 1024 × 1024 | 49414 | `7226479bc12fd57d532ac7015784f6b1beaff47b3836bc90e53534d37707289c` |
| `composer-icon-dark.png` | 1024 × 1024 | 49414 | `7226479bc12fd57d532ac7015784f6b1beaff47b3836bc90e53534d37707289c` |

PNG-only assets and a logo minimum of 256px meet both the supplied submission
skill and the current official guide. The official guide also permits JPEG,
WebP and SVG square icons at least 48px; replacing the SVGs is a compatibility
choice, not evidence that current portal validation rejects SVG.

## Reproduce and inspect

Use repository-supported Node 22 and installed lockfile dependencies:

```sh
node scripts/validate-planwren-public-package.mjs
node --test scripts/review/planwren-public-package.test.mjs
PYTHONDONTWRITEBYTECODE=1 python3 scripts/review/test-planwren-public-package.py
python3 scripts/build-planwren-public-package.py --output .local/publication/planwren-public-0.3.0-draft.zip
python3 scripts/build-planwren-public-package.py --verify .local/publication/planwren-public-0.3.0-draft.zip
```

The Node validator passes, reporting `metadataComplete:false` with commerce and
recording gaps. The 43 Node tests and 22 Python tests pass. The builder verifies
every member's safe path, type, size, exact source bytes and CRC, then extracts and
validates the actual upload copy. It produces deterministic archives; the
reproducibility test builds twice and compares exact bytes. A separate verify pass
and direct ZIP inventory/manifest inspection passed after the final build.
Current detailed evidence is in
[public-package-validation-2026-10-11.json](public-package-validation-2026-10-11.json).

Local structure, syntax and hashes cannot establish publisher/domain verification,
policy accuracy, account access, actual host behavior, recording playback, portal
metadata/skill/tool scans or approval. Follow the dated readiness report and
[owner-decisions-2026-10-11.md](owner-decisions-2026-10-11.md) for remaining gates.
Only a separately authorized final portal setup follows completion of source,
listing, demo/review materials and the final ZIP. Submission and publication are
separate authorized actions.

Any package edit changes the archive and hash. Rebuild, re-inspect the ZIP and
update this evidence before final upload. Older version `0.2.0` documents and
release records are historical and do not pass the current draft's host review.
