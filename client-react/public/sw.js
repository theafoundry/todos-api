const CACHE_NAME = "todos-react-fold-v1";
const DB_NAME = "todos-offline";
const STORE_NAME = "mutations";
const MUTATION_TTL = 24 * 60 * 60 * 1000; // 24 hours
let replayPromise;

// Static assets to pre-cache
const PRE_CACHE = ["/app-react/"];

// API paths that should never be cached
const API_PREFIXES = [
  "/auth",
  "/todos",
  "/users",
  "/admin",
  "/ai",
  "/projects",
  "/agent",
  "/mcp",
  "/api",
];

// Install: pre-cache shell
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRE_CACHE)),
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)),
        ),
      ),
  );
  self.clients.claim();
});

// Fetch handler
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Skip non-same-origin
  if (url.origin !== self.location.origin) return;

  // API requests: network-only, queue mutations on failure
  const isApi = API_PREFIXES.some((p) => url.pathname.startsWith(p));
  if (isApi) {
    if (event.request.method === "GET") return; // Let browser handle

    // Manual retry callers must receive failures, not an automatic queue receipt.
    if (event.request.headers.get("X-Planwren-Offline-Mode") === "manual") {
      event.respondWith(fetch(event.request.clone()));
      return;
    }

    // Mutable API requests: try network, queue on failure
    event.respondWith(
      fetch(event.request.clone()).catch(async () => {
        if (event.request.method === "POST" || event.request.method === "PUT") {
          await queueMutation(event.request);
        }
        return new Response(JSON.stringify({ queued: true }), {
          status: 202,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );
    return;
  }

  // Static assets: network-first for HTML/JS/CSS, cache-first for images/fonts
  const ext = url.pathname.split(".").pop() || "";
  const cacheFirst = [
    "png",
    "jpg",
    "jpeg",
    "svg",
    "woff",
    "woff2",
    "ico",
  ].includes(ext);

  if (cacheFirst) {
    event.respondWith(
      caches.match(event.request).then(
        (cached) =>
          cached ||
          fetch(event.request).then((res) => {
            const clone = res.clone();
            caches
              .open(CACHE_NAME)
              .then((cache) => cache.put(event.request, clone));
            return res;
          }),
      ),
    );
  } else {
    // Network-first for JS/CSS/HTML
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const clone = res.clone();
          caches
            .open(CACHE_NAME)
            .then((cache) => cache.put(event.request, clone));
          return res;
        })
        .catch(() =>
          caches
            .match(event.request)
            .then((cached) => cached || caches.match("/app-react/")),
        ),
    );
  }
});

// Background sync: replay queued mutations
self.addEventListener("sync", (event) => {
  if (event.tag === "offline-mutations") {
    event.waitUntil(replayMutations());
  }
});

// Listen for manual replay trigger from client
self.addEventListener("message", (event) => {
  if (event.data === "replay-mutations") {
    event.waitUntil(replayMutations());
  }
});

// --- IndexedDB helpers ---

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME, {
        keyPath: "id",
        autoIncrement: true,
      });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function queueMutation(request) {
  const db = await openDB();
  const body = await request.text();
  const mutation = {
    url: request.url,
    method: request.method,
    body,
    authHeader: request.headers.get("Authorization"),
    timestamp: Date.now(),
  };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).add(mutation);
    tx.oncomplete = resolve;
    tx.onerror = reject;
  });
}

function replayMutations() {
  if (!replayPromise) {
    replayPromise = performReplay().finally(() => {
      replayPromise = undefined;
    });
  }
  return replayPromise;
}

async function performReplay() {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, "readonly");
  const store = tx.objectStore(STORE_NAME);

  const mutations = await new Promise((resolve) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve([]);
  });

  let replayed = 0;
  let failed = 0;

  for (const m of mutations) {
    // Skip expired mutations
    if (Date.now() - m.timestamp > MUTATION_TTL) {
      await deleteMutation(db, m.id);
      continue;
    }

    try {
      const res = await fetch(m.url, {
        method: m.method,
        body: m.body,
        headers: {
          "Content-Type": "application/json",
          ...(m.authHeader ? { Authorization: m.authHeader } : {}),
        },
      });
      if (res.ok || res.status === 409) {
        await deleteMutation(db, m.id);
        replayed++;
      } else {
        failed++;
      }
    } catch {
      failed++;
    }
  }

  // Notify clients
  const clients = await self.clients.matchAll();
  for (const client of clients) {
    client.postMessage({
      type: "offline-sync-complete",
      replayed,
      failed,
    });
  }
}

function deleteMutation(db, id) {
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = resolve;
    tx.onerror = resolve;
  });
}
