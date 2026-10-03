const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const contract = require("../../dist/mcp/appContract");
const resource = require("../../dist/mcp/todayPlanResource");
const { assertToolContract } = require("./assert-tool-contract");

const phase1Golden = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "../mcp/native-golden-prompts.json"),
    "utf8",
  ),
);
const phase2Golden = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "today-plan-golden-prompts.json"),
    "utf8",
  ),
);
const phase3Golden = JSON.parse(
  fs.readFileSync(path.join(__dirname, "package-golden-prompts.json"), "utf8"),
);

module.exports = {
  name: "plugin",
  description:
    "Deterministic package, activation, and conversational-sequence evals for the Phase 3 Todos plugin.",
  trials: [
    {
      id: "plugin-phase3-package-integrity",
      type: "regression",
      description:
        "The installable package resolves its manifest, skill, MCP connection, and synthetic assets without private identifiers.",
      async run({ writeJson }) {
        const validation = spawnSync(
          process.execPath,
          [
            path.join(
              __dirname,
              "../../scripts/validate-todos-plugin-package.mjs",
            ),
          ],
          { cwd: path.join(__dirname, "../.."), encoding: "utf8" },
        );
        assert.equal(
          validation.status,
          0,
          validation.stderr || validation.stdout,
        );
        writeJson("package-validation.json", {
          command: "npm run validate:plugin",
          output: validation.stdout.trim(),
        });
        return { packageValid: true };
      },
    },
    {
      id: "plugin-phase3-activation-boundaries",
      type: "capability",
      description:
        "Supported daily workflows activate selectively while unrelated, unsupported, ambiguous, and injected prompts stay within scope.",
      async run({ writeJson }) {
        const toolNames = new Set(
          contract.buildNativeAppToolsList().map((tool) => tool.name),
        );
        const categories = new Set();
        for (const entry of phase3Golden) {
          categories.add(entry.category);
          assert.equal(typeof entry.expectedActivation, "boolean");
          assert.ok(Array.isArray(entry.expectedTools));
          for (const tool of [
            ...entry.expectedTools,
            ...(entry.forbiddenTools || []),
          ]) {
            assert.ok(
              toolNames.has(tool),
              `Unknown tool in ${entry.id}: ${tool}`,
            );
          }
          if (!entry.expectedActivation) {
            assert.deepEqual(
              entry.expectedTools,
              [],
              `${entry.id} over-activates`,
            );
          }
          const renderIndex = entry.expectedTools.indexOf("render_today_plan");
          if (renderIndex >= 0) {
            assert.ok(
              entry.expectedTools.slice(0, renderIndex).includes("plan_today"),
              `${entry.id} renders without a prior plan`,
            );
          }
          if (
            entry.expectedTools.includes("complete_task") ||
            entry.expectedTools.includes("reschedule_task")
          ) {
            assert.equal(
              entry.requiresContext,
              true,
              `${entry.id} mutates without contextual IDs`,
            );
          }
          if (entry.expectedTools.includes("capture_task")) {
            assert.equal(entry.maxToolCalls.capture_task, 1);
          }
        }
        for (const required of [
          "positive-activation",
          "selective-nonactivation",
          "unsupported",
          "ambiguous-write",
          "prompt-injection",
          "ui-behavior",
        ]) {
          assert.ok(categories.has(required), `Missing ${required} cases`);
        }
        writeJson("phase3-golden.json", phase3Golden);
        return {
          caseCount: phase3Golden.length,
          categories: [...categories],
          activated: phase3Golden.filter((entry) => entry.expectedActivation)
            .length,
          notActivated: phase3Golden.filter(
            (entry) => !entry.expectedActivation,
          ).length,
        };
      },
    },
    {
      id: "plugin-phase1-golden-preservation",
      type: "regression",
      description:
        "The sealed Phase 1 golden cases remain available as complete text-only workflows.",
      async run({ writeJson }) {
        assert.equal(phase1Golden.length, 8);
        for (const entry of phase1Golden) {
          assert.ok(Array.isArray(entry.expectedTools));
          assert.ok(!entry.expectedTools.includes("render_today_plan"));
        }
        writeJson("phase1-golden.json", phase1Golden);
        return { caseCount: phase1Golden.length, textOnlyCompatible: true };
      },
    },
    {
      id: "plugin-phase2-golden-sequences",
      type: "capability",
      description:
        "Phase 2 direct, indirect, follow-up, write, negative, injection, fallback, and component sequences are internally consistent.",
      async run({ writeJson }) {
        const toolNames = new Set(
          contract.buildNativeAppToolsList().map((tool) => tool.name),
        );
        const categories = new Set();
        for (const entry of phase2Golden) {
          categories.add(entry.category);
          for (const name of [
            ...entry.expectedTools,
            ...(entry.forbiddenTools || []),
          ]) {
            assert.ok(
              toolNames.has(name),
              `Unknown tool in ${entry.id}: ${name}`,
            );
          }
          const renderIndex = entry.expectedTools.indexOf("render_today_plan");
          if (renderIndex >= 0) {
            assert.ok(
              entry.expectedTools.slice(0, renderIndex).includes("plan_today"),
              `${entry.id} renders before plan_today`,
            );
          }
        }
        for (const required of [
          "direct",
          "indirect",
          "follow-up",
          "write",
          "negative",
          "prompt-injection",
          "fallback",
          "component-follow-up",
        ]) {
          assert.ok(categories.has(required), `Missing ${required} case`);
        }
        writeJson("phase2-golden.json", phase2Golden);
        return { caseCount: phase2Golden.length, categories: [...categories] };
      },
    },
    {
      id: "plugin-six-tool-resource-contract",
      type: "regression",
      description:
        "Six conversational tools and one read-only app-only opener share one bounded Today Plan resource.",
      async run({ writeJson }) {
        const tools = contract.buildNativeAppToolsList();
        const counts = assertToolContract({
          tools,
          descriptor: resource.TODAY_PLAN_RESOURCE_DESCRIPTOR,
          metadata: resource.TODAY_PLAN_RESOURCE_META,
        });
        writeJson("contract.json", {
          tools,
          resources: [resource.TODAY_PLAN_RESOURCE_DESCRIPTOR],
        });
        return counts;
      },
    },
    {
      id: "plugin-portable-widget-boundary",
      type: "capability",
      description:
        "The self-contained component uses portable MCP Apps methods and has no private network client or host-specific dependency.",
      async run({ writeJson }) {
        const html = resource.buildTodayPlanWidgetHtml(
          "https://todos.example/",
        );
        assert.match(html, /ui\/initialize/);
        assert.match(html, /tools\/call/);
        assert.match(html, /ui\/open-link/);
        assert.doesNotMatch(html, /window\.openai/);
        assert.doesNotMatch(html, /fetch\s*\(|XMLHttpRequest|<iframe/i);
        assert.doesNotMatch(html, /\/api\//i);
        writeJson("widget-boundary.json", {
          resourceUri: contract.TODAY_PLAN_RESOURCE_URI,
          mimeType: resource.TODAY_PLAN_RESOURCE_MIME_TYPE,
          csp: resource.TODAY_PLAN_RESOURCE_META.ui.csp,
          bridgeMethods: ["ui/initialize", "tools/call", "ui/open-link"],
        });
        return { portableBridge: true, directNetworkAccess: false };
      },
    },
  ],
};
