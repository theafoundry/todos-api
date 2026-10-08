// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSwipeAction, SWIPE_THRESHOLD } from "./useSwipeAction";

describe("useSwipeAction", () => {
  it("starts with zero offset and idle state", () => {
    const { result } = renderHook(() => useSwipeAction());
    expect(result.current.offsetX).toBe(0);
    expect(result.current.state).toBe("idle");
  });

  it("tracks horizontal movement during swipe", () => {
    const { result } = renderHook(() => useSwipeAction());
    act(() => result.current.onTouchStart(100));
    act(() => result.current.onTouchMove(150));
    expect(result.current.offsetX).toBe(50);
    expect(result.current.state).toBe("swiping");
  });

  it("triggers right action when released past threshold", () => {
    const { result } = renderHook(() => useSwipeAction());
    act(() => result.current.onTouchStart(0));
    act(() => result.current.onTouchMove(SWIPE_THRESHOLD + 10));
    act(() => result.current.onTouchEnd());
    expect(result.current.state).toBe("triggered-right");
  });

  it("triggers left action when released past negative threshold", () => {
    const { result } = renderHook(() => useSwipeAction());
    act(() => result.current.onTouchStart(200));
    act(() => result.current.onTouchMove(200 - SWIPE_THRESHOLD - 10));
    act(() => result.current.onTouchEnd());
    expect(result.current.state).toBe("triggered-left");
  });

  it("snaps back when released before threshold", () => {
    const { result } = renderHook(() => useSwipeAction());
    act(() => result.current.onTouchStart(100));
    act(() => result.current.onTouchMove(130));
    act(() => result.current.onTouchEnd());
    expect(result.current.offsetX).toBe(0);
    expect(result.current.state).toBe("idle");
  });

  it("resets to idle", () => {
    const { result } = renderHook(() => useSwipeAction());
    act(() => result.current.onTouchStart(0));
    act(() => result.current.onTouchMove(SWIPE_THRESHOLD + 10));
    act(() => result.current.onTouchEnd());
    act(() => result.current.reset());
    expect(result.current.state).toBe("idle");
    expect(result.current.offsetX).toBe(0);
  });
  it("locks vertical movement so later horizontal movement cannot complete a task", () => {
    const { result } = renderHook(() => useSwipeAction());
    act(() => result.current.onTouchStart(100, 100));
    act(() => result.current.onTouchMove(105, 125));
    act(() => result.current.onTouchMove(230, 125));
    let direction: string | null = "right";
    act(() => {
      direction = result.current.onTouchEnd();
    });
    expect(direction).toBeNull();
    expect(result.current.offsetX).toBe(0);
  });

  it("rejects an ambiguous diagonal gesture even if it later becomes horizontal", () => {
    const { result } = renderHook(() => useSwipeAction());
    act(() => result.current.onTouchStart(100, 100));
    act(() => result.current.onTouchMove(125, 125));
    act(() => result.current.onTouchMove(230, 125));
    let direction: string | null = "right";
    act(() => {
      direction = result.current.onTouchEnd();
    });
    expect(direction).toBeNull();
  });

  it("clears a cancelled horizontal gesture without committing it", () => {
    const { result } = renderHook(() => useSwipeAction());
    act(() => result.current.onTouchStart(100, 100));
    act(() => result.current.onTouchMove(230, 100));
    act(() => result.current.onTouchCancel());
    let direction: string | null = "right";
    act(() => {
      direction = result.current.onTouchEnd();
    });
    expect(direction).toBeNull();
    expect(result.current.offsetX).toBe(0);
    expect(result.current.state).toBe("idle");
  });
});
