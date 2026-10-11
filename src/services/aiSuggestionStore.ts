import { Prisma, PrismaClient } from "@prisma/client";
import { randomUUID } from "crypto";
import { HttpError } from "../errorHandling";
import type { UserPlan } from "./aiQuotaService";
import {
  databaseUtcDayStart,
  databaseUtcNow,
  utcDayStart,
} from "./aiDailyWindow";

export type AiSuggestionType =
  | "task_critic"
  | "plan_from_goal"
  | "morning_brief";
export type AiSuggestionStatus = "pending" | "accepted" | "rejected";

export interface AiSuggestionRecord {
  id: string;
  userId: string;
  type: AiSuggestionType;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  feedback?: Record<string, unknown>;
  appliedAt?: Date;
  appliedTodoIds?: string[];
  status: AiSuggestionStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface AiFeedbackSummary {
  acceptedCount: number;
  rejectedCount: number;
  acceptedReasons: Array<{ reason: string; count: number }>;
  rejectedReasons: Array<{ reason: string; count: number }>;
}

export interface AiSuggestionSlot {
  id: string;
  userId: string;
  dayStart: Date;
  dailyLimit: number;
}

export interface AiSuggestionSlotResult {
  slot: AiSuggestionSlot | null;
  plan: UserPlan;
  used: number;
  pending: number;
  limit: number;
  dayStart: Date;
}

export interface AiSuggestionSlotSettlement {
  id: string;
  limitsByPlan: Record<UserPlan, number>;
  fallbackPlan: UserPlan;
}

export interface AiSuggestionCreateInput {
  userId: string;
  type: AiSuggestionType;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
}

export interface IAiSuggestionStore {
  create(
    record: AiSuggestionCreateInput,
    reservation?: AiSuggestionSlotSettlement,
  ): Promise<AiSuggestionRecord>;
  reserveSlot(params: {
    userId: string;
    limitsByPlan: Record<UserPlan, number>;
    fallbackPlan: UserPlan;
  }): Promise<AiSuggestionSlotResult>;
  releaseSlot(userId: string, reservationId: string): Promise<void>;
  listByUser(userId: string, limit: number): Promise<AiSuggestionRecord[]>;
  getById(userId: string, id: string): Promise<AiSuggestionRecord | null>;
  countByUserSince(userId: string, since: Date): Promise<number>;
  summarizeFeedbackByUserSince(
    userId: string,
    since: Date,
    reasonLimit: number,
  ): Promise<AiFeedbackSummary>;
  markApplied(
    userId: string,
    id: string,
    appliedTodoIds: string[],
    feedback?: Record<string, unknown>,
  ): Promise<AiSuggestionRecord | null>;
  updateStatus(
    userId: string,
    id: string,
    status: AiSuggestionStatus,
    feedback?: Record<string, unknown>,
  ): Promise<AiSuggestionRecord | null>;
}

export class InMemoryAiSuggestionStore implements IAiSuggestionStore {
  private records: AiSuggestionRecord[] = [];
  private slots = new Map<string, AiSuggestionSlot>();

  async create(
    record: AiSuggestionCreateInput,
    reservation?: AiSuggestionSlotSettlement,
  ): Promise<AiSuggestionRecord> {
    const now = new Date();
    if (reservation) {
      const slot = this.slots.get(reservation.id);
      if (!slot || slot.userId !== record.userId)
        throw new HttpError(503, "AI suggestion reservation is unavailable");
      const used = this.records.filter(
        (item) =>
          item.userId === record.userId && item.createdAt >= utcDayStart(now),
      ).length;
      if (used >= reservation.limitsByPlan[reservation.fallbackPlan]) {
        throw new HttpError(429, "Daily AI suggestion limit reached");
      }
    }
    const created: AiSuggestionRecord = {
      id: randomUUID(),
      userId: record.userId,
      type: record.type,
      input: record.input,
      output: record.output,
      feedback: undefined,
      appliedAt: undefined,
      appliedTodoIds: undefined,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    };
    this.records.unshift(created);
    if (reservation) this.slots.delete(reservation.id);
    return created;
  }

  async reserveSlot(params: {
    userId: string;
    limitsByPlan: Record<UserPlan, number>;
    fallbackPlan: UserPlan;
  }): Promise<AiSuggestionSlotResult> {
    // No await separates this check from its mutation, so concurrent callers cannot overbook.
    const dayStart = utcDayStart();
    const limit = params.limitsByPlan[params.fallbackPlan];
    const used = this.records.filter(
      (item) => item.userId === params.userId && item.createdAt >= dayStart,
    ).length;
    const pending = [...this.slots.values()].filter(
      (slot) =>
        slot.userId === params.userId &&
        slot.dayStart.getTime() === dayStart.getTime(),
    ).length;
    const slot =
      used + pending >= limit
        ? null
        : {
            id: randomUUID(),
            userId: params.userId,
            dayStart,
            dailyLimit: limit,
          };
    if (slot) this.slots.set(slot.id, slot);
    return { slot, plan: params.fallbackPlan, used, pending, limit, dayStart };
  }

