import { Prisma, PrismaClient } from "@prisma/client";
import { config } from "../config";
import type { UserPlan } from "./aiQuotaService";
import { databaseUtcDayStart, nextUtcDayStart } from "./aiDailyWindow";

export class AiProviderAdmissionError extends Error {
  readonly code: string;
  readonly statusCode: 429 | 503;
  readonly retryAt?: string;

  constructor(params: {
    code: string;
    statusCode: 429 | 503;
    message: string;
    retryAt?: string;
  }) {
    super(params.message);
    this.name = "AiProviderAdmissionError";
    this.code = params.code;
    this.statusCode = params.statusCode;
    this.retryAt = params.retryAt;
  }
}

export interface AiProviderReservation {
  id: string;
  userId: string | null;
  requestKey: string;
  fingerprint: string;
  dayStart: Date;
  status: "reserved" | "completed" | "uncertain" | "reconciled";
  reservedCostMicros: number;
  chargedCostMicros: number | null;
}

export interface AiProviderReserveInput {
  userId: string;
  requestKey: string;
  fingerprint: string;
  maxCostMicros: number;
}

export interface AiProviderAdmission {
  kind: "new" | "replay";
  reservation: AiProviderReservation;
}

export interface AiProviderSettlement {
  reservation: AiProviderReservation;
  exceededReservation: boolean;
}

type StoredReservation = {
  id: string;
  userId: string | null;
  requestKey: string;
  fingerprint: string;
  dayStart: Date;
  status: AiProviderReservation["status"];
  reservedCostMicros: bigint;
  chargedCostMicros: bigint | null;
};

const ACTIVE_STATUSES = ["reserved", "uncertain"] as const;
const positiveInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;

function denied(
  code: string,
  message: string,
  statusCode: 429 | 503 = 503,
  retryAt?: string,
): AiProviderAdmissionError {
  return new AiProviderAdmissionError({ code, message, statusCode, retryAt });
}

function mapReservation(record: StoredReservation): AiProviderReservation {
  return {
    id: record.id,
    userId: record.userId,
    requestKey: record.requestKey,
    fingerprint: record.fingerprint,
    dayStart: record.dayStart,
    status: record.status,
    reservedCostMicros: Number(record.reservedCostMicros),
    chargedCostMicros:
      record.chargedCostMicros === null
        ? null
        : Number(record.chargedCostMicros),
  };
}

/** Durable provider admission. No HTTP or output persistence belongs in these transactions. */
export class AiProviderAdmissionService {
  private readonly prisma?: PrismaClient;
  private readonly limitsByPlan?: Record<UserPlan, number>;
  private readonly dailyBudgetMicros?: number;
  private readonly maxConcurrent: number;
  private readonly maxConcurrentPerUser: number;

  constructor(
    params: {
      prisma?: PrismaClient;
      limitsByPlan?: Record<UserPlan, number>;
      dailyBudgetMicros?: number;
      maxConcurrent?: number;
      maxConcurrentPerUser?: number;
    } = {},
  ) {
    this.prisma = params.prisma;
    this.limitsByPlan =
      params.limitsByPlan ?? config.aiProviderDailyRequestLimitByPlan;
    this.dailyBudgetMicros =
      params.dailyBudgetMicros ?? config.aiProviderDailyBudgetMicros;
    this.maxConcurrent = params.maxConcurrent ?? config.aiProviderMaxConcurrent;
    this.maxConcurrentPerUser =
      params.maxConcurrentPerUser ?? config.aiProviderMaxConcurrentPerUser;
  }

  private requireConfiguration(): void {
    if (!positiveInteger(this.dailyBudgetMicros)) {
      throw denied(
        "AI_PROVIDER_BUDGET_UNCONFIGURED",
        "Hosted AI has no configured daily spending ceiling",
      );
    }
    if (
      !this.limitsByPlan ||
      !["free", "pro", "team"].every((plan) =>
        positiveInteger(this.limitsByPlan?.[plan as UserPlan]),
      ) ||
      !positiveInteger(this.maxConcurrent) ||
      !positiveInteger(this.maxConcurrentPerUser)
    ) {
      throw denied(
        "AI_PROVIDER_LIMITS_UNCONFIGURED",
        "Hosted AI admission limits are not configured",
      );
    }
  }

