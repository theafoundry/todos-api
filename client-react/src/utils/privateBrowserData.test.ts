import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearLegacyOfflineMutations,
  clearPrivateBrowserData,
  clearLegacyResponseCaches,
} from "./privateBrowserData";

afterEach(() => vi.unstubAllGlobals());

function legacyDatabase(existing = true) {
  const records = [
    { body: "Private account A action", authHeader: "Bearer synthetic-a" },
  ];
  const close = vi.fn();
  const abort = vi.fn();
  const clear = vi.fn(() => records.splice(0));
  const open = vi.fn(() => {
    const request = {
      result: {
        close,
        objectStoreNames: { contains: () => true },
        transaction: () => {
          const transaction = {
            oncomplete: undefined as (() => void) | undefined,
            objectStore: () => ({ clear }),
          };
          queueMicrotask(() => transaction.oncomplete?.());
          return transaction;
        },
      },
      transaction: { abort },
      onsuccess: undefined as (() => void) | undefined,
      onerror: undefined as (() => void) | undefined,
      onupgradeneeded: undefined as (() => void) | undefined,
    };
    queueMicrotask(() => {
      if (existing) request.onsuccess?.();
      else {
        request.onupgradeneeded?.();
        request.onerror?.();
      }
    });
    return request;
  });
  vi.stubGlobal("indexedDB", { open });
  return { records, clear, open, close, abort };
}

describe("private browser data cleanup", () => {
  it("erases legacy credentials and bodies directly without relying on the worker version", async () => {
    const db = legacyDatabase();
    await clearLegacyOfflineMutations();
    expect(db.open).toHaveBeenCalledWith("todos-offline", 1);
    expect(db.records).toEqual([]);
    expect(db.close).toHaveBeenCalledTimes(1);
  });

  it("clears old Focus data and sends only a cleanup message", async () => {
    const db = legacyDatabase();
    const postMessage = vi.fn();
    vi.stubGlobal("navigator", {
      serviceWorker: { controller: { postMessage } },
    });
    localStorage.setItem("todos:focus-brief-cache", "Private account A brief");
    clearPrivateBrowserData();
    expect(localStorage.getItem("todos:focus-brief-cache")).toBeNull();
    expect(postMessage).toHaveBeenCalledExactlyOnceWith("clear-private-data");
    await vi.waitFor(() => expect(db.close).toHaveBeenCalledTimes(1));
    expect(db.records).toEqual([]);
  });

  it("does not create a queue when no legacy database exists", async () => {
    const db = legacyDatabase(false);
    await clearLegacyOfflineMutations();
    expect(db.abort).toHaveBeenCalledTimes(1);
    expect(db.clear).not.toHaveBeenCalled();
  });

  it("deletes legacy private response caches directly when the old worker ignores messages", async () => {
    const deleteCache = vi.fn().mockResolvedValue(true);
    vi.stubGlobal("caches", {
      keys: async () => [
        "todos-react-fold-v1",
        "todos-react-old",
        "todos-react-fold-v2",
        "unrelated-app",
      ],
      delete: deleteCache,
    });
    await clearLegacyResponseCaches();
    expect(deleteCache.mock.calls).toEqual([
      ["todos-react-fold-v1"],
      ["todos-react-old"],
    ]);
  });

  it("does not block authentication when browser storage is unavailable", async () => {
    vi.stubGlobal("indexedDB", {
      open: () => {
        throw new Error("Storage unavailable");
      },
    });
    vi.stubGlobal("navigator", {
      serviceWorker: {
        controller: {
          postMessage: () => {
            throw new Error("Worker unavailable");
          },
        },
      },
    });
    expect(() => clearPrivateBrowserData()).not.toThrow();
    await expect(clearLegacyOfflineMutations()).resolves.toBeUndefined();
  });
});
