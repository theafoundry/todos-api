import { useState, useEffect, useCallback, useRef } from "react";
import { apiCall } from "../api/client";
import type { FocusBriefResponse } from "../types/focusBrief";

const CACHE_KEY = "todos:focus-brief-cache";

function readCache(): FocusBriefResponse | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Invalidate stale cache missing provenance fields (pre-card-design format)
      if (
        parsed.rankedPanels?.length > 0 &&
        !parsed.rankedPanels[0].provenance
      ) {
        localStorage.removeItem(CACHE_KEY);
        return null;
      }
      return parsed;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function writeCache(data: FocusBriefResponse): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch {
    /* ignore */
  }
}

export function useFocusBrief() {
  const [brief, setBrief] = useState<FocusBriefResponse | null>(readCache);
  const [loading, setLoading] = useState(!brief);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const sequence = useRef(0);

  const fetchBrief = useCallback(async () => {
    const request = ++sequence.current;
    setLoading(true);
    try {
      const res = await apiCall("/ai/focus-brief");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: FocusBriefResponse = await res.json();
      if (!data?.pinned || !Array.isArray(data.rankedPanels))
        throw new Error("The focus brief response was invalid.");
      if (request !== sequence.current) return false;
      setBrief(data);
      writeCache(data);
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
    void fetchBrief();
  }, [fetchBrief]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await apiCall("/ai/focus-brief/refresh", {
        method: "POST",
      });
      if (!response.ok || response.status === 202)
        throw new Error(`Could not refresh focus brief (${response.status}).`);
      return await fetchBrief();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not refresh focus brief.",
      );
      return false;
    } finally {
      setRefreshing(false);
    }
  }, [fetchBrief]);

  return { brief, loading, error, refreshing, refresh, revalidate: fetchBrief };
}
