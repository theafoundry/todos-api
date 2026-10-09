import { useState, useMemo, useEffect } from "react";
import type { Project, User } from "../../types";
import {
  IconFocus,
  IconDesk,
  IconEverything,
  IconToday,
  IconUpcoming,
  IconCompleted,
  IconActivity,
  IconPlus,
  IconSidebar,
  IconSearch,
} from "../shared/Icons";
import { BrandMark } from "../ui/BrandMark";
import { ProfileLauncher } from "../shared/ProfileLauncher";
import {
  groupProjectsByArea,
  getVisibleViews,
  VIEW_LABELS,
  STATUS_COLORS,
} from "./sidebarModels";
import type { WorkspaceView } from "./sidebarModels";

export type { WorkspaceView } from "./sidebarModels";

// Display labels match classic app-shell.fragment
const WORKSPACE_VIEWS: {
  key: WorkspaceView;
  label: string;
  icon: React.ComponentType;
}[] = [
  { key: "inbox", label: "Inbox", icon: IconDesk },
  { key: "today", label: "Today", icon: IconToday },
  { key: "all", label: "Tasks", icon: IconEverything },
  { key: "home", label: "Focus", icon: IconFocus },
  { key: "horizon", label: "Horizon", icon: IconUpcoming },
  { key: "completed", label: "Completed", icon: IconCompleted },
];

function ProjectRailItem({
  project: p,
  isActive,
  onClick,
}: {
  project: Project;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`projects-rail-item${isActive ? " projects-rail-item--active" : ""}`}
      data-project-key={p.name}
      onClick={onClick}
    >
      <span className="nav-label">{p.name}</span>
    </button>
  );
}

interface Props {
  projects: Project[];
  activeView: WorkspaceView;
  selectedProjectId: string | null;
  viewCounts?: Record<string, number>;
  onSelectView: (view: WorkspaceView) => void;
  onSelectProject: (id: string | null) => void;
  onCreateProject: () => void;
  onOpenSettings: () => void;
  onOpenComponents: () => void;
  onOpenFeedback: () => void;
  onOpenAdmin: () => void;
  onOpenActivity: () => void;
  activePage: string;
  onToggleTheme: () => void;
  onOpenShortcuts: () => void;
  onOpenProfile: () => void;
  onLogout: () => void;
  user: User | null;
  dark: boolean;
  isAdmin: boolean;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onNewTask: () => void;
  uiMode: string;
}

