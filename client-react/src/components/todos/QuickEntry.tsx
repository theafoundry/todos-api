import { useState, useRef, useEffect, useCallback } from "react";
import type { CreateTodoDto } from "../../types";
import { IconClose } from "../shared/Icons";
import { AiOnCreateAssist } from "../ai/AiOnCreateAssist";
import { useCaptureRoute } from "../../hooks/useCaptureRoute";

interface Props {
  projectId?: string | null;
  workspaceView?: string;
  onAddTask: (dto: CreateTodoDto) => Promise<unknown>;
  onCaptureToDesk: (text: string) => Promise<unknown>;
  placeholder?: string;
}

interface ParsedDate {
  text: string;
  date: string; // ISO date string
}

/**
 * Simple natural language date parser.
 * Detects common patterns like "tomorrow", "next monday", "jan 15", etc.
 */
function parseNaturalDate(input: string): ParsedDate | null {
  const lower = input.toLowerCase();
  const today = new Date();

  const patterns: Array<{
    regex: RegExp;
    resolve: (m: RegExpMatchArray) => Date | null;
    label: string;
  }> = [
    {
      regex: /\b(today)\b/,
      resolve: () => today,
      label: "Today",
    },
    {
      regex: /\b(tomorrow)\b/,
      resolve: () => {
        const d = new Date(today);
        d.setDate(d.getDate() + 1);
        return d;
      },
      label: "Tomorrow",
    },
    {
      regex:
        /\bnext (monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/,
      resolve: (m) => {
        const days = [
          "sunday",
          "monday",
          "tuesday",
          "wednesday",
          "thursday",
          "friday",
          "saturday",
        ];
        const target = days.indexOf(m[1]);
        const d = new Date(today);
        const diff = (target - d.getDay() + 7) % 7 || 7;
        d.setDate(d.getDate() + diff);
        return d;
      },
      label: "",
    },
    {
      regex: /\bin (\d+) days?\b/,
      resolve: (m) => {
        const d = new Date(today);
        d.setDate(d.getDate() + parseInt(m[1]));
        return d;
      },
      label: "",
    },
    {
      regex:
        /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+(\d{1,2})\b/,
      resolve: (m) => {
        const months = [
          "jan",
          "feb",
          "mar",
          "apr",
          "may",
          "jun",
          "jul",
          "aug",
          "sep",
          "oct",
          "nov",
          "dec",
        ];
        const month = months.indexOf(m[1].slice(0, 3));
        if (month === -1) return null;
        const d = new Date(today.getFullYear(), month, parseInt(m[2]));
        if (d < today) d.setFullYear(d.getFullYear() + 1);
        return d;
      },
      label: "",
    },
  ];

  for (const p of patterns) {
    const match = lower.match(p.regex);
    if (match) {
      const date = p.resolve(match);
      if (!date) continue;
      const iso = date.toISOString().split("T")[0];
      const label =
        p.label ||
        date.toLocaleDateString(undefined, {
          weekday: "short",
          month: "short",
          day: "numeric",
        });
      return { text: label, date: iso };
    }
  }
  return null;
}

function getRouteLabel(route: "task" | "triage") {
  return route === "task" ? "Create task now" : "Save to Inbox";
}

function formatAssistDueDate(value: string): ParsedDate | null {
  const isoDate = value.includes("T") ? value.split("T")[0] : value;
  const parts = isoDate.split("-").map((part) => Number(part));
  if (parts.length !== 3 || parts.some((part) => Number.isNaN(part))) {
    return null;
  }

  const [year, month, day] = parts;
  const parsed = new Date(year, month - 1, day);
  if (Number.isNaN(parsed.getTime())) return null;

  return {
    text: parsed.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    }),
    date: isoDate,
  };
}

