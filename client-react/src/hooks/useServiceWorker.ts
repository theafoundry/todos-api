import { useEffect } from "react";

export function useServiceWorker(
  onSyncComplete?: (replayed: number, failed: number) => void,
) {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    navigator.serviceWorker.register("/app/sw.js").catch(() => {
      // SW registration failed — no offline support
    });

    // Listen for sync complete messages
    const handler = (event: MessageEvent) => {
      if (event.data?.type === "offline-sync-complete") {
        onSyncComplete?.(event.data.replayed, event.data.failed);
      }
    };
    navigator.serviceWorker.addEventListener("message", handler);

    return () => {
      navigator.serviceWorker.removeEventListener("message", handler);
    };
  }, [onSyncComplete]);
}
