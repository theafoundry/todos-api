// @vitest-environment jsdom
import { ce } from "../../test-helpers";
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";

// Mock dependencies before importing QuickEntry
vi.mock("../../hooks/useCaptureRoute", () => ({
  useCaptureRoute: () => ({
    suggestion: null,
    loading: false,
    preferredRoute: "task",
    alternateRoute: "triage",
  }),
}));

vi.mock("../ai/AiOnCreateAssist", () => ({
  AiOnCreateAssist: () => null,
}));

import { QuickEntry } from "./QuickEntry";

describe("QuickEntry", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  const defaultProps = {
    onAddTask: vi.fn().mockResolvedValue(undefined),
    onCaptureToDesk: vi.fn().mockResolvedValue(undefined),
  };

  it("retains a failed capture draft and clears it after an explicit successful retry", async () => {
    const onCaptureToDesk = vi
      .fn()
      .mockRejectedValueOnce(new Error("Could not save to Inbox"))
      .mockResolvedValueOnce(undefined);
    render(ce(QuickEntry, { ...defaultProps, onCaptureToDesk }));
    const input = screen.getByPlaceholderText("Add a task…");
    fireEvent.change(input, { target: { value: "Review next week" } });
    fireEvent.click(screen.getByRole("button", { name: "Save to Inbox" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not save to Inbox",
    );
    expect(input).toHaveValue("Review next week");
    fireEvent.click(screen.getByRole("button", { name: "Save to Inbox" }));
    await waitFor(() => expect(input).toHaveValue(""));
    expect(onCaptureToDesk).toHaveBeenCalledTimes(2);
  });

  it("renders input with default placeholder", () => {
    render(ce(QuickEntry, defaultProps));
    expect(screen.getByPlaceholderText("Add a task…")).toBeTruthy();
  });

  it("renders with custom placeholder", () => {
    render(ce(QuickEntry, { ...defaultProps, placeholder: "Custom…" }));
    expect(screen.getByPlaceholderText("Custom…")).toBeTruthy();
  });

  it("renders Create task and Save to Inbox buttons", () => {
    render(ce(QuickEntry, defaultProps));
    expect(
      screen.getByRole("button", { name: "Create task now" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save to Inbox" })).toBeTruthy();
  });

  it("disables buttons when input is empty", () => {
    render(ce(QuickEntry, defaultProps));
    expect(
      screen.getByRole("button", { name: "Create task now" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Save to Inbox" }),
    ).toBeDisabled();
  });

  it("enables buttons when input has text", () => {
    render(ce(QuickEntry, defaultProps));
    fireEvent.change(screen.getByPlaceholderText("Add a task…"), {
      target: { value: "Test task" },
    });
    expect(
      screen.getByRole("button", { name: "Create task now" }),
    ).not.toBeDisabled();
  });

  it("calls onAddTask when submitting", async () => {
    render(ce(QuickEntry, defaultProps));
    fireEvent.change(screen.getByPlaceholderText("Add a task…"), {
      target: { value: "Test task" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create task now" }));
    });
    expect(defaultProps.onAddTask).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Test task" }),
    );
  });

  it("calls onCaptureToDesk when submitting alternate route", async () => {
    render(ce(QuickEntry, defaultProps));
    fireEvent.change(screen.getByPlaceholderText("Add a task…"), {
      target: { value: "Test task" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save to Inbox" }));
    });
    expect(defaultProps.onCaptureToDesk).toHaveBeenCalledWith("Test task");
  });

  it("clears input after submission", async () => {
    render(ce(QuickEntry, defaultProps));
    const input = screen.getByPlaceholderText("Add a task…");
    fireEvent.change(input, { target: { value: "Test task" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create task now" }));
    });
    expect(input).toHaveValue("");
  });

  it("submits on Enter key", async () => {
    render(ce(QuickEntry, defaultProps));
    const input = screen.getByPlaceholderText("Add a task…");
    fireEvent.change(input, { target: { value: "Test task" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    expect(defaultProps.onAddTask).toHaveBeenCalled();
  });

  it("includes projectId when provided", async () => {
    render(ce(QuickEntry, { ...defaultProps, projectId: "p1" }));
    fireEvent.change(screen.getByPlaceholderText("Add a task…"), {
      target: { value: "Test task" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create task now" }));
    });
    expect(defaultProps.onAddTask).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "p1" }),
    );
  });

  it("shows date chip for natural language dates", async () => {
    render(ce(QuickEntry, defaultProps));
    const input = screen.getByPlaceholderText("Add a task…");
    fireEvent.change(input, { target: { value: "Test task tomorrow" } });
    await waitFor(
      () => {
        expect(screen.getByText("Tomorrow")).toBeTruthy();
      },
      { timeout: 500 },
    );
  });

  it("toggles date applied on chip click", async () => {
    render(ce(QuickEntry, defaultProps));
    const input = screen.getByPlaceholderText("Add a task…");
    fireEvent.change(input, { target: { value: "Test task tomorrow" } });
    await waitFor(
      () => {
        expect(screen.getByText("Tomorrow")).toBeTruthy();
      },
      { timeout: 500 },
    );

    const chip = screen.getByText("Tomorrow").closest("button");
    await act(async () => {
      fireEvent.click(chip!);
    });

    await waitFor(() => {
      expect(screen.getByText("Tomorrow").closest("button")).toHaveClass(
        "natural-date-chip--applied",
      );
    });
  });

  it("shows saving state during submission", async () => {
    const onAddTask = vi.fn().mockImplementation(() => new Promise(() => {}));
    render(ce(QuickEntry, { ...defaultProps, onAddTask }));
    fireEvent.change(screen.getByPlaceholderText("Add a task…"), {
      target: { value: "Test task" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create task now" }));
    });
    expect(screen.getByRole("button", { name: "Saving…" })).toBeTruthy();
  });

  it("includes dueDate when date chip is applied", async () => {
    render(ce(QuickEntry, defaultProps));
    const input = screen.getByPlaceholderText("Add a task…");
    fireEvent.change(input, { target: { value: "Test task tomorrow" } });
    await waitFor(
      () => {
        expect(screen.getByText("Tomorrow")).toBeTruthy();
      },
      { timeout: 500 },
    );

    // Click chip to apply date (first click toggles to applied)
    const chip = screen.getByText("Tomorrow").closest("button");
    await act(async () => {
      fireEvent.click(chip!);
    });

    // Verify chip is now in applied state
    await waitFor(() => {
      expect(screen.getByText("Tomorrow").closest("button")).toHaveClass(
        "natural-date-chip--applied",
      );
    });

    // Submit
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create task now" }));
    });

    // Verify onAddTask was called with a dueDate
    expect(defaultProps.onAddTask).toHaveBeenCalled();
    const callArgs = defaultProps.onAddTask.mock.calls[0][0];
    expect(callArgs.dueDate).toBeTruthy();
  });
});
