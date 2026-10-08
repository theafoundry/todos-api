// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useScrollPersistence } from "./useScrollPersistence";

let content: HTMLDivElement;
beforeEach(() => {
  sessionStorage.clear();
  content = document.createElement("div");
  content.className = "m-shell__content";
  document.body.append(content);
});
afterEach(() => {
  content.remove();
  vi.restoreAllMocks();
});

function scrollTo(position: number) {
  act(() => {
    content.scrollTop = position;
    content.dispatchEvent(new Event("scroll"));
  });
}

describe("useScrollPersistence", () => {
  it("restores distinct offsets for tabs, project lists, and custom views", () => {
    const { rerender } = renderHook(({ key }) => useScrollPersistence(key), {
      initialProps: { key: "today" },
    });
    scrollTo(320);
    rerender({ key: "projects:project-1" });
    expect(content.scrollTop).toBe(0);
    scrollTo(150);
    rerender({ key: "custom:all" });
    scrollTo(90);
    rerender({ key: "today" });
    expect(content.scrollTop).toBe(320);
    rerender({ key: "projects:project-1" });
    expect(content.scrollTop).toBe(150);
    rerender({ key: "custom:completed" });
    expect(content.scrollTop).toBe(0);
  });

  it("persists a current view offset for reload without requiring a tab switch", () => {
    const first = renderHook(() => useScrollPersistence("today"));
    scrollTo(480);
    first.unmount();
    content.scrollTop = 0;
    renderHook(() => useScrollPersistence("today"));
    expect(content.scrollTop).toBe(480);
  });

  it("waits for fetched content before restoring a reload offset", () => {
    sessionStorage.setItem(
      "mobile:scrollPositions",
      JSON.stringify({ today: 480 }),
    );
    let availableScroll = 0;
    let scrollTop = 0;
    Object.defineProperty(content, "scrollTop", {
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = Math.min(value, availableScroll);
      },
      configurable: true,
    });
    const { rerender } = renderHook(
      ({ ready }) => useScrollPersistence("today", undefined, ready),
      {
        initialProps: { ready: false },
      },
    );
    content.dispatchEvent(new Event("scroll"));
    expect(content.scrollTop).toBe(0);
    expect(
      JSON.parse(sessionStorage.getItem("mobile:scrollPositions")!).today,
    ).toBe(480);
    availableScroll = 1000;
    rerender({ ready: true });
    expect(content.scrollTop).toBe(480);
  });

  it("keeps the user position through a background refresh of an already loaded view", () => {
    const { rerender } = renderHook(
      ({ ready }) => useScrollPersistence("today", undefined, ready),
      { initialProps: { ready: true } },
    );
    scrollTo(300);
    rerender({ ready: false });
    scrollTo(800);
    expect(
      JSON.parse(sessionStorage.getItem("mobile:scrollPositions")!).today,
    ).toBe(800);
    rerender({ ready: true });
    expect(content.scrollTop).toBe(800);
    expect(
      JSON.parse(sessionStorage.getItem("mobile:scrollPositions")!).today,
    ).toBe(800);
  });

  it("still defers a newly entered view and restores the prior view when returning", () => {
    sessionStorage.setItem(
      "mobile:scrollPositions",
      JSON.stringify({ today: 300, "custom:all": 600 }),
    );
    const { rerender } = renderHook(
      ({ key, ready }) => useScrollPersistence(key, undefined, ready),
      { initialProps: { key: "today", ready: true } },
    );
    expect(content.scrollTop).toBe(300);
    rerender({ key: "custom:all", ready: false });
    scrollTo(0);
    expect(
      JSON.parse(sessionStorage.getItem("mobile:scrollPositions")!)[
        "custom:all"
      ],
    ).toBe(600);
    rerender({ key: "custom:all", ready: true });
    expect(content.scrollTop).toBe(600);
    rerender({ key: "today", ready: true });
    expect(content.scrollTop).toBe(300);
  });

  it("uses the supplied scroll owner instead of another matching DOM element", () => {
    const owned = document.createElement("div");
    document.body.append(owned);
    const first = renderHook(() =>
      useScrollPersistence("today", { current: owned }),
    );
    act(() => {
      owned.scrollTop = 210;
      owned.dispatchEvent(new Event("scroll"));
    });
    expect(content.scrollTop).toBe(0);
    first.unmount();
    owned.scrollTop = 0;
    renderHook(() => useScrollPersistence("today", { current: owned }));
    expect(owned.scrollTop).toBe(210);
    owned.remove();
  });

  it("ignores corrupt or impossible stored offsets", () => {
    sessionStorage.setItem(
      "mobile:scrollPositions",
      JSON.stringify({ today: -1, focus: "120", "custom:all": null }),
    );
    renderHook(() => useScrollPersistence("today"));
    expect(content.scrollTop).toBe(0);
  });

  it("keeps in-memory restoration when storage cannot be written", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Full", "QuotaExceededError");
    });
    const { rerender } = renderHook(({ key }) => useScrollPersistence(key), {
      initialProps: { key: "today" },
    });
    scrollTo(180);
    rerender({ key: "focus" });
    rerender({ key: "today" });
    expect(content.scrollTop).toBe(180);
  });
});
