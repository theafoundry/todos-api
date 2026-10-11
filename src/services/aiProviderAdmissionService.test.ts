import { PrismaClient } from "@prisma/client";
import {
  AiProviderAdmissionError,
  AiProviderAdmissionService,
} from "./aiProviderAdmissionService";

// Storage fixture exercises policy and settlement without a database or provider.
// The separate PostgreSQL suite verifies the real locking and durability behavior.
function storageFixture() {
  const users = new Map<
    string,
    { plan: "free" | "pro" | "team"; agentConfig: { aiOptOut: boolean } | null }
  >([
    ["user-a", { plan: "free", agentConfig: null }],
    ["user-b", { plan: "pro", agentConfig: null }],
  ]);
  const reservations = new Map<string, any>();
  const userDays = new Map<string, any>();
  const budgetDays = new Map<string, any>();
  let day = "2026-10-11";
  let sequence = 0;
  let chain = Promise.resolve();
  const dayKey = (value: Date) => value.toISOString().slice(0, 10);
  const userKey = (value: { userId: string; dayStart: Date }) =>
    `${value.userId}:${dayKey(value.dayStart)}`;
  const apply = (record: any, data: any) => {
    for (const [key, value] of Object.entries(data)) {
      if (value && typeof value === "object" && "increment" in value)
        record[key] += (value as any).increment;
      else if (value && typeof value === "object" && "decrement" in value)
        record[key] -= (value as any).decrement;
      else record[key] = value;
    }
    return record;
  };
  const tx = {
    $queryRaw: jest.fn(async (strings: TemplateStringsArray) =>
      strings.join("").includes('"utcDay"')
        ? [{ utcDay: day }]
        : [{ value: 1 }],
    ),
    user: {
      findUnique: jest.fn(
        async ({ where }: any) => users.get(where.id) ?? null,
      ),
    },
    aiProviderReservation: {
      findUnique: jest.fn(async ({ where }: any) =>
        where.id
          ? (reservations.get(where.id) ?? null)
          : ([...reservations.values()].find(
              (item) =>
                item.userId === where.userId_requestKey.userId &&
                item.requestKey === where.userId_requestKey.requestKey,
            ) ?? null),
      ),
      findUniqueOrThrow: jest.fn(async ({ where }: any) =>
        reservations.get(where.id),
      ),
      count: jest.fn(
        async ({ where }: any) =>
          [...reservations.values()].filter(
            (item) =>
              (where.userId === undefined || item.userId === where.userId) &&
              where.status.in.includes(item.status),
          ).length,
      ),
      create: jest.fn(async ({ data }: any) => {
        const record = {
          id: `reservation-${++sequence}`,
          status: "reserved",
          chargedCostMicros: null,
          ...data,
        };
        reservations.set(record.id, record);
        return record;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const record = reservations.get(where.id);
        if (!record || record.status !== where.status) return { count: 0 };
        apply(record, data);
        return { count: 1 };
      }),
      update: jest.fn(async ({ where, data }: any) =>
        apply(reservations.get(where.id), data),
      ),
    },
    aiProviderUserDay: {
      upsert: jest.fn(async ({ where, create }: any) => {
        const key = userKey(where.userId_dayStart);
        if (!userDays.has(key))
          userDays.set(key, { requestCount: 0, ...create });
        return userDays.get(key);
      }),
      update: jest.fn(async ({ where, data }: any) =>
        apply(userDays.get(userKey(where.userId_dayStart)), data),
      ),
    },
    aiProviderBudgetDay: {
      count: jest.fn(
        async () =>
          [...budgetDays.values()].filter(
            (item) => item.breachedAt && !item.breachReconciledAt,
          ).length,
      ),
      upsert: jest.fn(async ({ where, create }: any) => {
        const key = dayKey(where.dayStart);
        if (!budgetDays.has(key))
          budgetDays.set(key, {
            reservedCostMicros: 0n,
            spentCostMicros: 0n,
            breachedAt: null,
            breachReconciledAt: null,
            ...create,
          });
        return budgetDays.get(key);
      }),
      update: jest.fn(async ({ where, data }: any) =>
        apply(budgetDays.get(dayKey(where.dayStart)), data),
      ),
      findUnique: jest.fn(
        async ({ where }: any) =>
          budgetDays.get(dayKey(where.dayStart)) ?? null,
      ),
    },
  };
  const db = {
    $transaction: jest.fn(
      (action: (transaction: typeof tx) => Promise<unknown>) => {
        const run = chain.then(async () => {
          const snapshots = [reservations, userDays, budgetDays].map(
            (map) =>
              new Map([...map].map(([key, value]) => [key, { ...value }])),
          );
          try {
            return await action(tx);
          } catch (error) {
            [reservations, userDays, budgetDays].forEach((map, index) => {
              map.clear();
              for (const [key, value] of snapshots[index]) map.set(key, value);
            });
            throw error;
          }
        });
        chain = run.then(
          () => undefined,
          () => undefined,
        );
        return run;
      },
    ),
  };
  return {
    db: db as unknown as PrismaClient,
    tx,
    users,
    reservations,
    userDays,
    budgetDays,
    setDay: (value: string) => {
      day = value;
    },
  };
}

