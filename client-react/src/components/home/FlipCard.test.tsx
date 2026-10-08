import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { FlipCard } from "./FlipCard";
import { CardInteractionContext } from "./CardInteractionContext";

describe("FlipCard", () => {
  it("exposes only front actions initially", () => {
    const { container } = render(
      <FlipCard
        front={<button>Open task</button>}
        back={<button>Read source</button>}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Open task" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Read source" })).toBeNull();
    expect(container.querySelector(".flip-card__back")).toHaveAttribute(
      "inert",
    );
  });

  it("flips using named buttons and moves focus to the newly operable face", () => {
    const { container } = render(
      <FlipCard
        front={<button>Open task</button>}
        back={<button>Read source</button>}
      />,
    );
    const about = screen.getByRole("button", { name: "About this card" });
    expect(about).toHaveAttribute("type", "button");
    fireEvent.click(about);
    expect(container.querySelector(".flip-card")).toHaveClass(
      "flip-card--flipped",
    );
    expect(container.querySelector(".flip-card__front")).toHaveAttribute(
      "inert",
    );
    expect(screen.queryByRole("button", { name: "Open task" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Show card front" }),
    ).toHaveFocus();
    expect(
      screen.getByRole("button", { name: "Read source" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show card front" }));
    expect(container.querySelector(".flip-card")).not.toHaveClass(
      "flip-card--flipped",
    );
    expect(
      screen.getByRole("button", { name: "About this card" }),
    ).toHaveFocus();
  });

  it("reports flipped state to a carousel and resets when its slide becomes inactive", () => {
    const onFlipChange = vi.fn();
    const view = (active: boolean) => (
      <CardInteractionContext.Provider value={{ active, onFlipChange }}>
        <FlipCard front="Front" back="Back" />
      </CardInteractionContext.Provider>
    );
    const { rerender, container } = render(view(true));
    fireEvent.click(screen.getByRole("button", { name: "About this card" }));
    expect(onFlipChange).toHaveBeenCalledWith(true);
    rerender(view(false));
    expect(container.querySelector(".flip-card")).not.toHaveClass(
      "flip-card--flipped",
    );
  });
});
