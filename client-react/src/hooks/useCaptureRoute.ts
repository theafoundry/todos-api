import { useEffect, useMemo, useState } from "react";
import { suggestCaptureRoute, type CaptureRouteSuggestion } from "../api/inbox";

const CAPTURE_ROUTE_DEBOUNCE_MS = 260;
const CAPTURE_ROUTE_CONFIDENCE_THRESHOLD = 0.7;

interface Options {
  text: string;
  project?: string | null;
  workspaceView?: string;
  enabled?: boolean;
}

export function useCaptureRoute({
  text,
  project,
  workspaceView,
  enabled = true,
}: Options) {
  const [suggestion, setSuggestion] = useState<CaptureRouteSuggestion | null>(
    null,
  );
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const trimmed = text.trim();
    if (!enabled || !trimmed) {
      setSuggestion(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const nextSuggestion = await suggestCaptureRoute({
          text: trimmed,
          project,
          workspaceView,
        });
        if (!cancelled) {
          setSuggestion(nextSuggestion);
        }
      } catch {
        if (!cancelled) {
          setSuggestion(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }, CAPTURE_ROUTE_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [enabled, text, project, workspaceView]);

  return useMemo(() => {
    const preferredRoute =
      suggestion && suggestion.confidence >= CAPTURE_ROUTE_CONFIDENCE_THRESHOLD
        ? suggestion.route
        : project
          ? "task"
          : workspaceView === "triage" || workspaceView === "inbox"
            ? "triage"
            : "task";
    const alternateRoute: "task" | "triage" =
      preferredRoute === "task" ? "triage" : "task";

    return {
      suggestion,
      loading,
      preferredRoute: preferredRoute as "task" | "triage",
      alternateRoute,
    };
  }, [suggestion, loading, project, workspaceView]);
}
