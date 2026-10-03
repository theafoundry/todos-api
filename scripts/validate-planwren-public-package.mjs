import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import * as yaml from "js-yaml";

const repository = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const schemas = path.join(
  repository,
  "scripts/review/planwren-package-schemas",
);
const archiveUtility = path.join(
  repository,
  "scripts/build-planwren-public-package.py",
);
export const expectedTools = [
  "list_today",
  "plan_today",
  "capture_task",
  "complete_task",
  "reschedule_task",
  "render_today_plan",
];
const endpoint = "https://todos.theafoundry.com/mcp/app";
const permittedUrls = {
  websiteURL: "https://www.planwren.com",
  supportURL: "https://www.planwren.com/support",
  privacyPolicyURL: "https://www.planwren.com/privacy",
  termsOfServiceURL: "https://www.planwren.com/terms",
};
const decoder = new TextDecoder("utf-8", { fatal: true });
const ajv = new Ajv2020({ allErrors: true, strict: true });

function json(file) {
  return JSON.parse(decoder.decode(fs.readFileSync(file)));
}

function object(value, label, allowed) {
  assert.ok(
    value && typeof value === "object" && !Array.isArray(value),
    `${label} must be an object`,
  );
  if (allowed)
    for (const key of Object.keys(value)) {
      assert.ok(
        allowed.includes(key),
        `${label}.${key} is outside this public package's supported fields`,
      );
    }
}

function text(value, label, max, multiline = false) {
  assert.equal(typeof value, "string", `${label} must be text`);
  assert.ok(
    value.trim().length > 0 && value.length <= max,
    `${label} is empty or exceeds ${max} characters`,
  );
  assert.doesNotMatch(
    value,
    multiline
      ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/u
      : /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/u,
    `${label} contains unsupported characters`,
  );
}

function httpsUrl(value, label, max = 1024) {
  text(value, label, max);
  assert.equal(value, value.trim(), `${label} has outer whitespace`);
  assert.doesNotMatch(value, /\s/u, `${label} contains unescaped whitespace`);
  const url = new URL(value);
  assert.equal(url.protocol, "https:", `${label} must use HTTPS`);
  assert.ok(
    url.hostname && !url.username && !url.password,
    `${label} must not embed credentials`,
  );
}

function normalize(name) {
  return name.normalize("NFC").toLowerCase();
}

function listFiles(root) {
  const files = [];
  const normalized = new Set();
  function visit(directory) {
    for (const name of fs.readdirSync(directory).sort()) {
      const full = path.join(directory, name);
      const relative = path.relative(root, full).split(path.sep).join("/");
      assert.ok(
        relative.split("/").length <= 20 && Buffer.byteLength(relative) <= 1024,
        `${relative}: unsafe path length`,
      );
      assert.ok(
        !relative
          .split("/")
          .some(
            (part) =>
              !part ||
              part !== part.trim() ||
              part.startsWith(".") ||
              /[\\\u0000-\u001f\u007f]/u.test(part),
          ),
        `${relative}: unsafe path`,
      );
      const key = normalize(relative);
      assert.ok(!normalized.has(key), `${relative}: normalized path collision`);
      normalized.add(key);
      const stat = fs.lstatSync(full);
      assert.ok(!stat.isSymbolicLink(), `${relative}: symlinks are prohibited`);
      if (stat.isDirectory()) visit(full);
      else {
        assert.ok(stat.isFile(), `${relative}: must be a regular file`);
        assert.equal(
          stat.mode & 0o111,
          0,
          `${relative}: executable files are prohibited`,
        );
        assert.ok(
          stat.size <= 100 * 1024 * 1024,
          `${relative}: exceeds entry size limit`,
        );
        assert.ok(
          /^(?:plugin\.json|mcp\.json|assets\/[^/]+\.(?:png|svg)|skills\/today-planning\/SKILL\.md|skills\/today-planning\/agents\/openai\.yaml)$/.test(
            relative,
          ),
          `${relative}: unrelated or unsupported package file`,
        );
        const bytes = fs.readFileSync(full);
        files.push({
          path: relative,
          bytes: stat.size,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        });
      }
    }
  }
  assert.ok(
    fs.lstatSync(root).isDirectory() && !fs.lstatSync(root).isSymbolicLink(),
    "package root must be a real directory",
  );
  visit(root);
  assert.ok(
    files.length > 0 && files.length <= 5000,
    "package must contain 1–5000 files",
  );
  assert.ok(
    files.reduce((sum, file) => sum + file.bytes, 0) <= 512 * 1024 * 1024,
    "package exceeds 512 MiB",
  );
  return files;
}

