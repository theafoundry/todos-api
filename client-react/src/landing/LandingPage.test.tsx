// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { LandingPage } from "./LandingPage";

const NARROW = "(max-width: 639px)";
const DARK = "(prefers-color-scheme: dark)";
const MOBILE_LIGHT = "/images/landing/hero-mobile-light.png";
const MOBILE_DARK = "/images/landing/hero-mobile-dark.png";

/** Install a matchMedia stub answering per query; returns a restore fn. */
function mockMatchMedia(matching: Partial<Record<string, boolean>>) {
  const original = window.matchMedia;
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: matching[query] ?? false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  return () => {
    window.matchMedia = original;
  };
}

function heroSource(container: HTMLElement) {
  const source = container.querySelector(".landing-hero__picture > source");
  expect(source).not.toBeNull();
  return source as HTMLSourceElement;
}

describe("LandingPage", () => {
  beforeEach(() => {
    window.history.pushState({}, "", "/");
    window.localStorage.removeItem("darkMode");
    document.body.classList.remove("dark-mode");
  });

  it("exposes banner, navigation, main and footer landmarks", () => {
    render(createElement(LandingPage));
    expect(screen.getByRole("banner")).toHaveClass("landing-nav");
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeTruthy();
    expect(screen.getByRole("main")).toHaveAttribute("id", "landing-main");
    expect(screen.getByRole("contentinfo")).toHaveClass("landing-footer");
    expect(
      screen.getByRole("link", { name: "Skip to content" }),
    ).toHaveAttribute("href", "#landing-main");
  });

  it("keeps a single h1 and h3 headings under each section heading", () => {
    render(createElement(LandingPage));
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(10);
    expect(screen.queryAllByRole("heading", { level: 4 })).toHaveLength(0);
  });

  it("adds the public scope class only while mounted", () => {
    const { unmount } = render(createElement(LandingPage));
    expect(document.body).toHaveClass("pw-public");
    unmount();
    expect(document.body).not.toHaveClass("pw-public");
  });

  it("follows a saved dark appearance without persisting a new choice", () => {
    window.localStorage.setItem("darkMode", "true");
    render(createElement(LandingPage));
    expect(document.body).toHaveClass("dark-mode");
    expect(window.localStorage.getItem("darkMode")).toBe("true");
  });

  it("stays light without a saved preference when system theme is unknown", () => {
    render(createElement(LandingPage));
    expect(document.body).not.toHaveClass("dark-mode");
    expect(window.localStorage.getItem("darkMode")).toBeNull();
  });

  it("follows the system dark preference when nothing is saved", () => {
    const original = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === "(prefers-color-scheme: dark)",
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    try {
      render(createElement(LandingPage));
      expect(document.body).toHaveClass("dark-mode");
      expect(window.localStorage.getItem("darkMode")).toBeNull();
    } finally {
      window.matchMedia = original;
    }
  });

  it("renders the navigation bar with logo", () => {
    const { container } = render(createElement(LandingPage));
    expect(screen.getByText("Planwren")).toBeTruthy();
    expect(container.querySelector(".landing-nav")).toBeTruthy();
  });

  it("gives the logo link an accessible home name", () => {
    render(createElement(LandingPage));
    expect(screen.getByRole("link", { name: "Planwren home" })).toHaveAttribute(
      "href",
      "/",
    );
  });

  it("renders navigation links", () => {
    render(createElement(LandingPage));
    const links = screen.getAllByRole("link");
    expect(links.some((l) => l.textContent === "Features")).toBeTruthy();
    expect(links.some((l) => l.textContent === "Log in")).toBeTruthy();
    expect(links.some((l) => l.textContent === "Start for free")).toBeTruthy();
  });

  it("renders the hero section with heading", () => {
    render(createElement(LandingPage));
    expect(screen.getByText(/Plan your days\. Review your weeks/)).toBeTruthy();
  });

  it("renders hero CTA buttons", () => {
    render(createElement(LandingPage));
    const links = screen.getAllByRole("link");
    expect(links.some((l) => l.textContent === "Start for free")).toBeTruthy();
    expect(links.some((l) => l.textContent === "See features")).toBeTruthy();
  });

  it("renders hero screenshot", () => {
    render(createElement(LandingPage));
    const img = screen.getByAltText(/Planning workspace with home dashboard/);
    expect(img).toBeTruthy();
    expect(img).toHaveAttribute("src", "/images/landing/hero-desktop.png");
  });

  it("art-directs the hero with a narrow mobile source and desktop fallback", () => {
    const { container } = render(createElement(LandingPage));
    const picture = container.querySelector(".landing-hero__picture");
    expect(picture?.tagName).toBe("PICTURE");

    const source = heroSource(container);
    expect(source).toHaveAttribute("media", NARROW);
    expect(source).toHaveAttribute("srcset", MOBILE_LIGHT);
    expect(source).toHaveAttribute("width", "390");
    expect(source).toHaveAttribute("height", "844");

    // The <img> stays last in <picture> and keeps the desktop fallback.
    const img = picture?.querySelector("img");
    expect(picture?.lastElementChild).toBe(img);
    expect(img).toHaveAttribute("src", "/images/landing/hero-desktop.png");
    expect(img).toHaveAttribute("loading", "eager");
    expect(img).toHaveClass("landing-hero__img");
  });

  it("uses the dark mobile hero when a saved preference overrides a light system", () => {
    window.localStorage.setItem("darkMode", "true");
    const restore = mockMatchMedia({ [DARK]: false });
    try {
      const { container } = render(createElement(LandingPage));
      expect(document.body).toHaveClass("dark-mode");
      expect(heroSource(container)).toHaveAttribute("srcset", MOBILE_DARK);
    } finally {
      restore();
    }
  });

  it("uses the light mobile hero when a saved preference overrides a dark system", () => {
    window.localStorage.setItem("darkMode", "false");
    const restore = mockMatchMedia({ [DARK]: true });
    try {
      const { container } = render(createElement(LandingPage));
      expect(document.body).not.toHaveClass("dark-mode");
      expect(heroSource(container)).toHaveAttribute("srcset", MOBILE_LIGHT);
    } finally {
      restore();
    }
  });

  it("follows the system theme for the mobile hero when nothing is saved", () => {
    const restore = mockMatchMedia({ [DARK]: true });
    try {
      const { container } = render(createElement(LandingPage));
      expect(heroSource(container)).toHaveAttribute("srcset", MOBILE_DARK);
      expect(window.localStorage.getItem("darkMode")).toBeNull();
    } finally {
      restore();
    }
  });

  it("switches the mobile hero when the saved theme changes in another tab", () => {
    const { container } = render(createElement(LandingPage));
    expect(heroSource(container)).toHaveAttribute("srcset", MOBILE_LIGHT);

    window.localStorage.setItem("darkMode", "true");
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "darkMode" }));
    });
    expect(document.body).toHaveClass("dark-mode");
    expect(heroSource(container)).toHaveAttribute("srcset", MOBILE_DARK);
  });

  it("gives only the dark mode card a mobile source with a desktop fallback", () => {
    const { container } = render(createElement(LandingPage));
    const pictures = container.querySelectorAll(".landing-card__picture");
    expect(pictures).toHaveLength(1);

    const card = screen.getByText("Dark Mode").closest(".landing-card");
    const picture = card?.querySelector(".landing-card__picture");
    expect(picture?.tagName).toBe("PICTURE");
    const source = picture?.querySelector("source");
    expect(source).toHaveAttribute("media", NARROW);
    // The card always demonstrates dark mode, independent of page theme.
    expect(source).toHaveAttribute("srcset", MOBILE_DARK);
    expect(source).toHaveAttribute("width", "390");
    expect(source).toHaveAttribute("height", "844");

    const img = picture?.querySelector("img");
    expect(img).toHaveAttribute("src", "/images/landing/dark-mode.png");
    expect(img).toHaveAttribute("loading", "lazy");
  });

  it("describes the mobile screenshots in alt text on narrow viewports", () => {
    const restore = mockMatchMedia({ [NARROW]: true });
    try {
      render(createElement(LandingPage));
      const hero = screen.getByAltText(
        "Mobile Today view with a list of tasks",
      );
      expect(hero).toHaveClass("landing-hero__img");
      // Fallback src is unchanged; only the matched <source> differs.
      expect(hero).toHaveAttribute("src", "/images/landing/hero-desktop.png");
      expect(
        screen.getByAltText("Mobile Today view in dark mode"),
      ).toHaveAttribute("src", "/images/landing/dark-mode.png");
      expect(
        screen.queryByAltText(/Planning workspace with home dashboard/),
      ).toBeNull();
    } finally {
      restore();
    }
  });

  it("renders the features section with heading", () => {
    render(createElement(LandingPage));
    expect(
      screen.getByText(/A planning workspace that works the way you think/),
    ).toBeTruthy();
  });

  it("renders all four feature cards", () => {
    render(createElement(LandingPage));
    expect(
      screen.getByText(/A daily plan that balances priorities and deadlines/),
    ).toBeTruthy();
    expect(screen.getByText(/Capture anything, organize later/)).toBeTruthy();
    expect(screen.getByText(/Review your week, stay honest/)).toBeTruthy();
    expect(
      screen.getByText(/Your AI assistant already knows your tasks/),
    ).toBeTruthy();
  });

  it("renders the capabilities section with heading", () => {
    render(createElement(LandingPage));
    expect(screen.getByText("Built for real workflows")).toBeTruthy();
  });

  it("renders all six capability cards", () => {
    render(createElement(LandingPage));
    expect(screen.getByText("Projects & Areas")).toBeTruthy();
    expect(screen.getByText("Filters & Views")).toBeTruthy();
    expect(screen.getByText("Focus Dashboard")).toBeTruthy();
    expect(screen.getByText("Desk")).toBeTruthy();
    expect(screen.getByText("Keyboard First")).toBeTruthy();
    expect(screen.getByText("Dark Mode")).toBeTruthy();
  });

  it("renders the dark mode card with wide class and image", () => {
    render(createElement(LandingPage));
    const darkModeCard = screen.getByText("Dark Mode").closest(".landing-card");
    expect(darkModeCard).toHaveClass("landing-card--wide");
    const img = screen.getByAltText("Planning workspace in dark mode");
    expect(img).toHaveAttribute("src", "/images/landing/dark-mode.png");
  });

  it("renders the final CTA section", () => {
    render(createElement(LandingPage));
    expect(screen.getByText(/Get started/i)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Create free account" }),
    ).toBeTruthy();
  });

  it("renders the footer with copyright", () => {
    render(createElement(LandingPage));
    const year = new Date().getFullYear();
    expect(screen.getByText(new RegExp(`© ${year} Planwren`))).toBeTruthy();
  });

  it("has correct anchor links in navigation", () => {
    render(createElement(LandingPage));
    const featuresLink = screen.getByRole("link", { name: "Features" });
    expect(featuresLink).toHaveAttribute("href", "#landing-features");
  });

  it("has correct auth links with next parameter", () => {
    render(createElement(LandingPage));
    const links = screen.getAllByRole("link");
    const loginLink = links.find((l) => l.textContent === "Log in");
    const registerLink = links.find((l) => l.textContent === "Start for free");
    expect(loginLink).toHaveAttribute("href", "/auth?next=%2Fapp&tab=login");
    expect(registerLink).toHaveAttribute(
      "href",
      "/auth?next=%2Fapp&tab=register",
    );
  });
});