const request = (
  key = "request-1",
  userId = "user-a",
  maxCostMicros = 100,
) => ({ userId, requestKey: key, fingerprint: "a".repeat(64), maxCostMicros });

describe("durable provider admission policy", () => {
  let fixture: ReturnType<typeof storageFixture>;
  let service: AiProviderAdmissionService;
  beforeEach(() => {
    fixture = storageFixture();
    service = new AiProviderAdmissionService({
      prisma: fixture.db,
      limitsByPlan: { free: 2, pro: 3, team: 4 },
      dailyBudgetMicros: 1000,
      maxConcurrent: 4,
      maxConcurrentPerUser: 2,
    });
  });

  it("fails closed before touching storage when the monetary ceiling is absent", async () => {
    const admission = new AiProviderAdmissionService({
      prisma: fixture.db,
      limitsByPlan: { free: 2, pro: 3, team: 4 },
      dailyBudgetMicros: 0,
      maxConcurrent: 4,
      maxConcurrentPerUser: 2,
    });
    await expect(admission.reserve(request())).rejects.toMatchObject({
      code: "AI_PROVIDER_BUDGET_UNCONFIGURED",
      statusCode: 503,
    });
    expect(fixture.db.$transaction).not.toHaveBeenCalled();
  });

  it("requires an explicitly supplied durable client", async () => {
    const admission = new AiProviderAdmissionService({
      limitsByPlan: { free: 2, pro: 3, team: 4 },
      dailyBudgetMicros: 1000,
      maxConcurrent: 4,
      maxConcurrentPerUser: 2,
    });
    await expect(admission.reserve(request())).rejects.toMatchObject({
      code: "AI_PROVIDER_STORE_UNAVAILABLE",
    });
  });

  it.each([0, -1, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects an invalid maximum cost %p before storage",
    async (cost) => {
      await expect(
        service.reserve(request("invalid", "user-a", cost)),
      ).rejects.toBeInstanceOf(AiProviderAdmissionError);
      expect(fixture.db.$transaction).not.toHaveBeenCalled();
    },
  );

  it("reads the current owner plan and opt-out rather than caller tier claims", async () => {
    fixture.users.get("user-a")!.agentConfig = { aiOptOut: true };
    await expect(service.reserve(request())).rejects.toMatchObject({
      code: "AI_PROVIDER_OPTED_OUT",
    });
    fixture.users.get("user-a")!.agentConfig = null;
    fixture.users.get("user-a")!.plan = "pro";
    for (let index = 0; index < 3; index++) {
      const admitted = await service.reserve(request(`pro-${index}`));
      await service.settle({
        reservationId: admitted.reservation.id,
        userId: "user-a",
        outcome: "completed",
        actualCostMicros: 20,
      });
    }
    await expect(service.reserve(request("exhausted"))).rejects.toMatchObject({
      code: "AI_PROVIDER_USER_DAILY_LIMIT",
      retryAt: "2026-10-12T00:00:00.000Z",
    });
  });

  it("replays identical pending or settled identities once and rejects conflicting bounds", async () => {
    const admitted = await service.reserve(request());
    expect(admitted.kind).toBe("new");
    expect((await service.reserve(request())).kind).toBe("replay");
    await service.settle({
      reservationId: admitted.reservation.id,
      userId: "user-a",
      outcome: "completed",
      actualCostMicros: 30,
    });
    expect((await service.reserve(request())).kind).toBe("replay");
    await expect(
      service.reserve(request("request-1", "user-a", 101)),
    ).rejects.toMatchObject({ code: "AI_PROVIDER_IDEMPOTENCY_CONFLICT" });
    expect(fixture.userDays.get("user-a:2026-10-11").requestCount).toBe(1);
  });

  it("reserves maximum aggregate cost before allowing a second account", async () => {
    const admission = new AiProviderAdmissionService({
      prisma: fixture.db,
      limitsByPlan: { free: 5, pro: 5, team: 5 },
      dailyBudgetMicros: 150,
      maxConcurrent: 4,
      maxConcurrentPerUser: 2,
    });
    await admission.reserve(request());
    await expect(
      admission.reserve(request("other", "user-b")),
    ).rejects.toMatchObject({ code: "AI_PROVIDER_GLOBAL_DAILY_BUDGET" });
    expect(fixture.budgetDays.get("2026-10-11").reservedCostMicros).toBe(100n);
  });

  it("settles once and releases only the known unused amount", async () => {
    const admitted = await service.reserve(request());
    await Promise.all(
      [20, 40].map((cost) =>
        service.settle({
          reservationId: admitted.reservation.id,
          userId: "user-a",
          outcome: "completed",
          actualCostMicros: cost,
        }),
      ),
    );
    expect(fixture.budgetDays.get("2026-10-11")).toMatchObject({
      reservedCostMicros: 0n,
      spentCostMicros: 20n,
    });
    expect(fixture.userDays.get("user-a:2026-10-11").requestCount).toBe(1);
  });

  it("charges full maximum for a terminal response with no usage but frees its slot", async () => {
    const admitted = await service.reserve(request());
    const settled = await service.settle({
      reservationId: admitted.reservation.id,
      userId: "user-a",
      outcome: "completed",
    });
    expect(settled.reservation).toMatchObject({
      status: "completed",
      chargedCostMicros: 100,
    });
    expect(fixture.budgetDays.get("2026-10-11").spentCostMicros).toBe(100n);
  });

  it("keeps uncertain execution latched until explicit recovery with no refund", async () => {
    const admitted = await service.reserve(request());
    await service.settle({
      reservationId: admitted.reservation.id,
      userId: "user-a",
      outcome: "uncertain",
      actualCostMicros: 0,
    });
    expect(fixture.reservations.get(admitted.reservation.id).status).toBe(
      "uncertain",
    );
    await service.settle({
      reservationId: admitted.reservation.id,
      userId: "user-a",
      outcome: "completed",
      actualCostMicros: 0,
    });
    expect(fixture.reservations.get(admitted.reservation.id).status).toBe(
      "uncertain",
    );
    await service.reconcileUncertain({
      reservationId: admitted.reservation.id,
      providerRequestEnded: true,
    });
    await service.reconcileUncertain({
      reservationId: admitted.reservation.id,
      providerRequestEnded: true,
    });
    expect(fixture.budgetDays.get("2026-10-11").spentCostMicros).toBe(100n);
    expect(fixture.reservations.get(admitted.reservation.id).status).toBe(
      "reconciled",
    );
  });

  it("does not move settlement or pending concurrency to a new day", async () => {
    const admitted = await service.reserve(request());
    fixture.setDay("2026-10-12");
    await service.settle({
      reservationId: admitted.reservation.id,
      userId: "user-a",
      outcome: "completed",
      actualCostMicros: 30,
    });
    expect(fixture.budgetDays.get("2026-10-11").spentCostMicros).toBe(30n);
    expect(
      (
        await service.reserve(request("next-day"))
      ).reservation.dayStart.toISOString(),
    ).toBe("2026-10-12T00:00:00.000Z");
  });

  it("records a known overrun and latches a circuit across days until reviewed", async () => {
    const admitted = await service.reserve(request());
    const settled = await service.settle({
      reservationId: admitted.reservation.id,
      userId: "user-a",
      outcome: "completed",
      actualCostMicros: 120,
    });
    expect(settled.exceededReservation).toBe(true);
    expect(fixture.budgetDays.get("2026-10-11").spentCostMicros).toBe(120n);
    fixture.setDay("2026-10-12");
    await expect(service.reserve(request("blocked"))).rejects.toMatchObject({
      code: "AI_PROVIDER_COST_BOUND_BREACHED",
    });
    await service.reconcileBudgetBreach({
      dayStart: new Date("2026-10-11T00:00:00.000Z"),
      pricingCorrected: true,
      providerUsageReviewed: true,
    });
    expect((await service.reserve(request("reviewed"))).kind).toBe("new");
    expect(fixture.budgetDays.get("2026-10-11").spentCostMicros).toBe(120n);
  });

  it("retains anonymous pending global admission after account deletion", async () => {
    const admission = new AiProviderAdmissionService({
      prisma: fixture.db,
      limitsByPlan: { free: 5, pro: 5, team: 5 },
      dailyBudgetMicros: 1000,
      maxConcurrent: 1,
      maxConcurrentPerUser: 1,
    });
    const admitted = await admission.reserve(request());
    fixture.users.delete("user-a");
    fixture.reservations.get(admitted.reservation.id).userId = null;
    await expect(
      admission.reserve(request("other", "user-b")),
    ).rejects.toMatchObject({ code: "AI_PROVIDER_CONCURRENCY_LIMIT" });
    await admission.settle({
      reservationId: admitted.reservation.id,
      userId: "user-a",
      outcome: "completed",
    });
    expect(fixture.budgetDays.get("2026-10-11").spentCostMicros).toBe(100n);
  });

  it("fails closed when storage cannot commit", async () => {
    jest
      .spyOn(fixture.db, "$transaction")
      .mockRejectedValueOnce(new Error("fixture database unavailable"));
    await expect(service.reserve(request())).rejects.toMatchObject({
      code: "AI_PROVIDER_STORE_UNAVAILABLE",
      statusCode: 503,
    });
  });
});
