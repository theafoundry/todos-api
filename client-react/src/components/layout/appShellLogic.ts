// Pure utility functions extracted from AppShell for testability.
// These encapsulate date math, navigation state derivation, and page logic
// that previously lived inline in AppShell's handler callbacks.

import type { WorkspaceView, HorizonSegment } from "./appShellFilters";
import type { Project } from "../../types";
import { DRAFT_PROJECT_ID } from "./appShellViews";

// Re-export for test consumers (avoids circular imports)
export { DRAFT_PROJECT_ID };

// ── Snooze date calculations ──────────────────────────────────────────────

export type SnoozeAction =
  | "cancel"
  | "reopen"
  | "archive"
  | "snooze-tomorrow"
  | "snooze-next-week"
  | "snooze-next-month";

export interface SnoozeResult {
  status?: string;
  archived?: boolean;
  scheduledDate?: string;
}

export function computeSnoozePayload(
  action: SnoozeAction,
  now = new Date(),
): SnoozeResult {
  switch (action) {
    case "cancel":
      return { status: "cancelled" };
    case "reopen":
      return { status: "inbox" };
    case "archive":
      return { archived: true };
    case "snooze-tomorrow": {
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      return {
        scheduledDate: tomorrow.toISOString().split("T")[0],
        status: "scheduled",
      };
    }
    case "snooze-next-week": {
      const nextWeek = new Date(now);
      nextWeek.setDate(nextWeek.getDate() + 7);
      return {
        scheduledDate: nextWeek.toISOString().split("T")[0],
        status: "scheduled",
      };
    }
    case "snooze-next-month": {
      const nextMonth = new Date(now);
      nextMonth.setMonth(nextMonth.getMonth() + 1);
      return {
        scheduledDate: nextMonth.toISOString().split("T")[0],
        status: "scheduled",
      };
    }
  }
}

// ── Undo message derivation ───────────────────────────────────────────────

export function getLifecycleUndoMessage(
  action: SnoozeAction,
  taskTitle: string,
): string {
  switch (action) {
    case "cancel":
      return "Task cancelled";
    case "reopen":
      return "Task reopened";
    case "archive":
      return "Task archived";
    case "snooze-tomorrow":
      return "Snoozed until tomorrow";
    case "snooze-next-week":
      return "Snoozed until next week";
    case "snooze-next-month":
      return "Snoozed until next month";
  }
}

// ── Page title derivation ─────────────────────────────────────────────────

export type AppPage =
  | "todos"
  | "settings"
  | "components"
  | "admin"
  | "feedback"
  | "review"
  | "activity";

export function getPageLabel(page: AppPage): string {
  switch (page) {
    case "settings":
      return "Settings";
    case "components":
      return "Component Gallery";
    case "admin":
      return "Admin";
    case "feedback":
      return "Feedback";
    case "review":
      return "Weekly Review";
    case "activity":
      return "Agent Activity";
    case "todos":
      return ""; // Uses headerTitle instead
  }
}

export function buildDocumentTitle(page: AppPage, headerTitle: string): string {
  const pageLabel = page === "todos" ? headerTitle : getPageLabel(page);
  return `${pageLabel} — Planwren`;
}

// ── Header title derivation ───────────────────────────────────────────────

export const VIEW_LABELS: Record<WorkspaceView, string> = {
  inbox: "Inbox",
  home: "Focus",
  all: "Tasks",
  today: "Today",
  horizon: "Horizon",
  completed: "Completed",
};

export function getHeaderTitle(
  activeView: WorkspaceView,
  selectedProjectId: string | null,
  selectedProjectName: string | null,
): string {
  if (selectedProjectId) {
    return selectedProjectName ?? "Project";
  }
  return VIEW_LABELS[activeView] ?? activeView;
}

// ── Active view key derivation ─────────────────────────────────────────────

export function getActiveViewKey(
  activeView: WorkspaceView,
  selectedProjectId: string | null,
): string {
  return selectedProjectId ? `project:${selectedProjectId}` : activeView;
}

// ── Keyboard shortcut dispatch logic ──────────────────────────────────────

