import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "issue-alert.mjs",
);

const ALERT_LABELS = ["harness-alert", "type:ci-alert"];
const TITLE = "Harness regression: Harness Regression failed (f3d5e79)";
const RUN_URL = "https://github.com/example/todos-api/actions/runs/123456";
const BODY = `## Harness regression\n- workflow: Harness Regression\n- run: ${RUN_URL}\n- branch: refs/heads/master\n- commit: f3d5e79\n\nView logs: ${RUN_URL}`;

// Stand-in for the gh CLI, modelled on the real one:
// - create/comment refuse to run non-interactively without a body flag, and
//   only read the body from stdin with `--body-file -`;
// - `issue create` resolves every --label before creating and aborts if one
//   does not exist in the repository;
// - `issue list --label X` only matches issues carrying label X.
// Repository state comes from FAKE_GH_LABELS / FAKE_GH_OPEN_ISSUES (JSON), and
// FAKE_GH_FAIL names one command ("label list", "issue list", "issue create",
// "issue comment") that should fail like an API error.
const FAKE_GH = `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const flagValues = (names) =>
  args.flatMap((arg, index) => (names.includes(arg) ? [args[index + 1]] : []));
const bodyFromStdin = flagValues(["--body-file", "-F"]).includes("-");
const stdin = bodyFromStdin ? fs.readFileSync(0, "utf8") : null;
fs.appendFileSync(process.env.FAKE_GH_LOG, JSON.stringify({ args, stdin }) + "\\n");

const command = args.slice(0, 2).join(" ");
const labels = JSON.parse(process.env.FAKE_GH_LABELS ?? "[]");
const openIssues = JSON.parse(process.env.FAKE_GH_OPEN_ISSUES ?? "[]");
const fail = (message, code = 1) => {
  process.stderr.write(message + "\\n");
  process.exit(code);
};

if (process.env.FAKE_GH_FAIL === command) {
  fail("HTTP 502: Bad Gateway (https://api.github.com/graphql)");
}
if (command === "label list") {
  process.stdout.write(JSON.stringify(labels.map((name) => ({ name }))));
  process.exit(0);
}
if (command === "issue list") {
  const wanted = flagValues(["--label", "-l"]);
  const matches = openIssues
    .filter((issue) => wanted.every((label) => issue.labels.includes(label)))
    .map((issue) => ({
      number: issue.number,
      title: issue.title,
      labels: issue.labels.map((name) => ({ name })),
    }));
  const jq = flagValues(["--jq", "-q"])[0];
  if (jq === ".[0].number") {
    process.stdout.write(matches.length ? String(matches[0].number) : "");
  } else {
    process.stdout.write(JSON.stringify(matches));
  }
  process.exit(0);
}
if (command === "issue create" || command === "issue comment") {
  if (flagValues(["--body", "-b", "--body-file", "-F"]).length === 0) {
    fail("must provide \`--title\` and \`--body\` when not running interactively");
  }
  if (command === "issue create") {
    for (const label of flagValues(["--label", "-l"])) {
      if (!labels.includes(label)) {
        fail("could not add label: '" + label + "' not found");
      }
    }
  }
  process.stdout.write("https://github.example/issues/1\\n");
  process.exit(0);
}
fail("fake gh: unexpected command " + args.join(" "), 2);
`;

function runAlert({ labels = ALERT_LABELS, openIssues = [], fail } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "issue-alert-test-"));
  const binDir = path.join(dir, "bin");
  const logFile = path.join(dir, "gh-calls.jsonl");
  fs.mkdirSync(binDir);
  fs.writeFileSync(path.join(binDir, "gh"), FAKE_GH, { mode: 0o755 });
  fs.writeFileSync(logFile, "");

  // Build the environment from scratch: only the fake gh and node are on PATH
  // and no GitHub credentials are inherited, so a real gh can never run.
  const env = {
    PATH: [binDir, path.dirname(process.execPath)].join(path.delimiter),
    FAKE_GH_LOG: logFile,
    FAKE_GH_LABELS: JSON.stringify(labels),
    FAKE_GH_OPEN_ISSUES: JSON.stringify(openIssues),
    GITHUB_REPOSITORY: "example/todos-api",
    GITHUB_WORKFLOW: "Harness Regression",
    GITHUB_RUN_ID: "123456",
    GITHUB_SHA: "f3d5e791a3983746ffffca3356d36bf5c70e73d5",
    GITHUB_REF: "refs/heads/master",
  };
  if (fail) env.FAKE_GH_FAIL = fail;

  const result = spawnSync(process.execPath, [script], {
    env,
    encoding: "utf8",
    timeout: 30_000,
  });
  const calls = fs
    .readFileSync(logFile, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  fs.rmSync(dir, { recursive: true, force: true });
  return { ...result, calls };
}

