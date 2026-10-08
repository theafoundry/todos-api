// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTabBar } from "./useTabBar";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => vi.restoreAllMocks());

describe("useTabBar", () => {
  it("defaults to the capture review Inbox", () => {
    const { result } = renderHook(() => useTabBar());
    expect(result.current.activeTab).toBe("inbox");
  });

  it("switches tabs", () => {
    const { result } = renderHook(() => useTabBar());
    act(() => result.current.setActiveTab("today"));
    expect(result.current.activeTab).toBe("today");
  });

  it("restores the selected tab after reload", () => {
    const first = renderHook(() => useTabBar());
    act(() => first.result.current.setActiveTab("projects"));
    first.unmount();
    const second = renderHook(() => useTabBar());
    expect(second.result.current.activeTab).toBe("projects");
    expect(sessionStorage.getItem("mobile:activeTab")).toBe("projects");
  });

  it("ignores obsolete or corrupted stored tab values", () => {
    sessionStorage.setItem("mobile:activeTab", "obsolete-tab");
    localStorage.setItem("mobile:customTab", "obsolete-view");
    const { result } = renderHook(() => useTabBar());
    expect(result.current.activeTab).toBe("inbox");
    expect(result.current.customView).toBe("all");
  });

  it("still switches tabs when session storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Blocked", "SecurityError");
    });
    const { result } = renderHook(() => useTabBar());
    act(() => result.current.setActiveTab("today"));
    expect(result.current.activeTab).toBe("today");
  });

  it("defaults custom tab to Tasks", () => {
    const { result } = renderHook(() => useTabBar());
    expect(result.current.customView).toBe("all");
  });

  it("persists custom view to localStorage", () => {
    const { result } = renderHook(() => useTabBar());
    act(() => result.current.setCustomView("horizon"));
    expect(result.current.customView).toBe("horizon");
    expect(localStorage.getItem("mobile:customTab")).toBe("horizon");
  });

  it("restores custom view from localStorage", () => {
    localStorage.setItem("mobile:customTab", "completed");
    const { result } = renderHook(() => useTabBar());
    expect(result.current.customView).toBe("completed");
  });

  it("retains the existing Focus session and optional fourth-tab choice", () => {
    sessionStorage.setItem("mobile:activeTab", "focus");
    localStorage.setItem("mobile:customTab", "horizon");
    const { result } = renderHook(() => useTabBar());
    expect(result.current.activeTab).toBe("focus");
    expect(result.current.customView).toBe("horizon");
    act(() => result.current.setCustomView("home"));
    expect(result.current.customView).toBe("home");
  });

  it("opens all Tasks without overwriting the configured fourth tab", () => {
    localStorage.setItem("mobile:customTab", "completed");
    const { result } = renderHook(() => useTabBar());
    act(() => result.current.setActiveTab("tasks"));
    expect(result.current.activeTab).toBe("tasks");
    expect(result.current.customView).toBe("completed");
    expect(localStorage.getItem("mobile:customTab")).toBe("completed");
  });
});
