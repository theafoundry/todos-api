import { useState, useCallback, useRef } from "react";

export const SWIPE_THRESHOLD = 80;
const AXIS_SLOP = 8;
export type SwipeState =
  | "idle"
  | "swiping"
  | "triggered-right"
  | "triggered-left";
type Direction = "right" | "left" | null;

export function useSwipeAction() {
  const [offsetX, setOffsetX] = useState(0);
  const [state, setState] = useState<SwipeState>("idle");
  const gesture = useRef<{
    x: number;
    y: number;
    axis: "horizontal" | "vertical" | null;
    offset: number;
  } | null>(null);

  const reset = useCallback(() => {
    gesture.current = null;
    setState("idle");
    setOffsetX(0);
  }, []);

  const onTouchStart = useCallback((clientX: number, clientY = 0) => {
    gesture.current = { x: clientX, y: clientY, axis: null, offset: 0 };
    setState("idle");
    setOffsetX(0);
  }, []);

  const onTouchMove = useCallback((clientX: number, clientY = 0): boolean => {
    const current = gesture.current;
    if (!current) return false;
    const dx = clientX - current.x;
    const dy = clientY - current.y;
    if (!current.axis && Math.max(Math.abs(dx), Math.abs(dy)) > AXIS_SLOP) {
      if (Math.abs(dx) > Math.abs(dy) * 1.25) current.axis = "horizontal";
      else current.axis = "vertical";
    }
    if (current.axis !== "horizontal") return false;
    current.offset = dx;
    setOffsetX(dx);
    setState("swiping");
    return true;
  }, []);

  const onTouchEnd = useCallback((): Direction => {
    const current = gesture.current;
    gesture.current = null;
    const direction =
      current?.axis === "horizontal" &&
      Math.abs(current.offset) > SWIPE_THRESHOLD
        ? current.offset > 0
          ? "right"
          : "left"
        : null;
    setState(direction ? `triggered-${direction}` : "idle");
    if (!direction) setOffsetX(0);
    return direction;
  }, []);

  return {
    offsetX,
    state,
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    onTouchCancel: reset,
    reset,
  };
}
