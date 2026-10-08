import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const workerSource = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../public/sw.js"),
  "utf8",
);

interface QueuedMutation {
  url: string;
  method: string;
  body: string;
  authHeader: string | null;
  timestamp: number;
}

interface WorkerFetchEvent {
  request: Request;
  respondWith: (response: Promise<Response>) => void;
}

interface WorkerReplayEvent {
  tag?: string;
  data?: string;
  waitUntil: (completion: Promise<void>) => void;
}

function createWorker() {
  const listeners = new Map<
    string,
    (event: WorkerFetchEvent | WorkerReplayEvent) => void
  >();
  const queuedMutations: QueuedMutation[] = [];
  const mutationIds = new Map<QueuedMutation, number>();
  let nextId = 1;
  const fetch = vi.fn<typeof globalThis.fetch>();
  const postMessage = vi.fn();
  const matchAll = vi.fn().mockResolvedValue([{ postMessage }]);
  const transaction = () => {
    const tx = {
      oncomplete: undefined as (() => void) | undefined,
      objectStore: () => ({
        add: (mutation: QueuedMutation) => {
          mutationIds.set(mutation, nextId++);
          queuedMutations.push(mutation);
        },
        getAll: () => {
          const request = {
            result: queuedMutations.map((mutation) => ({
              ...mutation,
              id: mutationIds.get(mutation),
            })),
            onsuccess: undefined as (() => void) | undefined,
          };
          queueMicrotask(() => request.onsuccess?.());
          return request;
        },
        delete: (id: number) => {
          const index = queuedMutations.findIndex(
            (mutation) => mutationIds.get(mutation) === id,
          );
          if (index !== -1) {
            mutationIds.delete(queuedMutations[index]);
            queuedMutations.splice(index, 1);
          }
        },
      }),
    };
    queueMicrotask(() => tx.oncomplete?.());
    return tx;
  };
  const openDB = vi.fn(() => {
    const request = {
      result: { transaction },
      onsuccess: undefined as (() => void) | undefined,
    };
    queueMicrotask(() => request.onsuccess?.());
    return request;
  });

  // Execute the shipped worker, including its real fetch and queue handlers.
  runInNewContext(workerSource, {
    self: {
      location: { origin: "https://planwren.test" },
      clients: { matchAll },
      addEventListener: (
        type: string,
        listener: (event: WorkerFetchEvent | WorkerReplayEvent) => void,
      ) => listeners.set(type, listener),
    },
    URL,
    Response,
    fetch,
    indexedDB: { open: openDB },
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

  const replay = (type: "sync" | "message") => {
    const waitUntil = vi.fn<(completion: Promise<void>) => void>();
    listeners.get(type)!({
      ...(type === "sync"
        ? { tag: "offline-mutations" }
        : { data: "replay-mutations" }),
      waitUntil,
    });
    return { waitUntil, completion: waitUntil.mock.calls[0]?.[0] };
  };

  return {
    fetch,
    openDB,
    queuedMutations,
    intercept,
    replay,
    matchAll,
    postMessage,
  };
}

function mutationRequest(method: string, manual = false) {
  return new Request("https://planwren.test/todos/task-1", {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer test-token",
      ...(manual ? { "X-Planwren-Offline-Mode": "manual" } : {}),
    },
    body: JSON.stringify({ title: "Keep the draft" }),
  });
}

describe("service worker mutation retry policy", () => {
  it.each(["POST", "PUT", "DELETE", "PATCH"])(
    "propagates a manual %s network failure without queuing or acknowledging it",
    async (method) => {
      const worker = createWorker();
      const failure = new TypeError("Failed to fetch");
      worker.fetch.mockRejectedValue(failure);

      const response = worker.intercept(mutationRequest(method, true));

      expect(response).toBeDefined();
      await expect(response).rejects.toBe(failure);
      expect(worker.fetch).toHaveBeenCalledTimes(1);
      expect(worker.openDB).not.toHaveBeenCalled();
      expect(worker.queuedMutations).toEqual([]);
    },
  );

  it.each(["POST", "PUT"])(
    "preserves automatic queueing for an ordinary %s network failure",
    async (method) => {
      const worker = createWorker();
      worker.fetch.mockRejectedValue(new TypeError("Failed to fetch"));
      const request = mutationRequest(method);

      const response = await worker.intercept(request);

      expect(response?.status).toBe(202);
      await expect(response?.json()).resolves.toEqual({ queued: true });
      expect(worker.openDB).toHaveBeenCalledWith("todos-offline", 1);
      expect(worker.queuedMutations).toEqual([
        {
          url: request.url,
          method,
          body: JSON.stringify({ title: "Keep the draft" }),
          authHeader: "Bearer test-token",
          timestamp: expect.any(Number),
        },
      ]);
    },
  );

  it("returns a successful manual request's network response unchanged", async () => {
    const worker = createWorker();
    const response = new Response(JSON.stringify({ id: "task-1" }), {
      status: 200,
    });
    worker.fetch.mockResolvedValue(response);

    await expect(worker.intercept(mutationRequest("PUT", true))).resolves.toBe(
      response,
    );

    expect(worker.openDB).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "leaves GET requests to the browser (manual=%s)",
    (manual) => {
      const worker = createWorker();
      const request = new Request("https://planwren.test/todos", {
        headers: manual ? { "X-Planwren-Offline-Mode": "manual" } : {},
      });

      expect(worker.intercept(request)).toBeUndefined();
      expect(worker.fetch).not.toHaveBeenCalled();
      expect(worker.openDB).not.toHaveBeenCalled();
    },
  );

  it("leaves cross-origin manual mutations to the browser", () => {
    const worker = createWorker();
    const request = new Request("https://elsewhere.test/todos", {
      method: "POST",
      headers: { "X-Planwren-Offline-Mode": "manual" },
    });

    expect(worker.intercept(request)).toBeUndefined();
    expect(worker.fetch).not.toHaveBeenCalled();
    expect(worker.openDB).not.toHaveBeenCalled();
  });
});

async function queueCreation(worker: ReturnType<typeof createWorker>) {
  worker.fetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
  const response = await worker.intercept(mutationRequest("POST"));
  expect(response?.status).toBe(202);
  worker.fetch.mockClear();
  worker.openDB.mockClear();
}

describe("service worker replay concurrency", () => {
  it("shares concurrent sync and message work and replays a later creation", async () => {
    const worker = createWorker();
    await queueCreation(worker);
    let resolveReplay!: (response: Response) => void;
    worker.fetch.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveReplay = resolve;
      }),
    );

    const sync = worker.replay("sync");
    const message = worker.replay("message");

    expect(sync.waitUntil).toHaveBeenCalledTimes(1);
    expect(message.waitUntil).toHaveBeenCalledTimes(1);
    expect(sync.completion).toBeDefined();
    expect(message.completion).toBe(sync.completion);
    await vi.waitFor(() => expect(worker.fetch).toHaveBeenCalledTimes(1));
    expect(worker.openDB).toHaveBeenCalledTimes(1);
    expect(worker.fetch).toHaveBeenCalledWith(
      "https://planwren.test/todos/task-1",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ title: "Keep the draft" }),
      }),
    );

    resolveReplay(new Response("{}", { status: 201 }));
    await Promise.all([sync.completion, message.completion]);

    expect(worker.fetch).toHaveBeenCalledTimes(1);
    expect(worker.queuedMutations).toEqual([]);
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    expect(worker.postMessage).toHaveBeenCalledWith({
      type: "offline-sync-complete",
      replayed: 1,
      failed: 0,
    });

    await queueCreation(worker);
    worker.fetch.mockResolvedValueOnce(new Response("{}", { status: 201 }));
    const later = worker.replay("message");
    expect(later.completion).not.toBe(sync.completion);
    await later.completion;
    expect(worker.fetch).toHaveBeenCalledTimes(1);
    expect(worker.queuedMutations).toEqual([]);
  });

  it("retries a failed queued creation on a later trigger", async () => {
    const worker = createWorker();
    await queueCreation(worker);
    worker.fetch.mockRejectedValueOnce(new TypeError("Still offline"));

    await worker.replay("sync").completion;

    expect(worker.queuedMutations).toHaveLength(1);
    expect(worker.postMessage).toHaveBeenLastCalledWith({
      type: "offline-sync-complete",
      replayed: 0,
      failed: 1,
    });
    worker.fetch.mockResolvedValueOnce(new Response("{}", { status: 201 }));

    await worker.replay("message").completion;

    expect(worker.fetch).toHaveBeenCalledTimes(2);
    expect(worker.queuedMutations).toEqual([]);
    expect(worker.postMessage).toHaveBeenLastCalledWith({
      type: "offline-sync-complete",
      replayed: 1,
      failed: 0,
    });
  });

  it("releases shared replay after the replay operation rejects", async () => {
    const worker = createWorker();
    const failure = new Error("Clients unavailable");
    worker.matchAll.mockRejectedValueOnce(failure);
    const failed = worker.replay("message");

    await expect(failed.completion).rejects.toBe(failure);

    await queueCreation(worker);
    worker.fetch.mockResolvedValueOnce(new Response("{}", { status: 201 }));
    const later = worker.replay("sync");
    expect(later.completion).not.toBe(failed.completion);
    await later.completion;
    expect(worker.fetch).toHaveBeenCalledTimes(1);
    expect(worker.queuedMutations).toEqual([]);
  });
});