  async releaseSlot(userId: string, reservationId: string): Promise<void> {
    if (this.slots.get(reservationId)?.userId === userId)
      this.slots.delete(reservationId);
  }

  async listByUser(
    userId: string,
    limit: number,
  ): Promise<AiSuggestionRecord[]> {
    return this.records
      .filter((record) => record.userId === userId)
      .slice(0, limit);
  }

  async getById(
    userId: string,
    id: string,
  ): Promise<AiSuggestionRecord | null> {
    const record = this.records.find(
      (item) => item.id === id && item.userId === userId,
    );
    return record || null;
  }

  async countByUserSince(userId: string, since: Date): Promise<number> {
    return this.records.filter(
      (record) => record.userId === userId && record.createdAt >= since,
    ).length;
  }

  async summarizeFeedbackByUserSince(
    userId: string,
    since: Date,
    reasonLimit: number,
  ): Promise<AiFeedbackSummary> {
    const acceptedReasons = new Map<string, number>();
    const rejectedReasons = new Map<string, number>();
    let acceptedCount = 0;
    let rejectedCount = 0;

    for (const record of this.records) {
      if (record.userId !== userId || record.updatedAt < since) {
        continue;
      }
      if (record.status !== "accepted" && record.status !== "rejected") {
        continue;
      }

      const reasonRaw = record.feedback?.reason;
      const reason =
        typeof reasonRaw === "string" && reasonRaw.trim().length > 0
          ? reasonRaw.trim()
          : "unspecified";

      if (record.status === "accepted") {
        acceptedCount += 1;
        acceptedReasons.set(reason, (acceptedReasons.get(reason) || 0) + 1);
      } else {
        rejectedCount += 1;
        rejectedReasons.set(reason, (rejectedReasons.get(reason) || 0) + 1);
      }
    }

    const toRanked = (counts: Map<string, number>) =>
      [...counts.entries()]
        .sort((a, b) => {
          if (b[1] !== a[1]) {
            return b[1] - a[1];
          }
          return a[0].localeCompare(b[0]);
        })
        .slice(0, reasonLimit)
        .map(([reason, count]) => ({ reason, count }));

    return {
      acceptedCount,
      rejectedCount,
      acceptedReasons: toRanked(acceptedReasons),
      rejectedReasons: toRanked(rejectedReasons),
    };
  }

  async markApplied(
    userId: string,
    id: string,
    appliedTodoIds: string[],
    feedback?: Record<string, unknown>,
  ): Promise<AiSuggestionRecord | null> {
    const index = this.records.findIndex(
      (record) => record.id === id && record.userId === userId,
    );
    if (index === -1) {
      return null;
    }

    const existing = this.records[index];
    if (existing.status === "rejected") {
      return existing;
    }
    if (existing.status === "accepted" && existing.appliedTodoIds?.length) {
      return existing;
    }

    const updated = {
      ...existing,
      status: "accepted" as const,
      feedback,
      appliedAt: new Date(),
      appliedTodoIds,
      updatedAt: new Date(),
    };
    this.records[index] = updated;
    return updated;
  }

  async updateStatus(
    userId: string,
    id: string,
    status: AiSuggestionStatus,
    feedback?: Record<string, unknown>,
  ): Promise<AiSuggestionRecord | null> {
    const index = this.records.findIndex(
      (record) => record.id === id && record.userId === userId,
    );
    if (index === -1) {
      return null;
    }
    const updated = {
      ...this.records[index],
      status,
      feedback,
      updatedAt: new Date(),
    };
    this.records[index] = updated;
    return updated;
  }
}

type PrismaAiSuggestionRecord = Prisma.AiSuggestionGetPayload<{}> & {
  appliedTodos?: Array<{ todoId: string }>;
};

export class PrismaAiSuggestionStore implements IAiSuggestionStore {
  constructor(private prisma: PrismaClient) {}

  private normalizeAppliedTodoIds(ids: string[]): string[] {
    const unique = new Set<string>();
    for (const id of ids) {
      if (typeof id === "string" && id.length > 0) {
        unique.add(id);
      }
    }
    return [...unique];
  }

