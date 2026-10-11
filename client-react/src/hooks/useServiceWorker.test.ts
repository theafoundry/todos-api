import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useServiceWorker } from "./useServiceWorker";

afterEach(() => vi.unstubAllGlobals());

describe("static service worker registration", () => {
  it("registers the canonical worker and never asks an older worker to replay private writes", () => {
    const postMessage = vi.fn();
    const register = vi.fn().mockResolvedValue({});
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    vi.stubGlobal("navigator", {
      serviceWorker: {
        controller: { postMessage },
        register,
        addEventListener,
        removeEventListener,
      },
    });
    const { unmount } = renderHook(() => useServiceWorker());
    window.dispatchEvent(new Event("online"));
    expect(register).toHaveBeenCalledExactlyOnceWith("/app/sw.js");
    expect(postMessage).not.toHaveBeenCalled();
    unmount();
    expect(removeEventListener).toHaveBeenCalledWith(
      "message",
      expect.any(Function),
    );
  });
});
