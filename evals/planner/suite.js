const assert = require("node:assert/strict");

const { PlannerService } = require("../../dist/services/plannerService");
const { TodoService } = require("../../dist/services/todoService");

const USER_ID = "user-1";

function makeProject(id, name, overrides = {}) {
  return {
    id,
    name,
    status: "active",
    archived: false,
    userId: USER_ID,
    createdAt: new Date("2026-03-01T00:00:00.000Z"),
    updatedAt: new Date("2026-03-01T00:00:00.000Z"),
    taskCount: 0,
    openTaskCount: 0,
    completedTaskCount: 0,
    todoCount: 0,
    openTodoCount: 0,
    ...overrides,
  };
}

function createProjectServiceMock(projects) {
  return {
    findAll: async () => projects,
    findById: async (_userId, projectId) =>
      projects.find((project) => project.id === projectId) ?? null,
    create: async () => {
      throw new Error("Not implemented in eval harness");
    },
    update: async () => {
      throw new Error("Not implemented in eval harness");
    },
    setArchived: async () => {
      throw new Error("Not implemented in eval harness");
    },
    delete: async () => {
      throw new Error("Not implemented in eval harness");
    },
  };
}

function createPlannerHarness(projects) {
  const todoService = new TodoService();
  const plannerService = new PlannerService({
    todoService,
    projectService: createProjectServiceMock(projects),
  });
  return { plannerService, todoService };
}

module.exports = {
  name: "planner",
  description:
    "Deterministic suggest/apply evals for the planner runtime over canonical services.",
  trials: [
    {
      id: "plan-project-suggest",
      type: "regression",
      description:
        "Project planning in suggest mode returns structured suggested tasks without mutating state.",
      async run() {
        const project = makeProject("project-1", "Vacation", {
          goal: "Plan anniversary vacation",
        });
        const { plannerService, todoService } = createPlannerHarness([project]);

        await todoService.create(USER_ID, {
          title: "Define success criteria for Plan anniversary vacation",
          projectId: project.id,
          category: project.name,
        });

        const result = await plannerService.planProject({
          userId: USER_ID,
          projectId: project.id,
          goal: "Plan anniversary vacation",
          mode: "suggest",
        });

        assert.ok(result);
        assert.equal(result.project.id, project.id);
        assert.equal(result.createdTaskIds.length, 0);
        assert.ok(result.suggestedTasks.length >= 1);

        const tasks = await todoService.findAll(USER_ID, {
          archived: false,
          projectId: project.id,
        });
        assert.equal(tasks.length, 1);

        return {
          summary: result.summary,
          suggestedTasks: result.suggestedTasks.map((task) => task.title),
        };
      },
    },
    {
      id: "ensure-next-action-existing",
      type: "regression",
      description:
        "ensure_next_action returns an existing next action instead of creating a duplicate.",
      async run() {
        const project = makeProject("project-1", "Platform");
        const { plannerService, todoService } = createPlannerHarness([project]);

        const existingTask = await todoService.create(USER_ID, {
          title: "Ship changelog",
          projectId: project.id,
          category: project.name,
          status: "next",
        });

        const result = await plannerService.ensureNextAction({
          userId: USER_ID,
          projectId: project.id,
          mode: "apply",
        });

        assert.ok(result);
        assert.equal(result.created, false);
        assert.equal(result.task?.id, existingTask.id);
        assert.equal(result.task?.status, "next");

        const tasks = await todoService.findAll(USER_ID, {
          archived: false,
          projectId: project.id,
        });
        assert.equal(tasks.length, 1);

        return result;
      },
    },
    {
      id: "weekly-review-suggest",
      type: "regression",
      description:
        "weekly_review returns stable findings and safe recommendations in suggest mode.",
      async run() {
        const emptyProject = makeProject("project-1", "Admin");
        const blockedProject = makeProject("project-2", "Launch");
        const now = Date.now();
        const { plannerService, todoService } = createPlannerHarness([
          emptyProject,
          blockedProject,
        ]);

        const waitingTask = await todoService.create(USER_ID, {
          title: "Await legal approval",
          projectId: blockedProject.id,
          category: blockedProject.name,
          status: "waiting",
          waitingOn: "legal approval",
          dueDate: new Date(now + 2 * 24 * 60 * 60 * 1000),
        });
        waitingTask.updatedAt = new Date(now - 60 * 24 * 60 * 60 * 1000);

        const result = await plannerService.weeklyReview({
          userId: USER_ID,
          mode: "suggest",
          includeArchived: false,
        });

        assert.equal(result.summary.projectsWithoutNextAction, 1);
        assert.equal(result.summary.waitingTasks, 1);
        assert.equal(result.summary.upcomingTasks, 1);
        assert.ok(
          result.findings.some((finding) => finding.type === "missing_next_action"),
        );

        return {
          summary: result.summary,
          findingTypes: result.findings.map((finding) => finding.type),
        };
      },
    },
    {
      id: "plan-project-apply",
      type: "capability",
      description:
        "Project planning in apply mode creates missing tasks through the canonical todo service.",
      async run() {
        const project = makeProject("project-1", "Launch");
        const { plannerService, todoService } = createPlannerHarness([project]);

        const result = await plannerService.planProject({
          userId: USER_ID,
          projectId: project.id,
          goal: "Launch customer beta",
          mode: "apply",
        });

        assert.ok(result);
        assert.ok(result.createdTaskIds.length > 0);
        const tasks = await todoService.findAll(USER_ID, {
          archived: false,
          projectId: project.id,
        });
        assert.equal(tasks.length, result.createdTaskIds.length);

        return {
          summary: result.summary,
          createdTaskIds: result.createdTaskIds,
        };
      },
    },
    {
      id: "decide-next-work-ranking",
      type: "capability",
      description:
        "The planner runtime ranks next work deterministically and includes reasons.",
      async run() {
        const project = makeProject("project-1", "Platform");
        const { plannerService, todoService } = createPlannerHarness([project]);

        await todoService.create(USER_ID, {
          title: "Investigate overdue bug",
          projectId: project.id,
          category: project.name,
          status: "next",
          priority: "high",
          dueDate: new Date("2026-03-11T12:00:00.000Z"),
          estimateMinutes: 45,
          context: "computer",
          energy: "medium",
        });
        await todoService.create(USER_ID, {
          title: "Document release steps",
          projectId: project.id,
          category: project.name,
          status: "next",
          priority: "medium",
          estimateMinutes: 90,
          context: "computer",
          energy: "medium",
        });

        const result = await plannerService.decideNextWork({
          userId: USER_ID,
          availableMinutes: 120,
          energy: "medium",
          context: ["computer"],
          mode: "suggest",
        });

        assert.ok(result.recommendedTasks.length >= 1);
        assert.equal(result.recommendedTasks[0].title, "Investigate overdue bug");
        assert.match(result.recommendedTasks[0].reason, /due soon|overdue|unblocks/i);

        return result;
      },
    },
  ],
};
