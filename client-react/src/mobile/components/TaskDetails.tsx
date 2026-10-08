import { useState } from "react";
import type { Project, Todo } from "../../types";
import type { TaskFeedback as Feedback } from "../hooks/useTaskActions";
import { deadlineDateValue } from "../utils/taskDates";
import { TaskFeedback } from "./TaskFeedback";

interface Props {
  todo: Todo;
  project?: Project;
  pending: boolean;
  feedback: Feedback | null;
  onEdit: () => void;
  onComplete: () => void;
  onReschedule: () => void;
  onDelete: () => void;
  onToggleSubtask: (id: string, completed: boolean) => void;
}

export function TaskDetails({
  todo,
  project,
  pending,
  feedback,
  onEdit,
  onComplete,
  onReschedule,
  onDelete,
  onToggleSubtask,
}: Props) {
  const [showMore, setShowMore] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const deadline = deadlineDateValue(todo.dueDate ?? null);
  return (
    <div className="m-sheet-half">
      <h3 className="m-sheet-half__title">{todo.title}</h3>
      {todo.description && (
        <p className="m-sheet-half__desc">{todo.description}</p>
      )}
      <div className="m-sheet-half__pills">
        <span className="m-pill m-pill--status">
          {todo.completed ? "Completed" : todo.status.replace(/_/g, " ")}
        </span>
        {todo.priority && (
          <span className={`m-pill m-priority--${todo.priority}`}>
            {todo.priority}
          </span>
        )}
        {project && (
          <span className="m-pill m-pill--project">{project.name}</span>
        )}
      </div>
      {todo.scheduledDate && (
        <p>Plan for {new Date(todo.scheduledDate).toLocaleString()}</p>
      )}
      {deadline && (
        <p>Due by {new Date(`${deadline}T12:00:00`).toLocaleDateString()}</p>
      )}
      {todo.notes && <p className="m-task-details__notes">{todo.notes}</p>}
      {todo.estimateMinutes != null && (
        <p>Estimate: {todo.estimateMinutes} min</p>
      )}
      {todo.tags.length > 0 && <p>Tags: {todo.tags.join(", ")}</p>}
      <TaskFeedback feedback={feedback} />
      {todo.subtasks?.map((subtask) => (
        <button
          key={subtask.id}
          type="button"
          disabled={pending}
          className="m-sheet-half__subtask"
          aria-pressed={subtask.completed}
          onClick={() => onToggleSubtask(subtask.id, !subtask.completed)}
        >
          {subtask.completed ? "☑" : "☐"} {subtask.title}
        </button>
      ))}
      <div className="m-sheet-half__actions">
        <button
          type="button"
          disabled={pending}
          className="m-sheet-half__action"
          onClick={onEdit}
        >
          Edit
        </button>
        <button
          type="button"
          disabled={pending}
          className="m-sheet-half__action m-sheet-half__action--complete"
          onClick={onComplete}
        >
          {pending ? "Saving…" : todo.completed ? "Reopen" : "Complete"}
        </button>
      </div>
      <button
        type="button"
        disabled={pending}
        className="m-sheet-half__action"
        onClick={onReschedule}
      >
        Reschedule
      </button>
      <button
        type="button"
        className="m-sheet-half__action"
        disabled={pending}
        aria-expanded={showMore}
        onClick={() => setShowMore(!showMore)}
      >
        More actions
      </button>
      {showMore && !confirmDelete && (
        <button
          type="button"
          disabled={pending}
          className="m-sheet-full__action m-sheet-full__action--delete"
          onClick={() => setConfirmDelete(true)}
        >
          Delete task
        </button>
      )}
      {confirmDelete && (
        <div
          className="m-task-details__delete"
          role="group"
          aria-label="Confirm deletion"
        >
          <p>Delete this task? This cannot be undone.</p>
          <button
            type="button"
            disabled={pending}
            onClick={() => setConfirmDelete(false)}
          >
            Keep task
          </button>
          <button type="button" disabled={pending} onClick={onDelete}>
            Confirm delete
          </button>
        </div>
      )}
    </div>
  );
}
