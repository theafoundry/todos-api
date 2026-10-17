// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ce } from "../../test-helpers";
import { PageOverlay } from "./PageOverlay";

describe("PageOverlay", () => {
  it("is a named modal page that isolates the shell and restores its opener", () => {
    const onBack = vi.fn();
    const view = (open: boolean) =>
      ce(
        "div",
        { className: "m-shell" },
        ce("button", { "data-testid": "opener" }, "Profile"),
        ce("nav", { "data-testid": "tabs" }, ce("button", null, "Today")),
        open && ce(PageOverlay, { title: "AI Workspace", onBack }, "Body"),
      );
    const { rerender } = render(view(false));
    const opener = screen.getByTestId("opener");
    opener.focus();
    rerender(view(true));
    expect(
      screen.getByRole("dialog", { name: "AI Workspace" }),
    ).toHaveAttribute("aria-modal", "true");
    const back = screen.getByRole("button", { name: "← Back" });
    expect(back).toHaveFocus();
    expect(opener).toHaveAttribute("inert");
    expect(screen.getByTestId("tabs")).toHaveAttribute("inert");
    fireEvent.keyDown(document, { key: "Tab" });
    expect(back).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(back).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(back);
    expect(onBack).toHaveBeenCalledTimes(2);
    rerender(view(false));
    expect(opener).not.toHaveAttribute("inert");
    expect(screen.getByTestId("tabs")).not.toHaveAttribute("inert");
    expect(opener).toHaveFocus();
  });
});
