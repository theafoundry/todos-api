// @vitest-environment jsdom
import React from "react";
import { ce } from "../../test-helpers";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { AgendaItem } from "../../types/focusBrief";
import { TodayAgendaPanel } from "./TodayAgendaPanel";

vi.mock("./FlipCard", () => ({
  FlipCard: ({ front }: { front: React.ReactNode }) => (
    <div data-testid="flip-mock">{front}</div>
  ),
}));

vi.mock("./TarotCard", () => ({
  TarotCardFront: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="tarot-front">{children}</div>
  ),
  TarotCardBack: () => <div data-testid="tarot-back" />,
}));

vi.mock("./CardBack", () => ({
  CardBackContent: ({ reason }: { reason: string }) => (
    <div data-testid="card-back">{reason}</div>
  ),
}));

vi.mock("./pixel-art", () => ({
  SunriseArt: () => <span data-testid="sunrise-art" />,
}));

describe("TodayAgendaPanel", () => {
  const onTaskClick = vi.fn();
  const onToggle = vi.fn();

  it("shows empty agenda copy", () => {
    render(
      ce(TodayAgendaPanel, {
        items: [],
        onTaskClick,
        onToggle,
      }),
    );
    expect(screen.getByText("All clear. Enjoy your day.")).toBeTruthy();
  });

  it("renders timeline items and forwards task clicks", () => {
    const items: AgendaItem[] = [
      {
        id: "1",
        title: "First task",
        dueDate: null,
        estimateMinutes: 10,
        priority: "normal",
        overdue: false,
        completed: false,
      },
      {
        id: "2",
        title: "Second task",
        dueDate: null,
        estimateMinutes: null,
        priority: "normal",
        overdue: true,
        completed: false,
      },
    ];
    render(
      ce(TodayAgendaPanel, {
        items,
        onTaskClick,
        onToggle,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "First task" }));
    expect(onTaskClick).toHaveBeenCalledWith("1");
    expect(screen.getByText("overdue")).toBeTruthy();
    expect(screen.getByText("10m")).toBeTruthy();
  });

  it("shows light day hint when there are at most two items", () => {
    const items: AgendaItem[] = [
      {
        id: "1",
        title: "Only",
        dueDate: null,
        estimateMinutes: null,
        priority: "low",
        overdue: false,
        completed: false,
      },
    ];
    render(
      ce(TodayAgendaPanel, {
        items,
        onTaskClick,
        onToggle,
      }),
    );
    expect(screen.getByText(/Light day/)).toBeTruthy();
  });

  it("separates completion from opening a task and disables duplicate actions while pending", () => {
    const onToggle = vi.fn();
    const onTaskClick = vi.fn();
    const items: AgendaItem[] = [
      {
        id: "1",
        title: "Agenda task",
        dueDate: null,
        estimateMinutes: null,
        priority: "normal",
        overdue: false,
        completed: false,
      },
    ];
    const { rerender } = render(
      ce(TodayAgendaPanel, { items, onTaskClick, onToggle }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Complete Agenda task" }),
    );
    expect(onToggle).toHaveBeenCalledWith("1", true);
    expect(onTaskClick).not.toHaveBeenCalled();
    rerender(
      ce(TodayAgendaPanel, {
        items,
        onTaskClick,
        onToggle,
        pendingIds: new Set(["1"]),
      }),
    );
    const toggle = screen.getByRole("button", { name: "Complete Agenda task" });
    expect(toggle).toBeDisabled();
    expect(toggle).toHaveAttribute("aria-busy", "true");
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledOnce();
    rerender(
      ce(TodayAgendaPanel, {
        items: [{ ...items[0], completed: true }],
        onTaskClick,
        onToggle,
      }),
    );
    const reopen = screen.getByRole("button", { name: "Reopen Agenda task" });
    expect(reopen).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(reopen);
    expect(onToggle).toHaveBeenLastCalledWith("1", false);
  });
});
