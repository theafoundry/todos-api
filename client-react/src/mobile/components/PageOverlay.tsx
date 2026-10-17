import { useCallback, useId, type ReactNode } from "react";
import { useModalSurface } from "../hooks/useModalSurface";

interface Props {
  title: string;
  onBack: () => void;
  children: ReactNode;
}

/** Full-screen secondary page; shares the modal frame's inert background, focus and Escape ownership. */
export function PageOverlay({ title, onBack, children }: Props) {
  const titleId = useId();
  const { layerRef, dialogRef } = useModalSurface(true, onBack);
  const setPage = useCallback(
    (node: HTMLDivElement | null) => {
      layerRef.current = node;
      dialogRef.current = node;
    },
    [layerRef, dialogRef],
  );

  return (
    <div
      className="m-shell__page-overlay"
      ref={setPage}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
    >
      <header className="m-header">
        <button type="button" className="m-header__back" onClick={onBack}>
          ← Back
        </button>
        <div className="m-header__text">
          <h1 id={titleId} className="m-header__title">
            {title}
          </h1>
        </div>
      </header>
      <div className="m-shell__page-content">{children}</div>
    </div>
  );
}
