import request from "supertest";
import { createApp } from "./app";
import { PrismaTodoService } from "./services/prismaTodoService";
import { AuthService } from "./services/authService";
import { prisma } from "./prismaClient";
import { PrismaProjectService } from "./services/projectService";
import { AgentIdempotencyService } from "./services/agentIdempotencyService";
import { McpOAuthService } from "./services/mcpOAuthService";
import { config } from "./config";
import { getMcpAppResource } from "./mcp/appContract";
import type { McpOAuthScope } from "./mcp/mcpScopes";

const FIXTURE_EMAILS = [
  "capture-test@example.com",
  "other-receipt@example.com",
  "other-capture@example.com",
  "foreign-project@example.com",
];

describe("Capture API Integration", () => {
  let app: ReturnType<typeof createApp>;
  let authToken: string;
  let userId: string;
  let authService: AuthService;
  let oauthService: McpOAuthService;
  let fixtureDatabaseApproved = false;
  const originalJwtSecret = process.env.JWT_SECRET;

  beforeAll(() => {
    const database = new URL(config.databaseUrl || "");
    if (
      !["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) ||
      !database.pathname.includes("test")
    ) {
      throw new Error(
        "Capture fixtures require an isolated local test database",
      );
    }
    fixtureDatabaseApproved = true;
    process.env.JWT_SECRET = "test-secret-for-capture-api-tests";
    const todoService = new PrismaTodoService(prisma);
    authService = new AuthService(prisma);
    oauthService = new McpOAuthService(prisma);
    app = createApp({
      todoService,
      authService,
      projectService: new PrismaProjectService(prisma),
    });
  });

  beforeEach(async () => {
    await prisma.captureItem.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();
    jest
      .spyOn(authService, "dispatchVerificationEmail")
      .mockImplementation(() => {});

    const registerResponse = await request(app)
      .post("/auth/register")
      .send({
        email: "capture-test@example.com",
        password: "password123",
        name: "Capture Tester",
      })
      .expect(201);

    authToken = registerResponse.body.token;
    userId = registerResponse.body.user.id;
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    try {
      if (fixtureDatabaseApproved) {
        await prisma.user.deleteMany({
          where: { email: { in: FIXTURE_EMAILS } },
        });
      }
    } finally {
      await prisma.$disconnect();
      if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = originalJwtSecret;
    }
  });

  async function nativeMcpToken(scopes: McpOAuthScope[]) {
    const resource = getMcpAppResource(config.baseUrl);
    const session = await oauthService.createAssistantSession({
      userId,
      scopes,
      source: "oauth",
      clientId: "synthetic-capture-review",
      resource,
    });
    return authService.createMcpToken({
      userId,
      email: "capture-test@example.com",
      scopes,
      sessionId: session.id,
      resource,
    }).token;
  }

  async function reviewSnapshot() {
    return Promise.all([
      prisma.captureItem.findMany({ orderBy: { id: "asc" } }),
      prisma.todo.findMany({ orderBy: { id: "asc" } }),
      prisma.agentIdempotencyRecord.findMany({ orderBy: { id: "asc" } }),
      prisma.mcpAssistantSession.findMany({ orderBy: { id: "asc" } }),
    ]);
  }

  it("POST /capture creates an item and returns 201", async () => {
    const response = await request(app)
      .post("/capture")
      .set("Authorization", `Bearer ${authToken}`)
      .send({ text: "Buy milk", source: "test" })
      .expect(201);

    expect(response.body.id).toBeDefined();
    expect(response.body.text).toBe("Buy milk");
    expect(response.body.source).toBe("test");
    expect(response.body.lifecycle).toBe("new");
    expect(response.body.capturedAt).toBeDefined();
    expect(response.body.createdAt).toBeDefined();
    expect(response.body.updatedAt).toBeDefined();
  });

  it("GET /capture returns all items", async () => {
    await request(app)
      .post("/capture")
      .set("Authorization", `Bearer ${authToken}`)
      .send({ text: "Item 1" })
      .expect(201);

    await request(app)
      .post("/capture")
      .set("Authorization", `Bearer ${authToken}`)
      .send({ text: "Item 2" })
      .expect(201);

    const response = await request(app)
      .get("/capture")
      .set("Authorization", `Bearer ${authToken}`)
      .expect(200);

    expect(response.body).toHaveLength(2);
  });

  it("GET /capture?lifecycle=new returns only new items", async () => {
    const created = await request(app)
      .post("/capture")
      .set("Authorization", `Bearer ${authToken}`)
      .send({ text: "Item A" })
      .expect(201);

    await request(app)
      .patch(`/capture/${created.body.id}`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({ lifecycle: "triaged" })
      .expect(200);

    await request(app)
      .post("/capture")
      .set("Authorization", `Bearer ${authToken}`)
      .send({ text: "Item B" })
      .expect(201);

    const response = await request(app)
      .get("/capture?lifecycle=new")
      .set("Authorization", `Bearer ${authToken}`)
      .expect(200);

    expect(response.body).toHaveLength(1);
    expect(response.body[0].text).toBe("Item B");
  });

  it("GET /capture/:id returns a specific item", async () => {
    const created = await request(app)
      .post("/capture")
      .set("Authorization", `Bearer ${authToken}`)
      .send({ text: "Specific item" })
      .expect(201);

    const response = await request(app)
      .get(`/capture/${created.body.id}`)
      .set("Authorization", `Bearer ${authToken}`)
      .expect(200);

    expect(response.body.id).toBe(created.body.id);
    expect(response.body.text).toBe("Specific item");
  });

  it("PATCH /capture/:id updates lifecycle", async () => {
    const created = await request(app)
      .post("/capture")
      .set("Authorization", `Bearer ${authToken}`)
      .send({ text: "To triage" })
      .expect(201);

    const response = await request(app)
      .patch(`/capture/${created.body.id}`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({ lifecycle: "triaged", triageResult: { decision: "keep" } })
      .expect(200);

    expect(response.body.lifecycle).toBe("triaged");
    expect(response.body.triageResult).toEqual({ decision: "keep" });
  });

  it("GET /capture returns 401 without auth", async () => {
    await request(app).get("/capture").expect(401);
  });

  async function capture(text = "Review the draft", source = "api") {
    const response = await request(app)
      .post("/capture")
      .set("Authorization", `Bearer ${authToken}`)
      .send({ text, source })
      .expect(201);
    return response.body;
  }

  function accept(id: string, title?: string) {
    return request(app)
      .post(`/capture/${id}/accept`)
      .set("Authorization", `Bearer ${authToken}`)
      .send(title === undefined ? {} : { title });
  }

  function discard(id: string) {
    return request(app)
      .post(`/capture/${id}/discard`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({});
  }

  it("reviews new and legacy triaged captures without including accepted or discarded items", async () => {
    const fresh = await capture("New capture");
    const legacy = await capture("Legacy recommendation");
    await prisma.captureItem.update({
      where: { id: legacy.id },
      data: { lifecycle: "triaged", triageResult: { kind: "create_task" } },
    });
    const accepted = await capture("Accepted capture");
    await accept(accepted.id).expect(201);
    const discarded = await capture("Discarded capture");
    await discard(discarded.id).expect(200);
    const response = await request(app)
      .get("/capture?review=pending")
      .set("Authorization", `Bearer ${authToken}`)
      .expect(200);
    expect(response.body.map((item: { id: string }) => item.id).sort()).toEqual(
      [fresh.id, legacy.id].sort(),
    );
  });

  it("accepts an edited task as next while preserving raw text and truthful source", async () => {
    const rawText = `Discussed action:\n${"A".repeat(300)}\nCall the dentist tomorrow`;
    const item = await capture(rawText, "voice");
    const response = await accept(item.id, "  Call the dentist  ").expect(201);
    expect(response.body.created).toBe(true);
    expect(response.body.task).toMatchObject({
      title: "Call the dentist",
      status: "next",
      completed: false,
      sourceText: rawText,
      notes: `Captured from voice at ${item.capturedAt}\n\n${rawText}`,
    });
    expect(response.body.task.projectId).toBeUndefined();
    expect(response.body.task.source).toBeUndefined();
    const stored = await prisma.todo.findUnique({
      where: { id: response.body.task.id },
    });
    expect(stored?.sourceText).toBe(rawText);
    expect(stored?.source).toBeNull();
    const review = await prisma.captureItem.findUnique({
      where: { id: item.id },
    });
    expect(review).toMatchObject({ lifecycle: "triaged" });
    expect(review?.triageResult).toMatchObject({
      promotedAs: "task",
      promotedId: response.body.task.id,
    });
  });

  it("maps an existing valid source without inventing conversation context", async () => {
    const item = await capture("Call the dentist tomorrow", "api");
    const response = await accept(item.id).expect(201);
    expect(response.body.task.source).toBe("api");
    expect(response.body.task.sourceText).toBe(item.text);
    expect(response.body.task.createdByPrompt).toBeUndefined();
    expect(response.body.task.dueDate).toBeUndefined();
  });

  it("returns the same accepted task on retries without changing its title or modification time", async () => {
    const item = await capture();
    const first = await accept(item.id, "Chosen title").expect(201);
    const repeated = await accept(item.id, "Different retry title").expect(200);
    expect(repeated.body).toEqual({ task: first.body.task, created: false });
    expect(await prisma.todo.count({ where: { userId } })).toBe(1);
  });

  it("serializes concurrent acceptance into one task", async () => {
    const item = await capture();
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => accept(item.id)),
    );
    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 200, 200, 200, 201,
    ]);
    expect(
      new Set(responses.map((response) => response.body.task.id)).size,
    ).toBe(1);
    expect(responses.filter((response) => response.body.created)).toHaveLength(
      1,
    );
    expect(await prisma.todo.count({ where: { userId } })).toBe(1);
  });

  it("preserves canonical task ordering when different captures are accepted concurrently", async () => {
    const items = await Promise.all([
      capture("First action"),
      capture("Second action"),
      capture("Third action"),
    ]);
    await Promise.all(items.map((item) => accept(item.id)));
    const tasks = await prisma.todo.findMany({
      where: { userId },
      orderBy: { order: "asc" },
    });
    expect(tasks.map((task) => task.order)).toEqual([0, 1, 2]);
  });

  it("discards once and refuses later acceptance", async () => {
    const item = await capture();
    const first = await discard(item.id).expect(200);
    const repeated = await discard(item.id).expect(200);
    expect(first.body.lifecycle).toBe("discarded");
    expect(repeated.body).toEqual(first.body);
    await accept(item.id).expect(409);
    expect(await prisma.todo.count({ where: { userId } })).toBe(0);
  });

  it("rejects discard after acceptance and preserves immutable promotion metadata", async () => {
    const item = await capture();
    const accepted = await accept(item.id).expect(201);
    await discard(item.id).expect(409);
    const attemptedReset = await request(app)
      .patch(`/capture/${item.id}`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({ lifecycle: "new", triageResult: {} })
      .expect(200);
    expect(attemptedReset.body.lifecycle).toBe("triaged");
    expect(attemptedReset.body.triageResult.promotedId).toBe(
      accepted.body.task.id,
    );
    const again = await accept(item.id).expect(200);
    expect(again.body.task.id).toBe(accepted.body.task.id);
  });

  it.each(["new", "triaged"] as const)(
    "preserves explicit legacy restore to %s while agent triage cannot resurrect a discard",
    async (lifecycle) => {
      const item = await capture();
      await discard(item.id).expect(200);
      const triage = await request(app)
        .post("/agent/write/triage_capture_item")
        .set("Authorization", `Bearer ${authToken}`)
        .send({ captureItemId: item.id, mode: "apply" })
        .expect(200);
      expect(triage.body.data.applied).toBe(false);
      await accept(item.id).expect(409);
      const restored = await request(app)
        .patch(`/capture/${item.id}`)
        .set("Authorization", `Bearer ${authToken}`)
        .send({ lifecycle })
        .expect(200);
      expect(restored.body.lifecycle).toBe(lifecycle);
      await accept(item.id).expect(201);
    },
  );

  function agentCapture(key: string, text: string, token = authToken) {
    return request(app)
      .post("/agent/write/capture_inbox_item")
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", key)
      .send({ text, source: "api" });
  }

  function publicCapture(key: string, text: string, token: string, id: number) {
    return request(app)
      .post("/mcp/app")
      .set("Authorization", `Bearer ${token}`)
      .set("Accept", "application/json, text/event-stream")
      .send({
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: {
          name: "capture_task",
          arguments: { text, idempotencyKey: key },
        },
      });
  }

  it.each(["tasks.read", "tasks.write"] as const)(
    "rejects %s MCP tokens on web-only review writes without changing records",
    async (scope) => {
      const item = await capture();
      const token = await nativeMcpToken([scope]);
      const before = await reviewSnapshot();
      for (const action of ["accept", "discard"]) {
        const response = await request(app)
          .post(`/capture/${item.id}/${action}`)
          .set("Authorization", `Bearer ${token}`)
          .send(action === "accept" ? { title: "Unapproved task" } : {})
          .expect(401);
        expect(response.body.error).toBe("Invalid token");
        expect(await reviewSnapshot()).toEqual(before);
      }
      expect(
        (await prisma.captureItem.findUniqueOrThrow({ where: { id: item.id } }))
          .lifecycle,
      ).toBe("new");
      expect(await prisma.todo.count({ where: { userId } })).toBe(0);
      // The normal web token can still review the same capture.
      await accept(item.id).expect(201);
    },
  );

  function mcpBody(response: request.Response) {
    if (response.body && Object.keys(response.body).length)
      return response.body;
    const event = response.text
      .split("\n")
      .find((line) => line.startsWith("data: "));
    if (!event) throw new Error("Missing MCP response event");
    return JSON.parse(event.slice(6));
  }

  it("atomically saves one raw capture across concurrent public MCP and agent retries", async () => {
    const token = await nativeMcpToken(["tasks.write"]);
    const key = "concurrent-shared-capture";
    const text = "Call the dentist tomorrow";
    const [first, second, third, fourth] = await Promise.all([
      publicCapture(key, text, token, 101),
      publicCapture(key, text, token, 102),
      agentCapture(key, text),
      agentCapture(key, text),
    ]);
    const publicResults = [mcpBody(first).result, mcpBody(second).result];
    expect(publicResults.every((result) => !result.isError)).toBe(true);
    expect([third.status, fourth.status]).toEqual([201, 201]);
    const ids = [
      ...publicResults.map((result) => result.structuredContent.capture.id),
      third.body.data.item.id,
      fourth.body.data.item.id,
    ];
    expect(new Set(ids).size).toBe(1);
    const creations =
      publicResults.filter((result) => result.structuredContent.created)
        .length +
      [third, fourth].filter((response) => !response.body.trace.replayed)
        .length;
    expect(creations).toBe(1);
    expect(await prisma.captureItem.count({ where: { userId } })).toBe(1);
    expect(
      await prisma.agentIdempotencyRecord.count({
        where: { userId, idempotencyKey: key },
      }),
    ).toBe(1);
    const replay = await publicCapture(key, text, token, 103).expect(200);
    expect(mcpBody(replay).result.structuredContent).toMatchObject({
      created: false,
      capture: { id: ids[0], text, lifecycle: "new" },
    });
    const accepted = await accept(ids[0], "Call the dentist").expect(201);
    expect(accepted.body.task).toMatchObject({
      title: "Call the dentist",
      sourceText: text,
      status: "next",
    });
    const afterReview = await publicCapture(key, text, token, 104).expect(200);
    expect(mcpBody(afterReview).result.isError).not.toBe(true);
    expect(mcpBody(afterReview).result.structuredContent.created).toBe(false);
    expect(
      await prisma.captureItem.findUniqueOrThrow({ where: { id: ids[0] } }),
    ).toMatchObject({
      lifecycle: "triaged",
      triageResult: {
        promotedAs: "task",
        promotedId: accepted.body.task.id,
      },
    });
    const pending = await request(app)
      .get("/capture?review=pending")
      .set("Authorization", `Bearer ${authToken}`)
      .expect(200);
    expect(pending.body).toEqual([]);
    expect(await prisma.todo.count({ where: { userId } })).toBe(1);
  });

  it("conflicts concurrent reuse of a raw capture key with different input", async () => {
    const results = await Promise.all([
      agentCapture("conflicting-capture", "Call the dentist"),
      agentCapture("conflicting-capture", "Review the draft"),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    expect(
      results.find((result) => result.status === 409)?.body.error.code,
    ).toBe("IDEMPOTENCY_CONFLICT");
    expect(await prisma.captureItem.count({ where: { userId } })).toBe(1);
    expect(
      await prisma.agentIdempotencyRecord.count({ where: { userId } }),
    ).toBe(1);
  });

  it("isolates raw capture retry receipts between accounts", async () => {
    const other = await request(app)
      .post("/auth/register")
      .send({
        email: "other-receipt@example.com",
        password: "password123",
        name: "Other",
      })
      .expect(201);
    const [first, second] = await Promise.all([
      agentCapture("same-account-local-key", "Same action"),
      agentCapture("same-account-local-key", "Same action", other.body.token),
    ]);
    expect([first.status, second.status]).toEqual([201, 201]);
    expect(first.body.data.item.id).not.toBe(second.body.data.item.id);
    expect(await prisma.captureItem.count()).toBe(2);
    expect(await prisma.agentIdempotencyRecord.count()).toBe(2);
  });

  it("rolls back a raw capture if its retry receipt cannot be saved", async () => {
    const failure = jest
      .spyOn(AgentIdempotencyService.prototype, "store")
      .mockRejectedValueOnce(new Error("Synthetic receipt failure"));
    try {
      await agentCapture("failed-receipt", "Call the dentist").expect(500);
      expect(await prisma.captureItem.count({ where: { userId } })).toBe(0);
      expect(
        await prisma.agentIdempotencyRecord.count({ where: { userId } }),
      ).toBe(0);
    } finally {
      failure.mockRestore();
    }
    const retried = await agentCapture(
      "failed-receipt",
      "Call the dentist",
    ).expect(201);
    expect(retried.body.trace.replayed).toBeUndefined();
    expect(await prisma.captureItem.count({ where: { userId } })).toBe(1);
  });

  it("preserves promotion when legacy single and batch triage race with acceptance", async () => {
    const items = await Promise.all([
      capture("Call the team"),
      capture("Review the report"),
    ]);
    const results = await Promise.all([
      ...items.map((item) => accept(item.id)),
      request(app)
        .post("/agent/write/triage_capture_item")
        .set("Authorization", `Bearer ${authToken}`)
        .send({ captureItemId: items[0].id, mode: "apply" }),
      request(app)
        .post("/agent/write/triage_inbox")
        .set("Authorization", `Bearer ${authToken}`)
        .send({ mode: "apply" }),
    ]);
    expect(results.map((result) => result.status)).toEqual([
      201, 201, 200, 200,
    ]);
    for (const item of items) {
      const stored = await prisma.captureItem.findUniqueOrThrow({
        where: { id: item.id },
      });
      expect(stored.lifecycle).toBe("triaged");
      expect(stored.triageResult).toMatchObject({
        promotedAs: "task",
        promotedId: expect.any(String),
      });
      await accept(item.id).expect(200);
    }
    expect(await prisma.todo.count({ where: { userId } })).toBe(2);
  });

  it("resolves concurrent accept and discard to one terminal decision", async () => {
    const item = await capture();
    const [accepted, discarded] = await Promise.all([
      accept(item.id),
      discard(item.id),
    ]);
    const stored = await prisma.captureItem.findUniqueOrThrow({
      where: { id: item.id },
    });
    if (accepted.status === 201) {
      expect(discarded.status).toBe(409);
      expect(stored.lifecycle).toBe("triaged");
      expect(await prisma.todo.count({ where: { userId } })).toBe(1);
    } else {
      expect(accepted.status).toBe(409);
      expect(discarded.status).toBe(200);
      expect(stored.lifecycle).toBe("discarded");
      expect(await prisma.todo.count({ where: { userId } })).toBe(0);
    }
  });

  it("isolates capture retrieval, acceptance, discard and pending review by account", async () => {
    const item = await capture();
    const other = await request(app)
      .post("/auth/register")
      .send({
        email: "other-capture@example.com",
        password: "password123",
        name: "Other",
      })
      .expect(201);
    const otherToken = other.body.token;
    for (const [method, path] of [
      ["get", `/capture/${item.id}`],
      ["post", `/capture/${item.id}/accept`],
      ["post", `/capture/${item.id}/discard`],
    ] as const) {
      await request(app)
        [method](path)
        .set("Authorization", `Bearer ${otherToken}`)
        .send({})
        .expect(404);
    }
    const pending = await request(app)
      .get("/capture?review=pending")
      .set("Authorization", `Bearer ${otherToken}`)
      .expect(200);
    expect(pending.body).toEqual([]);
    expect(
      (await prisma.captureItem.findUniqueOrThrow({ where: { id: item.id } }))
        .lifecycle,
    ).toBe("new");
    expect(await prisma.todo.count()).toBe(0);
  });

  it("keeps legacy agent promotion compatible and shares web acceptance retry safety", async () => {
    const item = await capture();
    const promoted = await request(app)
      .post("/agent/write/promote_inbox_item")
      .set("Authorization", `Bearer ${authToken}`)
      .send({ captureItemId: item.id, type: "task" })
      .expect(201);
    expect(promoted.body.data.type).toBe("task");
    expect(promoted.body.data.task.status).toBe("inbox");
    const accepted = await accept(item.id).expect(200);
    expect(accepted.body.task.id).toBe(promoted.body.data.task.id);
    expect(accepted.body.created).toBe(false);
    expect(await prisma.todo.count({ where: { userId } })).toBe(1);
  });

  it("rolls back acceptance when a legacy promotion references another account's project", async () => {
    const item = await capture();
    const other = await prisma.user.create({
      data: {
        email: "foreign-project@example.com",
        password: "unused",
        name: "Other",
      },
    });
    const project = await prisma.project.create({
      data: { userId: other.id, name: "Private project" },
    });
    await request(app)
      .post("/agent/write/promote_inbox_item")
      .set("Authorization", `Bearer ${authToken}`)
      .send({ captureItemId: item.id, type: "task", projectId: project.id })
      .expect(404);
    expect(await prisma.todo.count({ where: { userId } })).toBe(0);
    expect(
      (await prisma.captureItem.findUniqueOrThrow({ where: { id: item.id } }))
        .lifecycle,
    ).toBe("new");
  });

  it("promotes a legacy project only once and rejects task acceptance of it", async () => {
    const item = await capture("A new project");
    const promote = () =>
      request(app)
        .post("/agent/write/promote_inbox_item")
        .set("Authorization", `Bearer ${authToken}`)
        .send({ captureItemId: item.id, type: "project" });
    const results = await Promise.all([promote(), promote()]);
    expect(results.map((response) => response.status).sort()).toEqual([
      200, 201,
    ]);
    expect(results[0].body.data.project.id).toBe(
      results[1].body.data.project.id,
    );
    expect(await prisma.project.count({ where: { userId } })).toBe(1);
    await accept(item.id).expect(409);
    await discard(item.id).expect(409);
  });

  it.each([
    { type: "task", title: "x".repeat(201), limit: 200 },
    { type: "project", title: "x".repeat(51), limit: 50 },
  ])(
    "returns a controlled error for legacy titles beyond the existing database limit",
    async ({ type, title, limit }) => {
      const item = await capture();
      const response = await request(app)
        .post("/agent/write/promote_inbox_item")
        .set("Authorization", `Bearer ${authToken}`)
        .send({ captureItemId: item.id, type, title })
        .expect(400);
      expect(response.body.error.message).toBe(
        `title must contain 1 to ${limit} characters`,
      );
      expect(await prisma.todo.count({ where: { userId } })).toBe(0);
      expect(await prisma.project.count({ where: { userId } })).toBe(0);
      expect(
        (await prisma.captureItem.findUniqueOrThrow({ where: { id: item.id } }))
          .lifecycle,
      ).toBe("new");
    },
  );

  it.each([
    { title: "   " },
    { title: "x".repeat(201) },
    { title: 123 },
    { projectId: "ignored" },
  ])(
    "rejects invalid acceptance input %j without creating a task",
    async (body) => {
      const item = await capture();
      await request(app)
        .post(`/capture/${item.id}/accept`)
        .set("Authorization", `Bearer ${authToken}`)
        .send(body)
        .expect(400);
      expect(await prisma.todo.count({ where: { userId } })).toBe(0);
    },
  );
});
