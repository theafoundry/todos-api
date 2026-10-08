import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { RefObject } from "react";
import { TodoApiError } from "../../api/todos";
import type {
  Priority,
  Project,
  Todo,
  TodoStatus,
  UpdateTodoDto,
} from "../../types";
import { FIELD_REGISTRY_BY_KEY } from "../../types/fieldLayout";
import {
  deadlineDateToIso,
  deadlineDateValue,
  localDateTimeToIso,
  localDateTimeValue,
  validateTaskDates,
} from "../utils/taskDates";
import { FieldPicker } from "./FieldPicker";
import { MobileModal } from "./MobileModal";
import "./task-editor.css";

interface TaskEditorProps {
  open: boolean;
  todo: Todo;
  projects: Project[];
  onSave: (id: string, dto: UpdateTodoDto) => Promise<unknown>;
  onReconcile?: () => Promise<boolean>;
  onCancel: () => void;
  onSaved?: () => void;
  closeRequestRef?: RefObject<(() => void) | null>;
}

interface TaskDraft {
  title: string;
  status: TodoStatus;
  projectId: string | null;
  scheduledDate: string;
  dueDate: string;
  priority: Priority | null;
  energy: Todo["energy"];
  estimateMinutes: string;
  description: string;
  notes: string;
  tags: string;
}

function draftFromTodo(todo: Todo): TaskDraft {
  return {
    title: todo.title,
    status: todo.status,
    projectId: todo.projectId ?? null,
    scheduledDate: localDateTimeValue(todo.scheduledDate ?? null),
    dueDate: deadlineDateValue(todo.dueDate ?? null),
    priority: todo.priority ?? null,
    energy: todo.energy ?? null,
    estimateMinutes:
      todo.estimateMinutes == null ? "" : String(todo.estimateMinutes),
    description: todo.description ?? "",
    notes: todo.notes ?? "",
    tags: todo.tags.join(", "),
  };
}

function registryOptions<T extends string>(key: string, current?: T | null) {
  return (FIELD_REGISTRY_BY_KEY[key].options ?? [])
    .filter(
      (option) =>
        option.value &&
        (!option.hiddenUnlessCurrent || option.value === current),
    )
    .map((option) => ({ key: option.value as T, label: option.label }));
}

