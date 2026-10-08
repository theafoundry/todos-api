import { useState, useRef, useCallback, useMemo, useEffect } from "react";

const COMMIT_THRESHOLD = 50;
const AXIS_THRESHOLD = 10;
const HORIZONTAL_RATIO = 1.25;
const MIN_FLICK_DISTANCE = 25;
const VELOCITY_THRESHOLD = 0.3;
const RUBBER_DAMPING = 0.4;

interface Options {
  count: number;
  locked?: boolean;
  onIndexChange?: (index: number) => void;
}

export function useSwipeNavigation({ count, locked, onIndexChange }: Options) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const indexRef = useRef(0);
  const onChangeRef = useRef(onIndexChange);
  onChangeRef.current = onIndexChange;
  const drag = useRef<{
    id: number;
    x: number;
    y: number;
    time: number;
    dx: number;
    axis: "pending" | "horizontal";
    track: HTMLElement;
  } | null>(null);
  const suppressClick = useRef(false);

  const applyTransform = useCallback(
    (track: HTMLElement, index: number, dx = 0) => {
      const width = track.parentElement?.clientWidth || window.innerWidth;
      track.style.transform = `translateX(${-(index * 100) + (dx / width) * 100}%)`;
    },
    [],
  );

  const cancelDrag = useCallback(() => {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    if (current.axis === "horizontal") suppressClick.current = true;
    current.track.classList.remove("m-carousel__track--dragging");
    applyTransform(current.track, indexRef.current);
    if (current.track.hasPointerCapture?.(current.id))
      current.track.releasePointerCapture(current.id);
    setIsDragging(false);
  }, [applyTransform]);

  const goTo = useCallback(
    (index: number) => {
      cancelDrag();
      const next = Math.max(0, Math.min(index, Math.max(0, count - 1)));
      if (next === indexRef.current) return;
      indexRef.current = next;
      setActiveIndex(next);
      onChangeRef.current?.(next);
    },
    [count, cancelDrag],
  );

  useEffect(() => {
    goTo(indexRef.current);
    cancelDrag();
  }, [count, goTo, cancelDrag]);
  useEffect(() => {
    if (locked) cancelDrag();
  }, [locked, cancelDrag]);
  useEffect(() => cancelDrag, [cancelDrag]);

  const goNext = useCallback(() => {
    if (!locked) goTo(indexRef.current + 1);
  }, [locked, goTo]);
  const goPrev = useCallback(() => {
    if (!locked) goTo(indexRef.current - 1);
  }, [locked, goTo]);

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      cancelDrag();
      if (event.isPrimary === false) return;
      suppressClick.current = false;
      if (locked || event.button !== 0 || event.defaultPrevented) return;
      const target = event.target as Element;
      // Nested row gestures and editable controls retain their own interaction.
      if (
        target.closest(
          ".m-swipe-row, input, select, textarea, [contenteditable]:not([contenteditable='false'])",
        )
      )
        return;
      // Only task-opening titles opt in; other buttons and links keep their guards.
      const control = target.closest("button, a, [role='button']");
      if (control && !control.hasAttribute("data-card-swipe-target")) return;
      drag.current = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        time: Date.now(),
        dx: 0,
        axis: "pending",
        track: event.currentTarget as HTMLElement,
      };
    },
    [locked, cancelDrag],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      const current = drag.current;
      if (!current || current.id !== event.pointerId || locked) return;
      const dx = event.clientX - current.x;
      const dy = event.clientY - current.y;
      if (current.axis === "pending") {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < AXIS_THRESHOLD) return;
        if (Math.abs(dx) <= Math.abs(dy) * HORIZONTAL_RATIO) {
          cancelDrag();
          return;
        }
        current.axis = "horizontal";
        suppressClick.current = true;
        current.track.classList.add("m-carousel__track--dragging");
        current.track.setPointerCapture?.(event.pointerId);
        setIsDragging(true);
      }
      current.dx = dx;
      const edge =
        (indexRef.current === 0 && dx > 0) ||
        (indexRef.current === count - 1 && dx < 0);
      applyTransform(
        current.track,
        indexRef.current,
        edge ? dx * RUBBER_DAMPING : dx,
      );
    },
    [locked, count, cancelDrag, applyTransform],
  );

  const onPointerCancel = useCallback(
    (event: React.PointerEvent) => {
      if (drag.current?.id === event.pointerId) cancelDrag();
    },
    [cancelDrag],
  );

  const onLostPointerCapture = useCallback(
    (event: React.PointerEvent) => {
      // Touch titles lose their implicit capture when the track claims a drag.
      if (event.target === drag.current?.track) onPointerCancel(event);
    },
    [onPointerCancel],
  );

  const onPointerUp = useCallback(
    (event: React.PointerEvent) => {
      const current = drag.current;
      if (!current || current.id !== event.pointerId) return;
      if (current.axis === "horizontal") {
        suppressClick.current = true;
        const elapsed = Math.max(Date.now() - current.time, 1);
        if (
          !locked &&
          (Math.abs(current.dx) > COMMIT_THRESHOLD ||
            (Math.abs(current.dx) >= MIN_FLICK_DISTANCE &&
              Math.abs(current.dx) / elapsed > VELOCITY_THRESHOLD))
        ) {
          goTo(indexRef.current + (current.dx < 0 ? 1 : -1));
        }
      }
      cancelDrag();
    },
    [locked, goTo, cancelDrag],
  );

  const handlers = useMemo(
    () => ({
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onLostPointerCapture,
      onClickCapture: (event: React.MouseEvent) => {
        if (!suppressClick.current || event.detail === 0) return;
        suppressClick.current = false;
        event.preventDefault();
        event.stopPropagation();
      },
    }),
    [
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onLostPointerCapture,
    ],
  );

  return { activeIndex, isDragging, handlers, goNext, goPrev, goTo };
}