export type KeyAction =
  | { type: "close-palette" }
  | { type: "deescalate" }
  | { type: "cancel-bulk" }
  | { type: "close-mobile-nav" }
  | { type: "toggle-palette" }
  | { type: "focus-quick-entry" }
  | { type: "toggle-view-menu" }
  | { type: "focus-search" }
  | { type: "toggle-shortcuts" }
  | { type: "navigate-down"; count: number }
  | { type: "navigate-up"; count: number }
  | { type: "toggle-complete"; todoId: string }
  | { type: "open-drawer"; todoId: string }
  | { type: "request-delete"; todoId: string }
  | { type: "none" };

export function dispatchKeyboardShortcut(options: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  inInput: boolean;
  paletteOpen: boolean;
  activeTodoId: string | null;
  bulkMode: boolean;
  mobileNavOpen: boolean;
  visibleTodoIds: string[];
}): KeyAction {
  const {
    key,
    metaKey,
    ctrlKey,
    inInput,
    paletteOpen,
    activeTodoId,
    bulkMode,
    mobileNavOpen,
    visibleTodoIds,
  } = options;

  // Escape: contextual close
  if (key === "Escape") {
    if (paletteOpen) return { type: "close-palette" };
    if (activeTodoId) return { type: "deescalate" };
    if (bulkMode) return { type: "cancel-bulk" };
    if (mobileNavOpen) return { type: "close-mobile-nav" };
    return { type: "none" };
  }

  // Ctrl/Cmd+K: toggle command palette
  if ((metaKey || ctrlKey) && key === "k") {
    return { type: "toggle-palette" };
  }

  // Ignore when in input field
  if (inInput) return { type: "none" };

  // Single key shortcuts
  switch (key) {
    case "n":
      return { type: "focus-quick-entry" };
    case "v":
      return { type: "toggle-view-menu" };
    case "/":
      return { type: "focus-search" };
    case "?":
      return { type: "toggle-shortcuts" };
    case "j":
      return activeTodoId
        ? { type: "navigate-down", count: visibleTodoIds.length }
        : { type: "none" };
    case "k":
      return activeTodoId
        ? { type: "navigate-up", count: visibleTodoIds.length }
        : { type: "none" };
    case "x":
      return activeTodoId
        ? { type: "toggle-complete", todoId: activeTodoId }
        : { type: "none" };
    case "e":
      return activeTodoId
        ? { type: "open-drawer", todoId: activeTodoId }
        : { type: "none" };
    case "d":
      return activeTodoId
        ? { type: "request-delete", todoId: activeTodoId }
        : { type: "none" };
    default:
      return { type: "none" };
  }
}

export function computeNextNavIndex(
  currentTodoId: string | null,
  direction: "up" | "down",
  visibleTodoIds: string[],
): number {
  const currentIdx = currentTodoId ? visibleTodoIds.indexOf(currentTodoId) : -1;
  if (currentIdx === -1) return 0;

  if (direction === "down") {
    return currentIdx < visibleTodoIds.length - 1 ? currentIdx + 1 : 0;
  }
  return currentIdx > 0 ? currentIdx - 1 : visibleTodoIds.length - 1;
}

// ── Bulk select all logic ──────────────────────────────────────────────────

export function computeSelectAllResult(
  currentSelectedIds: Set<string>,
  visibleTodoIds: string[],
): Set<string> {
  if (currentSelectedIds.size === visibleTodoIds.length) {
    return new Set();
  }
  return new Set(visibleTodoIds);
}

// ── Export calendar logic ──────────────────────────────────────────────────

export interface ExportCalendarResult {
  count: number;
  message: string;
}

export function computeExportCalendarResult(
  todoCount: number,
): ExportCalendarResult {
  if (todoCount === 0) {
    return { count: 0, message: "No tasks with due dates to export" };
  }
  return {
    count: todoCount,
    message: `Exported ${todoCount} task${todoCount > 1 ? "s" : ""} to .ics`,
  };
}

// ── Draft project creation ─────────────────────────────────────────────────

export function createDraftProject(now = new Date()): Project {
  const nowIso = now.toISOString();
  return {
    id: DRAFT_PROJECT_ID,
    name: "",
    description: null,
    goal: null,
    status: "active",
    priority: null,
    area: null,
    areaId: null,
    targetDate: null,
    archived: false,
    userId: "draft-user",
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}
