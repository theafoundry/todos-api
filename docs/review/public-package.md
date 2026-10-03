# Public Planwren package

`plugins/planwren-public` is the separate **Planwren by Thea Foundry** public
package, version `0.2.0`. The developer package in `plugins/todos` and its local
marketplace registration remain unchanged.

## Format and contents

This uses the current portable Agent Plugins format, with root `plugin.json`
and `mcp.json`, automatically discovered `skills/`, and four referenced icons.
OpenAI listing and review settings live in `extensions.com.openai`. There is
one remote Streamable HTTP server at
`https://todos.theafoundry.com/mcp/app`. OAuth discovery remains server-owned;
the exact issuer is `https://todos.theafoundry.com`.

The ZIP has eight regular files at its root layout. It contains no app reference,
lifecycle hook, local server command, embedded authentication header, credential,
review-account identifier, executable, approval-policy override, or local path.
The listing supplies the public Planwren website, privacy, terms and support
URLs. Availability countries and translations are omitted pending owner choices.

The public skill preserves the six conversational tool boundaries, adds the
declared remote dependency, and obtains the account's authoritative date and
timezone with `list_today` before an initial plan when context is absent.
Capture means an inbox capture, not a promised scheduled task. The app-only
`open_today_plan` entrypoint remains part of the deployed seven-definition
server catalog; the package neither hides it nor adds a conversational tool.

## Brand provenance

The two light PNGs are copied without alteration from the Fold assets in the
deployed source `0335614086f2a4ab587464e81037348b6486c193`. Both dark SVGs are
unchanged copies of that source's square cream-on-ink app icon.

| Public file                     | Canonical source                              | SHA-256                                                            |
| ------------------------------- | --------------------------------------------- | ------------------------------------------------------------------ |
| `assets/logo.png`               | `plugins/todos/assets/logo.png`               | `33f2d3f35b2696deae48fb78bab8b9c9d7393890bbb4b897b8433c59cfe24a03` |
| `assets/composer-icon.png`      | `plugins/todos/assets/composer-icon.png`      | `963716e9178ab7e82f421bca51968fb12f876af30e77c7ca4e2ccf2325431fc3` |
| `assets/logo-dark.svg`          | `client-react/public/brand/app-icon-dark.svg` | `b70cf9a005306cd2311aa8e01bd143ab2cd198ee160321325436c227c81be000` |
| `assets/composer-icon-dark.svg` | `client-react/public/brand/app-icon-dark.svg` | `b70cf9a005306cd2311aa8e01bd143ab2cd198ee160321325436c227c81be000` |

The candidate source now uses Planwren throughout the widget, native metadata
descriptions and OAuth connection copy. Production source `03356140` still
serves the earlier Todos labels until a separately approved deployment.
Canonical protocol identifiers retain Todos for compatibility. See
[branding-and-annotations.md](branding-and-annotations.md) for the exact
source changes and the distinction from authenticated hosted acceptance.

## Reproduce and verify

Use the repository's supported Node version and installed lockfile dependencies:

```bash
node scripts/validate-planwren-public-package.mjs
node --test scripts/review/planwren-public-package.test.mjs
python3 scripts/review/test-planwren-public-package.py
python3 scripts/build-planwren-public-package.py --output /tmp/planwren-public-0.2.0.zip
python3 scripts/build-planwren-public-package.py --verify /tmp/planwren-public-0.2.0.zip
```

The validator uses the exact vendored Agent Plugins 1.0.0 JSON schemas, with
their source hashes in
`scripts/review/planwren-package-schemas/provenance.json`, plus the documented
OpenAI listing, skill, image and archive limits. Its additional restrictions
apply to this Planwren package, rather than every possible plugin. The builder
uses fixed timestamps, sorted entries and standard-library ZIP encoding. It
checks every archive member against validated source bytes, extracts into a
private temporary directory and validates the extracted package again.

The focused tests cover hostile configuration, credentials, paths, references,
SVG content, corrupted images, unsafe ZIP entries and reproducibility. Local
validation does not replace the portal's metadata, skill-safety, security and
MCP scans.

## Evidence and remaining gates

Five positive and three negative cases are packaged as **expected behavior**.
They have not been executed in a signed-in ChatGPT session for this source.
The manifest omits screenshots and `demo_recording_url` until genuine captures
and recording exist; the historical illustrated MP4 is not a final demo.

See [acceptance-report.md](acceptance-report.md) for passed local checks, the
repaired legacy evaluation and the distinction between public release
verification and authenticated acceptance. Follow
[test-cases.md](test-cases.md) and
[screenshot-and-recording-plan.md](screenshot-and-recording-plan.md) for remaining
review work. Publisher/domain verification, a dedicated synthetic account,
protected review credentials, a deployed scan of the corrected annotations,
signed-in QA, recording and owner approval remain pending.

The user approved publishing this package and its source repairs as a draft PR.
Merge, deployment, portal upload/submission, reviewer-account creation,
credential grants and directory publication remain outside this authorization.
The companion review bundle must not be uploaded as the plugin ZIP.

The authoritative workflow and field definitions are the current official
[package guide](https://developers.openai.com/plugins/build/plugins),
[submission reference](https://developers.openai.com/plugins/deploy/submission)
and [validation reference](https://developers.openai.com/plugins/deploy/submission-errors).
