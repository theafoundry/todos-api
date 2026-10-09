import { randomUUID } from "crypto";
import { Request } from "express";
import { AuthService, McpTokenPayload } from "../services/authService";
import { McpScope } from "../types";
import { buildStructuredMcpError } from "./mcpErrors";
import { hasAllMcpScopes } from "./mcpScopes";
import { config } from "../config";
import { McpOAuthService } from "../services/mcpOAuthService";

type JsonRpcId = number | string | null;

export interface ResolvedMcpAuthContext {
  session: McpTokenPayload;
  user: {
    id: string;
    email: string | null;
    name: string | null;
    isVerified: boolean;
    role: string;
    plan: string;
  };
  requestId: string;
  actor: string;
}

function readHeader(req: Request, name: string): string | undefined {
  const value = req.header(name);
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

export function buildMcpRequestId(req: Request, requestId?: JsonRpcId): string {
  const headerId = readHeader(req, "x-mcp-request-id");
  if (headerId) {
    return headerId;
  }
  if (typeof requestId === "string" || typeof requestId === "number") {
    return `mcp-${requestId}`;
  }
  return randomUUID();
}

export function buildMcpActor(
  req: Request,
  session?: Pick<McpTokenPayload, "assistantName" | "clientId">,
): string {
  const headerActor = readHeader(req, "x-assistant-name");
  if (headerActor) {
    return headerActor;
  }
  if (session?.assistantName) {
    return session.assistantName;
  }
  if (session?.clientId) {
    return session.clientId;
  }
  return readHeader(req, "user-agent") || "unknown-assistant";
}

export async function resolveMcpAuthContext(input: {
  req: Request;
  authService?: AuthService;
  mcpOAuthService?: McpOAuthService;
  requestId: string;
  requiredResource?: string;
}): Promise<{
  httpStatus: number;
  context?: ResolvedMcpAuthContext;
  error?: ReturnType<typeof buildStructuredMcpError>;
}> {
  if (!input.authService) {
    return {
      httpStatus: 501,
      error: buildStructuredMcpError({
        code: "MCP_NOT_CONFIGURED",
        message: "MCP authentication is not configured",
        retryable: false,
        hint: "Enable application authentication before using the remote MCP surface.",
      }),
    };
  }

  const authHeader = readHeader(input.req, "authorization");
  if (!authHeader) {
    return {
      httpStatus: 401,
      error: buildStructuredMcpError({
        code: "MCP_UNAUTHENTICATED",
        message: "Authorization header missing",
        retryable: false,
        hint: "Complete the MCP account-link flow and send Authorization: Bearer <token>.",
      }),
    };
  }

  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") {
    return {
      httpStatus: 401,
      error: buildStructuredMcpError({
        code: "MCP_INVALID_AUTHORIZATION",
        message: "Invalid authorization format. Expected: Bearer <token>",
        retryable: false,
        hint: "Send the MCP access token as a bearer token.",
      }),
    };
  }

  let session: McpTokenPayload;
  try {
    session = await input.authService.verifyMcpToken(parts[1], {
      resource:
        input.requiredResource ?? new URL("/mcp", config.baseUrl).toString(),
      requireResource: Boolean(input.requiredResource),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "Token expired") {
      return {
        httpStatus: 401,
        error: buildStructuredMcpError({
          code: "MCP_AUTH_EXPIRED",
          message: "MCP access token expired",
          retryable: false,
          hint: "Use the MCP refresh-token grant if available, or repeat the link flow to mint a fresh token.",
        }),
      };
    }
    if (message === "MCP token revoked") {
      return {
        httpStatus: 401,
        error: buildStructuredMcpError({
          code: "MCP_AUTH_REVOKED",
          message: "MCP access token has been revoked",
          retryable: false,
          hint: "Reconnect the assistant or mint a new token after re-authorizing access.",
        }),
      };
    }

    return {
      httpStatus: 401,
      error: buildStructuredMcpError({
        code: "MCP_INVALID_TOKEN",
        message: "Invalid MCP access token",
        retryable: false,
        hint: "Use a token minted through the MCP OAuth exchange or local dev mint endpoint.",
      }),
    };
  }

  const user = await input.authService.getUserById(session.userId);
  if (!user) {
    return {
      httpStatus: 401,
      error: buildStructuredMcpError({
        code: "MCP_INVALID_SESSION",
        message: "MCP token no longer maps to an active user session",
        retryable: false,
        hint: "Re-link the user account to mint a fresh token.",
      }),
    };
  }

  if (session.sessionId && input.mcpOAuthService) {
    await input.mcpOAuthService.recordAssistantSessionUsage(session.sessionId);
  }

  return {
    httpStatus: 200,
    context: {
      session,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        isVerified: user.isVerified,
        role: user.role,
        plan: user.plan,
      },
      requestId: input.requestId,
      actor: buildMcpActor(input.req, session),
    },
  };
}

export function buildScopeError(input: {
  toolName: string;
  requiredScopes: McpScope[];
}) {
  return buildStructuredMcpError({
    code: "MCP_INSUFFICIENT_SCOPE",
    message: `Tool "${input.toolName}" requires scopes: ${input.requiredScopes.join(", ")}`,
    retryable: false,
    hint: "Re-link the account with the missing scopes and retry.",
    details: {
      requiredScopes: input.requiredScopes,
    },
  });
}

export function hasRequiredToolScopes(
  availableScopes: McpScope[],
  requiredScopes: McpScope[],
) {
  return hasAllMcpScopes(availableScopes, requiredScopes);
}

export function buildMcpWwwAuthenticateHeader(input?: {
  error?: "invalid_token" | "insufficient_scope";
  errorDescription?: string;
  resourceMetadataUrl?: string;
  scopes?: McpScope[];
}) {
  const parts = [
    'Bearer realm="todos-api-mcp"',
    `resource_metadata="${input?.resourceMetadataUrl || `${config.baseUrl}/.well-known/oauth-protected-resource`}"`,
  ];

  if (input?.error) {
    parts.push(`error="${input.error}"`);
  }
  if (input?.errorDescription) {
    parts.push(
      `error_description="${input.errorDescription.replace(/"/g, "")}"`,
    );
  }
  if (input?.scopes?.length) {
    parts.push(`scope="${input.scopes.join(" ")}"`);
  }

  return parts.join(", ");
}
