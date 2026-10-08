import { useEffect, useRef, useState, type ReactNode } from "react";
import { useSwipeAction, SWIPE_THRESHOLD } from "../hooks/useSwipeAction";
import { CompletionBurst } from "./CompletionBurst";
import "./mobile-gestures.css";

interface Props {
  children: ReactNode;
  onSwipeRight?: () => void | Promise<unknown>;
  onSwipeLeft?: () => void | Promise<unknown>;
  rightLabel?: string;
  leftLabel?: string;
}

export function SwipeRow({
  children,
  onSwipeRight,
  onSwipeLeft,
  rightLabel = "Complete",
  leftLabel = "Plan for",
}: Props) {
  const { offsetX, state, onTouchStart, onTouchMove, onTouchEnd, reset } =
    useSwipeAction();
  const [pending, setPending] = useState(false);
  const [burst, setBurst] = useState(false);
  const [error, setError] = useState("");
  const [retryDirection, setRetryDirection] = useState<"right" | "left" | null>(
    null,
  );
  const busy = useRef(false);
  const touchId = useRef<number | null>(null);
  const suppressClickUntil = useRef(0);
  const mounted = useRef(true);
  const burstTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (burstTimer.current) clearTimeout(burstTimer.current);
    };
  }, []);

  const execute = async (direction: "right" | "left") => {
    const action = direction === "right" ? onSwipeRight : onSwipeLeft;
    reset();
    if (!action || busy.current) return;
    busy.current = true;
    setPending(true);
    setError("");
    setRetryDirection(null);
    try {
      const saved = await action();
      if (mounted.current && direction === "right" && saved === true) {
        setBurst(true);
        if (burstTimer.current) clearTimeout(burstTimer.current);
        burstTimer.current = setTimeout(() => {
          if (mounted.current) setBurst(false);
        }, 400);
      }
    } catch (cause) {
      if (mounted.current) {
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not save the action. Try again.",
        );
        setRetryDirection(direction);
      }
    } finally {
      busy.current = false;
      if (mounted.current) setPending(false);
    }
  };

  const cancel = () => {
    touchId.current = null;
    reset();
  };
  const isSwipingRight = offsetX > 0;
  const progress = Math.min(Math.abs(offsetX) / SWIPE_THRESHOLD, 1);

  return (
    <div className="m-swipe-row" aria-busy={pending}>
      <CompletionBurst active={burst} />
      <div
        aria-hidden="true"
        className={`m-swipe-row__action m-swipe-row__action--right${isSwipingRight ? " m-swipe-row__action--visible" : ""}`}
        style={{ opacity: isSwipingRight ? progress : 0 }}
      >
        <span className="m-swipe-row__action-label">✓ {rightLabel}</span>
      </div>
      <div
        aria-hidden="true"
        className={`m-swipe-row__action m-swipe-row__action--left${!isSwipingRight && offsetX < 0 ? " m-swipe-row__action--visible" : ""}`}
        style={{ opacity: !isSwipingRight ? progress : 0 }}
      >
        <span className="m-swipe-row__action-label">◷ {leftLabel}</span>
      </div>
      <div
        className="m-swipe-row__content"
        style={{
          transform:
            state === "swiping" ? `translateX(${offsetX}px)` : undefined,
          transition:
            state === "idle"
              ? "transform var(--dur-base) var(--ease-spring)"
              : "none",
        }}
        onClickCapture={(event) => {
          if (
            busy.current ||
            (event.detail > 0 && Date.now() < suppressClickUntil.current)
          ) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
        onTouchStart={(event) => {
          if (busy.current || event.touches.length !== 1) {
            cancel();
            return;
          }
          const touch = event.touches[0];
          touchId.current = touch.identifier;
          suppressClickUntil.current = 0;
          onTouchStart(touch.clientX, touch.clientY);
        }}
        onTouchMove={(event) => {
          if (event.touches.length !== 1) {
            cancel();
            return;
          }
          const touch = Array.from(event.touches).find(
            (item) => item.identifier === touchId.current,
          );
          if (touch && onTouchMove(touch.clientX, touch.clientY))
            suppressClickUntil.current = Date.now() + 700;
        }}
        onTouchEnd={(event) => {
          if (
            !Array.from(event.changedTouches).some(
              (touch) => touch.identifier === touchId.current,
            )
          )
            return;
          touchId.current = null;
          const direction = onTouchEnd();
          if (direction) void execute(direction);
        }}
        onTouchCancel={cancel}
      >
        {children}
      </div>
      {pending && (
        <p className="m-gesture-feedback" role="status">
          Saving…
        </p>
      )}
      {error && (
        <p
          className="m-gesture-feedback m-gesture-feedback--error"
          role="alert"
        >
          {error}
          {retryDirection && (
            <button
              type="button"
              disabled={pending}
              onClick={() => void execute(retryDirection)}
            >
              Retry action
            </button>
          )}
        </p>
      )}
    </div>
  );
}
