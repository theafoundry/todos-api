import { Prisma, PrismaClient } from "@prisma/client";
import { IProjectService } from "../interfaces/IProjectService";
import {
  CreateProjectDto,
  Project,
  ProjectTaskDisposition,
  UpdateProjectDto,
} from "../types";
import { hasPrismaCode } from "../errorHandling";

export class DuplicateProjectNameError extends Error {
  constructor() {
    super("Project name already exists");
    this.name = "DuplicateProjectNameError";
  }
}

export class PrismaProjectService implements IProjectService {
  constructor(private prisma: PrismaClient) {}

  private async mapProjectRows(
    userId: string,
    rows: Array<{
      id: string;
      name: string;
      description: string | null;
      status: Project["status"];
      priority: Project["priority"];
      area: string | null;
      goal: string | null;
      targetDate: Date | null;
      reviewCadence: Project["reviewCadence"];
      lastReviewedAt: Date | null;
      archived: boolean;
      archivedAt: Date | null;
      userId: string;
      createdAt: Date;
      updatedAt: Date;
      _count: { todos: number };
    }>,
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<Project[]> {
    const projectCounts = await this.getProjectCountMaps(
      userId,
      rows.map((row) => row.id),
      client,
    );

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      status: row.status,
      priority: row.priority ?? undefined,
      area: row.area,
      goal: row.goal,
      targetDate: row.targetDate,
      reviewCadence: row.reviewCadence ?? undefined,
      lastReviewedAt: row.lastReviewedAt,
      archived: row.archived,
      archivedAt: row.archivedAt,
      userId: row.userId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      taskCount: row._count.todos,
      openTaskCount: projectCounts.openByProjectId.get(row.id) || 0,
      completedTaskCount: projectCounts.completedByProjectId.get(row.id) || 0,
      todoCount: row._count.todos,
      openTodoCount: projectCounts.openByProjectId.get(row.id) || 0,
    }));
  }

  private async getProjectCountMaps(
    userId: string,
    projectIds: string[],
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<{
    openByProjectId: Map<string, number>;
    completedByProjectId: Map<string, number>;
  }> {
    if (!projectIds.length) {
      return {
        openByProjectId: new Map(),
        completedByProjectId: new Map(),
      };
    }

    const [openRows, completedRows] = await Promise.all([
      client.todo.groupBy({
        by: ["projectId"],
        where: {
          userId,
          completed: false,
          archived: false,
          projectId: { in: projectIds },
        },
        _count: { _all: true },
      }),
      client.todo.groupBy({
        by: ["projectId"],
        where: {
          userId,
          completed: true,
          archived: false,
          projectId: { in: projectIds },
        },
        _count: { _all: true },
      }),
    ]);

    return {
      openByProjectId: new Map(
        openRows
          .filter((row) => typeof row.projectId === "string" && row.projectId)
          .map((row) => [String(row.projectId), row._count._all]),
      ),
      completedByProjectId: new Map(
        completedRows
          .filter((row) => typeof row.projectId === "string" && row.projectId)
          .map((row) => [String(row.projectId), row._count._all]),
      ),
    };
  }

  async findAll(userId: string): Promise<Project[]> {
    const rows = await this.prisma.project.findMany({
      where: { userId },
      orderBy: { name: "asc" },
      include: {
        _count: {
          select: { todos: true },
        },
      },
    });
    return this.mapProjectRows(userId, rows);
  }

  async findById(
    userId: string,
    projectId: string,
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<Project | null> {
    try {
      const row = await client.project.findFirst({
        where: { id: projectId, userId },
        include: {
          _count: {
            select: { todos: true },
          },
        },
      });
      if (!row) {
        return null;
      }

      const [project] = await this.mapProjectRows(userId, [row], client);
      return project;
    } catch (error: unknown) {
      if (hasPrismaCode(error, ["P2023"])) {
        return null;
      }
      throw error;
    }
  }

  async create(userId: string, dto: CreateProjectDto): Promise<Project> {
    return this.createInTransaction(this.prisma, userId, dto);
  }

  async createInTransaction(
    client: Prisma.TransactionClient,
    userId: string,
    dto: CreateProjectDto,
  ): Promise<Project> {
    try {
      const archived = dto.archived === true || dto.status === "archived";
      const status = archived ? "archived" : dto.status || "active";
      const archivedAt = archived ? new Date() : null;
      const row = await client.project.create({
        data: {
          name: dto.name,
          description: dto.description,
          status,
          priority: dto.priority ?? null,
          area: dto.area,
          goal: dto.goal,
          targetDate: dto.targetDate,
          reviewCadence: dto.reviewCadence ?? null,
          lastReviewedAt: dto.lastReviewedAt,
          archived,
          archivedAt,
          userId,
        },
      });
      return {
        id: row.id,
        name: row.name,
        description: row.description,
        status: row.status,
        priority: row.priority ?? undefined,
        area: row.area,
        goal: row.goal,
        targetDate: row.targetDate,
        reviewCadence: row.reviewCadence ?? undefined,
        lastReviewedAt: row.lastReviewedAt,
        archived: row.archived,
        archivedAt: row.archivedAt,
        userId: row.userId,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        taskCount: 0,
        openTaskCount: 0,
        completedTaskCount: 0,
        todoCount: 0,
        openTodoCount: 0,
      };
    } catch (error: unknown) {
      if (hasPrismaCode(error, ["P2002"])) {
        throw new DuplicateProjectNameError();
      }
      throw error;
    }
  }

  async update(
    userId: string,
    projectId: string,
    dto: UpdateProjectDto,
  ): Promise<Project | null> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const existing = await tx.project.findFirst({
          where: { id: projectId, userId },
        });
        if (!existing) {
          return null;
        }

        const archived =
          dto.archived !== undefined
            ? dto.archived
            : dto.status !== undefined
              ? dto.status === "archived"
              : existing.archived;
        const status = archived
          ? "archived"
          : dto.status && dto.status !== "archived"
            ? dto.status
            : existing.status === "archived"
              ? "active"
              : existing.status;
        const archivedAt = archived ? existing.archivedAt || new Date() : null;

        const updated = await tx.project.update({
          where: { id: projectId },
          data: {
            ...(dto.name !== undefined ? { name: dto.name } : {}),
            ...(dto.description !== undefined
              ? { description: dto.description }
              : {}),
            ...(dto.priority !== undefined ? { priority: dto.priority } : {}),
            ...(dto.area !== undefined ? { area: dto.area } : {}),
            ...(dto.goal !== undefined ? { goal: dto.goal } : {}),
            ...(dto.targetDate !== undefined
              ? { targetDate: dto.targetDate }
              : {}),
            ...(dto.reviewCadence !== undefined
              ? { reviewCadence: dto.reviewCadence }
              : {}),
            ...(dto.lastReviewedAt !== undefined
              ? { lastReviewedAt: dto.lastReviewedAt }
              : {}),
            archived,
            archivedAt,
            status,
          },
        });

        const [count, openTodoCount, completedTaskCount] = await Promise.all([
          tx.todo.count({ where: { userId, projectId } }),
          tx.todo.count({
            where: { userId, projectId, completed: false, archived: false },
          }),
          tx.todo.count({
            where: { userId, projectId, completed: true, archived: false },
          }),
        ]);
        return {
          id: updated.id,
          name: updated.name,
          description: updated.description,
          status: updated.status,
          priority: updated.priority ?? undefined,
          area: updated.area,
          goal: updated.goal,
          targetDate: updated.targetDate,
          reviewCadence: updated.reviewCadence ?? undefined,
          lastReviewedAt: updated.lastReviewedAt,
          archived: updated.archived,
          archivedAt: updated.archivedAt,
          userId: updated.userId,
          createdAt: updated.createdAt,
          updatedAt: updated.updatedAt,
          taskCount: count,
          openTaskCount: openTodoCount,
          completedTaskCount,
          todoCount: count,
          openTodoCount,
        };
      });
    } catch (error: unknown) {
      if (hasPrismaCode(error, ["P2002"])) {
        throw new DuplicateProjectNameError();
      }
      if (hasPrismaCode(error, ["P2023"])) {
        return null;
      }
      throw error;
    }
  }

  async setArchived(
    userId: string,
    projectId: string,
    archived: boolean,
  ): Promise<Project | null> {
    try {
      return await this.update(userId, projectId, { archived });
    } catch (error: unknown) {
      if (hasPrismaCode(error, ["P2023"])) {
        return null;
      }
      throw error;
    }
  }

  async delete(
    userId: string,
    projectId: string,
    taskDisposition: ProjectTaskDisposition,
    moveTasksToProjectId?: string | null,
  ): Promise<boolean> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const existing = await tx.project.findFirst({
          where: { id: projectId, userId },
          select: { id: true },
        });
        if (!existing) {
          return false;
        }

        if (moveTasksToProjectId) {
          const targetProject = await tx.project.findFirst({
            where: { id: moveTasksToProjectId, userId },
            select: { id: true, name: true },
          });
          if (!targetProject) {
            return false;
          }

          await tx.todo.updateMany({
            where: { userId, projectId },
            data: {
              projectId: targetProject.id,
              category: targetProject.name,
              headingId: null,
            },
          });
        } else if (taskDisposition === "delete") {
          await tx.todo.deleteMany({
            where: { userId, projectId },
          });
        } else {
          await tx.todo.updateMany({
            where: { userId, projectId },
            data: {
              projectId: null,
              category: null,
              headingId: null,
            },
          });
        }

        await tx.project.delete({
          where: { id: projectId },
        });

        return true;
      });
    } catch (error: unknown) {
      if (hasPrismaCode(error, ["P2023"])) {
        return false;
      }
      throw error;
    }
  }
}
