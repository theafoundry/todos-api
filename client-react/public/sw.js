const CACHE_NAME = "todos-react-fold-v2";
const CACHE_PREFIX = "todos-react-";
const SHELL_PATH = "/app/";
const LEGACY_DB_NAME = "todos-offline";
const LEGACY_STORE_NAME = "mutations";

// Only shipped, public files may enter this cache. API paths are network-only,
// including future routes that are not known to this worker.
const PUBLIC_ASSETS = new Set([
  "/app/manifest.json",
  "/app/favicon.ico",
  "/app/favicon.svg",
  "/app/favicon-16x16.png",
  "/app/favicon-32x32.png",
  "/app/apple-touch-icon.png",
  "/app/icon-192.png",
  "/app/icon-512.png",
  "/app/icon-maskable-192.png",
  "/app/icon-maskable-512.png",
  "/app/brand/fold-ink.svg",
  "/app/brand/fold-coral.svg",
  "/app/brand/fold-cream.svg",
  "/app/brand/app-icon.svg",
  "/app/brand/app-icon-dark.svg",
  "/app/brand/app-icon-1024.png",
  "/app/brand/app-icon-dark-1024.png",
  "/app/brand/assets.json",
  "/app/images/landing/hero-desktop.png",
  "/app/images/landing/hero-mobile-light.png",
  "/app/images/landing/hero-mobile-dark.png",
  "/app/images/landing/dark-mode.png",
]);
const BUILD_ASSET_PATH =
  /^\/app\/assets\/[A-Za-z0-9._-]+\.(?:js|css|png|jpe?g|svg|webp|woff2?|ico)$/;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll([SHELL_PATH]))
      .catch(() => undefined),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([clearOldCaches(), clearLegacyMutations()]).then(() =>
      self.clients.claim(),
    ),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (
    url.origin !== self.location.origin ||
    request.method !== "GET" ||
    request.headers.has("Authorization")
  ) {
    return;
  }

  const isShell = url.pathname === SHELL_PATH && !url.search;
  if (
    !isShell &&
    !PUBLIC_ASSETS.has(url.pathname) &&
    !BUILD_ASSET_PATH.test(url.pathname)
  ) {
    return;
  }

  // Public asset version queries need not be retained in browser storage.
  const cacheKey = url.origin + url.pathname;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME).catch(() => undefined);
      try {
        const response = await fetch(request);
        const cacheControl = response.headers.get("Cache-Control") || "";
        if (
          response.ok &&
          !response.redirected &&
          !/\b(?:private|no-store)\b/i.test(cacheControl) &&
          !/(?:^|,)\s*(?:authorization|cookie|\*)\s*(?:,|$)/i.test(
            response.headers.get("Vary") || "",
          )
        ) {
          try {
            await cache?.put(cacheKey, response.clone());
          } catch {
            // An unavailable static cache must not turn a successful fetch into a failure.
          }
        }
        return response;
      } catch (error) {
        const cached = await cache?.match(cacheKey);
        if (cached) return cached;
        throw error;
      }
    })(),
  );
});

// Older workers stored task bodies and bearer credentials for automatic replay.
// Discard those records; retries now require a current, explicit user action.
self.addEventListener("sync", (event) => {
  if (event.tag === "offline-mutations") {
    event.waitUntil(clearLegacyMutations());
  }
});

self.addEventListener("message", (event) => {
  if (
    event.data === "clear-private-data" ||
    event.data === "replay-mutations"
  ) {
    event.waitUntil(Promise.all([clearOldCaches(), clearLegacyMutations()]));
  }
});

function clearOldCaches() {
  return caches
    .keys()
    .then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      ),
    )
    .catch(() => undefined);
}

function clearLegacyMutations() {
  return new Promise((resolve) => {
    let request;
    try {
      request = indexedDB.open(LEGACY_DB_NAME, 1);
    } catch {
      resolve();
      return;
    }
    // Do not create a database for clients that never used the old queue.
    request.onupgradeneeded = () => request.transaction.abort();
    request.onerror = () => resolve();
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(LEGACY_STORE_NAME)) {
        db.close();
        resolve();
        return;
      }
      const transaction = db.transaction(LEGACY_STORE_NAME, "readwrite");
      transaction.objectStore(LEGACY_STORE_NAME).clear();
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
