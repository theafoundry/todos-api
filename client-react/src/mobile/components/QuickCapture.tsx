import {
  useState,
  useEffect,
  useId,
  useCallback,
  useRef,
  type RefObject,
} from "react";
import type { CreateTodoDto, Project } from "../../types";
import { TodoApiError } from "../../api/todos";
import {
  deadlineDateToIso,
  localDateTimeToIso,
  validateTaskDates,
} from "../utils/taskDates";
import { MobileModal } from "./MobileModal";

type CaptureMode = "task" | "project";
export interface CaptureReconciliationRequest {
  type: CaptureMode;
  label: string;
}
export interface CaptureReconciliationMatch {
  id: string;
  label: string;
  type: CaptureMode;
}
export interface CaptureReconciliationResult {
  matches: CaptureReconciliationMatch[];
}
interface Props {
  open: boolean;
  projects: Project[];
  onClose: () => void;
  onCreateTask: (dto: CreateTodoDto) => Promise<unknown>;
  onCreateProject: (name: string) => Promise<unknown>;
  /** null means the fresh list could not be applied; matches never confirm POST identity. */
  onReconcile?: (
    request: CaptureReconciliationRequest,
  ) => Promise<CaptureReconciliationResult | null>;
  closeRequestRef?: RefObject<(() => void) | null>;
}

