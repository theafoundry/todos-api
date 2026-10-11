import {
  IAiSuggestionStore,
  AiSuggestionCreateInput,
  AiSuggestionRecord,
  AiSuggestionSlot,
} from "./aiSuggestionStore";
import { config } from "../config";
import { nextUtcDayStart, utcDayStart } from "./aiDailyWindow";

export type UserPlan = "free" | "pro" | "team";

export interface AiUsage {
  plan: UserPlan;
  used: number;
  remaining: number;
  limit: number;
  resetAt: string;
}

export interface AiFeedbackContext {
  rejectionSignals: string[];
  acceptanceSignals: string[];
}

export function getCurrentUtcDayStart(): Date {
  return utcDayStart();
}

export function getNextUtcDayStart(): Date {
  const dayStart = getCurrentUtcDayStart();
  return nextUtcDayStart(dayStart);
}

export function buildInsightsRecommendation(params: {
  plan: UserPlan;
  usageRemaining: number;
  usageLimit: number;
  generatedCount: number;
  topRejectedReason?: string;
}): string {
  const usageThreshold = Math.max(1, Math.ceil(params.usageLimit * 0.1));
  if (params.plan === "free" && params.usageRemaining <= usageThreshold) {
    return "You are near your daily AI cap. Upgrade to Pro for higher limits and uninterrupted planning.";
  }
  const reason = (params.topRejectedReason || "").toLowerCase();
  if (
    reason.includes("generic") ||
    reason.includes("vague") ||
    reason.includes("specific")
  ) {
    return "Recent rejections suggest outputs are too generic. Add constraints like owner, metric, and due date to get stronger suggestions.";
  }
  if (params.generatedCount < 3) {
    return "Generate a few more AI suggestions this week to improve personalization and quality tracking.";
  }
  return "Keep rating suggestions after each run to continuously improve output quality.";
}

export class AiQuotaService {
  private readonly suggestionStore: IAiSuggestionStore;
  private readonly limitsByPlan: Record<UserPlan, number>;
  private readonly resolveUserPlan?: (userId: string) => Promise<UserPlan>;

  constructor(params: {
    suggestionStore: IAiSuggestionStore;
    limitsByPlan: Record<UserPlan, number>;
    resolveUserPlan?: (userId: string) => Promise<UserPlan>;
  }) {
    this.suggestionStore = params.suggestionStore;
    this.limitsByPlan = params.limitsByPlan;
    this.resolveUserPlan = params.resolveUserPlan;
  }

  async getUserPlan(userId: string): Promise<UserPlan> {
    if (!this.resolveUserPlan) {
      return "free";
    }
    return this.resolveUserPlan(userId);
  }

  async getUsage(userId: string): Promise<AiUsage> {
    const plan = await this.getUserPlan(userId);
    const dailyLimit = this.limitsByPlan[plan] || this.limitsByPlan.free;
    const dayStart = getCurrentUtcDayStart();
    const used = await this.suggestionStore.countByUserSince(userId, dayStart);
    const remaining = Math.max(dailyLimit - used, 0);
    return {
      plan,
      used,
      remaining,
      limit: dailyLimit,
      resetAt: nextUtcDayStart(dayStart).toISOString(),
    };
  }

  async checkQuota(userId: string): Promise<AiUsage | null> {
    const usage = await this.getUsage(userId);
    if (usage.remaining <= 0) {
      return usage;
    }
    return null;
  }

  async reserveSuggestion(userId: string): Promise<{
    slot: AiSuggestionSlot | null;
    usage: AiUsage & { pending: number };
  }> {
    const result = await this.suggestionStore.reserveSlot({
      userId,
      limitsByPlan: this.limitsByPlan,
      fallbackPlan: await this.getUserPlan(userId),
    });
    return {
      slot: result.slot,
      usage: {
        plan: result.plan,
        used: result.used,
        pending: result.pending,
        remaining: Math.max(result.limit - result.used - result.pending, 0),
        limit: result.limit,
        resetAt: nextUtcDayStart(result.dayStart).toISOString(),
      },
    };
  }

  async saveSuggestion(
    slot: AiSuggestionSlot,
    record: AiSuggestionCreateInput,
  ): Promise<AiSuggestionRecord> {
    return this.suggestionStore.create(record, {
      id: slot.id,
      limitsByPlan: this.limitsByPlan,
      fallbackPlan: await this.getUserPlan(record.userId),
    });
  }

  async releaseSuggestion(slot: AiSuggestionSlot): Promise<void> {
    await this.suggestionStore.releaseSlot(slot.userId, slot.id);
  }

  async getFeedbackContext(userId: string): Promise<AiFeedbackContext> {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const summary = await this.suggestionStore.summarizeFeedbackByUserSince(
      userId,
      since,
      3,
    );
    return {
      rejectionSignals: summary.rejectedReasons.map((item) => item.reason),
      acceptanceSignals: summary.acceptedReasons.map((item) => item.reason),
    };
  }
}

export function buildLimitsByPlan(params: {
  aiDailySuggestionLimit?: number;
  aiDailySuggestionLimitByPlan?: Partial<Record<UserPlan, number>>;
}): Record<UserPlan, number> {
  const defaultLimits: Record<UserPlan, number> = {
    free: config.aiDailySuggestionLimitByPlan.free,
    pro: config.aiDailySuggestionLimitByPlan.pro,
    team: config.aiDailySuggestionLimitByPlan.team,
  };
  const globalOverride =
    params.aiDailySuggestionLimit && params.aiDailySuggestionLimit > 0
      ? params.aiDailySuggestionLimit
      : undefined;
  return {
    free:
      params.aiDailySuggestionLimitByPlan?.free &&
      params.aiDailySuggestionLimitByPlan.free > 0
        ? params.aiDailySuggestionLimitByPlan.free
        : globalOverride || defaultLimits.free || config.aiDailySuggestionLimit,
    pro:
      params.aiDailySuggestionLimitByPlan?.pro &&
      params.aiDailySuggestionLimitByPlan.pro > 0
        ? params.aiDailySuggestionLimitByPlan.pro
        : defaultLimits.pro || config.aiDailySuggestionLimit,
    team:
      params.aiDailySuggestionLimitByPlan?.team &&
      params.aiDailySuggestionLimitByPlan.team > 0
        ? params.aiDailySuggestionLimitByPlan.team
        : defaultLimits.team || config.aiDailySuggestionLimit,
  };
}
