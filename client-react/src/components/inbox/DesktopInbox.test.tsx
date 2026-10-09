import { useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acceptCapture,
  captureInboxItem,
  discardCapture,
  fetchInboxItems,
  type CaptureItemDto,
} from "../../api/inbox";
import type { Todo } from "../../types";
import { ViewRoute, ViewRouter } from "../layout/ViewRouter";
import { DesktopInbox } from "./DesktopInbox";

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
  title: "Read revised notes",
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

// The Inbox lives beside both the page conditional and the bounded view cache.
function DesktopNavigation({
  userId = "user-1",
  onAccepted = () => {},
}: {
  userId?: string;
  onAccepted?: (accepted: Todo) => void;
}) {
  const [view, setView] = useState("inbox");
  const [page, setPage] = useState("todos");
  const views = ["Inbox", "Today", "Tasks", "Horizon", "Focus"];
  return (
    <>
      <nav aria-label="Sections">
        {views.map((label) => (
          <button
            key={label}
            onClick={() => {
              setPage("todos");
              setView(label.toLowerCase());
            }}
          >
            {label}
          </button>
        ))}
        {["Settings", "Review", "Activity"].map((label) => (
          <button key={label} onClick={() => setPage(label.toLowerCase())}>
            {label}
          </button>
        ))}
      </nav>
      <DesktopInbox
        userId={userId}
        isActive={page === "todos" && view === "inbox"}
        onAccepted={onAccepted}
      />
      {page === "todos" ? (
        <ViewRouter activeViewKey={view} capacity={3}>
          {views.slice(1).map((label) => (
            <ViewRoute key={label} viewKey={label.toLowerCase()}>
              <p>{label} content</p>
            </ViewRoute>
          ))}
        </ViewRouter>
      ) : (
        <p>{page} content</p>
      )}
    </>
  );
}

function go(label: string) {
  fireEvent.click(screen.getByRole("button", { name: label }));
}

