// @vitest-environment jsdom
import { ce } from "../../test-helpers";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PullToSearch } from "./PullToSearch";
const todos = [
  {
    id: "t1",
    title: "Write report",
    description: "Important",
    notes: "Call finance",
    completed: false,
    archived: false,
    tags: ["work"],
    projectId: "p1",
  },
  { id: "t2", title: "Archived item", archived: true, tags: [] },
];
const projects = [
  {
    id: "p1",
    name: "Work",
    status: "active",
    archived: false,
    userId: "u1",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
  },
];
describe("explicit mobile search", () => {
  it("list touch gestures never open search", () => {
    render(ce(PullToSearch, { todos, projects, onSelectResult: vi.fn() }));
    fireEvent.touchStart(document, { touches: [{ clientY: 10 }] });
    fireEvent.touchEnd(document, { changedTouches: [{ clientY: 250 }] });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it.each(["report", "finance", "work"])(
    "finds tasks by %s without a server mutation",
    (query) => {
      const select = vi.fn();
      render(
        ce(PullToSearch, {
          open: true,
          todos,
          projects,
          onSelectResult: select,
        }),
      );
      expect(screen.getByRole("dialog", { name: "Search tasks" })).toBeTruthy();
      const input = screen.getByRole("searchbox", { name: "Search tasks" });
      expect(document.activeElement).toBe(input);
      fireEvent.change(input, { target: { value: query } });
      fireEvent.click(screen.getByRole("button", { name: /Write report/ }));
      expect(select).toHaveBeenCalledWith("t1");
    },
  );
  it("excludes archived tasks and shows a truthful empty result", () => {
    render(
      ce(PullToSearch, {
        open: true,
        todos,
        projects,
        onSelectResult: vi.fn(),
      }),
    );
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "Archived" },
    });
    expect(screen.getByRole("status").textContent).toContain(
      "0 matching tasks",
    );
    expect(screen.getByText("No matching tasks")).toBeTruthy();
  });
  it("Cancel and Escape use the owned close callback", () => {
    const close = vi.fn();
    render(
      ce(PullToSearch, {
        open: true,
        todos,
        projects,
        onClose: close,
        onSelectResult: vi.fn(),
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(close).toHaveBeenCalledTimes(2);
  });
});
