import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
require("ts-node/register/transpile-only");
const {
  assertReviewResetAccount,
  assertReviewResetDatabase,
  assertReviewResetEnrollment,
  REVIEW_DATABASE_MARKER,
  REVIEW_DATABASE_NAME,
  validateReviewResetEnvironment,
} = require("./reset-review-safety.ts");
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

function environment(overrides = {}) {
  return {
    NODE_ENV: "test",
    DATABASE_URL:
      "postgresql://fixture_user:offline_only@127.0.0.1:5432/planwren_review_disposable",
    REVIEW_ACCOUNT_USER_ID: "synthetic-fixture-id",
    REVIEW_ACCOUNT_EMAIL: "fixture@example.invalid",
    REVIEW_RESET_CONFIRM: "RESET_DEDICATED_REVIEW_ACCOUNT",
    REVIEW_RESET_DISPOSABLE_CONFIRM: "RESET_LOCAL_DISPOSABLE_REVIEW_DATABASE",
    ...overrides,
  };
}

function rejectEnvironment(name, overrides, expected) {
  test(name, () => {
    const env = environment(overrides);
    assert.throws(() => validateReviewResetEnvironment(env), expected);
  });
}

test("accepts only explicit IPv4/IPv6 loopback disposable targets and freezes the config", () => {
  for (const host of ["127.0.0.1", "[::1]"]) {
    const env = environment({
      DATABASE_URL: `postgres://fixture_user:offline_only@${host}:55432/planwren_review_disposable`,
      REVIEW_ACCOUNT_EMAIL: "FIXTURE@EXAMPLE.INVALID",
      REVIEW_TIMEZONE: "UTC",
    });
    const config = validateReviewResetEnvironment(env);
    assert.equal(config.databaseUrl, env.DATABASE_URL);
    assert.equal(config.email, "fixture@example.invalid");
    assert.equal(config.timezone, "UTC");
    assert.ok(Object.isFrozen(config));
  }
});

for (const value of [undefined, "development", "production", "test "]) {
  rejectEnvironment(
    `rejects non-test environment ${String(value)}`,
    { NODE_ENV: value },
    /requires NODE_ENV=test/,
  );
}
for (const name of [
  "REVIEW_RESET_CONFIRM",
  "REVIEW_RESET_DISPOSABLE_CONFIRM",
  "DATABASE_URL",
  "REVIEW_ACCOUNT_USER_ID",
  "REVIEW_ACCOUNT_EMAIL",
]) {
  rejectEnvironment(`requires ${name}`, { [name]: undefined }, /is required/);
}
rejectEnvironment(
  "rejects incorrect account confirmation",
  { REVIEW_RESET_CONFIRM: "RESET_ANY_ACCOUNT" },
  /confirm the dedicated account/,
);
rejectEnvironment(
  "rejects incorrect disposable confirmation",
  { REVIEW_RESET_DISPOSABLE_CONFIRM: "RESET_HOSTED_DATABASE" },
  /confirm the local disposable database/,
);

for (const [label, host] of [
  ["hosted server", "db.example.invalid"],
  ["private network server", "10.0.0.1"],
  ["localhost DNS alias", "localhost"],
  ["trailing-dot local alias", "127.0.0.1."],
  ["shorthand loopback alias", "127.1"],
  ["integer loopback alias", "2130706433"],
  ["hexadecimal loopback alias", "0x7f000001"],
  ["encoded loopback host", "%31%32%37.0.0.1"],
  ["mapped IPv6 alias", "[::ffff:127.0.0.1]"],
  ["wildcard listener", "0.0.0.0"],
]) {
  rejectEnvironment(
    `rejects ${label}`,
    {
      DATABASE_URL: `postgresql://fixture_user:offline_only@${host}:5432/planwren_review_disposable`,
    },
    /literal loopback|local disposable PostgreSQL/,
  );
}

