// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { CommandPalette } from "./CommandPalette";
import type { Project, Todo } from "../../types";

// Mock Illustrations
vi.mock("./Illustrations", () => ({
  IllustrationNoResults: () =>
    createElement("div", { "data-testid": "no-results" }),
}));

// Mock useOverlayFocusTrap
vi.mock("./useOverlayFocusTrap", () => ({
  useOverlayFocusTrap: vi.fn(),
}));

const mockProjects: Project[] = [
  {
    id: "p1",
    name: "Work",
    status: "active",
    archived: false,
    userId: "u1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "p2",
    name: "Personal",
    status: "active",
    archived: false,
    userId: "u1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "p3",
    name: "Archived",
    status: "active",
    archived: true,
    userId: "u1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
];

const mockTodos: Todo[] = [
  {
    id: "t1",
    title: "Call dentist",
    description: "Book annual checkup",
    status: "next",
    completed: false,
    tags: [],
    category: "health",
    userId: "u1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    completedAt: null,
    projectId: null,
    headingId: null,
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
    firstStep: null,
    emotionalState: null,
    effortScore: null,
    source: null,
    recurrence: null,
    subtasks: undefined,
  },
  {
    id: "t2",
    title: "Buy groceries",
    description: "Milk, eggs, bread",
    status: "next",
    completed: false,
    tags: [],
    category: "errands",
    userId: "u1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    completedAt: null,
    projectId: null,
    headingId: null,
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
    order: 1,
    priority: null,
    archived: false,
    firstStep: null,
    emotionalState: null,
    effortScore: null,
    source: null,
    recurrence: null,
    subtasks: undefined,
  },
];

const defaultCommandProps = {
  isOpen: true,
  onClose: vi.fn(),
  onNavigate: vi.fn(),
  onNavigateHorizonSegment: vi.fn(),
  onWeeklyReview: vi.fn(),
  onToggleDarkMode: vi.fn(),
  onOpenSettings: vi.fn(),
  onOpenFeedback: vi.fn(),
  onOpenShortcuts: vi.fn(),
  onNewTask: vi.fn(),
  onFocusSearch: vi.fn(),
  onExportCalendar: vi.fn(),
  onLogout: vi.fn(),
  projects: mockProjects,
  todos: mockTodos,
  onTodoClick: vi.fn(),
  onProjectOpen: vi.fn(),
};

describe("CommandPalette", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing when not open", () => {
    render(
      createElement(CommandPalette, { ...defaultCommandProps, isOpen: false }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders the command palette dialog when open", () => {
    render(createElement(CommandPalette, defaultCommandProps));
    expect(
      screen.getByRole("dialog", { name: "Command palette" }),
    ).toBeTruthy();
  });

  it("renders the search input", () => {
    render(createElement(CommandPalette, defaultCommandProps));
    expect(screen.getByPlaceholderText("Type a command…")).toBeTruthy();
  });

  it("shows commands by default when query is empty", () => {
    render(createElement(CommandPalette, defaultCommandProps));
    expect(screen.getByText("Create Task")).toBeTruthy();
    expect(screen.getByText("Go to Focus")).toBeTruthy();
    expect(screen.getByText("Go to Today")).toBeTruthy();
    expect(screen.getByText("Go to Tasks")).toBeTruthy();
  });

  it("filters commands by query matching label", () => {
    render(createElement(CommandPalette, defaultCommandProps));
    const input = screen.getByPlaceholderText(
      "Type a command…",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "dark" } });
    expect(screen.getByText("Toggle Dark Mode")).toBeTruthy();
    expect(screen.queryByText("Create Task")).toBeNull();
  });

  it("filters commands by query matching keywords", () => {
    render(createElement(CommandPalette, defaultCommandProps));
    const input = screen.getByPlaceholderText(
      "Type a command…",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "bug" } });
    expect(screen.getByText("Go to Feedback")).toBeTruthy();
  });

  it("shows section headers for filtered results", () => {
    render(createElement(CommandPalette, defaultCommandProps));
    expect(screen.getByText("Commands")).toBeTruthy();
  });

  it("shows task matches when query matches todo titles", () => {
    render(createElement(CommandPalette, defaultCommandProps));
    const input = screen.getByPlaceholderText(
      "Type a command…",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "dentist" } });
    expect(screen.getByText("Call dentist")).toBeTruthy();
    expect(screen.getByText("Tasks")).toBeTruthy();
  });

  it("shows task meta with category and status", () => {
    render(
      createElement(CommandPalette, {
        ...defaultCommandProps,
        todos: [{ ...mockTodos[0], status: "waiting" as const }],
      }),
    );
    const input = screen.getByPlaceholderText(
      "Type a command…",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "dentist" } });
    expect(screen.getByText(/health · waiting/)).toBeTruthy();
  });

  it("limits task matches to top 6 results", () => {
    const manyTodos: Todo[] = Array.from({ length: 10 }, (_, i) => ({
      ...mockTodos[0],
      id: `t-${i}`,
      title: `Task ${i}`,
    }));
    render(
      createElement(CommandPalette, {
        ...defaultCommandProps,
        todos: manyTodos,
      }),
    );
    const input = screen.getByPlaceholderText(
      "Type a command…",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "task" } });
    const taskOptions = screen
      .getAllByRole("option")
      .filter((opt) =>
        opt
          .querySelector(".command-palette__option-label")
          ?.textContent?.startsWith("Task"),
      );
    expect(taskOptions.length).toBeLessThanOrEqual(6);
  });

  it("shows empty state when no matches", () => {
    render(createElement(CommandPalette, defaultCommandProps));
    const input = screen.getByPlaceholderText(
      "Type a command…",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "zzzznotfound" } });
    expect(screen.getByTestId("no-results")).toBeTruthy();
    expect(screen.getByText("No results")).toBeTruthy();
  });

  it("calls onClose when Escape is pressed", () => {
    render(createElement(CommandPalette, defaultCommandProps));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(defaultCommandProps.onClose).toHaveBeenCalled();
  });

  it("calls onClose when overlay backdrop is clicked", () => {
    render(createElement(CommandPalette, defaultCommandProps));
    fireEvent.click(screen.getByRole("dialog").parentElement!);
    expect(defaultCommandProps.onClose).toHaveBeenCalled();
  });

  it("executes command when Enter is pressed", async () => {
    render(createElement(CommandPalette, defaultCommandProps));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Enter" });
    await waitFor(() => {
      expect(defaultCommandProps.onNewTask).toHaveBeenCalled();
    });
  });

  it("executes command when option is clicked", async () => {
    render(createElement(CommandPalette, defaultCommandProps));
    fireEvent.click(screen.getByText("Go to Focus"));
    await waitFor(() => {
      expect(defaultCommandProps.onNavigate).toHaveBeenCalledWith("home");
    });
  });

  it("navigates with ArrowDown key", () => {
    render(createElement(CommandPalette, defaultCommandProps));
    const input = screen.getByPlaceholderText("Type a command…");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    // First option is "Create Task", second is "Go to Focus"
    const secondOption = screen.getAllByRole("option")[1];
    expect(secondOption).toHaveAttribute("aria-selected", "true");
  });

  it("navigates with ArrowUp key", () => {
    render(createElement(CommandPalette, defaultCommandProps));
    const input = screen.getByPlaceholderText("Type a command…");
    // Go down then up to verify cycling
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    const firstOption = screen.getAllByRole("option")[0];
    expect(firstOption).toHaveAttribute("aria-selected", "true");
  });

  it("highlights active option on mouse enter", () => {
    render(createElement(CommandPalette, defaultCommandProps));
    const focusOption = screen.getByText("Go to Focus").closest("button")!;
    fireEvent.mouseEnter(focusOption);
    expect(focusOption).toHaveAttribute("aria-selected", "true");
  });

  it("filters out archived projects from project commands", () => {
    render(createElement(CommandPalette, defaultCommandProps));
    const input = screen.getByPlaceholderText(
      "Type a command…",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "project" } });
    expect(screen.getByText("Go to project: Work")).toBeTruthy();
    expect(screen.getByText("Go to project: Personal")).toBeTruthy();
    expect(screen.queryByText("Go to project: Archived")).toBeNull();
  });

  it("calls onProjectOpen when project command is executed", async () => {
    render(createElement(CommandPalette, defaultCommandProps));
    fireEvent.click(screen.getByText("Go to project: Work"));
    await waitFor(() => {
      expect(defaultCommandProps.onProjectOpen).toHaveBeenCalledWith("p1");
    });
  });

  it("calls onTodoClick when task option is clicked", async () => {
    render(createElement(CommandPalette, defaultCommandProps));
    const input = screen.getByPlaceholderText(
      "Type a command…",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "dentist" } });
    fireEvent.click(screen.getByText("Call dentist"));
    await waitFor(() => {
      expect(defaultCommandProps.onTodoClick).toHaveBeenCalledWith("t1");
    });
  });

  it("resets query when closed and reopened", async () => {
    const { unmount } = render(
      createElement(CommandPalette, defaultCommandProps),
    );
    const input = screen.getByPlaceholderText(
      "Type a command…",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "search" } });
    expect(input.value).toBe("search");

    unmount();
    render(createElement(CommandPalette, defaultCommandProps));
    const newInput = screen.getByPlaceholderText(
      "Type a command…",
    ) as HTMLInputElement;
    expect(newInput.value).toBe("");
  });

  it("executes navigation commands correctly", async () => {
    render(createElement(CommandPalette, defaultCommandProps));
    const input = screen.getByPlaceholderText(
      "Type a command…",
    ) as HTMLInputElement;

    fireEvent.change(input, { target: { value: "today" } });
    fireEvent.click(screen.getByText("Go to Today"));
    await waitFor(() => {
      expect(defaultCommandProps.onNavigate).toHaveBeenCalledWith("today");
    });
  });

  it("executes toggle dark mode command", async () => {
    render(createElement(CommandPalette, defaultCommandProps));
    const input = screen.getByPlaceholderText(
      "Type a command…",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "dark" } });
    fireEvent.click(screen.getByText("Toggle Dark Mode"));
    await waitFor(() => {
      expect(defaultCommandProps.onToggleDarkMode).toHaveBeenCalled();
    });
  });

  it("executes keyboard shortcuts command", async () => {
    render(createElement(CommandPalette, defaultCommandProps));
    const input = screen.getByPlaceholderText(
      "Type a command…",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "shortcuts" } });
    fireEvent.click(screen.getByText("Show Keyboard Shortcuts"));
    await waitFor(() => {
      expect(defaultCommandProps.onOpenShortcuts).toHaveBeenCalled();
    });
  });

  it("executes weekly review command", async () => {
    render(createElement(CommandPalette, defaultCommandProps));
    const input = screen.getByPlaceholderText(
      "Type a command…",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "review" } });
    fireEvent.click(screen.getByText("Go to Weekly Reset"));
    await waitFor(() => {
      expect(defaultCommandProps.onWeeklyReview).toHaveBeenCalled();
    });
  });

  it("executes settings command", async () => {
    render(createElement(CommandPalette, defaultCommandProps));
    const input = screen.getByPlaceholderText(
      "Type a command…",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "settings" } });
    fireEvent.click(screen.getByText("Go to Settings"));
    await waitFor(() => {
      expect(defaultCommandProps.onOpenSettings).toHaveBeenCalled();
    });
  });

  it("executes feedback command", async () => {
    render(createElement(CommandPalette, defaultCommandProps));
    const input = screen.getByPlaceholderText(
      "Type a command…",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "feedback" } });
    fireEvent.click(screen.getByText("Go to Feedback"));
    await waitFor(() => {
      expect(defaultCommandProps.onOpenFeedback).toHaveBeenCalled();
    });
  });

  it("executes export calendar command", async () => {
    render(createElement(CommandPalette, defaultCommandProps));
    const input = screen.getByPlaceholderText(
      "Type a command…",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "calendar" } });
    fireEvent.click(screen.getByText("Export Calendar"));
    await waitFor(() => {
      expect(defaultCommandProps.onExportCalendar).toHaveBeenCalled();
    });
  });

  it("executes logout command", async () => {
    render(createElement(CommandPalette, defaultCommandProps));
    const input = screen.getByPlaceholderText(
      "Type a command…",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "logout" } });
    fireEvent.click(screen.getByText("Logout"));
    await waitFor(() => {
      expect(defaultCommandProps.onLogout).toHaveBeenCalled();
    });
  });

  it("executes focus search command", async () => {
    render(createElement(CommandPalette, defaultCommandProps));
    const input = screen.getByPlaceholderText(
      "Type a command…",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "search" } });
    fireEvent.click(screen.getByText("Focus Search"));
    await waitFor(() => {
      expect(defaultCommandProps.onFocusSearch).toHaveBeenCalled();
    });
  });

  it("executes Horizon segment navigation commands", async () => {
    render(createElement(CommandPalette, defaultCommandProps));
    const input = screen.getByPlaceholderText(
      "Type a command…",
    ) as HTMLInputElement;

    fireEvent.change(input, { target: { value: "due" } });
    fireEvent.click(screen.getByText("Go to Horizon: Due"));
    await waitFor(() => {
      expect(defaultCommandProps.onNavigateHorizonSegment).toHaveBeenCalledWith(
        "due",
      );
    });
  });
});