function editTitle(value = task.title) {
  fireEvent.click(screen.getByRole("button", { name: "Edit title" }));
  fireEvent.change(screen.getByLabelText("Task title"), {
    target: { value },
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(fetchInboxItems).mockResolvedValue([capture]);
});
afterEach(cleanup);

describe("Desktop Inbox drafts", () => {
  it("preserves capture and title drafts across cache eviction, top-level pages, and refresh", async () => {
    render(<DesktopNavigation />);
    await screen.findByText(capture.text);
    const captureInput = screen.getByLabelText("Save an intention for review");
    fireEvent.change(captureInput, {
      target: { value: "Unfinished intention" },
    });
    editTitle();
    for (const label of ["Today", "Tasks", "Horizon", "Focus"]) go(label);
    // Regular sections still obey the three-view cache limit.
    expect(screen.queryByText("Today content")).not.toBeInTheDocument();
    expect(
      document.querySelectorAll(
        '.view-router__slot:not([data-view-key="inbox"])',
      ),
    ).toHaveLength(3);
    expect(captureInput).not.toBeVisible();
    expect(captureInput.closest("[hidden]")).not.toBeNull();
    expect(
      screen.queryByRole("textbox", { name: "Save an intention for review" }),
    ).not.toBeInTheDocument();
    for (const label of ["Settings", "Review", "Activity"]) go(label);
    expect(fetchInboxItems).toHaveBeenCalledTimes(1);
    go("Inbox");
    await waitFor(() => expect(fetchInboxItems).toHaveBeenCalledTimes(2));
    expect(captureInput).toBeVisible();
    expect(captureInput).toHaveValue("Unfinished intention");
    expect(screen.getByLabelText("Task title")).toHaveValue(task.title);

    const refresh = deferred<(typeof capture)[]>();
    vi.mocked(fetchInboxItems).mockReturnValueOnce(refresh.promise);
    fireEvent.click(screen.getByRole("button", { name: "Refresh Inbox" }));
    expect(screen.getByText("Loading Inbox…")).toBeInTheDocument();
    expect(screen.getByLabelText("Task title")).toHaveValue(task.title);
    await act(async () => refresh.resolve([{ ...capture }]));
    expect(captureInput).toHaveValue("Unfinished intention");
    expect(screen.getByLabelText("Task title")).toHaveValue(task.title);
    expect(acceptCapture).not.toHaveBeenCalled();
    expect(discardCapture).not.toHaveBeenCalled();
    expect(captureInboxItem).not.toHaveBeenCalled();
  });

  it("keeps discard cancellation calm and restores the original title when explicitly canceled", async () => {
    render(<DesktopNavigation />);
    await screen.findByText(capture.text);
    editTitle();
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    go("Today");
    go("Tasks");
    go("Horizon");
    go("Inbox");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByLabelText("Task title")).toHaveValue(task.title);
    fireEvent.click(screen.getByRole("button", { name: "Cancel title edit" }));
    expect(screen.queryByLabelText("Task title")).not.toBeInTheDocument();
    expect(screen.getByText(capture.text)).toBeInTheDocument();
    expect(acceptCapture).not.toHaveBeenCalled();
    expect(discardCapture).not.toHaveBeenCalled();
  });

  it("clears only the confirmed capture draft and preserves review state until discard succeeds", async () => {
    vi.mocked(fetchInboxItems).mockResolvedValue([]);
    const saved = { ...capture, text: "New intention", source: "manual" };
    vi.mocked(captureInboxItem).mockResolvedValue(saved);
    const discarded = deferred<CaptureItemDto>();
    vi.mocked(discardCapture).mockReturnValueOnce(discarded.promise);
    render(<DesktopNavigation />);
    await screen.findByText("Inbox is clear");
    const input = screen.getByLabelText("Save an intention for review");
    fireEvent.change(input, { target: { value: saved.text } });
    fireEvent.click(screen.getByRole("button", { name: "Save to Inbox" }));
    await screen.findByText("Saved to Inbox for review.");
    expect(input).toHaveValue("");
    vi.mocked(fetchInboxItems).mockResolvedValue([saved]);
    go("Settings");
    go("Inbox");
    await screen.findByText(saved.text);
    editTitle("Edited saved intention");
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm discard" }));
    go("Activity");
    expect(input).not.toBeVisible();
    await act(async () =>
      discarded.resolve({ ...saved, lifecycle: "discarded" }),
    );
    vi.mocked(fetchInboxItems).mockResolvedValue([]);
    go("Inbox");
    await screen.findByText("Capture discarded.");
    expect(screen.queryByLabelText("Task title")).not.toBeInTheDocument();
    expect(input).toHaveValue("");
  });

  it("accepts the retained edited title while hidden without losing an unrelated capture draft", async () => {
    const acceptance = deferred<{ task: Todo; created: boolean }>();
    vi.mocked(acceptCapture).mockReturnValueOnce(acceptance.promise);
    const onAccepted = vi.fn();
    render(<DesktopNavigation onAccepted={onAccepted} />);
    await screen.findByText(capture.text);
    const input = screen.getByLabelText("Save an intention for review");
    fireEvent.change(input, {
      target: { value: "Another unfinished thought" },
    });
    editTitle();
    go("Today");
    go("Tasks");
    go("Horizon");
    go("Inbox");
    fireEvent.click(screen.getByRole("button", { name: "Accept to Tasks" }));
    expect(acceptCapture).toHaveBeenCalledWith(capture.id, task.title);
    go("Settings");
    await act(async () => acceptance.resolve({ task, created: true }));
    expect(onAccepted).toHaveBeenCalledWith(task);
    vi.mocked(fetchInboxItems).mockResolvedValue([]);
    go("Inbox");
    await screen.findByText("Inbox is clear");
    expect(screen.queryByLabelText("Task title")).not.toBeInTheDocument();
    expect(input).toHaveValue("Another unfinished thought");
  });

  it("resets drafts, edited titles, errors, and retry keys when the account changes", async () => {
    vi.mocked(captureInboxItem)
      .mockRejectedValueOnce(new Error("Synthetic save failure"))
      .mockResolvedValueOnce({
        ...capture,
        id: "capture-2",
        text: "New thought",
      });
    const { rerender } = render(<DesktopNavigation userId="user-1" />);
    await screen.findByText(capture.text);
    editTitle();
    fireEvent.change(screen.getByLabelText("Save an intention for review"), {
      target: { value: "New thought" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save to Inbox" }));
    await screen.findByText("Synthetic save failure");
    const oldKey = vi.mocked(captureInboxItem).mock.calls[0][2];
    vi.mocked(fetchInboxItems).mockResolvedValue([]);
    rerender(<DesktopNavigation userId="user-2" />);
    await screen.findByText("Inbox is clear");
    expect(screen.getByLabelText("Save an intention for review")).toHaveValue(
      "",
    );
    expect(screen.queryByLabelText("Task title")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText(capture.text)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Save an intention for review"), {
      target: { value: "New thought" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save to Inbox" }));
    await screen.findByText("Saved to Inbox for review.");
    expect(vi.mocked(captureInboxItem).mock.calls[1][2]).not.toBe(oldKey);
  });
});
