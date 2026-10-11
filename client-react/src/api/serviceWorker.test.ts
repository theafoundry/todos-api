import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const workerSource = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../public/sw.js"),
  "utf8",
);
const ORIGIN = "https://planwren.test";
const CURRENT_CACHE = "todos-react-fold-v2";
const legacyMutation = {
  url: ORIGIN + "/capture/task-drafts",
  method: "POST",
  body: '{"title":"Private account A draft"}',
  authHeader: "Bearer synthetic-account-a",
  timestamp: Date.now(),
};

interface WorkerEvent {
  request?: Request;
  tag?: string;
  data?: string;
  respondWith?: (response: Promise<Response>) => void;
  waitUntil?: (completion: Promise<unknown>) => void;
}

function createWorker(existingDatabase = true) {
  const listeners = new Map<string, (event: WorkerEvent) => void>();
  const records = [{ ...legacyMutation }];
  const fetch = vi.fn<typeof globalThis.fetch>();
  const claim = vi.fn().mockResolvedValue(undefined);
  const close = vi.fn();
  const abort = vi.fn();
  const clear = vi.fn(() => records.splice(0));
  const transaction = vi.fn(() => {
    const tx = {
      oncomplete: undefined as (() => void) | undefined,
      objectStore: vi.fn(() => ({ clear })),
    };
    queueMicrotask(() => tx.oncomplete?.());
    return tx;
  });
  const openDB = vi.fn(() => {
    const request = {
      result: {
        transaction,
        close,
        objectStoreNames: { contains: () => true },
      },
      transaction: { abort },
      onsuccess: undefined as (() => void) | undefined,
      onerror: undefined as (() => void) | undefined,
      onupgradeneeded: undefined as (() => void) | undefined,
    };
    queueMicrotask(() => {
      if (existingDatabase) {
        request.onsuccess?.();
      } else {
        request.onupgradeneeded?.();
        request.onerror?.();
      }
    });
    return request;
  });
  const stored = new Map<string, Map<string, Response>>();
  const addAll = vi.fn().mockResolvedValue(undefined);
  const put = vi.fn(async (key: string, response: Response) => {
    stored.get(CURRENT_CACHE)!.set(key, response);
  });
  const match = vi.fn(async (key: string) =>
    stored.get(CURRENT_CACHE)?.get(key),
  );
  const openCache = vi.fn(async (name: string) => {
    if (!stored.has(name)) stored.set(name, new Map());
    return { addAll, put, match };
  });
  const deleteCache = vi.fn(async (name: string) => stored.delete(name));

  // Execute the shipped worker, including fetch, lifecycle and legacy handlers.
  runInNewContext(workerSource, {
    self: {
      location: { origin: ORIGIN },
      clients: { claim },
      skipWaiting: vi.fn(),
      addEventListener: (
        type: string,
        listener: (event: WorkerEvent) => void,
      ) => listeners.set(type, listener),
    },
    URL,
    Response,
    fetch,
    indexedDB: { open: openDB },
    caches: {
      open: openCache,
      keys: async () => [...stored.keys()],
      delete: deleteCache,
    },
  });

  const intercept = (request: Request) => {
    let response: Promise<Response> | undefined;
    listeners.get("fetch")!({
      request,
      respondWith: (promise) => {
        response = promise;
      },
    });
    return response;
  };
  const dispatch = (
    type: "install" | "activate" | "sync" | "message",
    data?: string,
  ) => {
    let completion: Promise<unknown> | undefined;
    listeners.get(type)!({
      ...(type === "sync" ? { tag: data } : { data }),
      waitUntil: (promise) => {
        completion = promise;
      },
    });
    return completion;
  };

  return {
    fetch,
    openDB,
    records,
    clear,
    close,
    abort,
    claim,
    stored,
    put,
    match,
    openCache,
    deleteCache,
    addAll,
    intercept,
    dispatch,
  };
}