function schemaCheck(value, name) {
  const schema = json(path.join(schemas, `${name}.schema.json`));
  const validate = ajv.getSchema(schema.$id) || ajv.compile(schema);
  assert.ok(
    validate(value),
    `${name} does not match official Agent Plugins 1.0.0 schema: ${ajv.errorsText(validate.errors)}`,
  );
}

function relativeAsset(root, relative, label) {
  text(relative, label, 1024);
  assert.match(relative, /^\.\//, `${label} must start with ./`);
  const segments = relative.slice(2).split("/");
  assert.ok(
    segments.every(
      (segment) =>
        segment &&
        segment !== "." &&
        segment !== ".." &&
        !/[\\:]/.test(segment),
    ),
    `${label} contains unsafe traversal`,
  );
  assert.equal(relative, relative.trim(), `${label} has outer whitespace`);
  const file = path.resolve(root, relative);
  assert.ok(
    file.startsWith(`${root}${path.sep}`),
    `${label} escapes the package`,
  );
  assert.ok(
    fs.lstatSync(file).isFile() && !fs.lstatSync(file).isSymbolicLink(),
    `${label} must name a regular file`,
  );
  return file;
}

function luminance(color) {
  const linear = color
    .slice(1)
    .match(/../g)
    .map((hex) => parseInt(hex, 16) / 255)
    .map((channel) =>
      channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
    );
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

function validateInterface(root, value) {
  object(value, "interface", [
    "displayName",
    "shortDescription",
    "longDescription",
    "developerName",
    "category",
    "capabilities",
    "websiteURL",
    "supportURL",
    "privacyPolicyURL",
    "termsOfServiceURL",
    "defaultPrompt",
    "brandColor",
    "brandColorDark",
    "composerIcon",
    "composerIconDark",
    "logo",
    "logoDark",
    "screenshots",
  ]);
  for (const [key, max] of Object.entries({
    displayName: 30,
    shortDescription: 30,
    longDescription: 4000,
    developerName: 80,
  }))
    text(value[key], `interface.${key}`, max, key === "longDescription");
  assert.equal(value.displayName, "Planwren");
  assert.equal(value.developerName, "Thea Foundry");
  assert.equal(value.category, "Productivity");
  for (const [key, expected] of Object.entries(permittedUrls)) {
    httpsUrl(value[key], `interface.${key}`);
    assert.equal(
      value[key],
      expected,
      `interface.${key} must use the approved public publisher URL`,
    );
  }
  if (value.capabilities !== undefined) {
    assert.ok(
      Array.isArray(value.capabilities) && value.capabilities.length <= 20,
      "capabilities must be a list of at most 20 labels",
    );
    for (const entry of value.capabilities) text(entry, "capability", 120);
  }
  const prompts =
    value.defaultPrompt === undefined
      ? []
      : typeof value.defaultPrompt === "string"
        ? [value.defaultPrompt]
        : value.defaultPrompt;
  assert.ok(
    Array.isArray(prompts) && prompts.length <= 3,
    "at most three starter prompts are allowed",
  );
  const unique = new Set();
  for (const prompt of prompts) {
    text(prompt, "starter prompt", 128);
    assert.doesNotMatch(
      prompt,
      /@\S+/u,
      "starter prompts must not contain MCP mentions",
    );
    const key = prompt
      .normalize("NFKC")
      .trim()
      .replace(/\s+/gu, " ")
      .toLowerCase();
    assert.ok(
      !unique.has(key),
      "starter prompts must be unique after normalization",
    );
    unique.add(key);
  }
  for (const [key, background] of [
    ["brandColor", "#FFFFFF"],
    ["brandColorDark", "#212121"],
  ])
    if (value[key] !== undefined) {
      assert.match(value[key], /^#[0-9a-f]{6}$/i, `${key} must be #RRGGBB`);
      const levels = [luminance(value[key]), luminance(background)].sort(
        (a, b) => a - b,
      );
      assert.ok(
        (levels[1] + 0.05) / (levels[0] + 0.05) >= 2,
        `${key} must have at least 2:1 contrast`,
      );
    }
  const icons = ["logo", "composerIcon"];
  for (const key of ["logoDark", "composerIconDark"])
    if (value[key] !== undefined) icons.push(key);
  const iconFiles = icons.map((key) => relativeAsset(root, value[key], key));
  assert.ok(
    value.screenshots === undefined ||
      (Array.isArray(value.screenshots) && value.screenshots.length === 0),
    "fresh authenticated screenshots are pending; omit screenshots from this package",
  );
  const images = spawnSync(
    "python3",
    [archiveUtility, "inspect-images", ...iconFiles],
    { encoding: "utf8" },
  );
  assert.equal(images.status, 0, `image validation failed: ${images.stderr}`);
  return JSON.parse(images.stdout);
}

function validateReview(review) {
  object(review, "review", [
    "test_cases",
    "demo_recording_url",
    "commerce",
    "commerce_description",
  ]);
  if (review.commerce !== undefined)
    assert.equal(typeof review.commerce, "boolean");
  if (review.commerce_description !== undefined)
    text(review.commerce_description, "commerce_description", 4000, true);
  assert.equal(
    review.demo_recording_url,
    undefined,
    "fresh authenticated recording is pending; omit demo_recording_url",
  );
  if (review.test_cases !== undefined) {
    object(review.test_cases, "test_cases", ["positive", "negative"]);
    for (const [type, count] of [
      ["positive", 5],
      ["negative", 3],
    ]) {
      const cases = review.test_cases[type];
      assert.ok(
        Array.isArray(cases) && cases.length === count,
        `review requires exactly ${count} ${type} cases`,
      );
      for (const entry of cases) {
        object(entry, `${type} case`, [
          "description",
          "prompt",
          "tools_triggered",
          "expected_behavior",
          "file_attachment_urls",
          "expected_output_url",
        ]);
        for (const key of ["description", "prompt"])
          text(entry[key], `${type}.${key}`, 4000, true);
        for (const key of ["tools_triggered", "expected_behavior"])
          if (type === "positive" || entry[key] !== undefined)
            text(entry[key], `${type}.${key}`, 4000, true);
        if (entry.tools_triggered) {
          const tools = entry.tools_triggered.split(/[\s,;]+/).filter(Boolean);
          assert.ok(
            tools.every((tool) => expectedTools.includes(tool)),
            "review case names an unsupported tool",
          );
        }
        if (entry.file_attachment_urls !== undefined) {
          assert.ok(Array.isArray(entry.file_attachment_urls));
          entry.file_attachment_urls.forEach((url) =>
            httpsUrl(url, "attachment URL"),
          );
        }
        if (entry.expected_output_url !== undefined)
          httpsUrl(entry.expected_output_url, "expected output URL");
      }
    }
  }
}

function validateSkill(root, pluginName) {
  const skillPath = path.join(root, "skills/today-planning/SKILL.md");
  const contents = decoder.decode(fs.readFileSync(skillPath));
  const match = contents.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]+)$/);
  assert.ok(
    match,
    "SKILL.md must have closed YAML front matter and a nonempty body",
  );
  const frontmatter = yaml.load(match[1], { schema: yaml.JSON_SCHEMA });
  object(frontmatter, "skill front matter", ["name", "description"]);
  assert.equal(frontmatter.name, "today-planning");
  text(frontmatter.description, "skill description", 1024);
  assert.ok(
    `${pluginName}:${frontmatter.name}`.length <= 64,
    "combined skill identity exceeds 64 characters",
  );
  assert.ok(match[2].trim());
  const tools = [
    ...new Set(
      [...match[2].matchAll(/`([a-z][a-z0-9_]+)`/g)]
        .map((entry) => entry[1])
        .filter((name) => name.includes("_")),
    ),
  ].sort();
  assert.deepEqual(
    tools,
    [...expectedTools].sort(),
    "skill must reference only the six existing MCP tools",
  );
  const agent = yaml.load(
    decoder.decode(
      fs.readFileSync(
        path.join(root, "skills/today-planning/agents/openai.yaml"),
      ),
    ),
    { schema: yaml.JSON_SCHEMA },
  );
  object(agent, "skill agent", ["interface", "policy", "dependencies"]);
  object(agent.interface, "skill interface", [
    "display_name",
    "short_description",
    "default_prompt",
  ]);
  for (const key of ["display_name", "short_description"])
    text(agent.interface[key], `skill ${key}`, 120);
  if (agent.interface.default_prompt !== undefined)
    text(agent.interface.default_prompt, "skill default_prompt", 512);
  if (agent.policy !== undefined) {
    object(agent.policy, "skill policy", [
      "allow_implicit_invocation",
      "products",
    ]);
    if (agent.policy.allow_implicit_invocation !== undefined)
      assert.equal(typeof agent.policy.allow_implicit_invocation, "boolean");
    if (agent.policy.products !== undefined)
      assert.ok(
        Array.isArray(agent.policy.products) &&
          agent.policy.products.length > 0 &&
          agent.policy.products.every((product) =>
            ["CHAT", "CODEX"].includes(product),
          ),
        "unsupported skill product",
      );
  }
  if (agent.dependencies !== undefined) {
    object(agent.dependencies, "skill dependencies", ["tools"]);
    assert.ok(
      Array.isArray(agent.dependencies.tools) &&
        agent.dependencies.tools.length === 1,
      "declare only the existing Planwren MCP dependency",
    );
    const dependency = agent.dependencies.tools[0];
    object(dependency, "MCP dependency", [
      "type",
      "value",
      "description",
      "transport",
      "url",
    ]);
    assert.equal(dependency.type, "mcp");
    assert.equal(dependency.value, "planwren");
    assert.equal(dependency.transport, "streamable_http");
    assert.equal(dependency.url, endpoint);
    if (dependency.description !== undefined)
      text(dependency.description, "MCP dependency description", 1024);
  }
}

