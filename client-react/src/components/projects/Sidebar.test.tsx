// @vitest-environment jsdom
import { ce } from "../../test-helpers";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Sidebar } from "./Sidebar";
import type { Project, User } from "../../types";

vi.mock("../shared/ProfileLauncher", () => ({
  ProfileLauncher: () =>
    ce("div", { "data-testid": "profile-launcher" }, "Profile"),
}));

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: overrides.id ?? "p1",
    name: overrides.name ?? "Test Project",
    description: null,
    goal: null,
    status: "active",
    priority: null,
    area: overrides.area ?? null,
    areaId: null,
    targetDate: null,
    archived: overrides.archived ?? false,
    userId: "u1",

    updatedAt: "2026-01-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

const mockUser: User = {
  id: "u1",
  email: "test@example.com",
  name: "Test User",
  onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
  onboardingStep: 4,
  plan: "free",
};

const defaultProps = {
  projects: [],
  activeView: "home" as const,
  selectedProjectId: null,
  viewCounts: undefined,
  onSelectView: vi.fn(),
  onSelectProject: vi.fn(),
  onCreateProject: vi.fn(),
  onOpenSettings: vi.fn(),
  onOpenComponents: vi.fn(),
  onOpenFeedback: vi.fn(),
  onOpenAdmin: vi.fn(),
  onOpenActivity: vi.fn(),
  activePage: "todos",
  onToggleTheme: vi.fn(),
  onOpenShortcuts: vi.fn(),
  onOpenProfile: vi.fn(),
  onLogout: vi.fn(),
  user: mockUser,
  dark: false,
  isAdmin: false,
  isCollapsed: false,
  onToggleCollapse: vi.fn(),
  searchQuery: "",
  onSearchChange: vi.fn(),
  onNewTask: vi.fn(),
  uiMode: "normal",
};

