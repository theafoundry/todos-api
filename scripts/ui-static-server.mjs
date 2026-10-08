import http from "http";
import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const reactRoot = resolveFirstBuildRoot(
  [
    path.resolve(__dirname, "../client-react/dist"),
    path.resolve(__dirname, "../dist"),
  ],
  "index.html",
);
const landingRoot = resolveFirstBuildRoot(
  [
    path.resolve(__dirname, "../client-react/dist-landing"),
    path.resolve(__dirname, "../dist-landing"),
  ],
  "landing.html",
);
const authRoot = resolveFirstBuildRoot(
  [
    path.resolve(__dirname, "../client-react/dist-auth"),
    path.resolve(__dirname, "../dist-auth"),
  ],
  "auth.html",
);
const vendorRoots = [
  {
    prefix: "/vendor/chrono-node/",
    root: path.resolve(__dirname, "../node_modules/chrono-node/dist/esm"),
  },
];
const port = Number.parseInt(process.env.UI_PORT || "4173", 10);

function resolveFirstExistingPath(candidates) {
  for (const candidate of candidates) {
    if (fsSync.existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}

function resolveFirstBuildRoot(candidates, entryFile) {
  for (const candidate of candidates) {
    if (fsSync.existsSync(path.join(candidate, entryFile))) {
      return candidate;
    }
  }

  return resolveFirstExistingPath(candidates);
}

function resolveFirstExistingFile(candidates) {
  for (const candidate of candidates) {
    if (fsSync.existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

// Resolve a URL path (already stripped of its mount prefix) inside baseRoot.
// Returns null for malformed encodings, NUL bytes, or paths escaping baseRoot.
function safePathForRoot(requestPath, baseRoot, indexFile = "index.html") {
  let decoded;
  try {
    decoded = decodeURIComponent(requestPath.split("?")[0]);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) {
    return null;
  }
  const normalized = path.normalize(decoded).replace(/^([/\\])+/, "");
  const resolved = path.resolve(baseRoot, normalized || indexFile);
  if (resolved !== baseRoot && !resolved.startsWith(baseRoot + path.sep)) {
    return null;
  }
  return resolved;
}

// Serve a regular file if it exists; returns false (without responding) if not.
async function sendFileIfExists(res, filePath) {
  if (!filePath) return false;
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return false;
  } catch {
    return false;
  }
  const ext = path.extname(filePath).toLowerCase();
  const body = await fs.readFile(filePath);
  res.writeHead(200, {
    "Content-Type": contentTypes[ext] || "application/octet-stream",
    "Cache-Control": "no-store",
  });
  res.end(body);
  return true;
}

function sendNotFound(res) {
  res.writeHead(404, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end("Not found");
}

// Mirrors src/app.ts: /app (+ /feedback) from dist, / and its static assets
// from dist-landing, /auth and /auth/assets from dist-auth.
const reactIndex = path.join(reactRoot, "index.html");
const landingIndex = resolveFirstExistingFile([
  path.join(landingRoot, "landing.html"),
  path.join(landingRoot, "index.html"),
]);
const authIndex = resolveFirstExistingFile([
  path.join(authRoot, "auth.html"),
  path.join(authRoot, "index.html"),
]);
const authAssetsRoot = path.join(authRoot, "assets");

// Standalone page routes — map product URLs to their HTML files
const standaloneRoutes = {
  "/": landingIndex,
  "/auth": authIndex,
  "/feedback": reactIndex,
};

const server = http.createServer(async (req, res) => {
  try {
    const urlPath = req.url || "/";
    const pathname = urlPath.split("?")[0];

    // Mock API endpoints — return empty data so the React app can render.
    const apiHandlers = {
      "POST:/auth/login": () =>
        JSON.stringify({
          token: "mock",
          refreshToken: "mock",
          user: {
            id: "mock-user",
            name: "Test User",
            email: "test@example.com",
          },
        }),
      "POST:/auth/refresh": () =>
        JSON.stringify({ token: "mock", refreshToken: "mock" }),
      "GET:/users/me": () =>
        JSON.stringify({
          id: "mock-user",
          name: "Test User",
          email: "test@example.com",
          onboardingCompletedAt: new Date().toISOString(),
          onboardingStep: 4,
        }),
      "GET:/users/me/settings": () => JSON.stringify({}),
      "GET:/todos": () => JSON.stringify([]),
      "GET:/projects": () => JSON.stringify([]),
      "GET:/capture": () => JSON.stringify([]),
      "GET:/tuneup": () =>
        JSON.stringify({
          stale: [],
          staleByCategory: [],
          myopic: [],
          myopicByCategory: [],
        }),
      "GET:/ai/focus-brief": () =>
        JSON.stringify({
          pinned: {
            rightNow: {
              narrative: "No tasks to focus on right now.",
              urgentItems: [],
              topRecommendation: null,
            },
            todayAgenda: [],
            rightNowProvenance: { source: "deterministic" },
            todayAgendaProvenance: { source: "deterministic" },
          },
          rankedPanels: [],
          generatedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
          cached: false,
          isStale: false,
        }),
      "GET:/activity": () => JSON.stringify({ entries: [] }),
      "GET:/search": () => JSON.stringify({ results: [] }),
      "GET:/agent-profiles": () => JSON.stringify([]),
    };

    const apiMethod = (req.method || "GET").toUpperCase();
    const apiHandlerKey = `${apiMethod}:${pathname}`;

    const handler =
      apiHandlers[apiHandlerKey] || apiHandlers[`GET:${pathname}`];
    if (handler) {
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(handler());
      return;
    }

    const apiPaths = [
      "/users",
      "/todos",
      "/projects",
      "/tuneup",
      "/ai/",
      "/activity",
      "/search",
      "/auth/",
      "/agent-profiles",
    ];
    const isApiPath = apiPaths.some(
      (p) => pathname === p || pathname.startsWith(p + "/"),
    );
    if (["POST", "PUT", "PATCH", "DELETE"].includes(apiMethod) && isApiPath) {
      if (req.readable) {
        await new Promise((resolve) => {
          req.on("data", () => {});
          req.on("end", resolve);
        });
      }
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(JSON.stringify({ success: true }));
      return;
    }

    const standaloneFile =
      standaloneRoutes[pathname] ??
      (pathname.startsWith("/feedback/") ? reactIndex : undefined);
    if (standaloneFile) {
      if (!(await sendFileIfExists(res, standaloneFile))) {
        sendNotFound(res);
      }
      return;
    }

    if (pathname === "/app-react" || pathname.startsWith("/app-react/")) {
      const newPath = pathname.replace(/^\/app-react/, "/app") || "/app";
      const qs = urlPath.includes("?")
        ? urlPath.slice(urlPath.indexOf("?"))
        : "";
      res.writeHead(302, { Location: newPath + qs });
      res.end();
      return;
    }

    if (pathname === "/app" || pathname.startsWith("/app/")) {
      const relative = pathname.replace(/^\/app\/?/, "") || "index.html";
      if (await sendFileIfExists(res, safePathForRoot(relative, reactRoot))) {
        return;
      }
      // Missing build assets must 404 rather than masquerade as the SPA shell.
      if (pathname.startsWith("/app/assets/")) {
        sendNotFound(res);
        return;
      }
      if (!(await sendFileIfExists(res, reactIndex))) {
        sendNotFound(res);
      }
      return;
    }

    if (pathname.startsWith("/auth/assets/")) {
      const relative = pathname.slice("/auth/assets/".length);
      const authFile = safePathForRoot(relative, authAssetsRoot, "");
      if (!(await sendFileIfExists(res, authFile))) {
        sendNotFound(res);
      }
      return;
    }

    for (const vendorRoot of vendorRoots) {
      if (!pathname.startsWith(vendorRoot.prefix)) continue;
      const relative = pathname.slice(vendorRoot.prefix.length);
      const vendorFile = safePathForRoot(relative, vendorRoot.root, "");
      if (!(await sendFileIfExists(res, vendorFile))) {
        sendNotFound(res);
      }
      return;
    }

    // Landing static assets (bundles, favicon, manifest, public images).
    const landingFile = safePathForRoot(pathname, landingRoot, "");
    if (!(await sendFileIfExists(res, landingFile))) {
      sendNotFound(res);
    }
  } catch (error) {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Internal server error");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`UI static server listening on http://127.0.0.1:${port}`);
});
