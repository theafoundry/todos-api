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

  it("acknowledges acceptance even when Tasks could not refresh", async () => {
    vi.mocked(acceptCapture).mockResolvedValue({ task, created: true });
    render(
      <InboxReview
        onAccepted={async () => {
          throw new Error("refresh failed");
        }}
      />,
    );
    await screen.findByText(capture.text);
    fireEvent.click(screen.getByRole("button", { name: "Accept to Tasks" }));
    await screen.findByText(
      "Accepted to Tasks. Refresh Tasks to see the saved task.",
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
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
