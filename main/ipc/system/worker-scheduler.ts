/**
 * Worker schedules, kept by the main process so they fire on any screen (Workers, Chat,
 * Settings), not only while the Workers screen happens to be open.
 *
 * Every 15 seconds the most overdue worker is claimed here: its schedule is advanced and
 * saved before anything runs, so a run is never started twice. The claimed worker is then
 * sent to the window ('workers:due'); the renderer builds the prompt and runs it (the run
 * itself goes back through the agent runner in this process). One scheduled run at a time.
 *
 * Nothing can run while EverFern is fully closed. Runs missed in that time are combined into
 * one run when it opens again, and the worker's chat says so (`schedule.missed`).
 */
import { BrowserWindow, ipcMain } from 'electron';
import { advanceWorkerSchedule, cleanSchedule } from '../../../src/lib/worker-schedule';
import { activeConversationIds } from '../../agent/runner/abort-manager';
import { readWorkers, writeWorkers } from './worker-handlers';

const TICK_MS = 15_000;
/** A dispatched run that never reports back is given up on after this long. */
const STALE_MS = 3 * 60 * 60 * 1000;

let timer: NodeJS.Timeout | null = null;
/** The renderer that said it can run scheduled work (the main window, once its page has loaded). */
let runnerId: number | null = null;
let inFlight: { workerId: string; at: number } | null = null;
let claiming = false;

const windowOf = (id: number | null) => BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.webContents.id === id) ?? null;

/** The worker whose scheduled run is most overdue, or undefined. Exported for tests. */
export function pickDue(list: any[], now = Date.now(), active: string[] = []): any | undefined {
  return list
    .filter((w) => w?.schedule && w.status !== 'paused' && w.status !== 'draft' && String(w.prompt || '').trim()
      && Date.parse(w.schedule.nextRun) <= now
      && !active.some((c) => c === `worker-${w.id}` || c.startsWith(`worker-${w.id}-`)))
    .sort((a, b) => Date.parse(a.schedule.nextRun) - Date.parse(b.schedule.nextRun))[0];
}

/** Getting a cloud machine ready can take minutes; a run that has not started by then was lost (page reloaded). */
const NO_START_MS = 10 * 60 * 1000;

async function tick() {
  if (claiming) return;
  const active = activeConversationIds();
  if (inFlight) {
    const id = inFlight.workerId;
    const running = active.some((c) => c === `worker-${id}` || c.startsWith(`worker-${id}-`));
    const age = Date.now() - inFlight.at;
    if (age < STALE_MS && (running || age < NO_START_MS)) return;
    inFlight = null;
  }
  const win = windowOf(runnerId);
  if (!win) return; // no page to build the run yet; it stays due (and is combined) until there is one
  if (active.some((c) => c.startsWith('worker-'))) return; // one worker run at a time
  const claimNative = (globalThis as typeof globalThis & {
    __efClaimScheduledWorker?: () => Promise<any>;
  }).__efClaimScheduledWorker;
  if (claimNative) {
    claiming = true;
    try {
      const claimed = await claimNative();
      if (claimed) {
        inFlight = { workerId: claimed.id, at: Date.now() };
        win.webContents.send('workers:due', claimed);
      }
    } catch (error) {
      console.warn('[Workers] Could not claim a scheduled run:', error);
    } finally {
      claiming = false;
    }
    return;
  }
  let list: any[];
  try { list = readWorkers(); } catch { return; } // damaged store: the Workers screen shows the error
  const due = pickDue(list, Date.now(), active);
  if (!due) return;
  const schedule = cleanSchedule(due.schedule);
  const claimed = { ...due, status: 'idle', schedule: schedule ? advanceWorkerSchedule(schedule) : undefined };
  try {
    writeWorkers(list.map((w) => (w.id === due.id ? claimed : w)));
  } catch (e) {
    console.warn('[Workers] Could not claim a scheduled run:', e);
    return;
  }
  inFlight = { workerId: due.id, at: Date.now() };
  win.webContents.send('workers:due', claimed);
}

export function startWorkerScheduler(): void {
  // The page says when it is ready to take runs; a reload or navigation says so again.
  ipcMain.on('workers:scheduler-ready', (event) => {
    // Only the main window runs scheduled work (overlay windows load the same layout).
    const main = (global as any).mainWindow as BrowserWindow | null | undefined;
    if (!main || main.isDestroyed() || main.webContents.id !== event.sender.id) return;
    if (runnerId !== event.sender.id) {
      runnerId = event.sender.id;
      event.sender.once('destroyed', () => { if (runnerId === event.sender.id) runnerId = null; });
    }
    setTimeout(tick, 1000);
  });
  ipcMain.on('workers:due-done', (_event, workerId: unknown) => {
    if (inFlight && inFlight.workerId === workerId) inFlight = null;
    setTimeout(tick, 1000); // the next queued worker, if any, without waiting for the timer
  });
  if (!timer) timer = setInterval(tick, TICK_MS);
}