  private mapPrismaRecord(
    record: PrismaAiSuggestionRecord,
  ): AiSuggestionRecord {
    const fromRelation = Array.isArray(record.appliedTodos)
      ? record.appliedTodos
          .map((item: { todoId?: unknown }) =>
            typeof item.todoId === "string" ? item.todoId : null,
          )
          .filter((todoId: string | null): todoId is string => !!todoId)
      : [];
    const fromJson =
      (record.appliedTodoIds as string[] | null | undefined) || undefined;
    const appliedTodoIds =
      fromRelation.length > 0 ? fromRelation : (fromJson ?? undefined);

    return {
      id: record.id,
      userId: record.userId,
      type: record.type as AiSuggestionType,
      input: record.input as Record<string, unknown>,
      output: record.output as Record<string, unknown>,
      feedback: (record.feedback as Record<string, unknown>) || undefined,
      appliedAt: record.appliedAt || undefined,
      appliedTodoIds:
        Array.isArray(appliedTodoIds) && appliedTodoIds.length > 0
          ? appliedTodoIds
          : undefined,
      status: record.status as AiSuggestionStatus,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  async create(
    record: AiSuggestionCreateInput,
    reservation?: AiSuggestionSlotSettlement,
  ): Promise<AiSuggestionRecord> {
    const createData = {
      userId: record.userId,
      type: record.type,
      input: record.input as Prisma.InputJsonValue,
      output: record.output as Prisma.InputJsonValue,
      status: "pending" as const,
    };
    if (reservation) {
      return this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${record.userId} FOR UPDATE`;
        const slot = await tx.aiSuggestionReservation.findUnique({
          where: { id: reservation.id },
        });
        if (!slot || slot.userId !== record.userId)
          throw new HttpError(503, "AI suggestion reservation is unavailable");
        const user = await tx.user.findUnique({
          where: { id: record.userId },
          select: { plan: true },
        });
        if (!user)
          throw new HttpError(401, "AI suggestion account is unavailable");
        const createdAt = await databaseUtcNow(tx);
        const dayStart = utcDayStart(createdAt);
        const used = await tx.aiSuggestion.count({
          where: { userId: record.userId, createdAt: { gte: dayStart } },
        });
        // Recheck on save for midnight rollover, a plan downgrade, or an unreserved background write.
        if (used >= reservation.limitsByPlan[user.plan])
          throw new HttpError(429, "Daily AI suggestion limit reached");
        const created = await tx.aiSuggestion.create({
          data: { ...createData, createdAt },
        });
        await tx.aiSuggestionReservation.delete({
          where: { id: reservation.id },
        });
        return this.mapPrismaRecord(created);
      });
    }
    const created = await this.prisma.aiSuggestion.create({
      data: {
        ...createData,
      },
    });

    return this.mapPrismaRecord(created);
  }

  async reserveSlot(params: {
    userId: string;
    limitsByPlan: Record<UserPlan, number>;
    fallbackPlan: UserPlan;
  }): Promise<AiSuggestionSlotResult> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${params.userId} FOR UPDATE`;
      const user = await tx.user.findUnique({
        where: { id: params.userId },
        select: { plan: true },
      });
      if (!user)
        throw new HttpError(401, "AI suggestion account is unavailable");
      const dayStart = await databaseUtcDayStart(tx);
      const limit = params.limitsByPlan[user.plan];
      const used = await tx.aiSuggestion.count({
        where: { userId: params.userId, createdAt: { gte: dayStart } },
      });
      const pending = await tx.aiSuggestionReservation.count({
        where: { userId: params.userId, dayStart },
      });
      const slot =
        used + pending >= limit
          ? null
          : await tx.aiSuggestionReservation.create({
              data: { userId: params.userId, dayStart, dailyLimit: limit },
            });
      return { slot, plan: user.plan, used, pending, limit, dayStart };
    });
  }

  async releaseSlot(userId: string, reservationId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${userId} FOR UPDATE`;
      await tx.aiSuggestionReservation.deleteMany({
        where: { id: reservationId, userId },
      });
    });
  }

  async listByUser(
    userId: string,
    limit: number,
  ): Promise<AiSuggestionRecord[]> {
    const records = await this.prisma.aiSuggestion.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        appliedTodos: {
          select: { todoId: true },
        },
      },
    });

    return records.map((record) => this.mapPrismaRecord(record));
  }

  async getById(
    userId: string,
    id: string,
  ): Promise<AiSuggestionRecord | null> {
    const record = await this.prisma.aiSuggestion.findUnique({
      where: { id },
      include: {
        appliedTodos: {
          select: { todoId: true },
        },
      },
    });

    if (!record || record.userId !== userId) {
      return null;
    }

    return this.mapPrismaRecord(record);
  }

  async countByUserSince(userId: string, since: Date): Promise<number> {
    return this.prisma.aiSuggestion.count({
      where: {
        userId,
        createdAt: {
          gte: since,
        },
      },
    });
  }

  async summarizeFeedbackByUserSince(
    userId: string,
    since: Date,
    reasonLimit: number,
  ): Promise<AiFeedbackSummary> {
    const records = await this.prisma.aiSuggestion.findMany({
      where: {
        userId,
        updatedAt: {
          gte: since,
        },
        status: {
          in: ["accepted", "rejected"],
        },
      },
      select: {
        status: true,
        feedback: true,
      },
    });

    const acceptedReasons = new Map<string, number>();
    const rejectedReasons = new Map<string, number>();
    let acceptedCount = 0;
    let rejectedCount = 0;

    for (const record of records) {
      const feedback =
        record.feedback && typeof record.feedback === "object"
          ? (record.feedback as Record<string, unknown>)
          : undefined;
      const reasonRaw = feedback?.reason;
      const reason =
        typeof reasonRaw === "string" && reasonRaw.trim().length > 0
          ? reasonRaw.trim()
          : "unspecified";

      if (record.status === "accepted") {
        acceptedCount += 1;
        acceptedReasons.set(reason, (acceptedReasons.get(reason) || 0) + 1);
      } else {
        rejectedCount += 1;
        rejectedReasons.set(reason, (rejectedReasons.get(reason) || 0) + 1);
      }
    }

    const toRanked = (counts: Map<string, number>) =>
      [...counts.entries()]
        .sort((a, b) => {
          if (b[1] !== a[1]) {
            return b[1] - a[1];
          }
          return a[0].localeCompare(b[0]);
        })
        .slice(0, reasonLimit)
        .map(([reason, count]) => ({ reason, count }));

    return {
      acceptedCount,
      rejectedCount,
      acceptedReasons: toRanked(acceptedReasons),
      rejectedReasons: toRanked(rejectedReasons),
    };
  }

  async markApplied(
    userId: string,
    id: string,
    appliedTodoIds: string[],
    feedback?: Record<string, unknown>,
  ): Promise<AiSuggestionRecord | null> {
    const normalizedAppliedTodoIds =
      this.normalizeAppliedTodoIds(appliedTodoIds);
    const existing = await this.prisma.aiSuggestion.findUnique({
      where: { id },
      include: {
        appliedTodos: {
          select: { todoId: true },
        },
      },
    });
    if (!existing || existing.userId !== userId) {
      return null;
    }
    if (existing.status === "rejected") {
      return this.mapPrismaRecord(existing);
    }
    if (
      existing.status === "accepted" &&
      this.mapPrismaRecord(existing).appliedTodoIds
    ) {
      return this.mapPrismaRecord(existing);
    }

    const now = new Date();
    const record = await this.prisma.$transaction(async (tx) => {
      const updateResult = await tx.aiSuggestion.updateMany({
        where: { id, userId, status: "pending" },
        data: {
          status: "accepted",
          feedback: feedback as Prisma.InputJsonValue | undefined,
          appliedAt: now,
          appliedTodoIds:
            normalizedAppliedTodoIds as unknown as Prisma.InputJsonValue,
        },
      });

      if (updateResult.count !== 1) {
        return null;
      }

      if (normalizedAppliedTodoIds.length > 0) {
        await tx.aiSuggestionAppliedTodo.createMany({
          data: normalizedAppliedTodoIds.map((todoId) => ({
            id: randomUUID(),
            suggestionId: id,
            todoId,
          })),
          skipDuplicates: true,
        });
      }

      return tx.aiSuggestion.findUnique({
        where: { id },
        include: {
          appliedTodos: {
            select: { todoId: true },
          },
        },
      });
    });

    if (!record) {
      const latest = await this.prisma.aiSuggestion.findUnique({
        where: { id },
        include: {
          appliedTodos: {
            select: { todoId: true },
          },
        },
      });
      if (!latest || latest.userId !== userId) {
        return null;
      }
      return this.mapPrismaRecord(latest);
    }
    if (record.userId !== userId) {
      return null;
    }
    return this.mapPrismaRecord(record);
  }

  async updateStatus(
    userId: string,
    id: string,
    status: AiSuggestionStatus,
    feedback?: Record<string, unknown>,
  ): Promise<AiSuggestionRecord | null> {
    const result = await this.prisma.aiSuggestion.updateMany({
      where: { id, userId },
      data: {
        status,
        feedback: feedback as Prisma.InputJsonValue | undefined,
      },
    });

    if (result.count !== 1) {
      return null;
    }

    const record = await this.prisma.aiSuggestion.findUnique({
      where: { id },
      include: {
        appliedTodos: {
          select: { todoId: true },
        },
      },
    });
    if (!record || record.userId !== userId) {
      return null;
    }
    return this.mapPrismaRecord(record);
  }
}
