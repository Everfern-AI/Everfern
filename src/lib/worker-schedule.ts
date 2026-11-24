/**
 * Worker schedules. A schedule is stored by its kind and time ({ kind, hour, minute });
 * the label is only what the UI shows, so renaming a label never breaks a saved schedule.
 * Times are in the computer's local time zone (stored as `timeZone` for reference).
 */
export type ScheduleKind = "weekdays" | "daily" | "hourly" | "once";

export type WorkerSchedule = {
  kind: ScheduleKind;
  label: string;
  nextRun: string;
  timeZone: string;
  hour?: number;
  minute?: number;
  /** Set when one or more runs were missed and combined into the next one. */
  missed?: number;
};

export type ScheduleOption = { label: string; kind: ScheduleKind; hour?: number; minute?: number };

/** Every schedule the UI offers. Buttons and the parser both use this list. */
export const SCHEDULE_OPTIONS: readonly ScheduleOption[] = [
  { label: "Every weekday at 9:00", kind: "weekdays", hour: 9, minute: 0 },
  { label: "Every day at 9:00", kind: "daily", hour: 9, minute: 0 },
  { label: "Every hour", kind: "hourly" },
  { label: "Tomorrow at 9:00", kind: "once", hour: 9, minute: 0 },
];
export const SCHEDULE_LABELS = SCHEDULE_OPTIONS.map((o) => o.label);
export const REMOVE_SCHEDULE = "Remove schedule";

/** Labels saved by earlier builds, still accepted. */
const LEGACY: Record<string, ScheduleOption> = {
  "Tomorrow at 8:00": { label: "Tomorrow at 8:00", kind: "once", hour: 8, minute: 0 },
};

const HOUR = 3_600_000;
const localZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return "UTC"; } };

/** The next time after `now` at hour:minute on an allowed day. */
function nextAt(kind: "weekdays" | "daily" | "once", hour: number, minute: number, now: Date): Date {
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (kind === "once") { next.setDate(now.getDate() + 1); return next; }
  if (next <= now) next.setDate(next.getDate() + 1);
  if (kind === "weekdays") while (next.getDay() === 0 || next.getDay() === 6) next.setDate(next.getDate() + 1);
  return next;
}

/** Hour and minute of a schedule, including ones saved before they were stored. */
function timeOf(s: Pick<WorkerSchedule, "hour" | "minute" | "label">): { hour: number; minute: number } {
  if (Number.isInteger(s.hour) && Number.isInteger(s.minute)) return { hour: s.hour!, minute: s.minute! };
  const m = /(\d{1,2}):(\d{2})/.exec(s.label || "");
  return m ? { hour: Math.min(23, Number(m[1])), minute: Math.min(59, Number(m[2])) } : { hour: 9, minute: 0 };
}

export function makeWorkerSchedule(label: string, now = new Date()): WorkerSchedule {
  const opt = SCHEDULE_OPTIONS.find((o) => o.label === label) ?? LEGACY[label];
  if (!opt) throw new Error("Choose a supported schedule.");
  const base = { kind: opt.kind, label: opt.label, timeZone: localZone() };
  if (opt.kind === "hourly") return { ...base, nextRun: new Date(now.getTime() + HOUR).toISOString() };
  const { hour, minute } = { hour: opt.hour ?? 9, minute: opt.minute ?? 0 };
  return { ...base, hour, minute, nextRun: nextAt(opt.kind, hour, minute, now).toISOString() };
}

/**
 * The schedule after a run was claimed at `now`, or undefined for a one-time run.
 * Missed occurrences are combined into that one run (never a backlog), and counted in `missed`.
 * Hourly runs stay on the hour they were scheduled for, so they do not drift by the run's length.
 */
export function advanceWorkerSchedule(schedule: WorkerSchedule, now = new Date()): WorkerSchedule | undefined {
  if (schedule.kind === "once") return undefined;
  const due = Date.parse(schedule.nextRun);
  if (schedule.kind === "hourly") {
    const from = Number.isFinite(due) ? due : now.getTime();
    const steps = Math.max(1, Math.floor((now.getTime() - from) / HOUR) + 1);
    return { ...schedule, nextRun: new Date(from + steps * HOUR).toISOString(), missed: steps - 1 || undefined };
  }
  if (schedule.kind !== "weekdays" && schedule.kind !== "daily") return undefined;
  const { hour, minute } = timeOf(schedule);
  // Count occurrences between the one that was due and now (all but the claimed one were missed).
  let missed = 0;
  if (Number.isFinite(due)) {
    for (let t = nextAt(schedule.kind, hour, minute, new Date(due)); t <= now && missed < 1000; t = nextAt(schedule.kind, hour, minute, t)) missed++;
  }
  return { ...schedule, hour, minute, nextRun: nextAt(schedule.kind, hour, minute, now).toISOString(), missed: missed || undefined };
}

/** A saved schedule from untrusted JSON, or undefined. */
export function cleanSchedule(v: unknown): WorkerSchedule | undefined {
  const s = v as Partial<WorkerSchedule> | null;
  if (!s || typeof s !== "object") return undefined;
  if (!["weekdays", "daily", "hourly", "once"].includes(String(s.kind))) return undefined;
  if (typeof s.nextRun !== "string" || !Number.isFinite(Date.parse(s.nextRun))) return undefined;
  const out: WorkerSchedule = {
    kind: s.kind as ScheduleKind,
    label: typeof s.label === "string" ? s.label.slice(0, 80) : "Scheduled",
    nextRun: new Date(s.nextRun).toISOString(),
    timeZone: typeof s.timeZone === "string" ? s.timeZone.slice(0, 64) : localZone(),
  };
  if (Number.isInteger(s.hour) && s.hour! >= 0 && s.hour! <= 23) out.hour = s.hour;
  if (Number.isInteger(s.minute) && s.minute! >= 0 && s.minute! <= 59) out.minute = s.minute;
  if (Number.isInteger(s.missed) && s.missed! > 0) out.missed = Math.min(s.missed!, 1000);
  return out;
}
