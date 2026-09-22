# Phase 4B acceptance report

Status: pending

## Candidate identity

- PR: pending
- Branch: `codex/chatgpt-native-phase4-review`
- Full commit SHA: pending
- Deployment URL: `https://todos.theafoundry.com`
- Deployment ID and timestamp: pending
- Deployment reports the exact candidate SHA: pending
- Lockfile hash: pending

## Hosted checks

- [ ] Exact domain challenge
- [ ] Privacy, Terms, and Support pages
- [ ] Protected-resource discovery
- [ ] OAuth authorization-server discovery
- [ ] OpenID configuration and UserInfo challenge
- [ ] PKCE code flow and cancellation paths
- [ ] Refresh rotation, expiry, revoke, replay, and relink
- [ ] Wrong audience and insufficient scope
- [ ] Six-tool surface and Today Plan resource
- [ ] `ui.domain` and exact empty CSP
- [ ] Legacy `/mcp` compatibility

## Portal checks

- [ ] Draft created without selecting Submit for Review
- [ ] Domain verified
- [ ] Scan Tools completed
- [ ] Portal scan canonically equivalent to committed metadata
- [ ] Submission text, URLs, annotations, and demo credentials verified

## Client checks

- [ ] MCP Inspector discovery and all six tools
- [ ] ChatGPT developer-mode connection
- [ ] Five positive reviewer cases
- [ ] Negative, unsupported, ambiguous, and prompt-injection cases
- [ ] Today Plan widget, mutation confirmation, auth expiry, and relink
- [ ] Keyboard, screen reader, reduced motion, contrast, responsive, 200% zoom

## Evidence

Add sanitized evidence paths with date and operator. Do not add secrets or
review credentials.

## Merge gate

Do not merge until all applicable items above pass against the exact candidate
SHA. If the candidate changes, rerun affected checks and update evidence.
