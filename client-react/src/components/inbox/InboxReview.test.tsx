import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InboxReview } from "./InboxReview";
import {
  acceptCapture,
  captureInboxItem,
  discardCapture,
  fetchInboxItems,
} from "../../api/inbox";
import { MutationApiError } from "../../api/mutations";
import { ViewActivityProvider } from "../layout/ViewActivityContext";
import type { Todo } from "../../types";

vi.mock("../../api/inbox", () => ({
  acceptCapture: vi.fn(),
  captureInboxItem: vi.fn(),
  discardCapture: vi.fn(),
  fetchInboxItems: vi.fn(),
}));
const capture = {
  id: "capture-1",
  text: "Read design notes",
  source: "api",
  lifecycle: "new" as const,
  capturedAt: "2026-10-08T12:00:00.000Z",
  createdAt: "2026-10-08T12:00:00.000Z",
  updatedAt: "2026-10-08T12:00:00.000Z",
};
const task: Todo = {
  id: "task-1",
  title: capture.text,
  status: "next",
  completed: false,
  archived: false,
  tags: [],
  dependsOnTaskIds: [],
  order: 0,
  userId: "user-1",
  createdAt: capture.createdAt,
  updatedAt: capture.updatedAt,
};
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(fetchInboxItems).mockResolvedValue([capture]);
});
afterEach(cleanup);

