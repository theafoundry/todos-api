// Pure utility functions for Sidebar project grouping.
import type { Project } from "../../types";
// Re-export from canonical source (appShellFilters) to avoid duplicate declarations.
export type { WorkspaceView } from "../layout/appShellFilters";

// Area labels and order match classic railUi.js
export const AREA_ORDER = [
  "home",
  "family",
  "work",
  "finance",
  "side-projects",
] as const;

export const AREA_LABELS: Record<string, string> = {
  home: "Focus",
  family: "Family",
  work: "Work",
  finance: "Finance",
  "side-projects": "Side projects",
};

export interface ProjectGroup {
  area: string;
  label: string;
  projects: Project[];
}

export function groupProjectsByArea(projects: Project[]): ProjectGroup[] {
  const active = projects.filter((p) => !p.archived);
  const groups = new Map<string, Project[]>();

  for (const p of active) {
    const area = p.area || "";
    const list = groups.get(area) || [];
    list.push(p);
    groups.set(area, list);
  }

  const sorted: ProjectGroup[] = [];

  for (const area of AREA_ORDER) {
    const list = groups.get(area);
    if (list?.length) {
      sorted.push({
        area,
        label: AREA_LABELS[area] || area,
        projects: list,
      });
      groups.delete(area);
    }
  }

  const unknownAreas = [...groups.entries()]
    .filter(([a]) => a !== "")
    .sort(([a], [b]) => a.localeCompare(b));
  for (const [area, list] of unknownAreas) {
    sorted.push({
      area,
      label: area.charAt(0).toUpperCase() + area.slice(1),
      projects: list,
    });
  }

  const ungrouped = groups.get("");
  if (ungrouped?.length) {
    sorted.push({ area: "", label: "", projects: ungrouped });
  }

  return sorted;
}

export function getVisibleViews(isSimple: boolean): string[] {
  const ALL_VIEWS = [
    "inbox",
    "today",
    "all",
    "home",
    "horizon",
    "completed",
  ] as const;
  return isSimple ? ALL_VIEWS.filter((v) => v !== "home") : [...ALL_VIEWS];
}

export const VIEW_LABELS: Record<string, string> = {
  inbox: "Inbox",
  home: "Focus",
  all: "Tasks",
  today: "Today",
  horizon: "Horizon",
  completed: "Completed",
};

export const STATUS_COLORS: Record<string, string> = {
  active: "var(--success)",
  on_hold: "var(--warning)",
  completed: "var(--muted)",
  archived: "var(--muted)",
};
