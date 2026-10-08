import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import "./mobile-modal.css";

export interface MobileModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  fullHeight?: boolean;
  dismissDisabled?: boolean;
  compact?: boolean;
  onExpand?: () => void;
  className?: string;
  backdropClassName?: string;
}

const FOCUSABLE =
  'button:not(:disabled), a[href], input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/** Owners decide whether each close request discards a draft. */
export function MobileModal({
  open,
  title,
  onClose,
  children,
  footer,
  fullHeight = false,
  dismissDisabled = false,
  compact = false,
  onExpand,
  className = "",
  backdropClassName = "",
}: MobileModalProps) {
  const titleId = useId();
  const layerRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const pointerTrigger = useRef<HTMLElement | null>(null);
  const callbacks = useRef({ onClose, dismissDisabled });
  callbacks.current = { onClose, dismissDisabled };
  const drag = useRef<{ id: number; y: number } | null>(null);
  const [dragOffset, setDragOffset] = useState(0);

  useLayoutEffect(() => {
    if (open) return;
    const rememberTrigger = (event: PointerEvent) => {
      const target =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>(
              'button, a[href], [role="button"], [tabindex="0"]',
            )
          : null;
      if (target && !target.closest("[inert]")) pointerTrigger.current = target;
    };
    document.addEventListener("pointerdown", rememberTrigger, true);
    return () =>
      document.removeEventListener("pointerdown", rememberTrigger, true);
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !layerRef.current || !dialogRef.current) return;
    setDragOffset(0);
    // Safari may leave focus on body after a tap; retain the actual triggering control.
    const focused = document.activeElement;
    const previousFocus =
      focused instanceof HTMLElement &&
      focused !== document.body &&
      focused !== document.documentElement
        ? focused
        : pointerTrigger.current;
    const background: { element: HTMLElement; inert: boolean }[] = [];
    // Keep inherited Fold tokens, but make every branch outside this surface inert.
    let branch: HTMLElement = layerRef.current;
    while (branch.parentElement) {
      for (const sibling of branch.parentElement.children) {
        if (sibling !== branch && sibling instanceof HTMLElement) {
          background.push({
            element: sibling,
            inert: sibling.hasAttribute("inert"),
          });
          sibling.setAttribute("inert", "");
        }
      }
      if (branch.parentElement === document.body) break;
      branch = branch.parentElement;
    }
    const bodyOverflow = document.body.style.overflow;
    const bodyOverscroll = document.body.style.overscrollBehavior;
    document.body.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "none";

    const updateViewport = () => {
      const viewport = window.visualViewport;
      layerRef.current?.style.setProperty(
        "--m-modal-height",
        `${viewport?.height ?? window.innerHeight}px`,
      );
      layerRef.current?.style.setProperty(
        "--m-modal-top",
        `${viewport?.offsetTop ?? 0}px`,
      );
    };
    updateViewport();
    window.visualViewport?.addEventListener("resize", updateViewport);
    window.visualViewport?.addEventListener("scroll", updateViewport);
    window.addEventListener("resize", updateViewport);

    const focusables = () =>
      Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [],
      )
        .filter(
          (element) =>
            !element.closest('[hidden], [inert], [aria-hidden="true"]'),
        )
        .sort((a, b) =>
          a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING
            ? -1
            : 1,
        );
    const initialItems = focusables();
    (
      initialItems.find((element) => element.hasAttribute("data-autofocus")) ??
      initialItems[0] ??
      dialogRef.current
    ).focus({ preventScroll: true });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (!callbacks.current.dismissDisabled) callbacks.current.onClose();
      } else if (event.key === "Tab") {
        const items = focusables();
        const first = items[0];
        const last = items[items.length - 1];
        if (!first) {
          event.preventDefault();
          dialogRef.current?.focus();
        } else if (
          event.shiftKey &&
          (document.activeElement === first ||
            !dialogRef.current?.contains(document.activeElement))
        ) {
          event.preventDefault();
          last.focus();
        } else if (
          !event.shiftKey &&
          (document.activeElement === last ||
            !dialogRef.current?.contains(document.activeElement))
        ) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      window.visualViewport?.removeEventListener("resize", updateViewport);
      window.visualViewport?.removeEventListener("scroll", updateViewport);
      window.removeEventListener("resize", updateViewport);
      background.forEach(({ element, inert }) => {
        if (!inert) element.removeAttribute("inert");
      });
      document.body.style.overflow = bodyOverflow;
      document.body.style.overscrollBehavior = bodyOverscroll;
      if (previousFocus?.isConnected && !previousFocus.closest("[inert]"))
        previousFocus.focus({ preventScroll: true });
      drag.current = null;
    };
  }, [open]);

  if (!open) return null;
  const requestClose = () => {
    if (!dismissDisabled) onClose();
  };
  const cancelDrag = () => {
    drag.current = null;
    setDragOffset(0);
  };

  return (
    <div className="m-mobile-modal-layer" ref={layerRef}>
      <div
        className={`m-mobile-modal__backdrop ${backdropClassName}`}
        onClick={requestClose}
        aria-hidden="true"
      />
      <div
        className={`m-mobile-modal${fullHeight ? " m-mobile-modal--full" : ""}${compact ? " m-mobile-modal--compact" : ""} ${className}`}
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-busy={dismissDisabled}
        aria-labelledby={titleId}
        tabIndex={-1}
        style={
          dragOffset > 0
            ? { transform: `translateY(${dragOffset}px)` }
            : undefined
        }
      >
        <div
          className="m-mobile-modal__handle m-bottom-sheet__handle"
          aria-hidden="true"
          onTouchStart={(event) => {
            if (dismissDisabled || event.touches.length !== 1) {
              cancelDrag();
              return;
            }
            drag.current = {
              id: event.touches[0].identifier,
              y: event.touches[0].clientY,
            };
          }}
          onTouchMove={(event) => {
            if (!drag.current) return;
            if (event.touches.length !== 1) {
              cancelDrag();
              return;
            }
            const touch = Array.from(event.touches).find(
              (item) => item.identifier === drag.current?.id,
            );
            if (touch)
              setDragOffset(Math.max(0, touch.clientY - drag.current.y));
          }}
          onTouchEnd={(event) => {
            const start = drag.current;
            if (!start) return;
            const touch = Array.from(event.changedTouches).find(
              (item) => item.identifier === start.id,
            );
            cancelDrag();
            if (!touch || dismissDisabled) return;
            const distance = touch.clientY - start.y;
            if (distance > 100) requestClose();
            else if (distance < -100) onExpand?.();
          }}
          onTouchCancel={cancelDrag}
        >
          <div className="m-bottom-sheet__handle-bar" />
        </div>
        <header className="m-mobile-modal__header">
          <h2 id={titleId}>{title}</h2>
          <button
            type="button"
            aria-label={`Close ${title}`}
            disabled={dismissDisabled}
            onClick={requestClose}
          >
            Close
          </button>
        </header>
        <div className="m-mobile-modal__body">{children}</div>
        {footer && <footer className="m-mobile-modal__footer">{footer}</footer>}
      </div>
    </div>
  );
}
