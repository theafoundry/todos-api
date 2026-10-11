import { DataRetentionService } from "./dataRetentionService";
import { DataExportService } from "./dataExportService";

function database() {
  return {
    activityEvent: { deleteMany: jest.fn().mockResolvedValue({ count: 2 }) },
    userInsight: { deleteMany: jest.fn().mockResolvedValue({ count: 3 }) },
    agentMetricEvent: { deleteMany: jest.fn().mockResolvedValue({ count: 4 }) },
    $transaction: jest.fn(),
  };
}

describe("Account-scoped data retention", () => {
  afterEach(() => jest.useRealTimers());

  it("uses the established UTC durations and one instant for the whole purge", async () => {
    const now = new Date("2026-03-09T12:34:56.789Z");
    jest.useFakeTimers().setSystemTime(now);
    const db = database();
    await expect(
      new DataRetentionService(db as any).purgeAll("owner"),
    ).resolves.toEqual({
      activityEvents: 2,
      insights: 3,
      metricEvents: 4,
    });
    for (const [model, field, days] of [
      [db.activityEvent, "createdAt", 90],
      [db.userInsight, "computedAt", 365],
      [db.agentMetricEvent, "recordedAt", 180],
    ] as const) {
      expect(model.deleteMany).toHaveBeenCalledWith({
        where: {
          userId: "owner",
          [field]: { lt: new Date(now.getTime() - days * 86_400_000) },
        },
      });
    }
  });

  test.each([undefined, null, "", "   "])(
    "rejects absent actor %p before any delete",
    async (userId) => {
      const db = database();
      const service = new DataRetentionService(db as any);
      for (const method of [
        "purgeAll",
        "purgeOldActivityEvents",
        "purgeOldInsights",
        "purgeOldMetricEvents",
      ] as const) {
        await expect(service[method](userId as any)).rejects.toThrow(
          "User ID is required",
        );
      }
      expect(db.activityEvent.deleteMany).not.toHaveBeenCalled();
      expect(db.userInsight.deleteMany).not.toHaveBeenCalled();
      expect(db.agentMetricEvent.deleteMany).not.toHaveBeenCalled();
    },
  );

  test.each([0, -1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER, "90"])(
    "rejects unsafe duration %p before any delete",
    async (days) => {
      const db = database();
      const service = new DataRetentionService(db as any);
      for (const method of [
        "purgeOldActivityEvents",
        "purgeOldInsights",
        "purgeOldMetricEvents",
      ] as const) {
        await expect(service[method]("owner", days as number)).rejects.toThrow(
          "Retention days",
        );
      }
      expect(db.activityEvent.deleteMany).not.toHaveBeenCalled();
      expect(db.userInsight.deleteMany).not.toHaveBeenCalled();
      expect(db.agentMetricEvent.deleteMany).not.toHaveBeenCalled();
    },
  );

  test.each([undefined, null, "", "   "])(
    "export rejects absent actor %p before a transaction",
    async (userId) => {
      const db = database();
      await expect(
        new DataExportService(db as any).exportAllUserData(userId as any),
      ).rejects.toThrow("User ID is required");
      expect(db.$transaction).not.toHaveBeenCalled();
    },
  );
});
