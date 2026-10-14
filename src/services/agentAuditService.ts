import { Prisma, PrismaClient } from "@prisma/client";
import { RationaleMetadata } from "../ai/decisionSource";
import {
  AGENT_ID_MAX_LENGTH,
  AUDIT_IDEMPOTENCY_KEY_MAX_LENGTH,
  AUDIT_REQUEST_ID_MAX_LENGTH,
  boundDisplayLabel,
  deriveAgentId,
  truncateToCodePoints,
} from "./auditAttribution";

/**
 * Defense in depth: ids are lookup keys and are never truncated here
 * (callers reject oversized values before mutation). An oversized id
 * reaching this layer is logged and the audit row is skipped rather
 * than failing against the column limit.
 */
function hasOversizedTraceId(input: {
  requestId: string;
  idempotencyKey?: string;
  action: string;
}): boolean {
  const oversized =
    input.requestId.length > AUDIT_REQUEST_ID_MAX_LENGTH ||
    (input.idempotencyKey !== undefined &&
      input.idempotencyKey.length > AUDIT_IDEMPOTENCY_KEY_MAX_LENGTH);
  if (oversized) {
    console.error(
      "Skipping agent audit record with oversized request or idempotency id:",
      { action: input.action },
    );
  }
  return oversized;
}

interface AgentAuditRecordInput {
  surface: "agent" | "mcp";
  action: string;
  readOnly: boolean;
  outcome: "success" | "error";
  status: number;
  userId: string;
  requestId: string;
  actor: string;
  idempotencyKey?: string;
  replayed?: boolean;
  errorCode?: string;
  jobName?: string;
  jobPeriodKey?: string;
  triggeredBy?: "user" | "automation" | "agent";
  agentId?: string;
  narration?: string;
}

export class AgentAuditService {
  constructor(private readonly prisma?: PrismaClient) {}

  async logWithRationale(
    ctx: {
      userId: string;
      requestId: string;
      actor: string;
      surface: string;
    },
    action: string,
    outcome: "success" | "error",
    rationaleMetadata: RationaleMetadata,
  ): Promise<void> {
    if (!this.prisma) {
      return;
    }
    if (hasOversizedTraceId({ requestId: ctx.requestId, action })) {
      return;
    }

    const metadata: Prisma.InputJsonValue = {
      ts: new Date().toISOString(),
      rationale: rationaleMetadata as unknown as Prisma.InputJsonObject,
    };

    // Fire and forget to avoid blocking or crashing on high concurrency
    this.prisma.agentActionAudit
      .create({
        data: {
          surface: ctx.surface as "agent" | "mcp",
          action,
          readOnly: false,
          outcome,
          status: outcome === "success" ? 200 : 500,
          userId: ctx.userId,
          requestId: ctx.requestId,
          actor: boundDisplayLabel(ctx.actor, "unknown-agent"),
          replayed: false,
          metadata,
        },
      })
      .catch((err) => {
        console.error(
          "Non-fatal error auditing agent action with rationale:",
          err,
        );
      });
  }

  async record(input: AgentAuditRecordInput): Promise<void> {
    if (!this.prisma) {
      return;
    }
    if (hasOversizedTraceId(input)) {
      return;
    }

    const metadata: Prisma.InputJsonValue = {
      ts: new Date().toISOString(),
    };

    // Fire and forget to avoid blocking or crashing on high concurrency
    this.prisma.agentActionAudit
      .create({
        data: {
          surface: input.surface,
          action: input.action,
          readOnly: input.readOnly,
          outcome: input.outcome,
          status: input.status,
          userId: input.userId,
          requestId: input.requestId,
          actor: boundDisplayLabel(input.actor, "unknown-agent"),
          idempotencyKey: input.idempotencyKey,
          replayed: input.replayed || false,
          errorCode: input.errorCode,
          jobName: input.jobName,
          jobPeriodKey: input.jobPeriodKey,
          triggeredBy: input.triggeredBy,
          agentId: input.agentId
            ? [...input.agentId].length <= AGENT_ID_MAX_LENGTH
              ? input.agentId
              : deriveAgentId(input.agentId)
            : undefined,
          narration: input.narration
            ? truncateToCodePoints(input.narration, 500)
            : undefined,
          metadata,
        },
      })
      .catch((err) => {
        console.error("Non-fatal error auditing agent action:", err);
      });
  }
}
