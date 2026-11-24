"use client";
/**
 * Runs the scheduled work the main process hands over ('workers:due', see
 * main/ipc/system/worker-scheduler.ts). The worker arrives already claimed: its schedule
 * has been advanced and saved, so it is run exactly once here.
 *
 * When the Workers screen is open it takes the run (setScheduledRunHandler) so you can
 * watch it in the chat. On any other screen the run happens in the background, and its
 * report is added to the worker's saved chat and run history for when you open it.
 */
import { APPS, startUrlFor } from "./apps";
import { ensureCloudVm, cloudToken, API_URL } from "./cloud-vms";
import { activeRunOf, parseSteps, runWorker } from "./worker-engine";
import { loadWorkerChat, saveWorkerChat, withRun, type Worker } from "./workers";

type Handler = (w: Worker) => Promise<void>;
let foreground: Handler | null = null;

/** The Workers screen registers here while it is mounted (null when it unmounts). */
export function setScheduledRunHandler(h: Handler | null) { foreground = h; }

/** Text for a run that stands in for several missed ones. */
export function missedNote(w: Worker): string | null {
  const n = w.schedule?.missed;
  return n ? `EverFern was closed for ${n} scheduled run${n === 1 ? "" : "s"}, so they are combined into this one.` : null;
}

const controllable = (app: string) => !!(APPS[app]?.domain || APPS[app]?.url || ["chrome", "browser", "terminal", "files"].includes(app));

/** Gets a cloud worker's machine ready (assigned and its apps registered). Throws with a readable message. */
export async function prepareCloudWorker(w: Worker): Promise<Worker> {
  const assigned = await ensureCloudVm({ preferId: w.cloudVmId, workerId: w.id, name: w.name });
  if (!("vm" in assigned)) throw new Error("error" in assigned ? assigned.error : "Your cloud plan needs attention before this worker can run.");
  const api = (window as any).electronAPI?.workers;
  if (!api?.registerCloudVm) throw new Error("Cloud app control is unavailable in this desktop build.");
  const token = cloudToken();
  if (!token) throw new Error("Sign in to EverFern Cloud before running this worker.");
  const registered = await Promise.all(w.apps.filter(controllable).map((app) => api.registerCloudVm(`persist:worker-${w.id}`, app, assigned.vm.id, API_URL, token, startUrlFor(app) ?? undefined)));
  if (registered.some((r: unknown) => r !== true)) throw new Error("Could not register the worker's cloud apps.");
  return { ...w, cloudVmId: assigned.vm.id };
}

async function appendChat(id: string, texts: string[]) {
  const saved = await loadWorkerChat<Record<string, unknown>>(id);
  const at = new Date().toISOString();
  saveWorkerChat(id, [...saved, ...texts.map((text) => ({ kind: "ai", text, at }))]);
}

/** A scheduled run with no Workers screen to show it on. */
export async function runScheduledInBackground(w: Worker): Promise<void> {
  const api = (window as any).electronAPI?.workers;
  if (!api?.save || activeRunOf(w.id)) return;
  const steps = parseSteps(w.prompt);
  await api.save({ ...w, status: "running" });
  let res: { text: string; error?: string };
  let exec = w;
  try {
    if (w.machine === "cloud") exec = await prepareCloudWorker(w);
    res = await runWorker(exec, steps, { onText: () => undefined, onTool: () => undefined }, { auto: true });
  } catch (e) {
    res = { text: "", error: e instanceof Error ? e.message : String(e) };
  }
  const list: Worker[] = await api.list().catch(() => []);
  const latest = list.find((x) => x.id === w.id);
  if (!latest) return; // deleted while it ran
  const summary = res.error ? `Failed: ${res.error}` : (res.text.trim() || "Finished without a report.");
  await api.save(withRun({ ...latest, cloudVmId: exec.cloudVmId ?? latest.cloudVmId, status: "idle" }, {
    at: new Date().toISOString(), task: steps.join("; "), summary, ok: !res.error, auto: true,
  }));
  await appendChat(w.id, [
    ...(missedNote(w) ? [missedNote(w)!] : []),
    `Scheduled run (${w.schedule?.label ?? "scheduled"}) ${res.error ? "failed" : "finished"} while you were on another screen.\n\n${summary}`,
  ]);
}

/** Called for every 'workers:due' message. Always reports back so the next run can start. */
export async function handleDueWorker(w: Worker): Promise<void> {
  const api = (window as any).electronAPI?.workers;
  try {
    if (foreground) await foreground(w);
    else await runScheduledInBackground(w);
  } catch (e) {
    console.warn("[Workers] Scheduled run failed:", e);
  } finally {
    api?.dueDone?.(w.id);
  }
}
