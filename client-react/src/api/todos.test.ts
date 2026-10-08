import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useTodosStore } from "../store/useTodosStore";
import { apiCall } from "./client";
import {
  createTodo,
  deleteTodo,
  fetchTodos,
  reorderTodos,
  TodoApiError,
  updateTodo,
} from "./todos";

vi.mock("./client", () => ({
  apiCall: vi.fn(),
  buildUrl: (path: string) => path,
}));

const todo = {
  id: "task-1",
  title: "Read paper",
  status: "next",
  completed: false,
  tags: [],
  dependsOnTaskIds: [],
  order: 0,
  archived: false,
  userId: "user-1",
  createdAt: "2026-10-08T12:00:00.000Z",
  updatedAt: "2026-10-08T12:00:00.000Z",
};
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.restoreAllMocks());

describe("task mutation responses", () => {
  it("keeps real store records intact when an old worker acknowledges a queued capture", async () => {
    vi.mocked(apiCall)
      .mockResolvedValueOnce(response([todo]))
      .mockResolvedValueOnce(response({ queued: true }, 202));
    const { result } = renderHook(() =>
      useTodosStore({ offlineMode: "manual" }),
    );
    await act(async () => {
      await result.current.loadTodos();
    });
    await act(async () => {
      await expect(
        result.current.addTodo({ title: "New capture" }),
      ).rejects.toMatchObject({ code: "uncertain" });
    });
    expect(result.current.todos).toEqual([todo]);
  });

  it("returns the confirmed task for capture and editing", async () => {
    vi.mocked(apiCall).mockResolvedValueOnce(response(todo, 201));
    await expect(createTodo({ title: todo.title })).resolves.toEqual(todo);
    vi.mocked(apiCall).mockResolvedValueOnce(
      response({ ...todo, completed: true, status: "done" }),
    );
    await expect(
      updateTodo(todo.id, { completed: true }),
    ).resolves.toMatchObject({ completed: true, status: "done" });
  });

  it.each([
    ["create", () => createTodo({ title: todo.title })],
    ["update", () => updateTodo(todo.id, { completed: true })],
    ["delete", () => deleteTodo(todo.id)],
    ["reorder", () => reorderTodos([{ id: todo.id, order: 1 }])],
  ] as const)(
    "rejects legacy worker queued202 acknowledgement for %s",
    async (_name, mutate) => {
      vi.mocked(apiCall).mockResolvedValue(response({ queued: true }, 202));
      await expect(mutate()).rejects.toMatchObject({
        name: "TodoApiError",
        code: "uncertain",
        status: 202,
        requiresReconciliation: true,
        message: expect.stringMatching(/refresh.*before trying again/i),
      });
    },
  );

  it.each([
    { queued: true },
    { ...todo, status: undefined },
    { ...todo, tags: [42] },
    { ...todo, title: null },
  ])(
    "rejects malformed successful task data instead of admitting it to the store",
    async (body) => {
      vi.mocked(apiCall).mockResolvedValue(response(body));
      await expect(createTodo({ title: todo.title })).rejects.toMatchObject({
        code: "uncertain",
      });
    },
  );

  it("rejects a task response for a different id", async () => {
    vi.mocked(apiCall).mockResolvedValue(
      response({ ...todo, id: "different-task" }),
    );
    await expect(
      updateTodo(todo.id, { title: "Edited" }),
    ).rejects.toMatchObject({ code: "uncertain" });
  });

  it("marks an unreadable successful mutation response as uncertain", async () => {
    vi.mocked(apiCall).mockResolvedValue(
      new Response("<html>proxy</html>", { status: 200 }),
    );
    await expect(createTodo({ title: todo.title })).rejects.toMatchObject({
      code: "uncertain",
    });
  });

  it("exposes useful server validation errors with typed status", async () => {
    vi.mocked(apiCall).mockResolvedValue(
      response({ error: "Scheduled date must be a valid date" }, 400),
    );
    await expect(
      updateTodo(todo.id, { scheduledDate: "bad-date" }),
    ).rejects.toMatchObject({
      code: "http",
      status: 400,
      message: "Scheduled date must be a valid date",
      requiresReconciliation: false,
    });
  });

  it("gives a session fallback when an error body is not JSON", async () => {
    vi.mocked(apiCall).mockResolvedValue(
      new Response("Unauthorized", { status: 401 }),
    );
    await expect(
      updateTodo(todo.id, { completed: true }),
    ).rejects.toMatchObject({
      code: "http",
      message: expect.stringMatching(/sign in/i),
    });
  });

  it("accepts authoritative deletion without requiring a body", async () => {
    vi.mocked(apiCall).mockResolvedValue(new Response(null, { status: 204 }));
    await expect(deleteTodo(todo.id)).resolves.toBeUndefined();
  });
});

describe("bounded manual offline retry", () => {
  it.each([
    [
      "POST",
      () => createTodo({ title: todo.title }, { offlineMode: "manual" }),
    ],
    [
      "PUT",
      () => updateTodo(todo.id, { title: "Edited" }, { offlineMode: "manual" }),
    ],
    ["DELETE", () => deleteTodo(todo.id, { offlineMode: "manual" })],
  ] as const)("sends the worker opt-out on %s", async (method, mutate) => {
    vi.mocked(apiCall).mockResolvedValue(response(todo));
    await mutate();
    expect(apiCall).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        method,
        headers: { "X-Planwren-Offline-Mode": "manual" },
      }),
    );
  });

  it("preserves the desktop default without the opt-out header", async () => {
    vi.mocked(apiCall).mockResolvedValue(response(todo));
    await createTodo({ title: todo.title });
    expect(apiCall).toHaveBeenCalledWith(
      "/todos",
      expect.not.objectContaining({ headers: expect.anything() }),
    );
  });

  it("refuses a known offline write before it reaches an older worker", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    await expect(
      createTodo({ title: todo.title }, { offlineMode: "manual" }),
    ).rejects.toMatchObject({
      code: "network",
      requiresReconciliation: false,
    });
    expect(apiCall).not.toHaveBeenCalled();
  });

  it("requires reconciliation when a sent request loses its response", async () => {
    vi.mocked(apiCall).mockRejectedValue(new TypeError("Failed to fetch"));
    const error = await createTodo(
      { title: todo.title },
      { offlineMode: "manual" },
    ).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(TodoApiError);
    expect(error).toMatchObject({
      code: "uncertain",
      requiresReconciliation: true,
      message: expect.stringMatching(/refresh/),
    });
  });
});

describe("task list responses", () => {
  it("accepts an empty list and validates loaded task records", async () => {
    vi.mocked(apiCall)
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response([todo]));
    await expect(fetchTodos()).resolves.toEqual([]);
    await expect(fetchTodos()).resolves.toEqual([todo]);
  });

  it.each([{ queued: true }, [{ queued: true }]])(
    "rejects invalid loaded task lists",
    async (body) => {
      vi.mocked(apiCall).mockResolvedValue(response(body));
      await expect(fetchTodos()).rejects.toMatchObject({
        code: "http",
        message: expect.stringMatching(/invalid task list/),
      });
    },
  );

  it("returns a useful connection error for a failed GET", async () => {
    vi.mocked(apiCall).mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(fetchTodos()).rejects.toMatchObject({
      code: "network",
      requiresReconciliation: false,
    });
  });
});
