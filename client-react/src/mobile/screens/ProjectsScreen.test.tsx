// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Project, Todo } from "../../types";
import { ProjectsScreen } from "./ProjectsScreen";

const iso = "2026-10-08T12:00:00.000Z";
const project: Project = {
  id: "project-1",
  name: "Work",
  status: "active",
  archived: false,
  userId: "user-1",
  createdAt: iso,
  updatedAt: iso,
  openTodoCount: 1,
  todoCount: 2,
};
const todo: Todo = {
  id: "task-1",
  title: "A long project task title",
  description: null,
  notes: null,
  status: "next",
  completed: false,
  completedAt: null,
  projectId: "project-1",
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
  priority: "medium",
  archived: false,
  recurrence: null,
  source: null,
  effortScore: null,
  userId: "user-1",
  createdAt: iso,
  updatedAt: iso,
};
function props() {
  return {
    projects: [project],
    todos: [todo],
    user: null,
    onTodoClick: vi.fn(),
    onToggleTodo: vi.fn(),
    onAvatarClick: vi.fn(),
    onSnoozeTodo: vi.fn(),
  };
}

describe("ProjectsScreen", () => {
  it("supports controlled project selection and Back without a competing local route", () => {
    const defaults = props();
    const onSelectProject = vi.fn();
    const onBack = vi.fn();
    const { rerender } = render(
      <ProjectsScreen
        {...defaults}
        selectedProjectId={null}
        onSelectProject={onSelectProject}
        onBack={onBack}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Work 1 open/ }));
    expect(onSelectProject).toHaveBeenCalledWith("project-1");
    expect(screen.queryByText(todo.title)).toBeNull();
    rerender(
      <ProjectsScreen
        {...defaults}
        selectedProjectId="project-1"
        onSelectProject={onSelectProject}
        onBack={onBack}
      />,
    );
    expect(screen.getByRole("heading", { name: "Work" })).toBeTruthy();
    expect(screen.getByText(todo.title)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "← Back" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("derives selected project details from fresh data instead of retaining an old object", () => {
    const defaults = props();
    const { rerender } = render(
      <ProjectsScreen {...defaults} selectedProjectId="project-1" />,
    );
    rerender(
      <ProjectsScreen
        {...defaults}
        projects={[{ ...project, name: "Updated project" }]}
        selectedProjectId="project-1"
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Updated project" }),
    ).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Work" })).toBeNull();
  });

  it("keeps completion and details as separate controls", () => {
    const defaults = props();
    const { container } = render(
      <ProjectsScreen {...defaults} selectedProjectId="project-1" />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: `Complete ${todo.title}` }),
    );
    expect(defaults.onToggleTodo).toHaveBeenCalledWith(todo.id, true);
    expect(defaults.onTodoClick).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: /A long project task title medium/ }),
    );
    expect(defaults.onTodoClick).toHaveBeenCalledWith(todo.id);
    expect(container.querySelector("button button")).toBeNull();
  });

  it("disables actions and exposes pending feedback for the task being saved", () => {
    const defaults = props();
    const { container } = render(
      <ProjectsScreen
        {...defaults}
        selectedProjectId="project-1"
        pendingIds={new Set([todo.id])}
      />,
    );
    const complete = screen.getByRole("button", {
      name: `Complete ${todo.title}`,
    });
    const open = screen.getByRole("button", {
      name: /A long project task title Saving/,
    });
    expect(complete).toBeDisabled();
    expect(open).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Saving…");
    expect(container.querySelector(".m-todo-row")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    fireEvent.click(complete);
    fireEvent.click(open);
    expect(defaults.onToggleTodo).not.toHaveBeenCalled();
    expect(defaults.onTodoClick).not.toHaveBeenCalled();
  });
});
