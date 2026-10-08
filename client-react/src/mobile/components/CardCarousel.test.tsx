import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { CardCarousel } from "./CardCarousel";
import { FlipCard } from "../../components/home/FlipCard";

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
});
