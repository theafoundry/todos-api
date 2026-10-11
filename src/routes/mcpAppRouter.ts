import { Request, Response, Router } from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { AgentExecutor } from "../agent/agentExecutor";
import { IProjectService } from "../interfaces/IProjectService";
import { AuthService } from "../services/authService";
import { McpOAuthService } from "../services/mcpOAuthService";
import {
  buildMcpActor,
  buildMcpRequestId,
  buildMcpWwwAuthenticateHeader,
  buildScopeError,
  hasRequiredToolScopes,
  resolveMcpAuthContext,
} from "../mcp/mcpAuth";
import {
  buildNativeAppToolsList,
  findNativeAppTool,
  getMcpAppProtectedResourceMetadataUrl,
  getMcpAppResource,
  MCP_APP_SERVER_NAME,
  MCP_APP_SERVER_INSTRUCTIONS,
  MCP_APP_SERVER_VERSION,
  NativeAppToolName,
  TODAY_PLAN_RESOURCE_URI,
} from "../mcp/appContract";
import {
  buildNativeAppSuccessText,
  executeNativeAppTool,
  NativeAppToolError,
} from "../mcp/appTools";
import {
  buildTodayPlanResourceContents,
  TODAY_PLAN_RESOURCE_DESCRIPTOR,
} from "../mcp/todayPlanResource";
import { config } from "../config";
import type { AiProviderAdmissionService } from "../services/aiProviderAdmissionService";
import { runWithAiProviderContext } from "../services/aiProviderContext";
import { McpScope } from "../types";

interface McpAppRouterDeps {
  agentExecutor: AgentExecutor;
  authService?: AuthService;
  mcpOAuthService: McpOAuthService;
  projectService?: IProjectService;
  providerAdmissionService?: AiProviderAdmissionService;
}

function toolError(input: {
  code: string;
  message: string;
  retryable?: boolean;
  hint?: string;
  challenge?: string;
}) {
  return {
    content: [{ type: "text" as const, text: input.message }],
    isError: true,
    structuredContent: {
      error: {
        code: input.code,
        message: input.message,
        retryable: input.retryable ?? false,
        ...(input.hint ? { hint: input.hint } : {}),
      },
    },
    ...(input.challenge
      ? { _meta: { "mcp/www_authenticate": [input.challenge] } }
      : {}),
  };
}

function authChallenge(input: {
  error: "invalid_token" | "insufficient_scope";
  errorDescription: string;
  scopes: readonly McpScope[];
}) {
  return buildMcpWwwAuthenticateHeader({
    error: input.error,
    errorDescription: input.errorDescription,
    resourceMetadataUrl: getMcpAppProtectedResourceMetadataUrl(config.baseUrl),
    scopes: [...input.scopes],
  });
}

function createNativeAppServer(req: Request, deps: McpAppRouterDeps) {
  const server = new Server(
    { name: MCP_APP_SERVER_NAME, version: MCP_APP_SERVER_VERSION },
    {
      capabilities: { tools: {}, resources: {} },
      instructions: MCP_APP_SERVER_INSTRUCTIONS,
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: buildNativeAppToolsList(),
  }));

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [TODAY_PLAN_RESOURCE_DESCRIPTOR],
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    if (request.params.uri !== TODAY_PLAN_RESOURCE_URI) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Unknown resource: ${request.params.uri}`,
      );
    }
    return {
      contents: [buildTodayPlanResourceContents(config.baseUrl)],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const definition = findNativeAppTool(request.params.name);
    if (!definition) {
      return toolError({
        code: "TOOL_NOT_FOUND",
        message: `Unknown tool: ${request.params.name}`,
      });
    }

    const requestId = buildMcpRequestId(req);
    const auth = await resolveMcpAuthContext({
      req,
      authService: deps.authService,
      mcpOAuthService: deps.mcpOAuthService,
      requestId,
      requiredResource: getMcpAppResource(config.baseUrl),
    });
    if (!auth.context) {
      return toolError({
        code: auth.error?.code ?? "MCP_UNAUTHENTICATED",
        message: auth.error?.message ?? "Authentication required",
        retryable: false,
        hint: auth.error?.hint,
        challenge: authChallenge({
          error: "invalid_token",
          errorDescription: auth.error?.message ?? "Authentication required",
          scopes: definition.scopes,
        }),
      });
    }
    if (
      !hasRequiredToolScopes(
        auth.context.session.scopes,
        definition.scopes.slice(),
      )
    ) {
      const error = buildScopeError({
        toolName: definition.name,
        requiredScopes: definition.scopes.slice(),
      });
      return toolError({
        code: error.code,
        message: error.message,
        retryable: false,
        hint: error.hint,
        challenge: authChallenge({
          error: "insufficient_scope",
          errorDescription: error.message,
          scopes: definition.scopes,
        }),
      });
    }

    const authContext = auth.context;
    try {
      const structuredContent = await runWithAiProviderContext(
        { userId: authContext.user.id, source: "native-mcp" },
        () =>
          executeNativeAppTool(
            definition.name as NativeAppToolName,
            request.params.arguments,
            {
              agentExecutor: deps.agentExecutor,
              projectService: deps.projectService,
              prisma: deps.authService?.getPrismaClient(),
              userId: authContext.user.id,
              sessionId: authContext.session.sessionId,
              requestId,
              actor: buildMcpActor(req, authContext.session),
            },
          ),
        deps.providerAdmissionService,
      );
      const output = definition.outputSchema.safeParse(structuredContent);
      if (!output.success) {
        throw new NativeAppToolError(
          "INTERNAL_CONTRACT_ERROR",
          "The tool result did not match its public output contract.",
          true,
        );
      }
      return {
        content: [
          {
            type: "text" as const,
            text: buildNativeAppSuccessText(
              definition.name,
              output.data as Record<string, unknown>,
            ),
          },
        ],
        structuredContent: output.data as Record<string, unknown>,
      };
    } catch (error) {
      if (error instanceof NativeAppToolError) {
        return toolError({
          code: error.code,
          message: error.message,
          retryable: error.retryable,
          hint: error.hint,
        });
      }
      return toolError({
        code: "INTERNAL_ERROR",
        message: "The tool could not complete the request.",
        retryable: true,
      });
    }
  });

  return server;
}

export function createMcpAppRouter(deps: McpAppRouterDeps): Router {
  const router = Router();

  router.post("/", async (req: Request, res: Response) => {
    const server = createNativeAppServer(req, deps);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (_error) {
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32603, message: "Internal server error" },
        });
      }
    }
  });

  router.get("/", (_req, res) => res.status(405).end());
  router.delete("/", (_req, res) => res.status(405).end());
  return router;
}
