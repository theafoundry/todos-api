// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
  buildQueryParams,
  getViewTitle,
  shouldShowListViewHeader,
  isBlockingOverlayOpen,
  getActiveViewFromHash,
  DRAFT_PROJECT_ID,
} from "./appShellViews";

describe("appShellViews", () => {
  describe("DRAFT_PROJECT_ID", () => {
    it("is a constant string", () => {
      expect(DRAFT_PROJECT_ID).toBe("draft-project");
    });
  });

  describe("buildQueryParams", () => {
    it("returns empty params for home view", () => {
      const params = buildQueryParams({
        activeView: "home",
        selectedProjectId: null,
        sortBy: "order",
        sortOrder: "asc",
      });
      expect(params).toEqual({});
    });

    it("sets dueDate sort for today view", () => {
      const params = buildQueryParams({
        activeView: "today",
        selectedProjectId: null,
        sortBy: "order",
        sortOrder: "asc",
      });
      expect(params.sortBy).toBe("dueDate");
      expect(params.sortOrder).toBe("asc");
    });

    it("sets completed flag for completed view", () => {
      const params = buildQueryParams({
        activeView: "completed",
        selectedProjectId: null,
        sortBy: "order",
        sortOrder: "asc",
      });
      expect(params.completed).toBe("true");
    });

    it("sets dueDate sort for horizon view", () => {
      const params = buildQueryParams({
        activeView: "horizon",
        selectedProjectId: null,
        sortBy: "order",
        sortOrder: "asc",
      });
      expect(params.sortBy).toBe("dueDate");
      expect(params.sortOrder).toBe("asc");
    });

    it("includes projectId when project selected", () => {
      const params = buildQueryParams({
        activeView: "home",
        selectedProjectId: "p1",
        sortBy: "order",
        sortOrder: "asc",
      });
      expect(params.projectId).toBe("p1");
    });

    it("excludes draft project ID", () => {
      const params = buildQueryParams({
        activeView: "home",
        selectedProjectId: "draft-project",
        sortBy: "order",
        sortOrder: "asc",
      });
      expect(params.projectId).toBeUndefined();
    });

    it("overrides view defaults with user sort", () => {
      const params = buildQueryParams({
        activeView: "today",
        selectedProjectId: null,
        sortBy: "title",
        sortOrder: "desc",
      });
      expect(params.sortBy).toBe("title");
      expect(params.sortOrder).toBe("desc");
    });

    it("keeps view defaults when user sort is default", () => {
      const params = buildQueryParams({
        activeView: "today",
        selectedProjectId: null,
        sortBy: "order",
        sortOrder: "asc",
      });
      expect(params.sortBy).toBe("dueDate");
    });
  });

  describe("getViewTitle", () => {
    it("returns project name when project selected", () => {
      const title = getViewTitle("home", "due", "p1", [
        { id: "p1", name: "My Project" },
      ]);
      expect(title).toBe("My Project");
    });

    it("returns generic Project when project not found", () => {
      const title = getViewTitle("home", "due", "missing", [
        { id: "p1", name: "Other" },
      ]);
      expect(title).toBe("Project");
    });

    it("returns Focus for home view", () => {
      expect(getViewTitle("home", "due", null, [])).toBe("Focus");
    });

    it("returns Today for today view", () => {
      expect(getViewTitle("today", "due", null, [])).toBe("Today");
    });

    it("returns Horizon for horizon/due", () => {
      expect(getViewTitle("horizon", "due", null, [])).toBe("Horizon");
    });

    it("returns Waiting for horizon/pending", () => {
      expect(getViewTitle("horizon", "pending", null, [])).toBe("Waiting");
    });

    it("returns Planned for horizon/planned", () => {
      expect(getViewTitle("horizon", "planned", null, [])).toBe("Planned");
    });

    it("returns Later for horizon/later", () => {
      expect(getViewTitle("horizon", "later", null, [])).toBe("Later");
    });

    it("returns Completed for completed view", () => {
      expect(getViewTitle("completed", "due", null, [])).toBe("Completed");
    });

    it("returns Tasks for the compatible all view", () => {
      expect(getViewTitle("all", "due", null, [])).toBe("Tasks");
    });

    it("returns Inbox for pending capture review", () => {
      expect(getViewTitle("inbox", "due", null, [])).toBe("Inbox");
    });
  });

  describe("shouldShowListViewHeader", () => {
    it("returns true when project selected", () => {
      expect(shouldShowListViewHeader("home", "p1")).toBe(true);
    });

    it("returns true for all view", () => {
      expect(shouldShowListViewHeader("all", null)).toBe(true);
    });

    it("returns false for today view", () => {
      expect(shouldShowListViewHeader("today", null)).toBe(false);
    });

    it("returns false for home view", () => {
      expect(shouldShowListViewHeader("home", null)).toBe(false);
    });

    it("returns false for horizon view", () => {
      expect(shouldShowListViewHeader("horizon", null)).toBe(false);
    });
  });

  describe("isBlockingOverlayOpen", () => {
    it("returns false when nothing is open", () => {
      expect(
        isBlockingOverlayOpen({
          mobileNavOpen: false,
          paletteOpen: false,
          shortcutsOpen: false,
          composerOpen: false,
          projectCrudMode: null,
          deleteTarget: null,
          activeTodo: null,
          showOnboarding: false,
        }),
      ).toBe(false);
    });

    it("returns true when mobile nav is open", () => {
      expect(
        isBlockingOverlayOpen({
          mobileNavOpen: true,
          paletteOpen: false,
          shortcutsOpen: false,
          composerOpen: false,
          projectCrudMode: null,
          deleteTarget: null,
          activeTodo: null,
          showOnboarding: false,
        }),
      ).toBe(true);
    });

    it("returns true when palette is open", () => {
      expect(
        isBlockingOverlayOpen({
          mobileNavOpen: false,
          paletteOpen: true,
          shortcutsOpen: false,
          composerOpen: false,
          projectCrudMode: null,
          deleteTarget: null,
          activeTodo: null,
          showOnboarding: false,
        }),
      ).toBe(true);
    });

    it("returns true when project CRUD is active", () => {
      expect(
        isBlockingOverlayOpen({
          mobileNavOpen: false,
          paletteOpen: false,
          shortcutsOpen: false,
          composerOpen: false,
          projectCrudMode: "create",
          deleteTarget: null,
          activeTodo: null,
          showOnboarding: false,
        }),
      ).toBe(true);
    });

    it("returns true when delete target is set", () => {
      expect(
        isBlockingOverlayOpen({
          mobileNavOpen: false,
          paletteOpen: false,
          shortcutsOpen: false,
          composerOpen: false,
          projectCrudMode: null,
          deleteTarget: "t1",
          activeTodo: null,
          showOnboarding: false,
        }),
      ).toBe(true);
    });

    it("returns true when onboarding is shown", () => {
      expect(
        isBlockingOverlayOpen({
          mobileNavOpen: false,
          paletteOpen: false,
          shortcutsOpen: false,
          composerOpen: false,
          projectCrudMode: null,
          deleteTarget: null,
          activeTodo: null,
          showOnboarding: true,
        }),
      ).toBe(true);
    });

    it("returns true when active todo is open", () => {
      expect(
        isBlockingOverlayOpen({
          mobileNavOpen: false,
          paletteOpen: false,
          shortcutsOpen: false,
          composerOpen: false,
          projectCrudMode: null,
          deleteTarget: null,
          activeTodo: { id: "t1" },
          showOnboarding: false,
        }),
      ).toBe(true);
    });
  });

  describe("getActiveViewFromHash", () => {
    it("returns home for #/home", () => {
      expect(getActiveViewFromHash("#/home")).toBe("home");
    });

    it("returns today for #/today", () => {
      expect(getActiveViewFromHash("#/today")).toBe("today");
    });

    it("returns horizon for #/horizon", () => {
      expect(getActiveViewFromHash("#/horizon")).toBe("horizon");
    });

    it("returns completed for #/completed", () => {
      expect(getActiveViewFromHash("#/completed")).toBe("completed");
    });

    it("returns all for #/all", () => {
      expect(getActiveViewFromHash("#/all")).toBe("all");
    });

    it("returns undefined for empty hash", () => {
      expect(getActiveViewFromHash("")).toBeUndefined();
    });

    it("returns undefined for unknown route", () => {
      expect(getActiveViewFromHash("#/settings")).toBeUndefined();
    });

    it("returns undefined for task route", () => {
      expect(getActiveViewFromHash("#/task/t1")).toBeUndefined();
    });
  });
});
