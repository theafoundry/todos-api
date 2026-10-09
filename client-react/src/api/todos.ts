import { apiCall, buildUrl } from "./client";
import type { Todo, CreateTodoDto, UpdateTodoDto } from "../types";

import {
  MutationApiError as TodoApiError,
  ensureApiResponse,
  mutationRequest,
} from "./mutations";
import type { MutationOptions as TodoMutationOptions } from "./mutations";
export { MutationApiError as TodoApiError } from "./mutations";
export type { MutationOptions as TodoMutationOptions } from "./mutations";

const statuses = new Set([
  "inbox",
  "next",
  "in_progress",
  "waiting",
  "scheduled",
  "someday",
  "done",
  "cancelled",
]);
const stringFields = [
  "description",
  "notes",
  "completedAt",
  "projectId",
  "category",
  "headingId",
  "context",
  "dueDate",
  "startDate",
  "scheduledDate",
  "reviewDate",
  "doDate",
  "waitingOn",
  "firstStep",
  "emotionalState",
  "source",
];

export function isTodo(value: unknown): value is Todo {
  if (!value || typeof value !== "object") return false;
  const todo = value as Record<string, unknown>;
  return (
    typeof todo.id === "string" &&
    todo.id.length > 0 &&
    typeof todo.title === "string" &&
    typeof todo.status === "string" &&
    statuses.has(todo.status) &&
    typeof todo.completed === "boolean" &&
    typeof todo.archived === "boolean" &&
    typeof todo.userId === "string" &&
    typeof todo.createdAt === "string" &&
    typeof todo.updatedAt === "string" &&
    typeof todo.order === "number" &&
    Number.isFinite(todo.order) &&
    Array.isArray(todo.tags) &&
    todo.tags.every((tag) => typeof tag === "string") &&
    Array.isArray(todo.dependsOnTaskIds) &&
    todo.dependsOnTaskIds.every((id) => typeof id === "string") &&
    stringFields.every(
      (field) => todo[field] == null || typeof todo[field] === "string",
    ) &&
    (todo.estimateMinutes == null ||
      (typeof todo.estimateMinutes === "number" &&
        Number.isFinite(todo.estimateMinutes))) &&
    (todo.energy == null ||
      ["low", "medium", "high"].includes(String(todo.energy))) &&
    (todo.priority == null ||
      ["low", "medium", "high", "urgent"].includes(String(todo.priority)))
  );
}

async function readTodo(res: Response, expectedId?: string): Promise<Todo> {
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    // A successful request with an unreadable body may already have saved.
  }
  if (!isTodo(data) || (expectedId !== undefined && data.id !== expectedId)) {
    throw new TodoApiError(
      "The server did not confirm the saved task. Refresh to check it before trying again.",
      "uncertain",
      res.status,
    );
  }
  return data;
}

async function readTodos(res: Response, mutation = false): Promise<Todo[]> {
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    // Handled as an invalid response below.
  }
  if (!Array.isArray(data) || !data.every(isTodo)) {
    throw new TodoApiError(
      mutation
        ? "The server did not confirm the changed tasks. Refresh before trying again."
        : "Could not load tasks. The server returned an invalid task list.",
      mutation ? "uncertain" : "http",
      res.status,
    );
  }
  return data;
}

export async function fetchTodos(
  params: Record<string, string | undefined> = {},
): Promise<Todo[]> {
  let res: Response;
  try {
    res = await apiCall(buildUrl("/todos", params));
  } catch {
    throw new TodoApiError(
      "Could not load tasks. Check your connection and try again.",
      "network",
    );
  }
  await ensureApiResponse(res, "load tasks");
  return readTodos(res);
}

export async function createTodo(
  dto: CreateTodoDto,
  options: TodoMutationOptions = {},
): Promise<Todo> {
  const res = await mutationRequest(
    "/todos",
    { method: "POST", body: JSON.stringify(dto) },
    options,
    "add the task",
  );
  return readTodo(res);
}

export async function updateTodo(
  id: string,
  dto: UpdateTodoDto,
  options: TodoMutationOptions = {},
): Promise<Todo> {
  const res = await mutationRequest(
    `/todos/${encodeURIComponent(id)}`,
    { method: "PUT", body: JSON.stringify(dto) },
    options,
    "save the task",
  );
  return readTodo(res, id);
}

export async function deleteTodo(
  id: string,
  options: TodoMutationOptions = {},
): Promise<void> {
  const res = await mutationRequest(
    `/todos/${encodeURIComponent(id)}`,
    { method: "DELETE" },
    options,
    "delete the task",
  );
}

export async function reorderTodos(
  items: Array<{ id: string; order: number }>,
  options: TodoMutationOptions = {},
): Promise<Todo[]> {
  const res = await mutationRequest(
    "/todos/reorder",
    { method: "PUT", body: JSON.stringify(items) },
    options,
    "reorder tasks",
  );
  return readTodos(res, true);
}
