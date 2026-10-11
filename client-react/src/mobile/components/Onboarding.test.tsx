// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { Onboarding } from "./Onboarding";

const { createElement } = React;

describe("Onboarding", () => {
  beforeEach(() => {
    localStorage.removeItem("mobile:onboardingDone");
  });

  it("renders the first step by default", () => {
    render(createElement(Onboarding));

    expect(screen.getByText("Swipe to act")).toBeTruthy();
    expect(screen.getByText(/Swipe right to complete/)).toBeTruthy();
  });

  it("shows Next button on first step", () => {
    render(createElement(Onboarding));

    expect(screen.getByText("Next")).toBeTruthy();
  });

  it("advances to next step when Next is clicked", () => {
    render(createElement(Onboarding));

    fireEvent.click(screen.getByText("Next"));
    expect(screen.getByText("Quick capture")).toBeTruthy();
  });

  it("shows Get started on last step", () => {
    render(createElement(Onboarding));

    // Click through all steps
    fireEvent.click(screen.getByText("Next"));
    fireEvent.click(screen.getByText("Next"));
    expect(screen.getByText("Get started")).toBeTruthy();
  });

  it("dismisses onboarding when Get started is clicked", () => {
    const { container, rerender } = render(createElement(Onboarding));

    // Click through all steps
    fireEvent.click(screen.getByText("Next"));
    fireEvent.click(screen.getByText("Next"));
    fireEvent.click(screen.getByText("Get started"));

    // Onboarding should be dismissed (renders nothing)
    rerender(createElement(Onboarding));
    expect(container.firstChild).toBeNull();
  });

  it("dismisses onboarding when Skip is clicked", () => {
    const { container, rerender } = render(createElement(Onboarding));

    fireEvent.click(screen.getByText("Skip"));

    // Onboarding should be dismissed
    rerender(createElement(Onboarding));
    expect(container.firstChild).toBeNull();
  });

  it("does not render if already dismissed", () => {
    localStorage.setItem("mobile:onboardingDone", "1");

    const { container } = render(createElement(Onboarding));
    expect(container.firstChild).toBeNull();
  });

  it("shows dot indicators for steps", () => {
    render(createElement(Onboarding));

    const dots = document.querySelectorAll(".m-onboarding__dot");
    expect(dots).toHaveLength(3); // 3 steps
  });

  it("highlights the active dot", () => {
    render(createElement(Onboarding));

    const activeDot = document.querySelector(".m-onboarding__dot--active");
    expect(activeDot).toBeTruthy();
  });

  it("owns keyboard focus and background until dismissed, then restores them", () => {
    const background = render(createElement("button", null, "Outside"));
    const trigger = screen.getByRole("button", { name: "Outside" });
    trigger.focus();
    render(createElement(Onboarding));

    const dialog = screen.getByRole("dialog", { name: "Swipe to act" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleDescription(/choose when to plan it/);
    expect(background.container).toHaveAttribute("inert");
    expect(document.body.style.overflow).toBe("hidden");
    expect(screen.getByRole("button", { name: "Next" })).toHaveFocus();

    fireEvent.keyDown(document, { key: "Tab" });
    expect(screen.getByRole("button", { name: "Skip" })).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(screen.getByRole("button", { name: "Next" })).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(background.container).not.toHaveAttribute("inert");
    expect(document.body.style.overflow).toBe("");
    expect(trigger).toHaveFocus();
    expect(localStorage.getItem("mobile:onboardingDone")).toBe("1");
  });

  it("keeps the guide accessible as its step changes", () => {
    render(createElement(Onboarding));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("dialog", { name: "Quick capture" })).toBeTruthy();
    expect(screen.getByText("Step 2 of 3")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(
      screen.getByRole("dialog", { name: "Tap for details" }),
    ).toHaveAccessibleDescription(/Choose Edit/);
    expect(screen.queryByText(/Drag up for more|snooze/)).toBeNull();
  });
});
