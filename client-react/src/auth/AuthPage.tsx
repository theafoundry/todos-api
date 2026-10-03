import { useState, useEffect, useCallback } from "react";
import { useAuth } from "./AuthProvider";
import { LoginForm } from "./LoginForm";
import { RegisterForm } from "./RegisterForm";
import { ForgotPasswordForm } from "./ForgotPasswordForm";
import { ResetPasswordForm } from "./ResetPasswordForm";
import { PhoneLoginForm } from "./PhoneLoginForm";
import { navigateWithFade } from "../utils/pageTransitions";
import { BrandMark } from "../components/ui/BrandMark";
import "./auth.css";

type FormView = "login" | "register" | "forgot" | "reset" | "phone";
type MessageType = "error" | "success";

function readQueryParam(key: string): string | null {
  return new URLSearchParams(window.location.search).get(key);
}

export function AuthPage() {
  const { setTokens } = useAuth();
  const [view, setView] = useState<FormView>("login");
  const [tab, setTab] = useState<"login" | "register">("login");
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

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-card__header">
          <button
            className="auth-card__back"
            onClick={goHome}
            title="Back to home"
          >
            ←
          </button>
          <span className="auth-card__logo">
            <BrandMark size={28} />
            <span>Planwren</span>
          </span>
        </div>

        {message && (
          <div
            className={`auth-message auth-message--${message.type} auth-message--visible`}
          >
            <span>{message.text}</span>
            <button
              className="auth-message__dismiss"
              onClick={dismissMessage}
              title="Dismiss"
            >
              ✕
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
                role="tab"
                aria-selected={tab === "login"}
                className={`auth-tab${tab === "login" ? " auth-tab--active" : ""}`}
                onClick={() => {
                  setTab("login");
                  setView("login");
                  setMessage(null);
                }}
              >
                Login
              </button>
              <button
                role="tab"
                aria-selected={tab === "register"}
                className={`auth-tab${tab === "register" ? " auth-tab--active" : ""}`}
                onClick={() => {
                  setTab("register");
                  setView("register");
                  setMessage(null);
                }}
              >
                Register
              </button>
            </div>
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
    </div>
  );
}
