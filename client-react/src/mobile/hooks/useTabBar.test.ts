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
  it("defaults to focus tab", () => {
    const { result } = renderHook(() => useTabBar());
    expect(result.current.activeTab).toBe("focus");
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
    expect(result.current.activeTab).toBe("focus");
    expect(result.current.customView).toBe("horizon");
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

  it("defaults custom tab to horizon (Upcoming)", () => {
    const { result } = renderHook(() => useTabBar());
    expect(result.current.customView).toBe("horizon");
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
});
