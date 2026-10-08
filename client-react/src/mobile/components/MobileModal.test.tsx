// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ce } from "../../test-helpers";
import { MobileModal } from "./MobileModal";

describe("MobileModal", () => {
  it("names the dialog, traps focus and restores focus/background on close", () => {
    const onClose = vi.fn();
    const view = (open: boolean) =>
      ce(
        "div",
        { className: "m-shell", "data-palette": "coral" },
        ce("button", { "data-testid": "trigger" }, "Open"),
        ce(
          MobileModal,
          {
            open,
            title: "Edit task",
            onClose,
            footer: ce("button", null, "Save"),
          },
          ce("input", { "aria-label": "Title", "data-autofocus": true }),
        ),
        ce("nav", { inert: true, "data-testid": "already-inert" }, "Other"),
      );
    const { rerender } = render(view(false));
    const trigger = screen.getByTestId("trigger");
    trigger.focus();
    rerender(view(true));
    expect(screen.getByRole("dialog", { name: "Edit task" })).toHaveAttribute(
      "aria-modal",
      "true",
    );
    expect(screen.getByRole("textbox", { name: "Title" })).toHaveFocus();
    expect(trigger).toHaveAttribute("inert");
    expect(document.body.style.overflow).toBe("hidden");
    screen.getByRole("button", { name: "Save" }).focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(
      screen.getByRole("button", { name: "Close Edit task" }),
    ).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(screen.getByRole("button", { name: "Save" })).toHaveFocus();
    rerender(view(false));
    expect(trigger).not.toHaveAttribute("inert");
    expect(screen.getByTestId("already-inert")).toHaveAttribute("inert");
    expect(trigger).toHaveFocus();
    expect(document.body.style.overflow).toBe("");
  });

  it("routes Escape and Close through the owner guard; pending blocks them", () => {
    const onClose = vi.fn();
    const { rerender } = render(
      ce(MobileModal, { open: true, title: "Draft", onClose }, "Body"),
    );
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Close Draft" }));
    expect(onClose).toHaveBeenCalledTimes(2);
    rerender(
      ce(
        MobileModal,
        { open: true, title: "Draft", onClose, dismissDisabled: true },
        "Body",
      ),
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("button", { name: "Close Draft" })).toBeDisabled();
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("restores a tapped trigger even when the browser leaves active focus on body", () => {
    const view = (open: boolean) =>
      ce(
        "div",
        null,
        ce("button", { "data-testid": "tap-trigger" }, "Task"),
        ce(
          MobileModal,
          { open, title: "Task details", onClose: vi.fn() },
          "Body",
        ),
      );
    const { rerender } = render(view(false));
    const trigger = screen.getByTestId("tap-trigger");
    fireEvent.pointerDown(trigger);
    expect(document.activeElement).toBe(document.body);
    rerender(view(true));
    expect(
      screen.getByRole("button", { name: "Close Task details" }),
    ).toHaveFocus();
    rerender(view(false));
    expect(trigger).toHaveFocus();
  });

  it("excludes hidden disclosure content from the focus wrap", () => {
    render(
      ce(
        MobileModal,
        { open: true, title: "Fields", onClose: vi.fn() },
        ce("button", null, "Visible action"),
        ce(
          "div",
          { "aria-hidden": "true" },
          ce("button", { "data-autofocus": true }, "Hidden action"),
        ),
        ce("input", { type: "hidden", value: "secret", readOnly: true }),
      ),
    );
    expect(screen.getByRole("button", { name: "Close Fields" })).toHaveFocus();
    screen.getByRole("button", { name: "Visible action" }).focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(screen.getByRole("button", { name: "Close Fields" })).toHaveFocus();
  });

  it("body taps and cancelled handle movement never request dismissal", () => {
    const onClose = vi.fn();
    const { container } = render(
      ce(
        MobileModal,
        { open: true, title: "Task", onClose },
        ce("button", null, "Edit"),
      ),
    );
    fireEvent.touchEnd(screen.getByRole("button", { name: "Edit" }), {
      changedTouches: [{ identifier: 1, clientY: 250 }],
    });
    expect(onClose).not.toHaveBeenCalled();
    const handle = container.querySelector(".m-mobile-modal__handle")!;
    fireEvent.touchStart(handle, { touches: [{ identifier: 1, clientY: 10 }] });
    fireEvent.touchMove(handle, { touches: [{ identifier: 1, clientY: 250 }] });
    fireEvent.touchCancel(handle);
    fireEvent.touchEnd(handle, {
      changedTouches: [{ identifier: 1, clientY: 250 }],
    });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.touchStart(handle, { touches: [{ identifier: 2, clientY: 10 }] });
    fireEvent.touchEnd(handle, {
      changedTouches: [{ identifier: 2, clientY: 250 }],
    });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
