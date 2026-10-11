# Privacy amendments — preparation draft

**Unpublished.** These paragraphs are reviewable preparation material, not a statement that production already enforces the selected periods. Do not update the hosted policy until the operating controls below have been verified and policy publication is authorized. Keep the existing public privacy URL in package metadata; record its coverage gap in readiness.

Proposed data-category wording, supported by source:

> Planwren processes account details you provide, including email, optional name and optional phone or social sign-in details; your tasks, projects, planning preferences, saved plans and free-text Inbox captures. Captures may include their source and capture time. Connected assistants receive the specific task, plan or capture fields needed for your request, including task identifiers, titles, status, dates, priority, time estimates, energy, project names and the account timezone. The focused ChatGPT integration does not return account credentials, task notes or internal diagnostic records. Broader legacy MCP connections have a different tool surface and permission scope.

Proposed retention wording, pending operational evidence:

> We keep account and planning content while you use Planwren or until you delete it or request deletion. After verifying an account-deletion request, we remove associated content from primary storage within 30 days. Security and operational logs are retained for 30 days, subject to documented legal or security holds. Backups containing deleted content expire within 35 days of primary deletion; deletion requests are reapplied before restored data returns to service. Activity events are retained for 90 days, computed planning insights for 365 days and agent metric events for 180 days. Authorized retention cleanup runs periodically, so its maximum run interval must be included in final wording.

Before publishing, verify: support handling can meet the 30-day deletion target; all stored content and related sessions/receipts are covered by deletion; log and monitoring-provider retention is 30 days; every backup is rotated within 35 days; restorations reapply deletion; and scheduled cleanup enforces the existing 90/365/180-day source limits. No production data, provider configuration or cleanup schedule was inspected or modified in this task.

Confirm enabled providers and recipient categories before replacing the policy's current conditional infrastructure/communications wording. Source contains optional Sentry monitoring and optional phone/social/email sign-in integrations, which does not establish that every provider is enabled in production. Resolve the selected legal publisher against the public Thea Foundry brand and secure support arrangements. A source expiration constant does not establish physical deletion timing.

See [owner-decisions-2026-10-11.md](owner-decisions-2026-10-11.md). Retention targets were selected after the user delegated this decision; publication and claims of current enforcement remain separate gates.
