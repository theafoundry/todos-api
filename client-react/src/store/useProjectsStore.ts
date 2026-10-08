import { useState, useCallback, useRef } from "react";
import type { Project } from "../types";
import { fetchProjects } from "../api/projects";

export function useProjectsStore() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);
  const projectsRef = useRef<Project[]>([]);
  const getProjects = useCallback(
    (): readonly Project[] => projectsRef.current,
    [],
  );

  const loadProjects = useCallback(async () => {
    const request = ++sequence.current;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchProjects();
      if (
        !Array.isArray(data) ||
        data.some(
          (project) =>
            typeof project?.id !== "string" || typeof project.name !== "string",
        )
      )
        throw new Error("The project list response was invalid.");
      if (request !== sequence.current) return false;
      projectsRef.current = data;
      setProjects(data);
      return true;
    } catch (reason) {
      if (request === sequence.current)
        setError(
          reason instanceof Error ? reason.message : "Could not load projects.",
        );
      return false;
    } finally {
      if (request === sequence.current) setLoading(false);
    }
  }, []);

  return { projects, getProjects, loading, error, loadProjects };
}
