# Remote MCP Auth

This doc covers the current public account-linking, authentication, and scope model for the remote MCP server.

## Current Linking Model

The remote MCP surface now exposes a browser-based OAuth-style PKCE flow over standard public endpoints. It reuses the app's existing user auth and JWT primitives instead of introducing a second identity system.

Public flow:

1. The connector discovers metadata from:
   - `GET /.well-known/oauth-protected-resource`
   - `GET /.well-known/oauth-authorization-server`
   - `GET /.well-known/openid-configuration` when verified identity claims
     are needed
2. The connector registers a public PKCE client at `POST /oauth/register`.
3. The user is sent to `GET /oauth/authorize`.
4. The user signs in with their existing Todos account and approves scopes.
5. The connector exchanges the authorization code at `POST /oauth/token`.
6. The connector calls `GET /mcp` or `POST /mcp` with `Authorization: Bearer <mcp-token>`.

Local development still supports the older direct mint shortcut at `POST /auth/mcp/token`, but that is not the production connector path.

## Public Auth Endpoints

### `GET /.well-known/oauth-protected-resource`

Protected-resource metadata for MCP clients.

Returns:

- `resource`
- `authorization_servers`
- `bearer_methods_supported`
- `scopes_supported`

### `GET /.well-known/oauth-authorization-server`

Authorization server metadata for remote connectors.

Returns:

- `issuer`
- `authorization_endpoint`
- `token_endpoint`
- `revocation_endpoint`
- `registration_endpoint`
- `response_types_supported`
- `grant_types_supported`
- `token_endpoint_auth_methods_supported`
- `code_challenge_methods_supported`
- `scopes_supported`

The authorization server advertises both Todos application scopes and the
standard `openid` and `email` identity scopes. The protected-resource metadata
continues to advertise only the permissions accepted by its MCP resource.

### `GET /.well-known/openid-configuration`

OpenID Connect discovery for ChatGPT workspace-domain restrictions. It
advertises the same authorization, token, revocation, registration, and PKCE
capabilities as the OAuth metadata plus:

- `userinfo_endpoint`
- `openid` and `email` in `scopes_supported`
- `sub`, `email`, and `email_verified` in `claims_supported`

This contract intentionally does not advertise ID-token or JWKS capabilities;
the authorization-code response remains an OAuth access-token response and
verified identity is exposed through UserInfo.

### `GET|POST /oauth/userinfo`

Returns the linked account's verified identity for an audience-bound
`/mcp/app` access token carrying both `openid` and `email`:

```json
{
  "sub": "<stable-user-subject>",
  "email": "person@example.com",
  "email_verified": true
}
```

The endpoint revalidates token signature, issuer, audience, expiry, revocation,
assistant-session state, current user existence, current email, and current
verification state. It returns `401 invalid_token` for invalid identity and
`403 insufficient_scope` when either identity scope is absent. Responses are
never cached.

### `POST /oauth/register`

Dynamic client registration for public PKCE clients.

Input:

- `redirect_uris`
- `client_name` (optional)
- `grant_types` (`authorization_code`, or `authorization_code` plus `refresh_token`)
- `response_types` (`code` only)
- `token_endpoint_auth_method` (`none` only)

Response:

- `client_id`
- `client_id_issued_at`
- `redirect_uris`
- `grant_types`
- `response_types`
- `token_endpoint_auth_method`
- `client_name` (if provided)

### `GET /oauth/authorize`

Browser-based sign-in and consent page.

Query parameters:

- `client_id`
- `redirect_uri`
- `response_type=code`
- `scope` (optional; defaults to `tasks.read projects.read`)
- `state` (optional)
- `code_challenge`
- `code_challenge_method=S256`

Behavior:

- if the temporary link session cookie is missing, the server renders a login page
- once the user signs in, the server renders a consent page
- approval redirects back to the connector callback with `code` and `state`

### `POST /oauth/token`

Exchanges an authorization code for an MCP bearer token.

Form input:

- `grant_type=authorization_code`
- `code`
- `client_id`
- `redirect_uri`
- `code_verifier`

Response:

- `access_token`
- `token_type`
- `expires_in`
- `expires_at`
- `scope`
- `session_id`

### `POST /oauth/revoke`

Revokes an issued MCP token.

Form input:

- `token`
- `client_id` (optional)
- `token_type_hint` (`refresh_token` or `access_token`, optional)

Behavior:

- revoking a refresh token invalidates the linked assistant session when present
- revoking an access token invalidates the backing assistant session for newer session-backed tokens
- older legacy tokens without a session binding fall back to revoke-all for that user

### `POST /auth/mcp/token`

Local development shortcut only.

