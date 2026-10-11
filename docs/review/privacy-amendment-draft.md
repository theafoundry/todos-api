# Privacy amendments — preparation draft

**Unpublished and incomplete.** This draft distinguishes source behavior from operating commitments. The hosted policy must not acquire unsupported retention promises. No production cleanup cadence, log provider retention, backup rotation, restore procedure or support deletion turnaround was inspected or changed.

## Source-supported categories and controls

Proposed wording, conditional on deploying the reviewed candidate:

> Planwren processes account details you provide, including email, optional name and optional phone or social sign-in details; tasks, projects, subtasks, saved plans, planning preferences and free-text Inbox captures. Captures may include their source and capture time. It also stores derived planning and adaptation information, activity history, automation records and feedback/support requests. Support submissions can include text, optional screenshots, page URL and browser information.
>
> Connected assistants receive the task, plan or capture fields needed for your request, including identifiers, titles, status, dates, priority, time estimates, energy, project names and account timezone. The focused ChatGPT integration does not return account credentials, task notes or internal diagnostic records. Broader legacy MCP connections have a different tool surface and permission scope. Planwren's core capture, review and planning service is free. Hosted backend model inference is disabled for this launch; the connected assistant provides its own conversation inference.
>
> You can request a data export and account deletion through support. The signed-in export includes stored account and planning content plus user-facing automation metadata. It excludes credentials, security tokens, internal diagnostics and other users' identifiers. An authorized account deletion removes owned primary database records and invalidates application and connected-assistant access. Deleting an account does not itself erase backups, monitoring records or externally promoted support issues and externally hosted screenshots; those recipients and deletion procedures must be described in the final policy.

The final sentence requires the operating recipient inventory: optional source integrations do not establish which services run in production. Do not name an enabled provider, retention period or external deletion promise without evidence. A support-page email link does not establish mailbox delivery. The hosted-AI sentence requires deployment-time verification of the disabled flag; this task only prepared and tested local defaults.

## Retention section requiring operating evidence

| Category                                              | Established source behavior                                                         | Final policy fact still needed                                                               |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Account/tasks/projects/captures/plans and preferences | Stored until content/account deletion; authorized deletion cascades primary records | Actual support request verification and maximum completion time                              |
| Activity events                                       | Owner-scoped cleanup selects records older than 90 days                             | Enabled cleanup cadence and maximum physical retention                                       |
| Computed planning insights                            | Owner-scoped cleanup selects records older than 365 days                            | Enabled cleanup cadence and maximum physical retention                                       |
| Agent metric events                                   | Owner-scoped cleanup selects records older than 180 days                            | Enabled cleanup cadence and maximum physical retention                                       |
| Security, application and monitoring logs             | Source contains logging and optional monitoring                                     | Enabled recipients, periods, exceptions and deletion handling                                |
| Database/provider backups                             | No deployment retention proof from repository                                       | Every backup period, expiry and restore/deletion procedure                                   |
| Authorization/session/job records                     | Token validity is bounded; account deletion removes owned persisted records         | Physical cleanup cadence for expired records and any separately retained operational records |
| External support artifacts                            | Source may promote feedback to GitHub and use external screenshot URLs              | Which workflows run, recipients, retention and deletion process                              |

The user delegated selection of proposed operating targets (30 days for verified primary deletion and logs; backups within 35 days after primary deletion). These remain planning targets in [owner decisions](owner-decisions-2026-10-11.md), **not established production periods** and are deliberately absent from publishable policy prose. Existing 90/365/180-day source thresholds are unchanged. Document and verify real controls before substituting precise policy commitments.

See [privacy operations runbook](privacy-operations-runbook.md) for local proof and remaining operating facts. Publishing the policy, provisioning reviewer access and changing live provider/backup settings require separate authorization.
