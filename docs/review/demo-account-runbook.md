# Planwren synthetic reviewer account runbook

Status: preparation only. No reviewer account was created, reset, authenticated,
or granted access during this package/material task. Credentials remain pending.

## Account authorization and isolation

The owner must separately authorize provisioning and hosted fixture mutations.
Use one dedicated account containing synthetic review data only, never a real
user's account. Record a non-secret account label and operator approval in the
private operational record. Supply the actual email/password only through the
review portal's protected credential field; this repository and public artifacts
must not contain them.

Verify from a clean browser context that the account is already verified and
can sign in without MFA, SMS, email confirmation during review, VPN, network
allowlisting, or a private network. Confirm the server-reported date/timezone
before planning. Account creation, verification, grants and these credential
checks remain pending.

## Reset safety contract

`npm run review:reset` deletes and recreates **all tasks and projects for the
identified account**. It requires:

- `REVIEW_ACCOUNT_USER_ID`
- `REVIEW_ACCOUNT_EMAIL`
- `REVIEW_RESET_CONFIRM=RESET_DEDICATED_REVIEW_ACCOUNT`

The implementation checks that the user exists, the email matches and the user
is verified. It does **not** independently prove that the account is synthetic
or dedicated. The operator must establish that boundary before running it.
Matching fields and the confirmation string alone are not permission to reset
a hosted account.

During local package preparation, use disposable loopback test data or in-memory
services only. Do not connect to the production database or run hosted resets.
For a separately authorized hosted review, a credentialed operator should supply
database access and account values privately at runtime and run
`npm run review:reset` from the reviewed source. No database URL or credential
is supplied in this runbook.

Record the source SHA, UTC reset timestamp, operator and sanitized result. The
script's output includes the account email; redact it from public logs. Verify
the selected account before and after reset, and do not rerun after an uncertain
failure until the outcome has been inspected.

## Versioned baseline fixture

The current script creates two projects and five open tasks:

| Project        | Task                               | Relative state                 |
| -------------- | ---------------------------------- | ------------------------------ |
| Review launch  | Review production launch checklist | Due today, 45 minutes, high    |
| Review launch  | Confirm reviewer demo flow         | Scheduled today, 30 minutes    |
| Review launch  | Close an overdue review item       | Due yesterday, 15 minutes, low |
| Personal admin | Schedule a follow-up for tomorrow  | Due tomorrow, 20 minutes       |
| Inbox          | Capture an unfiled idea            | Undated inbox task, 10 minutes |

It restores planning preferences (`maxDailyTasks: 5`, preferred chunk 30
minutes, weekends enabled) and updates timezone on existing agent enrollments.
Confirm the effective account timezone from tools; the reset's timezone argument
does not guarantee an enrollment exists. Fixture task IDs are generated anew,
so obtain IDs from current structured results rather than copying an earlier
session's IDs.

Additional ambiguity and prompt-injection fixtures may be added only to this
synthetic account after explicit review-QA authorization. Record those changes
and restore the baseline afterward. Do not fabricate a passed boundary test
when the necessary fixture was never created or exercised.

## Recording and cleanup

Use [demo-video-script.txt](demo-video-script.txt) for the future actual ChatGPT
recording and [screenshot-and-recording-plan.md](screenshot-and-recording-plan.md)
for captures. Hide sign-in secrets and browser password prompts. Retain useful
success/error evidence without account IDs, tokens or private content.

After authorized QA, restore the synthetic fixtures if requested, disconnect the
reviewer's app connection as agreed, and store credentials only in the approved
private location. Record cleanup results. Account/session revocation and cleanup
must stay within that synthetic account's authorized scope.