for (const [label, url] of [
  [
    "ordinary development database",
    "postgresql://fixture@127.0.0.1:5432/todos_dev",
  ],
  ["ordinary test database", "postgresql://fixture@127.0.0.1:5432/todos_test"],
  [
    "missing explicit port",
    "postgresql://fixture@127.0.0.1/planwren_review_disposable",
  ],
  [
    "missing explicit user",
    "postgresql://127.0.0.1:5432/planwren_review_disposable",
  ],
  [
    "invalid port",
    "postgresql://fixture@127.0.0.1:65536/planwren_review_disposable",
  ],
  [
    "padded port",
    "postgresql://fixture@127.0.0.1:05432/planwren_review_disposable",
  ],
  [
    "wrong protocol",
    "https://fixture@127.0.0.1:5432/planwren_review_disposable",
  ],
  [
    "database traversal",
    "postgresql://fixture@127.0.0.1:5432/a/../planwren_review_disposable",
  ],
  [
    "encoded database name",
    "postgresql://fixture@127.0.0.1:5432/%70lanwren_review_disposable",
  ],
  [
    "multiple hosts",
    "postgresql://fixture@127.0.0.1:5432,db.example.invalid:5432/planwren_review_disposable",
  ],
]) {
  rejectEnvironment(`rejects ${label}`, { DATABASE_URL: url }, /DATABASE_URL/);
}

for (const [label, suffix] of [
  ["host query override", "?host=db.example.invalid"],
  ["socket query override", "?host=%2Ftmp"],
  ["PostgreSQL URL options", "?options=-csearch_path%3Dpublic"],
  ["SSL query options", "?sslmode=require"],
  ["URL fragment", "#local"],
  ["trailing whitespace", " "],
]) {
  rejectEnvironment(
    `rejects ${label}`,
    { DATABASE_URL: `${environment().DATABASE_URL}${suffix}` },
    /URL options or unsafe syntax/,
  );
}

for (const name of [
  "PGHOST",
  "PGHOSTADDR",
  "PGPORT",
  "PGDATABASE",
  "PGSERVICE",
  "PGOPTIONS",
  "PGUSER",
  "PGPASSWORD",
]) {
  rejectEnvironment(
    `rejects inherited ${name}`,
    { [name]: "synthetic-override" },
    /Remove inherited PostgreSQL/,
  );
}
rejectEnvironment(
  "rejects a real-looking email",
  { REVIEW_ACCOUNT_EMAIL: "person@example.com" },
  /reserved fixture account/,
);
rejectEnvironment(
  "rejects another synthetic email",
  { REVIEW_ACCOUNT_EMAIL: "someone-else@example.invalid" },
  /reserved fixture account/,
);
rejectEnvironment(
  "rejects invalid timezone without reflecting its value",
  { REVIEW_TIMEZONE: "synthetic-private-timezone" },
  /^Error: REVIEW_TIMEZONE must be UTC for the local review fixture baseline$/,
);
rejectEnvironment(
  "rejects otherwise valid non-UTC fixture timezone",
  { REVIEW_TIMEZONE: "America/New_York" },
  /must be UTC/,
);
test("defaults the local baseline to UTC", () => {
  assert.equal(validateReviewResetEnvironment(environment()).timezone, "UTC");
});

function proof(overrides = {}) {
  return {
    databaseName: REVIEW_DATABASE_NAME,
    serverAddress: "127.0.0.1",
    marker: REVIEW_DATABASE_MARKER,
    ...overrides,
  };
}
test("accepts only the exact database marker and loopback server proof", () => {
  assert.doesNotThrow(() => assertReviewResetDatabase(proof()));
  assert.doesNotThrow(() =>
    assertReviewResetDatabase(proof({ serverAddress: "::1" })),
  );
});
for (const [label, overrides] of [
  ["a different database", { databaseName: "todos_prod" }],
  ["missing database marker", { marker: null }],
  ["a similar database marker", { marker: `${REVIEW_DATABASE_MARKER} ` }],
  ["a remote server behind loopback forwarding", { serverAddress: "10.0.0.1" }],
  ["a Docker/private server", { serverAddress: "172.17.0.2" }],
  ["a mapped loopback alias", { serverAddress: "::ffff:127.0.0.1" }],
  ["a Unix socket server", { serverAddress: null }],
]) {
  test(`rejects database proof with ${label}`, () => {
    assert.throws(
      () => assertReviewResetDatabase(proof(overrides)),
      /disposable database marker/,
    );
  });
}

