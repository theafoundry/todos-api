import { registerAgentControlActions } from "./agentControlActions";
import { ActionRegistry, type ActionRuntime } from "./actionRegistry";
import type { AgentExecutionContext } from "./agentTypes";

function createRuntime(overrides: Partial<ActionRuntime> = {}): ActionRuntime {
  return {
    agentService: {} as ActionRuntime["agentService"],
    jobRunService: {
      claimRun: jest.fn(),
      completeRun: jest.fn(),
      failRun: jest.fn(),
      getRunStatus: jest.fn(),
      replayRun: jest.fn(),
      listRuns: jest.fn(),
    } as unknown as ActionRuntime["jobRunService"],
    metricsService: {} as ActionRuntime["metricsService"],
    feedbackService: {} as ActionRuntime["feedbackService"],
    dayContextService: {} as ActionRuntime["dayContextService"],
    agentConfigService: {} as ActionRuntime["agentConfigService"],
    failedActionService: {} as ActionRuntime["failedActionService"],
    executiveSummaryService: {} as ActionRuntime["executiveSummaryService"],
    evaluationService: {} as ActionRuntime["evaluationService"],
    learningRecommendationService:
      {} as ActionRuntime["learningRecommendationService"],
    frictionService: {} as ActionRuntime["frictionService"],
    actionPolicyService: {} as ActionRuntime["actionPolicyService"],
    captureService: null,
    projectService: undefined,
    persistencePrisma: {
      agentActionAudit: {
        create: jest.fn().mockResolvedValue({}),
      },
    } as unknown as ActionRuntime["persistencePrisma"],
    exec: {
      handleIdempotent: jest.fn(),
      buildDryRunResult: jest.fn(),
      success: jest.fn((action, readOnly, context, status, data) => ({
        status,
        body: {
          ok: true,
          action,
          readOnly,
          data,
          trace: {
            requestId: context.requestId,
          },
        },
      })),
    },
    ...overrides,
  };
}

