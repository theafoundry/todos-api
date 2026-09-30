# Production migration closeout — 2026-09-29

## Status

The Railway-to-self-hosted-Postgres migration and the Phase 6 credential
rotation are complete. Production is healthy on the migrated database, the
runtime and migrator identities are separated, the legacy database identity is
disabled, and the superseded Todos SES access key has been deleted.

This record contains identifiers and verification results only. It contains no
credential values or hashes.

## Final production shape

- Railway runs one API service and seven scheduled services.
- All eight services connect to the `todos_api` schema on the self-hosted
  Supabase Postgres instance through the `todos_api_runtime` role.
- GitHub Actions holds the separate `todos_api_migrator` connection in the
  `Production` environment as `PROD_MIGRATOR_DATABASE_URL`.
- The production Railway service has no connected source repository. Releases
  use the manually dispatched `Production release` workflow and its pinned
  `railway up` target.
- The application start command performs no migration. The workflow applies
  migrations before a deployment becomes eligible.

## Acceptance evidence

| Gate                  | Result | Evidence                                                                                                                                                                                            |
| --------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Migration ledger      | Passed | 45 repository migrations, 45 completed database records, 0 unfinished records.                                                                                                                      |
| Migrator credential   | Passed | GitHub `Production` secret updated; run [35608775141](https://github.com/theafoundry/todos-api/actions/runs/35608775141) authenticated and completed the migrate job as a clean no-op.              |
| Migrate-only boundary | Passed | The same run was stopped before deployment; the deploy job executed 0 steps.                                                                                                                        |
| Runtime credential    | Passed | All eight Railway services identify as `todos_api_runtime`; their stored password hashes matched, and their latest deployments were successful.                                                     |
| API health            | Passed | `https://todos.karthikg.in` and `https://todos.theafoundry.com` returned HTTP 200 for `/healthz` and `/readyz`. The API reported release `393c324d650bb87df489ec21f6c0ac7e73383d66`.                |
| Legacy database role  | Passed | `todos_api` is `NOLOGIN`, has 0 active sessions, and owns 0 database objects.                                                                                                                       |
| SES replacement       | Passed | `todos-api-ses-smtp-20260921` remained active after the superseded key was disabled. A real message was accepted through the current `us-east-1` SMTP configuration while the old key was inactive. |
| SES retirement        | Passed | The only key on `ses-smtp-user.20260312-001229` was deleted after the live send; the user now has 0 access keys.                                                                                    |
| Staging cleanup       | Passed | `/root/.phase5` is empty and the obsolete legacy-role rollback password was securely removed.                                                                                                       |

The health and delivery checks are point-in-time acceptance checks. SMTP
acceptance proves that the replacement credential can send; recipient inbox
placement remains subject to the receiving provider.

## Credential and recovery disposition

- Current database role recovery material is retained at
  `/root/backups/todos-api/credentials/role-passwords-20260921` on
  `supabase-server`, owned by `root:root` with mode `0600`.
- `/root/backups/todos-api/credentials/README` documents the recovery purpose
  without containing credential values and is also `root:root` mode `0600`.
- Temporary rotation and rollback files under `/root/.phase5` have been
  removed after their corresponding acceptance checks passed.
- The empty IAM user `ses-smtp-user.20260312-001229` is retained as an audit
  marker. Deleting that keyless user later is optional.

## Repository assurance repairs

The closeout change also repairs the checks that had stopped providing useful
signal:

- Root Node workflows provide a non-secret local placeholder URL so Prisma can
  load `prisma.config.ts` during its install-time client generation and
  TypeScript build. Integration tests continue to override it with their live
  Postgres service URL.
- The Harness Regression workflow uses the supported Node 22 line and grants
  its failure notifier the issue permission and token it requires. Its planner
  review fixture now derives relative dates at run time so the scheduled
  upcoming-task assertion remains stable.
- Gitleaks ignores only nine reviewed historical fingerprints. Each finding is
  a synthetic test fixture; future findings in the same files remain enabled.
- The stray conflict marker that made the main CI workflow invalid is removed.

## Remaining actions

No required production migration or credential-rotation action remains. Keep
the root-only recovery archive until the normal retention policy permits its
removal. The keyless historical IAM user may be deleted as optional account
hygiene.
