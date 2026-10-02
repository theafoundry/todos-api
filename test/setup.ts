// Set NODE_ENV before any imports
process.env.NODE_ENV = "test";

import { execSync } from "child_process";
import * as dotenv from "dotenv";
import { shouldSetupDatabaseForArgs } from "./dbTestConfig";

// Load environment variables
dotenv.config();

const DEFAULT_LOCAL_TEST_DATABASE_URL =
  "postgresql://postgres:postgres@localhost:5432/todos_test?schema=public";

/**
 * Jest global setup - runs once before all tests.
 * Ensures test database schema is up to date.
 */
export default async function globalSetup() {
  if (process.env.SKIP_DB_SETUP === "true") {
    console.log("\n⏭️  Skipping test database setup (SKIP_DB_SETUP=true)\n");
    return;
  }

  if (!shouldSetupDatabaseForArgs(process.argv.slice(2))) {
    console.log(
      "\n⏭️  Skipping test database setup (no DB-backed tests selected)\n",
    );
    process.env.SKIP_DB_TEST_SETUP = "true";
    return;
  }

  console.log("\n🔧 Setting up test database...\n");

  const explicitTestDatabaseUrl =
    (process.env.TEST_DATABASE_URL || "").trim() ||
    (process.env.DATABASE_URL_TEST || "").trim();
  const testDatabaseUrl =
    explicitTestDatabaseUrl || DEFAULT_LOCAL_TEST_DATABASE_URL;

  // Defensive guard against destructive reset targeting non-test DBs.
  const lowerUrl = testDatabaseUrl.toLowerCase();
  if (!lowerUrl.includes("test")) {
    throw new Error(
      "Refusing to reset database because resolved integration test DB URL does not look like a test database",
    );
  }

  const allowRemoteTestDb =
    (process.env.ALLOW_REMOTE_TEST_DB || "false").toLowerCase() === "true";
  const isLocalHostUrl = isLocalDatabaseUrl(testDatabaseUrl);
  if (!allowRemoteTestDb && !isLocalHostUrl) {
    throw new Error(
      `Refusing to run integration tests against non-local database host. Resolved URL host is remote. Set ALLOW_REMOTE_TEST_DB=true to override intentionally.`,
    );
  }

  // Set database URL to test database
  process.env.DATABASE_URL = testDatabaseUrl;
  process.env.DATABASE_URL_TEST = testDatabaseUrl;
  process.env.TEST_DATABASE_URL = testDatabaseUrl;

  if (!explicitTestDatabaseUrl) {
    console.log(
      `ℹ️  No TEST_DATABASE_URL/DATABASE_URL_TEST provided; using default local test DB: ${DEFAULT_LOCAL_TEST_DATABASE_URL}\n`,
    );
  }

  try {
    // Prisma 7 resets and applies migrations without running seed or generation.
    execSync("npx prisma migrate reset --force", {
      stdio: "inherit",
      env: {
        ...process.env,
        DATABASE_URL: testDatabaseUrl,
      },
    });

    console.log("\n✅ Test database ready\n");
  } catch (error) {
    console.error(
      "\n❌ Failed to set up test database. Ensure PostgreSQL is running and reachable.",
    );
    console.error(
      "Hint: run `npm run docker:up`, or set TEST_DATABASE_URL/DATABASE_URL_TEST to your local test DB URL.\n",
    );
    console.error(error);
    throw error;
  }
}

function isLocalDatabaseUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
    return localHosts.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}
