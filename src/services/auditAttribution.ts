import { createHash } from "crypto";
import { AgentExecutionError } from "../domains/agent/actions/agentExecutionError";

/**
 * Audit attribution limits, mirroring prisma/schema.prisma:
 * AgentActionAudit.actor/requestId/idempotencyKey are VarChar(255) and
 * agent_id is VarChar(20); AgentIdempotencyRecord.idempotencyKey is
 * VarChar(255).
 *
 * `actor` is an untrusted display label supplied by the caller (or a
 * user-agent fallback). It is never an authenticated identity and must
 * never be used for authorization; authenticated identity always comes
 * from the verified token's userId.
 */
export const AUDIT_ACTOR_MAX_LENGTH = 255;
export const AUDIT_REQUEST_ID_MAX_LENGTH = 255;
export const AUDIT_IDEMPOTENCY_KEY_MAX_LENGTH = 255;
export const AGENT_ID_MAX_LENGTH = 20;

/**
 * Truncate by Unicode code points, never by UTF-16 code units, so a
 * surrogate pair (for example an emoji) at the boundary is kept whole
 * instead of being split into an invalid lone surrogate. Postgres
 * varchar limits also count code points, not UTF-16 units.
 */
export function truncateToCodePoints(
  value: string,
  maxCodePoints: number,
): string {
  // Fast path: UTF-16 length at most the limit implies code-point
  // length at most the limit too.
  if (value.length <= maxCodePoints) {
    return value;
  }
  return [...value].slice(0, maxCodePoints).join("");
}

/** Bound an untrusted display label to its storage limit. */
export function boundDisplayLabel(
  value: string | undefined | null,
  fallback: string,
): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    return fallback;
  }
  return truncateToCodePoints(normalized, AUDIT_ACTOR_MAX_LENGTH);
}

/**
 * Stable agent identity, kept separate from the bounded display label.
 *
 * The identity is always derived from the FULL identity source, never
 * from display text truncated to 255 characters, so two sources that
 * differ only after the display bound keep distinct identities.
 * Sources that fit the column are kept verbatim (exact, no hashing);
 * longer sources are represented by an 80-bit SHA-256 digest prefix
 * (20 hex characters, the full agent_id column).
 *
 * Collision limits: the previous representation carried only a 32-bit
 * (8 hex) hash suffix, whose birthday bound reaches ~50% collision
 * probability at roughly 77k distinct long labels — reachable for a
 * busy deployment. The 80-bit digest reaches ~50% only at roughly
 * 1.4e12 distinct long identities, and the collision probability at
 * one million distinct identities is about 4e-13. Identity here is an
 * audit grouping key, not a credential; authenticated identity remains
 * the verified token's userId (and, for MCP, its clientId claim).
 */
export function deriveAgentId(identitySource: string): string {
  const normalized = identitySource.trim();
  // The column counts Unicode code points, so the verbatim threshold
  // does too; a 20-code-point identity containing emoji still fits.
  if ([...normalized].length <= AGENT_ID_MAX_LENGTH) {
    return normalized;
  }
  return createHash("sha256").update(normalized).digest("hex").slice(0, 20);
}

/**
 * Request and idempotency ids are lookup keys, so they are never
 * silently truncated (that would merge distinct keys). Oversized
 * caller-supplied values are rejected before any mutation.
 */
export function assertValidTraceIds(ids: {
  requestId?: string;
  idempotencyKey?: string;
}): void {
  if (
    ids.requestId !== undefined &&
    ids.requestId.length > AUDIT_REQUEST_ID_MAX_LENGTH
  ) {
    throw new AgentExecutionError(
      400,
      "INVALID_INPUT",
      `requestId cannot exceed ${AUDIT_REQUEST_ID_MAX_LENGTH} characters`,
      false,
      `Supply a request id of at most ${AUDIT_REQUEST_ID_MAX_LENGTH} characters or omit it.`,
    );
  }
  if (
    ids.idempotencyKey !== undefined &&
    ids.idempotencyKey.length > AUDIT_IDEMPOTENCY_KEY_MAX_LENGTH
  ) {
    throw new AgentExecutionError(
      400,
      "INVALID_INPUT",
      `idempotencyKey cannot exceed ${AUDIT_IDEMPOTENCY_KEY_MAX_LENGTH} characters`,
      false,
      `Supply an idempotency key of at most ${AUDIT_IDEMPOTENCY_KEY_MAX_LENGTH} characters.`,
    );
  }
}
