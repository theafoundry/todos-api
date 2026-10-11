// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { apiCall } from "../api/client";
import { useFocusBrief } from "./useFocusBrief";
import type { FocusBriefResponse } from "../types/focusBrief";

vi.mock("../api/client", () => ({
  apiCall: vi.fn(),
}));

const mockBrief: FocusBriefResponse = {
  pinned: {
    rightNow: {
      narrative: "Focus on this.",
      urgentItems: [],
      topRecommendation: null,
    },
    todayAgenda: [],
    rightNowProvenance: { source: "deterministic" },
    todayAgendaProvenance: { source: "deterministic" },
  },
  rankedPanels: [],
  generatedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 3600000).toISOString(),
  cached: false,
  isStale: false,
};

describe("useFocusBrief", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("fetches the focus brief on mount", async () => {
    vi.mocked(apiCall).mockResolvedValue({
      ok: true,
      json: async () => mockBrief,
    } as unknown as Response);

    const { result } = renderHook(() => useFocusBrief());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.brief).toEqual(mockBrief);
    expect(result.current.error).toBeNull();
  });

  it("sets error on fetch failure", async () => {
    vi.mocked(apiCall).mockResolvedValue({
      ok: false,
      status: 500,
    } as unknown as Response);

    const { result } = renderHook(() => useFocusBrief());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("HTTP 500");
  });

  it("ignores and removes the previous session's persistent brief", async () => {
    localStorage.setItem("todos:focus-brief-cache", JSON.stringify(mockBrief));

    vi.mocked(apiCall).mockResolvedValue({
      ok: true,
      json: async () => mockBrief,
    } as unknown as Response);

    const { result } = renderHook(() => useFocusBrief());

    expect(result.current.brief).toBeNull();
    expect(localStorage.getItem("todos:focus-brief-cache")).toBeNull();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.brief).toEqual(mockBrief);
    expect(localStorage.getItem("todos:focus-brief-cache")).toBeNull();
  });

  it("removes obsolete malformed storage without rendering it", async () => {
    const staleBrief = {
      rankedPanels: [{ type: "unsorted", data: {}, reason: "" }],
      pinned: { rightNow: {}, todayAgenda: [] },
    };
    localStorage.setItem("todos:focus-brief-cache", JSON.stringify(staleBrief));

    vi.mocked(apiCall).mockResolvedValue({
      ok: true,
      json: async () => mockBrief,
    } as unknown as Response);

    const { result } = renderHook(() => useFocusBrief());

    expect(result.current.loading).toBe(true);
    expect(result.current.brief).toBeNull();
    expect(localStorage.getItem("todos:focus-brief-cache")).toBeNull();
    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it("handles network error gracefully", async () => {
    vi.mocked(apiCall).mockRejectedValue(new Error("Network error"));

    const { result } = renderHook(() => useFocusBrief());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Network error");
  });

  it("retains only the current mounted session's brief on a transient failure and reconciles on Retry", async () => {
    vi.mocked(apiCall).mockResolvedValueOnce({
      ok: true,
      json: async () => mockBrief,
    } as Response);
    const { result } = renderHook(() => useFocusBrief());
    await waitFor(() => expect(result.current.loading).toBe(false));
    vi.mocked(apiCall).mockResolvedValueOnce({
      ok: false,
      status: 500,
    } as Response);
    await act(async () => {
      expect(await result.current.revalidate()).toBe(false);
    });
    expect(result.current.brief).toEqual(mockBrief);
    expect(result.current.error).toBe("HTTP 500");
    const fresh = { ...mockBrief, generatedAt: "2026-10-08T10:00:00Z" };
    vi.mocked(apiCall).mockResolvedValueOnce({
      ok: true,
      json: async () => fresh,
    } as Response);
    await act(async () => {
      expect(await result.current.revalidate()).toBe(true);
    });
    expect(result.current.brief).toEqual(fresh);
    expect(result.current.error).toBeNull();
  });

  it("does not replace a newer brief with a late earlier GET", async () => {
    let finish!: (response: Response) => void;
    vi.mocked(apiCall).mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    const { result } = renderHook(() => useFocusBrief());
    const fresh = { ...mockBrief, generatedAt: "2026-10-08T10:00:00Z" };
    vi.mocked(apiCall).mockResolvedValueOnce({
      ok: true,
      json: async () => fresh,
    } as Response);
    await act(async () => {
      expect(await result.current.revalidate()).toBe(true);
    });
    await act(async () => {
      finish({ ok: true, json: async () => mockBrief } as Response);
    });
    expect(result.current.brief).toEqual(fresh);
  });

  it("reports a failed refresh POST instead of reading and reporting success", async () => {
    vi.mocked(apiCall).mockResolvedValueOnce({
      ok: true,
      json: async () => mockBrief,
    } as Response);
    const { result } = renderHook(() => useFocusBrief());
    await waitFor(() => expect(result.current.loading).toBe(false));
    vi.mocked(apiCall).mockResolvedValueOnce({
      ok: false,
      status: 500,
    } as Response);
    await act(async () => {
      expect(await result.current.refresh()).toBe(false);
    });
    expect(apiCall).toHaveBeenCalledTimes(2);
    expect(result.current.error).toContain("Could not refresh");
    expect(result.current.brief).toEqual(mockBrief);
  });

  it.each([401, 403, 503])(
    "clears the current brief when GET returns %s",
    async (status) => {
      vi.mocked(apiCall).mockResolvedValueOnce({
        ok: true,
        json: async () => mockBrief,
      } as Response);
      const { result } = renderHook(() => useFocusBrief());
      await waitFor(() => expect(result.current.brief).toEqual(mockBrief));
      vi.mocked(apiCall).mockResolvedValueOnce({
        ok: false,
        status,
      } as Response);
      await act(async () => {
        expect(await result.current.revalidate()).toBe(false);
      });
      expect(result.current.brief).toBeNull();
      expect(result.current.error).toBe(`HTTP ${status}`);
      expect(result.current.unavailable).toBe(status === 503);
    },
  );

  it.each([401, 403, 503])(
    "clears the current brief when refresh POST returns %s without another GET",
    async (status) => {
      vi.mocked(apiCall).mockResolvedValueOnce({
        ok: true,
        json: async () => mockBrief,
      } as Response);
      const { result } = renderHook(() => useFocusBrief());
      await waitFor(() => expect(result.current.brief).toEqual(mockBrief));
      vi.mocked(apiCall).mockResolvedValueOnce({
        ok: false,
        status,
      } as Response);
      await act(async () => {
        expect(await result.current.refresh()).toBe(false);
      });
      expect(result.current.brief).toBeNull();
      expect(result.current.error).toContain(`(${status})`);
      expect(apiCall).toHaveBeenCalledTimes(2);
      expect(result.current.refreshing).toBe(false);
      expect(result.current.unavailable).toBe(status === 503);
    },
  );

  it("cannot restore an earlier GET after hosted AI becomes unavailable during refresh", async () => {
    vi.mocked(apiCall).mockResolvedValueOnce({
      ok: true,
      json: async () => mockBrief,
    } as Response);
    const { result } = renderHook(() => useFocusBrief());
    await waitFor(() => expect(result.current.brief).toEqual(mockBrief));
    let finishEarlier!: (response: Response) => void;
    vi.mocked(apiCall).mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        finishEarlier = resolve;
      }),
    );
    let earlier!: Promise<boolean>;
    act(() => {
      earlier = result.current.revalidate();
    });
    vi.mocked(apiCall).mockResolvedValueOnce({
      ok: false,
      status: 503,
    } as Response);
    await act(async () => {
      expect(await result.current.refresh()).toBe(false);
    });
    await act(async () => {
      finishEarlier({ ok: true, json: async () => mockBrief } as Response);
      await earlier;
    });
    expect(result.current.brief).toBeNull();
    expect(result.current.unavailable).toBe(true);
    expect(result.current.loading).toBe(false);
    expect(localStorage.getItem("todos:focus-brief-cache")).toBeNull();
  });

  it("cannot persist a late response after its session unmounts", async () => {
    let finish!: (value: Response) => void;
    vi.mocked(apiCall).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const firstSession = renderHook(() => useFocusBrief());
    firstSession.unmount();
    vi.mocked(apiCall).mockResolvedValueOnce({
      ok: false,
      status: 503,
    } as Response);
    const nextSession = renderHook(() => useFocusBrief());
    await waitFor(() =>
      expect(nextSession.result.current.error).toBe("HTTP 503"),
    );
    await act(async () => {
      finish({ ok: true, json: async () => mockBrief } as Response);
    });
    expect(nextSession.result.current.brief).toBeNull();
    expect(localStorage.getItem("todos:focus-brief-cache")).toBeNull();
  });
});
