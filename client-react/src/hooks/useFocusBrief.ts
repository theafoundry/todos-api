import { useState, useEffect, useCallback, useRef } from "react";
import { apiCall } from "../api/client";
import type { FocusBriefResponse } from "../types/focusBrief";
import { clearPersistedFocusBrief } from "../utils/focusBriefCache";

export function useFocusBrief() {
  // AuthGate keys each shell by user.id. Never hydrate another session's data.
  const [brief, setBrief] = useState<FocusBriefResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const sequence = useRef(0);

  const fetchBrief = useCallback(async () => {
    const request = ++sequence.current;
    setLoading(true);
    try {
      const res = await apiCall("/ai/focus-brief");
      if (!res.ok) {
        if (request === sequence.current) setUnavailable(res.status === 503);
        if (
          request === sequence.current &&
          [401, 403, 503].includes(res.status)
        )
          setBrief(null);
        throw new Error(`HTTP ${res.status}`);
      }
      const data: FocusBriefResponse = await res.json();
      if (!data?.pinned || !Array.isArray(data.rankedPanels))
        throw new Error("The focus brief response was invalid.");
      if (request !== sequence.current) return false;
      setBrief(data);
      setUnavailable(false);
      setError(null);
      return true;
    } catch (err: any) {
      if (request === sequence.current)
        setError(err.message || "Failed to load focus brief");
      return false;
    } finally {
      if (request === sequence.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    clearPersistedFocusBrief();
    void fetchBrief();
    return () => {
      sequence.current += 1;
    };
  }, [fetchBrief]);

  const refresh = useCallback(async () => {
    const request = ++sequence.current;
    setRefreshing(true);
    try {
      const response = await apiCall("/ai/focus-brief/refresh", {
        method: "POST",
      });
      if (request !== sequence.current) return false;
      if (!response.ok || response.status === 202) {
        setUnavailable(response.status === 503);
        if ([401, 403, 503].includes(response.status)) setBrief(null);
        throw new Error(`Could not refresh focus brief (${response.status}).`);
      }
      return await fetchBrief();
    } catch (err) {
      if (request === sequence.current)
        setError(
          err instanceof Error ? err.message : "Could not refresh focus brief.",
        );
      return false;
    } finally {
      if (request === sequence.current) setLoading(false);
      setRefreshing(false);
    }
  }, [fetchBrief]);

  return {
    brief,
    loading,
    error,
    refreshing,
    unavailable,
    refresh,
    revalidate: fetchBrief,
  };
}
