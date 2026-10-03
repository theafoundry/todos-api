import fs from "fs";
import path from "path";
import request from "supertest";
import { createApp } from "./app";
import { AgentExecutor } from "./agent/agentExecutor";
import {
  buildNativeAppToolsList,
  MCP_APP_SERVER_INSTRUCTIONS,
  MCP_APP_SERVER_NAME,
  MCP_APP_SERVER_VERSION,
  nativeAppToolDefinitions,
  TODAY_PLAN_RESOURCE_URI,
} from "./mcp/appContract";
import {
  executeNativeAppTool,
  formatCalendarDate,
  isValidIanaTimezone,
  resolveNativeAppTimezone,
} from "./mcp/appTools";
import {
  buildTodayPlanResourceContents,
  TODAY_PLAN_RESOURCE_DESCRIPTOR,
  TODAY_PLAN_RESOURCE_META,
  TODAY_PLAN_RESOURCE_MIME_TYPE,
  TODAY_PLAN_WIDGET_DOMAIN,
} from "./mcp/todayPlanResource";
import { AuthService } from "./services/authService";
import { DayContextService } from "./services/dayContextService";
import { TodoService } from "./services/todoService";
const {
  applyApprovedSubmissionChanges,
} = require("../test/helpers/mcp-approved-submission-contract");

const mcpHeaders = {
  Accept: "application/json, text/event-stream",
  "Content-Type": "application/json",
};

function parseMcpResponse(response: request.Response) {
  if (response.body && Object.keys(response.body).length > 0) {
    return response.body;
  }
  const dataLine = response.text
    .split("\n")
    .find((line) => line.startsWith("data: "));
  if (!dataLine)
    throw new Error("MCP response did not contain an SSE data event");
  return JSON.parse(dataLine.slice("data: ".length));
}

