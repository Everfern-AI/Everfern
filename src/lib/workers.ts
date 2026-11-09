"use client";

import { useCallback, useEffect, useState } from "react";
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
};

export const TIERS: { id: Tier; name: string; price: string; desc: string; tag?: string }[] = [
  { id: "lite", name: "Lite", price: "€", desc: "For simple, recurring tasks.", tag: "Quick actions" },
  { id: "balanced", name: "Balanced", price: "€€", desc: "Best for everyday tasks." },
  { id: "pro", name: "Pro", price: "€€€€", desc: "For complex, exploratory tasks." },
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

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        let list: Worker[] = api()?.list ? await api().list() : readLocal();
        // One-time move of workers made in an earlier, browser-only build into the main-process store.
        if (api()?.save && !list.length && readLocal().length) {
          list = readLocal().map(worker => worker.status === 'running' ? { ...worker, status: 'paused' as const } : worker);
          await Promise.all(list.map((w) => api().save(w)));
          localStorage.removeItem(KEY);
        }
        if (alive) {
          setWorkers(list);
          setReady(true);
        }
      } catch (err) {
        console.error('[useWorkers] failed', err);
        if (alive) setReady(true);
      }
    })();
    return () => { alive = false; };
  }, []);

  const save = useCallback((w: Worker) => {
    setWorkers((prev) => {
      const next = prev.some((p) => p.id === w.id) ? prev.map((p) => (p.id === w.id ? w : p)) : [...prev, w];
      if (api()?.save) api().save(w);
      else localStorage.setItem(KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const remove = useCallback((id: string) => {
    setWorkers((prev) => {
      const next = prev.filter((p) => p.id !== id);
      if (api()?.delete) api().delete(id);
      else localStorage.setItem(KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  return { workers, ready, save, remove };
}

/** Soft gradient orb used as a worker's avatar. */
export function orbBackground(hue: number) {
  return `radial-gradient(circle at 32% 28%, hsl(${hue} 90% 88%) 0%, hsl(${hue} 70% 62%) 38%, hsl(${(hue + 40) % 360} 60% 34%) 100%)`;
}
