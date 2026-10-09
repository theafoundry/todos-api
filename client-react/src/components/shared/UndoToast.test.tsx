// @vitest-environment jsdom
import { createElement } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UndoToast } from "./UndoToast";

describe("UndoToast", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing when action is null", () => {
    render(
      createElement(UndoToast, {
        action: null,
        onDismiss: vi.fn(),
      }),
    );
    const toast = document.getElementById("undoToast");
    expect(toast).toBeTruthy();
    expect(toast).not.toHaveClass("active");
  });

  it("renders toast message when action is provided", () => {
    render(
      createElement(UndoToast, {
        action: { message: "Task deleted" },
        onDismiss: vi.fn(),
      }),
    );
    expect(screen.getByText("Task deleted")).toBeTruthy();
    const toast = document.getElementById("undoToast");
    expect(toast).toHaveClass("active");
  });

  it("renders Undo button when onUndo is provided", () => {
    render(
      createElement(UndoToast, {
        action: { message: "Task deleted", onUndo: vi.fn() },
        onDismiss: vi.fn(),
      }),
    );
    expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();
  });

  it("uses a supplied navigation label for a capture acknowledgment", () => {
    const onUndo = vi.fn();
    render(
      createElement(UndoToast, {
        action: {
          message: "Saved to Inbox for review",
          actionLabel: "Open Inbox",
          onUndo,
        },
        onDismiss: vi.fn(),
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Open Inbox" }));
    expect(onUndo).toHaveBeenCalledOnce();
  });

  it("calls onUndo and onDismiss when Undo button is clicked", () => {
    const onUndo = vi.fn();
    const onDismiss = vi.fn();
    render(
      createElement(UndoToast, {
        action: { message: "Task deleted", onUndo },
        onDismiss,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(onUndo).toHaveBeenCalled();
    expect(onDismiss).toHaveBeenCalled();
  });

  it("applies variant class when provided", () => {
    render(
      createElement(UndoToast, {
        action: { message: "Error occurred", variant: "error" },
        onDismiss: vi.fn(),
      }),
    );
    expect(document.getElementById("undoToast")).toHaveClass(
      "undo-toast--error",
    );
  });

  it("shows progress bar when toast is visible", () => {
    render(
      createElement(UndoToast, {
        action: { message: "Task deleted" },
        onDismiss: vi.fn(),
      }),
    );
    expect(document.querySelector(".undo-toast__progress")).toBeTruthy();
  });

  it("auto-dismisses after 5 seconds", async () => {
    const onDismiss = vi.fn();
    render(
      createElement(UndoToast, {
        action: { message: "Task deleted" },
        onDismiss,
      }),
    );

    await vi.advanceTimersByTimeAsync(5000);
    // The 200ms exit animation timer
    await vi.advanceTimersByTimeAsync(200);

    expect(onDismiss).toHaveBeenCalled();
  });

  it("applies exiting class after auto-dismiss timeout", async () => {
    render(
      createElement(UndoToast, {
        action: { message: "Task deleted" },
        onDismiss: vi.fn(),
      }),
    );

    await vi.advanceTimersByTimeAsync(5000);
    // Let React process the state update
    await vi.advanceTimersByTimeAsync(0);

    expect(document.getElementById("undoToast")).toHaveClass(
      "undo-toast--exiting",
    );
  });

  it("clears timer when action changes", () => {
    const onDismiss = vi.fn();
    const { rerender } = render(
      createElement(UndoToast, {
        action: { message: "Task deleted" },
        onDismiss,
      }),
    );

    vi.advanceTimersByTime(2500);

    // Change action - should reset timer
    rerender(
      createElement(UndoToast, {
        action: { message: "New action" },
        onDismiss,
      }),
    );

    vi.advanceTimersByTime(5000);

    // onDismiss should still only be called once per timer cycle
    // The new action starts a new 5s timer
  });

  it("hides when action becomes null", () => {
    const onDismiss = vi.fn();
    const { rerender } = render(
      createElement(UndoToast, {
        action: { message: "Task deleted" },
        onDismiss,
      }),
    );

    expect(document.getElementById("undoToast")).toHaveClass("active");

    rerender(
      createElement(UndoToast, {
        action: null,
        onDismiss,
      }),
    );

    expect(document.getElementById("undoToast")).not.toHaveClass("active");
  });
});
