import { defineConfig, devices } from "@playwright/test";

const uiPort = Number.parseInt(process.env.UI_PORT || "4173", 10);
const baseURL = process.env.PLAYWRIGHT_BASE_URL || `http://127.0.0.1:${uiPort}`;
/** Health URL for webServer / reuse checks (Vite React app lives under /app/). */
const webServerUrl =
  process.env.PLAYWRIGHT_WEB_SERVER_URL || `http://127.0.0.1:${uiPort}/app/`;

export default defineConfig({
  testDir: "./tests/ui",
  snapshotPathTemplate:
    "{testDir}/{testFilePath}-snapshots/{arg}-{projectName}-{platform}{ext}",
  timeout: 30_000,
  expect: {
    timeout: 5_000,
    toHaveScreenshot: {
      // Allow minor cross-platform rasterization differences (macOS vs Linux CI).
      maxDiffPixelRatio: 0.05,
      animations: "disabled",
    },
  },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 4 : 3,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    reducedMotion: "reduce",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
        colorScheme: "light",
      },
    },
    {
      name: "chromium-mobile",
      use: {
        ...devices["Pixel 7"],
        deviceScaleFactor: 1,
        colorScheme: "light",
      },
    },
  ],
  webServer: {
    command: `UI_PORT=${uiPort} node scripts/ui-static-server.mjs`,
    url: webServerUrl,
    // CI runs `start-server-and-test preview:react` first; reuse that server instead of double-binding 4173.
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
