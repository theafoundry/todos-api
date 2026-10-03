const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const {
  applyApprovedSubmissionChanges,
} = require("../../test/helpers/mcp-approved-submission-contract");

const reviewedSnapshot = fs.readFileSync(
  path.join(__dirname, "../../test/fixtures/mcp-app-metadata.phase2.json"),
);
assert.equal(
  createHash("sha256").update(reviewedSnapshot).digest("hex"),
  "6e385ca644964340578b20149d48136ee7f9d0ed454764c3c86db6a3c244fe33",
  "The sealed Phase 2 fixture must not change to accommodate a catalog regression",
);
const reviewedModelTools = applyApprovedSubmissionChanges(
  JSON.parse(reviewedSnapshot.toString()).tools,
);

const expectedModelTools = [
  "list_today",
  "plan_today",
  "capture_task",
  "complete_task",
  "reschedule_task",
  "render_today_plan",
];
const expectedResourceUri = "ui://todos/today-plan/v1.html";

function assertToolContract({ tools, descriptor, metadata }) {
  assert.deepEqual(
    tools.map((tool) => tool.name),
    [...expectedModelTools, "open_today_plan"],
    "The complete catalog must contain exactly the six conversational tools and one app-only opener",
  );
  const modelTools = tools.filter(
    (tool) =>
      !tool._meta?.ui?.visibility || tool._meta.ui.visibility.includes("model"),
  );
  assert.deepEqual(
    modelTools.map((tool) => tool.name),
    expectedModelTools,
    "The app-only opener must not become model-visible or hide a conversational tool",
  );
  assert.deepEqual(
    modelTools,
    reviewedModelTools,
    "Conversational definitions must preserve Phase 2 with only the literal approved destructive annotations and Planwren renderer copy",
  );
  const uiTools = tools.filter((tool) => tool._meta?.ui);
  assert.deepEqual(
    uiTools.map((tool) => tool.name),
    ["render_today_plan", "open_today_plan"],
    "Only the renderer and app-only opener may link the Today Plan resource",
  );
  const [renderer, opener] = uiTools;
  assert.deepEqual(renderer._meta.ui, { resourceUri: expectedResourceUri });
  assert.equal(renderer._meta["openai/ui"], undefined);
  assert.deepEqual(opener._meta.ui, {
    resourceUri: expectedResourceUri,
    visibility: ["app"],
  });
  assert.deepEqual(opener._meta["openai/ui"], {
    entrypoints: [{ type: "thread" }],
  });
  assert.deepEqual(
    tools.filter((tool) => tool._meta?.["openai/ui"]).map((tool) => tool.name),
    ["open_today_plan"],
    "Only the app-only opener may advertise the thread entrypoint",
  );
  assert.deepEqual(opener.inputSchema, {
    type: "object",
    properties: {},
    additionalProperties: false,
  });
  assert.deepEqual(opener.annotations, {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  });
  const readSecurity = [
    { type: "oauth2", scopes: ["tasks.read", "projects.read"] },
  ];
  for (const tool of uiTools) {
    assert.deepEqual(tool.securitySchemes, readSecurity);
    assert.deepEqual(tool._meta.securitySchemes, readSecurity);
  }
  assert.equal(descriptor.uri, expectedResourceUri);
  assert.equal(descriptor.mimeType, "text/html;profile=mcp-app");
  assert.equal(
    descriptor.description,
    "A compact, interactive view of an authoritative Planwren day plan.",
  );
  assert.equal(metadata.ui.domain, "https://todos.theafoundry.com");
  assert.deepEqual(metadata.ui.csp, {
    connectDomains: [],
    resourceDomains: [],
  });
  assert.deepEqual(metadata["openai/ui"].availableDisplayModes, [
    "inline",
    "fullscreen",
  ]);
  return {
    toolCount: tools.length,
    modelToolCount: modelTools.length,
    appOnlyToolCount: 1,
    resourceCount: 1,
  };
}

module.exports = { assertToolContract };
