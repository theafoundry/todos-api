import type { PrismaClient } from "@prisma/client";
import type { Request, Response as ExpressResponse } from "express";
import { config } from "../config";
import { errorHandler } from "../errorHandling";
import {
  AiProviderAdmissionError,
  type AiProviderAdmissionService,
} from "./aiProviderAdmissionService";
import {
  callAiProvider,
  calculateProviderCostMicros,
} from "./aiProviderClient";
import { runWithAiProviderContext } from "./aiProviderContext";
import { AiPlannerService } from "./aiService";
import { FeedbackTriageService } from "./feedbackTriageService";
import { callLlm } from "./llmService";

const original = { ...config };
const reservation = {
  id: "synthetic-reservation",
  userId: "verified-user",
  requestKey: "key",
  fingerprint: "hash",
  dayStart: new Date("2026-10-11T00:00:00Z"),
  status: "reserved",
  reservedCostMicros: 2300,
  chargedCostMicros: null,
};
const options = {
  operation: "test_call",
  systemPrompt: "Synthetic system",
  userPrompt: "Synthetic task",
};
const result = (
  content = "synthetic result",
  usage: unknown = { prompt_tokens: 7, completion_tokens: 2 },
) =>
  new Response(
    JSON.stringify({
      choices: [{ message: { content } }],
      ...(usage === undefined ? {} : { usage }),
    }),
  );

