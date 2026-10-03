import { test, expect, type Locator, type Page } from "@playwright/test";
import {
  bootstrapTodosContext,
  waitForTodosViewIdle,
} from "./helpers/todos-view";

const FIXED_TIME = new Date("2026-01-15T15:00:00Z");
const REGISTER_URL = "/auth?next=%2Fapp&tab=register";
const LOGIN_URL = "/auth?next=%2Fapp&tab=login";
type Theme = "light" | "dark";

/** Keep provider availability deterministic without visiting an OAuth provider. */
async function mockProviders(page: Page): Promise<void> {
  await page.route("**/auth/providers", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ google: true, apple: false, phone: false }),
    }),
  );
}

async function setThemePreference(
  page: Page,
  system: Theme,
  saved: Theme | null = null,
): Promise<void> {
  await page.emulateMedia({ colorScheme: system });
  await page.addInitScript((preference) => {
    if (preference === null) {
      localStorage.removeItem("darkMode");
    } else {
      localStorage.setItem("darkMode", String(preference === "dark"));
    }
  }, saved);
}

async function expectTheme(page: Page, theme: Theme): Promise<void> {
  if (theme === "dark") {
    await expect(page.locator("body")).toHaveClass(/dark-mode/);
  } else {
    await expect(page.locator("body")).not.toHaveClass(/dark-mode/);
  }
}

/** Wait for real page content, fonts, and every lazy image before capture. */
async function openSettledPublicPage(page: Page, path: string): Promise<void> {
  await page.goto(path);
  if (path === "/") {
    await expect(page.locator(".landing-hero__title")).toBeVisible();
    await expect(page.locator(".landing-hero__img")).toBeVisible();
    await expect(page.locator(".landing-card__img")).toBeVisible();
    await expect(page.locator(".landing-footer")).toContainText("2026");
  } else {
    await expect(page.locator(".auth-card")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Welcome back" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Continue with Google" }),
    ).toBeVisible();
  }

  const images = page.locator("img");
  for (let index = 0; index < (await images.count()); index += 1) {
    const image = images.nth(index);
    const src = await image.getAttribute("src");
    await image.scrollIntoViewIfNeeded();
    await expect
      .poll(
        () =>
          image.evaluate((element: HTMLImageElement) =>
            Boolean(element.complete && element.naturalWidth > 0),
          ),
        { message: `image ${src} must finish loading` },
      )
      .toBe(true);
  }
  await page.evaluate(async () => {
    await document.fonts.ready;
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    root: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(dimensions.root).toBeLessThanOrEqual(dimensions.viewport);
  expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport);

  // Also detect clipped interactive controls if overflow-x is hidden.
  const controls = page.locator("a, button, input");
  for (let index = 0; index < (await controls.count()); index += 1) {
    const control = controls.nth(index);
    if (!(await control.isVisible())) continue;
    const box = await control.boundingBox();
    expect(box, "visible controls must have a bounding box").not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(-0.5);
    expect(box!.x + box!.width).toBeLessThanOrEqual(dimensions.viewport + 0.5);
  }
}

async function expectTapTargets(controls: Locator): Promise<void> {
  expect(await controls.count()).toBeGreaterThan(0);
  for (let index = 0; index < (await controls.count()); index += 1) {
    const control = controls.nth(index);
    if (!(await control.isVisible())) continue;
    const box = await control.boundingBox();
    const label = await control.evaluate(
      (element) =>
        element.getAttribute("aria-label")?.trim() ||
        element.textContent?.trim() ||
        element.id ||
        element.tagName.toLowerCase(),
    );
    expect(box, `${label} must have a bounding box`).not.toBeNull();
    // Chromium can report 43.99999... for an exact 44px target. Round to
    // 0.001 CSSpx so floating-point noise does not change the 44px contract.
    const height = Math.round(box!.height * 1000) / 1000;
    const width = Math.round(box!.width * 1000) / 1000;
    expect(height, `${label} touch target height`).toBeGreaterThanOrEqual(44);
    expect(width, `${label} touch target width`).toBeGreaterThanOrEqual(44);
  }
}

