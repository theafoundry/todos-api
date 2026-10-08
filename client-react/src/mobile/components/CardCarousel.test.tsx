import { act, render, screen, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { CardCarousel } from "./CardCarousel";
import { FlipCard } from "../../components/home/FlipCard";
import { SwipeRow } from "./SwipeRow";

function dragTitle(title: Element, dx: number, dy = 0) {
  const position = { pointerId: 1, isPrimary: true, button: 0 };
  fireEvent.pointerDown(title, { ...position, clientX: 200, clientY: 100 });
  fireEvent.pointerMove(title, {
    ...position,
    clientX: 200 + dx,
    clientY: 100 + dy,
  });
  fireEvent.pointerUp(title, {
    ...position,
    clientX: 200 + dx,
    clientY: 100 + dy,
  });
}

function denseCards(open: () => void, complete: () => void) {
  return ["Focus", "Fold"].map((name) => (
    <div key={name}>
      {Array.from({ length: 8 }, (_, index) => (
        <div key={index}>
          <button data-card-swipe-target onClick={open}>
            <span>
              {name} task {index + 1}
            </span>
          </button>
          <button
            aria-label={`Complete ${name} task ${index + 1}`}
            onClick={complete}
          >
            Complete
          </button>
        </div>
      ))}
      <input aria-label={`${name} task input`} />
    </div>
  ));
}

describe("CardCarousel", () => {
  const cards = [
    <button key="a">Card A task</button>,
    <button key="b">Card B task</button>,
    <button key="c">Card C task</button>,
  ];

  it("keeps inactive slides mounted but inert and hidden from accessibility", () => {
    const { container } = render(<CardCarousel>{cards}</CardCarousel>);
    expect(
      screen.getByRole("button", { name: "Card A task" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Card B task" })).toBeNull();
    expect(container.querySelectorAll(".m-carousel__slide")).toHaveLength(3);
    expect(container.querySelectorAll(".m-carousel__slide")[1]).toHaveAttribute(
      "inert",
    );
    expect(screen.getByRole("status")).toHaveTextContent("Card 1 of 3");
  });

  it("supports direct, next and previous navigation with named buttons", () => {
    render(<CardCarousel>{cards}</CardCarousel>);
    expect(
      screen.getByRole("button", { name: "Previous card" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Card 2 of 3" }));
    expect(
      screen.getByRole("button", { name: "Card B task" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Card A task" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Next card" }));
    expect(screen.getByRole("button", { name: "Next card" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Previous card" }));
    expect(screen.getByRole("status")).toHaveTextContent("Card 2 of 3");
  });

  it("clamps an active position when refreshed cards shrink", () => {
    const { rerender } = render(<CardCarousel>{cards}</CardCarousel>);
    fireEvent.click(screen.getByRole("button", { name: "Card 3 of 3" }));
    rerender(<CardCarousel>{cards.slice(0, 1)}</CardCarousel>);
    expect(
      screen.getByRole("button", { name: "Card A task" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Card 1 of 1");
    expect(
      screen.queryByRole("navigation", { name: "Card position" }),
    ).toBeNull();
  });

  it("explicit navigation remains available from the card back and resets that face", () => {
    render(
      <CardCarousel>
        {[
          <FlipCard key="a" front={<button>A task</button>} back="A source" />,
          <FlipCard key="b" front={<button>B task</button>} back="B source" />,
        ]}
      </CardCarousel>,
    );
    fireEvent.click(screen.getByRole("button", { name: "About this card" }));
    expect(screen.queryByRole("button", { name: "A task" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Next card" }));
    expect(screen.getByRole("button", { name: "B task" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Previous card" }));
    expect(
      within(screen.getByRole("group", { name: "Card 1 of 2" })).getByRole(
        "button",
        { name: "A task" },
      ),
    ).toBeInTheDocument();
  });

  it("swipes dense task titles both directions without opening or completing a task", () => {
    const open = vi.fn();
    const complete = vi.fn();
    render(<CardCarousel>{denseCards(open, complete)}</CardCarousel>);
    const focusTitle = screen.getByText("Focus task 4");
    dragTitle(focusTitle, -120);
    fireEvent.click(focusTitle, { detail: 1 });
    expect(screen.getByRole("status")).toHaveTextContent("Card 2 of 2");
    const foldTitle = screen.getByText("Fold task 4");
    dragTitle(foldTitle, 120);
    fireEvent.click(foldTitle, { detail: 1 });
    expect(screen.getByRole("status")).toHaveTextContent("Card 1 of 2");
    expect(open).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });

  it("still opens a title after a tap with jitter and a fresh tap following a drag", () => {
    const open = vi.fn();
    const complete = vi.fn();
    render(<CardCarousel>{denseCards(open, complete)}</CardCarousel>);
    const title = screen.getByText("Focus task 4");
    dragTitle(title, -6, 3);
    fireEvent.click(title, { detail: 1 });
    expect(open).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent("Card 1 of 2");
    dragTitle(title, -120);
    fireEvent.click(title, { detail: 1 });
    const foldTitle = screen.getByText("Fold task 4");
    dragTitle(foldTitle, 0);
    fireEvent.click(foldTitle, { detail: 1 });
    expect(open).toHaveBeenCalledTimes(2);
    expect(complete).not.toHaveBeenCalled();
  });

  it.each([
    [-70, 120],
    [-120, 120],
    [-120, 100],
  ])(
    "leaves scrolling and diagonal title gestures (%i, %i) on the current card",
    (dx, dy) => {
      const open = vi.fn();
      render(<CardCarousel>{denseCards(open, vi.fn())}</CardCarousel>);
      dragTitle(screen.getByText("Focus task 4"), dx, dy);
      expect(screen.getByRole("status")).toHaveTextContent("Card 1 of 2");
      expect(open).not.toHaveBeenCalled();
    },
  );

  it("retains explicit action and input controls instead of treating them as task-title swipes", () => {
    const complete = vi.fn();
    render(<CardCarousel>{denseCards(vi.fn(), complete)}</CardCarousel>);
    const action = screen.getByRole("button", {
      name: "Complete Focus task 4",
    });
    dragTitle(action, -120);
    expect(screen.getByRole("status")).toHaveTextContent("Card 1 of 2");
    expect(complete).not.toHaveBeenCalled();
    dragTitle(action, 0);
    fireEvent.click(action, { detail: 1 });
    expect(complete).toHaveBeenCalledOnce();
    const input = screen.getByRole("textbox", { name: "Focus task input" });
    dragTitle(input, -120);
    fireEvent.change(input, { target: { value: "Draft task" } });
    expect(input).toHaveValue("Draft task");
    expect(screen.getByRole("status")).toHaveTextContent("Card 1 of 2");
  });

  it.each(["pointercancel", "lostpointercapture"])(
    "suppresses the title click after %s interrupts a recognized drag",
    (type) => {
      const open = vi.fn();
      const { container } = render(
        <CardCarousel>{denseCards(open, vi.fn())}</CardCarousel>,
      );
      const title = screen.getByText("Focus task 4");
      const position = { pointerId: 1, isPrimary: true, button: 0 };
      fireEvent.pointerDown(title, { ...position, clientX: 200, clientY: 100 });
      fireEvent.pointerMove(title, { ...position, clientX: 80, clientY: 100 });
      const owner =
        type === "lostpointercapture"
          ? container.querySelector(".m-carousel__track")!
          : title;
      fireEvent(owner, new PointerEvent(type, { pointerId: 1, bubbles: true }));
      fireEvent.pointerUp(title, { ...position, clientX: 80, clientY: 100 });
      fireEvent.click(title, { detail: 1 });
      expect(screen.getByRole("status")).toHaveTextContent("Card 1 of 2");
      expect(open).not.toHaveBeenCalled();
      dragTitle(title, 0);
      fireEvent.click(title, { detail: 1 });
      expect(open).toHaveBeenCalledOnce();
    },
  );

  it("leaves nested task-row swipes with their owner even when the title is marked", async () => {
    const complete = vi.fn();
    const plan = vi.fn();
    const open = vi.fn();
    const { container } = render(
      <CardCarousel>
        {[
          <SwipeRow key="row" onSwipeRight={complete} onSwipeLeft={plan}>
            <button data-card-swipe-target onClick={open}>
              Nested task
            </button>
          </SwipeRow>,
          <div key="next">Next card</div>,
        ]}
      </CardCarousel>,
    );
    const title = screen.getByRole("button", { name: "Nested task" });
    for (const distance of [120, -120]) {
      dragTitle(title, distance);
      fireEvent.touchStart(title, {
        touches: [{ identifier: 1, clientX: 200, clientY: 100 }],
      });
      fireEvent.touchMove(title, {
        touches: [{ identifier: 1, clientX: 200 + distance, clientY: 100 }],
      });
      await act(async () => {
        fireEvent.touchEnd(title, {
          changedTouches: [
            { identifier: 1, clientX: 200 + distance, clientY: 100 },
          ],
        });
      });
      fireEvent.click(title, { detail: 1 });
      expect(
        container.querySelector(".m-carousel__position"),
      ).toHaveTextContent("Card 1 of 2");
    }
    expect(complete).toHaveBeenCalledOnce();
    expect(plan).toHaveBeenCalledOnce();
    expect(open).not.toHaveBeenCalled();
  });

  it("keeps the About face locked even for a marked title", () => {
    render(
      <CardCarousel>
        {[
          <FlipCard
            key="a"
            front="Tasks"
            back={<button data-card-swipe-target>About title</button>}
          />,
          <div key="b">Next card</div>,
        ]}
      </CardCarousel>,
    );
    fireEvent.click(screen.getByRole("button", { name: "About this card" }));
    dragTitle(screen.getByRole("button", { name: "About title" }), -120);
    expect(screen.getByRole("status")).toHaveTextContent("Card 1 of 2");
    fireEvent.click(screen.getByRole("button", { name: "Next card" }));
    expect(screen.getByRole("status")).toHaveTextContent("Card 2 of 2");
  });
});
