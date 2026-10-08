import { useMemo } from "react";
import type { Todo, Project, User } from "../../types";
import type { WorkspaceView } from "../../components/projects/Sidebar";
import { MobileHeader } from "../MobileHeader";
import { SwipeRow } from "../components/SwipeRow";
import { CUSTOM_TAB_OPTIONS } from "../hooks/useTabBar";
import {
  GenerativePattern,
  hashSeed,
} from "../../components/GenerativePattern";
import { calendarDayOffset, deadlineDateValue } from "../utils/taskDates";
import "../date-actions.css";

function getEmptyMessage(view: WorkspaceView): string {
  switch (view) {
    case "horizon":
      return "No upcoming tasks on the horizon";
    case "completed":
      return "No completed tasks yet";
    case "all":
      return "No tasks at all";
    default:
      return "Nothing here. Nice work!";
  }
}

interface Props {
  view: WorkspaceView;
  todos: Todo[];
  projects: Project[];
  user: User | null;
  onTodoClick: (id: string) => void;
  onToggleTodo: (id: string, completed: boolean) => void | Promise<boolean>;
  pendingIds?: ReadonlySet<string>;
  onAvatarClick: () => void;
  onSearch?: () => void;
  onSnoozeTodo: (id: string) => void;
}

function filterForView(todos: Todo[], view: WorkspaceView): Todo[] {
  switch (view) {
    case "horizon":
      return todos
        .filter((t) => {
          const date =
            t.scheduledDate ??
            (t.dueDate ? deadlineDateValue(t.dueDate) : null);
          const days = date ? calendarDayOffset(date) : null;
          return !t.completed && !t.archived && days !== null && days > 0;
        })
        .sort(
          (a, b) =>
            new Date(a.scheduledDate ?? a.dueDate!).getTime() -
            new Date(b.scheduledDate ?? b.dueDate!).getTime(),
        );
    case "all":
      return todos.filter((t) => !t.archived);
    case "completed":
      return todos
        .filter((t) => t.completed && !t.archived)
        .sort(
          (a, b) =>
            new Date(b.completedAt ?? b.updatedAt).getTime() -
            new Date(a.completedAt ?? a.updatedAt).getTime(),
        );
    default:
      return todos.filter((t) => !t.completed && !t.archived);
  }
}

export function CustomScreen({
  view,
  todos,
  projects,
  user,
  onTodoClick,
  onToggleTodo,
  onAvatarClick,
  onSearch,
  onSnoozeTodo,
  pendingIds,
}: Props) {
  const label =
    CUSTOM_TAB_OPTIONS.find((o) => o.key === view)?.label ?? "Tasks";
  const filteredTodos = useMemo(
    () => filterForView(todos, view),
    [todos, view],
  );
  const projectMap = useMemo(() => {
    const m = new Map<string, Project>();
    projects.forEach((p) => m.set(p.id, p));
    return m;
  }, [projects]);

  return (
    <div className="m-screen m-screen--custom">
      <MobileHeader
        title={label}
        user={user}
        onAvatarClick={onAvatarClick}
        onSearch={onSearch}
      />
      <div className="m-custom__content">
        <div className="m-today__pull-hint">
          Pull down to refresh · Swipe a task for actions
        </div>
        <div className="m-custom__list">
          {filteredTodos.map((t) => (
            <SwipeRow
              key={t.id}
              rightLabel={t.completed ? "Reopen" : "Complete"}
              onSwipeRight={() => onToggleTodo(t.id, !t.completed)}
              onSwipeLeft={() => onSnoozeTodo(t.id)}
            >
              <div
                className="m-todo-row m-todo-row--actions"
                aria-busy={pendingIds?.has(t.id)}
              >
                <button
                  type="button"
                  className="m-todo-row__toggle"
                  disabled={pendingIds?.has(t.id)}
                  aria-label={`${t.completed ? "Reopen" : "Complete"} ${t.title}`}
                  onClick={() => onToggleTodo(t.id, !t.completed)}
                >
                  <span
                    aria-hidden="true"
                    className={`m-todo-row__check${t.completed ? " m-todo-row__check--done" : ""}`}
                  />
                </button>
                <button
                  type="button"
                  className="m-todo-row__open"
                  disabled={pendingIds?.has(t.id)}
                  onClick={() => onTodoClick(t.id)}
                >
                  <div className="m-todo-row__title">{t.title}</div>
                  <div className="m-todo-row__meta">
                    {pendingIds?.has(t.id) && <span>Saving… </span>}
                    {t.projectId && projectMap.get(t.projectId)?.name}
                    {t.priority && (
                      <>
                        {" "}
                        ·{" "}
                        <span className={`m-priority--${t.priority}`}>
                          {t.priority}
                        </span>
                      </>
                    )}
                  </div>
                </button>
              </div>
            </SwipeRow>
          ))}
          {filteredTodos.length === 0 && (
            <div className="m-empty">
              <GenerativePattern
                mode="arcRivers"
                seed={hashSeed("custom")}
                color="#D85A30"
                background="transparent"
                opacity={0.18}
                density={35}
                width={200}
                height={120}
                className="m-empty__pattern"
              />
              <div className="m-empty__title">{getEmptyMessage(view)}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
