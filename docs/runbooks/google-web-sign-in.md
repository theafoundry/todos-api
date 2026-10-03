# Google web sign-in origins

Ordinary Google web and CLI sign-in use an explicit callback on the host that
owns their OAuth state cookie. Production permits only these HTTPS callbacks:

- `https://todos.theafoundry.com/auth/google/callback`
- `https://www.planwren.com/auth/google/callback`

The request must be HTTPS through the existing trusted proxy and its raw Host
authority must match one permitted host (case-insensitive, optional standard 443
port). Forwarded hosts and caller-provided callback parameters cannot select an
origin. Start and code exchange use the identical selected callback. Unsupported
hosts, invalid state and malformed codes fail before provider/user operations.

State remains random, HttpOnly, Secure in production, SameSite=Lax, host-only and
scoped to `/auth/google` for ten minutes. No shared cookie domain, state bypass or
cross-host token handoff is added. Successful web responses retain relative
`/auth` destinations. Post-auth destinations must be on the initiating origin and
under the existing app/feedback path allowlist. Starting a web flow clears an
abandoned CLI loopback cookie; legitimate CLI completion retains 127.0.0.1 and its
validated port after the same provider/state checks.

Production web/CLI no longer use an old configured `GOOGLE_REDIRECT_URI` as their
callback. Nonproduction retains its explicitly configured callback only when the
request host and protocol match it. No runtime variable change is required for
this repair. Keep `BASE_URL`, issuer, client IDs/secrets, scopes, JWT/signing keys
and existing environment/proxy settings unchanged.

The separate MCP Google linking flow continues to use the canonical
`${BASE_URL}/oauth/authorize/google/callback` override. This repair does not change
its routes, scopes, cookie/state handling, token audience or metadata.

## External settings review before release

The read-only audit matched the deployed Google client to project
`todos-491102`, number 72992757519. Existing Google CLI authentication can read
that project, although its active configured project is different. The installed
IAP and Workforce Identity OAuth commands do not manage this general web client.
Use the existing authenticated
[Google Auth Platform Clients console](https://console.cloud.google.com/auth/clients?project=todos-491102)
to inspect the actual deployed web client. No new CLI login, scope, credential or
IAM grant is presumed necessary; console permissions must be observed.

Before proposing an exact provider diff, read that client's complete current
authorized redirect URI list. Ensure the two callbacks above exist, adding only
missing entries and preserving every existing entry, especially the canonical
MCP callback. Retain the same client/secret, consent-screen settings, scopes,
publishing status and unrelated origins. This server OAuth flow does not require
inventing a JavaScript-origin change. Obtain narrow approval for the concrete
before/after settings before applying it.

The callback list was not accessible through the audited CLI, so this source
repair alone does not establish that Google will accept either callback. Do not
release or announce the new entry point as authenticated acceptance without
verifying the provider list and the exact tested application revision.

## Verification

`npm run test:unit` includes isolated route and Google service tests. They cover
both production origins, host/protocol attacks, state/code failures, safe local
destinations, CLI completion, callback override consistency and Google ID-token
issuer/audience checks using mocked provider/user services. No actual login,
network exchange or user-data mutation is required by these tests.

After separately approved provider settings and the controlled exact-SHA release,
perform authenticated acceptance with an isolated test account on both canonical
and www origins, checking actual Google return URL, state/session establishment,
refresh/logout and safe destinations. Recheck canonical MCP/OIDC metadata and
existing assistant connections. Keep DNS/public launch held until required
new-domain TLS and enabled sign-in acceptance pass.
