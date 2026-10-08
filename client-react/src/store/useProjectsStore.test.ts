import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import * as projectsApi from "../api/projects";
import { useProjectsStore } from "./useProjectsStore";
import type { Project } from "../types";

vi.mock("../api/projects");

const makeProject = (overrides: Partial<Project> = {}): Project => ({
  id: overrides.id ?? "proj-1",
  name: overrides.name ?? "Test Project",
  description: overrides.description ?? null,
  status: overrides.status ?? "active",
  priority: overrides.priority ?? null,
  area: overrides.area ?? null,
  areaId: overrides.areaId ?? null,
  targetDate: overrides.targetDate ?? null,
  archived: overrides.archived ?? false,
  todoCount: overrides.todoCount ?? 0,
  openTodoCount: overrides.openTodoCount ?? 0,
  completedTaskCount: overrides.completedTaskCount ?? 0,
  userId: overrides.userId ?? "user-1",
  createdAt: overrides.createdAt ?? "2026-01-01T00:00:00.000Z",
  updatedAt: overrides.updatedAt ?? "2026-01-01T00:00:00.000Z",
});

describe("useProjectsStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("initial state", () => {
    it("starts with empty projects and not loading", () => {
      const { result } = renderHook(() => useProjectsStore());
      expect(result.current.projects).toEqual([]);
      expect(result.current.loading).toBe(false);
    });
  });

  describe("loadProjects", () => {
    it("loads projects successfully", async () => {
      const projects = [makeProject({ id: "1" }), makeProject({ id: "2" })];
      vi.mocked(projectsApi.fetchProjects).mockResolvedValue(projects);

      const { result } = renderHook(() => useProjectsStore());

      await act(async () => {
        await result.current.loadProjects();
        expect(result.current.getProjects()).toEqual(projects);
      });

      expect(projectsApi.fetchProjects).toHaveBeenCalled();
      expect(result.current.projects).toEqual(projects);
      expect(result.current.loading).toBe(false);
    });

    it("handles load failure gracefully (projects may not be configured)", async () => {
      vi.mocked(projectsApi.fetchProjects).mockRejectedValue(
        new Error("Not configured"),
      );

      const { result } = renderHook(() => useProjectsStore());

      await act(async () => {
        await result.current.loadProjects();
      });

      // Should not crash — projects stay empty, loading stops
      expect(result.current.projects).toEqual([]);
      expect(result.current.loading).toBe(false);
    });

    it("retains visible projects and reports a failed refresh truthfully", async () => {
      const project = makeProject();
      vi.mocked(projectsApi.fetchProjects)
        .mockResolvedValueOnce([project])
        .mockRejectedValueOnce(new Error("Connection lost"));
      const { result } = renderHook(() => useProjectsStore());
      await act(async () => {
        expect(await result.current.loadProjects()).toBe(true);
      });
      await act(async () => {
        expect(await result.current.loadProjects()).toBe(false);
      });
      expect(result.current.projects).toEqual([project]);
      expect(result.current.error).toBe("Connection lost");
    });
  });
});
