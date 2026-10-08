// Pure utility functions extracted from AppShell for testability.
// These encapsulate the view filtering, counting, and placeholder logic
// that previously lived inline in AppShell's useMemo blocks.

import type { Todo } from "../../types";
import type { ActiveFilters } from "../todos/FilterPanel";
import { applyFilters } from "../todos/FilterPanel";
import { PROJECT_RAIL_BACKLOG_SENTINEL } from "../projects/projectEditorModels";

export type WorkspaceView =
  | "inbox"
  | "home"
  | "all"
  | "today"
  | "horizon"
  | "completed";
export type HorizonSegment = "due" | "planned" | "pending" | "later";

interface FilterTodosOptions {
  todos: Todo[];
  activeView: WorkspaceView;
  horizonSegment: HorizonSegment;
  selectedProjectId: string | null;
  searchQuery: string;
  activeTagFilter: string | null;
  activeHeadingId: string | null;
  activeFilters: ActiveFilters;
}

export function filterVisibleTodos(options: FilterTodosOptions): Todo[] {
  const {
    todos,
    activeView,
    horizonSegment,
    selectedProjectId,
    searchQuery,
    activeTagFilter,
    activeHeadingId,
    activeFilters,
  } = options;

  let filtered = todos;

  if (!selectedProjectId) {
    const today = new Date().toISOString().split("T")[0];
    if (activeView === "today") {
      filtered = filtered.filter(
        (t) => !t.completed && t.dueDate && t.dueDate.split("T")[0] <= today,
      );
    } else if (activeView === "horizon") {
      const upcomingEnd = new Date();
      upcomingEnd.setDate(upcomingEnd.getDate() + 14);
      const upcomingEndIso = upcomingEnd.toISOString().split("T")[0];
      if (horizonSegment === "due") {
        filtered = filtered.filter(
          (t) =>
            !t.completed &&
            !!t.dueDate &&
            t.dueDate.split("T")[0] > today &&
            t.dueDate.split("T")[0] <= upcomingEndIso,
        );
      } else if (horizonSegment === "pending") {
        filtered = filtered.filter(
          (t) => !t.completed && t.status === "waiting",
        );
      } else if (horizonSegment === "planned") {
        filtered = filtered.filter((t) => !t.completed && !!t.scheduledDate);
      } else if (horizonSegment === "later") {
        filtered = filtered.filter(
          (t) => !t.completed && t.status === "someday",
        );
      }
    } else if (activeView === "completed") {
      filtered = filtered.filter((t) => t.completed);
    } else if (activeView === "all") {
      // no filter
    }
    // home view: no date filter
  }

  if (searchQuery.trim()) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.description?.toLowerCase().includes(q) ||
        t.category?.toLowerCase().includes(q) ||
        t.notes?.toLowerCase().includes(q) ||
        t.tags.some((tag) => tag.toLowerCase().includes(q)),
    );
  }

  if (activeTagFilter) {
    filtered = filtered.filter((t) =>
      t.tags.some((tag) => tag === activeTagFilter),
    );
  }

  if (activeHeadingId && selectedProjectId) {
    if (activeHeadingId === PROJECT_RAIL_BACKLOG_SENTINEL) {
      filtered = filtered.filter((t) => !t.headingId);
    } else {
      filtered = filtered.filter((t) => t.headingId === activeHeadingId);
    }
  }

  if (
    activeFilters.dateFilter !== "all" ||
    activeFilters.priority ||
    activeFilters.status
  ) {
    filtered = applyFilters(filtered, activeFilters);
  }

  return filtered;
}

interface HorizonCounts extends Record<string, number> {
  due: number;
  pending: number;
  planned: number;
  later: number;
}

export function computeHorizonCounts(todos: Todo[]): HorizonCounts {
  const active = todos.filter((t) => !t.completed);
  const today = new Date().toISOString().split("T")[0];
  const upcomingEnd = new Date();
  upcomingEnd.setDate(upcomingEnd.getDate() + 14);
  const upcomingEndIso = upcomingEnd.toISOString().split("T")[0];

  return {
    due: active.filter(
      (t) =>
        !!t.dueDate &&
        t.dueDate.split("T")[0] > today &&
        t.dueDate.split("T")[0] <= upcomingEndIso,
    ).length,
    pending: active.filter((t) => t.status === "waiting").length,
    planned: active.filter((t) => !!t.scheduledDate).length,
    later: active.filter((t) => t.status === "someday").length,
  };
}

interface ViewCounts extends Record<string, number> {
  today: number;
  horizon: number;
}

export function computeViewCounts(todos: Todo[]): ViewCounts {
  const active = todos.filter((t) => !t.completed);
  const horizonIds = new Set<string>();
  const today = new Date().toISOString().split("T")[0];
  const upcomingEnd = new Date();
  upcomingEnd.setDate(upcomingEnd.getDate() + 14);
  const upcomingEndIso = upcomingEnd.toISOString().split("T")[0];

  for (const todo of active) {
    if (
      (todo.dueDate &&
        todo.dueDate.split("T")[0] > today &&
        todo.dueDate.split("T")[0] <= upcomingEndIso) ||
      todo.status === "waiting" ||
      !!todo.scheduledDate ||
      todo.status === "someday"
    ) {
      horizonIds.add(todo.id);
    }
  }

  return {
    today: active.filter((t) => t.dueDate && t.dueDate.split("T")[0] <= today)
      .length,
    horizon: horizonIds.size,
  };
}

interface ProjectLike {
  id: string;
  name: string;
}

export function getQuickEntryPlaceholder(
  selectedProjectId: string | null,
  projects: ProjectLike[],
  activeView: WorkspaceView,
  horizonSegment: HorizonSegment,
): string {
  if (selectedProjectId) {
    const project = projects.find((p) => p.id === selectedProjectId);
    return project ? `Add a task to ${project.name}…` : "Add a task…";
  }
  switch (activeView) {
    case "home":
      return "What needs your focus today?";
    case "today":
      return "Add a task for today…";
    case "horizon":
      switch (horizonSegment) {
        case "pending":
          return "Add something you're waiting on…";
        case "planned":
          return "Add something planned for later…";
        case "later":
          return "Capture something for later…";
        default:
          return "Add something on the horizon…";
      }
    default:
      return "Add a task…";
  }
}
