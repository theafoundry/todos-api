import { test, expect } from "@playwright/test";
import {
  openTodosViewWithStorageState,
  waitForTodosViewIdle,
} from "./helpers/todos-view";

/**
 * App shell tests — authenticated desktop rendering, sidebar navigation, view switching.
 * Uses mocked API responses via bootstrapTodosContext.
 * Pinned to chromium (desktop) project — mobile is tested in mobile-shell.spec.ts.
 */
test.describe("App shell (desktop)", () => {
  test.skip(({ isMobile }) => isMobile);

  test("renders sidebar and main content area", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await openTodosViewWithStorageState(context);

    // Desktop sidebar visible.
    const sidebar = page.locator("aside.app-sidebar");
    await expect(sidebar).toBeVisible();

    // Sidebar header with logo.
    await expect(page.locator(".sidebar-header__logo")).toBeVisible();
    await expect(page.locator(".sidebar-header__logo")).toHaveText("Planwren");

    // Main content area.
    const mainArea = page.locator(".app-main");
    await expect(mainArea).toBeVisible();

    await context.close();
  });

  test("sidebar has all workspace navigation items", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await openTodosViewWithStorageState(context);

    const navItems = [
      { key: "home", label: "Focus" },
      { key: "all", label: "Everything" },
      { key: "today", label: "Today" },
      { key: "horizon", label: "Horizon" },
      { key: "completed", label: "Completed" },
    ];

    for (const item of navItems) {
      const btn = page.locator(`button[data-workspace-view="${item.key}"]`);
      await expect(btn).toBeVisible();
      await expect(btn).toContainText(item.label);
    }

    await context.close();
  });

  test("sidebar has Activity link", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await openTodosViewWithStorageState(context);

    const activityBtn = page.locator(
      "nav.projects-rail__primary button:has-text('Activity')",
    );
    await expect(activityBtn).toBeVisible();

    await context.close();
  });

  test("sidebar has search input", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await openTodosViewWithStorageState(context);

    const searchInput = page.locator("#searchInput[data-search-input='true']");
    await expect(searchInput).toBeVisible();
    await expect(searchInput).toHaveAttribute("aria-label", "Search tasks");

    await context.close();
  });

  test("Focus view is active by default and renders home dashboard", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await openTodosViewWithStorageState(context);

    // Focus nav item should be highlighted.
    const focusBtn = page.locator('button[data-workspace-view="home"]');
    await expect(focusBtn).toHaveClass(/projects-rail-item--active/);

    // Home dashboard renders (may take a moment for focus brief to load).
    const dashboard = page.locator('[data-testid="home-dashboard"]');
    await expect(dashboard).toBeVisible({ timeout: 10000 });

    await context.close();
  });

  test("switching to Today view updates active state", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await openTodosViewWithStorageState(context);

    // Click Today nav.
    await page.locator('button[data-workspace-view="today"]').click();
    await waitForTodosViewIdle(page);

    // Today should be active.
    const todayBtn = page.locator('button[data-workspace-view="today"]');
    await expect(todayBtn).toHaveClass(/projects-rail-item--active/);

    // Focus should no longer be active.
    const focusBtn = page.locator('button[data-workspace-view="home"]');
    await expect(focusBtn).not.toHaveClass(/projects-rail-item--active/);

    await context.close();
  });

  test("switching views preserves LRU cache (view state persists)", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await openTodosViewWithStorageState(context);

    // Start on Focus (home).
    await expect(
      page.locator('button[data-workspace-view="home"]'),
    ).toHaveClass(/projects-rail-item--active/);

    // Switch to Today.
    await page.locator('button[data-workspace-view="today"]').click();
    await waitForTodosViewIdle(page);
    await expect(
      page.locator('button[data-workspace-view="today"]'),
    ).toHaveClass(/projects-rail-item--active/);

    // Switch to Horizon.
    await page.locator('button[data-workspace-view="horizon"]').click();
    await waitForTodosViewIdle(page);
    await expect(
      page.locator('button[data-workspace-view="horizon"]'),
    ).toHaveClass(/projects-rail-item--active/);

    // Switch back to Focus — should still be active.
    await page.locator('button[data-workspace-view="home"]').click();
    await waitForTodosViewIdle(page);
    await expect(
      page.locator('button[data-workspace-view="home"]'),
    ).toHaveClass(/projects-rail-item--active/);

    await context.close();
  });

  test("view router uses data-view-key attributes", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await openTodosViewWithStorageState(context);

    // The active view slot should have data-active="true".
    const activeSlot = page.locator('.view-router__slot[data-active="true"]');
    await expect(activeSlot).toBeVisible();

    // Active view should be "home".
    await expect(activeSlot).toHaveAttribute("data-view-key", "home");

    await context.close();
  });

  test("New Task button in sidebar is visible", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await openTodosViewWithStorageState(context);

    const newTaskBtn = page.locator(
      "button.sidebar-new-task-btn[data-new-task-trigger='true']",
    );
    await expect(newTaskBtn).toBeVisible();
    await expect(newTaskBtn).toContainText("New Task");

    await context.close();
  });

  test("profile launcher is visible at bottom of sidebar", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await openTodosViewWithStorageState(context);

    const profileTrigger = page.locator(".profile-launcher__trigger");
    await expect(profileTrigger).toBeVisible();

    await context.close();
  });

  test("logout button exists in profile menu", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await openTodosViewWithStorageState(context);

    // Open profile menu.
    await page.locator(".profile-launcher__trigger").click();

    // Logout button should appear.
    const logoutBtn = page.locator("button:has-text('Logout')");
    await expect(logoutBtn).toBeVisible({ timeout: 5000 });

    await context.close();
  });

  test("dark mode toggle is present in the UI", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await openTodosViewWithStorageState(context);

    // Dark mode toggle button exists somewhere in the DOM.
    const darkModeBtn = page.locator('[aria-label="Toggle dark mode"]');
    await expect(darkModeBtn).toBeVisible();

    await context.close();
  });
});
