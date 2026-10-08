import { useState, useCallback, useRef } from "react";
import type { Todo, CreateTodoDto, UpdateTodoDto } from "../types";
import * as todosApi from "../api/todos";

export type LoadState = "idle" | "loading" | "loaded" | "error";

export function useTodosStore(options: todosApi.TodoMutationOptions = {}) {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const todosRef = useRef<Todo[]>([]);
  const loadSeqRef = useRef(0);
  const changeSeqRef = useRef(0);
  const taskVersionsRef = useRef(new Map<string, number>());
  const taskQueuesRef = useRef(new Map<string, Promise<void>>());
  const pendingTasksRef = useRef(new Map<string, number>());
  const offlineMode = options.offlineMode;

  const commitTodos = useCallback((update: (current: Todo[]) => Todo[]) => {
    const next = update(todosRef.current);
    todosRef.current = next;
    setTodos(next);
  }, []);

  // Reconciliation reads the committed store before React renders the next snapshot.
  const getTodos = useCallback((): readonly Todo[] => todosRef.current, []);
  const getTodo = useCallback(
    (id: string): Todo | undefined =>
      todosRef.current.find((todo) => todo.id === id),
    [],
  );

  const markTaskChanged = useCallback((id: string) => {
    taskVersionsRef.current.set(id, ++changeSeqRef.current);
  }, []);

  const runTaskMutation = useCallback(
    <T>(id: string, mutation: () => Promise<T>): Promise<T> => {
      markTaskChanged(id);
      pendingTasksRef.current.set(
        id,
        (pendingTasksRef.current.get(id) ?? 0) + 1,
      );
      const previous = taskQueuesRef.current.get(id) ?? Promise.resolve();
      const operation = previous.then(mutation).finally(() => {
        markTaskChanged(id);
        const remaining = (pendingTasksRef.current.get(id) ?? 1) - 1;
        if (remaining) pendingTasksRef.current.set(id, remaining);
        else pendingTasksRef.current.delete(id);
      });
      // A failed operation must not prevent the next intentional retry.
      const tail = operation.then(
        () => undefined,
        () => undefined,
      );
      taskQueuesRef.current.set(id, tail);
      void tail.then(() => {
        if (taskQueuesRef.current.get(id) === tail)
          taskQueuesRef.current.delete(id);
      });
      return operation;
    },
    [markTaskChanged],
  );

  const loadTodos = useCallback(
    async (
      params: Record<string, string | undefined> = {},
    ): Promise<boolean> => {
      const seq = ++loadSeqRef.current;
      const changeSeq = changeSeqRef.current;
      setLoadState("loading");
      setErrorMessage("");
      try {
        const data = await todosApi.fetchTodos(params);
        if (seq !== loadSeqRef.current) return false;
        // Keep locally confirmed/optimistic tasks changed while this GET was in flight.
        // Tombstones also prevent a stale GET from resurrecting a deleted task.
        commitTodos((current) => {
          const protectedIds = new Set(
            [...taskVersionsRef.current]
              .filter(
                ([id, version]) =>
                  version > changeSeq || pendingTasksRef.current.has(id),
              )
              .map(([id]) => id),
          );
          const currentById = new Map(current.map((todo) => [todo.id, todo]));
          const incomingIds = new Set(data.map((todo) => todo.id));
          return [
            ...current.filter(
              (todo) => protectedIds.has(todo.id) && !incomingIds.has(todo.id),
            ),
            ...data.flatMap((todo) => {
              const local = currentById.get(todo.id);
              if (!protectedIds.has(todo.id)) {
                // A cached/replica response must not replace a newer confirmed task.
                return [
                  local &&
                  Date.parse(local.updatedAt) > Date.parse(todo.updatedAt)
                    ? local
                    : todo,
                ];
              }
              return local ? [local] : [];
            }),
          ];
        });
        setLoadState("loaded");
        return true;
      } catch (err) {
        if (seq !== loadSeqRef.current) return false;
        setErrorMessage(
          err instanceof Error ? err.message : "Failed to load todos",
        );
        setLoadState("error");
        return false;
      }
    },
    [commitTodos],
  );

  const addTodo = useCallback(
    async (dto: CreateTodoDto) => {
      const created = await todosApi.createTodo(dto, { offlineMode });
      markTaskChanged(created.id);
      commitTodos((current) => [
        created,
        ...current.filter((todo) => todo.id !== created.id),
      ]);
      return created;
    },
    [commitTodos, markTaskChanged, offlineMode],
  );

  const toggleTodo = useCallback(
    (id: string, completed: boolean): Promise<Todo> =>
      runTaskMutation(id, async () => {
        const original = todosRef.current.find((todo) => todo.id === id);
        commitTodos((current) =>
          current.map((todo) =>
            todo.id === id ? { ...todo, completed } : todo,
          ),
        );
        try {
          const updated = await todosApi.updateTodo(
            id,
            { completed },
            { offlineMode },
          );
          commitTodos((current) =>
            current.map((todo) => (todo.id === id ? updated : todo)),
          );
          return updated;
        } catch (err) {
          if (original)
            commitTodos((current) =>
              current.map((todo) => (todo.id === id ? original : todo)),
            );
          throw err;
        }
      }),
    [commitTodos, offlineMode, runTaskMutation],
  );

  const editTodo = useCallback(
    (id: string, dto: UpdateTodoDto): Promise<Todo> =>
      runTaskMutation(id, async () => {
        const updated = await todosApi.updateTodo(id, dto, { offlineMode });
        commitTodos((current) =>
          current.map((todo) => (todo.id === id ? updated : todo)),
        );
        return updated;
      }),
    [commitTodos, offlineMode, runTaskMutation],
  );

  const removeTodo = useCallback(
    (id: string): Promise<void> =>
      runTaskMutation(id, async () => {
        const originalIndex = todosRef.current.findIndex(
          (todo) => todo.id === id,
        );
        const original = todosRef.current[originalIndex];
        commitTodos((current) => current.filter((todo) => todo.id !== id));
        try {
          await todosApi.deleteTodo(id, { offlineMode });
        } catch (err) {
          if (original)
            commitTodos((current) => {
              if (current.some((todo) => todo.id === id)) return current;
              const restored = [...current];
              restored.splice(
                Math.min(originalIndex, restored.length),
                0,
                original,
              );
              return restored;
            });
          throw err;
        }
      }),
    [commitTodos, offlineMode, runTaskMutation],
  );

  return {
    todos,
    getTodo,
    getTodos,
    loadState,
    errorMessage,
    loadTodos,
    addTodo,
    toggleTodo,
    editTodo,
    removeTodo,
  };
}
