import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Run after client-react's build:all. Everything here is copied to temporary
// directories: this check never changes the checkout or calls Railway.
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temp = fs.mkdtempSync(
  path.join(os.tmpdir(), "todos-frontend-packaging-"),
);
const outputs = [
  ["dist", "index.html", "index.html"],
  ["dist-landing", "landing.html", "landing.html"],
  ["dist-auth", "auth.html", "auth.html"],
];
const excluded = ["/client-react/dist-landing/", "/client-react/dist-auth/"];
const sha = (file) =>
  createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const title = (file) =>
  fs.readFileSync(file, "utf8").match(/<title>(.*?)<\/title>/s)?.[1];

function filesBelow(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? filesBelow(file) : [file];
  });
}

function git(...args) {
  return execFileSync("git", ["-c", "core.fsmonitor=false", ...args], {
    cwd: repo,
  });
}

function uploadFiles(context, ignore) {
  fs.writeFileSync(path.join(context, ".railwayignore"), ignore);
  // Railway CLI 5.28.1 uses ignore::WalkBuilder with a custom .railwayignore.
  // ripgrep uses the same Rust ignore engine. Disable machine-specific ignores
  // and enforce Railway's unconditional .git/node_modules exclusions.
  return execFileSync(
    "rg",
    [
      "--files",
      "--hidden",
      "--null",
      "--no-config",
      "--no-ignore-global",
      "--no-ignore-parent",
      "--ignore-file",
      ".railwayignore",
      "--glob",
      "!.git/**",
      "--glob",
      "!**/node_modules/**",
    ],
    { cwd: context },
  )
    .toString()
    .split("\0")
    .filter(Boolean);
}

function overlay(context, files, target) {
  for (const file of files) {
    const destination = path.join(target, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(context, file), destination);
  }
}

function servedFile(image, href) {
  const url = new URL(href, "https://packaging.invalid/");
  if (url.origin !== "https://packaging.invalid") return null;
  const relative = url.pathname.startsWith("/auth/assets/")
    ? `dist-auth/${url.pathname.slice("/auth/".length)}`
    : url.pathname.startsWith("/app/")
      ? `dist/${url.pathname.slice("/app/".length)}`
      : `dist-landing/${url.pathname.slice(1)}`;
  return path.join(image, "client-react", relative);
}

