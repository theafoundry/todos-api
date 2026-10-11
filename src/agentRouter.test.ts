import request from "supertest";
import express, { type Express } from "express";
import type { PrismaClient } from "@prisma/client";
import { createApp } from "./app";
import { AuthService } from "./services/authService";
import { TodoService } from "./services/todoService";
import type { IProjectService } from "./interfaces/IProjectService";
import type {
  CreateProjectDto,
  Project,
  ProjectTaskDisposition,
  UpdateProjectDto,
  Todo,
} from "./types";
import { AgentExecutor } from "./agent/agentExecutor";
import {
  AgentConfigService,
  type AgentConfigRecord,
} from "./services/agentConfigService";
import { AgentService } from "./services/agentService";
import { AiPlannerService } from "./services/aiService";
import { createAgentRouter } from "./routes/agentRouter";
import { createMcpRouter } from "./routes/mcpRouter";

function createProjectServiceMock(): jest.Mocked<IProjectService> {
  const projects: Project[] = [];

  return {
    findAll: jest
      .fn<Promise<Project[]>, [string]>()
      .mockImplementation(async (userId) =>
        projects.filter((project) => project.userId === userId),
      ),
    findById: jest
      .fn<Promise<Project | null>, [string, string]>()
      .mockImplementation(
        async (userId, id) =>
          projects.find(
            (project) => project.userId === userId && project.id === id,
          ) ?? null,
      ),
    create: jest
      .fn<Promise<Project>, [string, CreateProjectDto]>()
      .mockImplementation(async (userId, dto) => {
        const project: Project = {
          id: `project-${projects.length + 1}`,
          name: dto.name,
          status: dto.status ?? "active",
          archived: dto.archived ?? false,
          userId,
          createdAt: new Date(),
          updatedAt: new Date(),
          taskCount: 0,
          openTaskCount: 0,
          completedTaskCount: 0,
          todoCount: 0,
          openTodoCount: 0,
        };
        projects.push(project);
        return project;
      }),
    update: jest.fn<
      Promise<Project | null>,
      [string, string, UpdateProjectDto]
    >(),
    setArchived: jest.fn<Promise<Project | null>, [string, string, boolean]>(),
    delete: jest.fn<
      Promise<boolean>,
      [string, string, ProjectTaskDisposition, (string | null)?]
    >(),
  };
}

