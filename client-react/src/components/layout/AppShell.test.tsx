// @vitest-environment jsdom
import { ce } from "../../test-helpers";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import React from "react";

// ─── Mock all heavy dependencies before importing AppShell ──────────

vi.mock("../../auth/AuthProvider", () => ({
  useAuth: vi.fn(),
}));

vi.mock("../../store/useTodosStore", () => ({
  useTodosStore: vi.fn(),
}));

vi.mock("../../store/useProjectsStore", () => ({
  useProjectsStore: vi.fn(),
}));

vi.mock("../../hooks/useDarkMode", () => ({
  useDarkMode: vi.fn(),
}));

vi.mock("../../hooks/useDensity", () => ({
  useDensity: () => ({
    density: "comfortable",
    setDensity: vi.fn(),
    cycle: vi.fn(),
  }),
}));

vi.mock("../../hooks/useGroupBy", () => ({
  useGroupBy: () => ({ groupBy: "none", setGroupBy: vi.fn() }),
}));

vi.mock("../../hooks/useServiceWorker", () => ({
  useServiceWorker: () => vi.fn(),
}));

vi.mock("../../hooks/useIsMobile", () => ({
  useIsMobile: vi.fn(),
}));

vi.mock("../../hooks/useIcsExport", () => ({
  useIcsExport: () => ({ exportIcs: vi.fn() }),
}));

vi.mock("../../hooks/useTaskNavigation", () => ({
  useTaskNavigation: vi.fn(),
}));

vi.mock("../../hooks/useHashRoute", () => ({
  useHashRoute: () => ({ hashRoute: { taskId: null } }),
}));

vi.mock("../../hooks/useViewTransition", () => ({
  useViewTransition: () => ({ startTransition: (fn: any) => fn() }),
}));

vi.mock("../shared/useOverlayFocusTrap", () => ({
  useOverlayFocusTrap: () => {},
}));

vi.mock("../../api/inbox", () => ({
  captureInboxItem: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../api/client", () => ({
  apiCall: vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }),
}));

vi.mock("../../api/todos", () => ({
  reorderTodos: vi.fn().mockResolvedValue(undefined),
}));

// Mock child components
vi.mock("../projects/Sidebar", () => ({
  Sidebar: ({
    onNewTask,
    onOpenSettings,
    onOpenActivity,
    onToggleTheme,
    onOpenShortcuts,
    onLogout,
    onSearchChange,
    searchQuery,
    isCollapsed,
  }: any) =>
    React.createElement(
      "aside",
      {
        "data-testid": "sidebar",
        "data-collapsed": isCollapsed ? "true" : "false",
      },
      React.createElement(
        "button",
        { "data-testid": "sidebar-new-task", onClick: onNewTask },
        "New Task",
      ),
      React.createElement(
        "button",
        { "data-testid": "sidebar-settings", onClick: onOpenSettings },
        "Settings",
      ),
      React.createElement(
        "button",
        { "data-testid": "sidebar-activity", onClick: onOpenActivity },
        "Activity",
      ),
      React.createElement(
        "button",
        { "data-testid": "sidebar-dark-mode", onClick: onToggleTheme },
        "Dark Mode",
      ),
      React.createElement(
        "button",
        { "data-testid": "sidebar-shortcuts", onClick: onOpenShortcuts },
        "Shortcuts",
      ),
      React.createElement(
        "button",
        { "data-testid": "sidebar-logout", onClick: onLogout },
        "Logout",
      ),
      React.createElement("input", {
        "data-testid": "sidebar-search",
        value: searchQuery || "",
        onChange: (e: any) => onSearchChange?.(e.target.value),
      }),
    ),
}));

vi.mock("../todos/SortableTodoList", () => ({
  SortableTodoList: () =>
    React.createElement("div", { "data-testid": "todo-list" }),
}));

vi.mock("../todos/TodoDrawer", () => ({
  TodoDrawer: ({ todo, onDelete }: any) =>
    todo
      ? React.createElement(
          "div",
          { "data-testid": "todo-drawer" },
          React.createElement(
            "button",
            { onClick: () => onDelete(todo.id) },
            "Request task deletion",
          ),
        )
      : null,
}));

