/**
 * Real local Postgres coverage for audit attribution column limits.
 * Synthetic fixtures only; runs against the disposable todos_test
 * database provisioned by the Jest global setup.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import {
  ActionRegistry,
  type ActionRuntime,
} from "./domains/agent/actions/actionRegistry";
import { registerAgentControlActions } from "./domains/agent/actions/agentControlActions";
import type { AgentExecutionContext } from "./domains/agent/actions/agentTypes";
import { AgentAuditService } from "./services/agentAuditService";
import { AgentJobRunService } from "./services/agentJobRunService";

const testDatabaseUrl =
  process.env.TEST_DATABASE_URL || process.env.DATABASE_URL_TEST;

describe("audit attribution against real Postgres column limits", () => {
  let db: PrismaClient;
  let userId: string;

  beforeAll(async () => {
    db = new PrismaClient({
      adapter: new PrismaPg({ connectionString: testDatabaseUrl! }),
    });
  });

  // The shared Jest setup wipes all users before each test, so the
  // synthetic fixture is recreated per test.
  beforeEach(async () => {
    const user = await db.user.create({
      data: { email: `audit-synthetic-${Date.now()}@example.test` },
    });
    userId = user.id;
  });

  afterEach(async () => {
    await db.user.deleteMany({ where: { id: userId } });
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  function auditData(actor: string) {
    return {
      surface: "agent",
      action: "create_task",
      readOnly: false,
      outcome: "success",
      status: 200,
      userId,
      requestId: "synthetic-request",
      actor,
    };
  }

  it("proves Postgres enforces the actor column limit", async () => {
    await expect(
      db.agentActionAudit.create({ data: auditData("x".repeat(300)) }),
    ).rejects.toThrow();
  });

  it("persists an oversized caller label in bounded form", async () => {
    const service = new AgentAuditService(db);
    await service.record({
      surface: "agent",
      action: "create_task",
      readOnly: false,
      outcome: "success",
      status: 200,
      userId,
      requestId: "synthetic-oversized",
      actor: `Mozilla/5.0 ${"y".repeat(5000)}`,
    });
    await new Promise((resolve) => setImmediate(resolve));

    const row = await db.agentActionAudit.findFirst({
      where: { userId, requestId: "synthetic-oversized" },
    });
    expect(row).not.toBeNull();
    expect(row!.actor).toHaveLength(255);
  });

  it("completes a job run and stores bounded distinct agent ids", async () => {
    const registry = new ActionRegistry();
    registerAgentControlActions(registry);
    const handler = registry.getRaw("complete_job_run")!;

    const runtime = {
      jobRunService: new AgentJobRunService(db),
      persistencePrisma: db,
      exec: {
        success: jest.fn((action, readOnly, context, status, data) => ({
          status,
          body: { ok: true, action, readOnly, data },
        })),
      },
    } as unknown as ActionRuntime;

    // Labels differ only after char 255 (the display bound): their
    // stored audit identities must still be distinct.
    const sharedPrefix = "shared-agent-prefix-".repeat(15);
    const agentIds: string[] = [];
    for (const [index, suffix] of ["alpha", "omega"].entries()) {
      const periodKey = `2026-04-1${index}`;
      await db.agentJobRun.create({
        data: {
          userId,
          jobName: "evaluator_daily",
          periodKey,
          status: "running",
        },
      });
      const context: AgentExecutionContext = {
        userId,
        requestId: `synthetic-job-${index}`,
        actor: `${sharedPrefix}${suffix}${"z".repeat(200)}`,
        surface: "agent",
      };
      const result = await handler(
        { jobName: "evaluator_daily", periodKey },
        context,
        runtime,
      );
      expect(result.status).toBe(200);

      const run = await db.agentJobRun.findUnique({
        where: {
          userId_jobName_periodKey: {
            userId,
            jobName: "evaluator_daily",
            periodKey,
          },
        },
      });
      expect(run?.status).toBe("completed");

      const audit = await db.agentActionAudit.findFirst({
        where: { userId, requestId: `synthetic-job-${index}` },
      });
      expect(audit).not.toBeNull();
      expect(audit!.actor.length).toBeLessThanOrEqual(255);
      expect(audit!.agentId).toHaveLength(20);
      agentIds.push(audit!.agentId!);
    }
    expect(agentIds[0]).not.toBe(agentIds[1]);
  });
});
