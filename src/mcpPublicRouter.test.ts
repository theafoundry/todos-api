import { createHash } from "crypto";
import request from "supertest";
import type { Express } from "express";

// Override config before createApp imports it — disable social login
// providers so MCP OAuth pages don't render Google/Apple/Phone buttons.
jest.mock("./config", () => {
  const actual = jest.requireActual<typeof import("./config")>("./config");
  return {
    ...actual,
    config: {
      ...actual.config,
      googleLoginEnabled: false,
      appleLoginEnabled: false,
      phoneLoginEnabled: false,
    },
  };
});

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

function buildMcpSession(userId: string, scopes: McpScope[]) {
  return {
    userId,
    email: `${userId}@example.com`,
    tokenType: "mcp" as const,
    scopes,
    assistantName: "ChatGPT",
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

describe("Public MCP OAuth and discovery routes", () => {
  let app: Express;
  let currentSession: ReturnType<typeof buildMcpSession>;
  let mockAuthService: {
    login: jest.Mock;
    verifyToken: jest.Mock;
    createMcpToken: jest.Mock;
    verifyMcpToken: jest.Mock;
    decodeMcpToken: jest.Mock;
    revokeAllMcpTokensForUser: jest.Mock;
    getUserById: jest.Mock;
  };

  beforeEach(() => {
    currentSession = buildMcpSession("user-1", ["tasks.read"]);
    mockAuthService = {
      login: jest.fn().mockResolvedValue({
        user: {
          id: "user-1",
          email: "user-1@example.com",
          name: "User One",
        },
        token: "app-session-token",
      }),
      verifyToken: jest.fn().mockReturnValue({
        userId: "user-1",
        email: "user-1@example.com",
      }),
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
      decodeMcpToken: jest.fn().mockImplementation(() => ({
        ...currentSession,
        issuedAt: Math.floor(Date.now() / 1000),
      })),
      revokeAllMcpTokensForUser: jest
        .fn()
        .mockResolvedValue("2026-03-12T00:00:00.000Z"),
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
      todoService: new TodoService(),
      authService: mockAuthService as any,
      projectService: createProjectServiceMock(),
    });
  });

  it("publishes OAuth authorization server metadata for remote connectors", async () => {
    const response = await request(app)
      .get("/.well-known/oauth-authorization-server")
      .expect(200);

    expect(response.body.authorization_endpoint).toMatch(/\/oauth\/authorize$/);
    expect(response.body.token_endpoint).toMatch(/\/oauth\/token$/);
    expect(response.body.revocation_endpoint).toMatch(/\/oauth\/revoke$/);
    expect(response.body.registration_endpoint).toMatch(/\/oauth\/register$/);
    expect(response.body.code_challenge_methods_supported).toContain("S256");
    expect(response.body.scopes_supported).toEqual(
      expect.arrayContaining(["openid", "email", "tasks.read"]),
    );
  });

  it("publishes OIDC discovery with the verified-email UserInfo contract", async () => {
    const response = await request(app)
      .get("/.well-known/openid-configuration")
      .expect(200);

    expect(response.body).toMatchObject({
      issuer: "http://localhost:3000",
      authorization_endpoint: "http://localhost:3000/oauth/authorize",
      token_endpoint: "http://localhost:3000/oauth/token",
      userinfo_endpoint: "http://localhost:3000/oauth/userinfo",
      scopes_supported: expect.arrayContaining([
        "openid",
        "email",
        "tasks.read",
      ]),
      claims_supported: ["sub", "email", "email_verified"],
    });
  });

  it("returns verified identity claims from UserInfo", async () => {
    currentSession = {
      ...buildMcpSession("user-1", ["tasks.read"]),
      oauthScopes: ["openid", "email", "tasks.read"],
      sessionId: "session-1",
      resource: "http://localhost:3000/mcp/app",
    } as any;

    const response = await request(app)
      .get("/oauth/userinfo")
      .set("Authorization", "Bearer mcp-token-user-1")
      .expect(200);

    expect(response.body).toEqual({
      sub: "user-1",
      email: "user-1@example.com",
      email_verified: true,
    });
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(mockAuthService.verifyMcpToken).toHaveBeenCalledWith(
      "mcp-token-user-1",
      {
        resource: "http://localhost:3000/mcp/app",
        requireResource: true,
      },
    );
  });

  it("supports POST at the UserInfo endpoint", async () => {
    currentSession = {
      ...buildMcpSession("user-1", []),
      oauthScopes: ["openid", "email"],
      resource: "http://localhost:3000/mcp/app",
    } as any;

    const response = await request(app)
      .post("/oauth/userinfo")
      .set("Authorization", "Bearer mcp-token-user-1")
      .expect(200);

    expect(response.body).toMatchObject({
      sub: "user-1",
      email_verified: true,
    });
  });

  it("rejects UserInfo tokens without both identity scopes", async () => {
    currentSession = {
      ...buildMcpSession("user-1", ["tasks.read"]),
      oauthScopes: ["openid", "tasks.read"],
    } as any;

    const response = await request(app)
      .get("/oauth/userinfo")
      .set("Authorization", "Bearer mcp-token-user-1")
      .expect(403);

    expect(response.body.error).toBe("insufficient_scope");
    expect(response.headers["www-authenticate"]).toContain(
      'scope="openid email"',
    );
  });

  it("rejects UserInfo when the current account email is not verified", async () => {
    currentSession = {
      ...buildMcpSession("user-1", []),
      oauthScopes: ["openid", "email"],
    } as any;
    mockAuthService.getUserById.mockResolvedValueOnce({
      id: "user-1",
      email: "user-1@example.com",
      name: "User One",
      isVerified: false,
      role: "user",
      plan: "free",
    });

    const response = await request(app)
      .get("/oauth/userinfo")
      .set("Authorization", "Bearer mcp-token-user-1")
      .expect(401);

    expect(response.body.error).toBe("invalid_token");
    expect(response.body).not.toHaveProperty("email");
  });

  it("rejects missing and invalid UserInfo bearer tokens", async () => {
    const missing = await request(app).get("/oauth/userinfo").expect(401);
    expect(missing.body.error).toBe("invalid_token");

    mockAuthService.verifyMcpToken.mockRejectedValueOnce(
      new Error("Invalid MCP token"),
    );
    const invalid = await request(app)
      .get("/oauth/userinfo")
      .set("Authorization", "Bearer invalid-token")
      .expect(401);
    expect(invalid.body.error).toBe("invalid_token");
  });

  it("registers a public PKCE client for connector use", async () => {
    const response = await request(app)
      .post("/oauth/register")
      .send({
        redirect_uris: ["https://chat.openai.com/aip/callback"],
        client_name: "ChatGPT",
        grant_types: ["authorization_code"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      })
      .expect(201);

    expect(response.body.client_id).toEqual(expect.any(String));
    expect(response.body.redirect_uris).toEqual([
      "https://chat.openai.com/aip/callback",
    ]);
    expect(response.body.grant_types).toEqual(["authorization_code"]);
    expect(response.body.token_endpoint_auth_method).toBe("none");
  });

  it("accepts public clients that request refresh-token grant metadata", async () => {
    const response = await request(app)
      .post("/oauth/register")
      .send({
        redirect_uris: ["https://chat.openai.com/aip/callback"],
        client_name: "Codex",
        grant_types: ["refresh_token", "authorization_code"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      })
      .expect(201);

    expect(response.body.client_id).toEqual(expect.any(String));
    expect(response.body.grant_types).toEqual([
      "authorization_code",
      "refresh_token",
    ]);
    expect(response.body.response_types).toEqual(["code"]);
  });

  it("rejects unsupported OAuth client grant types during registration", async () => {
    const response = await request(app)
      .post("/oauth/register")
      .send({
        redirect_uris: ["https://chat.openai.com/aip/callback"],
        grant_types: ["authorization_code", "client_credentials"],
      })
      .expect(400);

    expect(response.body.error).toBe("invalid_client_metadata");
    expect(response.body.error_description).toContain(
      '"authorization_code" and optional "refresh_token"',
    );
    expect(response.body.error_details.code).toBe(
      "MCP_OAUTH_AUTHORIZE_INVALID",
    );
  });

  it("completes the browser-style OAuth code flow for a registered connector", async () => {
    const register = await request(app)
      .post("/oauth/register")
      .send({
        redirect_uris: ["https://chat.openai.com/aip/callback"],
        client_name: "ChatGPT",
        grant_types: ["authorization_code", "refresh_token"],
      })
      .expect(201);

    const pkce = createPkcePair(
      "oauth-verifier-public-flow-1111111111111111111111111111111",
    );
    const scope = "tasks.read tasks.write";
    const state = `openai_platform_oauth_relay__${"a".repeat(512)}`;
    const agent = request.agent(app);

    const authorizeUrl = `/oauth/authorize?client_id=${encodeURIComponent(
      register.body.client_id,
    )}&redirect_uri=${encodeURIComponent(
      "https://chat.openai.com/aip/callback",
    )}&response_type=code&scope=${encodeURIComponent(
      scope,
    )}&state=${encodeURIComponent(state)}&code_challenge=${encodeURIComponent(
      pkce.challenge,
    )}&code_challenge_method=S256`;

    const loginPage = await agent.get(authorizeUrl).expect(200);
    expect(loginPage.text).toContain("Connect Assistant");
    expect(loginPage.headers["content-security-policy"]).toContain(
      "form-action 'self' http://localhost:3000",
    );
    expect(loginPage.text).toContain(
      'action="http://localhost:3000/oauth/authorize/login"',
    );

    const login = await agent
      .post("/oauth/authorize/login")
      .type("form")
      .send({
        email: "user-1@example.com",
        password: "password123",
        client_id: register.body.client_id,
        redirect_uri: "https://chat.openai.com/aip/callback",
        response_type: "code",
        scope,
        state,
        code_challenge: pkce.challenge,
        code_challenge_method: "S256",
      })
      .expect(303);

    expect(login.headers.location).toContain("/oauth/authorize?");

    const consent = await agent.get(login.headers.location).expect(200);
    expect(consent.text).toContain("Authorize Assistant");
    expect(consent.text).toContain("tasks.read");
    expect(consent.text).toContain("tasks.write");
    expect(consent.headers["content-security-policy"]).toContain(
      "form-action 'self' http://localhost:3000",
    );
    expect(consent.text).toContain(
      'action="http://localhost:3000/oauth/authorize/decision"',
    );

    const approve = await agent
      .post("/oauth/authorize/decision")
      .type("form")
      .send({
        decision: "approve",
        client_id: register.body.client_id,
        redirect_uri: "https://chat.openai.com/aip/callback",
        response_type: "code",
        scope,
        state,
        code_challenge: pkce.challenge,
        code_challenge_method: "S256",
      })
      .expect(303);
    expect(approve.headers["content-security-policy"]).toContain(
      "form-action 'self' http://localhost:3000",
    );
    expect(approve.headers["content-security-policy"]).toContain(
      "script-src 'nonce-",
    );

    const redirectUrl = new URL(approve.headers.location);
    const code = redirectUrl.searchParams.get("code");
    expect(redirectUrl.origin + redirectUrl.pathname).toBe(
      "https://chat.openai.com/aip/callback",
    );
    expect(redirectUrl.searchParams.get("state")).toBe(state);
    expect(code).toEqual(expect.any(String));

    const token = await request(app)
      .post("/oauth/token")
      .type("form")
      .send({
        grant_type: "authorization_code",
        code,
        client_id: register.body.client_id,
        redirect_uri: "https://chat.openai.com/aip/callback",
        code_verifier: pkce.verifier,
      })
      .expect(200);

    expect(token.body.access_token).toBe("mcp-token-user-1");
    expect(token.body.token_type).toBe("Bearer");
    expect(token.body.scope).toBe("tasks.read tasks.write");
    expect(token.body.session_id).toEqual(expect.any(String));
    expect(token.body.refresh_token).toEqual(expect.any(String));
    expect(token.body.refresh_token_expires_at).toEqual(expect.any(String));
    expect(token.body.refresh_token_expires_in).toBe(2592000);
  });

  it("preserves state and creates no authorization code when consent is cancelled", async () => {
    const register = await request(app)
      .post("/oauth/register")
      .send({
        redirect_uris: ["https://chat.openai.com/aip/callback"],
        client_name: "ChatGPT",
      })
      .expect(201);
    const pkce = createPkcePair(
      "oauth-verifier-cancel-flow-1111111111111111111111111111111",
    );
    const agent = request.agent(app);
    const authorizeUrl = `/oauth/authorize?client_id=${encodeURIComponent(
      register.body.client_id,
    )}&redirect_uri=${encodeURIComponent(
      "https://chat.openai.com/aip/callback",
    )}&response_type=code&scope=tasks.read&state=cancel-state&code_challenge=${encodeURIComponent(
      pkce.challenge,
    )}&code_challenge_method=S256`;

    await agent.get(authorizeUrl).expect(200);
    const login = await agent
      .post("/oauth/authorize/login")
      .type("form")
      .send({
        email: "user-1@example.com",
        password: "password123",
        client_id: register.body.client_id,
        redirect_uri: "https://chat.openai.com/aip/callback",
        response_type: "code",
        scope: "tasks.read",
        state: "cancel-state",
        code_challenge: pkce.challenge,
        code_challenge_method: "S256",
      })
      .expect(303);
    await agent.get(login.headers.location).expect(200);

    const cancelled = await agent
      .post("/oauth/authorize/decision")
      .type("form")
      .send({
        decision: "deny",
        client_id: register.body.client_id,
        redirect_uri: "https://chat.openai.com/aip/callback",
        response_type: "code",
        scope: "tasks.read",
        state: "cancel-state",
        code_challenge: pkce.challenge,
        code_challenge_method: "S256",
      })
      .expect(303);

    const redirect = new URL(cancelled.headers.location);
    expect(redirect.searchParams.get("error")).toBe("access_denied");
    expect(redirect.searchParams.get("state")).toBe("cancel-state");
    expect(redirect.searchParams.has("code")).toBe(false);
  });

  it("preserves OIDC identity scopes through code exchange and refresh rotation", async () => {
    const register = await request(app)
      .post("/oauth/register")
      .send({
        redirect_uris: ["https://chat.openai.com/aip/callback"],
        client_name: "ChatGPT",
        grant_types: ["authorization_code", "refresh_token"],
      })
      .expect(201);
    const pkce = createPkcePair(
      "oauth-verifier-oidc-flow-11111111111111111111111111111111",
    );
    const scope = "openid email tasks.read";
    const resource = "http://localhost:3000/mcp/app";
    const agent = request.agent(app);

    const authorizeUrl = `/oauth/authorize?client_id=${encodeURIComponent(
      register.body.client_id,
    )}&redirect_uri=${encodeURIComponent(
      "https://chat.openai.com/aip/callback",
    )}&response_type=code&scope=${encodeURIComponent(
      scope,
    )}&code_challenge=${encodeURIComponent(
      pkce.challenge,
    )}&code_challenge_method=S256&resource=${encodeURIComponent(resource)}`;

    await agent.get(authorizeUrl).expect(200);
    const login = await agent
      .post("/oauth/authorize/login")
      .type("form")
      .send({
        email: "user-1@example.com",
        password: "password123",
        client_id: register.body.client_id,
        redirect_uri: "https://chat.openai.com/aip/callback",
        response_type: "code",
        scope,
        code_challenge: pkce.challenge,
        code_challenge_method: "S256",
        resource,
      })
      .expect(303);
    await agent.get(login.headers.location).expect(200);
    const approve = await agent
      .post("/oauth/authorize/decision")
      .type("form")
      .send({
        decision: "approve",
        client_id: register.body.client_id,
        redirect_uri: "https://chat.openai.com/aip/callback",
        response_type: "code",
        scope,
        code_challenge: pkce.challenge,
        code_challenge_method: "S256",
        resource,
      })
      .expect(303);

    const code = new URL(approve.headers.location).searchParams.get("code");
    const token = await request(app)
      .post("/oauth/token")
      .type("form")
      .send({
        grant_type: "authorization_code",
        code,
        client_id: register.body.client_id,
        redirect_uri: "https://chat.openai.com/aip/callback",
        code_verifier: pkce.verifier,
        resource,
      })
      .expect(200);

    expect(token.body.scope).toBe("email openid tasks.read");
    expect(mockAuthService.createMcpToken).toHaveBeenLastCalledWith(
      expect.objectContaining({
        scopes: ["email", "openid", "tasks.read"],
        resource,
      }),
    );

    const refreshed = await request(app)
      .post("/oauth/token")
      .type("form")
      .send({
        grant_type: "refresh_token",
        refresh_token: token.body.refresh_token,
        client_id: register.body.client_id,
        resource,
      })
      .expect(200);

    expect(refreshed.body.scope).toBe("email openid tasks.read");
    expect(mockAuthService.createMcpToken).toHaveBeenLastCalledWith(
      expect.objectContaining({
        scopes: ["email", "openid", "tasks.read"],
        resource,
      }),
    );
  });

  it("does not let identity-only scopes authorize native Todos tools", async () => {
    currentSession = {
      ...buildMcpSession("user-1", []),
      oauthScopes: ["openid", "email"],
      resource: "http://localhost:3000/mcp/app",
    } as any;

    const response = await request(app)
      .post("/mcp/app")
      .set("Accept", "application/json, text/event-stream")
      .set("Content-Type", "application/json")
      .set("Authorization", "Bearer mcp-token-user-1")
      .send({
        jsonrpc: "2.0",
        id: 91,
        method: "tools/call",
        params: { name: "list_today", arguments: {} },
      })
      .expect(200);

    const body =
      response.body && Object.keys(response.body).length > 0
        ? response.body
        : JSON.parse(
            response.text
              .split("\n")
              .find((line) => line.startsWith("data: "))!
              .slice("data: ".length),
          );
    expect(body.result.isError).toBe(true);
    expect(body.result.structuredContent.error.code).toBe(
      "MCP_INSUFFICIENT_SCOPE",
    );
  });

  it("rejects the email identity scope without openid", async () => {
    const register = await request(app)
      .post("/oauth/register")
      .send({
        redirect_uris: ["https://chat.openai.com/aip/callback"],
        client_name: "ChatGPT",
      })
      .expect(201);
    const pkce = createPkcePair(
      "oauth-verifier-email-without-openid-1111111111111111111111",
    );

    const response = await request(app)
      .get("/oauth/authorize")
      .query({
        client_id: register.body.client_id,
        redirect_uri: "https://chat.openai.com/aip/callback",
        response_type: "code",
        scope: "email tasks.read",
        code_challenge: pkce.challenge,
        code_challenge_method: "S256",
      })
      .expect(400);

    expect(response.text).toContain("scope &quot;email&quot; requires scope");
  });

  it("preserves the native resource binding after a failed OAuth login", async () => {
    const register = await request(app)
      .post("/oauth/register")
      .send({
        redirect_uris: ["https://chat.openai.com/aip/callback"],
        client_name: "ChatGPT",
      })
      .expect(201);
    const pkce = createPkcePair(
      "oauth-verifier-native-resource-11111111111111111111111111",
    );
    const resource = "http://localhost:3000/mcp/app";
    mockAuthService.login.mockRejectedValueOnce(
      new Error("Invalid credentials"),
    );

    const response = await request(app)
      .post("/oauth/authorize/login")
      .type("form")
      .send({
        email: "user-1@example.com",
        password: "incorrect-password",
        client_id: register.body.client_id,
        redirect_uri: "https://chat.openai.com/aip/callback",
        response_type: "code",
        scope: "tasks.read projects.read",
        state: "state-native-resource",
        code_challenge: pkce.challenge,
        code_challenge_method: "S256",
        resource,
      })
      .expect(401);

    expect(response.text).toContain('name="resource"');
    expect(response.text).toContain(`value="${resource}"`);
  });

  it("defaults authorize scopes when the connector omits scope", async () => {
    const register = await request(app)
      .post("/oauth/register")
      .send({
        redirect_uris: ["https://chat.openai.com/aip/callback"],
        client_name: "Codex",
      })
      .expect(201);

    const pkce = createPkcePair(
      "oauth-verifier-default-scope-1111111111111111111111111111",
    );
    const agent = request.agent(app);

    const authorizeUrl = `/oauth/authorize?client_id=${encodeURIComponent(
      register.body.client_id,
    )}&redirect_uri=${encodeURIComponent(
      "https://chat.openai.com/aip/callback",
    )}&response_type=code&state=state-default-scope&code_challenge=${encodeURIComponent(
      pkce.challenge,
    )}&code_challenge_method=S256`;

    const loginPage = await agent.get(authorizeUrl).expect(200);
    expect(loginPage.text).toContain("Connect Assistant");

    const login = await agent
      .post("/oauth/authorize/login")
      .type("form")
      .send({
        email: "user-1@example.com",
        password: "password123",
        client_id: register.body.client_id,
        redirect_uri: "https://chat.openai.com/aip/callback",
        response_type: "code",
        state: "state-default-scope",
        code_challenge: pkce.challenge,
        code_challenge_method: "S256",
      })
      .expect(303);

    expect(login.headers.location).toContain("/oauth/authorize?");
    expect(login.headers.location).toContain("scope=projects.read+tasks.read");

    const consent = await agent.get(login.headers.location).expect(200);
    expect(consent.text).toContain("Authorize Assistant");
    expect(consent.text).toContain("tasks.read");
    expect(consent.text).toContain("projects.read");

    const approve = await agent
      .post("/oauth/authorize/decision")
      .type("form")
      .send({
        decision: "approve",
        client_id: register.body.client_id,
        redirect_uri: "https://chat.openai.com/aip/callback",
        response_type: "code",
        state: "state-default-scope",
        code_challenge: pkce.challenge,
        code_challenge_method: "S256",
      })
      .expect(303);

    const redirectUrl = new URL(approve.headers.location);
    const code = redirectUrl.searchParams.get("code");
    expect(code).toEqual(expect.any(String));

    const token = await request(app)
      .post("/oauth/token")
      .type("form")
      .send({
        grant_type: "authorization_code",
        code,
        client_id: register.body.client_id,
        redirect_uri: "https://chat.openai.com/aip/callback",
        code_verifier: pkce.verifier,
      })
      .expect(200);

    expect(token.body.scope).toBe("projects.read tasks.read");
    expect(token.body.session_id).toEqual(expect.any(String));
  });

  it("rotates refresh tokens through the public OAuth token endpoint", async () => {
    const register = await request(app)
      .post("/oauth/register")
      .send({
        redirect_uris: ["https://chat.openai.com/aip/callback"],
        client_name: "Codex",
        grant_types: ["authorization_code", "refresh_token"],
      })
      .expect(201);

    const pkce = createPkcePair(
      "oauth-verifier-public-refresh-1111111111111111111111111111",
    );
    const agent = request.agent(app);

    const authorizeUrl = `/oauth/authorize?client_id=${encodeURIComponent(
      register.body.client_id,
    )}&redirect_uri=${encodeURIComponent(
      "https://chat.openai.com/aip/callback",
    )}&response_type=code&scope=${encodeURIComponent(
      "tasks.read tasks.write",
    )}&code_challenge=${encodeURIComponent(
      pkce.challenge,
    )}&code_challenge_method=S256`;

    await agent.get(authorizeUrl).expect(200);
    const login = await agent
      .post("/oauth/authorize/login")
      .type("form")
      .send({
        email: "user-1@example.com",
        password: "password123",
        client_id: register.body.client_id,
        redirect_uri: "https://chat.openai.com/aip/callback",
        response_type: "code",
        scope: "tasks.read tasks.write",
        code_challenge: pkce.challenge,
        code_challenge_method: "S256",
      })
      .expect(303);
    await agent.get(login.headers.location).expect(200);
    const approve = await agent
      .post("/oauth/authorize/decision")
      .type("form")
      .send({
        decision: "approve",
        client_id: register.body.client_id,
        redirect_uri: "https://chat.openai.com/aip/callback",
        response_type: "code",
        scope: "tasks.read tasks.write",
        code_challenge: pkce.challenge,
        code_challenge_method: "S256",
      })
      .expect(303);

    const code = new URL(approve.headers.location).searchParams.get("code");

    const token = await request(app)
      .post("/oauth/token")
      .type("form")
      .send({
        grant_type: "authorization_code",
        code,
        client_id: register.body.client_id,
        redirect_uri: "https://chat.openai.com/aip/callback",
        code_verifier: pkce.verifier,
      })
      .expect(200);

    const refreshed = await request(app)
      .post("/oauth/token")
      .type("form")
      .send({
        grant_type: "refresh_token",
        refresh_token: token.body.refresh_token,
        client_id: register.body.client_id,
      })
      .expect(200);

    expect(refreshed.body.access_token).toBe("mcp-token-user-1");
    expect(refreshed.body.session_id).toEqual(expect.any(String));
    expect(refreshed.body.refresh_token).toEqual(expect.any(String));
    expect(refreshed.body.refresh_token).not.toBe(token.body.refresh_token);
  });

  it("accepts OAuth revoke requests for issued refresh tokens", async () => {
    const register = await request(app)
      .post("/oauth/register")
      .send({
        redirect_uris: ["https://chat.openai.com/aip/callback"],
        client_name: "ChatGPT",
        grant_types: ["authorization_code", "refresh_token"],
      })
      .expect(201);

    const pkce = createPkcePair(
      "oauth-verifier-public-revoke-11111111111111111111111111111",
    );
    const agent = request.agent(app);

    const authorizeUrl = `/oauth/authorize?client_id=${encodeURIComponent(
      register.body.client_id,
    )}&redirect_uri=${encodeURIComponent(
      "https://chat.openai.com/aip/callback",
    )}&response_type=code&scope=${encodeURIComponent(
      "tasks.read",
    )}&code_challenge=${encodeURIComponent(
      pkce.challenge,
    )}&code_challenge_method=S256`;

    await agent.get(authorizeUrl).expect(200);
    const login = await agent
      .post("/oauth/authorize/login")
      .type("form")
      .send({
        email: "user-1@example.com",
        password: "password123",
        client_id: register.body.client_id,
        redirect_uri: "https://chat.openai.com/aip/callback",
        response_type: "code",
        scope: "tasks.read",
        code_challenge: pkce.challenge,
        code_challenge_method: "S256",
      })
      .expect(303);
    await agent.get(login.headers.location).expect(200);
    const approve = await agent
      .post("/oauth/authorize/decision")
      .type("form")
      .send({
        decision: "approve",
        client_id: register.body.client_id,
        redirect_uri: "https://chat.openai.com/aip/callback",
        response_type: "code",
        scope: "tasks.read",
        code_challenge: pkce.challenge,
        code_challenge_method: "S256",
      })
      .expect(303);

    const code = new URL(approve.headers.location).searchParams.get("code");
    const token = await request(app)
      .post("/oauth/token")
      .type("form")
      .send({
        grant_type: "authorization_code",
        code,
        client_id: register.body.client_id,
        redirect_uri: "https://chat.openai.com/aip/callback",
        code_verifier: pkce.verifier,
      })
      .expect(200);

    await request(app)
      .post("/oauth/revoke")
      .type("form")
      .send({
        token: token.body.refresh_token,
        client_id: register.body.client_id,
        token_type_hint: "refresh_token",
      })
      .expect(200);
  });

  it("advertises resource metadata when MCP auth is missing", async () => {
    const response = await request(app).get("/mcp").expect(401);

    expect(response.headers["www-authenticate"]).toContain(
      ".well-known/oauth-protected-resource",
    );
    expect(response.body.error.code).toBe("MCP_UNAUTHENTICATED");
  });

  it("lists the planner runtime read tools for authenticated public clients", async () => {
    currentSession = buildMcpSession("user-1", ["projects.read", "tasks.read"]);

    const response = await request(app)
      .post("/mcp")
      .set("Authorization", "Bearer mcp-token-user-1")
      .send({
        jsonrpc: "2.0",
        id: 21,
        method: "tools/list",
      })
      .expect(200);

    const toolNames = response.body.result.tools.map(
      (tool: { name: string }) => tool.name,
    );
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
  });

  it("opens an authenticated MCP stream endpoint for streamable-http clients", async () => {
    const response = await request(app)
      .get("/mcp")
      .set("Authorization", "Bearer mcp-token-user-1")
      .buffer(false)
      .parse((res, done) => {
        res.once("data", () => {
          (res as typeof res & { destroy(): void }).destroy();
          done(null, "");
        });
      })
      .expect(200);

    expect(response.headers["content-type"]).toContain("text/event-stream");
  });

  describe("MCP OAuth Google sign-in", () => {
    it("returns 501 for google/start when Google login is not configured", async () => {
      const register = await request(app)
        .post("/oauth/register")
        .send({
          redirect_uris: ["https://chat.openai.com/aip/callback"],
          client_name: "ChatGPT",
        })
        .expect(201);

      const pkce = createPkcePair(
        "oauth-verifier-google-start-1111111111111111111111111111",
      );
      const response = await request(app)
        .get(
          `/oauth/authorize/google/start?client_id=${encodeURIComponent(
            register.body.client_id,
          )}&redirect_uri=${encodeURIComponent(
            "https://chat.openai.com/aip/callback",
          )}&response_type=code&scope=tasks.read&state=s1&code_challenge=${encodeURIComponent(
            pkce.challenge,
          )}&code_challenge_method=S256`,
        )
        .expect(501);

      expect(response.text).toContain("Google Login Not Available");
    });

    it("returns 501 for google/callback when Google login is not configured", async () => {
      const response = await request(app)
        .get("/oauth/authorize/google/callback?code=abc&state=xyz")
        .expect(501);

      expect(response.text).toContain("Google Login Not Available");
    });

    it("does not show Google button on login page when Google is disabled", async () => {
      const register = await request(app)
        .post("/oauth/register")
        .send({
          redirect_uris: ["https://chat.openai.com/aip/callback"],
          client_name: "ChatGPT",
        })
        .expect(201);

      const pkce = createPkcePair(
        "oauth-verifier-no-google-btn-1111111111111111111111111111",
      );
      const response = await request(app)
        .get(
          `/oauth/authorize?client_id=${encodeURIComponent(
            register.body.client_id,
          )}&redirect_uri=${encodeURIComponent(
            "https://chat.openai.com/aip/callback",
          )}&response_type=code&scope=tasks.read&state=s2&code_challenge=${encodeURIComponent(
            pkce.challenge,
          )}&code_challenge_method=S256`,
        )
        .expect(200);

      expect(response.text).toContain("Connect Assistant");
      expect(response.text).not.toContain("Sign in with Google");
      expect(response.text).not.toContain("google/start");
    });

    it("does not show Google button on register page when Google is disabled", async () => {
      const register = await request(app)
        .post("/oauth/register")
        .send({
          redirect_uris: ["https://chat.openai.com/aip/callback"],
          client_name: "ChatGPT",
        })
        .expect(201);

      const pkce = createPkcePair(
        "oauth-verifier-no-google-reg-1111111111111111111111111111",
      );
      const response = await request(app)
        .get(
          `/oauth/authorize/register?client_id=${encodeURIComponent(
            register.body.client_id,
          )}&redirect_uri=${encodeURIComponent(
            "https://chat.openai.com/aip/callback",
          )}&response_type=code&scope=tasks.read&state=s3&code_challenge=${encodeURIComponent(
            pkce.challenge,
          )}&code_challenge_method=S256`,
        )
        .expect(200);

      expect(response.text).toContain("Create Account");
      expect(response.text).not.toContain("Sign up with Google");
      expect(response.text).not.toContain("google/start");
    });
  });
});