describe("One durable provider boundary", () => {
  let fetchSpy: jest.SpyInstance;
  let reserve: jest.Mock;
  let settle: jest.Mock;
  let admission: AiProviderAdmissionService;
  const call = (input = options) =>
    runWithAiProviderContext(
      { userId: "verified-user", source: "application" },
      () => callAiProvider(input),
      admission,
    );
  beforeEach(() => {
    Object.assign(config, {
      aiProviderEnabled: true,
      aiProviderApiKey: "synthetic-key-not-real",
      aiProviderModel: "synthetic-model",
      aiProviderBillingModel: "synthetic-model",
      aiProviderBaseUrl: "https://provider.invalid/v1",
      aiProviderBillingBaseUrl: "https://provider.invalid/v1",
      aiProviderInputTokenCeiling: 1000,
      aiProviderInputPriceMicrosPerMillionTokens: 2_000_000,
      aiProviderOutputPriceMicrosPerMillionTokens: 3_000_000,
      aiProviderMaxPromptBytes: 32768,
      aiProviderMaxOutputTokens: 100,
      aiProviderMaxResponseBytes: 131072,
      aiProviderTimeoutMs: 15000,
    });
    reserve = jest.fn().mockResolvedValue({ kind: "new", reservation });
    settle = jest
      .fn()
      .mockResolvedValue({ reservation, exceededReservation: false });
    admission = { reserve, settle } as unknown as AiProviderAdmissionService;
    fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue(result());
  });
  afterEach(() => {
    Object.assign(config, original);
    jest.restoreAllMocks();
  });

  test("reserves full verified context before fetching, then settles actual integer usage", async () => {
    const order: string[] = [];
    reserve.mockImplementation(async () => {
      order.push("reserve");
      return { kind: "new", reservation };
    });
    fetchSpy.mockImplementation(async () => {
      order.push("fetch");
      return result();
    });
    settle.mockImplementation(async () => {
      order.push("settle");
      return { exceededReservation: false };
    });
    expect(await call()).toBe("synthetic result");
    expect(order).toEqual(["reserve", "fetch", "settle"]);
    expect(reserve).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "verified-user",
        maxCostMicros: 2300,
        requestKey: expect.stringMatching(/^[a-f0-9]{64}$/),
        fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(settle).toHaveBeenCalledWith({
      reservationId: reservation.id,
      userId: "verified-user",
      outcome: "completed",
      actualCostMicros: 20,
      usageBoundBreached: false,
    });
    const request = fetchSpy.mock.calls[0][1];
    expect(request.redirect).toBe("error");
    expect(JSON.parse(request.body).max_tokens).toBe(100);
  });

  test.each([
    "disabled",
    "missing key",
    "missing identity",
    "missing dependency",
    "pricing",
    "model",
    "endpoint",
  ])("blocks %s before reserve or HTTP", async (reason) => {
    let invoke = call;
    if (reason === "disabled") config.aiProviderEnabled = false;
    if (reason === "missing key") config.aiProviderApiKey = "";
    if (reason === "pricing")
      config.aiProviderInputPriceMicrosPerMillionTokens = undefined;
    if (reason === "model") config.aiProviderBillingModel = "different-model";
    if (reason === "endpoint")
      config.aiProviderBillingBaseUrl = "https://different.invalid";
    if (reason === "missing identity")
      invoke = (input = options) => callAiProvider(input);
    if (reason === "missing dependency")
      invoke = (input = options) =>
        runWithAiProviderContext(
          { userId: "verified-user", source: "application" },
          () => callAiProvider(input),
        );
    await expect(invoke()).rejects.toThrow();
    expect(reserve).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test.each([429, 503] as const)(
    "propagates central %s denial with no HTTP",
    async (statusCode) => {
      const error = new AiProviderAdmissionError({
        code: "CENTRAL_DENIED",
        statusCode,
        message: "Synthetic denial",
      });
      reserve.mockRejectedValue(error);
      await expect(call()).rejects.toBe(error);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(settle).not.toHaveBeenCalled();
    },
  );
  test("replay never dispatches or resettles", async () => {
    reserve.mockResolvedValue({ kind: "replay", reservation });
    await expect(call()).rejects.toMatchObject({
      code: "AI_PROVIDER_REQUEST_ALREADY_ADMITTED",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(settle).not.toHaveBeenCalled();
  });
  test("a preaborted request consumes no admission", async () => {
    const controller = new AbortController();
    controller.abort(new Error("Synthetic cancel"));
    await expect(
      call({ ...options, signal: controller.signal } as typeof options),
    ).rejects.toThrow("Synthetic cancel");
    expect(reserve).not.toHaveBeenCalled();
  });
  test("switching OFF during admission prevents dispatch and records zero cost", async () => {
    reserve.mockImplementation(async () => {
      config.aiProviderEnabled = false;
      return { kind: "new", reservation };
    });
    await expect(call()).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(settle).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "completed", actualCostMicros: 0 }),
    );
  });
  test("bounds the prompt before admission and never expands an output cap", async () => {
    await call({ ...options, maxTokens: 1000 } as typeof options);
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body).max_tokens).toBe(100);
    config.aiProviderMaxPromptBytes = 5;
    await expect(call()).rejects.toMatchObject({
      code: "AI_PROVIDER_INPUT_BOUND",
    });
    expect(reserve).toHaveBeenCalledTimes(1);
  });
  test.each([0, -1, 1.5, NaN])(
    "rejects invalid output bound %p",
    async (maxTokens) => {
      await expect(
        call({ ...options, maxTokens } as typeof options),
      ).rejects.toMatchObject({ code: "AI_PROVIDER_INVALID_REQUEST" });
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );
  test("complete missing usage charges its reservation and frees concurrency", async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
      ),
    );
    expect(await call()).toBe("ok");
    expect(settle).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "completed",
        actualCostMicros: undefined,
      }),
    );
  });
  test.each([
    { prompt_tokens: -1, completion_tokens: 1 },
    { prompt_tokens: 1.5, completion_tokens: 1 },
    { prompt_tokens: 1001, completion_tokens: 1 },
    { prompt_tokens: 1, completion_tokens: 101 },
    null,
    {},
  ])("latches invalid or exceeded provider usage %p", async (usage) => {
    fetchSpy.mockResolvedValue(result("ok", usage));
    await expect(call()).rejects.toMatchObject({
      code: "AI_PROVIDER_USAGE_BOUND_BREACHED",
    });
    expect(settle).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "completed",
        usageBoundBreached: true,
      }),
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
  test.each(["http", "json", "empty"])(
    "a terminal %s failure charges maximum without retry",
    async (failure) => {
      fetchSpy.mockResolvedValue(
        failure === "http"
          ? new Response("private provider body", { status: 500 })
          : failure === "json"
            ? new Response("invalid JSON")
            : result(""),
      );
      await expect(call()).rejects.toThrow();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(settle).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: "completed" }),
      );
    },
  );
  test.each(["network", "partial", "oversize", "deadline", "cancel"])(
    "holds the uncertain %s attempt without retry",
    async (failure) => {
      const controller = new AbortController();
      if (failure === "network")
        fetchSpy.mockRejectedValue(new Error("Synthetic network failure"));
      if (failure === "partial")
        fetchSpy.mockResolvedValue(
          new Response(
            new ReadableStream({
              start(stream) {
                stream.enqueue(new Uint8Array([1]));
                stream.error(new Error("Synthetic body failure"));
              },
            }),
          ),
        );
      if (failure === "oversize") {
        config.aiProviderMaxResponseBytes = 5;
        fetchSpy.mockResolvedValue(result());
      }
      if (failure === "deadline" || failure === "cancel") {
        config.aiProviderTimeoutMs = 5;
        fetchSpy.mockImplementation(
          (_url, init) =>
            new Promise((_resolve, reject) => {
              init.signal.addEventListener(
                "abort",
                () => reject(init.signal.reason),
                { once: true },
              );
              if (failure === "cancel")
                controller.abort(new Error("Synthetic caller cancellation"));
            }),
        );
      }
      await expect(
        call({ ...options, signal: controller.signal } as typeof options),
      ).rejects.toThrow();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(settle).toHaveBeenCalledWith(
        expect.objectContaining({
          outcome: "uncertain",
          actualCostMicros: undefined,
        }),
      );
    },
  );
  test("failed settlement prevents returning output and no refund/retry is attempted", async () => {
    settle.mockRejectedValue(new Error("Synthetic database loss"));
    await expect(call()).rejects.toThrow("Synthetic database loss");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(settle).toHaveBeenCalledTimes(1);
  });
  test("a durable cost breach remains an error after the ledger committed it", async () => {
    settle.mockResolvedValue({ exceededReservation: true });
    await expect(call()).rejects.toMatchObject({
      code: "AI_PROVIDER_COST_BOUND_BREACHED",
    });
  });
  test("text, planner JSON, and feedback JSON all use this boundary", async () => {
    const planner = new AiPlannerService();
    const prisma = {
      feedbackRequest: {
        findUnique: jest.fn().mockResolvedValue({
          id: "feedback",
          userId: "feedback-owner",
          type: "bug",
          title: "Task crashes",
          body: "Save crashes",
          screenshotUrl: null,
          pageUrl: null,
          userAgent: null,
          appVersion: null,
          triageSummary: null,
          dedupeKey: null,
        }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const failure = {
      record: jest.fn().mockResolvedValue({}),
      resolveOpenForFeedback: jest.fn(),
    };
    const triage = new FeedbackTriageService(
      prisma as unknown as PrismaClient,
      { feedbackFailureService: failure as never },
    );
    fetchSpy.mockImplementation(async () => result("{}"));
    await runWithAiProviderContext(
      { userId: "verified-user", source: "admin" },
      async () => {
        await callLlm(options);
        await planner.critiqueTask({ title: "Synthetic task" });
        await triage.triageFeedback("feedback");
      },
      admission,
    );
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(reserve).toHaveBeenCalledTimes(3);
    expect(
      new Set(reserve.mock.calls.map(([input]) => input.requestKey)).size,
    ).toBe(3);
    expect(
      reserve.mock.calls.every(([input]) => input.userId === "verified-user"),
    ).toBe(true);
    for (const [, request] of fetchSpy.mock.calls)
      expect(JSON.parse(request.body).max_tokens).toBe(100);
    expect(JSON.parse(fetchSpy.mock.calls[1][1].body).response_format).toEqual({
      type: "json_object",
    });
  });
  test("central HTTP denial returns typed status and authoritative retry time without logging", () => {
    const retryAt = new Date(Date.now() + 60_000).toISOString();
    const response = {
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const log = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    errorHandler(
      new AiProviderAdmissionError({
        code: "AI_PROVIDER_DAILY_LIMIT",
        statusCode: 429,
        message: "Limit reached",
        retryAt,
      }),
      {} as Request,
      response as unknown as ExpressResponse,
      jest.fn(),
    );
    expect(response.status).toHaveBeenCalledWith(429);
    expect(response.setHeader).toHaveBeenCalledWith(
      "Retry-After",
      expect.stringMatching(/^60$/),
    );
    expect(response.json).toHaveBeenCalledWith({
      code: "AI_PROVIDER_DAILY_LIMIT",
      error: "Limit reached",
      retryAt,
    });
    expect(log).not.toHaveBeenCalled();
  });
});

describe("Integer token cost accounting", () => {
  test("ceil rounding and exact zero", () => {
    expect(calculateProviderCostMicros(1, 0, 1, 0)).toBe(1);
    expect(calculateProviderCostMicros(0, 0, 2_000_000, 3_000_000)).toBe(0);
    expect(calculateProviderCostMicros(7, 2, 2_000_000, 3_000_000)).toBe(20);
  });
  test.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid token counts %p",
    (value) => {
      expect(() => calculateProviderCostMicros(value, 0, 1, 1)).toThrow();
    },
  );
  test("rejects arithmetic overflow rather than silently undercharging", () => {
    expect(() =>
      calculateProviderCostMicros(
        Number.MAX_SAFE_INTEGER,
        Number.MAX_SAFE_INTEGER,
        Number.MAX_SAFE_INTEGER,
        Number.MAX_SAFE_INTEGER,
      ),
    ).toThrow();
  });
});