try {
  const context = path.join(temp, "upload");
  fs.mkdirSync(path.join(context, ".git"), { recursive: true });
  fs.copyFileSync(
    path.join(repo, ".gitignore"),
    path.join(context, ".gitignore"),
  );
  fs.cpSync(
    path.join(repo, "client-react"),
    path.join(context, "client-react"),
    {
      recursive: true,
      filter: (source) => {
        const first = path
          .relative(path.join(repo, "client-react"), source)
          .split(path.sep)[0];
        return !["node_modules", ...outputs.map(([dir]) => dir)].includes(
          first,
        );
      },
    },
  );

  // Use the exact tracked upload artifacts, rather than inventing stale HTML.
  const tracked = git(
    "ls-files",
    "-z",
    "client-react/dist-landing",
    "client-react/dist-auth",
  )
    .toString()
    .split("\0")
    .filter(Boolean);
  assert.ok(
    tracked.length > 0,
    "Expected tracked artifacts for the regression control",
  );
  for (const file of tracked) {
    const destination = path.join(context, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, git("show", `HEAD:${file}`));
  }

  const currentIgnore = fs.readFileSync(
    path.join(repo, ".railwayignore"),
    "utf8",
  );
  const originalIgnore = currentIgnore
    .split("\n")
    .filter((line) => !excluded.includes(line.trim()))
    .join("\n");
  const originalFiles = uploadFiles(context, originalIgnore);
  const fixedFiles = uploadFiles(context, currentIgnore);
  assert.ok(
    tracked.every((file) => originalFiles.includes(file)),
    "Original upload must include stale artifacts",
  );
  assert.ok(
    tracked.every((file) => !fixedFiles.includes(file)),
    "Fixed upload must exclude every stale artifact",
  );
  const sourceFiles = fixedFiles.filter((file) =>
    file.startsWith("client-react/"),
  );
  for (const required of [
    "package.json",
    "package-lock.json",
    "index.html",
    "landing.html",
    "auth.html",
    "vite.config.ts",
    "vite.landing.config.ts",
    "vite.auth.config.ts",
    "public/favicon.svg",
    "public/manifest.json",
    "public/sw.js",
  ]) {
    assert.ok(
      sourceFiles.includes(`client-react/${required}`),
      `Missing build input: ${required}`,
    );
  }
  assert.ok(
    sourceFiles.some((file) => file.startsWith("client-react/src/")),
    "Missing client sources",
  );

  const originalImage = path.join(temp, "original-image");
  const fixedImage = path.join(temp, "fixed-image");
  const generated = [];
  for (const [dir, entry, source] of outputs) {
    const build = path.join(repo, "client-react", dir);
    assert.equal(
      title(path.join(build, entry)),
      title(path.join(repo, "client-react", source)),
      `Rebuild ${dir}: its title differs from source`,
    );
    for (const image of [originalImage, fixedImage]) {
      fs.cpSync(build, path.join(image, "client-react", dir), {
        recursive: true,
      });
    }
    for (const file of filesBelow(build)) {
      generated.push({ file: path.relative(repo, file), sha256: sha(file) });
    }
    for (const publicFile of ["favicon.svg", "manifest.json", "sw.js"]) {
      assert.equal(
        sha(path.join(build, publicFile)),
        sha(path.join(repo, "client-react/public", publicFile)),
        `Stale public file: ${dir}/${publicFile}`,
      );
    }
  }

  // Reproduce Nixpacks' final COPY . /app after the actual Vite builds.
  overlay(context, originalFiles, originalImage);
  overlay(context, fixedFiles, fixedImage);
  const negativeControl = outputs.slice(1).map(([dir, entry]) => {
    const relative = `client-react/${dir}/${entry}`;
    const stale = path.join(context, relative);
    const built = path.join(repo, relative);
    assert.notEqual(
      sha(stale),
      sha(built),
      `Regression control requires stale ${relative}`,
    );
    assert.equal(
      sha(path.join(originalImage, relative)),
      sha(stale),
      `Original COPY did not reproduce stale ${entry}`,
    );
    return {
      file: relative,
      staleTitle: title(stale),
      generatedTitle: title(built),
    };
  });
  for (const item of generated) {
    assert.equal(
      sha(path.join(fixedImage, item.file)),
      item.sha256,
      `Final COPY overwrote ${item.file}`,
    );
  }

  const references = [];
  const externalReferences = [];
  for (const [dir, entry] of outputs) {
    const html = fs.readFileSync(
      path.join(fixedImage, "client-react", dir, entry),
      "utf8",
    );
    for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
      const file = servedFile(fixedImage, match[1]);
      if (file === null) {
        externalReferences.push(match[1]);
        continue;
      }
      const relative = path.relative(fixedImage, file);
      assert.ok(
        generated.some(
          (item) => item.file === relative && item.sha256 === sha(file),
        ),
        `Missing or overwritten HTML reference: ${match[1]}`,
      );
      references.push(match[1]);
    }
  }

  const report = {
    passed: true,
    checkoutBaseRevision: git("rev-parse", "HEAD").toString().trim(),
    railwayIgnoreSHA256: sha(path.join(repo, ".railwayignore")),
    frontendInputsSHA256: createHash("sha256")
      .update(
        sourceFiles
          .sort()
          .map((file) => `${file}\0${sha(path.join(context, file))}\n`)
          .join(""),
      )
      .digest("hex"),
    ignoreEngine: execFileSync("rg", ["--version"]).toString().split("\n")[0],
    trackedArtifactsExcluded: tracked.length,
    sourceFilesRetained: sourceFiles.length,
    generatedFilesPreserved: generated.length,
    htmlReferencesVerified: references.length,
    externalReferencesNotFetched: externalReferences,
    negativeControl,
    generated,
    limit:
      "Local simulation of upload filtering and final source COPY; no provider build/deployment or authenticated acceptance.",
  };
  const reportFlag = process.argv.indexOf("--report");
  if (reportFlag !== -1) {
    assert.ok(process.argv[reportFlag + 1], "--report requires a file path");
    fs.writeFileSync(
      process.argv[reportFlag + 1],
      `${JSON.stringify(report, null, 2)}\n`,
    );
  }
  console.log(JSON.stringify({ ...report, generated: undefined }, null, 2));
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
