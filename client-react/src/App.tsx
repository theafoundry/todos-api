import { useEffect } from "react";
import { AuthProvider, useAuth } from "./auth/AuthProvider";
import { AuthPage } from "./auth/AuthPage";
import { FeedbackView } from "./views/FeedbackView";
import { AppShell } from "./components/layout/AppShell";
import { MobileShell } from "./mobile/MobileShell";
import { ToastProvider } from "./components/ui/ToastProvider";
import { useIsMobile } from "./hooks/useIsMobile";
import "./styles/app.css";
import { navigateWithFade } from "./utils/pageTransitions";

function AuthGate() {
  const { user, loading } = useAuth();
  const isMobile = useIsMobile();

  useEffect(() => {
    if (!loading && !user) {
      navigateWithFade("/auth?next=/app", { replace: true });
    }
  }, [loading, user]);

  if (loading) {
    return (
      <div id="todosView">
        <div id="todosContent">
          <div className="loading">Loading…</div>
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  if (isMobile) {
    return (
      <div id="todosView" className="active">
        <div id="todosContent">
          <MobileShell key={user.id} />
        </div>
      </div>
    );
  }

  return (
    <div id="todosView" className="active">
      <div id="todosContent">
        <AppShell key={user.id} />
      </div>
    </div>
  );
}

function AppContent() {
  const path = window.location.pathname;

  // /auth — standalone auth page (no auth gate needed)
  if (path === "/auth") {
    return (
      <AuthProvider>
        <AuthPage />
      </AuthProvider>
    );
  }

  // /feedback or /feedback/new — feedback pages (auth-gated internally)
  if (path === "/feedback" || path === "/feedback/new") {
    return (
      <AuthProvider>
        <FeedbackView />
      </AuthProvider>
    );
  }

  // Everything else — main app with auth gate
  return (
    <AuthProvider>
      <AuthGate />
    </AuthProvider>
  );
}

export function App() {
  return (
    <ToastProvider>
      <AppContent />
    </ToastProvider>
  );
}
