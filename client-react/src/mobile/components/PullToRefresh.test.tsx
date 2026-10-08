// @vitest-environment jsdom
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PullToRefresh } from "./PullToRefresh";

const touch = (clientX: number, clientY: number, identifier = 1) => ({
  identifier,
  clientX,
  clientY,
});
function setup(
  onRefresh: () => Promise<void | boolean> = vi
    .fn()
    .mockResolvedValue(undefined),
  disabled = false,
) {
  const open = vi.fn();
  const view = render(
    <div style={{ overflowY: "auto" }} data-testid="scroll-owner">
      <PullToRefresh onRefresh={onRefresh} disabled={disabled}>
        <button onClick={open}>Task</button>
        <input aria-label="Task title" />
      </PullToRefresh>
    </div>,
  );
  const wrapper = view.container.querySelector(".m-pull-refresh")!;
  return { ...view, wrapper, owner: screen.getByTestId("scroll-owner"), open };
}
function pull(wrapper: Element, x = 0, y = 260) {
  fireEvent.touchStart(wrapper, { touches: [touch(100, 0)] });
  fireEvent.touchMove(wrapper, { touches: [touch(100 + x, y)] });
  fireEvent.touchEnd(wrapper, { changedTouches: [touch(100 + x, y)] });
}

describe("PullToRefresh", () => {
  it("refreshes on a deliberate vertical pull from the actual scroll owner top, including y=0", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const { wrapper } = setup(onRefresh);
    expect(screen.getByRole("button", { name: "Task" })).toBeVisible();
    pull(wrapper);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent("Refreshing");
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Refresh complete"),
    );
  });

  it("does not refresh when the parent list is scrolled, even though the wrapper scrollTop is zero", () => {
    const onRefresh = vi.fn();
    const { wrapper, owner } = setup(onRefresh);
    owner.scrollTop = 50;
    pull(wrapper);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("rejects horizontal and diagonal gestures even when later movement turns vertical", () => {
    const onRefresh = vi.fn();
    const { wrapper } = setup(onRefresh);
    pull(wrapper, 260, 10);
    pull(wrapper, 260, 260);
    fireEvent.touchStart(wrapper, { touches: [touch(100, 0)] });
    fireEvent.touchMove(wrapper, { touches: [touch(125, 25)] });
    fireEvent.touchMove(wrapper, { touches: [touch(125, 300)] });
    fireEvent.touchEnd(wrapper, { changedTouches: [touch(125, 300)] });
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("cancels touchcancel and multi-touch without refreshing", () => {
    const onRefresh = vi.fn();
    const { wrapper } = setup(onRefresh);
    fireEvent.touchStart(wrapper, { touches: [touch(100, 0)] });
    fireEvent.touchMove(wrapper, { touches: [touch(100, 260)] });
    fireEvent.touchCancel(wrapper);
    fireEvent.touchEnd(wrapper, { changedTouches: [touch(100, 260)] });
    fireEvent.touchStart(wrapper, { touches: [touch(100, 0)] });
    fireEvent.touchMove(wrapper, {
      touches: [touch(100, 260), touch(150, 260, 2)],
    });
    fireEvent.touchEnd(wrapper, { changedTouches: [touch(100, 260)] });
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("does not steal gestures from a form field, nested scrolling area or modal", () => {
    const onRefresh = vi.fn();
    const { wrapper, container } = setup(onRefresh);
    pull(screen.getByLabelText("Task title"));
    const nested = document.createElement("div");
    nested.style.overflowY = "auto";
    Object.defineProperty(nested, "scrollHeight", { value: 500 });
    Object.defineProperty(nested, "clientHeight", { value: 100 });
    wrapper.append(nested);
    pull(nested);
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    container.append(dialog);
    pull(wrapper);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("prevents duplicate refreshes while pending and suppresses the drag-ending pointer click", async () => {
    let finish!: () => void;
    const onRefresh = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const { wrapper, open } = setup(onRefresh);
    pull(wrapper);
    pull(wrapper);
    fireEvent.click(screen.getByRole("button", { name: "Task" }), {
      detail: 1,
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
    await act(async () => finish());
    expect(wrapper).toHaveAttribute("aria-busy", "false");
  });

  it("preserves current content after failure and supports one explicit retry", async () => {
    const onRefresh = vi
      .fn()
      .mockRejectedValueOnce(new Error("Unable to fetch tasks"))
      .mockResolvedValueOnce(true);
    const { wrapper } = setup(onRefresh);
    pull(wrapper);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to fetch tasks",
    );
    expect(screen.getByRole("button", { name: "Task" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Retry refresh" }));
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Refresh complete"),
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("treats an unapplied refresh as failure and does not claim success", async () => {
    const { wrapper } = setup(vi.fn().mockResolvedValue(false));
    pull(wrapper);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not refresh",
    );
    expect(screen.queryByText("Refresh complete")).toBeNull();
  });

  it("ignores pulls when explicitly disabled", () => {
    const onRefresh = vi.fn();
    const { wrapper } = setup(onRefresh, true);
    pull(wrapper);
    expect(onRefresh).not.toHaveBeenCalled();
  });
});
