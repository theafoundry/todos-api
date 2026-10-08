import { useMemo } from "react";
import type { Todo, Project, User } from "../../types";
import type { FocusBriefResponse } from "../../types/focusBrief";
import { MobileHeader } from "../MobileHeader";
import { CardCarousel } from "../components/CardCarousel";
import { SkeletonCard } from "../components/SkeletonCard";
import { RightNowPanel } from "../../components/home/RightNowPanel";
import { TodayAgendaPanel } from "../../components/home/TodayAgendaPanel";
import { PanelRenderer } from "../../components/home/PanelRenderer";
import type { ReactNode } from "react";
import { calendarDayOffset, deadlineDateValue } from "../utils/taskDates";
import {
  isTodayFocusTask,
  reconcileFocusBrief,
} from "../utils/reconcileFocusBrief";

interface Props {
  todos: Todo[];
  projects: Project[];
  user: User | null;
  onTodoClick: (id: string) => void;
  onToggleTodo: (id: string, completed: boolean) => void;
  onAvatarClick: () => void;
  onSearch?: () => void;
  onSelectProject?: (id: string) => void;
  pendingIds?: ReadonlySet<string>;
  brief: FocusBriefResponse | null;
  briefLoading: boolean;
  briefError: string | null;
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

const SKELETON_CARDS: ReactNode[] = [
  <SkeletonCard
    key="skel-flame"
    name="The Flame"
    subtitle="Your priorities right now"
    numeral="I"
    source="ai"
  />,
  <SkeletonCard
    key="skel-dawn"
    name="The Dawn"
    subtitle="Today's agenda"
    numeral="II"
    source="sys"
  />,
];

export function FocusScreen({
  todos,
  projects,
  user,
  onTodoClick,
  onToggleTodo,
  onAvatarClick,
  onSearch,
  onSelectProject,
  pendingIds,
  brief,
  briefLoading,
  briefError,
}: Props) {
  const openTodos = useMemo(
    () => todos.filter((t) => !t.completed && !t.archived),
    [todos],
  );
  const todayCount = useMemo(() => {
    return openTodos.filter((todo) => isTodayFocusTask(todo)).length;
  }, [openTodos]);
  const overdueCount = useMemo(() => {
    return openTodos.filter(
      (t) =>
        t.dueDate && (calendarDayOffset(deadlineDateValue(t.dueDate)) ?? 0) < 0,
    ).length;
  }, [openTodos]);

  const subtitle = `${todayCount} tasks today${overdueCount ? ` · ${overdueCount} overdue` : ""}`;

  const cards = useMemo(() => {
    if (!brief) return [];
    const liveBrief = reconcileFocusBrief(brief, todos, projects);
    const result: ReactNode[] = [];

    const priorities = liveBrief.pinned.rightNow;
    // RightNowPanel already returns null for this case; don't create an empty slide.
    if (
      priorities.narrative ||
      priorities.urgentItems.length > 0 ||
      priorities.topRecommendation
    ) {
      result.push(
        <RightNowPanel
          key="rightNow"
          data={priorities}
          provenance={liveBrief.pinned.rightNowProvenance}
          onTaskClick={onTodoClick}
        />,
      );
    }

    result.push(
      <TodayAgendaPanel
        key="todayAgenda"
        items={liveBrief.pinned.todayAgenda}
        provenance={liveBrief.pinned.todayAgendaProvenance}
        onTaskClick={onTodoClick}
        onToggle={onToggleTodo}
        pendingIds={pendingIds}
      />,
    );

    for (const panel of liveBrief.rankedPanels) {
      const node = (
        <PanelRenderer
          key={panel.type}
          panel={panel}
          onTaskClick={onTodoClick}
          onSelectProject={onSelectProject ?? (() => {})}
        />
      );
      result.push(node);
    }

    return result;
  }, [
    brief,
    todos,
    projects,
    onTodoClick,
    onToggleTodo,
    onSelectProject,
    pendingIds,
  ]);

  const showSkeleton = briefLoading && !brief;
  const generatedAt = brief ? new Date(brief.generatedAt) : null;

  return (
    <div className="m-screen m-screen--focus">
      <MobileHeader
        title={getGreeting()}
        subtitle={subtitle}
        user={user}
        onAvatarClick={onAvatarClick}
        onSearch={onSearch}
      />
      {generatedAt && !Number.isNaN(generatedAt.getTime()) && (
        <p className="m-focus__freshness">
          {brief?.cached || brief?.isStale ? "Cached brief" : "Brief"} as of{" "}
          {generatedAt.toLocaleString(undefined, {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}
          . Today’s agenda and task actions reflect your latest tasks.
        </p>
      )}
      {showSkeleton && <CardCarousel>{SKELETON_CARDS}</CardCarousel>}
      {briefError && !brief && (
        <div className="m-focus__error">
          <p>Failed to load focus brief.</p>
        </div>
      )}
      {cards.length > 0 && <CardCarousel>{cards}</CardCarousel>}
    </div>
  );
}
