import { createHash } from "crypto";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "./app";
import { TodoService } from "./services/todoService";
import type { IProjectService } from "./interfaces/IProjectService";
import type {
  CreateProjectDto,
  McpScope,
  Project,
  ProjectTaskDisposition,
  UpdateProjectDto,
} from "./types";

function createProjectServiceMock(): jest.Mocked<IProjectService> {
  return {
    findAll: jest.fn<Promise<Project[]>, [string]>(),
    findById: jest.fn<Promise<Project | null>, [string, string]>(),
    create: jest.fn<Promise<Project>, [string, CreateProjectDto]>(),
    update: jest.fn<
      Promise<Project | null>,
      [string, string, UpdateProjectDto]
    >(),
    setArchived: jest.fn<Promise<Project | null>, [string, string, boolean]>(),
    delete: jest.fn<
      Promise<boolean>,
      [string, string, ProjectTaskDisposition, (string | null)?]
    >(),
  };
}

function buildMcpSession(
  userId: string,
  scopes: McpScope[],
  assistantName = "ChatGPT",
) {
  return {
    userId,
    email: `${userId}@example.com`,
    tokenType: "mcp" as const,
    scopes,
    assistantName,
    clientId: "chatgpt-client",
  };
}

function createPkcePair(verifier: string) {
  const challenge = createHash("sha256")
    .update(verifier, "utf8")
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  return { verifier, challenge };
}

