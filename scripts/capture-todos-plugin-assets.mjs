import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { chromium } from "playwright";

const root = process.cwd();
const assetsDir = path.join(root, "plugins", "todos", "assets");
const appIconPath = path.join(
  root,
  "client-react",
  "public",
  "brand",
  "app-icon.svg",
);
const require = createRequire(import.meta.url);
const { buildTodayPlanWidgetHtml } = require(
  path.join(root, "dist", "mcp", "todayPlanResource.js"),
);

const syntheticPlan = {
  date: "2026-08-11",
  timezone: "America/New_York",
  availableMinutes: 120,
  energy: "medium",
  tasks: [
    {
      id: "00000000-0000-4000-8000-000000000010",
      title: "Review launch checklist",
      status: "next",
      completed: false,
      dueDate: "2026-08-11T16:00:00.000Z",
      scheduledDate: null,
      priority: "high",
      estimateMinutes: 30,
      energy: "medium",
      overdue: true,
      project: {
        id: "00000000-0000-4000-8000-000000000100",
        name: "Demo Launch",
      },
      rank: 1,
      reason: "Due today and fits the available time.",
    },
    {
      id: "00000000-0000-4000-8000-000000000011",
      title: "Draft release notes",
      status: "scheduled",
      completed: false,
      dueDate: null,
      scheduledDate: "2026-08-11T14:00:00.000Z",
      priority: "medium",
      estimateMinutes: 30,
      energy: "low",
      overdue: false,
      project: {
        id: "00000000-0000-4000-8000-000000000100",
        name: "Demo Launch",
      },
      rank: 2,
      reason: "Scheduled today and suitable for current energy.",
    },
    {
      id: "00000000-0000-4000-8000-000000000012",
      title: "Confirm rollout owner",
      status: "next",
      completed: false,
      dueDate: null,
      scheduledDate: null,
      priority: "medium",
      estimateMinutes: 30,
      energy: "medium",
      overdue: false,
      project: {
        id: "00000000-0000-4000-8000-000000000100",
        name: "Demo Launch",
      },
      rank: 3,
      reason: "A clear next action that fits the remaining time.",
    },
  ],
  totalMinutes: 90,
  remainingMinutes: 30,
  warnings: [],
};

async function renderSvg(browser, svg, size, outputPath) {
  const page = await browser.newPage({
    viewport: { width: size, height: size },
  });
  const encoded = Buffer.from(svg).toString("base64");
  await page.setContent(
    `<style>html,body{margin:0;width:100%;height:100%;overflow:hidden}img{display:block;width:100%;height:100%}</style><img alt="Planwren Fold logo" src="data:image/svg+xml;base64,${encoded}">`,
  );
  await page.screenshot({ path: outputPath, omitBackground: true });
  await page.close();
}

async function renderWidget(browser, outputPath) {
  const page = await browser.newPage({
    viewport: { width: 760, height: 1100 },
  });
  const html = buildTodayPlanWidgetHtml("https://todos.theafoundry.com/");
  await page.setContent(
    '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:20px;background:#eef2ef"><main style="width:720px;margin:auto"><iframe id="widget" title="Synthetic Today Plan component" style="display:block;width:100%;height:1060px;border:0"></iframe></main></body></html>',
  );
  await page.evaluate(
    ({ widgetHtml, plan }) => {
      const iframe = document.getElementById("widget");
      const post = (message) => iframe.contentWindow?.postMessage(message, "*");
      const result = (id, value) => post({ jsonrpc: "2.0", id, result: value });

      window.addEventListener("message", (event) => {
        if (event.source !== iframe.contentWindow) return;
        const message = event.data;
        if (!message || message.jsonrpc !== "2.0" || !message.method) return;
        if (message.method === "ui/initialize") {
          result(message.id, {
            protocolVersion: "2026-01-26",
            hostInfo: { name: "synthetic-asset-host", version: "1.0.0" },
            hostCapabilities: { openLinks: {}, serverTools: {} },
            hostContext: { displayMode: "inline", theme: "light" },
          });
          return;
        }
        if (message.method === "ui/notifications/initialized") {
          post({
            jsonrpc: "2.0",
            method: "ui/notifications/tool-input",
            params: {
              arguments: {
                date: plan.date,
                taskIds: plan.tasks.map((task) => task.id),
                availableMinutes: plan.availableMinutes,
                energy: plan.energy,
              },
            },
          });
          post({
            jsonrpc: "2.0",
            method: "ui/notifications/tool-result",
            params: { structuredContent: structuredClone(plan), content: [] },
          });
        }
      });
      iframe.srcdoc = widgetHtml;
    },
    { widgetHtml: html, plan: syntheticPlan },
  );

  const frame = page.frameLocator("#widget");
  await frame.locator('#card[data-state="ready"]').waitFor();
  await frame.locator("#skeleton").evaluate((element) => {
    element.style.display = "none";
  });
  await frame.locator(".reschedule[hidden]").evaluateAll((elements) => {
    for (const element of elements) element.style.display = "none";
  });
  await frame.locator("#card").screenshot({ path: outputPath });
  await page.close();
}

await fs.mkdir(assetsDir, { recursive: true });
const appIcon = await fs.readFile(appIconPath, "utf8");
const browser = await chromium.launch({ headless: true });

try {
  await renderSvg(
    browser,
    appIcon,
    256,
    path.join(assetsDir, "composer-icon.png"),
  );
  await renderSvg(browser, appIcon, 512, path.join(assetsDir, "logo.png"));
  await renderWidget(
    browser,
    path.join(assetsDir, "screenshot-today-plan.png"),
  );
} finally {
  await browser.close();
}

console.info(`Wrote synthetic plugin assets to ${assetsDir}`);
