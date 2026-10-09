// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { TabBar } from "./TabBar";

const { createElement } = React;

const defaultProps = {
  activeTab: "inbox" as const,
  customView: "all",
  onTabChange: vi.fn(),
  onFabPress: vi.fn(),
};

describe("TabBar", () => {
  it("renders all tabs with correct labels", () => {
    render(createElement(TabBar, defaultProps));

    expect(screen.getByText("Inbox")).toBeTruthy();
    expect(screen.getByText("Today")).toBeTruthy();
    expect(screen.getByText("Projects")).toBeTruthy();
    expect(screen.getByText("Tasks")).toBeTruthy();
  });

  it("marks the active tab as selected", () => {
    render(createElement(TabBar, defaultProps));

    const inboxTab = screen.getByText("Inbox").closest("button");
    expect(inboxTab).toHaveClass("m-tab-bar__tab--active");
    expect(inboxTab).toHaveAttribute("aria-selected", "true");

    const todayTab = screen.getByText("Today").closest("button");
    expect(todayTab).not.toHaveClass("m-tab-bar__tab--active");
  });

  it("calls onTabChange when a tab is clicked", () => {
    const onTabChange = vi.fn();
    render(createElement(TabBar, { ...defaultProps, onTabChange }));

    fireEvent.click(screen.getByText("Today"));
    expect(onTabChange).toHaveBeenCalledWith("today");

    fireEvent.click(screen.getByText("Projects"));
    expect(onTabChange).toHaveBeenCalledWith("projects");

    fireEvent.click(screen.getByText("Inbox"));
    expect(onTabChange).toHaveBeenCalledWith("inbox");
  });

  it("calls onFabPress when FAB is clicked", () => {
    const onFabPress = vi.fn();
    render(createElement(TabBar, { ...defaultProps, onFabPress }));

    const fab = screen.getByRole("button", { name: "Quick capture" });
    fireEvent.click(fab);
    expect(onFabPress).toHaveBeenCalled();
  });

  it("shows custom view label for custom tab", () => {
    render(createElement(TabBar, { ...defaultProps, customView: "completed" }));

    expect(screen.getByText("Completed")).toBeTruthy();
  });

  it("falls back to 'More' for unknown custom view", () => {
    render(createElement(TabBar, { ...defaultProps, customView: "unknown" }));

    expect(screen.getByText("More")).toBeTruthy();
  });

  it("has correct accessibility attributes", () => {
    render(createElement(TabBar, defaultProps));

    const nav = screen.getByRole("tablist", { name: "Main navigation" });
    expect(nav).toBeTruthy();

    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(4); // Inbox, Today, Projects, Custom
  });
});