describe("Sidebar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("workspace views", () => {
    it("renders all workspace views in normal mode", () => {
      render(ce(Sidebar, defaultProps));
      expect(screen.getByText("Focus")).toBeTruthy();
      expect(screen.getByText("Tasks")).toBeTruthy();
      expect(screen.getByText("Today")).toBeTruthy();
      expect(screen.getByText("Horizon")).toBeTruthy();
      expect(screen.getByText("Completed")).toBeTruthy();
    });

    it("excludes Focus view in simple mode", () => {
      render(ce(Sidebar, { ...defaultProps, uiMode: "simple" }));
      expect(screen.queryByText("Focus")).toBeNull();
      expect(screen.getByText("Tasks")).toBeTruthy();
    });

    it("shows view counts when provided", () => {
      render(
        ce(Sidebar, {
          ...defaultProps,
          viewCounts: { today: 5, horizon: 3 },
        }),
      );
      expect(screen.getByText("5")).toBeTruthy();
      expect(screen.getByText("3")).toBeTruthy();
    });

    it("does not show zero counts", () => {
      render(
        ce(Sidebar, {
          ...defaultProps,
          viewCounts: { today: 0, horizon: 0 },
        }),
      );
      expect(screen.queryByText("0")).toBeNull();
    });

    it("marks active view when no project selected", () => {
      render(ce(Sidebar, { ...defaultProps, activeView: "today" }));
      const todayBtn = screen.getByText("Today").closest("button");
      expect(todayBtn).toHaveClass("projects-rail-item--active");
    });

    it("does not mark active view when project selected", () => {
      render(
        ce(Sidebar, {
          ...defaultProps,
          activeView: "today",
          selectedProjectId: "p1",
        }),
      );
      const todayBtn = screen.getByText("Today").closest("button");
      expect(todayBtn).not.toHaveClass("projects-rail-item--active");
    });

    it("calls onSelectView and onSelectProject when view is clicked", () => {
      render(ce(Sidebar, defaultProps));
      fireEvent.click(screen.getByText("Today"));
      expect(defaultProps.onSelectView).toHaveBeenCalledWith("today");
      expect(defaultProps.onSelectProject).toHaveBeenCalledWith(null);
    });
  });

  describe("activity button", () => {
    it("renders Activity button", () => {
      render(ce(Sidebar, defaultProps));
      expect(screen.getByText("Activity")).toBeTruthy();
    });

    it("marks Activity as active when activePage is activity", () => {
      render(ce(Sidebar, { ...defaultProps, activePage: "activity" }));
      const activityBtn = screen.getByText("Activity").closest("button");
      expect(activityBtn).toHaveClass("projects-rail-item--active");
    });

    it("calls onOpenActivity when clicked", () => {
      render(ce(Sidebar, defaultProps));
      fireEvent.click(screen.getByText("Activity"));
      expect(defaultProps.onOpenActivity).toHaveBeenCalled();
    });
  });

  describe("new task button", () => {
    it("renders New Task button when not collapsed", () => {
      render(ce(Sidebar, defaultProps));
      expect(screen.getByText("New Task")).toBeTruthy();
    });

    it("hides New Task button when collapsed", () => {
      render(ce(Sidebar, { ...defaultProps, isCollapsed: true }));
      expect(screen.queryByText("New Task")).toBeNull();
    });

    it("calls onNewTask when clicked", () => {
      render(ce(Sidebar, defaultProps));
      fireEvent.click(screen.getByText("New Task"));
      expect(defaultProps.onNewTask).toHaveBeenCalled();
    });
  });

  describe("search", () => {
    it("renders search input when not collapsed", () => {
      render(ce(Sidebar, defaultProps));
      expect(screen.getByPlaceholderText("Search…")).toBeTruthy();
    });

    it("hides search when collapsed", () => {
      render(ce(Sidebar, { ...defaultProps, isCollapsed: true }));
      expect(screen.queryByPlaceholderText("Search…")).toBeNull();
    });

    it("calls onSearchChange when typing", () => {
      render(ce(Sidebar, defaultProps));
      fireEvent.change(screen.getByPlaceholderText("Search…"), {
        target: { value: "test" },
      });
      expect(defaultProps.onSearchChange).toHaveBeenCalledWith("test");
    });

    it("shows clear button when query exists", () => {
      render(ce(Sidebar, { ...defaultProps, searchQuery: "test" }));
      expect(screen.getByLabelText("Clear search")).toBeTruthy();
    });

    it("clears search on clear button click", () => {
      render(ce(Sidebar, { ...defaultProps, searchQuery: "test" }));
      fireEvent.click(screen.getByLabelText("Clear search"));
      expect(defaultProps.onSearchChange).toHaveBeenCalledWith("");
    });

    it("clears search on Escape key", () => {
      render(ce(Sidebar, { ...defaultProps, searchQuery: "test" }));
      fireEvent.keyDown(screen.getByPlaceholderText("Search…"), {
        key: "Escape",
      });
      expect(defaultProps.onSearchChange).toHaveBeenCalledWith("");
    });
  });

  describe("project grouping", () => {
    it("renders projects grouped by area", () => {
      const projects = [
        makeProject({ id: "p1", name: "Work Project", area: "work" }),
        makeProject({ id: "p2", name: "Family Project", area: "family" }),
      ];
      render(ce(Sidebar, { ...defaultProps, projects }));
      expect(screen.getByText("Work")).toBeTruthy();
      expect(screen.getByText("Family")).toBeTruthy();
      expect(screen.getByText("Work Project")).toBeTruthy();
      expect(screen.getByText("Family Project")).toBeTruthy();
    });

    it("collapses/expands areas on click", () => {
      const projects = [
        makeProject({ id: "p1", name: "Work Project", area: "work" }),
      ];
      render(ce(Sidebar, { ...defaultProps, projects }));
      // Initially expanded
      expect(screen.getByText("Work Project")).toBeTruthy();
      // Click to collapse
      fireEvent.click(screen.getByText("Work"));
      expect(screen.queryByText("Work Project")).toBeNull();
    });

    it("marks active project", () => {
      const projects = [makeProject({ id: "p1", name: "Active Project" })];
      render(
        ce(Sidebar, { ...defaultProps, projects, selectedProjectId: "p1" }),
      );
      const btn = screen.getByText("Active Project").closest("button");
      expect(btn).toHaveClass("projects-rail-item--active");
    });

    it("calls onSelectProject when project clicked", () => {
      const projects = [makeProject({ id: "p1", name: "Test Project" })];
      render(ce(Sidebar, { ...defaultProps, projects }));
      fireEvent.click(screen.getByText("Test Project"));
      expect(defaultProps.onSelectProject).toHaveBeenCalledWith("p1");
    });

    it("hides archived projects", () => {
      const projects = [
        makeProject({ id: "p1", name: "Active", archived: false }),
        makeProject({ id: "p2", name: "Archived", archived: true }),
      ];
      render(ce(Sidebar, { ...defaultProps, projects }));
      expect(screen.getByText("Active")).toBeTruthy();
      expect(screen.queryByText("Archived")).toBeNull();
    });

    it("calls onCreateProject when new project button clicked", () => {
      render(ce(Sidebar, defaultProps));
      fireEvent.click(screen.getByLabelText("New project"));
      expect(defaultProps.onCreateProject).toHaveBeenCalled();
    });
  });

  describe("collapse/expand", () => {
    it("calls onToggleCollapse when collapse button clicked", () => {
      render(ce(Sidebar, defaultProps));
      fireEvent.click(screen.getByLabelText("Collapse sidebar"));
      expect(defaultProps.onToggleCollapse).toHaveBeenCalled();
    });

    it("shows expand label when collapsed", () => {
      render(ce(Sidebar, { ...defaultProps, isCollapsed: true }));
      expect(screen.getByLabelText("Expand sidebar")).toBeTruthy();
    });
  });

  describe("profile launcher", () => {
    it("renders profile launcher at bottom", () => {
      render(ce(Sidebar, defaultProps));
      expect(screen.getByTestId("profile-launcher")).toBeTruthy();
    });
  });
});
