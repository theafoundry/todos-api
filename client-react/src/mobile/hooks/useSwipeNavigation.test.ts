import { renderHook, act } from "@testing-library/react";
import { afterEach, describe, it, expect, vi } from "vitest";
import type { PointerEvent, MouseEvent } from "react";
import { useSwipeNavigation } from "./useSwipeNavigation";

function pointer(
  track: HTMLElement,
  x: number,
  y = 0,
  id = 1,
  target: Element = track,
): PointerEvent {
  return {
    currentTarget: track,
    target,
    clientX: x,
    clientY: y,
    pointerId: id,
    button: 0,
    isPrimary: true,
  } as unknown as PointerEvent;
}

describe("useSwipeNavigation", () => {
  afterEach(() => vi.restoreAllMocks());
  it("advances, goes back and clamps both boundaries", () => {
    const onIndexChange = vi.fn();
    const { result } = renderHook(() =>
      useSwipeNavigation({ count: 3, onIndexChange }),
    );
    act(() => result.current.goPrev());
    expect(result.current.activeIndex).toBe(0);
    act(() => result.current.goNext());
    act(() => result.current.goNext());
    act(() => result.current.goNext());
    expect(result.current.activeIndex).toBe(2);
    expect(onIndexChange.mock.calls.map(([index]) => index)).toEqual([1, 2]);
    act(() => result.current.goPrev());
    expect(result.current.activeIndex).toBe(1);
  });

  it("blocks implicit navigation while flipped but permits an explicit position request", () => {
    const { result } = renderHook(() =>
      useSwipeNavigation({ count: 5, locked: true }),
    );
    act(() => result.current.goNext());
    expect(result.current.activeIndex).toBe(0);
    act(() => result.current.goTo(2));
    expect(result.current.activeIndex).toBe(2);
  });

  it("clamps refreshed card counts including an empty result", () => {
    const { result, rerender } = renderHook(
      ({ count }) => useSwipeNavigation({ count }),
      { initialProps: { count: 5 } },
    );
    act(() => result.current.goTo(4));
    rerender({ count: 2 });
    expect(result.current.activeIndex).toBe(1);
    rerender({ count: 0 });
    expect(result.current.activeIndex).toBe(0);
    act(() => result.current.goNext());
    expect(result.current.activeIndex).toBe(0);
  });

  it("only claims horizontal background movement and ignores a cancelled swipe", () => {
    const track = document.createElement("div");
    const { result } = renderHook(() => useSwipeNavigation({ count: 3 }));
    act(() => result.current.handlers.onPointerDown(pointer(track, 200)));
    expect(result.current.isDragging).toBe(false);
    act(() => result.current.handlers.onPointerMove(pointer(track, 100)));
    expect(result.current.isDragging).toBe(true);
    expect(track).toHaveClass("m-carousel__track--dragging");
    act(() => result.current.handlers.onPointerCancel(pointer(track, 100)));
    expect(result.current.isDragging).toBe(false);
    expect(result.current.activeIndex).toBe(0);
    expect(track.style.transform).toBe("translateX(0%)");
    expect(track).not.toHaveClass("m-carousel__track--dragging");
  });

  it("commits a horizontal swipe once and suppresses its trailing click", () => {
    const track = document.createElement("div");
    const { result } = renderHook(() => useSwipeNavigation({ count: 3 }));
    act(() => result.current.handlers.onPointerDown(pointer(track, 200)));
    act(() => result.current.handlers.onPointerMove(pointer(track, 100)));
    act(() => result.current.handlers.onPointerUp(pointer(track, 100)));
    expect(result.current.activeIndex).toBe(1);
    expect(result.current.isDragging).toBe(false);
    const click = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as MouseEvent;
    act(() => result.current.handlers.onClickCapture(click));
    expect(click.preventDefault).toHaveBeenCalledOnce();
    expect(click.stopPropagation).toHaveBeenCalledOnce();
    act(() => result.current.handlers.onClickCapture(click));
    expect(click.preventDefault).toHaveBeenCalledOnce();
  });

  it("leaves vertical scrolling, controls and other pointers alone", () => {
    const track = document.createElement("div");
    const button = track.appendChild(document.createElement("button"));
    const { result } = renderHook(() => useSwipeNavigation({ count: 3 }));
    act(() => result.current.handlers.onPointerDown(pointer(track, 200)));
    act(() => result.current.handlers.onPointerMove(pointer(track, 150, 100)));
    act(() => result.current.handlers.onPointerUp(pointer(track, 100, 200)));
    expect(result.current.activeIndex).toBe(0);
    act(() =>
      result.current.handlers.onPointerDown(pointer(track, 200, 0, 1, button)),
    );
    act(() => result.current.handlers.onPointerMove(pointer(track, 0)));
    act(() => result.current.handlers.onPointerUp(pointer(track, 0)));
    expect(result.current.activeIndex).toBe(0);
    act(() => result.current.handlers.onPointerDown(pointer(track, 200)));
    act(() => result.current.handlers.onPointerMove(pointer(track, 0, 0, 2)));
    act(() => result.current.handlers.onPointerUp(pointer(track, 0, 0, 2)));
    expect(result.current.isDragging).toBe(false);
    expect(result.current.activeIndex).toBe(0);
  });

  it("navigates both ways from descendants of opted-in task titles", () => {
    const track = document.createElement("div");
    const title = track.appendChild(document.createElement("button"));
    title.setAttribute("data-card-swipe-target", "");
    const text = title.appendChild(document.createElement("span"));
    const onIndexChange = vi.fn();
    const { result } = renderHook(() =>
      useSwipeNavigation({ count: 3, onIndexChange }),
    );
    for (const [start, end] of [
      [200, 80],
      [80, 200],
    ]) {
      act(() =>
        result.current.handlers.onPointerDown(
          pointer(track, start, 0, 1, text),
        ),
      );
      act(() => result.current.handlers.onPointerMove(pointer(track, end)));
      act(() => result.current.handlers.onPointerUp(pointer(track, end)));
    }
    expect(onIndexChange.mock.calls.map(([index]) => index)).toEqual([1, 0]);
    expect(result.current.isDragging).toBe(false);
  });

  it.each([
    [-100, 120],
    [-120, 120],
    [-120, 100],
  ])(
    "leaves vertical or diagonal title movement (%i, %i) unclaimed",
    (dx, dy) => {
      const track = document.createElement("div");
      const title = track.appendChild(document.createElement("button"));
      title.setAttribute("data-card-swipe-target", "");
      const { result } = renderHook(() => useSwipeNavigation({ count: 3 }));
      act(() =>
        result.current.handlers.onPointerDown(pointer(track, 200, 0, 1, title)),
      );
      act(() =>
        result.current.handlers.onPointerMove(pointer(track, 200 + dx, dy)),
      );
      // Once scrolling wins, later horizontal movement cannot take over that gesture.
      act(() => result.current.handlers.onPointerMove(pointer(track, 0, dy)));
      act(() => result.current.handlers.onPointerUp(pointer(track, 0, dy)));
      expect(result.current.activeIndex).toBe(0);
      expect(result.current.isDragging).toBe(false);
    },
  );

  it("does not navigate for tap jitter or a fast micro drag, but accepts a deliberate flick", () => {
    const track = document.createElement("div");
    const now = vi.spyOn(Date, "now").mockReturnValue(100);
    const { result } = renderHook(() => useSwipeNavigation({ count: 3 }));
    for (const distance of [8, 11, 24]) {
      act(() => result.current.handlers.onPointerDown(pointer(track, 200)));
      act(() =>
        result.current.handlers.onPointerMove(pointer(track, 200 - distance)),
      );
      act(() =>
        result.current.handlers.onPointerUp(pointer(track, 200 - distance)),
      );
      expect(result.current.activeIndex).toBe(0);
    }
    act(() => result.current.handlers.onPointerDown(pointer(track, 200)));
    act(() => result.current.handlers.onPointerMove(pointer(track, 175)));
    now.mockReturnValue(150);
    act(() => result.current.handlers.onPointerUp(pointer(track, 175)));
    expect(result.current.activeIndex).toBe(1);
  });

  it("snaps back a slow short drag and suppresses its pointer click while preserving keyboard clicks", () => {
    const track = document.createElement("div");
    const now = vi.spyOn(Date, "now").mockReturnValue(100);
    const { result } = renderHook(() => useSwipeNavigation({ count: 3 }));
    act(() => result.current.handlers.onPointerDown(pointer(track, 200)));
    act(() => result.current.handlers.onPointerMove(pointer(track, 170)));
    now.mockReturnValue(500);
    act(() => result.current.handlers.onPointerUp(pointer(track, 170)));
    expect(result.current.activeIndex).toBe(0);
    expect(track.style.transform).toBe("translateX(0%)");
    const keyboardClick = {
      detail: 0,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as MouseEvent;
    const pointerClick = { ...keyboardClick, detail: 1 } as MouseEvent;
    act(() => result.current.handlers.onClickCapture(keyboardClick));
    expect(keyboardClick.preventDefault).not.toHaveBeenCalled();
    act(() => result.current.handlers.onClickCapture(pointerClick));
    expect(pointerClick.preventDefault).toHaveBeenCalledOnce();
  });

  it.each(["button", "a", "input", "select", "textarea"])(
    "keeps unmarked %s controls guarded even inside an opted-in ancestor",
    (tag) => {
      const track = document.createElement("div");
      const owner = track.appendChild(document.createElement("div"));
      owner.setAttribute("role", "button");
      owner.setAttribute("data-card-swipe-target", "");
      const control = owner.appendChild(document.createElement(tag));
      const text = control.appendChild(document.createElement("span"));
      const { result } = renderHook(() => useSwipeNavigation({ count: 3 }));
      act(() =>
        result.current.handlers.onPointerDown(pointer(track, 200, 0, 1, text)),
      );
      act(() => result.current.handlers.onPointerMove(pointer(track, 0)));
      act(() => result.current.handlers.onPointerUp(pointer(track, 0)));
      expect(result.current.activeIndex).toBe(0);
      expect(result.current.isDragging).toBe(false);
    },
  );

  it.each(["row", "editable", "prevented"])(
    "does not override a nested %s gesture owner even when its title opts in",
    (ownerType) => {
      const track = document.createElement("div");
      const owner = track.appendChild(document.createElement("div"));
      if (ownerType === "row") owner.className = "m-swipe-row";
      if (ownerType === "editable")
        owner.setAttribute("contenteditable", "true");
      const title = owner.appendChild(document.createElement("button"));
      title.setAttribute("data-card-swipe-target", "");
      const { result } = renderHook(() => useSwipeNavigation({ count: 3 }));
      act(() =>
        result.current.handlers.onPointerDown({
          ...pointer(track, 200, 0, 1, title),
          defaultPrevented: ownerType === "prevented",
        }),
      );
      act(() => result.current.handlers.onPointerMove(pointer(track, 0)));
      act(() => result.current.handlers.onPointerUp(pointer(track, 0)));
      expect(result.current.activeIndex).toBe(0);
    },
  );

  it.each(["onPointerCancel", "onLostPointerCapture"] as const)(
    "%s ignores unrelated pointers and cancels only the active drag",
    (handler) => {
      const track = document.createElement("div");
      const { result } = renderHook(() => useSwipeNavigation({ count: 3 }));
      act(() => result.current.handlers.onPointerDown(pointer(track, 200)));
      act(() => result.current.handlers.onPointerMove(pointer(track, 100)));
      act(() => result.current.handlers[handler](pointer(track, 100, 0, 2)));
      expect(result.current.isDragging).toBe(true);
      act(() => result.current.handlers[handler](pointer(track, 100)));
      act(() => result.current.handlers.onPointerUp(pointer(track, 100)));
      expect(result.current.activeIndex).toBe(0);
      expect(result.current.isDragging).toBe(false);
      const click = {
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as MouseEvent;
      act(() => result.current.handlers.onClickCapture(click));
      expect(click.preventDefault).toHaveBeenCalledOnce();
    },
  );

  it("keeps a title drag when implicit capture transfers from the title to the track", () => {
    const track = document.createElement("div");
    const title = track.appendChild(document.createElement("button"));
    title.setAttribute("data-card-swipe-target", "");
    const { result } = renderHook(() => useSwipeNavigation({ count: 3 }));
    act(() =>
      result.current.handlers.onPointerDown(pointer(track, 200, 0, 1, title)),
    );
    act(() => result.current.handlers.onPointerMove(pointer(track, 100)));
    act(() =>
      result.current.handlers.onLostPointerCapture(
        pointer(track, 100, 0, 1, title),
      ),
    );
    expect(result.current.isDragging).toBe(true);
    act(() => result.current.handlers.onPointerUp(pointer(track, 100)));
    expect(result.current.activeIndex).toBe(1);
  });

  it("cancels when another finger interrupts and preserves suppression for the first finger", () => {
    const track = document.createElement("div");
    const { result } = renderHook(() => useSwipeNavigation({ count: 3 }));
    act(() => result.current.handlers.onPointerDown(pointer(track, 200)));
    act(() => result.current.handlers.onPointerMove(pointer(track, 100)));
    act(() =>
      result.current.handlers.onPointerDown({
        ...pointer(track, 180, 0, 2),
        isPrimary: false,
      }),
    );
    act(() => result.current.handlers.onPointerUp(pointer(track, 100)));
    expect(result.current.activeIndex).toBe(0);
    expect(result.current.isDragging).toBe(false);
    const click = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as MouseEvent;
    act(() => result.current.handlers.onClickCapture(click));
    expect(click.preventDefault).toHaveBeenCalledOnce();
  });

  it("clears a stale pending drag before a new guarded control interaction", () => {
    const track = document.createElement("div");
    const control = track.appendChild(document.createElement("button"));
    const { result } = renderHook(() => useSwipeNavigation({ count: 3 }));
    act(() => result.current.handlers.onPointerDown(pointer(track, 200)));
    act(() =>
      result.current.handlers.onPointerDown(pointer(track, 200, 0, 1, control)),
    );
    act(() => result.current.handlers.onPointerMove(pointer(track, 0)));
    act(() => result.current.handlers.onPointerUp(pointer(track, 0)));
    expect(result.current.activeIndex).toBe(0);
  });

  it("explicit navigation ends an in-flight gesture without a second navigation on release", () => {
    const track = document.createElement("div");
    const onIndexChange = vi.fn();
    const { result } = renderHook(() =>
      useSwipeNavigation({ count: 3, onIndexChange }),
    );
    act(() => result.current.handlers.onPointerDown(pointer(track, 200)));
    act(() => result.current.handlers.onPointerMove(pointer(track, 100)));
    act(() => result.current.goTo(1));
    act(() => result.current.handlers.onPointerUp(pointer(track, 100)));
    expect(result.current.activeIndex).toBe(1);
    expect(result.current.isDragging).toBe(false);
    expect(onIndexChange).toHaveBeenCalledTimes(1);
  });

  it("cancels a title drag when the card flips or count changes", () => {
    const track = document.createElement("div");
    const { result, rerender } = renderHook(
      ({ count, locked }) => useSwipeNavigation({ count, locked }),
      { initialProps: { count: 3, locked: false } },
    );
    act(() => result.current.handlers.onPointerDown(pointer(track, 200)));
    act(() => result.current.handlers.onPointerMove(pointer(track, 100)));
    rerender({ count: 3, locked: true });
    act(() => result.current.handlers.onPointerUp(pointer(track, 100)));
    expect(result.current.activeIndex).toBe(0);
    expect(result.current.isDragging).toBe(false);
    rerender({ count: 3, locked: false });
    act(() => result.current.handlers.onPointerDown(pointer(track, 200)));
    act(() => result.current.handlers.onPointerMove(pointer(track, 100)));
    rerender({ count: 2, locked: false });
    act(() => result.current.handlers.onPointerUp(pointer(track, 100)));
    expect(result.current.activeIndex).toBe(0);
  });
});