describe("Agent router", () => {
  let app: Express;
  let todoService: TodoService;
  let projectService: jest.Mocked<IProjectService>;

  beforeEach(() => {
    todoService = new TodoService();
    projectService = createProjectServiceMock();
    app = createApp({ todoService, projectService });
  });

  it("returns the runtime manifest with enabled project actions", async () => {
    const response = await request(app).get("/agent/manifest").expect(200);

    expect(response.body.ok).toBe(true);
    expect(response.body.action).toBe("manifest");
    expect(response.body.data.manifest.basePath).toBe("/agent");
    expect(
      response.body.data.manifest.definitions.todo.properties.status,
    ).toEqual(
      expect.objectContaining({
        $ref: "#/definitions/taskStatus",
      }),
    );
    expect(response.body.data.manifest.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "create_project",
          enabled: true,
          readOnly: false,
        }),
        expect.objectContaining({
          name: "archive_task",
          enabled: true,
          readOnly: false,
        }),
        expect.objectContaining({
          name: "list_today",
          enabled: true,
          readOnly: true,
        }),
        expect.objectContaining({
          name: "plan_project",
          enabled: true,
          readOnly: false,
        }),
        expect.objectContaining({
          name: "suggest_capture_route",
          enabled: true,
          readOnly: true,
        }),
        expect.objectContaining({
          name: "ensure_next_action",
          enabled: true,
          readOnly: false,
        }),
        expect.objectContaining({
          name: "weekly_review",
          enabled: true,
          readOnly: false,
        }),
        expect.objectContaining({
          name: "decide_next_work",
          enabled: true,
          readOnly: true,
        }),
        expect.objectContaining({
          name: "analyze_project_health",
          enabled: true,
          readOnly: true,
        }),
        expect.objectContaining({
          name: "analyze_work_graph",
          enabled: true,
          readOnly: true,
        }),
      ]),
    );
  });

  it("lists tasks through the read surface with a structured envelope", async () => {
    await request(app)
      .post("/todos")
      .send({ title: "Ship report", category: "Work" })
      .expect(201);
    await request(app)
      .post("/todos")
      .send({ title: "Home errand", category: "Home" })
      .expect(201);

    const response = await request(app)
      .post("/agent/read/list_tasks")
      .send({ project: "Work" })
      .expect(200);

    expect(response.body.ok).toBe(true);
    expect(response.body.action).toBe("list_tasks");
    expect(response.body.readOnly).toBe(true);
    expect(response.body.data.tasks).toHaveLength(1);
    expect(response.body.data.tasks[0].title).toBe("Ship report");
    expect(response.body.trace.requestId).toBeDefined();
  });

  it("returns structured validation errors for unsupported fields", async () => {
    const response = await request(app)
      .post("/agent/read/list_tasks")
      .send({ bogus: true })
      .expect(400);

    expect(response.body.ok).toBe(false);
    expect(response.body.action).toBe("list_tasks");
    expect(response.body.error.code).toBe("INVALID_INPUT");
    expect(response.body.error.retryable).toBe(false);
    expect(response.body.error.hint).toContain("/agent/manifest");
  });

  it("suggests capture routing through the read surface", async () => {
    const response = await request(app)
      .post("/agent/read/suggest_capture_route")
      .send({ text: "Submit expense report tomorrow" })
      .expect(200);

    expect(response.body.ok).toBe(true);
    expect(response.body.action).toBe("suggest_capture_route");
    expect(response.body.readOnly).toBe(true);
    expect(response.body.data.route).toBe("task");
    expect(response.body.data.extractedFields.dueDate).toBeDefined();
  });

  it("replays create_task responses for matching idempotency keys", async () => {
    const firstResponse = await request(app)
      .post("/agent/write/create_task")
      .set("Idempotency-Key", "task-create-1")
      .set("X-Agent-Name", "codex-test")
      .send({ title: "Agent created task" })
      .expect(201);

    const replayResponse = await request(app)
      .post("/agent/write/create_task")
      .set("Idempotency-Key", "task-create-1")
      .set("X-Agent-Name", "codex-test")
      .send({ title: "Agent created task" })
      .expect(201);

    expect(firstResponse.body.ok).toBe(true);
    expect(replayResponse.body.ok).toBe(true);
    expect(replayResponse.body.data.task.id).toBe(
      firstResponse.body.data.task.id,
    );
    expect(replayResponse.body.trace.replayed).toBe(true);
    expect(replayResponse.body.trace.originalRequestId).toBe(
      firstResponse.body.trace.requestId,
    );
  });

  it("returns a structured idempotency conflict for mismatched create_task payloads", async () => {
    await request(app)
      .post("/agent/write/create_task")
      .set("Idempotency-Key", "task-create-2")
      .send({ title: "Original task" })
      .expect(201);

    const response = await request(app)
      .post("/agent/write/create_task")
      .set("Idempotency-Key", "task-create-2")
      .send({ title: "Different task" })
      .expect(409);

    expect(response.body.ok).toBe(false);
    expect(response.body.action).toBe("create_task");
    expect(response.body.error.code).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("logs agent-triggered mutations with request trace metadata", async () => {
    const logSpy = jest.spyOn(console, "info").mockImplementation(() => {});

    await request(app)
      .post("/agent/write/create_task")
      .set("X-Agent-Name", "codex-test")
      .set("X-Agent-Request-Id", "req-123")
      .send({ title: "Logged task" })
      .expect(201);

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('"type":"agent_action"'),
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('"action":"create_task"'),
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('"requestId":"req-123"'),
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('"actor":"codex-test"'),
    );

    logSpy.mockRestore();
  });

  it("creates projects through the write surface with idempotency support", async () => {
    projectService.create.mockResolvedValue({
      id: "proj-1",
      name: "Platform",
      status: "active",
      archived: false,
      userId: "default-user",
      createdAt: new Date(),
      updatedAt: new Date(),
      todoCount: 0,
      openTodoCount: 0,
    });

    const firstResponse = await request(app)
      .post("/agent/write/create_project")
      .set("Idempotency-Key", "project-create-1")
      .send({ name: "Platform" })
      .expect(201);

    const replayResponse = await request(app)
      .post("/agent/write/create_project")
      .set("Idempotency-Key", "project-create-1")
      .send({ name: "Platform" })
      .expect(201);

    expect(projectService.create).toHaveBeenCalledTimes(1);
    expect(firstResponse.body.data.project.name).toBe("Platform");
    expect(replayResponse.body.trace.replayed).toBe(true);
  });

  it("replays ensure_next_action apply responses for matching idempotency keys", async () => {
    projectService.findById.mockResolvedValue({
      id: "00000000-0000-1000-8000-000000000051",
      name: "Ops",
      status: "active",
      archived: false,
      userId: "default-user",
      createdAt: new Date(),
      updatedAt: new Date(),
      todoCount: 0,
      openTodoCount: 0,
    } as Project);

    const firstResponse = await request(app)
      .post("/agent/write/ensure_next_action")
      .set("Idempotency-Key", "planner-ensure-1")
      .send({
        projectId: "00000000-0000-1000-8000-000000000051",
        mode: "apply",
      })
      .expect(200);

    const replayResponse = await request(app)
      .post("/agent/write/ensure_next_action")
      .set("Idempotency-Key", "planner-ensure-1")
      .send({
        projectId: "00000000-0000-1000-8000-000000000051",
        mode: "apply",
      })
      .expect(200);

    const tasks = await todoService.findAll("default-user", {
      archived: false,
    });

    expect(firstResponse.body.data.result.created).toBe(true);
    expect(replayResponse.body.trace.replayed).toBe(true);
    expect(replayResponse.body.data.result.task.id).toBe(
      firstResponse.body.data.result.task.id,
    );
    expect(tasks).toHaveLength(1);
  });

  it("returns a structured idempotency conflict for mismatched plan_project apply payloads", async () => {
    projectService.findById.mockResolvedValue({
      id: "00000000-0000-1000-8000-000000000052",
      name: "Vacation",
      goal: "Plan trip",
      status: "active",
      archived: false,
      userId: "default-user",
      createdAt: new Date(),
      updatedAt: new Date(),
      todoCount: 0,
      openTodoCount: 0,
    } as Project);

    await request(app)
      .post("/agent/write/plan_project")
      .set("Idempotency-Key", "planner-plan-1")
      .send({
        projectId: "00000000-0000-1000-8000-000000000052",
        goal: "Plan vacation",
        mode: "apply",
      })
      .expect(200);

    const response = await request(app)
      .post("/agent/write/plan_project")
      .set("Idempotency-Key", "planner-plan-1")
      .send({
        projectId: "00000000-0000-1000-8000-000000000052",
        goal: "Plan a different vacation",
        mode: "apply",
      })
      .expect(409);

    expect(response.body.ok).toBe(false);
    expect(response.body.action).toBe("plan_project");
    expect(response.body.error.code).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("replays weekly_review apply responses without duplicating created tasks", async () => {
    const reviewProject = {
      id: "00000000-0000-1000-8000-000000000053",
      name: "Admin",
      status: "active",
      archived: false,
      userId: "default-user",
      createdAt: new Date(),
      updatedAt: new Date(),
      todoCount: 0,
      openTodoCount: 0,
    } as Project;
    projectService.findAll.mockResolvedValue([reviewProject]);
    projectService.findById.mockResolvedValue(reviewProject);

    const firstResponse = await request(app)
      .post("/agent/write/weekly_review")
      .set("Idempotency-Key", "planner-review-1")
      .send({
        mode: "apply",
      })
      .expect(200);

    const replayResponse = await request(app)
      .post("/agent/write/weekly_review")
      .set("Idempotency-Key", "planner-review-1")
      .send({
        mode: "apply",
      })
      .expect(200);

    const tasks = await todoService.findAll("default-user", {
      archived: false,
    });

    expect(firstResponse.body.data.review.appliedActions).toHaveLength(1);
    expect(replayResponse.body.trace.replayed).toBe(true);
    expect(tasks).toHaveLength(1);
  });

  it("plans a project through the write surface", async () => {
    projectService.findById.mockResolvedValue({
      id: "00000000-0000-1000-8000-000000000041",
      name: "Vacation",
      goal: "Plan anniversary vacation",
      status: "active",
      archived: false,
      userId: "default-user",
      createdAt: new Date(),
      updatedAt: new Date(),
      todoCount: 0,
      openTodoCount: 0,
    } as Project);

    const response = await request(app)
      .post("/agent/write/plan_project")
      .send({
        projectId: "00000000-0000-1000-8000-000000000041",
        goal: "Plan anniversary vacation",
        mode: "suggest",
      })
      .expect(200);

    expect(response.body.ok).toBe(true);
    expect(response.body.action).toBe("plan_project");
    expect(response.body.data.plan.project).toEqual({
      id: "00000000-0000-1000-8000-000000000041",
      name: "Vacation",
    });
    expect(response.body.data.plan.suggestedTasks.length).toBeGreaterThan(0);
  });

  it("creates a missing next action through the write surface", async () => {
    projectService.findById.mockResolvedValue({
      id: "00000000-0000-1000-8000-000000000042",
      name: "Ops",
      status: "active",
      archived: false,
      userId: "default-user",
      createdAt: new Date(),
      updatedAt: new Date(),
      todoCount: 0,
      openTodoCount: 0,
    } as Project);

    const response = await request(app)
      .post("/agent/write/ensure_next_action")
      .send({
        projectId: "00000000-0000-1000-8000-000000000042",
        mode: "apply",
      })
      .expect(200);

    expect(response.body.ok).toBe(true);
    expect(response.body.action).toBe("ensure_next_action");
    expect(response.body.data.result.created).toBe(true);
    expect(response.body.data.result.task.status).toBe("next");
  });

  it("returns weekly review findings through the write surface", async () => {
    projectService.findAll.mockResolvedValue([
      {
        id: "00000000-0000-1000-8000-000000000043",
        name: "Admin",
        status: "active",
        archived: false,
        userId: "default-user",
        createdAt: new Date(),
        updatedAt: new Date(),
        todoCount: 0,
        openTodoCount: 0,
      } as Project,
    ]);

    const response = await request(app)
      .post("/agent/write/weekly_review")
      .send({
        mode: "suggest",
      })
      .expect(200);

    expect(response.body.ok).toBe(true);
    expect(response.body.action).toBe("weekly_review");
    expect(response.body.data.review.summary.projectsWithoutNextAction).toBe(0);
    expect(response.body.data.review.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "empty_active_project",
          projectName: "Admin",
        }),
      ]),
    );
  });

  it("decides the next work through the read surface", async () => {
    projectService.findAll.mockResolvedValue([
      {
        id: "00000000-0000-1000-8000-000000000044",
        name: "Platform",
        status: "active",
        archived: false,
        userId: "default-user",
        createdAt: new Date(),
        updatedAt: new Date(),
        todoCount: 0,
        openTodoCount: 0,
      } as Project,
    ]);

    await todoService.create("default-user", {
      title: "Investigate overdue bug",
      projectId: "00000000-0000-1000-8000-000000000044",
      category: "Platform",
      status: "next",
      priority: "high",
      dueDate: new Date("2026-03-11T12:00:00.000Z"),
      context: "computer",
      energy: "medium",
      estimateMinutes: 45,
    });

    const response = await request(app)
      .post("/agent/read/decide_next_work")
      .send({
        availableMinutes: 60,
        energy: "medium",
        context: ["computer"],
      })
      .expect(200);

    expect(response.body.ok).toBe(true);
    expect(response.body.action).toBe("decide_next_work");
    expect(response.body.data.decision.recommendedTasks[0].title).toBe(
      "Investigate overdue bug",
    );
  });

  it("analyzes project health through the read surface", async () => {
    projectService.findById.mockResolvedValue({
      id: "00000000-0000-1000-8000-000000000045",
      name: "Migration",
      status: "active",
      archived: false,
      userId: "default-user",
      createdAt: new Date(),
      updatedAt: new Date(),
      todoCount: 0,
      openTodoCount: 0,
    } as Project);

    await todoService.create("default-user", {
      title: "Await vendor answer",
      projectId: "00000000-0000-1000-8000-000000000045",
      category: "Migration",
      status: "waiting",
      waitingOn: "vendor answer",
    });

    const response = await request(app)
      .post("/agent/read/analyze_project_health")
      .send({
        projectId: "00000000-0000-1000-8000-000000000045",
      })
      .expect(200);

    expect(response.body.ok).toBe(true);
    expect(response.body.action).toBe("analyze_project_health");
    expect(response.body.data.health.risks).toEqual(
      expect.arrayContaining(["No next action defined"]),
    );
  });

  it("analyzes work graph dependencies through the read surface", async () => {
    projectService.findById.mockResolvedValue({
      id: "00000000-0000-1000-8000-000000000046",
      name: "Launch",
      status: "active",
      archived: false,
      userId: "default-user",
      createdAt: new Date(),
      updatedAt: new Date(),
      todoCount: 0,
      openTodoCount: 0,
    } as Project);

    const foundation = await todoService.create("default-user", {
      title: "Define rollout scope",
      projectId: "00000000-0000-1000-8000-000000000046",
      category: "Launch",
      status: "next",
    });
    await todoService.create("default-user", {
      title: "Approve launch checklist",
      projectId: "00000000-0000-1000-8000-000000000046",
      category: "Launch",
      status: "next",
      dependsOnTaskIds: [foundation.id],
    });

    const response = await request(app)
      .post("/agent/read/analyze_work_graph")
      .send({
        projectId: "00000000-0000-1000-8000-000000000046",
      })
      .expect(200);

    expect(response.body.ok).toBe(true);
    expect(response.body.action).toBe("analyze_work_graph");
    expect(response.body.data.graph.blockedTasks[0].title).toBe(
      "Approve launch checklist",
    );
  });

  it("returns agent auth errors in the structured action envelope", async () => {
    const authService = {
      verifyToken: jest.fn(),
    } as unknown as AuthService;
    const authedApp = createApp({
      todoService: new TodoService(),
      authService,
      projectService,
    });

    const response = await request(authedApp)
      .post("/agent/read/list_tasks")
      .send({})
      .expect(401);

    expect(response.body.ok).toBe(false);
    expect(response.body.action).toBe("list_tasks");
    expect(response.body.readOnly).toBe(true);
    expect(response.body.error.code).toBe("AUTH_REQUIRED");
    expect(response.body.trace.requestId).toBeDefined();
  });

  it("rejects invalid project rename input before calling the project service", async () => {
    const response = await request(app)
      .post("/agent/write/update_project")
      .send({
        id: "00000000-0000-1000-8000-000000000000",
        name: "   ",
      })
      .expect(400);

    expect(response.body.ok).toBe(false);
    expect(response.body.action).toBe("update_project");
    expect(response.body.error.code).toBe("INVALID_INPUT");
    expect(projectService.update).not.toHaveBeenCalled();
  });

  it("moves a task to another project through the agent surface", async () => {
    const task = await todoService.create("default-user", {
      title: "Move this task",
    });
    projectService.findById.mockResolvedValue({
      id: "00000000-0000-1000-8000-000000000001",
      name: "Platform",
      status: "active",
      archived: false,
      userId: "default-user",
      createdAt: new Date(),
      updatedAt: new Date(),
      todoCount: 3,
      openTodoCount: 2,
    });

    const response = await request(app)
      .post("/agent/write/move_task_to_project")
      .send({
        taskId: task.id,
        projectId: "00000000-0000-1000-8000-000000000001",
      })
      .expect(200);

    expect(response.body.ok).toBe(true);
    expect(response.body.data.task.category).toBe("Platform");
    expect(projectService.findById).toHaveBeenCalledWith(
      "default-user",
      "00000000-0000-1000-8000-000000000001",
    );
  });

  it("rejects cross-user project moves through the agent surface", async () => {
    const task = await todoService.create("default-user", {
      title: "Private task",
    });
    projectService.findById.mockResolvedValue(null);

    const response = await request(app)
      .post("/agent/write/move_task_to_project")
      .send({
        taskId: task.id,
        projectId: "00000000-0000-1000-8000-000000000002",
      })
      .expect(404);

    expect(response.body.ok).toBe(false);
    expect(response.body.action).toBe("move_task_to_project");
    expect(response.body.error.code).toBe("RESOURCE_NOT_FOUND_OR_FORBIDDEN");
  });

  it("deletes projects with reassignment through the agent surface", async () => {
    projectService.delete.mockResolvedValue(true);

    const response = await request(app)
      .post("/agent/write/delete_project")
      .send({
        id: "00000000-0000-1000-8000-000000000010",
        moveTasksToProjectId: "00000000-0000-1000-8000-000000000011",
      })
      .expect(200);

    expect(projectService.delete).toHaveBeenCalledWith(
      "default-user",
      "00000000-0000-1000-8000-000000000010",
      "unsorted",
      "00000000-0000-1000-8000-000000000011",
    );
    expect(response.body.data.deleted).toBe(true);
    expect(response.body.data.taskDisposition).toBe("reassigned");
  });

  it("archives projects through the agent surface", async () => {
    projectService.setArchived.mockResolvedValue({
      id: "00000000-0000-1000-8000-000000000020",
      name: "Platform",
      status: "archived",
      archived: true,
      userId: "default-user",
      createdAt: new Date(),
      updatedAt: new Date(),
      todoCount: 4,
      openTodoCount: 2,
    });

    const response = await request(app)
      .post("/agent/write/archive_project")
      .send({
        id: "00000000-0000-1000-8000-000000000020",
        archived: true,
      })
      .expect(200);

    expect(response.body.ok).toBe(true);
    expect(response.body.data.project.archived).toBe(true);
  });
});

