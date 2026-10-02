# Planwren branding and domain launch

Status: source changes prepared for review; live cutover requires separate approval.
Inventory date: 2026-10-02. This runbook contains no credentials.

## Scope and source

Planwren is the standalone web app formerly named Todos. This change updates
landing/auth/app page titles and visible name, installable PWA display names,
favicon accessibility text, support/policy copy and account email display copy.
The existing artwork and interaction patterns remain in place.

Repository/package names, API paths, local storage and offline cache names,
calendar export identifiers, OAuth clients/issuer/scopes, MCP tools/resource URIs,
old domains and native iOS application identifiers are compatibility contracts.
They are not renamed by this branding change. Existing assistant connections may
continue to be listed as Todos. No domain is hardcoded into new client metadata
before the domain is live.

Visual coverage was restored in the separately merged [PR1090](https://github.com/theafoundry/todos-api/pull/1090).
Its source and test infrastructure are retained. Branding intentionally changes
wordmark pixels in auth, landing and app screenshots. Both landing illustrations
and all eight platform baselines were separately rendered and visually reviewed
against the branding code. Both platforms retain the same screenshot threshold.

## Read-only inventory

Porkbun's existing account API lists `planwren.com` as ACTIVE, created
`2026-10-02 20:12:06`, expiring `2027-10-02 20:12:06` (provider-returned timestamps).
Auto-renew, registrar lock and WHOIS privacy are enabled. User-confirmed payment
is already complete; no further purchase is needed or authorized here.

Public delegation currently points to:

- `curitiba.ns.porkbun.com`
- `fortaleza.ns.porkbun.com`
- `maceio.ns.porkbun.com`
- `salvador.ns.porkbun.com`

The apex currently resolves to Porkbun parking addresses `207.207.210.23`,
`207.207.210.36`, `207.207.210.50`; `www` is an alias of `uixie.porkbun.com`.
No public DS record was returned. DigitalOcean's authenticated lookup returns
404 for the `planwren.com` zone. Account inventory and public DNS are point-in-time
observations; recheck immediately before approved changes.

Porkbun's authenticated read-only DNS inventory contains 11 records. Preserve
the existing email-forwarding records when moving delegation, even if no
forwarding mailbox has been configured:

| Name | Type | Value                                  | Priority | TTL |
| ---- | ---- | -------------------------------------- | -------- | --- |
| `@`  | MX   | `fwd1.porkbun.com`                     | 10       | 600 |
| `@`  | MX   | `fwd2.porkbun.com`                     | 20       | 600 |
| `@`  | TXT  | `v=spf1 include:_spf.porkbun.com ~all` | —        | 600 |

The remaining records are the parking apex ALIAS and wildcard CNAME, four
Porkbun zone NS records, and two `_acme-challenge` TXT records. The zone NS
values (`curitiba.porkbun.com`, `fortaleza.porkbun.com`, `maceio.porkbun.com`,
`salvador.porkbun.com`) are distinct from the registry delegation above. Replace
the zone NS with DigitalOcean's default records when approved; do not carry
parking aliases or ACME challenges into the launch zone without identifying
their current purpose. These forwarding records do not verify a new Planwren
mailbox or SES sending identity.

The existing production application is a single Railway service serving the
React landing page at `/`, standalone auth at `/auth`, app at `/app/`, and API:

| Item                           | Verified value                                                    |
| ------------------------------ | ----------------------------------------------------------------- |
| Railway project                | `todos-api`, `708a7c3b-8c2a-46c8-8fc9-7af9aa406f70`               |
| Environment                    | `production`, `bc4b4e30-e129-4334-b294-94784e7ab688`              |
| API/frontend service           | `satisfied-determination`, `890ed217-cc4c-4fa7-a3c4-ae22d1aa4a6c` |
| Target port on current domains | `8080`                                                            |
| Railway service domain         | `satisfied-determination-production.up.railway.app`               |
| Current custom domains         | `todos.theafoundry.com`, `todos.karthikg.in`                      |
| Source repository connection   | None; both source repo/image fields null                          |
| Currently served release       | `393c324d650bb87df489ec21f6c0ac7e73383d66`                        |
| OAuth/OIDC issuer              | `https://todos.theafoundry.com`                                   |

Both custom domains are ACTIVE, ownership-verified and certificate-valid in
Railway; public TLS checks also succeeded. Their observed certificates expire
2026-11-07 and are Railway-managed. Both `/healthz` and the public landing/app
pages return 200. Production `/privacy` remains 404 because newer merged source
has not been deployed. Git merges alone do not update production.

The connected Vercel scope `karthikg80s-projects` was fully paginated: 29 projects,
none named Todos or Planwren. No existing standalone frontend project was found
there; existing Railway service and live pages prove the current hosting shape.
This is scoped inventory, not a claim about every possible external account.

Current DigitalOcean records to retain:

| Zone              | Name                    | Type  | Value                               | TTL   |
| ----------------- | ----------------------- | ----- | ----------------------------------- | ----- |
| `theafoundry.com` | `todos`                 | CNAME | `yvip7ps2.up.railway.app`           | 300   |
| `theafoundry.com` | `_railway-verify.todos` | TXT   | Existing Railway verification value | 300   |
| `karthikg.in`     | `todos`                 | CNAME | `zkk94lhs.up.railway.app`           | 43200 |
| `karthikg.in`     | `_railway-verify.todos` | TXT   | Existing Railway verification value | 3600  |

Retain their existing nameservers, TLS bindings and all mail/SES records.

## Proposed staged topology

Keep DigitalOcean as authoritative DNS. Keep the entire frontend/API on the
existing Railway service so browser API requests remain on the app's origin.
Use `https://www.planwren.com` as the new web entry point. Keep all old URLs,
OAuth discovery/issuer and MCP endpoints serving in place.

The apex is a separate decision: Railway requires apex CNAME flattening or a
suitable dynamic ALIAS, while DigitalOcean's supported record set offers ordinary
A/AAAA/CNAME records. Do not create an ordinary apex CNAME, pin a transient
Railway edge IP, or mistake DNS aliases for HTTP redirects. See
[Railway apex requirements](https://docs.railway.com/networking/domains/working-with-domains#adding-a-root-domain)
and [DigitalOcean record types](https://docs.digitalocean.com/products/networking/dns/how-to/manage-records/).

Recommended apex option: a small, separately approved Vercel redirect project
named `planwren-entry`, bound only to `planwren.com`, sending public GET/HEAD
landing and app URLs to `https://www.planwren.com` with a temporary 302 and
preserved path/query during staged acceptance. It needs no API credentials or
backend migration and retains the proposed DigitalOcean DNS provider. It is not an API/MCP proxy and should
not redirect OAuth callback, verification-token or token-bearing URLs across
origins; keep those on the canonical existing service. Define and test explicit
route exclusions before provisioning. If the apex must serve the full app
instead, choose and approve a different ingress design before changing DNS.

## Exact bindings and DNS proposal

Bindings proposed for approval:

1. Add `www.planwren.com` to Railway project/environment/service IDs above,
   target port `8080`, retaining both existing custom domains and the disconnected
   source-repo invariant. Obtain the new CNAME target, ownership TXT name/value
   and certificate status from that binding. Do not reuse an old domain's unique
   CNAME/verification token without Railway confirming it.
2. Provision the optional `planwren-entry` redirect project in the existing
   Vercel scope and bind `planwren.com`; retain DigitalOcean nameservers. Inspect
   the domain's recommended A/verification values and certificate requirements.
   This project and binding do not exist yet.
3. Create DigitalOcean zone `planwren.com` and preload the approved records.
   Preload the three existing forwarding MX/SPF records listed above and retain
   any additional required non-parking records discovered in a fresh registrar
   inventory. Move delegation only after authoritative-zone validation.

| Location / name                       | Type  | Proposed value                                                         | TTL                 | Readiness                             |
| ------------------------------------- | ----- | ---------------------------------------------------------------------- | ------------------- | ------------------------------------- |
| Porkbun registry delegation           | NS    | `ns1.digitalocean.com`, `ns2.digitalocean.com`, `ns3.digitalocean.com` | Registry-controlled | Exact, requires approval              |
| DO `@`                                | NS    | Same three DigitalOcean nameservers                                    | Zone default        | Created automatically with zone       |
| DO `www`                              | CNAME | New Railway binding's exact provider-issued target                     | 300                 | Generated only after approved binding |
| DO Railway verification host          | TXT   | Exact name/value returned for `www.planwren.com`                       | 300                 | Generated only after approved binding |
| DO `@`                                | A     | Optional redirect project's exact Vercel domain-card recommendation    | 300                 | Pending approved project/binding      |
| DO Vercel ownership host, if required | TXT   | Exact provider-issued verification name/value                          | 300                 | Conditional; do not invent            |
| DO `@`                                | MX    | `fwd1.porkbun.com`, priority 10                                        | 600                 | Preserve existing forwarding          |
| DO `@`                                | MX    | `fwd2.porkbun.com`, priority 20                                        | 600                 | Preserve existing forwarding          |
| DO `@`                                | TXT   | `v=spf1 include:_spf.porkbun.com ~all`                                 | 600                 | Preserve existing forwarding SPF      |

No additional `api`, wildcard, mail-sender SPF/DKIM or AAAA record is required by
this web topology. Preserve the existing forwarding MX/SPF above.
Do not copy another project's A address or publish guessed provider tokens.
New binding-specific CNAME/TXT/A values cannot be verified read-only before
those bindings exist. Approval is therefore staged: approve provisioning first,
then review the concrete returned record diff before DNS/delegation cutover.
[Vercel domain guidance](https://vercel.com/docs/domains/working-with-domains/add-a-domain)
requires values shown for the actual project/domain.

DigitalOcean delegation uses the
[documented three nameservers](https://docs.digitalocean.com/products/networking/dns/getting-started/dns-registrars/).
Keep existing registrar lock/privacy/auto-renew settings. A nameserver switch
is the first global routing change and requires the explicit cutover approval.

## Authentication and compatibility acceptance

- Keep `BASE_URL`, OAuth issuer, client registration, token audience/resource,
  scopes, existing callback URLs, signing keys, MCP UI domain and directory
  metadata on the existing domains. A future auth-domain migration is a separate
  reviewed project, not part of this launch.
- `apiCall` uses `window.location.origin`; Railway must serve app and API at
  `www.planwren.com`, not just a static Vercel app without API routing.
- Read-only inventory deliberately did not export production environment values.
  Before activation, inspect only the current origin allowlist and required
  non-secret auth origins through authorized tooling; propose adding the new
  web origin while retaining old origins only if necessary. Any environment
  mutation needs explicit approval and must obey `--skip-deploys`/controlled
  release rules. Do not change `BASE_URL` to make browser login look branded:
  it is also the live OAuth issuer and email-link authority.
- Local storage, refresh tokens, IndexedDB/service workers and installed PWAs
  are origin-bound. Users opening the new domain must sign in there; keep their
  old-domain sessions/PWAs working. Do not move tokens through URLs or attempt
  to copy storage between domains.
- Google/Apple browser sign-in must succeed from the new origin if its buttons
  are enabled. Check the actual provider-authorized
  [Google JavaScript origins](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid)
  and [Apple website/return URLs](https://developer.apple.com/help/account/capabilities/configure-sign-in-with-apple-for-the-web/);
  a missing allowed origin can reject sign-in entirely.
  Approve only the necessary additional origins/callbacks while retaining old
  ones, credentials and scopes. Block launch if enabled sign-in is broken;
  documenting a failed button is not acceptance. Email links may still return
  to the old canonical origin; verify and explain that session boundary.
- Keep `hello@theafoundry.com` support and the existing configured SES sender;
  source branding changes only display copy/fallback display names. Do not
  invent a Planwren mailbox or sending-domain records.

After separately authorized hosting setup and a controlled exact-SHA release,
use isolated test data/accounts to check DNS, ownership, TLS/SNI, `/`, `/auth`,
`/app/`, manifest/icon, policies and `/healthz`; password login/refresh/logout;
actual Google/Apple return origins if enabled; old-domain login/email links;
MCP/OIDC discovery and fail-closed unauthenticated challenges. Keep real ChatGPT
connection/fullscreen acceptance and directory submission as separate approved
steps. No actual user task mutations are part of acceptance.

MCP/OIDC metadata on the new web hostname must continue to advertise the
existing canonical issuer/resource. Test that clients are directed to
`https://todos.theafoundry.com/mcp/app`, that unauthenticated requests remain
challenged, and that an incorrect resource/audience is rejected. The new
hostname is not a replacement assistant connection endpoint.

Before delegation, query the preloaded DigitalOcean zone directly at its
authoritative servers and review every record. Under this sequence, Railway
ownership verification and certificate issuance depend on public DNS after
delegation; provider bindings may remain pending until then. TLS/SNI and real
new-domain sign-in are post-delegation gates. Keep the new entry point
unannounced until they pass; the domain currently serves only parking.

## Rollback

Before cutover, save only non-secret registrar nameservers, public DNS records,
binding IDs, routing configuration and the current release SHA. Retain the
existing domains and all mail records throughout.

If zone or provisional-binding checks fail before delegation, leave Porkbun
delegation unchanged and remove only newly approved bindings when authorized.
After delegation, first correct faulty records in the DigitalOcean zone using
the approved record diff. To return entirely to parking, restore the previous
Porkbun registry nameservers and preserved registrar records from the public
snapshot. Record correction and delegation reversal are separate operations;
delegation caches can outlive the short record TTLs. Check actual parent NS
TTLs before cutover and allow for delayed convergence. Disable only the new
apex redirect if it is the fault. Existing Todos URLs are the immediate user
fallback throughout.

If application code must roll back, use the existing manually approved
[production release runbook](production-deploy.md) with a schema-compatible
known release. Do not delete the registered domain, change old-domain DNS,
rollback database migrations or reset credentials as a branding rollback.

## Required approvals before execution

- Review/merge this branding PR, which retains PR1090's restored visual gates;
  no merge is performed by this task.
- Approve the canonical `www` topology and optional apex redirect hosting.
- Approve the exact new Railway binding and optional Vercel project/binding;
  capture provider-issued DNS values without a deployment or DNS write.
- Approve the concrete DigitalOcean zone/record diff and registrar nameserver
  replacement, including any current DNSSEC/DS implications from a fresh check.
- Approve only necessary, explicit non-secret origin configuration updates and
  the exact-SHA production release through the established workflow/environment.
- Approve isolated authenticated/new-domain and real-host acceptance separately
  if access/setup or mutations are needed.

Nothing in this source PR performs DNS, registrar, domain-binding, security,
production variable, deployment, purchase or directory-submission operations.
