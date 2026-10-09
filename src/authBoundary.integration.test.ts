import { createHash, randomUUID } from "crypto";
import jwt from "jsonwebtoken";
import request from "supertest";
import { createApp } from "./app";
import { config } from "./config";
import { prisma } from "./prismaClient";
import { AuthService } from "./services/authService";
import { AgentEnrollmentService } from "./services/agentEnrollmentService";
import { McpOAuthService } from "./services/mcpOAuthService";
import { PrismaTodoService } from "./services/prismaTodoService";
import { PrismaProjectService } from "./services/projectService";
import { GoogleAuthService } from "./services/googleAuthService";
import type { McpOAuthScope } from "./mcp/mcpScopes";

const SECRET = "synthetic-auth-boundary-secret";
const PASSWORD = "boundary-password-123";
const EMAIL_SUFFIX = "@auth-boundary.example.test";
const BROAD_RESOURCE = `${config.baseUrl}/mcp`;
const APP_RESOURCE = `${config.baseUrl}/mcp/app`;
const READ_SCOPES: McpOAuthScope[] = ["tasks.read", "projects.read"];
const WRITE_SCOPES: McpOAuthScope[] = [
  ...READ_SCOPES,
  "tasks.write",
  "projects.write",
];
const VERIFIER = "boundary-verifier-11111111111111111111111111111111111111111";
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");
const REDIRECT = "https://chat.openai.com/aip/callback";

interface FixtureAccount {
  user: { id: string; email: string | null };
  token: string;
  refreshToken?: string;
}

interface CredentialCase {
  label: string;
  scopes: McpOAuthScope[];
  resource?: string;
  revoked?: boolean;
}

const MCP_CREDENTIALS: CredentialCase[] = [
  { label: "legacy read", scopes: READ_SCOPES },
  { label: "legacy write", scopes: WRITE_SCOPES },
  { label: "broad bound read", scopes: READ_SCOPES, resource: BROAD_RESOURCE },
  {
    label: "broad bound write",
    scopes: WRITE_SCOPES,
    resource: BROAD_RESOURCE,
  },
  { label: "native bound read", scopes: READ_SCOPES, resource: APP_RESOURCE },
  { label: "native bound write", scopes: WRITE_SCOPES, resource: APP_RESOURCE },
  { label: "revoked legacy", scopes: WRITE_SCOPES, revoked: true },
  {
    label: "revoked bound",
    scopes: WRITE_SCOPES,
    resource: BROAD_RESOURCE,
    revoked: true,
  },
  {
    label: "different resource",
    scopes: WRITE_SCOPES,
    resource: "https://other.example.test/mcp",
  },
];

function parseRpc(response: request.Response) {
  if (response.body && Object.keys(response.body).length) return response.body;
  const event = response.text
    .split("\n")
    .find((line) => line.startsWith("data: "));
  if (!event) throw new Error("Expected MCP JSON or SSE response");
  return JSON.parse(event.slice(6));
}

