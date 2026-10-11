import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HomeDashboard } from "./HomeDashboard";
import { useFocusBrief } from "../../hooks/useFocusBrief";

vi.mock("../../hooks/useFocusBrief", () => ({ useFocusBrief: vi.fn() }));

describe("Focus without hosted AI", () => {
  beforeEach(() => vi.mocked(useFocusBrief).mockReset());
  it("keeps Today and Tasks navigation available when hosted AI is off", () => {
    vi.mocked(useFocusBrief).mockReturnValue({
      brief: null,
      loading: false,
      error: "HTTP 503",
      refreshing: false,
      unavailable: true,
      refresh: vi.fn(),
      revalidate: vi.fn(),
    });
    const onNavigate = vi.fn();
    render(
      <HomeDashboard
        onTodoClick={vi.fn()}
        onToggleTodo={vi.fn()}
        onSelectProject={vi.fn()}
        onNavigate={onNavigate}
      />,
    );
    expect(screen.getByText("Your tasks are ready")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open Today" }));
    fireEvent.click(screen.getByRole("button", { name: "Open Tasks" }));
    expect(onNavigate.mock.calls).toEqual([["today"], ["all"]]);
  });

  it("preserves actual failure feedback when an enabled service fails", () => {
    vi.mocked(useFocusBrief).mockReturnValue({
      brief: null,
      loading: false,
      error: "HTTP 500",
      refreshing: false,
      unavailable: false,
      refresh: vi.fn(),
      revalidate: vi.fn(),
    });
    render(
      <HomeDashboard
        onTodoClick={vi.fn()}
        onToggleTodo={vi.fn()}
        onSelectProject={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("HTTP 500");
    expect(screen.queryByRole("button", { name: "Open Today" })).toBeNull();
  });
});
