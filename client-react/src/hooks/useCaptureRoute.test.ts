import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import * as inboxApi from "../api/inbox";
import { useCaptureRoute } from "./useCaptureRoute";
import type { CaptureRouteSuggestion } from "../api/inbox";

vi.mock("../api/inbox");

describe("useCaptureRoute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("disabled or empty text", () => {
    it("returns task route when text is empty and no project", () => {
      const { result } = renderHook(() =>
        useCaptureRoute({
          text: "",
          project: null,
          workspaceView: undefined,
          enabled: true,
        }),
      );

      expect(result.current.preferredRoute).toBe("task");
      expect(result.current.loading).toBe(false);
      expect(result.current.suggestion).toBeNull();
    });

    it("returns project route 'task' when project is set", () => {
      const { result } = renderHook(() =>
        useCaptureRoute({
          text: "",
          project: "proj-1",
          workspaceView: undefined,
          enabled: true,
        }),
      );

      expect(result.current.preferredRoute).toBe("task");
    });

    it("returns triage route when workspaceView is 'triage'", () => {
      const { result } = renderHook(() =>
        useCaptureRoute({
          text: "",
          project: null,
          workspaceView: "triage",
          enabled: true,
        }),
      );

      expect(result.current.preferredRoute).toBe("triage");
    });

    it("defaults to saving for review from the primary Inbox view", () => {
      const { result } = renderHook(() =>
        useCaptureRoute({ text: "", workspaceView: "inbox" }),
      );
      expect(result.current.preferredRoute).toBe("triage");
      expect(result.current.alternateRoute).toBe("task");
    });

    it("does not call API when enabled is false", async () => {
      renderHook(() =>
        useCaptureRoute({
          text: "some text",
          project: null,
          workspaceView: undefined,
          enabled: false,
        }),
      );

      await new Promise((r) => setTimeout(r, 300));
      expect(inboxApi.suggestCaptureRoute).not.toHaveBeenCalled();
    });

    it("does not call API when text is only whitespace", async () => {
      renderHook(() =>
        useCaptureRoute({
          text: "   ",
          project: null,
          workspaceView: undefined,
          enabled: true,
        }),
      );

      await new Promise((r) => setTimeout(r, 300));
      expect(inboxApi.suggestCaptureRoute).not.toHaveBeenCalled();
    });
  });

  describe("API suggestions", () => {
    it("calls API after debounce with trimmed text", async () => {
      const suggestion: CaptureRouteSuggestion = {
        route: "triage",
        confidence: 0.9,
        why: "test",
      };
      vi.mocked(inboxApi.suggestCaptureRoute).mockResolvedValue(suggestion);

      renderHook(() =>
        useCaptureRoute({
          text: "  hello world  ",
          project: null,
          workspaceView: undefined,
          enabled: true,
        }),
      );

      expect(inboxApi.suggestCaptureRoute).not.toHaveBeenCalled();

      // Wait for debounce + API call
      await waitFor(
        () => {
          expect(inboxApi.suggestCaptureRoute).toHaveBeenCalledWith({
            text: "hello world",
            project: null,
            workspaceView: undefined,
          });
        },
        { timeout: 1000 },
      );
    });

    it("uses suggested route when confidence >= 0.7", async () => {
      const suggestion: CaptureRouteSuggestion = {
        route: "triage",
        confidence: 0.85,
        why: "test",
      };
      vi.mocked(inboxApi.suggestCaptureRoute).mockResolvedValue(suggestion);

      const { result } = renderHook(() =>
        useCaptureRoute({
          text: "meeting notes",
          project: null,
          workspaceView: undefined,
          enabled: true,
        }),
      );

      await waitFor(
        () => {
          expect(result.current.preferredRoute).toBe("triage");
        },
        { timeout: 1000 },
      );

      expect(result.current.suggestion).toEqual(suggestion);
    });

    it("falls back to task route when confidence < 0.7", async () => {
      const suggestion: CaptureRouteSuggestion = {
        route: "triage",
        confidence: 0.5,
        why: "test",
      };
      vi.mocked(inboxApi.suggestCaptureRoute).mockResolvedValue(suggestion);

      const { result } = renderHook(() =>
        useCaptureRoute({
          text: "something",
          project: null,
          workspaceView: undefined,
          enabled: true,
        }),
      );

      await waitFor(
        () => {
          expect(result.current.preferredRoute).toBe("task");
        },
        { timeout: 1000 },
      );
    });

    it("passes project and workspaceView to the API", async () => {
      vi.mocked(inboxApi.suggestCaptureRoute).mockResolvedValue({
        route: "task",
        confidence: 0.9,
        why: "test",
      });

      renderHook(() =>
        useCaptureRoute({
          text: "task text",
          project: "proj-1",
          workspaceView: "inbox",
          enabled: true,
        }),
      );

      await waitFor(
        () => {
          expect(inboxApi.suggestCaptureRoute).toHaveBeenCalledWith({
            text: "task text",
            project: "proj-1",
            workspaceView: "inbox",
          });
        },
        { timeout: 1000 },
      );
    });

    it("clears suggestion and stops loading on API error", async () => {
      vi.mocked(inboxApi.suggestCaptureRoute).mockRejectedValue(
        new Error("API error"),
      );

      const { result } = renderHook(() =>
        useCaptureRoute({
          text: "error text",
          project: null,
          workspaceView: undefined,
          enabled: true,
        }),
      );

      await waitFor(
        () => {
          expect(result.current.loading).toBe(false);
        },
        { timeout: 1000 },
      );

      expect(result.current.suggestion).toBeNull();
    });
  });

  describe("debounce behavior", () => {
    it("clears suggestion when text becomes empty", async () => {
      vi.mocked(inboxApi.suggestCaptureRoute).mockResolvedValue({
        route: "triage",
        confidence: 0.9,
        why: "test",
      });

      const { rerender, result } = renderHook(
        ({ text }) =>
          useCaptureRoute({
            text,
            project: null,
            workspaceView: undefined,
            enabled: true,
          }),
        {
          initialProps: { text: "has text" },
        },
      );

      await waitFor(
        () => {
          expect(result.current.suggestion).not.toBeNull();
        },
        { timeout: 1000 },
      );

      // Now empty the text
      rerender({ text: "" });
      expect(result.current.suggestion).toBeNull();
      expect(result.current.loading).toBe(false);
    });
  });

  describe("alternateRoute", () => {
    it("returns triage when preferred is task", async () => {
      vi.mocked(inboxApi.suggestCaptureRoute).mockResolvedValue({
        route: "task",
        confidence: 0.9,
        why: "test",
      });

      const { result } = renderHook(() =>
        useCaptureRoute({
          text: "text",
          project: null,
          workspaceView: undefined,
          enabled: true,
        }),
      );

      await waitFor(
        () => {
          expect(result.current.alternateRoute).toBe("triage");
        },
        { timeout: 1000 },
      );
    });

    it("returns task when preferred is triage", async () => {
      vi.mocked(inboxApi.suggestCaptureRoute).mockResolvedValue({
        route: "triage",
        confidence: 0.9,
        why: "test",
      });

      const { result } = renderHook(() =>
        useCaptureRoute({
          text: "text",
          project: null,
          workspaceView: undefined,
          enabled: true,
        }),
      );

      await waitFor(
        () => {
          expect(result.current.alternateRoute).toBe("task");
        },
        { timeout: 1000 },
      );
    });
  });
});
