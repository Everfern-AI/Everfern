/**
 * EverFern Desktop — Artifacts Watch (NR-PERF-07)
 *
 * Main→renderer fs-watch push for artifacts: instead of the renderer
 * re-polling `artifacts:list` after every write, the main process watches
 * the global artifacts root and each open project's artifacts dir, then
 * broadcasts a debounced `artifacts:changed` event to every live renderer
 * window so it refetches once per settled burst.
 *
 * Self-contained by design: fs/path/os/electron only — no chokidar and no
 * store imports, so watchers can never bypass main/store/artifacts.ts
 * sandboxing (MP-SEC-02).
 */

import { ipcMain, BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const ARTIFACTS_WATCH_DEBOUNCE_MS = 300;

interface ArtifactWatchOptions {
  debounceMs?: number;
  /** Overrides the global artifacts root (tests point this at temp dirs). */
  globalDir?: string;
}

type ArtifactChangeSource = 'global' | 'project';

interface ArtifactChangeEvent {
  source: ArtifactChangeSource;
  projectPath?: string;
}

interface WatchEntry {
  watcher: fs.FSWatcher;
  timer: NodeJS.Timeout | null;
}

// NR-PERF-07: module-level watcher state — one watcher per project + one global.
const projectWatchers = new Map<string, WatchEntry>();
let globalWatcher: WatchEntry | null = null;
let activeDebounceMs = ARTIFACTS_WATCH_DEBOUNCE_MS;
let activeGlobalDir = path.join(os.homedir(), '.everfern', 'artifacts');
// Electron throws on duplicate ipcMain.handle registration; guard re-entry.
let registered = false;
let globalWatchWarned = false;

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// NR-PERF-07: notify all live renderer windows that the artifacts listing is stale.
function broadcastChange(info: ArtifactChangeEvent): void {
  const windows = BrowserWindow.getAllWindows();
  for (const window of windows) {
    if (!window.isDestroyed()) {
      window.webContents.send('artifacts:changed', info);
    }
  }
}

// NR-PERF-07: collapse a burst of fs.watch events into a single broadcast.
function scheduleBroadcast(entry: WatchEntry, info: ArtifactChangeEvent): void {
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = setTimeout(() => {
    entry.timer = null;
    broadcastChange(info);
  }, activeDebounceMs);
}

function attachWatcher(entry: WatchEntry, info: ArtifactChangeEvent, onDead: () => void): void {
  entry.watcher.on('change', () => scheduleBroadcast(entry, info));
  // A dead watcher (dir deleted, perms lost) self-cleans; never crash main.
  entry.watcher.on('error', () => {
    try {
      entry.watcher.close();
    } catch {
      // Already closed
    }
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = null;
    onDead();
  });
}

function ensureGlobalWatch(): void {
  if (globalWatcher) return;
  try {
    const watcher = fs.watch(activeGlobalDir, { recursive: true });
    const entry: WatchEntry = { watcher, timer: null };
    attachWatcher(entry, { source: 'global' }, () => {
      if (globalWatcher === entry) globalWatcher = null;
    });
    globalWatcher = entry;
    globalWatchWarned = false;
  } catch (err) {
    // Non-blocking: the global dir may not exist yet (fresh install);
    // revalidateArtifactWatch() retries on the next watch-project call.
    if (!globalWatchWarned) {
      console.warn('[ArtifactsWatch] global watch unavailable (non-blocking):', errMessage(err));
      globalWatchWarned = true;
    }
  }
}

function watchProject(rawProjectPath: string): { success: boolean; reason?: string; error?: string } {
  if (typeof rawProjectPath !== 'string' || rawProjectPath.length === 0) {
    return { success: false, reason: 'invalid-path', error: 'projectPath must be a non-empty string' };
  }
  const resolved = path.resolve(rawProjectPath);
  if (projectWatchers.has(resolved)) return { success: true };
  // Pick up a global artifacts dir that appeared since the last attempt.
  ensureGlobalWatch();
  const artifactsDir = path.join(resolved, '.everfern', 'artifacts');
  try {
    const watcher = fs.watch(artifactsDir, { recursive: true });
    const entry: WatchEntry = { watcher, timer: null };
    attachWatcher(entry, { source: 'project', projectPath: resolved }, () => {
      projectWatchers.delete(resolved);
    });
    projectWatchers.set(resolved, entry);
    return { success: true };
  } catch (err) {
    // Do NOT mkdir here — watching must never create project state on disk.
    const code = (err as NodeJS.ErrnoException)?.code;
    const reason = code === 'ENOENT' ? 'dir-missing' : 'watch-failed';
    console.warn(`[ArtifactsWatch] project watch unavailable for ${resolved} (non-blocking):`, errMessage(err));
    return { success: false, reason, error: errMessage(err) };
  }
}

export function registerArtifactWatchHandlers(options: ArtifactWatchOptions = {}): void {
  activeDebounceMs = options.debounceMs ?? ARTIFACTS_WATCH_DEBOUNCE_MS;
  activeGlobalDir = options.globalDir ?? path.join(os.homedir(), '.everfern', 'artifacts');
  // Retry the global watch on every call — it may have been unavailable before.
  ensureGlobalWatch();
  if (registered) return;
  registered = true;
  ipcMain.handle('artifacts:watch-project', (_e, projectPath: string) => {
    try {
      return watchProject(projectPath);
    } catch (err) {
      // Never throw to the renderer over a watcher setup failure.
      console.error('[ArtifactsWatch] artifacts:watch-project rejected:', errMessage(err));
      return { success: false, error: errMessage(err) };
    }
  });
}

// NR-PERF-07: retry a previously-unavailable global watch (e.g. dir appeared).
function revalidateArtifactWatch(): void {
  ensureGlobalWatch();
}

export function disposeArtifactWatchers(): void {
  for (const entry of projectWatchers.values()) {
    try {
      entry.watcher.close();
    } catch {
      // Already closed
    }
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = null;
  }
  projectWatchers.clear();
  if (globalWatcher) {
    try {
      globalWatcher.watcher.close();
    } catch {
      // Already closed
    }
    if (globalWatcher.timer) clearTimeout(globalWatcher.timer);
    globalWatcher = null;
  }
  // Allow a clean re-register (tests re-run registration per case).
  registered = false;
}

export function __getProjectWatcherCountForTests(): number {
  return projectWatchers.size;
}

export function __isGlobalWatchActiveForTests(): boolean {
  return globalWatcher !== null;
}
