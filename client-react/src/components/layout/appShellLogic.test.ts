// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
  computeSnoozePayload,
  getLifecycleUndoMessage,
  getPageLabel,
  buildDocumentTitle,
  getHeaderTitle,
  getActiveViewKey,
  dispatchKeyboardShortcut,
  computeNextNavIndex,
  computeSelectAllResult,
  computeExportCalendarResult,
  createDraftProject,
  DRAFT_PROJECT_ID,
  VIEW_LABELS,
} from "./appShellLogic";
import type { SnoozeAction } from "./appShellLogic";

describe("appShellLogic", () => {
  describe("computeSnoozePayload", () => {
    it("returns cancelled status for cancel action", () => {
      expect(computeSnoozePayload("cancel")).toEqual({ status: "cancelled" });
    });

    it("returns inbox status for reopen action", () => {
      expect(computeSnoozePayload("reopen")).toEqual({ status: "inbox" });
    });

    it("returns archived true for archive action", () => {
      expect(computeSnoozePayload("archive")).toEqual({ archived: true });
    });

    it("returns tomorrow date for snooze-tomorrow", () => {
      const now = new Date("2026-04-13T12:00:00Z");
      const result = computeSnoozePayload("snooze-tomorrow", now);
      expect(result.status).toBe("scheduled");
      expect(result.scheduledDate).toBe("2026-04-14");
    });

    it("returns next week date for snooze-next-week", () => {
      const now = new Date("2026-04-13T12:00:00Z");
      const result = computeSnoozePayload("snooze-next-week", now);
      expect(result.status).toBe("scheduled");
      expect(result.scheduledDate).toBe("2026-04-20");
    });

    it("returns next month date for snooze-next-month", () => {
      const now = new Date("2026-04-13T12:00:00Z");
      const result = computeSnoozePayload("snooze-next-month", now);
      expect(result.status).toBe("scheduled");
      expect(result.scheduledDate).toBe("2026-05-13");
    });

    it("handles month boundary correctly", () => {
      const now = new Date("2026-01-31T12:00:00Z");
      const result = computeSnoozePayload("snooze-next-month", now);
      // Feb has 28 days in 2026, so next month from Jan 31 is Feb 28 or Mar 3
      expect(result.status).toBe("scheduled");
      expect(result.scheduledDate).toMatch(/^2026-0[23]-/);
    });
  });

  describe("getLifecycleUndoMessage", () => {
    it.each<[SnoozeAction, string]>([
      ["cancel", "Task cancelled"],
      ["reopen", "Task reopened"],
      ["archive", "Task archived"],
      ["snooze-tomorrow", "Snoozed until tomorrow"],
      ["snooze-next-week", "Snoozed until next week"],
      ["snooze-next-month", "Snoozed until next month"],
    ])("returns '%s' for %s action", (action, expected) => {
      expect(getLifecycleUndoMessage(action, "Test task")).toBe(expected);
    });
  });

  describe("getPageLabel", () => {
    it.each([
      ["settings", "Settings"],
      ["components", "Component Gallery"],
      ["admin", "Admin"],
      ["feedback", "Feedback"],
      ["review", "Weekly Review"],
      ["activity", "Agent Activity"],
      ["todos", ""],
    ])("returns '%s' for %s page", (page, expected) => {
      expect(getPageLabel(page as any)).toBe(expected);
    });
  });

  describe("buildDocumentTitle", () => {
    it("uses headerTitle for todos page", () => {
      expect(buildDocumentTitle("todos", "Focus")).toBe("Focus — Planwren");
    });

    it.each([
      ["settings", "Settings — Planwren"],
      ["admin", "Admin — Planwren"],
      ["feedback", "Feedback — Planwren"],
      ["review", "Weekly Review — Planwren"],
    ])("uses page label for %s page", (page, expected) => {
      expect(buildDocumentTitle(page as any, "Ignored")).toBe(expected);
    });
  });

  describe("VIEW_LABELS", () => {
    it("has labels for all workspace views", () => {
      expect(VIEW_LABELS.home).toBe("Focus");
      expect(VIEW_LABELS.all).toBe("Everything");
      expect(VIEW_LABELS.today).toBe("Today");
      expect(VIEW_LABELS.horizon).toBe("Horizon");
      expect(VIEW_LABELS.completed).toBe("Completed");
    });
  });

  describe("getHeaderTitle", () => {
    it("returns project name when project selected", () => {
      expect(getHeaderTitle("home", "p1", "My Project")).toBe("My Project");
    });

    it("returns 'Project' when project selected but name is null", () => {
      expect(getHeaderTitle("home", "p1", null)).toBe("Project");
    });

    it("returns view label when no project selected", () => {
      expect(getHeaderTitle("today", null, null)).toBe("Today");
      expect(getHeaderTitle("horizon", null, null)).toBe("Horizon");
    });

    it("returns activeView as fallback for unknown view", () => {
      expect(getHeaderTitle("unknown" as any, null, null)).toBe("unknown");
    });
  });

  describe("getActiveViewKey", () => {
    it("returns project:ID for selected project", () => {
      expect(getActiveViewKey("home", "p1")).toBe("project:p1");
    });

    it("returns view key when no project selected", () => {
      expect(getActiveViewKey("today", null)).toBe("today");
    });
  });

  describe("dispatchKeyboardShortcut", () => {
    describe("Escape key", () => {
      it("closes palette when palette is open", () => {
        expect(
          dispatchKeyboardShortcut({
            key: "Escape",
            metaKey: false,
            ctrlKey: false,
            inInput: false,
            paletteOpen: true,
            activeTodoId: null,
            bulkMode: false,
            mobileNavOpen: false,
            visibleTodoIds: [],
          }),
        ).toEqual({ type: "close-palette" });
      });

      it("deescalates when active todo exists", () => {
        expect(
          dispatchKeyboardShortcut({
            key: "Escape",
            metaKey: false,
            ctrlKey: false,
            inInput: false,
            paletteOpen: false,
            activeTodoId: "t1",
            bulkMode: false,
            mobileNavOpen: false,
            visibleTodoIds: [],
          }),
        ).toEqual({ type: "deescalate" });
      });

      it("cancels bulk when bulk mode is active", () => {
        expect(
          dispatchKeyboardShortcut({
            key: "Escape",
            metaKey: false,
            ctrlKey: false,
            inInput: false,
            paletteOpen: false,
            activeTodoId: null,
            bulkMode: true,
            mobileNavOpen: false,
            visibleTodoIds: [],
          }),
        ).toEqual({ type: "cancel-bulk" });
      });

      it("closes mobile nav when mobile nav is open", () => {
        expect(
          dispatchKeyboardShortcut({
            key: "Escape",
            metaKey: false,
            ctrlKey: false,
            inInput: false,
            paletteOpen: false,
            activeTodoId: null,
            bulkMode: false,
            mobileNavOpen: true,
            visibleTodoIds: [],
          }),
        ).toEqual({ type: "close-mobile-nav" });
      });

      it("does nothing when nothing is open", () => {
        expect(
          dispatchKeyboardShortcut({
            key: "Escape",
            metaKey: false,
            ctrlKey: false,
            inInput: false,
            paletteOpen: false,
            activeTodoId: null,
            bulkMode: false,
            mobileNavOpen: false,
            visibleTodoIds: [],
          }),
        ).toEqual({ type: "none" });
      });
    });

    describe("Cmd/Ctrl+K", () => {
      it("toggles palette with metaKey", () => {
        expect(
          dispatchKeyboardShortcut({
            key: "k",
            metaKey: true,
            ctrlKey: false,
            inInput: false,
            paletteOpen: false,
            activeTodoId: null,
            bulkMode: false,
            mobileNavOpen: false,
            visibleTodoIds: [],
          }),
        ).toEqual({ type: "toggle-palette" });
      });

      it("toggles palette with ctrlKey", () => {
        expect(
          dispatchKeyboardShortcut({
            key: "k",
            metaKey: false,
            ctrlKey: true,
            inInput: false,
            paletteOpen: false,
            activeTodoId: null,
            bulkMode: false,
            mobileNavOpen: false,
            visibleTodoIds: [],
          }),
        ).toEqual({ type: "toggle-palette" });
      });
    });

    describe("single key shortcuts (not in input)", () => {
      it("n focuses quick entry", () => {
        expect(
          dispatchKeyboardShortcut({
            key: "n",
            metaKey: false,
            ctrlKey: false,
            inInput: false,
            paletteOpen: false,
            activeTodoId: null,
            bulkMode: false,
            mobileNavOpen: false,
            visibleTodoIds: [],
          }),
        ).toEqual({ type: "focus-quick-entry" });
      });

      it("v toggles view menu", () => {
        expect(
          dispatchKeyboardShortcut({
            key: "v",
            metaKey: false,
            ctrlKey: false,
            inInput: false,
            paletteOpen: false,
            activeTodoId: null,
            bulkMode: false,
            mobileNavOpen: false,
            visibleTodoIds: [],
          }),
        ).toEqual({ type: "toggle-view-menu" });
      });

      it("/ focuses search", () => {
        expect(
          dispatchKeyboardShortcut({
            key: "/",
            metaKey: false,
            ctrlKey: false,
            inInput: false,
            paletteOpen: false,
            activeTodoId: null,
            bulkMode: false,
            mobileNavOpen: false,
            visibleTodoIds: [],
          }),
        ).toEqual({ type: "focus-search" });
      });

      it("? toggles shortcuts", () => {
        expect(
          dispatchKeyboardShortcut({
            key: "?",
            metaKey: false,
            ctrlKey: false,
            inInput: false,
            paletteOpen: false,
            activeTodoId: null,
            bulkMode: false,
            mobileNavOpen: false,
            visibleTodoIds: [],
          }),
        ).toEqual({ type: "toggle-shortcuts" });
      });

      it("ignores shortcuts when in input", () => {
        expect(
          dispatchKeyboardShortcut({
            key: "n",
            metaKey: false,
            ctrlKey: false,
            inInput: true,
            paletteOpen: false,
            activeTodoId: null,
            bulkMode: false,
            mobileNavOpen: false,
            visibleTodoIds: [],
          }),
        ).toEqual({ type: "none" });
      });
    });

    describe("navigation (j/k)", () => {
      it("j navigates down when active todo exists", () => {
        expect(
          dispatchKeyboardShortcut({
            key: "j",
            metaKey: false,
            ctrlKey: false,
            inInput: false,
            paletteOpen: false,
            activeTodoId: "t1",
            bulkMode: false,
            mobileNavOpen: false,
            visibleTodoIds: ["t1", "t2", "t3"],
          }),
        ).toEqual({ type: "navigate-down", count: 3 });
      });

      it("k navigates up when active todo exists", () => {
        expect(
          dispatchKeyboardShortcut({
            key: "k",
            metaKey: false,
            ctrlKey: false,
            inInput: false,
            paletteOpen: false,
            activeTodoId: "t2",
            bulkMode: false,
            mobileNavOpen: false,
            visibleTodoIds: ["t1", "t2", "t3"],
          }),
        ).toEqual({ type: "navigate-up", count: 3 });
      });

      it("j does nothing when no active todo", () => {
        expect(
          dispatchKeyboardShortcut({
            key: "j",
            metaKey: false,
            ctrlKey: false,
            inInput: false,
            paletteOpen: false,
            activeTodoId: null,
            bulkMode: false,
            mobileNavOpen: false,
            visibleTodoIds: ["t1", "t2"],
          }),
        ).toEqual({ type: "none" });
      });
    });

    describe("task actions (x/e/d)", () => {
      it("x toggles complete when active todo exists", () => {
        expect(
          dispatchKeyboardShortcut({
            key: "x",
            metaKey: false,
            ctrlKey: false,
            inInput: false,
            paletteOpen: false,
            activeTodoId: "t1",
            bulkMode: false,
            mobileNavOpen: false,
            visibleTodoIds: [],
          }),
        ).toEqual({ type: "toggle-complete", todoId: "t1" });
      });

      it("e opens drawer when active todo exists", () => {
        expect(
          dispatchKeyboardShortcut({
            key: "e",
            metaKey: false,
            ctrlKey: false,
            inInput: false,
            paletteOpen: false,
            activeTodoId: "t1",
            bulkMode: false,
            mobileNavOpen: false,
            visibleTodoIds: [],
          }),
        ).toEqual({ type: "open-drawer", todoId: "t1" });
      });

      it("d requests delete when active todo exists", () => {
        expect(
          dispatchKeyboardShortcut({
            key: "d",
            metaKey: false,
            ctrlKey: false,
            inInput: false,
            paletteOpen: false,
            activeTodoId: "t1",
            bulkMode: false,
            mobileNavOpen: false,
            visibleTodoIds: [],
          }),
        ).toEqual({ type: "request-delete", todoId: "t1" });
      });

      it("x does nothing when no active todo", () => {
        expect(
          dispatchKeyboardShortcut({
            key: "x",
            metaKey: false,
            ctrlKey: false,
            inInput: false,
            paletteOpen: false,
            activeTodoId: null,
            bulkMode: false,
            mobileNavOpen: false,
            visibleTodoIds: [],
          }),
        ).toEqual({ type: "none" });
      });
    });

    describe("unknown key", () => {
      it("returns none for unrecognized key", () => {
        expect(
          dispatchKeyboardShortcut({
            key: "z",
            metaKey: false,
            ctrlKey: false,
            inInput: false,
            paletteOpen: false,
            activeTodoId: null,
            bulkMode: false,
            mobileNavOpen: false,
            visibleTodoIds: [],
          }),
        ).toEqual({ type: "none" });
      });
    });
  });

  describe("computeNextNavIndex", () => {
    it("moves down from middle", () => {
      expect(computeNextNavIndex("t2", "down", ["t1", "t2", "t3"])).toBe(2);
    });

    it("moves up from middle", () => {
      expect(computeNextNavIndex("t2", "up", ["t1", "t2", "t3"])).toBe(0);
    });

    it("wraps down from last to first", () => {
      expect(computeNextNavIndex("t3", "down", ["t1", "t2", "t3"])).toBe(0);
    });

    it("wraps up from first to last", () => {
      expect(computeNextNavIndex("t1", "up", ["t1", "t2", "t3"])).toBe(2);
    });

    it("returns 0 when no active todo", () => {
      expect(computeNextNavIndex(null, "down", ["t1", "t2"])).toBe(0);
    });

    it("returns 0 when active todo not in list", () => {
      expect(computeNextNavIndex("t99", "down", ["t1", "t2"])).toBe(0);
    });
  });

  describe("computeSelectAllResult", () => {
    it("selects all when none selected", () => {
      const result = computeSelectAllResult(new Set(), ["t1", "t2", "t3"]);
      expect(result).toEqual(new Set(["t1", "t2", "t3"]));
    });

    it("clears selection when all selected", () => {
      const result = computeSelectAllResult(
        new Set(["t1", "t2", "t3"]),
        ["t1", "t2", "t3"],
      );
      expect(result).toEqual(new Set());
    });

    it("selects all when some selected", () => {
      const result = computeSelectAllResult(
        new Set(["t1"]),
        ["t1", "t2", "t3"],
      );
      expect(result).toEqual(new Set(["t1", "t2", "t3"]));
    });

    it("clears selection when partial match equals visible count", () => {
      // Edge case: selected set has same size as visible list
      const result = computeSelectAllResult(
        new Set(["t1", "t2", "t3"]),
        ["t1", "t2", "t3"],
      );
      expect(result).toEqual(new Set());
    });
  });

  describe("computeExportCalendarResult", () => {
    it("returns no tasks message when count is 0", () => {
      expect(computeExportCalendarResult(0)).toEqual({
        count: 0,
        message: "No tasks with due dates to export",
      });
    });

    it("returns exported message for 1 task", () => {
      expect(computeExportCalendarResult(1)).toEqual({
        count: 1,
        message: "Exported 1 task to .ics",
      });
    });

    it("returns exported message for multiple tasks", () => {
      expect(computeExportCalendarResult(5)).toEqual({
        count: 5,
        message: "Exported 5 tasks to .ics",
      });
    });
  });

  describe("createDraftProject", () => {
    it("creates a draft project with expected defaults", () => {
      const now = new Date("2026-04-13T12:00:00Z");
      const project = createDraftProject(now);
      expect(project.id).toBe(DRAFT_PROJECT_ID);
      expect(project.name).toBe("");
      expect(project.status).toBe("active");
      expect(project.archived).toBe(false);
      expect(project.userId).toBe("draft-user");
      expect(project.createdAt).toBe("2026-04-13T12:00:00.000Z");
      expect(project.updatedAt).toBe("2026-04-13T12:00:00.000Z");
    });

    it("uses current time when no date provided", () => {
      const project = createDraftProject();
      expect(project.createdAt).toBeTruthy();
      expect(project.updatedAt).toBeTruthy();
    });
  });
});
