import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { Todo } from "../../types";
import {
  acceptCapture,
  captureInboxItem,
  discardCapture,
  fetchInboxItems,
  type CaptureItemDto,
} from "../../api/inbox";
import { MutationApiError } from "../../api/mutations";
import { useViewActivity } from "../layout/ViewActivityContext";
import "./inbox-review.css";

export interface InboxReviewProps {
  onAccepted: (task: Todo) => void | Promise<void>;
  onReconcileTasks?: () => void | Promise<void>;
  onOpenTask?: (taskId: string) => void;
  refreshKey?: string | number;
  onCaptureAdded?: () => void;
  refreshRef?: RefObject<(() => Promise<boolean>) | null>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Could not save this change. Try again.";
}

function CaptureRow({
  item,
  pending,
  error,
  onAccept,
  onDiscard,
}: {
  item: CaptureItemDto;
  pending: boolean;
  error?: string;
  onAccept: (title: string) => void;
  onDiscard: () => void;
}) {
  const originalTitle = item.text.trim().slice(0, 200);
  const [title, setTitle] = useState(originalTitle);
  const [editing, setEditing] = useState(false);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const capturedAt = new Date(item.capturedAt);
  const source =
    item.source === "manual"
      ? "Manual capture"
      : item.source === "api"
        ? "Agent or API"
        : item.source || "Unknown source";

  return (
    <li className="inbox-review__item" aria-busy={pending}>
      <div className="inbox-review__meta">
        <span>{source}</span>
        {!Number.isNaN(capturedAt.getTime()) && (
          <time dateTime={item.capturedAt}>{capturedAt.toLocaleString()}</time>
        )}
      </div>
      {editing ? (
        <label className="inbox-review__field">
          Task title
          <input
            value={title}
            maxLength={200}
            disabled={pending}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
      ) : (
        <h2 className="inbox-review__title">{title}</h2>
      )}
      {(item.text.trim() !== title || editing) && (
        <p className="inbox-review__context">
          <span>Original capture</span>
          {item.text}
        </p>
      )}
      {error && (
        <p role="alert" className="inbox-review__error">
          {error}
        </p>
      )}
      {confirmingDiscard ? (
        <div className="inbox-review__confirm">
          <p>Discard this capture from Inbox?</p>
          <div className="inbox-review__actions">
            <button
              type="button"
              className="btn"
              disabled={pending}
              onClick={() => setConfirmingDiscard(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn"
              disabled={pending}
              onClick={onDiscard}
            >
              {pending ? "Discarding…" : "Confirm discard"}
            </button>
          </div>
        </div>
      ) : (
        <div className="inbox-review__actions">
          <button
            type="button"
            className="btn btn--primary"
            disabled={pending || !title.trim()}
            onClick={() => onAccept(title.trim())}
          >
            {pending ? "Saving…" : "Accept to Tasks"}
          </button>
          <button
            type="button"
            className="btn"
            disabled={pending}
            onClick={() => setEditing((value) => !value)}
          >
            {editing ? "Done editing" : "Edit title"}
          </button>
          {editing && (
            <button
              type="button"
              className="btn"
              disabled={pending}
              onClick={() => {
                setTitle(originalTitle);
                setEditing(false);
              }}
            >
              Cancel title edit
            </button>
          )}
          <button
            type="button"
            className="btn"
            disabled={pending}
            onClick={() => setConfirmingDiscard(true)}
          >
            Discard
          </button>
        </div>
      )}
    </li>
  );
}

export function InboxReview({
  onAccepted,
  onReconcileTasks,
  onOpenTask,
  refreshKey,
  onCaptureAdded,
  refreshRef,
}: InboxReviewProps) {
  const { isActive } = useViewActivity();
  const [items, setItems] = useState<CaptureItemDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [tasksRefreshError, setTasksRefreshError] = useState("");
  const [refreshingTasks, setRefreshingTasks] = useState(false);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  const [acceptedTask, setAcceptedTask] = useState<Todo | null>(null);
  const [draft, setDraft] = useState("");
  const [savingCapture, setSavingCapture] = useState(false);
  const [captureError, setCaptureError] = useState("");
  const [needsCaptureCheck, setNeedsCaptureCheck] = useState(false);
  const pending = useRef(new Set<string>());
  const removedIds = useRef(new Map<string, number>());
  const reviewSequence = useRef(0);
  const saving = useRef(false);
  const mounted = useRef(false);
  const loadSequence = useRef(0);
  const acceptedCallback = useRef(onAccepted);
  const reconciliationCallback = useRef(onReconcileTasks);
  const tasksRefresh = useRef<Promise<string | null> | null>(null);
  const captureAttempt = useRef<{ text: string; key: string } | null>(null);

  useEffect(() => {
    acceptedCallback.current = onAccepted;
  }, [onAccepted]);
  useEffect(() => {
    reconciliationCallback.current = onReconcileTasks;
  }, [onReconcileTasks]);

  const queueTasksRefresh = useCallback(
    async (
      callback: () => void | Promise<void>,
      isCurrent = () => mounted.current,
    ) => {
      // A prior read can predate a committed acceptance. Serialize it, then make
      // a fresh read for this refresh rather than treating its snapshot as current.
      const previous = tasksRefresh.current;
      const attempt = Promise.resolve(previous).then(async () => {
        if (!isCurrent()) return null;
        try {
          await callback();
          return null;
        } catch (error) {
          return errorMessage(error);
        }
      });
      tasksRefresh.current = attempt;
      if (mounted.current) setRefreshingTasks(true);
      void attempt.then(() => {
        if (tasksRefresh.current === attempt) {
          tasksRefresh.current = null;
          if (mounted.current) setRefreshingTasks(false);
        }
      });
      return attempt;
    },
    [],
  );

  const reconcileTasks = useCallback(
    async (isCurrent = () => mounted.current) => {
      if (!reconciliationCallback.current) return true;
      const error = await queueTasksRefresh(
        () => reconciliationCallback.current?.(),
        isCurrent,
      );
      if (isCurrent()) setTasksRefreshError(error ?? "");
      return error === null;
    },
    [queueTasksRefresh],
  );

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    const reviewedBeforeLoad = reviewSequence.current;
    setLoading(true);
    setLoadError("");
    try {
      const next = await fetchInboxItems();
      if (!mounted.current || sequence !== loadSequence.current) return null;
      // Reads started before a confirmed review must not resurrect that capture.
      // A later read is authoritative, including an explicitly restored capture.
      const visible = next.filter(
        (item) => (removedIds.current.get(item.id) ?? 0) <= reviewedBeforeLoad,
      );
      for (const [id, reviewedAt] of removedIds.current) {
        if (reviewedAt <= reviewedBeforeLoad) removedIds.current.delete(id);
      }
      setItems(visible);
      // An acceptance can commit despite an unreadable response, or another
      // surface can review a capture. Refresh Tasks without inferring an outcome.
      const tasksRefreshed = await reconcileTasks(
        () => mounted.current && sequence === loadSequence.current,
      );
      if (!mounted.current || sequence !== loadSequence.current) return null;
      return { items: visible, tasksRefreshed };
    } catch (error) {
      if (mounted.current && sequence === loadSequence.current)
        setLoadError(errorMessage(error));
      return null;
    } finally {
      if (mounted.current && sequence === loadSequence.current)
        setLoading(false);
    }
  }, [reconcileTasks]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      ++loadSequence.current;
    };
  }, []);

  useEffect(() => {
    if (isActive) void load();
  }, [isActive, refreshKey, load]);

  useEffect(() => {
    if (!refreshRef) return;
    const refresh = async () => (await load())?.tasksRefreshed ?? false;
    refreshRef.current = refresh;
    return () => {
      if (refreshRef.current === refresh) refreshRef.current = null;
    };
  }, [refreshRef, load]);

  const review = async (item: CaptureItemDto, title?: string) => {
    if (pending.current.has(item.id)) return;
    pending.current.add(item.id);
    setPendingIds(new Set(pending.current));
    setErrors((current) => ({ ...current, [item.id]: "" }));
    try {
      const accepted =
        title !== undefined ? await acceptCapture(item.id, title) : null;
      if (!accepted) await discardCapture(item.id);
      if (mounted.current) {
        removedIds.current.set(item.id, ++reviewSequence.current);
        setItems((current) =>
          current.filter((capture) => capture.id !== item.id),
        );
        setNotice(
          accepted
            ? "Accepted to Tasks. Available for day planning with your connected agent."
            : "Capture discarded.",
        );
        setAcceptedTask(accepted?.task ?? null);
      }
      if (accepted) {
        // Confirmed acceptance needs its own fresh read in the same queue.
        // Navigation may unmount this review while the owning shell still lives.
        const error = await queueTasksRefresh(
          () => acceptedCallback.current(accepted.task),
          () => true,
        );
        if (mounted.current) {
          if (error) {
            setTasksRefreshError(error);
            setNotice(
              "Accepted to Tasks. Refresh Tasks to see the saved task.",
            );
          } else {
            setTasksRefreshError("");
          }
        }
      }
    } catch (error) {
      if (mounted.current)
        setErrors((current) => ({
          ...current,
          [item.id]: errorMessage(error),
        }));
      if (
        title !== undefined &&
        error instanceof MutationApiError &&
        error.requiresReconciliation
      )
        void reconcileTasks();
    } finally {
      pending.current.delete(item.id);
      if (mounted.current) setPendingIds(new Set(pending.current));
    }
  };

  const saveCapture = async () => {
    if (saving.current || needsCaptureCheck || !draft.trim()) return;
    saving.current = true;
    setSavingCapture(true);
    setCaptureError("");
    try {
      const text = draft.trim();
      if (captureAttempt.current?.text !== text)
        captureAttempt.current = { text, key: crypto.randomUUID() };
      const item = await captureInboxItem(
        text,
        "manual",
        captureAttempt.current.key,
      );
      if (!mounted.current) return;
      ++loadSequence.current;
      setLoading(false);
      setItems((current) => [
        item,
        ...current.filter((capture) => capture.id !== item.id),
      ]);
      setDraft("");
      captureAttempt.current = null;
      setNotice("Saved to Inbox for review.");
      setAcceptedTask(null);
      try {
        onCaptureAdded?.();
      } catch {
        setNotice("Saved to Inbox for review. Refresh Inbox to check it.");
      }
    } catch (error) {
      if (mounted.current) {
        setCaptureError(errorMessage(error));
        setNeedsCaptureCheck(
          error instanceof MutationApiError && error.requiresReconciliation,
        );
      }
    } finally {
      saving.current = false;
      if (mounted.current) setSavingCapture(false);
    }
  };

  const checkCapture = async () => {
    const refreshed = await load();
    if (!refreshed || !mounted.current) return;
    if (refreshed.items.some((item) => item.text.trim() === draft.trim())) {
      setCaptureError(
        "A matching capture is in Inbox. It may be your earlier save. Review it before saving this draft again.",
      );
    } else {
      setNeedsCaptureCheck(false);
      setCaptureError(
        "No matching capture is in the refreshed Inbox. You can retry saving this draft.",
      );
    }
  };

  return (
    <section className="inbox-review" aria-label="Inbox review">
      <p className="inbox-review__intro">
        Review saved intentions and turn them into tasks. Accepted tasks are
        available for day planning with your connected agent.
      </p>
      <form
        className="inbox-review__capture"
        onSubmit={(event) => {
          event.preventDefault();
          void saveCapture();
        }}
      >
        <label className="inbox-review__field">
          Save an intention for review
          <textarea
            value={draft}
            maxLength={2000}
            disabled={savingCapture}
            rows={2}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="What would you like to come back to?"
          />
        </label>
        {captureError && (
          <p role="alert" className="inbox-review__error">
            {captureError}
          </p>
        )}
        <div className="inbox-review__actions">
          <button
            type="submit"
            className="btn"
            disabled={!draft.trim() || savingCapture || needsCaptureCheck}
          >
            {savingCapture ? "Saving…" : "Save to Inbox"}
          </button>
          {needsCaptureCheck && (
            <button
              type="button"
              className="btn"
              disabled={loading}
              onClick={() => void checkCapture()}
            >
              Check Inbox
            </button>
          )}
          {captureError && draft && (
            <button
              type="button"
              className="btn"
              disabled={savingCapture}
              onClick={() => {
                setDraft("");
                captureAttempt.current = null;
                setCaptureError("");
                setNeedsCaptureCheck(false);
              }}
            >
              Clear draft
            </button>
          )}
        </div>
      </form>
      {notice && (
        <div className="inbox-review__notice" role="status">
          {notice}
          {acceptedTask && onOpenTask && (
            <button
              type="button"
              className="btn"
              onClick={() => onOpenTask(acceptedTask.id)}
            >
              Open task
            </button>
          )}
        </div>
      )}
      <div className="inbox-review__toolbar">
        <span>{items.length} awaiting review</span>
        <button
          type="button"
          className="btn"
          disabled={loading}
          onClick={() => void load()}
        >
          Refresh Inbox
        </button>
      </div>
      {loading && <p role="status">Loading Inbox…</p>}
      {loadError && (
        <div role="alert" className="inbox-review__error">
          <p>{loadError}</p>
          <button type="button" className="btn" onClick={() => void load()}>
            Retry loading Inbox
          </button>
        </div>
      )}
      {tasksRefreshError && (
        <div role="alert" className="inbox-review__error">
          <p>
            Tasks could not be refreshed. Try again to check any saved changes.
          </p>
          <p>{tasksRefreshError}</p>
          {onReconcileTasks && (
            <button
              type="button"
              className="btn"
              disabled={refreshingTasks}
              onClick={() => void reconcileTasks()}
            >
              Retry refreshing Tasks
            </button>
          )}
        </div>
      )}
      {!loading && !loadError && !items.length && (
        <div className="inbox-review__empty">
          <h2>Inbox is clear</h2>
          <p>
            Things you save from a connected agent will appear here for review.
            Accepted captures are in Tasks.
          </p>
        </div>
      )}
      <ul className="inbox-review__list">
        {items.map((item) => (
          <CaptureRow
            key={item.id}
            item={item}
            pending={pendingIds.has(item.id)}
            error={errors[item.id]}
            onAccept={(title) => void review(item, title)}
            onDiscard={() => void review(item)}
          />
        ))}
      </ul>
    </section>
  );
}