describe("ChatGPT-native MCP app profile", () => {
  const taskId = "00000000-0000-4000-8000-000000000010";
  const task = {
    id: taskId,
    title: "Review launch plan",
    status: "next",
    completed: false,
    dueDate: "2026-08-11T16:00:00.000Z",
    scheduledDate: null,
    priority: "high",
    estimateMinutes: 30,
    energy: "medium",
    projectId: null,
    userId: "must-not-leak",
    notes: "must-not-leak",
  };
  const runtime = (execute: jest.Mock) => ({
    agentExecutor: { execute } as any,
    userId: "user-1",
    requestId: "request-1",
    actor: "ChatGPT",
  });

  test("preserves Phase 1 tool metadata except the two approved destructive annotations", () => {
    const snapshot = JSON.parse(
      fs.readFileSync(
        path.join(
          process.cwd(),
          "test/fixtures/mcp-app-tools-list.phase1.json",
        ),
        "utf8",
      ),
    );

    expect(buildNativeAppToolsList().slice(0, 5)).toEqual(
      applyApprovedSubmissionChanges(snapshot.tools),
    );
    expect(snapshot.tools.map((tool: { name: string }) => tool.name)).toEqual([
      "list_today",
      "plan_today",
      "capture_task",
      "complete_task",
      "reschedule_task",
    ]);
    for (const tool of snapshot.tools) {
      expect(tool.outputSchema.type).toBe("object");
      expect(tool._meta.securitySchemes).toEqual(tool.securitySchemes);
    }
  });

  test("extension metadata preserves the reviewed six-tool contract with only approved submission deltas", () => {
    const reviewedSnapshot = JSON.parse(
      fs.readFileSync(
        path.join(process.cwd(), "test/fixtures/mcp-app-metadata.phase2.json"),
        "utf8",
      ),
    );
    const snapshot = JSON.parse(
      fs.readFileSync(
        path.join(
          process.cwd(),
          "test/fixtures/mcp-app-metadata.extensions.json",
        ),
        "utf8",
      ),
    );
    const tools = buildNativeAppToolsList();

    expect({
      server: {
        name: MCP_APP_SERVER_NAME,
        version: MCP_APP_SERVER_VERSION,
        instructions: MCP_APP_SERVER_INSTRUCTIONS,
      },
      tools,
      resources: [TODAY_PLAN_RESOURCE_DESCRIPTOR],
      resourceContents: [
        {
          uri: TODAY_PLAN_RESOURCE_URI,
          mimeType: TODAY_PLAN_RESOURCE_MIME_TYPE,
          _meta: TODAY_PLAN_RESOURCE_META,
        },
      ],
    }).toEqual(snapshot);
    expect(tools.slice(0, 6)).toEqual(
      applyApprovedSubmissionChanges(reviewedSnapshot.tools),
    );
    expect(tools.map((tool) => tool.name)).toEqual([
      "list_today",
      "plan_today",
      "capture_task",
      "complete_task",
      "reschedule_task",
      "render_today_plan",
      "open_today_plan",
    ]);
    expect(tools.filter((tool) => "ui" in tool._meta)).toEqual([
      expect.objectContaining({
        name: "render_today_plan",
        _meta: expect.objectContaining({
          ui: { resourceUri: TODAY_PLAN_RESOURCE_URI },
        }),
      }),
      expect.objectContaining({
        name: "open_today_plan",
        title: "Today Plan",
        _meta: expect.objectContaining({
          ui: {
            resourceUri: TODAY_PLAN_RESOURCE_URI,
            visibility: ["app"],
          },
          "openai/ui": { entrypoints: [{ type: "thread" }] },
        }),
      }),
    ]);
    expect(TODAY_PLAN_RESOURCE_META.ui.domain).toBe(TODAY_PLAN_WIDGET_DOMAIN);
    expect(TODAY_PLAN_WIDGET_DOMAIN).toBe("https://todos.theafoundry.com");
  });

  test("declares one strict, read-only thread entrypoint with no planning defaults", () => {
    const tools = buildNativeAppToolsList();
    const opener = tools.find((tool) => tool.name === "open_today_plan")!;
    const definition = nativeAppToolDefinitions.find(
      (tool) => tool.name === "open_today_plan",
    )!;

    expect(opener.inputSchema).toEqual({
      type: "object",
      properties: {},
      additionalProperties: false,
    });
    expect(opener._meta).toEqual({
      securitySchemes: [
        { type: "oauth2", scopes: ["tasks.read", "projects.read"] },
      ],
      ui: { resourceUri: TODAY_PLAN_RESOURCE_URI, visibility: ["app"] },
      "openai/ui": { entrypoints: [{ type: "thread" }] },
      "openai/toolInvocation/invoking": "Running today plan…",
      "openai/toolInvocation/invoked": "Today Plan complete",
    });
    expect(opener.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    expect(tools.filter((tool) => "openai/ui" in tool._meta)).toEqual([opener]);
    expect(definition.inputSchema.safeParse({}).success).toBe(true);
    for (const argumentsValue of [
      { date: "2026-10-02" },
      { availableMinutes: 120 },
      { energy: "medium" },
      { userId: "other-user" },
      { taskIds: [taskId] },
    ]) {
      expect(definition.inputSchema.safeParse(argumentsValue).success).toBe(
        false,
      );
    }
    const setup = { state: "setup", date: "2026-10-02", timezone: "UTC" };
    expect(definition.outputSchema.safeParse(setup).success).toBe(true);
    expect(
      definition.outputSchema.safeParse({ ...setup, tasks: [task] }).success,
    ).toBe(false);
  });

  test("opens setup with the account calendar without fetching tasks or planning", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-10-02T12:00:00Z"));
    const execute = jest.fn();
    const findProjects = jest.fn();
    const enrollmentTimezone = jest
      .fn()
      .mockResolvedValue({ timezone: "Pacific/Kiritimati" });
    const sessionTimezone = jest
      .fn()
      .mockResolvedValue({ timezone: "America/Los_Angeles" });

    try {
      const result = await executeNativeAppTool(
        "open_today_plan",
        {},
        {
          ...runtime(execute),
          sessionId: "private-session",
          projectService: { findAll: findProjects } as any,
          prisma: {
            agentEnrollment: { findUnique: enrollmentTimezone },
            mcpAssistantSession: { findUnique: sessionTimezone },
          } as any,
        },
      );

      expect(result).toEqual({
        state: "setup",
        date: "2026-10-03",
        timezone: "Pacific/Kiritimati",
      });
      expect(execute).not.toHaveBeenCalled();
      expect(findProjects).not.toHaveBeenCalled();
      expect(enrollmentTimezone).toHaveBeenCalledWith({
        where: { userId: "user-1" },
        select: { timezone: true },
      });
      expect(sessionTimezone).toHaveBeenCalledWith({
        where: { id: "private-session" },
        select: { timezone: true },
      });
      expect(JSON.stringify(result)).not.toMatch(
        /user-1|private-session|request-1|task|email|token|trace|availableMinutes|energy/,
      );
    } finally {
      jest.useRealTimers();
    }
  });

  test("requires account linking before opening the thread panel", async () => {
    const verifyMcpToken = jest.fn();
    const getPrismaClient = jest.fn();
    const execute = jest.spyOn(AgentExecutor.prototype, "execute");

    try {
      const response = await request(
        createApp({
          authService: { verifyMcpToken, getPrismaClient } as any,
        }),
      )
        .post("/mcp/app")
        .set(mcpHeaders)
        .send({
          jsonrpc: "2.0",
          id: 23,
          method: "tools/call",
          params: { name: "open_today_plan", arguments: {} },
        });
      const result = parseMcpResponse(response).result;

      expect(response.status).toBe(200);
      expect(result.isError).toBe(true);
      expect(result.structuredContent.error.code).toBe("MCP_UNAUTHENTICATED");
      expect(result._meta["mcp/www_authenticate"][0]).toContain(
        'scope="tasks.read projects.read"',
      );
      expect(verifyMcpToken).not.toHaveBeenCalled();
      expect(getPrismaClient).not.toHaveBeenCalled();
      expect(execute).not.toHaveBeenCalled();
    } finally {
      execute.mockRestore();
    }
  });

  test.each([
    { label: "no task scopes", scopes: [] },
    { label: "only task read", scopes: ["tasks.read"] },
    { label: "only project read", scopes: ["projects.read"] },
    { label: "identity scopes", scopes: ["openid", "email"] },
  ])("denies the panel opener with $label", async ({ scopes }) => {
    const getPrismaClient = jest.fn();
    const execute = jest.spyOn(AgentExecutor.prototype, "execute");
    const authService = {
      verifyMcpToken: jest.fn().mockResolvedValue({
        userId: "user-1",
        email: "synthetic@example.com",
        tokenType: "mcp",
        scopes,
        resource: "http://localhost:3000/mcp/app",
      }),
      getUserById: jest.fn().mockResolvedValue({
        id: "user-1",
        email: "synthetic@example.com",
        name: "Synthetic User",
        isVerified: true,
        role: "user",
        plan: "free",
      }),
      getPrismaClient,
    } as any;

    try {
      const response = await request(createApp({ authService }))
        .post("/mcp/app")
        .set(mcpHeaders)
        .set("Authorization", "Bearer synthetic-panel-token")
        .send({
          jsonrpc: "2.0",
          id: 24,
          method: "tools/call",
          params: { name: "open_today_plan", arguments: {} },
        });
      const result = parseMcpResponse(response).result;

      expect(result.isError).toBe(true);
      expect(result.structuredContent.error.code).toBe(
        "MCP_INSUFFICIENT_SCOPE",
      );
      expect(result._meta["mcp/www_authenticate"][0]).toContain(
        'error="insufficient_scope"',
      );
      expect(result._meta["mcp/www_authenticate"][0]).toContain(
        'scope="tasks.read projects.read"',
      );
      expect(authService.verifyMcpToken).toHaveBeenCalledWith(
        "synthetic-panel-token",
        {
          resource: "http://localhost:3000/mcp/app",
          requireResource: true,
        },
      );
      expect(getPrismaClient).not.toHaveBeenCalled();
      expect(execute).not.toHaveBeenCalled();
    } finally {
      execute.mockRestore();
    }
  });

  test("returns only setup and a usable text fallback after scoped panel opening", async () => {
    const execute = jest.spyOn(AgentExecutor.prototype, "execute");
    const authService = {
      verifyMcpToken: jest.fn().mockResolvedValue({
        userId: "private-user",
        email: "synthetic@example.com",
        tokenType: "mcp",
        scopes: ["tasks.read", "projects.read"],
        resource: "http://localhost:3000/mcp/app",
      }),
      getUserById: jest.fn().mockResolvedValue({
        id: "private-user",
        email: "synthetic@example.com",
        name: "Synthetic User",
        isVerified: true,
        role: "user",
        plan: "free",
      }),
      getPrismaClient: () => undefined,
    } as any;

    try {
      const response = await request(createApp({ authService }))
        .post("/mcp/app")
        .set(mcpHeaders)
        .set("Authorization", "Bearer synthetic-panel-token")
        .send({
          jsonrpc: "2.0",
          id: 25,
          method: "tools/call",
          params: { name: "open_today_plan", arguments: {} },
        });
      const result = parseMcpResponse(response).result;

      expect(response.status).toBe(200);
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toEqual({
        state: "setup",
        date: formatCalendarDate(new Date(), "America/New_York"),
        timezone: "America/New_York",
      });
      expect(result.content).toEqual([
        {
          type: "text",
          text: expect.stringMatching(
            /^Today Plan is ready for \d{4}-\d{2}-\d{2} in America\/New_York\. Choose your available minutes and energy to create a plan\.$/,
          ),
        },
      ]);
      expect(execute).not.toHaveBeenCalled();
      expect(JSON.stringify(result)).not.toMatch(
        /private-user|synthetic@example.com|synthetic-panel-token|requestId|trace/,
      );
    } finally {
      execute.mockRestore();
    }
  });

  test("every advertised output schema accepts the shared tool error contract", () => {
    const errorResult = {
      error: {
        code: "MCP_UNAUTHENTICATED",
        message: "Authorization header missing",
        retryable: false,
        hint: "Complete account linking and retry.",
      },
    };

    for (const tool of nativeAppToolDefinitions) {
      expect(tool.outputSchema.safeParse(errorResult).success).toBe(true);
    }
  });

  test("supports unauthenticated initialize and tool discovery", async () => {
    const app = createApp();
    const initialize = await request(app)
      .post("/mcp/app")
      .set(mcpHeaders)
      .send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "contract-test", version: "1.0.0" },
        },
      });
    expect(initialize.status).toBe(200);
    expect(parseMcpResponse(initialize).result.serverInfo).toEqual({
      name: MCP_APP_SERVER_NAME,
      version: MCP_APP_SERVER_VERSION,
    });

    const list = await request(app)
      .post("/mcp/app")
      .set(mcpHeaders)
      .send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    expect(list.status).toBe(200);
    expect(parseMcpResponse(list).result.tools).toEqual(
      buildNativeAppToolsList(),
    );

    const resources = await request(app)
      .post("/mcp/app")
      .set(mcpHeaders)
      .send({ jsonrpc: "2.0", id: 21, method: "resources/list", params: {} });
    expect(resources.status).toBe(200);
    expect(parseMcpResponse(resources).result.resources).toEqual([
      TODAY_PLAN_RESOURCE_DESCRIPTOR,
    ]);

    const read = await request(app)
      .post("/mcp/app")
      .set(mcpHeaders)
      .send({
        jsonrpc: "2.0",
        id: 22,
        method: "resources/read",
        params: { uri: TODAY_PLAN_RESOURCE_URI },
      });
    expect(read.status).toBe(200);
    const resource = parseMcpResponse(read).result.contents[0];
    expect(resource).toMatchObject({
      uri: TODAY_PLAN_RESOURCE_URI,
      mimeType: TODAY_PLAN_RESOURCE_MIME_TYPE,
      _meta: TODAY_PLAN_RESOURCE_META,
    });
    expect(resource.text).toContain('request("ui/initialize"');
    expect(resource.text).toContain('request("tools/call"');
    expect(resource.text).not.toMatch(/fetch\s*\(|XMLHttpRequest|<iframe/i);
    expect(resource.text).not.toMatch(
      /access[_-]?token|refresh[_-]?token|sessionId|userId|window\.openai/i,
    );
  });

  test("returns an MCP authorization challenge for unauthenticated tool calls", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/mcp/app")
      .set(mcpHeaders)
      .send({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "list_today", arguments: {} },
      });

    expect(response.status).toBe(200);
    const body = parseMcpResponse(response);
    expect(body.result.isError).toBe(true);
    expect(body.result.structuredContent.error.code).toBe("MCP_NOT_CONFIGURED");
    expect(body.result._meta["mcp/www_authenticate"][0]).toContain(
      "/.well-known/oauth-protected-resource/mcp/app",
    );
    expect(body.result._meta["mcp/www_authenticate"][0]).toContain(
      'error="invalid_token"',
    );
    expect(body.result._meta["mcp/www_authenticate"][0]).toContain(
      'error_description="MCP authentication is not configured"',
    );
    expect(body.result._meta["mcp/www_authenticate"][0]).toContain(
      'scope="tasks.read projects.read"',
    );
  });

  test("returns a scoped MCP challenge before invoking a write tool", async () => {
    const authService = {
      verifyMcpToken: jest.fn().mockResolvedValue({
        userId: "user-1",
        email: "user@example.com",
        tokenType: "mcp",
        scopes: ["tasks.read"],
        resource: "http://localhost:3000/mcp/app",
      }),
      getUserById: jest.fn().mockResolvedValue({
        id: "user-1",
        email: "user@example.com",
        name: "User",
        isVerified: true,
        role: "user",
        plan: "free",
      }),
      getPrismaClient: () => undefined,
    } as any;
    const response = await request(createApp({ authService }))
      .post("/mcp/app")
      .set(mcpHeaders)
      .set("Authorization", "Bearer read-only-token")
      .send({
        jsonrpc: "2.0",
        id: 31,
        method: "tools/call",
        params: {
          name: "capture_task",
          arguments: { text: "Call the dentist", idempotencyKey: "capture-1" },
        },
      });
    const body = parseMcpResponse(response);
    const challenge = body.result._meta["mcp/www_authenticate"][0];

    expect(body.result.structuredContent.error.code).toBe(
      "MCP_INSUFFICIENT_SCOPE",
    );
    expect(challenge).toContain('error="insufficient_scope"');
    expect(challenge).toContain('scope="tasks.write"');
  });

  test("executes a scoped tool and returns only the public DTO", async () => {
    const todoService = new TodoService();
    const timezone = "America/New_York";
    const date = formatCalendarDate(new Date(), timezone);
    const dueDate = new Date(`${date}T16:00:00.000Z`);
    const task = await todoService.create("user-1", {
      title: "Review the public contract",
      dueDate,
      priority: "high",
      estimateMinutes: 30,
      energy: "medium",
    });
    const authService = {
      verifyMcpToken: jest.fn().mockResolvedValue({
        userId: "user-1",
        email: "user@example.com",
        tokenType: "mcp",
        scopes: ["tasks.read", "projects.read"],
        resource: "http://localhost:3000/mcp/app",
      }),
      getUserById: jest.fn().mockResolvedValue({
        id: "user-1",
        email: "user@example.com",
        name: "User",
        isVerified: true,
        role: "user",
        plan: "free",
      }),
      getPrismaClient: () => undefined,
    } as any;
    const response = await request(createApp({ todoService, authService }))
      .post("/mcp/app")
      .set(mcpHeaders)
      .set("Authorization", "Bearer native-token")
      .send({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "list_today", arguments: {} },
      });
    const body = parseMcpResponse(response);

    expect(response.status).toBe(200);
    expect(body.result.isError).not.toBe(true);
    expect(body.result.content).toEqual([
      {
        type: "text",
        text: expect.stringMatching(/^Found 1 task for \d{4}-\d{2}-\d{2}\.$/),
      },
    ]);
    expect(body.result.structuredContent.tasks).toEqual([
      expect.objectContaining({
        id: task.id,
        title: task.title,
        project: null,
      }),
    ]);
    expect(body.result.structuredContent).not.toHaveProperty("trace");
    expect(JSON.stringify(body.result.structuredContent)).not.toContain(
      "user-1",
    );
  });

  test("publishes exact protected-resource metadata", async () => {
    const response = await request(createApp()).get(
      "/.well-known/oauth-protected-resource/mcp/app",
    );
    expect(response.status).toBe(200);
    expect(response.body.resource).toBe("http://localhost:3000/mcp/app");
    expect(response.body.scopes_supported).toEqual([
      "tasks.read",
      "tasks.write",
      "projects.read",
    ]);
  });

  test("accepts scoped synthetic mutations with normalized retries and unchanged reopening semantics", async () => {
    const todoService = new TodoService();
    const synthetic = await todoService.create("review-user", {
      title: "Synthetic review acceptance",
      status: "waiting",
      dueDate: new Date("2026-08-11T16:00:00.000Z"),
    });
    const update = jest.spyOn(todoService, "update");
    const authService = {
      verifyMcpToken: jest.fn().mockResolvedValue({
        userId: "review-user",
        email: "synthetic@example.com",
        tokenType: "mcp",
        scopes: ["tasks.read", "tasks.write", "projects.read"],
        resource: "http://localhost:3000/mcp/app",
      }),
      getUserById: jest.fn().mockResolvedValue({
        id: "review-user",
        email: "synthetic@example.com",
        name: "Synthetic reviewer",
        isVerified: true,
        role: "user",
        plan: "free",
      }),
      getPrismaClient: () => undefined,
    } as any;
    const app = createApp({ todoService, authService });
    const call = async (
      name: string,
      argumentsValue: Record<string, unknown>,
    ) => {
      const response = await request(app)
        .post("/mcp/app")
        .set(mcpHeaders)
        .set("Authorization", "Bearer synthetic-local-review-token")
        .send({
          jsonrpc: "2.0",
          id: 91,
          method: "tools/call",
          params: { name, arguments: argumentsValue },
        });
      expect(response.status).toBe(200);
      const result = parseMcpResponse(response).result;
      expect(result.isError).not.toBe(true);
      return result.structuredContent;
    };
    const reschedule = {
      taskId: synthetic.id,
      scheduledDate: "2026-08-12T09:00:00-04:00",
    };
    expect(await call("reschedule_task", reschedule)).toMatchObject({
      changed: true,
      task: {
        scheduledDate: "2026-08-12T13:00:00.000Z",
        dueDate: "2026-08-11T16:00:00.000Z",
        status: "waiting",
        completed: false,
      },
    });
    const written = await todoService.findById("review-user", synthetic.id);
    expect(await call("reschedule_task", reschedule)).toMatchObject({
      changed: false,
    });
    expect(update).toHaveBeenCalledTimes(1);
    expect(
      (await todoService.findById("review-user", synthetic.id))?.updatedAt,
    ).toEqual(written?.updatedAt);
    const clear = { taskId: synthetic.id, scheduledDate: null };
    expect(await call("reschedule_task", clear)).toMatchObject({
      changed: true,
      task: { scheduledDate: null, dueDate: "2026-08-11T16:00:00.000Z" },
    });
    expect(await call("reschedule_task", clear)).toMatchObject({
      changed: false,
    });
    expect(update).toHaveBeenCalledTimes(2);

    const complete = { taskId: synthetic.id, completed: true };
    expect(await call("complete_task", complete)).toMatchObject({
      changed: true,
      task: { status: "done", completed: true },
    });
    expect(
      (await todoService.findById("review-user", synthetic.id))?.completedAt,
    ).toBeInstanceOf(Date);
    expect(await call("complete_task", complete)).toMatchObject({
      changed: false,
    });
    const reopen = { taskId: synthetic.id, completed: false };
    expect(await call("complete_task", reopen)).toMatchObject({
      changed: true,
      task: { status: "next", completed: false },
    });
    expect(
      (await todoService.findById("review-user", synthetic.id))?.completedAt,
    ).toBeUndefined();
    expect(await call("complete_task", reopen)).toMatchObject({
      changed: false,
    });
    expect(update).toHaveBeenCalledTimes(4);
  });

  test("uses deterministic IANA timezone calendar dates", async () => {
    expect(isValidIanaTimezone("Pacific/Kiritimati")).toBe(true);
    expect(isValidIanaTimezone("not/a-timezone")).toBe(false);
    expect(
      formatCalendarDate(
        new Date("2026-01-01T10:30:00.000Z"),
        "Pacific/Honolulu",
      ),
    ).toBe("2026-01-01");
    await expect(
      resolveNativeAppTimezone({
        userId: "00000000-0000-4000-8000-000000000000",
        serverDefault: "Europe/London",
      }),
    ).resolves.toBe("Europe/London");
    await expect(
      resolveNativeAppTimezone({
        userId: "user-1",
        sessionId: "session-1",
        prisma: {
          agentEnrollment: {
            findUnique: jest
              .fn()
              .mockResolvedValue({ timezone: "America/Los_Angeles" }),
          },
          mcpAssistantSession: {
            findUnique: jest
              .fn()
              .mockResolvedValue({ timezone: "Europe/Paris" }),
          },
        } as any,
        serverDefault: "Asia/Kolkata",
      }),
    ).resolves.toBe("America/Los_Angeles");
  });

  test("accepts only short-lived access tokens with the exact native audience", async () => {
    const authService = new AuthService({
      user: {
        findUnique: jest.fn().mockResolvedValue({ mcpRevokedAfter: null }),
      },
    } as any);
    const resource = "http://localhost:3000/mcp/app";
    const issued = authService.createMcpToken({
      userId: "00000000-0000-4000-8000-000000000001",
      email: "user@example.com",
      scopes: ["tasks.read", "projects.read"],
      resource,
    });

    expect(issued.expiresIn).toBe(3600);
    await expect(
      authService.verifyMcpToken(issued.token, {
        resource,
        requireResource: true,
      }),
    ).resolves.toMatchObject({ resource });
    await expect(
      authService.verifyMcpToken(issued.token, {
        resource: "http://localhost:3000/mcp",
        requireResource: true,
      }),
    ).rejects.toThrow("Invalid MCP token");
  });

  test("keeps OIDC identity scopes out of native tool authorization", async () => {
    const authService = new AuthService({
      user: {
        findUnique: jest.fn().mockResolvedValue({ mcpRevokedAfter: null }),
      },
    } as any);
    const resource = "http://localhost:3000/mcp/app";
    const issued = authService.createMcpToken({
      userId: "00000000-0000-4000-8000-000000000001",
      email: "user@example.com",
      scopes: ["openid", "email"],
      resource,
    });

    const verified = await authService.verifyMcpToken(issued.token, {
      resource,
      requireResource: true,
    });
    expect(issued.scopes).toEqual(["email", "openid"]);
    expect(verified.oauthScopes).toEqual(["email", "openid"]);
    expect(verified.scopes).toEqual([]);
  });

  test("sanitizes planner results and omits internal attribution", async () => {
    const execute = jest.fn().mockResolvedValue({
      status: 200,
      body: {
        ok: true,
        data: {
          plan: {
            recommendedTasks: [
              {
                ...task,
                estimatedMinutes: 25,
                score: 999,
                attribution: { decisionRunId: "must-not-leak" },
                explanation: { rank: 1, whyIncluded: "Due today" },
              },
            ],
            availableMinutes: 60,
            totalMinutes: 25,
            remainingMinutes: 35,
          },
        },
        trace: { requestId: "must-not-leak" },
      },
    });

    const result = await executeNativeAppTool(
      "plan_today",
      { date: "2026-08-11", availableMinutes: 60, energy: "medium" },
      runtime(execute),
    );
    expect(result).toMatchObject({
      date: "2026-08-11",
      availableMinutes: 60,
      tasks: [{ id: taskId, rank: 1, reason: "Due today" }],
    });
    expect(JSON.stringify(result)).not.toMatch(
      /score|attribution|decisionRunId|trace|must-not-leak/,
    );
  });

  test.each([
    { mode: "travel" as const, rawMinutes: 100, effectiveMinutes: 70 },
    { mode: "rescue" as const, rawMinutes: 100, effectiveMinutes: 60 },
    { mode: "normal" as const, rawMinutes: 100, effectiveMinutes: 100 },
    { mode: "travel" as const, rawMinutes: 1, effectiveMinutes: 1 },
    { mode: "rescue" as const, rawMinutes: 1, effectiveMinutes: 1 },
    { mode: "normal" as const, rawMinutes: 1, effectiveMinutes: 1 },
  ])(
    "keeps repeated raw $rawMinutes-minute plans stable in $mode mode with an effective $effectiveMinutes-minute budget",
    async ({ mode, rawMinutes, effectiveMinutes }) => {
      const userId = "synthetic-budget-user";
      const date = "2026-10-02";
      const todoService = new TodoService();
      const syntheticTask = await todoService.create(userId, {
        title: "Synthetic ten-minute task",
        status: "next",
        priority: "high",
        estimateMinutes: 10,
        effortScore: 10,
        energy: "medium",
      });
      const dayContext = jest
        .spyOn(DayContextService.prototype, "getContext")
        .mockResolvedValue({
          id: "synthetic-day-context",
          contextDate: date,
          mode,
          energy: "high",
          notes: null,
          createdAt: new Date(`${date}T00:00:00Z`),
          updatedAt: new Date(`${date}T00:00:00Z`),
        });
      const agentExecutor = new AgentExecutor({ todoService });
      // Observe the real executor; only account context and storage are isolated.
      const execute = jest.spyOn(agentExecutor, "execute");
      const inputs = Object.freeze({
        date,
        availableMinutes: rawMinutes,
        energy: "medium",
      });
      const nativeRuntime = {
        agentExecutor,
        userId,
        requestId: "synthetic-budget-request",
        actor: "Synthetic contract test",
        prisma: {
          agentEnrollment: {
            findUnique: jest
              .fn()
              .mockResolvedValue({ timezone: "Pacific/Kiritimati" }),
          },
        } as any,
      };
      const expectedTasks =
        rawMinutes === 1
          ? []
          : [{ id: syntheticTask.id, estimateMinutes: 10, rank: 1 }];
      const totalMinutes = rawMinutes === 1 ? 0 : 10;

      try {
        const first = await executeNativeAppTool(
          "plan_today",
          inputs,
          nativeRuntime,
        );
        expect(first).toMatchObject({
          date,
          timezone: "Pacific/Kiritimati",
          energy: "medium",
          availableMinutes: effectiveMinutes,
          totalMinutes,
          remainingMinutes: effectiveMinutes - totalMinutes,
          tasks: expectedTasks,
        });

        for (let refresh = 0; refresh < 2; refresh += 1) {
          await expect(
            executeNativeAppTool("plan_today", inputs, nativeRuntime),
          ).resolves.toEqual(first);
        }

        expect(execute).toHaveBeenCalledTimes(3);
        expect(dayContext).toHaveBeenCalledTimes(3);
        for (let call = 1; call <= 3; call += 1) {
          expect(execute).toHaveBeenNthCalledWith(
            call,
            "plan_today",
            inputs,
            expect.objectContaining({
              userId,
              effectiveDate: date,
              timezone: "Pacific/Kiritimati",
            }),
          );
          expect(dayContext).toHaveBeenNthCalledWith(call, userId, date);
          expect(await execute.mock.results[call - 1].value).toMatchObject({
            body: {
              ok: true,
              data: {
                plan: {
                  date,
                  energy: "medium",
                  availableMinutes: effectiveMinutes,
                  totalMinutes,
                  remainingMinutes: effectiveMinutes - totalMinutes,
                },
              },
            },
          });
        }
        expect(inputs).toEqual({
          date,
          availableMinutes: rawMinutes,
          energy: "medium",
        });
      } finally {
        execute.mockRestore();
        dayContext.mockRestore();
      }
    },
  );

  test("reruns the planner with identical inputs and intersects authoritative tasks in requested order", async () => {
    const secondTaskId = "00000000-0000-4000-8000-000000000011";
    const staleTaskId = "00000000-0000-4000-8000-000000000099";
    const execute = jest.fn().mockResolvedValue({
      status: 200,
      body: {
        ok: true,
        data: {
          plan: {
            recommendedTasks: [
              {
                ...task,
                explanation: { rank: 1, whyIncluded: "Due today" },
              },
              {
                ...task,
                id: secondTaskId,
                title: "Draft release notes",
                estimatedMinutes: 20,
                explanation: { rank: 2, whyIncluded: "Fits the budget" },
              },
            ],
            availableMinutes: 90,
            totalMinutes: 50,
            remainingMinutes: 40,
          },
        },
        trace: { requestId: "must-not-leak" },
      },
    });

    const result = (await executeNativeAppTool(
      "render_today_plan",
      {
        date: "2026-08-11",
        taskIds: [secondTaskId, taskId, staleTaskId],
        availableMinutes: 90,
        energy: "medium",
      },
      runtime(execute),
    )) as any;

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(
      "plan_today",
      {
        date: "2026-08-11",
        availableMinutes: 90,
        energy: "medium",
      },
      expect.objectContaining({ effectiveDate: "2026-08-11" }),
    );
    expect(result.tasks.map((entry: { id: string }) => entry.id)).toEqual([
      secondTaskId,
      taskId,
    ]);
    expect(result.tasks.map((entry: { rank: number }) => entry.rank)).toEqual([
      1, 2,
    ]);
    expect(result.totalMinutes).toBe(50);
    expect(result.remainingMinutes).toBe(40);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/1 selected task was omitted/),
        expect.stringMatching(/authoritative plan order changed/),
      ]),
    );
    expect(JSON.stringify(result)).not.toMatch(
      /score|attribution|decisionRunId|trace|must-not-leak|userId/,
    );
  });

  test("omits a cross-user or missing task ID without probing or leaking it", async () => {
    const foreignTaskId = "00000000-0000-4000-8000-000000000099";
    const execute = jest.fn().mockResolvedValue({
      status: 200,
      body: {
        ok: true,
        data: {
          plan: {
            recommendedTasks: [],
            availableMinutes: 60,
            totalMinutes: 0,
            remainingMinutes: 60,
          },
        },
        trace: {},
      },
    });

    const result = (await executeNativeAppTool(
      "render_today_plan",
      {
        date: "2026-08-11",
        taskIds: [foreignTaskId],
        availableMinutes: 60,
        energy: "low",
      },
      runtime(execute),
    )) as any;

    expect(result.tasks).toEqual([]);
    expect(result.warnings).toEqual([
      expect.stringMatching(/1 selected task was omitted/),
    ]);
    expect(JSON.stringify(result)).not.toContain(foreignTaskId);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(
      "plan_today",
      expect.any(Object),
      expect.any(Object),
    );
  });

  test("never trusts render display fields or admits more than twelve task IDs", () => {
    const renderTool = nativeAppToolDefinitions.find(
      (definition) => definition.name === "render_today_plan",
    )!;
    const validId = "00000000-0000-4000-8000-000000000010";
    const base = {
      date: "2026-08-11",
      taskIds: [validId],
      availableMinutes: 60,
      energy: "low",
    };

    expect(
      renderTool.inputSchema.safeParse({
        ...base,
        tasks: [{ id: validId, title: "Client-controlled title" }],
      }).success,
    ).toBe(false);
    expect(
      renderTool.inputSchema.safeParse({
        ...base,
        taskIds: Array.from(
          { length: 13 },
          (_, index) =>
            `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        ),
      }).success,
    ).toBe(false);
  });

  test("builds a self-contained resource with an exact no-network CSP", () => {
    const resource = buildTodayPlanResourceContents("https://todos.example/");

    expect(resource._meta).toEqual({
      ui: {
        prefersBorder: true,
        domain: TODAY_PLAN_WIDGET_DOMAIN,
        csp: { connectDomains: [], resourceDomains: [] },
      },
      "openai/ui": { availableDisplayModes: ["inline", "fullscreen"] },
    });
    expect(resource.text).toContain('href="https://todos.example/app"');
    expect(resource.text).not.toContain("window.openai");
  });

  test("preserves idempotent capture semantics and fixes the internal source", async () => {
    const execute = jest.fn().mockResolvedValue({
      status: 201,
      body: {
        ok: true,
        data: {
          item: {
            id: taskId,
            text: "Call the dentist tomorrow",
            lifecycle: "new",
            capturedAt: "2026-08-11T16:00:00.000Z",
          },
        },
        trace: { replayed: true },
      },
    });
    const result = await executeNativeAppTool(
      "capture_task",
      {
        text: "Call the dentist tomorrow",
        idempotencyKey: "capture-1",
      },
      runtime(execute),
    );

    expect(result).toMatchObject({ created: false, capture: { id: taskId } });
    expect(execute).toHaveBeenCalledWith(
      "capture_inbox_item",
      { text: "Call the dentist tomorrow", source: "api" },
      expect.objectContaining({ idempotencyKey: "capture-1" }),
    );
  });

  test("reports unchanged completion without issuing a redundant write", async () => {
    const execute = jest.fn().mockResolvedValue({
      status: 200,
      body: {
        ok: true,
        data: { task: { ...task, completed: true, status: "done" } },
        trace: {},
      },
    });
    const result = await executeNativeAppTool(
      "complete_task",
      { taskId, completed: true },
      runtime(execute),
    );

    expect(result).toMatchObject({ changed: false, task: { id: taskId } });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(
      "get_task",
      { id: taskId },
      expect.any(Object),
    );
  });

  test("maps rescheduling to only the narrow allowed update fields", async () => {
    const nextDate = "2026-08-12T13:00:00.000Z";
    const execute = jest
      .fn()
      .mockResolvedValueOnce({
        status: 200,
        body: { ok: true, data: { task }, trace: {} },
      })
      .mockResolvedValueOnce({
        status: 200,
        body: {
          ok: true,
          data: { task: { ...task, scheduledDate: nextDate } },
          trace: {},
        },
      });
    const result = await executeNativeAppTool(
      "reschedule_task",
      { taskId, scheduledDate: nextDate },
      runtime(execute),
    );

    expect(result).toMatchObject({
      changed: true,
      previousScheduledDate: null,
      previousDueDate: task.dueDate,
    });
    expect(execute).toHaveBeenLastCalledWith(
      "update_task",
      { id: taskId, scheduledDate: nextDate },
      expect.any(Object),
    );
  });

  test.each(
    ["dueDate", "scheduledDate"].flatMap((field) =>
      [
        "2026-08-12T09:00:00-04:00",
        "2026-08-12T13:00:00Z",
        "2026-08-12T13:00:00+00:00",
      ].map((value) => [field, value]),
    ),
  )("does not rewrite equivalent %s timestamp %s", async (field, value) => {
    const execute = jest.fn().mockResolvedValue({
      status: 200,
      body: {
        ok: true,
        data: {
          task: { ...task, [field]: new Date("2026-08-12T13:00:00.000Z") },
        },
        trace: {},
      },
    });
    const result = await executeNativeAppTool(
      "reschedule_task",
      { taskId, [field]: value },
      runtime(execute),
    );

    expect(result).toMatchObject({
      changed: false,
      task: { [field]: "2026-08-12T13:00:00.000Z" },
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(
      "get_task",
      { id: taskId },
      expect.any(Object),
    );
  });

  test.each(["dueDate", "scheduledDate"])(
    "persists normalized %s once across identical retries and preserves the omitted date",
    async (field) => {
      let persisted = { ...task };
      const execute = jest.fn(
        async (action: string, params: Record<string, unknown>) => {
          if (action === "update_task")
            persisted = { ...persisted, [field]: params[field] };
          else expect(action).toBe("get_task");
          return {
            status: 200,
            body: { ok: true, data: { task: { ...persisted } }, trace: {} },
          };
        },
      );
      const args = { taskId, [field]: "2026-08-12T09:00:00-04:00" };
      const first = await executeNativeAppTool(
        "reschedule_task",
        args,
        runtime(execute),
      );
      const retry = await executeNativeAppTool(
        "reschedule_task",
        args,
        runtime(execute),
      );
      const otherField = field === "dueDate" ? "scheduledDate" : "dueDate";

      expect(first).toMatchObject({ changed: true });
      expect(retry).toMatchObject({ changed: false });
      expect(first).toMatchObject({
        task: {
          [field]: "2026-08-12T13:00:00.000Z",
          [otherField]: task[otherField],
          status: task.status,
          completed: task.completed,
        },
      });
      expect(
        execute.mock.calls.filter(([action]) => action === "update_task"),
      ).toEqual([
        [
          "update_task",
          { id: taskId, [field]: "2026-08-12T13:00:00.000Z" },
          expect.any(Object),
        ],
      ]);
    },
  );

  test("normalizes both supplied dates when only one instant changes", async () => {
    const execute = jest
      .fn()
      .mockResolvedValueOnce({
        status: 200,
        body: { ok: true, data: { task }, trace: {} },
      })
      .mockResolvedValueOnce({
        status: 200,
        body: {
          ok: true,
          data: {
            task: {
              ...task,
              dueDate: task.dueDate,
              scheduledDate: "2026-08-12T13:00:00.000Z",
            },
          },
          trace: {},
        },
      });
    await executeNativeAppTool(
      "reschedule_task",
      {
        taskId,
        dueDate: "2026-08-11T12:00:00-04:00",
        scheduledDate: "2026-08-12T13:00:00Z",
      },
      runtime(execute),
    );

    expect(execute).toHaveBeenLastCalledWith(
      "update_task",
      {
        id: taskId,
        dueDate: "2026-08-11T16:00:00.000Z",
        scheduledDate: "2026-08-12T13:00:00.000Z",
      },
      expect.any(Object),
    );
  });

  test.each(["dueDate", "scheduledDate"])(
    "clears only explicit-null %s once and preserves the omitted date on retry",
    async (field) => {
      let persisted = {
        ...task,
        scheduledDate: "2026-08-12T13:00:00.000Z",
      } as Record<string, unknown>;
      const before = { ...persisted };
      const execute = jest.fn(
        async (action: string, params: Record<string, unknown>) => {
          if (action === "update_task")
            persisted = { ...persisted, [field]: params[field] };
          else expect(action).toBe("get_task");
          return {
            status: 200,
            body: { ok: true, data: { task: { ...persisted } }, trace: {} },
          };
        },
      );
      const args = { taskId, [field]: null };
      const first = await executeNativeAppTool(
        "reschedule_task",
        args,
        runtime(execute),
      );
      const retry = await executeNativeAppTool(
        "reschedule_task",
        args,
        runtime(execute),
      );
      const otherField = field === "dueDate" ? "scheduledDate" : "dueDate";

      expect(first).toMatchObject({
        changed: true,
        task: { [field]: null, [otherField]: before[otherField] },
      });
      expect(retry).toMatchObject({ changed: false });
      expect(
        execute.mock.calls.filter(([action]) => action === "update_task"),
      ).toEqual([
        ["update_task", { id: taskId, [field]: null }, expect.any(Object)],
      ]);
    },
  );

  test("skips a write when both supplied dates are already equivalent", async () => {
    const execute = jest.fn().mockResolvedValue({
      status: 200,
      body: {
        ok: true,
        data: { task: { ...task, scheduledDate: "2026-08-12T13:00:00.000Z" } },
        trace: {},
      },
    });
    const result = await executeNativeAppTool(
      "reschedule_task",
      {
        taskId,
        dueDate: "2026-08-11T16:00:00Z",
        scheduledDate: "2026-08-12T09:00:00-04:00",
      },
      runtime(execute),
    );

    expect(result).toMatchObject({ changed: false });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  test.each([
    "not-a-date",
    "2026-02-30T13:00:00Z",
    "2026-08-12T13:00:00+99:99",
  ])(
    "rejects invalid rescheduling timestamp %s before any executor call",
    async (dueDate) => {
      const execute = jest.fn();
      await expect(
        executeNativeAppTool(
          "reschedule_task",
          { taskId, dueDate },
          runtime(execute),
        ),
      ).rejects.toMatchObject({ code: "INVALID_ARGUMENT", retryable: false });
      expect(execute).not.toHaveBeenCalled();
    },
  );
});