const commandOf = (call) => call.args.slice(0, 2).join(" ");
const flagValues = (call, flag) =>
  call.args.flatMap((arg, index) =>
    arg === flag ? [call.args[index + 1]] : [],
  );
const writes = (result) =>
  result.calls.filter((call) =>
    ["issue create", "issue comment"].includes(commandOf(call)),
  );

function assertSingleCreate(result, expectedLabels) {
  assert.equal(result.status, 0, result.stderr);
  const [create, ...rest] = writes(result);
  assert.equal(rest.length, 0, "exactly one alert write");
  assert.equal(commandOf(create), "issue create");
  assert.deepEqual(flagValues(create, "--title"), [TITLE]);
  assert.deepEqual(flagValues(create, "--label"), expectedLabels);
  assert.deepEqual(flagValues(create, "--body-file"), ["-"]);
  assert.equal(create.stdin, BODY);
}

function assertSingleComment(result, issueNumber) {
  assert.equal(result.status, 0, result.stderr);
  const [comment, ...rest] = writes(result);
  assert.equal(rest.length, 0, "comments instead of opening a duplicate");
  assert.deepEqual(comment.args.slice(0, 3), [
    "issue",
    "comment",
    String(issueNumber),
  ]);
  assert.deepEqual(flagValues(comment, "--body-file"), ["-"]);
  assert.equal(comment.stdin, BODY);
}

test("creates a labelled issue with the alert body when none is open", () => {
  const result = runAlert();

  assertSingleCreate(result, ALERT_LABELS);
  assert.doesNotMatch(result.stderr, /::warning::/);
});

test("creates the alert without labels the repository does not have", () => {
  const result = runAlert({ labels: ["bug", "enhancement"] });

  assertSingleCreate(result, []);
  assert.match(
    result.stderr,
    /::warning::.*harness-alert, type:ci-alert/,
    "names the missing labels",
  );
});

test("keeps the alert labels that do exist", () => {
  const result = runAlert({ labels: ["bug", "type:ci-alert"] });

  assertSingleCreate(result, ["type:ci-alert"]);
  assert.match(result.stderr, /::warning::.*harness-alert/);
});

test("comments on the open labelled alert instead of opening a duplicate", () => {
  const result = runAlert({
    openIssues: [
      { number: 7, title: "Unrelated bug", labels: ["bug"] },
      { number: 42, title: "Earlier harness alert", labels: ["harness-alert"] },
    ],
  });

  assertSingleComment(result, 42);
});

test("deduplicates by alert title when the repository has no alert labels", () => {
  const result = runAlert({
    labels: [],
    openIssues: [
      { number: 7, title: "Unrelated bug", labels: [] },
      {
        number: 58,
        title: "Harness regression: Harness Regression failed (abc1234)",
        labels: [],
      },
    ],
  });

  assertSingleComment(result, 58);
});

test("fails loudly without writing when open alerts cannot be read", () => {
  const result = runAlert({ fail: "issue list" });

  assert.notEqual(result.status, 0);
  assert.equal(
    writes(result).length,
    0,
    "must not treat a read error as no alert",
  );
  assert.match(result.stderr, /::error::.*gh issue list/);
});

test("fails loudly without writing when repository labels cannot be read", () => {
  const result = runAlert({ fail: "label list" });

  assert.notEqual(result.status, 0);
  assert.equal(writes(result).length, 0);
  assert.match(result.stderr, /::error::.*gh label list/);
});

test("fails loudly when gh cannot create the alert", () => {
  const result = runAlert({ fail: "issue create" });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /HTTP 502/);
  assert.match(result.stderr, /::error::.*gh issue create/);
});

test("fails loudly when gh cannot comment on the open alert", () => {
  const result = runAlert({
    fail: "issue comment",
    openIssues: [{ number: 42, title: TITLE, labels: ["harness-alert"] }],
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /::error::.*gh issue comment/);
});
