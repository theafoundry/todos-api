import { render, screen, fireEvent } from "@testing-library/react";
import { afterEach, describe, it, expect, vi } from "vitest";
import { FocusScreen } from "./FocusScreen";
import type { Todo } from "../../types";
import type { FocusBriefResponse } from "../../types/focusBrief";

vi.mock("../../components/home/RightNowPanel", () => ({
  RightNowPanel: () => <p>Priorities</p>,
}));
vi.mock("../../components/home/TodayAgendaPanel", () => ({
  TodayAgendaPanel: () => <p>Agenda</p>,
}));
vi.mock("../../components/home/PanelRenderer", () => ({
  PanelRenderer: ({
    onSelectProject,
  }: {
    onSelectProject: (id: string) => void;
  }) => <button onClick={() => onSelectProject("p1")}>Nudge project</button>,
}));

const todo = (id: string, dates: Partial<Todo> = {}): Todo =>
  ({
    id,
    title: id,
    completed: false,
    archived: false,
    dueDate: null,
    scheduledDate: null,
    ...dates,
  }) as Todo;
const brief: FocusBriefResponse = {
  pinned: {
    rightNow: {
      narrative: "Priorities",
      urgentItems: [],
      topRecommendation: null,
    },
    todayAgenda: [],
    rightNowProvenance: { source: "deterministic" },
    todayAgendaProvenance: { source: "deterministic" },
  },
  rankedPanels: [
    {
      type: "projectsToNudge",
      reason: "Project needs attention",
      data: {
        type: "projectsToNudge",
        items: [
          {
            id: "p1",
            name: "Project",
            overdueCount: 1,
            waitingCount: 0,
            dueSoonCount: 0,
          },
        ],
      },
      provenance: { source: "deterministic" },
    },
  ],
  generatedAt: "2026-10-07T12:00:00Z",
  expiresAt: "2026-10-07T13:00:00Z",
  cached: false,
  isStale: false,
};
const props = () => ({
  todos: [] as Todo[],
  projects: [],
  user: null,
  onTodoClick: vi.fn(),
  onToggleTodo: vi.fn(),
  onAvatarClick: vi.fn(),
  onSelectProject: vi.fn(),
  brief: null,
  briefLoading: false,
  briefError: null,
});
afterEach(() => vi.useRealTimers());

describe("FocusScreen", () => {
  it("counts local planned tasks and whole-day deadlines consistently, excluding closed tasks", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 7, 12));
    render(
      <FocusScreen
        {...props()}
        todos={[
          todo("today", {
            dueDate: new Date(2026, 9, 7, 23, 59).toISOString(),
          }),
          todo("planned", {
            scheduledDate: new Date(2026, 9, 7, 9).toISOString(),
          }),
          todo("overdue", { dueDate: "2026-10-06T00:00:00.000Z" }),
          todo("future", { dueDate: "2026-10-08T00:00:00.000Z" }),
          todo("closed", { dueDate: "2026-10-06", completed: true }),
          todo("archived", { dueDate: "2026-10-06", archived: true }),
        ]}
      />,
    );
    expect(screen.getByText("3 tasks today · 1 overdue")).toBeInTheDocument();
  });

  it("forwards project selection from a ranked card rather than silently ignoring it", () => {
    const callbacks = props();
    render(<FocusScreen {...callbacks} brief={brief} />);
    fireEvent.click(screen.getByRole("button", { name: "Card 3 of 3" }));
    fireEvent.click(screen.getByRole("button", { name: "Nudge project" }));
    expect(callbacks.onSelectProject).toHaveBeenCalledWith("p1");
  });

  it("starts on Dawn when the priority panel has no renderable content", () => {
    const emptyPriorities = {
      ...brief,
      pinned: {
        ...brief.pinned,
        rightNow: { narrative: "", urgentItems: [], topRecommendation: null },
      },
      rankedPanels: [],
    };
    render(<FocusScreen {...props()} brief={emptyPriorities} />);
    expect(screen.getByText("Agenda")).toBeInTheDocument();
    expect(screen.queryByText("Priorities")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Card 1 of 1");
    expect(screen.queryByRole("button", { name: "Next card" })).toBeNull();
  });
});
