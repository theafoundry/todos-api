/** Isolated worker: source routes/services, fixture auth/storage, loopback only. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const net = require("node:net");
const { execFileSync } = require("node:child_process");
const repository = path.resolve(__dirname, "../..");
let stage = "SAFETY";
let server;
let allowedPort;
let blockedConnections = 0;
const capturedLogs = [];
const wallTime = new Date().toISOString();
const clock = "2026-10-11T12:00:00.000Z";
const OriginalDate = Date;
const writeFailure = process.stderr.write.bind(process.stderr);
process.on("uncaughtException", (error) => {
  const code =
    typeof error?.code === "string" && /^[A-Z0-9_]+$/.test(error.code)
      ? error.code
      : "UNCAUGHT";
  writeFailure(`Synthetic review failed: ${stage}_${code}\n`);
  process.exitCode = 1;
  if (server) server.close();
});

function check(condition, message) {
  assert.ok(condition, message);
}
function hash(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}
function sourceHash(files) {
  return hash(
    files
      .map(
        (file) =>
          `${file}\0${hash(fs.readFileSync(path.join(repository, file)))}`,
      )
      .join("\n"),
  );
}

async function main() {
  check(
    process.env.NODE_ENV === "test" &&
      process.env.PLANWREN_SYNTHETIC_REVIEW === "IN_MEMORY_ONLY",
    "worker requires the isolated runner",
  );
  check(
    process.cwd() !== repository &&
      fs.readFileSync(path.join(process.cwd(), ".env"), "utf8") === "",
    "worker cwd must have an empty environment file",
  );
  for (const key of [
    "DATABASE_URL",
    "TEST_DATABASE_URL",
    "DATABASE_URL_TEST",
    "JWT_SECRET",
    "JWT_ACCESS_SECRET",
    "JWT_REFRESH_SECRET",
    "OPENAI_API_KEY",
    "AI_PROVIDER_API_KEY",
    "GITHUB_TOKEN",
    "SMTP_PASS",
  ])
    check(!process.env[key], "worker inherited forbidden settings");
  const connect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...args) {
    const options = Array.isArray(args[0])
      ? args[0][0]
      : typeof args[0] === "object"
        ? args[0]
        : { port: args[0], host: args[1] };
    if (
      !options ||
      options.path ||
      !["127.0.0.1", "::1"].includes(options.host) ||
      Number(options.port) !== allowedPort
    ) {
      blockedConnections += 1;
      throw new Error("SYNTHETIC_NETWORK_GUARD");
    }
    return connect.apply(this, args);
  };
  assert.throws(
    () => net.createConnection({ host: "203.0.113.1", port: 443 }),
    /SYNTHETIC_NETWORK_GUARD/,
  );
  for (const level of ["log", "info", "warn", "error", "debug"])
    console[level] = (...values) =>
      capturedLogs.push({ level, count: values.length });
  let sequence = 0;
  crypto.randomUUID = () =>
    `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`;
  global.Date = class extends OriginalDate {
    constructor(...args) {
      super(...(args.length ? args : [clock]));
    }
    static now() {
      return new OriginalDate(clock).getTime();
    }
  };
  require("ts-node/register/transpile-only");
  const forbiddenPrisma = new Proxy(
    {},
    {
      get() {
        throw new Error("DEFAULT_DATABASE_ACCESS_FORBIDDEN");
      },
    },
  );
  const prismaPath = require.resolve(
    path.join(repository, "src/prismaClient.ts"),
  );
  require.cache[prismaPath] = {
    id: prismaPath,
    filename: prismaPath,
    loaded: true,
    exports: { prisma: forbiddenPrisma },
  };
  const { TodoService } = require(
    path.join(repository, "src/services/todoService.ts"),
  );
  const { AgentExecutor } = require(
    path.join(repository, "src/agent/agentExecutor.ts"),
  );
  const { CaptureService } = require(
    path.join(repository, "src/services/captureService.ts"),
  );
  const { createCaptureRouter } = require(
    path.join(repository, "src/routes/captureRouter.ts"),
  );
  const { createMcpAppRouter } = require(
    path.join(repository, "src/routes/mcpAppRouter.ts"),
  );
  const { config } = require(path.join(repository, "src/config.ts"));
  const { errorHandler } = require(
    path.join(repository, "src/errorHandling.ts"),
  );
  const express = require("express");
  const request = require("supertest");
  const files = Object.keys(require.cache)
    .filter(
      (file) =>
        file.startsWith(`${repository}/src/`) &&
        file !== prismaPath &&
        fs.existsSync(file),
    )
    .map((file) => path.relative(repository, file))
    .sort();
  const loadedSourceHash = sourceHash(files);
  const loadedSourceFiles = files.map((file) => ({
    path: file,
    sha256: hash(fs.readFileSync(path.join(repository, file))),
  }));
  const harnessFiles = [
    "scripts/review/run-synthetic-review.mjs",
    "scripts/review/synthetic-review-worker.cjs",
    "scripts/review/synthetic-review-safety.mjs",
    "scripts/review/synthetic-review-acceptance.test.mjs",
  ];
  const harnessHash = sourceHash(harnessFiles);
  const mcpBytes = fs.readFileSync(
    path.join(repository, "plugins/planwren-public/mcp.json"),
  );
  const declaredEndpoint = JSON.parse(mcpBytes).mcpServers.planwren.url;
  check(
    declaredEndpoint === "https://todos.theafoundry.com/mcp/app",
    "public endpoint drift",
  );
  const manifestBytes = fs.readFileSync(
    path.join(repository, "plugins/planwren-public/plugin.json"),
  );
  const manifest = JSON.parse(manifestBytes);
  const cases = manifest.extensions["com.openai"].review.test_cases;
  check(
    cases.positive.length === 5 && cases.negative.length === 3,
    "review cases must be complete",
  );
  const caseFor = (id) =>
    [...cases.positive, ...cases.negative].find((entry) =>
      entry.description.startsWith(`${id} `),
    );
  for (const id of ["P1", "P2", "P3", "P4", "P5", "N1", "N2", "N3"])
    check(caseFor(id), "case identity mismatch");
  const owner = "synthetic-owner";
  const other = "synthetic-other";
  const todos = new TodoService();
  const captures = new Map();
  const receipts = new Map();
  let lockRequests = 0;
  const row = (task) => ({
    ...task,
    project: null,
    recurrenceType: task.recurrence?.type ?? "none",
  });
  const matchCapture = (item, where) =>
    (!where.id || item.id === where.id) &&
    (!where.userId || item.userId === where.userId) &&
    (!where.lifecycle ||
      (typeof where.lifecycle === "string"
        ? item.lifecycle === where.lifecycle
        : where.lifecycle.in.includes(item.lifecycle)));
  const receiptKey = (where) =>
    JSON.stringify(where.action_userId_idempotencyKey);
  const fixturePrisma = {
    $queryRaw: async () => {
      lockRequests += 1;
      return [];
    },
    captureItem: {
      create: async ({ data }) => {
        const item = {
          id: crypto.randomUUID(),
          userId: data.userId,
          text: data.text,
          source: data.source ?? null,
          capturedAt: data.capturedAt ?? new Date(),
          lifecycle: "new",
          triageResult: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        captures.set(item.id, item);
        return item;
      },
      findFirst: async ({ where }) =>
        [...captures.values()].find((item) => matchCapture(item, where)) ??
        null,
      findMany: async ({ where }) =>
        [...captures.values()].filter((item) => matchCapture(item, where)),
      update: async ({ where, data }) => {
        const item = captures.get(where.id);
        check(item, "unknown fixture capture");
        Object.assign(item, data, { updatedAt: new Date() });
        return item;
      },
    },
    agentIdempotencyRecord: {
      findUnique: async ({ where }) => receipts.get(receiptKey(where)) ?? null,
      create: async ({ data }) => {
        receipts.set(
          JSON.stringify({
            action: data.action,
            userId: data.userId,
            idempotencyKey: data.idempotencyKey,
          }),
          data,
        );
        return data;
      },
      delete: async ({ where }) => receipts.delete(receiptKey(where)),
    },
    todo: {
      findFirst: async ({ where, select }) => {
        const items = await todos.findAll(where.userId);
        const item = where.id
          ? items.find((task) => task.id === where.id)
          : items.sort((a, b) => b.order - a.order)[0];
        return !item ? null : select ? { order: item.order } : row(item);
      },
      create: async ({ data }) => row(await todos.create(data.userId, data)),
    },
    agentActionAudit: { create: async () => ({}) },
    agentEnrollment: { findUnique: async () => ({ timezone: "UTC" }) },
    mcpAssistantSession: { findUnique: async () => null },
  };
  fixturePrisma.$transaction = async (callback) => callback(fixturePrisma);
  const memoryExecutor = new AgentExecutor({ todoService: todos });
  const captureExecutor = new AgentExecutor({
    todoService: todos,
    persistencePrisma: fixturePrisma,
  });
  const executor = {
    execute: (action, input, context) =>
      (action === "capture_inbox_item"
        ? captureExecutor
        : memoryExecutor
      ).execute(action, input, context),
  };
  const authService = {
    getPrismaClient: () => fixturePrisma,
    verifyMcpToken: async (label, options) => {
      if (!["fixture-full", "fixture-read"].includes(label))
        throw new Error("Invalid token");
      check(options.resource === `${config.baseUrl}/mcp/app`, "resource drift");
      return {
        userId: owner,
        tokenType: "mcp",
        scopes:
          label === "fixture-full"
            ? ["tasks.read", "tasks.write", "projects.read"]
            : ["tasks.read", "projects.read"],
        resource: options.resource,
      };
    },
    getUserById: async (id) =>
      id === owner
        ? {
            id: owner,
            email: null,
            name: "Synthetic reviewer",
            isVerified: true,
            role: "user",
            plan: "free",
          }
        : null,
  };
  const app = express();
  app.use(express.json());
  app.use(
    "/mcp/app",
    createMcpAppRouter({
      agentExecutor: executor,
      authService,
      mcpOAuthService: {},
    }),
  );
  app.use(
    "/capture",
    (req, _res, next) => {
      const kind = req.header("x-synthetic-context");
      if (["owner-web", "other-web", "owner-mcp"].includes(kind))
        req.user = {
          userId: kind === "other-web" ? other : owner,
          ...(kind === "owner-mcp" ? { tokenType: "mcp" } : {}),
        };
      next();
    },
    createCaptureRouter(new CaptureService(fixturePrisma)),
  );
  app.use(errorHandler);
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  allowedPort = server.address().port;
  config.baseUrl = `http://127.0.0.1:${allowedPort}`;
  const client = request(server);
  let requestId = 0;
  const parse = (response) =>
    response.body?.jsonrpc
      ? response.body
      : JSON.parse(
          response.text
            .split("\n")
            .find((line) => line.startsWith("data: "))
            .slice(6),
        );
  const rpc = async (method, params, label = "fixture-full") => {
    const response = await client
      .post("/mcp/app")
      .set({
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
        Authorization: `Bearer ${label}`,
        "x-mcp-request-id": `synthetic-${++requestId}`,
      })
      .send({ jsonrpc: "2.0", id: requestId, method, params });
    assert.equal(response.status, 200);
    return parse(response).result;
  };
  const call = async (name, args, label) =>
    rpc("tools/call", { name, arguments: args }, label);
  const success = async (name, args, label) => {
    const result = await call(name, args, label);
    check(!result.isError, `tool failed: ${name}`);
    return result.structuredContent;
  };
  const web = (method, suffix, context = "owner-web", body) => {
    const operation = client[method](`/capture${suffix}`).set(
      "x-synthetic-context",
      context,
    );
    return body === undefined ? operation : operation.send(body);
  };
  stage = "FIXTURE";
  const date = "2026-10-11";
  const due = await todos.create(owner, {
    title: "Review sample A",
    status: "next",
    dueDate: new Date(`${date}T09:00:00Z`),
    estimateMinutes: 15,
    effortScore: 15,
    energy: "low",
    priority: "high",
  });
  const scheduled = await todos.create(owner, {
    title: "Review sample B",
    status: "next",
    scheduledDate: new Date(`${date}T11:00:00Z`),
    dueDate: new Date("2026-10-12T15:00:00Z"),
    estimateMinutes: 15,
    effortScore: 15,
    energy: "low",
    priority: "high",
  });
  const overdue = await todos.create(owner, {
    title: "Review sample C",
    status: "next",
    dueDate: new Date("2026-10-10T09:00:00Z"),
    estimateMinutes: 10,
    effortScore: 10,
    energy: "low",
    priority: "high",
  });
  const completed = await todos.create(owner, {
    title: "Review completed sample",
    completed: true,
    dueDate: new Date(`${date}T08:00:00Z`),
    estimateMinutes: 5,
    effortScore: 5,
    energy: "low",
  });
  const undatedCompleted = await todos.create(owner, {
    title: "Undated completed sample",
    completed: true,
    estimateMinutes: 5,
    effortScore: 5,
    energy: "low",
  });
  const foreign = await todos.create(other, {
    title: "Foreign synthetic task",
    dueDate: new Date(`${date}T09:00:00Z`),
    estimateMinutes: 10,
    effortScore: 10,
    energy: "low",
  });
  const snapshot = async () =>
    JSON.stringify({
      todos: await todos.findAll(owner),
      other: await todos.findAll(other),
      captures: [...captures.values()],
      receipts: [...receipts.values()],
    });
  const rows = [];
  const record = (id, tools, evidence, kind = "positive") =>
    rows.push({
      id,
      kind,
      prompt: caseFor(id).prompt,
      descriptionSha256: hash(caseFor(id).description),
      status: "Passed local server assertions",
      hostStatus: "Not run",
      requestedToolsByHarness: tools,
      evidence,
    });
  stage = "P1";
  const p1 = await success("capture_task", {
    text: "call the dentist tomorrow.",
    idempotencyKey: "synthetic-review-capture-1",
  });
  check(
    p1.created && p1.capture.lifecycle === "new" && captures.size === 1,
    "capture was not one new Inbox item",
  );
  check((await todos.findAll(owner)).length === 5, "capture created a task");
  const replay = await success("capture_task", {
    text: "call the dentist tomorrow.",
    idempotencyKey: "synthetic-review-capture-1",
  });
  check(
    !replay.created &&
      replay.capture.id === p1.capture.id &&
      captures.size === 1,
    "capture retry duplicated",
  );
  record("P1", ["capture_task", "capture_task (retry)"], {
    captureId: p1.capture.id,
    created: p1.created,
    replayCreated: replay.created,
    captureCount: captures.size,
    taskCountUnchanged: true,
  });
  stage = "P2";
  const p2 = await success("list_today", {
    includeOverdue: true,
    includeCompleted: true,
  });
  assert.deepEqual(
    new Set(p2.tasks.map((task) => task.id)),
    new Set([due.id, scheduled.id, overdue.id, completed.id]),
  );
  check(
    !p2.tasks.some((task) =>
      [foreign.id, undatedCompleted.id].includes(task.id),
    ),
    "daily list crossed its set/account boundary",
  );
  assert.equal(p2.date, date);
  assert.equal(p2.timezone, "UTC");
  record("P2", ["list_today"], {
    date: p2.date,
    timezone: p2.timezone,
    returnedIds: p2.tasks.map((task) => task.id),
    completedDailyItemIncluded: true,
    undatedCompletedItemExcluded: true,
    foreignTaskExcluded: true,
  });
  stage = "P3";
  const calendar = await success("list_today", {});
  const planArgs = { date: calendar.date, availableMinutes: 45, energy: "low" };
  stage = "P3_PLAN";
  const plan = await success("plan_today", planArgs);
  stage = "P3_PLAN_SHAPE";
  stage = `P3_PLAN_SHAPE_COUNT_${plan.tasks.length}`;
  check(plan.tasks.length >= 2, "fixture must produce two planned tasks");
  const planIds = plan.tasks.map((task) => task.id);
  stage = "P3_RENDER";
  const rendered = await success("render_today_plan", {
    ...planArgs,
    taskIds: planIds,
  });
  stage = "P3_RENDER_MATCH";
  assert.deepEqual(rendered, plan);
  check(
    plan.totalMinutes <= 45 && plan.remainingMinutes === 45 - plan.totalMinutes,
    "plan budget inconsistent",
  );
  record("P3", ["list_today", "plan_today", "render_today_plan"], {
    ...planArgs,
    timezone: plan.timezone,
    returnedIds: planIds,
    totalMinutes: plan.totalMinutes,
    remainingMinutes: plan.remainingMinutes,
    renderMatchesPlan: true,
  });
  stage = "P4";
  const firstId = planIds[0];
  stage = "P4_COMPLETE";
  const done = await success("complete_task", {
    taskId: firstId,
    completed: true,
  });
  stage = "P4_REOPEN";
  const reopened = await success("complete_task", {
    taskId: firstId,
    completed: false,
  });
  stage = "P4_RETURNED_STATE";
  check(
    done.changed &&
      done.task.completed &&
      reopened.changed &&
      !reopened.task.completed &&
      reopened.task.status === "next",
    "complete/reopen failed",
  );
  stage = "P4_CANONICAL_STATE";
  check(
    (await todos.findById(owner, firstId)).completedAt == null,
    "reopen retained completion time",
  );
  record("P4", ["complete_task", "complete_task"], {
    taskIdFromLatestPlan: firstId,
    completed: done.task.completed,
    reopened: !reopened.task.completed,
    status: reopened.task.status,
    changedFlags: [done.changed, reopened.changed],
  });
  stage = "P5";
  const secondId = planIds[1];
  const beforeTask = await todos.findById(owner, secondId);
  const p5 = await success("reschedule_task", {
    taskId: secondId,
    scheduledDate: "2026-10-12T09:00:00+00:00",
  });
  check(
    p5.changed && p5.task.scheduledDate === "2026-10-12T09:00:00.000Z",
    "reschedule failed",
  );
  assert.equal(p5.task.dueDate, beforeTask.dueDate?.toISOString() ?? null);
  const repeated = await success("reschedule_task", {
    taskId: secondId,
    scheduledDate: "2026-10-12T09:00:00.000Z",
  });
  check(!repeated.changed, "equivalent reschedule was not a no-op");
  record("P5", ["reschedule_task", "reschedule_task (equivalent retry)"], {
    taskIdFromLatestPlan: secondId,
    scheduledDate: p5.task.scheduledDate,
    dueDate: p5.task.dueDate,
    dueDatePreserved: true,
    equivalentRetryChanged: repeated.changed,
  });
  stage = "WEB_REVIEW";
  const inbox = await web("get", "?review=pending");
  assert.equal(inbox.status, 200);
  assert.equal(inbox.body[0].id, p1.capture.id);
  const accepted = await web("post", `/${p1.capture.id}/accept`, "owner-web", {
    title: "Call the dentist — reviewed",
  });
  assert.equal(accepted.status, 201);
  check(accepted.body.created, "first accept not created");
  const again = await web("post", `/${p1.capture.id}/accept`, "owner-web", {});
  assert.equal(again.status, 200);
  check(
    !again.body.created && again.body.task.id === accepted.body.task.id,
    "accept retry duplicated task",
  );
  const acceptedTask = await todos.findById(owner, accepted.body.task.id);
  assert.equal(acceptedTask.sourceText, p1.capture.text);
  check(
    acceptedTask.notes.includes(p1.capture.text) &&
      !acceptedTask.scheduledDate &&
      !acceptedTask.dueDate,
    "accept lost context or inferred scheduling",
  );
  const afterAcceptReplay = await success("capture_task", {
    text: "call the dentist tomorrow.",
    idempotencyKey: "synthetic-review-capture-1",
  });
  check(
    !afterAcceptReplay.created &&
      afterAcceptReplay.capture.id === p1.capture.id,
    "accepted capture replay duplicated",
  );
  assert.equal((await web("get", "?review=pending")).body.length, 0);
  const deniedWeb = await web(
    "post",
    `/${p1.capture.id}/accept`,
    "owner-mcp",
    {},
  );
  assert.equal(deniedWeb.status, 403);
  const foreignWeb = await web("get", `/${p1.capture.id}`, "other-web");
  assert.equal(foreignWeb.status, 404);
  stage = "NEGATIVE";
  const discovery = await rpc("tools/list", {});
  stage = "NEGATIVE_DISCOVERY";
  const modelTools = discovery.tools
    .filter(
      (tool) =>
        !tool._meta?.ui?.visibility ||
        tool._meta.ui.visibility.includes("model"),
    )
    .map((tool) => tool.name);
  assert.equal(modelTools.length, 6);
  for (const [id, name, args] of [
    ["N1", "delete_task", {}],
    ["N3", "send_email", { taskId: firstId }],
  ]) {
    stage = `NEGATIVE_${id}`;
    const before = await snapshot();
    const result = await call(name, args);
    check(
      result.isError &&
        result.structuredContent.error.code === "TOOL_NOT_FOUND",
      "unsupported tool accepted",
    );
    assert.equal(await snapshot(), before);
    record(
      id,
      [name],
      {
        protocolError: "TOOL_NOT_FOUND",
        mutationCount: 0,
        capabilityAbsent: !modelTools.includes(name),
        hostNoToolSelectionNotExercised: true,
      },
      "negative protocol probe",
    );
  }
  const beforeForeign = await snapshot();
  stage = "NEGATIVE_N2_SELECTOR";
  const injectedUser = await call("list_today", { userId: other });
  check(
    injectedUser.isError &&
      injectedUser.structuredContent.error.code === "INVALID_ARGUMENT",
    "cross-user selector accepted",
  );
  stage = "NEGATIVE_N2_FOREIGN_ID";
  const foreignMutation = await call("reschedule_task", {
    taskId: foreign.id,
    scheduledDate: "2026-10-12T09:00:00Z",
  });
  const foreignErrorCode = foreignMutation.structuredContent?.error?.code;
  stage = `NEGATIVE_N2_FOREIGN_${typeof foreignErrorCode === "string" && /^[A-Z0-9_]+$/.test(foreignErrorCode) ? foreignErrorCode : "NO_CODE"}`;
  check(
    foreignMutation.isError &&
      foreignErrorCode === "RESOURCE_NOT_FOUND_OR_FORBIDDEN",
    "foreign task accepted",
  );
  assert.equal(await snapshot(), beforeForeign);
  record(
    "N2",
    [
      "list_today (invalid user selector)",
      "reschedule_task (foreign synthetic ID)",
    ],
    {
      userSelectorRejected: true,
      foreignTaskError: foreignMutation.structuredContent.error.code,
      mutationCount: 0,
      hostNoToolSelectionNotExercised: true,
    },
    "negative protocol probe",
  );
  stage = "NEGATIVE_SCOPE";
  const beforeDenied = await snapshot();
  const denied = await call(
    "capture_task",
    { text: "read-only boundary", idempotencyKey: "denied-local" },
    "fixture-read",
  );
  check(
    denied.isError &&
      denied.structuredContent.error.code === "MCP_INSUFFICIENT_SCOPE",
    "read-only write accepted",
  );
  assert.equal(await snapshot(), beforeDenied);
  stage = "EVIDENCE";
  assert.equal(
    sourceHash(harnessFiles),
    harnessHash,
    "harness changed during execution",
  );
  assert.equal(
    hash(
      fs.readFileSync(
        path.join(repository, "plugins/planwren-public/mcp.json"),
      ),
    ),
    hash(mcpBytes),
    "MCP declaration changed during execution",
  );
  assert.equal(
    sourceHash(files),
    loadedSourceHash,
    "loaded source changed during execution; rerun at stable source",
  );
  assert.equal(
    hash(
      fs.readFileSync(
        path.join(repository, "plugins/planwren-public/plugin.json"),
      ),
    ),
    hash(manifestBytes),
    "manifest changed during execution",
  );
  check(
    blockedConnections === 1,
    "unexpected external/database network attempt",
  );
  const report = {
    executedAtUTC: wallTime,
    scope:
      "Local server-protocol and web-router assertions only; not ChatGPT model selection, host UI, real authentication or database concurrency acceptance",
    source: {
      head: execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: repository,
        encoding: "utf8",
      }).trim(),
      loadedSourceSha256: loadedSourceHash,
      loadedSourceFileCount: files.length,
      loadedSourceFiles,
      harnessSha256: harnessHash,
      treeIdentity:
        "Loaded source and harness hashes identify the current worktree; HEAD alone does not identify uncommitted edits",
      stableDuringRun: true,
    },
    package: {
      name: manifest.name,
      version: manifest.version,
      manifestSha256: hash(manifestBytes),
      mcpDeclarationSha256: hash(mcpBytes),
      publicEndpoint: declaredEndpoint,
    },
    fixture: {
      storage:
        "In-process synthetic adapter and canonical TodoService; no Prisma database client",
      clock,
      timezone: "UTC",
      lowEnergyTaskEstimates: [15, 15, 10],
      plannerEffortScores: [15, 15, 10],
      completedDailyTask: "Completed and due on fixture date",
      undatedCompletedNegativeControl: true,
      credentialsCreated: false,
    },
    safety: {
      actualListener: "127.0.0.1 (ephemeral port)",
      environmentAllowlisted: true,
      repositoryDotenvNotLoaded: true,
      defaultDatabaseClientForbidden: true,
      externalNetworkProbeBlocked: true,
      unexpectedNetworkAttempts: 0,
      rawServiceLogsWithheld: capturedLogs.length,
    },
    cases: rows.sort((a, b) => a.id.localeCompare(b.id)),
    webCaptureReview: {
      status: "Passed local router/service assertions",
      captureId: p1.capture.id,
      returnedTaskId: accepted.body.task.id,
      editedTitleAccepted: true,
      rawCaptureTextPreserved: true,
      noInferredDates: true,
      acceptRetryCreated: again.body.created,
      captureReplayAfterAcceptCreated: afterAcceptReplay.created,
      pendingInboxCount: 0,
      mcpContextAcceptStatus: deniedWeb.status,
      foreignCaptureReadStatus: foreignWeb.status,
    },
    additionalScopeCheck: {
      readOnlyCaptureError: denied.structuredContent.error.code,
      mutationCount: 0,
    },
    fixtureLockRequests: lockRequests,
    hostReview: {
      positive: "Not run (5 cases)",
      negative: "Not run (3 cases)",
      demo: "Not recorded, viewed or hosted",
      reviewerAccess: "Not provisioned or verified",
    },
    limitations: [
      "Harness selects tools/arguments explicitly; natural-language routing/refusal and no-tool host behavior are untested",
      "MCP auth verifier and web user context are injected synthetic fixtures; OAuth, JWT, revocation and real login are not exercised",
      "Fixture transactions do not prove SQL locking, rollback, concurrent writes or provider/database isolation",
      "Today Plan structured data is checked; no actual ChatGPT rendering or accessibility is claimed",
    ],
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
main()
  .catch(() => {
    writeFailure(`Synthetic review failed: ${stage}\n`);
    process.exitCode = 1;
  })
  .finally(() => {
    if (server) server.close();
  });