export function Sidebar({
  projects,
  activeView,
  selectedProjectId,
  viewCounts,
  onSelectView,
  onSelectProject,
  onCreateProject,
  onOpenSettings,
  onOpenComponents,
  onOpenFeedback,
  onOpenAdmin,
  onOpenActivity,
  activePage,
  onToggleTheme,
  onOpenShortcuts,
  onOpenProfile,
  onLogout,
  user,
  dark,
  isAdmin,
  isCollapsed,
  onToggleCollapse,
  searchQuery,
  onSearchChange,
  onNewTask,
  uiMode,
}: Props) {
  const [collapsedAreas, setCollapsedAreas] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem("todos:collapsed-areas");
      if (stored) return new Set(JSON.parse(stored));
    } catch {
      /* ignore */
    }
    return new Set();
  });

  useEffect(() => {
    try {
      localStorage.setItem(
        "todos:collapsed-areas",
        JSON.stringify([...collapsedAreas]),
      );
    } catch {
      /* ignore */
    }
  }, [collapsedAreas]);

  const isSimple = uiMode === "simple";

  // Group active projects by area (matching classic railUi.js logic)
  const projectGroups = useMemo(
    () => groupProjectsByArea(projects),
    [projects],
  );

  const toggleArea = (area: string) => {
    setCollapsedAreas((prev) => {
      const next = new Set(prev);
      if (next.has(area)) next.delete(area);
      else next.add(area);
      return next;
    });
  };

  const visibleViews = isSimple
    ? WORKSPACE_VIEWS.filter((v) => v.key !== "home")
    : WORKSPACE_VIEWS;

  return (
    <>
      {/* Sidebar header: app name + collapse toggle (like Claude.ai) */}
      <div className="sidebar-header">
        <div className="sidebar-header__brand">
          <BrandMark size={24} className="sidebar-header__mark" />
          <span className="sidebar-header__logo">Planwren</span>
        </div>
        <button
          className="sidebar-header__collapse"
          onClick={onToggleCollapse}
          aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <IconSidebar />
        </button>
      </div>

      {/* New task button — styled like a nav item */}
      {!isCollapsed && (
        <button
          className="sidebar-new-task-btn workspace-view-item"
          data-new-task-trigger="true"
          onClick={onNewTask}
        >
          <IconPlus className="nav-icon" />
          <span className="nav-label">New Task</span>
        </button>
      )}

      {/* Sidebar search — styled like a nav item */}
      {!isCollapsed && (
        <div className="sidebar-search workspace-view-item">
          <IconSearch />
          <input
            id="searchInput"
            data-search-input="true"
            className="sidebar-search__input nav-label"
            data-global-search-input="true"
            type="text"
            placeholder="Search…"
            aria-label="Search tasks"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                onSearchChange("");
                (e.target as HTMLInputElement).blur();
              }
            }}
          />
          {searchQuery && (
            <button
              className="sidebar-search__clear"
              onClick={() => onSearchChange("")}
              aria-label="Clear search"
            >
              ✕
            </button>
          )}
        </div>
      )}

      {/* Scrollable content area */}
      <div className="sidebar-scroll">
        {/* Section 1: Workspace navigation */}
        <nav className="projects-rail__primary">
          {visibleViews.map((v) => (
            <button
              key={v.key}
              className={`workspace-view-item${activeView === v.key && !selectedProjectId ? " projects-rail-item--active" : ""}`}
              data-workspace-view={v.key}
              onClick={() => {
                onSelectProject(null);
                onSelectView(v.key);
              }}
            >
              <v.icon />
              <span className="nav-label">{v.label}</span>
              {viewCounts?.[v.key] != null && viewCounts[v.key] > 0 && (
                <span className="workspace-view-item__count">
                  {viewCounts[v.key]}
                </span>
              )}
            </button>
          ))}
        </nav>

        <nav className="projects-rail__primary" style={{ marginTop: 4 }}>
          <button
            className={`workspace-view-item${activePage === "activity" ? " projects-rail-item--active" : ""}`}
            onClick={onOpenActivity}
          >
            <IconActivity />
            <span className="nav-label">Activity</span>
          </button>
        </nav>

        {/* Section 2: Projects grouped by area */}
        <div className="projects-rail__section">
          <div className="projects-rail__section-header">
            <span className="projects-rail__section-label">Projects</span>
            <button
              id="railNewProjectBtn"
              className="projects-rail__add-btn"
              onClick={onCreateProject}
              aria-label="New project"
            >
              <IconPlus />
            </button>
          </div>
          <div id="projectsRailList" className="projects-rail__list">
            {projectGroups.map(({ area, label, projects: areaProjects }) => (
              <div key={area || "__ungrouped"}>
                {label && (
                  <button
                    className={`projects-rail-area-header${collapsedAreas.has(area) ? " projects-rail-area-header--collapsed" : ""}`}
                    data-area-toggle={area}
                    aria-expanded={!collapsedAreas.has(area)}
                    onClick={() => toggleArea(area)}
                  >
                    <span className="projects-rail-area-header__chevron">
                      {collapsedAreas.has(area) ? "▸" : "▾"}
                    </span>
                    {label}
                  </button>
                )}
                {!collapsedAreas.has(area) && (
                  <div
                    className="projects-rail-area-group"
                    data-area={area || undefined}
                  >
                    {areaProjects.map((p) => (
                      <ProjectRailItem
                        key={p.id}
                        project={p}
                        isActive={selectedProjectId === p.id}
                        onClick={() => onSelectProject(p.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
      {/* end sidebar-scroll */}

      {/* Profile launcher — pinned at bottom, never scrolls */}
      <ProfileLauncher
        user={user}
        dark={dark}
        isAdmin={isAdmin}
        onOpenProfile={onOpenProfile}
        onOpenSettings={onOpenSettings}
        onOpenComponents={onOpenComponents}
        onToggleTheme={onToggleTheme}
        onOpenShortcuts={onOpenShortcuts}
        onOpenFeedback={onOpenFeedback}
        onOpenAdmin={onOpenAdmin}
        onLogout={onLogout}
      />
    </>
  );
}
