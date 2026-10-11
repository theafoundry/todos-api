import express from "express";
import request from "supertest";
import { createApp } from "./app";
import type { AgentExecutor } from "./agent/agentExecutor";
import { config } from "./config";
import { agentAuthMiddleware } from "./middleware/agentAuthMiddleware";
import { authMiddleware } from "./middleware/authMiddleware";
import { createMcpAppRouter } from "./routes/mcpAppRouter";
import { createMcpRouter } from "./routes/mcpRouter";
import type { AiProviderAdmissionService } from "./services/aiProviderAdmissionService";
import {
  getAiProviderAdmission,
  getAiProviderContext,
  nextAiProviderAdmissionKey,
} from "./services/aiProviderContext";
import type { AuthService } from "./services/authService";
import { McpOAuthService } from "./services/mcpOAuthService";
import { TodoService } from "./services/todoService";

const admission = {
  name: "server-owned-service",
} as unknown as AiProviderAdmissionService;
const forgedRequestId = "caller-chosen-repeat-id";

function applicationAuth() {
  return {
    verifyActiveToken: jest.fn().mockImplementation(async (token: string) => {
      await Promise.resolve();
      if (token === "invalid") throw new Error("Invalid token");
      return { userId: `verified-${token}`, email: `${token}@example.test` };
    }),
    isAdmin: jest
      .fn()
      .mockImplementation(
        async (userId: string) => userId === "verified-operator",
      ),
    getAllUsers: jest.fn().mockResolvedValue([]),
  };
}

function spoofedHeaders(test: request.Test): request.Test {
  return test
    .set("x-user-id", "victim")
    .set("x-plan", "team")
    .set("x-request-id", forgedRequestId)
    .set("x-mcp-request-id", forgedRequestId)
    .set("x-agent-request-id", forgedRequestId)
    .set("Idempotency-Key", forgedRequestId);
}

function parseMcp(response: request.Response) {
  if (Object.keys(response.body).length) return response.body;
  const event = response.text
    .split("\n")
    .find((line) => line.startsWith("data: "));
  if (!event) throw new Error("Missing synthetic MCP response");
  return JSON.parse(event.slice(6));
}

function mcpFixture(surface: "legacy" | "native") {
  const observations: Array<{
    context: ReturnType<typeof getAiProviderContext>;
    admission: ReturnType<typeof getAiProviderAdmission>;
    admissionKey: string;
    executionUserId: string;
  }> = [];
  const execute = jest
    .fn()
    .mockImplementation(async (_action, _args, actor) => {
      await Promise.resolve();
      observations.push({
        context: getAiProviderContext(),
        admission: getAiProviderAdmission(),
        admissionKey: nextAiProviderAdmissionKey("planner.plan_today"),
        executionUserId: actor.userId,
      });
      return {
        status: 200,
        body: { ok: true, data: { tasks: [] }, trace: {}, readOnly: true },
      };
    });
  const auth = {
    verifyMcpToken: jest.fn().mockImplementation(async (token, options) => {
      if (token === "invalid" || token === "web-token") {
        throw new Error("Invalid MCP token");
      }
      const resource = new URL("/mcp/app", config.baseUrl).toString();
      if (token === "wrong-resource" && options.requireResource) {
        throw new Error("Invalid MCP token");
      }
      return {
        userId: "verified-assistant-owner",
        email: "fixture@example.test",
        tokenType: "mcp",
        scopes:
          token === "insufficient"
            ? ["projects.read"]
            : ["tasks.read", "projects.read"],
        ...(surface === "native" ? { resource } : {}),
      };
    }),
    getUserById: jest.fn().mockImplementation(async (id) => ({
      id,
      email: "fixture@example.test",
      name: "Synthetic owner",
      isVerified: true,
      role: "user",
      plan: "free",
    })),
    getPrismaClient: jest.fn().mockReturnValue(undefined),
  };
  const app = express();
  app.use(express.json());
  app.use(
    "/mcp",
    surface === "legacy"
      ? createMcpRouter({
          agentExecutor: { execute } as unknown as AgentExecutor,
          authService: auth as unknown as AuthService,
          providerAdmissionService: admission,
        })
      : createMcpAppRouter({
          agentExecutor: { execute } as unknown as AgentExecutor,
          authService: auth as unknown as AuthService,
          mcpOAuthService: new McpOAuthService(),
          providerAdmissionService: admission,
        }),
  );
  const call = (token: string) =>
    spoofedHeaders(
      request(app)
        .post("/mcp")
        .set("Authorization", `Bearer ${token}`)
        .set("Accept", "application/json, text/event-stream"),
    ).send({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: surface === "native" ? "list_today" : "list_tasks",
        arguments: {},
      },
    });
  return { app, auth, execute, observations, call };
}

