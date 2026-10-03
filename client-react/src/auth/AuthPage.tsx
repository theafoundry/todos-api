import { useState, useEffect, useCallback, useRef } from "react";
import type { KeyboardEvent } from "react";
import { useAuth } from "./AuthProvider";
import { LoginForm } from "./LoginForm";
import { RegisterForm } from "./RegisterForm";
import { ForgotPasswordForm } from "./ForgotPasswordForm";
import { ResetPasswordForm } from "./ResetPasswordForm";
import { PhoneLoginForm } from "./PhoneLoginForm";
import { navigateWithFade } from "../utils/pageTransitions";
import { BrandMark } from "../components/ui/BrandMark";
import { usePublicTheme } from "../styles/publicTheme";
import "./auth.css";

type FormView = "login" | "register" | "forgot" | "reset" | "phone";
type AuthTab = "login" | "register";
type MessageType = "error" | "success";

const TAB_ORDER: AuthTab[] = ["login", "register"];

function readQueryParam(key: string): string | null {
  return new URLSearchParams(window.location.search).get(key);
}

export function AuthPage() {
  usePublicTheme();
  const { setTokens } = useAuth();
  const [view, setView] = useState<FormView>("login");
  const [tab, setTab] = useState<AuthTab>("login");
  const tabRefs = useRef<Record<AuthTab, HTMLButtonElement | null>>({
    login: null,
    register: null,
  });
  const [message, setMessage] = useState<{
    type: MessageType;
    text: string;
  } | null>(null);

  // Handle social OAuth callback: ?auth=success&token=...&refreshToken=...
  useEffect(() => {
    const auth = readQueryParam("auth");
    if (auth === "success") {
      const token = readQueryParam("token");
      const refreshToken = readQueryParam("refreshToken");
      const userId = readQueryParam("userId");
      const email = readQueryParam("email") ?? "";
      if (token && refreshToken && userId) {
        setTokens(token, refreshToken, { id: userId, email, name: "" });
        const next = readQueryParam("next");
        const target =
          next === "/app" || next?.startsWith("/app/") ? next : "/app";
        window.location.href = target;
        return;
      }
    }
  }, [setTokens]);

  // Handle email verification: ?verified=1|0
  useEffect(() => {
    const verified = readQueryParam("verified");
    if (verified === "1") {
      setMessage({
        type: "success",
        text: "Email verified. You can now log in.",
      });
    } else if (verified === "0") {
      setMessage({
        type: "error",
        text: "Verification link expired or invalid.",
      });
    }
  }, []);

  // Handle reset token: ?token=RESETTOKEN (skip if social callback present)
  useEffect(() => {
    const token = readQueryParam("token");
    const auth = readQueryParam("auth");
    if (token && !auth) {
      setView("reset");
    }
  }, []);

  // Handle ?tab=login|register from external links
  useEffect(() => {
    const tabParam = readQueryParam("tab");
    if (tabParam === "register") setTab("register");
  }, []);

  const switchToForgot = useCallback(() => {
    setView("forgot");
    setMessage(null);
  }, []);
  const switchToLogin = useCallback(() => {
    setView("login");
    setTab("login");
    setMessage(null);
  }, []);
  const switchToRegister = useCallback(() => {
    setView("register");
    setTab("register");
    setMessage(null);
  }, []);
  const switchToPhone = useCallback(() => {
    setView("phone");
    setMessage(null);
  }, []);
  const goHome = useCallback(() => {
    navigateWithFade("/", { replace: true });
  }, []);

  const dismissMessage = useCallback(() => setMessage(null), []);

  const selectTab = useCallback((next: AuthTab) => {
    setTab(next);
    setView(next);
    setMessage(null);
  }, []);

  // WAI-ARIA tabs: arrows wrap, Home/End jump; selection follows focus.
  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = TAB_ORDER.indexOf(tab);
    let next: AuthTab;
    switch (event.key) {
      case "ArrowRight":
        next = TAB_ORDER[(index + 1) % TAB_ORDER.length];
        break;
      case "ArrowLeft":
        next = TAB_ORDER[(index - 1 + TAB_ORDER.length) % TAB_ORDER.length];
        break;
      case "Home":
        next = TAB_ORDER[0];
        break;
      case "End":
        next = TAB_ORDER[TAB_ORDER.length - 1];
        break;
      default:
        return;
    }
    event.preventDefault();
    if (next !== tab) selectTab(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <main className="auth-page">
      <div className="auth-card">
        <div className="auth-card__header">
          <button
            type="button"
            className="auth-card__back"
            onClick={goHome}
            aria-label="Back to home"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m12 19-7-7 7-7" />
              <path d="M19 12H5" />
            </svg>
          </button>
          <h1 className="auth-card__logo">
            <BrandMark size={28} />
            <span>Planwren</span>
          </h1>
        </div>

        {message && (
          <div
            className={`auth-message auth-message--${message.type} auth-message--visible`}
            role={message.type === "error" ? "alert" : "status"}
          >
            <span>{message.text}</span>
            <button
              type="button"
              className="auth-message__dismiss"
              onClick={dismissMessage}
              aria-label="Dismiss message"
            >
              <span aria-hidden="true">✕</span>
            </button>
          </div>
        )}

        {view === "login" || view === "register" ? (
          <>
            <div
              className="auth-tabs"
              role="tablist"
              aria-label="Authentication"
            >
              <button
                type="button"
                role="tab"
                id="auth-tab-login"
                ref={(el) => {
                  tabRefs.current.login = el;
                }}
                tabIndex={tab === "login" ? 0 : -1}
                aria-selected={tab === "login"}
                aria-controls="auth-tabpanel"
                className={`auth-tab${tab === "login" ? " auth-tab--active" : ""}`}
                onClick={() => selectTab("login")}
                onKeyDown={handleTabKeyDown}
              >
                Login
              </button>
              <button
                type="button"
                role="tab"
                id="auth-tab-register"
                ref={(el) => {
                  tabRefs.current.register = el;
                }}
                tabIndex={tab === "register" ? 0 : -1}
                aria-selected={tab === "register"}
                aria-controls="auth-tabpanel"
                className={`auth-tab${tab === "register" ? " auth-tab--active" : ""}`}
                onClick={() => selectTab("register")}
                onKeyDown={handleTabKeyDown}
              >
                Register
              </button>
            </div>
            <div
              role="tabpanel"
              id="auth-tabpanel"
              aria-labelledby={`auth-tab-${tab}`}
            >
              {tab === "login" && (
                <LoginForm
                  onSwitchToForgot={switchToForgot}
                  onSwitchToPhone={switchToPhone}
                  onSwitchToRegister={switchToRegister}
                  initialMessage={message}
                />
              )}
              {tab === "register" && (
                <RegisterForm
                  onSwitchToLogin={switchToLogin}
                  onSwitchToPhone={switchToPhone}
                />
              )}
            </div>
          </>
        ) : view === "forgot" ? (
          <ForgotPasswordForm onBack={switchToLogin} />
        ) : view === "reset" ? (
          <ResetPasswordForm
            token={readQueryParam("token") ?? ""}
            onBack={switchToLogin}
          />
        ) : view === "phone" ? (
          <PhoneLoginForm onBack={switchToLogin} />
        ) : null}
      </div>
    </main>
  );
}
