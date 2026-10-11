import { AiPlannerService } from "./aiService";
import type { IAiSuggestionStore } from "./aiSuggestionStore";
import { AiQuotaService, buildLimitsByPlan } from "./aiQuotaService";
import { HttpError } from "../errorHandling";
import {
  findLatestPendingHomeFocusSuggestion,
  normalizeHomeFocusEnvelope,
} from "./aiNormalizationService";

export const DEFAULT_HOME_FOCUS_PREWARM_TOP_N = 3;
export const DEFAULT_HOME_FOCUS_PREWARM_FRESHNESS_HOURS = 18;

export interface HomeFocusPrewarmInput {
  topN?: 3 | 5;
  freshnessHours?: number;
  force?: boolean;
  timezone?: string;
  periodKey?: string;
}

export interface HomeFocusPrewarmResult {
  status: "generated" | "reused";
  suggestionId: string;
  createdAt: string;
  freshUntil: string;
  ageHours: number;
  suggestionCount: number;
  mustAbstain: boolean;
}

export class HomeFocusPrewarmService {
  constructor(
    private readonly aiPlannerService: AiPlannerService,
    private readonly suggestionStore: IAiSuggestionStore,
    private readonly quotaService: AiQuotaService = new AiQuotaService({
      suggestionStore,
      limitsByPlan: buildLimitsByPlan({}),
    }),
  ) {}

  async prewarmForUser(
    userId: string,
    input: HomeFocusPrewarmInput = {},
  ): Promise<HomeFocusPrewarmResult> {
    const topN = input.topN ?? DEFAULT_HOME_FOCUS_PREWARM_TOP_N;
    const freshnessHours =
      input.freshnessHours ?? DEFAULT_HOME_FOCUS_PREWARM_FRESHNESS_HOURS;
    const now = new Date();
    const latest = await findLatestPendingHomeFocusSuggestion(
      this.suggestionStore,
      userId,
    );

    if (!input.force && latest) {
      const existing = this.tryBuildResult(latest, freshnessHours, now);
      if (existing && existing.ageHours < freshnessHours) {
        return { ...existing, status: "reused" };
      }
    }

    const { slot } = await this.quotaService.reserveSuggestion(userId);
    if (!slot) throw new HttpError(429, "Daily AI suggestion limit reached");
    try {
      const output = await this.aiPlannerService.generateDecisionAssistStub(
        {
          surface: "home_focus",
          topN,
        },
        { userId },
      );

      const created = await this.quotaService.saveSuggestion(slot, {
        userId,
        type: "task_critic",
        input: {
          surface: "home_focus",
          topN,
          source: "automation_prewarm",
          ...(typeof input.timezone === "string" && input.timezone
            ? { timezone: input.timezone }
            : {}),
          ...(typeof input.periodKey === "string" && input.periodKey
            ? { periodKey: input.periodKey }
            : {}),
        },
        output: output as unknown as Record<string, unknown>,
      });

      const result = this.tryBuildResult(created, freshnessHours, now);
      if (!result) {
        throw new Error("Failed to normalize generated home focus snapshot");
      }
      return { ...result, status: "generated" };
    } finally {
      try {
        await this.quotaService.releaseSuggestion(slot);
      } catch {
        // Release failure keeps the saved slot reserved until explicit cleanup.
        console.error("AI suggestion reservation release failed");
      }
    }
  }

  private tryBuildResult(
    record: {
      id: string;
      createdAt: Date;
      output: Record<string, unknown>;
    },
    freshnessHours: number,
    now: Date,
  ): Omit<HomeFocusPrewarmResult, "status"> | null {
    try {
      const envelope = normalizeHomeFocusEnvelope(record.output);
      const createdAt = record.createdAt.toISOString();
      const ageHours = this.roundHours(
        (now.getTime() - record.createdAt.getTime()) / (60 * 60 * 1000),
      );
      return {
        suggestionId: record.id,
        createdAt,
        freshUntil: new Date(
          record.createdAt.getTime() + freshnessHours * 60 * 60 * 1000,
        ).toISOString(),
        ageHours,
        suggestionCount: envelope.suggestions.length,
        mustAbstain: envelope.must_abstain || envelope.suggestions.length === 0,
      };
    } catch {
      return null;
    }
  }

  private roundHours(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.round(value * 100) / 100);
  }
}