describe("Inbox review", () => {
  it("shows raw captures and source, then accepts a task without requiring metadata", async () => {
    const onAccepted = vi.fn();
    const onOpenTask = vi.fn();
    vi.mocked(acceptCapture).mockResolvedValue({ task, created: true });
    render(<InboxReview onAccepted={onAccepted} onOpenTask={onOpenTask} />);
    expect(await screen.findByText(capture.text)).toBeInTheDocument();
    expect(screen.getByText("Agent or API")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Accept to Tasks" }));
    await waitFor(() => expect(onAccepted).toHaveBeenCalledWith(task));
    expect(screen.queryByText(capture.text)).not.toBeInTheDocument();
    expect(screen.getByText("Inbox is clear")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open task" }));
    expect(onOpenTask).toHaveBeenCalledWith(task.id);
  });

  it("preserves the edited title after failed acceptance and blocks duplicate clicks while pending", async () => {
    const attempt = deferred<{ task: Todo; created: boolean }>();
    vi.mocked(acceptCapture)
      .mockReturnValueOnce(attempt.promise)
      .mockRejectedValueOnce(new Error("Please retry"));
    render(<InboxReview onAccepted={vi.fn()} />);
    await screen.findByText(capture.text);
    fireEvent.click(screen.getByRole("button", { name: "Edit title" }));
    fireEvent.change(screen.getByLabelText("Task title"), {
      target: { value: "Read revised notes" },
    });
    const button = screen.getByRole("button", { name: "Accept to Tasks" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(acceptCapture).toHaveBeenCalledTimes(1);
    await act(async () => attempt.resolve({ task, created: true }));
    expect(acceptCapture).toHaveBeenCalledWith(
      capture.id,
      "Read revised notes",
    );
  });

  it("keeps a failed acceptance in the queue and permits an intentional retry", async () => {
    vi.mocked(acceptCapture)
      .mockRejectedValueOnce(new Error("Try again"))
      .mockResolvedValueOnce({ task, created: false });
    render(<InboxReview onAccepted={vi.fn()} />);
    await screen.findByText(capture.text);
    fireEvent.click(screen.getByRole("button", { name: "Edit title" }));
    fireEvent.change(screen.getByLabelText("Task title"), {
      target: { value: "Revised title" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Accept to Tasks" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Try again");
    expect(screen.getByLabelText("Task title")).toHaveValue("Revised title");
    fireEvent.click(screen.getByRole("button", { name: "Accept to Tasks" }));
    await screen.findByText("Inbox is clear");
    expect(acceptCapture).toHaveBeenLastCalledWith(capture.id, "Revised title");
  });

  it("lets title edit and discard confirmation be cancelled without a write", async () => {
    render(<InboxReview onAccepted={vi.fn()} />);
    await screen.findByText(capture.text);
    fireEvent.click(screen.getByRole("button", { name: "Edit title" }));
    fireEvent.change(screen.getByLabelText("Task title"), {
      target: { value: "Unwanted title" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel title edit" }));
    expect(screen.getByText(capture.text)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(discardCapture).not.toHaveBeenCalled();
    expect(acceptCapture).not.toHaveBeenCalled();
  });

  it("keeps line breaks out of a multi-line capture's editable title and preserves the original", async () => {
    const multiline = {
      ...capture,
      text: "Ask Maya for the checklist\nKeep the pilot  short",
    };
    vi.mocked(fetchInboxItems).mockResolvedValue([multiline]);
    vi.mocked(acceptCapture).mockResolvedValue({ task, created: true });
    render(<InboxReview onAccepted={vi.fn()} />);
    const title = "Ask Maya for the checklist Keep the pilot short";
    expect(
      await screen.findByRole("heading", { name: title }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Original capture").parentElement,
    ).toHaveTextContent(multiline.text, { normalizeWhitespace: false });
    fireEvent.click(screen.getByRole("button", { name: "Edit title" }));
    expect(screen.getByLabelText("Task title")).toHaveValue(title);
    fireEvent.click(screen.getByRole("button", { name: "Accept to Tasks" }));
    await screen.findByText("Inbox is clear");
    expect(acceptCapture).toHaveBeenCalledWith(multiline.id, title);
  });

  it("caps a long CRLF/tab capture's unedited title after collapsing whitespace and keeps the raw original", async () => {
    const words = Array.from({ length: 60 }, (_, i) => `word${i}`);
    const raw = `  \r\n${words.slice(0, 3).join("\r\n\r\n")}\t\t${words.slice(3).join("   ")}  `;
    vi.mocked(fetchInboxItems).mockResolvedValue([{ ...capture, text: raw }]);
    vi.mocked(acceptCapture).mockResolvedValue({ task, created: true });
    render(<InboxReview onAccepted={vi.fn()} />);
    // The 200-character cap lands just after a space; acceptance trims it.
    const expected = words.join(" ").slice(0, 200);
    expect(expected).toMatch(/ $/);
    expect(
      await screen.findByRole("heading", { name: expected.trim() }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Original capture").parentElement!.textContent,
    ).toBe(`Original capture${raw}`);
    fireEvent.click(screen.getByRole("button", { name: "Accept to Tasks" }));
    await screen.findByText("Inbox is clear");
    const [, title] = vi.mocked(acceptCapture).mock.calls[0];
    expect(title).toBe(expected.trim());
    expect(title!.length).toBeLessThanOrEqual(200);
    expect(title).not.toMatch(/[\r\n\t]|\s{2}/);
  });

  it("restores the normalized multi-line title on cancel across a failed and retried accept", async () => {
    const multiline = { ...capture, text: "First line\nSecond line" };
    vi.mocked(fetchInboxItems).mockResolvedValue([multiline]);
    vi.mocked(acceptCapture)
      .mockRejectedValueOnce(new Error("Try again"))
      .mockResolvedValueOnce({ task, created: false });
    render(<InboxReview onAccepted={vi.fn()} />);
    await screen.findByRole("heading", { name: "First line Second line" });
    fireEvent.click(screen.getByRole("button", { name: "Edit title" }));
    fireEvent.change(screen.getByLabelText("Task title"), {
      target: { value: "Edited first line" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Accept to Tasks" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Try again");
    expect(acceptCapture).toHaveBeenLastCalledWith(
      multiline.id,
      "Edited first line",
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel title edit" }));
    expect(
      screen.getByRole("heading", { name: "First line Second line" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Accept to Tasks" }));
    await screen.findByText("Inbox is clear");
    expect(acceptCapture).toHaveBeenCalledTimes(2);
    expect(acceptCapture).toHaveBeenLastCalledWith(
      multiline.id,
      "First line Second line",
    );
  });

  it("does not remove a capture after failed discard", async () => {
    vi.mocked(discardCapture)
      .mockRejectedValueOnce(new Error("Discard failed"))
      .mockResolvedValueOnce({ ...capture, lifecycle: "discarded" });
    render(<InboxReview onAccepted={vi.fn()} />);
    await screen.findByText(capture.text);
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm discard" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Discard failed",
    );
    expect(screen.getByText(capture.text)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm discard" }));
    await screen.findByText("Capture discarded.");
  });

  it("reports loading errors instead of claiming Inbox is clear", async () => {
    vi.mocked(fetchInboxItems)
      .mockRejectedValueOnce(new Error("Server unavailable"))
      .mockResolvedValueOnce([capture]);
    render(<InboxReview onAccepted={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Server unavailable",
    );
    expect(screen.queryByText("Inbox is clear")).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Retry loading Inbox" }),
    );
    expect(await screen.findByText(capture.text)).toBeInTheDocument();
  });

  it("reloads a cached screen when visited again", async () => {
    const onAccepted = vi.fn();
    const { rerender } = render(
      <ViewActivityProvider isActive>
        <InboxReview onAccepted={onAccepted} />
      </ViewActivityProvider>,
    );
    await screen.findByText(capture.text);
    rerender(
      <ViewActivityProvider isActive={false}>
        <InboxReview onAccepted={onAccepted} />
      </ViewActivityProvider>,
    );
    expect(fetchInboxItems).toHaveBeenCalledTimes(1);
    rerender(
      <ViewActivityProvider isActive>
        <InboxReview onAccepted={onAccepted} />
      </ViewActivityProvider>,
    );
    await waitFor(() => expect(fetchInboxItems).toHaveBeenCalledTimes(2));
  });

  it("ignores stale reads that arrive after a newer Inbox load", async () => {
    const stale = deferred<(typeof capture)[]>();
    vi.mocked(fetchInboxItems)
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValueOnce([{ ...capture, text: "Latest capture" }]);
    const onAccepted = vi.fn();
    const { rerender } = render(
      <InboxReview onAccepted={onAccepted} refreshKey={0} />,
    );
    rerender(<InboxReview onAccepted={onAccepted} refreshKey={1} />);
    await screen.findByText("Latest capture");
    await act(async () => stale.resolve([capture]));
    expect(screen.queryByText(capture.text)).not.toBeInTheDocument();
  });

  it("does not resurrect a discarded capture from an earlier read, but shows a later restoration", async () => {
    const stale = deferred<(typeof capture)[]>();
    vi.mocked(fetchInboxItems)
      .mockResolvedValueOnce([capture])
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValueOnce([capture]);
    vi.mocked(discardCapture).mockResolvedValue({
      ...capture,
      lifecycle: "discarded",
    });
    render(<InboxReview onAccepted={vi.fn()} />);
    await screen.findByText(capture.text);
    fireEvent.click(screen.getByRole("button", { name: "Refresh Inbox" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm discard" }));
    await screen.findByText("Capture discarded.");
    await act(async () => stale.resolve([capture]));
    expect(screen.queryByText(capture.text)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh Inbox" }));
    expect(await screen.findByText(capture.text)).toBeInTheDocument();
  });

  it("reconciles a confirmed task when navigation unmounts the pending review", async () => {
    const acceptance = deferred<{ task: Todo; created: boolean }>();
    vi.mocked(acceptCapture).mockReturnValue(acceptance.promise);
    const onAccepted = vi.fn();
    const { unmount } = render(<InboxReview onAccepted={onAccepted} />);
    await screen.findByText(capture.text);
    fireEvent.click(screen.getByRole("button", { name: "Accept to Tasks" }));
    unmount();
    await act(async () => acceptance.resolve({ task, created: true }));
    expect(onAccepted).toHaveBeenCalledWith(task);
  });

  it("recovers an uncertain acceptance with a fresh Tasks read after an older snapshot", async () => {
    const staleTasks = deferred<void>();
    let cachedTasks: Todo[] = [];
    const onReconcileTasks = vi
      .fn()
      .mockRejectedValueOnce(new Error("Tasks temporarily unavailable"))
      .mockImplementationOnce(async () => {
        await staleTasks.promise;
        cachedTasks = [];
      })
      .mockImplementation(async () => {
        cachedTasks = [task];
      });
    const onAccepted = vi.fn();
    vi.mocked(fetchInboxItems)
      .mockResolvedValueOnce([capture])
      .mockResolvedValueOnce([]);
    vi.mocked(acceptCapture).mockRejectedValue(
      new MutationApiError("Acceptance result uncertain", "uncertain"),
    );
    render(
      <InboxReview
        onAccepted={onAccepted}
        onReconcileTasks={onReconcileTasks}
      />,
    );
    await screen.findByText("Tasks temporarily unavailable");
    fireEvent.click(
      screen.getByRole("button", { name: "Retry refreshing Tasks" }),
    );
    await waitFor(() => expect(onReconcileTasks).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("button", { name: "Accept to Tasks" }));
    await screen.findByText("Acceptance result uncertain");
    fireEvent.click(screen.getByRole("button", { name: "Refresh Inbox" }));
    await waitFor(() => expect(fetchInboxItems).toHaveBeenCalledTimes(2));
    expect(onReconcileTasks).toHaveBeenCalledTimes(2);
    await act(async () => staleTasks.resolve());
    await screen.findByText("Inbox is clear");
    expect(onReconcileTasks).toHaveBeenCalledTimes(4);
    expect(cachedTasks).toEqual([task]);
    expect(onAccepted).not.toHaveBeenCalled();
    expect(acceptCapture).toHaveBeenCalledOnce();
    expect(discardCapture).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps Inbox usable when Tasks refresh fails and awaits a truthful refresh result", async () => {
    const refreshRef = { current: null as (() => Promise<boolean>) | null };
    const tasksRead = deferred<void>();
    const onReconcileTasks = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(async () => {
        await tasksRead.promise;
        throw new Error("Task read failed");
      })
      .mockResolvedValueOnce(undefined);
    render(
      <InboxReview
        onAccepted={vi.fn()}
        onReconcileTasks={onReconcileTasks}
        refreshRef={refreshRef}
      />,
    );
    await screen.findByText(capture.text);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Refresh Inbox" }),
      ).toBeEnabled(),
    );
    let finished = false;
    let refresh!: Promise<boolean>;
    await act(async () => {
      refresh = refreshRef.current!().then((result) => {
        finished = true;
        return result;
      });
    });
    expect(finished).toBe(false);
    expect(
      screen.getByRole("button", { name: "Accept to Tasks" }),
    ).toBeEnabled();
    await act(async () => tasksRead.resolve());
    await expect(refresh).resolves.toBe(false);
    expect(screen.getByRole("alert")).toHaveTextContent("Task read failed");
    expect(screen.getByText(capture.text)).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Retry refreshing Tasks" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
    );
    expect(onReconcileTasks).toHaveBeenCalledTimes(3);
    expect(acceptCapture).not.toHaveBeenCalled();
    expect(discardCapture).not.toHaveBeenCalled();
  });

  it("does not let an earlier task reconciliation overwrite a newer Inbox load error", async () => {
    const staleTasks = deferred<void>();
    const onReconcileTasks = vi.fn(async () => {
      await staleTasks.promise;
      throw new Error("Older Tasks error");
    });
    vi.mocked(fetchInboxItems)
      .mockResolvedValueOnce([capture])
      .mockRejectedValueOnce(new Error("Latest Inbox error"));
    const refreshRef = { current: null as (() => Promise<boolean>) | null };
    render(
      <InboxReview
        onAccepted={vi.fn()}
        onReconcileTasks={onReconcileTasks}
        refreshRef={refreshRef}
      />,
    );
    await screen.findByText(capture.text);
    await act(async () => {
      await refreshRef.current!();
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Latest Inbox error");
    await act(async () => staleTasks.resolve());
    expect(screen.getByRole("alert")).toHaveTextContent("Latest Inbox error");
    expect(screen.queryByText("Older Tasks error")).not.toBeInTheDocument();
    expect(screen.queryByText("Loading Inbox…")).not.toBeInTheDocument();
  });

  it("serializes confirmed acceptance with a newer Inbox refresh", async () => {
    const acceptedTasksRead = deferred<void>();
    let acceptedReadPending = false;
    const onAccepted = vi.fn(async () => {
      acceptedReadPending = true;
      await acceptedTasksRead.promise;
      acceptedReadPending = false;
    });
    const onReconcileTasks = vi.fn(async () => {
      expect(acceptedReadPending).toBe(false);
    });
    const refreshRef = { current: null as (() => Promise<boolean>) | null };
    vi.mocked(acceptCapture).mockResolvedValue({ task, created: true });
    vi.mocked(fetchInboxItems)
      .mockResolvedValueOnce([capture])
      .mockResolvedValueOnce([]);
    render(
      <InboxReview
        onAccepted={onAccepted}
        onReconcileTasks={onReconcileTasks}
        refreshRef={refreshRef}
      />,
    );
    await screen.findByText(capture.text);
    fireEvent.click(screen.getByRole("button", { name: "Accept to Tasks" }));
    await waitFor(() => expect(onAccepted).toHaveBeenCalledWith(task));
    let refresh!: Promise<boolean>;
    await act(async () => {
      refresh = refreshRef.current!();
    });
    expect(onReconcileTasks).toHaveBeenCalledOnce();
    await act(async () => acceptedTasksRead.resolve());
    await expect(refresh).resolves.toBe(true);
    expect(onReconcileTasks).toHaveBeenCalledTimes(2);
    expect(
      screen.queryByText(
        "Accepted to Tasks. Refresh Tasks to see the saved task.",
      ),
    ).not.toBeInTheDocument();
  });

  it("acknowledges acceptance even when Tasks could not refresh", async () => {
    const onReconcileTasks = vi.fn();
    vi.mocked(acceptCapture).mockResolvedValue({ task, created: true });
    render(
      <InboxReview
        onAccepted={async () => {
          throw new Error("refresh failed");
        }}
        onReconcileTasks={onReconcileTasks}
      />,
    );
    await screen.findByText(capture.text);
    fireEvent.click(screen.getByRole("button", { name: "Accept to Tasks" }));
    await screen.findByText(
      "Accepted to Tasks. Refresh Tasks to see the saved task.",
    );
    expect(screen.getByRole("alert")).toHaveTextContent("refresh failed");
    fireEvent.click(
      screen.getByRole("button", { name: "Retry refreshing Tasks" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
    );
    expect(onReconcileTasks).toHaveBeenCalledTimes(2);
    expect(acceptCapture).toHaveBeenCalledOnce();
  });

  it("checks ambiguous saves before retry and keeps the original draft key", async () => {
    vi.mocked(captureInboxItem)
      .mockRejectedValueOnce(
        new MutationApiError("Result uncertain", "uncertain"),
      )
      .mockResolvedValueOnce({
        ...capture,
        text: "New intention",
        source: "manual",
      });
    vi.mocked(fetchInboxItems).mockResolvedValue([]);
    render(<InboxReview onAccepted={vi.fn()} />);
    await screen.findByText("Inbox is clear");
    fireEvent.change(screen.getByLabelText("Save an intention for review"), {
      target: { value: "New intention" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save to Inbox" }));
    await screen.findByText("Result uncertain");
    expect(
      screen.getByRole("button", { name: "Save to Inbox" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Check Inbox" }));
    await screen.findByText(
      "No matching capture is in the refreshed Inbox. You can retry saving this draft.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Save to Inbox" }));
    await screen.findByText("Saved to Inbox for review.");
    expect(captureInboxItem).toHaveBeenCalledTimes(2);
    expect(vi.mocked(captureInboxItem).mock.calls[0][2]).toBe(
      vi.mocked(captureInboxItem).mock.calls[1][2],
    );
    expect(screen.getByText("New intention")).toBeInTheDocument();
  });

  it("uses a new draft key after explicitly clearing an uncertain save", async () => {
    vi.mocked(captureInboxItem)
      .mockRejectedValueOnce(
        new MutationApiError("Result uncertain", "uncertain"),
      )
      .mockResolvedValueOnce({ ...capture, text: "New intention" });
    vi.mocked(fetchInboxItems).mockResolvedValue([]);
    render(<InboxReview onAccepted={vi.fn()} />);
    await screen.findByText("Inbox is clear");
    const input = screen.getByLabelText("Save an intention for review");
    fireEvent.change(input, { target: { value: "New intention" } });
    fireEvent.click(screen.getByRole("button", { name: "Save to Inbox" }));
    await screen.findByText("Result uncertain");
    fireEvent.click(screen.getByRole("button", { name: "Clear draft" }));
    fireEvent.change(input, { target: { value: "New intention" } });
    fireEvent.click(screen.getByRole("button", { name: "Save to Inbox" }));
    await screen.findByText("Saved to Inbox for review.");
    expect(vi.mocked(captureInboxItem).mock.calls[1][2]).not.toBe(
      vi.mocked(captureInboxItem).mock.calls[0][2],
    );
  });
});
