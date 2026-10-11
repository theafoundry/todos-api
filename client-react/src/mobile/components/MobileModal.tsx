import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useModalSurface } from "../hooks/useModalSurface";
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
  const { layerRef, dialogRef } = useModalSurface(
    open,
    onClose,
    dismissDisabled,
  );
  const drag = useRef<{ id: number; y: number } | null>(null);
  const [dragOffset, setDragOffset] = useState(0);

  useLayoutEffect(() => {
    if (open) setDragOffset(0);
    return () => {
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
