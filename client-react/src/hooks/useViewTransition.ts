import { useCallback } from "react";

/**
 * Wraps state updates in the View Transitions API when available.
 * Falls back to immediate update in unsupported browsers.
 */
export function useViewTransition() {
  const startTransition = useCallback((callback: () => void) => {
    if (
      typeof document !== "undefined" &&
      "startViewTransition" in document &&
      typeof document.startViewTransition === "function"
    ) {
      const transition = document.startViewTransition(callback);
      void transition.ready.catch((error: unknown) => {
        // A newer navigation can skip the animation after its update has run.
        if (!(error instanceof DOMException && error.name === "AbortError"))
          throw error;
      });
    } else {
      callback();
    }
  }, []);

  return { startTransition };
}
