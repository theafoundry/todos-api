import express from "express";
import request from "supertest";
import { createAiRouter } from "./routes/aiRouter";
import { errorHandler } from "./errorHandling";
import { AiPlannerService } from "./services/aiService";
import { AiQuotaService } from "./services/aiQuotaService";
import { InMemoryAiSuggestionStore } from "./services/aiSuggestionStore";
import { TodoService } from "./services/todoService";
import { HomeFocusPrewarmService } from "./services/homeFocusPrewarmService";
import { assertAiAdmissionFixtureUrl } from "../test/aiAdmissionFixture";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fixture() {
  const userId = "synthetic-suggestion-owner";
  const store = new InMemoryAiSuggestionStore();
  const todoService = new TodoService();
  const planner = new AiPlannerService({ todoService });
  const limits = { free: 2, pro: 2, team: 2 };
  const quota = new AiQuotaService({
    suggestionStore: store,
    limitsByPlan: limits,
  });
  const app = express();
  app.use(express.json());
  app.use(
    "/ai",
    createAiRouter({
      todoService,
      suggestionStore: store,
      aiPlannerService: planner,
      aiDailySuggestionLimitByPlan: limits,
      resolveAiUserId: () => userId,
      decisionAssistEnabled: true,
    }),
  );
  app.use(errorHandler);
  return { app, store, planner, quota, userId };
}

