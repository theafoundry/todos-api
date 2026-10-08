import { useState, useCallback } from "react";
import type { WorkspaceView } from "../../components/projects/Sidebar";

export type MobileTab =
  | "inbox"
  | "focus"
  | "today"
  | "projects"
  | "tasks"
  | "custom";

const CUSTOM_TAB_KEY = "mobile:customTab";
const ACTIVE_TAB_KEY = "mobile:activeTab";
const MOBILE_TABS: MobileTab[] = [
  "inbox",
  "focus",
  "today",
  "projects",
  "tasks",
  "custom",
];

export const CUSTOM_TAB_OPTIONS: { key: WorkspaceView; label: string }[] = [
  { key: "all", label: "Tasks" },
  { key: "horizon", label: "Upcoming" },
  { key: "completed", label: "Completed" },
  { key: "home", label: "Focus" },
];

function getStoredTab(): MobileTab {
  try {
    const stored = sessionStorage.getItem(ACTIVE_TAB_KEY);
    return MOBILE_TABS.includes(stored as MobileTab)
      ? (stored as MobileTab)
      : "inbox";
  } catch {
    return "inbox";
  }
}

function getStoredCustomView(): WorkspaceView {
  try {
    const stored = localStorage.getItem(CUSTOM_TAB_KEY);
    if (stored && CUSTOM_TAB_OPTIONS.some((option) => option.key === stored))
      return stored as WorkspaceView;
  } catch {
    // Use the default view when browser storage is disabled.
  }
  return "all";
}

export function useTabBar() {
  const [activeTab, setActiveTabState] = useState<MobileTab>(getStoredTab);
  const [customView, setCustomViewState] =
    useState<WorkspaceView>(getStoredCustomView);

  const setActiveTab = useCallback((tab: MobileTab) => {
    setActiveTabState(tab);
    try {
      sessionStorage.setItem(ACTIVE_TAB_KEY, tab);
    } catch {
      /* Keep navigation usable without storage. */
    }
  }, []);

  const setCustomView = useCallback((view: WorkspaceView) => {
    if (!CUSTOM_TAB_OPTIONS.some((option) => option.key === view)) return;
    setCustomViewState(view);
    try {
      localStorage.setItem(CUSTOM_TAB_KEY, view);
    } catch {
      /* Keep navigation usable without storage. */
    }
  }, []);

  return { activeTab, setActiveTab, customView, setCustomView };
}
