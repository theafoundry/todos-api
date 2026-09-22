import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

const portalPath = process.env.REVIEW_PORTAL_SCAN_PATH || process.argv[2];
if (!portalPath) {
  console.error(
    "Set REVIEW_PORTAL_SCAN_PATH or pass the sanitized portal contract JSON path",
  );
  process.exit(2);
}

const expectedPath = path.resolve("test/fixtures/mcp-app-metadata.phase2.json");
const expected = JSON.parse(fs.readFileSync(expectedPath, "utf8"));
const rawPortal = JSON.parse(fs.readFileSync(path.resolve(portalPath), "utf8"));
const portal = rawPortal.contract || rawPortal.metadata || rawPortal;

if (!isDeepStrictEqual(portal, expected)) {
  console.error(
    "Portal scan is not canonically equivalent to the committed MCP metadata snapshot.",
  );
  console.error(
    "The comparison intentionally allows no contract-field substitutions; remove portal envelope fields before comparing.",
  );
  process.exit(1);
}

console.log("Portal scan is canonically equivalent to committed MCP metadata.");
