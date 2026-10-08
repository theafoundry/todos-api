// @vitest-environment jsdom
import { createElement } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TaskComposer } from "./TaskComposer";
import type { Project } from "../../types";

vi.mock("../ai/AiOnCreateAssist", () => ({
  AiOnCreateAssist: ({
    title,
    onApplySuggestion,
  }: {
    title: string;
    onApplySuggestion: (field: string, value: string) => void;
  }) =>
    createElement(
      "div",
      { "data-testid": "ai-assist" },
      createElement(
        "button",
        {
          type: "button",
          onClick: () => onApplySuggestion("priority", "high"),
        },
        "Apply priority",
      ),
      createElement(
        "button",
        {
          type: "button",
          onClick: () => onApplySuggestion("dueDate", "2026-05-01"),
        },
        "Apply due date",
      ),
    ),
}));

vi.mock("../../hooks/useCaptureRoute", () => ({
  useCaptureRoute: () => ({
    suggestion: null,
    loading: false,
    preferredRoute: "task" as const,
    alternateRoute: "triage" as const,
  }),
}));

const defaultProjects: Project[] = [
  {
    id: "p1",
    name: "Work",
    status: "active",
    archived: false,
    userId: "user-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "p2",
    name: "Personal",
    status: "active",
    archived: false,
    userId: "user-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
];

const defaultProps = {
  isOpen: true,
  projects: defaultProjects,
  onSubmitTask: vi.fn().mockResolvedValue(undefined),
  onCaptureToDesk: vi.fn().mockResolvedValue(undefined),
  onClose: vi.fn(),
};

describe("TaskComposer", () => {
  it("keeps the capture draft open on save failure and permits a deliberate retry", async () => {
    const onCaptureToDesk = vi
      .fn()
      .mockRejectedValueOnce(
        new Error("Capture could not be confirmed. Check Inbox or retry."),
      )
      .mockResolvedValueOnce(undefined);
    const onClose = vi.fn();
    render(
      createElement(TaskComposer, {
        ...defaultProps,
        onCaptureToDesk,
        onClose,
      }),
    );
    const title = screen.getByPlaceholderText("Task title");
    fireEvent.change(title, { target: { value: "Review next week" } });
    fireEvent.click(screen.getByRole("button", { name: "Save to Inbox" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Capture could not be confirmed",
    );
    expect(title).toHaveValue("Review next week");
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save to Inbox" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onCaptureToDesk).toHaveBeenCalledTimes(2);
  });

  it("renders nothing when not open", () => {
    render(createElement(TaskComposer, { ...defaultProps, isOpen: false }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders the dialog when open", () => {
    render(createElement(TaskComposer, defaultProps));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("New Task")).toBeTruthy();
  });

  it("closes when close button is clicked", () => {
    render(createElement(TaskComposer, defaultProps));
    fireEvent.click(screen.getByRole("button", { name: /close|✕/i }));
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it("closes when overlay is clicked", () => {
    render(createElement(TaskComposer, defaultProps));
    fireEvent.click(screen.getByRole("dialog").parentElement!);
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it("closes when Escape key is pressed", () => {
    render(createElement(TaskComposer, defaultProps));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it("submits as task when primary button is clicked", async () => {
    const onSubmitTask = vi.fn().mockResolvedValue(undefined);
    render(createElement(TaskComposer, { ...defaultProps, onSubmitTask }));

    const titleInput = screen.getByPlaceholderText(
      "Task title",
    ) as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: "New task" } });

    fireEvent.click(screen.getByRole("button", { name: "Create task now" }));

    await waitFor(() => {
      expect(onSubmitTask).toHaveBeenCalledWith(
        expect.objectContaining({ title: "New task" }),
      );
    });
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it("submits to desk when alternate route is clicked", async () => {
    const onCaptureToDesk = vi.fn().mockResolvedValue(undefined);
    render(createElement(TaskComposer, { ...defaultProps, onCaptureToDesk }));

    const titleInput = screen.getByPlaceholderText(
      "Task title",
    ) as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: "Desk item" } });

    // alternateRoute is "triage" from mock
    const alternateBtn = screen
      .getAllByRole("button")
      .find((btn) => btn.textContent === "Save to Inbox")!;
    fireEvent.click(alternateBtn);

    await waitFor(() => {
      expect(onCaptureToDesk).toHaveBeenCalledWith("Desk item");
    });
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it("does not submit when title is empty", () => {
    const onSubmitTask = vi.fn();
    render(createElement(TaskComposer, { ...defaultProps, onSubmitTask }));

    const submitBtn = screen.getByRole("button", { name: "Create task now" });
    fireEvent.click(submitBtn);

    expect(onSubmitTask).not.toHaveBeenCalled();
  });

  it("disables submit buttons when submitting", async () => {
    let resolveSubmit: () => void;
    const submitPromise = new Promise<void>((r) => {
      resolveSubmit = r;
    });
    const onSubmitTask = vi.fn().mockReturnValue(submitPromise);
    render(createElement(TaskComposer, { ...defaultProps, onSubmitTask }));

    const titleInput = screen.getByPlaceholderText(
      "Task title",
    ) as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: "Task" } });

    fireEvent.click(screen.getByRole("button", { name: "Create task now" }));

    await waitFor(() => {
      const buttons = screen.getAllByRole("button", {
        name: /Saving…|Create task now|Save to Inbox/,
      });
      buttons.forEach((btn) => {
        if (btn.textContent?.includes("Saving")) {
          expect(btn).toBeDisabled();
        }
      });
    });

    resolveSubmit!();
    await waitFor(() => {
      expect(defaultProps.onClose).toHaveBeenCalled();
    });
  });

  it("submits with all form fields populated", async () => {
    const onSubmitTask = vi.fn().mockResolvedValue(undefined);
    render(createElement(TaskComposer, { ...defaultProps, onSubmitTask }));

    fireEvent.change(screen.getByPlaceholderText("Task title"), {
      target: { value: "Full task" },
    });
    fireEvent.change(screen.getByPlaceholderText("Description (optional)"), {
      target: { value: "Details" },
    });

    const statusSelect = screen.getAllByRole("combobox")[0];
    fireEvent.change(statusSelect, { target: { value: "next" } });

    const prioritySelect = screen.getAllByRole("combobox")[1];
    fireEvent.change(prioritySelect, { target: { value: "high" } });

    const projectSelect = screen.getAllByRole("combobox")[2];
    fireEvent.change(projectSelect, { target: { value: "p1" } });

    const dueDateInput = document.getElementById(
      "todoDueDateInput",
    ) as HTMLInputElement;
    fireEvent.change(dueDateInput, { target: { value: "2026-06-15" } });
    fireEvent.change(screen.getByPlaceholderText("e.g. work, important"), {
      target: { value: "work, urgent" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Create task now" }));

    await waitFor(() => {
      expect(onSubmitTask).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Full task",
          description: "Details",
          status: "next",
          priority: "high",
          projectId: "p1",
          dueDate: "2026-06-15",
          tags: ["work", "urgent"],
        }),
      );
    });
  });

  it("does not include empty fields in submission", async () => {
    const onSubmitTask = vi.fn().mockResolvedValue(undefined);
    render(createElement(TaskComposer, { ...defaultProps, onSubmitTask }));

    fireEvent.change(screen.getByPlaceholderText("Task title"), {
      target: { value: "Minimal" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create task now" }));

    await waitFor(() => {
      expect(onSubmitTask).toHaveBeenCalledWith({
        title: "Minimal",
      });
    });
  });

  it("resets form when opened", () => {
    const { rerender } = render(
      createElement(TaskComposer, {
        ...defaultProps,
        isOpen: false,
      }),
    );

    // Open and fill form
    rerender(createElement(TaskComposer, { ...defaultProps, isOpen: true }));
    fireEvent.change(screen.getByPlaceholderText("Task title"), {
      target: { value: "Filled" },
    });
    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[1], { target: { value: "high" } });

    // Close and reopen
    rerender(createElement(TaskComposer, { ...defaultProps, isOpen: false }));
    rerender(createElement(TaskComposer, { ...defaultProps, isOpen: true }));

    expect(
      (screen.getByPlaceholderText("Task title") as HTMLInputElement).value,
    ).toBe("");
    const newSelects = screen.getAllByRole("combobox");
    expect((newSelects[1] as HTMLSelectElement).value).toBe("");
  });

  it("shows AI assist component", () => {
    render(createElement(TaskComposer, defaultProps));
    expect(screen.getByTestId("ai-assist")).toBeTruthy();
  });

  it("applies AI suggestion for priority", async () => {
    render(createElement(TaskComposer, defaultProps));

    fireEvent.click(screen.getByText("Apply priority"));
    const selects = screen.getAllByRole("combobox");
    expect((selects[1] as HTMLSelectElement).value).toBe("high");
  });

  it("applies AI suggestion for due date", async () => {
    render(createElement(TaskComposer, defaultProps));

    fireEvent.click(screen.getByText("Apply due date"));
    const dueDateInput = document.getElementById(
      "todoDueDateInput",
    ) as HTMLInputElement;
    expect(dueDateInput.value).toBe("2026-05-01");
  });

  it("filters out archived projects from project select", () => {
    const projectsWithArchived: Project[] = [
      ...defaultProjects,
      {
        id: "p3",
        name: "Archived",
        status: "active",
        archived: true,
        userId: "user-1",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    render(
      createElement(TaskComposer, {
        ...defaultProps,
        projects: projectsWithArchived,
      }),
    );

    const selects = screen.getAllByRole("combobox");
    const projectSelect = selects[2] as HTMLSelectElement;
    const options = Array.from(projectSelect.options).map((o) => o.value);
    expect(options).toContain("p1");
    expect(options).toContain("p2");
    expect(options).not.toContain("p3");
  });

  it("uses defaultProjectId when provided", () => {
    render(
      createElement(TaskComposer, {
        ...defaultProps,
        defaultProjectId: "p2",
      }),
    );
    const selects = screen.getAllByRole("combobox");
    expect((selects[2] as HTMLSelectElement).value).toBe("p2");
  });
});
