import { clearPersistedFocusBrief } from "./focusBriefCache";

/** Erase obsolete private caches at startup, logout, and account transitions. */
export function clearPrivateBrowserData(): void {
  clearPersistedFocusBrief();
  // Purge directly as well, since an older controlling worker does not recognize
  // the cleanup message. No request body or credential is sent to the worker.
  void clearLegacyOfflineMutations();
  void clearLegacyResponseCaches();
  try {
    navigator.serviceWorker?.controller?.postMessage("clear-private-data");
  } catch {
    // Worker availability must not block authentication cleanup.
  }
}

export async function clearLegacyResponseCaches(): Promise<void> {
  if (!("caches" in globalThis)) return;
  try {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(
          (key) =>
            key.startsWith("todos-react-") && key !== "todos-react-fold-v2",
        )
        .map((key) => caches.delete(key)),
    );
  } catch {
    // Cache storage can be unavailable in restricted browser contexts.
  }
}

export function clearLegacyOfflineMutations(): Promise<void> {
  return new Promise((resolve) => {
    if (!("indexedDB" in globalThis)) {
      resolve();
      return;
    }
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open("todos-offline", 1);
    } catch {
      resolve();
      return;
    }
    request.onupgradeneeded = () => request.transaction?.abort();
    request.onerror = () => resolve();
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("mutations")) {
        db.close();
        resolve();
        return;
      }
      const transaction = db.transaction("mutations", "readwrite");
      transaction.objectStore("mutations").clear();
      transaction.oncomplete =
        transaction.onerror =
        transaction.onabort =
          () => {
            db.close();
            resolve();
          };
    };
  });
}
