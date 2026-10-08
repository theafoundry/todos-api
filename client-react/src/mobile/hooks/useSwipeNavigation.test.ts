import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
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
    act(() => result.current.handlers.onPointerCancel());
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
});
