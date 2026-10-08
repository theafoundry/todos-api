import { defineConfig, devices } from "@playwright/test";

const port = Number.parseInt(process.env.UI_PORT || "4191", 10);
const baseURL = process.env.PLAYWRIGHT_BASE_URL || `http://127.0.0.1:${port}`;
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(baseURL).hostname)) {
  throw new Error("Mobile fixture tests require a loopback app server");
}

/** Stateful composed-app coverage; install matching engines with playwright install chromium webkit. */
export default defineConfig({
  testDir: "./tests/ui",
  testMatch: "mobile-interactions.spec.ts",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 2,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    timezoneId: "America/Los_Angeles",
    locale: "en-US",
    serviceWorkers: "block",
    colorScheme: "light",
    contextOptions: { reducedMotion: "reduce" },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium-mobile", use: { ...devices["Pixel 7"] } },
    { name: "webkit-mobile", use: { ...devices["iPhone 13"] } },
  ],
  webServer: {
    command: `node node_modules/vite/bin/vite.js --host 127.0.0.1 --port ${port} --strictPort`,
    cwd: "client-react",
    env: { API_PROXY_TARGET: "http://127.0.0.1:9" },
    url: `${baseURL}/app/`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
