# Planwren public submission preparation

Current preparation: October 11, 2026, package `0.3.0`, baseline source
`59158d060dc038bfd18e9a1991a5727ae5299e3d` from the isolated
`codex/planwren-public-readiness` worktree. The owner selected **Thea Foundry LLC**
and **all available countries**. This work prepares source and materials; it has
not uploaded, submitted, published, created reviewer credentials or recorded a
current signed-in demo.

The current outcome and owner-dependent gates are in
[public-readiness-2026-10-11.md](public-readiness-2026-10-11.md) and
[owner-decisions-2026-10-11.md](owner-decisions-2026-10-11.md). Publisher verification,
policy coverage, reviewer access, commerce and a real accessible recording are
not completed merely by local package validation.

## Current materials

| File                                                                                   | Purpose                                                                             |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| [submission-copy.md](submission-copy.md)                                               | Capture-first listing, selected identity/countries, honest release notes and links. |
| [verification-2026-10-11.md](verification-2026-10-11.md)                               | Final local regression counts, independent review, qualified evidence and limits.   |
| [reviewer-guide.md](reviewer-guide.md)                                                 | Source-backed product flow, synthetic fixture and safe execution procedure.         |
| [test-cases.md](test-cases.md)                                                         | Five positive/three negative expectations, all host results Not run; additional QA. |
| [demo-video-script.txt](demo-video-script.txt)                                         | Actual host/web walkthrough to rehearse and record once authorized access exists.   |
| [public-package.md](public-package.md)                                                 | Separate upload copy, archive reproduction, asset provenance and local results.     |
| [public-package-validation-2026-10-11.json](public-package-validation-2026-10-11.json) | Current offline package, archive hashes and extracted-copy verification.            |

## Package boundary

`plugins/todos` is the original private developer package. Preserve its identity,
registered-app bindings and working installation. `plugins/planwren-public` is a
separate author-supplied upload copy with root `plugin.json` and `mcp.json`, approved
Fold PNG icons, and the bounded Today Planning skill. It declares only the focused
remote `https://todos.theafoundry.com/mcp/app`, not the broader legacy `/mcp`.
The canonical issuer and UI resource identifiers remain on the existing origin.
No root `.app.json`, compatibility overlay, app binding, credential, auth header,
local command or account data belongs in the public ZIP. Portal-generated app
bindings in a future saved release are a different lifecycle stage and must be
preserved there.

## Current requirements and order

The official [submission guide](https://developers.openai.com/plugins/deploy/submission),
[MCP review requirements](https://developers.openai.com/plugins/deploy/app-review)
and [plugin guidelines](https://developers.openai.com/plugins/plugin-guidelines)
were retrieved October 11, 2026 by the parent task. The supplied Plugin Creator
submission skill and its listing, review-material and lifecycle references were
also read. The current submission guide is the source of truth if older MCP
review prose describes a different portal sequence.

Prepare the source/listing and owner facts first, then reviewer/demo material,
then rebuild and inspect the full ZIP. Only a separately authorized final portal
setup follows: select the intended verified owner, upload a draft, verify imported
metadata, connect the real focused MCP via its OAuth flow, verify its domain and
scan, and run the cases against that exact saved version. Only one MCP server can
be connected per plugin. Legal/policy attestations and submission require the
authorized owner. Publication is a separate action after review approval.

The chosen publisher name in source expresses the owner's intention; it cannot
prove portal identity verification or override the selected verified identity.
Country availability is an explicit empty allowlist, which removes restrictions.
Commerce stays absent until decided. No translation or optional screenshot is
invented. A script or historical synthetic MP4 does not fulfill the recording URL.

## Offline checks

Use the repository-supported Node 22 runtime and existing lockfile dependencies:

```sh
node scripts/validate-planwren-public-package.mjs
node --test scripts/review/planwren-public-package.test.mjs
PYTHONDONTWRITEBYTECODE=1 python3 scripts/review/test-planwren-public-package.py
python3 scripts/build-planwren-public-package.py --output .local/publication/planwren-public-0.3.0-draft.zip
python3 scripts/build-planwren-public-package.py --verify .local/publication/planwren-public-0.3.0-draft.zip
```

Repository-wide security/build/regression results belong to the current readiness
report. Do not load production database settings or run destructive `review:reset`
from these preparation instructions.

## Historical evidence

The older acceptance-report, release-evidence, public-evidence, package-validation,
live-MCP evidence, branding review and MP4 assets document earlier dated releases
and tasks. Preserve them as historical records. Their source `03356140`, old
candidate/deployment language, and earlier test counts do not describe the current
baseline or prove authenticated acceptance for this package. Use the new dated
readiness report and package evidence for current conclusions.
