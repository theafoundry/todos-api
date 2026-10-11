import type { PrismaClient } from "@prisma/client";
import express from "express";
import request from "supertest";
import { config } from "./config";
import type { ITodoService } from "./interfaces/ITodoService";
import { createAdaptationRouter } from "./routes/adaptationRouter";
import { createFocusBriefRouter } from "./routes/focusBriefRouter";
import { createPrioritiesBriefRouter } from "./routes/prioritiesBriefRouter";
import { AdaptationLlmInferenceService } from "./services/adaptationLlmInference";
import { AdaptationProjectInferenceService } from "./services/adaptationProjectInferenceService";
import { AiPlannerService } from "./services/aiService";
import { FeedbackTriageService } from "./services/feedbackTriageService";
import { callLlm, LlmProviderNotConfiguredError } from "./services/llmService";
import type { UserAdaptationService } from "./services/userAdaptationService";

const fixtureKey = "synthetic-provider-key-never-sent";
const originalProviderConfig = {
  enabled: config.aiProviderEnabled,
  key: config.aiProviderApiKey,
};

function createPlanner(alreadyCreated: boolean): AiPlannerService {
  // Exercise the concrete HTTP provider selected at construction, including an
  // instance created before the switch was disabled. Do not inject a mock provider.
  config.aiProviderEnabled = alreadyCreated;
  const planner = new AiPlannerService();
  config.aiProviderEnabled = false;
  return planner;
}

