import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import type { WorkspaceView } from "../projects/Sidebar";
import type { Project, Todo } from "../../types";
import { IllustrationNoResults } from "./Illustrations";
import { useOverlayFocusTrap } from "./useOverlayFocusTrap";

interface CommandItem {
  id: string;
  label: string;
  section: "Commands" | "Tasks";
  action: () => void;
  keywords?: string;
  meta?: string;
}

type ScoredTaskMatch = Omit<CommandItem, "section"> & {
  section: "Tasks";
  score: number;
};

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (view: WorkspaceView) => void;
  onNavigateHorizonSegment: (
    segment: "due" | "planned" | "pending" | "later",
  ) => void;
  onWeeklyReview: () => void;
  onToggleDarkMode: () => void;
  onOpenSettings: () => void;
  onOpenFeedback: () => void;
  onOpenShortcuts: () => void;
  onNewTask: () => void;
  onFocusSearch: () => void;
  onExportCalendar: () => void;
  onLogout: () => void;
  projects?: Project[];
  todos?: Todo[];
  onTodoClick?: (id: string) => void;
  onProjectOpen?: (id: string) => void;
}

export function CommandPalette({
  isOpen,
  onClose,
  onNavigate,
  onNavigateHorizonSegment,
  onWeeklyReview,
  onToggleDarkMode,
  onOpenSettings,
  onOpenFeedback,
  onOpenShortcuts,
  onNewTask,
  onFocusSearch,
  onExportCalendar,
  onLogout,
  projects = [],
  todos = [],
  onTodoClick,
  onProjectOpen,
}: Props) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useOverlayFocusTrap({
    isOpen,
    containerRef: panelRef,
    onClose,
    initialFocusRef: inputRef,
    restoreFocus: false,
  });

  const commands: CommandItem[] = useMemo(
    () => [
      {
        id: "new-task",
        label: "Create Task",
        section: "Commands",
        action: onNewTask,
        keywords: "add create todo quick entry",
      },
      {
        id: "nav-inbox",
        label: "Go to Inbox",
        section: "Commands",
        action: () => onNavigate("inbox"),
        keywords: "capture review desk saved intentions",
      },
      {
        id: "nav-focus",
        label: "Go to Focus",
        section: "Commands",
        action: () => onNavigate("home"),
        keywords: "home dashboard",
      },
      {
        id: "nav-everything",
        label: "Go to Tasks",
        section: "Commands",
        action: () => onNavigate("all"),
        keywords: "all tasks",
      },
      {
        id: "nav-today",
        label: "Go to Today",
        section: "Commands",
        action: () => onNavigate("today"),
        keywords: "today due now",
      },
      {
        id: "nav-horizon",
        label: "Go to Horizon",
        section: "Commands",
        action: () => onNavigate("horizon"),
        keywords: "horizon upcoming future planning",
      },
      {
        id: "nav-horizon-due",
        label: "Go to Horizon: Due",
        section: "Commands",
        action: () => onNavigateHorizonSegment("due"),
        keywords: "horizon upcoming due soon schedule",
      },
      {
        id: "nav-horizon-pending",
        label: "Go to Horizon: Pending",
        section: "Commands",
        action: () => onNavigateHorizonSegment("pending"),
        keywords: "waiting blocked hold pending horizon",
      },
      {
        id: "nav-horizon-planned",
        label: "Go to Horizon: Planned",
        section: "Commands",
        action: () => onNavigateHorizonSegment("planned"),
        keywords: "scheduled planned calendar horizon",
      },
      {
        id: "nav-horizon-later",
        label: "Go to Horizon: Later",
        section: "Commands",
        action: () => onNavigateHorizonSegment("later"),
        keywords: "later someday maybe backlog horizon",
      },
      {
        id: "nav-completed",
        label: "Go to Completed",
        section: "Commands",
        action: () => onNavigate("completed"),
        keywords: "done finished completed",
      },
      {
        id: "nav-weekly-review",
        label: "Go to Weekly Reset",
        section: "Commands",
        action: onWeeklyReview,
        keywords: "weekly review reset",
      },
      {
        id: "nav-settings",
        label: "Go to Settings",
        section: "Commands",
        action: onOpenSettings,
        keywords: "profile preferences account",
      },
      {
        id: "nav-feedback",
        label: "Go to Feedback",
        section: "Commands",
        action: onOpenFeedback,
        keywords: "bug report feedback",
      },
      {
        id: "focus-search",
        label: "Focus Search",
        section: "Commands",
        action: onFocusSearch,
        keywords: "find filter search",
      },
      {
        id: "toggle-dark-mode",
        label: "Toggle Dark Mode",
        section: "Commands",
        action: onToggleDarkMode,
        keywords: "theme light night",
      },
      {
        id: "show-shortcuts",
        label: "Show Keyboard Shortcuts",
        section: "Commands",
        action: onOpenShortcuts,
        keywords: "help shortcuts keys",
      },
      {
        id: "export-calendar",
        label: "Export Calendar",
        section: "Commands",
        action: onExportCalendar,
        keywords: "ics calendar download",
      },
      {
        id: "logout",
        label: "Logout",
        section: "Commands",
        action: onLogout,
        keywords: "sign out log out",
      },
      ...projects
        .filter((project) => !project.archived)
        .map((project) => ({
          id: `project-${project.id}`,
          label: `Go to project: ${project.name}`,
          section: "Commands" as const,
          action: () => onProjectOpen?.(project.id),
          keywords: `${project.name.toLowerCase()} project`,
        })),
    ],
    [
      onNewTask,
      onNavigate,
      onNavigateHorizonSegment,
      onWeeklyReview,
      onOpenSettings,
      onOpenFeedback,
      onFocusSearch,
      onToggleDarkMode,
      onOpenShortcuts,
      onExportCalendar,
      onLogout,
      projects,
      onProjectOpen,
    ],
  );

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const commandMatches =
      normalizedQuery.length === 0
        ? commands
        : commands.filter(
            (command) =>
              command.label.toLowerCase().includes(normalizedQuery) ||
              command.keywords?.toLowerCase().includes(normalizedQuery),
          );

    const taskMatches: CommandItem[] =
      normalizedQuery.length === 0 || !onTodoClick
        ? []
        : todos
            .map<ScoredTaskMatch | null>((todo) => {
              const title = todo.title.toLowerCase();
              const description = todo.description?.toLowerCase() ?? "";
              const category = todo.category?.toLowerCase() ?? "";

              let score = -1;
              if (title.startsWith(normalizedQuery)) score = 0;
              else if (title.includes(normalizedQuery)) score = 1;
              else if (
                description.includes(normalizedQuery) ||
                category.includes(normalizedQuery)
              ) {
                score = 2;
              }

              if (score === -1) return null;

              return {
                id: `task-${todo.id}`,
                label: todo.title,
                section: "Tasks" as const,
                action: () => onTodoClick(todo.id),
                meta: [todo.category, todo.status !== "next" ? todo.status : ""]
                  .filter(Boolean)
                  .join(" · "),
                score,
              };
            })
            .filter((item): item is ScoredTaskMatch => item !== null)
            .sort((a, b) => {
              if (a.score !== b.score) return a.score - b.score;
              return a.label.localeCompare(b.label);
            })
            .slice(0, 6)
            .map(({ score: _score, ...item }) => item);

    return [...commandMatches, ...taskMatches];
  }, [commands, query, todos, onTodoClick]);

  const rows = useMemo(() => {
    if (filtered.length === 0) return [];

    const nextRows: Array<
      { kind: "section"; label: string } | { kind: "item"; item: CommandItem }
    > = [];
    let currentSection: CommandItem["section"] | null = null;

    for (const item of filtered) {
      if (item.section !== currentSection) {
        currentSection = item.section;
        nextRows.push({ kind: "section", label: currentSection });
      }
      nextRows.push({ kind: "item", item });
    }

    return nextRows;
  }, [filtered]);

  const closePalette = useCallback(
    (restoreFocus: boolean) => {
      onClose();
      if (!restoreFocus) return;
      requestAnimationFrame(() => {
        restoreFocusRef.current?.focus({ preventScroll: true });
      });
    },
    [onClose],
  );

  useEffect(() => {
    if (!isOpen) return;

    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setQuery("");
    setActiveIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [isOpen]);

  useEffect(() => {
    setActiveIndex((index) =>
      Math.min(index, Math.max(0, filtered.length - 1)),
    );
  }, [filtered.length]);

  const execute = useCallback(
    (item: CommandItem) => {
      closePalette(false);
      requestAnimationFrame(() => item.action());
    },
    [closePalette],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (filtered.length === 0) {
        if (e.key === "Escape") onClose();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        if (filtered.length === 0) return;
        setActiveIndex((index) => (index + 1) % filtered.length);
        return;
      }

      if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        if (filtered.length === 0) return;
        setActiveIndex(
          (index) => (index - 1 + filtered.length) % filtered.length,
        );
        return;
      }

      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        if (filtered[activeIndex]) execute(filtered[activeIndex]);
        return;
      }

      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closePalette(true);
      }
    },
    [activeIndex, closePalette, execute, filtered],
  );

  if (!isOpen) return null;

  let flatIndex = 0;

  return (
    <div
      id="commandPaletteOverlay"
      className="command-palette-overlay command-palette-overlay--open"
      onClick={() => closePalette(true)}
      onKeyDown={onKeyDown}
    >
      <div
        ref={panelRef}
        className="command-palette"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        <input
          id="commandPaletteInput"
          ref={inputRef}
          className="command-palette__input"
          type="text"
          placeholder="Type a command…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div
          id="commandPaletteList"
          className="command-palette__list"
          role="listbox"
        >
          {filtered.length === 0 && (
            <div id="commandPaletteEmpty" className="command-palette__empty">
              <IllustrationNoResults />
              <p>No results</p>
            </div>
          )}
          {rows.map((row) => {
            if (row.kind === "section") {
              return (
                <div key={row.label} className="command-palette__group">
                  {row.label}
                </div>
              );
            }

            const index = flatIndex++;
            const isActive = index === activeIndex;

            return (
              <button
                key={row.item.id}
                type="button"
                id={`commandPaletteOption-${index}`}
                className={`command-palette__option${isActive ? " command-palette__option--active" : ""}`}
                role="option"
                aria-selected={isActive}
                onClick={() => execute(row.item)}
                onMouseEnter={() => setActiveIndex(index)}
              >
                <span className="command-palette__option-label">
                  {row.item.label}
                </span>
                {row.item.meta && (
                  <span className="command-palette__option-meta">
                    {row.item.meta}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
