import { useLayoutEffect, useRef } from "react";

const FOCUSABLE =
  'button:not(:disabled), a[href], input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/** Shared focus, background and viewport ownership for mobile modal surfaces. */
export function useModalSurface(
  open: boolean,
  onClose: () => void,
  dismissDisabled = false,
) {
  const layerRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const pointerTrigger = useRef<HTMLElement | null>(null);
  const callbacks = useRef({ onClose, dismissDisabled });
  callbacks.current = { onClose, dismissDisabled };

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
    };
  }, [open]);

  return { layerRef, dialogRef };
}
