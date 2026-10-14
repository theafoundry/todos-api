import { randomUUID } from "crypto";
import { Request } from "express";
import { boundDisplayLabel, deriveAgentId } from "../services/auditAttribution";

export interface AgentRequestContext {
  requestId: string;
  /** Bounded untrusted display label (255 chars). Never used as identity. */
  actor: string;
  /** Stable audit identity derived from the full, untruncated label. */
  agentId: string;
  idempotencyKey?: string;
}

declare global {
  namespace Express {
    interface Request {
      agentContext?: AgentRequestContext;
    }
  }
}

function readOptionalHeader(req: Request, name: string): string | undefined {
  const raw = req.header(name);
  if (typeof raw !== "string") {
    return undefined;
  }
  const normalized = raw.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function getAgentRequestContext(req: Request): AgentRequestContext {
  if (req.agentContext) {
    return req.agentContext;
  }

  // Display and identity are separated: the display label is bounded
  // to the audit column limit, while the stable agent identity is
  // derived from the full untruncated source. Both are untrusted on
  // this surface; authenticated identity comes from the verified
  // token, never these values.
  const rawLabel =
    readOptionalHeader(req, "x-agent-name") ||
    readOptionalHeader(req, "user-agent") ||
    "unknown-agent";
  const actor = boundDisplayLabel(rawLabel, "unknown-agent");
  const agentId = deriveAgentId(rawLabel);
  const requestId =
    req.requestId ||
    readOptionalHeader(req, "x-request-id") ||
    readOptionalHeader(req, "x-agent-request-id") ||
    randomUUID();
  const idempotencyKey = readOptionalHeader(req, "idempotency-key");

  req.agentContext = {
    requestId,
    actor,
    agentId,
    ...(idempotencyKey ? { idempotencyKey } : {}),
  };

  return req.agentContext;
}
