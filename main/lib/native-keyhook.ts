/**
 * Ctrl/Alt watching for the voice overlay, done by the Tauri shell (src-tauri/src/keyhook.rs)
 * in place of the `uiohook-napi` addon. Runs `everfern --ef-keyhook`, which reports only
 * whether a key was Ctrl, Alt or something else, never which key.
 */
import { spawn } from "child_process";
import { createInterface } from "readline";

export type HookKey = "ctrl" | "alt" | "other";

export function hasNativeKeyHook(): boolean {
  return process.env.EVERFERN_SHELL === "tauri" && !!process.env.EF_NATIVE_EXE && process.platform === "win32";
}

/** Starts the hook; returns a function that stops it. If the hook process dies it is restarted. */
export function startNativeKeyHook(onKey: (key: HookKey, down: boolean) => void): () => void {
  let stopped = false;
  let child: ReturnType<typeof spawn> | null = null;
  let failures = 0;

  const start = () => {
    const proc = spawn(process.env.EF_NATIVE_EXE!, ["--ef-keyhook"], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    child = proc;
    let stderr = "";
    proc.stderr!.on("data", (chunk) => { stderr = (stderr + chunk).slice(-1000); });
    createInterface({ input: proc.stdout! }).on("line", (line) => {
      try {
        const event = JSON.parse(line);
        if (event.ready) { failures = 0; return; }
        if (event.key === "ctrl" || event.key === "alt" || event.key === "other") onKey(event.key, !!event.down);
      } catch { /* not ours */ }
    });
    proc.on("error", (e) => console.error("[KeyHook] Could not start:", e.message));
    proc.on("exit", (code) => {
      if (stopped) return;
      failures++;
      console.warn(`[KeyHook] Exited (code ${code}) ${stderr.trim()}`);
      // A hook that keeps dying won't get better by retrying forever.
      if (failures <= 5) setTimeout(() => { if (!stopped) start(); }, 1000 * failures);
    });
  };

  start();
  return () => {
    stopped = true;
    child?.stdin?.end();
    child?.kill();
  };
}
