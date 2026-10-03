// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { createElement } from "react";
import { LandingPage } from "./LandingPage";

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
