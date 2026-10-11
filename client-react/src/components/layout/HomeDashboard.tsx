import { useState } from "react";
import type { Todo, Project } from "../../types";
import { useFocusBrief } from "../../hooks/useFocusBrief";
import { RightNowPanel } from "../home/RightNowPanel";
import { TodayAgendaPanel } from "../home/TodayAgendaPanel";
import { PanelRenderer } from "../home/PanelRenderer";
import { ViewState } from "./ViewState";
import { Skeleton } from "../shared/Skeleton";

interface Props {
  todos?: Todo[];
  projects?: Project[];
  onTodoClick: (id: string) => void;
  onToggleTodo: (id: string, completed: boolean) => void;
  onEditTodo?: (id: string, updates: Record<string, unknown>) => void;
  onNavigate?: (view: "today" | "horizon" | "all") => void;
  onSelectProject: (id: string) => void;
  onUndo?: (action: { message: string; onUndo: () => void }) => void;
}

export function HomeDashboard({
  onTodoClick,
  onToggleTodo,
  onSelectProject,
  onEditTodo,
  onNavigate,
}: Props) {
  const { brief, loading, error, refreshing, unavailable } = useFocusBrief();
  const [showMore, setShowMore] = useState(false);

  if (loading && !brief) {
    return (
      <div className="home-dashboard">
        <ViewState
          loading
          loadingContent={
            <Skeleton variant="panel" aria-label="Loading focus brief" />
          }
        />
      </div>
    );
  }

  if (!brief) {
    if (unavailable) {
      return (
        <div className="home-dashboard">
          <ViewState
            empty
            emptyContent={
              <div>
                <h2>Your tasks are ready</h2>
                <p>
                  Hosted AI is currently unavailable. Review Inbox, choose tasks
                  for Today, and plan a realistic day.
                </p>
                {onNavigate && (
                  <>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => onNavigate("today")}
                    >
                      Open Today
                    </button>{" "}
                    <button
                      type="button"
                      className="btn"
                      onClick={() => onNavigate("all")}
                    >
                      Open Tasks
                    </button>
                  </>
                )}
              </div>
            }
          />
        </div>
      );
    }
    return (
      <div className="home-dashboard">
        <ViewState error={error ?? "Failed to load focus brief."} />
      </div>
    );
  }

  return (
    <div data-testid="home-dashboard" className="home-dashboard">
      <div className="home-dashboard__pinned">
        <RightNowPanel
          data={brief.pinned.rightNow}
          provenance={brief.pinned.rightNowProvenance}
          onTaskClick={onTodoClick}
        />
        <TodayAgendaPanel
          items={brief.pinned.todayAgenda}
          provenance={brief.pinned.todayAgendaProvenance}
          onTaskClick={onTodoClick}
          onToggle={onToggleTodo}
        />
      </div>

      {brief.rankedPanels.length > 0 && (
        <>
          <div className="focus-divider">Surfaced for you</div>
          <div className="home-dashboard__ranked">
            {brief.rankedPanels.slice(0, 3).map((panel) => (
              <PanelRenderer
                key={panel.type}
                panel={panel}
                onTaskClick={onTodoClick}
                onSelectProject={onSelectProject}
                onEditTodo={onEditTodo}
              />
            ))}
            {showMore &&
              brief.rankedPanels
                .slice(3)
                .map((panel) => (
                  <PanelRenderer
                    key={panel.type}
                    panel={panel}
                    onTaskClick={onTodoClick}
                    onSelectProject={onSelectProject}
                    onEditTodo={onEditTodo}
                  />
                ))}
          </div>
          {brief.rankedPanels.length > 3 && (
            <button
              className="focus-disclosure"
              onClick={() => setShowMore((s) => !s)}
            >
              {showMore
                ? "Show less ▴"
                : `Show ${brief.rankedPanels.length - 3} more panels ▾`}
            </button>
          )}
        </>
      )}

      {(brief.isStale || refreshing) && (
        <p className="focus-panel__empty">Refreshing in background...</p>
      )}
    </div>
  );
}
