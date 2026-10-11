import {
  AiQuotaService,
  buildInsightsRecommendation,
  buildLimitsByPlan,
  getCurrentUtcDayStart,
  getNextUtcDayStart,
  UserPlan,
} from "./services/aiQuotaService";
import {
  IAiSuggestionStore,
  AiFeedbackSummary,
} from "./services/aiSuggestionStore";

// ── Helpers ──

function buildMockStore(
  overrides: Partial<IAiSuggestionStore> = {},
): IAiSuggestionStore {
  return {
    create: jest.fn(),
    reserveSlot: jest.fn(),
    releaseSlot: jest.fn(),
    listByUser: jest.fn(),
    getById: jest.fn(),
    countByUserSince: jest.fn().mockResolvedValue(0),
    summarizeFeedbackByUserSince: jest.fn().mockResolvedValue({
      acceptedCount: 0,
      rejectedCount: 0,
      acceptedReasons: [],
      rejectedReasons: [],
    } satisfies AiFeedbackSummary),
    markApplied: jest.fn(),
    updateStatus: jest.fn(),
    ...overrides,
  };
}

const DEFAULT_LIMITS: Record<UserPlan, number> = {
  free: 10,
  pro: 50,
  team: 100,
};

// ── Date helpers ──

describe("getCurrentUtcDayStart / getNextUtcDayStart", () => {
  it("returns midnight UTC for the current day", () => {
    const dayStart = getCurrentUtcDayStart();
    expect(dayStart.getUTCHours()).toBe(0);
    expect(dayStart.getUTCMinutes()).toBe(0);
    expect(dayStart.getUTCSeconds()).toBe(0);
    expect(dayStart.getUTCMilliseconds()).toBe(0);
  });

  it("next day start is exactly 24h after day start", () => {
    const dayStart = getCurrentUtcDayStart();
    const nextDay = getNextUtcDayStart();
    expect(nextDay.getTime() - dayStart.getTime()).toBe(86_400_000);
  });
});

// ── AiQuotaService ──

describe("AiQuotaService", () => {
  describe("getUserPlan", () => {
    it("defaults to free when no resolver is provided", async () => {
      const svc = new AiQuotaService({
        suggestionStore: buildMockStore(),
        limitsByPlan: DEFAULT_LIMITS,
      });
      expect(await svc.getUserPlan("user-1")).toBe("free");
    });

    it("delegates to resolver when provided", async () => {
      const resolver = jest.fn().mockResolvedValue("pro" as UserPlan);
      const svc = new AiQuotaService({
        suggestionStore: buildMockStore(),
        limitsByPlan: DEFAULT_LIMITS,
        resolveUserPlan: resolver,
      });
      expect(await svc.getUserPlan("user-1")).toBe("pro");
      expect(resolver).toHaveBeenCalledWith("user-1");
    });
  });

  describe("getUsage", () => {
    it("computes remaining from limit minus used", async () => {
      const store = buildMockStore({
        countByUserSince: jest.fn().mockResolvedValue(7),
      });
      const svc = new AiQuotaService({
        suggestionStore: store,
        limitsByPlan: DEFAULT_LIMITS,
      });

      const usage = await svc.getUsage("user-1");

      expect(usage.plan).toBe("free");
      expect(usage.limit).toBe(10);
      expect(usage.used).toBe(7);
      expect(usage.remaining).toBe(3);
      expect(typeof usage.resetAt).toBe("string");
    });

    it("clamps remaining to zero when over limit", async () => {
      const store = buildMockStore({
        countByUserSince: jest.fn().mockResolvedValue(15),
      });
      const svc = new AiQuotaService({
        suggestionStore: store,
        limitsByPlan: DEFAULT_LIMITS,
      });

      const usage = await svc.getUsage("user-1");
      expect(usage.remaining).toBe(0);
    });
  });

  describe("checkQuota", () => {
    it("returns null when under quota", async () => {
      const store = buildMockStore({
        countByUserSince: jest.fn().mockResolvedValue(5),
      });
      const svc = new AiQuotaService({
        suggestionStore: store,
        limitsByPlan: DEFAULT_LIMITS,
      });

      expect(await svc.checkQuota("user-1")).toBeNull();
    });

    it("returns usage when quota exceeded", async () => {
      const store = buildMockStore({
        countByUserSince: jest.fn().mockResolvedValue(10),
      });
      const svc = new AiQuotaService({
        suggestionStore: store,
        limitsByPlan: DEFAULT_LIMITS,
      });

      const result = await svc.checkQuota("user-1");
      expect(result).not.toBeNull();
      expect(result!.remaining).toBe(0);
    });
  });

  describe("getFeedbackContext", () => {
    it("maps store summary to rejection and acceptance signals", async () => {
      const store = buildMockStore({
        summarizeFeedbackByUserSince: jest.fn().mockResolvedValue({
          acceptedCount: 5,
          rejectedCount: 2,
          acceptedReasons: [{ reason: "helpful", count: 5 }],
          rejectedReasons: [{ reason: "too generic", count: 2 }],
        } satisfies AiFeedbackSummary),
      });
      const svc = new AiQuotaService({
        suggestionStore: store,
        limitsByPlan: DEFAULT_LIMITS,
      });

      const ctx = await svc.getFeedbackContext("user-1");
      expect(ctx.acceptanceSignals).toEqual(["helpful"]);
      expect(ctx.rejectionSignals).toEqual(["too generic"]);
    });
  });
});

// ── buildInsightsRecommendation ──

describe("buildInsightsRecommendation", () => {
  it("recommends upgrade when free plan is near cap", () => {
    const result = buildInsightsRecommendation({
      plan: "free",
      usageRemaining: 1,
      usageLimit: 10,
      generatedCount: 10,
    });
    expect(result).toContain("Upgrade to Pro");
  });

  it("recommends constraints when rejections are generic", () => {
    const result = buildInsightsRecommendation({
      plan: "pro",
      usageRemaining: 40,
      usageLimit: 50,
      generatedCount: 20,
      topRejectedReason: "Too generic output",
    });
    expect(result).toContain("generic");
  });

  it("recommends more generation when count is low", () => {
    const result = buildInsightsRecommendation({
      plan: "pro",
      usageRemaining: 40,
      usageLimit: 50,
      generatedCount: 1,
    });
    expect(result).toContain("Generate a few more");
  });

  it("falls back to rating advice", () => {
    const result = buildInsightsRecommendation({
      plan: "pro",
      usageRemaining: 40,
      usageLimit: 50,
      generatedCount: 10,
    });
    expect(result).toContain("Keep rating");
  });
});

// ── buildLimitsByPlan ──

describe("buildLimitsByPlan", () => {
  it("uses per-plan overrides when provided", () => {
    const limits = buildLimitsByPlan({
      aiDailySuggestionLimitByPlan: { free: 5, pro: 25, team: 75 },
    });
    expect(limits.free).toBe(5);
    expect(limits.pro).toBe(25);
    expect(limits.team).toBe(75);
  });

  it("uses global override for free when per-plan not set", () => {
    const limits = buildLimitsByPlan({
      aiDailySuggestionLimit: 20,
    });
    expect(limits.free).toBe(20);
  });
});