async function expectKeyboardFocus(page: Page, target: Locator): Promise<void> {
  const restingShadow = await target.evaluate(
    (element) => getComputedStyle(element).boxShadow,
  );
  let focused = false;
  for (let index = 0; index < 30; index += 1) {
    await page.keyboard.press("Tab");
    focused = await target.evaluate(
      (element) => document.activeElement === element,
    );
    if (focused) break;
  }
  expect(focused, "control must be reachable with Tab").toBe(true);
  await expect(target).toBeFocused();
  const indication = await target.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      visible: element.matches(":focus-visible"),
      outline: style.outlineStyle,
      outlineWidth: Number.parseFloat(style.outlineWidth),
      outlineColor: style.outlineColor,
      shadow: style.boxShadow,
    };
  });
  expect(indication.visible).toBe(true);
  const outlineVisible =
    indication.outline !== "none" &&
    indication.outlineWidth >= 2 &&
    indication.outlineColor !== "rgba(0, 0, 0, 0)";
  const shadowVisible =
    indication.shadow !== "none" && indication.shadow !== restingShadow;
  expect(
    outlineVisible || shadowVisible,
    "keyboard focus must be visible",
  ).toBe(true);
}

async function expectActiveAuthTab(
  page: Page,
  activeName: "Login" | "Register",
): Promise<void> {
  const active = page.getByRole("tab", { name: activeName, exact: true });
  const inactive = page.getByRole("tab", {
    name: activeName === "Login" ? "Register" : "Login",
    exact: true,
  });
  await expect(active).toBeFocused();
  await expect(active).toHaveAttribute("aria-selected", "true");
  await expect(active).toHaveAttribute("tabindex", "0");
  await expect(inactive).toHaveAttribute("aria-selected", "false");
  await expect(inactive).toHaveAttribute("tabindex", "-1");
  await expect(page.getByRole("tablist").locator('[tabindex="0"]')).toHaveCount(
    1,
  );
  const activeId = await active.getAttribute("id");
  expect(activeId).not.toBeNull();
  await expect(page.getByRole("tabpanel")).toHaveAttribute(
    "aria-labelledby",
    activeId!,
  );
  await expect(
    page.getByRole("heading", {
      name: activeName === "Login" ? "Welcome back" : "Create your account",
    }),
  ).toBeVisible();
}

