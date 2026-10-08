import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { DotIndicator } from "./DotIndicator";

describe("DotIndicator", () => {
  it("names positions and selects a requested card through native buttons", () => {
    const onSelect = vi.fn();
    render(<DotIndicator count={3} activeIndex={1} onSelect={onSelect} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(3);
    expect(buttons[0]).not.toHaveAttribute("aria-current");
    expect(buttons[1]).toHaveAttribute("aria-current", "true");
    expect(buttons[1]).toHaveClass("m-dot--active");
    expect(buttons[2]).toHaveAttribute("type", "button");
    fireEvent.click(screen.getByRole("button", { name: "Card 3 of 3" }));
    expect(onSelect).toHaveBeenCalledWith(2);
  });

  it.each([0, 1])("renders no redundant navigation for %s cards", (count) => {
    const { container } = render(
      <DotIndicator count={count} activeIndex={0} onSelect={vi.fn()} />,
    );
    expect(container.querySelector(".m-dot-indicator")).toBeNull();
  });
});