describe("service worker private request boundary", () => {
  it.each(["POST", "PUT", "PATCH", "DELETE"])(
    "lets ordinary and manual %s failures reach the caller without storage or a false receipt",
    async (method) => {
      for (const manual of [false, true]) {
        const worker = createWorker();
        const request = new Request(ORIGIN + "/todos/task-1", {
          method,
          headers: {
            Authorization: "Bearer synthetic-account-a",
            ...(manual ? { "X-Planwren-Offline-Mode": "manual" } : {}),
          },
          body: '{"title":"Keep the draft"}',
        });
        const failure = new TypeError("Failed to fetch");
        worker.fetch.mockRejectedValue(failure);

        expect(worker.intercept(request)).toBeUndefined();
        // A non-intercepted request goes directly to the browser's network.
        await expect(worker.fetch(request)).rejects.toBe(failure);
        expect(worker.openDB).not.toHaveBeenCalled();
        expect(worker.openCache).not.toHaveBeenCalled();
        expect(worker.records).toEqual([legacyMutation]);
      }
    },
  );

  it.each([
    "/todos",
    "/users/me",
    "/auth/mcp/sessions",
    "/capture/task-drafts",
    "/adaptation/snapshot",
    "/planning/today",
    "/calendar/events",
    "/ai/focus-brief",
    "/mcp/app",
    "/api/sync",
    "/future-api/private.png",
    "/app/unknown-api",
    "/app/?authorization=synthetic-value",
  ])(
    "never caches private or unknown GET %s with or without a bearer",
    (path) => {
      for (const authorized of [false, true]) {
        const worker = createWorker();
        const request = new Request(ORIGIN + path, {
          headers: authorized
            ? { Authorization: "Bearer synthetic-account-a" }
            : {},
        });
        expect(worker.intercept(request)).toBeUndefined();
        expect(worker.fetch).not.toHaveBeenCalled();
        expect(worker.openCache).not.toHaveBeenCalled();
        expect(worker.openDB).not.toHaveBeenCalled();
      }
    },
  );

  it.each(["/app/", "/app/assets/index-Ab12.js", "/app/icon-192.png"])(
    "does not cache an authorized request even at public path %s",
    (path) => {
      const worker = createWorker();
      expect(
        worker.intercept(
          new Request(ORIGIN + path, {
            headers: { Authorization: "Bearer synthetic-account-b" },
          }),
        ),
      ).toBeUndefined();
      expect(worker.openCache).not.toHaveBeenCalled();
    },
  );

  it("leaves public-looking cross-origin requests to the browser", () => {
    const worker = createWorker();
    expect(
      worker.intercept(new Request("https://other.test/app/icon-192.png")),
    ).toBeUndefined();
    expect(worker.fetch).not.toHaveBeenCalled();
  });
});