describe("atomic saved-suggestion admission", () => {
  beforeEach(() => {
    jest
      .spyOn(global, "fetch")
      .mockRejectedValue(
        new Error("Provider HTTP forbidden in saved-suggestion fixtures"),
      );
    jest.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    expect(global.fetch).not.toHaveBeenCalled();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it.each([
    {
      route: "/ai/task-critic",
      method: "critiqueTask" as const,
      body: { title: "Synthetic task" },
    },
    {
      route: "/ai/plan-from-goal",
      method: "planFromGoal" as const,
      body: { goal: "Synthetic goal", maxTasks: 3 },
    },
    {
      route: "/ai/decision-assist/stub",
      method: "generateDecisionAssistStub" as const,
      body: { surface: "on_create", title: "Synthetic task", topN: 3 },
    },
  ])(
    "rejects a concurrent final slot on $route before a second generation",
    async ({ route, method, body }) => {
      const { app, store, planner, quota, userId } = fixture();
      await store.create({
        userId,
        type: "task_critic",
        input: {},
        output: {},
      });
      const entered = deferred();
      const release = deferred();
      const original = planner[method].bind(planner) as (
        ...args: any[]
      ) => Promise<unknown>;
      const generate = jest.spyOn(planner, method).mockImplementation((async (
        ...args: any[]
      ) => {
        entered.resolve();
        await release.promise;
        return original(...args);
      }) as any);
      const first = request(app)
        .post(route)
        .set("x-ai-explicit-request", "true")
        .send(body)
        .then((response) => response);
      try {
        await entered.promise;
        const second = await request(app)
          .post(route)
          .set("x-ai-explicit-request", "true")
          .send(body);
        expect(second.status).toBe(429);
        expect(second.body.usage).toMatchObject({
          used: 1,
          pending: 1,
          remaining: 0,
          limit: 2,
        });
        expect((await quota.getUsage(userId)).used).toBe(1);
        expect(generate).toHaveBeenCalledTimes(1);
      } finally {
        release.resolve();
      }
      expect((await first).status).toBe(200);
      expect((await quota.getUsage(userId)).used).toBe(2);
      const exhausted = await request(app)
        .post(route)
        .set("x-ai-explicit-request", "true")
        .send(body);
      expect(exhausted.status).toBe(429);
      expect(generate).toHaveBeenCalledTimes(1);
    },
  );

  it("releases a slot when generation fails without creating a suggestion", async () => {
    const { app, planner, quota, userId } = fixture();
    jest
      .spyOn(planner, "critiqueTask")
      .mockRejectedValueOnce(new Error("Synthetic generation failure"));
    expect(
      (
        await request(app)
          .post("/ai/task-critic")
          .send({ title: "Synthetic task" })
      ).status,
    ).toBe(500);
    const admitted = await quota.reserveSuggestion(userId);
    expect(admitted.usage).toMatchObject({ used: 0, pending: 0 });
    expect(admitted.slot).not.toBeNull();
    await quota.releaseSuggestion(admitted.slot!);
  });

  it("releases only the saved slot after record persistence fails", async () => {
    const { app, store, quota, userId } = fixture();
    jest
      .spyOn(store, "create")
      .mockRejectedValueOnce(new Error("Synthetic record persistence failure"));
    expect(
      (
        await request(app)
          .post("/ai/task-critic")
          .send({ title: "Synthetic task" })
      ).status,
    ).toBe(500);
    const admitted = await quota.reserveSuggestion(userId);
    expect(admitted.usage).toMatchObject({ used: 0, pending: 0 });
    expect(admitted.slot).not.toBeNull();
    await quota.releaseSuggestion(admitted.slot!);
  });

  it("continues counting accepted and rejected records without refunds", async () => {
    const { store, quota, userId } = fixture();
    for (const status of ["accepted", "rejected"] as const) {
      const record = await store.create({
        userId,
        type: "task_critic",
        input: {},
        output: {},
      });
      await store.updateStatus(userId, record.id, status);
    }
    expect((await quota.getUsage(userId)).used).toBe(2);
    expect((await quota.reserveSuggestion(userId)).slot).toBeNull();
  });

  it("does not allow a save crossing midnight to overflow the new record day", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-10-11T23:59:59.000Z"));
    const store = new InMemoryAiSuggestionStore();
    const quota = new AiQuotaService({
      suggestionStore: store,
      limitsByPlan: { free: 1, pro: 1, team: 1 },
    });
    const owner = "synthetic-midnight-owner";
    const oldSlot = (await quota.reserveSuggestion(owner)).slot!;
    jest.setSystemTime(new Date("2026-10-12T00:00:01.000Z"));
    const newSlot = (await quota.reserveSuggestion(owner)).slot!;
    await quota.saveSuggestion(oldSlot, {
      userId: owner,
      type: "task_critic",
      input: {},
      output: {},
    });
    await expect(
      quota.saveSuggestion(newSlot, {
        userId: owner,
        type: "task_critic",
        input: {},
        output: {},
      }),
    ).rejects.toMatchObject({ status: 429 });
    await quota.releaseSuggestion(newSlot);
    expect((await quota.getUsage(owner)).used).toBe(1);
  });

  it("enforces saved-record quota for forced prewarm while allowing cache reuse", async () => {
    const { store, planner, userId } = fixture();
    const quota = new AiQuotaService({
      suggestionStore: store,
      limitsByPlan: { free: 1, pro: 1, team: 1 },
    });
    const generate = jest.spyOn(planner, "generateDecisionAssistStub");
    const prewarm = new HomeFocusPrewarmService(planner, store, quota);
    expect((await prewarm.prewarmForUser(userId, { force: true })).status).toBe(
      "generated",
    );
    expect((await prewarm.prewarmForUser(userId)).status).toBe("reused");
    await expect(
      prewarm.prewarmForUser(userId, { force: true }),
    ).rejects.toMatchObject({ status: 429 });
    expect(generate).toHaveBeenCalledTimes(1);
    expect((await quota.getUsage(userId)).used).toBe(1);
  });

  it("rejects a concurrent prewarm cache miss before another generation", async () => {
    const { store, planner, userId } = fixture();
    const quota = new AiQuotaService({
      suggestionStore: store,
      limitsByPlan: { free: 1, pro: 1, team: 1 },
    });
    const entered = deferred();
    const release = deferred();
    const original = planner.generateDecisionAssistStub.bind(planner);
    const generate = jest
      .spyOn(planner, "generateDecisionAssistStub")
      .mockImplementation(async (...args) => {
        entered.resolve();
        await release.promise;
        return original(...args);
      });
    const prewarm = new HomeFocusPrewarmService(planner, store, quota);
    const first = prewarm.prewarmForUser(userId, { force: true });
    try {
      await entered.promise;
      await expect(
        prewarm.prewarmForUser(userId, { force: true }),
      ).rejects.toMatchObject({ status: 429 });
      expect(generate).toHaveBeenCalledTimes(1);
    } finally {
      release.resolve();
    }
    expect((await first).status).toBe("generated");
  });

  it.each([
    "postgresql://127.0.0.1:55581/planwren_ai_admission_test_fixture?host=remote.example",
    "postgresql://127.0.0.1:55581/planwren_ai_admission_test_fixture#remote",
    "https://127.0.0.1:55581/planwren_ai_admission_test_fixture",
    "postgresql://remote.example:55581/planwren_ai_admission_test_fixture",
  ])(
    "rejects dangerous disposable fixture URL %s without a connection",
    (url) => {
      expect(() =>
        assertAiAdmissionFixtureUrl(
          url,
          "a802624e-b2a3-4a21-b3c9-f7358e6c286a",
          {},
        ),
      ).toThrow();
    },
  );

  it("rejects PG environment overrides and absent fixture markers", () => {
    const url =
      "postgresql://127.0.0.1:55581/planwren_ai_admission_test_fixture";
    expect(() =>
      assertAiAdmissionFixtureUrl(url, "a802624e-b2a3-4a21-b3c9-f7358e6c286a", {
        PGHOST: "remote.example",
      }),
    ).toThrow();
    expect(() => assertAiAdmissionFixtureUrl(url, undefined, {})).toThrow();
    expect(
      assertAiAdmissionFixtureUrl(
        url,
        "a802624e-b2a3-4a21-b3c9-f7358e6c286a",
        {},
      ).hostname,
    ).toBe("127.0.0.1");
  });
});
