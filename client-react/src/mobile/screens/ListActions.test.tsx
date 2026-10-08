// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { Todo, Project } from "../../types";
import { CustomScreen } from "./CustomScreen";
import { ProjectsScreen } from "./ProjectsScreen";

const timestamp = "2026-10-07T12:00:00.000Z";
const task: Todo = {
  id: "t1",
  title: "My task",
  description: null,
  notes: null,
  status: "next",
  completed: false,
  completedAt: null,
  projectId: "p1",
  category: null,
  headingId: null,
  tags: [],
  context: null,
  energy: null,
  dueDate: null,
  startDate: null,
  scheduledDate: null,
  reviewDate: null,
  doDate: null,
  estimateMinutes: null,
  waitingOn: null,
  dependsOnTaskIds: [],
  order: 0,
  priority: null,
  archived: false,
  recurrence: null,
  source: null,
  effortScore: null,
  userId: "u1",
  createdAt: timestamp,
  updatedAt: timestamp,
};
const project: Project = {
  id: "p1",
  name: "My project",
  status: "active",
  archived: false,
  userId: "u1",
  createdAt: timestamp,
  updatedAt: timestamp,
};
const props = {
  todos: [task],
  projects: [project],
  user: null,
  onTodoClick: vi.fn(),
  onToggleTodo: vi.fn(),
  onAvatarClick: vi.fn(),
  onSnoozeTodo: vi.fn(),
};

describe("mobile list actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 7, 12));
  });
  afterEach(() => vi.useRealTimers());

  it("exposes separate named complete and details buttons in Everything", () => {
    const { container } = render(<CustomScreen {...props} view="all" />);
    fireEvent.click(screen.getByRole("button", { name: "Complete My task" }));
    expect(props.onToggleTodo).toHaveBeenCalledWith("t1", true);
    expect(props.onTodoClick).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /^My task/ }));
    expect(props.onTodoClick).toHaveBeenCalledWith("t1");
    expect(container.querySelector("button button")).toBeNull();
  });

  it("names the completed-row action Reopen", () => {
    render(
      <CustomScreen
        {...props}
        view="completed"
        todos={[{ ...task, completed: true }]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Reopen My task" }));
    expect(props.onToggleTodo).toHaveBeenCalledWith("t1", false);
  });

  it("includes future planned tasks in Horizon and uses their local calendar day", () => {
    render(
      <CustomScreen
        {...props}
        view="horizon"
        todos={[
          {
            ...task,
            id: "today",
            title: "Tonight",
            scheduledDate: new Date(2026, 9, 7, 23, 45).toISOString(),
          },
          {
            ...task,
            id: "future",
            title: "Tomorrow",
            scheduledDate: new Date(2026, 9, 8, 0, 15).toISOString(),
          },
          {
            ...task,
            id: "due",
            title: "Future deadline",
            dueDate: "2026-10-09T00:00:00.000Z",
          },
        ]}
      />,
    );
    expect(screen.queryByText("Tonight")).toBeNull();
    expect(screen.getByText("Tomorrow")).toBeTruthy();
    expect(screen.getByText("Future deadline")).toBeTruthy();
  });

  it("exposes a separate completion button inside a project", () => {
    const { container } = render(<ProjectsScreen {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /My project/ }));
    fireEvent.click(screen.getByRole("button", { name: "Complete My task" }));
    expect(props.onToggleTodo).toHaveBeenCalledWith("t1", true);
    expect(props.onTodoClick).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "My task" }));
    expect(props.onTodoClick).toHaveBeenCalledWith("t1");
    expect(container.querySelector("button button")).toBeNull();
  });
});
