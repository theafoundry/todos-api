import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "crypto";
import { AiProviderAdmissionService } from "./services/aiProviderAdmissionService";
import { AiQuotaService } from "./services/aiQuotaService";
import { PrismaAiSuggestionStore } from "./services/aiSuggestionStore";
import { assertAiAdmissionFixtureUrl } from "../test/aiAdmissionFixture";

// This suite never falls back to application configuration or the general test DB.
// Run only after applying migrations to a newly created disposable local database.
const testDatabaseUrl = process.env.AI_ADMISSION_TEST_DATABASE_URL;
const fixtureMarker = process.env.AI_ADMISSION_TEST_MARKER;
if (testDatabaseUrl) {
  assertAiAdmissionFixtureUrl(testDatabaseUrl, fixtureMarker);
}
const integration = testDatabaseUrl ? describe : describe.skip;

integration("PostgreSQL AI admission transactions", () => {
  let db: PrismaClient;
  let secondDb: PrismaClient;
  let userId: string;
  let otherUserId: string;
  let fixtureVerified = false;
  const fingerprint = "a".repeat(64);
  const input = (owner: string, key = randomUUID(), maxCostMicros = 100) => ({
    userId: owner,
    requestKey: key,
    fingerprint,
    maxCostMicros,
  });
  const admission = (
    overrides: Partial<
      ConstructorParameters<typeof AiProviderAdmissionService>[0]
    > = {},
    client?: PrismaClient,
  ) =>
    new AiProviderAdmissionService({
      prisma: client ?? db,
      limitsByPlan: { free: 10, pro: 20, team: 30 },
      dailyBudgetMicros: 1000,
      maxConcurrent: 20,
      maxConcurrentPerUser: 10,
      ...overrides,
    });

  beforeAll(async () => {
    db = new PrismaClient({
      adapter: new PrismaPg({ connectionString: testDatabaseUrl! }),
    });
    secondDb = new PrismaClient({
      adapter: new PrismaPg({ connectionString: testDatabaseUrl! }),
    });
    const expected = new URL(testDatabaseUrl!);
    const actual = await db.$queryRaw<
      Array<{ database: string; address: string; port: number }>
    >`SELECT current_database() AS "database", host(inet_server_addr()) AS "address", inet_server_port() AS "port"`;
    const marker = await db.$queryRaw<
      Array<{ marker: string }>
    >`SELECT "marker" FROM "planwren_ai_admission_fixture"`;
    if (
      actual[0]?.database !== expected.pathname.slice(1) ||
      !["127.0.0.1", "::1"].includes(actual[0]?.address) ||
      actual[0]?.port !== Number(expected.port) ||
      marker.length !== 1 ||
      marker[0]?.marker !== fixtureMarker
    ) {
      throw new Error(
        "Refusing fixture cleanup: disposable database identity or marker mismatch",
      );
    }
    fixtureVerified = true;
    jest
      .spyOn(global, "fetch")
      .mockRejectedValue(
        new Error("Provider HTTP forbidden in admission fixtures"),
      );
  });
  beforeEach(async () => {
    if (!fixtureVerified)
      throw new Error("Disposable fixture was not verified");
    await db.aiProviderReservation.deleteMany();
    await db.aiProviderUserDay.deleteMany();
    await db.aiProviderBudgetDay.deleteMany();
    await db.aiSuggestionReservation.deleteMany();
    await db.user.deleteMany();
    userId = (
      await db.user.create({
        data: { email: `${randomUUID()}@example.test`, plan: "free" },
      })
    ).id;
    otherUserId = (
      await db.user.create({
        data: { email: `${randomUUID()}@example.test`, plan: "pro" },
      })
    ).id;
  });
  afterEach(() => {
    expect(global.fetch).not.toHaveBeenCalled();
  });
  afterAll(async () => {
    jest.restoreAllMocks();
    await Promise.all([db.$disconnect(), secondDb.$disconnect()]);
  });

  it("allows exactly one concurrent final user slot across independent clients", async () => {
    const services = [
      admission({ limitsByPlan: { free: 1, pro: 2, team: 3 } }),
      admission({ limitsByPlan: { free: 1, pro: 2, team: 3 } }, secondDb),
    ];
    const attempts = await Promise.allSettled(
      Array.from({ length: 12 }, (_, index) =>
        services[index % 2].reserve(input(userId)),
      ),
    );
    expect(
      attempts.filter((attempt) => attempt.status === "fulfilled"),
    ).toHaveLength(1);
    for (const attempt of attempts)
      if (attempt.status === "rejected")
        expect(attempt.reason.code).toBe("AI_PROVIDER_USER_DAILY_LIMIT");
    expect(
      (await db.aiProviderUserDay.findFirstOrThrow({ where: { userId } }))
        .requestCount,
    ).toBe(1);
    expect(await db.aiProviderReservation.count()).toBe(1);
  });

  it("reserves an aggregate cost ceiling atomically across accounts and clients", async () => {
    const services = [
      admission({ dailyBudgetMicros: 200 }),
      admission({ dailyBudgetMicros: 200 }, secondDb),
    ];
    const attempts = await Promise.allSettled(
      Array.from({ length: 8 }, (_, index) =>
        services[index % 2].reserve(input(index % 2 ? userId : otherUserId)),
      ),
    );
    expect(
      attempts.filter((attempt) => attempt.status === "fulfilled"),
    ).toHaveLength(2);
    for (const attempt of attempts)
      if (attempt.status === "rejected")
        expect(attempt.reason.code).toBe("AI_PROVIDER_GLOBAL_DAILY_BUDGET");
    expect(
      (await db.aiProviderBudgetDay.findFirstOrThrow()).reservedCostMicros,
    ).toBe(200n);
  });

  it("commits one dispatcher for concurrent duplicate identities", async () => {
    const request = input(userId);
    const services = [admission(), admission({}, secondDb)];
    const attempts = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        services[index % 2].reserve(request),
      ),
    );
    expect(attempts.filter((attempt) => attempt.kind === "new")).toHaveLength(
      1,
    );
    expect(
      attempts.filter((attempt) => attempt.kind === "replay"),
    ).toHaveLength(7);
    expect(
      new Set(attempts.map((attempt) => attempt.reservation.id)).size,
    ).toBe(1);
    await expect(
      services[0].reserve({ ...request, fingerprint: "b".repeat(64) }),
    ).rejects.toMatchObject({ code: "AI_PROVIDER_IDEMPOTENCY_CONFLICT" });
    expect((await db.aiProviderUserDay.findFirstOrThrow()).requestCount).toBe(
      1,
    );
  });

  it("enforces current database plan and opt-out", async () => {
    const service = admission({ limitsByPlan: { free: 1, pro: 2, team: 3 } });
    const first = await service.reserve(input(userId));
    await service.settle({
      reservationId: first.reservation.id,
      userId,
      outcome: "completed",
    });
    await expect(service.reserve(input(userId))).rejects.toMatchObject({
      code: "AI_PROVIDER_USER_DAILY_LIMIT",
    });
    await db.user.update({ where: { id: userId }, data: { plan: "pro" } });
    await service.reserve(input(userId));
    await db.agentConfig.create({ data: { userId, aiOptOut: true } });
    await expect(service.reserve(input(userId))).rejects.toMatchObject({
      code: "AI_PROVIDER_OPTED_OUT",
    });
    expect(
      (await db.aiProviderUserDay.findFirstOrThrow({ where: { userId } }))
        .requestCount,
    ).toBe(2);
  });

  it("settles competing completions once without refunding request count", async () => {
    const service = admission();
    const reserved = await service.reserve(input(userId));
    await Promise.all(
      [20, 40].map((cost, index) =>
        admission({}, index ? secondDb : db).settle({
          reservationId: reserved.reservation.id,
          userId,
          outcome: "completed",
          actualCostMicros: cost,
        }),
      ),
    );
    const budget = await db.aiProviderBudgetDay.findFirstOrThrow();
    expect(budget.reservedCostMicros).toBe(0n);
    expect([20n, 40n]).toContain(budget.spentCostMicros);
    expect((await db.aiProviderUserDay.findFirstOrThrow()).requestCount).toBe(
      1,
    );
  });

  it("charges missing terminal usage conservatively and releases concurrency", async () => {
    const service = admission({ maxConcurrent: 1, maxConcurrentPerUser: 1 });
    const reserved = await service.reserve(input(userId));
    await service.settle({
      reservationId: reserved.reservation.id,
      userId,
      outcome: "completed",
    });
    expect(
      (
        await db.aiProviderReservation.findUniqueOrThrow({
          where: { id: reserved.reservation.id },
        })
      ).status,
    ).toBe("completed");
    expect(
      (await db.aiProviderBudgetDay.findFirstOrThrow()).spentCostMicros,
    ).toBe(100n);
    await service.reserve(input(otherUserId));
  });

  it("keeps uncertain execution latched after restart until explicit no-refund recovery", async () => {
    const service = admission({ maxConcurrent: 1, maxConcurrentPerUser: 1 });
    const request = input(userId);
    const reserved = await service.reserve(request);
    await service.settle({
      reservationId: reserved.reservation.id,
      userId,
      outcome: "uncertain",
    });
    const restarted = admission(
      { maxConcurrent: 1, maxConcurrentPerUser: 1 },
      secondDb,
    );
    expect((await restarted.reserve(request)).kind).toBe("replay");
    await expect(restarted.reserve(input(otherUserId))).rejects.toMatchObject({
      code: "AI_PROVIDER_CONCURRENCY_LIMIT",
    });
    await restarted.reconcileUncertain({
      reservationId: reserved.reservation.id,
      providerRequestEnded: true,
    });
    expect(
      (await db.aiProviderBudgetDay.findFirstOrThrow()).spentCostMicros,
    ).toBe(100n);
    await restarted.reserve(input(otherUserId));
  });

  it("settles to the admitted bucket after UTC rollover", async () => {
    const service = admission();
    const reserved = await service.reserve(input(userId));
    const oldDay = new Date(
      reserved.reservation.dayStart.getTime() - 86_400_000,
    );
    await db.$transaction([
      db.aiProviderBudgetDay.update({
        where: { dayStart: reserved.reservation.dayStart },
        data: { dayStart: oldDay },
      }),
      db.aiProviderReservation.update({
        where: { id: reserved.reservation.id },
        data: { dayStart: oldDay },
      }),
      db.aiProviderUserDay.update({
        where: {
          userId_dayStart: { userId, dayStart: reserved.reservation.dayStart },
        },
        data: { dayStart: oldDay },
      }),
    ]);
    await service.settle({
      reservationId: reserved.reservation.id,
      userId,
      outcome: "completed",
      actualCostMicros: 30,
    });
    expect(
      (
        await db.aiProviderBudgetDay.findUniqueOrThrow({
          where: { dayStart: oldDay },
        })
      ).spentCostMicros,
    ).toBe(30n);
    expect((await service.reserve(input(userId))).reservation.dayStart).toEqual(
      reserved.reservation.dayStart,
    );
  });

  it("persists known overruns and circuit-breaks subsequent days", async () => {
    const service = admission();
    const reserved = await service.reserve(input(userId));
    expect(
      (
        await service.settle({
          reservationId: reserved.reservation.id,
          userId,
          outcome: "completed",
          actualCostMicros: 120,
        })
      ).exceededReservation,
    ).toBe(true);
    const oldDay = new Date(
      reserved.reservation.dayStart.getTime() - 86_400_000,
    );
    await db.aiProviderBudgetDay.update({
      where: { dayStart: reserved.reservation.dayStart },
      data: { dayStart: oldDay },
    });
    await expect(
      admission({}, secondDb).reserve(input(otherUserId)),
    ).rejects.toMatchObject({ code: "AI_PROVIDER_COST_BOUND_BREACHED" });
    await service.reconcileBudgetBreach({
      dayStart: oldDay,
      pricingCorrected: true,
      providerUsageReviewed: true,
    });
    expect(
      (
        await db.aiProviderBudgetDay.findUniqueOrThrow({
          where: { dayStart: oldDay },
        })
      ).spentCostMicros,
    ).toBe(120n);
  });

  it("keeps unknown concurrency and spending after owner deletion", async () => {
    const service = admission({ maxConcurrent: 1 });
    const reserved = await service.reserve(input(userId));
    await db.user.delete({ where: { id: userId } });
    expect(
      (
        await db.aiProviderReservation.findUniqueOrThrow({
          where: { id: reserved.reservation.id },
        })
      ).userId,
    ).toBeNull();
    expect(await db.aiProviderUserDay.count({ where: { userId } })).toBe(0);
    await expect(service.reserve(input(otherUserId))).rejects.toMatchObject({
      code: "AI_PROVIDER_CONCURRENCY_LIMIT",
    });
    expect(
      (await db.aiProviderBudgetDay.findFirstOrThrow()).reservedCostMicros,
    ).toBe(100n);
    await service.settle({
      reservationId: reserved.reservation.id,
      userId,
      outcome: "uncertain",
    });
    expect(
      (await db.aiProviderBudgetDay.findFirstOrThrow()).spentCostMicros,
    ).toBe(100n);
  });

  it("claims saved suggestion slots atomically while preserving used=record count", async () => {
    const store = new PrismaAiSuggestionStore(db);
    const quota = new AiQuotaService({
      suggestionStore: store,
      limitsByPlan: { free: 1, pro: 2, team: 3 },
    });
    const attempts = await Promise.all(
      Array.from({ length: 8 }, () => quota.reserveSuggestion(userId)),
    );
    expect(attempts.filter((attempt) => attempt.slot)).toHaveLength(1);
    expect((await quota.getUsage(userId)).used).toBe(0);
    const slot = attempts.find((attempt) => attempt.slot)!.slot!;
    await quota.saveSuggestion(slot, {
      userId,
      type: "task_critic",
      input: {},
      output: { synthetic: true },
    });
    expect(await db.aiSuggestionReservation.count()).toBe(0);
    expect((await quota.getUsage(userId)).used).toBe(1);
    expect((await quota.reserveSuggestion(userId)).slot).toBeNull();
    expect(await db.aiProviderUserDay.count()).toBe(0);
  });

  it("rolls back a failed record save and releases only its slot, retaining provider cost", async () => {
    const service = admission();
    const paid = await service.reserve(input(userId));
    await service.settle({
      reservationId: paid.reservation.id,
      userId,
      outcome: "completed",
      actualCostMicros: 20,
    });
    const quota = new AiQuotaService({
      suggestionStore: new PrismaAiSuggestionStore(db),
      limitsByPlan: { free: 1, pro: 2, team: 3 },
    });
    const { slot } = await quota.reserveSuggestion(userId);
    await db.$executeRawUnsafe(
      'ALTER TABLE "ai_suggestions" ADD CONSTRAINT "synthetic_record_save_failure" CHECK (false) NOT VALID',
    );
    try {
      await expect(
        quota.saveSuggestion(slot!, {
          userId,
          type: "task_critic",
          input: {},
          output: {},
        }),
      ).rejects.toThrow();
      expect(await db.aiSuggestion.count({ where: { userId } })).toBe(0);
      expect(
        await db.aiSuggestionReservation.count({ where: { userId } }),
      ).toBe(1);
    } finally {
      await db.$executeRawUnsafe(
        'ALTER TABLE "ai_suggestions" DROP CONSTRAINT "synthetic_record_save_failure"',
      );
      await quota.releaseSuggestion(slot!);
    }
    expect(await db.aiSuggestionReservation.count({ where: { userId } })).toBe(
      0,
    );
    expect(
      (await db.aiProviderBudgetDay.findFirstOrThrow()).spentCostMicros,
    ).toBe(20n);
    expect((await db.aiProviderUserDay.findFirstOrThrow()).requestCount).toBe(
      1,
    );
  });

  it("rechecks the new day and plan before saving a reserved record", async () => {
    const quota = new AiQuotaService({
      suggestionStore: new PrismaAiSuggestionStore(db),
      limitsByPlan: { free: 1, pro: 2, team: 3 },
    });
    const { slot } = await quota.reserveSuggestion(otherUserId);
    await db.aiSuggestionReservation.update({
      where: { id: slot!.id },
      data: { dayStart: new Date(slot!.dayStart.getTime() - 86_400_000) },
    });
    await db.user.update({
      where: { id: otherUserId },
      data: { plan: "free" },
    });
    await db.aiSuggestion.create({
      data: {
        userId: otherUserId,
        type: "task_critic",
        input: {},
        output: {},
        status: "accepted",
      },
    });
    await expect(
      quota.saveSuggestion(slot!, {
        userId: otherUserId,
        type: "task_critic",
        input: {},
        output: {},
      }),
    ).rejects.toMatchObject({ status: 429 });
    await quota.releaseSuggestion(slot!);
    expect(
      await db.aiSuggestion.count({ where: { userId: otherUserId } }),
    ).toBe(1);
  });

  it("uses the post-lock database instant when a save waits across midnight", async () => {
    // Fixture-only clock function gives a real blocked transaction a controlled UTC rollover.
    // CURRENT_TIMESTAMP remains the genuine transaction-start instant on the prior day.
    const tomorrow = new Date(Date.now());
    tomorrow.setUTCHours(0, 0, 0, 0);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const beforeMidnight = new Date(tomorrow.getTime() - 1000);
    const afterMidnight = new Date(tomorrow.getTime() + 1000);
    await db.$executeRawUnsafe('CREATE SCHEMA "admission_clock_fixture"');
    await db.$executeRawUnsafe(
      'CREATE TABLE "admission_clock_fixture"."clock" ("utc_now" TIMESTAMPTZ NOT NULL)',
    );
    await db.$executeRaw`INSERT INTO "admission_clock_fixture"."clock" ("utc_now") VALUES (${beforeMidnight})`;
    await db.$executeRawUnsafe(
      'CREATE FUNCTION "admission_clock_fixture"."clock_timestamp"() RETURNS TIMESTAMPTZ LANGUAGE SQL VOLATILE AS $$ SELECT "utc_now" FROM "admission_clock_fixture"."clock" LIMIT 1 $$',
    );
    const clockDb = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: testDatabaseUrl!,
        options: "-c search_path=admission_clock_fixture,pg_catalog,public",
        application_name: "planwren-ai-midnight-save",
      }),
    });
    const quota = new AiQuotaService({
      suggestionStore: new PrismaAiSuggestionStore(clockDb),
      limitsByPlan: { free: 1, pro: 2, team: 3 },
    });
    const slot = (await quota.reserveSuggestion(userId)).slot!;
    let release!: () => void;
    let locked!: () => void;
    const releasePromise = new Promise<void>((done) => {
      release = done;
    });
    const lockedPromise = new Promise<void>((done) => {
      locked = done;
    });
    const blocker = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${userId} FOR UPDATE`;
      locked();
      await releasePromise;
    });
    await lockedPromise;
    const saving = quota.saveSuggestion(slot, {
      userId,
      type: "task_critic",
      input: {},
      output: { synthetic: true },
    });
    try {
      let waiting = false;
      for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
        const rows = await secondDb.$queryRaw<
          Array<{ count: bigint }>
        >`SELECT count(*) AS "count" FROM pg_stat_activity WHERE application_name = 'planwren-ai-midnight-save' AND wait_event_type = 'Lock'`;
        waiting = rows[0].count > 0n;
        if (!waiting) await new Promise((done) => setTimeout(done, 10));
      }
      expect(waiting).toBe(true);
      await db.$executeRaw`UPDATE "admission_clock_fixture"."clock" SET "utc_now" = ${afterMidnight}`;
      release();
      await blocker;
      const created = await saving;
      expect(created.createdAt).toEqual(afterMidnight);
      expect(created.createdAt.getTime()).toBeGreaterThanOrEqual(
        tomorrow.getTime(),
      );
      expect(
        await db.aiSuggestion.count({
          where: { userId, createdAt: { gte: tomorrow } },
        }),
      ).toBe(1);
      expect((await quota.reserveSuggestion(userId)).slot).toBeNull();
    } finally {
      release();
      await blocker;
      await saving.catch(() => undefined);
      await clockDb.$disconnect();
      await db.$executeRawUnsafe(
        'DROP SCHEMA "admission_clock_fixture" CASCADE',
      );
    }
  });
});
