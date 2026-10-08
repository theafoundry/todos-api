import { useRef, useCallback, useLayoutEffect, type RefObject } from "react";

const SCROLL_KEY = "mobile:scrollPositions";

function readPositions(): Record<string, number> {
  try {
    const value: unknown = JSON.parse(
      sessionStorage.getItem(SCROLL_KEY) ?? "{}",
    );
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(
        ([key, position]) =>
          key.length <= 512 &&
          typeof position === "number" &&
          Number.isFinite(position) &&
          position >= 0,
      ),
    );
  } catch {
    return {};
  }
}

/** Positions belong to the actual scroll container, scoped to the current list view. */
export function useScrollPersistence(
  activeViewKey = "focus",
  scrollRef?: RefObject<HTMLElement | null>,
  dataReady = true,
) {
  const positions = useRef<Record<string, number>>(readPositions());
  const enteredView = useRef<{
    key: string;
    owner: HTMLElement | null;
    hydrated: boolean;
  }>({
    key: activeViewKey,
    owner: null,
    hydrated: false,
  });
  const element = useCallback(
    () =>
      scrollRef?.current ??
      document.querySelector<HTMLElement>(".m-shell__content"),
    [scrollRef],
  );
  const save = useCallback(
    (viewKey: string) => {
      const el = element();
      if (!el) return;
      positions.current[viewKey] = Math.max(0, el.scrollTop);
      try {
        sessionStorage.setItem(SCROLL_KEY, JSON.stringify(positions.current));
      } catch {
        /* In-memory restoration still works. */
      }
    },
    [element],
  );
  const restore = useCallback(
    (viewKey: string) => {
      const el = element();
      if (el) el.scrollTop = positions.current[viewKey] ?? 0;
    },
    [element],
  );

  useLayoutEffect(() => {
    const el = element();
    if (!el) return;
    if (
      enteredView.current.key !== activeViewKey ||
      enteredView.current.owner !== el
    ) {
      enteredView.current = { key: activeViewKey, owner: el, hydrated: false };
    }
    if (!enteredView.current.hydrated) {
      if (!dataReady) return;
      restore(activeViewKey);
      enteredView.current.hydrated = true;
    }
    // A background refresh keeps the existing list usable. Continue tracking user
    // scroll, and restore only on entering a view rather than every completed read.
    const onScroll = () => save(activeViewKey);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [activeViewKey, dataReady, element, restore, save]);

  return { save, restore };
}
