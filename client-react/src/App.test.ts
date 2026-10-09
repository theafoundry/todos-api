// @vitest-environment jsdom
import { createElement, useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { useAuth } from "./auth/AuthProvider";

function ShellProbe({ label }: { label: string }) {
  const { user, setUser, setTokens } = useAuth();
  const [draft, setDraft] = useState("");
  return createElement(
    "div",
    null,
    label,
    createElement("input", {
      "aria-label": "Owner draft",
      value: draft,
      onChange: (event: { target: { value: string } }) =>
        setDraft(event.target.value),
    }),
    createElement(
      "button",
      {
        onClick: () =>
          setTokens("refreshed-token", "refresh-token", {
            ...user!,
            name: "Refreshed profile",
          }),
      },
      "Refresh same account",
    ),
    createElement(
      "button",
      {
        onClick: () => setUser({ ...user!, id: "account-b" }),
      },
      "Switch account",
    ),
  );
}

const mocks = vi.hoisted(() => ({
  navigateWithFade: vi.fn(),
}));

vi.mock("./utils/pageTransitions", () => ({
  navigateWithFade: mocks.navigateWithFade,
}));

vi.mock("./components/layout/AppShell", () => ({
  AppShell: () => createElement(ShellProbe, { label: "App shell" }),
}));

vi.mock("./mobile/MobileShell", () => ({
  MobileShell: () => createElement(ShellProbe, { label: "Mobile shell" }),
}));

describe("App auth gate", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    Object.defineProperty(window, "innerWidth", {
      writable: true,
      value: 1200,
    });
    // Mock matchMedia for useIsMobile hook
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("redirects to auth when user hydration fails with only a token present", async () => {
    localStorage.setItem("authToken", "stale-token");

    vi.spyOn(window, "fetch").mockResolvedValue(
      new Response(null, { status: 401 }),
    );

    render(createElement(App));

    await waitFor(() => {
      expect(mocks.navigateWithFade).toHaveBeenCalledWith("/auth?next=/app", {
        replace: true,
      });
    });
    expect(screen.queryByText("App shell")).toBeNull();
  });

  it.each([false, true])(
    "resets shell drafts on account change and preserves same-account token refresh (mobile=%s)",
    async (mobile) => {
      Object.defineProperty(window, "innerWidth", {
        writable: true,
        value: mobile ? 390 : 1200,
      });
      localStorage.setItem(
        "user",
        JSON.stringify({
          id: "account-a",
          name: "Account A",
          email: "a@example.com",
        }),
      );
      render(createElement(App));
      const input = await screen.findByRole("textbox", { name: "Owner draft" });
      fireEvent.change(input, { target: { value: "Unfinished intention" } });
      fireEvent.click(
        screen.getByRole("button", { name: "Refresh same account" }),
      );
      expect(screen.getByRole("textbox", { name: "Owner draft" })).toHaveValue(
        "Unfinished intention",
      );
      fireEvent.click(screen.getByRole("button", { name: "Switch account" }));
      expect(screen.getByRole("textbox", { name: "Owner draft" })).toHaveValue(
        "",
      );
      expect(screen.getByRole("textbox", { name: "Owner draft" })).not.toBe(
        input,
      );
      expect(
        screen.getByText(mobile ? "Mobile shell" : "App shell"),
      ).toBeInTheDocument();
    },
  );
});
