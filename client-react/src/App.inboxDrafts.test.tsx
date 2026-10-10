import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acceptCapture,
  captureInboxItem,
  discardCapture,
  fetchInboxItems,
  type CaptureItemDto,
} from "./api/inbox";
import { MutationApiError } from "./api/mutations";
import { keepInboxDraftsFor } from "./components/inbox/inboxDrafts";
import type { Todo, User } from "./types";
import { App } from "./App";

// The real AuthGate swaps shells; each stub hosts the real Inbox exactly as its
// shell does and records which shell and account received each callback.
const shell = vi.hoisted(() => ({
  user: null as { id: string; email: string } | null,
  mobile: false,
  mountInbox: true,
  calls: [] as string[],
}));

vi.mock("./auth/AuthProvider", () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => ({ user: shell.user, loading: false }),
}));
vi.mock("./hooks/useIsMobile", () => ({ useIsMobile: () => shell.mobile }));
vi.mock("./utils/pageTransitions", () => ({ navigateWithFade: vi.fn() }));
vi.mock("./auth/AuthPage", () => ({ AuthPage: () => null }));
vi.mock("./views/FeedbackView", () => ({ FeedbackView: () => null }));
vi.mock("./api/inbox", () => ({
  acceptCapture: vi.fn(),
  captureInboxItem: vi.fn(),
  discardCapture: vi.fn(),
  fetchInboxItems: vi.fn(),
}));
vi.mock("./components/layout/AppShell", async () => {
  const { DesktopInbox } = await import("./components/inbox/DesktopInbox");
  return {
    AppShell: () => {
      const id = shell.user!.id;
      return shell.mountInbox ? (
        <DesktopInbox
          userId={id}
          isActive
          onAccepted={() => void shell.calls.push(`desktop:${id}:accepted`)}
          onReconcileTasks={() =>
            void shell.calls.push(`desktop:${id}:reconcile`)
          }
        />
      ) : null;
    },
  };
});
vi.mock("./mobile/MobileShell", async () => {
  const { InboxScreen } = await import("./mobile/screens/InboxScreen");
  const { ViewActivityProvider } =
    await import("./components/layout/ViewActivityContext");
  return {
    MobileShell: () => {
      const id = shell.user!.id;
      return (
        <ViewActivityProvider isActive>
          <InboxScreen
            user={shell.user as User}
            refreshRef={{ current: null }}
            onAvatarClick={() => {}}
            onSearch={() => {}}
            onOpenTask={() => {}}
            onAccepted={() => void shell.calls.push(`mobile:${id}:accepted`)}
            onReconcileTasks={() =>
              void shell.calls.push(`mobile:${id}:reconcile`)
            }
          />
        </ViewActivityProvider>
      );
    },
  };
});

const capture: CaptureItemDto = {
  id: "capture-1",
  text: "Read design notes\nThen reply",
  source: "api",
  lifecycle: "new",
  capturedAt: "2026-10-08T12:00:00.000Z",
  createdAt: "2026-10-08T12:00:00.000Z",
  updatedAt: "2026-10-08T12:00:00.000Z",
};
const task = { id: "task-1", title: "Edited title" } as Todo;
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};

let view: ReturnType<typeof render>;
const signIn = (id: string) =>
  (shell.user = { id, email: `${id}@example.test` });
const swap = (mobile: boolean) => {
  shell.mobile = mobile;
  view.rerender(<App />);
};
// The replacement shell rereads server rows; only drafts are retained.
const settle = () =>
  waitFor(() => expect(screen.queryByText("Loading Inbox…")).toBeNull());
const captureBox = () =>
  screen.getByRole("textbox", { name: "Save an intention for review" });
const titleBox = () => screen.queryByRole("textbox", { name: "Task title" });
const row = () => screen.getByRole("listitem");
const findCapture = () =>
  screen.findByRole("heading", { name: "Read design notes Then reply" });
const callsSince = (start: number) => shell.calls.slice(start);

async function startWithDrafts() {
  view = render(<App />);
  await findCapture();
  fireEvent.change(captureBox(), { target: { value: "Unsaved thought" } });
  fireEvent.click(screen.getByRole("button", { name: "Edit title" }));
  fireEvent.change(titleBox()!, { target: { value: task.title } });
}

beforeEach(() => {
  vi.resetAllMocks();
  keepInboxDraftsFor(null);
  Object.assign(shell, { mobile: false, mountInbox: true, calls: [] });
  signIn("user-a");
  vi.mocked(fetchInboxItems).mockResolvedValue([capture]);
});
afterEach(cleanup);