export function QuickCapture({
  open,
  projects,
  onClose,
  onCreateTask,
  onCreateProject,
  onReconcile,
  closeRequestRef,
}: Props) {
  const [mode, setMode] = useState<CaptureMode>("task");
  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState("");
  const [priority, setPriority] = useState<
    NonNullable<CreateTodoDto["priority"]> | ""
  >("");
  const [plannedDate, setPlannedDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [needsReconciliation, setNeedsReconciliation] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [checkError, setCheckError] = useState("");
  const [checkResult, setCheckResult] =
    useState<CaptureReconciliationResult | null>(null);
  const [uncertainAttempt, setUncertainAttempt] =
    useState<CaptureReconciliationRequest | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const submitRef = useRef(false);
  const needsReconciliationRef = useRef(false);
  const attemptRef = useRef<CaptureReconciliationRequest | null>(null);
  const wasOpen = useRef(false);
  const detailsId = useId();
  const dirty = Boolean(
    title ||
    projectId ||
    priority ||
    plannedDate ||
    dueDate ||
    needsReconciliation,
  );
  const busy = submitting || reconciling;

  useEffect(() => {
    if (open && !wasOpen.current) {
      setMode("task");
      setTitle("");
      setProjectId("");
      setPriority("");
      setPlannedDate("");
      setDueDate("");
      setMoreOpen(false);
      setError("");
      setNeedsReconciliation(false);
      needsReconciliationRef.current = false;
      attemptRef.current = null;
      setUncertainAttempt(null);
      setReconciling(false);
      setCheckError("");
      setCheckResult(null);
      setDiscardOpen(false);
      setSubmitting(false);
      submitRef.current = false;
    }
    wasOpen.current = open;
  }, [open]);

  const requestClose = useCallback(() => {
    if (submitRef.current) return;
    if (dirty) setDiscardOpen(true);
    else onClose();
  }, [dirty, onClose]);

  useEffect(() => {
    if (!closeRequestRef || !open) return;
    closeRequestRef.current = requestClose;
    return () => {
      if (closeRequestRef.current === requestClose)
        closeRequestRef.current = null;
    };
  }, [closeRequestRef, open, requestClose]);

  const handleSubmit = async () => {
    if (submitRef.current || needsReconciliationRef.current) return;
    const trimmed = title.trim();
    if (!trimmed) return;
    let dto: CreateTodoDto = { title: trimmed };
    if (mode === "task") {
      const scheduledDate = localDateTimeToIso(plannedDate);
      const deadline = deadlineDateToIso(dueDate);
      if ((plannedDate && !scheduledDate) || (dueDate && !deadline)) {
        setError("Choose valid dates and times in this device’s timezone.");
        return;
      }
      const dateError = validateTaskDates(scheduledDate, deadline);
      if (dateError) {
        setError(dateError);
        return;
      }
      dto = {
        ...dto,
        ...(projectId ? { projectId } : {}),
        ...(priority ? { priority } : {}),
        ...(scheduledDate ? { scheduledDate } : {}),
        ...(deadline ? { dueDate: deadline } : {}),
      };
    }
    submitRef.current = true;
    setSubmitting(true);
    setError("");
    setDiscardOpen(false);
    try {
      if (mode === "task") await onCreateTask(dto);
      else await onCreateProject(trimmed);
      onClose();
    } catch (failure) {
      const uncertain =
        failure instanceof TodoApiError && failure.requiresReconciliation;
      needsReconciliationRef.current = uncertain;
      setNeedsReconciliation(uncertain);
      if (uncertain) {
        const attempt = { type: mode, label: trimmed };
        attemptRef.current = attempt;
        setUncertainAttempt(attempt);
      }
      setError(
        uncertain
          ? "The result is uncertain. Keep this draft and check your tasks or projects after reconnecting before adding it again."
          : failure instanceof Error
            ? failure.message
            : "Could not add this item. Keep your draft and try again.",
      );
    } finally {
      submitRef.current = false;
      setSubmitting(false);
    }
  };

  const handleReconcile = async () => {
    const attempt = attemptRef.current;
    if (
      submitRef.current ||
      !needsReconciliationRef.current ||
      !attempt ||
      !onReconcile
    )
      return;
    submitRef.current = true;
    setReconciling(true);
    setCheckError("");
    setCheckResult(null);
    setDiscardOpen(false);
    try {
      const result = await onReconcile(attempt);
      if (result) setCheckResult(result);
      else
        setCheckError(
          "Could not refresh the list. Your draft is still here. Reconnect and try Refresh again.",
        );
    } catch (failure) {
      setCheckError(
        failure instanceof Error
          ? failure.message
          : "Could not refresh the list. Try Refresh again.",
      );
    } finally {
      // Reading possible matches never identifies which POST created an item.
      // Keep the creation guard until this draft is deliberately dismissed.
      submitRef.current = false;
      setReconciling(false);
    }
  };

  return (
    <MobileModal
      open={open}
      title="Quick capture"
      onClose={requestClose}
      dismissDisabled={busy}
      backdropClassName="m-capture__backdrop"
      footer={
        <>
          <button
            type="button"
            className="m-mobile-modal__cancel"
            disabled={busy}
            onClick={requestClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="m-capture__submit"
            disabled={!title.trim() || busy || needsReconciliation}
            onClick={() => {
              void handleSubmit();
            }}
          >
            {busy
              ? reconciling
                ? "Checking…"
                : "Adding…"
              : error && !needsReconciliation
                ? "Retry"
                : mode === "task"
                  ? "Add Task"
                  : "Add Project"}
          </button>
          {busy && (
            <span role="status" aria-live="polite">
              {reconciling
                ? "Refreshing the list to check this capture…"
                : `Adding ${mode}…`}
            </span>
          )}
        </>
      }
    >
      <div className="m-capture-draft">
        {discardOpen && (
          <section
            className="m-mobile-modal__discard"
            role="group"
            aria-label="Discard this draft?"
          >
            <p>Discard this draft?</p>
            <div className="m-mobile-modal__discard-actions">
              <button type="button" onClick={() => setDiscardOpen(false)}>
                Keep editing
              </button>
              <button type="button" onClick={onClose}>
                Discard
              </button>
            </div>
          </section>
        )}
        {error && (
          <div className="m-mobile-modal__error" role="alert">
            {error}
          </div>
        )}
        {needsReconciliation && uncertainAttempt && (
          <section aria-label="Check capture result">
            <p>
              Check the earlier {uncertainAttempt.type} capture: “
              {uncertainAttempt.label}”. Your current draft stays here.
            </p>
            {onReconcile ? (
              <button
                type="button"
                className="m-mobile-modal__cancel"
                disabled={busy || discardOpen}
                onClick={() => void handleReconcile()}
              >
                {reconciling ? "Refreshing…" : "Refresh and check"}
              </button>
            ) : (
              <p>
                Reconnect and check the task or project list before deliberately
                closing this draft.
              </p>
            )}
            {checkError && <p role="alert">{checkError}</p>}
            {checkResult && (
              <>
                <p role="status" aria-live="polite">
                  {checkResult.matches.length
                    ? "The refreshed list has possible matches. They may predate this capture. Review them before closing this draft."
                    : "No matching item appeared in the refreshed list. This does not confirm that the earlier request failed."}
                </p>
                {checkResult.matches.length > 0 && (
                  <ul aria-label="Possible existing items">
                    {checkResult.matches.map((match) => (
                      <li key={`${match.type}-${match.id}`}>
                        {match.type === "task" ? "Task" : "Project"}:{" "}
                        {match.label}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
            <p>
              Add stays blocked to avoid creating a duplicate. Refreshing does
              not confirm which request created an item.
            </p>
          </section>
        )}
        <fieldset disabled={busy || discardOpen}>
          <div
            className="m-capture__tabs"
            role="group"
            aria-label="Capture type"
          >
            <button
              type="button"
              className={`m-capture__tab${mode === "task" ? " m-capture__tab--active" : ""}`}
              aria-pressed={mode === "task"}
              disabled={needsReconciliation}
              onClick={() => setMode("task")}
            >
              Task
            </button>
            <button
              type="button"
              className={`m-capture__tab${mode === "project" ? " m-capture__tab--active" : ""}`}
              aria-pressed={mode === "project"}
              disabled={needsReconciliation}
              onClick={() => setMode("project")}
            >
              Project
            </button>
          </div>
          <label className="m-capture-draft__field">
            {mode === "task" ? "Task title" : "Project name"}
            <input
              data-autofocus
              type="text"
              placeholder={
                mode === "task" ? "What needs to be done?" : "Project name"
              }
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  void handleSubmit();
                }
              }}
            />
          </label>
          {mode === "task" && (
            <>
              <button
                type="button"
                className="m-capture-draft__more"
                aria-expanded={moreOpen}
                aria-controls={detailsId}
                onClick={() => setMoreOpen((value) => !value)}
              >
                More details {moreOpen ? "▴" : "▾"}
              </button>
              {moreOpen && (
                <div id={detailsId}>
                  <label className="m-capture-draft__field">
                    Project
                    <select
                      value={projectId}
                      onChange={(event) => setProjectId(event.target.value)}
                    >
                      <option value="">No project</option>
                      {projects
                        .filter(
                          (project) =>
                            project.status === "active" && !project.archived,
                        )
                        .map((project) => (
                          <option key={project.id} value={project.id}>
                            {project.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className="m-capture-draft__field">
                    Priority
                    <select
                      value={priority}
                      onChange={(event) =>
                        setPriority(event.target.value as typeof priority)
                      }
                    >
                      <option value="">No priority</option>
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                      <option value="urgent">Urgent</option>
                    </select>
                  </label>
                  <label className="m-capture-draft__field">
                    Plan for
                    <input
                      type="datetime-local"
                      value={plannedDate}
                      onChange={(event) => setPlannedDate(event.target.value)}
                    />
                  </label>
                  <label className="m-capture-draft__field">
                    Due by
                    <input
                      type="date"
                      value={dueDate}
                      onChange={(event) => setDueDate(event.target.value)}
                    />
                  </label>
                  <p>
                    Dates use this device’s timezone:{" "}
                    {Intl.DateTimeFormat().resolvedOptions().timeZone}. Due by
                    means the end of the selected day.
                  </p>
                </div>
              )}
            </>
          )}
        </fieldset>
      </div>
    </MobileModal>
  );
}
