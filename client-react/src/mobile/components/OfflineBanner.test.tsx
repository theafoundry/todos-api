// @vitest-environment jsdom
import { ce } from "../../test-helpers";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { OfflineBanner } from "./OfflineBanner";

describe("OfflineBanner", () => {
  let onLineDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    onLineDescriptor = Object.getOwnPropertyDescriptor(
      Navigator.prototype,
      "onLine",
    );
  });

  afterEach(() => {
    if (onLineDescriptor) {
      Object.defineProperty(Navigator.prototype, "onLine", onLineDescriptor);
    }
  });

  it("renders nothing when online", () => {
    Object.defineProperty(Navigator.prototype, "onLine", {
      configurable: true,
      get: () => true,
    });
    render(ce(OfflineBanner));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("renders banner when navigator starts offline", () => {
    Object.defineProperty(Navigator.prototype, "onLine", {
      configurable: true,
      get: () => false,
    });
    render(ce(OfflineBanner));
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.getByText(/You're offline/i)).toBeTruthy();
    expect(screen.getByText(/retry saving when you reconnect/i)).toBeTruthy();
    expect(screen.queryByText(/will sync/i)).toBeNull();
  });

  it("shows after offline event", async () => {
    Object.defineProperty(Navigator.prototype, "onLine", {
      configurable: true,
      get: () => true,
    });
    render(ce(OfflineBanner));
    expect(screen.queryByRole("status")).toBeNull();
    Object.defineProperty(Navigator.prototype, "onLine", {
      configurable: true,
      get: () => false,
    });
    await act(async () => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("hides after online event", async () => {
    Object.defineProperty(Navigator.prototype, "onLine", {
      configurable: true,
      get: () => false,
    });
    render(ce(OfflineBanner));
    expect(screen.getByRole("status")).toBeTruthy();
    Object.defineProperty(Navigator.prototype, "onLine", {
      configurable: true,
      get: () => true,
    });
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    expect(screen.queryByRole("status")).toBeNull();
  });
});
