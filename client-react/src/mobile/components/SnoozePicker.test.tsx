// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRef } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { SnoozePicker } from "./SnoozePicker";
import { MutationApiError } from "../../api/mutations";
import { localDateTimeToIso, schedulingPresets } from "../utils/taskDates";

const defaultProps = {
  open: true,
  onClose: vi.fn(),
  onSnooze: vi.fn().mockResolvedValue(undefined),
};

describe("SnoozePicker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 7, 12));
  });
  afterEach(() => vi.useRealTimers());

  it("renders nothing when closed", () => {
    const { container } = render(
      <SnoozePicker {...defaultProps} open={false} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("labels the planned date dialog, time zone and exact preset times", () => {
    render(<SnoozePicker {...defaultProps} />);
    expect(screen.getByRole("dialog", { name: "Plan for…" })).toBeTruthy();
    expect(screen.getByText(/The deadline stays unchanged/)).toBeTruthy();
    schedulingPresets().forEach((preset) =>
      expect(screen.getByText(preset.detail)).toBeTruthy(),
    );
  });

  it("saves the actual preset instant and closes only after success", async () => {
    const onClose = vi.fn();
    const onSnooze = vi.fn().mockResolvedValue(undefined);
    render(
      <SnoozePicker {...defaultProps} onClose={onClose} onSnooze={onSnooze} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Tomorrow/ }));
    expect(onSnooze).toHaveBeenCalledWith(schedulingPresets()[1].value);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("prevents duplicate submissions and dismissal while saving", async () => {
    let finish!: () => void;
    const onClose = vi.fn();
    const onSnooze = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    render(
      <SnoozePicker {...defaultProps} onSnooze={onSnooze} onClose={onClose} />,
    );
    const option = screen.getByRole("button", { name: /^Tomorrow/ });
    fireEvent.click(option);
    fireEvent.click(option);
    expect(onSnooze).toHaveBeenCalledTimes(1);
    expect(option).toBeDisabled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => finish());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("retains a failed preset and retries without losing the selected local date", async () => {
    const onClose = vi.fn();
    const onSnooze = vi
      .fn()
      .mockRejectedValueOnce(new Error("Could not save. Try again."))
      .mockResolvedValueOnce(undefined);
    render(
      <SnoozePicker {...defaultProps} onSnooze={onSnooze} onClose={onClose} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Tomorrow/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not save. Try again.",
    );
    expect(onClose).not.toHaveBeenCalled();
    const input = screen.getByLabelText("Plan for");
    expect(input).toHaveValue("2026-10-08T09:00");
    fireEvent.click(screen.getByRole("button", { name: "Retry planned date" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onSnooze.mock.calls[1][0]).toBe(onSnooze.mock.calls[0][0]);
  });

  it("reveals a labeled datetime input without nesting controls and saves its time", async () => {
    const onSnooze = vi.fn().mockResolvedValue(undefined);
    const { container } = render(
      <SnoozePicker {...defaultProps} onSnooze={onSnooze} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Pick a date/ }));
    const input = screen.getByLabelText("Plan for");
    expect(input.closest("button")).toBeNull();
    expect(container.querySelector("button button")).toBeNull();
    fireEvent.change(input, { target: { value: "2026-10-09T18:30" } });
    fireEvent.click(screen.getByRole("button", { name: "Save planned date" }));
    expect(onSnooze).toHaveBeenCalledWith(
      localDateTimeToIso("2026-10-09T18:30"),
    );
    await waitFor(() => expect(defaultProps.onClose).toHaveBeenCalled());
  });

  it("clears the local selection after the dialog has closed", () => {
    const { rerender } = render(<SnoozePicker {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: /^Pick a date/ }));
    fireEvent.change(screen.getByLabelText("Plan for"), {
      target: { value: "2026-10-09T18:30" },
    });
    rerender(<SnoozePicker {...defaultProps} open={false} />);
    rerender(<SnoozePicker {...defaultProps} />);
    expect(screen.queryByLabelText("Plan for")).toBeNull();
  });
  it.each(["close", "escape", "backdrop", "back"] as const)(
    "retains a dirty planned date and confirms dismissal through %s",
    (method) => {
      const onClose = vi.fn();
      const closeRequestRef = createRef<(() => void) | null>();
      const { container } = render(
        <SnoozePicker
          {...defaultProps}
          onClose={onClose}
          closeRequestRef={closeRequestRef}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: /^Pick a date/ }));
      fireEvent.change(screen.getByLabelText("Plan for"), {
        target: { value: "2026-10-09T18:30" },
      });
      const close = () => {
        if (method === "close")
          fireEvent.click(
            screen.getByRole("button", { name: "Close Plan for…" }),
          );
        else if (method === "escape")
          fireEvent.keyDown(document, { key: "Escape" });
        else if (method === "backdrop")
          fireEvent.click(
            container.querySelector(".m-mobile-modal__backdrop")!,
          );
        else act(() => closeRequestRef.current?.());
      };
      close();
      expect(onClose).not.toHaveBeenCalled();
      expect(
        screen.getByRole("group", { name: "Discard planned date changes?" }),
      ).toBeVisible();
      expect(screen.getByLabelText("Plan for")).toBeDisabled();
      fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
      expect(screen.getByLabelText("Plan for")).toHaveValue("2026-10-09T18:30");
      close();
      fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
      expect(onClose).toHaveBeenCalledTimes(1);
    },
  );

  it("guards the browser Back close callback while pending and releases ownership when closed", async () => {
    let finish!: () => void;
    const onSnooze = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const onClose = vi.fn();
    const closeRequestRef = createRef<(() => void) | null>();
    const { rerender } = render(
      <SnoozePicker
        {...defaultProps}
        onSnooze={onSnooze}
        onClose={onClose}
        closeRequestRef={closeRequestRef}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Tomorrow/ }));
    act(() => closeRequestRef.current?.());
    expect(onClose).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("group", { name: "Discard planned date changes?" }),
    ).toBeNull();
    await act(async () => finish());
    expect(onClose).toHaveBeenCalledTimes(1);
    rerender(
      <SnoozePicker
        {...defaultProps}
        open={false}
        closeRequestRef={closeRequestRef}
      />,
    );
    expect(closeRequestRef.current).toBeNull();
  });

  it("keeps a failed preset draft when its close button is pressed", async () => {
    const onSnooze = vi.fn().mockRejectedValue(new Error("Could not save"));
    const onClose = vi.fn();
    render(
      <SnoozePicker {...defaultProps} onSnooze={onSnooze} onClose={onClose} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Tomorrow/ }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Close Plan for…" }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Plan for")).toHaveValue("2026-10-08T09:00");
    expect(screen.getByRole("button", { name: "Keep editing" })).toBeVisible();
  });
  it.each([
    new MutationApiError("Save response was lost.", "uncertain"),
    new MutationApiError("This change may be queued.", "uncertain", 202),
    new MutationApiError(
      "Server save could not be confirmed.",
      "http",
      503,
      true,
    ),
  ])(
    "blocks writes after %s even when the selected date is edited",
    async (cause) => {
      const onSnooze = vi.fn().mockRejectedValue(cause);
      const onReconcile = vi.fn().mockResolvedValue(false);
      const onClose = vi.fn();
      render(
        <SnoozePicker
          {...defaultProps}
          onSnooze={onSnooze}
          onClose={onClose}
          onReconcile={onReconcile}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: /^Tomorrow/ }));
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Refresh this task before trying to save again",
      );
      expect(screen.getByLabelText("Plan for")).toHaveValue("2026-10-08T09:00");
      expect(screen.getByRole("button", { name: /^Tomorrow/ })).toBeDisabled();
      const retry = screen.getByRole("button", { name: "Retry planned date" });
      expect(retry).toBeDisabled();
      fireEvent.change(screen.getByLabelText("Plan for"), {
        target: { value: "2026-10-09T18:30" },
      });
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Refresh this task before trying to save again",
      );
      expect(retry).toBeDisabled();
      fireEvent.click(retry);
      fireEvent.click(screen.getByRole("button", { name: /^Tomorrow/ }));
      expect(onSnooze).toHaveBeenCalledTimes(1);
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled();
    },
  );

  it("retains the write block after unsuccessful refreshes and guards duplicate refresh, Close and Back while pending", async () => {
    let finish!: (applied: boolean) => void;
    const onReconcile = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            finish = resolve;
          }),
      )
      .mockRejectedValueOnce(new Error("Refresh interrupted."));
    const onSnooze = vi
      .fn()
      .mockRejectedValue(
        new MutationApiError("Save was not confirmed.", "uncertain"),
      );
    const onClose = vi.fn();
    const closeRequestRef = createRef<(() => void) | null>();
    render(
      <SnoozePicker
        {...defaultProps}
        onSnooze={onSnooze}
        onClose={onClose}
        closeRequestRef={closeRequestRef}
        onReconcile={onReconcile}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Tomorrow/ }));
    await screen.findByRole("alert");
    const button = screen.getByRole("button", { name: "Refresh" });
    act(() => {
      fireEvent.click(button);
      fireEvent.click(button);
      closeRequestRef.current?.();
    });
    expect(onReconcile).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: "Close Plan for…" }),
    ).toBeDisabled();
    expect(screen.getByLabelText("Plan for")).toBeDisabled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("group", { name: "Discard planned date changes?" }),
    ).toBeNull();
    await act(async () => finish(false));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not refresh this task",
    );
    expect(
      screen.getByRole("button", { name: "Retry planned date" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Refresh interrupted",
      ),
    );
    expect(
      screen.getByRole("button", { name: "Retry planned date" }),
    ).toBeDisabled();
    expect(screen.getByLabelText("Plan for")).toHaveValue("2026-10-08T09:00");
    expect(onSnooze).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("releases the write block only after a fresh applied task read and requires an explicit save", async () => {
    const onReconcile = vi.fn().mockResolvedValue(true);
    const onSnooze = vi
      .fn()
      .mockRejectedValueOnce(
        new MutationApiError("Save was not confirmed.", "uncertain"),
      )
      .mockResolvedValueOnce(undefined);
    const onClose = vi.fn();
    render(
      <SnoozePicker
        {...defaultProps}
        onSnooze={onSnooze}
        onClose={onClose}
        onReconcile={onReconcile}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Tomorrow/ }));
    await screen.findByRole("alert");
    fireEvent.change(screen.getByLabelText("Plan for"), {
      target: { value: "2026-10-09T18:30" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Review the selected date and save when ready",
      ),
    );
    expect(screen.getByLabelText("Plan for")).toHaveValue("2026-10-09T18:30");
    expect(
      screen.getByRole("button", { name: "Save planned date" }),
    ).toBeEnabled();
    expect(onSnooze).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save planned date" }));
    expect(onSnooze).toHaveBeenLastCalledWith(
      localDateTimeToIso("2026-10-09T18:30"),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("keeps uncertainty guidance and blocks writes when no reconciliation callback is available", async () => {
    const onSnooze = vi
      .fn()
      .mockRejectedValue(
        new MutationApiError("Save was not confirmed.", "uncertain"),
      );
    render(<SnoozePicker {...defaultProps} onSnooze={onSnooze} />);
    fireEvent.click(screen.getByRole("button", { name: /^Tomorrow/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "refresh the task list to check whether the change was saved",
    );
    expect(screen.queryByRole("button", { name: "Refresh" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Retry planned date" }),
    ).toBeDisabled();
  });
});