This bypasses the public authorization-code flow and mints an MCP token directly from a signed-in app user session. Keep it for local verification, not provider-facing account linking.

### `GET /auth/mcp/sessions`

Lists active MCP assistant sessions for the signed-in app user.

### `POST /auth/mcp/sessions/revoke`

Revokes MCP assistant access for the signed-in app user.

JSON input:

- `{ "sessionId": "<uuid>" }` to revoke one session
- `{ "revokeAll": true }` to revoke all MCP sessions without rotating unrelated app auth

## MCP Request Authentication

Every remote MCP request must include:

- `Authorization: Bearer <mcp-access-token>`

The server then:

1. verifies token signature and expiry
2. validates token type is `mcp`
3. rejects tokens bound to revoked MCP assistant sessions
4. rejects tokens issued before a user-level MCP revoke-all timestamp
5. resolves the token to a concrete app user via `getUserById`
6. enforces scopes before tool execution
7. denies the request if the linked user is no longer valid

No MCP tool trusts a client-provided user ID.

### Application and connector token boundaries

Application REST routes, `/agent` actions, account management and account-linking
sessions require an application access token. Login, refresh, social/phone login
and runner enrollment issue these tokens. Existing enrollment tokens with a
nullable email remain supported. MCP credentials never establish an application
session, even when they have write scopes.

The local `/auth/mcp/token` and `/auth/mcp/oauth/*` shortcuts support only the
legacy resource-less mode. A supplied `resource` field is rejected; use the
public `/oauth/authorize` and `/oauth/token` endpoints for resource-bound grants.

Legacy resource-less MCP tokens remain supported on `/mcp`. Resource-bound OAuth
tokens are accepted only by their intended transport: `/mcp` tokens on `/mcp`,
and `/mcp/app` tokens on `/mcp/app`. Bound tokens require their exact issuer,
audience, subject, resource and owned live assistant session. Partial bindings
are rejected rather than treated as legacy tokens. Both modes retain scope,
expiry and revocation checks.

UserInfo continues to accept `/mcp/app` credentials with the required identity
scopes. OAuth token exchange and revocation retain their protocol-specific
credential handling; an MCP bearer cannot authorize application token minting
or assistant-session management.

## Supported Scopes

Todos application-authorization scopes:

- `tasks.read`
- `tasks.write`
- `projects.read`
- `projects.write`

Identity scopes:

- `openid`
- `email` (requires `openid`)

Identity scopes are persisted through authorization-code exchange and refresh
rotation, but they grant no task or project permission. Tool authorization
extracts and checks only the four Todos application scopes above. An
identity-only token therefore cannot call any MCP tool.

The older `read` / `write` aliases are still accepted by validation and expanded to explicit scopes, but new connector setup should use the explicit names above.

## Tool to Scope Mapping

| Tool                                | Read only | Required scopes                                                                                 |
| ----------------------------------- | --------- | ----------------------------------------------------------------------------------------------- |
| `list_tasks`                        | Yes       | `tasks.read`                                                                                    |
| `search_tasks`                      | Yes       | `tasks.read`                                                                                    |
| `get_task`                          | Yes       | `tasks.read`                                                                                    |
| `list_today`                        | Yes       | `tasks.read`                                                                                    |
| `list_next_actions`                 | Yes       | `tasks.read`                                                                                    |
| `list_waiting_on`                   | Yes       | `tasks.read`                                                                                    |
| `list_upcoming`                     | Yes       | `tasks.read`                                                                                    |
| `list_stale_tasks`                  | Yes       | `tasks.read`                                                                                    |
| `create_task`                       | No        | `tasks.write`                                                                                   |
| `update_task`                       | No        | `tasks.write`                                                                                   |
| `complete_task`                     | No        | `tasks.write`                                                                                   |
| `archive_task`                      | No        | `tasks.write`                                                                                   |
| `delete_task`                       | No        | `tasks.write`                                                                                   |
| `add_subtask`                       | No        | `tasks.write`                                                                                   |
| `update_subtask`                    | No        | `tasks.write`                                                                                   |
| `delete_subtask`                    | No        | `tasks.write`                                                                                   |
| `move_task_to_project`              | No        | `tasks.write`                                                                                   |
| `list_projects`                     | Yes       | `projects.read`                                                                                 |
| `get_project`                       | Yes       | `projects.read`                                                                                 |
| `review_projects`                   | Yes       | `projects.read`                                                                                 |
| `list_projects_without_next_action` | Yes       | `projects.read`, `tasks.read`                                                                   |
| `plan_project`                      | No        | `suggest`: `projects.read`, `tasks.read`; `apply`: `projects.read`, `tasks.read`, `tasks.write` |
| `ensure_next_action`                | No        | `suggest`: `projects.read`, `tasks.read`; `apply`: `projects.read`, `tasks.read`, `tasks.write` |
| `weekly_review`                     | No        | `suggest`: `projects.read`, `tasks.read`; `apply`: `projects.read`, `tasks.read`, `tasks.write` |
| `decide_next_work`                  | Yes       | `projects.read`, `tasks.read`                                                                   |
| `analyze_project_health`            | Yes       | `projects.read`, `tasks.read`                                                                   |
| `analyze_work_graph`                | Yes       | `projects.read`, `tasks.read`                                                                   |
| `create_project`                    | No        | `projects.write`                                                                                |
| `update_project`                    | No        | `projects.write`                                                                                |
| `rename_project`                    | No        | `projects.write`                                                                                |
| `delete_project`                    | No        | `projects.write`                                                                                |
| `archive_project`                   | No        | `projects.write`                                                                                |

