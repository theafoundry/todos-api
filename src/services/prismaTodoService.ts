import {
  PrismaClient,
  Prisma,
  TodoRecurrenceType as PrismaTodoRecurrenceType,
  TodoStatus as PrismaTodoStatus,
} from "@prisma/client";
import { ITodoService } from "../interfaces/ITodoService";
import {
  Todo,
  Subtask,
  CreateTodoDto,
  UpdateTodoDto,
  CreateSubtaskDto,
  UpdateSubtaskDto,
  ReorderTodoItemDto,
  FindTodosQuery,
  TodoSortBy,
  SortOrder,
} from "../types";
import { hasPrismaCode, isPrismaInvalidUuidError } from "../errorHandling";
import {
  reconcileStatusAndCompletion,
  isValidTransition,
  classifyStatus,
} from "../domains/tasks/taskLifecycle";

type PrismaTodoWithRelations = Prisma.TodoGetPayload<{
  include: { project: true; subtasks: true };
}>;

type PrismaSubtaskRecord = Prisma.SubtaskGetPayload<{}>;
const PROJECT_PATH_SEPARATOR = " / ";

/**
 * Prisma-based implementation of ITodoService using PostgreSQL database.
 * Provides persistent storage for todos with full CRUD operations.
 */
export class PrismaTodoService implements ITodoService {
  constructor(private prisma: PrismaClient) {}
  private static readonly NOT_FOUND_ERROR = "TODO_NOT_FOUND";
  static readonly INVALID_HEADING_ERROR = "INVALID_HEADING";
  static readonly INVALID_PROJECT_ERROR = "INVALID_PROJECT";
  static readonly INVALID_DEPENDENCY_ERROR = "INVALID_DEPENDENCY";

