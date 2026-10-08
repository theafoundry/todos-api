import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import * as todosApi from "../api/todos";
import { useTodosStore, type LoadState } from "./useTodosStore";
import type { Todo, CreateTodoDto, UpdateTodoDto } from "../types";

vi.mock("../api/todos");

const makeTodo = (overrides: Partial<Todo> = {}): Todo => ({
  id: overrides.id ?? "todo-1",
  title: overrides.title ?? "Test task",
  description: overrides.description ?? null,
  notes: overrides.notes ?? null,
  status: overrides.status ?? "next",
  completed: overrides.completed ?? false,
  completedAt: overrides.completedAt ?? null,
  projectId: overrides.projectId ?? null,
  category: overrides.category ?? null,
  headingId: overrides.headingId ?? null,
  tags: overrides.tags ?? [],
  context: overrides.context ?? null,
  energy: overrides.energy ?? null,
  dueDate: overrides.dueDate ?? null,
  startDate: overrides.startDate ?? null,
  scheduledDate: overrides.scheduledDate ?? null,
  reviewDate: overrides.reviewDate ?? null,
  doDate: overrides.doDate ?? null,
  estimateMinutes: overrides.estimateMinutes ?? null,
  waitingOn: overrides.waitingOn ?? null,
  dependsOnTaskIds: overrides.dependsOnTaskIds ?? [],
  order: overrides.order ?? 0,
  priority: overrides.priority ?? null,
  archived: overrides.archived ?? false,
  firstStep: overrides.firstStep ?? null,
  emotionalState: overrides.emotionalState ?? null,
  effortScore: overrides.effortScore ?? null,
  source: overrides.source ?? null,
  recurrence: overrides.recurrence ?? null,
  subtasks: overrides.subtasks ?? undefined,
  userId: overrides.userId ?? "user-1",
  createdAt: overrides.createdAt ?? "2026-01-01T00:00:00.000Z",
  updatedAt: overrides.updatedAt ?? "2026-01-01T00:00:00.000Z",
});

