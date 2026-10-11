import express from "express";
import request from "supertest";
import { createPrioritiesBriefRouter } from "./routes/prioritiesBriefRouter";

const callLlmMock = jest.fn();

jest.mock("./services/llmService", () => {
  class TestLlmProviderNotConfiguredError extends Error {}
  return {
    callLlm: (...args: unknown[]) => callLlmMock(...args),
    LlmProviderNotConfiguredError: TestLlmProviderNotConfiguredError,
  };
});

function createTestApp(userId = "user-1") {
  const app = express();
  app.use(
    "/ai",
    createPrioritiesBriefRouter({
      todoService: {
        findAll: jest.fn().mockResolvedValue([
          {
            id: "todo-1",
            title: "Ship priorities tile",
            completed: false,
            category: "Work",
            dueDate: "2026-03-20T14:00:00.000Z",
            priority: "high",
          },
        ]),
      } as any,
      projectService: {
        findAll: jest.fn().mockResolvedValue([
          {
            id: "project-1",
            name: "Work",
            area: "ops",
            openTaskCount: 3,
          },
        ]),
      } as any,
      resolveUserId: () => userId,
    }),
  );
  return app;
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("prioritiesBriefRouter", () => {
  beforeEach(() => {
    callLlmMock.mockReset();
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("serves cached fresh content without regenerating", async () => {
    const app = createTestApp("user-fresh");
    callLlmMock.mockResolvedValue("<div>Fresh priorities</div>");

    const first = await request(app).get("/ai/priorities-brief").expect(200);
    expect(first.body).toMatchObject({
      html: "<div>Fresh priorities</div>",
      cached: false,
      isStale: false,
      refreshInFlight: false,
    });
    expect(first.body.generatedAt).toEqual(expect.any(String));
    expect(first.body.expiresAt).toEqual(expect.any(String));

    const second = await request(app).get("/ai/priorities-brief").expect(200);
    expect(second.body).toMatchObject({
      html: "<div>Fresh priorities</div>",
      cached: true,
      isStale: false,
      refreshInFlight: false,
    });
    expect(callLlmMock).toHaveBeenCalledTimes(1);
  });

  it("returns stale cached content while a background refresh is running", async () => {
    const app = createTestApp("user-stale");
    const refreshDeferred = createDeferred<string>();

    callLlmMock.mockResolvedValueOnce("<div>Cached priorities</div>");
    await request(app).get("/ai/priorities-brief").expect(200);

    callLlmMock.mockImplementationOnce(() => refreshDeferred.promise);
    const refreshRequest = request(app)
      .post("/ai/priorities-brief/refresh")
      .expect(200)
      .then((response) => response);
    await new Promise((resolve) => setImmediate(resolve));

    const stale = await request(app).get("/ai/priorities-brief").expect(200);
    expect(stale.body).toMatchObject({
      html: "<div>Cached priorities</div>",
      cached: true,
      isStale: true,
      refreshInFlight: true,
    });

    refreshDeferred.resolve("<div>Fresh priorities</div>");
    await refreshDeferred.promise;
    await refreshRequest;

    const fresh = await request(app).get("/ai/priorities-brief").expect(200);
    expect(fresh.body).toMatchObject({
      html: "<div>Fresh priorities</div>",
      cached: true,
      isStale: false,
      refreshInFlight: false,
    });
  });

  it("keeps serving stale cached content when a background refresh fails", async () => {
    const app = createTestApp("user-failed-refresh");

    callLlmMock.mockResolvedValueOnce("<div>Last good priorities</div>");
    await request(app).get("/ai/priorities-brief").expect(200);

    callLlmMock.mockRejectedValueOnce(new Error("llm down"));
    await request(app).post("/ai/priorities-brief/refresh").expect(500);
    await new Promise((resolve) => setImmediate(resolve));

    const retryDeferred = createDeferred<string>();
    callLlmMock.mockImplementationOnce(() => retryDeferred.promise);
    const stale = await request(app).get("/ai/priorities-brief").expect(200);
    expect(stale.body).toMatchObject({
      html: "<div>Last good priorities</div>",
      cached: true,
      isStale: true,
      refreshInFlight: true,
    });
    retryDeferred.resolve("<div>Recovered priorities</div>");
    await retryDeferred.promise;
    await new Promise((resolve) => setImmediate(resolve));
    const recovered = await request(app)
      .get("/ai/priorities-brief")
      .expect(200);
    expect(recovered.body).toMatchObject({
      html: "<div>Recovered priorities</div>",
      isStale: false,
      refreshInFlight: false,
    });
  });
});
