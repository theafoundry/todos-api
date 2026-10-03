// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { createElement } from "react";
import { AuthPage } from "./AuthPage";
import * as pageTransitions from "../utils/pageTransitions";

// Mock useAuth
vi.mock("./AuthProvider", () => ({
  useAuth: () => ({
    setTokens: vi.fn(),
    user: null,
    loading: false,
  }),
}));

// Mock sub-forms to focus on AuthPage routing logic
vi.mock("./LoginForm", () => ({
  LoginForm: () => createElement("div", { "data-testid": "login-form" }),
}));

vi.mock("./RegisterForm", () => ({
  RegisterForm: () => createElement("div", { "data-testid": "register-form" }),
}));

vi.mock("./ForgotPasswordForm", () => ({
  ForgotPasswordForm: () =>
    createElement("div", { "data-testid": "forgot-form" }),
}));

vi.mock("./ResetPasswordForm", () => ({
  ResetPasswordForm: () =>
    createElement("div", { "data-testid": "reset-form" }),
}));

vi.mock("./PhoneLoginForm", () => ({
  PhoneLoginForm: () => createElement("div", { "data-testid": "phone-form" }),
}));

// Mock page transitions
vi.mock("../utils/pageTransitions", () => ({
  navigateWithFade: vi.fn(),
}));