function feedbackFixture() {
  const prisma = {
    feedbackRequest: {
      findUnique: jest.fn().mockResolvedValue({
        id: "synthetic-feedback",
        userId: "synthetic-user",
        type: "bug",
        title: "Task drawer crashes on save",
        body: "The task drawer crashed when I saved a task.",
        screenshotUrl: null,
        pageUrl: null,
        userAgent: null,
        appVersion: null,
        triageSummary: null,
        dedupeKey: null,
      }),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const failureService = {
    record: jest.fn().mockResolvedValue({}),
    resolveOpenForFeedback: jest.fn().mockResolvedValue(undefined),
  };
  return { prisma, failureService };
}

function briefApp(kind: "focus" | "priorities", userId: string) {
  const app = express();
  const deps = {
    todoService: {
      findAll: jest.fn().mockResolvedValue([]),
    } as unknown as ITodoService,
    resolveUserId: () => userId,
  };
  app.use(
    "/ai",
    kind === "focus"
      ? createFocusBriefRouter(deps)
      : createPrioritiesBriefRouter(deps),
  );
  return app;
}

describe("hosted AI disabled", () => {
  let fetchSpy: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    config.aiProviderEnabled = false;
    // A key remains present to prove that the enable switch, not missing
    // credentials, prevents outbound HTTP. It is a synthetic fixture value.
    config.aiProviderApiKey = fixtureKey;
    fetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Unexpected outbound provider HTTP"));
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    config.aiProviderEnabled = originalProviderConfig.enabled;
    config.aiProviderApiKey = originalProviderConfig.key;
    jest.restoreAllMocks();
  });

  it("rejects direct text-provider calls before outbound HTTP", async () => {
    await expect(
      callLlm({
        systemPrompt: "Synthetic system",
        userPrompt: "Synthetic task",
      }),
    ).rejects.toBeInstanceOf(LlmProviderNotConfiguredError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  describe.each([
    ["fresh", false],
    ["already-created", true],
  ] as const)("%s planner", (_label, alreadyCreated) => {
    it("returns a usable task critique without provider HTTP", async () => {
      const result = await createPlanner(alreadyCreated).critiqueTask({
        title: "Write a synthetic launch checklist",
      });
      expect(result.improvedTitle).toBeTruthy();
      expect(result.qualityScore).toEqual(expect.any(Number));
      expect(Array.isArray(result.suggestions)).toBe(true);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("returns a bounded goal plan without provider HTTP", async () => {
      const result = await createPlanner(alreadyCreated).planFromGoal({
        goal: "Prepare a synthetic launch",
        maxTasks: 3,
      });
      expect(result.tasks.length).toBeGreaterThan(0);
      expect(result.tasks.length).toBeLessThanOrEqual(3);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("returns task subtasks without provider HTTP", async () => {
      const result = await createPlanner(
        alreadyCreated,
      ).breakdownTodoIntoSubtasks({
        title: "Write a synthetic launch checklist",
        maxSubtasks: 3,
      });
      expect(result.subtasks).toHaveLength(3);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("returns a deterministic morning brief without provider HTTP", async () => {
      const result = await createPlanner(alreadyCreated).generateMorningBrief({
        tasks: [{ title: "Write a synthetic launch checklist" }],
      });
      expect(result).toMatchObject({
        deterministic: true,
        brief: expect.stringContaining("Write a synthetic launch checklist"),
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  it.each([
    ["fresh", false],
    ["already-created", true],
  ] as const)(
    "persists deterministic %s feedback triage without provider HTTP",
    async (_label, alreadyCreated) => {
      const { prisma, failureService } = feedbackFixture();
      config.aiProviderEnabled = alreadyCreated;
      const service = new FeedbackTriageService(
        prisma as unknown as PrismaClient,
        {
          feedbackFailureService: failureService as never,
        },
      );
      config.aiProviderEnabled = false;
      const result = await service.triageFeedback("synthetic-feedback");
      expect(result.classification).toBe("bug");
      expect(prisma.feedbackRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ classification: "bug" }),
        }),
      );
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  it.each(["focus", "priorities"] as const)(
    "declines a new %s brief without provider HTTP",
    async (kind) => {
      const app = briefApp(kind, `synthetic-disabled-${kind}`);
      await request(app).get(`/ai/${kind}-brief`).expect(503);
      await request(app).post(`/ai/${kind}-brief/refresh`);
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  it.each(["focus", "priorities"] as const)(
    "does not call a provider when disabled after caching a %s brief",
    async (kind) => {
      const app = briefApp(kind, `synthetic-cached-${kind}`);
      const content =
        kind === "focus"
          ? JSON.stringify({
              rightNow: {
                narrative: "Synthetic brief",
                urgentItems: [],
                topRecommendation: null,
              },
              whatNext: [],
              panelRanking: [],
            })
          : "<div>Synthetic brief</div>";
      fetchSpy.mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [{ message: { content } }] }),
      } as Response);
      config.aiProviderEnabled = true;
      await request(app).get(`/ai/${kind}-brief`).expect(200);
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      config.aiProviderEnabled = false;
      fetchSpy.mockClear();
      await request(app).get(`/ai/${kind}-brief`);
      await request(app).post(`/ai/${kind}-brief/refresh`);
      await request(app).get(`/ai/${kind}-brief`);
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  it("returns no soft inference through the adaptation route without provider HTTP", async () => {
    const prisma = {
      project: {
        findFirst: jest.fn().mockResolvedValue({
          id: "synthetic-project",
          name: "Synthetic launch",
          description: null,
        }),
      },
      todo: { findMany: jest.fn().mockResolvedValue([]) },
      heading: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as PrismaClient;
    const adaptation = {
      getOrCreateProfile: jest
        .fn()
        .mockResolvedValue({ profile: { confidence: 0.1 } }),
    } as unknown as UserAdaptationService;
    const service = new AdaptationProjectInferenceService(
      prisma,
      adaptation,
      new AdaptationLlmInferenceService(),
    );
    const app = express();
    app.use(
      "/adaptation",
      createAdaptationRouter({
        adaptationService: adaptation,
        projectInferenceService: service,
        resolveUserId: () => "synthetic-user",
      }),
    );
    const result = await request(app)
      .get("/adaptation/projects/synthetic-project/soft-inference")
      .expect(200);
    expect(result.body.inference).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("keeps section and hint helpers deterministic without provider HTTP", async () => {
    const service = new AdaptationLlmInferenceService();
    await expect(
      service.suggestStarterSections({
        projectName: "Synthetic launch",
        taskTitles: [],
      }),
    ).resolves.toEqual([]);
    await expect(
      service.recommendHintStyle({
        projectName: "Synthetic launch",
        taskCount: 0,
        sectionCount: 0,
        hasDates: false,
      }),
    ).resolves.toBe("supportive");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
