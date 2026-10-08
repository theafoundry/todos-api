import { apiCall } from "./client";
import type { Todo } from "../types";
import { isTodo } from "./todos";
import {
  ensureApiResponse,
  manualMutationRequest,
  MutationApiError,
} from "./mutations";

export interface CaptureItemDto {
  id: string;
  text: string;
  source?: string | null;
  capturedAt: string;
  lifecycle: "new" | "triaged" | "discarded";
  triageResult?: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface AcceptedCapture {
  task: Todo;
  created: boolean;
}

const uncertainCaptures = new Map<string, { key: string; expiresAt: number }>();

function captureAccountId(): string | null {
  try {
    const user: unknown = JSON.parse(localStorage.getItem("user") ?? "null");
    if (
      user &&
      typeof user === "object" &&
      "id" in user &&
      typeof user.id === "string" &&
      user.id
    )
      return user.id;
  } catch {
    /* A missing or invalid cached profile can fall back to the token's account claim. */
  }
  try {
    const encoded = localStorage.getItem("authToken")?.split(".")[1];
    if (!encoded) return null;
    const payload: unknown = JSON.parse(
      atob(encoded.replace(/-/g, "+").replace(/_/g, "/")),
    );
    if (
      payload &&
      typeof payload === "object" &&
      "userId" in payload &&
      typeof payload.userId === "string" &&
      payload.userId
    )
      return payload.userId;
  } catch {
    /* Do not share a retry key when the account cannot be identified. */
  }
  return null;
}

async function captureIdentity(
  text: string,
  source: string,
): Promise<string | null> {
  const accountId = captureAccountId();
  if (!accountId) return null;
  // Keep only a digest in memory. Account credentials and capture text are never persisted here.
  const bytes = new TextEncoder().encode(
    JSON.stringify([accountId, text, source]),
  );
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function isCaptureItem(value: unknown): value is CaptureItemDto {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === "string" &&
    Boolean(item.id) &&
    typeof item.text === "string" &&
    (item.source == null || typeof item.source === "string") &&
    typeof item.capturedAt === "string" &&
    typeof item.createdAt === "string" &&
    typeof item.updatedAt === "string" &&
    ["new", "triaged", "discarded"].includes(String(item.lifecycle))
  );
}

async function readCapture(
  res: Response,
  expectedId?: string,
): Promise<CaptureItemDto> {
  const data: unknown = await res.json().catch(() => null);
  if (!isCaptureItem(data) || (expectedId && data.id !== expectedId)) {
    throw new MutationApiError(
      "The saved capture could not be confirmed. Refresh Inbox to check it before trying again.",
      "uncertain",
      res.status,
    );
  }
  return data;
}

export interface CaptureRouteSuggestion {
  route: "task" | "triage";
  confidence: number;
  why: string;
  cleanedTitle?: string;
  extractedFields?: {
    dueDate?: string | null;
    project?: string | null;
    projectId?: string | null;
  };
}

interface AgentEnvelope<T> {
  data?: T;
}

export async function fetchInboxItems(): Promise<CaptureItemDto[]> {
  let res: Response;
  try {
    res = await apiCall("/capture?review=pending");
  } catch {
    throw new MutationApiError(
      "Could not load Inbox. Check your connection and try again.",
      "network",
    );
  }
  await ensureApiResponse(res, "load Inbox");
  const data: unknown = await res.json().catch(() => null);
  if (!Array.isArray(data) || !data.every(isCaptureItem)) {
    throw new MutationApiError(
      "Could not load Inbox. The server returned an invalid capture list.",
      "http",
      res.status,
    );
  }
  return data;
}

export async function acceptCapture(
  captureId: string,
  title?: string,
): Promise<AcceptedCapture> {
  const res = await manualMutationRequest(
    `/capture/${encodeURIComponent(captureId)}/accept`,
    {
      method: "POST",
      body: JSON.stringify(title === undefined ? {} : { title: title.trim() }),
    },
    "accept the capture",
  );
  const data: unknown = await res.json().catch(() => null);
  if (
    !data ||
    typeof data !== "object" ||
    !("task" in data) ||
    !isTodo(data.task) ||
    !("created" in data) ||
    typeof data.created !== "boolean"
  ) {
    throw new MutationApiError(
      "Acceptance could not be confirmed. Refresh Inbox or retry acceptance to check the saved task.",
      "uncertain",
      res.status,
    );
  }
  return data as AcceptedCapture;
}

export async function discardCapture(
  captureId: string,
): Promise<CaptureItemDto> {
  const res = await manualMutationRequest(
    `/capture/${encodeURIComponent(captureId)}/discard`,
    { method: "POST", body: JSON.stringify({}) },
    "discard the capture",
  );
  const item = await readCapture(res, captureId);
  if (item.lifecycle !== "discarded") {
    throw new MutationApiError(
      "Discard could not be confirmed. Refresh Inbox to check it before trying again.",
      "uncertain",
      res.status,
    );
  }
  return item;
}

export async function suggestCaptureRoute(input: {
  text: string;
  project?: string | null;
  workspaceView?: string;
}): Promise<CaptureRouteSuggestion | null> {
  const res = await apiCall("/agent/read/suggest_capture_route", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!res.ok) return null;

  const payload = (await res.json()) as
    | CaptureRouteSuggestion
    | AgentEnvelope<CaptureRouteSuggestion>;
  if ("data" in payload && payload.data) {
    return payload.data;
  }
  return payload as CaptureRouteSuggestion;
}

export async function captureInboxItem(
  text: string,
  source = "manual",
  idempotencyKey?: string,
): Promise<CaptureItemDto> {
  const trimmed = text.trim();
  const identity = await captureIdentity(trimmed, source);
  for (const [signature, attempt] of uncertainCaptures) {
    if (attempt.expiresAt <= Date.now()) uncertainCaptures.delete(signature);
  }
  const key =
    idempotencyKey ??
    (identity ? uncertainCaptures.get(identity)?.key : undefined) ??
    crypto.randomUUID();
  try {
    const res = await manualMutationRequest(
      "/agent/write/capture_inbox_item",
      {
        method: "POST",
        headers: { "Idempotency-Key": key },
        body: JSON.stringify({ text: trimmed, source }),
      },
      "save to Inbox",
    );
    const envelope: unknown = await res.json().catch(() => null);
    const item =
      envelope &&
      typeof envelope === "object" &&
      "data" in envelope &&
      envelope.data &&
      typeof envelope.data === "object" &&
      "item" in envelope.data
        ? envelope.data.item
        : null;
    if (!isCaptureItem(item)) {
      throw new MutationApiError(
        "The saved capture could not be confirmed. Refresh Inbox to check it before trying again.",
        "uncertain",
        res.status,
      );
    }
    if (identity) uncertainCaptures.delete(identity);
    return item;
  } catch (error) {
    if (
      identity &&
      error instanceof MutationApiError &&
      error.requiresReconciliation
    ) {
      uncertainCaptures.set(identity, {
        key,
        expiresAt: Date.now() + 15 * 60 * 1000,
      });
      if (uncertainCaptures.size > 50)
        uncertainCaptures.delete(uncertainCaptures.keys().next().value!);
    } else {
      if (identity) uncertainCaptures.delete(identity);
    }
    throw error;
  }
}