describe("service worker public static cache", () => {
  it("pre-caches the canonical app shell", async () => {
    const worker = createWorker();
    await worker.dispatch("install");
    expect(worker.addAll).toHaveBeenCalledWith(["/app/"]);
  });

  it.each([
    "/app/",
    "/app/assets/index-Ab12.js",
    "/app/icon-192.png?v=fold-v1",
  ])(
    "caches public file %s and serves that same file offline",
    async (path) => {
      const worker = createWorker();
      const request = new Request(ORIGIN + path);
      const response = new Response("public file", {
        headers: { Vary: "Accept-Encoding" },
      });
      worker.fetch.mockResolvedValueOnce(response);
      await expect(worker.intercept(request)).resolves.toBe(response);

      const key = ORIGIN + new URL(request.url).pathname;
      expect(worker.put).toHaveBeenCalledWith(key, expect.any(Response));
      worker.fetch.mockRejectedValueOnce(new TypeError("Offline"));
      const cached = await worker.intercept(request);
      expect(await cached?.text()).toBe("public file");
      expect(worker.stored.get(CURRENT_CACHE)?.size).toBe(1);
    },
  );

  it.each([
    { status: 401 },
    { headers: { "Cache-Control": "private" } },
    { headers: { "Cache-Control": "no-store" } },
    { headers: { Vary: "Accept-Encoding, Authorization" } },
    { headers: { Vary: "Cookie" } },
    { headers: { Vary: "*" } },
  ])(
    "never persists a personalized or failed public-path response %j",
    async (init) => {
      const worker = createWorker();
      const response = new Response("not a public asset", init as ResponseInit);
      worker.fetch.mockResolvedValue(response);

      await expect(
        worker.intercept(new Request(ORIGIN + "/app/assets/index-Ab12.js")),
      ).resolves.toBe(response);
      expect(worker.put).not.toHaveBeenCalled();
    },
  );

  it("does not persist redirected responses", async () => {
    const worker = createWorker();
    const response = new Response("redirected");
    Object.defineProperty(response, "redirected", { value: true });
    worker.fetch.mockResolvedValue(response);
    await worker.intercept(new Request(ORIGIN + "/app/"));
    expect(worker.put).not.toHaveBeenCalled();
  });

  it("propagates an asset network failure without substituting HTML", async () => {
    const worker = createWorker();
    worker.stored.set(
      CURRENT_CACHE,
      new Map([[ORIGIN + "/app/", new Response("<html>shell</html>")]]),
    );
    const failure = new TypeError("Offline");
    worker.fetch.mockRejectedValue(failure);
    await expect(
      worker.intercept(new Request(ORIGIN + "/app/assets/missing-Ab12.js")),
    ).rejects.toBe(failure);
  });

  it("returns the network response when static browser storage is unavailable", async () => {
    const worker = createWorker();
    worker.openCache.mockRejectedValue(new Error("Storage disabled"));
    const response = new Response("public file");
    worker.fetch.mockResolvedValue(response);
    await expect(
      worker.intercept(new Request(ORIGIN + "/app/icon-192.png")),
    ).resolves.toBe(response);
  });
});

describe("service worker migration and account cleanup", () => {
  it("drops old private response caches and queued credentials before claiming clients", async () => {
    const worker = createWorker();
    worker.stored.set(
      "todos-react-fold-v1",
      new Map([[ORIGIN + "/planning/today", new Response("Account A plan")]]),
    );
    worker.stored.set(CURRENT_CACHE, new Map());
    worker.stored.set("unrelated-app", new Map());

    await worker.dispatch("activate");

    expect(worker.records).toEqual([]);
    expect(worker.openDB).toHaveBeenCalledWith("todos-offline", 1);
    expect(worker.clear).toHaveBeenCalledTimes(1);
    expect(worker.close).toHaveBeenCalledTimes(1);
    expect(worker.deleteCache).toHaveBeenCalledWith("todos-react-fold-v1");
    expect(worker.stored.has(CURRENT_CACHE)).toBe(true);
    expect(worker.stored.has("unrelated-app")).toBe(true);
    expect(worker.claim).toHaveBeenCalledTimes(1);
    expect(worker.fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["sync", "offline-mutations"],
    ["message", "replay-mutations"],
    ["message", "clear-private-data"],
  ] as const)(
    "discards old queue on %s/%s without replaying account A",
    async (type, data) => {
      const worker = createWorker();
      await worker.dispatch(type, data);
      expect(worker.records).toEqual([]);
      expect(worker.close).toHaveBeenCalledTimes(1);
      expect(worker.fetch).not.toHaveBeenCalled();
    },
  );

  it("does not create a private queue for a new installation", async () => {
    const worker = createWorker(false);
    await worker.dispatch("activate");
    expect(worker.abort).toHaveBeenCalledTimes(1);
    expect(worker.clear).not.toHaveBeenCalled();
    expect(worker.claim).toHaveBeenCalledTimes(1);
    expect(worker.fetch).not.toHaveBeenCalled();
  });
});