describe("AuthPage", () => {
  beforeEach(() => {
    // Clear URL search params
    window.history.pushState({}, "", "/auth");
    vi.clearAllMocks();
  });

  it("renders the auth page container with logo", () => {
    const { container } = render(createElement(AuthPage));
    expect(screen.getByText("Planwren")).toBeTruthy();
    expect(container.querySelector(".auth-card")).toBeTruthy();
  });

  it("shows back to home button", () => {
    render(createElement(AuthPage));
    expect(screen.getByRole("button", { name: "Back to home" })).toBeTruthy();
  });

  it("calls navigateWithFade when back button is clicked", () => {
    render(createElement(AuthPage));
    fireEvent.click(screen.getByRole("button", { name: "Back to home" }));
    expect(pageTransitions.navigateWithFade).toHaveBeenCalledWith("/", {
      replace: true,
    });
  });

  it("renders a main landmark with the brand as the page heading", () => {
    render(createElement(AuthPage));
    expect(screen.getByRole("main")).toHaveClass("auth-page");
    expect(
      screen.getByRole("heading", { level: 1, name: "Planwren" }),
    ).toBeTruthy();
  });

  it("scopes public styling to the mounted page and leaves the app theme on unmount", () => {
    window.localStorage.setItem("darkMode", "true");
    document.body.classList.remove("pw-public", "dark-mode");
    const { unmount } = render(createElement(AuthPage));
    expect(document.body).toHaveClass("pw-public");
    expect(document.body).toHaveClass("dark-mode");

    unmount();
    expect(document.body).not.toHaveClass("pw-public");
    // The app's saved theme is owned by useDarkMode(); cleanup must not touch it.
    expect(document.body).toHaveClass("dark-mode");
    expect(window.localStorage.getItem("darkMode")).toBe("true");
    document.body.classList.remove("dark-mode");
  });

  it("uses a roving tabindex for the auth tabs", () => {
    render(createElement(AuthPage));
    expect(screen.getByRole("tab", { name: "Login" })).toHaveAttribute(
      "tabindex",
      "0",
    );
    expect(screen.getByRole("tab", { name: "Register" })).toHaveAttribute(
      "tabindex",
      "-1",
    );
    fireEvent.click(screen.getByRole("tab", { name: "Register" }));
    expect(screen.getByRole("tab", { name: "Login" })).toHaveAttribute(
      "tabindex",
      "-1",
    );
    expect(screen.getByRole("tab", { name: "Register" })).toHaveAttribute(
      "tabindex",
      "0",
    );
  });

  it("moves focus and selection with arrow, Home and End keys", () => {
    render(createElement(AuthPage));
    const login = screen.getByRole("tab", { name: "Login" });
    const register = screen.getByRole("tab", { name: "Register" });
    login.focus();

    fireEvent.keyDown(login, { key: "ArrowRight" });
    expect(register).toHaveFocus();
    expect(register).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("register-form")).toBeTruthy();

    fireEvent.keyDown(register, { key: "ArrowRight" });
    expect(login).toHaveFocus();
    expect(login).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("login-form")).toBeTruthy();

    fireEvent.keyDown(login, { key: "ArrowLeft" });
    expect(register).toHaveFocus();
    expect(register).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(register, { key: "Home" });
    expect(login).toHaveFocus();
    expect(login).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(login, { key: "End" });
    expect(register).toHaveFocus();
    expect(register).toHaveAttribute("aria-selected", "true");
  });

  it("ignores unrelated keys on tabs", () => {
    render(createElement(AuthPage));
    const login = screen.getByRole("tab", { name: "Login" });
    fireEvent.keyDown(login, { key: "ArrowDown" });
    expect(login).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("login-form")).toBeTruthy();
  });

  it("links tabs to the active tab panel", () => {
    render(createElement(AuthPage));
    const panel = screen.getByRole("tabpanel");
    expect(screen.getByRole("tab", { name: "Login" })).toHaveAttribute(
      "aria-controls",
      panel.id,
    );
    expect(panel).toHaveAttribute("aria-labelledby", "auth-tab-login");
    fireEvent.click(screen.getByRole("tab", { name: "Register" }));
    expect(screen.getByRole("tabpanel")).toHaveAttribute(
      "aria-labelledby",
      "auth-tab-register",
    );
  });

  it("shows login form by default", () => {
    render(createElement(AuthPage));
    expect(screen.getByTestId("login-form")).toBeTruthy();
    expect(screen.queryByTestId("register-form")).toBeNull();
  });

  it("renders login and register tabs", () => {
    render(createElement(AuthPage));
    expect(screen.getByRole("tab", { name: "Login" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Register" })).toBeTruthy();
  });

  it("has login tab active by default", () => {
    render(createElement(AuthPage));
    expect(screen.getByRole("tab", { name: "Login" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "Register" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });

  it("switches to register form when Register tab is clicked", () => {
    render(createElement(AuthPage));
    fireEvent.click(screen.getByRole("tab", { name: "Register" }));
    expect(screen.getByTestId("register-form")).toBeTruthy();
    expect(screen.queryByTestId("login-form")).toBeNull();
  });

  it("switches back to login form when Login tab is clicked", () => {
    render(createElement(AuthPage));
    fireEvent.click(screen.getByRole("tab", { name: "Register" }));
    fireEvent.click(screen.getByRole("tab", { name: "Login" }));
    expect(screen.getByTestId("login-form")).toBeTruthy();
    expect(screen.queryByTestId("register-form")).toBeNull();
  });

  it("shows success message when verified=1 in URL", () => {
    window.history.pushState({}, "", "/auth?verified=1");
    render(createElement(AuthPage));
    expect(
      screen.getByText("Email verified. You can now log in."),
    ).toBeTruthy();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Email verified. You can now log in.",
    );
  });

  it("shows error message when verified=0 in URL", () => {
    window.history.pushState({}, "", "/auth?verified=0");
    render(createElement(AuthPage));
    expect(
      screen.getByText("Verification link expired or invalid."),
    ).toBeTruthy();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Verification link expired or invalid.",
    );
  });

  it("dismisses message when dismiss button is clicked", () => {
    window.history.pushState({}, "", "/auth?verified=1");
    render(createElement(AuthPage));
    expect(
      screen.getByText("Email verified. You can now log in."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss message" }));
    expect(
      screen.queryByText("Email verified. You can now log in."),
    ).toBeNull();
  });

  it("switches to reset form when token is in URL", () => {
    window.history.pushState({}, "", "/auth?token=RESET123");
    render(createElement(AuthPage));
    expect(screen.getByTestId("reset-form")).toBeTruthy();
    expect(screen.queryByTestId("login-form")).toBeNull();
  });

  it("shows register tab active when ?tab=register in URL", () => {
    window.history.pushState({}, "", "/auth?tab=register");
    render(createElement(AuthPage));
    expect(screen.getByRole("tab", { name: "Register" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByTestId("register-form")).toBeTruthy();
  });
});
