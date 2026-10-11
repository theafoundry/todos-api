import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { assertSyntheticReviewEnvironment } from "./synthetic-review-safety.mjs";

const repository = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const runner = path.join(repository, "scripts/review/run-synthetic-review.mjs");
const manifestPath = path.join(
  repository,
  "plugins/planwren-public/plugin.json",
);
const sha256 = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");
const cleanEnv = { PATH: process.env.PATH, NODE_ENV: "test" };
const run = (env = cleanEnv, args = []) =>
  spawnSync(process.execPath, [runner, ...args], {
    cwd: repository,
    env,
    encoding: "utf8",
    timeout: 60_000,
    maxBuffer: 2 * 1024 * 1024,
  });

for (const value of [undefined, "development", "production"]) {
  test(`reject environment ${value ?? "unset"} before source execution`, () => {
    assert.throws(
      () => assertSyntheticReviewEnvironment({ NODE_ENV: value }),
      /requires NODE_ENV=test/,
    );
  });
}
test("permits test mode without any database or endpoint", () =>
  assert.doesNotThrow(() => assertSyntheticReviewEnvironment(cleanEnv)));
for (const [key, value] of [
  [
    "DATABASE_URL",
    "postgresql://unused:never-print-this@prod.example:5432/planwren_review_disposable",
  ],
  ["TEST_DATABASE_URL", "postgresql://127.0.0.1:5432/planwren"],
  [
    "DATABASE_URL_TEST",
    "postgresql://localhost:5432/planwren_review_disposable",
  ],
  [
    "TEST_DATABASE_URL",
    "postgresql://127.0.0.1:5432/planwren_review_disposable?host=prod.example",
  ],
  ["BASE_URL", "https://todos.theafoundry.com"],
  ["REVIEW_BASE_URL", "http://localhost:3000"],
  ["REVIEW_BASE_URL", "http://unused:never-print-this@127.0.0.1:3000"],
  ["BASE_URL", "https://127.0.0.1:3000"],
  ["BASE_URL", "http://127.0.0.1:3000?endpoint=prod.example"],
  ["DATABASE_URL", "not-a-url-never-print-this"],
]) {
  test(`reject unsafe inherited ${key} (${sha256(value).slice(0, 8)}) without disclosing value`, () => {
    assert.throws(
      () => assertSyntheticReviewEnvironment({ ...cleanEnv, [key]: value }),
      (error) =>
        !error.message.includes("never-print-this") &&
        !error.message.includes("prod.example"),
    );
  });
}
test("production invocation stops without report or sensitive settings", () => {
  const result = run({
    ...cleanEnv,
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://unused:never-print-this@prod.example/live",
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /requires NODE_ENV=test/);
  assert.doesNotMatch(result.stderr, /never-print-this|prod.example/);
});
test("remote inherited database stops before loopback listener", () => {
  const result = run({
    ...cleanEnv,
    DATABASE_URL:
      "postgresql://unused:never-print-this@prod.example/planwren_review_disposable",
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /literal loopback/);
  assert.doesNotMatch(result.stderr, /never-print-this|prod.example/);
});
test("endpoint and credential arguments are unsupported", () => {
  const result = run(cleanEnv, ["--endpoint", "http://127.0.0.1:3000"]);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /No endpoint, credential, or database arguments/);
});

test("actual focused MCP/web routes satisfy all synthetic assertions with explicit host limitations", () => {
  const result = run({
    ...cleanEnv,
    JWT_SECRET: "inherited-sentinel-do-not-load",
    AI_PROVIDER_API_KEY: "inherited-sentinel-do-not-load",
    GH_TOKEN: "inherited-sentinel-do-not-load",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  const report = JSON.parse(result.stdout);
  const manifestBytes = fs.readFileSync(manifestPath);
  const manifest = JSON.parse(manifestBytes);
  assert.equal(report.package.manifestSha256, sha256(manifestBytes));
  assert.equal(report.package.name, manifest.name);
  assert.equal(report.package.version, manifest.version);
  assert.equal(
    report.package.publicEndpoint,
    "https://todos.theafoundry.com/mcp/app",
  );
  assert.match(report.source.head, /^[0-9a-f]{40}$/);
  assert.match(report.source.loadedSourceSha256, /^[0-9a-f]{64}$/);
  assert.ok(report.source.loadedSourceFileCount > 30);
  assert.equal(report.source.stableDuringRun, true);
  assert.equal(report.fixture.credentialsCreated, false);
  assert.equal(report.safety.environmentAllowlisted, true);
  assert.equal(report.safety.repositoryDotenvNotLoaded, true);
  assert.equal(report.safety.defaultDatabaseClientForbidden, true);
  assert.equal(report.safety.externalNetworkProbeBlocked, true);
  assert.equal(report.safety.unexpectedNetworkAttempts, 0);
  assert.doesNotMatch(
    result.stdout,
    /inherited-sentinel|fixture-full|fixture-read|Authorization|Bearer|\/Users\/|password|refreshToken/,
  );
  const rows = new Map(report.cases.map((entry) => [entry.id, entry]));
  assert.deepEqual([...rows.keys()].sort(), [
    "N1",
    "N2",
    "N3",
    "P1",
    "P2",
    "P3",
    "P4",
    "P5",
  ]);
  const allCases = [
    ...manifest.extensions["com.openai"].review.test_cases.positive,
    ...manifest.extensions["com.openai"].review.test_cases.negative,
  ];
  for (const sourceCase of allCases) {
    const id = sourceCase.description.slice(0, 2);
    assert.equal(rows.get(id).prompt, sourceCase.prompt);
    assert.equal(
      rows.get(id).descriptionSha256,
      sha256(sourceCase.description),
    );
    assert.equal(rows.get(id).hostStatus, "Not run");
    assert.equal(rows.get(id).status, "Passed local server assertions");
  }
  assert.equal(rows.get("P1").evidence.replayCreated, false);
  assert.equal(rows.get("P1").evidence.taskCountUnchanged, true);
  assert.equal(rows.get("P2").evidence.completedDailyItemIncluded, true);
  assert.equal(rows.get("P2").evidence.undatedCompletedItemExcluded, true);
  assert.equal(rows.get("P2").evidence.foreignTaskExcluded, true);
  const plan = rows.get("P3").evidence;
  assert.equal(plan.availableMinutes, 45);
  assert.equal(plan.energy, "low");
  assert.ok(plan.returnedIds.length >= 2);
  assert.equal(plan.renderMatchesPlan, true);
  assert.equal(plan.remainingMinutes, 45 - plan.totalMinutes);
  assert.equal(
    rows.get("P4").evidence.taskIdFromLatestPlan,
    plan.returnedIds[0],
  );
  assert.equal(
    rows.get("P5").evidence.taskIdFromLatestPlan,
    plan.returnedIds[1],
  );
  assert.equal(rows.get("P5").evidence.dueDatePreserved, true);
  assert.equal(rows.get("P5").evidence.equivalentRetryChanged, false);
  for (const id of ["N1", "N2", "N3"]) {
    assert.equal(rows.get(id).kind, "negative protocol probe");
    assert.equal(rows.get(id).evidence.mutationCount, 0);
    assert.equal(rows.get(id).evidence.hostNoToolSelectionNotExercised, true);
  }
  assert.equal(
    rows.get("N2").evidence.foreignTaskError,
    "RESOURCE_NOT_FOUND_OR_FORBIDDEN",
  );
  assert.equal(
    report.webCaptureReview.captureId,
    rows.get("P1").evidence.captureId,
  );
  assert.equal(report.webCaptureReview.acceptRetryCreated, false);
  assert.equal(report.webCaptureReview.captureReplayAfterAcceptCreated, false);
  assert.equal(report.webCaptureReview.noInferredDates, true);
  assert.equal(report.webCaptureReview.mcpContextAcceptStatus, 403);
  assert.equal(report.webCaptureReview.foreignCaptureReadStatus, 404);
  assert.equal(
    report.additionalScopeCheck.readOnlyCaptureError,
    "MCP_INSUFFICIENT_SCOPE",
  );
  assert.equal(report.hostReview.positive, "Not run (5 cases)");
  assert.equal(report.hostReview.negative, "Not run (3 cases)");
  assert.equal(report.hostReview.demo, "Not recorded, viewed or hosted");
  assert.equal(report.limitations.length, 4);

  const repeated = run();
  assert.equal(repeated.status, 0, repeated.stderr);
  const next = JSON.parse(repeated.stdout);
  // Fixed source, fixture clock and returned IDs make the assertions repeatable.
  delete report.executedAtUTC;
  delete next.executedAtUTC;
  assert.deepEqual(next, report);
});
