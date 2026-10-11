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
      localStorage.setItem(
        "todos:focus-brief-cache",
        JSON.stringify({ privateTask: "Old account task" }),
      );
      const mockFetch = vi.mocked(global.fetch);
      mockFetch
        .mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }))
        .mockRejectedValueOnce(new Error("Network error"));

      await apiCall("/todos");

      expect(localStorage.getItem("authToken")).toBeNull();
      expect(localStorage.getItem("refreshToken")).toBeNull();
      expect(localStorage.getItem("user")).toBeNull();
      expect(localStorage.getItem("todos:focus-brief-cache")).toBeNull();
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

  describe("authentication response account isolation", () => {
    const setAccount = (id: string) => {
      localStorage.setItem("authToken", `synthetic-${id}-access`);
      localStorage.setItem("refreshToken", `synthetic-${id}-refresh`);
      localStorage.setItem("user", JSON.stringify({ id }));
    };

    it.each([200, 401])(
      "preserves a delayed %s from the same login after a peer refresh",
      async (status) => {
        setAccount("a");
        let finishDelayed!: (response: Response) => void;
        const fetch = vi.mocked(global.fetch);
        fetch
          .mockReturnValueOnce(
            new Promise<Response>((resolve) => {
              finishDelayed = resolve;
            }),
          )
          .mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }))
          .mockResolvedValueOnce(
            new Response(
              JSON.stringify({
                token: "synthetic-a-new",
                refreshToken: "synthetic-a-new-refresh",
              }),
            ),
          )
          .mockResolvedValueOnce(new Response("{}"))
          .mockResolvedValueOnce(new Response("{}"));
        const delayed = apiCall("/users/me");
        const peer = apiCall("/todos");
        expect((await peer).status).toBe(200);
        finishDelayed(new Response("{}", { status }));
        expect((await delayed).status).toBe(200);
        expect(
          fetch.mock.calls.filter(([url]) =>
            String(url).endsWith("/auth/refresh"),
          ),
        ).toHaveLength(1);
        expect(localStorage.getItem("authToken")).toBe("synthetic-a-new");
        expect(fetch).toHaveBeenCalledTimes(status === 200 ? 4 : 5);
        if (status === 401)
          expect(fetch.mock.calls[4]?.[1]?.headers).toEqual(
            expect.objectContaining({
              Authorization: "Bearer synthetic-a-new",
            }),
          );
      },
    );

    it.each(["success", "failure", "network"])(
      "ignores a late account A refresh %s after switching to B",
      async (outcome) => {
        setAccount("a");
        let finish!: (response: Response) => void;
        let fail!: (error: Error) => void;
        const deferred = new Promise<Response>((resolve, reject) => {
          finish = resolve;
          fail = reject;
        });
        const fetch = vi.mocked(global.fetch);
        fetch
          .mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }))
          .mockReturnValueOnce(deferred);
        const pending = apiCall("/todos");
        const assertion = expect(pending).rejects.toThrow(
          "Your session changed",
        );
        await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
        setAccount("b");
        if (outcome === "network") fail(new Error("Network interrupted"));
        else
          finish(
            outcome === "failure"
              ? new Response("Unauthorized", { status: 401 })
              : new Response(
                  JSON.stringify({
                    token: "synthetic-a-new",
                    refreshToken: "synthetic-a-new-refresh",
                  }),
                ),
          );
        await assertion;
        expect(localStorage.getItem("authToken")).toBe("synthetic-b-access");
        expect(localStorage.getItem("refreshToken")).toBe(
          "synthetic-b-refresh",
        );
        expect(localStorage.getItem("user")).toBe(JSON.stringify({ id: "b" }));
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(pageTransitions.navigateWithFade).not.toHaveBeenCalled();
      },
    );

    it("cannot restore account A after logout while refresh is pending", async () => {
      setAccount("a");
      let finish!: (response: Response) => void;
      const fetch = vi.mocked(global.fetch);
      fetch
        .mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }))
        .mockReturnValueOnce(
          new Promise<Response>((resolve) => {
            finish = resolve;
          }),
        );
      const pending = apiCall("/todos");
      const assertion = expect(pending).rejects.toThrow("Your session changed");
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
      localStorage.clear();
      finish(
        new Response(
          JSON.stringify({
            token: "synthetic-a-new",
            refreshToken: "synthetic-a-new-refresh",
          }),
        ),
      );
      await assertion;
      expect(localStorage.getItem("authToken")).toBeNull();
      expect(localStorage.getItem("refreshToken")).toBeNull();
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(pageTransitions.navigateWithFade).not.toHaveBeenCalled();
    });

    it("does not retry an old request using B when its original 401 arrives late", async () => {
      setAccount("a");
      let finish!: (response: Response) => void;
      const fetch = vi.mocked(global.fetch);
      fetch.mockReturnValueOnce(
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
      );
      const pending = apiCall("/todos", {
        method: "POST",
        body: "private account A task",
      });
      const assertion = expect(pending).rejects.toThrow("Your session changed");
      setAccount("b");
      finish(new Response("Unauthorized", { status: 401 }));
      await assertion;
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(localStorage.getItem("authToken")).toBe("synthetic-b-access");
    });

    it("does not deliver an old successful response to a new account", async () => {
      setAccount("a");
      let finish!: (response: Response) => void;
      vi.mocked(global.fetch).mockReturnValueOnce(
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
      );
      const pending = apiCall("/todos");
      const assertion = expect(pending).rejects.toThrow("Your session changed");
      setAccount("b");
      finish(new Response(JSON.stringify({ title: "Private account A task" })));
      await assertion;
      expect(localStorage.getItem("authToken")).toBe("synthetic-b-access");
    });

    it("does not share A's pending refresh with B or release B's refresh early", async () => {
      setAccount("a");
      let finishA!: (response: Response) => void;
      let finishB!: (response: Response) => void;
      const fetch = vi.mocked(global.fetch);
      fetch
        .mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }))
        .mockReturnValueOnce(
          new Promise<Response>((resolve) => {
            finishA = resolve;
          }),
        )
        .mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }))
        .mockReturnValueOnce(
          new Promise<Response>((resolve) => {
            finishB = resolve;
          }),
        )
        .mockResolvedValueOnce(new Response("{}"));
      const pendingA = apiCall("/todos");
      const assertionA = expect(pendingA).rejects.toThrow(
        "Your session changed",
      );
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
      setAccount("b");
      const pendingB = apiCall("/users/me");
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(4));
      finishA(new Response("Unauthorized", { status: 401 }));
      await assertionA;
      finishB(
        new Response(
          JSON.stringify({
            token: "synthetic-b-new",
            refreshToken: "synthetic-b-new-refresh",
          }),
        ),
      );
      expect((await pendingB).status).toBe(200);
      expect(localStorage.getItem("authToken")).toBe("synthetic-b-new");
      expect(fetch).toHaveBeenCalledTimes(5);
      expect(fetch.mock.calls[3]?.[1]?.body).toBe(
        JSON.stringify({ refreshToken: "synthetic-b-refresh" }),
      );
      expect(fetch.mock.calls[4]?.[1]?.headers).toEqual(
        expect.objectContaining({ Authorization: "Bearer synthetic-b-new" }),
      );
    });
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