describe("Verified provider attribution boundaries", () => {
  test.each(["/ai", "/adaptation"])(
    "%s uses live verified identity and server-owned keys despite spoofed metadata",
    async (path) => {
      const auth = applicationAuth();
      const app = express();
      app.use(express.json());
      app.use(path, authMiddleware(auth as unknown as AuthService, admission));
      const observed: Array<ReturnType<typeof getAiProviderContext>> = [];
      app.post(path, async (_req, res) => {
        await Promise.resolve();
        observed.push(getAiProviderContext());
        expect(getAiProviderAdmission()).toBe(admission);
        res.json({ ok: true });
      });
      await Promise.all(
        ["account-a", "account-b"].map((token) =>
          spoofedHeaders(
            request(app).post(path).set("Authorization", `Bearer ${token}`),
          )
            .send({
              userId: "victim",
              plan: "team",
              requestKey: forgedRequestId,
            })
            .expect(200),
        ),
      );
      expect(observed.map((context) => context!.userId).sort()).toEqual([
        "verified-account-a",
        "verified-account-b",
      ]);
      for (const context of observed) {
        expect(context!.source).toBe("application");
        expect(context!.requestKey).not.toBe(forgedRequestId);
        expect(Object.keys(context!).sort()).toEqual([
          "requestKey",
          "source",
          "userId",
        ]);
      }
      expect(observed[0]!.requestKey).not.toBe(observed[1]!.requestKey);
      expect(auth.verifyActiveToken).toHaveBeenCalledTimes(2);
      expect(getAiProviderContext()).toBeUndefined();
    },
  );

  test.each(["application", "agent"] as const)(
    "failed %s authentication cannot bind or execute provider work",
    async (surface) => {
      const auth = applicationAuth();
      const reached = jest.fn();
      const app = express();
      app.use(
        surface === "agent"
          ? agentAuthMiddleware(auth as unknown as AuthService, admission)
          : authMiddleware(auth as unknown as AuthService, admission),
      );
      app.get("/", (_req, res) => {
        reached();
        res.json({});
      });
      await spoofedHeaders(
        request(app).get("/").set("Authorization", "Bearer invalid"),
      ).expect(401);
      expect(reached).not.toHaveBeenCalled();
      expect(getAiProviderContext()).toBeUndefined();
    },
  );

  test("agent authentication ignores body actor/plan and binds the verified account", async () => {
    const auth = applicationAuth();
    const app = express();
    app.use(express.json());
    app.use(agentAuthMiddleware(auth as unknown as AuthService, admission));
    app.post("/", async (_req, res) => {
      await Promise.resolve();
      expect(getAiProviderAdmission()).toBe(admission);
      res.json(getAiProviderContext());
    });
    const response = await spoofedHeaders(
      request(app).post("/").set("Authorization", "Bearer agent-owner"),
    )
      .send({ userId: "victim", plan: "team" })
      .expect(200);
    expect(response.body).toMatchObject({
      userId: "verified-agent-owner",
      source: "agent",
    });
    expect(response.body.requestKey).not.toBe(forgedRequestId);
  });

  test("createApp keeps admission instances separate and attributes admin work to the operator", async () => {
    const applications = [0, 1].map(() => {
      const auth = applicationAuth();
      const todoService = new TodoService();
      const observed: Array<{
        source?: string;
        userId?: string;
        service?: AiProviderAdmissionService;
      }> = [];
      jest.spyOn(todoService, "findAll").mockImplementation(async () => {
        observed.push({
          ...getAiProviderContext(),
          service: getAiProviderAdmission(),
        });
        return [];
      });
      auth.getAllUsers.mockImplementation(async () => {
        observed.push({
          ...getAiProviderContext(),
          service: getAiProviderAdmission(),
        });
        return [];
      });
      return {
        app: createApp({
          todoService,
          authService: auth as unknown as AuthService,
        }),
        auth,
        observed,
      };
    });
    for (const fixture of applications) {
      await request(fixture.app)
        .get("/todos")
        .set("Authorization", "Bearer owner")
        .expect(200);
      await spoofedHeaders(
        request(fixture.app)
          .get("/admin/users")
          .set("Authorization", "Bearer operator"),
      ).expect(200);
      expect(fixture.observed[0]).toMatchObject({
        userId: "verified-owner",
        source: "application",
      });
      expect(fixture.observed[1]).toMatchObject({
        userId: "verified-operator",
        source: "admin",
      });
      expect(fixture.observed[0].service).toBe(fixture.observed[1].service);
      expect(fixture.observed[0].service).toBeDefined();
      await request(fixture.app)
        .get("/admin/users")
        .set("Authorization", "Bearer ordinary")
        .expect(403);
      expect(fixture.auth.getAllUsers).toHaveBeenCalledTimes(1);
    }
    expect(applications[0].observed[0].service).not.toBe(
      applications[1].observed[0].service,
    );
  });

  test.each(["legacy", "native"] as const)(
    "%s MCP binds only the verified owner and allocates fresh keys despite repeated caller IDs",
    async (surface) => {
      const fixture = mcpFixture(surface);
      for (let call = 0; call < 2; call += 1) {
        const response = await fixture.call("valid").expect(200);
        expect(parseMcp(response).result.isError).not.toBe(true);
      }
      expect(fixture.observations).toHaveLength(2);
      for (const observed of fixture.observations) {
        expect(observed.context).toMatchObject({
          userId: "verified-assistant-owner",
          source: surface === "legacy" ? "legacy-mcp" : "native-mcp",
        });
        expect(observed.admission).toBe(admission);
        expect(observed.executionUserId).toBe("verified-assistant-owner");
        expect(observed.context!.requestKey).not.toBe(forgedRequestId);
      }
      expect(fixture.observations[0].admissionKey).not.toBe(
        fixture.observations[1].admissionKey,
      );
      expect(getAiProviderContext()).toBeUndefined();
    },
  );

  describe.each(["legacy", "native"] as const)(
    "%s MCP rejected requests",
    (surface) => {
      test.each(["invalid", "web-token", "insufficient"])(
        "%s credentials/scopes cannot reach provider execution",
        async (token) => {
          const fixture = mcpFixture(surface);
          const response = await fixture.call(token);
          if (surface === "native" || token === "insufficient") {
            expect(parseMcp(response).result.isError).toBe(true);
          } else {
            expect(response.status).toBe(401);
          }
          expect(fixture.execute).not.toHaveBeenCalled();
          expect(fixture.observations).toEqual([]);
          expect(getAiProviderContext()).toBeUndefined();
        },
      );
    },
  );

  test("native resource rejection remains before provider context creation", async () => {
    const fixture = mcpFixture("native");
    const response = await fixture.call("wrong-resource").expect(200);
    expect(parseMcp(response).result.isError).toBe(true);
    expect(fixture.execute).not.toHaveBeenCalled();
    expect(fixture.auth.verifyMcpToken).toHaveBeenCalledWith("wrong-resource", {
      resource: new URL("/mcp/app", config.baseUrl).toString(),
      requireResource: true,
    });
  });
});
