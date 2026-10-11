import { randomUUID } from "crypto";
import request from "supertest";
import { createApp } from "./app";
import { config } from "./config";
import { prisma } from "./prismaClient";
import { AuthService } from "./services/authService";
import { DataExportService } from "./services/dataExportService";
import { DataRetentionService } from "./services/dataRetentionService";
import { PrismaTodoService } from "./services/prismaTodoService";

const SUFFIX = "@data-privacy.example.test";
const SECRET_MARKER = "synthetic-private-credential";
const INTERNAL_MARKER = "synthetic-internal-payload";
const OWNED_MODELS = [
  "socialAccount",
  "refreshToken",
  "mcpAuthorizationCode",
  "mcpAssistantSession",
  "mcpRefreshToken",
  "agentIdempotencyRecord",
  "agentActionAudit",
  "agentEnrollment",
  "agentJobRun",
  "agentConfig",
  "agentMetricEvent",
  "taskRecommendationFeedback",
  "userDayContext",
  "learningRecommendation",
  "failedAutomationAction",
  "aiSuggestion",
  "captureItem",
  "feedbackRequest",
  "area",
  "goal",
  "userPlanningPreferences",
  "activityEvent",
  "userInsight",
  "dayPlan",
  "userAdaptationProfile",
  "todo",
  "project",
] as const;

async function createRunnerTables() {
  await prisma.$executeRaw`
    CREATE TABLE agent_runner_job_runs (
      id SERIAL PRIMARY KEY, job_name TEXT NOT NULL, period_key TEXT NOT NULL,
      user_id TEXT NOT NULL DEFAULT 'global', started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ, status TEXT NOT NULL DEFAULT 'running',
      result_summary JSONB, error_message TEXT, UNIQUE(job_name, period_key, user_id)
    )
  `;
  await prisma.$executeRaw`
    CREATE TABLE agent_runner_audit_log (
      id SERIAL PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      job_name TEXT NOT NULL, period_key TEXT NOT NULL, user_id TEXT NOT NULL DEFAULT 'global',
      action_type TEXT NOT NULL, entity_type TEXT, entity_id TEXT, idempotency_key TEXT,
      payload JSONB, result JSONB, outcome TEXT NOT NULL, skip_reason TEXT, error_message TEXT
    )
  `;
}

async function account(label: string) {
  return prisma.user.create({
    data: {
      email: `${label}-${randomUUID()}${SUFFIX}`,
      name: label,
      password: SECRET_MARKER,
      verificationToken: `${SECRET_MARKER}-verify-${randomUUID()}`,
      resetToken: `${SECRET_MARKER}-reset-${randomUUID()}`,
      onboardingCompletedAt: new Date(),
    },
  });
}

