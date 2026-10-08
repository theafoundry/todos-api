/** Mobile dates use the device's calendar. Deadlines are calendar dates; plans are instants. */
function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function localDateValue(date = new Date()): string {
  return `${String(date.getFullYear()).padStart(4, "0")}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function calendarParts(value: string): [number, number, number] | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const parts: [number, number, number] = [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
  ];
  const date = new Date(0);
  date.setUTCFullYear(parts[0], parts[1] - 1, parts[2]);
  date.setUTCHours(0, 0, 0, 0);
  return date.getUTCFullYear() === parts[0] &&
    date.getUTCMonth() === parts[1] - 1 &&
    date.getUTCDate() === parts[2]
    ? parts
    : null;
}

export function deadlineDateValue(value: string | null | undefined): string {
  if (!value) return "";
  // Legacy date-only deadlines were serialized as UTC midnight. Keep their named day.
  if (
    value.length === 10 ||
    /^\d{4}-\d{2}-\d{2}T00:00:00(?:\.000)?Z$/.test(value)
  ) {
    const date = value.slice(0, 10);
    return calendarParts(date) ? date : "";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : localDateValue(date);
}

/** Explicitly selected Due by dates last through the end of the device-local calendar day. */
export function deadlineDateToIso(value: string): string | null {
  if (!calendarParts(value)) return null;
  const date = new Date(`${value}T23:59:59.999`);
  return Number.isNaN(date.getTime()) || localDateValue(date) !== value
    ? null
    : date.toISOString();
}

export function validateTaskDates(
  scheduledDate: string | null | undefined,
  dueDate: string | null | undefined,
): string | null {
  if (
    scheduledDate &&
    dueDate &&
    new Date(scheduledDate).getTime() > new Date(dueDate).getTime()
  ) {
    return "Planned time must be on or before the deadline. Change Due by to keep this planned time.";
  }
  return null;
}

export function localDateTimeValue(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value.length === 10 ? `${value}T00:00` : value);
  if (Number.isNaN(date.getTime())) return "";
  return `${localDateValue(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function localDateTimeToIso(value: string): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match || !calendarParts(match[1])) return null;
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  if (hour > 23 || minute > 59) return null;
  const date = new Date(value);
  // Reject calendar rollovers and the nonexistent hour during a DST spring transition.
  if (
    Number.isNaN(date.getTime()) ||
    localDateTimeValue(date.toISOString()) !== value
  )
    return null;
  return date.toISOString();
}

function calendarOrdinal(value: string): number | null {
  const parts = calendarParts(value);
  if (!parts) return null;
  const date = new Date(0);
  date.setUTCFullYear(parts[0], parts[1] - 1, parts[2]);
  date.setUTCHours(0, 0, 0, 0);
  return date.getTime() / 86_400_000;
}

/** Compare named calendar days, avoiding 23/25-hour DST days and UTC date truncation. */
export function calendarDayOffset(
  value: string,
  now = new Date(),
): number | null {
  const calendar =
    value.length === 10 ? value : localDateTimeValue(value).slice(0, 10);
  const target = calendarOrdinal(calendar);
  const today = calendarOrdinal(localDateValue(now));
  return target === null || today === null ? null : target - today;
}

export function formatPlannedDate(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function schedulingPresets(
  now = new Date(),
): { label: string; value: string; detail: string }[] {
  const later = new Date(now);
  later.setHours(17, 0, 0, 0);
  if (later <= now) later.setTime(now.getTime() + 3 * 60 * 60 * 1000);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  const monday = new Date(now);
  monday.setDate(
    monday.getDate() + (monday.getDay() === 0 ? 1 : 8 - monday.getDay()),
  );
  monday.setHours(9, 0, 0, 0);
  return [
    {
      label:
        localDateValue(later) === localDateValue(now)
          ? "Later today"
          : "In 3 hours",
      date: later,
    },
    { label: "Tomorrow", date: tomorrow },
    { label: "Next Monday", date: monday },
  ].map(({ label, date }) => ({
    label,
    value: date.toISOString(),
    detail: formatPlannedDate(date.toISOString()),
  }));
}
