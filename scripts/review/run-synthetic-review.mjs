import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { assertSyntheticReviewEnvironment } from "./synthetic-review-safety.mjs";

const repository = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
try {
  assertSyntheticReviewEnvironment();
  if (process.argv.length !== 2)
    throw new Error(
      "No endpoint, credential, or database arguments are supported",
    );
  const temporary = fs.mkdtempSync(
    path.join(os.tmpdir(), "planwren-synthetic-review-"),
  );
  try {
    // An empty cwd and a clean environment keep source config from reading the
    // repository's .env or inheriting secrets/provider settings.
    fs.writeFileSync(path.join(temporary, ".env"), "");
    const result = spawnSync(
      process.execPath,
      [path.join(repository, "scripts/review/synthetic-review-worker.cjs")],
      {
        cwd: temporary,
        env: {
          PATH: process.env.PATH,
          NODE_ENV: "test",
          SKIP_DB_SETUP: "true",
          DOTENV_CONFIG_QUIET: "true",
          PLANWREN_SYNTHETIC_REVIEW: "IN_MEMORY_ONLY",
          BASE_URL: "http://127.0.0.1:0",
          AI_PROVIDER_ENABLED: "false",
          EMAIL_FEATURES_ENABLED: "false",
          GOOGLE_LOGIN_ENABLED: "false",
          APPLE_LOGIN_ENABLED: "false",
          PHONE_LOGIN_ENABLED: "false",
          TS_NODE_PROJECT: path.join(repository, "tsconfig.json"),
        },
        encoding: "utf8",
        timeout: 90_000,
        maxBuffer: 2 * 1024 * 1024,
      },
    );
    if (result.status !== 0) {
      // The worker emits only its sanitized failure label. Never forward a
      // stack, inherited environment, request headers or arbitrary raw output.
      const failure = result.stderr?.match(
        /^Synthetic review failed: [A-Z0-9_]+$/m,
      )?.[0];
      throw new Error(
        failure || "Synthetic worker failed; raw output withheld",
      );
    }
    const report = JSON.parse(result.stdout);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
