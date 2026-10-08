// Pure utility functions for AppShell view title, labels, and query params.
import type { SortField, SortOrder } from "../../types/viewTypes";
import type { WorkspaceView, HorizonSegment } from "./appShellFilters";

export const DRAFT_PROJECT_ID = "draft-project";

export interface QueryParams extends Record<string, string | undefined> {
  projectId?: string;
  sortBy?: string;
  sortOrder?: SortOrder;
  completed?: string;
}

export function buildQueryParams(options: {
  activeView: WorkspaceView;
  selectedProjectId: string | null;
  sortBy: SortField;
  sortOrder: SortOrder;
}): QueryParams {
  const { activeView, selectedProjectId, sortBy, sortOrder } = options;
  const params: QueryParams = {};

  if (selectedProjectId && selectedProjectId !== DRAFT_PROJECT_ID) {
    params.projectId = selectedProjectId;
  } else {
    switch (activeView) {
      case "home":
        break;
      case "today":
        params.sortBy = "dueDate";
        params.sortOrder = "asc";
        break;
      case "completed":
        params.completed = "true";
        break;
      case "horizon":
        params.sortBy = "dueDate";
        params.sortOrder = "asc";
        break;
    }
  }

  // User sort overrides view defaults
  if (sortBy !== "order") {
    params.sortBy = sortBy;
    params.sortOrder = sortOrder;
  }

  return params;
}

export function getViewTitle(
  activeView: WorkspaceView,
  horizonSegment: HorizonSegment,
  selectedProjectId: string | null,
  projects: Array<{ id: string; name: string }>,
): string {
  if (selectedProjectId) {
    const project = projects.find((p) => p.id === selectedProjectId);
    return project ? project.name : "Project";
  }
  switch (activeView) {
    case "inbox":
      return "Inbox";
    case "home":
      return "Focus";
    case "today":
      return "Today";
    case "horizon":
      switch (horizonSegment) {
        case "due":
          return "Horizon";
        case "pending":
          return "Waiting";
        case "planned":
          return "Planned";
        case "later":
          return "Later";
      }
    case "completed":
      return "Completed";
    case "all":
      return "Tasks";
  }
}

export function shouldShowListViewHeader(
  activeView: WorkspaceView,
  selectedProjectId: string | null,
): boolean {
  return selectedProjectId !== null || activeView === "all";
}

export function isBlockingOverlayOpen(options: {
  mobileNavOpen: boolean;
  paletteOpen: boolean;
  shortcutsOpen: boolean;
  composerOpen: boolean;
  projectCrudMode: string | null;
  deleteTarget: string | null;
  activeTodo: unknown;
  showOnboarding: boolean;
}): boolean {
  return (
    options.mobileNavOpen ||
    options.paletteOpen ||
    options.shortcutsOpen ||
    options.composerOpen ||
    !!options.projectCrudMode ||
    !!options.deleteTarget ||
    !!options.activeTodo ||
    options.showOnboarding
  );
}

export function getActiveViewFromHash(hash: string): WorkspaceView | undefined {
  const match = hash.match(/^#\/(inbox|home|today|horizon|completed|all)$/);
  if (!match) return undefined;
  return match[1] as WorkspaceView;
}
