import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { apiCall, buildUrl } from "./client";
import * as pageTransitions from "../utils/pageTransitions";

vi.mock("../utils/pageTransitions");

const originalLocation = window.location;
const originalFetch = global.fetch;

describe("api/client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    // Mock fetch globally
    global.fetch = vi.fn();
    // Mock location.origin
    Object.defineProperty(window, "location", {
      value: { origin: "http://localhost:3000" },
      writable: true,
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    Object.defineProperty(window, "location", {
      value: originalLocation,
      writable: true,
    });
  });

  describe("apiCall", () => {
    it("includes auth token header when present", async () => {
      localStorage.setItem("authToken", "token-123");
      vi.mocked(global.fetch).mockResolvedValue(
        new Response("{}", { status: 200 }),
      );

      await apiCall("/todos");

      expect(global.fetch).toHaveBeenCalledWith(
        "http://localhost:3000/todos",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer token-123",
          }),
        }),
      );
    });

    it("does not include auth header when no token", async () => {
      vi.mocked(global.fetch).mockResolvedValue(
        new Response("{}", { status: 200 }),
      );

      await apiCall("/auth/register", { method: "POST" });

      expect(global.fetch).toHaveBeenCalledWith(
        "http://localhost:3000/auth/register",
        expect.objectContaining({
          headers: expect.not.objectContaining({
            Authorization: expect.any(String),
          }),
        }),
      );
    });

    it("merges custom headers", async () => {
      vi.mocked(global.fetch).mockResolvedValue(
        new Response("{}", { status: 200 }),
      );

      await apiCall("/todos", {
        headers: { "X-Custom": "value" },
      });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            "X-Custom": "value",
          }),
        }),
      );
    });

    it("refreshes token on 401 and retries request", async () => {
      localStorage.setItem("authToken", "old-token");
      localStorage.setItem("refreshToken", "refresh-123");
      const mockFetch = vi.mocked(global.fetch);
      mockFetch
        .mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }))
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ token: "new-token", refreshToken: "new-refresh" }),
            {
              status: 200,
            },
          ),
        )
        .mockResolvedValueOnce(new Response("{}", { status: 200 }));

      const res = await apiCall("/todos");

      expect(res.status).toBe(200);
      // First call: original with old token (401)
      // Second call: refresh
      // Third call: retry with new token
      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(localStorage.getItem("authToken")).toBe("new-token");
    });

    it("returns 401 response when no refresh token (caller handles navigation)", async () => {
      localStorage.setItem("authToken", "token-123");
      vi.mocked(global.fetch).mockResolvedValue(
        new Response("Unauthorized", { status: 401 }),
      );

      const res = await apiCall("/todos");

      expect(res.status).toBe(401);
      // No navigation — caller handles the 401
      expect(
        vi.mocked(pageTransitions.navigateWithFade),
      ).not.toHaveBeenCalled();
    });

    it("navigates to auth on 401 when refresh fails", async () => {
      localStorage.setItem("authToken", "old-token");
      localStorage.setItem("refreshToken", "refresh-123");
      const mockFetch = vi.mocked(global.fetch);
      mockFetch
        .mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }))
        .mockResolvedValueOnce(new Response("Unauthorized", { status: 401 })); // refresh fails

      await apiCall("/todos");

      expect(vi.mocked(pageTransitions.navigateWithFade)).toHaveBeenCalledWith(
        "/auth?next=/app",
        { replace: true },
      );
    });

    it("deduplicates concurrent refresh requests", async () => {
      localStorage.setItem("authToken", "old-token");
      localStorage.setItem("refreshToken", "refresh-123");
      const mockFetch = vi.mocked(global.fetch);
      let resolveRefresh: (value: Response) => void;
      const refreshPromise = new Promise<Response>((r) => {
        resolveRefresh = r;
      });
      mockFetch
        .mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }))
        .mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }))
        .mockImplementationOnce(() => refreshPromise)
        .mockResolvedValueOnce(new Response("{}", { status: 200 }))
        .mockResolvedValueOnce(new Response("{}", { status: 200 }));

      // Fire two concurrent calls that both get 401
      const call1 = apiCall("/todos");
      const call2 = apiCall("/users/me");

      await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(3));
      // Resolve the one shared refresh after both original requests returned401.
      resolveRefresh!(
        new Response(
          JSON.stringify({ token: "new", refreshToken: "new-refresh" }),
          {
            status: 200,
          },
        ),
      );

      const [res1, res2] = await Promise.all([call1, call2]);

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
      // Two original401s, one refresh, and two retries.
      expect(mockFetch).toHaveBeenCalledTimes(5);
      expect(
        mockFetch.mock.calls.filter(([url]) =>
          String(url).endsWith("/auth/refresh"),
        ),
      ).toHaveLength(1);
    });

    it("clears all auth storage on refresh failure", async () => {
      localStorage.setItem("authToken", "old-token");
      localStorage.setItem("refreshToken", "refresh-123");
      localStorage.setItem("user", JSON.stringify({ id: "u1" }));
      const mockFetch = vi.mocked(global.fetch);
      mockFetch
        .mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }))
        .mockRejectedValueOnce(new Error("Network error"));

      await apiCall("/todos");

      expect(localStorage.getItem("authToken")).toBeNull();
      expect(localStorage.getItem("refreshToken")).toBeNull();
      expect(localStorage.getItem("user")).toBeNull();
    });

    it("clears all auth storage on refresh 401", async () => {
      localStorage.setItem("authToken", "old-token");
      localStorage.setItem("refreshToken", "refresh-123");
      localStorage.setItem("user", JSON.stringify({ id: "u1" }));
      const mockFetch = vi.mocked(global.fetch);
      mockFetch
        .mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }))
        .mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }));

      await apiCall("/todos");

      expect(localStorage.getItem("authToken")).toBeNull();
      expect(localStorage.getItem("refreshToken")).toBeNull();
      expect(localStorage.getItem("user")).toBeNull();
    });
  });

  describe("manual offline authentication", () => {
    it("preserves manual retry mode through token refresh and the retried write", async () => {
      localStorage.setItem("authToken", "old-token");
      localStorage.setItem("refreshToken", "refresh-123");
      const mockFetch = vi.mocked(global.fetch);
      mockFetch
        .mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }))
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ token: "new-token", refreshToken: "new-refresh" }),
            { status: 200 },
          ),
        )
        .mockResolvedValueOnce(new Response("{}", { status: 200 }));
      await apiCall("/todos", {
        method: "POST",
        headers: { "X-Planwren-Offline-Mode": "manual" },
      });
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        "http://localhost:3000/auth/refresh",
        expect.objectContaining({
          headers: expect.objectContaining({
            "X-Planwren-Offline-Mode": "manual",
          }),
        }),
      );
      expect(mockFetch).toHaveBeenNthCalledWith(
        3,
        "http://localhost:3000/todos",
        expect.objectContaining({
          headers: expect.objectContaining({
            "X-Planwren-Offline-Mode": "manual",
            Authorization: "Bearer new-token",
          }),
        }),
      );
    });

    it.each([
      new Response(JSON.stringify({ queued: true }), { status: 202 }),
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    ])(
      "never stores a queue receipt or invalid token response as credentials",
      async (refreshResponse) => {
        localStorage.setItem("authToken", "old-token");
        localStorage.setItem("refreshToken", "refresh-123");
        const mockFetch = vi.mocked(global.fetch);
        mockFetch
          .mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }))
          .mockResolvedValueOnce(refreshResponse);
        const response = await apiCall("/todos", {
          method: "POST",
          headers: { "X-Planwren-Offline-Mode": "manual" },
        });
        expect(response.status).toBe(401);
        expect(mockFetch).toHaveBeenCalledTimes(2);
        expect(localStorage.getItem("authToken")).toBeNull();
        expect(localStorage.getItem("refreshToken")).toBeNull();
        expect(pageTransitions.navigateWithFade).toHaveBeenCalledWith(
          "/auth?next=/app",
          { replace: true },
        );
      },
    );
  });

  describe("buildUrl", () => {
    it("returns path unchanged with no params", () => {
      expect(buildUrl("/todos")).toBe("/todos");
    });

    it("appends query params", () => {
      expect(
        buildUrl("/todos", { projectId: "proj-1", completed: false }),
      ).toBe("/todos?projectId=proj-1&completed=false");
    });

    it("omits null and undefined params", () => {
      expect(
        buildUrl("/todos", {
          projectId: null,
          status: undefined,
          completed: true,
        }),
      ).toBe("/todos?completed=true");
    });

    it("omits empty string params", () => {
      expect(buildUrl("/todos", { projectId: "", status: "next" })).toBe(
        "/todos?status=next",
      );
    });

    it("handles numeric params", () => {
      expect(buildUrl("/todos", { limit: 20, offset: 0 })).toBe(
        "/todos?limit=20&offset=0",
      );
    });
  });
});
