// @vitest-environment jsdom
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SwipeRow } from "./SwipeRow";

function touch(identifier: number, clientX: number, clientY: number) {
  return { identifier, clientX, clientY };
}
function swipe(content: Element, x: number, y = 0) {
  fireEvent.touchStart(content, { touches: [touch(1, 100, 100)] });
  fireEvent.touchMove(content, { touches: [touch(1, 100 + x, 100 + y)] });
  fireEvent.touchEnd(content, { changedTouches: [touch(1, 100 + x, 100 + y)] });
}
function setup(action: () => void | Promise<unknown> = vi.fn()) {
  const open = vi.fn();
  const view = render(
    <SwipeRow onSwipeRight={action}>
      <button onClick={open}>Task details</button>
    </SwipeRow>,
  );
  return {
    ...view,
    open,
    content: view.container.querySelector(".m-swipe-row__content")!,
    row: view.container.querySelector(".m-swipe-row")!,
  };
}

describe("SwipeRow", () => {
  it("waits for saved completion, prevents duplicate gestures, and leaves a retained row visible", async () => {
    let finish!: (saved: boolean) => void;
    const action = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    const { content, container, row } = setup(action);
    swipe(content, 110);
    swipe(content, 110);
    expect(action).toHaveBeenCalledTimes(1);
    expect(row).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Saving");
    expect(container.querySelector(".m-burst")).toBeNull();
    await act(async () => finish(true));
    expect(container.querySelector(".m-burst")).toBeTruthy();
    expect(row).toHaveAttribute("aria-busy", "false");
    expect(screen.getByRole("button", { name: "Task details" })).toBeVisible();
    expect(row).not.toHaveClass("m-swipe-row--completing");
  });

  it("does not celebrate a rejected completion or an action without a saved result", async () => {
    const { content, container, rerender } = setup(
      vi.fn().mockResolvedValue(false),
    );
    swipe(content, 110);
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    expect(container.querySelector(".m-burst")).toBeNull();
    rerender(<SwipeRow onSwipeRight={() => undefined}>Still here</SwipeRow>);
    swipe(content, 110);
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    expect(container.querySelector(".m-burst")).toBeNull();
  });

  it("retains the row after an error and offers an explicit retry", async () => {
    const action = vi
      .fn()
      .mockRejectedValueOnce(new Error("Could not save"))
      .mockResolvedValueOnce(true);
    const { content, container } = setup(action);
    swipe(content, 110);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not save",
    );
    expect(container.querySelector(".m-burst")).toBeNull();
    expect(screen.getByRole("button", { name: "Task details" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Retry action" }));
    await waitFor(() => expect(action).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(container.querySelector(".m-burst")).toBeTruthy();
  });

  it("suppresses the pointer click after a horizontal drag but preserves keyboard activation", () => {
    const action = vi.fn();
    const { content, open } = setup(action);
    swipe(content, 25);
    fireEvent.click(screen.getByRole("button"), { detail: 1 });
    expect(open).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button"), { detail: 0 });
    expect(open).toHaveBeenCalledTimes(1);
    expect(action).not.toHaveBeenCalled();
  });

  it("ignores vertical, diagonal, cancelled and multi-touch gestures", () => {
    const action = vi.fn();
    const { content } = setup(action);
    swipe(content, 100, 120);
    swipe(content, 120, 120);
    fireEvent.touchStart(content, { touches: [touch(1, 100, 100)] });
    fireEvent.touchMove(content, { touches: [touch(1, 220, 100)] });
    fireEvent.touchCancel(content);
    fireEvent.touchEnd(content, { changedTouches: [touch(1, 220, 100)] });
    fireEvent.touchStart(content, { touches: [touch(1, 100, 100)] });
    fireEvent.touchMove(content, {
      touches: [touch(1, 220, 100), touch(2, 120, 100)],
    });
    fireEvent.touchEnd(content, { changedTouches: [touch(1, 220, 100)] });
    expect(action).not.toHaveBeenCalled();
    expect(content).not.toHaveStyle({ transform: "translateX(120px)" });
  });
});
