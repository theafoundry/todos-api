const assert = require("node:assert/strict");
const { test } = require("node:test");
const contract = require("../../dist/mcp/appContract");
const resource = require("../../dist/mcp/todayPlanResource");
const { assertToolContract } = require("./assert-tool-contract");

function fixture() {
  return structuredClone({
    tools: contract.buildNativeAppToolsList(),
    descriptor: resource.TODAY_PLAN_RESOURCE_DESCRIPTOR,
    metadata: resource.TODAY_PLAN_RESOURCE_META,
  });
}

test("accepts the six conversational tools and strictly app-only read-only opener", () => {
  assert.deepEqual(assertToolContract(fixture()), {
    toolCount: 7,
    modelToolCount: 6,
    appOnlyToolCount: 1,
    resourceCount: 1,
  });
});

for (const [name, change] of [
  [
    "an extra conversational tool",
    (data) => data.tools.push({ name: "delete_task" }),
  ],
  [
    "an extra hidden app-only tool",
    (data) =>
      data.tools.push({
        name: "hidden_admin",
        _meta: { ui: { visibility: ["app"] } },
      }),
  ],
  [
    "the opener promoted to model visibility",
    (data) => {
      data.tools[6]._meta.ui.visibility.push("model");
    },
  ],
  [
    "the renderer hidden from the model",
    (data) => {
      data.tools[5]._meta.ui.visibility = ["app"];
    },
  ],
  [
    "the opener exposed by implicit visibility",
    (data) => {
      delete data.tools[6]._meta.ui.visibility;
    },
  ],
  [
    "a missing app-only thread entrypoint",
    (data) => {
      delete data.tools[6]._meta["openai/ui"];
    },
  ],
  [
    "a parameterized opener",
    (data) => {
      data.tools[6].inputSchema.properties.userId = { type: "string" };
    },
  ],
  [
    "a writable opener annotation",
    (data) => {
      data.tools[6].annotations.readOnlyHint = false;
    },
  ],
  [
    "an expanded opener OAuth scope",
    (data) => {
      data.tools[6].securitySchemes = structuredClone(
        data.tools[6].securitySchemes,
      );
      data.tools[6].securitySchemes[0].scopes.push("tasks.write");
    },
  ],
  [
    "an expanded conversational OAuth scope",
    (data) => {
      data.tools[0].securitySchemes[0].scopes.push("tasks.write");
    },
  ],
  [
    "a changed conversational output schema",
    (data) => {
      data.tools[0].outputSchema.additionalProperties = true;
    },
  ],
  [
    "a changed conversational annotation",
    (data) => {
      data.tools[0].annotations.readOnlyHint = false;
    },
  ],
  ...["complete_task", "reschedule_task"].map((name) => [
    `a reverted destructive annotation on ${name}`,
    (data) => {
      data.tools.find(
        (tool) => tool.name === name,
      ).annotations.destructiveHint = false;
    },
  ]),
  ...["capture_task", "list_today"].map((name) => [
    `an unapproved destructive annotation on ${name}`,
    (data) => {
      data.tools.find(
        (tool) => tool.name === name,
      ).annotations.destructiveHint = true;
    },
  ]),
  [
    "a renderer description beyond the approved Planwren copy",
    (data) => {
      data.tools.find(
        (tool) => tool.name === "render_today_plan",
      ).description += " Extra behavior.";
    },
  ],
  [
    "a resource description beyond the approved Planwren copy",
    (data) => {
      data.descriptor.description += " Extra behavior.";
    },
  ],
  [
    "write scopes in the opener's metadata copy",
    (data) => {
      data.tools[6]._meta.securitySchemes = structuredClone(
        data.tools[6]._meta.securitySchemes,
      );
      data.tools[6]._meta.securitySchemes[0].scopes.push("tasks.write");
    },
  ],
  [
    "a destructive opener annotation",
    (data) => {
      data.tools[6].annotations.destructiveHint = true;
    },
  ],
  [
    "an open-world opener annotation",
    (data) => {
      data.tools[6].annotations.openWorldHint = true;
    },
  ],
  [
    "an opener permitting additional input",
    (data) => {
      data.tools[6].inputSchema.additionalProperties = true;
    },
  ],
  [
    "a second thread entrypoint",
    (data) => {
      data.tools[6]._meta["openai/ui"].entrypoints.push({ type: "thread" });
    },
  ],
  [
    "a thread entrypoint on another tool",
    (data) => {
      data.tools[0]._meta["openai/ui"] = { entrypoints: [{ type: "thread" }] };
    },
  ],
  [
    "mismatched advertised security metadata",
    (data) => {
      data.tools[6]._meta.securitySchemes = [];
    },
  ],
  [
    "a replaced resource identifier",
    (data) => {
      data.descriptor.uri = "ui://different/plan.html";
    },
  ],
  [
    "an opener linked to another resource",
    (data) => {
      data.tools[6]._meta.ui.resourceUri = "ui://different/plan.html";
    },
  ],
  [
    "an expanded widget connection CSP",
    (data) => {
      data.metadata.ui.csp.connectDomains.push("https://external.invalid");
    },
  ],
  [
    "an expanded widget resource CSP",
    (data) => {
      data.metadata.ui.csp.resourceDomains.push("https://external.invalid");
    },
  ],
  [
    "a changed component domain",
    (data) => {
      data.metadata.ui.domain = "https://different.invalid";
    },
  ],
  [
    "an unsupported display mode",
    (data) => {
      data.metadata["openai/ui"].availableDisplayModes.push("pip");
    },
  ],
]) {
  test(`rejects ${name}`, () => {
    const data = fixture();
    change(data);
    assert.throws(() => assertToolContract(data), assert.AssertionError);
  });
}
