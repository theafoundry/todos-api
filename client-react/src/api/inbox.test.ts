import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiCall } from "./client";
import {
  acceptCapture,
  captureInboxItem,
  discardCapture,
  fetchInboxItems,
} from "./inbox";

vi.mock("./client", () => ({ apiCall: vi.fn() }));
const item = {
  id: "capture-1",
  text: "Read the design notes",
  source: "api",
  lifecycle: "new",
  capturedAt: "2026-10-08T12:00:00.000Z",
  createdAt: "2026-10-08T12:00:00.000Z",
  updatedAt: "2026-10-08T12:00:00.000Z",
};
const task = {
  id: "task-1",
  title: item.text,
  status: "next",
  completed: false,
  archived: false,
  tags: [],
  dependsOnTaskIds: [],
  order: 0,
  userId: "user-1",
  createdAt: item.createdAt,
  updatedAt: item.updatedAt,
};
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
const captureResponse = () => response({ ok: true, data: { item } }, 201);
const keyAt = (index: number) =>
  new Headers(vi.mocked(apiCall).mock.calls[index][1]?.headers).get(
    "Idempotency-Key",
  );

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("crypto", webcrypto);
  localStorage.setItem("authToken", crypto.randomUUID());
  localStorage.setItem("user", JSON.stringify({ id: crypto.randomUUID() }));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Inbox transport", () => {
  it("loads the pending review queue from the direct capture endpoint", async () => {
    vi.mocked(apiCall).mockResolvedValue(response([item]));
    await expect(fetchInboxItems()).resolves.toEqual([item]);
    expect(apiCall).toHaveBeenCalledWith("/capture?review=pending");
  });

  it.each([
    response({ error: "Unauthorized" }, 401),
    response({ items: [item] }),
    response([{ ...item, text: undefined }]),
  ])(
    "never turns a failed or malformed queue response into an empty Inbox",
    async (res) => {
      vi.mocked(apiCall).mockResolvedValue(res);
      await expect(fetchInboxItems()).rejects.toThrow();
    },
  );

  it("reports network failure while loading", async () => {
    vi.mocked(apiCall).mockRejectedValue(new TypeError("offline"));
    await expect(fetchInboxItems()).rejects.toMatchObject({ code: "network" });
  });

  it("accepts with a trimmed title and a confirmed task, without a project", async () => {
    vi.mocked(apiCall).mockResolvedValue(response({ task, created: true }));
    await expect(acceptCapture("capture/1", "  Read notes  ")).resolves.toEqual(
      { task, created: true },
    );
    expect(apiCall).toHaveBeenCalledWith(
      "/capture/capture%2F1/accept",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ title: "Read notes" }),
        headers: expect.objectContaining({
          "X-Planwren-Offline-Mode": "manual",
        }),
      }),
    );
  });

  it.each([
    { queued: true },
    { task: { ...task, id: "" }, created: true },
    { task, created: "yes" },
  ])("does not acknowledge malformed acceptance", async (body) => {
    vi.mocked(apiCall).mockResolvedValue(response(body));
    await expect(acceptCapture(item.id)).rejects.toMatchObject({
      code: "uncertain",
    });
  });

  it("confirms discard lifecycle and identity", async () => {
    vi.mocked(apiCall).mockResolvedValueOnce(
      response({ ...item, lifecycle: "discarded" }),
    );
    await expect(discardCapture(item.id)).resolves.toMatchObject({
      lifecycle: "discarded",
    });
    vi.mocked(apiCall).mockResolvedValueOnce(response(item));
    await expect(discardCapture(item.id)).rejects.toMatchObject({
      code: "uncertain",
    });
  });

  it("preserves server conflict errors", async () => {
    vi.mocked(apiCall).mockResolvedValue(
      response({ error: "Capture has already been discarded" }, 409),
    );
    await expect(acceptCapture(item.id)).rejects.toThrow(
      "Capture has already been discarded",
    );
  });

  it("saves manual captures through the canonical agent action and reads its envelope", async () => {
    vi.mocked(apiCall).mockResolvedValue(captureResponse());
    await expect(
      captureInboxItem("  Read the design notes  "),
    ).resolves.toEqual(item);
    expect(apiCall).toHaveBeenCalledWith(
      "/agent/write/capture_inbox_item",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ text: item.text, source: "manual" }),
        headers: expect.objectContaining({
          "idempotency-key": expect.any(String),
          "X-Planwren-Offline-Mode": "manual",
        }),
      }),
    );
  });

  it("reuses the same opaque key after an ambiguous save and uses a new key after confirmed success", async () => {
    vi.mocked(apiCall)
      .mockRejectedValueOnce(new TypeError("response lost"))
      .mockResolvedValueOnce(captureResponse())
      .mockResolvedValueOnce(captureResponse());
    await expect(captureInboxItem(item.text)).rejects.toMatchObject({
      code: "uncertain",
    });
    await captureInboxItem(item.text);
    await captureInboxItem(item.text);
    expect(keyAt(0)).toBe(keyAt(1));
    expect(keyAt(2)).not.toBe(keyAt(1));
  });

  it("does not reuse an uncertain key for a changed draft or account", async () => {
    vi.mocked(apiCall)
      .mockRejectedValueOnce(new TypeError("lost"))
      .mockImplementation(async () => captureResponse());
    await expect(captureInboxItem(item.text)).rejects.toThrow();
    await captureInboxItem("Changed intention");
    localStorage.setItem("user", JSON.stringify({ id: "different-account" }));
    await captureInboxItem(item.text);
    expect(keyAt(1)).not.toBe(keyAt(0));
    expect(keyAt(2)).not.toBe(keyAt(0));
  });

  it("keeps an uncertain retry key when the same account refreshes its access token", async () => {
    vi.mocked(apiCall)
      .mockRejectedValueOnce(new TypeError("response lost"))
      .mockResolvedValueOnce(captureResponse());
    await expect(captureInboxItem(item.text)).rejects.toThrow();
    localStorage.setItem("authToken", "refreshed-access-token");
    await captureInboxItem(item.text);
    expect(keyAt(1)).toBe(keyAt(0));
  });

  it("falls back to a stable JWT account claim when the cached profile is absent", async () => {
    localStorage.removeItem("user");
    const token = (issued: number) =>
      `header.${btoa(JSON.stringify({ userId: "jwt-account", iat: issued }))}.signature`;
    localStorage.setItem("authToken", token(1));
    vi.mocked(apiCall)
      .mockRejectedValueOnce(new TypeError("response lost"))
      .mockResolvedValueOnce(captureResponse());
    await expect(captureInboxItem(item.text)).rejects.toThrow();
    localStorage.setItem("authToken", token(2));
    await captureInboxItem(item.text);
    expect(keyAt(1)).toBe(keyAt(0));
  });

  it("keeps an explicit draft key for manual retries and rejects queued acknowledgments", async () => {
    vi.mocked(apiCall).mockResolvedValue(response({ queued: true }, 202));
    await expect(
      captureInboxItem(item.text, "manual", "draft-key"),
    ).rejects.toMatchObject({ code: "uncertain" });
    expect(keyAt(0)).toBe("draft-key");
  });
});
