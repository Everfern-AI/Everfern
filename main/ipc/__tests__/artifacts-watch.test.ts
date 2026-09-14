// @vitest-environment node
/**
 * Artifacts watch tests (NR-PERF-07)
 *
 * Main-side fs-watch push for artifacts: the main process watches the global
 * artifacts root plus per-project `<project>/.everfern/artifacts` dirs and
 * broadcasts a debounced `artifacts:changed` event to every live renderer
 * window so the artifacts panel refetches instead of polling.
 *
 * Under test:
 *  - global dir watch → debounced broadcast { source: 'global' }
 *  - artifacts:watch-project idempotence (same path dedupes, new path adds)
 *  - project broadcasts carry { source: 'project', projectPath }
 *  - destroyed windows never receive broadcasts
 *  - dispose closes every watcher and resets registration state
 *  - missing project artifacts dir → { success: false } without throwing
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ipcMain, BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// ── Mocks ────────────────────────────────────────────────────────────────

let allWindows: any[] = [];

vi.mock('electron', () => {
  return {
    ipcMain: {
      handle: vi.fn(),
    },
    BrowserWindow: {
      getAllWindows: vi.fn(() => allWindows),
    },
  };
});

// ── Imports (after mocks) ─────────────────────────────────────────────────

// NOTE: imported dynamically per-test (vi.resetModules) so each case gets a
// clean watcher map without relying on dispose resetting every code path.
let registerArtifactWatchHandlers: (options?: {
  debounceMs?: number;
  globalDir?: string;
}) => void;
let disposeArtifactWatchers: () => void;
let __getProjectWatcherCountForTests: () => number;
let __isGlobalWatchActiveForTests: () => boolean;

function captureHandler(channel: string): Function {
  const calls = (ipcMain.handle as any as ReturnType<typeof vi.fn>).mock.calls;
  const found = calls.find((c: any[]) => c[0] === channel);
  if (!found) throw new Error(`No handler registered for ${channel}`);
  return found[1] as Function;
}

function makeFakeWindow(opts: { destroyed?: boolean } = {}) {
  return {
    isDestroyed: vi.fn(() => !!opts.destroyed),
    webContents: { send: vi.fn() },
  };
}

/** Poll `send` until predicate passes — fs.watch/FSEvents latency can be ~100ms+. */
async function waitFor(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const startedAt = Date.now();
  while (!condition()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`waitFor timed out after ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('artifacts-watch (NR-PERF-07)', () => {
  let globalTempDir: string;
  let projectTempDir: string;
  let projectArtifactsDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    allWindows = [];
    globalTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'everfern-artifacts-watch-'));
    projectTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'everfern-artifacts-project-'));
    projectArtifactsDir = path.join(projectTempDir, '.everfern', 'artifacts');
    fs.mkdirSync(projectArtifactsDir, { recursive: true });
    vi.resetModules();
    ({
      registerArtifactWatchHandlers,
      disposeArtifactWatchers,
      __getProjectWatcherCountForTests,
      __isGlobalWatchActiveForTests,
    } = await import('../artifacts-watch'));
    registerArtifactWatchHandlers({ debounceMs: 50, globalDir: globalTempDir });
  });

  afterEach(async () => {
    disposeArtifactWatchers();
    // Let any in-flight debounce timers fire before the temp dirs vanish.
    await new Promise((resolve) => setTimeout(resolve, 100));
    fs.rmSync(globalTempDir, { recursive: true, force: true });
    fs.rmSync(projectTempDir, { recursive: true, force: true });
  });

  it('broadcasts a debounced { source: "global" } event when the global artifacts dir changes', async () => {
    const alive = makeFakeWindow();
    const destroyed = makeFakeWindow({ destroyed: true });
    allWindows = [alive, destroyed];

    fs.writeFileSync(path.join(globalTempDir, 'note.md'), 'hello');

    await waitFor(() =>
      (alive.webContents.send as any).mock.calls.some((c: any[]) => c[0] === 'artifacts:changed')
    );

    expect(alive.webContents.send).toHaveBeenCalledWith('artifacts:changed', { source: 'global' });
    expect(destroyed.webContents.send).not.toHaveBeenCalled();
    expect(__isGlobalWatchActiveForTests()).toBe(true);
  });

  it('dedupes watch-project calls for the same path and adds watchers for new paths', async () => {
    const handler = captureHandler('artifacts:watch-project');

    const first = await handler({} as any, projectTempDir);
    expect(first).toEqual({ success: true });
    expect(__getProjectWatcherCountForTests()).toBe(1);

    // Same path again — idempotent, no second watcher.
    const second = await handler({} as any, projectTempDir);
    expect(second).toEqual({ success: true });
    expect(__getProjectWatcherCountForTests()).toBe(1);

    // A different project path gets its own watcher.
    const otherProject = fs.mkdtempSync(path.join(os.tmpdir(), 'everfern-artifacts-project2-'));
    try {
      fs.mkdirSync(path.join(otherProject, '.everfern', 'artifacts'), { recursive: true });
      const third = await handler({} as any, otherProject);
      expect(third).toEqual({ success: true });
      expect(__getProjectWatcherCountForTests()).toBe(2);
    } finally {
      fs.rmSync(otherProject, { recursive: true, force: true });
    }
  });

  it('broadcasts { source: "project", projectPath } when a watched project artifacts dir changes', async () => {
    const alive = makeFakeWindow();
    allWindows = [alive];

    const handler = captureHandler('artifacts:watch-project');
    await handler({} as any, projectTempDir);

    fs.writeFileSync(path.join(projectArtifactsDir, 'report.html'), '<p>hi</p>');

    await waitFor(() =>
      (alive.webContents.send as any).mock.calls.some((c: any[]) => c[0] === 'artifacts:changed')
    );

    expect(alive.webContents.send).toHaveBeenCalledWith('artifacts:changed', {
      source: 'project',
      projectPath: path.resolve(projectTempDir),
    });
  });

  it('dispose closes every watcher and resets registration state', async () => {
    const handler = captureHandler('artifacts:watch-project');
    await handler({} as any, projectTempDir);
    expect(__getProjectWatcherCountForTests()).toBe(1);
    expect(__isGlobalWatchActiveForTests()).toBe(true);

    disposeArtifactWatchers();

    expect(__getProjectWatcherCountForTests()).toBe(0);
    expect(__isGlobalWatchActiveForTests()).toBe(false);

    // Fresh registration is possible again (registered flag was reset).
    registerArtifactWatchHandlers({ debounceMs: 50, globalDir: globalTempDir });
    expect(__isGlobalWatchActiveForTests()).toBe(true);
  });

  it('returns { success: false } for a project with no .everfern/artifacts dir, without adding a watcher', async () => {
    const handler = captureHandler('artifacts:watch-project');

    const emptyProject = fs.mkdtempSync(path.join(os.tmpdir(), 'everfern-artifacts-empty-'));
    try {
      const result = await handler({} as any, emptyProject);
      expect(result.success).toBe(false);
      expect((result as any).reason).toBe('dir-missing');
      expect(__getProjectWatcherCountForTests()).toBe(0);
    } finally {
      fs.rmSync(emptyProject, { recursive: true, force: true });
    }
  });

  it('rejects invalid projectPath values without throwing', async () => {
    const handler = captureHandler('artifacts:watch-project');

    const result = await handler({} as any, '');
    expect(result).toEqual({
      success: false,
      reason: 'invalid-path',
      error: 'projectPath must be a non-empty string',
    });
    expect(__getProjectWatcherCountForTests()).toBe(0);
  });
});
