import { PrismaClient } from "@prisma/client";

/**
 * Purges an account's old activity events, insights, and metrics.
 */
export class DataRetentionService {
  constructor(private readonly prisma: PrismaClient) {}

  private validateUserId(userId: string): void {
    if (typeof userId !== "string" || !userId.trim()) {
      throw new Error("User ID is required for data retention");
    }
  }

  private cutoff(olderThanDays: number, now = new Date()): Date {
    if (!Number.isSafeInteger(olderThanDays) || olderThanDays <= 0) {
      throw new Error("Retention days must be a positive integer");
    }
    const cutoff = new Date(now.getTime() - olderThanDays * 86_400_000);
    if (!Number.isFinite(cutoff.getTime())) {
      throw new Error("Retention days are outside the supported date range");
    }
    return cutoff;
  }

  async purgeOldActivityEvents(
    userId: string,
    olderThanDays = 90,
  ): Promise<number> {
    this.validateUserId(userId);
    const cutoff = this.cutoff(olderThanDays);

    const result = await this.prisma.activityEvent.deleteMany({
      where: { userId, createdAt: { lt: cutoff } },
    });
    return result.count;
  }

  async purgeOldInsights(userId: string, olderThanDays = 365): Promise<number> {
    this.validateUserId(userId);
    const cutoff = this.cutoff(olderThanDays);

    const result = await this.prisma.userInsight.deleteMany({
      where: { userId, computedAt: { lt: cutoff } },
    });
    return result.count;
  }

  async purgeOldMetricEvents(
    userId: string,
    olderThanDays = 180,
  ): Promise<number> {
    this.validateUserId(userId);
    const cutoff = this.cutoff(olderThanDays);

    const result = await this.prisma.agentMetricEvent.deleteMany({
      where: { userId, recordedAt: { lt: cutoff } },
    });
    return result.count;
  }

  async purgeAll(userId: string): Promise<{
    activityEvents: number;
    insights: number;
    metricEvents: number;
  }> {
    this.validateUserId(userId);
    const now = new Date();
    const [activityEvents, insights, metricEvents] = await Promise.all([
      this.prisma.activityEvent.deleteMany({
        where: { userId, createdAt: { lt: this.cutoff(90, now) } },
      }),
      this.prisma.userInsight.deleteMany({
        where: { userId, computedAt: { lt: this.cutoff(365, now) } },
      }),
      this.prisma.agentMetricEvent.deleteMany({
        where: { userId, recordedAt: { lt: this.cutoff(180, now) } },
      }),
    ]);
    return {
      activityEvents: activityEvents.count,
      insights: insights.count,
      metricEvents: metricEvents.count,
    };
  }
}
