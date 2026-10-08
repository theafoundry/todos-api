import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { ce } from "../../test-helpers";
import { TodoApiError } from "../../api/todos";
import type { Todo } from "../../types";
import { deadlineDateToIso, localDateTimeToIso } from "../utils/taskDates";
import { TaskEditor } from "./TaskEditor";

afterEach(cleanup);

function makeTodo(overrides: Partial<Todo> = {}): Todo {
  return {
    id: "task-1",
    title: "Review proposal",
    status: "next",
    completed: false,
    tags: [],
    dependsOnTaskIds: [],
    order: 0,
    archived: false,
    userId: "user-1",
    createdAt: "2026-10-08T09:00:00.000Z",
    updatedAt: "2026-10-08T09:00:00.000Z",
    ...overrides,
  };
}

function deferred() {
  let resolve!: (value?: unknown) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<unknown>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function setup(
  todo = makeTodo(),
  onSave = vi.fn().mockResolvedValue(undefined),
  onReconcile?: () => Promise<boolean>,
) {
  const onCancel = vi.fn();
  const onSaved = vi.fn();
  const closeRequestRef = createRef<(() => void) | null>();
  const props = {
    open: true,
    todo,
    projects: [],
    onSave,
    onReconcile,
    onCancel,
    onSaved,
    closeRequestRef,
  };
  const view = render(ce(TaskEditor, props));
  return { ...view, props, onSave, onCancel, onSaved, closeRequestRef };
}

function openMore() {
  fireEvent.click(screen.getByRole("button", { name: "More details" }));
}

describe("TaskEditor", () => {
  it("discloses real editable fields and submits one complete draft after local typing", async () => {
    const pending = deferred();
    const onSave = vi.fn().mockReturnValue(pending.promise);
    const { onSaved } = setup(makeTodo(), onSave);
    expect(screen.getByRole("dialog", { name: "Edit task" })).toBeTruthy();
    expect(screen.queryByLabelText("Notes")).toBeNull();
    const more = screen.getByRole("button", { name: "More details" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    openMore();
    expect(more).toHaveAttribute("aria-expanded", "true");
    const notes = screen.getByLabelText("Notes");
    fireEvent.change(notes, { target: { value: "a" } });
    fireEvent.change(notes, { target: { value: "ab" } });
    fireEvent.change(notes, { target: { value: "abc" } });
    fireEvent.change(screen.getByLabelText("Task title"), {
      target: { value: "Updated proposal" },
    });
    fireEvent.change(screen.getByLabelText("Estimate (minutes)"), {
      target: { value: "30" },
    });
    expect(notes).toHaveValue("abc");
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith("task-1", {
      title: "Updated proposal",
      notes: "abc",
      estimateMinutes: 30,
    });
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(screen.getByLabelText("Task title")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    await act(async () => {
      pending.resolve();
      await pending.promise;
    });
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("guards a second submit synchronously before the pending state renders", async () => {
    const pending = deferred();
    const onSave = vi.fn().mockReturnValue(pending.promise);
    const { container, onCancel, closeRequestRef } = setup(makeTodo(), onSave);
    fireEvent.change(screen.getByLabelText("Task title"), {
      target: { value: "Changed title" },
    });
    const form = container.querySelector("form")!;
    act(() => {
      fireEvent.submit(form);
      fireEvent.submit(form);
      closeRequestRef.current?.();
    });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.queryByText("Discard your unsaved changes?")).toBeNull();
    await act(async () => {
      pending.resolve();
      await pending.promise;
    });
  });

  it("keeps the full draft after a failed request and retries its single patch", async () => {
    const onSave = vi
      .fn()
      .mockRejectedValueOnce(
        new Error("Could not save. Check your connection."),
      )
      .mockResolvedValueOnce(undefined);
    const { onSaved } = setup(makeTodo(), onSave);
    openMore();
    fireEvent.change(screen.getByLabelText("Notes"), {
      target: { value: "Keep all these notes" },
    });
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "Draft description" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not save. Check your connection.",
    );
    expect(screen.getByLabelText("Notes")).toHaveValue("Keep all these notes");
    expect(screen.getByLabelText("Description")).toHaveValue(
      "Draft description",
    );
    expect(onSaved).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave.mock.calls[1]).toEqual(onSave.mock.calls[0]);
  });

  it("keeps a dirty draft across server refreshes and does not submit unrelated refreshed fields", async () => {
    const { rerender, props, onSave } = setup();
    openMore();
    fireEvent.change(screen.getByLabelText("Notes"), {
      target: { value: "Local draft" },
    });
    rerender(
      ce(TaskEditor, {
        ...props,
        todo: makeTodo({
          title: "Changed elsewhere",
          notes: "Remote notes",
          priority: "urgent",
        }),
      }),
    );
    expect(screen.getByLabelText("Notes")).toHaveValue("Local draft");
    expect(screen.getByLabelText("Task title")).toHaveValue("Review proposal");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith("task-1", { notes: "Local draft" }),
    );
  });

  it.each([
    new TodoApiError(
      "Server response could not confirm this save.",
      "http",
      500,
      true,
    ),
    new TodoApiError("This save may have been queued.", "uncertain", 202),
  ])(
    "blocks every write after an uncertain error, including after typing: %s",
    async (error) => {
      const onSave = vi.fn().mockRejectedValue(error);
      const onReconcile = vi.fn().mockResolvedValue(false);
      const { container } = setup(makeTodo(), onSave, onReconcile);
      openMore();
      fireEvent.change(screen.getByLabelText("Notes"), {
        target: { value: "Retained notes" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(error.message);
      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
      expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
      fireEvent.change(screen.getByLabelText("Notes"), {
        target: { value: "Retained notes plus a correction" },
      });
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Refresh this task before trying to save again",
      );
      fireEvent.submit(container.querySelector("form")!);
      expect(onSave).toHaveBeenCalledTimes(1);
      expect(screen.getByLabelText("Notes")).toHaveValue(
        "Retained notes plus a correction",
      );
      expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled();
    },
  );

  it("retains the write block after unsuccessful refreshes and guards refresh, Close and Back while busy", async () => {
    let resolveRefresh!: (value: boolean) => void;
    const refresh = new Promise<boolean>((resolve) => {
      resolveRefresh = resolve;
    });
    const onReconcile = vi
      .fn()
      .mockReturnValueOnce(refresh)
      .mockRejectedValueOnce(new Error("Refresh interrupted."));
    const onSave = vi
      .fn()
      .mockRejectedValue(new TodoApiError("Save is unconfirmed.", "uncertain"));
    const { container, closeRequestRef, onCancel } = setup(
      makeTodo(),
      onSave,
      onReconcile,
    );
    fireEvent.change(screen.getByLabelText("Task title"), {
      target: { value: "Draft title" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("alert");
    const button = screen.getByRole("button", { name: "Refresh" });
    act(() => {
      fireEvent.click(button);
      fireEvent.click(button);
      closeRequestRef.current?.();
    });
    expect(onReconcile).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: "Close Edit task" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByLabelText("Task title")).toBeDisabled();
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.queryByText("Discard your unsaved changes?")).toBeNull();
    await act(async () => {
      resolveRefresh(false);
      await refresh;
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not refresh this task",
    );
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Refresh interrupted.",
      ),
    );
    fireEvent.submit(container.querySelector("form")!);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Task title")).toHaveValue("Draft title");
    expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled();
  });

  it("rebases untouched fields from a successful refresh and retries only user-edited fields", async () => {
    let resolveRefresh!: (value: boolean) => void;
    const refresh = new Promise<boolean>((resolve) => {
      resolveRefresh = resolve;
    });
    const onReconcile = vi.fn().mockReturnValue(refresh);
    const onSave = vi
      .fn()
      .mockRejectedValueOnce(
        new TodoApiError("Save is unconfirmed.", "http", 500, true),
      )
      .mockResolvedValueOnce(undefined);
    const { rerender, props, onSaved } = setup(makeTodo(), onSave, onReconcile);
    openMore();
    fireEvent.change(screen.getByLabelText("Notes"), {
      target: { value: "Local notes" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    rerender(
      ce(TaskEditor, {
        ...props,
        todo: makeTodo({
          title: "Fresh title",
          notes: "Remote notes",
          priority: "urgent",
        }),
      }),
    );
    await act(async () => {
      resolveRefresh(true);
      await refresh;
    });
    expect(screen.getByLabelText("Task title")).toHaveValue("Fresh title");
    expect(screen.getByLabelText("Notes")).toHaveValue("Local notes");
    expect(
      screen.getByRole("button", { name: /Priority.*Urgent/ }),
    ).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(onSaved).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenLastCalledWith("task-1", { notes: "Local notes" });
    expect(onSave).toHaveBeenCalledTimes(2);
  });

  it("recognizes a draft already present in fresh data without announcing a new save", async () => {
    let resolveRefresh!: (value: boolean) => void;
    const refresh = new Promise<boolean>((resolve) => {
      resolveRefresh = resolve;
    });
    const onSave = vi
      .fn()
      .mockRejectedValue(new TodoApiError("Save is unconfirmed.", "uncertain"));
    const { rerender, props, onSaved } = setup(
      makeTodo(),
      onSave,
      () => refresh,
    );
    openMore();
    fireEvent.change(screen.getByLabelText("Notes"), {
      target: { value: "Already saved notes" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    rerender(
      ce(TaskEditor, {
        ...props,
        todo: makeTodo({ notes: "Already saved notes" }),
      }),
    );
    await act(async () => {
      resolveRefresh(true);
      await refresh;
    });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Your changes match the refreshed task.",
    );
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "preserves explicit deadline normalization only while fresh data differs (already saved: %s)",
    async (alreadySaved) => {
      let resolveRefresh!: (value: boolean) => void;
      const refresh = new Promise<boolean>((resolve) => {
        resolveRefresh = resolve;
      });
      const onSave = vi
        .fn()
        .mockRejectedValueOnce(
          new TodoApiError("Save is unconfirmed.", "uncertain"),
        )
        .mockResolvedValueOnce(undefined);
      const initial = makeTodo({ dueDate: "2026-10-10T00:00:00.000Z" });
      const { rerender, props, onSaved } = setup(
        initial,
        onSave,
        () => refresh,
      );
      fireEvent.click(
        screen.getByRole("button", { name: "Use end of this day" }),
      );
      const wanted = deadlineDateToIso(
        (screen.getByLabelText("Due by") as HTMLInputElement).value,
      );
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await screen.findByRole("alert");
      fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
      rerender(
        ce(TaskEditor, {
          ...props,
          todo: makeTodo({ dueDate: alreadySaved ? wanted : initial.dueDate }),
        }),
      );
      await act(async () => {
        resolveRefresh(true);
        await refresh;
      });
      expect(onSaved).not.toHaveBeenCalled();
      if (alreadySaved) {
        expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
        expect(screen.getByRole("status")).toHaveTextContent(
          "Your changes match the refreshed task.",
        );
      } else {
        fireEvent.click(screen.getByRole("button", { name: "Retry" }));
        await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
        expect(onSave).toHaveBeenLastCalledWith("task-1", { dueDate: wanted });
      }
    },
  );

  it("offers guidance but never permits blind retry when refresh is unavailable", async () => {
    const onSave = vi
      .fn()
      .mockRejectedValue(new TodoApiError("Save is unconfirmed.", "uncertain"));
    setup(makeTodo(), onSave);
    fireEvent.change(screen.getByLabelText("Task title"), {
      target: { value: "Draft title" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Reconnect and refresh the task list",
    );
    expect(screen.queryByRole("button", { name: "Refresh" })).toBeNull();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("allows an explicit retry after a known rejected 422 without reconciliation", async () => {
    const onSave = vi
      .fn()
      .mockRejectedValueOnce(
        new TodoApiError("Check the task details.", "http", 422),
      )
      .mockResolvedValueOnce(undefined);
    const onReconcile = vi.fn();
    const { onSaved } = setup(makeTodo(), onSave, onReconcile);
    fireEvent.change(screen.getByLabelText("Task title"), {
      target: { value: "Draft title" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onReconcile).not.toHaveBeenCalled();
  });

  it("refreshes a pristine draft when new task data arrives", () => {
    const { rerender, props } = setup();
    rerender(
      ce(TaskEditor, { ...props, todo: makeTodo({ title: "Fresh title" }) }),
    );
    expect(screen.getByLabelText("Task title")).toHaveValue("Fresh title");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("routes Cancel, Close, Escape and parent Back through the same dirty decision", () => {
    const { onCancel, onSave, closeRequestRef } = setup();
    fireEvent.change(screen.getByLabelText("Task title"), {
      target: { value: "Unsaved title" },
    });
    const keep = () => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Discard your unsaved changes?",
      );
      fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
      expect(screen.getByLabelText("Task title")).toHaveValue("Unsaved title");
      expect(onCancel).not.toHaveBeenCalled();
    };
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    keep();
    fireEvent.click(screen.getByRole("button", { name: "Close Edit task" }));
    keep();
    fireEvent.keyDown(document, { key: "Escape" });
    keep();
    act(() => closeRequestRef.current?.());
    keep();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("validates an empty title and an invalid estimate without a save request", () => {
    const { onSave } = setup();
    fireEvent.change(screen.getByLabelText("Task title"), {
      target: { value: "   " },
    });
    openMore();
    fireEvent.change(screen.getByLabelText("Estimate (minutes)"), {
      target: { value: "-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByLabelText("Task title")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(screen.getByText("Enter a task title.")).toBeTruthy();
    expect(
      screen.getByText("Enter a whole number of minutes, zero or greater."),
    ).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("preserves untouched deadline precision and clears dates explicitly", async () => {
    const dueDate = "2026-10-10T12:34:56.789Z";
    const scheduledDate = "2026-10-09T09:15:42.000Z";
    const { onSave } = setup(makeTodo({ dueDate, scheduledDate }));
    fireEvent.change(screen.getByLabelText("Task title"), {
      target: { value: "Title only" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith("task-1", { title: "Title only" }),
    );
    fireEvent.change(screen.getByLabelText("Plan for"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByLabelText("Due by"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(onSave).toHaveBeenLastCalledWith("task-1", {
        scheduledDate: null,
        dueDate: null,
      }),
    );
  });

  it("saves a local planned instant and a selected deadline at the end of the local day", async () => {
    const { onSave } = setup();
    fireEvent.change(screen.getByLabelText("Plan for"), {
      target: { value: "2026-10-10T09:00" },
    });
    fireEvent.change(screen.getByLabelText("Due by"), {
      target: { value: "2026-10-10" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith("task-1", {
        scheduledDate: localDateTimeToIso("2026-10-10T09:00"),
        dueDate: deadlineDateToIso("2026-10-10"),
      }),
    );
  });

  it("rejects a plan beyond an existing exact deadline without changing it", () => {
    const { onSave } = setup(makeTodo({ dueDate: "2026-10-10T00:00:00.000Z" }));
    fireEvent.change(screen.getByLabelText("Plan for"), {
      target: { value: "2026-10-11T09:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByLabelText("Plan for")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(
      screen.getByText(/Planned time must be on or before the deadline/),
    ).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("lets the user explicitly extend an existing same-day deadline before saving a plan", async () => {
    const { onSave } = setup(makeTodo({ dueDate: "2026-10-10T00:00:00.000Z" }));
    fireEvent.change(screen.getByLabelText("Plan for"), {
      target: { value: "2026-10-10T09:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(
      screen.getByText(/Planned time must be on or before the deadline/),
    ).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(/Current saved deadline:/)).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Use end of this day" }),
    );
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith("task-1", {
        scheduledDate: localDateTimeToIso("2026-10-10T09:00"),
        dueDate: deadlineDateToIso("2026-10-10"),
      }),
    );
  });

  it("uses registry status options and saves selected fields only after Save", async () => {
    const { onSave } = setup();
    const status = screen.getByRole("button", { name: /Status.*Next/ });
    fireEvent.touchEnd(status, {
      changedTouches: [{ identifier: 1, clientY: 600 }],
    });
    fireEvent.click(status);
    expect(status).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("button", { name: "In progress" }));
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith("task-1", { status: "in_progress" }),
    );
    expect(screen.getByRole("dialog", { name: "Edit task" })).toBeTruthy();
  });
});