describe.each(["agent", "mcp"] as const)(
  "Legacy AI policy through %s",
  (surface) => {
    let app: Express;
    let agentConfig: AgentConfigRecord;
    let providerCall: jest.Mock;
    let todoService: TodoService;
    let projectService: jest.Mocked<IProjectService>;
    let tasks: Todo[];

    async function addStaleProjectTask() {
      const project = await projectService.create("user-1", {
        name: "Synthetic launch plan",
      });
      const task = await todoService.create("user-1", {
        title: "Write launch checklist",
        projectId: project.id,
        status: "next",
      });
      task.updatedAt = new Date(Date.now() - 8 * 86_400_000);
      tasks.push(task);
    }

    async function callAction(name: string) {
      const response =
        surface === "agent"
          ? await request(app)
              .post(`/agent/write/${name}`)
              .set("Authorization", "Bearer synthetic-access-token")
              .send({})
              .expect(200)
          : await request(app)
              .post("/mcp")
              .set("Authorization", "Bearer synthetic-mcp-token")
              .send({
                jsonrpc: "2.0",
                id: 1,
                method: "tools/call",
                params: { name, arguments: {} },
              })
              .expect(200);
      const envelope =
        surface === "agent"
          ? response.body
          : response.body.result.structuredContent;
      expect(envelope.ok).toBe(true);
      return envelope.data;
    }

    beforeEach(async () => {
      agentConfig = {
        ...(await new AgentConfigService().getConfig("user-1")),
        aiOptOut: true,
      };
      jest
        .spyOn(AgentConfigService.prototype, "getConfig")
        .mockImplementation(async (userId) => {
          expect(userId).toBe("user-1");
          return agentConfig;
        });
      jest
        .spyOn(global, "fetch")
        .mockRejectedValue(new Error("Unexpected HTTP"));

      tasks = [];
      todoService = new TodoService();
      projectService = createProjectServiceMock();
      await addStaleProjectTask();
      jest
        .spyOn(AgentService.prototype, "listTasks")
        .mockImplementation(async (userId, query) =>
          tasks.filter(
            (task) =>
              task.userId === userId &&
              (!query.projectId || task.projectId === query.projectId),
          ),
        );
      jest
        .spyOn(AgentService.prototype, "analyzeProjectHealthForUser")
        .mockResolvedValue({ healthScore: 10 } as any);
      jest
        .spyOn(AgentService.prototype, "ensureNextActionForUser")
        .mockResolvedValue({ created: false } as any);
      jest.spyOn(todoService, "createSubtask");

      providerCall = jest.fn().mockResolvedValue({
        brief: "Provider morning brief",
        subtasks: [{ title: "Provider subtask" }],
      });
      const aiPlannerService = new AiPlannerService({
        provider: { generateJson: providerCall },
      });
      const persistencePrisma = {
        userInsight: { findMany: jest.fn().mockResolvedValue([]) },
        userPlanningPreferences: {
          findUnique: jest.fn().mockResolvedValue(null),
        },
        agentActionAudit: { create: jest.fn().mockResolvedValue({}) },
      } as unknown as PrismaClient;
      const agentExecutor = new AgentExecutor({
        todoService,
        projectService,
        persistencePrisma,
        aiPlannerService,
      });
      const authService = {
        verifyActiveToken: jest.fn().mockResolvedValue({
          userId: "user-1",
          email: "synthetic@example.com",
        }),
        verifyMcpToken: jest.fn().mockResolvedValue({
          userId: "user-1",
          email: "synthetic@example.com",
          tokenType: "mcp",
          scopes: ["tasks.read", "tasks.write", "projects.read"],
        }),
        getUserById: jest.fn().mockResolvedValue({
          id: "user-1",
          email: "synthetic@example.com",
          role: "user",
          plan: "free",
        }),
      } as unknown as AuthService;
      app = express();
      app.use(express.json());
      app.use("/agent", createAgentRouter({ agentExecutor, authService }));
      app.use("/mcp", createMcpRouter({ agentExecutor, authService }));
    });

    afterEach(() => {
      expect(global.fetch).not.toHaveBeenCalled();
      jest.restoreAllMocks();
    });

    it("returns the deterministic morning brief without provider access on opt-out", async () => {
      const data = await callAction("generate_morning_brief");

      expect(data.deterministic).toBe(true);
      expect(data.brief).toContain("Write launch checklist");
      expect(providerCall).not.toHaveBeenCalled();
    });

    it("keeps provider morning briefs available when the user allows AI", async () => {
      agentConfig.aiOptOut = false;

      const data = await callAction("generate_morning_brief");

      expect(data).toMatchObject({
        deterministic: false,
        brief: "Provider morning brief",
      });
      expect(providerCall).toHaveBeenCalledTimes(1);
    });

    it("falls back to the deterministic morning brief when the provider fails", async () => {
      agentConfig.aiOptOut = false;
      providerCall.mockRejectedValue(new Error("Synthetic provider failure"));

      const data = await callAction("generate_morning_brief");

      expect(data.deterministic).toBe(true);
      expect(data.brief).toContain("Write launch checklist");
      expect(providerCall).toHaveBeenCalledTimes(1);
    });

    it("uses deterministic project breakdown on opt-out and preserves the write cap", async () => {
      agentConfig.maxWriteActionsPerRun = 2;

      const data = await callAction("project_health_intervention");

      expect(data.totalWriteActions).toBe(2);
      expect(data.interventions[0].subtasksCreated).toBe(2);
      expect(todoService.createSubtask).toHaveBeenCalledTimes(2);
      expect(providerCall).not.toHaveBeenCalled();
    });

    it("preserves the existing project-health enable gate", async () => {
      agentConfig.projectHealthEnabled = false;
      agentConfig.aiOptOut = false;

      const data = await callAction("project_health_intervention");

      expect(data).toMatchObject({ skipped: true });
      expect(todoService.createSubtask).not.toHaveBeenCalled();
      expect(providerCall).not.toHaveBeenCalled();
    });

    it("keeps provider project breakdown bounded to three critical projects", async () => {
      agentConfig.aiOptOut = false;
      for (let index = 0; index < 3; index++) await addStaleProjectTask();

      const data = await callAction("project_health_intervention");

      expect(data.projectsAnalyzed).toBe(4);
      expect(data.criticalCount).toBe(3);
      expect(data.totalWriteActions).toBe(3);
      expect(providerCall).toHaveBeenCalledTimes(3);
    });
  },
);
