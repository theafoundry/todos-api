// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { createElement as ce, createRef } from "react";
import { QuickCapture, type CaptureReconciliationResult } from "./QuickCapture";
import { TodoApiError } from "../../api/todos";
import { deadlineDateToIso, localDateTimeToIso } from "../utils/taskDates";
import type { Project } from "../../types";

const project = {
  id: "p1",
  name: "Work",
  status: "active",
  archived: false,
  userId: "u1",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
} satisfies Project;
function props() {
  return {
    open: true,
    projects: [
      project,
      { ...project, id: "p2", name: "Archived", archived: true },
    ],
    onClose: vi.fn(),
    onCreateTask: vi.fn().mockResolvedValue(undefined),
    onCreateProject: vi.fn().mockResolvedValue(undefined),
  };
}
const typeTitle = (title = "Test task") =>
  fireEvent.change(screen.getByRole("textbox", { name: "Task title" }), {
    target: { value: title },
  });

describe("QuickCapture", () => {
  it("renders a named modal with a focused title and disabled empty submission", () => {
    render(ce(QuickCapture, props()));
    expect(screen.getByRole("dialog", { name: "Quick capture" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Task title" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "Add Task" })).toBeDisabled();
  });

  it("renders nothing when closed and initializes a new draft on a new open instance", () => {
    const values = props();
    const { rerender } = render(ce(QuickCapture, { ...values, open: false }));
    expect(screen.queryByRole("dialog")).toBeNull();
    rerender(ce(QuickCapture, values));
    typeTitle();
    rerender(ce(QuickCapture, { ...values, open: false }));
    rerender(ce(QuickCapture, values));
    expect(screen.getByRole("textbox", { name: "Task title" })).toHaveValue("");
  });

  it("discloses directly selectable and clearable planning fields, retaining values when collapsed", async () => {
    const values = props();
    render(ce(QuickCapture, values));
    typeTitle("  Plan work  ");
    const more = screen.getByRole("button", { name: /More details/ });
    expect(more).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(more);
    expect(more).toHaveAttribute("aria-expanded", "true");
    expect(screen.queryByRole("option", { name: "Archived" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Project"), {
      target: { value: "p1" },
    });
    fireEvent.change(screen.getByLabelText("Priority"), {
      target: { value: "urgent" },
    });
    fireEvent.change(screen.getByLabelText("Plan for"), {
      target: { value: "2026-10-08T09:00" },
    });
    fireEvent.change(screen.getByLabelText("Due by"), {
      target: { value: "2026-10-09" },
    });
    fireEvent.click(more);
    expect(screen.queryByLabelText("Priority")).toBeNull();
    fireEvent.click(more);
    expect(screen.getByLabelText("Priority")).toHaveValue("urgent");
    fireEvent.change(screen.getByLabelText("Project"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add Task" }));
    await vi.waitFor(() => expect(values.onClose).toHaveBeenCalledOnce());
    expect(values.onCreateTask).toHaveBeenCalledWith({
      title: "Plan work",
      priority: "urgent",
      scheduledDate: localDateTimeToIso("2026-10-08T09:00"),
      dueDate: deadlineDateToIso("2026-10-09"),
    });
  });

  it("validates planned date against deadline before sending", () => {
    const values = props();
    render(ce(QuickCapture, values));
    typeTitle();
    fireEvent.click(screen.getByRole("button", { name: /More details/ }));
    fireEvent.change(screen.getByLabelText("Plan for"), {
      target: { value: "2026-10-10T09:00" },
    });
    fireEvent.change(screen.getByLabelText("Due by"), {
      target: { value: "2026-10-09" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add Task" }));
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(values.onCreateTask).not.toHaveBeenCalled();
  });

  it("guards duplicate Enter/tap submission synchronously and blocks dismissal while pending", async () => {
    let resolve!: () => void;
    const values = props();
    values.onCreateTask.mockImplementation(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    const { container } = render(ce(QuickCapture, values));
    typeTitle();
    const input = screen.getByRole("textbox", { name: "Task title" });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Adding…" }));
    fireEvent.click(container.querySelector(".m-capture__backdrop")!);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(values.onCreateTask).toHaveBeenCalledOnce();
    expect(values.onClose).not.toHaveBeenCalled();
    expect(input).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Adding task");
    await act(async () => resolve());
    expect(values.onClose).toHaveBeenCalledOnce();
  });

  it("retains typed draft and fields after a known failure and retries explicitly", async () => {
    const values = props();
    values.onCreateTask.mockRejectedValueOnce(
      new TodoApiError("Reconnect before trying again", "network"),
    );
    render(ce(QuickCapture, values));
    typeTitle("Keep me");
    fireEvent.click(screen.getByRole("button", { name: /More details/ }));
    fireEvent.change(screen.getByLabelText("Priority"), {
      target: { value: "high" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add Task" }));
    await screen.findByRole("alert");
    expect(screen.getByRole("textbox", { name: "Task title" })).toHaveValue(
      "Keep me",
    );
    expect(screen.getByLabelText("Priority")).toHaveValue("high");
    expect(values.onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await vi.waitFor(() => expect(values.onClose).toHaveBeenCalledOnce());
    expect(values.onCreateTask).toHaveBeenCalledTimes(2);
  });

  it("retains an uncertain creation and prevents a blind retry", async () => {
    const values = props();
    values.onCreateTask.mockRejectedValue(
      new TodoApiError("Uncertain", "uncertain"),
    );
    render(ce(QuickCapture, values));
    typeTitle();
    fireEvent.click(screen.getByRole("button", { name: "Add Task" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "check your tasks or projects",
    );
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(screen.getByRole("button", { name: "Add Task" })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Task title" }), {
      key: "Enter",
    });
    expect(values.onCreateTask).toHaveBeenCalledOnce();
    expect(values.onClose).not.toHaveBeenCalled();
  });

  it("checks fresh possible matches inside capture while retaining the draft and blocking another POST", async () => {
    const values = props();
    values.onCreateTask.mockRejectedValue(
      new TodoApiError("Unconfirmed", "http", 500, true),
    );
    const onReconcile = vi.fn().mockResolvedValue({
      matches: [{ id: "existing-task", label: "Original title", type: "task" }],
    } satisfies CaptureReconciliationResult);
    render(ce(QuickCapture, { ...values, onReconcile }));
    typeTitle("  Original title  ");
    fireEvent.click(screen.getByRole("button", { name: /More details/ }));
    fireEvent.change(screen.getByLabelText("Project"), {
      target: { value: "p1" },
    });
    fireEvent.change(screen.getByLabelText("Priority"), {
      target: { value: "high" },
    });
    fireEvent.change(screen.getByLabelText("Plan for"), {
      target: { value: "2026-10-08T09:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add Task" }));
    await screen.findByRole("alert");
    typeTitle("Corrected draft title");
    fireEvent.click(screen.getByRole("button", { name: "Refresh and check" }));
    await screen.findByRole("list", { name: "Possible existing items" });
    expect(onReconcile).toHaveBeenCalledWith({
      type: "task",
      label: "Original title",
    });
    expect(screen.getByRole("listitem")).toHaveTextContent(
      "Task: Original title",
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "They may predate this capture",
    );
    expect(screen.getByRole("textbox", { name: "Task title" })).toHaveValue(
      "Corrected draft title",
    );
    expect(screen.getByLabelText("Project")).toHaveValue("p1");
    expect(screen.getByLabelText("Priority")).toHaveValue("high");
    expect(screen.getByLabelText("Plan for")).toHaveValue("2026-10-08T09:00");
    expect(screen.getByRole("button", { name: "Add Task" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(screen.getByRole("button", { name: "Project" })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Task title" }), {
      key: "Enter",
    });
    expect(values.onCreateTask).toHaveBeenCalledOnce();
    expect(values.onClose).not.toHaveBeenCalled();
  });

  it("never interprets an empty refreshed match list as permission to repeat creation", async () => {
    const values = props();
    values.onCreateTask.mockRejectedValue(
      new TodoApiError("Unconfirmed", "uncertain", 202),
    );
    const onReconcile = vi.fn().mockResolvedValue({ matches: [] });
    render(ce(QuickCapture, { ...values, onReconcile }));
    typeTitle();
    fireEvent.click(screen.getByRole("button", { name: "Add Task" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Refresh and check" }));
    await vi.waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "This does not confirm that the earlier request failed",
      ),
    );
    expect(screen.getByRole("button", { name: "Add Task" })).toBeDisabled();
    expect(
      screen.queryByRole("list", { name: "Possible existing items" }),
    ).toBeNull();
    typeTitle("Another correction");
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Task title" }), {
      key: "Enter",
    });
    expect(values.onCreateTask).toHaveBeenCalledOnce();
    expect(values.onClose).not.toHaveBeenCalled();
  });

  it("guards repeated checks and dismissal while refreshing, then retains the draft and creation block on failure", async () => {
    let resolve!: (result: CaptureReconciliationResult | null) => void;
    const pending = new Promise<CaptureReconciliationResult | null>((done) => {
      resolve = done;
    });
    const values = props();
    values.onCreateTask.mockRejectedValue(
      new TodoApiError("Unconfirmed", "uncertain"),
    );
    const onReconcile = vi
      .fn()
      .mockReturnValueOnce(pending)
      .mockRejectedValueOnce(new Error("List refresh interrupted."));
    const closeRequestRef = createRef<(() => void) | null>();
    const { container } = render(
      ce(QuickCapture, { ...values, onReconcile, closeRequestRef }),
    );
    typeTitle("Keep this draft");
    fireEvent.click(screen.getByRole("button", { name: "Add Task" }));
    await screen.findByRole("alert");
    const refresh = screen.getByRole("button", { name: "Refresh and check" });
    act(() => {
      fireEvent.click(refresh);
      fireEvent.click(refresh);
      closeRequestRef.current?.();
    });
    fireEvent.click(container.querySelector(".m-capture__backdrop")!);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onReconcile).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Close Quick capture" }),
    ).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "Task title" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Refreshing the list");
    expect(values.onClose).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("group", { name: "Discard this draft?" }),
    ).toBeNull();
    await act(async () => {
      resolve(null);
      await pending;
    });
    expect(screen.getByText(/Could not refresh the list/)).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Task title" })).toHaveValue(
      "Keep this draft",
    );
    expect(screen.getByRole("button", { name: "Add Task" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Refresh and check" }));
    await screen.findByText("List refresh interrupted.");
    expect(
      screen.getByRole("button", { name: "Refresh and check" }),
    ).toBeEnabled();
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Task title" }), {
      key: "Enter",
    });
    expect(values.onCreateTask).toHaveBeenCalledOnce();
  });

  it("checks ambiguous project captures without changing or repeating either creation callback", async () => {
    const values = props();
    values.onCreateProject.mockRejectedValue(
      new TodoApiError("Unconfirmed", "uncertain", 202),
    );
    const onReconcile = vi.fn().mockResolvedValue({
      matches: [{ id: "new-project", label: "Project draft", type: "project" }],
    } satisfies CaptureReconciliationResult);
    render(ce(QuickCapture, { ...values, onReconcile }));
    fireEvent.click(screen.getByRole("button", { name: "Project" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Project name" }), {
      target: { value: "Project draft" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add Project" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Refresh and check" }));
    await screen.findByRole("list", { name: "Possible existing items" });
    expect(onReconcile).toHaveBeenCalledWith({
      type: "project",
      label: "Project draft",
    });
    expect(screen.getByRole("listitem")).toHaveTextContent(
      "Project: Project draft",
    );
    expect(screen.getByRole("textbox", { name: "Project name" })).toHaveValue(
      "Project draft",
    );
    expect(screen.getByRole("button", { name: "Add Project" })).toBeDisabled();
    expect(values.onCreateProject).toHaveBeenCalledOnce();
    expect(values.onCreateTask).not.toHaveBeenCalled();
    expect(values.onClose).not.toHaveBeenCalled();
  });

  it("keeps the dirty dismissal decision after checking, even if the ambiguous draft title is cleared", async () => {
    const values = props();
    values.onCreateTask.mockRejectedValue(
      new TodoApiError("Unconfirmed", "uncertain"),
    );
    const closeRequestRef = createRef<(() => void) | null>();
    const onReconcile = vi.fn().mockResolvedValue({ matches: [] });
    render(ce(QuickCapture, { ...values, onReconcile, closeRequestRef }));
    typeTitle();
    fireEvent.click(screen.getByRole("button", { name: "Add Task" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Refresh and check" }));
    await screen.findByText(/No matching item appeared in the refreshed list/);
    typeTitle("");
    act(() => closeRequestRef.current?.());
    expect(
      screen.getByRole("group", { name: "Discard this draft?" }),
    ).toBeTruthy();
    expect(values.onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.getByRole("button", { name: "Add Task" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(values.onClose).toHaveBeenCalledOnce();
  });

  it.each(["Cancel", "Escape", "backdrop", "external Back"])(
    "protects a dirty draft on %s with Keep editing or Discard",
    (action) => {
      const values = props();
      const closeRequestRef = createRef<(() => void) | null>();
      const { container } = render(
        ce(QuickCapture, { ...values, closeRequestRef }),
      );
      typeTitle("Retain this draft");
      if (action === "Cancel")
        fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      else if (action === "Escape")
        fireEvent.keyDown(document, { key: "Escape" });
      else if (action === "backdrop")
        fireEvent.click(container.querySelector(".m-capture__backdrop")!);
      else act(() => closeRequestRef.current?.());
      expect(values.onClose).not.toHaveBeenCalled();
      expect(
        screen.getByRole("group", { name: "Discard this draft?" }),
      ).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
      expect(screen.getByRole("textbox", { name: "Task title" })).toHaveValue(
        "Retain this draft",
      );
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      fireEvent.click(screen.getByRole("button", { name: "Discard" }));
      expect(values.onClose).toHaveBeenCalledOnce();
    },
  );

  it("creates a project with the same guarded submission contract", async () => {
    const values = props();
    render(ce(QuickCapture, values));
    fireEvent.click(screen.getByRole("button", { name: "Project" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Project name" }), {
      target: { value: "  Project name  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add Project" }));
    await vi.waitFor(() => expect(values.onClose).toHaveBeenCalledOnce());
    expect(values.onCreateProject).toHaveBeenCalledWith("Project name");
    expect(values.onCreateTask).not.toHaveBeenCalled();
  });
});
