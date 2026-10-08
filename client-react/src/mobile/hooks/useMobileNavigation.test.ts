// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMobileNavigation } from "./useMobileNavigation";

function browserHistory() {
  let entries: unknown[] = [{ outsideOwner: true }];
  let cursor = 0;
  const state = () => entries[cursor];
  vi.spyOn(history, "state", "get").mockImplementation(state);
  vi.spyOn(history, "replaceState").mockImplementation((value) => {
    entries[cursor] = value;
  });
  vi.spyOn(history, "pushState").mockImplementation((value) => {
    entries = entries.slice(0, cursor + 1);
    entries.push(value);
    cursor++;
  });
  const move = (delta: number) => {
    const next = cursor + delta;
    if (next < 0 || next >= entries.length) return;
    cursor = next;
    window.dispatchEvent(new PopStateEvent("popstate", { state: state() }));
  };
  vi.spyOn(history, "go").mockImplementation((delta = 0) => move(delta));
  return {
    back: () => move(-1),
    forward: () => move(1),
    move,
    state,
    index: () => cursor,
  };
}

beforeEach(() => sessionStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("useMobileNavigation", () => {
  it("consumes details and editor one layer at a time, preserving unrelated history state", () => {
    const browser = browserHistory();
    const closeRequestRef = { current: null as (() => void) | null };
    const { result } = renderHook(() =>
      useMobileNavigation({ closeRequestRef }),
    );
    expect(result.current.surface.mode).toBe("closed");
    expect(browser.state()).toMatchObject({ outsideOwner: true });
    act(() =>
      result.current.openSurface({ mode: "details", taskId: "task-1" }),
    );
    act(() => result.current.openSurface({ mode: "edit", taskId: "task-1" }));
    closeRequestRef.current = () => result.current.closeSurface();
    act(() => browser.back());
    expect(result.current.surface).toEqual({
      mode: "details",
      taskId: "task-1",
    });
    act(() => browser.back());
    expect(result.current.surface.mode).toBe("closed");
  });

  it("restores the owned editor before asking to keep or discard a dirty draft", () => {
    const browser = browserHistory();
    const closeRequestRef = { current: null as (() => void) | null };
    const { result } = renderHook(() =>
      useMobileNavigation({ closeRequestRef }),
    );
    act(() =>
      result.current.openSurface({ mode: "details", taskId: "task-1" }),
    );
    act(() => result.current.openSurface({ mode: "edit", taskId: "task-1" }));
    const askToDiscard = vi.fn();
    closeRequestRef.current = askToDiscard;
    act(() => browser.back());
    expect(askToDiscard).toHaveBeenCalledTimes(1);
    expect(result.current.surface.mode).toBe("edit");
    expect(browser.index()).toBe(2);
    // Keep editing does not change route; a later explicit discard consumes only the editor.
    act(() => result.current.closeSurface());
    expect(result.current.surface.mode).toBe("details");
  });

  it("handles a multi-entry Back as one guarded editor dismissal", () => {
    const browser = browserHistory();
    const closeRequestRef = { current: null as (() => void) | null };
    const { result } = renderHook(() =>
      useMobileNavigation({ closeRequestRef }),
    );
    act(() =>
      result.current.openSurface({ mode: "details", taskId: "task-1" }),
    );
    act(() => result.current.openSurface({ mode: "edit", taskId: "task-1" }));
    closeRequestRef.current = () => result.current.closeSurface();
    act(() => browser.move(-2));
    expect(result.current.surface.mode).toBe("details");
    expect(browser.index()).toBe(1);
  });

  it("blocks Back while a mutation is pending without consulting the draft callback", () => {
    const browser = browserHistory();
    let pending = true;
    const closeRequestRef = { current: vi.fn() };
    const { result } = renderHook(() =>
      useMobileNavigation({ closeRequestRef, isDismissBlocked: () => pending }),
    );
    act(() => result.current.openSurface({ mode: "capture" }));
    act(() => browser.back());
    expect(browser.index()).toBe(1);
    expect(result.current.surface.mode).toBe("capture");
    expect(closeRequestRef.current).not.toHaveBeenCalled();
    pending = false;
    act(() => result.current.requestClose());
    expect(closeRequestRef.current).toHaveBeenCalledTimes(1);
  });

  it("successful all-close returns to the list and rejects obsolete Forward entries", () => {
    const browser = browserHistory();
    const { result } = renderHook(() =>
      useMobileNavigation({ closeRequestRef: { current: null } }),
    );
    act(() =>
      result.current.openSurface({ mode: "details", taskId: "task-1" }),
    );
    act(() => result.current.openSurface({ mode: "edit", taskId: "task-1" }));
    act(() => result.current.closeSurface({ all: true }));
    expect(browser.index()).toBe(0);
    act(() => browser.forward());
    expect(result.current.surface.mode).toBe("closed");
    expect(browser.index()).toBe(0);
    act(() => result.current.openSurface({ mode: "capture" }));
    act(() => browser.back());
    expect(result.current.surface.mode).toBe("closed");
    expect(browser.index()).toBe(0);
  });

  it("replaces profile with a destination page so Back returns directly to the list", () => {
    const browser = browserHistory();
    const { result } = renderHook(() =>
      useMobileNavigation({ closeRequestRef: { current: null } }),
    );
    act(() => result.current.openSurface({ mode: "profile" }));
    act(() => result.current.openPage("ai"));
    expect(result.current.surface.mode).toBe("closed");
    expect(result.current.page).toBe("ai");
    expect(browser.index()).toBe(1);
    act(() => browser.back());
    expect(result.current.page).toBe("todos");
    expect(result.current.surface.mode).toBe("closed");
  });

  it("returns from task details to its project and from the project to the overview", () => {
    const browser = browserHistory();
    const { result } = renderHook(() =>
      useMobileNavigation({ closeRequestRef: { current: null } }),
    );
    act(() => result.current.openProject("project-1"));
    act(() =>
      result.current.openSurface({ mode: "details", taskId: "task-1" }),
    );
    act(() => browser.back());
    expect(result.current.selectedProjectId).toBe("project-1");
    expect(result.current.surface.mode).toBe("closed");
    act(() => browser.back());
    expect(result.current.selectedProjectId).toBeNull();
    expect(sessionStorage.getItem("mobile:selectedProject")).toBeNull();
  });

  it("reload restores project selection while removing a transient editor", () => {
    const browser = browserHistory();
    sessionStorage.setItem("mobile:activeTab", "projects");
    const first = renderHook(() =>
      useMobileNavigation({ closeRequestRef: { current: null } }),
    );
    act(() => first.result.current.openProject("project-1"));
    act(() =>
      first.result.current.openSurface({ mode: "edit", taskId: "task-1" }),
    );
    first.unmount();
    const second = renderHook(() =>
      useMobileNavigation({ closeRequestRef: { current: null } }),
    );
    expect(second.result.current.surface.mode).toBe("closed");
    expect(second.result.current.selectedProjectId).toBe("project-1");
    act(() => browser.back());
    expect(second.result.current.selectedProjectId).toBeNull();
  });

  it("falls back to local navigation when history access is unavailable", () => {
    browserHistory();
    vi.mocked(history.replaceState).mockImplementation(() => {
      throw new DOMException("Blocked", "SecurityError");
    });
    const { result } = renderHook(() =>
      useMobileNavigation({ closeRequestRef: { current: null } }),
    );
    act(() =>
      result.current.openSurface({ mode: "details", taskId: "task-1" }),
    );
    act(() => result.current.closeSurface());
    expect(result.current.surface.mode).toBe("closed");
  });
});
