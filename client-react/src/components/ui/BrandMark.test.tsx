// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BrandMark } from "./BrandMark";

describe("BrandMark", () => {
  it("renders an SVG with default 24px sizing", () => {
    const { container } = render(<BrandMark />);
    const svg = container.querySelector("svg")!;
    expect(svg).toBeTruthy();
    expect(svg).toHaveAttribute("width", "24");
    expect(svg).toHaveAttribute("height", "24");
    expect(svg).toHaveAttribute("viewBox", "77 214 222 252");
  });

  it("honors the size override", () => {
    const { container } = render(<BrandMark size={48} />);
    const svg = container.querySelector("svg")!;
    expect(svg).toHaveAttribute("width", "48");
    expect(svg).toHaveAttribute("height", "48");
  });

  it("is aria-hidden so screen readers skip decorative chrome", () => {
    const { container } = render(<BrandMark />);
    expect(container.querySelector("svg")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  it("merges a caller-provided className", () => {
    const { container } = render(<BrandMark className="extra" />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("class")).toBe("extra");
  });

  it("gives a standalone mark an accessible name without hiding it", () => {
    const { getByRole } = render(<BrandMark label="Planwren Fold logo" />);
    expect(
      getByRole("img", { name: "Planwren Fold logo" }),
    ).not.toHaveAttribute("aria-hidden");
  });

  it("references design-system tokens (no hardcoded hex)", () => {
    const { container } = render(<BrandMark />);
    const svg = container.querySelector("svg")!;
    const fills = [svg, ...svg.querySelectorAll("[fill]")]
      .map((el) => el.getAttribute("fill"))
      .filter((f): f is string => !!f && f !== "none");
    expect(fills.length).toBeGreaterThan(0);
    for (const fill of fills) {
      expect(fill).toMatch(/^var\(--/);
    }
  });
});
