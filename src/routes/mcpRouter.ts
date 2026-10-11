import { Request, Response, Router } from "express";
import packageJson from "../../package.json";
import { AgentActionName, AgentExecutor } from "../agent/agentExecutor";
import { config } from "../config";
import {
  buildMcpRequestId,
  buildMcpWwwAuthenticateHeader,
  buildScopeError,
  hasRequiredToolScopes,
  resolveMcpAuthContext,
} from "../mcp/mcpAuth";
import { buildStructuredMcpError } from "../mcp/mcpErrors";
import {
  getMcpToolDefinition,
  listMcpTools,
  MCP_PROTOCOL_VERSION,
  negotiateMcpProtocolVersion,
  requiredScopesForToolCall,
  supportsMcpIdempotencyKey,
} from "../mcp/mcpToolCatalog";
import { AuthService } from "../services/authService";
import type { AiProviderAdmissionService } from "../services/aiProviderAdmissionService";
import { runWithAiProviderContext } from "../services/aiProviderContext";
import { McpOAuthService } from "../services/mcpOAuthService";
import { McpScope } from "../types";

type JsonRpcId = number | string | null;

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: unknown;
}

interface McpRouterDeps {
  agentExecutor: AgentExecutor;
  authService?: AuthService;
  mcpOAuthService?: McpOAuthService;
  providerAdmissionService?: AiProviderAdmissionService;
}

function jsonRpcSuccess(id: JsonRpcId, result: Record<string, unknown>) {
  return {
    jsonrpc: "2.0" as const,
    id,
    result,
  };
}

function jsonRpcError(input: {
  id: JsonRpcId;
  code: number;
  message: string;
  data: Record<string, unknown>;
}) {
  return {
    jsonrpc: "2.0" as const,
    id: input.id,
    error: {
      code: input.code,
      message: input.message,
      data: input.data,
    },
  };
}

function parseRequest(body: unknown): JsonRpcRequest | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }
  const request = body as Record<string, unknown>;
  if (request.jsonrpc !== "2.0" || typeof request.method !== "string") {
    return null;
  }
  if (
    request.id !== undefined &&
    request.id !== null &&
    typeof request.id !== "string" &&
    typeof request.id !== "number"
  ) {
    return null;
  }

  return {
    jsonrpc: "2.0",
    method: request.method,
    id: (request.id as JsonRpcId | undefined) ?? undefined,
    params: request.params,
  };
}

function buildToolErrorResult(message: string, error: Record<string, unknown>) {
  return {
    content: [{ type: "text", text: message }],
    structuredContent: error,
    isError: true,
  };
}

function normalizeToolArguments(params: unknown): {
  name?: string;
  args: Record<string, unknown>;
  error?: ReturnType<typeof buildStructuredMcpError>;
} {
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return {
      args: {},
      error: buildStructuredMcpError({
        code: "MCP_INVALID_PARAMS",
        message: "tools/call params must be an object",
        retryable: false,
        hint: 'Provide { "name": string, "arguments": object }.',
      }),
    };
  }

  const rawParams = params as Record<string, unknown>;
  if (typeof rawParams.name !== "string" || !rawParams.name.trim()) {
    return {
      args: {},
      error: buildStructuredMcpError({
        code: "MCP_TOOL_NAME_REQUIRED",
        message: "Tool name is required",
        retryable: false,
        hint: "Provide a valid tool name in params.name.",
      }),
    };
  }

  if (
    rawParams.arguments !== undefined &&
    (typeof rawParams.arguments !== "object" ||
      Array.isArray(rawParams.arguments))
  ) {
    return {
      name: rawParams.name.trim(),
      args: {},
      error: buildStructuredMcpError({
        code: "MCP_INVALID_TOOL_ARGUMENTS",
        message: "Tool arguments must be an object",
        retryable: false,
        hint: "Provide tool arguments as a JSON object.",
      }),
    };
  }

  return {
    name: rawParams.name.trim(),
    args: (rawParams.arguments as Record<string, unknown>) || {},
  };
}

function rejectUnexpectedOrigin(req: Request) {
  const origin = req.header("origin");
  if (!origin || config.corsOrigins.includes(origin)) {
    return null;
  }
  return buildStructuredMcpError({
    code: "MCP_ORIGIN_NOT_ALLOWED",
    message: "Origin not allowed for MCP requests",
    retryable: false,
    hint: "Use a non-browser MCP client or configure the origin in CORS_ORIGINS.",
  });
}