async function completeFixture(label: string) {
  const user = await account(label);
  const userId = user.id;
  const auth = new AuthService(prisma);
  const credentials = await auth.issueTokens(user.id, user.email);
  const area = await prisma.area.create({
    data: { userId, name: `${label} area` },
  });
  const goal = await prisma.goal.create({
    data: { userId, name: `${label} goal` },
  });
  const project = await prisma.project.create({
    data: {
      userId,
      name: `${label} project`,
      areaId: area.id,
      goalId: goal.id,
      headings: { create: { name: `${label} heading` } },
    },
    include: { headings: true },
  });
  const todo = await prisma.todo.create({
    data: {
      userId,
      title: `${label} task`,
      projectId: project.id,
      headingId: project.headings[0].id,
      areaId: area.id,
      goalId: goal.id,
      subtasks: { create: { title: `${label} subtask` } },
    },
    include: { subtasks: true },
  });
  const session = await prisma.mcpAssistantSession.create({
    data: {
      userId,
      clientId: "https://assistant.example.test/client",
      assistantName: "Fixture assistant",
      resource: `${config.baseUrl}/mcp/app`,
      source: "oauth",
      scopes: ["tasks.read", "tasks.write"],
    },
  });
  const expiresAt = new Date(Date.now() + 86_400_000);
  await Promise.all([
    prisma.socialAccount.create({
      data: {
        userId,
        provider: "google",
        providerSubject: `${label}-${randomUUID()}`,
        emailAtProvider: user.email,
      },
    }),
    prisma.mcpAuthorizationCode.create({
      data: {
        code: randomUUID(),
        userId,
        email: user.email!,
        clientId: "fixture-client",
        redirectUri: "https://assistant.example.test/callback",
        codeChallenge: SECRET_MARKER,
        codeChallengeMethod: "S256",
        expiresAt,
      },
    }),
    prisma.mcpRefreshToken.create({
      data: {
        userId,
        sessionId: session.id,
        email: user.email!,
        tokenHash: `${SECRET_MARKER}-${randomUUID()}`,
        expiresAt,
      },
    }),
    prisma.agentIdempotencyRecord.create({
      data: {
        userId,
        action: "capture_inbox_item",
        idempotencyKey: INTERNAL_MARKER,
        inputHash: INTERNAL_MARKER,
        status: 201,
        response: { private: INTERNAL_MARKER },
        expiresAt,
      },
    }),
    prisma.agentActionAudit.create({
      data: {
        userId,
        surface: "agent",
        action: "create_task",
        readOnly: false,
        outcome: "success",
        status: 201,
        requestId: INTERNAL_MARKER,
        actor: INTERNAL_MARKER,
        metadata: { private: INTERNAL_MARKER },
        agentId: "synthetic-agent",
        narration: INTERNAL_MARKER,
      },
    }),
    prisma.agentEnrollment.create({
      data: { userId, refreshToken: SECRET_MARKER },
    }),
    prisma.agentJobRun.create({
      data: {
        userId,
        jobName: "fixture",
        periodKey: "2026-10-11",
        status: "completed",
        metadata: { private: INTERNAL_MARKER },
        errorMessage: INTERNAL_MARKER,
      },
    }),
    prisma.agentConfig.create({ data: { userId } }),
    prisma.agentMetricEvent.create({
      data: {
        userId,
        jobName: "fixture",
        periodKey: "2026-10-11",
        metricType: "tasks",
        value: 1,
        metadata: { private: INTERNAL_MARKER },
      },
    }),
    prisma.taskRecommendationFeedback.create({
      data: {
        userId,
        planDate: "2026-10-11",
        taskId: todo.id,
        signal: "accepted",
      },
    }),
    prisma.userDayContext.create({
      data: {
        userId,
        contextDate: "2026-10-11",
        notes: `${label} day context`,
      },
    }),
    prisma.learningRecommendation.create({
      data: {
        userId,
        type: "fixture",
        target: "maxDailyTasks",
        currentValue: 6,
        suggestedValue: 5,
        confidence: 0.8,
        why: `${label} recommendation`,
      },
    }),
    prisma.failedAutomationAction.create({
      data: {
        userId,
        jobName: "fixture",
        periodKey: "2026-10-11",
        actionType: "create_task",
        errorCode: "FIXTURE",
        payload: { private: INTERNAL_MARKER },
        errorMessage: INTERNAL_MARKER,
      },
    }),
    prisma.aiSuggestion.create({
      data: {
        userId,
        type: "task_critic",
        input: { title: todo.title },
        output: { title: todo.title },
        appliedTodos: { create: { todoId: todo.id } },
      },
    }),
    prisma.captureItem.create({
      data: {
        userId,
        text: `${label} capture`,
        triageResult: { route: "task", taskId: todo.id },
      },
    }),
    prisma.feedbackRequest.create({
      data: {
        userId,
        type: "general",
        title: `${label} feedback`,
        body: `${label} feedback body`,
        triageSummary: INTERNAL_MARKER,
        matchedFeedbackIds: [INTERNAL_MARKER],
        screenshotUrl: "https://attachments.example.test/fixture.png",
      },
    }),
    prisma.userPlanningPreferences.create({ data: { userId } }),
    prisma.activityEvent.create({
      data: { userId, eventType: "task_created", entityId: todo.id },
    }),
    prisma.userInsight.create({
      data: {
        userId,
        insightType: "completion_velocity",
        periodType: "daily",
        periodStart: new Date("2026-10-11T00:00:00Z"),
        value: 1,
      },
    }),
    prisma.dayPlan.create({
      data: {
        userId,
        date: new Date("2026-10-11T00:00:00Z"),
        notes: `${label} plan`,
        tasks: { create: { todoId: todo.id, order: 0 } },
      },
    }),
    prisma.userAdaptationProfile.create({
      data: {
        userId,
        structureAppetite: "moderate",
        insightAffinity: "moderate",
        dateDiscipline: "moderate",
        organizationStyle: "moderate",
        guidanceNeed: "moderate",
      },
    }),
    prisma.$executeRaw`INSERT INTO agent_runner_job_runs (job_name,period_key,user_id,result_summary,error_message) VALUES ('fixture','2026-10-11',${userId},${JSON.stringify({ private: INTERNAL_MARKER })}::jsonb,${INTERNAL_MARKER})`,
    prisma.$executeRaw`INSERT INTO agent_runner_audit_log (job_name,period_key,user_id,action_type,outcome,payload,error_message) VALUES ('fixture','2026-10-11',${userId},'create_task','applied',${JSON.stringify({ private: INTERNAL_MARKER })}::jsonb,${INTERNAL_MARKER})`,
  ]);
  const mcp = auth.createMcpToken({
    userId,
    email: user.email!,
    sessionId: session.id,
    resource: `${config.baseUrl}/mcp/app`,
    scopes: ["tasks.read", "tasks.write"],
  });
  return { user, todo, project, session, credentials, mcp };
}

