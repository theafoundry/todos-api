// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useState } from "react";
import { ce } from "../../test-helpers";
import { BottomSheet } from "./BottomSheet";
import { FieldPicker } from "./FieldPicker";
import type { BottomSheetSnap } from "../hooks/useBottomSheet";

function TouchHarness({ onClose }: { onClose: () => void }) {
  const [snap, setSnap] = useState<BottomSheetSnap>("half");
  const [priority, setPriority] = useState<"high" | "low" | null>(null);
  return ce(BottomSheet, {
    snap,
    onClose,
    onExpandFull: () => setSnap("full"),
    halfContent: ce("button", { onClick: () => setSnap("full") }, "Edit"),
    fullContent: ce(FieldPicker, {
      label: "Priority",
      value: priority,
      options: [
        { key: "high", label: "High" },
        { key: "low", label: "Low" },
      ],
      onChange: setPriority,
      allowClear: true,
    }),
  });
}
const touch = (clientY: number) => ({ identifier: 1, clientY, clientX: 50 });
function tap(element: Element, clientY: number) {
  fireEvent.touchStart(element, { touches: [touch(clientY)] });
  fireEvent.touchEnd(element, { changedTouches: [touch(clientY)] });
  fireEvent.click(element);
}

describe("BottomSheet", () => {
  it("renders nothing closed and switches content at the requested snap", () => {
    const values = {
      onClose: vi.fn(),
      onExpandFull: vi.fn(),
      halfContent: "Half content",
      fullContent: "Full content",
    };
    const { rerender } = render(ce(BottomSheet, { ...values, snap: "closed" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    rerender(ce(BottomSheet, { ...values, snap: "half" }));
    expect(
      screen.getByRole("dialog", { name: "Task details" }),
    ).toHaveTextContent("Half content");
    rerender(ce(BottomSheet, { ...values, snap: "full" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Full content");
  });

  it("keeps first body touch, Edit and progressive disclosure in a composed sheet", () => {
    const onClose = vi.fn();
    render(ce(TouchHarness, { onClose }));
    tap(screen.getByRole("button", { name: "Edit" }), 600);
    const picker = screen.getByRole("button", { name: /Priority/ });
    tap(picker, 400);
    expect(picker).toHaveAttribute("aria-expanded", "true");
    tap(screen.getByRole("button", { name: "High" }), 450);
    expect(screen.getByRole("button", { name: /Priority/ })).toHaveTextContent(
      "High",
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not convert a body scroll into a dismissal", () => {
    const onClose = vi.fn();
    const { container } = render(ce(TouchHarness, { onClose }));
    const body = container.querySelector(".m-mobile-modal__body")!;
    fireEvent.touchStart(body, { touches: [touch(250)] });
    fireEvent.touchMove(body, { touches: [touch(500)] });
    fireEvent.touchEnd(body, { changedTouches: [touch(500)] });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("dismisses only a completed handle drag and resets a cancelled gesture", () => {
    const onClose = vi.fn();
    const { container } = render(ce(TouchHarness, { onClose }));
    const handle = container.querySelector(".m-bottom-sheet__handle")!;
    fireEvent.touchStart(handle, { touches: [touch(300)] });
    fireEvent.touchMove(handle, { touches: [touch(500)] });
    fireEvent.touchCancel(handle);
    fireEvent.touchEnd(handle, { changedTouches: [touch(500)] });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.touchStart(handle, { touches: [touch(300)] });
    fireEvent.touchEnd(handle, { changedTouches: [touch(450)] });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