`tools/list` only returns tools the token is allowed to use.

For the planner tools above, `tools/list` exposes the minimum scopes needed to
run the default `mode: "suggest"` behavior, plus mode-scoped requirements for
`apply`.

For `create_task`, `create_project`, and the planner tools that support
`mode: "apply"`, MCP callers can also send an optional `idempotencyKey`
argument to make safe retries replay the original success response.

The planner-runtime architecture behind these tools is documented in
`docs/planner-runtime.md`.

## Auth-Related Errors

Auth and authorization failures return stable machine-usable fields:

- `code`
- `message`
- `retryable`
- `hint` when the next step is clear

Important auth codes:

- `MCP_UNAUTHENTICATED`
- `MCP_INVALID_AUTHORIZATION`
- `MCP_INVALID_TOKEN`
- `MCP_AUTH_EXPIRED`
- `MCP_AUTH_REVOKED`
- `MCP_INVALID_SESSION`
- `MCP_INSUFFICIENT_SCOPE`
- `MCP_INVALID_CLIENT`
- `MCP_REDIRECT_URI_MISMATCH`
- `MCP_AUTH_CODE_INVALID`
- `MCP_AUTH_CODE_EXPIRED`
- `MCP_AUTH_CODE_ALREADY_USED`
- `MCP_INVALID_CODE_VERIFIER`
- `RESOURCE_NOT_FOUND_OR_FORBIDDEN`

GET `/mcp` also returns a `WWW-Authenticate` challenge that points remote clients at `/.well-known/oauth-protected-resource`.

## Audit / Traceability

The public MCP layer logs lightweight structured events for:

- OAuth client registration success/failure
- authorize page views and failures
- login success/failure during connector linking
- code approval / denial
- token exchange success/failure
- revoke success/failure
- MCP auth success/failure
- scope denials
- tool calls with request ID, tool name, user ID, and latency

This remains log-based only.

## Connector Expectations

First-pass compatibility target:

- public HTTPS base URL
- OAuth protected-resource and authorization-server metadata
- public PKCE client registration
- browser-based user sign-in and consent
- `GET /mcp` SSE transport
- `POST /mcp` Streamable HTTP JSON-RPC

Current behavior:

- the server issues refresh tokens for clients registered with `grant_types=["authorization_code","refresh_token"]`
- refresh-token exchange rotates the refresh token and returns a new access token plus a replacement refresh token
- public OAuth metadata advertises `revocation_endpoint`
- signed-in app users can list and revoke assistant sessions through `/auth/mcp/sessions`
- `POST /oauth/revoke` supports first-pass connector disconnect without touching normal app auth

## Local Development

Typical local public-flow test:

1. Start the app locally with `BASE_URL=http://localhost:3000`.
2. Register a public client with `POST /oauth/register`.
3. Visit the generated `GET /oauth/authorize` URL in a browser.
4. Sign in with a real app user and approve scopes.
5. Exchange the returned code at `POST /oauth/token`.
6. Persist the returned `refresh_token` if the client registered for refresh support.
7. Use the bearer token on `/mcp`.

For direct local shortcuts only, `POST /auth/mcp/token` still mints a scoped token from a signed-in app session.

Detailed deployment and smoke steps live in:

- `docs/ops/railway-remote-mcp-deploy.md`
- `docs/ops/connector-smoke-checklist.md`

## Current Limitations

- MCP access tokens are session-revocable, but there is still no polished in-app assistant management UI
- refresh tokens are rotated, stored durably, and survive app restarts
- older pre-session MCP tokens are only guaranteed to be invalidated by revoke-all once they are rotated onto the newer session-backed flow
- persisted audit records are lightweight operational traces, not a full analytics pipeline
- real public deployment and connector validation must be completed from a networked environment with Railway and provider access
