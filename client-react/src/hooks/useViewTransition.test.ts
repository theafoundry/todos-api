import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useViewTransition } from "./useViewTransition";

const original = Object.getOwnPropertyDescriptor(
  document,
  "startViewTransition",
);
afterEach(() => {
  if (original)
    Object.defineProperty(document, "startViewTransition", original);
  else Reflect.deleteProperty(document, "startViewTransition");
});

describe("useViewTransition", () => {
  it("runs the update immediately when the browser does not support transitions", () => {
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: undefined,
    });
    const update = vi.fn();
    const { result } = renderHook(useViewTransition);
    result.current.startTransition(update);
    expect(update).toHaveBeenCalledOnce();
  });

  it("uses the browser transition when supported", async () => {
    const start = vi.fn((update: () => void) => {
      update();
      return { ready: Promise.resolve() };
    });
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: start,
    });
    const update = vi.fn();
    const { result } = renderHook(useViewTransition);
    await act(async () => result.current.startTransition(update));
    expect(start).toHaveBeenCalledWith(update);
    expect(update).toHaveBeenCalledOnce();
  });

  it("keeps the navigation update when a newer transition skips its animation", async () => {
    const start = vi.fn((update: () => void) => {
      update();
      return {
        ready: Promise.reject(
          new DOMException("Transition was skipped", "AbortError"),
        ),
      };
    });
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: start,
    });
    const update = vi.fn();
    const { result } = renderHook(useViewTransition);
    await act(async () => result.current.startTransition(update));
    expect(update).toHaveBeenCalledOnce();
  });
});
