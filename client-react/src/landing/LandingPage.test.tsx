// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { createElement } from "react";
import { LandingPage } from "./LandingPage";

describe("LandingPage", () => {
  beforeEach(() => {
    window.history.pushState({}, "", "/");
  });

  it("renders the navigation bar with logo", () => {
    const { container } = render(createElement(LandingPage));
    expect(screen.getByText("Planwren")).toBeTruthy();
    expect(container.querySelector(".landing-nav")).toBeTruthy();
  });

  it("renders navigation links", () => {
    render(createElement(LandingPage));
    const links = screen.getAllByRole("link");
    expect(links.some(l => l.textContent === "Features")).toBeTruthy();
    expect(links.some(l => l.textContent === "Log in")).toBeTruthy();
    expect(links.some(l => l.textContent === "Start for free")).toBeTruthy();
  });

  it("renders the hero section with heading", () => {
    render(createElement(LandingPage));
    expect(
      screen.getByText(/Plan your days\. Review your weeks/),
    ).toBeTruthy();
  });

  it("renders hero CTA buttons", () => {
    render(createElement(LandingPage));
    const links = screen.getAllByRole("link");
    expect(links.some(l => l.textContent === "Start for free")).toBeTruthy();
    expect(links.some(l => l.textContent === "See features")).toBeTruthy();
  });

  it("renders hero screenshot", () => {
    render(createElement(LandingPage));
    const img = screen.getByAltText(
      /Planning workspace with home dashboard/,
    );
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
    const darkModeCard = screen.getByText("Dark Mode").closest(
      ".landing-card",
    );
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
    const loginLink = links.find(l => l.textContent === "Log in");
    const registerLink = links.find(l => l.textContent === "Start for free");
    expect(loginLink).toHaveAttribute("href", "/auth?next=%2Fapp&tab=login");
    expect(registerLink).toHaveAttribute(
      "href",
      "/auth?next=%2Fapp&tab=register",
    );
  });
});