test("requires the existing verified account ID and reserved email to agree", () => {
  const config = validateReviewResetEnvironment(environment());
  const account = {
    id: config.userId,
    email: config.email,
    isVerified: true,
  };
  assert.doesNotThrow(() => assertReviewResetAccount(account, config));
  for (const rejected of [
    null,
    { ...account, id: "other-fixture-id" },
    { ...account, email: null },
    { ...account, email: "other@example.invalid" },
  ]) {
    assert.throws(
      () => assertReviewResetAccount(rejected, config),
      /same existing fixture account/,
    );
  }
  assert.throws(
    () => assertReviewResetAccount({ ...account, isVerified: false }, config),
    /must already be verified/,
  );
});

test("requires an existing UTC enrollment without provisioning or changing it", () => {
  assert.doesNotThrow(() => assertReviewResetEnrollment({ timezone: "UTC" }));
  for (const enrollment of [
    null,
    { timezone: "America/New_York" },
    { timezone: "" },
    { timezone: "not-a-timezone" },
  ]) {
    assert.throws(
      () => assertReviewResetEnrollment(enrollment),
      /existing UTC agent enrollment/,
    );
  }
});

test("CLI rejects unsafe input before importing dotenv or Prisma, even beside a populated .env", () => {
  const temporary = fs.mkdtempSync(
    path.join(os.tmpdir(), "planwren-reset-guard-"),
  );
  const hook = path.join(temporary, "block-sensitive-imports.cjs");
  const marker = path.join(temporary, "sensitive-import-attempted");
  fs.writeFileSync(
    hook,
    `const fs = require("node:fs");
const Module = require("node:module");
const original = Module._load;
Module._load = function (name, ...args) {
  if (name === "dotenv" || name.startsWith("dotenv/") || name.startsWith("@prisma/")) {
    fs.writeFileSync(process.env.RESET_GUARD_TEST_MARKER, name);
    throw new Error("Offline test blocked a sensitive import");
  }
  return original.call(this, name, ...args);
};`,
  );
  fs.writeFileSync(
    path.join(temporary, ".env"),
    Object.entries(environment())
      .map(([key, value]) => `${key}=${value}`)
      .join("\n"),
  );
  function run(env) {
    return spawnSync(
      process.execPath,
      [
        "--require",
        hook,
        "--require",
        require.resolve("ts-node/register/transpile-only"),
        path.join(root, "scripts/review/reset-review-account.ts"),
      ],
      {
        cwd: temporary,
        env: {
          PATH: process.env.PATH,
          TS_NODE_PROJECT: path.join(root, "tsconfig.json"),
          RESET_GUARD_TEST_MARKER: marker,
          ...env,
        },
        encoding: "utf8",
        timeout: 10_000,
      },
    );
  }
  try {
    for (const env of [
      {},
      environment({ NODE_ENV: "production" }),
      environment({
        DATABASE_URL:
          "postgresql://never-print-this:never-print-this@db.example.invalid:5432/todos_prod",
      }),
      environment({ REVIEW_ACCOUNT_EMAIL: "never-print-this@example.com" }),
      environment({ PGHOST: "never-print-this.example.invalid" }),
    ]) {
      const result = run(env);
      assert.ifError(result.error);
      assert.equal(result.status, 1);
      assert.equal(fs.existsSync(marker), false);
      assert.doesNotMatch(
        result.stdout + result.stderr,
        /never-print-this|offline_only|postgresql:\/\//,
      );
    }
    // Prove the hook is active without allowing a client import/DB connection.
    const result = run(environment());
    assert.ifError(result.error);
    assert.equal(result.status, 1);
    assert.equal(fs.readFileSync(marker, "utf8"), "@prisma/adapter-pg");
    assert.match(result.stderr, /Local review fixture reset failed/);
    assert.doesNotMatch(
      result.stderr,
      /Offline test blocked|offline_only|fixture@example.invalid/,
    );
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test("CLI checks database/account proof before mutation and sanitizes client errors using offline Prisma stand-ins", () => {
  const temporary = fs.mkdtempSync(
    path.join(os.tmpdir(), "planwren-reset-flow-"),
  );
  const hook = path.join(temporary, "offline-prisma.cjs");
  const operations = path.join(temporary, "operations");
  fs.writeFileSync(
    hook,
    `const fs = require("node:fs");
const Module = require("node:module");
const assert = require("node:assert/strict");
const original = Module._load;
const scenario = process.env.RESET_GUARD_TEST_SCENARIO;
const record = (operation) => fs.appendFileSync(process.env.RESET_GUARD_TEST_OPERATIONS, operation + "\\n");
global.Date = class extends Date {
  constructor(value) { super(arguments.length ? value : "2026-10-11T23:30:00.000Z"); }
};
Module._load = function (name, ...args) {
  if (name === "dotenv" || name.startsWith("dotenv/")) throw new Error("Offline test blocks dotenv");
  if (name === "@prisma/adapter-pg") return { PrismaPg: class {} };
  if (name === "@prisma/client") return { PrismaClient: class {
    constructor() {
      if (scenario === "client-error") throw new Error("DATABASE_URL postgresql://never-print-this:never-print-this@private.example.invalid/db fixture@example.invalid");
    }
    async $transaction(callback) {
      record("transaction");
      const databaseProof = {
        databaseName: "planwren_review_disposable",
        serverAddress: "127.0.0.1",
        marker: "PLANWREN_DISPOSABLE_LOCAL_REVIEW_FIXTURES_ONLY",
      };
      if (scenario === "wrong-database") databaseProof.databaseName = "todos_prod";
      if (scenario === "remote-server") databaseProof.serverAddress = "10.0.0.1";
      if (scenario === "missing-marker") databaseProof.marker = null;
      const account = { id: "synthetic-fixture-id", email: "fixture@example.invalid", isVerified: true };
      if (scenario === "wrong-account") account.email = "another@example.invalid";
      if (scenario === "unverified-account") account.isVerified = false;
      const mutation = (operation, result) => async () => { record(operation); return result; };
      await callback({
        $queryRaw: async () => { record("database-proof"); return scenario === "no-database-proof" ? [] : [databaseProof]; },
        user: { findUnique: async (input) => {
          assert.deepEqual(input.select, { id: true, email: true, isVerified: true });
          record("account-proof"); return account;
        } },
        todo: {
          deleteMany: mutation("delete-tasks", {}),
          createMany: async ({ data }) => {
            record("create-tasks");
            fs.writeFileSync(process.env.RESET_GUARD_TEST_OPERATIONS + ".rows.json", JSON.stringify(data));
            return {};
          },
        },
        project: { deleteMany: mutation("delete-projects", {}), create: mutation("create-project", { id: "synthetic-project-id" }) },
        userPlanningPreferences: { upsert: mutation("planning-preferences", {}) },
        agentEnrollment: { findUnique: async (input) => {
          assert.deepEqual(input.select, { timezone: true });
          record("enrollment-proof");
          if (scenario === "missing-enrollment") return null;
          return { timezone: scenario === "wrong-enrollment-timezone" ? "America/New_York" : "UTC" };
        } },
      });
    }
    async $disconnect() { record("disconnect"); }
  } };
  if (name.startsWith("@prisma/")) throw new Error("Offline test blocks actual Prisma imports");
  return original.call(this, name, ...args);
};`,
  );
  function run(scenario) {
    fs.rmSync(operations, { force: true });
    const result = spawnSync(
      process.execPath,
      [
        "--require",
        hook,
        "--require",
        require.resolve("ts-node/register/transpile-only"),
        path.join(root, "scripts/review/reset-review-account.ts"),
      ],
      {
        cwd: temporary,
        env: {
          PATH: process.env.PATH,
          TS_NODE_PROJECT: path.join(root, "tsconfig.json"),
          RESET_GUARD_TEST_OPERATIONS: operations,
          RESET_GUARD_TEST_SCENARIO: scenario,
          ...environment(),
        },
        encoding: "utf8",
        timeout: 10_000,
      },
    );
    assert.ifError(result.error);
    assert.doesNotMatch(
      result.stdout + result.stderr,
      /never-print-this|offline_only|fixture@example.invalid|postgresql:\/\//,
    );
    return {
      result,
      calls: fs.existsSync(operations)
        ? fs.readFileSync(operations, "utf8").trim().split("\n")
        : [],
    };
  }
  try {
    for (const scenario of [
      "wrong-database",
      "remote-server",
      "missing-marker",
      "no-database-proof",
    ]) {
      const { result, calls } = run(scenario);
      assert.equal(result.status, 1);
      assert.deepEqual(calls, ["transaction", "database-proof", "disconnect"]);
    }
    for (const scenario of ["wrong-account", "unverified-account"]) {
      const { result, calls } = run(scenario);
      assert.equal(result.status, 1);
      assert.deepEqual(calls, [
        "transaction",
        "database-proof",
        "account-proof",
        "disconnect",
      ]);
    }
    for (const scenario of [
      "missing-enrollment",
      "wrong-enrollment-timezone",
    ]) {
      const { result, calls } = run(scenario);
      assert.equal(result.status, 1);
      assert.deepEqual(calls, [
        "transaction",
        "database-proof",
        "account-proof",
        "enrollment-proof",
        "disconnect",
      ]);
      assert.match(result.stderr, /existing UTC agent enrollment/);
    }
    const clientError = run("client-error");
    assert.equal(clientError.result.status, 1);
    assert.deepEqual(clientError.calls, []);
    assert.match(
      clientError.result.stderr,
      /Local review fixture reset failed/,
    );
    const success = run("accepted-synthetic-fixture");
    assert.equal(success.result.status, 0);
    assert.deepEqual(success.calls, [
      "transaction",
      "database-proof",
      "account-proof",
      "enrollment-proof",
      "delete-tasks",
      "delete-projects",
      "create-project",
      "create-project",
      "create-tasks",
      "planning-preferences",
      "disconnect",
    ]);
    assert.match(
      success.result.stdout,
      /Reset local disposable fixture account/,
    );
    const rows = JSON.parse(fs.readFileSync(operations + ".rows.json", "utf8"));
    assert.equal(rows.length, 6);
    const sample = (name) => rows.find((row) => row.title === name);
    for (const [name, minutes] of [
      ["Review sample A", 15],
      ["Review sample B", 15],
      ["Review sample C", 10],
    ]) {
      const row = sample(name);
      assert.equal(row.energy, "low");
      assert.equal(row.estimateMinutes, minutes);
      assert.equal(row.effortScore, minutes);
      assert.equal(row.completed ?? false, false);
    }
    assert.equal(sample("Review sample A").dueDate, "2026-10-11T17:00:00.000Z");
    assert.equal(
      sample("Review sample B").scheduledDate,
      "2026-10-11T14:00:00.000Z",
    );
    assert.equal(sample("Review sample B").dueDate, "2026-10-12T17:00:00.000Z");
    assert.equal(sample("Review sample C").dueDate, "2026-10-10T17:00:00.000Z");
    const completed = sample("Review completed sample");
    assert.equal(completed.completed, true);
    assert.equal(completed.status, "done");
    assert.equal(completed.completedAt, "2026-10-11T23:30:00.000Z");
    assert.equal(completed.dueDate, "2026-10-11T17:00:00.000Z");
    assert.equal(completed.estimateMinutes, 5);
    assert.equal(completed.effortScore, 5);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
