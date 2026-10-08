import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type TouchEvent as ReactTouchEvent,
} from "react";
import "./mobile-gestures.css";

interface Props {
  onRefresh: () => Promise<void | boolean>;
  children: ReactNode;
  disabled?: boolean;
}

const THRESHOLD = 60;
const AXIS_SLOP = 8;

interface Gesture {
  id: number;
  x: number;
  y: number;
  axis: "vertical" | "blocked" | null;
  distance: number;
  owner: HTMLElement;
}

function scrollOwner(container: HTMLElement): HTMLElement {
  let ancestor = container.parentElement;
  while (ancestor && ancestor !== document.body) {
    if (/auto|scroll|overlay/.test(getComputedStyle(ancestor).overflowY))
      return ancestor;
    ancestor = ancestor.parentElement;
  }
  return container;
}

function excludesPull(
  target: EventTarget | null,
  container: HTMLElement,
): boolean {
  if (!(target instanceof Element)) return false;
  if (
    target.closest(
      "input, textarea, select, [contenteditable], [data-no-pull-refresh]",
    )
  )
    return true;
  let element: Element | null = target;
  while (element && element !== container) {
    if (
      element instanceof HTMLElement &&
      /auto|scroll|overlay/.test(getComputedStyle(element).overflowY) &&
      element.scrollHeight > element.clientHeight
    )
      return true;
    element = element.parentElement;
  }
  return false;
}

export function PullToRefresh({
  onRefresh,
  children,
  disabled = false,
}: Props) {
  const [refreshing, setRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const gesture = useRef<Gesture | null>(null);
  const pending = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const suppressClickUntil = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const blocked = useCallback(
    () =>
      disabled ||
      Boolean(containerRef.current?.closest("[inert]")) ||
      Boolean(document.querySelector('[role="dialog"][aria-modal="true"]')),
    [disabled],
  );

  const cancel = useCallback(() => {
    gesture.current = null;
    if (!pending.current) setPullDistance(0);
  }, []);

  useEffect(() => {
    if (disabled) cancel();
  }, [disabled, cancel]);

  const refresh = useCallback(async () => {
    if (pending.current || blocked()) return;
    cancel();
    pending.current = true;
    setRefreshing(true);
    setPullDistance(THRESHOLD);
    setError("");
    setFeedback("");
    try {
      if ((await onRefresh()) === false)
        throw new Error(
          "Could not refresh. Your current tasks are still available.",
        );
      if (mounted.current) setFeedback("Refresh complete");
    } catch (cause) {
      if (mounted.current)
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not refresh. Try again.",
        );
    } finally {
      pending.current = false;
      if (mounted.current) {
        setRefreshing(false);
        setPullDistance(0);
      }
    }
  }, [blocked, cancel, onRefresh]);

  const start = (event: ReactTouchEvent<HTMLDivElement>) => {
    cancel();
    const container = containerRef.current;
    if (
      !container ||
      pending.current ||
      blocked() ||
      event.touches.length !== 1 ||
      excludesPull(event.target, container)
    )
      return;
    const owner = scrollOwner(container);
    if (owner.scrollTop > 0) return;
    const touch = event.touches[0];
    gesture.current = {
      id: touch.identifier,
      x: touch.clientX,
      y: touch.clientY,
      axis: null,
      distance: 0,
      owner,
    };
    suppressClickUntil.current = 0;
  };

  const move = useCallback(
    (event: TouchEvent) => {
      const current = gesture.current;
      if (!current) return;
      if (
        pending.current ||
        blocked() ||
        event.touches.length !== 1 ||
        current.owner.scrollTop > 0
      ) {
        cancel();
        return;
      }
      const touch = Array.from(event.touches).find(
        (item) => item.identifier === current.id,
      );
      if (!touch) {
        cancel();
        return;
      }
      const dx = touch.clientX - current.x;
      const dy = touch.clientY - current.y;
      if (!current.axis && Math.max(Math.abs(dx), Math.abs(dy)) > AXIS_SLOP) {
        current.axis = dy > Math.abs(dx) * 1.25 ? "vertical" : "blocked";
      }
      if (current.axis !== "vertical") return;
      current.distance = Math.min(Math.sqrt(Math.max(0, dy)) * 4, 120);
      setPullDistance(current.distance);
      suppressClickUntil.current = Date.now() + 700;
      // Only an owned downward gesture at the top prevents native overscroll.
      if (dy > 0 && event.cancelable) event.preventDefault();
    },
    [blocked, cancel],
  );

  useEffect(() => {
    const container = containerRef.current;
    container?.addEventListener("touchmove", move, { passive: false });
    return () => container?.removeEventListener("touchmove", move);
  }, [move]);

  const end = (event: ReactTouchEvent<HTMLDivElement>) => {
    const current = gesture.current;
    if (
      !current ||
      !Array.from(event.changedTouches).some(
        (touch) => touch.identifier === current.id,
      )
    )
      return;
    const shouldRefresh =
      current.axis === "vertical" &&
      current.distance > THRESHOLD &&
      current.owner.scrollTop <= 0;
    cancel();
    if (shouldRefresh) void refresh();
  };

  return (
    <div
      ref={containerRef}
      className="m-pull-refresh"
      aria-busy={refreshing}
      onTouchStart={start}
      onTouchEnd={end}
      onTouchCancel={cancel}
      onClickCapture={(event) => {
        if (event.detail > 0 && Date.now() < suppressClickUntil.current) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
    >
      <div
        className={`m-pull-refresh__indicator${refreshing ? " m-pull-refresh__indicator--active" : ""}`}
        style={{ height: pullDistance > 0 ? `${pullDistance}px` : undefined }}
        aria-hidden={!refreshing}
        role={refreshing ? "status" : undefined}
      >
        {refreshing ? (
          <>
            <div className="m-pull-refresh__spinner" aria-hidden="true" />
            <span className="m-pull-refresh__text">Refreshing…</span>
          </>
        ) : pullDistance > THRESHOLD ? (
          <span className="m-pull-refresh__text">Release to refresh</span>
        ) : pullDistance > 10 ? (
          <span className="m-pull-refresh__text">Pull to refresh</span>
        ) : null}
      </div>
      {error && (
        <p
          className="m-pull-refresh__feedback m-pull-refresh__feedback--error"
          role="alert"
        >
          {error}
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={refreshing}
          >
            Retry refresh
          </button>
        </p>
      )}
      {feedback && (
        <p className="m-pull-refresh__feedback" role="status">
          {feedback}
        </p>
      )}
      <div className="m-pull-refresh__controls">
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={refreshing || disabled}
        >
          Refresh tasks
        </button>
      </div>
      {children}
    </div>
  );
}
