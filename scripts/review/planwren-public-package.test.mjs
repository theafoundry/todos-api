import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { validatePackage } from "../validate-planwren-public-package.mjs";

const source = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../plugins/planwren-public",
);

function fixture(callback) {
  const temporary = fs.mkdtempSync(
    path.join(os.tmpdir(), "planwren-package-test-"),
  );
  const root = path.join(temporary, "plugin");
  try {
    fs.cpSync(source, root, { recursive: true });
    return callback(root);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

function edit(root, filename, update) {
  const target = path.join(root, filename);
  const value = JSON.parse(fs.readFileSync(target, "utf8"));
  update(value);
  fs.writeFileSync(target, JSON.stringify(value));
}

function reject(name, update, expected) {
  test(name, () =>
    fixture((root) => {
      update(root);
      assert.throws(() => validatePackage(root), expected);
    }),
  );
}

test("valid deployed-brand public package validates repeatedly offline", () => {
  const first = validatePackage(source);
  assert.equal(first.files.length, 8);
  assert.equal(first.tools.length, 6);
  assert.deepEqual(validatePackage(source), first);
});
reject(
  "reject invalid numeric semver prerelease",
  (root) => {
    edit(root, "plugin.json", (value) => {
      value.version = "0.2.0-01";
    });
  },
  /prerelease identifiers/,
);
reject(
  "reject unescaped spaces in optional publisher URLs",
  (root) => {
    edit(root, "plugin.json", (value) => {
      value.author.url = "https://www.planwren.com/a b";
    });
  },
  /unescaped whitespace/,
);

reject(
  "reject local app integration overlays",
  (root) => {
    fs.writeFileSync(path.join(root, ".app.json"), '{"apps":{}}');
  },
  /unsafe path/,
);
reject(
  "reject hooks embedded in OpenAI extension",
  (root) => {
    edit(root, "plugin.json", (value) => {
      value.extensions["com.openai"].hooks = "./hooks.json";
    });
  },
  /hooks is outside/,
);
reject(
  "reject portable metadata at compatibility-manifest level",
  (root) => {
    edit(root, "plugin.json", (value) => {
      value.interface = value.extensions["com.openai"].interface;
    });
  },
  /official Agent Plugins/,
);
reject(
  "reject stdout command server",
  (root) => {
    edit(root, "mcp.json", (value) => {
      value.mcpServers.planwren = { type: "stdio", command: "curl" };
    });
  },
  /canonical remote MCP/,
);
reject(
  "reject embedded authorization header",
  (root) => {
    edit(root, "mcp.json", (value) => {
      value.mcpServers.planwren.headers = { Authorization: "Bearer secret" };
    });
  },
  /without embedded auth/,
);
reject(
  "reject a second MCP server",
  (root) => {
    edit(root, "mcp.json", (value) => {
      value.mcpServers.other = value.mcpServers.planwren;
    });
  },
  /exactly one server/,
);
reject(
  "reject canonical MCP endpoint drift",
  (root) => {
    edit(root, "mcp.json", (value) => {
      value.mcpServers.planwren.url = "https://www.planwren.com/mcp/app";
    });
  },
  /canonical remote MCP/,
);
reject(
  "reject expanded package permissions",
  (root) => {
    edit(root, "plugin.json", (value) => {
      value.extensions["com.openai"].permissions = ["filesystem"];
    });
  },
  /permissions is outside/,
);
reject(
  "reject directory subtitle above final 30-character limit",
  (root) => {
    edit(root, "plugin.json", (value) => {
      value.extensions["com.openai"].interface.shortDescription = "a".repeat(
        31,
      );
    });
  },
  /exceeds 30/,
);
reject(
  "reject invisible listing controls",
  (root) => {
    edit(root, "plugin.json", (value) => {
      value.extensions["com.openai"].interface.shortDescription =
        "Plan\u200btasks";
    });
  },
  /unsupported characters/,
);
reject(
  "reject duplicate starter prompts after normalization",
  (root) => {
    edit(root, "plugin.json", (value) => {
      value.extensions["com.openai"].interface.defaultPrompt = [
        "Plan my day",
        "  PLAN  my day ",
      ];
    });
  },
  /unique after normalization/,
);
reject(
  "reject overly long starter prompt",
  (root) => {
    edit(root, "plugin.json", (value) => {
      value.extensions["com.openai"].interface.defaultPrompt = "a".repeat(129);
    });
  },
  /exceeds 128/,
);
reject(
  "reject publisher URL credentials",
  (root) => {
    edit(root, "plugin.json", (value) => {
      value.extensions["com.openai"].interface.supportURL =
        "https://user:secret@www.planwren.com/support";
    });
  },
  /must not embed credentials/,
);
reject(
  "reject insufficient light brand contrast",
  (root) => {
    edit(root, "plugin.json", (value) => {
      value.extensions["com.openai"].interface.brandColor = "#FFFFFF";
    });
  },
  /2:1 contrast/,
);
reject(
  "reject directory reviewer credentials",
  (root) => {
    edit(root, "plugin.json", (value) => {
      value.extensions["com.openai"].review.test_credentials =
        "review-password";
    });
  },
  /test_credentials is outside/,
);
reject(
  "reject recording claim before authenticated recording",
  (root) => {
    edit(root, "plugin.json", (value) => {
      value.extensions["com.openai"].review.demo_recording_url =
        "https://www.planwren.com/review/demo.mp4";
    });
  },
  /recording is pending/,
);
reject(
  "reject incorrect final negative case count",
  (root) => {
    edit(root, "plugin.json", (value) => {
      value.extensions["com.openai"].review.test_cases.negative.pop();
    });
  },
  /exactly 3 negative/,
);
reject(
  "reject unknown tools in review cases",
  (root) => {
    edit(root, "plugin.json", (value) => {
      value.extensions[
        "com.openai"
      ].review.test_cases.positive[0].tools_triggered = "delete_task";
    });
  },
  /unsupported tool/,
);
reject(
  "reject branding path traversal",
  (root) => {
    edit(root, "plugin.json", (value) => {
      value.extensions["com.openai"].interface.logo = "./assets/../plugin.json";
    });
  },
  /unsafe traversal/,
);
reject(
  "reject symlinked branding file",
  (root) => {
    const target = path.join(root, "assets/logo.png");
    fs.unlinkSync(target);
    fs.symlinkSync(path.join(source, "assets/logo.png"), target);
  },
  /symlinks are prohibited/,
);
reject(
  "reject executable skill metadata",
  (root) => {
    fs.chmodSync(
      path.join(root, "skills/today-planning/agents/openai.yaml"),
      0o755,
    );
  },
  /executable files are prohibited/,
);
reject(
  "reject unused asset files",
  (root) => {
    fs.copyFileSync(
      path.join(root, "assets/logo.png"),
      path.join(root, "assets/unused.png"),
    );
  },
  /exactly the referenced/,
);
reject(
  "reject malformed PNG payload even with intact dimensions",
  (root) => {
    const target = path.join(root, "assets/logo.png");
    const bytes = fs.readFileSync(target);
    bytes[bytes.length - 20] ^= 0xff;
    fs.writeFileSync(target, bytes);
  },
  /CRC mismatch|invalid|incomplete/,
);
reject(
  "reject active SVG content",
  (root) => {
    const target = path.join(root, "assets/logo-dark.svg");
    fs.writeFileSync(
      target,
      fs
        .readFileSync(target, "utf8")
        .replace("</svg>", "<script>alert(1)</script></svg>"),
    );
  },
  /active\/external/,
);
reject(
  "reject SVG stylesheet external imports",
  (root) => {
    const target = path.join(root, "assets/logo-dark.svg");
    fs.writeFileSync(
      target,
      fs
        .readFileSync(target, "utf8")
        .replace(
          "</svg>",
          '<style>@import "https://example.com/style.css";</style></svg>',
        ),
    );
  },
  /active\/external/,
);
reject(
  "reject malformed skill YAML",
  (root) => {
    const target = path.join(root, "skills/today-planning/SKILL.md");
    fs.writeFileSync(
      target,
      fs
        .readFileSync(target, "utf8")
        .replace("name: today-planning", "name: [unclosed"),
    );
  },
  /unexpected end|missed comma|flow collection|deficient indentation/,
);
reject(
  "reject unsupported tool instructions",
  (root) => {
    fs.appendFileSync(
      path.join(root, "skills/today-planning/SKILL.md"),
      "\nUse `delete_all_tasks` to erase tasks.\n",
    );
  },
  /six existing MCP tools/,
);
reject(
  "reject MCP dependency identity mismatch",
  (root) => {
    const target = path.join(root, "skills/today-planning/agents/openai.yaml");
    fs.writeFileSync(
      target,
      fs
        .readFileSync(target, "utf8")
        .replace('value: "planwren"', 'value: "unrelated"'),
    );
  },
  /unrelated/,
);
reject(
  "reject private API keys in a text file",
  (root) => {
    fs.appendFileSync(
      path.join(root, "skills/today-planning/SKILL.md"),
      `\n${"sk-"}${"a".repeat(24)}\n`,
    );
  },
  /contains a credential/,
);
reject(
  "reject developer paths in a text file",
  (root) => {
    fs.appendFileSync(
      path.join(root, "skills/today-planning/SKILL.md"),
      "\nRead /Users/example/local-config.\n",
    );
  },
  /local development path/,
);
reject(
  "reject quoted credential assignments in JSON examples",
  (root) => {
    fs.appendFileSync(
      path.join(root, "skills/today-planning/SKILL.md"),
      '\n{"password":"synthetic-example-value"}\n',
    );
  },
  /credential assignment/,
);
reject(
  "reject quoted client secret assignments in JSON examples",
  (root) => {
    fs.appendFileSync(
      path.join(root, "skills/today-planning/SKILL.md"),
      '\n{"client_secret":"synthetic-example-value"}\n',
    );
  },
  /credential assignment/,
);
