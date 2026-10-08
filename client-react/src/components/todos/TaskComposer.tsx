import { useState, useEffect, useRef, useCallback } from "react";
import type { CreateTodoDto, TodoStatus, Priority, Project } from "../../types";
import { AiOnCreateAssist } from "../ai/AiOnCreateAssist";
import { useCaptureRoute } from "../../hooks/useCaptureRoute";

interface Props {
  isOpen: boolean;
  projects: Project[];
  defaultProjectId?: string | null;
  workspaceView?: string;
  onSubmitTask: (dto: CreateTodoDto) => Promise<unknown>;
  onCaptureToDesk: (text: string) => Promise<unknown>;
  onClose: () => void;
}

const STATUS_OPTIONS: TodoStatus[] = [
  "inbox",
  "next",
  "in_progress",
  "waiting",
  "scheduled",
  "someday",
];
const PRIORITY_OPTIONS: (Priority | "")[] = [
  "",
  "low",
  "medium",
  "high",
  "urgent",
];

export function TaskComposer({
  isOpen,
  projects,
  defaultProjectId,
  workspaceView,
  onSubmitTask,
  onCaptureToDesk,
  onClose,
}: Props) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<TodoStatus>("inbox");
  const [priority, setPriority] = useState<string>("");
  const [projectId, setProjectId] = useState(defaultProjectId || "");
  const [dueDate, setDueDate] = useState("");
  const [tags, setTags] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const submitRef = useRef(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const { suggestion, loading, preferredRoute, alternateRoute } =
    useCaptureRoute({
      text: title,
      project: projectId,
      workspaceView,
      enabled: isOpen,
    });

  useEffect(() => {
    if (isOpen) {
      setTitle("");
      setDescription("");
      setStatus("inbox");
      setPriority("");
      setProjectId(defaultProjectId || "");
      setDueDate("");
      setTags("");
      setError("");
      requestAnimationFrame(() => titleRef.current?.focus());
    }
  }, [isOpen, defaultProjectId]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitRef.current) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  const handleSubmit = async (route: "task" | "triage") => {
    const trimmed = title.trim();
    if (!trimmed || submitRef.current) return;
    submitRef.current = true;
    setSubmitting(true);
    setError("");
    try {
      if (route === "triage") {
        await onCaptureToDesk(trimmed);
        onClose();
        return;
      }
      const dto: CreateTodoDto = {
        title: suggestion?.cleanedTitle?.trim() || trimmed,
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(status !== "inbox" ? { status } : {}),
        ...(priority ? { priority: priority as Priority } : {}),
        ...(projectId ? { projectId } : {}),
        ...(dueDate || suggestion?.extractedFields?.dueDate
          ? {
              dueDate:
                dueDate || suggestion?.extractedFields?.dueDate || undefined,
            }
          : {}),
        ...(tags.trim()
          ? {
              tags: tags
                .split(",")
                .map((t) => t.trim())
                .filter(Boolean),
            }
          : {}),
      };
      await onSubmitTask(dto);
      onClose();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not save this item. Your draft is ready to retry.",
      );
    } finally {
      submitRef.current = false;
      setSubmitting(false);
    }
  };

  const routeHint = !title.trim()
    ? ""
    : loading
      ? "Reviewing capture…"
      : suggestion?.why
        ? `Suggested: ${preferredRoute === "task" ? "Create task now" : "Save to Inbox"}. ${suggestion.why}`
        : "";

  if (!isOpen) return null;

  return (
    <div
      className="composer-overlay"
      onClick={() => {
        if (!submitRef.current) onClose();
      }}
    >
      <div
        className="composer"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="New task"
      >
        <div className="composer__header">
          <h3 className="composer__title">New Task</h3>
          <button
            className="todo-drawer__close"
            disabled={submitting}
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        <div className="composer__body">
          <input
            ref={titleRef}
            className="composer__input composer__input--title"
            type="text"
            placeholder="Task title"
            value={title}
            disabled={submitting}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(preferredRoute);
              }
            }}
          />
          <textarea
            className="composer__textarea"
            placeholder="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
          />

          <div className="composer__row">
            <div className="composer__field">
              <label className="todo-drawer__label">Status</label>
              <select
                id="todoStatusSelect"
                className="todo-drawer__select"
                value={status}
                onChange={(e) => setStatus(e.target.value as TodoStatus)}
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s.replace("_", " ")}
                  </option>
                ))}
              </select>
            </div>
            <div className="composer__field">
              <label className="todo-drawer__label">Priority</label>
              <select
                id="todoPrioritySelect"
                className="todo-drawer__select"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
              >
                {PRIORITY_OPTIONS.map((p) => (
                  <option key={p} value={p}>
                    {p || "None"}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="composer__row">
            <div className="composer__field">
              <label className="todo-drawer__label">Project</label>
              <select
                id="todoProjectSelect"
                className="todo-drawer__select"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
              >
                <option value="">None</option>
                {projects
                  .filter((p) => !p.archived)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </div>
            <div className="composer__field">
              <label className="todo-drawer__label">Due date</label>
              <input
                id="todoDueDateInput"
                className="todo-drawer__input"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </div>

          <div className="composer__field">
            <label className="todo-drawer__label">Tags (comma-separated)</label>
            <input
              id="todoTagsInput"
              className="todo-drawer__input"
              type="text"
              placeholder="e.g. work, important"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
            />
          </div>

          <AiOnCreateAssist
            title={title}
            onApplySuggestion={(field, value) => {
              if (field === "priority") setPriority(value);
              else if (field === "status") setStatus(value as TodoStatus);
              else if (field === "projectId") setProjectId(value);
              else if (field === "dueDate") setDueDate(value);
            }}
          />
          {routeHint && <p className="capture-route-hint">{routeHint}</p>}
          {error && (
            <p role="alert" className="inbox-review__error">
              {error}
            </p>
          )}
        </div>
        <div className="composer__footer">
          <button className="btn" disabled={submitting} onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn"
            onClick={() => handleSubmit(alternateRoute)}
            disabled={!title.trim() || submitting}
          >
            {alternateRoute === "task" ? "Create task now" : "Save to Inbox"}
          </button>
          <button
            className="btn"
            style={{
              background: "var(--accent)",
              color: "#fff",
              borderColor: "var(--accent)",
            }}
            onClick={() => handleSubmit(preferredRoute)}
            disabled={!title.trim() || submitting}
          >
            {submitting
              ? "Saving…"
              : preferredRoute === "task"
                ? "Create task now"
                : "Save to Inbox"}
          </button>
        </div>
      </div>
    </div>
  );
}
