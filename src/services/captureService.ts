import { Prisma, PrismaClient } from "@prisma/client";
import { CaptureItemDto, Project, TaskSource, Todo } from "../types";
import { HttpError } from "../errorHandling";
import { PrismaTodoService } from "./prismaTodoService";
import { PrismaProjectService } from "./projectService";
import { AgentIdempotencyService } from "./agentIdempotencyService";

type CapturePromotion =
  | { type: "task"; task: Todo; created: boolean }
  | { type: "project"; project: Project; created: boolean };

function promotionMetadata(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function hasPromotion(value: unknown): boolean {
  const result = promotionMetadata(value);
  return typeof result.promotedId === "string" && result.promotedId.length > 0;
}

export class CaptureService {
  constructor(private prisma: PrismaClient) {}

  async create(
    userId: string,
    text: string,
    source?: string,
    capturedAt?: Date,
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<CaptureItemDto> {
    const item = await client.captureItem.create({
      data: {
        userId,
        text,
        source: source ?? null,
        capturedAt: capturedAt ?? new Date(),
      },
    });
    return this.toDto(item);
  }

  /** Save a capture and its original success receipt in the same transaction. */
  async createWithReceipt<T>(
    userId: string,
    input: { text: string; source?: string },
    idempotencyKey: string,
    receipts: AgentIdempotencyService,
    buildReceipt: (item: CaptureItemDto) => { status: number; body: T },
  ): Promise<
    | { kind: "conflict" }
    | { kind: "success"; replayed: boolean; status: number; body: T }
  > {
    return this.prisma.$transaction(async (tx) => {
      // Captures have no row before insertion. Serialize this user's retry
      // receipt check, capture creation and receipt write on their existing row.
      await tx.$queryRaw`
        SELECT "id" FROM "users" WHERE "id" = ${userId} FOR UPDATE
      `;
      const lookup = await receipts.lookup(
        "capture_inbox_item",
        userId,
        idempotencyKey,
        input,
        tx,
      );
      if (lookup.kind === "conflict") return { kind: "conflict" };
      if (lookup.kind === "replay") {
        return {
          kind: "success",
          replayed: true,
          status: lookup.status,
          body: lookup.body as T,
        };
      }
      const item = await this.create(
        userId,
        input.text,
        input.source,
        undefined,
        tx,
      );
      const receipt = buildReceipt(item);
      await receipts.store(
        "capture_inbox_item",
        userId,
        idempotencyKey,
        input,
        receipt.status,
        receipt.body,
        tx,
      );
      return { kind: "success", replayed: false, ...receipt };
    });
  }

  async findAll(
    userId: string,
    lifecycle?: "new" | "triaged" | "discarded",
  ): Promise<CaptureItemDto[]> {
    const items = await this.prisma.captureItem.findMany({
      where: { userId, ...(lifecycle ? { lifecycle } : {}) },
      orderBy: { capturedAt: "desc" },
    });
    return items.map((item) => this.toDto(item));
  }

  async findById(userId: string, id: string): Promise<CaptureItemDto | null> {
    const item = await this.prisma.captureItem.findFirst({
      where: { id, userId },
    });
    return item ? this.toDto(item) : null;
  }

  async findPendingReview(userId: string): Promise<CaptureItemDto[]> {
    const items = await this.prisma.captureItem.findMany({
      where: { userId, lifecycle: { in: ["new", "triaged"] } },
      orderBy: [{ capturedAt: "desc" }, { id: "asc" }],
    });
    return items
      .filter((item) => !hasPromotion(item.triageResult))
      .map((item) => this.toDto(item));
  }

  async acceptAsTask(
    userId: string,
    id: string,
    title?: string,
  ): Promise<{ task: Todo; created: boolean }> {
    const result = await this.promote(userId, id, { type: "task", title });
    if (result.type !== "task") throw new Error("Unexpected capture promotion");
    return { task: result.task, created: result.created };
  }

  /** The capture row is the durable retry guard for both web and agent review. */
  async promote(
    userId: string,
    id: string,
    input: {
      type: "task" | "project";
      title?: string;
      projectId?: string;
      status?: "next" | "inbox";
    },
  ): Promise<CapturePromotion> {
    const todoService = new PrismaTodoService(this.prisma);
    const projectService = new PrismaProjectService(this.prisma);
    return this.prisma.$transaction(async (tx) => {
      const item = await this.lockOwnedCapture(tx, userId, id);
      const metadata = promotionMetadata(item.triageResult);
      if (hasPromotion(metadata)) {
        if (metadata.promotedAs !== input.type) {
          throw new HttpError(
            409,
            "Capture has already been accepted as another type",
          );
        }
        const promotedId = String(metadata.promotedId);
        if (input.type === "task") {
          const task = await todoService.findById(userId, promotedId, tx);
          if (!task)
            throw new HttpError(
              409,
              "The accepted task is no longer available",
            );
          return { type: "task", task, created: false };
        }
        const project = await projectService.findById(userId, promotedId, tx);
        if (!project)
          throw new HttpError(
            409,
            "The accepted project is no longer available",
          );
        return { type: "project", project, created: false };
      }
      if (item.lifecycle === "discarded") {
        throw new HttpError(409, "Capture has already been discarded");
      }
      const title = input.title?.trim() ?? item.text.trim().slice(0, 200);
      const maxTitleLength = input.type === "project" ? 50 : 200;
      if (!title || title.length > maxTitleLength) {
        throw new HttpError(
          400,
          `title must contain 1 to ${maxTitleLength} characters`,
        );
      }
      let result: CapturePromotion;
      if (input.type === "task") {
        const sources: TaskSource[] = [
          "manual",
          "system_seed",
          "chat",
          "email",
          "import",
          "automation",
          "api",
        ];
        const source = sources.includes(item.source as TaskSource)
          ? (item.source as TaskSource)
          : undefined;
        let task: Todo;
        try {
          task = await todoService.createInTransaction(tx, userId, {
            title,
            status: input.status ?? "next",
            projectId: input.projectId,
            source,
            sourceText: item.text,
            notes: `Captured from ${item.source ?? "unspecified source"} at ${item.capturedAt.toISOString()}\n\n${item.text}`,
          });
        } catch (error) {
          if (
            error instanceof Error &&
            error.message === PrismaTodoService.INVALID_PROJECT_ERROR
          ) {
            throw new HttpError(404, "Project not found");
          }
          throw error;
        }
        result = { type: "task", task, created: true };
      } else {
        const project = await projectService.createInTransaction(tx, userId, {
          name: title,
        });
        result = { type: "project", project, created: true };
      }
      await tx.captureItem.update({
        where: { id },
        data: {
          lifecycle: "triaged",
          triageResult: {
            ...metadata,
            promotedAs: result.type,
            promotedId:
              result.type === "task" ? result.task.id : result.project.id,
          } as Prisma.InputJsonObject,
        },
      });
      return result;
    });
  }

  async discard(userId: string, id: string): Promise<CaptureItemDto> {
    return this.prisma.$transaction(async (tx) => {
      const item = await this.lockOwnedCapture(tx, userId, id);
      if (hasPromotion(item.triageResult)) {
        throw new HttpError(409, "Capture has already been accepted");
      }
      if (item.lifecycle === "discarded") return this.toDto(item);
      return this.toDto(
        await tx.captureItem.update({
          where: { id },
          data: { lifecycle: "discarded" },
        }),
      );
    });
  }

  private async lockOwnedCapture(
    tx: Prisma.TransactionClient,
    userId: string,
    id: string,
  ) {
    await tx.$queryRaw`
      SELECT "id" FROM "capture_items"
      WHERE "id" = ${id}::uuid AND "user_id" = ${userId} FOR UPDATE
    `;
    const item = await tx.captureItem.findFirst({ where: { id, userId } });
    if (!item) throw new HttpError(404, "Capture item not found");
    return item;
  }

  async updateLifecycle(
    userId: string,
    id: string,
    lifecycle: "new" | "triaged" | "discarded",
    triageResult?: unknown,
    options: { allowRestore?: boolean } = {},
  ): Promise<CaptureItemDto | null> {
    return this.prisma.$transaction(async (tx) => {
      let item;
      try {
        item = await this.lockOwnedCapture(tx, userId, id);
      } catch (error) {
        if (error instanceof HttpError && error.status === 404) return null;
        throw error;
      }
      // Only explicit legacy PATCH restoration may reopen an unpromoted discard.
      if (
        hasPromotion(item.triageResult) ||
        (item.lifecycle === "discarded" &&
          !(options.allowRestore && lifecycle !== "discarded"))
      ) {
        return this.toDto(item);
      }
      return this.toDto(
        await tx.captureItem.update({
          where: { id },
          data: {
            lifecycle,
            ...(triageResult !== undefined
              ? { triageResult: triageResult as Prisma.InputJsonValue }
              : {}),
          },
        }),
      );
    });
  }

  private toDto(item: {
    id: string;
    text: string;
    source: string | null;
    capturedAt: Date;
    lifecycle: string;
    triageResult: unknown;
    createdAt: Date;
    updatedAt: Date;
  }): CaptureItemDto {
    return {
      id: item.id,
      text: item.text,
      source: item.source,
      capturedAt: item.capturedAt.toISOString(),
      lifecycle: item.lifecycle as "new" | "triaged" | "discarded",
      triageResult: item.triageResult,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    };
  }
}