describe("registerAgentControlActions", () => {
  const context: AgentExecutionContext = {
    userId: "user-1",
    requestId: "req-1",
    actor: "orla",
    surface: "agent",
  };

  it("records a narration entry when a job run completes", async () => {
    const registry = new ActionRegistry();
    registerAgentControlActions(registry);

    const runtime = createRuntime();
    const completeRun = jest
      .spyOn(runtime.jobRunService, "completeRun")
      .mockResolvedValue(true);

    const handler = registry.getRaw("complete_job_run");

    expect(handler).toBeDefined();

    const result = await handler!(
      {
        jobName: "evaluator_daily",
        periodKey: "2026-04-10",
        metadata: {
          acceptanceRate: 0.8,
          learningRecordingCount: 2,
          autoAppliedCount: 1,
        },
      },
      context,
      runtime,
    );

    expect(completeRun).toHaveBeenCalledWith(
      "user-1",
      "evaluator_daily",
      "2026-04-10",
      {
        acceptanceRate: 0.8,
        learningRecordingCount: 2,
        autoAppliedCount: 1,
      },
    );
    expect(
      runtime.persistencePrisma?.agentActionAudit.create,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "record_job_narration",
          agentId: "orla",
          jobName: "evaluator_daily",
          jobPeriodKey: "2026-04-10",
          narration:
            "evaluator_daily completed successfully. acceptance rate: 0.8 · learning recording count: 2 · auto applied count: 1.",
        }),
      }),
    );
    expect(result.status).toBe(200);
  });

  it("records a failure narration when a job run fails", async () => {
    const registry = new ActionRegistry();
    registerAgentControlActions(registry);

    const runtime = createRuntime();
    const failRun = jest
      .spyOn(runtime.jobRunService, "failRun")
      .mockResolvedValue(true);

    const handler = registry.getRaw("fail_job_run");

    expect(handler).toBeDefined();

    await handler!(
      {
        jobName: "morning_brief",
        periodKey: "2026-04-11",
        errorMessage: "Calendar access expired",
      },
      context,
      runtime,
    );

    expect(failRun).toHaveBeenCalledWith(
      "user-1",
      "morning_brief",
      "2026-04-11",
      "Calendar access expired",
    );
    expect(
      runtime.persistencePrisma?.agentActionAudit.create,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          jobName: "morning_brief",
          narration:
            "Morning brief could not be generated: Calendar access expired",
          metadata: {
            errorMessage: "Calendar access expired",
          },
        }),
      }),
    );
  });

  it("returns success when narration audit fails after job completion commits", async () => {
    const registry = new ActionRegistry();
    registerAgentControlActions(registry);

    const auditError = new Error("audit storage unavailable");
    const runtime = createRuntime({
      persistencePrisma: {
        agentActionAudit: { create: jest.fn().mockRejectedValue(auditError) },
      } as unknown as ActionRuntime["persistencePrisma"],
    });
    jest.spyOn(runtime.jobRunService, "completeRun").mockResolvedValue(true);
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    const handler = registry.getRaw("complete_job_run");
    const input = { jobName: "evaluator_daily", periodKey: "2026-04-10" };

    const result = await handler!(input, context, runtime);
    expect(result.status).toBe(200);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("job narration audit"),
      expect.objectContaining({ jobName: "evaluator_daily" }),
    );

    // Retry after the committed state change stays a success, not a
    // misleading failure caused by the earlier audit error.
    const retry = await handler!(input, context, runtime);
    expect(retry.status).toBe(200);
    errorSpy.mockRestore();
  });

  it("returns success when narration audit fails after job failure commits", async () => {
    const registry = new ActionRegistry();
    registerAgentControlActions(registry);

    const runtime = createRuntime({
      persistencePrisma: {
        agentActionAudit: {
          create: jest.fn().mockRejectedValue(new Error("audit down")),
        },
      } as unknown as ActionRuntime["persistencePrisma"],
    });
    jest.spyOn(runtime.jobRunService, "failRun").mockResolvedValue(true);
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    const handler = registry.getRaw("fail_job_run");
    const result = await handler!(
      {
        jobName: "morning_brief",
        periodKey: "2026-04-11",
        errorMessage: "Calendar access expired",
      },
      context,
      runtime,
    );

    expect(result.status).toBe(200);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("keeps distinct audit identities for labels differing only after char 255 (request path)", async () => {
    const { getAgentRequestContext } =
      await import("../../../agent/agentContext");
    type FakeReq = Parameters<typeof getAgentRequestContext>[0];
    const registry = new ActionRegistry();
    registerAgentControlActions(registry);
    const handler = registry.getRaw("complete_job_run")!;

    // Labels share their first 300 characters; they differ only after
    // the 255-character display bound.
    const shared = `agent-${"s".repeat(294)}`;
    const agentIds: string[] = [];
    for (const tail of ["alpha", "omega"]) {
      const runtime = createRuntime();
      jest.spyOn(runtime.jobRunService, "completeRun").mockResolvedValue(true);
      const req = {
        header: (name: string) =>
          name.toLowerCase() === "x-agent-name"
            ? `${shared}-${tail}`
            : undefined,
      } as unknown as FakeReq;
      const requestContext = getAgentRequestContext(req);
      // Mirror routes/agentRouter buildExecutionContext.
      const requestDerivedContext = {
        userId: "user-1",
        requestId: requestContext.requestId,
        actor: requestContext.actor,
        agentId: (requestContext as { agentId?: string }).agentId,
        surface: "agent" as const,
      };
      await handler(
        { jobName: "evaluator_daily", periodKey: "2026-04-10" },
        requestDerivedContext,
        runtime,
      );
      const create = runtime.persistencePrisma?.agentActionAudit
        .create as jest.Mock;
      const data = create.mock.calls[0][0].data;
      expect(data.actor).toHaveLength(255);
      agentIds.push(data.agentId);
    }
    expect(agentIds[0]).toHaveLength(20);
    expect(agentIds[0]).not.toBe(agentIds[1]);
  });

  it("stores a bounded actor and stable agent id for long caller labels", async () => {
    const registry = new ActionRegistry();
    registerAgentControlActions(registry);

    const runtime = createRuntime();
    jest.spyOn(runtime.jobRunService, "completeRun").mockResolvedValue(true);

    const longActor = `Mozilla/5.0 ${"q".repeat(300)}`;
    const handler = registry.getRaw("complete_job_run");
    await handler!(
      { jobName: "evaluator_daily", periodKey: "2026-04-10" },
      { ...context, actor: longActor },
      runtime,
    );

    const create = runtime.persistencePrisma?.agentActionAudit
      .create as jest.Mock;
    const data = create.mock.calls[0][0].data;
    expect(data.actor).toHaveLength(255);
    expect(data.agentId).toHaveLength(20);
  });

  it("rejects an oversized narration before writing any audit row", async () => {
    const registry = new ActionRegistry();
    registerAgentControlActions(registry);

    const runtime = createRuntime();
    const handler = registry.getRaw("record_job_narration");

    await expect(
      handler!(
        {
          jobName: "evaluator_daily",
          periodKey: "2026-04-10",
          narration: "n".repeat(501),
        },
        context,
        runtime,
      ),
    ).rejects.toMatchObject({ status: 400, code: "INVALID_INPUT" });
    expect(
      runtime.persistencePrisma?.agentActionAudit.create,
    ).not.toHaveBeenCalled();
  });

  it("does not record a feed narration for internal non-actionable job failures", async () => {
    const registry = new ActionRegistry();
    registerAgentControlActions(registry);

    const runtime = createRuntime();
    const failRun = jest
      .spyOn(runtime.jobRunService, "failRun")
      .mockResolvedValue(true);

    const handler = registry.getRaw("fail_job_run");

    expect(handler).toBeDefined();

    await handler!(
      {
        jobName: "evaluator_daily",
        periodKey: "2026-04-11",
        errorMessage: "Timeout while fetching agenda context",
      },
      context,
      runtime,
    );

    expect(failRun).toHaveBeenCalledWith(
      "user-1",
      "evaluator_daily",
      "2026-04-11",
      "Timeout while fetching agenda context",
    );
    expect(
      runtime.persistencePrisma?.agentActionAudit.create,
    ).not.toHaveBeenCalled();
  });
});
