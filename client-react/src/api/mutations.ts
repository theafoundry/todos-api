import { apiCall } from "./client";

export interface MutationOptions {
  /** Keep mobile drafts locally and ask the user to retry explicitly. */
  offlineMode?: "manual" | "queue";
}

export class MutationApiError extends Error {
  constructor(
    message: string,
    public readonly code: "network" | "http" | "uncertain",
    public readonly status?: number,
    public readonly requiresReconciliation = code === "uncertain",
  ) {
    super(message);
    this.name = "TodoApiError";
  }
}

export async function ensureApiResponse(
  res: Response,
  action: string,
  mutation = false,
): Promise<void> {
  if (res.status === 202) {
    throw new MutationApiError(
      "This change may be queued by an older app version. Reconnect and refresh to check it before trying again.",
      "uncertain",
      res.status,
    );
  }
  if (res.ok) return;
  let detail = "";
  try {
    const body: unknown = await res.json();
    if (body && typeof body === "object") {
      const data = body as Record<string, unknown>;
      detail =
        typeof data.error === "string"
          ? data.error
          : typeof data.message === "string"
            ? data.message
            : "";
    }
  } catch {
    // An HTML or empty error response still gets a useful fallback.
  }
  const fallback =
    res.status === 401
      ? "Your session has expired. Sign in again to continue."
      : res.status === 403
        ? "You do not have permission to make this change."
        : res.status === 404
          ? "This item is no longer available. Refresh the list."
          : res.status >= 500
            ? `Could not ${action}. The server is unavailable; try again shortly.`
            : `Could not ${action}. Check the details and try again.`;
  throw new MutationApiError(
    (res.status < 500 && detail) || fallback,
    "http",
    res.status,
    mutation && res.status >= 500,
  );
}

export async function mutationRequest(
  path: string,
  init: RequestInit,
  options: MutationOptions,
  action: string,
): Promise<Response> {
  if (options.offlineMode === "manual" && !navigator.onLine) {
    throw new MutationApiError(
      "You're offline. Reconnect before trying again.",
      "network",
    );
  }
  let response: Response;
  try {
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    if (options.offlineMode === "manual") {
      // Headers normalizes keys; keep only one value when overriding an existing mode.
      delete headers["x-planwren-offline-mode"];
      headers["X-Planwren-Offline-Mode"] = "manual";
    }
    response = await apiCall(path, {
      ...init,
      ...((options.offlineMode === "manual" || init.headers) && { headers }),
    });
  } catch {
    throw new MutationApiError(
      "The connection was interrupted and this change could not be confirmed. Reconnect and refresh to check it before trying again.",
      "uncertain",
    );
  }
  await ensureApiResponse(response, action, true);
  return response;
}

/** Shared manual-retry behavior for mobile project and subtask writes. */
export function manualMutationRequest(
  path: string,
  init: RequestInit,
  action: string,
): Promise<Response> {
  return mutationRequest(path, init, { offlineMode: "manual" }, action);
}
