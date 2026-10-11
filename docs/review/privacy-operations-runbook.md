# Privacy operations — reviewable runbook

Local preparation only. This runbook does not authorize a production deletion, credential grant, scheduler/provider setting or policy publication.

## Existing control paths

The signed-in `GET /users/me/export` returns an attachment and is limited to one request per account per hour. The candidate export uses explicit credential-safe account/automation projections, includes all activity rows instead of silently capping at 1,000, and supplies notes for exclusions. The focused public MCP does not expose export or account deletion.

An authenticated administrator can call `DELETE /admin/users/:id` for a verified deletion request. The route prevents deleting the administrator's own account. The candidate deletes the owner and associated Prisma records, then deletes rows for that owner from both optional raw runner tables in one transaction. Other owners' content is preserved. Application middleware and MCP validation reject the deleted owner; per-user runner claims and audit inserts check and lock a live owner before inserting records. User-facing brief caches must not persist another account's content after logout.

The legacy `run_data_retention` action uses the authenticated actor's user ID. Its existing thresholds are 90 days for activity, 365 for insights and 180 for metrics. Cleanup is restricted to that actor; a source job is not proof that it runs in production. This candidate changes neither token lifetimes nor deployed scheduling.

## Operator procedure for an authorized deletion

1. Receive and verify the account owner's request through the established support process. Record request and completion times without copying task content or credentials into the ticket.
2. Offer the owner the existing authenticated export where appropriate. Deliver only through an authenticated or otherwise verified secure channel.
3. With separately authorized production access, identify the exact account ID and invoke the administrator deletion path. Do not broaden the operation to another account or reset a database.
4. Verify owned primary rows and runner rows are absent, old app/MCP credentials are rejected and unrelated account data remains available. Synthetic local tests prove code paths, not the production operator's completion.
5. Handle each enabled external recipient under its documented deletion process. Source supports external feedback promotion and external screenshots; primary database deletion does not erase those destinations.
6. Record backup expiry and restoration handling under the verified production procedure. Do not claim backups were erased merely because primary deletion succeeded.
7. Close the verified request with actual completion time and any documented exception. Never disclose internal tokens, another user's identifiers or raw provider/diagnostic payloads.

## Evidence needed before publishing timelines

- Confirm support ownership and mailbox delivery, identity verification and the deletion completion target the operator can meet.
- Inventory enabled database, logging/monitoring, email/social/phone and external support providers. Runner delivery can log a full report, email task/action summaries to a configured recipient or send counts to a configured Slack webhook; verify which routes and recipients actually run. Record actual retained categories and contract/configuration periods.
- Confirm the backend and runner use the same primary database, or establish separately authorized cleanup for each database. Inventory historical global runner records separately; current job callers supply account IDs, but source inspection cannot attribute old deployment records.
- Verify deployed per-owner cleanup cadence, including inactive accounts, and compute maximum age from threshold plus maximum cleanup delay.
- Verify all backup rotations and restore handling. Reapply completed deletions before a restored database serves traffic.
- Establish expired credential/session/runner metadata cleanup separately from token validity.
- Reconcile chosen targets with these controls, then request policy publication and rollout authorization.

Current synthetic proof and exact results are recorded in [verification](verification-2026-10-11.md). No live user data was queried, reset, exported or deleted for this work.
