import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

export type MobileSurface =
  | { mode: "closed" }
  | { mode: "capture" }
  | { mode: "profile" }
  | { mode: "search" }
  | { mode: "details" | "edit"; taskId: string }
  | { mode: "reschedule"; taskId: string; returnToDetails: boolean };

export type MobilePage = "todos" | "ai" | "review" | "admin";

interface MobileRoute {
  surface: MobileSurface;
  page: MobilePage;
  projectId: string | null;
}

interface Options {
  closeRequestRef: RefObject<(() => void) | null>;
  isDismissBlocked?: () => boolean;
}

interface HistoryMarker {
  session: string;
  index: number;
}

const HISTORY_KEY = "planwrenMobile";
const PROJECT_KEY = "mobile:selectedProject";
const INITIAL_ROUTE: MobileRoute = {
  surface: { mode: "closed" },
  page: "todos",
  projectId: null,
};

function getStoredProject(): string | null {
  try {
    if (sessionStorage.getItem("mobile:activeTab") !== "projects") return null;
    const id = sessionStorage.getItem(PROJECT_KEY);
    return id && id.length <= 256 ? id : null;
  } catch {
    return null;
  }
}

function storeProject(id: string | null) {
  try {
    if (id) sessionStorage.setItem(PROJECT_KEY, id);
    else sessionStorage.removeItem(PROJECT_KEY);
  } catch {
    // Navigation remains available when browser storage is disabled.
  }
}

function markerFromState(state: unknown): HistoryMarker | null {
  if (!state || typeof state !== "object") return null;
  const marker = (state as Record<string, unknown>)[HISTORY_KEY];
  if (!marker || typeof marker !== "object") return null;
  const value = marker as Partial<HistoryMarker>;
  return typeof value.session === "string" &&
    Number.isSafeInteger(value.index) &&
    Number(value.index) >= 0
    ? { session: value.session, index: Number(value.index) }
    : null;
}

