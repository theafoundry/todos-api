import { useId, useState } from "react";
import type { Todo, Project } from "../../types";
import { MobileModal } from "./MobileModal";

interface Props {
  open?: boolean;
  onClose?: () => void;
  todos: Todo[];
  projects: Project[];
  onSelectResult: (id: string) => void;
}

/** Explicit search owns one modal; downward list gestures belong to refresh. */
export function PullToSearch({
  open = false,
  onClose = () => {},
  todos,
  projects,
  onSelectResult,
}: Props) {
  const [query, setQuery] = useState("");
  const id = useId();
  const projectMap = new Map(
    projects.map((project) => [project.id, project.name]),
  );
  const normalized = query.trim().toLocaleLowerCase();
  const matches = normalized
    ? todos.filter(
        (todo) =>
          !todo.archived &&
          [
            todo.title,
            todo.description ?? "",
            todo.notes ?? "",
            ...todo.tags,
            projectMap.get(todo.projectId ?? "") ?? "",
          ].some((value) => value.toLocaleLowerCase().includes(normalized)),
      )
    : [];
  const close = () => {
    setQuery("");
    onClose();
  };
  return (
    <MobileModal
      open={open}
      title="Search tasks"
      onClose={close}
      fullHeight
      footer={
        <button
          type="button"
          className="m-mobile-modal__cancel"
          onClick={close}
        >
          Cancel
        </button>
      }
    >
      <div className="m-task-search">
        <label htmlFor={id}>Search tasks</label>
        <input
          id={id}
          data-autofocus
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Titles, notes, tags or projects"
        />
        {normalized && (
          <p role="status">
            {matches.length} matching {matches.length === 1 ? "task" : "tasks"}
            {matches.length > 20 ? "; showing the first 20" : ""}
          </p>
        )}
        <ul className="m-search__results">
          {matches.slice(0, 20).map((todo) => (
            <li key={todo.id}>
              <button
                type="button"
                className="m-search__result"
                onClick={() => {
                  setQuery("");
                  onSelectResult(todo.id);
                }}
              >
                <span aria-hidden="true">{todo.completed ? "☑" : "☐"}</span>
                <span className="m-search__result-title">{todo.title}</span>
                {todo.projectId && (
                  <span className="m-search__result-project">
                    {projectMap.get(todo.projectId)}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
        {normalized && !matches.length && <p>No matching tasks</p>}
      </div>
    </MobileModal>
  );
}
