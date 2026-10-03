import { useLayoutEffect, useState } from "react";

// Same key the app's useDarkMode() writes; public pages only read it.
const STORAGE_KEY = "darkMode";
const DARK_QUERY = "(prefers-color-scheme: dark)";

/** Body class that scopes every runtime rule in styles/public.css. */
export const PUBLIC_SURFACE_CLASS = "pw-public";

function readSavedPreference(): boolean | null {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === null ? null : stored === "true";
  } catch {
    return null;
  }
}

function getDarkQuery(): MediaQueryList | null {
  return typeof window.matchMedia === "function"
    ? window.matchMedia(DARK_QUERY)
    : null;
}

/** Saved app preference wins; otherwise follow the system setting. */
function resolveDark(query: MediaQueryList | null): boolean {
  return readSavedPreference() ?? query?.matches ?? false;
}

/**
 * Activate public-surface styling while a landing/auth page is mounted and
 * mirror the app's saved (or system) appearance. It never persists a theme
 * choice, and on unmount it only removes the public scope class — the
 * app's dark-mode class is left as-is for useDarkMode() to own.
 *
 * Returns the effective dark flag (same value applied to the body) so
 * theme-specific artwork can follow a saved preference, not just the
 * system media query.
 */
export function usePublicTheme(): boolean {
  // Resolve synchronously so the first render already picks the right art.
  const [dark, setDark] = useState(() => resolveDark(getDarkQuery()));

  useLayoutEffect(() => {
    const body = document.body;
    const query = getDarkQuery();

    const apply = () => {
      const next = resolveDark(query);
      body.classList.toggle("dark-mode", next);
      setDark(next);
    };

    body.classList.add(PUBLIC_SURFACE_CLASS);
    apply();
    query?.addEventListener?.("change", apply);
    window.addEventListener("storage", apply);
    return () => {
      query?.removeEventListener?.("change", apply);
      window.removeEventListener("storage", apply);
      body.classList.remove(PUBLIC_SURFACE_CLASS);
    };
  }, []);

  return dark;
}