/** History holds markers, never draft contents; reload always starts with the list. */
export function useMobileNavigation({
  closeRequestRef,
  isDismissBlocked,
}: Options) {
  const [initialProject] = useState(getStoredProject);
  const initialFrames = initialProject
    ? [INITIAL_ROUTE, { ...INITIAL_ROUTE, projectId: initialProject }]
    : [INITIAL_ROUTE];
  const [route, setRoute] = useState<MobileRoute>(
    initialFrames[initialFrames.length - 1],
  );
  const frames = useRef<MobileRoute[]>(initialFrames);
  const index = useRef(initialFrames.length - 1);
  const session = useRef(
    globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
  );
  const initialized = useRef(false);
  const browserEnabled = useRef(true);
  const closingTo = useRef<number | null>(null);
  const rejectingForward = useRef(false);
  const restoringForClose = useRef(false);
  const callbacks = useRef({ closeRequestRef, isDismissBlocked });
  callbacks.current = { closeRequestRef, isDismissBlocked };

  const writeEntry = useCallback((target: number, replace: boolean) => {
    try {
      const state =
        history.state && typeof history.state === "object" ? history.state : {};
      const next = {
        ...state,
        [HISTORY_KEY]: { session: session.current, index: target },
      };
      if (replace) history.replaceState(next, "", window.location.href);
      else history.pushState(next, "", window.location.href);
      return true;
    } catch {
      browserEnabled.current = false;
      return false;
    }
  }, []);

  const commit = useCallback((target: number, discardForward: boolean) => {
    index.current = target;
    if (discardForward) frames.current = frames.current.slice(0, target + 1);
    storeProject(frames.current[target].projectId);
    setRoute(frames.current[target]);
  }, []);

  const consumeTo = useCallback(
    (target: number) => {
      if (closingTo.current !== null || target === index.current) return;
      if (!browserEnabled.current) {
        commit(target, true);
        return;
      }
      closingTo.current = target;
      try {
        history.go(target - index.current);
      } catch {
        closingTo.current = null;
        browserEnabled.current = false;
        commit(target, true);
      }
    },
    [commit],
  );

  const closeSurface = useCallback(
    (options?: { all?: boolean }) => {
      const current = frames.current[index.current];
      if (current.surface.mode === "closed" || index.current === 0) return;
      let target = index.current - 1;
      if (options?.all) {
        while (target > 0 && frames.current[target].surface.mode !== "closed")
          target--;
      }
      consumeTo(target);
    },
    [consumeTo],
  );

  const closePage = useCallback(() => {
    if (frames.current[index.current].page === "todos" || index.current === 0)
      return;
    let target = index.current - 1;
    while (target > 0 && frames.current[target].page !== "todos") target--;
    consumeTo(target);
  }, [consumeTo]);

  const closeProject = useCallback(() => {
    if (!frames.current[index.current].projectId) return;
    let target = index.current - 1;
    while (target > 0 && frames.current[target].projectId) target--;
    if (target >= 0) consumeTo(target);
  }, [consumeTo]);

  const requestClose = useCallback(() => {
    if (closingTo.current !== null || callbacks.current.isDismissBlocked?.())
      return;
    const current = frames.current[index.current];
    if (
      ["edit", "capture", "reschedule"].includes(current.surface.mode) &&
      callbacks.current.closeRequestRef.current
    ) {
      callbacks.current.closeRequestRef.current();
    } else if (current.surface.mode !== "closed") closeSurface();
    else if (current.page !== "todos") closePage();
    else closeProject();
  }, [closePage, closeProject, closeSurface]);

  const openRoute = useCallback(
    (next: MobileRoute, replace: boolean) => {
      if (closingTo.current !== null) return;
      if (
        JSON.stringify(next) === JSON.stringify(frames.current[index.current])
      )
        return;
      const target =
        replace && index.current > 0 ? index.current : index.current + 1;
      frames.current = frames.current.slice(0, target);
      frames.current[target] = next;
      writeEntry(target, replace && index.current > 0);
      commit(target, false);
    },
    [commit, writeEntry],
  );

  const openSurface = useCallback(
    (surface: MobileSurface, options?: { replace?: boolean }) => {
      if (surface.mode === "closed") {
        closeSurface({ all: true });
        return;
      }
      openRoute(
        { ...frames.current[index.current], surface },
        Boolean(options?.replace),
      );
    },
    [closeSurface, openRoute],
  );

  const openPage = useCallback(
    (page: MobilePage) => {
      if (page === "todos") {
        closePage();
        return;
      }
      // Selecting a page replaces its profile menu rather than stacking two surfaces.
      const current = frames.current[index.current];
      openRoute(
        { ...current, page, surface: { mode: "closed" } },
        current.surface.mode === "profile",
      );
    },
    [closePage, openRoute],
  );

  const openProject = useCallback(
    (projectId: string) => {
      const current = frames.current[index.current];
      openRoute(
        { ...current, page: "todos", surface: { mode: "closed" }, projectId },
        Boolean(current.projectId),
      );
    },
    [openRoute],
  );

  useEffect(() => {
    if (!initialized.current) {
      // A reload starts a new history session and never resurrects a transient editor.
      writeEntry(0, true);
      if (initialProject) writeEntry(1, false);
      initialized.current = true;
    }
    const onPopState = (event: PopStateEvent) => {
      if (!browserEnabled.current) return;
      const marker = markerFromState(event.state);
      const belongs = marker?.session === session.current;
      const target = belongs ? marker.index : -1;
      if (rejectingForward.current) {
        rejectingForward.current = false;
        if (target !== index.current) writeEntry(index.current, true);
        return;
      }
      if (restoringForClose.current) {
        restoringForClose.current = false;
        if (target !== index.current) writeEntry(index.current, true);
        requestClose();
        return;
      }
      if (index.current === 0 && !belongs) return;
      if (closingTo.current !== null) {
        const expected = closingTo.current;
        closingTo.current = null;
        if (target === expected && frames.current[target]) commit(target, true);
        else {
          // A confirmed UI close still works if another owner changed the history state.
          commit(expected, true);
          writeEntry(expected, true);
        }
        return;
      }
      if (target < index.current && index.current > 0) {
        const current = frames.current[index.current];
        const guarded =
          ["edit", "capture", "reschedule"].includes(current.surface.mode) &&
          Boolean(callbacks.current.closeRequestRef.current);
        if (callbacks.current.isDismissBlocked?.() || guarded) {
          // Restore the owned entry before consulting a dirty draft or pending save.
          if (belongs) {
            restoringForClose.current = true;
            try {
              history.go(index.current - target);
            } catch {
              restoringForClose.current = false;
              writeEntry(index.current, false);
              requestClose();
            }
          } else {
            writeEntry(index.current, false);
            requestClose();
          }
        } else if (belongs && frames.current[target]) commit(target, true);
        else {
          writeEntry(index.current, false);
          requestClose();
        }
      } else if (target !== index.current) {
        // Return to the owned entry so obsolete Forward does not add an extra Back step.
        if (belongs && target > index.current) {
          rejectingForward.current = true;
          try {
            history.go(index.current - target);
          } catch {
            rejectingForward.current = false;
            writeEntry(index.current, true);
          }
        } else writeEntry(index.current, true);
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [commit, initialProject, requestClose, writeEntry]);

  return {
    surface: route.surface,
    page: route.page,
    selectedProjectId: route.projectId,
    openSurface,
    closeSurface,
    requestClose,
    openPage,
    closePage,
    openProject,
    closeProject,
  };
}