  private normalizeCategory(category?: string | null): string | null {
    if (category === null || category === undefined) {
      return null;
    }
    const trimmed = category.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private async findOwnedProject(
    tx: Prisma.TransactionClient,
    userId: string,
    projectId: string,
  ) {
    return tx.project.findFirst({
      where: { id: projectId, userId },
      select: { id: true, name: true },
    });
  }

  private async ensureHeadingId(
    tx: Prisma.TransactionClient,
    userId: string,
    projectId: string | null,
    headingId: string | null,
  ): Promise<string | null> {
    if (!headingId) return null;
    if (!projectId) {
      throw new Error(PrismaTodoService.INVALID_HEADING_ERROR);
    }
    const heading = await tx.heading.findFirst({
      where: {
        id: headingId,
        projectId,
        project: {
          userId,
        },
      },
      select: { id: true },
    });
    if (!heading) {
      throw new Error(PrismaTodoService.INVALID_HEADING_ERROR);
    }
    return heading.id;
  }

  /**
   * Delegates to the pure domain function for status/completed reconciliation.
   * Kept as a thin wrapper for backward compatibility with internal callers.
   */
  private buildTodoState(input: {
    currentStatus?: Todo["status"];
    currentCompleted?: boolean;
    currentCompletedAt?: Date | null;
    nextStatus?: Todo["status"];
    nextCompleted?: boolean;
  }): {
    status: Todo["status"];
    completed: boolean;
    completedAt: Date | null;
  } {
    return reconcileStatusAndCompletion(input);
  }

  private buildRecurrenceFields(
    recurrence:
      | CreateTodoDto["recurrence"]
      | UpdateTodoDto["recurrence"]
      | null
      | undefined,
    current?: {
      type: PrismaTodoRecurrenceType;
      interval: number | null;
      rrule: string | null;
      nextOccurrence: Date | null;
    },
  ):
    | {
        recurrenceType: PrismaTodoRecurrenceType;
        recurrenceInterval: number | null;
        recurrenceRrule: string | null;
        recurrenceNextOccurrence: Date | null;
      }
    | undefined {
    if (recurrence === undefined) {
      return undefined;
    }
    if (recurrence === null) {
      return {
        recurrenceType: "none",
        recurrenceInterval: null,
        recurrenceRrule: null,
        recurrenceNextOccurrence: null,
      };
    }

    const nextType = (recurrence?.type ??
      current?.type ??
      "none") as PrismaTodoRecurrenceType;
    return {
      recurrenceType: nextType,
      recurrenceInterval:
        recurrence?.interval !== undefined
          ? recurrence.interval
          : (current?.interval ?? null),
      recurrenceRrule:
        recurrence?.rrule !== undefined
          ? recurrence.rrule
          : (current?.rrule ?? null),
      recurrenceNextOccurrence:
        recurrence?.nextOccurrence !== undefined
          ? recurrence.nextOccurrence
          : (current?.nextOccurrence ?? null),
    };
  }

  private async validateDependencyIds(
    tx: Prisma.TransactionClient,
    userId: string,
    dependsOnTaskIds: string[] | undefined,
    currentTodoId?: string,
  ) {
    if (dependsOnTaskIds === undefined) {
      return undefined;
    }
    if (currentTodoId && dependsOnTaskIds.includes(currentTodoId)) {
      throw new Error(PrismaTodoService.INVALID_DEPENDENCY_ERROR);
    }
    if (dependsOnTaskIds.length === 0) {
      return [];
    }
    const count = await tx.todo.count({
      where: {
        userId,
        id: { in: dependsOnTaskIds },
      },
    });
    if (count !== dependsOnTaskIds.length) {
      throw new Error(PrismaTodoService.INVALID_DEPENDENCY_ERROR);
    }
    return dependsOnTaskIds;
  }

  /**
   * Build a nullable date range filter for a single field.
   * Returns undefined when neither bound is set.
   */
  private static buildDateRangeFilter(bounds: {
    gte?: Date;
    lte?: Date;
    gt?: Date;
    lt?: Date;
  }): Prisma.DateTimeNullableFilter | undefined {
    const { gte, lte, gt, lt } = bounds;
    if (!gte && !lte && !gt && !lt) return undefined;
    const filter: Prisma.DateTimeNullableFilter = { not: null };
    if (gte) filter.gte = gte;
    if (lte) filter.lte = lte;
    if (gt) filter.gt = gt;
    if (lt) filter.lt = lt;
    return filter;
  }

  /**
   * Build a non-nullable date range filter (e.g. for updatedAt).
   */
  private static buildDateFilter(bounds: {
    gte?: Date;
    lte?: Date;
  }): Prisma.DateTimeFilter | undefined {
    const { gte, lte } = bounds;
    if (!gte && !lte) return undefined;
    const filter: Prisma.DateTimeFilter = {};
    if (gte) filter.gte = gte;
    if (lte) filter.lte = lte;
    return filter;
  }

  private buildFindAllWhere(
    userId: string,
    query?: FindTodosQuery,
  ): Prisma.TodoWhereInput {
    const where: Prisma.TodoWhereInput = {
      userId,
      archived: query?.archived ?? false,
    };
    const and: Prisma.TodoWhereInput[] = [];

    if (query?.completed !== undefined) {
      where.completed = query.completed;
    }
    if (query?.priority) {
      where.priority = query.priority;
    }
    if (query?.statuses?.length) {
      where.status = { in: query.statuses };
    }
    if (query?.category !== undefined) {
      and.push({
        OR: [
          { project: { is: { name: query.category } } },
          {
            AND: [{ projectId: null }, { category: query.category }],
          },
        ],
      });
    }
    if (query?.projectId) {
      where.projectId = query.projectId;
    }
    if (query?.unsorted) {
      and.push({
        projectId: null,
      });
    }
    if (query?.needsOrganizing) {
      and.push({
        completed: false,
        OR: [
          { status: "inbox" },
          {
            AND: [
              { projectId: null },
              { OR: [{ category: null }, { category: "" }] },
            ],
          },
        ],
      });
    }
    if (query?.project) {
      and.push({
        OR: [
          {
            project: { is: { name: query.project } },
          },
          {
            project: {
              is: {
                name: {
                  startsWith: `${query.project}${PROJECT_PATH_SEPARATOR}`,
                },
              },
            },
          },
          {
            AND: [{ projectId: null }, { category: query.project }],
          },
          {
            AND: [
              { projectId: null },
              {
                category: {
                  startsWith: `${query.project}${PROJECT_PATH_SEPARATOR}`,
                },
              },
            ],
          },
        ],
      });
    }
    if (query?.search) {
      and.push({
        OR: [
          { title: { contains: query.search, mode: "insensitive" } },
          { description: { contains: query.search, mode: "insensitive" } },
          { notes: { contains: query.search, mode: "insensitive" } },
          {
            project: {
              is: {
                name: { contains: query.search, mode: "insensitive" },
              },
            },
          },
          { category: { contains: query.search, mode: "insensitive" } },
          { waitingOn: { contains: query.search, mode: "insensitive" } },
        ],
      });
    }
    if (query?.tags?.length) {
      and.push({ tags: { hasSome: query.tags } });
    }
    if (query?.contexts?.length) {
      and.push({ context: { in: query.contexts } });
    }
    if (query?.energies?.length) {
      and.push({ energy: { in: query.energies } });
    }

    // Date range filters — shared helper eliminates repetitive pattern
    if (query?.dueDateIsNull) {
      and.push({ dueDate: null });
    } else {
      const dueDate = PrismaTodoService.buildDateRangeFilter({
        gte: query?.dueDateFrom,
        lte: query?.dueDateTo,
        gt: query?.dueDateAfter,
        lt: query?.dueDateBefore,
      });
      if (dueDate) and.push({ dueDate });
    }

    const startDate = PrismaTodoService.buildDateRangeFilter({
      gte: query?.startDateFrom,
      lte: query?.startDateTo,
    });
    if (startDate) and.push({ startDate });

    const scheduledDate = PrismaTodoService.buildDateRangeFilter({
      gte: query?.scheduledDateFrom,
      lte: query?.scheduledDateTo,
    });
    if (scheduledDate) and.push({ scheduledDate });

    const reviewDate = PrismaTodoService.buildDateRangeFilter({
      gte: query?.reviewDateFrom,
      lte: query?.reviewDateTo,
    });
    if (reviewDate) and.push({ reviewDate });

    const updatedAt = PrismaTodoService.buildDateFilter({
      gte: query?.updatedAfter,
      lte: query?.updatedBefore,
    });
    if (updatedAt) and.push({ updatedAt });

    if (and.length) {
      where.AND = and;
    }

    return where;
  }

  async create(userId: string, dto: CreateTodoDto): Promise<Todo> {
    const todo = await this.prisma.$transaction(async (tx) => {
      // Lock the user row so concurrent creates are serialized and cannot
      // compute the same next order value (same pattern as createSubtask).
      await tx.$queryRaw`
        SELECT "id" FROM "users" WHERE "id" = ${userId} FOR UPDATE
      `;

      // Calculate next order: max order + 1 for this user
      const maxOrderTodo = await tx.todo.findFirst({
        where: { userId },
        orderBy: { order: "desc" },
        select: { order: true },
      });
      const nextOrder = (maxOrderTodo?.order ?? -1) + 1;
      let projectId: string | null = null;
      let category: string | null = null;
      if (dto.projectId) {
        const project = await this.findOwnedProject(tx, userId, dto.projectId);
        if (!project) {
          throw new Error(PrismaTodoService.INVALID_PROJECT_ERROR);
        }
        projectId = project.id;
        category = project.name;
      } else {
        category = this.normalizeCategory(dto.category);
      }
      const headingId = await this.ensureHeadingId(
        tx,
        userId,
        projectId,
        dto.headingId || null,
      );
      const state = this.buildTodoState({
        nextStatus: dto.status,
        nextCompleted: dto.completed,
      });
      const dependsOnTaskIds = await this.validateDependencyIds(
        tx,
        userId,
        dto.dependsOnTaskIds,
      );
      const recurrence = this.buildRecurrenceFields(dto.recurrence);

      return tx.todo.create({
        data: {
          title: dto.title,
          description: dto.description,
          status: state.status as PrismaTodoStatus,
          completed: state.completed,
          category,
          projectId,
          headingId,
          dueDate: dto.dueDate,
          startDate: dto.startDate,
          scheduledDate: dto.scheduledDate,
          reviewDate: dto.reviewDate,
          completedAt: state.completedAt,
          context: dto.context,
          energy: dto.energy ?? null,
          estimateMinutes: dto.estimateMinutes,
          waitingOn: dto.waitingOn,
          dependsOnTaskIds: dependsOnTaskIds ?? [],
          tags: dto.tags ?? [],
          order: nextOrder,
          priority: dto.priority || "medium",
          archived: dto.archived ?? false,
          ...(recurrence || {}),
          source: dto.source ?? null,
          doDate: dto.doDate ?? null,
          blockedReason: dto.blockedReason ?? null,
          effortScore: dto.effortScore ?? null,
          confidenceScore: dto.confidenceScore ?? null,
          firstStep: dto.firstStep ?? null,
          emotionalState: dto.emotionalState ?? null,
          sourceText: dto.sourceText ?? null,
          areaId: dto.areaId ?? null,
          goalId: dto.goalId ?? null,
          createdByPrompt: dto.createdByPrompt,
          notes: dto.notes,
          userId,
        },
        include: {
          project: true,
          subtasks: {
            orderBy: { order: "asc" },
          },
        },
      });
    });

    return this.mapPrismaToTodo(todo);
  }

  async findAll(userId: string, query?: FindTodosQuery): Promise<Todo[]> {
    const where = this.buildFindAllWhere(userId, query);

    const sortBy: TodoSortBy = query?.sortBy ?? "order";
    const sortOrder: SortOrder = query?.sortOrder ?? "asc";
    const orderBy =
      sortBy === "order"
        ? [{ order: sortOrder }]
        : [{ [sortBy]: sortOrder }, { order: "asc" as const }];

    const skip =
      query?.limit !== undefined
        ? ((query.page ?? 1) - 1) * query.limit
        : undefined;

    const todos = await this.prisma.todo.findMany({
      where,
      orderBy,
      include: {
        project: true,
        subtasks: {
          orderBy: { order: "asc" },
        },
      },
      skip,
      take: query?.limit,
    });

    return todos.map(this.mapPrismaToTodo);
  }

  async findById(userId: string, id: string): Promise<Todo | null> {
    try {
      const todo = await this.prisma.todo.findFirst({
        where: { id, userId },
        include: {
          project: true,
          subtasks: {
            orderBy: { order: "asc" },
          },
        },
      });

      return todo ? this.mapPrismaToTodo(todo) : null;
    } catch (error: unknown) {
      // Invalid UUID in id filter.
      if (isPrismaInvalidUuidError(error)) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Build the scalar-field portion of the Prisma update payload from the DTO.
   * Pure data mapping — no DB calls, no side effects.
   */
  private buildScalarUpdateFields(
    dto: UpdateTodoDto,
  ): Prisma.TodoUncheckedUpdateInput {
    const data: Prisma.TodoUncheckedUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.dueDate !== undefined) data.dueDate = dto.dueDate;
    if (dto.startDate !== undefined) data.startDate = dto.startDate;
    if (dto.scheduledDate !== undefined) data.scheduledDate = dto.scheduledDate;
    if (dto.reviewDate !== undefined) data.reviewDate = dto.reviewDate;
    if (dto.order !== undefined) data.order = dto.order;
    if (dto.priority !== undefined) data.priority = dto.priority || "medium";
    if (dto.tags !== undefined) data.tags = dto.tags;
    if (dto.context !== undefined) data.context = dto.context;
    if (dto.energy !== undefined) data.energy = dto.energy;
    if (dto.estimateMinutes !== undefined)
      data.estimateMinutes = dto.estimateMinutes;
    if (dto.waitingOn !== undefined) data.waitingOn = dto.waitingOn;
    if (dto.archived !== undefined) data.archived = dto.archived;
    if (dto.source !== undefined) data.source = dto.source;
    if (dto.doDate !== undefined) data.doDate = dto.doDate;
    if (dto.blockedReason !== undefined) data.blockedReason = dto.blockedReason;
    if (dto.effortScore !== undefined) data.effortScore = dto.effortScore;
    if (dto.confidenceScore !== undefined)
      data.confidenceScore = dto.confidenceScore;
    if (dto.firstStep !== undefined) data.firstStep = dto.firstStep;
    if (dto.emotionalState !== undefined)
      data.emotionalState = dto.emotionalState;
    if (dto.sourceText !== undefined) data.sourceText = dto.sourceText;
    if (dto.areaId !== undefined) data.areaId = dto.areaId;
    if (dto.goalId !== undefined) data.goalId = dto.goalId;
    if (dto.createdByPrompt !== undefined)
      data.createdByPrompt = dto.createdByPrompt;
    if (dto.notes !== undefined) data.notes = dto.notes;
    return data;
  }

  /**
   * Resolve project/category/heading changes within a transaction.
   * Returns the next projectId and mutates updateData in place.
   */
  private async resolveProjectChanges(
    tx: Prisma.TransactionClient,
    userId: string,
    dto: UpdateTodoDto,
    currentProjectId: string | null,
    updateData: Prisma.TodoUncheckedUpdateInput,
  ): Promise<string | null> {
    let nextProjectId = currentProjectId;

    if (dto.projectId !== undefined) {
      if (dto.projectId === null) {
        nextProjectId = null;
        updateData.projectId = null;
        updateData.category = null;
        updateData.headingId = null;
      } else {
        const project = await this.findOwnedProject(tx, userId, dto.projectId);
        if (!project) return null;
        nextProjectId = project.id;
        const projectChanged = currentProjectId !== project.id;
        updateData.projectId = project.id;
        updateData.category = project.name;
        if (projectChanged && dto.headingId === undefined) {
          updateData.headingId = null;
        }
      }
    } else if (dto.category !== undefined) {
      updateData.category = this.normalizeCategory(dto.category);
    }

    if (dto.headingId !== undefined) {
      if (dto.headingId === null) {
        updateData.headingId = null;
      } else {
        updateData.headingId = await this.ensureHeadingId(
          tx,
          userId,
          nextProjectId,
          dto.headingId,
        );
      }
    }

    return nextProjectId;
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateTodoDto,
  ): Promise<Todo | null> {
    try {
      const updateData = this.buildScalarUpdateFields(dto);

      const todo = await this.prisma.$transaction(async (tx) => {
        const currentTodo = await tx.todo.findFirst({
          where: { id, userId },
          select: {
            id: true,
            projectId: true,
            status: true,
            completed: true,
            completedAt: true,
            recurrenceType: true,
            recurrenceInterval: true,
            recurrenceRrule: true,
            recurrenceNextOccurrence: true,
          },
        });
        if (!currentTodo) return null;

        // Resolve project/category/heading changes
        const resolvedProjectId = await this.resolveProjectChanges(
          tx,
          userId,
          dto,
          currentTodo.projectId,
          updateData,
        );
        // resolveProjectChanges returns null when project not found AND projectId was set
        if (
          dto.projectId &&
          dto.projectId !== null &&
          resolvedProjectId === null
        ) {
          return null;
        }

        // Reconcile status ↔ completed invariant via domain state machine
        const state = this.buildTodoState({
          currentStatus: currentTodo.status,
          currentCompleted: currentTodo.completed,
          currentCompletedAt: currentTodo.completedAt,
          nextStatus: dto.status,
          nextCompleted: dto.completed,
        });

        // Validate lifecycle transition (soft — logs but doesn't block)
        if (
          dto.status !== undefined &&
          currentTodo.status !== state.status &&
          !isValidTransition(currentTodo.status, state.status)
        ) {
          // Log invalid transition for observability but allow it through.
          // Once consumers are adapted, this becomes a hard error.
          console.warn(
            `[taskLifecycle] Invalid transition: ${currentTodo.status} → ${state.status} (todo ${id})`,
          );
        }

        updateData.status = state.status as PrismaTodoStatus;
        updateData.completed = state.completed;
        updateData.completedAt = state.completedAt;

        // Validate task dependencies
        if (dto.dependsOnTaskIds !== undefined) {
          updateData.dependsOnTaskIds = await this.validateDependencyIds(
            tx,
            userId,
            dto.dependsOnTaskIds,
            id,
          );
        }

        // Apply recurrence field changes
        const recurrence = this.buildRecurrenceFields(dto.recurrence, {
          type: currentTodo.recurrenceType,
          interval: currentTodo.recurrenceInterval,
          rrule: currentTodo.recurrenceRrule,
          nextOccurrence: currentTodo.recurrenceNextOccurrence,
        });
        if (recurrence) Object.assign(updateData, recurrence);

        // No-op shortcut: if nothing actually changed, return current state
        if (Object.keys(updateData).length === 0) {
          return tx.todo.findFirst({
            where: { id, userId },
            include: {
              project: true,
              subtasks: { orderBy: { order: "asc" } },
            },
          });
        }

        const result = await tx.todo.updateMany({
          where: { id, userId },
          data: updateData,
        });
        if (result.count !== 1) return null;

        return tx.todo.findFirst({
          where: { id, userId },
          include: {
            project: true,
            subtasks: { orderBy: { order: "asc" } },
          },
        });
      });

      return todo ? this.mapPrismaToTodo(todo) : null;
    } catch (error: unknown) {
      if (isPrismaInvalidUuidError(error)) return null;
      if (
        error instanceof Error &&
        error.message === PrismaTodoService.INVALID_HEADING_ERROR
      ) {
        throw error;
      }
      throw error;
    }
  }

  async delete(userId: string, id: string): Promise<boolean> {
    try {
      const result = await this.prisma.todo.deleteMany({
        where: { id, userId },
      });
      return result.count === 1;
    } catch (error: unknown) {
      // Invalid UUID format.
      if (isPrismaInvalidUuidError(error)) {
        return false;
      }
      throw error;
    }
  }

  async reorder(
    userId: string,
    items: ReorderTodoItemDto[],
  ): Promise<Todo[] | null> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Fetch current orders in a single query to identify which items
        // actually changed — avoids N writes when only a few moved.
        const currentTodos = await tx.todo.findMany({
          where: { userId },
          select: {
            id: true,
            order: true,
            projectId: true,
            headingId: true,
          },
        });
        const currentTodoMap = new Map(
          currentTodos.map((todo) => [todo.id, todo]),
        );

        const headingIdsToValidate = new Set<string>();
        for (const item of items) {
          if (typeof item.headingId === "string") {
            headingIdsToValidate.add(item.headingId);
          }
        }

        const headingProjectMap = new Map<string, string>();
        if (headingIdsToValidate.size > 0) {
          const headingRows = await tx.heading.findMany({
            where: {
              id: { in: Array.from(headingIdsToValidate) },
              project: { userId },
            },
            select: {
              id: true,
              projectId: true,
            },
          });
          for (const heading of headingRows) {
            headingProjectMap.set(heading.id, heading.projectId);
          }
        }

        // Validate all requested IDs exist before writing anything.
        for (const item of items) {
          const currentTodo = currentTodoMap.get(item.id);
          if (!currentTodo) {
            throw new Error(PrismaTodoService.NOT_FOUND_ERROR);
          }
          if (item.headingId === undefined) {
            continue;
          }
          if (item.headingId === null) {
            continue;
          }
          const headingProjectId = headingProjectMap.get(item.headingId);
          if (!headingProjectId || currentTodo.projectId !== headingProjectId) {
            throw new Error(PrismaTodoService.INVALID_HEADING_ERROR);
          }
        }

        // Only update items whose order actually changed (delta-only).
        for (const item of items) {
          const currentTodo = currentTodoMap.get(item.id)!;
          const orderChanged = currentTodo.order !== item.order;
          const headingChanged =
            item.headingId !== undefined &&
            currentTodo.headingId !== item.headingId;
          if (orderChanged || headingChanged) {
            const data: Prisma.TodoUpdateManyMutationInput = {
              ...(orderChanged && { order: item.order }),
              ...(item.headingId !== undefined && {
                headingId: item.headingId,
              }),
            };
            await tx.todo.updateMany({
              where: { id: item.id, userId },
              data,
            });
          }
        }

        const todos = await tx.todo.findMany({
          where: { userId },
          orderBy: { order: "asc" },
          include: {
            project: true,
            subtasks: {
              orderBy: { order: "asc" },
            },
          },
        });
        return todos.map((todo) => this.mapPrismaToTodo(todo));
      });
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        error.message === PrismaTodoService.NOT_FOUND_ERROR
      ) {
        return null;
      }
      if (isPrismaInvalidUuidError(error)) {
        return null;
      }
      throw error;
    }
  }

  async findSubtasks(
    userId: string,
    todoId: string,
  ): Promise<Subtask[] | null> {
    try {
      const todo = await this.prisma.todo.findFirst({
        where: { id: todoId, userId },
      });
      if (!todo) {
        return null;
      }

      const subtasks = await this.prisma.subtask.findMany({
        where: { todoId },
        orderBy: { order: "asc" },
      });
      return subtasks.map((subtask) => this.mapPrismaToSubtask(subtask));
    } catch (error: unknown) {
      if (isPrismaInvalidUuidError(error)) {
        return null;
      }
      throw error;
    }
  }

  async createSubtask(
    userId: string,
    todoId: string,
    dto: CreateSubtaskDto,
  ): Promise<Subtask | null> {
    try {
      const subtask = await this.prisma.$transaction(async (tx) => {
        // Lock the parent todo row so concurrent subtask inserts for the same todo
        // are serialized and cannot compute the same next order value.
        const todoRows = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id"
          FROM "todos"
          WHERE "id" = CAST(${todoId} AS UUID) AND "user_id" = ${userId}
          FOR UPDATE
        `;

        if (todoRows.length === 0) {
          return null;
        }

        const maxOrder = await tx.subtask.findFirst({
          where: { todoId },
          orderBy: { order: "desc" },
          select: { order: true },
        });

        return tx.subtask.create({
          data: {
            title: dto.title,
            completed: false,
            completedAt: null,
            order: (maxOrder?.order ?? -1) + 1,
            todoId,
          },
        });
      });

      return subtask ? this.mapPrismaToSubtask(subtask) : null;
    } catch (error: unknown) {
      if (isPrismaInvalidUuidError(error)) {
        return null;
      }
      throw error;
    }
  }

  async updateSubtask(
    userId: string,
    todoId: string,
    subtaskId: string,
    dto: UpdateSubtaskDto,
  ): Promise<Subtask | null> {
    try {
      const updatedSubtask = await this.prisma.$transaction(async (tx) => {
        const todoRows = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id"
          FROM "todos"
          WHERE "id" = CAST(${todoId} AS UUID) AND "user_id" = ${userId}
          FOR UPDATE
        `;
        if (todoRows.length === 0) {
          return null;
        }

        if (dto.order === undefined) {
          const updateData: Prisma.SubtaskUpdateManyMutationInput = {};
          if (dto.title !== undefined) updateData.title = dto.title;
          if (dto.completed !== undefined) {
            updateData.completed = dto.completed;
            updateData.completedAt = dto.completed ? new Date() : null;
          }

          const updated = await tx.subtask.updateMany({
            where: { id: subtaskId, todoId },
            data: updateData,
          });
          if (updated.count !== 1) {
            return null;
          }

          return tx.subtask.findUnique({
            where: { id: subtaskId },
          });
        }

        const orderedSubtasks = await tx.subtask.findMany({
          where: { todoId },
          orderBy: [{ order: "asc" }, { createdAt: "asc" }, { id: "asc" }],
          select: { id: true },
        });
        if (orderedSubtasks.length === 0) {
          return null;
        }

        const movingIndex = orderedSubtasks.findIndex(
          (item) => item.id === subtaskId,
        );
        if (movingIndex === -1) {
          return null;
        }

        const clampedOrder = Math.max(
          0,
          Math.min(dto.order, orderedSubtasks.length - 1),
        );
        const moving = orderedSubtasks[movingIndex];
        const reordered = orderedSubtasks.filter(
          (item) => item.id !== subtaskId,
        );
        reordered.splice(clampedOrder, 0, moving);

        await tx.subtask.updateMany({
          where: { todoId },
          data: { order: { increment: 1000 } },
        });

        for (let index = 0; index < reordered.length; index += 1) {
          const item = reordered[index];
          const data: Prisma.SubtaskUpdateInput = { order: index };
          if (item.id === subtaskId) {
            if (dto.title !== undefined) {
              data.title = dto.title;
            }
            if (dto.completed !== undefined) {
              data.completed = dto.completed;
              data.completedAt = dto.completed ? new Date() : null;
            }
          }
          await tx.subtask.update({
            where: { id: item.id },
            data,
          });
        }

        return tx.subtask.findUnique({
          where: { id: subtaskId },
        });
      });

      return updatedSubtask ? this.mapPrismaToSubtask(updatedSubtask) : null;
    } catch (error: unknown) {
      if (isPrismaInvalidUuidError(error) || hasPrismaCode(error, ["P2025"])) {
        return null;
      }
      throw error;
    }
  }

  async deleteSubtask(
    userId: string,
    todoId: string,
    subtaskId: string,
  ): Promise<boolean> {
    try {
      const todo = await this.prisma.todo.findFirst({
        where: { id: todoId, userId },
      });
      if (!todo) {
        return false;
      }

      const deleted = await this.prisma.subtask.deleteMany({
        where: { id: subtaskId, todoId },
      });
      return deleted.count === 1;
    } catch (error: unknown) {
      if (isPrismaInvalidUuidError(error) || hasPrismaCode(error, ["P2025"])) {
        return false;
      }
      throw error;
    }
  }

  async clear(): Promise<void> {
    if (process.env.NODE_ENV === "production") {
      throw new Error("clear() is not allowed in production");
    }
    await this.prisma.todo.deleteMany();
    await this.prisma.project.deleteMany();
  }

  /**
   * Map Prisma Todo model to application Todo type.
   * Ensures consistent interface regardless of database representation.
   */
  private mapPrismaToTodo(prismaTodo: PrismaTodoWithRelations): Todo {
    return {
      id: prismaTodo.id,
      title: prismaTodo.title,
      description: prismaTodo.description ?? undefined,
      status: prismaTodo.status,
      completed: prismaTodo.completed,
      projectId: prismaTodo.projectId ?? undefined,
      category: prismaTodo.project?.name ?? prismaTodo.category ?? undefined,
      tags: prismaTodo.tags ?? [],
      context: prismaTodo.context ?? undefined,
      energy: prismaTodo.energy ?? undefined,
      dueDate: prismaTodo.dueDate ?? undefined,
      startDate: prismaTodo.startDate ?? undefined,
      scheduledDate: prismaTodo.scheduledDate ?? undefined,
      reviewDate: prismaTodo.reviewDate ?? undefined,
      completedAt: prismaTodo.completedAt ?? undefined,
      estimateMinutes: prismaTodo.estimateMinutes ?? undefined,
      waitingOn: prismaTodo.waitingOn ?? undefined,
      dependsOnTaskIds: prismaTodo.dependsOnTaskIds ?? [],
      order: prismaTodo.order,
      priority: prismaTodo.priority || "medium",
      archived: prismaTodo.archived,
      recurrence: {
        type: prismaTodo.recurrenceType,
        interval: prismaTodo.recurrenceInterval ?? undefined,
        rrule: prismaTodo.recurrenceRrule ?? undefined,
        nextOccurrence: prismaTodo.recurrenceNextOccurrence ?? undefined,
      },
      source: prismaTodo.source ?? undefined,
      doDate: prismaTodo.doDate ?? null,
      blockedReason: prismaTodo.blockedReason ?? null,
      effortScore: prismaTodo.effortScore ?? null,
      confidenceScore: prismaTodo.confidenceScore ?? null,
      firstStep: prismaTodo.firstStep ?? null,
      emotionalState:
        (prismaTodo.emotionalState as Todo["emotionalState"]) ?? null,
      sourceText: prismaTodo.sourceText ?? null,
      areaId: prismaTodo.areaId ?? null,
      goalId: prismaTodo.goalId ?? null,
      createdByPrompt: prismaTodo.createdByPrompt ?? undefined,
      notes: prismaTodo.notes ?? undefined,
      headingId: prismaTodo.headingId ?? undefined,
      userId: prismaTodo.userId,
      createdAt: prismaTodo.createdAt,
      updatedAt: prismaTodo.updatedAt,
      subtasks: prismaTodo.subtasks || undefined,
    };
  }

  private mapPrismaToSubtask(prismaSubtask: PrismaSubtaskRecord): Subtask {
    return {
      id: prismaSubtask.id,
      title: prismaSubtask.title,
      completed: prismaSubtask.completed,
      order: prismaSubtask.order,
      completedAt: prismaSubtask.completedAt ?? undefined,
      todoId: prismaSubtask.todoId,
      createdAt: prismaSubtask.createdAt,
      updatedAt: prismaSubtask.updatedAt,
    };
  }
}
