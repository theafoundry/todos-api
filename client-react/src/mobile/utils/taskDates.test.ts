import { describe, expect, it } from "vitest";
import {
  calendarDayOffset,
  deadlineDateToIso,
  deadlineDateValue,
  formatPlannedDate,
  localDateTimeToIso,
  localDateTimeValue,
  localDateValue,
  schedulingPresets,
  validateTaskDates,
} from "./taskDates";

describe("mobile task dates in the device time zone", () => {
  it("groups a late-night planned instant by its local calendar day", () => {
    const lateTonight = new Date(2026, 9, 7, 23, 45);
    expect(localDateValue(lateTonight)).toBe("2026-10-07");
    expect(
      calendarDayOffset(lateTonight.toISOString(), new Date(2026, 9, 7, 8)),
    ).toBe(0);
    expect(
      calendarDayOffset(new Date(2026, 9, 8, 0, 15).toISOString(), lateTonight),
    ).toBe(1);
  });

  it("preserves date-only and legacy UTC-midnight deadlines", () => {
    expect(deadlineDateValue("2026-10-07")).toBe("2026-10-07");
    expect(deadlineDateValue("2026-10-07T00:00:00.000Z")).toBe("2026-10-07");
    expect(
      calendarDayOffset(
        deadlineDateValue("2026-10-07T00:00:00.000Z"),
        new Date(2026, 9, 7, 23),
      ),
    ).toBe(0);
  });

  it("saves an explicitly selected deadline through the local day's final millisecond", () => {
    const saved = deadlineDateToIso("2026-10-07")!;
    expect(saved).toBe(new Date(2026, 9, 7, 23, 59, 59, 999).toISOString());
    expect(deadlineDateValue(saved)).toBe("2026-10-07");
    expect(
      validateTaskDates(new Date(2026, 9, 7, 9).toISOString(), saved),
    ).toBeNull();
    expect(
      validateTaskDates(new Date(2026, 9, 8, 0).toISOString(), saved),
    ).toMatch(/deadline/);
  });

  it("does not reinterpret or move a legacy deadline to accept a later planned instant", () => {
    const due = "2026-10-07T00:00:00.000Z";
    expect(validateTaskDates("2026-10-07T09:00:00.000Z", due)).toMatch(
      /Change Due by/,
    );
    expect(validateTaskDates(null, due)).toBeNull();
  });

  it("roundtrips local planned inputs without UTC truncation", () => {
    const input = "2026-10-07T23:30";
    const saved = localDateTimeToIso(input)!;
    expect(saved).toBe(new Date(2026, 9, 7, 23, 30).toISOString());
    expect(localDateTimeValue(saved)).toBe(input);
    expect(localDateTimeValue("2026-10-07")).toBe("2026-10-07T00:00");
  });

  it("rejects invalid days, invalid times and invalid saved dates", () => {
    for (const value of [
      "2026-02-30T09:00",
      "2026-13-01T09:00",
      "2026-10-07T24:00",
      "2026-10-07T09:60",
      "garbage",
    ]) {
      expect(localDateTimeToIso(value)).toBeNull();
    }
    expect(deadlineDateToIso("2026-02-30")).toBeNull();
    expect(deadlineDateValue("garbage")).toBe("");
    expect(localDateTimeValue("garbage")).toBe("");
    expect(calendarDayOffset("garbage")).toBeNull();
  });

  it("counts calendar days across DST, month and year boundaries", () => {
    expect(calendarDayOffset("2026-03-09", new Date(2026, 2, 8, 12))).toBe(1);
    expect(calendarDayOffset("2026-11-02", new Date(2026, 10, 1, 12))).toBe(1);
    expect(calendarDayOffset("2027-01-01", new Date(2026, 11, 31, 23))).toBe(1);
    expect(calendarDayOffset("2026-02-28", new Date(2026, 2, 1, 0))).toBe(-1);
  });

  it("rejects a nonexistent local time when the device observes the spring DST gap", () => {
    const gap = new Date("2026-03-08T02:30");
    if (gap.getHours() !== 2)
      expect(localDateTimeToIso("2026-03-08T02:30")).toBeNull();
    else expect(localDateTimeToIso("2026-03-08T02:30")).toBe(gap.toISOString());
  });

  it("labels each preset with the exact saved local date and time", () => {
    const presets = schedulingPresets(new Date(2026, 2, 7, 12));
    expect(presets.map((preset) => preset.label)).toEqual([
      "Later today",
      "Tomorrow",
      "Next Monday",
    ]);
    expect(localDateTimeValue(presets[0].value)).toBe("2026-03-07T17:00");
    expect(localDateTimeValue(presets[1].value)).toBe("2026-03-08T09:00");
    expect(localDateTimeValue(presets[2].value)).toBe("2026-03-09T09:00");
    presets.forEach((preset) =>
      expect(preset.detail).toBe(formatPlannedDate(preset.value)),
    );
  });

  it("promises three hours when a late preset crosses midnight", () => {
    const now = new Date(2026, 9, 7, 22, 30);
    const [preset] = schedulingPresets(now);
    expect(preset.label).toBe("In 3 hours");
    expect(new Date(preset.value).getTime() - now.getTime()).toBe(
      3 * 60 * 60 * 1000,
    );
    expect(localDateTimeValue(preset.value)).toBe("2026-10-08T01:30");
  });
});
