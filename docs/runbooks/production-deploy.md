# Production deploy runbook

Production deploys go through **one** mechanism: the `Production release`
GitHub Actions workflow (`.github/workflows/deploy-production.yml`), dispatched
manually. Railway's GitHub-integration auto-deploy path is not used.

## How a release works

1. Merge to `master`, then dispatch **Production release** from the Actions tab
   (workflow_dispatch only; there is no automatic trigger on merge yet).
2. The `Production` GitHub environment requires **human approval** before any
   job runs. Note: both the migrate and deploy jobs declare
   `environment: Production`, so GitHub may prompt for approval a second time
   when the deploy job becomes eligible after a successful migration. That is
   acceptable for the first rollout; it does not change what each job can
   access.
3. The **migrate** job checks out the exact `${{ github.sha }}` of the run and
   applies pending Prisma migrations as the `todos_api_migrator` role.
4. The **deploy** job runs only if migration succeeded. It checks out the same
   exact SHA, stamps it into `release-sha.txt` (uploaded with the source, never
   committed), and deploys via `railway up` (Railway CLI).
5. The workflow polls `https://todos.karthikg.in/healthz` until it reports the
   release SHA, then checks `/readyz` on both public domains, and reports the
   deployed SHA.
6. `concurrency: production-deploy` with `cancel-in-progress: false` serializes
   releases; a second dispatch waits instead of cancelling a running release.

## Secrets (names only)

GitHub `Production` environment secrets:

- `PROD_MIGRATOR_DATABASE_URL` — migrator-role database URL. Referenced only
  by the migrate job. Never in Railway variables, never in the app runtime,
  never in build artifacts, never printed to logs.
- `RAILWAY_TOKEN` — Railway project token. Referenced only by the deploy job.

Railway production service variables hold only the runtime database credential.
`npm start` runs `node dist/server.js` with **no** Prisma migration step.

## Compatibility rule

**Production migrations must remain compatible with the currently serving
application during rollout.** If migration succeeds but the app deploy fails,
the previous app version keeps serving against the migrated schema. Write
migrations using expand/contract discipline: additive first, destructive
changes only after the code no longer depends on the old shape.

## Failure semantics

- **Migration fails** → the deploy job is skipped; the existing app keeps
  serving. Fix the migration and dispatch again.
- **Retry** → `prisma migrate deploy` applies only pending migrations, so
  re-dispatching is safe and idempotent.
- **Overlapping dispatches** → serialized by the concurrency group; Prisma's
  advisory lock is a second layer of protection.
- **Migration succeeded, app deploy failed** → schema stays forward-migrated;
  previous app version keeps serving (see compatibility rule above).
- **Code rollback** → redeploying older code does NOT roll back the database.
  Only roll back code to a version compatible with the migrated schema;
  otherwise write a compensating forward migration.

## Restart behavior

A normal API restart/redeploy performs **no** migration attempt: `npm start`
does not invoke Prisma. Verify after any restart that the migration history is
unchanged and no migrate step ran (see Stage A verification notes).

## Source-connection invariant (recorded 2026-09-21)

- The Production Railway service (`satisfied-determination`, production
  environment) has **no connected source repository**. The GitHub repository
  connection was disconnected on 2026-09-21: the Stage B incident showed that a
  variable upsert could trigger a rebuild from the stale `production` branch,
  so the source relationship was removed rather than repointed. Staging and
  UAT keep their own source connections; this invariant is Production-only.
- Production code deployments occur **only** through the GitHub Actions
  `Production release` workflow using `railway up` with the pinned
  project/environment/service IDs. Merge/push alone never deploys Production.
- Production variable changes must use `--skip-deploys` (or staged dashboard
  changes) and then be activated through the controlled deployment path
  (redeploy of a known upload-based deployment). A bare production variable
  mutation that implicitly creates a deployment must not be used.
- Do not reconnect a source repository to the Production service, and do not
  reinstall the Railway GitHub App for production. If Railway ever requires a
  connected source, prefer `master` with automatic deployment disabled -- and
  treat that as a deliberate, reviewed change to this invariant.