describe("Remote MCP router auth and scopes", () => {
  let app: Express;
  let todoService: TodoService;
  let projectService: jest.Mocked<IProjectService>;
  let currentSession: ReturnType<typeof buildMcpSession>;
  let mockAuthService: {
    verifyToken: jest.Mock;
    verifyActiveToken: jest.Mock;
    createMcpToken: jest.Mock;
    verifyMcpToken: jest.Mock;
    getUserById: jest.Mock;
  };

  beforeEach(() => {
    todoService = new TodoService();
    projectService = createProjectServiceMock();
    currentSession = buildMcpSession("user-1", ["projects.read", "tasks.read"]);

    mockAuthService = {
      verifyToken: jest
        .fn()
        .mockReturnValue({ userId: "user-1", email: "user-1@example.com" }),
      verifyActiveToken: jest
        .fn()
        .mockImplementation(async (token) =>
          mockAuthService.verifyToken(token),
        ),
      createMcpToken: jest.fn().mockImplementation((input) => ({
        token: `mcp-token-${input.userId}`,
        tokenType: "Bearer",
        scope: [...input.scopes].sort().join(" "),
        scopes: [...input.scopes].sort(),
        expiresAt: "2026-04-10T00:00:00.000Z",
        expiresIn: 2592000,
        assistantName: input.assistantName,
        clientId: input.clientId,
      })),
      verifyMcpToken: jest.fn().mockImplementation(() => currentSession),
      getUserById: jest.fn().mockImplementation(async (userId: string) => {
        if (userId === "missing-user") {
          return null;
        }

        return {
          id: userId,
          email: `${userId}@example.com`,
          name: userId,
          isVerified: true,
          role: "user",
          plan: "free",
          createdAt: new Date("2026-03-11T00:00:00.000Z"),
          updatedAt: new Date("2026-03-11T00:00:00.000Z"),
        };
      }),
    };

    app = createApp({
      todoService,
      authService: mockAuthService as any,
      projectService,
    });
  });

  it("issues scoped MCP tokens directly for local development", async () => {
    const response = await request(app)
      .post("/auth/mcp/token")
      .set("Authorization", "Bearer app-access-token")
      .send({
        scopes: ["tasks.write"],
        assistantName: "ChatGPT",
        clientId: "chatgpt-client",
      })
      .expect(201);

    expect(mockAuthService.createMcpToken).toHaveBeenCalledWith({
      userId: "user-1",
      email: "user-1@example.com",
      scopes: ["tasks.write"],
      assistantName: "ChatGPT",
      clientId: "chatgpt-client",
      sessionId: expect.any(String),
    });
    expect(response.body).toEqual({
      token: "mcp-token-user-1",
      tokenType: "Bearer",
      scope: "tasks.write",
      scopes: ["tasks.write"],
      expiresAt: "2026-04-10T00:00:00.000Z",
      expiresIn: 2592000,
      assistantName: "ChatGPT",
      clientId: "chatgpt-client",
      sessionId: expect.any(String),
    });
  });

  it("starts OAuth-style assistant linking for an authenticated app user", async () => {
    const pkce = createPkcePair(
      "verifier-value-0000000000000000000000000000000000000",
    );

    const response = await request(app)
      .post("/auth/mcp/oauth/authorize")
      .set("Authorization", "Bearer app-access-token")
      .send({
        clientId: "chatgpt-client",
        redirectUri: "https://chat.openai.com/aip/callback",
        scopes: ["tasks.read", "projects.read"],
        assistantName: "ChatGPT",
        state: "opaque-state",
        codeChallenge: pkce.challenge,
        codeChallengeMethod: "S256",
      })
      .expect(201);

    expect(response.body.authorizationCode).toEqual(expect.any(String));
    expect(response.body.tokenEndpoint).toBe("/auth/mcp/oauth/token");
    expect(response.body.scopes).toEqual(["projects.read", "tasks.read"]);
    expect(response.body.state).toBe("opaque-state");
  });

  it("exchanges an authorization code for a scoped MCP access token", async () => {
    const pkce = createPkcePair(
      "oauth-verifier-111111111111111111111111111111111111111",
    );

    const authorize = await request(app)
      .post("/auth/mcp/oauth/authorize")
      .set("Authorization", "Bearer app-access-token")
      .send({
        clientId: "chatgpt-client",
        redirectUri: "https://chat.openai.com/aip/callback",
        scopes: ["tasks.read", "tasks.write"],
        assistantName: "ChatGPT",
        codeChallenge: pkce.challenge,
        codeChallengeMethod: "S256",
      })
      .expect(201);

    const exchange = await request(app)
      .post("/auth/mcp/oauth/token")
      .send({
        grantType: "authorization_code",
        code: authorize.body.authorizationCode,
        clientId: "chatgpt-client",
        redirectUri: "https://chat.openai.com/aip/callback",
        codeVerifier: pkce.verifier,
      })
      .expect(200);

    expect(mockAuthService.createMcpToken).toHaveBeenCalledWith({
      userId: "user-1",
      email: "user-1@example.com",
      scopes: ["tasks.read", "tasks.write"],
      assistantName: "ChatGPT",
      clientId: "chatgpt-client",
      sessionId: expect.any(String),
    });
    expect(exchange.body).toEqual({
      accessToken: "mcp-token-user-1",
      tokenType: "Bearer",
      expiresAt: "2026-04-10T00:00:00.000Z",
      expiresIn: 2592000,
      scope: "tasks.read tasks.write",
      scopes: ["tasks.read", "tasks.write"],
      assistantName: "ChatGPT",
      clientId: "chatgpt-client",
      sessionId: expect.any(String),
      refreshToken: expect.any(String),
      refreshTokenExpiresAt: expect.any(String),
      refreshTokenExpiresIn: 2592000,
    });
  });

  it("rotates MCP refresh tokens through the internal OAuth token endpoint", async () => {
    const pkce = createPkcePair(
      "oauth-verifier-refresh-111111111111111111111111111111111111",
    );

    const authorize = await request(app)
      .post("/auth/mcp/oauth/authorize")
      .set("Authorization", "Bearer app-access-token")
      .send({
        clientId: "chatgpt-client",
        redirectUri: "https://chat.openai.com/aip/callback",
        scopes: ["tasks.read", "tasks.write"],
        assistantName: "ChatGPT",
        codeChallenge: pkce.challenge,
        codeChallengeMethod: "S256",
      })
      .expect(201);

    const exchange = await request(app)
      .post("/auth/mcp/oauth/token")
      .send({
        grantType: "authorization_code",
        code: authorize.body.authorizationCode,
        clientId: "chatgpt-client",
        redirectUri: "https://chat.openai.com/aip/callback",
        codeVerifier: pkce.verifier,
      })
      .expect(200);

    const refreshed = await request(app)
      .post("/auth/mcp/oauth/token")
      .send({
        grantType: "refresh_token",
        refreshToken: exchange.body.refreshToken,
        clientId: "chatgpt-client",
      })
      .expect(200);

    expect(refreshed.body.accessToken).toBe("mcp-token-user-1");
    expect(refreshed.body.refreshToken).toEqual(expect.any(String));
    expect(refreshed.body.refreshToken).not.toBe(exchange.body.refreshToken);
    expect(refreshed.body.sessionId).toEqual(expect.any(String));
  });

  it("lists active MCP assistant sessions for the authenticated app user", async () => {
    await request(app)
      .post("/auth/mcp/token")
      .set("Authorization", "Bearer app-access-token")
      .send({
        scopes: ["tasks.write"],
        assistantName: "ChatGPT",
        clientId: "chatgpt-client",
      })
      .expect(201);

    const response = await request(app)
      .get("/auth/mcp/sessions")
      .set("Authorization", "Bearer app-access-token")
      .expect(200);

    expect(response.body.sessions).toEqual([
      expect.objectContaining({
        id: expect.any(String),
        clientId: "chatgpt-client",
        assistantName: "ChatGPT",
        scopes: ["tasks.write"],
        source: "local",
      }),
    ]);
  });

  it("revokes an MCP assistant session for the authenticated app user", async () => {
    const issued = await request(app)
      .post("/auth/mcp/token")
      .set("Authorization", "Bearer app-access-token")
      .send({
        scopes: ["tasks.write"],
        assistantName: "ChatGPT",
        clientId: "chatgpt-client",
      })
      .expect(201);

    const revoke = await request(app)
      .post("/auth/mcp/sessions/revoke")
      .set("Authorization", "Bearer app-access-token")
      .send({
        sessionId: issued.body.sessionId,
      })
      .expect(200);

    expect(revoke.body).toEqual({
      revoked: true,
      sessionId: issued.body.sessionId,
    });

    const listed = await request(app)
      .get("/auth/mcp/sessions")
      .set("Authorization", "Bearer app-access-token")
      .expect(200);
    expect(listed.body.sessions).toEqual([]);
  });

  it("returns structured errors when the PKCE verifier is wrong", async () => {
    const pkce = createPkcePair(
      "oauth-verifier-222222222222222222222222222222222222222",
    );

    const authorize = await request(app)
      .post("/auth/mcp/oauth/authorize")
      .set("Authorization", "Bearer app-access-token")
      .send({
        clientId: "claude-client",
        redirectUri: "https://claude.ai/oauth/callback",
        scopes: ["tasks.read"],
        assistantName: "Claude",
        codeChallenge: pkce.challenge,
        codeChallengeMethod: "S256",
      })
      .expect(201);

    const exchange = await request(app)
      .post("/auth/mcp/oauth/token")
      .send({
        grantType: "authorization_code",
        code: authorize.body.authorizationCode,
        clientId: "claude-client",
        redirectUri: "https://claude.ai/oauth/callback",
        codeVerifier: "wrong-verifier-333333333333333333333333333333333333333",
      })
      .expect(401);

    expect(exchange.body.error.code).toBe("MCP_INVALID_CODE_VERIFIER");
  });

  it("rejects missing MCP auth with a structured protocol error", async () => {
    const response = await request(app)
      .post("/mcp")
      .send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
      })
      .expect(401);

    expect(response.body.error.data.code).toBe("MCP_UNAUTHENTICATED");
  });

  it("rejects expired MCP access tokens", async () => {
    mockAuthService.verifyMcpToken.mockImplementation(() => {
      throw new Error("Token expired");
    });

    const response = await request(app)
      .post("/mcp")
      .set("Authorization", "Bearer expired-token")
      .send({
        jsonrpc: "2.0",
        id: 2,
        method: "ping",
      })
      .expect(401);

    expect(response.body.error.data.code).toBe("MCP_AUTH_EXPIRED");
  });

  it("rejects MCP tokens that no longer resolve to a user", async () => {
    currentSession = buildMcpSession("missing-user", ["tasks.read"]);

    const response = await request(app)
      .post("/mcp")
      .set("Authorization", "Bearer orphaned-token")
      .send({
        jsonrpc: "2.0",
        id: 3,
        method: "ping",
      })
      .expect(401);

    expect(response.body.error.data.code).toBe("MCP_INVALID_SESSION");
  });

  it("lists only tools allowed by the current scopes and exposes auth metadata", async () => {
    currentSession = buildMcpSession("user-1", ["projects.read", "tasks.read"]);

    const response = await request(app)
      .post("/mcp")
      .set("Authorization", "Bearer scoped-token")
      .send({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/list",
      })
      .expect(200);

    const toolNames = response.body.result.tools.map(
      (tool: { name: string }) => tool.name,
    );
    expect(toolNames).toContain("list_tasks");
    expect(toolNames).toContain("list_projects");
    expect(toolNames).toEqual(
      expect.arrayContaining([
        "plan_project",
        "ensure_next_action",
        "weekly_review",
        "decide_next_work",
        "analyze_project_health",
        "analyze_work_graph",
      ]),
    );
    expect(toolNames).not.toContain("create_task");
    expect(toolNames).not.toContain("create_project");

    const listTasksTool = response.body.result.tools.find(
      (tool: { name: string }) => tool.name === "list_tasks",
    );
    expect(listTasksTool.auth).toEqual({
      required: true,
      requiredScopes: ["tasks.read"],
      readOnly: true,
      errors: [
        "MCP_UNAUTHENTICATED",
        "MCP_INVALID_TOKEN",
        "MCP_AUTH_EXPIRED",
        "MCP_INSUFFICIENT_SCOPE",
        "RESOURCE_NOT_FOUND_OR_FORBIDDEN",
      ],
    });

    const ensureNextActionTool = response.body.result.tools.find(
      (tool: { name: string }) => tool.name === "ensure_next_action",
    );
    expect(ensureNextActionTool.auth.requiredScopes).toEqual([
      "projects.read",
      "tasks.read",
    ]);
    expect(ensureNextActionTool.auth.modeScopedRequiredScopes).toEqual({
      suggest: ["projects.read", "tasks.read"],
      apply: ["projects.read", "tasks.read", "tasks.write"],
    });
    expect(ensureNextActionTool.auth.defaultMode).toBe("suggest");
  });

  it("exposes the new project-management tools when write scopes are granted", async () => {
    currentSession = buildMcpSession("user-1", [
      "projects.read",
      "projects.write",
      "tasks.read",
      "tasks.write",
    ]);

    const response = await request(app)
      .post("/mcp")
      .set("Authorization", "Bearer write-token")
      .send({
        jsonrpc: "2.0",
        id: 4.1,
        method: "tools/list",
      })
      .expect(200);

    const toolNames = response.body.result.tools.map(
      (tool: { name: string }) => tool.name,
    );
    expect(toolNames).toEqual(
      expect.arrayContaining([
        "update_project",
        "delete_project",
        "move_task_to_project",
        "archive_project",
      ]),
    );

    const deleteProjectTool = response.body.result.tools.find(
      (tool: { name: string }) => tool.name === "delete_project",
    );
    expect(deleteProjectTool.annotations.destructiveHint).toBe(true);
    expect(deleteProjectTool.auth.requiredScopes).toEqual(["projects.write"]);
  });

  it("exposes the expanded task, subtask, and review tools when scopes allow them", async () => {
    currentSession = buildMcpSession("user-1", [
      "projects.read",
      "projects.write",
      "tasks.read",
      "tasks.write",
    ]);

    const response = await request(app)
      .post("/mcp")
      .set("Authorization", "Bearer expanded-scope-token")
      .send({
        jsonrpc: "2.0",
        id: 4.2,
        method: "tools/list",
      })
      .expect(200);

    const toolNames = response.body.result.tools.map(
      (tool: { name: string }) => tool.name,
    );

    expect(toolNames).toEqual(
      expect.arrayContaining([
        "archive_task",
        "delete_task",
        "add_subtask",
        "update_subtask",
        "delete_subtask",
        "list_today",
        "list_next_actions",
        "list_waiting_on",
        "list_upcoming",
        "list_stale_tasks",
        "list_projects_without_next_action",
        "review_projects",
        "plan_project",
        "ensure_next_action",
        "weekly_review",
        "decide_next_work",
        "analyze_project_health",
        "analyze_work_graph",
        "rename_project",
      ]),
    );

    const createProjectTool = response.body.result.tools.find(
      (tool: { name: string }) => tool.name === "create_project",
    );
    expect(createProjectTool.inputSchema.properties.idempotencyKey).toEqual(
      expect.objectContaining({
        type: "string",
      }),
    );

    const ensureNextActionTool = response.body.result.tools.find(
      (tool: { name: string }) => tool.name === "ensure_next_action",
    );
    expect(ensureNextActionTool.auth.requiredScopes).toEqual([
      "projects.read",
      "tasks.read",
    ]);
    expect(ensureNextActionTool.auth.modeScopedRequiredScopes).toEqual({
      suggest: ["projects.read", "tasks.read"],
      apply: ["projects.read", "tasks.read", "tasks.write"],
    });
    expect(ensureNextActionTool.inputSchema.properties.idempotencyKey).toEqual(
      expect.objectContaining({
        type: "string",
      }),
    );
    expect(ensureNextActionTool.annotations.idempotentHint).toBe(true);

    const decideNextWorkTool = response.body.result.tools.find(
      (tool: { name: string }) => tool.name === "decide_next_work",
    );
    expect(decideNextWorkTool.auth.requiredScopes).toEqual([
      "projects.read",
      "tasks.read",
    ]);
  });

  it("rejects write tools when write scope is missing", async () => {
    currentSession = buildMcpSession("user-1", ["tasks.read"]);

    const response = await request(app)
      .post("/mcp")
      .set("Authorization", "Bearer readonly-token")
      .send({
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: {
          name: "create_task",
          arguments: { title: "Blocked write" },
        },
      })
      .expect(200);

    expect(response.body.result.isError).toBe(true);
    expect(response.body.result.structuredContent.error.code).toBe(
      "MCP_INSUFFICIENT_SCOPE",
    );
    expect(
      response.body.result.structuredContent.error.details.requiredScopes,
    ).toEqual(["tasks.write"]);
  });

  it("allows planner suggest calls with read-only scopes", async () => {
    currentSession = buildMcpSession("user-1", ["projects.read", "tasks.read"]);
    projectService.findById.mockResolvedValue({
      id: "00000000-0000-1000-8000-000000000091",
      name: "Planner",
      goal: "Ship planner docs",
      status: "active",
      archived: false,
      userId: "user-1",
      createdAt: new Date(),
      updatedAt: new Date(),
      todoCount: 0,
      openTodoCount: 0,
    } as Project);
    projectService.findAll.mockResolvedValue([
      {
        id: "00000000-0000-1000-8000-000000000091",
        name: "Planner",
        goal: "Ship planner docs",
        status: "active",
        archived: false,
        userId: "user-1",
        createdAt: new Date(),
        updatedAt: new Date(),
        todoCount: 0,
        openTodoCount: 0,
      } as Project,
    ]);

    const planResponse = await request(app)
      .post("/mcp")
      .set("Authorization", "Bearer planner-read-token")
      .send({
        jsonrpc: "2.0",
        id: 5.1,
        method: "tools/call",
        params: {
          name: "plan_project",
          arguments: {
            projectId: "00000000-0000-1000-8000-000000000091",
            mode: "suggest",
          },
        },
      })
      .expect(200);

    const ensureResponse = await request(app)
      .post("/mcp")
      .set("Authorization", "Bearer planner-read-token")
      .send({
        jsonrpc: "2.0",
        id: 5.2,
        method: "tools/call",
        params: {
          name: "ensure_next_action",
          arguments: {
            projectId: "00000000-0000-1000-8000-000000000091",
            mode: "suggest",
          },
        },
      })
      .expect(200);

    const reviewResponse = await request(app)
      .post("/mcp")
      .set("Authorization", "Bearer planner-read-token")
      .send({
        jsonrpc: "2.0",
        id: 5.3,
        method: "tools/call",
        params: {
          name: "weekly_review",
          arguments: {
            mode: "suggest",
          },
        },
      })
      .expect(200);

    expect(planResponse.body.result.isError).toBeUndefined();
    expect(
      planResponse.body.result.structuredContent.data.plan.suggestedTasks
        .length,
    ).toBeGreaterThan(0);
    expect(ensureResponse.body.result.isError).toBeUndefined();
    expect(
      ensureResponse.body.result.structuredContent.data.result.created,
    ).toBe(false);
    expect(reviewResponse.body.result.isError).toBeUndefined();
    expect(
      reviewResponse.body.result.structuredContent.data.review.summary,
    ).toBeDefined();
  });

  it("rejects planner apply calls when write scope is missing", async () => {
    currentSession = buildMcpSession("user-1", ["projects.read", "tasks.read"]);
    projectService.findById.mockResolvedValue({
      id: "00000000-0000-1000-8000-000000000092",
      name: "Planner",
      status: "active",
      archived: false,
      userId: "user-1",
      createdAt: new Date(),
      updatedAt: new Date(),
      todoCount: 0,
      openTodoCount: 0,
    } as Project);

    const response = await request(app)
      .post("/mcp")
      .set("Authorization", "Bearer planner-readonly-token")
      .send({
        jsonrpc: "2.0",
        id: 5.4,
        method: "tools/call",
        params: {
          name: "ensure_next_action",
          arguments: {
            projectId: "00000000-0000-1000-8000-000000000092",
            mode: "apply",
          },
        },
      })
      .expect(200);

    expect(response.body.result.isError).toBe(true);
    expect(response.body.result.structuredContent.error.code).toBe(
      "MCP_INSUFFICIENT_SCOPE",
    );
    expect(
      response.body.result.structuredContent.error.details.requiredScopes,
    ).toEqual(["projects.read", "tasks.read", "tasks.write"]);
  });

  it("blocks cross-user task access through the MCP surface", async () => {
    const todo = await todoService.create("user-1", {
      title: "User 1 private task",
    });
    currentSession = buildMcpSession("user-2", ["tasks.read"]);

    const response = await request(app)
      .post("/mcp")
      .set("Authorization", "Bearer user-2-token")
      .send({
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: {
          name: "get_task",
          arguments: { id: todo.id },
        },
      })
      .expect(200);

    expect(response.body.result.isError).toBe(true);
    expect(response.body.result.structuredContent.error.code).toBe(
      "RESOURCE_NOT_FOUND_OR_FORBIDDEN",
    );
  });

  it("reuses the internal agent layer for create_task with idempotency and audit logging", async () => {
    currentSession = buildMcpSession("user-1", ["tasks.read", "tasks.write"]);
    const logSpy = jest.spyOn(console, "info").mockImplementation(() => {});

    const firstResponse = await request(app)
      .post("/mcp")
      .set("Authorization", "Bearer mcp-token-1")
      .send({
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: {
          name: "create_task",
          arguments: {
            title: "MCP task",
            idempotencyKey: "mcp-create-task-1",
          },
        },
      })
      .expect(200);

    const replayResponse = await request(app)
      .post("/mcp")
      .set("Authorization", "Bearer mcp-token-1")
      .send({
        jsonrpc: "2.0",
        id: 8,
        method: "tools/call",
        params: {
          name: "create_task",
          arguments: {
            title: "MCP task",
            idempotencyKey: "mcp-create-task-1",
          },
        },
      })
      .expect(200);

    expect(
      firstResponse.body.result.structuredContent.data.task.id,
    ).toBeDefined();
    expect(replayResponse.body.result.structuredContent.data.task.id).toBe(
      firstResponse.body.result.structuredContent.data.task.id,
    );
    expect(replayResponse.body.result.structuredContent.trace.replayed).toBe(
      true,
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('"type":"assistant_mcp_call"'),
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('"authOutcome":"authenticated"'),
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('"toolName":"create_task"'),
    );

    logSpy.mockRestore();
  });

  it("replays planner apply calls through the MCP surface when idempotencyKey is reused", async () => {
    currentSession = buildMcpSession("user-1", [
      "projects.read",
      "tasks.read",
      "tasks.write",
    ]);
    projectService.findById.mockResolvedValue({
      id: "00000000-0000-1000-8000-000000000032",
      name: "Ops",
      status: "active",
      archived: false,
      userId: "user-1",
      createdAt: new Date(),
      updatedAt: new Date(),
      todoCount: 0,
      openTodoCount: 0,
    });

    const firstResponse = await request(app)
      .post("/mcp")
      .set("Authorization", "Bearer task-write-token")
      .send({
        jsonrpc: "2.0",
        id: 8.1,
        method: "tools/call",
        params: {
          name: "ensure_next_action",
          arguments: {
            projectId: "00000000-0000-1000-8000-000000000032",
            mode: "apply",
            idempotencyKey: "mcp-ensure-1",
          },
        },
      })
      .expect(200);

    const replayResponse = await request(app)
      .post("/mcp")
      .set("Authorization", "Bearer task-write-token")
      .send({
        jsonrpc: "2.0",
        id: 8.2,
        method: "tools/call",
        params: {
          name: "ensure_next_action",
          arguments: {
            projectId: "00000000-0000-1000-8000-000000000032",
            mode: "apply",
            idempotencyKey: "mcp-ensure-1",
          },
        },
      })
      .expect(200);

    expect(replayResponse.body.result.structuredContent.trace.replayed).toBe(
      true,
    );
    expect(
      replayResponse.body.result.structuredContent.data.result.task.id,
    ).toBe(firstResponse.body.result.structuredContent.data.result.task.id);
  });

  it("moves a task to a project through the MCP surface", async () => {
    currentSession = buildMcpSession("user-1", ["tasks.read", "tasks.write"]);
    const task = await todoService.create("user-1", {
      title: "Move via MCP",
    });
    projectService.findById.mockResolvedValue({
      id: "00000000-0000-1000-8000-000000000031",
      name: "Ops",
      status: "active",
      archived: false,
      userId: "user-1",
      createdAt: new Date(),
      updatedAt: new Date(),
      todoCount: 1,
      openTodoCount: 1,
    });

    const response = await request(app)
      .post("/mcp")
      .set("Authorization", "Bearer task-write-token")
      .send({
        jsonrpc: "2.0",
        id: 9,
        method: "tools/call",
        params: {
          name: "move_task_to_project",
          arguments: {
            taskId: task.id,
            projectId: "00000000-0000-1000-8000-000000000031",
          },
        },
      })
      .expect(200);

    expect(response.body.result.isError).toBeUndefined();
    expect(response.body.result.structuredContent.data.task.category).toBe(
      "Ops",
    );
  });

  it("creates a next action through the planner MCP tool", async () => {
    currentSession = buildMcpSession("user-1", [
      "projects.read",
      "tasks.read",
      "tasks.write",
    ]);
    projectService.findById.mockResolvedValue({
      id: "00000000-0000-1000-8000-000000000051",
      name: "Ops",
      status: "active",
      archived: false,
      userId: "user-1",
      createdAt: new Date(),
      updatedAt: new Date(),
      todoCount: 0,
      openTodoCount: 0,
    });

    const response = await request(app)
      .post("/mcp")
      .set("Authorization", "Bearer planner-token")
      .send({
        jsonrpc: "2.0",
        id: 10,
        method: "tools/call",
        params: {
          name: "ensure_next_action",
          arguments: {
            projectId: "00000000-0000-1000-8000-000000000051",
            mode: "apply",
          },
        },
      })
      .expect(200);

    expect(response.body.result.isError).toBeUndefined();
    expect(response.body.result.structuredContent.data.result.created).toBe(
      true,
    );
    expect(response.body.result.structuredContent.data.result.task.status).toBe(
      "next",
    );
  });

  it("analyzes the work graph through the planner MCP tools", async () => {
    currentSession = buildMcpSession("user-1", ["projects.read", "tasks.read"]);
    projectService.findById.mockResolvedValue({
      id: "00000000-0000-1000-8000-000000000052",
      name: "Launch",
      status: "active",
      archived: false,
      userId: "user-1",
      createdAt: new Date(),
      updatedAt: new Date(),
      todoCount: 0,
      openTodoCount: 0,
    });

    const foundation = await todoService.create("user-1", {
      title: "Define rollout scope",
      projectId: "00000000-0000-1000-8000-000000000052",
      category: "Launch",
      status: "next",
    });
    await todoService.create("user-1", {
      title: "Approve launch checklist",
      projectId: "00000000-0000-1000-8000-000000000052",
      category: "Launch",
      status: "next",
      dependsOnTaskIds: [foundation.id],
    });

    const response = await request(app)
      .post("/mcp")
      .set("Authorization", "Bearer planner-read-token")
      .send({
        jsonrpc: "2.0",
        id: 11,
        method: "tools/call",
        params: {
          name: "analyze_work_graph",
          arguments: {
            projectId: "00000000-0000-1000-8000-000000000052",
          },
        },
      })
      .expect(200);

    expect(response.body.result.isError).toBeUndefined();
    expect(
      response.body.result.structuredContent.data.graph.blockedTasks,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "Approve launch checklist",
        }),
      ]),
    );
  });
});