describe("Account privacy controls (disposable PostgreSQL)", () => {
  let disposableDatabaseApproved = false;
  beforeAll(() => {
    const db = new URL(config.databaseUrl || "");
    if (
      !["localhost", "127.0.0.1", "[::1]"].includes(db.hostname) ||
      !db.pathname.includes("test")
    ) {
      throw new Error("Privacy fixtures require a local test database");
    }
    disposableDatabaseApproved = true;
  });
  beforeEach(async () => {
    if (!disposableDatabaseApproved) return;
    await prisma.$executeRaw`DROP TABLE IF EXISTS agent_runner_job_runs`;
    await prisma.$executeRaw`DROP TABLE IF EXISTS agent_runner_audit_log`;
  });
  afterAll(async () => {
    if (!disposableDatabaseApproved) return;
    await prisma.user.deleteMany({ where: { email: { endsWith: SUFFIX } } });
    await prisma.$executeRaw`DROP TABLE IF EXISTS agent_runner_job_runs`;
    await prisma.$executeRaw`DROP TABLE IF EXISTS agent_runner_audit_log`;
  });

  it("exports and deletes accounts when optional runner tables have never existed", async () => {
    const owner = await account("optional-absent");
    const data = await new DataExportService(prisma).exportAllUserData(
      owner.id,
    );
    expect(data.user).toMatchObject({ id: owner.id });
    expect(data.runnerJobRuns).toEqual([]);
    expect(data.runnerActionHistory).toEqual([]);
    await new AuthService(prisma).deleteUser(owner.id);
    expect(
      await prisma.user.findUnique({ where: { id: owner.id } }),
    ).toBeNull();
  });

  it("exports all owned categories and over1000 events without credentials or internal payloads", async () => {
    await createRunnerTables();
    const owner = await completeFixture("export-owner");
    const other = await completeFixture("other-owner");
    await prisma.activityEvent.createMany({
      data: Array.from({ length: 1000 }, () => ({
        userId: owner.user.id,
        eventType: "session_start" as const,
      })),
    });
    // A malformed historical cross-account child must not expose the other task.
    await prisma.dayPlanTask.create({
      data: {
        planId: (
          await prisma.dayPlan.findFirstOrThrow({
            where: { userId: owner.user.id },
          })
        ).id,
        todoId: other.todo.id,
        order: 1,
      },
    });
    const data = (await new DataExportService(prisma).exportAllUserData(
      owner.user.id,
    )) as any;
    expect(data.activityEvents).toHaveLength(1001);
    expect(data.todos[0].subtasks[0].title).toBe("export-owner subtask");
    expect(data.projects[0].headings[0].name).toBe("export-owner heading");
    expect(data.dayPlans[0].tasks).toHaveLength(1);
    expect(data.dayPlans[0].tasks[0].todoId).toBe(owner.todo.id);
    for (const key of [
      "areas",
      "goals",
      "captureItems",
      "insights",
      "dayContexts",
      "recommendationFeedback",
      "learningRecommendations",
      "aiSuggestions",
      "socialAccounts",
      "feedbackRequests",
      "assistantConnections",
      "agentJobRuns",
      "agentMetricEvents",
      "failedAutomationActions",
      "actionHistory",
      "actionReceipts",
      "runnerJobRuns",
      "runnerActionHistory",
    ])
      expect(data[key]).toHaveLength(1);
    for (const key of [
      "planningPreferences",
      "agentConfig",
      "adaptationProfile",
      "agentEnrollment",
    ])
      expect(data[key]).not.toBeNull();
    const serialized = JSON.stringify(data);
    expect(serialized).not.toContain(SECRET_MARKER);
    expect(serialized).not.toContain(INTERNAL_MARKER);
    expect(serialized).not.toContain("other-owner");
    expect(data.exportNotes.excludedAuthenticationSecrets).toBeTruthy();
    const auth = new AuthService(prisma);
    const app = createApp({
      authService: auth,
      todoService: new PrismaTodoService(prisma),
    });
    const response = await request(app)
      .get("/users/me/export")
      .set("Authorization", `Bearer ${owner.credentials.token}`)
      .expect(200);
    expect(response.headers["content-disposition"]).toContain(
      "my-data-export.json",
    );
    expect(response.body.user.id).toBe(owner.user.id);
  });

  it("deletes every owned category and raw runner row while preserving another account and reviewer references", async () => {
    await createRunnerTables();
    const owner = await completeFixture("delete-owner");
    const other = await completeFixture("preserved-owner");
    const feedback = await prisma.feedbackRequest.findFirstOrThrow({
      where: { userId: other.user.id },
    });
    await prisma.feedbackRequest.update({
      where: { id: feedback.id },
      data: { reviewedByUserId: owner.user.id },
    });
    const delegates = prisma as unknown as Record<
      string,
      { count(input: unknown): Promise<number> }
    >;
    for (const model of OWNED_MODELS)
      expect(
        await delegates[model].count({ where: { userId: owner.user.id } }),
      ).toBeGreaterThan(0);
    const auth = new AuthService(prisma);
    const deletionApp = createApp({
      authService: auth,
      todoService: new PrismaTodoService(prisma),
    });
    await request(deletionApp)
      .delete(`/admin/users/${owner.user.id}`)
      .set("Authorization", `Bearer ${other.credentials.token}`)
      .expect(403);
    await prisma.user.update({
      where: { id: other.user.id },
      data: { role: "admin" },
    });
    await request(deletionApp)
      .delete(`/admin/users/${owner.user.id}`)
      .set("Authorization", `Bearer ${other.credentials.token}`)
      .expect(200);
    for (const model of OWNED_MODELS) {
      expect(
        await delegates[model].count({ where: { userId: owner.user.id } }),
      ).toBe(0);
      expect(
        await delegates[model].count({ where: { userId: other.user.id } }),
      ).toBeGreaterThan(0);
    }
    expect(
      await prisma.subtask.findUnique({
        where: { id: owner.todo.subtasks[0].id },
      }),
    ).toBeNull();
    expect(
      await prisma.heading.findUnique({
        where: { id: owner.project.headings[0].id },
      }),
    ).toBeNull();
    expect(
      await prisma.dayPlanTask.count({ where: { todoId: owner.todo.id } }),
    ).toBe(0);
    expect(
      await prisma.aiSuggestionAppliedTodo.count({
        where: { todoId: owner.todo.id },
      }),
    ).toBe(0);
    expect(
      (
        await prisma.feedbackRequest.findUniqueOrThrow({
          where: { id: feedback.id },
        })
      ).reviewedByUserId,
    ).toBeNull();
    for (const table of ["agent_runner_job_runs", "agent_runner_audit_log"]) {
      const rows =
        table === "agent_runner_job_runs"
          ? await prisma.$queryRaw<
              { user_id: string }[]
            >`SELECT user_id FROM agent_runner_job_runs`
          : await prisma.$queryRaw<
              { user_id: string }[]
            >`SELECT user_id FROM agent_runner_audit_log`;
      expect(rows.map((row) => row.user_id)).toEqual([other.user.id]);
    }
    await expect(
      auth.verifyActiveToken(owner.credentials.token),
    ).rejects.toThrow("Invalid token");
    await expect(
      auth.verifyMcpToken(owner.mcp.token, {
        resource: `${config.baseUrl}/mcp/app`,
        requireResource: true,
      }),
    ).rejects.toThrow("revoked");
    await expect(
      auth.refreshAccessToken(owner.credentials.refreshToken!),
    ).rejects.toThrow();
    const app = createApp({
      authService: auth,
      todoService: new PrismaTodoService(prisma),
    });
    await request(app)
      .get("/todos")
      .set("Authorization", `Bearer ${owner.credentials.token}`)
      .expect(401);
    const agent = await request(app)
      .post("/agent/read/list_tasks")
      .set("Authorization", `Bearer ${owner.credentials.token}`)
      .send({})
      .expect(401);
    expect(agent.body.error.code).toBe("INVALID_TOKEN");
    await request(app)
      .get("/todos")
      .set("Authorization", `Bearer ${other.credentials.token}`)
      .expect(200);
  });

  it("rolls back account cascades if optional runner cleanup fails", async () => {
    await createRunnerTables();
    const owner = await completeFixture("rollback-owner");
    await prisma.$executeRaw`CREATE FUNCTION privacy_fixture_block_delete() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RAISE EXCEPTION ''fixture blocks deletion''; END'`;
    await prisma.$executeRaw`CREATE TRIGGER privacy_fixture_delete BEFORE DELETE ON agent_runner_job_runs FOR EACH ROW EXECUTE FUNCTION privacy_fixture_block_delete()`;
    try {
      await expect(
        new AuthService(prisma).deleteUser(owner.user.id),
      ).rejects.toThrow("fixture blocks deletion");
      expect(
        await prisma.user.findUnique({ where: { id: owner.user.id } }),
      ).not.toBeNull();
      expect(
        await prisma.captureItem.count({ where: { userId: owner.user.id } }),
      ).toBe(1);
      expect(
        await prisma.refreshToken.count({ where: { userId: owner.user.id } }),
      ).toBe(1);
    } finally {
      await prisma.$executeRaw`DROP TRIGGER privacy_fixture_delete ON agent_runner_job_runs`;
      await prisma.$executeRaw`DROP FUNCTION privacy_fixture_block_delete()`;
    }
  });

  it("retains exact cutoff records and deletes only the actor's older history", async () => {
    const owner = await account("retention-owner");
    const other = await account("retention-other");
    const now = new Date("2026-10-11T12:00:00Z");
    for (const userId of [owner.id, other.id]) {
      for (const offset of [-1, 0, 1]) {
        await prisma.activityEvent.create({
          data: {
            userId,
            eventType: "session_start",
            createdAt: new Date(now.getTime() - 90 * 86_400_000 + offset),
          },
        });
        await prisma.userInsight.create({
          data: {
            userId,
            insightType: "completion_velocity",
            periodType: "daily",
            periodStart: new Date(now.getTime() + offset),
            value: 1,
            computedAt: new Date(now.getTime() - 365 * 86_400_000 + offset),
          },
        });
        await prisma.agentMetricEvent.create({
          data: {
            userId,
            jobName: "fixture",
            periodKey: "2026-10-11",
            metricType: "tasks",
            value: 1,
            recordedAt: new Date(now.getTime() - 180 * 86_400_000 + offset),
          },
        });
      }
    }
    jest
      .useFakeTimers({
        doNotFake: [
          "nextTick",
          "hrtime",
          "performance",
          "queueMicrotask",
          "setImmediate",
          "clearImmediate",
          "setInterval",
          "clearInterval",
          "setTimeout",
          "clearTimeout",
        ],
      })
      .setSystemTime(now);
    try {
      expect(await new DataRetentionService(prisma).purgeAll(owner.id)).toEqual(
        { activityEvents: 1, insights: 1, metricEvents: 1 },
      );
    } finally {
      jest.useRealTimers();
    }
    for (const model of [
      prisma.activityEvent,
      prisma.userInsight,
      prisma.agentMetricEvent,
    ] as any[]) {
      expect(await model.count({ where: { userId: owner.id } })).toBe(2);
      expect(await model.count({ where: { userId: other.id } })).toBe(3);
    }
  });

  it("passes the authenticated actor through the retention action even with cross-account input", async () => {
    const owner = await account("retention-route-owner");
    const other = await account("retention-route-other");
    const old = new Date("2020-01-01T00:00:00Z");
    await prisma.activityEvent.createMany({
      data: [owner.id, other.id].map((userId) => ({
        userId,
        eventType: "session_start" as const,
        createdAt: old,
      })),
    });
    const auth = new AuthService(prisma);
    const credentials = await auth.issueTokens(owner.id, owner.email);
    const app = createApp({
      authService: auth,
      todoService: new PrismaTodoService(prisma),
    });
    const response = await request(app)
      .post("/agent/write/run_data_retention")
      .set("Authorization", `Bearer ${credentials.token}`)
      .send({ userId: other.id })
      .expect(200);
    expect(response.body.data.purged).toEqual({
      activityEvents: 1,
      insights: 0,
      metricEvents: 0,
    });
    expect(
      await prisma.activityEvent.count({ where: { userId: other.id } }),
    ).toBe(1);
    expect(
      await prisma.activityEvent.count({ where: { userId: owner.id } }),
    ).toBe(0);
  });
});
