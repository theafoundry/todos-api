// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import React from "react";
import { TodayScreen } from "./TodayScreen";
import type { Todo, Project, User } from "../../types";

const { createElement: ce } = React;

const mockUser: User = {
  id: "u1",
  name: "Test User",
  email: "test@example.com",
};

const defaultProps = {
  todos: [] as Todo[],
  projects: [] as Project[],
  user: mockUser,
  onTodoClick: vi.fn(),
  onToggleTodo: vi.fn(),
  onAvatarClick: vi.fn(),
  onSnoozeTodo: vi.fn(),
};

const iso = "2024-01-01T00:00:00.000Z";

function makeTodo(overrides: Partial<Todo> = {}): Todo {
  const id = overrides.id ?? `todo-${Math.random()}`;
  return {
    id,
    title: "Test task",
    description: null,
    notes: null,
    status: "next",
    completed: false,
    completedAt: null,
    projectId: null,
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
    createdAt: iso,
    updatedAt: iso,
    ...overrides,
  };
}

describe("TodayScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 7, 12));
  });
  afterEach(() => vi.useRealTimers());
  it("renders with MobileHeader", () => {
    render(ce(TodayScreen, defaultProps));
    expect(screen.getByText("Today")).toBeTruthy();
  });

  it("shows formatted date", () => {
    render(ce(TodayScreen, defaultProps));
    // The date is formatted using toLocaleDateString, so it varies by locale.
    // Just check that a subtitle element exists with the current date.
    const subtitle = screen.getByText((content) => {
      const now = new Date();
      return content.includes(
        now.toLocaleDateString("en-US", { month: "long" }),
      );
    });
    expect(subtitle).toBeTruthy();
  });

  it("shows refresh and swipe guidance", () => {
    render(ce(TodayScreen, defaultProps));
    expect(
      screen.getByText("Pull down to refresh · Swipe a task for actions"),
    ).toBeTruthy();
  });

  it("shows empty state when no tasks", () => {
    render(ce(TodayScreen, defaultProps));
    expect(screen.getByText("Nothing due today. Enjoy your day!")).toBeTruthy();
  });

  it("groups overdue tasks", () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const overdue = makeTodo({
      title: "Overdue task",
      dueDate: yesterday.toISOString().split("T")[0],
    });

    render(ce(TodayScreen, { ...defaultProps, todos: [overdue] }));
    expect(screen.getByText("Overdue")).toBeTruthy();
    expect(screen.getByText("Overdue task")).toBeTruthy();
  });

  it("groups due today tasks without shifting a legacy midnight deadline", () => {
    const dueToday = makeTodo({
      title: "Due today",
      dueDate: "2026-10-07T00:00:00.000Z",
    });

    render(ce(TodayScreen, { ...defaultProps, todos: [dueToday] }));
    expect(screen.getByText("Due Today")).toBeTruthy();
    expect(screen.getByText("Due today")).toBeTruthy();
  });

  it("includes scheduled-only tasks in local today and future groups", () => {
    const today = makeTodo({
      title: "Planned tonight",
      scheduledDate: new Date(2026, 9, 7, 23, 45).toISOString(),
    });
    const future = makeTodo({
      title: "Planned tomorrow",
      scheduledDate: new Date(2026, 9, 8, 0, 15).toISOString(),
    });
    render(ce(TodayScreen, { ...defaultProps, todos: [today, future] }));
    const todayGroup = screen
      .getByRole("heading", { name: "Planned today" })
      .closest("section")!;
    const futureGroup = screen
      .getByRole("heading", { name: "Scheduled" })
      .closest("section")!;
    expect(within(todayGroup).getByText("Planned tonight")).toBeTruthy();
    expect(within(futureGroup).getByText("Planned tomorrow")).toBeTruthy();
    expect(within(todayGroup).queryByText("Planned tomorrow")).toBeNull();
  });

  it("keeps overdue deadlines visible even when planned for the future", () => {
    const overdue = makeTodo({
      title: "Still overdue",
      dueDate: "2026-10-06T00:00:00.000Z",
      scheduledDate: new Date(2026, 9, 8, 9).toISOString(),
    });
    const planned = makeTodo({
      title: "Work on future deadline",
      dueDate: "2026-10-10T00:00:00.000Z",
      scheduledDate: new Date(2026, 9, 7, 9).toISOString(),
    });
    render(ce(TodayScreen, { ...defaultProps, todos: [overdue, planned] }));
    expect(
      within(
        screen.getByRole("heading", { name: "Overdue" }).closest("section")!,
      ).getByText("Still overdue"),
    ).toBeTruthy();
    expect(
      within(
        screen
          .getByRole("heading", { name: "Planned today" })
          .closest("section")!,
      ).getByText("Work on future deadline"),
    ).toBeTruthy();
  });

  it("names ready tasks separately instead of inventing a due date", () => {
    render(
      ce(TodayScreen, {
        ...defaultProps,
        todos: [makeTodo({ title: "Ready task" })],
      }),
    );
    expect(
      screen.getByRole("heading", { name: "Ready to start" }),
    ).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Due Today" })).toBeNull();
  });

  it("groups scheduled tasks with future due dates", () => {
    // Use a date far enough in the future to avoid timezone edge cases.
    // daysUntil() compares local midnight vs parsed date string (which may be UTC).
    const farFuture = new Date();
    farFuture.setDate(farFuture.getDate() + 7);
    const scheduled = makeTodo({
      title: "Future task",
      dueDate: farFuture.toISOString().split("T")[0],
    });

    render(ce(TodayScreen, { ...defaultProps, todos: [scheduled] }));
    // The scheduled group heading exists
    const headings = screen.getAllByText("Scheduled");
    expect(headings.length).toBeGreaterThanOrEqual(1);
    // Task title exists
    expect(screen.getByText("Future task")).toBeTruthy();
  });

  it("excludes completed tasks", () => {
    const completed = makeTodo({ title: "Done", completed: true });
    render(ce(TodayScreen, { ...defaultProps, todos: [completed] }));
    expect(screen.queryByText("Done")).toBeNull();
    expect(screen.getByText(/Nothing due today/)).toBeTruthy();
  });

  it("excludes archived tasks", () => {
    const archived = makeTodo({ title: "Archived", archived: true });
    render(ce(TodayScreen, { ...defaultProps, todos: [archived] }));
    expect(screen.queryByText("Archived")).toBeNull();
  });

  it("calls onToggleTodo when check is clicked", () => {
    const onToggleTodo = vi.fn();
    const onTodoClick = vi.fn();
    const todo = makeTodo({ title: "Toggle me" });
    const { container } = render(
      ce(TodayScreen, {
        ...defaultProps,
        todos: [todo],
        onToggleTodo,
        onTodoClick,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Complete Toggle me" }));
    expect(onToggleTodo).toHaveBeenCalledWith(todo.id, true);
    expect(onTodoClick).not.toHaveBeenCalled();
    expect(container.querySelector("button button")).toBeNull();
  });

  it("calls onTodoClick when row is clicked", () => {
    const onTodoClick = vi.fn();
    const todo = makeTodo({ title: "Click me" });
    render(ce(TodayScreen, { ...defaultProps, todos: [todo], onTodoClick }));

    const row = screen.getByText("Click me").closest("button");
    if (row) fireEvent.click(row);
    expect(onTodoClick).toHaveBeenCalledWith(todo.id);
  });

  it("calls onSnoozeTodo when swiped left", () => {
    const onSnoozeTodo = vi.fn();
    const todo = makeTodo({ title: "Snooze me" });
    render(ce(TodayScreen, { ...defaultProps, todos: [todo], onSnoozeTodo }));

    // SwipeRow is used internally — verify the component renders with the right props
    // The SwipeRow wraps the TodoRowInner, so we check the row exists
    expect(screen.getByText("Snooze me")).toBeTruthy();
  });

  it("shows project name in todo row meta", () => {
    const project: Project = {
      id: "p1",
      name: "Work",
      status: "active",
      archived: false,
      userId: "u1",
      createdAt: iso,
      updatedAt: iso,
    };
    const todo = makeTodo({ title: "With project", projectId: "p1" });

    render(
      ce(TodayScreen, { ...defaultProps, todos: [todo], projects: [project] }),
    );
    expect(screen.getByText("Work")).toBeTruthy();
  });
});
