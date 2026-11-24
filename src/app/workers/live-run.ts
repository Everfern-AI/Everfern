/**
 * Keeps a worker's run on screen across a page reload.
 *
 * The agent runs in the main process, so a reload (Ctrl+R, a dev rebuild, a crash of the page)
 * does not stop it; only the page forgets it. Each run's details and the screen around it
 * (which worker was open, its windows, the plan) are kept in sessionStorage, which a reload
 * keeps and an app restart clears, the same as the run itself.
 */

import type { LiveRun } from "@/lib/worker-engine";

export type RunPlan = { workerId: string; steps: string[]; done: number; used: string[][]; agent?: { total: number; done: number } };

/** What the page needs to pick a run back up. */
export type SavedRun = {
  workerId: string;
  conversationId: string;
  /** The steps this run was asked to do. */
  steps: string[];
  /** Set when it continued a paused run: the whole plan and how many steps were done before. */
  from?: { steps: string[]; done: number };
  startTime: number;
  auto?: boolean;
  /** The key of its streamed reply in the chat, so the reply keeps updating in place. */
  key: string;
  plan?: RunPlan | null;
  completed?: number;
};

/** The screen the person was looking at. */
export type SavedView = { activeId: string | null; mode: string; wins: unknown[]; chatHidden: boolean };

const RUNS = "everfern_worker_live_runs";
const VIEW = "everfern_workers_view";

function read<T>(key: string, fallback: T): T {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch { return fallback; }
}
function write(key: string, value: unknown) {
  try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* storage off or full */ }
}

export const savedRuns = (): Record<string, SavedRun> => read(RUNS, {});
export function saveRun(r: SavedRun) { write(RUNS, { ...savedRuns(), [r.workerId]: r }); }
export function patchRun(workerId: string, patch: Partial<SavedRun>) {
  const all = savedRuns();
  if (all[workerId]) write(RUNS, { ...all, [workerId]: { ...all[workerId], ...patch } });
}
export function dropRun(workerId: string) {
  const { [workerId]: _gone, ...rest } = savedRuns();
  write(RUNS, rest);
}

export const savedView = (): SavedView | null => read(VIEW, null);
export const saveView = (v: SavedView) => write(VIEW, v);

/**
 * The main-process run that belongs to this worker's saved run. Without a saved record (storage
 * cleared), a run still going under the worker's id counts too, the newest first.
 */
export function pickLive(workerId: string, saved: SavedRun | undefined, runs: LiveRun[]): LiveRun | undefined {
  if (saved) return runs.find((r) => r.conversationId === saved.conversationId);
  const prefix = `worker-${workerId}-`;
  const stamp = (id: string) => Number(id.split("-").pop()) || 0;
  return runs
    .filter((r) => !r.done && r.conversationId.startsWith(prefix))
    .sort((a, b) => stamp(b.conversationId) - stamp(a.conversationId))[0];
}
