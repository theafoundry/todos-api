#!/usr/bin/env node
/** Derive every Fold mark and icon from the geometry consumed by BrandMark. */
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const check = args.includes("--check");
const previewIndex = args.indexOf("--preview-dir");
const previewDir = previewIndex === -1 ? null : args[previewIndex + 1];
if (
  args.some(
    (arg, i) =>
      arg !== "--check" &&
      arg !== "--preview-dir" &&
      !(previewIndex !== -1 && i === previewIndex + 1),
  )
) {
  throw new Error(
    "Usage: node scripts/generate-planwren-brand-assets.mjs [--check] [--preview-dir PATH]",
  );
}
if (previewIndex !== -1 && (!previewDir || previewDir.startsWith("--"))) {
  throw new Error("--preview-dir requires a path");
}
const brand = JSON.parse(
  await readFile(path.join(root, "client-react/src/brand/fold.json"), "utf8"),
);
const [x, y, width, height] = brand.viewBox.split(/\s+/).map(Number);
if (
  ![x, y, width, height].every(Number.isFinite) ||
  width <= 0 ||
  height <= 0
) {
  throw new Error("Fold viewBox must contain four valid coordinates");
}
if (
  brand.paths.length !== 2 ||
  brand.paths.some((d) => !/^[MCZ0-9.,\s-]+$/.test(d))
) {
  throw new Error("Fold must have its two canonical cubic silhouettes");
}
for (const [name, value] of Object.entries(brand.colors)) {
  if (!/^#[0-9A-F]{6}$/.test(value)) throw new Error(`Invalid ${name} color`);
}
if (
  brand.colors.coral !== "#E17055" ||
  brand.colors.cream !== "#FFFCF5" ||
  brand.colors.ink !== "#2D1F1A"
) {
  throw new Error("Fold palette must retain the approved coral, cream and ink");
}
const publicDir = "client-react/public/";
const paths = (fill) =>
  brand.paths.map((d) => `  <path d="${d}" fill="${fill}"/>`).join("\n");
const svg = (viewBox, content) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" role="img" aria-label="Planwren Fold">\n${content}\n</svg>\n`;
const mark = (color) => svg(brand.viewBox, paths(color));
function tile(size, background, markHeight = 0.64, rounded = false) {
  const scale = (size * markHeight) / height;
  const tx = (size - width * scale) / 2 - x * scale;
  const ty = (size - height * scale) / 2 - y * scale;
  const transform = `translate(${tx.toFixed(6)} ${ty.toFixed(6)}) scale(${scale.toFixed(9)})`;
  return svg(
    `0 0 ${size} ${size}`,
    `  <rect width="${size}" height="${size}"${rounded ? ` rx="${size / 4}"` : ""} fill="${background}"/>\n  <g transform="${transform}">\n${paths(brand.colors.cream)}\n  </g>`,
  );
}
function ico(images) {
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  for (const [i, { size, bytes }] of images.entries()) {
    const at = 6 + i * 16;
    header[at] = size === 256 ? 0 : size;
    header[at + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, at + 4);
    header.writeUInt16LE(32, at + 6);
    header.writeUInt32LE(bytes.length, at + 8);
    header.writeUInt32LE(offset, at + 12);
    offset += bytes.length;
  }
  return Buffer.concat([header, ...images.map((image) => image.bytes)]);
}
const outputs = new Map();
const manifest = [];
function add(relativePath, bytes, details) {
  const buffer = typeof bytes === "string" ? Buffer.from(bytes) : bytes;
  outputs.set(relativePath, buffer);
  manifest.push({
    path: relativePath,
    ...details,
    bytes: buffer.length,
    sha256: createHash("sha256").update(buffer).digest("hex"),
  });
}
for (const color of ["coral", "cream", "ink"]) {
  add(`${publicDir}brand/fold-${color}.svg`, mark(brand.colors[color]), {
    format: "svg",
    viewBox: brand.viewBox,
    color: brand.colors[color],
    background: "transparent",
  });
}
const favicon = tile(32, brand.colors.coral, 0.75, true);
const appIcon = tile(1024, brand.colors.coral);
const darkIcon = tile(1024, brand.colors.ink);
add(`${publicDir}favicon.svg`, favicon, {
  format: "svg",
  width: 32,
  height: 32,
});
add(`${publicDir}brand/app-icon.svg`, appIcon, {
  format: "svg",
  width: 1024,
  height: 1024,
});
add(`${publicDir}brand/app-icon-dark.svg`, darkIcon, {
  format: "svg",
  width: 1024,
  height: 1024,
});

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  async function png(source, size) {
    const base64 = await page.evaluate(
      async ({ source, size }) => {
        const image = new Image();
        image.src = `data:image/svg+xml;base64,${btoa(source)}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0, size, size);
        return canvas.toDataURL("image/png").split(",")[1];
      },
      { source, size },
    );
    return Buffer.from(base64, "base64");
  }
  const faviconImages = [];
  for (const size of [16, 32]) {
    const bytes = await png(favicon, size);
    add(`${publicDir}favicon-${size}x${size}.png`, bytes, {
      format: "png",
      width: size,
      height: size,
    });
    faviconImages.push({ size, bytes });
  }
  add(`${publicDir}favicon.ico`, ico(faviconImages), {
    format: "ico",
    sizes: [16, 32],
  });
  const rasters = [
    ["apple-touch-icon.png", 180, appIcon, "apple-touch"],
    ["icon-192.png", 192, appIcon, "any"],
    ["icon-512.png", 512, appIcon, "any"],
    ["icon-maskable-192.png", 192, appIcon, "maskable"],
    ["icon-maskable-512.png", 512, appIcon, "maskable"],
    ["brand/app-icon-1024.png", 1024, appIcon, "master"],
    ["brand/app-icon-dark-1024.png", 1024, darkIcon, "dark"],
  ];
  for (const [name, size, source, purpose] of rasters) {
    add(publicDir + name, await png(source, size), {
      format: "png",
      width: size,
      height: size,
      purpose,
    });
  }
  for (const [relativePath, size] of [
    ["plugins/todos/assets/logo.png", 512],
    ["plugins/todos/assets/composer-icon.png", 256],
  ]) {
    add(relativePath, await png(appIcon, size), {
      format: "png",
      width: size,
      height: size,
      purpose: "plugin",
    });
  }
  const manifestBytes =
    JSON.stringify(
      {
        version: brand.version,
        colors: brand.colors,
        source: "client-react/src/brand/fold.json",
        assets: manifest,
      },
      null,
      2,
    ) + "\n";
  outputs.set(`${publicDir}brand/assets.json`, Buffer.from(manifestBytes));
  const failures = [];
  for (const [relativePath, bytes] of outputs) {
    const destination = path.join(root, relativePath);
    if (check) {
      const existing = await readFile(destination).catch(() => null);
      if (!existing || !existing.equals(bytes)) failures.push(relativePath);
    } else {
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, bytes);
    }
  }
  if (failures.length)
    throw new Error(`Generated Fold assets differ: ${failures.join(", ")}`);
  if (previewDir) {
    const destination = path.resolve(previewDir);
    await mkdir(destination, { recursive: true });
    const data = (relativePath, type = "image/png") =>
      `data:${type};base64,${outputs.get(relativePath).toString("base64")}`;
    const image = (relativePath, size, extra = "") =>
      `<img src="${data(relativePath, relativePath.endsWith(".svg") ? "image/svg+xml" : "image/png")}" width="${size}" height="${size}" ${extra}>`;
    const icon = (label, name, size) =>
      `<div class="sample">${image(publicDir + name, size)}<p>${label}</p></div>`;
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.setContent(
      `<html><style>*{box-sizing:border-box}body{margin:0;background:${brand.colors.cream};color:${brand.colors.ink};font-family:Arial,sans-serif;padding:64px}h1{font-size:48px;letter-spacing:-2px;margin:0 0 8px}h2{font-size:20px;margin:0 0 28px}p{font-size:15px;line-height:1.5}header{margin-bottom:45px}.row{display:flex;gap:36px;align-items:center;margin-bottom:45px}.card{padding:34px;flex:1;border-radius:24px;background:white}.card.dark{background:${brand.colors.ink};color:${brand.colors.cream}}.sample{text-align:center;min-width:116px}.sample p{margin:12px 0 0}.rounded{border-radius:22%}.tiny{display:flex;gap:26px;align-items:center}.pixels{image-rendering:pixelated;border-radius:0}.caption{color:#735A51;font-size:14px}.colors{display:flex;gap:28px}.swatch{display:inline-block;width:22px;height:22px;border-radius:50%;vertical-align:middle;margin-right:9px}</style><body><header><h1>planwren / Fold</h1><p>Production vector · one silhouette across every size · ${brand.version}</p></header><div class="row"><div class="card"><h2>Coral mark / light surface</h2><img src="${data(publicDir + "brand/fold-coral.svg", "image/svg+xml")}" width="132" height="150"></div><div class="card dark"><h2>Cream mark / dark surface</h2><img src="${data(publicDir + "brand/fold-cream.svg", "image/svg+xml")}" width="132" height="150"></div><div class="sample">${image(publicDir + "brand/app-icon-1024.png", 180, 'class="rounded"')}<p>Coral app icon</p></div><div class="sample">${image(publicDir + "brand/app-icon-dark-1024.png", 180, 'class="rounded"')}<p>Ink app icon</p></div></div><div class="row">${icon("Apple · 180 px", "apple-touch-icon.png", 180)}${icon("PWA · 192 px", "icon-192.png", 144)}${icon("PWA / maskable · 512 px", "icon-maskable-512.png", 144)}<div class="card"><h2>Tiny favicons / native scale</h2><div class="tiny">${image(publicDir + "favicon-16x16.png", 16)}${image(publicDir + "favicon-32x32.png", 32)}${image(publicDir + "favicon-16x16.png", 96, 'class="pixels"')}${image(publicDir + "favicon-32x32.png", 96, 'class="pixels"')}</div><p class="caption">16 and 32 pixels, followed by enlarged pixel views.</p></div></div><div class="row"><div class="card"><h2>One-color ink</h2><img src="${data(publicDir + "brand/fold-ink.svg", "image/svg+xml")}" width="88" height="100"></div><div class="card dark"><h2>One-color cream</h2><img src="${data(publicDir + "brand/fold-cream.svg", "image/svg+xml")}" width="88" height="100"></div><div class="card"><h2>Plugin assets</h2><div class="tiny">${image("plugins/todos/assets/logo.png", 96, 'class="rounded"')}${image("plugins/todos/assets/composer-icon.png", 64, 'class="rounded"')}</div></div></div><div class="colors">${Object.entries(
        brand.colors,
      )
        .map(
          ([name, value]) =>
            `<p><span class="swatch" style="background:${value};border:1px solid ${brand.colors.ink}"></span>${name} ${value}</p>`,
        )
        .join("")}</div></body></html>`,
    );
    await page.screenshot({
      path: path.join(destination, "fold-production-contact-sheet.png"),
      fullPage: true,
    });
    await writeFile(
      path.join(destination, "asset-manifest.json"),
      manifestBytes,
    );
  }
  console.log(
    `${check ? "Verified" : "Generated"} ${outputs.size} consistent Fold assets (${brand.version}).`,
  );
} finally {
  await browser.close();
}
