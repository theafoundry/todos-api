import { navigateWithFade } from "../utils/pageTransitions";
import { clearPrivateBrowserData } from "../utils/privateBrowserData";
import {
  getAuthSession,
  invalidateAuthSession,
  isCurrentAuthSession,
  rotateAuthSession,
  type AuthSession,
} from "../utils/authSession";

const API_URL = window.location.origin;

type RefreshResult =
  | { kind: "refreshed"; session: AuthSession }
  | { kind: "failed" | "superseded" };

let refreshInFlight: {
  session: AuthSession;
  promise: Promise<RefreshResult>;
} | null = null;

function sameCredentials(left: AuthSession, right = getAuthSession()): boolean {
  return left.token === right.token && left.refreshToken === right.refreshToken;
}

function sessionChanged(): Error {
  return new Error("Your session changed. Please try again.");
}

function clearAuth() {
  invalidateAuthSession();
  clearPrivateBrowserData();
  localStorage.removeItem("authToken");
  localStorage.removeItem("refreshToken");
  localStorage.removeItem("user");
}

async function refreshAccessToken(
  session: AuthSession,
  manualRetry = false,
): Promise<RefreshResult> {
  if (!session.refreshToken) return { kind: "failed" };

  if (
    refreshInFlight &&
    session.generation === refreshInFlight.session.generation
  )
    return refreshInFlight.promise;

  const promise = (async (): Promise<RefreshResult> => {
    try {
      const res = await fetch(`${API_URL}/auth/refresh`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(manualRetry && { "X-Planwren-Offline-Mode": "manual" }),
        },
        body: JSON.stringify({ refreshToken: session.refreshToken }),
      });
      if (!isCurrentAuthSession(session)) return { kind: "superseded" };
      if (!res.ok || res.status === 202) {
        clearAuth();
        return { kind: "failed" };
      }
      const data = await res.json();
      if (!isCurrentAuthSession(session)) return { kind: "superseded" };
      if (
        typeof data.token !== "string" ||
        !data.token ||
        typeof data.refreshToken !== "string" ||
        !data.refreshToken
      ) {
        clearAuth();
        return { kind: "failed" };
      }
      return {
        kind: "refreshed",
        session: rotateAuthSession(session, data.token, data.refreshToken),
      };
    } catch {
      if (!isCurrentAuthSession(session)) return { kind: "superseded" };
      clearAuth();
      return { kind: "failed" };
    } finally {
      if (refreshInFlight?.session === session) refreshInFlight = null;
    }
  })();

  refreshInFlight = { session, promise };
  return promise;
}

export async function apiCall(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const session = getAuthSession();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (session.token) {
    headers["Authorization"] = `Bearer ${session.token}`;
  }

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });
  if (!isCurrentAuthSession(session)) throw sessionChanged();

  if (res.status === 401 && session.refreshToken) {
    // A peer may have refreshed this same login while the original response was
    // delayed. Reuse its current token instead of refreshing an old credential.
    const current = getAuthSession();
    const refreshed: RefreshResult = sameCredentials(session, current)
      ? await refreshAccessToken(
          current,
          headers["X-Planwren-Offline-Mode"] === "manual",
        )
      : { kind: "refreshed", session: current };
    if (refreshed.kind === "superseded") throw sessionChanged();
    if (refreshed.kind === "refreshed") {
      if (!isCurrentAuthSession(refreshed.session)) throw sessionChanged();
      const retrySession = getAuthSession();
      if (retrySession.token) {
        headers["Authorization"] = `Bearer ${retrySession.token}`;
      }
      const retried = await fetch(`${API_URL}${path}`, { ...options, headers });
      if (!isCurrentAuthSession(retrySession)) throw sessionChanged();
      return retried;
    }
    navigateWithFade("/auth?next=/app", { replace: true });
  }

  return res;
}

export function buildUrl(
  path: string,
  params: Record<string, string | number | boolean | undefined | null> = {},
): string {
  const url = new URL(`${API_URL}${path}`);
  for (const [key, val] of Object.entries(params)) {
    if (val != null && val !== "") {
      url.searchParams.set(key, String(val));
    }
  }
  return url.pathname + url.search;
}
