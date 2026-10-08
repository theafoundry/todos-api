import { navigateWithFade } from "../utils/pageTransitions";

const API_URL = window.location.origin;

let refreshInFlight: Promise<boolean> | null = null;

function getToken(): string | null {
  return localStorage.getItem("authToken");
}

function getRefreshToken(): string | null {
  return localStorage.getItem("refreshToken");
}

function setTokens(token: string, refresh: string) {
  localStorage.setItem("authToken", token);
  localStorage.setItem("refreshToken", refresh);
}

function clearAuth() {
  localStorage.removeItem("authToken");
  localStorage.removeItem("refreshToken");
  localStorage.removeItem("user");
}

async function refreshAccessToken(manualRetry = false): Promise<boolean> {
  const refresh = getRefreshToken();
  if (!refresh) return false;

  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      const res = await fetch(`${API_URL}/auth/refresh`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(manualRetry && { "X-Planwren-Offline-Mode": "manual" }),
        },
        body: JSON.stringify({ refreshToken: refresh }),
      });
      if (!res.ok || res.status === 202) {
        clearAuth();
        return false;
      }
      const data = await res.json();
      if (
        typeof data.token !== "string" ||
        !data.token ||
        typeof data.refreshToken !== "string" ||
        !data.refreshToken
      ) {
        clearAuth();
        return false;
      }
      setTokens(data.token, data.refreshToken);
      return true;
    } catch {
      clearAuth();
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

export async function apiCall(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });

  if (res.status === 401 && getRefreshToken()) {
    const refreshed = await refreshAccessToken(
      headers["X-Planwren-Offline-Mode"] === "manual",
    );
    if (refreshed) {
      const newToken = getToken();
      if (newToken) {
        headers["Authorization"] = `Bearer ${newToken}`;
      }
      return fetch(`${API_URL}${path}`, { ...options, headers });
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