export function validatePackage(
  packageDirectory = path.join(repository, "plugins/planwren-public"),
) {
  const root = path.resolve(packageDirectory);
  const files = listFiles(root);
  const manifest = json(path.join(root, "plugin.json"));
  const mcp = json(path.join(root, "mcp.json"));
  schemaCheck(manifest, "plugin");
  schemaCheck(mcp, "mcp");
  assert.equal(manifest.name, "planwren");
  assert.match(manifest.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  text(manifest.version, "version", 64);
  assert.match(
    manifest.version,
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/,
    "version must be semantic",
  );
  const prerelease = manifest.version
    .split("+")[0]
    .split("-")
    .slice(1)
    .join("-");
  assert.ok(
    !prerelease.split(".").some((identifier) => /^0\d+$/.test(identifier)),
    "semantic version numeric prerelease identifiers cannot have leading zeroes",
  );
  text(manifest.description, "description", 4000, true);
  object(manifest.author, "author", ["name", "email", "url"]);
  assert.equal(manifest.author.name, "Thea Foundry");
  text(manifest.author.name, "author.name", 120);
  if (manifest.author.email !== undefined) {
    text(manifest.author.email, "author.email", 320);
    assert.match(manifest.author.email, /^[^\s@]+@[^\s@]+\.[^\s@]+$/);
  }
  for (const [label, url] of [
    ["author.url", manifest.author.url],
    ["homepage", manifest.homepage],
    ["repository", manifest.repository],
  ])
    if (url !== undefined) httpsUrl(url, label, 2048);
  object(manifest.extensions, "extensions", ["com.openai"]);
  const openai = manifest.extensions["com.openai"];
  object(openai, "OpenAI extension", [
    "interface",
    "onboardingSkill",
    "review",
    "publication",
  ]);
  const images = validateInterface(root, openai.interface);
  const referencedAssets = [
    "logo",
    "composerIcon",
    "logoDark",
    "composerIconDark",
  ]
    .map((key) => openai.interface[key])
    .filter(Boolean)
    .map((relative) => relative.slice(2));
  assert.deepEqual(
    [...new Set(referencedAssets)].sort(),
    files
      .filter((entry) => entry.path.startsWith("assets/"))
      .map((entry) => entry.path)
      .sort(),
    "package must include exactly the referenced branding assets",
  );
  if (openai.onboardingSkill !== undefined)
    assert.equal(openai.onboardingSkill, "./skills/today-planning/SKILL.md");
  if (openai.review !== undefined) validateReview(openai.review);
  if (openai.publication !== undefined) {
    object(openai.publication, "publication", ["release_notes"]);
    if (openai.publication.release_notes !== undefined)
      text(openai.publication.release_notes, "release notes", 4000, true);
  }
  assert.deepEqual(
    Object.keys(mcp.mcpServers),
    ["planwren"],
    "package must declare exactly one server",
  );
  assert.deepEqual(
    mcp.mcpServers.planwren,
    { type: "streamable-http", url: endpoint },
    "server must use the canonical remote MCP URL without embedded auth, commands or environment",
  );
  validateSkill(root, manifest.name);
  const forbidden = [
    [/\/(?:Users|private\/tmp|tmp)\//, "local development path"],
    [
      /\b(?:localhost|127\.0\.0\.1|host\.docker\.internal)\b/i,
      "local endpoint",
    ],
    [
      /\b(?:asdk_app|connector|integration)[_-][A-Za-z0-9_-]{8,}\b/i,
      "private integration ID",
    ],
    [/-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/, "private key"],
    [
      /\b(?:access[_-]?token|refresh[_-]?token|client[_-]?secret|authorization[_-]?code|password)["']?\s*[=:]\s*["']?[^\s"']+/i,
      "credential assignment",
    ],
    [
      /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16})\b/,
      "credential",
    ],
    [/\bBearer\s+[A-Za-z0-9._-]{12,}/i, "bearer credential"],
  ];
  for (const file of files) {
    const bytes = fs.readFileSync(path.join(root, file.path));
    const contents = file.path.endsWith(".png")
      ? bytes.toString("latin1")
      : decoder.decode(bytes);
    for (const [pattern, label] of forbidden)
      assert.doesNotMatch(
        contents,
        pattern,
        `${file.path} contains a ${label}`,
      );
  }
  return {
    valid: true,
    scope:
      "local public package; publisher/domain verification, dashboard scans, demo account, authenticated ChatGPT QA and recording remain pending",
    packageName: manifest.name,
    version: manifest.version,
    endpoint,
    tools: expectedTools,
    schemas: [
      "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
      "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
    ],
    images,
    files,
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    console.log(JSON.stringify(validatePackage(process.argv[2]), null, 2));
  } catch (error) {
    console.error(`Public package validation failed: ${error.message}`);
    process.exitCode = 1;
  }
}
