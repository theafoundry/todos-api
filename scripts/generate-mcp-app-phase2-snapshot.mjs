import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { format } from "prettier";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const contract = require(path.join(repoRoot, "dist/mcp/appContract.js"));
const resource = require(path.join(repoRoot, "dist/mcp/todayPlanResource.js"));

const snapshot = {
  server: {
    name: contract.MCP_APP_SERVER_NAME,
    version: contract.MCP_APP_SERVER_VERSION,
    instructions: contract.MCP_APP_SERVER_INSTRUCTIONS,
  },
  tools: contract.buildNativeAppToolsList(),
  resources: [resource.TODAY_PLAN_RESOURCE_DESCRIPTOR],
  resourceContents: [
    {
      uri: contract.TODAY_PLAN_RESOURCE_URI,
      mimeType: resource.TODAY_PLAN_RESOURCE_MIME_TYPE,
      _meta: resource.TODAY_PLAN_RESOURCE_META,
    },
  ],
};

const outputPath = path.join(
  repoRoot,
  "test/fixtures/mcp-app-metadata.phase2.json",
);
const formattedSnapshot = await format(JSON.stringify(snapshot), {
  parser: "json",
});
const relativeOutputPath = path.relative(repoRoot, outputPath);

if (process.argv.includes("--check")) {
  const committedSnapshot = fs.readFileSync(outputPath, "utf8");
  if (committedSnapshot !== formattedSnapshot) {
    console.error(
      `${relativeOutputPath} does not match generated MCP app metadata. Run npm run snapshot:mcp-app:phase2 and review the contract change.`,
    );
    process.exit(1);
  }
  console.info(`${relativeOutputPath} matches generated metadata.`);
} else {
  fs.writeFileSync(outputPath, formattedSnapshot, "utf8");
  console.info(relativeOutputPath);
}
