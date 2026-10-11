# Hosted AI admission and operations

This follow-up extends the existing limits. Public launch remains provider OFF.
It does not enable paid AI, approve a spending amount, set live configuration,
or change the original public upload/private integration bindings.

## Three different counters

- Saved suggestions: existing per-account UTC-day limits (free 50, pro 250,
  team 1000 unless configured). Accepted, rejected and deterministic suggestions
  still count. Generation reserves a slot atomically; saving consumes that slot
  in the same transaction. A normal failed save releases it. `/ai/usage` still
  reports saved records, not provider spending or pending slots.
- Provider admissions: every admitted HTTP attempt increments a separate durable
  per-account UTC-day counter. Text briefs, planner JSON, feedback triage and
  legacy morning/project health all pass through `callAiProvider`. A denied
  request, replay or deterministic fallback makes no provider HTTP request.
  An admitted call canceled before dispatch can consume a request count while
  settling zero cost. Counts never imply a completed or billed provider call.
- Spending: integer microUSD reserved before HTTP, then settled against reported
  token usage. Provider usage is conditional evidence, not a provider invoice.
  Complete responses without usage are charged at the full reservation.

The owner approved separate paid-call quotas using the same existing tier limits.
Provider defaults therefore copy the effective saved-suggestion tier amounts
(50 / 250 / 1,000 by default) into an independent counter. All three explicit
provider overrides must be valid if any is supplied. Saved suggestion policy
is preserved; budget and verified pricing remain required before paid calls.

## Admission boundary and coverage

Authentication establishes a server-owned account context after credential
validation. App, admin, agent, legacy MCP and focused native MCP requests carry
that context; queued work captures its original account and dependency. Client
headers, bodies, tiers and retry IDs do not select the billing account. Admin
triage is attributed to the authenticated operator. Current database plan and
opt-out are checked at admission, including legacy paths.

All application instances sharing the database serialize admission and settlement
with a PostgreSQL transaction advisory lock. The database UTC clock picks the
bucket; settlement always updates its original bucket, even after midnight.
The lock covers account limits, global reserved-plus-spent budget, global active
requests and per-account active requests. HTTP occurs outside the transaction.
Missing configuration, account, database or authenticated context fails closed.
Duplicate reservation keys do not redispatch. Each actual attempt gets a fresh
server key; repeated HTTP requests consume fresh admission, and provider calls
have no automatic retry. Existing process-local HTTP rate limits remain separate.

Home Focus and Priorities share one generation per user per cache. Cold reads,
stale refreshes and explicit refresh requests join it. Their four-hour successful
TTL remains. Stale reads serve the last successful brief when refresh admission
fails. Explicit refresh waits for success or central 429/503 denial; it no longer
acknowledges work before admission. One disconnected waiter cannot cancel work
shared by another. Backoff is used only when central admission supplies `retryAt`.

## Configuration before any future enablement

`.env.example` keeps `AI_PROVIDER_ENABLED=false` and leaves all financial settings
empty. No approved monetary values or provider rates are supplied by this change.

| Setting                                         | Required decision or verification                                                                                              |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `AI_PROVIDER_DAILY_BUDGET_USD`                  | Owner-approved global daily ceiling; positive USD decimal with at most six fractional digits                                   |
| `AI_PROVIDER_DAILY_REQUEST_LIMIT_FREE/PRO/TEAM` | Blank inherits approved existing tiers as a separate counter; if any override is set, all three must be positive safe integers |
| `AI_PROVIDER_BILLING_MODEL`                     | Verified exact model, matching `AI_PROVIDER_MODEL`                                                                             |
| `AI_PROVIDER_BILLING_BASE_URL`                  | Verified exact provider endpoint, matching `AI_PROVIDER_BASE_URL`                                                              |
| `AI_PROVIDER_INPUT_USD_PER_MILLION_TOKENS`      | Verified worst applicable input price, positive USD decimal                                                                    |
| `AI_PROVIDER_OUTPUT_USD_PER_MILLION_TOKENS`     | Verified worst applicable output price, positive USD decimal                                                                   |
| `AI_PROVIDER_INPUT_TOKEN_CEILING`               | Verified actual model context/input ceiling, including protocol overhead; never a character estimate or desired smaller budget |

Technical defaults bound each call to 32,768 request bytes, 1,500 output tokens,
131,072 response bytes and a 15-second network deadline after admission, with four global active requests
and one per account. The request cannot increase the output cap. Verify provider
support for `max_tokens`, response usage and all billing token categories before
choosing a model. Streaming, tool loops and automatic retries are not used.

Maximum cost is rounded up from the full verified model input ceiling plus the
requested capped output at the configured rates. This deliberately reserves
more than a small prompt might cost. A daily budget smaller than one reservation
admits nothing. The daily ceiling is conditional on accurate worst-case prices,
all billed categories being represented, and the provider honoring its bounds;
it is not an invoice guarantee. Redirects are rejected. Oversized, failed or
partial bodies cannot silently refund an uncertain request.

## Uncertain execution and recovery

Timeout, connection failure, oversized or partial body, or process loss can leave
the provider running. Uncertain calls charge the full maximum and retain their
global/per-account concurrency slot across days. A reserved row left by a crashed
process also retains its slot. Four unknown calls can therefore stop global paid
AI until an operator investigates; there is intentionally no guessed expiry.

Keep hosted AI OFF during recovery. Identify the affected reservation IDs from
authorized database operations without exporting keys, prompts or credentials.
Verify that the original application process is stopped and the provider request
has ended; a local aborted fetch alone does not prove this. If the original row
is still `reserved`, settle it internally as `uncertain`, charging its original
maximum. Call `reconcileUncertain({reservationId, providerRequestEnded: true})`
only after termination evidence exists. This changes status to `reconciled`,
freeing concurrency, without refunding cost or request count. Methods are internal
service APIs; no new public/admin recovery endpoint or persistent access is added.

Invalid reported usage, reported tokens beyond bounds, or actual cost beyond the
reservation records a persistent budget breach. It blocks admission across future
days. Preserve the actual excessive cost; never clamp it to the reservation. Review
the provider request and correct model pricing/bounds, then use internal
`reconcileBudgetBreach({dayStart, pricingCorrected: true, providerUsageReviewed: true})`.
Reconciliation retains historical spending and only acknowledges the reviewed
breach. Never enable the provider as part of testing this code.

## Persistence and privacy

The additive migration introduces provider reservation, per-user-day and global
budget-day rows, plus saved-suggestion reservation rows. Account deletion cascades
per-user counters and suggestion slots. Provider reservations retain anonymous
cost/status/day evidence so deletion cannot refund global spending or concurrency;
the owner becomes null and the prompt fingerprint is scrubbed transactionally.
Per-user exports include only that owner's safe metadata, with lossless BigInt
strings; they omit request keys, prompt fingerprints and global budget data.

Before any future deployment, apply and verify the additive migration and the
deployed runtime database role's required SELECT/INSERT/UPDATE/DELETE permissions
on all four new tables. Saved routes, export and deletion use these tables even
with provider OFF; OFF does not remove that migration prerequisite. This local
change does not apply production migrations or establish live role grants.

No new retention promises are published. Active/uncertain accounting must not be
deleted by generic cleanup. Before future hosted-AI enablement, the owner must
confirm retention for anonymous billing evidence and recovery records, operator
monitoring/reconciliation responsibility, approved budget/limits and verified
model billing. Tests use fake providers and distinctly named disposable local
PostgreSQL databases. No live production accounts or paid calls are needed.
