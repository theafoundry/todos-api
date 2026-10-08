import { useMemo } from "react";
import type { Todo, Project, User } from "../../types";
import { MobileHeader } from "../MobileHeader";
import { SwipeRow } from "../components/SwipeRow";
import {
  GenerativePattern,
  hashSeed,
} from "../../components/GenerativePattern";
import { calendarDayOffset, deadlineDateValue } from "../utils/taskDates";
import "../date-actions.css";

interface Props {
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

function formatDate(): string {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function TodoRowInner({
  todo,
  project,
  onClick,
  onToggle,
  pending = false,
}: {
  todo: Todo;
  project?: Project;
  onClick: () => void;
  onToggle: () => void;
  pending?: boolean;
}) {
  return (
    <div className="m-todo-row m-todo-row--actions" aria-busy={pending}>
      <button
        type="button"
        className="m-todo-row__toggle"
        disabled={pending}
        aria-label={`${todo.completed ? "Reopen" : "Complete"} ${todo.title}`}
        onClick={onToggle}
      >
        <span
          aria-hidden="true"
          className={`m-todo-row__check${todo.completed ? " m-todo-row__check--done" : ""}`}
        />
      </button>
      <button
        type="button"
        className="m-todo-row__open"
        disabled={pending}
        onClick={onClick}
      >
        <div className="m-todo-row__title">{todo.title}</div>
        <div className="m-todo-row__meta">
          {pending && <span>Saving… </span>}
          {project?.name}
          {todo.priority && (
            <>
              {" "}
              ·{" "}
              <span className={`m-priority--${todo.priority}`}>
                {todo.priority}
              </span>
            </>
          )}
        </div>
      </button>
    </div>
  );
}

export function TodayScreen({
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
  const openTodos = useMemo(
    () => todos.filter((t) => !t.completed && !t.archived),
    [todos],
  );
  const projectMap = useMemo(() => {
    const m = new Map<string, Project>();
    projects.forEach((p) => m.set(p.id, p));
    return m;
  }, [projects]);

  const groups = useMemo(() => {
    const overdue: Todo[] = [];
    const dueToday: Todo[] = [];
    const plannedToday: Todo[] = [];
    const plannedEarlier: Todo[] = [];
    const ready: Todo[] = [];
    const scheduled: Todo[] = [];
    for (const t of openTodos) {
      const dueDays = t.dueDate
        ? calendarDayOffset(deadlineDateValue(t.dueDate))
        : null;
      const plannedDays = t.scheduledDate
        ? calendarDayOffset(t.scheduledDate)
        : null;
      if (dueDays !== null && dueDays < 0) overdue.push(t);
      else if (dueDays === 0) dueToday.push(t);
      else if (plannedDays === 0) plannedToday.push(t);
      else if (plannedDays !== null && plannedDays < 0) plannedEarlier.push(t);
      else if (
        (plannedDays !== null && plannedDays > 0) ||
        (dueDays !== null && dueDays > 0)
      )
        scheduled.push(t);
      else if (t.status === "next" || t.status === "in_progress") {
        ready.push(t);
      }
    }
    return {
      overdue,
      dueToday,
      plannedToday,
      plannedEarlier,
      ready,
      scheduled,
    };
  }, [openTodos]);

  const renderGroup = (label: string, items: Todo[], className?: string) => {
    if (items.length === 0) return null;
    return (
      <section className="m-today__group">
        <h2
          className={`m-today__group-title${className ? ` ${className}` : ""}`}
        >
          {label}
        </h2>
        <div className="m-today__group-list">
          {items.map((t) => (
            <SwipeRow
              key={t.id}
              onSwipeRight={() => onToggleTodo(t.id, true)}
              onSwipeLeft={() => onSnoozeTodo(t.id)}
            >
              <TodoRowInner
                todo={t}
                pending={pendingIds?.has(t.id)}
                project={t.projectId ? projectMap.get(t.projectId) : undefined}
                onClick={() => onTodoClick(t.id)}
                onToggle={() => onToggleTodo(t.id, !t.completed)}
              />
            </SwipeRow>
          ))}
        </div>
      </section>
    );
  };

  return (
    <div className="m-screen m-screen--today">
      <MobileHeader
        title="Today"
        subtitle={formatDate()}
        user={user}
        onAvatarClick={onAvatarClick}
        onSearch={onSearch}
      />
      <div className="m-today__content">
        <div className="m-today__pull-hint">
          Pull down to refresh · Swipe a task for actions
        </div>
        {renderGroup(
          "Overdue",
          groups.overdue,
          "m-today__group-title--overdue",
        )}
        {renderGroup("Due Today", groups.dueToday)}
        {renderGroup("Planned today", groups.plannedToday)}
        {renderGroup("Planned earlier", groups.plannedEarlier)}
        {renderGroup("Ready to start", groups.ready)}
        {renderGroup("Scheduled", groups.scheduled)}
        {Object.values(groups).every((items) => items.length === 0) && (
          <div className="m-empty">
            <GenerativePattern
              mode="flowField"
              seed={hashSeed("today")}
              color="#D85A30"
              background="transparent"
              opacity={0.18}
              density={35}
              width={200}
              height={120}
              className="m-empty__pattern"
            />
            <div className="m-empty__title">
              Nothing due today. Enjoy your day!
            </div>
            <div className="m-empty__hint">
              Tasks planned or due today will appear here
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
