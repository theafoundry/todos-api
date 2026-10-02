import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  buildNativeAppToolsList,
  TODAY_PLAN_RESOURCE_URI,
} from "./mcp/appContract";

const root = path.resolve(__dirname, "..");

describe("Phase 3 installable plugin package", () => {
  it("passes package integrity validation", () => {
    const result = spawnSync(
      process.execPath,
      [path.join(root, "scripts", "validate-todos-plugin-package.mjs")],
      { cwd: root, encoding: "utf8" },
    );

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Todos plugin package valid");
  });

  it("generates the ignored registered-app mapping used by the plugin", () => {
    const temporaryDirectory = mkdtempSync(
      path.join(tmpdir(), "todos-plugin-app-"),
    );
    const outputPath = path.join(temporaryDirectory, ".app.json");

    try {
      const result = spawnSync(
        process.execPath,
        [
          path.join(root, "scripts", "configure-todos-plugin-app.mjs"),
          `plugin_asdk_app_${"a".repeat(32)}`,
          "--output",
          outputPath,
        ],
        { cwd: root, encoding: "utf8" },
      );

      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      expect(JSON.parse(readFileSync(outputPath, "utf8"))).toEqual({
        apps: {
          [`dev-${"a".repeat(32)}`]: {
            id: `asdk_app_${"a".repeat(32)}`,
          },
        },
      });
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("preserves the reviewed model tools while adding only an app panel opener", () => {
    const tools = buildNativeAppToolsList();
    const modelTools = tools.filter((tool) => {
      const visibility: readonly string[] | undefined =
        tool._meta.ui?.visibility;
      return !visibility || visibility.includes("model");
    });
    expect(modelTools.map((tool) => tool.name)).toEqual([
      "list_today",
      "plan_today",
      "capture_task",
      "complete_task",
      "reschedule_task",
      "render_today_plan",
    ]);
    expect(TODAY_PLAN_RESOURCE_URI).toBe("ui://todos/today-plan/v1.html");

    const snapshot = readFileSync(
      path.join(root, "test", "fixtures", "mcp-app-metadata.phase2.json"),
    );
    expect(createHash("sha256").update(snapshot).digest("hex")).toBe(
      "6e385ca644964340578b20149d48136ee7f9d0ed454764c3c86db6a3c244fe33",
    );
    expect(modelTools).toEqual(JSON.parse(snapshot.toString()).tools);
    expect(tools.filter((tool) => !modelTools.includes(tool))).toEqual([
      expect.objectContaining({
        name: "open_today_plan",
        title: "Today Plan",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        _meta: expect.objectContaining({
          ui: {
            resourceUri: TODAY_PLAN_RESOURCE_URI,
            visibility: ["app"],
          },
          "openai/ui": { entrypoints: [{ type: "thread" }] },
        }),
      }),
    ]);
  });
});
