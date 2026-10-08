import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TodoApiError } from "../../api/todos";
import { useTaskActions } from "./useTaskActions";

describe("task command feedback", () => {
  it("owns one pending command per task and waits for confirmation", async () => {
    let resolve!: () => void;
    const command = vi.fn(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    const { result } = renderHook(() => useTaskActions());
    let first!: Promise<boolean>;
    await act(async () => {
      first = result.current.run("t1", command, "Completed task");
      expect(await result.current.run("t1", command, "Completed task")).toBe(
        false,
      );
    });
    expect(command).toHaveBeenCalledTimes(1);
    expect(result.current.feedback?.kind).toBe("pending");
    expect(result.current.pendingIds.has("t1")).toBe(true);
    await act(async () => {
      resolve();
      expect(await first).toBe(true);
    });
    expect(result.current.feedback?.message).toBe("Completed task");
    expect(result.current.pendingIds.size).toBe(0);
  });

  it("offers one intentional Retry for a confirmed rejection", async () => {
    const command = vi
      .fn()
      .mockRejectedValueOnce(new TodoApiError("Invalid change", "http", 422))
      .mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useTaskActions());
    await act(async () => {
      expect(await result.current.run("t1", command, "Completed task")).toBe(
        false,
      );
    });
    expect(result.current.feedback?.action?.label).toBe("Retry");
    await act(async () => {
      result.current.feedback?.action?.run();
    });
    await waitFor(() =>
      expect(result.current.feedback?.message).toBe("Completed task"),
    );
    expect(command).toHaveBeenCalledTimes(2);
  });

  it("retains explicit recovery after a failed or rejected refresh and guards overlap", async () => {
    const command = vi
      .fn()
      .mockRejectedValue(new TodoApiError("Result uncertain", "uncertain"));
    let reject!: (error: Error) => void;
    const refresh = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<boolean>((_resolve, fail) => {
            reject = fail;
          }),
      )
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const { result } = renderHook(() => useTaskActions(refresh));
    await act(async () => {
      await result.current.run("t1", command, "Deleted task");
    });
    await act(async () => {
      result.current.feedback?.action?.run();
      result.current.feedback?.action?.run();
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    await act(async () => {
      reject(new Error("offline"));
    });
    expect(result.current.feedback?.kind).toBe("error");
    expect(result.current.feedback?.action?.label).toBe("Refresh");
    await act(async () => {
      result.current.feedback?.action?.run();
    });
    expect(result.current.feedback?.message).toContain("Could not refresh");
    await act(async () => {
      result.current.feedback?.action?.run();
    });
    expect(result.current.feedback?.message).toContain("Refreshed tasks");
    expect(command).toHaveBeenCalledTimes(1);
  });

  it("refreshes an uncertain outcome without repeating the mutation", async () => {
    const command = vi
      .fn()
      .mockRejectedValue(
        new TodoApiError("Result uncertain", "http", 500, true),
      );
    const refresh = vi.fn().mockResolvedValue(true);
    const { result } = renderHook(() => useTaskActions(refresh));
    await act(async () => {
      await result.current.run("t1", command, "Deleted task");
    });
    expect(result.current.feedback?.action?.label).toBe("Refresh");
    await act(async () => {
      result.current.feedback?.action?.run();
    });
    await waitFor(() =>
      expect(result.current.feedback?.message).toContain("Refreshed tasks"),
    );
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(command).toHaveBeenCalledTimes(1);
  });
});