describe("useTodosStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("initial state", () => {
    it("starts with empty todos and idle load state", () => {
      const { result } = renderHook(() => useTodosStore());
      expect(result.current.todos).toEqual([]);
      expect(result.current.loadState).toBe("idle");
      expect(result.current.errorMessage).toBe("");
    });
  });

  describe("loadTodos", () => {
    it("loads todos successfully", async () => {
      const todos = [makeTodo({ id: "1" }), makeTodo({ id: "2" })];
      vi.mocked(todosApi.fetchTodos).mockResolvedValue(todos);

      const { result } = renderHook(() => useTodosStore());

      await act(async () => {
        await result.current.loadTodos({ projectId: "proj-1" });
        // The recovery callback runs before React commits its next render.
        expect(result.current.getTodos()).toEqual(todos);
      });

      expect(todosApi.fetchTodos).toHaveBeenCalledWith({ projectId: "proj-1" });
      expect(result.current.todos).toEqual(todos);
      expect(result.current.loadState).toBe("loaded");
    });

    it("sets error state on failure", async () => {
      vi.mocked(todosApi.fetchTodos).mockRejectedValue(
        new Error("Network error"),
      );

      const { result } = renderHook(() => useTodosStore());

      await act(async () => {
        await result.current.loadTodos();
      });

      expect(result.current.loadState).toBe("error");
      expect(result.current.errorMessage).toBe("Network error");
    });

    it("sets generic error message for non-Error rejections", async () => {
      vi.mocked(todosApi.fetchTodos).mockRejectedValue("string error");

      const { result } = renderHook(() => useTodosStore());

      await act(async () => {
        await result.current.loadTodos();
      });

      expect(result.current.errorMessage).toBe("Failed to load todos");
    });

    it("handles rapid successive loads gracefully", async () => {
      const first = [makeTodo({ id: "first" })];
      const second = [makeTodo({ id: "second" })];
      vi.mocked(todosApi.fetchTodos)
        .mockResolvedValueOnce(first)
        .mockResolvedValueOnce(second);

      const { result } = renderHook(() => useTodosStore());

      await act(async () => {
        await result.current.loadTodos();
      });
      await act(async () => {
        await result.current.loadTodos();
      });

      // Both loads complete; the second one should have the latest data
      expect(result.current.todos).toEqual(second);
    });
  });

  describe("addTodo", () => {
    it("returns created todo and prepends it via the API", async () => {
      const created = makeTodo({ id: "new-1", title: "New task" });
      vi.mocked(todosApi.createTodo).mockResolvedValue(created);

      const { result } = renderHook(() => useTodosStore());

      let added: Todo | undefined;
      await act(async () => {
        added = await result.current.addTodo({
          title: "New task",
        } as CreateTodoDto);
      });

      expect(todosApi.createTodo).toHaveBeenCalledWith(
        { title: "New task" },
        { offlineMode: undefined },
      );
      expect(added).toEqual(created);
      // The store prepends via setTodos updater, so the created todo should be in the list
      expect(result.current.todos.length).toBe(1);
      expect(result.current.todos[0].id).toBe("new-1");
    });
  });

  describe("toggleTodo", () => {
    it("calls updateTodo API with completed flag", async () => {
      const original = makeTodo({ id: "t1", completed: false });
      const updated = makeTodo({ id: "t1", completed: true });
      vi.mocked(todosApi.fetchTodos).mockResolvedValue([original]);
      vi.mocked(todosApi.updateTodo).mockResolvedValue(updated);

      const { result } = renderHook(() => useTodosStore());

      // Pre-populate via loadTodos
      await act(async () => {
        await result.current.loadTodos();
      });
      expect(result.current.todos).toEqual([original]);

      await act(async () => {
        await result.current.toggleTodo("t1", true);
      });

      expect(todosApi.updateTodo).toHaveBeenCalledWith(
        "t1",
        { completed: true },
        { offlineMode: undefined },
      );
      expect(result.current.todos).toEqual([updated]);
    });

    it("reverts optimistically on server failure", async () => {
      const original = makeTodo({ id: "t1", completed: false });
      vi.mocked(todosApi.fetchTodos).mockResolvedValue([original]);
      vi.mocked(todosApi.updateTodo).mockRejectedValue(new Error("Fail"));

      const { result } = renderHook(() => useTodosStore());

      await act(async () => {
        await result.current.loadTodos();
      });

      await act(async () => {
        await expect(result.current.toggleTodo("t1", true)).rejects.toThrow(
          "Fail",
        );
      });

      // Should be reverted to original state
      expect(result.current.todos).toEqual([original]);
    });
  });

  describe("editTodo", () => {
    it("updates the todo and returns the server response", async () => {
      const original = makeTodo({ id: "t1", title: "Old title" });
      const updated = makeTodo({ id: "t1", title: "New title" });
      vi.mocked(todosApi.fetchTodos).mockResolvedValue([original]);
      vi.mocked(todosApi.updateTodo).mockResolvedValue(updated);

      const { result } = renderHook(() => useTodosStore());

      await act(async () => {
        await result.current.loadTodos();
      });

      let edited: Todo | undefined;
      await act(async () => {
        edited = await result.current.editTodo("t1", {
          title: "New title",
        } as UpdateTodoDto);
      });

      expect(todosApi.updateTodo).toHaveBeenCalledWith(
        "t1",
        { title: "New title" },
        { offlineMode: undefined },
      );
      expect(result.current.todos).toEqual([updated]);
      expect(edited).toEqual(updated);
    });
  });

  describe("removeTodo", () => {
    it("deletes the todo via API and removes from list", async () => {
      const t1 = makeTodo({ id: "t1" });
      const t2 = makeTodo({ id: "t2" });
      vi.mocked(todosApi.fetchTodos).mockResolvedValue([t1, t2]);
      vi.mocked(todosApi.deleteTodo).mockResolvedValue(undefined);

      const { result } = renderHook(() => useTodosStore());

      await act(async () => {
        await result.current.loadTodos();
      });

      await act(async () => {
        await result.current.removeTodo("t1");
      });

      expect(todosApi.deleteTodo).toHaveBeenCalledWith("t1", {
        offlineMode: undefined,
      });
      expect(result.current.todos).toEqual([t2]);
    });

    it("restores the todo on server failure", async () => {
      const t1 = makeTodo({ id: "t1" });
      const t2 = makeTodo({ id: "t2" });
      vi.mocked(todosApi.fetchTodos).mockResolvedValue([t1, t2]);
      vi.mocked(todosApi.deleteTodo).mockRejectedValue(new Error("Fail"));

      const { result } = renderHook(() => useTodosStore());

      await act(async () => {
        await result.current.loadTodos();
      });

      await act(async () => {
        await expect(result.current.removeTodo("t1")).rejects.toThrow("Fail");
      });

      expect(result.current.todos).toEqual([t1, t2]);
    });
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function loadedStore(todos = [makeTodo()]) {
  vi.mocked(todosApi.fetchTodos).mockResolvedValue(todos);
  const hook = renderHook(() => useTodosStore({ offlineMode: "manual" }));
  await act(async () => {
    await hook.result.current.loadTodos();
  });
  return hook;
}

describe("task mutation and refresh ordering", () => {
  beforeEach(() => vi.resetAllMocks());

  it("serializes PUTs for the same task and returns each authoritative result", async () => {
    const { result } = await loadedStore();
    const firstResponse = deferred<Todo>();
    const firstTodo = makeTodo({ title: "First edit" });
    const secondTodo = makeTodo({ title: "Second edit" });
    vi.mocked(todosApi.updateTodo)
      .mockReturnValueOnce(firstResponse.promise)
      .mockResolvedValueOnce(secondTodo);
    let first!: Promise<Todo>;
    let second!: Promise<Todo>;
    await act(async () => {
      first = result.current.editTodo("todo-1", { title: "First edit" });
      second = result.current.editTodo("todo-1", { title: "Second edit" });
      await Promise.resolve();
    });
    expect(todosApi.updateTodo).toHaveBeenCalledTimes(1);
    await act(async () => {
      firstResponse.resolve(firstTodo);
      expect(await first).toEqual(firstTodo);
      expect(await second).toEqual(secondTodo);
    });
    expect(todosApi.updateTodo).toHaveBeenNthCalledWith(
      2,
      "todo-1",
      { title: "Second edit" },
      { offlineMode: "manual" },
    );
    expect(result.current.todos).toEqual([secondTodo]);
  });

  it("releases the next intentional edit after a failed PUT", async () => {
    const { result } = await loadedStore();
    const firstResponse = deferred<Todo>();
    const saved = makeTodo({ title: "Retry saved" });
    vi.mocked(todosApi.updateTodo)
      .mockReturnValueOnce(firstResponse.promise)
      .mockResolvedValueOnce(saved);
    let first!: Promise<Todo>;
    let retry!: Promise<Todo>;
    await act(async () => {
      first = result.current.editTodo("todo-1", { title: "Failed" });
      void first.catch(() => undefined);
      retry = result.current.editTodo("todo-1", { title: "Retry saved" });
      await Promise.resolve();
    });
    expect(todosApi.updateTodo).toHaveBeenCalledTimes(1);
    await act(async () => {
      firstResponse.reject(new Error("Server failed"));
      await expect(first).rejects.toThrow("Server failed");
      await expect(retry).resolves.toEqual(saved);
    });
    expect(result.current.todos).toEqual([saved]);
  });

  it("allows different task writes independently without overwriting each other", async () => {
    const { result } = await loadedStore([
      makeTodo({ id: "one" }),
      makeTodo({ id: "two" }),
    ]);
    const oneResponse = deferred<Todo>();
    const twoResponse = deferred<Todo>();
    const one = makeTodo({ id: "one", title: "One saved" });
    const two = makeTodo({ id: "two", title: "Two saved" });
    vi.mocked(todosApi.updateTodo).mockImplementation((id) =>
      id === "one" ? oneResponse.promise : twoResponse.promise,
    );
    let first!: Promise<Todo>;
    let second!: Promise<Todo>;
    await act(async () => {
      first = result.current.editTodo("one", { title: one.title });
      second = result.current.editTodo("two", { title: two.title });
      await Promise.resolve();
    });
    expect(todosApi.updateTodo).toHaveBeenCalledTimes(2);
    await act(async () => {
      twoResponse.resolve(two);
      await second;
    });
    await act(async () => {
      oneResponse.resolve(one);
      await first;
    });
    expect(result.current.todos).toEqual([one, two]);
  });

  it("merges unaffected fresh rows but preserves a PUT completed after a GET began", async () => {
    const original = makeTodo();
    const unchanged = makeTodo({ id: "other" });
    const { result } = await loadedStore([original, unchanged]);
    const getResponse = deferred<Todo[]>();
    const saved = makeTodo({ title: "Saved locally" });
    const otherFresh = makeTodo({ id: "other", title: "Changed elsewhere" });
    vi.mocked(todosApi.fetchTodos).mockReturnValueOnce(getResponse.promise);
    vi.mocked(todosApi.updateTodo).mockResolvedValue(saved);
    let refresh!: Promise<boolean>;
    act(() => {
      refresh = result.current.loadTodos();
    });
    await act(async () => {
      await result.current.editTodo(original.id, { title: saved.title });
    });
    await act(async () => {
      getResponse.resolve([original, otherFresh]);
      expect(await refresh).toBe(true);
    });
    expect(result.current.todos).toEqual([saved, otherFresh]);
  });

  it("does not let a GET undo a pending optimistic completion", async () => {
    const original = makeTodo();
    const { result } = await loadedStore([original]);
    const putResponse = deferred<Todo>();
    const saved = makeTodo({ completed: true, status: "done" });
    vi.mocked(todosApi.updateTodo).mockReturnValueOnce(putResponse.promise);
    vi.mocked(todosApi.fetchTodos).mockResolvedValueOnce([original]);
    let completion!: Promise<Todo>;
    await act(async () => {
      completion = result.current.toggleTodo(original.id, true);
      await Promise.resolve();
    });
    expect(result.current.todos[0].completed).toBe(true);
    await act(async () => {
      await result.current.loadTodos();
    });
    expect(result.current.todos[0].completed).toBe(true);
    await act(async () => {
      putResponse.resolve(saved);
      await expect(completion).resolves.toEqual(saved);
    });
    expect(result.current.todos).toEqual([saved]);
  });

  it("returns false for an out-of-order GET and leaves the newer list applied", async () => {
    const { result } = await loadedStore();
    const older = deferred<Todo[]>();
    const newer = makeTodo({ title: "Newer list" });
    vi.mocked(todosApi.fetchTodos)
      .mockReturnValueOnce(older.promise)
      .mockResolvedValueOnce([newer]);
    let stale!: Promise<boolean>;
    act(() => {
      stale = result.current.loadTodos();
    });
    await act(async () => {
      expect(await result.current.loadTodos()).toBe(true);
    });
    await act(async () => {
      older.resolve([makeTodo()]);
      expect(await stale).toBe(false);
    });
    expect(result.current.todos).toEqual([newer]);
  });

  it("does not resurrect a task deleted while a stale GET was in flight", async () => {
    const original = makeTodo();
    const { result } = await loadedStore([original]);
    const staleGet = deferred<Todo[]>();
    vi.mocked(todosApi.fetchTodos).mockReturnValueOnce(staleGet.promise);
    vi.mocked(todosApi.deleteTodo).mockResolvedValueOnce(undefined);
    let refresh!: Promise<boolean>;
    act(() => {
      refresh = result.current.loadTodos();
    });
    await act(async () => {
      await result.current.removeTodo(original.id);
    });
    await act(async () => {
      staleGet.resolve([original]);
      await refresh;
    });
    expect(result.current.todos).toEqual([]);
  });

  it("restores only the failed deletion while preserving another edit and a capture", async () => {
    const original = makeTodo({ id: "deleted" });
    const other = makeTodo({ id: "other" });
    const { result } = await loadedStore([original, other]);
    const removal = deferred<void>();
    const savedOther = makeTodo({ id: "other", title: "Saved other task" });
    const created = makeTodo({ id: "new" });
    vi.mocked(todosApi.deleteTodo).mockReturnValueOnce(removal.promise);
    vi.mocked(todosApi.updateTodo).mockResolvedValueOnce(savedOther);
    vi.mocked(todosApi.createTodo).mockResolvedValueOnce(created);
    let deleting!: Promise<void>;
    await act(async () => {
      deleting = result.current.removeTodo(original.id);
      void deleting.catch(() => undefined);
      await Promise.resolve();
    });
    await act(async () => {
      await result.current.editTodo(other.id, { title: savedOther.title });
      await result.current.addTodo({ title: created.title });
    });
    await act(async () => {
      removal.reject(new Error("Deletion failed"));
      await expect(deleting).rejects.toThrow("Deletion failed");
    });
    expect(result.current.todos).toEqual(
      expect.arrayContaining([original, savedOther, created]),
    );
    expect(result.current.todos).toHaveLength(3);
  });

  it("rolls back to the exact prior completion state and exposes the failure", async () => {
    const original = makeTodo({
      completed: true,
      status: "done",
      completedAt: "2026-10-08T12:00:00.000Z",
    });
    const { result } = await loadedStore([original]);
    const failure = new Error("Complete failed");
    vi.mocked(todosApi.updateTodo).mockRejectedValueOnce(failure);
    await act(async () => {
      await expect(result.current.toggleTodo(original.id, true)).rejects.toBe(
        failure,
      );
    });
    expect(result.current.todos).toEqual([original]);
  });

  it("keeps the previous list and returns false after a failed refresh", async () => {
    const original = makeTodo();
    const { result } = await loadedStore([original]);
    vi.mocked(todosApi.fetchTodos).mockRejectedValueOnce(
      new Error("Refresh failed"),
    );
    await act(async () => {
      expect(await result.current.loadTodos()).toBe(false);
    });
    expect(result.current.todos).toEqual([original]);
    expect(result.current.loadState).toBe("error");
    expect(result.current.errorMessage).toBe("Refresh failed");
  });

  it("does not duplicate a confirmed creation already seen by a refresh", async () => {
    const { result } = await loadedStore([]);
    const creating = deferred<Todo>();
    const created = makeTodo({ id: "new" });
    vi.mocked(todosApi.createTodo).mockReturnValueOnce(creating.promise);
    vi.mocked(todosApi.fetchTodos).mockResolvedValueOnce([created]);
    let capture!: Promise<Todo>;
    act(() => {
      capture = result.current.addTodo({ title: created.title });
    });
    await act(async () => {
      await result.current.loadTodos();
    });
    await act(async () => {
      creating.resolve(created);
      await capture;
    });
    expect(result.current.todos).toEqual([created]);
  });

  it("preserves a newer confirmed timestamp even if a later GET serves older data", async () => {
    const saved = makeTodo({
      title: "Saved",
      updatedAt: "2026-10-08T12:05:00.000Z",
    });
    const { result } = await loadedStore([saved]);
    vi.mocked(todosApi.fetchTodos).mockResolvedValueOnce([makeTodo()]);
    await act(async () => {
      await result.current.loadTodos();
    });
    expect(result.current.todos).toEqual([saved]);
  });
});

describe("synchronous reconciliation snapshots", () => {
  beforeEach(() => vi.resetAllMocks());

  it("keeps a stable getter that sees loaded and saved tasks before React publishes a render", async () => {
    const original = makeTodo();
    const saved = makeTodo({ title: "Authoritative save" });
    const { result } = renderHook(() => useTodosStore());
    const getTodo = result.current.getTodo;
    expect(getTodo(original.id)).toBeUndefined();
    vi.mocked(todosApi.fetchTodos).mockResolvedValueOnce([original]);
    await act(async () => {
      expect(await result.current.loadTodos()).toBe(true);
      expect(getTodo(original.id)).toEqual(original);
    });
    expect(result.current.getTodo).toBe(getTodo);
    vi.mocked(todosApi.updateTodo).mockResolvedValueOnce(saved);
    await act(async () => {
      await result.current.editTodo(original.id, { title: saved.title });
      expect(getTodo(original.id)).toEqual(saved);
    });
    expect(result.current.getTodo).toBe(getTodo);
    vi.mocked(todosApi.deleteTodo).mockResolvedValueOnce(undefined);
    await act(async () => {
      await result.current.removeTodo(original.id);
      expect(getTodo(original.id)).toBeUndefined();
    });
  });
});
