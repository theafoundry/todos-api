import "./instrument";
import * as Sentry from "@sentry/node";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createApp } from "./app";
import { PrismaTodoService } from "./services/prismaTodoService";
import { AuthService } from "./services/authService";
import { prisma, disconnectPrisma } from "./prismaClient";
import { config } from "./config";
import { PrismaAiSuggestionStore } from "./services/aiSuggestionStore";
import { PrismaProjectService } from "./services/projectService";
import { PrismaHeadingService } from "./services/prismaHeadingService";

const PORT = config.port;

const todoService = new PrismaTodoService(prisma);
const authService = new AuthService(prisma);
const aiSuggestionStore = new PrismaAiSuggestionStore(prisma);
const projectService = new PrismaProjectService(prisma);
const headingService = new PrismaHeadingService(prisma);
const app = createApp({
  todoService,
  authService,
  projectService,
  headingService,
  ai: {
    suggestionStore: aiSuggestionStore,
  },
});

// Release SHA stamped at deploy time by the production release workflow
// (release-sha.txt, written from the exact released commit). "unknown" when
// absent, e.g. local dev or deploys predating the release workflow.
const RELEASE_SHA = (() => {
  try {
    const sha = readFileSync(
      path.join(process.cwd(), "release-sha.txt"),
      "utf8",
    ).trim();
    return sha === "" ? "unknown" : sha;
  } catch {
    return "unknown";
  }
})();

app.get("/healthz", (_req, res) => {
  res.status(200).json({
    ok: true,
    service: "todos-api",
    sha: RELEASE_SHA,
    now: new Date().toISOString(),
  });
});

app.get("/readyz", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({
      ok: true,
      service: "todos-api",
      database: "ready",
      now: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Readiness check failed", error);
    res.status(503).json({
      ok: false,
      service: "todos-api",
      database: "unavailable",
      now: new Date().toISOString(),
    });
  }
});

const server = app.listen(PORT, () => {
  console.log(`Todos API server running on port ${PORT}`);
  console.log(`Environment: ${config.nodeEnv}`);
  console.log(
    `Database: ${config.databaseUrl ? "Connected" : "Not configured"}`,
  );
});

server.requestTimeout = config.requestTimeoutMs;
server.headersTimeout = config.headersTimeoutMs;
server.keepAliveTimeout = config.keepAliveTimeoutMs;

// Graceful shutdown: drain in-flight requests before closing Prisma. Protected
// by a force-exit timer so a hung connection can't block a deploy.
const SHUTDOWN_TIMEOUT_MS = (() => {
  const raw = Number.parseInt(process.env.SHUTDOWN_TIMEOUT_MS ?? "25000", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 25000;
})();

let shuttingDown = false;

async function gracefulShutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`\n${signal} received. Starting graceful shutdown...`);

  const forceExit = setTimeout(() => {
    console.error(
      `Graceful shutdown timed out after ${SHUTDOWN_TIMEOUT_MS}ms; forcing exit`,
    );
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  try {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    console.log("HTTP server closed");

    await disconnectPrisma();
    console.log("Database connections closed");

    await Sentry.close(2000);

    clearTimeout(forceExit);
    process.exit(0);
  } catch (error) {
    console.error("Error during shutdown:", error);
    process.exit(1);
  }
}

process.on("SIGTERM", () => {
  void gracefulShutdown("SIGTERM");
});
process.on("SIGINT", () => {
  void gracefulShutdown("SIGINT");
});

// Installing a listener on these events suppresses Node's default exit
// behavior, so we must terminate explicitly. Flush Sentry with a short budget,
// then exit non-zero. A force-exit timer guards against a hung flush.
// Sentry.captureException / Sentry.close are no-ops when init was skipped, so
// this preserves the pre-Sentry crash-on-fatal semantics when SENTRY_DSN is
// unset.
const FATAL_FLUSH_TIMEOUT_MS = 2000;
const FATAL_FORCE_EXIT_MS = 3000;

let terminating = false;

function fatal(source: string, err: unknown): void {
  if (terminating) return;
  terminating = true;

  console.error(source, err);
  Sentry.captureException(err);

  const forceExit = setTimeout(() => {
    process.exit(1);
  }, FATAL_FORCE_EXIT_MS);
  forceExit.unref();

  Sentry.close(FATAL_FLUSH_TIMEOUT_MS)
    .catch(() => {})
    .finally(() => {
      clearTimeout(forceExit);
      process.exit(1);
    });
}

process.on("uncaughtException", (err) => fatal("uncaughtException", err));
process.on("unhandledRejection", (reason) =>
  fatal("unhandledRejection", reason),
);
