import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiCall } from "./client";
import { manualMutationRequest, MutationApiError } from "./mutations";
import { TodoApiError } from "./todos";

vi.mock("./client", () => ({
  apiCall: vi.fn(),
  buildUrl: (path: string) => path,
}));
beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.restoreAllMocks());

describe("shared manual project and subtask writes", () => {
  it.each([
    ["/projects", "POST", "add the project"],
    ["/todos/task-1/subtasks/step-1", "PUT", "save the subtask"],
  ])(
    "rejects a legacy queue receipt on %s with the same typed uncertainty as tasks",
    async (path, method, action) => {
      vi.mocked(apiCall).mockResolvedValue(
        new Response(JSON.stringify({ queued: true }), { status: 202 }),
      );
      const error = await manualMutationRequest(path, { method }, action).catch(
        (err: unknown) => err,
      );
      expect(error).toBeInstanceOf(MutationApiError);
      expect(error).toBeInstanceOf(TodoApiError);
      expect(error).toMatchObject({
        code: "uncertain",
        requiresReconciliation: true,
      });
      expect(apiCall).toHaveBeenCalledWith(
        path,
        expect.objectContaining({
          method,
          headers: { "X-Planwren-Offline-Mode": "manual" },
        }),
      );
    },
  );

  it("preserves custom headers while opting out of worker queueing", async () => {
    const response = new Response("{}", { status: 200 });
    vi.mocked(apiCall).mockResolvedValue(response);
    await expect(
      manualMutationRequest(
        "/projects",
        { method: "POST", headers: new Headers({ "X-Request-ID": "one" }) },
        "add project",
      ),
    ).resolves.toBe(response);
    expect(apiCall).toHaveBeenCalledWith(
      "/projects",
      expect.objectContaining({
        headers: { "x-request-id": "one", "X-Planwren-Offline-Mode": "manual" },
      }),
    );
  });

  it.each(["manual", "queue"])(
    "replaces an existing %s mode with exactly one manual worker header",
    async (existingMode) => {
      vi.mocked(apiCall).mockResolvedValue(new Response("{}", { status: 200 }));
      await manualMutationRequest(
        "/projects",
        {
          method: "POST",
          headers: { "x-planwren-offline-mode": existingMode },
        },
        "add project",
      );
      const options = vi.mocked(apiCall).mock.calls[0][1];
      expect(new Headers(options?.headers).get("X-Planwren-Offline-Mode")).toBe(
        "manual",
      );
    },
  );

  it("marks a lost mutation response as uncertain before a duplicate retry", async () => {
    vi.mocked(apiCall).mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(
      manualMutationRequest("/projects", { method: "POST" }, "add project"),
    ).rejects.toMatchObject({ code: "uncertain" });
  });

  it("gives a safe offline retry error without sending a request", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    await expect(
      manualMutationRequest("/projects", { method: "POST" }, "add project"),
    ).rejects.toMatchObject({ code: "network", requiresReconciliation: false });
    expect(apiCall).not.toHaveBeenCalled();
  });

  it("uses actionable fallbacks for unavailable servers instead of internal error details", async () => {
    vi.mocked(apiCall).mockResolvedValue(
      new Response(JSON.stringify({ error: "Database driver failed" }), {
        status: 500,
      }),
    );
    await expect(
      manualMutationRequest("/projects", { method: "POST" }, "add the project"),
    ).rejects.toMatchObject({
      code: "http",
      status: 500,
      message:
        "Could not add the project. The server is unavailable; try again shortly.",
    });
  });
});