export function TaskEditor({
  open,
  todo,
  projects,
  onSave,
  onReconcile,
  onCancel,
  onSaved,
  closeRequestRef,
}: TaskEditorProps) {
  const [baseline, setBaseline] = useState(() => draftFromTodo(todo));
  const [draft, setDraft] = useState(() => draftFromTodo(todo));
  const [moreOpen, setMoreOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [dueEndOfDay, setDueEndOfDay] = useState(false);
  const [pending, setPending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [needsReconciliation, setNeedsReconciliation] = useState(false);
  const [freshReady, setFreshReady] = useState(false);
  const [reconciled, setReconciled] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<
    Partial<Record<keyof TaskDraft, string>>
  >({});
  const initialTodoRef = useRef(todo);
  const sessionRef = useRef({ open, id: todo.id });
  const pendingRef = useRef(false);
  const needsReconciliationRef = useRef(false);
  const keepEditingRef = useRef<HTMLButtonElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const formId = `${id}-form`;
  const moreId = `${id}-more`;
  const dirty =
    JSON.stringify(draft) !== JSON.stringify(baseline) || dueEndOfDay;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  // Fresh data may refresh a pristine editor, but never replace a person's draft.
  useEffect(() => {
    const newSession =
      (open && !sessionRef.current.open) || todo.id !== sessionRef.current.id;
    if (freshReady && !newSession) {
      const latest = draftFromTodo(todo);
      const retained = { ...latest };
      for (const key of Object.keys(draft) as (keyof TaskDraft)[]) {
        if (draft[key] !== baseline[key]) {
          // Each key retains its own type; only user-edited fields override fresh data.
          Object.assign(retained, { [key]: draft[key] });
        }
      }
      const explicitDeadline =
        draft.dueDate !== baseline.dueDate || dueEndOfDay;
      const wantedDeadline = deadlineDateToIso(draft.dueDate);
      const savedDeadline = todo.dueDate ?? null;
      const deadlineDiffers =
        wantedDeadline === null || savedDeadline === null
          ? wantedDeadline !== savedDeadline
          : Date.parse(wantedDeadline) !== Date.parse(savedDeadline);
      initialTodoRef.current = todo;
      setBaseline(latest);
      setDraft(retained);
      setDueEndOfDay(explicitDeadline && deadlineDiffers);
      needsReconciliationRef.current = false;
      setNeedsReconciliation(false);
      setFreshReady(false);
      setReconciled(true);
      setSaveError(null);
      setValidationErrors({});
      pendingRef.current = false;
      setPending(false);
      setRefreshing(false);
    } else if (
      newSession ||
      (!dirtyRef.current &&
        !pendingRef.current &&
        !needsReconciliationRef.current)
    ) {
      const next = draftFromTodo(todo);
      initialTodoRef.current = todo;
      setBaseline(next);
      setDraft(next);
      setDueEndOfDay(false);
      if (newSession) {
        setValidationErrors({});
        setSaveError(null);
        setDiscardOpen(false);
        setMoreOpen(false);
        needsReconciliationRef.current = false;
        setNeedsReconciliation(false);
        setFreshReady(false);
        setReconciled(false);
      }
    }
    sessionRef.current = { open, id: todo.id };
  }, [todo, open, freshReady]);

  const requestClose = useCallback(() => {
    if (pendingRef.current) return;
    if (dirty) setDiscardOpen(true);
    else onCancel();
  }, [dirty, onCancel]);

  useEffect(() => {
    if (!closeRequestRef || !open) return;
    closeRequestRef.current = requestClose;
    return () => {
      closeRequestRef.current = null;
    };
  }, [closeRequestRef, open, requestClose]);

  useEffect(() => {
    if (discardOpen) keepEditingRef.current?.focus();
  }, [discardOpen]);

  useEffect(() => {
    if (saveError) errorRef.current?.focus();
  }, [saveError]);

  function update<K extends keyof TaskDraft>(key: K, value: TaskDraft[K]) {
    if (pendingRef.current) return;
    setDraft((current) => ({ ...current, [key]: value }));
    if (key === "dueDate") setDueEndOfDay(false);
    setValidationErrors((current) => ({ ...current, [key]: undefined }));
    if (!needsReconciliationRef.current) setSaveError(null);
    setDiscardOpen(false);
  }

  async function save() {
    if (pendingRef.current || needsReconciliationRef.current || !dirty) return;
    const errors: Partial<Record<keyof TaskDraft, string>> = {};
    const title = draft.title.trim();
    if (!title) errors.title = "Enter a task title.";
    else if (draft.title.length > 200)
      errors.title = "Use 200 characters or fewer.";
    const estimate =
      draft.estimateMinutes === "" ? null : Number(draft.estimateMinutes);
    if (
      estimate !== null &&
      (!Number.isSafeInteger(estimate) || estimate < 0)
    ) {
      errors.estimateMinutes =
        "Enter a whole number of minutes, zero or greater.";
    }
    const planned =
      draft.scheduledDate === baseline.scheduledDate
        ? (initialTodoRef.current.scheduledDate ?? null)
        : localDateTimeToIso(draft.scheduledDate);
    const due =
      draft.dueDate === baseline.dueDate && !dueEndOfDay
        ? (initialTodoRef.current.dueDate ?? null)
        : deadlineDateToIso(draft.dueDate);
    if (draft.scheduledDate && !planned)
      errors.scheduledDate = "Choose a valid local date and time.";
    if (draft.dueDate && !due) errors.dueDate = "Choose a valid deadline date.";
    const dateError = validateTaskDates(planned, due);
    if (dateError) errors.scheduledDate = dateError;
    if (draft.description.length > 1000)
      errors.description = "Use 1,000 characters or fewer.";
    if (draft.notes.length > 10000)
      errors.notes = "Use 10,000 characters or fewer.";
    const tags = [
      ...new Set(
        draft.tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
      ),
    ];
    if (tags.length > 25 || tags.some((tag) => tag.length > 50)) {
      errors.tags = "Use up to 25 tags, with 50 characters or fewer each.";
    }
    setValidationErrors(errors);
    if (Object.keys(errors).length) {
      if (
        errors.estimateMinutes ||
        errors.description ||
        errors.notes ||
        errors.tags
      )
        setMoreOpen(true);
      requestAnimationFrame(() => {
        const field = document.getElementById(
          `${id}-${Object.keys(errors)[0]}`,
        );
        field?.focus();
      });
      return;
    }

    const patch: UpdateTodoDto = {};
    if (draft.title !== baseline.title) patch.title = title;
    if (draft.status !== baseline.status) patch.status = draft.status;
    if (draft.projectId !== baseline.projectId)
      patch.projectId = draft.projectId;
    if (draft.scheduledDate !== baseline.scheduledDate)
      patch.scheduledDate = planned;
    if (draft.dueDate !== baseline.dueDate || dueEndOfDay) patch.dueDate = due;
    if (draft.priority !== baseline.priority) patch.priority = draft.priority;
    if (draft.energy !== baseline.energy) patch.energy = draft.energy ?? null;
    if (draft.estimateMinutes !== baseline.estimateMinutes)
      patch.estimateMinutes = estimate;
    if (draft.description !== baseline.description)
      patch.description = draft.description || null;
    if (draft.notes !== baseline.notes) patch.notes = draft.notes || null;
    if (draft.tags !== baseline.tags) patch.tags = tags;

    // A ref closes the gap before React renders the disabled Save button.
    pendingRef.current = true;
    setPending(true);
    setSaveError(null);
    try {
      await onSave(todo.id, patch);
      initialTodoRef.current = {
        ...initialTodoRef.current,
        scheduledDate: planned,
        dueDate: due,
      };
      setBaseline(draft);
      setDueEndOfDay(false);
      setReconciled(false);
      onSaved?.();
    } catch (error) {
      if (error instanceof TodoApiError && error.requiresReconciliation) {
        needsReconciliationRef.current = true;
        setNeedsReconciliation(true);
      }
      setSaveError(
        error instanceof Error
          ? error.message
          : "Could not save the task. Try again.",
      );
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  async function reconcile() {
    if (!onReconcile || pendingRef.current || !needsReconciliationRef.current)
      return;
    pendingRef.current = true;
    setPending(true);
    setRefreshing(true);
    let applied = false;
    try {
      if (await onReconcile()) {
        // The parent has applied a fresh task snapshot. Rebase in the next render.
        applied = true;
        setFreshReady(true);
      } else {
        setSaveError(
          "Could not refresh this task. Your changes are still here. Reconnect and try Refresh again.",
        );
      }
    } catch (error) {
      setSaveError(
        error instanceof Error
          ? error.message
          : "Could not refresh this task. Try Refresh again.",
      );
    } finally {
      if (!applied) {
        pendingRef.current = false;
        setPending(false);
        setRefreshing(false);
      }
    }
  }

  function errorFor(key: keyof TaskDraft) {
    return validationErrors[key] ? (
      <span className="m-task-editor__field-error" id={`${id}-${key}-error`}>
        {validationErrors[key]}
      </span>
    ) : null;
  }

  function fieldA11y(key: keyof TaskDraft) {
    return {
      id: `${id}-${key}`,
      "aria-invalid": Boolean(validationErrors[key]),
      "aria-describedby": validationErrors[key]
        ? `${id}-${key}-error`
        : undefined,
    };
  }

  const savedDeadline = initialTodoRef.current.dueDate;
  const selectedDayEnd = deadlineDateToIso(draft.dueDate);
  const deadlineCanExtend =
    savedDeadline &&
    selectedDayEnd &&
    new Date(savedDeadline).getTime() !== new Date(selectedDayEnd).getTime();

  return (
    <MobileModal
      open={open}
      title="Edit task"
      onClose={requestClose}
      fullHeight
      dismissDisabled={pending}
      footer={
        <div className="m-task-editor__footer">
          <span role="status" className="m-task-editor__save-state">
            {pending
              ? refreshing
                ? "Refreshing task…"
                : "Saving changes…"
              : needsReconciliation
                ? "Refresh before trying again"
                : dirty
                  ? reconciled
                    ? "Refreshed task. Unsaved changes"
                    : "Unsaved changes"
                  : reconciled
                    ? "Your changes match the refreshed task."
                    : "No unsaved changes"}
          </span>
          <div className="m-task-editor__footer-buttons">
            <button
              type="button"
              className="m-task-editor__button"
              onClick={requestClose}
              disabled={pending}
            >
              Cancel
            </button>
            <button
              type="submit"
              form={formId}
              className="m-task-editor__button m-task-editor__button--primary"
              disabled={pending || needsReconciliation || !dirty}
            >
              {pending
                ? refreshing
                  ? "Refreshing…"
                  : "Saving…"
                : (saveError || reconciled) && !needsReconciliation && dirty
                  ? "Retry"
                  : "Save"}
            </button>
          </div>
        </div>
      }
    >
      <form
        id={formId}
        className="m-task-editor"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
        aria-busy={pending}
      >
        {discardOpen && (
          <div className="m-task-editor__notice" role="alert">
            <p>Discard your unsaved changes?</p>
            <div className="m-task-editor__notice-buttons">
              <button
                type="button"
                className="m-task-editor__button"
                ref={keepEditingRef}
                onClick={() => setDiscardOpen(false)}
              >
                Keep editing
              </button>
              <button
                type="button"
                className="m-task-editor__button"
                onClick={onCancel}
              >
                Discard changes
              </button>
            </div>
          </div>
        )}
        {saveError && (
          <div
            role="alert"
            className="m-task-editor__notice m-task-editor__notice--error"
            ref={errorRef}
            tabIndex={-1}
          >
            <p>{saveError}</p>
            {needsReconciliation ? (
              <>
                <p>
                  Your changes are still here. Refresh this task before trying
                  to save again.
                </p>
                {onReconcile ? (
                  <button
                    type="button"
                    className="m-task-editor__button"
                    disabled={pending}
                    onClick={() => void reconcile()}
                  >
                    {refreshing ? "Refreshing task…" : "Refresh"}
                  </button>
                ) : (
                  <p>
                    Reconnect and refresh the task list to check whether the
                    change was saved.
                  </p>
                )}
              </>
            ) : (
              <p>Your changes are still here. Review them and Retry.</p>
            )}
          </div>
        )}
        <fieldset className="m-task-editor__fields" disabled={pending}>
          <div className="m-task-editor__field">
            <label htmlFor={`${id}-title`}>Task title</label>
            <input
              {...fieldA11y("title")}
              data-autofocus
              value={draft.title}
              onChange={(event) => update("title", event.target.value)}
              required
              maxLength={200}
            />
            {errorFor("title")}
          </div>
          <FieldPicker<TodoStatus>
            label="Status"
            value={draft.status}
            options={registryOptions<TodoStatus>("status", draft.status)}
            onChange={(value) => {
              if (value) update("status", value);
            }}
            disabled={pending}
          />
          <FieldPicker<string>
            label="Project"
            value={draft.projectId}
            options={projects.map((project) => ({
              key: project.id,
              label: project.name,
            }))}
            onChange={(value) => update("projectId", value)}
            allowClear
            disabled={pending}
          />
          <div className="m-task-editor__field">
            <label htmlFor={`${id}-scheduledDate`}>Plan for</label>
            <input
              {...fieldA11y("scheduledDate")}
              type="datetime-local"
              value={draft.scheduledDate}
              onChange={(event) => update("scheduledDate", event.target.value)}
            />
            {errorFor("scheduledDate")}
          </div>
          <p className="m-task-editor__hint">
            Plan for uses your device time zone ({timezone}).
          </p>
          <div className="m-task-editor__field">
            <label htmlFor={`${id}-dueDate`}>Due by</label>
            <input
              {...fieldA11y("dueDate")}
              type="date"
              value={draft.dueDate}
              onChange={(event) => update("dueDate", event.target.value)}
            />
            {errorFor("dueDate")}
          </div>
          {deadlineCanExtend && (
            <p className="m-task-editor__hint">
              Current saved deadline:{" "}
              {new Date(savedDeadline).toLocaleString(undefined, {
                dateStyle: "medium",
                timeStyle: "short",
              })}{" "}
              ({timezone}).
            </p>
          )}
          {deadlineCanExtend &&
            draft.dueDate === baseline.dueDate &&
            !dueEndOfDay && (
              <button
                type="button"
                className="m-task-editor__button"
                onClick={() => {
                  setDueEndOfDay(true);
                  if (!needsReconciliationRef.current) setSaveError(null);
                  setValidationErrors((current) => ({
                    ...current,
                    scheduledDate: undefined,
                    dueDate: undefined,
                  }));
                  setDiscardOpen(false);
                }}
              >
                Use end of this day
              </button>
            )}
          {dueEndOfDay && (
            <p className="m-task-editor__hint">
              Save will set Due by to the end of {draft.dueDate} ({timezone}).
            </p>
          )}
          <p className="m-task-editor__hint">
            Changing Due by sets the deadline to the end of that day in your
            device time zone.
          </p>
          <button
            type="button"
            className="m-task-editor__disclosure"
            aria-expanded={moreOpen}
            aria-controls={moreId}
            onClick={() => setMoreOpen((value) => !value)}
          >
            More details <span aria-hidden="true">{moreOpen ? "−" : "+"}</span>
          </button>
          {moreOpen && (
            <div id={moreId} className="m-task-editor__more">
              <FieldPicker<Priority>
                label="Priority"
                value={draft.priority}
                options={registryOptions<Priority>("priority")}
                onChange={(value) => update("priority", value)}
                allowClear
                disabled={pending}
              />
              <FieldPicker<"low" | "medium" | "high">
                label="Energy"
                value={draft.energy ?? null}
                options={registryOptions<"low" | "medium" | "high">("energy")}
                onChange={(value) => update("energy", value)}
                allowClear
                disabled={pending}
              />
              <div className="m-task-editor__field">
                <label htmlFor={`${id}-estimateMinutes`}>
                  Estimate (minutes)
                </label>
                <input
                  {...fieldA11y("estimateMinutes")}
                  type="number"
                  inputMode="numeric"
                  min="0"
                  step="1"
                  value={draft.estimateMinutes}
                  onChange={(event) =>
                    update("estimateMinutes", event.target.value)
                  }
                />
                {errorFor("estimateMinutes")}
              </div>
              <div className="m-task-editor__field">
                <label htmlFor={`${id}-description`}>Description</label>
                <textarea
                  {...fieldA11y("description")}
                  rows={3}
                  maxLength={1000}
                  value={draft.description}
                  onChange={(event) =>
                    update("description", event.target.value)
                  }
                />
                {errorFor("description")}
              </div>
              <div className="m-task-editor__field">
                <label htmlFor={`${id}-notes`}>Notes</label>
                <textarea
                  {...fieldA11y("notes")}
                  rows={4}
                  maxLength={10000}
                  value={draft.notes}
                  onChange={(event) => update("notes", event.target.value)}
                />
                {errorFor("notes")}
              </div>
              <div className="m-task-editor__field">
                <label htmlFor={`${id}-tags`}>Tags</label>
                <input
                  {...fieldA11y("tags")}
                  value={draft.tags}
                  onChange={(event) => update("tags", event.target.value)}
                  placeholder="Separate tags with commas"
                />
                {errorFor("tags")}
              </div>
            </div>
          )}
        </fieldset>
      </form>
    </MobileModal>
  );
}