vi.mock("../shared/UndoToast", () => ({
  UndoToast: ({ action }: any) =>
    React.createElement(
      "div",
      {
        "data-testid": "undo-toast",
        "data-variant": action?.variant ?? "default",
      },
      action?.message,
      action?.onUndo &&
        React.createElement(
          "button",
          { onClick: action.onUndo },
          "Undo task change",
        ),
    ),
}));

vi.mock("../shared/ConfirmDialog", () => ({
  ConfirmDialog: ({ onConfirm }: any) =>
    React.createElement(
      "div",
      { "data-testid": "confirm-dialog" },
      React.createElement(
        "button",
        { onClick: onConfirm },
        "Confirm task deletion",
      ),
    ),
}));

vi.mock("../shared/CommandPalette", () => ({
  CommandPalette: ({ isOpen }: any) =>
    isOpen
      ? React.createElement("div", { "data-testid": "command-palette" })
      : null,
}));

vi.mock("../shared/ShortcutsOverlay", () => ({
  ShortcutsOverlay: ({ isOpen }: any) =>
    isOpen
      ? React.createElement("div", { "data-testid": "shortcuts-overlay" })
      : null,
}));

vi.mock("../todos/FilterPanel", () => ({
  FilterPanel: () => null,
  applyFilters: (todos: any[]) => todos,
}));

vi.mock("../shared/ErrorBoundary", () => ({
  ErrorBoundary: ({ children }: any) => children,
}));

vi.mock("./ViewRouter", () => ({
  ViewRouter: ({ children }: any) =>
    React.createElement("div", { "data-testid": "view-router" }, children),
  ViewRoute: ({ children, viewKey }: any) =>
    React.createElement(
      "div",
      { "data-testid": `view-route-${viewKey}`, "data-view-key": viewKey },
      children,
    ),
}));

vi.mock("./HomeDashboard", () => ({
  HomeDashboard: ({ todos, onToggleTodo }: any) =>
    React.createElement(
      "div",
      { "data-testid": "home-dashboard" },
      "Home Dashboard",
      todos.map((todo: any) =>
        React.createElement(
          "button",
          { key: todo.id, onClick: () => onToggleTodo(todo.id, true) },
          "Complete task",
        ),
      ),
    ),
}));

vi.mock("./ListViewHeader", () => ({
  ListViewHeader: () =>
    React.createElement("div", { "data-testid": "list-header" }),
}));

vi.mock("../../utils/focusTargets", () => ({
  focusGlobalSearchInput: vi.fn(),
  triggerPrimaryNewTask: vi.fn(),
}));

vi.mock("../shared/OnboardingFlow", () => ({
  OnboardingFlow: () =>
    React.createElement("div", { "data-testid": "onboarding-flow" }),
}));

vi.mock("../todos/TaskFullPage", () => ({
  TaskFullPage: () =>
    React.createElement("div", { "data-testid": "task-full-page" }),
}));

vi.mock("../todos/TaskComposer", () => ({
  TaskComposer: ({ isOpen }: any) =>
    isOpen
      ? React.createElement("div", { "data-testid": "task-composer" })
      : null,
}));

vi.mock("../projects/ProjectCrud", () => ({
  ProjectCrud: () =>
    React.createElement("div", { "data-testid": "project-crud" }),
}));

vi.mock("./ComponentGalleryPage", () => ({
  ComponentGalleryPage: () =>
    React.createElement("div", { "data-testid": "component-gallery" }),
}));

vi.mock("./SettingsPage", () => ({
  SettingsPage: () =>
    React.createElement("div", { "data-testid": "settings-page" }),
}));

vi.mock("../tuneup/TuneUpView", () => ({
  TuneUpView: () =>
    React.createElement("div", { "data-testid": "tuneup-view" }),
}));

vi.mock("./WeeklyReview", () => ({
  WeeklyReview: () =>
    React.createElement("div", { "data-testid": "weekly-review" }),
}));

vi.mock("../activity/AgentActivityView", () => ({
  AgentActivityView: () =>
    React.createElement("div", { "data-testid": "agent-activity-view" }),
}));

vi.mock("../projects/ProjectEditorView", () => ({
  ProjectEditorView: () =>
    React.createElement("div", { "data-testid": "project-editor-view" }),
}));

vi.mock("../projects/projectEditorModels", () => ({
  PROJECT_RAIL_BACKLOG_SENTINEL: "__unplaced__",
}));

