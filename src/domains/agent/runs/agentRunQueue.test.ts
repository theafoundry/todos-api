import type { AgentExecutor } from "../../../agent/agentExecutor";
import type { AgentJobRunService } from "../../../services/agentJobRunService";
import type { AiProviderAdmissionService } from "../../../services/aiProviderAdmissionService";
import {
  getAiProviderAdmission,
  getAiProviderContext,
  nextAiProviderAdmissionKey,
  runWithAiProviderContext,
} from "../../../services/aiProviderContext";
import { createAgentRunQueue, type EnqueuedRun } from "./agentRunQueue";

const admissionA = { name: "app-a" } as unknown as AiProviderAdmissionService;
const admissionB = { name: "app-b" } as unknown as AiProviderAdmissionService;

function fixture() {
  let finish!: () => void;
  const completed = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const observations: Array<{
    userId?: string;
    source?: string;
    requestKey?: string;
    admission?: AiProviderAdmissionService;
    admissionKey?: string;
  }> = [];
  const execute = jest.fn().mockImplementation(async () => {
    await Promise.resolve();
    const context = getAiProviderContext();
    observations.push({
      ...context,
      admission: getAiProviderAdmission(),
      admissionKey: context
        ? nextAiProviderAdmissionKey("planner.plan_today")
        : undefined,
    });
    return { status: 200, body: { ok: true } };
  });
  const completionContexts: Array<string | undefined> = [];
  const completeRun = jest.fn().mockImplementation(async () => {
    completionContexts.push(getAiProviderContext()?.userId);
    finish();
  });
  const failRun = jest.fn().mockImplementation(async () => {
    completionContexts.push(getAiProviderContext()?.userId);
    finish();
  });
  const queue = createAgentRunQueue({
    agentExecutor: { execute } as unknown as AgentExecutor,
    jobRunService: {
      completeRun,
      failRun,
    } as unknown as AgentJobRunService,
  });
  return {
    queue,
    execute,
    completeRun,
    failRun,
    observations,
    completionContexts,
    completed,
  };
}

function run(userId = "account-a"): EnqueuedRun {
  return {
    runId: "server-run",
    userId,
    action: "plan_today",
    params: { date: "2026-10-11" },
    requestId: "caller-owned-id",
    actor: "caller-owned-label",
  };
}

describe("Deferred agent provider attribution", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test("retains the authenticated actor/service when dispatched inside another request", async () => {
    const worker = fixture();
    const original = runWithAiProviderContext(
      { userId: "account-a", source: "agent" },
      () => {
        worker.queue.enqueue(run());
        return getAiProviderContext();
      },
      admissionA,
    );
    runWithAiProviderContext(
      { userId: "account-b", source: "application" },
      () => jest.runOnlyPendingTimers(),
      admissionB,
    );
    await worker.completed;
    expect(worker.observations).toEqual([
      {
        ...original,
        admission: admissionA,
        admissionKey: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    ]);
    expect(worker.completionContexts).toEqual(["account-a"]);
    expect(worker.completeRun).toHaveBeenCalledWith(
      "account-a",
      "plan_today",
      "server-run",
      expect.objectContaining({ result: { ok: true } }),
    );
    expect(getAiProviderContext()).toBeUndefined();
  });

  test("two interleaved workers never exchange actors or application services", async () => {
    const first = fixture();
    const second = fixture();
    runWithAiProviderContext(
      { userId: "account-a", source: "agent" },
      () => first.queue.enqueue(run("account-a")),
      admissionA,
    );
    runWithAiProviderContext(
      { userId: "account-b", source: "agent" },
      () => second.queue.enqueue(run("account-b")),
      admissionB,
    );
    jest.runOnlyPendingTimers();
    await Promise.all([first.completed, second.completed]);
    expect(first.observations[0].userId).toBe("account-a");
    expect(first.observations[0].admission).toBe(admissionA);
    expect(second.observations[0].userId).toBe("account-b");
    expect(second.observations[0].admission).toBe(admissionB);
    expect(first.observations[0].admissionKey).not.toBe(
      second.observations[0].admissionKey,
    );
  });

  test("rejects a queue actor mismatch before scheduling", () => {
    const worker = fixture();
    runWithAiProviderContext(
      { userId: "account-a", source: "agent" },
      () => {
        expect(() => worker.queue.enqueue(run("account-b"))).toThrow(
          "Agent run account does not match authenticated context",
        );
      },
      admissionA,
    );
    expect(jest.getTimerCount()).toBe(0);
    expect(worker.execute).not.toHaveBeenCalled();
  });

  test("unattributed local work cannot borrow the actor dispatching the timer", async () => {
    const worker = fixture();
    worker.queue.enqueue(run("default-user"));
    runWithAiProviderContext(
      { userId: "account-b", source: "application" },
      () => jest.runOnlyPendingTimers(),
      admissionB,
    );
    await worker.completed;
    expect(worker.observations).toEqual([
      { admission: undefined, admissionKey: undefined },
    ]);
    expect(worker.completionContexts).toEqual([undefined]);
  });

  test("captures actor/action metadata before a mutable input changes", async () => {
    const worker = fixture();
    const queued = run();
    runWithAiProviderContext(
      { userId: "account-a", source: "agent" },
      () => worker.queue.enqueue(queued),
      admissionA,
    );
    queued.userId = "account-b";
    queued.action = "other_action";
    queued.runId = "other-run";
    queued.actor = "other-actor";
    queued.params.date = "2099-01-01";
    jest.runOnlyPendingTimers();
    await worker.completed;
    expect(worker.execute).toHaveBeenCalledWith(
      "plan_today",
      { date: "2026-10-11" },
      expect.objectContaining({
        userId: "account-a",
        actor: "caller-owned-label",
      }),
    );
    expect(worker.completeRun.mock.calls[0].slice(0, 3)).toEqual([
      "account-a",
      "plan_today",
      "server-run",
    ]);
  });

  test("uses the same ordinal allocator for request and deferred provider dispatches", async () => {
    const worker = fixture();
    const keys: string[] = [];
    runWithAiProviderContext(
      { userId: "account-a", source: "agent" },
      () => {
        keys.push(nextAiProviderAdmissionKey("planner.plan_today"));
        worker.queue.enqueue(run());
        keys.push(nextAiProviderAdmissionKey("planner.plan_today"));
      },
      admissionA,
    );
    jest.runOnlyPendingTimers();
    await worker.completed;
    keys.push(worker.observations[0].admissionKey!);
    expect(new Set(keys).size).toBe(3);
  });

  test("failed work records the original actor after async rejection", async () => {
    const worker = fixture();
    worker.execute.mockImplementation(async () => {
      await Promise.resolve();
      throw new Error("synthetic provider denial");
    });
    runWithAiProviderContext(
      { userId: "account-a", source: "agent" },
      () => worker.queue.enqueue(run()),
      admissionA,
    );
    jest.runOnlyPendingTimers();
    await worker.completed;
    expect(worker.failRun).toHaveBeenCalledWith(
      "account-a",
      "plan_today",
      "server-run",
      "synthetic provider denial",
    );
    expect(worker.completionContexts).toEqual(["account-a"]);
  });
});