test.describe("Public surface behavior", () => {
  test.use({ timezoneId: "UTC" });
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(FIXED_TIME);
    await mockProviders(page);
  });

  test("landing CTAs retain their login and registration destinations", async ({
    page,
  }) => {
    await page.goto("/");
    const starts = page.getByRole("link", {
      name: "Start for free",
      exact: true,
    });
    expect(await starts.count()).toBeGreaterThan(0);
    for (const start of await starts.all()) {
      await expect(start).toHaveAttribute("href", REGISTER_URL);
    }
    await expect(
      page.getByRole("link", { name: "Log in", exact: true }),
    ).toHaveAttribute("href", LOGIN_URL);
    await expect(
      page.getByRole("link", { name: "Create free account" }),
    ).toHaveAttribute("href", REGISTER_URL);
    // This secondary link may be hidden in the narrow navigation layout.
    await expect(
      page.locator(".landing-nav__links a").filter({ hasText: /^Features$/ }),
    ).toHaveAttribute("href", "#landing-features");

    await page.getByRole("link", { name: "Log in", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Welcome back" }),
    ).toBeVisible();
    expect(new URL(page.url()).searchParams.get("next")).toBe("/app");
    expect(new URL(page.url()).searchParams.get("tab")).toBe("login");

    await page.goto("/");
    await starts.first().click();
    await expect(
      page.getByRole("heading", { name: "Create your account" }),
    ).toBeVisible();
    await expect(page.getByRole("tab", { name: "Register" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(new URL(page.url()).searchParams.get("next")).toBe("/app");
    expect(new URL(page.url()).searchParams.get("tab")).toBe("register");
  });

  test("auth login, register, forgot, and reset routes retain their forms", async ({
    page,
  }) => {
    await page.goto(LOGIN_URL);
    await expect(
      page.getByRole("heading", { name: "Welcome back" }),
    ).toBeVisible();
    await expect(page.getByLabel("Email", { exact: true })).toHaveAttribute(
      "autocomplete",
      "email",
    );
    await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute(
      "autocomplete",
      "current-password",
    );
    await page.getByRole("tab", { name: "Register" }).click();
    await expect(
      page.getByRole("heading", { name: "Create your account" }),
    ).toBeVisible();
    await expect(page.getByLabel("Name (optional)")).toBeVisible();
    await page
      .getByRole("button", { name: "Already have an account? Log in" })
      .click();
    await expect(page.getByRole("tab", { name: "Login" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.getByRole("button", { name: "Forgot password?" }).click();
    await expect(
      page.getByRole("heading", { name: "Reset your password" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Send Reset Link" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Back to Login" }).click();
    await expect(
      page.getByRole("heading", { name: "Welcome back" }),
    ).toBeVisible();

    await page.goto("/auth?token=visual-test-reset-token");
    await expect(
      page.getByRole("heading", { name: "Set new password" }),
    ).toBeVisible();
    await expect(
      page.getByLabel("New Password", { exact: true }),
    ).toHaveAttribute("autocomplete", "new-password");
    await expect(
      page.getByLabel("Confirm Password", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Reset Password", exact: true }),
    ).toBeVisible();
  });

  test("Google remains available at the same local OAuth start URL", async ({
    page,
  }) => {
    for (const path of [LOGIN_URL, REGISTER_URL]) {
      await page.goto(path);
      await expect(
        page.getByRole("link", { name: "Continue with Google" }),
      ).toHaveAttribute("href", "/auth/google/start");
    }
  });

  test("auth tab arrows wrap selection and preserve one keyboard tab stop", async ({
    page,
  }) => {
    await page.goto(LOGIN_URL);
    await expectKeyboardFocus(page, page.getByRole("tab", { name: "Login" }));
    await expectActiveAuthTab(page, "Login");

    for (const key of ["ArrowRight", "ArrowLeft"]) {
      await page.keyboard.press(key);
      await expectActiveAuthTab(page, "Register");
      await page.keyboard.press(key);
      await expectActiveAuthTab(page, "Login");
    }
  });

  test("auth tab Home and End move focus and selection to the first and last tabs", async ({
    page,
  }) => {
    await page.goto(REGISTER_URL);
    await expectKeyboardFocus(
      page,
      page.getByRole("tab", { name: "Register" }),
    );
    await expectActiveAuthTab(page, "Register");
    await page.keyboard.press("Home");
    await expectActiveAuthTab(page, "Login");
    await page.keyboard.press("Home");
    await expectActiveAuthTab(page, "Login");
    await page.keyboard.press("End");
    await expectActiveAuthTab(page, "Register");
    await page.keyboard.press("End");
    await expectActiveAuthTab(page, "Register");
  });

  test("public CSS does not override the authenticated desktop app body or palette", async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, "Desktop palette and shell containment");
    await setThemePreference(page, "light", "light");
    await bootstrapTodosContext(page.context());
    await page.goto("/app/");
    await waitForTodosViewIdle(page);
    await expect(page.locator("aside.app-sidebar")).toBeVisible();
    await expect(page.locator(".app-main")).toBeVisible();
    await expect(page.getByTestId("home-dashboard")).toBeVisible();
    await expect(page.locator(".app-main .loading-bar")).toHaveCount(0);
    await expect(page.locator("[aria-busy='true']")).toHaveCount(0);
    await expect(page.locator(".loading-skeleton")).toHaveCount(0);
    await page.evaluate(async () => document.fonts.ready);

    const body = page.locator("body");
    await expect(body).not.toHaveClass(/(?:^|\s)pw-public(?:\s|$)/);
    await expect(body).not.toHaveClass(/dark-mode/);
    const styles = await body.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        background: style.backgroundColor,
        backgroundToken: style.getPropertyValue("--bg").trim(),
        accent: style.getPropertyValue("--accent").trim(),
      };
    });
    expect(styles.backgroundToken).toBe("#f4f7fb");
    expect(styles.background).toBe("rgb(244, 247, 251)");
    expect(styles.background).not.toBe("rgb(255, 252, 245)");
    expect(styles.accent).toBe("#4f6ef7");
  });

  for (const path of ["/", "/auth"]) {
    test(`${path} follows the system theme without a saved preference`, async ({
      page,
    }) => {
      await setThemePreference(page, "light");
      await page.goto(path);
      await expectTheme(page, "light");
      const lightBackground = await page
        .locator(path === "/" ? ".landing-page" : ".auth-page")
        .evaluate((element) => getComputedStyle(element).backgroundColor);
      await page.emulateMedia({ colorScheme: "dark" });
      // A fresh visit must adopt the system preference when none is saved.
      await page.reload();
      await expectTheme(page, "dark");
      const darkBackground = await page
        .locator(path === "/" ? ".landing-page" : ".auth-page")
        .evaluate((element) => getComputedStyle(element).backgroundColor);
      expect(darkBackground).not.toBe(lightBackground);
    });

    for (const saved of ["light", "dark"] as const) {
      test(`${path} respects saved ${saved} over the opposite system theme`, async ({
        page,
      }) => {
        await setThemePreference(
          page,
          saved === "dark" ? "light" : "dark",
          saved,
        );
        await page.goto(path);
        await expectTheme(page, saved);
      });
    }
  }

  for (const width of [320, 390, 1440]) {
    test(`public pages fit ${width}px without clipping controls`, async ({
      page,
      isMobile,
    }) => {
      test.skip(isMobile ? width === 1440 : width !== 1440);
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
      await setThemePreference(page, "light");
      await openSettledPublicPage(page, "/");
      await expect(
        page.getByRole("link", { name: "Log in", exact: true }),
      ).toBeVisible();
      await expectNoHorizontalOverflow(page);
      if (isMobile) {
        await expectTapTargets(
          page.locator(".landing-nav__link, .landing-nav__cta, .landing-btn"),
        );
      }
      await openSettledPublicPage(page, "/auth");
      await expectNoHorizontalOverflow(page);
      if (isMobile) {
        await expectTapTargets(
          page.locator(
            ".auth-card__back, .auth-tab, .auth-form__field input, .auth-form__submit, .auth-form__link, .social-btn",
          ),
        );
      }
      await page.getByRole("tab", { name: "Register" }).click();
      await expect(
        page.getByRole("heading", { name: "Create your account" }),
      ).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.goto("/auth?token=visual-test-reset-token");
      await expect(
        page.getByRole("heading", { name: "Set new password" }),
      ).toBeVisible();
      await expectNoHorizontalOverflow(page);
    });
  }

  for (const width of [320, 390, 639, 640, 768, 1024, 1440]) {
    for (const saved of ["light", "dark"] as const) {
      test(`landing artwork at ${width}px follows effective ${saved} theme`, async ({
        page,
        isMobile,
      }) => {
        test.skip(isMobile ? width >= 640 : width < 640);
        await page.setViewportSize({ width, height: 844 });
        // An opposite system preference catches sources that ignore the
        // app's saved appearance and only use a color-scheme media query.
        await setThemePreference(
          page,
          saved === "dark" ? "light" : "dark",
          saved,
        );
        await openSettledPublicPage(page, "/");
        await expectTheme(page, saved);
        const hero = page.locator(".landing-hero__img");
        const capability = page.locator(".landing-card__img");
        const narrow = width <= 639;
        await expect
          .poll(() => hero.evaluate((img: HTMLImageElement) => img.currentSrc))
          .toContain(narrow ? `hero-mobile-${saved}.png` : "hero-desktop.png");
        await expect
          .poll(() =>
            capability.evaluate((img: HTMLImageElement) => img.currentSrc),
          )
          .toContain(narrow ? "hero-mobile-dark.png" : "dark-mode.png");
        for (const image of [hero, capability]) {
          const dimensions = await image.evaluate((img: HTMLImageElement) => {
            const box = img.getBoundingClientRect();
            const style = getComputedStyle(img);
            return {
              naturalWidth: img.naturalWidth,
              naturalHeight: img.naturalHeight,
              width: box.width,
              height: box.height,
              contentWidth:
                box.width -
                Number.parseFloat(style.borderLeftWidth) -
                Number.parseFloat(style.borderRightWidth),
              contentHeight:
                box.height -
                Number.parseFloat(style.borderTopWidth) -
                Number.parseFloat(style.borderBottomWidth),
            };
          });
          expect(dimensions.naturalWidth).toBe(narrow ? 390 : 1440);
          expect(dimensions.naturalHeight).toBe(narrow ? 844 : 900);
          // Measure the artwork inside its border, which has a different
          // ratio from the image at small sizes. The content must keep its
          // native ratio when the source becomes a portrait.
          expect(
            dimensions.contentWidth / dimensions.contentHeight,
          ).toBeCloseTo(dimensions.naturalWidth / dimensions.naturalHeight, 2);
          if (narrow) {
            expect(dimensions.width).toBeLessThanOrEqual(320);
            expect(dimensions.height).toBeLessThanOrEqual(740);
            expect(dimensions.width).toBeGreaterThanOrEqual(230);
          }
        }
        await expectNoHorizontalOverflow(page);
        if (narrow) {
          await expectTapTargets(page.locator(".landing-nav__logo"));
        }
      });
    }
  }

  test("landing and auth expose visible keyboard focus", async ({ page }) => {
    await setThemePreference(page, "light");
    await page.goto("/");
    await expectKeyboardFocus(
      page,
      page.locator(".landing-btn--primary").first(),
    );
    await page.goto("/auth");
    await expectKeyboardFocus(page, page.locator(".auth-card__back"));
    await expectKeyboardFocus(page, page.getByRole("tab", { name: "Login" }));
    await expectKeyboardFocus(page, page.getByLabel("Email", { exact: true }));
    await expectKeyboardFocus(
      page,
      page.getByRole("button", { name: "Login", exact: true }),
    );
  });
});

for (const theme of ["light", "dark"] as const) {
  test.describe(`@visual public surfaces ${theme}`, () => {
    test.use({ colorScheme: theme, timezoneId: "UTC" });
    test.beforeEach(async ({ page }) => {
      await page.clock.setFixedTime(FIXED_TIME);
      await mockProviders(page);
      await setThemePreference(page, theme);
    });

    test(`@visual full landing page in ${theme} theme`, async ({ page }) => {
      await openSettledPublicPage(page, "/");
      await expectTheme(page, theme);
      await expect(page).toHaveScreenshot(`public-landing-${theme}.png`, {
        fullPage: true,
        maxDiffPixelRatio: 0.05,
        animations: "disabled",
      });
    });

    test(`@visual auth page in ${theme} theme`, async ({ page }) => {
      await openSettledPublicPage(page, "/auth");
      await expectTheme(page, theme);
      await expect(page).toHaveScreenshot(`public-auth-${theme}.png`, {
        fullPage: true,
        maxDiffPixelRatio: 0.05,
        animations: "disabled",
      });
    });
  });
}