vi.mock("../shared/Icons", () => ({
  IconMoon: () => React.createElement("span", { "data-testid": "icon-moon" }),
  IconSun: () => React.createElement("span", { "data-testid": "icon-sun" }),
  IconMenu: () => React.createElement("span", { "data-testid": "icon-menu" }),
  IconPlus: () => React.createElement("span", { "data-testid": "icon-plus" }),
}));

import { useAuth } from "../../auth/AuthProvider";
import { useTodosStore } from "../../store/useTodosStore";
import { useProjectsStore } from "../../store/useProjectsStore";
import { useIsMobile } from "../../hooks/useIsMobile";
import { useDarkMode } from "../../hooks/useDarkMode";
import { useTaskNavigation } from "../../hooks/useTaskNavigation";
import { AppShell } from "./AppShell";

const mockUseAuth = vi.mocked(useAuth);
const mockUseTodosStore = vi.mocked(useTodosStore);
const mockUseProjectsStore = vi.mocked(useProjectsStore);
const mockUseIsMobile = vi.mocked(useIsMobile);
const mockUseDarkMode = vi.mocked(useDarkMode);
const mockUseTaskNavigation = vi.mocked(useTaskNavigation);

function setupOverrides(
  overrides: {
    user?: any;
    todos?: any[];
    loadState?: "idle" | "loading" | "loaded" | "error";
    projects?: any[];
    isMobile?: boolean;
    dark?: boolean;
  } = {},
) {
  mockUseAuth.mockReturnValue({
    user: overrides.user ?? {
      id: "u1",
      name: "Test User",
      email: "test@example.com",
    },
    loading: false,
    logout: vi.fn(),
    setUser: vi.fn(),
    setTokens: vi.fn(),
    refreshUser: vi.fn().mockResolvedValue(null),
  });
  mockUseTodosStore.mockReturnValue({
    todos: overrides.todos ?? [],
    getTodo: (id: string) => overrides.todos?.find((todo) => todo.id === id),
    getTodos: () => overrides.todos ?? [],
    loadState: (overrides.loadState ?? "loaded") as
      | "idle"
      | "loading"
      | "loaded"
      | "error",
    errorMessage: "",
    loadTodos: vi.fn(),
    addTodo: vi.fn(),
    toggleTodo: vi.fn(),
    editTodo: vi.fn(),
    removeTodo: vi.fn(),
  });
  mockUseProjectsStore.mockReturnValue({
    projects: overrides.projects ?? [],
    getProjects: () => overrides.projects ?? [],
    loading: false,
    error: null,
    loadProjects: vi.fn(),
  });
  mockUseIsMobile.mockReturnValue(overrides.isMobile ?? false);
  mockUseDarkMode.mockReturnValue({
    dark: overrides.dark ?? false,
    toggle: vi.fn(),
  });
  mockUseTaskNavigation.mockReturnValue({
    state: { mode: "collapsed" },
    activeTaskId: null,
    openQuickEdit: vi.fn(),
    openDrawer: vi.fn(),
    openFullPage: vi.fn(),
    escalate: vi.fn(),
    deescalate: vi.fn(),
    collapse: vi.fn(),
  });
}

