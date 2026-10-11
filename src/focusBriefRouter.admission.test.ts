import { Request, Response } from "express";
import { createFocusBriefRouter } from "./routes/focusBriefRouter";
import { AiProviderAdmissionError } from "./services/aiProviderAdmissionService";
import { LlmProviderNotConfiguredError } from "./services/llmService";

const callLlmMock = jest.fn();
jest.mock("./services/llmService", () => {
  class TestLlmProviderNotConfiguredError extends Error {}
  return {
    callLlm: (...args: unknown[]) => callLlmMock(...args),
    LlmProviderNotConfiguredError: TestLlmProviderNotConfiguredError,
  };
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

interface ResponseMock {
  statusCode: number;
  destroyed: boolean;
  writableEnded: boolean;
  body: any;
  headers: Record<string, string>;
  status: (statusCode: number) => ResponseMock;
  setHeader: (name: string, value: string) => ResponseMock;
  json: jest.Mock;
}

function responseMock(): ResponseMock {
  const response: ResponseMock = {
    statusCode: 200,
    destroyed: false,
    writableEnded: false,
    body: undefined,
    headers: {},
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
      return this;
    },
    json: jest.fn((body: unknown) => {
      response.body = body;
      response.writableEnded = true;
      return response;
    }),
  };
  return response;
}

function testHarness() {
  const findAll = jest.fn().mockResolvedValue([]);
  const router = createFocusBriefRouter({
    todoService: { findAll } as any,
    projectService: { findAll: jest.fn().mockResolvedValue([]) } as any,
    resolveUserId: (req) => (req as Request & { userId: string }).userId,
  });
  function begin(method: "get" | "post", userId = "user-a") {
    const path = method === "get" ? "/focus-brief" : "/focus-brief/refresh";
    const layer = router.stack.find(
      (layer: any) => layer.route?.path === path && layer.route.methods[method],
    );
    const route = layer?.route;
    if (!route) throw new Error("Expected brief route is missing");
    const response = responseMock();
    const completion = Promise.resolve(
      route.stack[0].handle(
        { userId } as unknown as Request,
        response as unknown as Response,
        jest.fn(),
      ),
    ).then(() => response);
    return { response, completion };
  }
  return { begin, findAll };
}

function output(marker: string): string {
  return JSON.stringify({
    rightNow: { narrative: marker, urgentItems: [], topRecommendation: null },
    whatNext: [],
    panelRanking: [],
  });
}
function marker(response: ResponseMock): string {
  return response.body.pinned.rightNow.narrative;
}
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("focusBriefRouter admission and coalescing", () => {
  let now: number;
  beforeEach(() => {
    now = 1_800_000_000_000;
    jest.spyOn(Date, "now").mockImplementation(() => now);
    jest.spyOn(console, "error").mockImplementation(() => {});
    callLlmMock.mockReset();
  });
  afterEach(() => jest.restoreAllMocks());

  it("coalesces concurrent cold requests and keeps the four-hour successful cache", async () => {
    const harness = testHarness();
    const provider = deferred<string>();
    callLlmMock.mockReturnValue(provider.promise);
    const requests = Array.from({ length: 12 }, () => harness.begin("get"));
    await flush();
    expect(callLlmMock).toHaveBeenCalledTimes(1);
    provider.resolve(output("shared"));
    const responses = await Promise.all(
      requests.map((request) => request.completion),
    );
    for (const response of responses) {
      expect(response.statusCode).toBe(200);
      expect(marker(response)).toBe("shared");
      expect(response.body).toMatchObject({ cached: false, isStale: false });
      expect(Date.parse(response.body.expiresAt) - now).toBe(
        4 * 60 * 60 * 1000,
      );
    }
    const cached = await harness.begin("get").completion;
    expect(cached.body).toMatchObject({ cached: true, isStale: false });
    expect(callLlmMock).toHaveBeenCalledTimes(1);
  });

  it("shares cold generation with an explicit refresh instead of starting another call", async () => {
    const harness = testHarness();
    const provider = deferred<string>();
    callLlmMock.mockReturnValue(provider.promise);
    const cold = harness.begin("get");
    const refresh = harness.begin("post");
    await flush();
    expect(callLlmMock).toHaveBeenCalledTimes(1);
    expect(refresh.response.json).not.toHaveBeenCalled();
    provider.resolve(output("cold"));
    await cold.completion;
    expect((await refresh.completion).body).toEqual({
      ok: true,
      refreshInFlight: false,
    });
  });

  it("returns stale content immediately and shares stale and forced refresh work", async () => {
    const harness = testHarness();
    callLlmMock.mockResolvedValueOnce(output("old"));
    await harness.begin("get").completion;
    now += 4 * 60 * 60 * 1000 + 1;
    const provider = deferred<string>();
    callLlmMock.mockReturnValue(provider.promise);
    const stale = await harness.begin("get").completion;
    expect(marker(stale)).toBe("old");
    expect(stale.body).toMatchObject({ cached: true, isStale: true });
    const refreshes = [harness.begin("post"), harness.begin("post")];
    const anotherStale = await harness.begin("get").completion;
    expect(marker(anotherStale)).toBe("old");
    await flush();
    expect(callLlmMock).toHaveBeenCalledTimes(2);
    expect(refreshes[0].response.json).not.toHaveBeenCalled();
    provider.resolve(output("new"));
    await Promise.all(refreshes.map((request) => request.completion));
    const fresh = await harness.begin("get").completion;
    expect(marker(fresh)).toBe("new");
    expect(fresh.body).toMatchObject({ cached: true, isStale: false });
    expect(callLlmMock).toHaveBeenCalledTimes(2);
  });

  it("isolates cached and in-flight work by authenticated user", async () => {
    const harness = testHarness();
    const firstProvider = deferred<string>();
    const secondProvider = deferred<string>();
    callLlmMock
      .mockReturnValueOnce(firstProvider.promise)
      .mockReturnValueOnce(secondProvider.promise);
    const first = harness.begin("get", "user-a");
    const second = harness.begin("get", "user-b");
    await flush();
    expect(callLlmMock).toHaveBeenCalledTimes(2);
    expect(harness.findAll).toHaveBeenCalledWith("user-a", {
      completed: false,
    });
    expect(harness.findAll).toHaveBeenCalledWith("user-b", {
      completed: false,
    });
    firstProvider.resolve(output("a"));
    secondProvider.resolve(output("b"));
    expect(marker(await first.completion)).toBe("a");
    expect(marker(await second.completion)).toBe("b");
    expect(marker(await harness.begin("get", "user-a").completion)).toBe("a");
    expect(marker(await harness.begin("get", "user-b").completion)).toBe("b");
    expect(callLlmMock).toHaveBeenCalledTimes(2);
  });

  it("does not let a disconnected waiter cancel another waiter's generation", async () => {
    const harness = testHarness();
    const provider = deferred<string>();
    callLlmMock.mockReturnValue(provider.promise);
    const disconnected = harness.begin("get");
    const connected = harness.begin("get");
    disconnected.response.destroyed = true;
    await flush();
    expect(callLlmMock).toHaveBeenCalledTimes(1);
    provider.resolve(output("connected"));
    await disconnected.completion;
    expect(disconnected.response.json).not.toHaveBeenCalled();
    expect(marker(await connected.completion)).toBe("connected");
    expect(marker(await harness.begin("get").completion)).toBe("connected");
  });

  it.each(["provider failure", "AbortError"])(
    "clears rejected shared work after %s",
    async (name) => {
      const harness = testHarness();
      const provider = deferred<string>();
      callLlmMock.mockReturnValue(provider.promise);
      const first = harness.begin("get");
      const second = harness.begin("get");
      await flush();
      const failure = new Error(name);
      failure.name = name;
      provider.reject(failure);
      expect((await first.completion).statusCode).toBe(500);
      expect((await second.completion).statusCode).toBe(500);
      expect(callLlmMock).toHaveBeenCalledTimes(1);
      callLlmMock.mockResolvedValue(output("retry"));
      expect(marker(await harness.begin("get").completion)).toBe("retry");
      expect(callLlmMock).toHaveBeenCalledTimes(2);
    },
  );

  it("returns a budget denial for forced refresh and suppresses attempts until its central retry time", async () => {
    const harness = testHarness();
    callLlmMock.mockResolvedValueOnce(output("last good"));
    await harness.begin("get").completion;
    const retryAt = new Date(now + 60_000).toISOString();
    const denial = new AiProviderAdmissionError({
      code: "AI_DAILY_LIMIT",
      statusCode: 429,
      message: "Daily provider allowance reached.",
      retryAt,
    });
    callLlmMock.mockRejectedValueOnce(denial);
    const denied = await harness.begin("post").completion;
    expect(denied.statusCode).toBe(429);
    expect(denied.body).toEqual({
      error: denial.message,
      code: denial.code,
      retryAt,
    });
    expect(denied.headers["retry-after"]).toBe("60");
    for (let index = 0; index < 3; index++) {
      const stale = await harness.begin("get").completion;
      expect(stale.statusCode).toBe(200);
      expect(marker(stale)).toBe("last good");
      expect(stale.body).toMatchObject({ cached: true, isStale: true });
    }
    expect((await harness.begin("post").completion).statusCode).toBe(429);
    expect(callLlmMock).toHaveBeenCalledTimes(2);
    now += 60_001;
    callLlmMock.mockResolvedValueOnce(output("after reset"));
    expect((await harness.begin("post").completion).statusCode).toBe(200);
    expect(marker(await harness.begin("get").completion)).toBe("after reset");
    expect(callLlmMock).toHaveBeenCalledTimes(3);
  });

  it.each([429, 503] as const)(
    "shares cold admission rejection with status %i",
    async (statusCode) => {
      const harness = testHarness();
      const provider = deferred<string>();
      callLlmMock.mockReturnValue(provider.promise);
      const first = harness.begin("get");
      const second = harness.begin("get");
      await flush();
      provider.reject(
        new AiProviderAdmissionError({
          code: "AI_ADMISSION_DENIED",
          statusCode,
          message: "Provider generation unavailable.",
          retryAt: new Date(now + 60_000).toISOString(),
        }),
      );
      expect((await first.completion).statusCode).toBe(statusCode);
      expect((await second.completion).statusCode).toBe(statusCode);
      expect((await harness.begin("get").completion).statusCode).toBe(
        statusCode,
      );
      expect(callLlmMock).toHaveBeenCalledTimes(1);
    },
  );

  it("does not invent a retry expiry when central admission omits retryAt", async () => {
    const harness = testHarness();
    callLlmMock.mockRejectedValueOnce(
      new AiProviderAdmissionError({
        code: "AI_CONCURRENCY_LIMIT",
        statusCode: 503,
        message: "Another provider operation is active.",
      }),
    );
    const denied = await harness.begin("get").completion;
    expect(denied.statusCode).toBe(503);
    expect(denied.headers).not.toHaveProperty("retry-after");
    callLlmMock.mockResolvedValueOnce(output("admitted later"));
    expect(marker(await harness.begin("get").completion)).toBe(
      "admitted later",
    );
    expect(callLlmMock).toHaveBeenCalledTimes(2);
  });

  it("does not let one user's budget denial block another user's generation", async () => {
    const harness = testHarness();
    callLlmMock.mockRejectedValueOnce(
      new AiProviderAdmissionError({
        code: "AI_DAILY_LIMIT",
        statusCode: 429,
        message: "Daily provider allowance reached.",
        retryAt: new Date(now + 60_000).toISOString(),
      }),
    );
    expect((await harness.begin("get", "user-a").completion).statusCode).toBe(
      429,
    );
    callLlmMock.mockResolvedValueOnce(output("user b"));
    expect(marker(await harness.begin("get", "user-b").completion)).toBe(
      "user b",
    );
    expect((await harness.begin("get", "user-a").completion).statusCode).toBe(
      429,
    );
    expect(callLlmMock).toHaveBeenCalledTimes(2);
  });

  it("keeps last-good content after a denied background refresh without hot retries", async () => {
    const harness = testHarness();
    callLlmMock.mockResolvedValueOnce(output("last good"));
    await harness.begin("get").completion;
    now += 4 * 60 * 60 * 1000 + 1;
    callLlmMock.mockRejectedValueOnce(
      new AiProviderAdmissionError({
        code: "AI_DAILY_LIMIT",
        statusCode: 429,
        message: "Daily provider allowance reached.",
        retryAt: new Date(now + 60_000).toISOString(),
      }),
    );
    const stale = await harness.begin("get").completion;
    expect(stale.statusCode).toBe(200);
    expect(marker(stale)).toBe("last good");
    await flush();
    const stillStale = await harness.begin("get").completion;
    expect(stillStale.statusCode).toBe(200);
    expect(marker(stillStale)).toBe("last good");

    expect((await harness.begin("post").completion).statusCode).toBe(429);
    expect(callLlmMock).toHaveBeenCalledTimes(2);
  });
  it("preserves provider-OFF 503 and does not generate for an empty refresh", async () => {
    const harness = testHarness();
    expect((await harness.begin("post").completion).body).toEqual({
      ok: true,
      refreshInFlight: false,
    });
    expect(callLlmMock).not.toHaveBeenCalled();
    callLlmMock.mockRejectedValueOnce(new LlmProviderNotConfiguredError());
    expect((await harness.begin("get").completion).statusCode).toBe(503);
    expect(callLlmMock).toHaveBeenCalledTimes(1);
  });
});
