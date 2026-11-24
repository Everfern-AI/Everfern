"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_APPS } from "./apps";
import type { WorkerSchedule } from "./worker-schedule";

/**
 * Worker store. Uses `electronAPI.workers` when the main process provides it, and
 * falls back to localStorage so the UI works in a plain browser (and until the
 * main-process store lands; see docs/EVERFERN_EMPLOYEE_OS_PLAN.md phase 1).
 */

export type Tier = "lite" | "balanced" | "pro";
export type Machine = "local" | "cloud";
export type WorkerStatus = "draft" | "idle" | "running" | "paused";

export type Worker = {
  id: string;
  name: string;
  folder?: string;
  /** hue for the orb avatar */
  hue: number;
  tier: Tier;
  status: WorkerStatus;
  apps: string[];
  templateId?: string;
  /** Where the worker's computer runs: the local Alpine VM or an EverFern Cloud VM. */
  machine?: Machine;
  /** The EverFern Cloud VM this worker uses when machine is "cloud". */
  cloudVmId?: string;
  prompt: string;
  schedule?: WorkerSchedule;
  createdAt: string;
  /** The last runs (newest last, at most 20), fed into the next run as context. */
  runs?: WorkerRun[];
  /** Where a paused run stopped: Continue picks up at steps[done]. Kept up to date while a run goes. */
  resume?: { steps: string[]; done: number };
  /** Why a paused worker stopped: you paused it, or EverFern closed while it was running. */
  pausedBy?: "you" | "closed";
};

export type WorkerRun = {
  at: string;
  /** What the worker was asked to do. */
  task: string;
  /** Its final report, shortened. */
  summary: string;
  ok: boolean;
  /** Started by the schedule rather than by you. */
  auto?: boolean;
};

/** Adds a run to a worker's history, keeping the last 20. */
export function withRun(w: Worker, run: WorkerRun): Worker {
  const clip = (t: string, n: number) => (t.length > n ? t.slice(0, n - 1) + "\u2026" : t);
  return { ...w, runs: [...(w.runs ?? []), { ...run, task: clip(run.task, 500), summary: clip(run.summary, 2000) }].slice(-20) };
}

export const TIERS: { id: Tier; name: string; price: string; desc: string; tag?: string }[] = [
  { id: "lite", name: "Lite", price: "Lowest cost", desc: "For simple, recurring tasks.", tag: "Quick actions" },
  { id: "balanced", name: "Balanced", price: "Medium cost", desc: "Best for everyday tasks." },
  { id: "pro", name: "Pro", price: "Highest cost", desc: "For complex, exploratory tasks." },
];

const KEY = "everfern_workers";

const api = () => (typeof window !== "undefined" ? (window as any).electronAPI?.workers : undefined);

function readLocal(): Worker[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
}

export function newWorker(): Worker {
  return {
    id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    name: "New worker",
    hue: Math.floor(Math.random() * 360),
    tier: "lite",
    status: "draft",
    apps: [...DEFAULT_APPS],
    prompt: "",
    createdAt: new Date().toISOString(),
  };
}

export function useWorkers() {
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [ready, setReady] = useState(false);
  /** Set when the store could not be read or written; the UI shows it instead of pretending all is well. */
  const [error, setError] = useState<string | null>(null);
  const latest = useRef<Worker[]>([]);
  latest.current = workers;

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        let list: Worker[] = api()?.list ? await api().list() : readLocal();
        // One-time move of workers made in an earlier, browser-only build into the main-process store.
        if (api()?.save && !list.length && readLocal().length) {
          const old = readLocal().map(worker => worker.status === 'running' ? { ...worker, status: 'paused' as const, pausedBy: 'closed' as const } : worker);
          const results = await Promise.all(old.map((w) => api().save(w)));
          // Only forget the browser copy once every worker made it into the store.
          if (results.every((r: any) => r?.success)) { localStorage.removeItem(KEY); list = old; }
          else list = old;
        }
        if (alive) {
          setWorkers(Array.isArray(list) ? list : []);
          setReady(true);
        }
      } catch (err) {
        console.error('[useWorkers] failed', err);
        if (alive) {
          setError(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err));
          setReady(true);
        }
      }
    })();
    return () => { alive = false; };
  }, []);

  /** Saves a worker. The list updates at once; if the store refuses, the error is shown. */
  const save = useCallback((w: Worker) => {
    const prev = latest.current;
    const next = prev.some((p) => p.id === w.id) ? prev.map((p) => (p.id === w.id ? w : p)) : [...prev, w];
    latest.current = next;
    setWorkers(next);
    if (api()?.save) {
      Promise.resolve(api().save(w)).then(
        (r: any) => setError(r?.success === false ? (r.error || 'Could not save the worker.') : null),
        (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
      );
    } else {
      try { localStorage.setItem(KEY, JSON.stringify(next)); } catch (e) { setError('Could not save the worker in this browser.'); }
    }
  }, []);

  /** Deletes a worker and everything it left behind (its runs, workspace, logins, chat). */
  const remove = useCallback(async (id: string): Promise<{ success: boolean; error?: string; warnings?: string[] }> => {
    if (api()?.delete) {
      let r: any;
      try { r = await api().delete(id); } catch (e) { r = { success: false, error: e instanceof Error ? e.message : String(e) }; }
      if (!r?.success) { setError(r?.error || 'Could not delete the worker.'); return { success: false, error: r?.error }; }
      const next = latest.current.filter((p) => p.id !== id);
      latest.current = next;
      setWorkers(next);
      return { success: true, warnings: r.warnings };
    }
    const next = latest.current.filter((p) => p.id !== id);
    latest.current = next;
    setWorkers(next);
    localStorage.setItem(KEY, JSON.stringify(next));
    return { success: true };
  }, []);

  return { workers, ready, error, clearError: () => setError(null), save, remove };
}

/** A worker's saved chat (the messages you exchanged with it), or [] in a plain browser. */
export async function loadWorkerChat<T = unknown>(id: string): Promise<T[]> {
  try { const v = await api()?.chatLoad?.(id); return Array.isArray(v) ? v : []; } catch { return []; }
}
export function saveWorkerChat(id: string, msgs: unknown[]) {
  try { void api()?.chatSave?.(id, msgs)?.catch?.(() => undefined); } catch { /* not in the desktop app */ }
}

/** Soft gradient orb used as a worker's avatar. */
export function orbBackground(hue: number) {
  return `radial-gradient(circle at 32% 28%, hsl(${hue} 90% 88%) 0%, hsl(${hue} 70% 62%) 38%, hsl(${(hue + 40) % 360} 60% 34%) 100%)`;
}
