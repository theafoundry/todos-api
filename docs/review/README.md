# Todos hosted review package

This directory versions the operational evidence for Phase 4B. The production
code remains authoritative; screenshots and reports here show which exact commit
was exercised before merge.

## Deterministic commands

```bash
npm ci
npm --prefix client-react ci
npm run review:metadata
npm run review:reset
REVIEW_BASE_URL=https://todos.theafoundry.com \
  DOMAIN_VERIFICATION_TOKEN='<portal token>' \
  npm run review:acceptance
npm run review:accessibility
npm run review:security
```

`review:reset` is destructive only for one explicitly identified, existing
review account. It requires `REVIEW_ACCOUNT_USER_ID`, the matching
`REVIEW_ACCOUNT_EMAIL`, and
`REVIEW_RESET_CONFIRM=RESET_DEDICATED_REVIEW_ACCOUNT`.

Never commit passwords, OAuth codes, access tokens, refresh tokens, challenge
tokens, or screenshots that expose them.

## Evidence inventory

- `acceptance-report.md` records deployment, portal scan, Inspector, and ChatGPT
  evidence against an exact commit SHA.
- `reviewer-guide.md` contains reviewer-facing setup and deterministic cases.
- `demo-account-runbook.md` describes safe fixture restoration and credential
  handoff.
- `security-review.md` covers OAuth and MCP security paths plus dependency audit.
- `accessibility-review.md` covers the Today Plan component and public pages.
- `portal-scan-comparison.md` compares the portal scan with the committed MCP
  metadata contract.
- `submission-copy.md` is the versioned source for portal text.

All evidence starts as pending. Do not change a result to passed until its
artifact, commit SHA, date, and operator are recorded.
