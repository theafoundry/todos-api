import { useEffect, useRef, useState } from "react";

export type ToastVariant = "default" | "success" | "error" | "warning";

interface UndoAction {
  message: string;
  onUndo?: () => void;
  actionLabel?: string;
  variant?: ToastVariant;
}

interface Props {
  action: UndoAction | null;
  onDismiss: () => void;
}

export function UndoToast({ action, onDismiss }: Props) {
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [exiting, setExiting] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (action) {
      setExiting(false);
      setVisible(true);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        setExiting(true);
        setTimeout(onDismiss, 200);
      }, 5000);
    } else {
      setVisible(false);
      setExiting(false);
    }
    return () => clearTimeout(timerRef.current);
  }, [action, onDismiss]);

  const variant = action?.variant || "default";

  return (
    <div
      id="undoToast"
      className={`undo-toast${visible ? " active" : ""} undo-toast--${variant}${exiting ? " undo-toast--exiting" : ""}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <span className="undo-toast__status" aria-hidden="true" />
      <span id="undoMessage" className="undo-toast__message">
        {action?.message}
      </span>
      {action?.onUndo && (
        <button
          className="undo-toast__btn"
          onClick={() => {
            action.onUndo?.();
            setExiting(false);
            setVisible(false);
            clearTimeout(timerRef.current);
            onDismiss();
          }}
        >
          {action.actionLabel || "Undo"}
        </button>
      )}
      {visible && !exiting && <div className="undo-toast__progress" />}
    </div>
  );
}
