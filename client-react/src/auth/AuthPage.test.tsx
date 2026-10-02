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
  ForgotPasswordForm: () => createElement("div", { "data-testid": "forgot-form" }),
}));

vi.mock("./ResetPasswordForm", () => ({
  ResetPasswordForm: () => createElement("div", { "data-testid": "reset-form" }),
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
    expect(screen.getByRole("button", { name: "←" })).toBeTruthy();
  });

  it("calls navigateWithFade when back button is clicked", () => {
    render(createElement(AuthPage));
    fireEvent.click(screen.getByRole("button", { name: "←" }));
    expect(pageTransitions.navigateWithFade).toHaveBeenCalledWith("/", { replace: true });
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
    expect(screen.getByRole("tab", { name: "Login" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Register" })).toHaveAttribute("aria-selected", "false");
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
    expect(screen.getByText("Email verified. You can now log in.")).toBeTruthy();
  });

  it("shows error message when verified=0 in URL", () => {
    window.history.pushState({}, "", "/auth?verified=0");
    render(createElement(AuthPage));
    expect(screen.getByText("Verification link expired or invalid.")).toBeTruthy();
  });

  it("dismisses message when dismiss button is clicked", () => {
    window.history.pushState({}, "", "/auth?verified=1");
    render(createElement(AuthPage));
    expect(screen.getByText("Email verified. You can now log in.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "✕" }));
    expect(screen.queryByText("Email verified. You can now log in.")).toBeNull();
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
    expect(screen.getByRole("tab", { name: "Register" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("register-form")).toBeTruthy();
  });
});
