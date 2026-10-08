import type { TaskFeedback as Feedback } from "../hooks/useTaskActions";

export function TaskFeedback({
  feedback,
  onDismiss,
}: {
  feedback: Feedback | null;
  onDismiss?: () => void;
}) {
  if (!feedback) return null;
  return (
    <div
      className={`m-task-feedback m-task-feedback--${feedback.kind}`}
      role={feedback.kind === "error" ? "alert" : "status"}
    >
      <span>{feedback.message}</span>
      {feedback.action && (
        <button type="button" onClick={feedback.action.run}>
          {feedback.action.label}
        </button>
      )}
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss task message"
        >
          ×
        </button>
      )}
    </div>
  );
}
