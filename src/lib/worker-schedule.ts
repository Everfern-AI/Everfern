export type WorkerSchedule = {
  kind: "weekdays" | "hourly" | "once";
  label: string;
  nextRun: string;
  timeZone: string;
};

export function makeWorkerSchedule(label: string, now = new Date()): WorkerSchedule {
  const next = new Date(now);
  let kind: WorkerSchedule["kind"];
  if (label === "Every hour") { kind = "hourly"; next.setTime(now.getTime() + 3_600_000); }
  else if (label === "Tomorrow at 8:00") { kind = "once"; next.setDate(next.getDate() + 1); next.setHours(8, 0, 0, 0); }
  else if (label === "Every weekday at 9:00") {
    kind = "weekdays"; next.setHours(9, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    while (next.getDay() === 0 || next.getDay() === 6) next.setDate(next.getDate() + 1);
  } else throw new Error("Choose a supported schedule.");
  return { kind, label, nextRun: next.toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
}

/** Coalesce missed occurrences into one run; never replay a backlog of actions. */
export function advanceWorkerSchedule(schedule: WorkerSchedule, now = new Date()): WorkerSchedule | undefined {
  return schedule.kind === "once" ? undefined : makeWorkerSchedule(schedule.label, now);
}