function logMcpRequest(input: {
  requestId: string;
  userId?: string;
  actor?: string;
  scopes?: McpScope[];
  method: string;
  outcome: "success" | "error";
  toolName?: string;
  errorCode?: string;
  authOutcome?:
    | "authenticated"
    | "missing"
    | "invalid"
    | "expired"
    | "session_invalid"
    | "scope_denied";
  requiredScopes?: McpScope[];
  httpStatus?: number;
  latencyMs?: number;
}) {
  console.info(
    JSON.stringify({
      type: "assistant_mcp_call",
      requestId: input.requestId,
      userId: input.userId,
      actor: input.actor,
      scopes: input.scopes,
      method: input.method,
      toolName: input.toolName,
      outcome: input.outcome,
      authOutcome: input.authOutcome,
      requiredScopes: input.requiredScopes,
      httpStatus: input.httpStatus,
      latencyMs: input.latencyMs,
      errorCode: input.errorCode,
      ts: new Date().toISOString(),
    }),
  );
}

export function createMcpRouter({
  agentExecutor,
  authService,
  mcpOAuthService,
  providerAdmissionService,
}: McpRouterDeps): Router {
  const router = Router();

  router.get("/", async (req: Request, res: Response) => {
    const requestId = buildMcpRequestId(req);
    const startedAt = Date.now();
    const auth = await resolveMcpAuthContext({
      req,
      authService,
      mcpOAuthService,
      requestId,
    });

    if (!auth.context || auth.error) {
      const errorCode = auth.error?.code;
      const authOutcome =
        errorCode === "MCP_UNAUTHENTICATED"
          ? "missing"
          : errorCode === "MCP_AUTH_EXPIRED"
            ? "expired"
            : errorCode === "MCP_INVALID_SESSION"
              ? "session_invalid"
              : "invalid";
      logMcpRequest({
        requestId,
        method: "get_stream",
        outcome: "error",
        authOutcome,
        errorCode,
        httpStatus: auth.httpStatus,
        latencyMs: Date.now() - startedAt,
      });
      res.setHeader(
        "WWW-Authenticate",
        buildMcpWwwAuthenticateHeader(
          errorCode && errorCode !== "MCP_UNAUTHENTICATED"
            ? {
                error: "invalid_token",
                errorDescription: auth.error?.message,
              }
            : undefined,
        ),
      );
      res.status(auth.httpStatus).json({
        error:
          auth.error ||
          buildStructuredMcpError({
            code: "MCP_UNAUTHENTICATED",
            message: "Authentication failed",
            retryable: false,
          }),
      });
      return;
    }

    const { context } = auth;
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();
    res.write(`: connected requestId=${context.requestId}\n\n`);

    const heartbeat = setInterval(() => {
      if (!res.writableEnded) {
        res.write(`: keepalive ${Date.now()}\n\n`);
      }
    }, 15000);

    req.on("close", () => {
      clearInterval(heartbeat);
    });

    logMcpRequest({
      requestId,
      method: "get_stream",
      outcome: "success",
      userId: context.user.id,
      actor: context.actor,
      scopes: context.session.scopes,
      authOutcome: "authenticated",
      httpStatus: 200,
      latencyMs: Date.now() - startedAt,
    });
  });

  router.post("/", async (req: Request, res: Response) => {
    const startedAt = Date.now();
    const parsedRequest = parseRequest(req.body);
    const requestId = buildMcpRequestId(req, parsedRequest?.id);

    if (!parsedRequest) {
      logMcpRequest({
        requestId,
        method: "invalid_request",
        outcome: "error",
        errorCode: "MCP_INVALID_REQUEST",
        httpStatus: 400,
        latencyMs: Date.now() - startedAt,
      });
      res.status(400).json(
        jsonRpcError({
          id: null,
          code: -32600,
          message: "Invalid Request",
          data: buildStructuredMcpError({
            code: "MCP_INVALID_REQUEST",
            message: "Request must be a JSON-RPC 2.0 object",
            retryable: false,
            hint: "Send a single JSON-RPC 2.0 request object to POST /mcp.",
          }),
        }),
      );
      return;
    }

    const originError = rejectUnexpectedOrigin(req);
    if (originError) {
      logMcpRequest({
        requestId,
        method: parsedRequest.method,
        outcome: "error",
        errorCode: originError.code,
        httpStatus: 403,
        latencyMs: Date.now() - startedAt,
      });
      res.status(403).json(
        jsonRpcError({
          id: parsedRequest.id ?? null,
          code: -32001,
          message: "Origin not allowed",
          data: originError,
        }),
      );
      return;
    }

    const auth = await resolveMcpAuthContext({
      req,
      authService,
      mcpOAuthService,
      requestId,
    });
    if (!auth.context || auth.error) {
      const errorCode = auth.error?.code;
      const authOutcome =
        errorCode === "MCP_UNAUTHENTICATED"
          ? "missing"
          : errorCode === "MCP_AUTH_EXPIRED"
            ? "expired"
            : errorCode === "MCP_INVALID_SESSION"
              ? "session_invalid"
              : "invalid";
      logMcpRequest({
        requestId,
        method: parsedRequest.method,
        outcome: "error",
        authOutcome,
        errorCode,
        httpStatus: auth.httpStatus,
        latencyMs: Date.now() - startedAt,
      });
      res.setHeader(
        "WWW-Authenticate",
        buildMcpWwwAuthenticateHeader(
          errorCode && errorCode !== "MCP_UNAUTHENTICATED"
            ? {
                error: "invalid_token",
                errorDescription: auth.error?.message,
              }
            : undefined,
        ),
      );
      res.status(auth.httpStatus).json(
        jsonRpcError({
          id: parsedRequest.id ?? null,
          code: -32001,
          message: auth.error?.message || "Authentication failed",
          data:
            auth.error ||
            buildStructuredMcpError({
              code: "MCP_UNAUTHENTICATED",
              message: "Authentication failed",
              retryable: false,
            }),
        }),
      );
      return;
    }

    const { context } = auth;
    const { session, actor, user } = context;

    switch (parsedRequest.method) {
      case "initialize": {
        const clientVersion =
          parsedRequest.params &&
          typeof parsedRequest.params === "object" &&
          !Array.isArray(parsedRequest.params)
            ? (parsedRequest.params as Record<string, unknown>).protocolVersion
            : undefined;
        const agreedVersion = negotiateMcpProtocolVersion(
          typeof clientVersion === "string" ? clientVersion : undefined,
        );
        logMcpRequest({
          requestId,
          method: parsedRequest.method,
          outcome: "success",
          userId: user.id,
          actor,
          scopes: session.scopes,
          authOutcome: "authenticated",
          httpStatus: 200,
          latencyMs: Date.now() - startedAt,
        });
        res.status(200).json(
          jsonRpcSuccess(parsedRequest.id ?? null, {
            protocolVersion: agreedVersion,
            capabilities: {
              tools: {
                listChanged: false,
              },
            },
            serverInfo: {
              name: "todos-api-mcp",
              version: packageJson.version,
            },
            instructions:
              "Use tools/list to discover your scoped tools. Public connectors should use /.well-known OAuth metadata plus /oauth/authorize, /oauth/token, and /oauth/register. /auth/mcp/token remains available for local development.",
          }),
        );
        return;
      }
      case "ping": {
        logMcpRequest({
          requestId,
          method: parsedRequest.method,
          outcome: "success",
          userId: user.id,
          actor,
          scopes: session.scopes,
          authOutcome: "authenticated",
          httpStatus: 200,
          latencyMs: Date.now() - startedAt,
        });
        res.status(200).json(jsonRpcSuccess(parsedRequest.id ?? null, {}));
        return;
      }
      case "notifications/initialized": {
        logMcpRequest({
          requestId,
          method: parsedRequest.method,
          outcome: "success",
          userId: user.id,
          actor,
          scopes: session.scopes,
          authOutcome: "authenticated",
          httpStatus: 202,
          latencyMs: Date.now() - startedAt,
        });
        res.status(202).end();
        return;
      }
      case "tools/list": {
        const tools = listMcpTools({
          scopes: session.scopes,
          projectServiceEnabled: agentExecutor.hasProjectService(),
        });
        logMcpRequest({
          requestId,
          method: parsedRequest.method,
          outcome: "success",
          userId: user.id,
          actor,
          scopes: session.scopes,
          authOutcome: "authenticated",
          httpStatus: 200,
          latencyMs: Date.now() - startedAt,
        });
        res.status(200).json(
          jsonRpcSuccess(parsedRequest.id ?? null, {
            tools,
          }),
        );
        return;
      }
      case "tools/call": {
        const normalized = normalizeToolArguments(parsedRequest.params);
        if (!normalized.name || normalized.error) {
          logMcpRequest({
            requestId,
            method: parsedRequest.method,
            outcome: "error",
            userId: user.id,
            actor,
            scopes: session.scopes,
            authOutcome: "authenticated",
            errorCode: normalized.error?.code,
            httpStatus: 400,
            latencyMs: Date.now() - startedAt,
          });
          res.status(400).json(
            jsonRpcError({
              id: parsedRequest.id ?? null,
              code: -32602,
              message: normalized.error?.message || "Invalid params",
              data:
                normalized.error ||
                buildStructuredMcpError({
                  code: "MCP_INVALID_PARAMS",
                  message: "Invalid tool call params",
                  retryable: false,
                }),
            }),
          );
          return;
        }

        const tool = getMcpToolDefinition(normalized.name);
        if (
          !tool ||
          (tool.requiresProjectService && !agentExecutor.hasProjectService())
        ) {
          const error = buildStructuredMcpError({
            code: "MCP_TOOL_NOT_FOUND",
            message: `Tool "${normalized.name}" is not available`,
            retryable: false,
            hint: "Call tools/list to discover the tools currently available to this token.",
          });
          logMcpRequest({
            requestId,
            method: parsedRequest.method,
            outcome: "error",
            userId: user.id,
            actor,
            scopes: session.scopes,
            toolName: normalized.name,
            authOutcome: "authenticated",
            errorCode: error.code,
            httpStatus: 200,
            latencyMs: Date.now() - startedAt,
          });
          res.status(200).json(
            jsonRpcSuccess(
              parsedRequest.id ?? null,
              buildToolErrorResult(error.message, {
                ok: false,
                error,
                trace: {
                  requestId,
                  actor,
                },
              }),
            ),
          );
          return;
        }

        const requiredScopes = requiredScopesForToolCall(
          tool.name,
          normalized.args,
        );

        if (!hasRequiredToolScopes(session.scopes, requiredScopes)) {
          const error = buildScopeError({
            toolName: tool.name,
            requiredScopes,
          });
          logMcpRequest({
            requestId,
            method: parsedRequest.method,
            outcome: "error",
            userId: user.id,
            actor,
            scopes: session.scopes,
            toolName: normalized.name,
            authOutcome: "scope_denied",
            requiredScopes,
            errorCode: error.code,
            httpStatus: 200,
            latencyMs: Date.now() - startedAt,
          });
          res.status(200).json(
            jsonRpcSuccess(
              parsedRequest.id ?? null,
              buildToolErrorResult(error.message, {
                ok: false,
                error,
                trace: {
                  requestId,
                  actor,
                },
              }),
            ),
          );
          return;
        }

        const toolArguments = { ...normalized.args };
        const idempotencyKey =
          supportsMcpIdempotencyKey(tool.name as AgentActionName) &&
          typeof toolArguments.idempotencyKey === "string" &&
          toolArguments.idempotencyKey.trim()
            ? toolArguments.idempotencyKey.trim()
            : undefined;
        if ("idempotencyKey" in toolArguments) {
          delete toolArguments.idempotencyKey;
        }

        const result = await runWithAiProviderContext(
          { userId: user.id, source: "legacy-mcp" },
          () =>
            agentExecutor.execute(tool.name as AgentActionName, toolArguments, {
              userId: user.id,
              requestId,
              actor,
              surface: "mcp",
              idempotencyKey,
            }),
          providerAdmissionService,
        );

        if (result.body.ok) {
          logMcpRequest({
            requestId,
            method: parsedRequest.method,
            outcome: "success",
            userId: user.id,
            actor,
            scopes: session.scopes,
            toolName: normalized.name,
            authOutcome: "authenticated",
            httpStatus: 200,
            latencyMs: Date.now() - startedAt,
          });
          res.status(200).json(
            jsonRpcSuccess(parsedRequest.id ?? null, {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(result.body),
                },
              ],
              structuredContent: result.body,
            }),
          );
          return;
        }

        logMcpRequest({
          requestId,
          method: parsedRequest.method,
          outcome: "error",
          userId: user.id,
          actor,
          scopes: session.scopes,
          toolName: normalized.name,
          authOutcome: "authenticated",
          errorCode: result.body.error.code,
          httpStatus: 200,
          latencyMs: Date.now() - startedAt,
        });
        res
          .status(200)
          .json(
            jsonRpcSuccess(
              parsedRequest.id ?? null,
              buildToolErrorResult(result.body.error.message, result.body),
            ),
          );
        return;
      }
      default: {
        const error = buildStructuredMcpError({
          code: "MCP_METHOD_NOT_FOUND",
          message: `Method "${parsedRequest.method}" is not supported`,
          retryable: false,
          hint: "Use initialize, ping, tools/list, tools/call, or notifications/initialized.",
        });
        logMcpRequest({
          requestId,
          method: parsedRequest.method,
          outcome: "error",
          userId: user.id,
          actor,
          scopes: session.scopes,
          authOutcome: "authenticated",
          errorCode: error.code,
          httpStatus: 404,
          latencyMs: Date.now() - startedAt,
        });
        res.status(404).json(
          jsonRpcError({
            id: parsedRequest.id ?? null,
            code: -32601,
            message: "Method not found",
            data: error,
          }),
        );
      }
    }
  });

  return router;
}
