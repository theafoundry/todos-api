# Demo account runbook

## Safety contract

The reset command may operate only on a dedicated synthetic review account. It
requires three independently matching values:

- `REVIEW_ACCOUNT_USER_ID`
- `REVIEW_ACCOUNT_EMAIL`
- `REVIEW_RESET_CONFIRM=RESET_DEDICATED_REVIEW_ACCOUNT`

The command refuses an unknown, mismatched, or unverified account. It deletes
and recreates tasks and projects only for that exact user; it does not delete
the account or affect other users.

## Reset

```bash
DATABASE_URL='<production database URL>' \
REVIEW_ACCOUNT_USER_ID='<exact UUID>' \
REVIEW_ACCOUNT_EMAIL='<exact account email>' \
REVIEW_RESET_CONFIRM=RESET_DEDICATED_REVIEW_ACCOUNT \
REVIEW_TIMEZONE=America/New_York \
npm run review:reset
```

The fixtures are relative to the account’s review date and contain:

- two projects;
- five open tasks;
- one overdue task;
- two tasks relevant today;
- one tomorrow task;
- one inbox task;
- stable planning preferences.

Run reset immediately before each portal or ChatGPT acceptance session. Record
only the reset timestamp and result, never the database URL or credentials.

## Credential handoff

Store the demo email and password only in the review portal’s protected
credential field. Verify the credentials from a private browsing session and
confirm the account does not require MFA, SMS, email confirmation, or network
allowlisting.