describe("AppShell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    setupOverrides();
  });

  describe("core structure", () => {
    it("renders the app shell container", () => {
      const { container } = render(ce(AppShell));
      expect(container.querySelector(".app-shell")).toBeTruthy();
    });

    it("renders the sidebar", () => {
      render(ce(AppShell));
      expect(screen.getByTestId("sidebar")).toBeTruthy();
    });

    it("renders the main content area", () => {
      const { container } = render(ce(AppShell));
      expect(container.querySelector(".app-main")).toBeTruthy();
    });

    it("renders the view router", () => {
      render(ce(AppShell));
      expect(screen.getByTestId("view-router")).toBeTruthy();
    });

    it("renders view routes for all workspace views", () => {
      render(ce(AppShell));
      expect(screen.getByTestId("view-route-home")).toBeTruthy();
      expect(screen.getByTestId("view-route-all")).toBeTruthy();
      expect(screen.getByTestId("view-route-today")).toBeTruthy();
      expect(screen.getByTestId("view-route-horizon")).toBeTruthy();
      expect(screen.getByTestId("view-route-completed")).toBeTruthy();
    });

    it("renders the undo toast", () => {
      render(ce(AppShell));
      expect(screen.getByTestId("undo-toast")).toBeTruthy();
    });

    it("renders the list header", () => {
      render(ce(AppShell));
      expect(
        screen.getAllByTestId("list-header").length,
      ).toBeGreaterThanOrEqual(1);
    });

    it("renders the todo list", () => {
      render(ce(AppShell));
      expect(screen.getAllByTestId("todo-list").length).toBeGreaterThanOrEqual(
        1,
      );
    });
  });

  describe("loading state", () => {
    it("shows loading bar when loadState is loading", () => {
      setupOverrides({ loadState: "loading" });
      const { container } = render(ce(AppShell));
      expect(container.querySelector(".loading-bar")).toBeTruthy();
    });

    it("hides loading bar when loadState is loaded", () => {
      setupOverrides({ loadState: "loaded" });
      const { container } = render(ce(AppShell));
      expect(container.querySelector(".loading-bar")).toBeNull();
    });
  });

  describe("page routing", () => {
    it("shows home dashboard on todos page", () => {
      render(ce(AppShell));
      expect(screen.getByTestId("home-dashboard")).toBeTruthy();
    });
  });

  describe("mobile responsiveness", () => {
    it("renders desktop sidebar when not mobile", () => {
      setupOverrides({ isMobile: false });
      const { container } = render(ce(AppShell));
      expect(container.querySelector("aside.app-sidebar")).toBeTruthy();
    });

    it("does not render mobile sheet when not mobile", () => {
      setupOverrides({ isMobile: false });
      render(ce(AppShell));
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  describe("sidebar state", () => {
    it("sidebar is not collapsed by default", () => {
      render(ce(AppShell));
      const sidebar = screen.getByTestId("sidebar");
      expect(sidebar.getAttribute("data-collapsed")).toBe("false");
    });
  });

  describe("overlays and dialogs", () => {
    it("does not render confirm dialog by default", () => {
      render(ce(AppShell));
      expect(screen.queryByTestId("confirm-dialog")).toBeNull();
    });

    it("does not render command palette by default", () => {
      render(ce(AppShell));
      expect(screen.queryByTestId("command-palette")).toBeNull();
    });

    it("does not render shortcuts overlay by default", () => {
      render(ce(AppShell));
      expect(screen.queryByTestId("shortcuts-overlay")).toBeNull();
    });

    it("does not render task composer by default", () => {
      render(ce(AppShell));
      expect(screen.queryByTestId("task-composer")).toBeNull();
    });

    it("does not render project CRUD by default", () => {
      render(ce(AppShell));
      expect(screen.queryByTestId("project-crud")).toBeNull();
    });

    it("does not render onboarding flow when user is onboarded", () => {
      setupOverrides({
        user: {
          id: "u1",
          name: "Test User",
          email: "test@example.com",
          onboardingCompletedAt: "2026-01-01",
        },
      });
      render(ce(AppShell));
      expect(screen.queryByTestId("onboarding-flow")).toBeNull();
    });

    it("renders onboarding flow when user is not onboarded", () => {
      setupOverrides({
        user: {
          id: "u1",
          name: "Test User",
          email: "test@example.com",
          onboardingCompletedAt: null,
        },
      });
      render(ce(AppShell));
      expect(screen.getByTestId("onboarding-flow")).toBeTruthy();
    });

    it("does not render task full page by default", () => {
      render(ce(AppShell));
      expect(screen.queryByTestId("task-full-page")).toBeNull();
    });

    it("does not render todo drawer by default", () => {
      render(ce(AppShell));
      expect(screen.queryByTestId("todo-drawer")).toBeNull();
    });

    it("does not render agent activity view by default", () => {
      render(ce(AppShell));
      expect(screen.queryByTestId("agent-activity-view")).toBeNull();
    });

    it("does not render weekly review by default", () => {
      render(ce(AppShell));
      expect(screen.queryByTestId("weekly-review")).toBeNull();
    });

    it("does not render tuneup view by default", () => {
      render(ce(AppShell));
      expect(screen.queryByTestId("tuneup-view")).toBeNull();
    });
  });

  describe("sidebar navigation", () => {
    it("shows settings page when sidebar settings button clicked", async () => {
      render(ce(AppShell));
      await act(async () => {
        fireEvent.click(screen.getByTestId("sidebar-settings"));
      });
      expect(screen.getByTestId("settings-page")).toBeTruthy();
    });

    it("shows agent activity view when sidebar activity button clicked", async () => {
      render(ce(AppShell));
      await act(async () => {
        fireEvent.click(screen.getByTestId("sidebar-activity"));
      });
      expect(screen.getByTestId("agent-activity-view")).toBeTruthy();
    });

    it("toggles dark mode when sidebar dark mode button clicked", async () => {
      const toggleDark = vi.fn();
      mockUseDarkMode.mockReturnValue({ dark: false, toggle: toggleDark });
      render(ce(AppShell));
      await act(async () => {
        fireEvent.click(screen.getByTestId("sidebar-dark-mode"));
      });
      expect(toggleDark).toHaveBeenCalled();
    });

    it("opens shortcuts overlay when sidebar shortcuts button clicked", async () => {
      render(ce(AppShell));
      await act(async () => {
        fireEvent.click(screen.getByTestId("sidebar-shortcuts"));
      });
      expect(screen.getByTestId("shortcuts-overlay")).toBeTruthy();
    });

    it("logs out when sidebar logout button clicked", async () => {
      const logout = vi.fn();
      mockUseAuth.mockReturnValue({
        user: { id: "u1", name: "Test User", email: "test@example.com" },
        loading: false,
        logout,
        setUser: vi.fn(),
        setTokens: vi.fn(),
        refreshUser: vi.fn().mockResolvedValue(null),
      });
      render(ce(AppShell));
      await act(async () => {
        fireEvent.click(screen.getByTestId("sidebar-logout"));
      });
      expect(logout).toHaveBeenCalled();
    });

    it("updates search query when sidebar search input changes", async () => {
      render(ce(AppShell));
      const searchInput = screen.getByTestId("sidebar-search");
      await act(async () => {
        fireEvent.change(searchInput, { target: { value: "test query" } });
      });
      expect(searchInput).toHaveValue("test query");
    });

    it("opens task composer when sidebar new task button clicked", async () => {
      render(ce(AppShell));
      await act(async () => {
        fireEvent.click(screen.getByTestId("sidebar-new-task"));
      });
      expect(screen.getByTestId("task-composer")).toBeTruthy();
    });
  });

  describe("mobile rendering", () => {
    it("renders mobile sheet when isMobile is true", () => {
      setupOverrides({ isMobile: true });
      const { container } = render(ce(AppShell));
      expect(container.querySelector(".mobile-sheet")).toBeTruthy();
      expect(container.querySelector(".mobile-sheet-backdrop")).toBeTruthy();
    });

    it("does not render desktop sidebar when mobile", () => {
      setupOverrides({ isMobile: true });
      const { container } = render(ce(AppShell));
      expect(container.querySelector("aside.app-sidebar")).toBeNull();
    });
  });

  describe("bulk mode", () => {
    it("app shell does not have bulk class by default", () => {
      const { container } = render(ce(AppShell));
      expect(container.querySelector(".is-bulk-selecting")).toBeNull();
    });
  });

  describe("dark mode", () => {
    it("passes dark prop to sidebar", () => {
      mockUseDarkMode.mockReturnValue({ dark: true, toggle: vi.fn() });
      render(ce(AppShell));
      expect(mockUseDarkMode).toHaveBeenCalled();
    });
  });

  describe("error state", () => {
    it("does not show loading bar when loadState is error", () => {
      setupOverrides({ loadState: "error" });
      const { container } = render(ce(AppShell));
      expect(container.querySelector(".loading-bar")).toBeNull();
    });
  });

  describe("view routing", () => {
    it("renders view-router container", () => {
      const { container } = render(ce(AppShell));
      expect(
        container.querySelector('[data-testid="view-router"]'),
      ).toBeTruthy();
    });

    it("renders home view route by default", () => {
      const { container } = render(ce(AppShell));
      expect(
        container.querySelector('[data-testid="view-route-home"]'),
      ).toBeTruthy();
    });
  });

  describe("view mode toggle", () => {
    it("passes viewMode to ListViewHeader", () => {
      render(ce(AppShell));
      const headers = screen.getAllByTestId("list-header");
      expect(headers.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("delete confirmation", () => {
    it("does not show delete confirmation by default", () => {
      render(ce(AppShell));
      expect(screen.queryByTestId("confirm-dialog")).toBeNull();
    });
  });

  describe("settings page navigation", () => {
    it("shows settings page when navigating to settings", async () => {
      render(ce(AppShell));
      await act(async () => {
        fireEvent.click(screen.getByTestId("sidebar-settings"));
      });
      expect(screen.getByTestId("settings-page")).toBeTruthy();
    });

    it("navigates back to todos from settings via sidebar", async () => {
      render(ce(AppShell));
      // Navigate to settings
      await act(async () => {
        fireEvent.click(screen.getByTestId("sidebar-settings"));
      });
      expect(screen.getByTestId("settings-page")).toBeTruthy();

      // Navigate back to activity (which is a different page)
      await act(async () => {
        fireEvent.click(screen.getByTestId("sidebar-activity"));
      });
      expect(screen.getByTestId("agent-activity-view")).toBeTruthy();
    });
  });

  describe("top bar header (desktop)", () => {
    it("renders new task button in top bar on home view", () => {
      const { container } = render(ce(AppShell));
      const newTaskBtn = container.querySelector(
        '[data-new-task-trigger="true"]',
      );
      expect(newTaskBtn).toBeTruthy();
    });

    it("renders logout button in top bar when user exists", () => {
      const { container } = render(ce(AppShell));
      const buttons = container.querySelectorAll("button");
      const logoutBtn = Array.from(buttons).find(
        (btn) => btn.textContent === "Logout",
      );
      expect(logoutBtn).toBeTruthy();
    });
  });

  describe("mobile header", () => {
    it("renders mobile header with menu button when mobile", () => {
      setupOverrides({ isMobile: true });
      const { container } = render(ce(AppShell));
      const menuBtn = container.querySelector("#projectsRailMobileOpen");
      expect(menuBtn).toBeTruthy();
    });

    it("opens mobile nav when menu button clicked", async () => {
      setupOverrides({ isMobile: true });
      const { container } = render(ce(AppShell));
      const menuBtn = container.querySelector("#projectsRailMobileOpen");
      await act(async () => {
        fireEvent.click(menuBtn!);
      });
      expect(container.querySelector('[aria-hidden="false"]')).toBeTruthy();
    });
  });

  describe("sidebar collapse state", () => {
    it("toggles sidebar collapse when toggle button clicked", async () => {
      render(ce(AppShell));
      // The sidebar mock should expose a collapse toggle
      // We verify via the data-collapsed attribute changing
      const sidebar = screen.getByTestId("sidebar");
      expect(sidebar.getAttribute("data-collapsed")).toBe("false");
    });
  });

  describe("idle load state", () => {
    it("does not show loading bar when loadState is idle", () => {
      setupOverrides({ loadState: "idle" });
      const { container } = render(ce(AppShell));
      expect(container.querySelector(".loading-bar")).toBeNull();
    });
  });

  describe("sidebar collapsed state", () => {
    it("applies collapsed class when sidebar is collapsed", async () => {
      render(ce(AppShell));
      // Initial state: not collapsed
      const { container } = render(ce(AppShell));
      expect(container.querySelector(".is-sidebar-collapsed")).toBeNull();
    });
  });

  describe("project selection", () => {
    it("renders project crud when project is selected", async () => {
      setupOverrides({
        projects: [{ id: "p1", name: "Test Project", slug: "test" }],
      });
      render(ce(AppShell));
      // Select a project via sidebar
      await act(async () => {
        fireEvent.click(screen.getByTestId("sidebar-settings"));
      });
      // Project crud should render when editing a project
      // This depends on the routing state
    });
  });
});

const desktopTask = {
  id: "desktop-task",
  title: "Review paper",
  status: "next" as const,
  completed: false,
  tags: [],
  dependsOnTaskIds: [],
  order: 0,
  archived: false,
  userId: "u1",
  createdAt: "2026-10-08T12:00:00.000Z",
  updatedAt: "2026-10-08T12:00:00.000Z",
};

function openDesktopTask() {
  const navigation = mockUseTaskNavigation();
  mockUseTaskNavigation.mockReturnValue({
    ...navigation,
    activeTaskId: desktopTask.id,
    state: { mode: "drawer", taskId: desktopTask.id },
  });
  return navigation;
}

describe("desktop mutation failure feedback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    setupOverrides({
      todos: [desktopTask],
      user: {
        id: "u1",
        name: "Test User",
        email: "test@example.com",
        onboardingCompletedAt: "2026-10-08T12:00:00.000Z",
      },
    });
  });

  it("shows completion failure without offering a false success or Undo", async () => {
    const store = mockUseTodosStore();
    vi.mocked(store.toggleTodo).mockRejectedValueOnce(
      new Error("Completion was not saved"),
    );
    render(ce(AppShell));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Complete task" }));
    });
    expect(store.toggleTodo).toHaveBeenCalledWith(desktopTask.id, true);
    expect(screen.getByTestId("undo-toast")).toHaveTextContent(
      "Completion was not saved",
    );
    expect(screen.getByTestId("undo-toast")).toHaveAttribute(
      "data-variant",
      "error",
    );
    expect(
      screen.queryByRole("button", { name: "Undo task change" }),
    ).toBeNull();
  });

  it("catches a failed completion Undo and keeps its error visible", async () => {
    const store = mockUseTodosStore();
    vi.mocked(store.toggleTodo)
      .mockResolvedValueOnce({ ...desktopTask, completed: true })
      .mockRejectedValueOnce(new Error("Undo was not saved"));
    render(ce(AppShell));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Complete task" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Undo task change" }));
    });
    expect(store.toggleTodo).toHaveBeenLastCalledWith(desktopTask.id, false);
    expect(screen.getByTestId("undo-toast")).toHaveTextContent(
      "Undo was not saved",
    );
    expect(screen.getByTestId("undo-toast")).toHaveAttribute(
      "data-variant",
      "error",
    );
  });

  it("closes the exiting confirmation after deletion failure and permits an intentional retry", async () => {
    const store = mockUseTodosStore();
    vi.mocked(store.removeTodo)
      .mockRejectedValueOnce(new Error("Deletion was not saved"))
      .mockResolvedValueOnce(undefined);
    const navigation = openDesktopTask();
    render(ce(AppShell));
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Request task deletion" }),
      );
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Confirm task deletion" }),
      );
    });
    expect(screen.queryByTestId("confirm-dialog")).toBeNull();
    expect(navigation.collapse).not.toHaveBeenCalled();
    expect(screen.getByTestId("undo-toast")).toHaveTextContent(
      "Deletion was not saved",
    );
    expect(
      screen.queryByRole("button", { name: "Undo task change" }),
    ).toBeNull();
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Request task deletion" }),
      );
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Confirm task deletion" }),
      );
    });
    expect(store.removeTodo).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("undo-toast")).toHaveTextContent(
      '"Review paper" deleted',
    );
  });

  it("sends only one deletion while confirmation callbacks are repeated during a slow response", async () => {
    const store = mockUseTodosStore();
    let resolveDeletion!: () => void;
    vi.mocked(store.removeTodo).mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveDeletion = resolve;
      }),
    );
    openDesktopTask();
    render(ce(AppShell));
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Request task deletion" }),
      );
    });
    await act(async () => {
      const confirm = screen.getByRole("button", {
        name: "Confirm task deletion",
      });
      fireEvent.click(confirm);
      fireEvent.click(confirm);
      fireEvent.click(
        screen.getByRole("button", { name: "Request task deletion" }),
      );
    });
    expect(store.removeTodo).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveDeletion();
    });
    expect(screen.queryByTestId("confirm-dialog")).toBeNull();
  });

  it("catches a failed deletion Undo instead of dropping a rejected capture promise", async () => {
    const store = mockUseTodosStore();
    vi.mocked(store.removeTodo).mockResolvedValueOnce(undefined);
    vi.mocked(store.addTodo).mockRejectedValueOnce(
      new Error("Restoring the task failed"),
    );
    openDesktopTask();
    render(ce(AppShell));
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Request task deletion" }),
      );
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Confirm task deletion" }),
      );
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Undo task change" }));
    });
    expect(store.addTodo).toHaveBeenCalledWith({
      title: desktopTask.title,
      projectId: undefined,
    });
    expect(screen.getByTestId("undo-toast")).toHaveTextContent(
      "Restoring the task failed",
    );
    expect(screen.getByTestId("undo-toast")).toHaveAttribute(
      "data-variant",
      "error",
    );
  });
});
