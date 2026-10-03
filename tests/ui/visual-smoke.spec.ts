import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { openTodosViewWithStorageState } from "./helpers/todos-view";

/**
 * Visual smoke tests — screenshot-based regression for key UI surfaces.
 * These are tagged @visual and excluded from the fast CI suite.
 *
 * NOTE: First run generates baselines. Run `npm run test:ui:update` to regenerate
 * after intentional UI changes. Use Docker for cross-platform baseline consistency.
 */

// Fixed wall clock so Date-derived text (e.g. the landing footer year) is stable.
// Kept in the past so server-generated expiry timestamps stay in the future.
const FIXED_TIME = new Date("2026-01-15T15:00:00Z");

async function waitForFonts(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

function isImageLoaded(el: HTMLImageElement): boolean {
  return el.complete && el.naturalWidth > 0;
}

/** Load every <img> (including lazy ones) and fail if any is broken. */
async function expectImagesLoaded(page: Page): Promise<void> {
  const images = page.locator("img");
  const count = await images.count();
  for (let i = 0; i < count; i += 1) {
    const image = images.nth(i);
    const src = await image.getAttribute("src");
    await image.scrollIntoViewIfNeeded();
    await expect
      .poll(() => image.evaluate(isImageLoaded), {
        message: `image ${src} should load successfully`,
      })
      .toBe(true);
  }
  await page.evaluate(() =>
    window.scrollTo({ top: 0, left: 0, behavior: "instant" }),
  );
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
}

async function openSettledDashboard(context: BrowserContext): Promise<Page> {
  await context.clock.setFixedTime(FIXED_TIME);
  const page = await openTodosViewWithStorageState(context);

  await expect(page.locator("aside.app-sidebar")).toBeVisible();
  await expect(page.locator(".app-main")).toBeVisible();
  await expect(page.getByTestId("home-dashboard")).toBeVisible();
  await expect(page.locator(".app-main .loading-bar")).toHaveCount(0);
  await expect(page.locator("[aria-busy='true']")).toHaveCount(0);
  await expect(page.locator(".loading-skeleton")).toHaveCount(0);
  await waitForFonts(page);
  return page;
}

test.describe("@visual smoke", () => {
  test.skip(({ isMobile }) => isMobile, "Visual tests for desktop only");
  test.use({ timezoneId: "UTC" });

  test("@visual landing page renders correctly", async ({ page }) => {
    await page.clock.setFixedTime(FIXED_TIME);
    await page.goto("/");
    await expect(page.locator(".landing-hero__title")).toBeVisible();
    await expect(page.locator(".landing-hero__img")).toBeVisible();
    await expect(page.locator(".landing-card__img")).toBeVisible();
    await expect(page.locator(".landing-footer")).toContainText("2026");
    await expectImagesLoaded(page);
    await waitForFonts(page);

    await expect(page).toHaveScreenshot("landing-page.png", {
      fullPage: true,
      maxDiffPixelRatio: 0.05,
      animations: "disabled",
    });
  });

  test("@visual auth page renders correctly", async ({ page }) => {
    await page.clock.setFixedTime(FIXED_TIME);
    await page.goto("/auth");
    await expect(page.locator(".auth-card")).toBeVisible();
    await waitForFonts(page);

    await expect(page).toHaveScreenshot("auth-page.png", {
      maxDiffPixelRatio: 0.05,
      animations: "disabled",
    });
  });

  test("@visual desktop app shell renders correctly", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await openSettledDashboard(context);

    await expect(page).toHaveScreenshot("app-shell-desktop.png", {
      maxDiffPixelRatio: 0.05,
      animations: "disabled",
    });

    await context.close();
  });

  test("@visual command palette renders correctly", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await openSettledDashboard(context);

    await page.keyboard.press("Control+k");
    const palette = page.locator(".command-palette[role='dialog']");
    await expect(palette).toBeVisible();
    await expect(palette.locator(".command-palette__input")).toBeFocused();
    await expect(palette.getByRole("option").first()).toBeVisible();

    await expect(page).toHaveScreenshot("command-palette.png", {
      maxDiffPixelRatio: 0.05,
      animations: "disabled",
    });

    await context.close();
  });
});