  // One database-wide transaction lock also serializes concurrency across UTC midnight.
  // All processes sharing this database must use this boundary before dispatching.
  private async lockAdmission(tx: Prisma.TransactionClient): Promise<void> {
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(1196446286, 1)`;
  }

  private async transaction<T>(
    action: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    if (!this.prisma) {
      throw denied(
        "AI_PROVIDER_STORE_UNAVAILABLE",
        "Hosted AI admission is unavailable",
      );
    }
    try {
      return await this.prisma.$transaction(action);
    } catch (error) {
      if (error instanceof AiProviderAdmissionError) throw error;
      throw denied(
        "AI_PROVIDER_STORE_UNAVAILABLE",
        "Hosted AI admission is unavailable",
      );
    }
  }

  async reserve(input: AiProviderReserveInput): Promise<AiProviderAdmission> {
    this.requireConfiguration();
    if (
      !input.userId ||
      !/^[A-Za-z0-9:_-]{1,128}$/.test(input.requestKey) ||
      !/^[a-f0-9]{64}$/.test(input.fingerprint) ||
      !positiveInteger(input.maxCostMicros)
    ) {
      throw denied(
        "AI_PROVIDER_INVALID_ADMISSION",
        "Hosted AI request cannot be admitted",
      );
    }
    return this.transaction(async (tx) => {
      await this.lockAdmission(tx);
      const breaches = await tx.aiProviderBudgetDay.count({
        where: { breachedAt: { not: null }, breachReconciledAt: null },
      });
      if (breaches > 0) {
        throw denied(
          "AI_PROVIDER_COST_BOUND_BREACHED",
          "Hosted AI spending bounds require operator review",
        );
      }
      // User and existing config locks keep plan/opt-out changes outside this decision.
      // The user lock also prevents an absent config being inserted through its FK.
      await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${input.userId} FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "agent_configs" WHERE "user_id" = ${input.userId} FOR UPDATE`;
      const user = await tx.user.findUnique({
        where: { id: input.userId },
        select: { plan: true, agentConfig: { select: { aiOptOut: true } } },
      });
      if (!user) {
        throw denied(
          "AI_PROVIDER_ACCOUNT_UNAVAILABLE",
          "Hosted AI account is unavailable",
        );
      }
      if (user.agentConfig?.aiOptOut) {
        throw denied(
          "AI_PROVIDER_OPTED_OUT",
          "Hosted AI is disabled for this account",
        );
      }
      const existing = await tx.aiProviderReservation.findUnique({
        where: {
          userId_requestKey: {
            userId: input.userId,
            requestKey: input.requestKey,
          },
        },
      });
      if (existing) {
        if (
          existing.fingerprint !== input.fingerprint ||
          existing.reservedCostMicros !== BigInt(input.maxCostMicros)
        ) {
          throw denied(
            "AI_PROVIDER_IDEMPOTENCY_CONFLICT",
            "Hosted AI request identity conflicts",
          );
        }
        // Replays must never redispatch, including a reservation whose process crashed.
        return { kind: "replay", reservation: mapReservation(existing) };
      }
      const dayStart = await databaseUtcDayStart(tx);
      const retryAt = nextUtcDayStart(dayStart).toISOString();
      const plan = user.plan as UserPlan;
      const limit = this.limitsByPlan![plan];
      const userDay = await tx.aiProviderUserDay.upsert({
        where: { userId_dayStart: { userId: input.userId, dayStart } },
        create: { userId: input.userId, dayStart },
        update: {},
      });
      if (userDay.requestCount >= limit) {
        throw denied(
          "AI_PROVIDER_USER_DAILY_LIMIT",
          "Daily hosted AI request limit reached",
          429,
          retryAt,
        );
      }
      const budgetDay = await tx.aiProviderBudgetDay.upsert({
        where: { dayStart },
        create: { dayStart },
        update: {},
      });
      const reservationCost = BigInt(input.maxCostMicros);
      if (
        budgetDay.reservedCostMicros +
          budgetDay.spentCostMicros +
          reservationCost >
        BigInt(this.dailyBudgetMicros!)
      ) {
        throw denied(
          "AI_PROVIDER_GLOBAL_DAILY_BUDGET",
          "Daily hosted AI spending ceiling reached",
          429,
          retryAt,
        );
      }
      const active = await tx.aiProviderReservation.count({
        where: { status: { in: [...ACTIVE_STATUSES] } },
      });
      const userActive = await tx.aiProviderReservation.count({
        where: { userId: input.userId, status: { in: [...ACTIVE_STATUSES] } },
      });
      if (
        active >= this.maxConcurrent ||
        userActive >= this.maxConcurrentPerUser
      ) {
        // There is no promised expiry: an ambiguous request requires operator recovery.
        throw denied(
          "AI_PROVIDER_CONCURRENCY_LIMIT",
          "Hosted AI is already processing its available requests",
          429,
        );
      }
      await tx.aiProviderUserDay.update({
        where: { userId_dayStart: { userId: input.userId, dayStart } },
        data: { requestCount: { increment: 1 } },
      });
      await tx.aiProviderBudgetDay.update({
        where: { dayStart },
        data: { reservedCostMicros: { increment: reservationCost } },
      });
      const created = await tx.aiProviderReservation.create({
        data: {
          userId: input.userId,
          requestKey: input.requestKey,
          fingerprint: input.fingerprint,
          dayStart,
          reservedCostMicros: reservationCost,
        },
      });
      return { kind: "new", reservation: mapReservation(created) };
    });
  }

  async settle(input: {
    reservationId: string;
    userId: string;
    outcome: "completed" | "uncertain";
    actualCostMicros?: number;
    usageBoundBreached?: boolean;
  }): Promise<AiProviderSettlement> {
    if (!input.userId || !["completed", "uncertain"].includes(input.outcome)) {
      throw denied(
        "AI_PROVIDER_INVALID_SETTLEMENT",
        "Hosted AI settlement is invalid",
      );
    }
    return this.transaction(async (tx) => {
      await this.lockAdmission(tx);
      const reservation = await tx.aiProviderReservation.findUnique({
        where: { id: input.reservationId },
      });
      // A deleted owner becomes null; an internal receipt can still settle its billing.
      // This method is never exposed as a user-facing endpoint.
      if (
        !reservation ||
        (reservation.userId !== null && reservation.userId !== input.userId)
      ) {
        throw denied(
          "AI_PROVIDER_RESERVATION_UNAVAILABLE",
          "Hosted AI reservation is unavailable",
        );
      }
      if (reservation.status !== "reserved") {
        return {
          reservation: mapReservation(reservation),
          exceededReservation:
            (reservation.chargedCostMicros ?? 0n) >
            reservation.reservedCostMicros,
        };
      }
      const knownCost =
        input.outcome === "completed" &&
        typeof input.actualCostMicros === "number" &&
        Number.isSafeInteger(input.actualCostMicros) &&
        input.actualCostMicros >= 0;
      const chargedCost = knownCost
        ? BigInt(input.actualCostMicros!)
        : reservation.reservedCostMicros;
      const changed = await tx.aiProviderReservation.updateMany({
        where: { id: reservation.id, status: "reserved" },
        data: {
          status: input.outcome,
          chargedCostMicros: chargedCost,
          settledAt: new Date(),
        },
      });
      if (changed.count !== 1) {
        throw denied(
          "AI_PROVIDER_STORE_UNAVAILABLE",
          "Hosted AI settlement is unavailable",
        );
      }
      await tx.aiProviderBudgetDay.update({
        where: { dayStart: reservation.dayStart },
        data: {
          reservedCostMicros: { decrement: reservation.reservedCostMicros },
          spentCostMicros: { increment: chargedCost },
          ...(chargedCost > reservation.reservedCostMicros ||
          input.usageBoundBreached === true ||
          (input.actualCostMicros !== undefined &&
            !knownCost &&
            input.outcome === "completed")
            ? { breachedAt: new Date(), breachReconciledAt: null }
            : {}),
        },
      });
      const settled = await tx.aiProviderReservation.findUniqueOrThrow({
        where: { id: reservation.id },
      });
      return {
        reservation: mapReservation(settled),
        exceededReservation: chargedCost > reservation.reservedCostMicros,
      };
    });
  }

  /** Internal operator recovery only; never refunds cost or daily request usage. */
  async reconcileUncertain(input: {
    reservationId: string;
    providerRequestEnded: true;
  }): Promise<AiProviderReservation> {
    if (input.providerRequestEnded !== true) {
      throw denied(
        "AI_PROVIDER_RECONCILIATION_UNCONFIRMED",
        "Provider termination must be confirmed before recovery",
      );
    }
    return this.transaction(async (tx) => {
      await this.lockAdmission(tx);
      const reservation = await tx.aiProviderReservation.findUnique({
        where: { id: input.reservationId },
      });
      if (
        !reservation ||
        !["uncertain", "reconciled"].includes(reservation.status)
      ) {
        throw denied(
          "AI_PROVIDER_RESERVATION_UNAVAILABLE",
          "Uncertain hosted AI reservation is unavailable",
        );
      }
      if (reservation.status === "reconciled")
        return mapReservation(reservation);
      const updated = await tx.aiProviderReservation.update({
        where: { id: reservation.id },
        data: { status: "reconciled", reconciledAt: new Date() },
      });
      return mapReservation(updated);
    });
  }

  /** Internal recovery after pricing/token bounds have been reviewed; no spending refund. */
  async reconcileBudgetBreach(input: {
    dayStart: Date;
    pricingCorrected: true;
    providerUsageReviewed: true;
  }): Promise<void> {
    if (
      input.pricingCorrected !== true ||
      input.providerUsageReviewed !== true
    ) {
      throw denied(
        "AI_PROVIDER_RECONCILIATION_UNCONFIRMED",
        "Spending bounds must be reviewed before recovery",
      );
    }
    await this.transaction(async (tx) => {
      await this.lockAdmission(tx);
      const day = await tx.aiProviderBudgetDay.findUnique({
        where: { dayStart: input.dayStart },
      });
      if (!day?.breachedAt) {
        throw denied(
          "AI_PROVIDER_RESERVATION_UNAVAILABLE",
          "Hosted AI budget breach is unavailable",
        );
      }
      await tx.aiProviderBudgetDay.update({
        where: { dayStart: input.dayStart },
        data: { breachReconciledAt: new Date() },
      });
    });
  }
}