describe("Application and assistant credential boundaries (integration)", () => {
  let app: ReturnType<typeof createApp>;
  let auth: AuthService;
  let oauth: McpOAuthService;
  let owner: FixtureAccount;
  let other: FixtureAccount;
  let taskId: string;
  let captureId: string;
  let projectId: string;
  let fixtureDatabaseApproved = false;
  const originalAccessSecret = process.env.JWT_ACCESS_SECRET;
  const originalRefreshSecret = process.env.JWT_REFRESH_SECRET;
  const nullEmailFixtureIds = new Set<string>();

  const cleanup = async () => {
    if (!fixtureDatabaseApproved) return;
    await prisma.user.deleteMany({
      where: {
        OR: [
          { email: { endsWith: EMAIL_SUFFIX } },
          { id: { in: [...nullEmailFixtureIds] } },
        ],
      },
    });
    nullEmailFixtureIds.clear();
  };

  beforeAll(() => {
    const database = new URL(config.databaseUrl || "");
    if (
      !["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) ||
      !database.pathname.includes("test")
    ) {
      throw new Error(
        "Auth boundary fixtures require an isolated local test database",
      );
    }
    fixtureDatabaseApproved = true;
    process.env.JWT_ACCESS_SECRET = SECRET;
    process.env.JWT_REFRESH_SECRET = SECRET;
    auth = new AuthService(prisma);
    oauth = new McpOAuthService(prisma);
    app = createApp({
      authService: auth,
      todoService: new PrismaTodoService(prisma),
      projectService: new PrismaProjectService(prisma),
    });
  });

  beforeEach(async () => {
    await cleanup();
    jest.spyOn(console, "info").mockImplementation(() => {});
    jest.spyOn(auth, "dispatchVerificationEmail").mockImplementation(() => {});
    owner = await auth.register({
      email: `owner${EMAIL_SUFFIX}`,
      password: PASSWORD,
      name: "Boundary owner",
    });
    other = await auth.register({
      email: `other${EMAIL_SUFFIX}`,
      password: PASSWORD,
      name: "Boundary other",
    });
    const project = await prisma.project.create({
      data: { userId: owner.user.id, name: "Private project" },
    });
    projectId = project.id;
    const task = await prisma.todo.create({
      data: { userId: owner.user.id, projectId, title: "Private task" },
    });
    taskId = task.id;
    const capture = await prisma.captureItem.create({
      data: {
        userId: owner.user.id,
        text: "Private capture",
        source: "manual",
      },
    });
    captureId = capture.id;
  });

  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await prisma.$disconnect();
      if (originalAccessSecret === undefined)
        delete process.env.JWT_ACCESS_SECRET;
      else process.env.JWT_ACCESS_SECRET = originalAccessSecret;
      if (originalRefreshSecret === undefined)
        delete process.env.JWT_REFRESH_SECRET;
      else process.env.JWT_REFRESH_SECRET = originalRefreshSecret;
    }
  });

  async function mcpCredential(input: CredentialCase, account = owner) {
    const session = await oauth.createAssistantSession({
      userId: account.user.id,
      source: "local",
      scopes: input.scopes,
      resource: input.resource,
      assistantName: "Synthetic assistant",
    });
    const issued = auth.createMcpToken({
      userId: account.user.id,
      email: account.user.email || "",
      scopes: input.scopes,
      sessionId: session.id,
      resource: input.resource,
    });
    if (input.revoked)
      await oauth.revokeAssistantSession({
        userId: account.user.id,
        sessionId: session.id,
      });
    return { token: issued.token, sessionId: session.id };
  }

  async function snapshot() {
    return Promise.all([
      prisma.user.findMany({ orderBy: { id: "asc" } }),
      prisma.todo.findMany({ orderBy: { id: "asc" } }),
      prisma.project.findMany({ orderBy: { id: "asc" } }),
      prisma.captureItem.findMany({ orderBy: { id: "asc" } }),
      prisma.refreshToken.findMany({ orderBy: { id: "asc" } }),
      prisma.mcpAssistantSession.findMany({ orderBy: { id: "asc" } }),
      prisma.mcpAuthorizationCode.findMany({ orderBy: { code: "asc" } }),
      prisma.mcpRefreshToken.findMany({ orderBy: { id: "asc" } }),
      prisma.agentEnrollment.findMany({ orderBy: { id: "asc" } }),
      prisma.userPlanningPreferences.findMany({ orderBy: { id: "asc" } }),
      prisma.area.findMany({ orderBy: { id: "asc" } }),
      prisma.goal.findMany({ orderBy: { id: "asc" } }),
      prisma.dayPlan.findMany({ orderBy: { id: "asc" } }),
      prisma.activityEvent.findMany({ orderBy: { id: "asc" } }),
      prisma.socialAccount.findMany({ orderBy: { id: "asc" } }),
      prisma.agentIdempotencyRecord.count(),
      prisma.agentActionAudit.count(),
    ]);
  }

  function protectedRequests() {
    return [
      () => request(app).get("/todos"),
      () => request(app).post("/todos").send({ title: "Unauthorized task" }),
      () =>
        request(app)
          .put(`/todos/${taskId}`)
          .send({ title: "Unauthorized edit" }),
      () => request(app).delete(`/todos/${taskId}`),
      () => request(app).get("/users/me"),
      () => request(app).get("/users/me/export"),
      () =>
        request(app)
          .put("/users/me")
          .send({
            name: "Unauthorized profile",
            email: `changed${EMAIL_SUFFIX}`,
          }),
      () => request(app).patch("/users/me/onboarding/step").send({ step: 4 }),
      () => request(app).post("/users/me/onboarding/complete"),
      () => request(app).get("/ai/focus-brief"),
      () => request(app).post("/ai/task-critic").send({ todoId: taskId }),
      () => request(app).get("/projects"),
      () =>
        request(app).post("/projects").send({ name: "Unauthorized project" }),
      () =>
        request(app)
          .put(`/projects/${projectId}`)
          .send({ name: "Unauthorized edit" }),
      () => request(app).get("/capture"),
      () =>
        request(app)
          .post("/capture")
          .send({ text: "Unauthorized capture", source: "api" }),
      () =>
        request(app)
          .patch(`/capture/${captureId}`)
          .send({ lifecycle: "discarded" }),
      () => request(app).get("/api/feedback"),
      () =>
        request(app).post("/api/feedback").send({
          title: "Unauthorized feedback",
          description: "Synthetic",
          type: "bug",
        }),
      () => request(app).get("/preferences"),
      () => request(app).patch("/preferences").send({ dailyBudgetMinutes: 30 }),
      () =>
        request(app)
          .post("/events/batch")
          .send({ events: [{ type: "task_completed", entityId: taskId }] }),
      () => request(app).get("/insights"),
      () => request(app).post("/insights/compute"),
      () => request(app).get("/calendar/export.ics"),
      () => request(app).get("/areas"),
      () => request(app).post("/areas").send({ name: "Unauthorized area" }),
      () => request(app).get("/goals"),
      () => request(app).post("/goals").send({ name: "Unauthorized goal" }),
      () => request(app).get("/plans/today"),
      () =>
        request(app)
          .put(`/plans/${randomUUID()}/meta`)
          .send({ availableMinutes: 30 }),
      () => request(app).get("/adaptation/profile"),
      () => request(app).post("/adaptation/profile/compute"),
      () => request(app).get("/agent-activity"),
      () => request(app).get("/admin/users"),
      () =>
        request(app)
          .put(`/admin/users/${other.user.id}/role`)
          .send({ role: "admin" }),
      () => request(app).get("/api/agent-enrollment"),
      () =>
        request(app).post("/api/agent-enrollment").send({ timezone: "UTC" }),
      () => request(app).post("/agent/read/list_tasks").send({}),
      () =>
        request(app)
          .post("/agent/write/create_task")
          .send({ title: "Unauthorized agent task" }),
      () => request(app).post("/agent/write/update_action_policy").send({}),
      () => request(app).get("/auth/bootstrap-admin/status"),
      () =>
        request(app)
          .post("/auth/bootstrap-admin")
          .send({ secret: "synthetic-secret" }),
      () => request(app).get("/auth/linked-providers"),
      () =>
        request(app)
          .delete("/auth/unlink-provider")
          .send({ provider: "google", providerSubject: "synthetic-provider" }),
      () =>
        request(app)
          .post("/auth/set-password")
          .send({ password: "unauthorized-password" }),
      () => request(app).post("/auth/mcp/token").send({ scopes: WRITE_SCOPES }),
      () =>
        request(app).post("/auth/mcp/oauth/authorize").send({
          clientId: "synthetic-client",
          redirectUri: REDIRECT,
          scopes: WRITE_SCOPES,
          codeChallenge: CHALLENGE,
          codeChallengeMethod: "S256",
        }),
      () => request(app).get("/auth/mcp/sessions"),
      () =>
        request(app)
          .post("/auth/mcp/sessions/revoke")
          .send({ revokeAll: true }),
    ];
  }

  test.each(MCP_CREDENTIALS)(
    "rejects $label credentials from application, agent, and account endpoints without writes",
    async (credential) => {
      const { token } = await mcpCredential(credential);
      const before = await snapshot();
      for (const build of protectedRequests()) {
        const attempt = build();
        const response = await attempt.set("Authorization", `Bearer ${token}`);
        expect({
          method: attempt.method,
          url: attempt.url,
          status: response.status,
        }).toEqual({ method: attempt.method, url: attempt.url, status: 401 });
      }
      expect(await snapshot()).toEqual(before);
    },
  );

  test("rejects an MCP credential even when its account is an administrator", async () => {
    await prisma.user.update({
      where: { id: owner.user.id },
      data: { role: "admin" },
    });
    const { token } = await mcpCredential({
      label: "admin MCP",
      scopes: WRITE_SCOPES,
    });
    const before = await snapshot();
    await request(app)
      .put(`/admin/users/${other.user.id}/role`)
      .set("Authorization", `Bearer ${token}`)
      .send({ role: "admin" })
      .expect(401);
    await request(app)
      .post("/auth/mcp/token")
      .set("Authorization", `Bearer ${token}`)
      .send({ scopes: WRITE_SCOPES })
      .expect(401);
    expect(await snapshot()).toEqual(before);
  });

  test("cannot set a password on a passwordless account using MCP credentials", async () => {
    const user = await prisma.user.create({
      data: {
        email: `passwordless${EMAIL_SUFFIX}`,
        name: "Synthetic passwordless",
      },
    });
    const account = { user, token: "" };
    const { token } = await mcpCredential(
      { label: "passwordless MCP", scopes: WRITE_SCOPES },
      account,
    );
    await request(app)
      .post("/auth/set-password")
      .set("Authorization", `Bearer ${token}`)
      .send({ password: PASSWORD })
      .expect(401);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: user.id } }))
        .password,
    ).toBeNull();
  });

  test.each(["web", "legacy MCP", "broad bound MCP", "native bound MCP"])(
    "rejects expired %s credentials across application, account, agent, and MCP endpoints without writes",
    async (kind) => {
      const issued =
        kind === "web"
          ? owner.token
          : (
              await mcpCredential({
                label: kind,
                scopes: WRITE_SCOPES,
                resource:
                  kind === "broad bound MCP"
                    ? BROAD_RESOURCE
                    : kind === "native bound MCP"
                      ? APP_RESOURCE
                      : undefined,
              })
            ).token;
      const payload = jwt.decode(issued) as jwt.JwtPayload;
      const expired = jwt.sign({ ...payload, exp: payload.iat! - 1 }, SECRET);
      const before = await snapshot();
      for (const build of protectedRequests()) {
        await build().set("Authorization", `Bearer ${expired}`).expect(401);
      }
      const broad = await broadRpc(expired, "tools/call", {
        name: "create_task",
        arguments: { title: "Expired credential task" },
      }).expect(401);
      expect(broad.body.error.data.code).toBe("MCP_AUTH_EXPIRED");
      const native = parseRpc(
        await nativeRpc(expired, "capture_task", {
          text: "Expired credential capture",
          idempotencyKey: randomUUID(),
        }).expect(200),
      );
      expect(native.result.isError).toBe(true);
      expect(native.result.structuredContent.error.code).toBe(
        "MCP_AUTH_EXPIRED",
      );
      expect(await snapshot()).toEqual(before);
    },
  );

  test("retains normal web administrator permission checks", async () => {
    await request(app)
      .get("/admin/users")
      .set("Authorization", `Bearer ${owner.token}`)
      .expect(403);
    await request(app)
      .put(`/admin/users/${other.user.id}/role`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ role: "admin" })
      .expect(403);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: other.user.id } }))
        .role,
    ).toBe("user");
    await prisma.user.update({
      where: { id: owner.user.id },
      data: { role: "admin" },
    });
    await request(app)
      .get("/admin/users")
      .set("Authorization", `Bearer ${owner.token}`)
      .expect(200);
    await request(app)
      .put(`/admin/users/${other.user.id}/role`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ role: "admin" })
      .expect(200);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: other.user.id } }))
        .role,
    ).toBe("admin");
  });

  test("normal registration, login, refresh, application access, and MCP minting remain usable", async () => {
    const registered = await request(app)
      .post("/auth/register")
      .send({ email: `registered${EMAIL_SUFFIX}`, password: PASSWORD })
      .expect(201);
    const loggedIn = await request(app)
      .post("/auth/login")
      .send({ email: registered.body.user.email, password: PASSWORD })
      .expect(200);
    const refreshed = await request(app)
      .post("/auth/refresh")
      .send({ refreshToken: loggedIn.body.refreshToken })
      .expect(200);
    const token = refreshed.body.token as string;
    expect(auth.verifyToken(token).userId).toBe(registered.body.user.id);
    await request(app)
      .get("/users/me")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const created = await request(app)
      .post("/todos")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Valid web task" })
      .expect(201);
    await request(app)
      .put(`/todos/${created.body.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Updated web task" })
      .expect(200);
    const minted = await request(app)
      .post("/auth/mcp/token")
      .set("Authorization", `Bearer ${token}`)
      .send({ scopes: READ_SCOPES })
      .expect(201);
    await request(app)
      .get("/auth/mcp/sessions")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    await broadRpc(minted.body.token, "ping").expect(200);
    await request(app)
      .post("/auth/refresh")
      .send({ refreshToken: loggedIn.body.refreshToken })
      .expect(401);
  });

  test("normal web credentials retain password setup and profile identity updates", async () => {
    const user = await prisma.user.create({
      data: {
        email: `web-passwordless${EMAIL_SUFFIX}`,
        name: "Passwordless web fixture",
      },
    });
    const { token } = await auth.issueTokens(user.id, user.email);
    await request(app)
      .post("/auth/set-password")
      .set("Authorization", `Bearer ${token}`)
      .send({ password: PASSWORD })
      .expect(200);
    const stored = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(stored.password).toEqual(expect.any(String));
    expect(stored.password).not.toBe(PASSWORD);
    const updatedEmail = `web-updated${EMAIL_SUFFIX}`;
    const updated = await request(app)
      .put("/users/me")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Updated fixture", email: updatedEmail })
      .expect(200);
    expect(updated.body).toEqual(
      expect.objectContaining({
        id: user.id,
        name: "Updated fixture",
        email: updatedEmail,
      }),
    );
    const login = await request(app)
      .post("/auth/login")
      .send({ email: updatedEmail, password: PASSWORD })
      .expect(200);
    await request(app)
      .get("/users/me")
      .set("Authorization", `Bearer ${login.body.token}`)
      .expect(200);
    expect(auth.dispatchVerificationEmail).toHaveBeenCalledWith(
      user.id,
      expect.any(String),
    );
  });

  test("Google linking hints accept normal web access and ignore MCP credentials without provider network calls", async () => {
    const originalEnabled = config.googleLoginEnabled;
    config.googleLoginEnabled = true;
    jest.spyOn(GoogleAuthService.prototype, "generateAuthUrl").mockReturnValue({
      url: "https://accounts.google.com/synthetic-authorization",
      state: "synthetic-google-state",
    });
    const googleApp = createApp({
      authService: auth,
      todoService: new PrismaTodoService(prisma),
      projectService: new PrismaProjectService(prisma),
    });
    try {
      const mcp = await mcpCredential({
        label: "link hint",
        scopes: WRITE_SCOPES,
        resource: APP_RESOURCE,
      });
      const before = await snapshot();
      const ignored = await request(googleApp)
        .get("/auth/google/start")
        .set("Host", new URL(config.googleRedirectUri).host)
        .set("Authorization", `Bearer ${mcp.token}`)
        .expect(302);
      expect(ignored.headers["set-cookie"]).not.toEqual(
        expect.arrayContaining([expect.stringMatching(/^link_to_user=/)]),
      );
      const accepted = await request(googleApp)
        .get("/auth/google/start")
        .set("Host", new URL(config.googleRedirectUri).host)
        .set("Authorization", `Bearer ${owner.token}`)
        .expect(302);
      expect(accepted.headers["set-cookie"]).toEqual(
        expect.arrayContaining([
          expect.stringContaining(`link_to_user=${owner.user.id}`),
        ]),
      );
      expect(await snapshot()).toEqual(before);
    } finally {
      config.googleLoginEnabled = originalEnabled;
    }
  });

  test("normal web credentials retain authenticated agent read and write access", async () => {
    const result = await request(app)
      .post("/agent/write/create_task")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ title: "Valid agent task" })
      .expect(201);
    expect(result.body.ok).toBe(true);
    expect(
      await prisma.todo.count({
        where: { userId: owner.user.id, title: "Valid agent task" },
      }),
    ).toBe(1);
    const listed = await request(app)
      .post("/agent/read/list_tasks")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({})
      .expect(200);
    expect(listed.body.ok).toBe(true);
  });

  test("normal web credentials and assistant-session controls remain account isolated", async () => {
    const mcp = await mcpCredential({
      label: "private session",
      scopes: WRITE_SCOPES,
    });
    const before = await snapshot();
    const listed = await request(app)
      .get("/todos")
      .set("Authorization", `Bearer ${other.token}`)
      .expect(200);
    expect(listed.body).toEqual([]);
    await request(app)
      .get(`/todos/${taskId}`)
      .set("Authorization", `Bearer ${other.token}`)
      .expect(404);
    await request(app)
      .put(`/todos/${taskId}`)
      .set("Authorization", `Bearer ${other.token}`)
      .send({ title: "Other account edit" })
      .expect(404);
    await request(app)
      .get(`/capture/${captureId}`)
      .set("Authorization", `Bearer ${other.token}`)
      .expect(404);
    await request(app)
      .post("/auth/mcp/sessions/revoke")
      .set("Authorization", `Bearer ${other.token}`)
      .send({ sessionId: mcp.sessionId })
      .expect(404);
    expect(await snapshot()).toEqual(before);
  });

  test("real runner enrollment exchanges preserve agent access without accepting MCP tokens as enrollment credentials", async () => {
    const enrollment = new AgentEnrollmentService(prisma);
    await enrollment.enroll(owner.user.id, { timezone: "UTC" });
    const stored = await prisma.agentEnrollment.findUniqueOrThrow({
      where: { userId: owner.user.id },
    });
    const exchange = await request(app)
      .post("/api/agent-enrollment/exchange")
      .send({ refreshToken: stored.refreshToken })
      .expect(200);
    const token = exchange.body.accessToken as string;
    expect(auth.verifyToken(token).userId).toBe(owner.user.id);
    await request(app)
      .post("/agent/read/list_tasks")
      .set("Authorization", `Bearer ${token}`)
      .send({})
      .expect(200);
    await request(app)
      .post("/agent/write/create_task")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Valid runner task" })
      .expect(201);
    const mcp = await mcpCredential({
      label: "MCP misuse",
      scopes: WRITE_SCOPES,
    });
    await request(app)
      .post("/api/agent-enrollment/exchange")
      .send({ refreshToken: mcp.token })
      .expect(401);
  });

  test("real enrollment for a synthetic phone account with null email retains application and agent access", async () => {
    const user = await prisma.user.create({
      data: { phoneE164: "+15555550199", name: "Synthetic phone account" },
    });
    nullEmailFixtureIds.add(user.id);
    const enrollment = new AgentEnrollmentService(prisma);
    await enrollment.enroll(user.id, { timezone: "UTC" });
    const stored = await prisma.agentEnrollment.findUniqueOrThrow({
      where: { userId: user.id },
    });
    const exchange = await request(app)
      .post("/api/agent-enrollment/exchange")
      .send({ refreshToken: stored.refreshToken })
      .expect(200);
    const token = exchange.body.accessToken as string;
    expect((jwt.decode(token) as jwt.JwtPayload).email).toBeNull();
    expect(auth.verifyToken(token)).toEqual(
      expect.objectContaining({ userId: user.id, email: "" }),
    );
    const me = await request(app)
      .get("/users/me")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(me.body.id).toBe(user.id);
    expect(me.body.email).toBeNull();
    await request(app)
      .post("/todos")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Phone account task" })
      .expect(201);
    await request(app)
      .post("/agent/read/list_tasks")
      .set("Authorization", `Bearer ${token}`)
      .send({})
      .expect(200);
    await request(app)
      .post("/agent/write/create_task")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Phone runner task" })
      .expect(201);
    expect(await prisma.todo.count({ where: { userId: user.id } })).toBe(2);
  });

  function broadRpc(
    token: string,
    method: string,
    params?: Record<string, unknown>,
  ) {
    return request(app)
      .post("/mcp")
      .set("Authorization", `Bearer ${token}`)
      .send({ jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) });
  }

  function nativeRpc(
    token: string,
    name: string,
    args: Record<string, unknown>,
  ) {
    return request(app)
      .post("/mcp/app")
      .set("Authorization", `Bearer ${token}`)
      .set("Accept", "application/json, text/event-stream")
      .send({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      });
  }

  test.each([
    { label: "manual legacy", scopes: WRITE_SCOPES },
    {
      label: "canonical broad bound",
      scopes: WRITE_SCOPES,
      resource: BROAD_RESOURCE,
    },
  ])(
    "preserves $label MCP tool read/write and user isolation",
    async (credential) => {
      const { token } = await mcpCredential(credential);
      const result = await broadRpc(token, "tools/call", {
        name: "create_task",
        arguments: {
          title: "Scoped MCP task",
          idempotencyKey: "boundary-create",
        },
      }).expect(200);
      expect(result.body.result.structuredContent.ok).toBe(true);
      expect(
        await prisma.todo.count({
          where: { userId: owner.user.id, title: "Scoped MCP task" },
        }),
      ).toBe(1);
      const otherToken = await mcpCredential(credential, other);
      const read = await broadRpc(otherToken.token, "tools/call", {
        name: "get_task",
        arguments: { id: taskId },
      }).expect(200);
      expect(read.body.result.isError).toBe(true);
      const edit = await broadRpc(otherToken.token, "tools/call", {
        name: "update_task",
        arguments: { id: taskId, title: "Cross account edit" },
      }).expect(200);
      expect(edit.body.result.isError).toBe(true);
      expect(
        (await prisma.todo.findUniqueOrThrow({ where: { id: taskId } })).title,
      ).toBe("Private task");
    },
  );

  test("native app bound credentials retain capture, task actions, and account isolation", async () => {
    const { token } = await mcpCredential({
      label: "native",
      scopes: WRITE_SCOPES,
      resource: APP_RESOURCE,
    });
    const capture = parseRpc(
      await nativeRpc(token, "capture_task", {
        text: "Native saved intention",
        idempotencyKey: "boundary-native-capture",
      }).expect(200),
    );
    expect(capture.result.isError).not.toBe(true);
    expect(
      await prisma.captureItem.count({
        where: { userId: owner.user.id, text: "Native saved intention" },
      }),
    ).toBe(1);
    const complete = parseRpc(
      await nativeRpc(token, "complete_task", {
        taskId,
        completed: true,
      }).expect(200),
    );
    expect(complete.result.isError).not.toBe(true);
    expect(
      (await prisma.todo.findUniqueOrThrow({ where: { id: taskId } }))
        .completed,
    ).toBe(true);
    const otherToken = await mcpCredential(
      { label: "native other", scopes: WRITE_SCOPES, resource: APP_RESOURCE },
      other,
    );
    const isolated = parseRpc(
      await nativeRpc(otherToken.token, "complete_task", {
        taskId,
        completed: false,
      }).expect(200),
    );
    expect(isolated.result.isError).toBe(true);
    expect(
      (await prisma.todo.findUniqueOrThrow({ where: { id: taskId } }))
        .completed,
    ).toBe(true);
  });

  test.each([
    { label: "legacy read", scopes: READ_SCOPES },
    { label: "broad read", scopes: READ_SCOPES, resource: BROAD_RESOURCE },
  ])("preserves $label MCP scope checks", async (credential) => {
    const { token } = await mcpCredential(credential);
    const listed = await broadRpc(token, "tools/call", {
      name: "list_tasks",
      arguments: {},
    }).expect(200);
    expect(listed.body.result.structuredContent.ok).toBe(true);
    const before = await prisma.todo.count();
    const rejected = await broadRpc(token, "tools/call", {
      name: "create_task",
      arguments: { title: "Scope denied" },
    }).expect(200);
    expect(rejected.body.result.isError).toBe(true);
    expect(rejected.body.result.structuredContent.error.code).toBe(
      "MCP_INSUFFICIENT_SCOPE",
    );
    expect(await prisma.todo.count()).toBe(before);
  });

  test("preserves native read-only scope checks", async () => {
    const { token } = await mcpCredential({
      label: "native read",
      scopes: READ_SCOPES,
      resource: APP_RESOURCE,
    });
    const listed = parseRpc(
      await nativeRpc(token, "list_today", {}).expect(200),
    );
    expect(listed.result.isError).not.toBe(true);
    const before = await prisma.captureItem.count();
    const rejected = parseRpc(
      await nativeRpc(token, "capture_task", {
        text: "Scope denied",
        idempotencyKey: "boundary-denied",
      }).expect(200),
    );
    expect(rejected.result.isError).toBe(true);
    expect(rejected.result.structuredContent.error.code).toBe(
      "MCP_INSUFFICIENT_SCOPE",
    );
    expect(await prisma.captureItem.count()).toBe(before);
  });

  test("keeps endpoint resource bindings separate and rejects revoked sessions", async () => {
    const broad = await mcpCredential({
      label: "broad",
      scopes: WRITE_SCOPES,
      resource: BROAD_RESOURCE,
    });
    const native = await mcpCredential({
      label: "native",
      scopes: WRITE_SCOPES,
      resource: APP_RESOURCE,
    });
    const legacy = await mcpCredential({
      label: "legacy",
      scopes: WRITE_SCOPES,
    });
    const wrong = await mcpCredential({
      label: "wrong",
      scopes: WRITE_SCOPES,
      resource: "https://other.example.test/mcp",
    });
    const before = await prisma.captureItem.count();
    for (const token of [broad.token, legacy.token, wrong.token, owner.token]) {
      const rejected = parseRpc(
        await nativeRpc(token, "capture_task", {
          text: "Cross resource",
          idempotencyKey: randomUUID(),
        }).expect(200),
      );
      expect(rejected.result.isError).toBe(true);
      expect(rejected.result.structuredContent.error.code).toBe(
        "MCP_INVALID_TOKEN",
      );
    }
    await broadRpc(native.token, "ping").expect(401);
    await request(app)
      .get("/mcp")
      .set("Authorization", `Bearer ${native.token}`)
      .expect(401);
    await broadRpc(wrong.token, "ping").expect(401);
    await broadRpc(owner.token, "ping").expect(401);
    expect(await prisma.captureItem.count()).toBe(before);
    await request(app)
      .post("/auth/mcp/sessions/revoke")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ sessionId: broad.sessionId })
      .expect(200);
    await broadRpc(broad.token, "ping").expect(401);
    await oauth.revokeAssistantSession({
      userId: owner.user.id,
      sessionId: native.sessionId,
    });
    const revoked = parseRpc(
      await nativeRpc(native.token, "capture_task", {
        text: "Revoked native",
        idempotencyKey: "boundary-revoked",
      }).expect(200),
    );
    expect(revoked.result.structuredContent.error.code).toBe(
      "MCP_AUTH_REVOKED",
    );
    expect(await prisma.captureItem.count()).toBe(before);
    await request(app)
      .get("/users/me")
      .set("Authorization", `Bearer ${owner.token}`)
      .expect(200);
  });

  test("does not accept refresh credentials or typed non-web credentials as application access", async () => {
    const { token } = await mcpCredential({
      label: "legacy",
      scopes: WRITE_SCOPES,
    });
    const before = await snapshot();
    for (const value of [
      owner.refreshToken!,
      token,
      jwt.sign(
        { userId: owner.user.id, email: owner.user.email, tokenType: "other" },
        SECRET,
        { expiresIn: "15m" },
      ),
    ]) {
      await request(app)
        .get("/users/me")
        .set("Authorization", `Bearer ${value}`)
        .expect(401);
    }
    await request(app)
      .post("/auth/refresh")
      .send({ refreshToken: token })
      .expect(401);
    expect(await snapshot()).toEqual(before);
  });

  async function publicAuthorization() {
    const client = await request(app)
      .post("/oauth/register")
      .send({
        redirect_uris: [REDIRECT],
        client_name: "Synthetic assistant",
        grant_types: ["authorization_code", "refresh_token"],
      })
      .expect(201);
    return {
      client_id: client.body.client_id as string,
      redirect_uri: REDIRECT,
      response_type: "code",
      scope: WRITE_SCOPES.join(" "),
      code_challenge: CHALLENGE,
      code_challenge_method: "S256",
      state: "boundary-state",
    };
  }

  test.each(MCP_CREDENTIALS)(
    "does not treat $label MCP cookie credentials as a web authorization session",
    async (credential) => {
      const { token } = await mcpCredential(credential);
      const fields = await publicAuthorization();
      const cookie = `${config.mcpOauthSessionCookieName}=${token}`;
      const before = await snapshot();
      const page = await request(app)
        .get("/oauth/authorize")
        .query(fields)
        .set("Cookie", cookie)
        .expect(200);
      expect(page.text).toContain("/oauth/authorize/login");
      const denied = await request(app)
        .post("/oauth/authorize/decision")
        .set("Cookie", cookie)
        .type("form")
        .send({ ...fields, decision: "approve" })
        .expect(400);
      expect(denied.headers.location).toBeUndefined();
      expect(await snapshot()).toEqual(before);
    },
  );

  test("normal web cookies can authorize, exchange and refresh resource-bound MCP access", async () => {
    const fields = { ...(await publicAuthorization()), resource: APP_RESOURCE };
    const approval = await request(app)
      .post("/oauth/authorize/decision")
      .set("Cookie", `${config.mcpOauthSessionCookieName}=${owner.token}`)
      .type("form")
      .send({ ...fields, decision: "approve" })
      .expect(303);
    const code = new URL(approval.headers.location).searchParams.get("code");
    expect(code).toEqual(expect.any(String));
    const exchange = await request(app)
      .post("/oauth/token")
      .type("form")
      .send({
        grant_type: "authorization_code",
        code,
        client_id: fields.client_id,
        redirect_uri: REDIRECT,
        code_verifier: VERIFIER,
        resource: APP_RESOURCE,
      })
      .expect(200);
    const refreshed = await request(app)
      .post("/oauth/token")
      .type("form")
      .send({
        grant_type: "refresh_token",
        refresh_token: exchange.body.refresh_token,
        client_id: fields.client_id,
        resource: APP_RESOURCE,
      })
      .expect(200);
    expect(refreshed.body.refresh_token).not.toBe(exchange.body.refresh_token);
    const valid = parseRpc(
      await nativeRpc(refreshed.body.access_token, "capture_task", {
        text: "Public OAuth capture",
        idempotencyKey: "boundary-public-oauth",
      }).expect(200),
    );
    expect(valid.result.isError).not.toBe(true);
    await request(app)
      .get("/todos")
      .set("Authorization", `Bearer ${refreshed.body.access_token}`)
      .expect(401);
  });

  test.each([
    { label: "null", resource: null },
    { label: "empty", resource: "" },
    { label: "blank", resource: "   " },
    { label: "broad", resource: BROAD_RESOURCE },
    { label: "native", resource: APP_RESOURCE },
  ])(
    "legacy assistant endpoints reject $label resource presence without issuance or rotation",
    async ({ resource }) => {
      const authorizeBody = {
        clientId: "synthetic-legacy-resource",
        redirectUri: REDIRECT,
        scopes: WRITE_SCOPES,
        codeChallenge: CHALLENGE,
        codeChallengeMethod: "S256",
      };
      const authorize = () =>
        request(app)
          .post("/auth/mcp/oauth/authorize")
          .set("Authorization", `Bearer ${owner.token}`)
          .send(authorizeBody);
      const refreshAuthorization = await authorize().expect(201);
      const initialExchange = await request(app)
        .post("/auth/mcp/oauth/token")
        .send({
          grantType: "authorization_code",
          code: refreshAuthorization.body.authorizationCode,
          clientId: authorizeBody.clientId,
          redirectUri: REDIRECT,
          codeVerifier: VERIFIER,
        })
        .expect(200);
      const codeAuthorization = await authorize().expect(201);
      const codeBody = {
        grantType: "authorization_code",
        code: codeAuthorization.body.authorizationCode,
        clientId: authorizeBody.clientId,
        redirectUri: REDIRECT,
        codeVerifier: VERIFIER,
      };
      const refreshBody = {
        grantType: "refresh_token",
        refreshToken: initialExchange.body.refreshToken,
        clientId: authorizeBody.clientId,
      };
      const mcp = await mcpCredential({
        label: "resource guard auth precedence",
        scopes: WRITE_SCOPES,
        resource: APP_RESOURCE,
      });
      const before = await snapshot();
      for (const [path, body] of [
        ["/auth/mcp/token", { scopes: WRITE_SCOPES }],
        ["/auth/mcp/oauth/authorize", authorizeBody],
      ] as const) {
        const denied = await request(app)
          .post(path)
          .set("Authorization", `Bearer ${owner.token}`)
          .send({ ...body, resource })
          .expect(400);
        expect(denied.body.error.code).toBe("MCP_INVALID_REQUEST");
        expect(denied.body.error.retryable).toBe(false);
        expect(await snapshot()).toEqual(before);
        await request(app)
          .post(path)
          .set("Authorization", `Bearer ${mcp.token}`)
          .send({ ...body, resource })
          .expect(401);
        expect(await snapshot()).toEqual(before);
      }
      for (const body of [codeBody, refreshBody]) {
        const denied = await request(app)
          .post("/auth/mcp/oauth/token")
          .send({ ...body, resource })
          .expect(400);
        expect(denied.body.error.code).toBe("MCP_INVALID_REQUEST");
        expect(denied.body.error.retryable).toBe(false);
        expect(await snapshot()).toEqual(before);
      }
      // Denied resource requests leave both legacy credentials usable.
      const exchanged = await request(app)
        .post("/auth/mcp/oauth/token")
        .send(codeBody)
        .expect(200);
      const refreshed = await request(app)
        .post("/auth/mcp/oauth/token")
        .send(refreshBody)
        .expect(200);
      await broadRpc(exchanged.body.accessToken, "ping").expect(200);
      await broadRpc(refreshed.body.accessToken, "ping").expect(200);
    },
  );

  test("legacy OAuth code and refresh exchange retain supported unbound MCP behavior", async () => {
    const authorize = await request(app)
      .post("/auth/mcp/oauth/authorize")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({
        clientId: "synthetic-legacy",
        redirectUri: REDIRECT,
        scopes: WRITE_SCOPES,
        codeChallenge: CHALLENGE,
        codeChallengeMethod: "S256",
      })
      .expect(201);
    const exchange = await request(app)
      .post("/auth/mcp/oauth/token")
      .send({
        grantType: "authorization_code",
        code: authorize.body.authorizationCode,
        clientId: "synthetic-legacy",
        redirectUri: REDIRECT,
        codeVerifier: VERIFIER,
      })
      .expect(200);
    await broadRpc(exchange.body.accessToken, "ping").expect(200);
    const refreshed = await request(app)
      .post("/auth/mcp/oauth/token")
      .send({
        grantType: "refresh_token",
        refreshToken: exchange.body.refreshToken,
        clientId: "synthetic-legacy",
      })
      .expect(200);
    await broadRpc(refreshed.body.accessToken, "ping").expect(200);
    await request(app)
      .get("/todos")
      .set("Authorization", `Bearer ${refreshed.body.accessToken}`)
      .expect(401);
  });

  test("bound authorization codes and refresh credentials cannot be downgraded by the legacy exchange", async () => {
    const client = await publicAuthorization();
    const code = await oauth.createAuthorizationCode({
      userId: owner.user.id,
      email: owner.user.email!,
      clientId: client.client_id,
      redirectUri: REDIRECT,
      scopes: WRITE_SCOPES,
      codeChallenge: CHALLENGE,
      codeChallengeMethod: "S256",
      resource: APP_RESOURCE,
    });
    const before = await snapshot();
    for (const resource of [undefined, APP_RESOURCE]) {
      const denied = await request(app)
        .post("/auth/mcp/oauth/token")
        .send({
          grantType: "authorization_code",
          code: code.code,
          clientId: client.client_id,
          redirectUri: REDIRECT,
          codeVerifier: VERIFIER,
          ...(resource ? { resource } : {}),
        })
        .expect(resource === undefined ? 401 : 400);
      expect(denied.body.error.code).toBe(
        resource === undefined
          ? "MCP_AUTH_CODE_RESOURCE_MISMATCH"
          : "MCP_INVALID_REQUEST",
      );
      expect(denied.body.error.retryable).toBe(false);
      expect(await snapshot()).toEqual(before);
    }
    const session = await oauth.createAssistantSession({
      userId: owner.user.id,
      scopes: WRITE_SCOPES,
      source: "oauth",
      clientId: client.client_id,
      resource: APP_RESOURCE,
    });
    const refresh = await oauth.createRefreshToken({
      userId: owner.user.id,
      email: owner.user.email!,
      scopes: WRITE_SCOPES,
      clientId: client.client_id,
      sessionId: session.id,
      resource: APP_RESOURCE,
    });
    const beforeRefresh = await snapshot();
    for (const resource of [undefined, APP_RESOURCE]) {
      const denied = await request(app)
        .post("/auth/mcp/oauth/token")
        .send({
          grantType: "refresh_token",
          refreshToken: refresh.refreshToken,
          clientId: client.client_id,
          ...(resource ? { resource } : {}),
        })
        .expect(resource === undefined ? 401 : 400);
      expect(denied.body.error.code).toBe(
        resource === undefined
          ? "MCP_REFRESH_TOKEN_RESOURCE_MISMATCH"
          : "MCP_INVALID_REQUEST",
      );
      expect(denied.body.error.retryable).toBe(false);
      expect(await snapshot()).toEqual(beforeRefresh);
    }
  });
});
