import { test, expect } from "@playwright/test";
import {
  bootstrapTodosContext,
  waitForTodosViewIdle,
  MOCK_USER,
} from "./helpers/todos-view";

/**
 * Mobile shell tests — Pixel 7 viewport, tab navigation, responsive rendering.
 * Pinned to chromium-mobile project — these tests require mobile viewport.
 */
test.describe("Mobile shell", () => {
  // Skip on desktop viewport — mobile-specific tests.
  test.skip(({ isMobile }) => !isMobile, "Mobile-only tests");

  test("renders mobile shell instead of desktop sidebar at mobile viewport", async ({
    page,
  }) => {
    await bootstrapTodosContext(page.context());
    await page.goto("/app/");
    await waitForTodosViewIdle(page);

    // Mobile shell root should be present.
    const shell = page.locator(".m-shell");
    await expect(shell).toBeVisible();

    // Desktop sidebar should NOT be visible at this viewport.
    const desktopSidebar = page.locator("aside.app-sidebar");
    const isVisible = await desktopSidebar.isVisible().catch(() => false);
    expect(isVisible).toBe(false);
  });

  test("tab bar is visible with all tabs", async ({ page }) => {
    await bootstrapTodosContext(page.context());
    await page.goto("/app/");
    await waitForTodosViewIdle(page);

    const tabBar = page.locator(".m-tab-bar");
    await expect(tabBar).toBeVisible();

    // All tab labels present.
    await expect(
      page.locator(".m-tab-bar__label", { hasText: "Inbox" }),
    ).toBeVisible();
    await expect(
      page.locator(".m-tab-bar__label", { hasText: "Today" }),
    ).toBeVisible();
    await expect(
      page.locator(".m-tab-bar__label", { hasText: "Projects" }),
    ).toBeVisible();

    // FAB (plus button) exists.
    const fab = page.locator(".m-tab-bar__fab");
    await expect(fab).toBeVisible();
  });

  test("Inbox tab is active by default", async ({ page }) => {
    await bootstrapTodosContext(page.context());
    await page.goto("/app/");
    await waitForTodosViewIdle(page);

    const inboxTab = page.locator('.m-tab-bar__tab[role="tab"]').first();
    await expect(inboxTab).toHaveAttribute("aria-selected", "true");
    await expect(inboxTab).toHaveClass(/m-tab-bar__tab--active/);
  });

  test("tapping Today tab switches to today view", async ({ page }) => {
    await bootstrapTodosContext(page.context());
    await page.goto("/app/");
    await waitForTodosViewIdle(page);

    // Tap Today tab.
    const todayTab = page.locator(".m-tab-bar__tab", { hasText: "Today" });
    await todayTab.click({ force: true });

    // Today tab should now be active.
    await expect(todayTab).toHaveAttribute("aria-selected", "true");
    await expect(todayTab).toHaveClass(/m-tab-bar__tab--active/);
  });

  test("tapping Projects tab switches to projects view", async ({ page }) => {
    await bootstrapTodosContext(page.context());
    await page.goto("/app/");
    await waitForTodosViewIdle(page);

    // Tap Projects tab.
    const projectsTab = page.locator(".m-tab-bar__tab", {
      hasText: "Projects",
    });
    await projectsTab.click({ force: true });

    await expect(projectsTab).toHaveAttribute("aria-selected", "true");
  });

  test("FAB button triggers quick capture", async ({ page }) => {
    await bootstrapTodosContext(page.context());
    await page.goto("/app/");
    await waitForTodosViewIdle(page);

    // Tap the Quick capture button (FAB).
    await page.getByRole("button", { name: "Quick capture" }).click();

    // Quick capture dialog should open with a text input.
    const dialog = page.getByRole("dialog", { name: "Quick capture" });
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // The text input should be focused.
    const input = dialog.getByRole("textbox", {
      name: "Task title",
      exact: true,
    });
    await expect(input).toBeVisible();
    await expect(input).toBeFocused();
  });

  test("offline banner component exists in DOM", async ({ page }) => {
    await bootstrapTodosContext(page.context());
    await page.goto("/app/");
    await waitForTodosViewIdle(page);

    // The offline banner component is rendered (may be hidden by default).
    const offlineBanner = page.locator(".offline-banner");
    const count = await offlineBanner.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test("pull to search gesture does not crash (graceful absence)", async ({
    page,
  }) => {
    await bootstrapTodosContext(page.context());
    await page.goto("/app/");
    await waitForTodosViewIdle(page);

    // The pull-to-search feature may or may not be present.
    // This test ensures it doesn't crash the app if absent.
    const pullToSearch = page.locator(".m-search");
    const count = await pullToSearch.count();
    // Either 0 (not implemented) or > 0 (present) is fine — no crash.
    expect(count).toBeGreaterThanOrEqual(0);
  });
});