export function QuickEntry({
  projectId,
  workspaceView,
  onAddTask,
  onCaptureToDesk,
  placeholder = "Add a task…",
}: Props) {
  const [title, setTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const submitRef = useRef(false);
  const [parsedDate, setParsedDate] = useState<ParsedDate | null>(null);
  const [dateApplied, setDateApplied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const { suggestion, loading, preferredRoute, alternateRoute } =
    useCaptureRoute({
      text: title,
      project: projectId,
      workspaceView,
    });

  // Debounced date parsing
  useEffect(() => {
    clearTimeout(debounceRef.current);
    if (!title.trim()) {
      setParsedDate(null);
      setDateApplied(false);
      return;
    }
    debounceRef.current = setTimeout(() => {
      const parsed = parseNaturalDate(title);
      setParsedDate(parsed);
      if (!parsed) setDateApplied(false);
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [title]);

  const handleSubmit = useCallback(
    async (route: "task" | "triage") => {
      const trimmed = title.trim();
      if (!trimmed || submitRef.current) return;
      submitRef.current = true;
      setSubmitting(true);
      setError("");
      try {
        if (route === "triage") {
          await onCaptureToDesk(trimmed);
        } else {
          const extractedDueDate =
            suggestion?.extractedFields?.dueDate &&
            typeof suggestion.extractedFields.dueDate === "string"
              ? suggestion.extractedFields.dueDate
              : null;
          await onAddTask({
            title: suggestion?.cleanedTitle?.trim() || trimmed,
            ...(projectId ? { projectId } : {}),
            ...((dateApplied && parsedDate) || extractedDueDate
              ? {
                  dueDate:
                    (dateApplied && parsedDate ? parsedDate.date : null) ??
                    extractedDueDate,
                }
              : {}),
          });
        }
        setTitle("");
        setParsedDate(null);
        setDateApplied(false);
        inputRef.current?.focus();
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
    },
    [
      title,
      submitting,
      projectId,
      dateApplied,
      parsedDate,
      onAddTask,
      onCaptureToDesk,
      suggestion,
    ],
  );

  const routeHint = !title.trim()
    ? ""
    : loading
      ? "Reviewing capture…"
      : suggestion?.why
        ? `Suggested: ${getRouteLabel(preferredRoute)}. ${suggestion.why}`
        : `Default: ${getRouteLabel(preferredRoute)}.`;

  const handleApplySuggestion = useCallback((field: string, value: string) => {
    if (!value) return;

    switch (field) {
      case "title":
      case "cleanedTitle":
      case "rewrite_title": {
        setTitle(value);
        return;
      }
      case "dueDate":
      case "due_date": {
        const nextParsedDate = formatAssistDueDate(value);
        if (!nextParsedDate) return;
        setParsedDate(nextParsedDate);
        setDateApplied(true);
        return;
      }
      default:
        return;
    }
  }, []);

  return (
    <div className="quick-entry" id="taskComposerSheet" aria-hidden="false">
      <input
        id="todoInput"
        ref={inputRef}
        className="quick-entry__input"
        data-quick-entry-input="true"
        type="text"
        placeholder={placeholder}
        aria-label={placeholder}
        value={title}
        disabled={submitting}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSubmit(preferredRoute);
        }}
      />
      {parsedDate && (
        <div id="quickEntryNaturalDueChipRow" className="quick-entry__chips">
          <button
            className={`natural-date-chip${dateApplied ? " natural-date-chip--applied" : ""}`}
            onClick={() => setDateApplied(!dateApplied)}
            title={
              dateApplied
                ? "Click to remove due date"
                : "Click to set as due date"
            }
          >
            {parsedDate.text}
            {dateApplied && (
              <span
                className="natural-date-chip__remove"
                onClick={(e) => {
                  e.stopPropagation();
                  setDateApplied(false);
                }}
              >
                <IconClose size={10} />
              </span>
            )}
          </button>
        </div>
      )}
      {routeHint && (
        <span className="capture-route-hint" aria-live="polite">
          {routeHint}
        </span>
      )}
      {error && (
        <p role="alert" className="inbox-review__error">
          {error}
        </p>
      )}
      <AiOnCreateAssist
        title={title}
        onApplySuggestion={handleApplySuggestion}
      />
      <div className="quick-entry__actions">
        <button
          id="taskComposerAddButton"
          className="quick-entry__btn"
          disabled={!title.trim() || submitting}
          onClick={() => handleSubmit(preferredRoute)}
        >
          {submitting ? "Saving…" : getRouteLabel(preferredRoute)}
        </button>
        <button
          type="button"
          className="quick-entry__btn quick-entry__btn--secondary"
          disabled={!title.trim() || submitting}
          onClick={() => handleSubmit(alternateRoute)}
        >
          {getRouteLabel(alternateRoute)}
        </button>
      </div>
    </div>
  );
}
