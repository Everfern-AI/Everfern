"use client";
import { useEffect } from "react";
import { handleDueWorker } from "@/lib/worker-scheduled-run";

/**
 * Mounted once in the root layout, so scheduled worker runs start on any screen.
 * The main process keeps the clock; this receives each due worker and runs it.
 */
export function WorkerScheduleHost() {
  useEffect(() => {
    const api = (window as any).electronAPI?.workers;
    if (!api?.onDue || !api?.schedulerReady) return;
    const off = api.onDue((w: any) => { void handleDueWorker(w); });
    api.schedulerReady();
    return () => { off?.(); };
  }, []);
  return null;
}