describe("Inbox drafts across the desktop/mobile shell swap", () => {
  it("keeps an account's unsaved capture and title in memory in both directions", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    await startWithDrafts();
    swap(true);
    await settle();
    expect(document.querySelector(".m-screen--inbox")).not.toBeNull();
    expect(captureBox()).toHaveValue("Unsaved thought");
    expect(titleBox()).toHaveValue(task.title);
    fireEvent.change(captureBox(), { target: { value: "Unsaved thought 2" } });
    swap(false);
    await settle();
    expect(document.querySelector(".m-screen--inbox")).toBeNull();
    expect(captureBox()).toHaveValue("Unsaved thought 2");
    expect(titleBox()).toHaveValue(task.title);
    expect(
      setItem.mock.calls.filter(([, value]) => value.includes("Unsaved")),
    ).toEqual([]);
    expect(captureInboxItem).not.toHaveBeenCalled();
    expect(acceptCapture).not.toHaveBeenCalled();
    setItem.mockRestore();
  });

  it("keeps a pending accept blocked across the swap and settles it without another click", async () => {
    const acceptance = deferred<{ task: Todo; created: boolean }>();
    vi.mocked(acceptCapture).mockReturnValueOnce(acceptance.promise);
    await startWithDrafts();
    fireEvent.click(screen.getByRole("button", { name: "Accept to Tasks" }));
    swap(true);
    await settle();
    const saving = within(row()).getByRole("button", { name: "Saving…" });
    expect(saving).toBeDisabled();
    expect(
      within(row()).getByRole("button", { name: "Discard" }),
    ).toBeDisabled();
    fireEvent.click(saving);
    expect(acceptCapture).toHaveBeenCalledTimes(1);
    expect(acceptCapture).toHaveBeenCalledWith(capture.id, task.title);

    const before = shell.calls.length;
    vi.mocked(fetchInboxItems).mockResolvedValue([]);
    await act(async () => acceptance.resolve({ task, created: true }));
    await screen.findByText("Inbox is clear");
    // The live shell rereads Inbox and reconciles its own Tasks.
    expect(callsSince(before)).toContain("mobile:user-a:reconcile");
    expect(captureBox()).toHaveValue("Unsaved thought");
    swap(false);
    await screen.findByText("Inbox is clear");
    expect(titleBox()).not.toBeInTheDocument();
    expect(captureBox()).toHaveValue("Unsaved thought");
  });

  it("removes a held review's row even when the replacement shell's reread fails", async () => {
    const discard = deferred<CaptureItemDto>();
    vi.mocked(discardCapture).mockReturnValueOnce(discard.promise);
    view = render(<App />);
    await findCapture();
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm discard" }));
    swap(true);
    await waitFor(() =>
      expect(screen.queryByText("Loading Inbox…")).toBeNull(),
    );
    expect(
      within(row()).getByRole("button", { name: "Discard" }),
    ).toBeDisabled();
    vi.mocked(fetchInboxItems).mockRejectedValue(new Error("Offline reread"));
    await act(async () =>
      discard.resolve({ ...capture, lifecycle: "discarded" }),
    );
    await screen.findByText("Offline reread");
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
    expect(discardCapture).toHaveBeenCalledTimes(1);
  });

  it("surfaces a failed pending accept in the replacement shell and retries the retained title", async () => {
    const acceptance = deferred<{ task: Todo; created: boolean }>();
    vi.mocked(acceptCapture)
      .mockReturnValueOnce(acceptance.promise)
      .mockResolvedValueOnce({ task, created: false });
    await startWithDrafts();
    fireEvent.click(screen.getByRole("button", { name: "Accept to Tasks" }));
    swap(true);
    const before = shell.calls.length;
    await act(async () =>
      acceptance.reject(
        new MutationApiError("Acceptance could not be confirmed.", "uncertain"),
      ),
    );
    await within(row()).findByText("Acceptance could not be confirmed.");
    expect(callsSince(before)).toContain("mobile:user-a:reconcile");
    expect(titleBox()).toHaveValue(task.title);
    const accept = within(row()).getByRole("button", {
      name: "Accept to Tasks",
    });
    expect(accept).toBeEnabled();
    vi.mocked(fetchInboxItems).mockResolvedValue([]);
    fireEvent.click(accept);
    await screen.findByText("Inbox is clear");
    expect(acceptCapture).toHaveBeenLastCalledWith(capture.id, task.title);
    expect(acceptCapture).toHaveBeenCalledTimes(2);
  });

  it("keeps capture-save guards across the swap and clears a confirmed draft without resurrecting it", async () => {
    const save = deferred<CaptureItemDto>();
    vi.mocked(captureInboxItem).mockReturnValueOnce(save.promise);
    await startWithDrafts();
    fireEvent.click(screen.getByRole("button", { name: "Save to Inbox" }));
    swap(true);
    expect(captureBox()).toHaveValue("Unsaved thought");
    expect(captureBox()).toBeDisabled();
    const saving = screen.getByRole("button", { name: "Saving…" });
    expect(saving).toBeDisabled();
    fireEvent.submit(captureBox().closest("form")!);
    expect(captureInboxItem).toHaveBeenCalledTimes(1);

    const saved = { ...capture, id: "capture-2", text: "Unsaved thought" };
    vi.mocked(fetchInboxItems).mockResolvedValue([capture, saved]);
    await act(async () => save.resolve(saved));
    expect(captureBox()).toHaveValue("");
    expect(captureBox()).toBeEnabled();
    await screen.findByText("Unsaved thought");
    swap(false);
    expect(captureBox()).toHaveValue("");
    expect(captureInboxItem).toHaveBeenCalledTimes(1);
  });

  it("keeps an uncertain save's check gate and retry key across the swap", async () => {
    vi.mocked(captureInboxItem)
      .mockRejectedValueOnce(
        new MutationApiError(
          "The saved capture could not be confirmed.",
          "uncertain",
        ),
      )
      .mockResolvedValueOnce({
        ...capture,
        id: "capture-2",
        text: "Unsaved thought",
      });
    await startWithDrafts();
    fireEvent.click(screen.getByRole("button", { name: "Save to Inbox" }));
    await screen.findByText("The saved capture could not be confirmed.");
    const firstKey = vi.mocked(captureInboxItem).mock.calls[0][2];
    swap(true);
    await settle();
    expect(captureBox()).toHaveValue("Unsaved thought");
    expect(
      screen.getByText("The saved capture could not be confirmed."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Save to Inbox" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Check Inbox" }));
    await screen.findByText(/No matching capture is in the refreshed Inbox/);
    fireEvent.click(screen.getByRole("button", { name: "Save to Inbox" }));
    await screen.findByText("Saved to Inbox for review.");
    expect(vi.mocked(captureInboxItem).mock.calls[1][2]).toBe(firstKey);
  });

  it("releases drafts at logout so the same account starts clean", async () => {
    await startWithDrafts();
    shell.user = null;
    view.rerender(<App />);
    signIn("user-a");
    swap(true);
    await findCapture();
    expect(captureBox()).toHaveValue("");
    expect(titleBox()).not.toBeInTheDocument();
  });

  it("does not restore A's drafts after A→B→A when B's Inbox never mounted", async () => {
    await startWithDrafts();
    signIn("user-b");
    shell.mountInbox = false;
    view.rerender(<App />);
    signIn("user-a");
    shell.mountInbox = true;
    view.rerender(<App />);
    await findCapture();
    expect(captureBox()).toHaveValue("");
    expect(titleBox()).not.toBeInTheDocument();
  });

  it("keeps a late account-A accept and save from touching account B's drafts or Tasks", async () => {
    const acceptance = deferred<{ task: Todo; created: boolean }>();
    const save = deferred<CaptureItemDto>();
    vi.mocked(acceptCapture).mockReturnValueOnce(acceptance.promise);
    vi.mocked(captureInboxItem).mockReturnValueOnce(save.promise);
    await startWithDrafts();
    fireEvent.click(screen.getByRole("button", { name: "Accept to Tasks" }));
    fireEvent.click(screen.getByRole("button", { name: "Save to Inbox" }));

    const bCapture = { ...capture, id: "capture-b", text: "B capture" };
    vi.mocked(fetchInboxItems).mockResolvedValue([bCapture]);
    signIn("user-b");
    swap(true);
    await screen.findByText("B capture");
    expect(captureBox()).toHaveValue("");
    expect(captureBox()).toBeEnabled();
    fireEvent.change(captureBox(), { target: { value: "B draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Edit title" }));
    fireEvent.change(titleBox()!, { target: { value: "B title" } });

    const before = shell.calls.length;
    await act(async () => {
      acceptance.resolve({ task, created: true });
      save.resolve({ ...capture, id: "capture-a2", text: "Unsaved thought" });
    });
    // A's late outcomes neither reconcile through B's session nor refresh B.
    expect(callsSince(before)).toEqual([]);
    expect(fetchInboxItems).toHaveBeenCalledTimes(2);
    expect(captureBox()).toHaveValue("B draft");
    expect(titleBox()).toHaveValue("B title");
    expect(screen.getByText("B capture")).toBeInTheDocument();
    expect(screen.queryByText("Saved to Inbox for review.")).toBeNull();
  });
});
