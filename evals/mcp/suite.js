const assert = require("node:assert/strict");

const request = require("supertest");

const {
  buildMcpSession,
  buildProject,
  createMcpEvalApp,
  createPkcePair,
  withAuthFixtureParity,
} = require("../shared/app-harness");

const PROJECT_ID = "00000000-0000-4000-8000-000000000002";

function mcpRequest(id, method, params = {}) {
  return {
    jsonrpc: "2.0",
    id,
    method,
    params,
  };
}

module.exports = {
  name: "mcp",
  description:
    "Deterministic evals for remote MCP auth, scopes, discovery, and representative tool calls.",
  trials: [
    {
      id: "mcp-unauthenticated-challenge",
      type: "regression",
      description:
        "Unauthenticated MCP requests fail with a structured auth challenge instead of a generic error.",
      async run({ writeJson }) {
        const session = buildMcpSession("user-1", ["tasks.read"]);
        const { app } = createMcpEvalApp({ session });

        const response = await request(app)
          .post("/mcp")
          .send(mcpRequest("mcp-1", "initialize", {}))
          .expect(401);

        writeJson("response.json", response.body);
        assert.equal(response.body.error.data.code, "MCP_UNAUTHENTICATED");
        assert.match(String(response.headers["www-authenticate"] || ""), /Bearer/);

        return {
          errorCode: response.body.error.data.code,
        };
      },
    },
    {
      id: "mcp-tools-list-read-scope",
      type: "regression",
      description:
        "A read-scoped MCP session can discover tools and the tool catalog stays aligned.",
      async run({ writeJson }) {
        const session = buildMcpSession("user-1", ["projects.read", "tasks.read"]);
        const { app } = createMcpEvalApp({ session });

        const response = await request(app)
          .post("/mcp")
          .set("Authorization", "Bearer mcp-token-user-1")
          .send(mcpRequest("mcp-2", "tools/list", {}))
          .expect(200);

        writeJson("response.json", response.body);
        const toolNames = response.body.result.tools.map((tool) => tool.name);
        assert.ok(toolNames.includes("plan_project"));
        assert.ok(toolNames.includes("analyze_work_graph"));

        return {
          toolCount: toolNames.length,
          sampleTools: toolNames.slice(0, 6),
        };
      },
    },
    {
      id: "mcp-scope-denial",
      type: "regression",
      description:
        "Read-only MCP sessions get a structured insufficient-scope error on write tool calls.",
      async run({ writeJson }) {
        const session = buildMcpSession("user-1", ["tasks.read"]);
        const { app } = createMcpEvalApp({ session });

        const response = await request(app)
          .post("/mcp")
          .set("Authorization", "Bearer mcp-token-user-1")
          .send(
            mcpRequest("mcp-3", "tools/call", {
              name: "create_task",
              arguments: { title: "Blocked by scope" },
            }),
          )
          .expect(200);

        writeJson("response.json", response.body);
        assert.equal(
          response.body.result.structuredContent.error.code,
          "MCP_INSUFFICIENT_SCOPE",
        );

        return {
          errorCode: response.body.result.structuredContent.error.code,
          requiredScopes:
            response.body.result.structuredContent.error.details.requiredScopes,
        };
      },
    },
    {
      id: "mcp-public-oauth-flow",
      type: "capability",
      description:
        "The public OAuth flow can mint a scoped token and immediately discover MCP tools.",
      async run({ writeJson }) {
        const session = buildMcpSession("user-1", ["projects.read", "tasks.read"]);
        const { app } = createMcpEvalApp({ session });
        const agent = request.agent(app);
        const pkce = createPkcePair(
          "oauth-verifier-public-eval-1111111111111111111111111111111",
        );

        const register = await request(app)
          .post("/oauth/register")
          .send({
            redirect_uris: ["https://chat.openai.com/aip/callback"],
            client_name: "ChatGPT",
            grant_types: ["authorization_code", "refresh_token"],
          })
          .expect(201);

        const scope = "projects.read tasks.read";
        const authorizeUrl = `/oauth/authorize?client_id=${encodeURIComponent(
          register.body.client_id,
        )}&redirect_uri=${encodeURIComponent(
          "https://chat.openai.com/aip/callback",
        )}&response_type=code&scope=${encodeURIComponent(
          scope,
        )}&state=state-261&code_challenge=${encodeURIComponent(
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
            scope,
            state: "state-261",
            code_challenge: pkce.challenge,
            code_challenge_method: "S256",
          })
          .expect(303);

        const approve = await agent
          .post("/oauth/authorize/decision")
          .type("form")
          .send({
            decision: "approve",
            client_id: register.body.client_id,
            redirect_uri: "https://chat.openai.com/aip/callback",
            response_type: "code",
            scope,
            state: "state-261",
            code_challenge: pkce.challenge,
            code_challenge_method: "S256",
          })
          .expect(303);

        const redirectUrl = new URL(approve.headers.location);
        const code = redirectUrl.searchParams.get("code");
        assert.ok(code);

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

        const list = await request(app)
          .post("/mcp")
          .set("Authorization", `Bearer ${token.body.access_token}`)
          .send(mcpRequest("mcp-4", "tools/list", {}))
          .expect(200);

        writeJson("register.json", register.body);
        writeJson("token.json", token.body);
        writeJson("tools-list.json", list.body);

        assert.equal(token.body.scope, "projects.read tasks.read");
        assert.ok(
          list.body.result.tools.some((tool) => tool.name === "list_tasks"),
        );

        return {
          accessToken: token.body.access_token,
          toolCount: list.body.result.tools.length,
        };
      },
    },
    {
      id: "mcp-oauth-deleted-account-session",
      type: "regression",
      description:
        "A signed OAuth link session for an account deleted after login cannot approve consent or receive a code.",
      async run({ writeJson }) {
        const session = buildMcpSession("user-1", ["projects.read", "tasks.read"]);
        const { app, auth } = createMcpEvalApp({ session });
        const agent = request.agent(app);
        const pkce = createPkcePair(
          "oauth-verifier-deleted-eval-11111111111111111111111111111",
        );

        const register = await request(app)
          .post("/oauth/register")
          .send({
            redirect_uris: ["https://chat.openai.com/aip/callback"],
            client_name: "ChatGPT",
            grant_types: ["authorization_code", "refresh_token"],
          })
          .expect(201);

        const fields = {
          client_id: register.body.client_id,
          redirect_uri: "https://chat.openai.com/aip/callback",
          response_type: "code",
          scope: "projects.read tasks.read",
          state: "state-deleted",
          code_challenge: pkce.challenge,
          code_challenge_method: "S256",
        };

        await agent
          .post("/oauth/authorize/login")
          .type("form")
          .send({ ...fields, email: "user-1@example.com", password: "password123" })
          .expect(303);

        // The consent page is gated only by the link-session check, so it
        // isolates verifyActiveToken from the decision's own account lookup.
        const activeView = await agent
          .get("/oauth/authorize")
          .query(fields)
          .expect(200);
        assert.match(activeView.text, /Authorize Assistant/);

        auth.deleteUser("user-1");

        const deletedView = await agent
          .get("/oauth/authorize")
          .query(fields)
          .expect(200);
        assert.match(deletedView.text, /Connect Assistant/);
        assert.doesNotMatch(deletedView.text, /Authorize Assistant/);

        const approve = await agent
          .post("/oauth/authorize/decision")
          .type("form")
          .send({ ...fields, decision: "approve" })
          .expect(400);

        writeJson("decision.json", {
          status: approve.status,
          location: approve.headers.location ?? null,
        });

        assert.equal(approve.headers.location, undefined);
        assert.doesNotMatch(approve.text, /[?&]code=/);
        assert.match(approve.text, /Authorization Error/);

        return {
          status: approve.status,
          codeIssued: false,
        };
      },
    },
    {
      id: "mcp-write-idempotent-flow",
      type: "capability",
      description:
        "A write-scoped MCP session can perform a representative write flow and replay it via idempotency.",
      async run({ writeJson }) {
        const project = buildProject(PROJECT_ID, "Vacation", "user-1", {
          goal: "Plan anniversary vacation",
        });
        const session = buildMcpSession("user-1", [
          "projects.read",
          "tasks.read",
          "tasks.write",
        ]);
        const { app } = createMcpEvalApp({ projects: [project], session });

        const first = await request(app)
          .post("/mcp")
          .set("Authorization", "Bearer mcp-token-user-1")
          .send(
            mcpRequest("mcp-5", "tools/call", {
              name: "ensure_next_action",
              arguments: {
                projectId: project.id,
                mode: "apply",
                idempotencyKey: "mcp-eval-ensure-1",
              },
            }),
          )
          .expect(200);

        const replay = await request(app)
          .post("/mcp")
          .set("Authorization", "Bearer mcp-token-user-1")
          .send(
            mcpRequest("mcp-6", "tools/call", {
              name: "ensure_next_action",
              arguments: {
                projectId: project.id,
                mode: "apply",
                idempotencyKey: "mcp-eval-ensure-1",
              },
            }),
          )
          .expect(200);

        writeJson("first-response.json", first.body);
        writeJson("replay-response.json", replay.body);

        assert.equal(first.body.result.structuredContent.ok, true);
        assert.equal(replay.body.result.structuredContent.ok, true);
        assert.deepEqual(
          first.body.result.structuredContent.data,
          replay.body.result.structuredContent.data,
        );
        assert.equal(replay.body.result.structuredContent.trace.replayed, true);
        assert.equal(
          replay.body.result.structuredContent.trace.originalRequestId,
          first.body.result.structuredContent.trace.requestId,
        );

        return {
          task: first.body.result.structuredContent.data.result.task,
          replayMatched: true,
        };
      },
    },
  ].map((trial) => ({ ...trial, run: withAuthFixtureParity(trial.run) })),
};
