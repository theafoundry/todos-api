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

## Local disposable reset safety contract

`npm run review:reset` is restricted to local disposable fixtures. It deletes
and recreates **all tasks and projects for the identified fixture account**.
There is no hosted or production override. Real reviewer account provisioning,
verification, credentials and hosted fixture changes require a separate owner
decision and an independently reviewed procedure; this tool cannot perform them.

Before any database client is loaded, the script requires all of the following
in its process environment:

- `NODE_ENV=test`
- `DATABASE_URL` with a literal `127.0.0.1` or `[::1]` host, explicit port and
  username, and the exact database name `planwren_review_disposable`
- `REVIEW_ACCOUNT_USER_ID` identifying an existing synthetic fixture account
- `REVIEW_ACCOUNT_EMAIL=fixture@example.invalid`
- `REVIEW_RESET_CONFIRM=RESET_DEDICATED_REVIEW_ACCOUNT`
- `REVIEW_RESET_DISPOSABLE_CONFIRM=RESET_LOCAL_DISPOSABLE_REVIEW_DATABASE`
- Optionally `REVIEW_TIMEZONE=UTC`; UTC is the fixed default and only supported
  timezone for this review baseline

The script never loads `.env`. Supply local database access privately at runtime;
do not preload dotenv or inject database modules into the process. It rejects
hosted hosts, `localhost` and other DNS/IP aliases, ordinary `todos_dev` and
`todos_test` databases, Unix sockets, URL query options/fragments, and inherited
`PG*` connection settings. No database URL or credential is supplied here.

Inside the same transaction that would reset fixtures, a read-only query must
confirm the exact disposable database name, a PostgreSQL server address of
`127.0.0.1` or `::1`, and the exact database comment
`PLANWREN_DISPOSABLE_LOCAL_REVIEW_FIXTURES_ONLY`. Only afterward does the script
check that the supplied ID and reserved email identify the same existing,
verified account and that an existing agent enrollment already reports `UTC`.
The enrollment query selects timezone only; it does not read refresh credentials,
create enrollment, activate access, or change its timezone. Missing enrollment
or another timezone fails before any deletes. Failure at any check prevents
fixture mutation. A Docker or
other private server address is rejected even when its exposed client port is
on loopback.

A separately authorized operator who has already created this disposable local
database may mark it using the following SQL through their private local
connection:

```sql
COMMENT ON DATABASE planwren_review_disposable IS
  'PLANWREN_DISPOSABLE_LOCAL_REVIEW_FIXTURES_ONLY';
```

Do not mark an existing development, shared, hosted or production database.
The marker and confirmation strings are safety checks, not authorization or
proof that account contents are synthetic. The operator must establish that
the PostgreSQL process and database are disposable and local, with no tunnel
or forwarded port, before running a reset. No database, account, marker or
password was created during package preparation.

During preparation, exercise the pure guard and CLI rejection tests with
`node --test scripts/review/reset-review-safety.test.mjs`; they block Prisma
imports and never connect to a database. Use in-memory services for acceptance
fixtures. A passed guard test does not establish a passed real reviewer reset.

For any future authorized local reset, record the source SHA, UTC timestamp,
operator and sanitized result privately. The script omits account identifiers
and database URLs from success/error logs. Verify the fixture account before and
after reset; after an uncertain failure, inspect the disposable database before
retrying.

## Versioned baseline fixture

The current script creates two projects and six tasks: five open and one
completed. All dates use UTC, matching the required existing enrollment.

| Project        | Task                              | Relative state                                                           |
| -------------- | --------------------------------- | ------------------------------------------------------------------------ |
| Review launch  | Review sample A                   | Due today at 17:00 UTC, 15 minutes, low energy                           |
| Review launch  | Review sample B                   | Scheduled today at 14:00 UTC, due tomorrow at 17:00 UTC, 15 minutes, low |
| Review launch  | Review sample C                   | Due yesterday at 17:00 UTC, 10 minutes, low energy                       |
| Personal admin | Schedule a follow-up for tomorrow | Due tomorrow at 17:00 UTC, 20 minutes, medium energy                     |
| Inbox          | Capture an unfiled idea           | Undated Inbox task, 10 minutes, low energy                               |
| Review launch  | Review completed sample           | Completed, due today at 17:00 UTC, 5 minutes, low energy                 |

It restores planning preferences (`maxDailyTasks: 5`, preferred chunk 30
minutes, weekends enabled). Each task sets both `estimateMinutes` and
`effortScore` to the listed minute value because the current planner budgets
using `effortScore`. A/B/C provide 40 minutes of open low-energy daily work for
the 45-minute P3 plan; B preserves a distinct due date for P5. The completed
due-today fixture exercises P2's include-completed daily set. This reset changes tasks, projects and planning preferences only; it does not
reset or delete Inbox captures. Before P1, separately inspect the synthetic
account Inbox without mutation and confirm that the exact dentist text is absent.
If it is present, establish an authorized fresh fixture baseline before running
P1 rather than claiming this reset cleared it.

Confirm the effective account date and `UTC` timezone from `list_today` before
planning. Fixture task IDs are generated anew, so obtain IDs and order from
current structured results rather than copying an earlier session's IDs or
assuming rank from these titles. Missing/non-UTC enrollment needs a separately
authorized local setup step; this tool refuses to provision or change it.

Additional ambiguity and prompt-injection fixtures may be added to an in-memory
fixture service or this disposable local account within authorized local QA.
Hosted reviewer QA remains a separate owner decision. Record fixture changes
and restore the local baseline afterward when requested. Do not fabricate a
passed boundary test when the necessary fixture was never created or exercised.

## Recording and cleanup

Use [demo-video-script.txt](demo-video-script.txt) for the future actual ChatGPT
recording and [screenshot-and-recording-plan.md](screenshot-and-recording-plan.md)
for captures. Hide sign-in secrets and browser password prompts. Retain useful
success/error evidence without account IDs, tokens or private content.

After authorized QA, restore the synthetic fixtures if requested, disconnect the
reviewer's app connection as agreed, and store credentials only in the approved
private location. Record cleanup results. Account/session revocation and cleanup
must stay within that synthetic account's authorized scope.
