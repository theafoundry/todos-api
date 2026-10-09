// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
  groupProjectsByArea,
  getVisibleViews,
  VIEW_LABELS,
  STATUS_COLORS,
  AREA_ORDER,
  AREA_LABELS,
} from "./sidebarModels";
import type { Project } from "../../types";

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: overrides.id ?? `p-${Math.random()}`,
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
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("sidebarModels", () => {
  describe("constants", () => {
    it("defines AREA_ORDER with expected values", () => {
      expect(AREA_ORDER).toEqual([
        "home",
        "family",
        "work",
        "finance",
        "side-projects",
      ]);
    });

    it("defines AREA_LABELS with expected values", () => {
      expect(AREA_LABELS.home).toBe("Focus");
      expect(AREA_LABELS["side-projects"]).toBe("Side projects");
    });

    it("defines VIEW_LABELS with expected values", () => {
      expect(VIEW_LABELS.home).toBe("Focus");
      expect(VIEW_LABELS.horizon).toBe("Horizon");
    });

    it("defines STATUS_COLORS with expected values", () => {
      expect(STATUS_COLORS.active).toBe("var(--success)");
      expect(STATUS_COLORS.archived).toBe("var(--muted)");
    });
  });

  describe("groupProjectsByArea", () => {
    it("returns empty array for no projects", () => {
      expect(groupProjectsByArea([])).toEqual([]);
    });

    it("groups unassigned projects together (no label)", () => {
      const projects = [
        makeProject({ id: "p1", name: "A", area: null }),
        makeProject({ id: "p2", name: "B", area: null }),
      ];
      const groups = groupProjectsByArea(projects);
      expect(groups).toHaveLength(1);
      expect(groups[0].label).toBe("");
      expect(groups[0].projects).toHaveLength(2);
    });

    it("groups projects by known areas in AREA_ORDER", () => {
      const projects = [
        makeProject({ id: "p1", name: "Work 1", area: "work" }),
        makeProject({ id: "p2", name: "Family 1", area: "family" }),
        makeProject({ id: "p3", name: "Work 2", area: "work" }),
      ];
      const groups = groupProjectsByArea(projects);
      expect(groups).toHaveLength(2);
      // family comes before work in AREA_ORDER
      expect(groups[0].area).toBe("family");
      expect(groups[1].area).toBe("work");
      expect(groups[1].projects).toHaveLength(2);
    });

    it("uses AREA_LABELS for known area labels", () => {
      const projects = [makeProject({ id: "p1", name: "A", area: "work" })];
      const groups = groupProjectsByArea(projects);
      expect(groups[0].label).toBe("Work");
    });

    it("capitalizes unknown area names", () => {
      const projects = [makeProject({ id: "p1", name: "A", area: "hobby" })];
      const groups = groupProjectsByArea(projects);
      expect(groups[0].label).toBe("Hobby");
    });

    it("sorts unknown areas alphabetically", () => {
      const projects = [
        makeProject({ id: "p1", name: "A", area: "zebra" }),
        makeProject({ id: "p2", name: "B", area: "alpha" }),
      ];
      const groups = groupProjectsByArea(projects);
      expect(groups[0].area).toBe("alpha");
      expect(groups[1].area).toBe("zebra");
    });

    it("filters out archived projects", () => {
      const projects = [
        makeProject({ id: "p1", name: "Active", area: "work" }),
        makeProject({
          id: "p2",
          name: "Archived",
          area: "work",
          archived: true,
        }),
      ];
      const groups = groupProjectsByArea(projects);
      expect(groups).toHaveLength(1);
      expect(groups[0].projects).toHaveLength(1);
      expect(groups[0].projects[0].name).toBe("Active");
    });

    it("places known areas before unknown areas", () => {
      const projects = [
        makeProject({ id: "p1", name: "A", area: "unknown" }),
        makeProject({ id: "p2", name: "B", area: "work" }),
      ];
      const groups = groupProjectsByArea(projects);
      expect(groups[0].area).toBe("work");
      expect(groups[1].area).toBe("unknown");
    });

    it("places ungrouped projects last", () => {
      const projects = [
        makeProject({ id: "p1", name: "A", area: "work" }),
        makeProject({ id: "p2", name: "B", area: null }),
      ];
      const groups = groupProjectsByArea(projects);
      expect(groups[groups.length - 1].label).toBe("");
    });
  });

  describe("getVisibleViews", () => {
    it("returns all views in normal mode", () => {
      const views = getVisibleViews(false);
      expect(views).toEqual([
        "inbox",
        "today",
        "all",
        "home",
        "horizon",
        "completed",
      ]);
    });

    it("excludes home view in simple mode", () => {
      const views = getVisibleViews(true);
      expect(views).toEqual(["inbox", "today", "all", "horizon", "completed"]);
    });
  });
});
