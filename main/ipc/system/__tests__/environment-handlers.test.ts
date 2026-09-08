/**
 * Environment handlers tests (MP-XPLAT-03)
 *
 * `system:installWSL` previously held the IPC handler for up to 3 minutes
 * while a UAC prompt sat on screen (both the non-elevated exec AND the
 * elevated PowerShell fallback were awaited with 180s timeouts) — renderer
 * calls timed out and the app seemed frozen.
 *
 * Fix under test:
 *  - elevated fallback spawns DETACHED (spawn + unref, never awaited)
 *  - handler returns immediately with { success: true, warning }
 *  - background poll (unref'd setTimeout chain, max ~5 min) checks WSL
 *    liveness via `wsl.exe -l -q` and broadcasts
 *    'system:wsl-install-progress' { stage } to all non-destroyed windows
 *  - non-win32 platforms fail fast with { success: false, error }
 *
 * Platform matrix: darwin / linux / win32.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ipcMain, BrowserWindow } from 'electron';
import * as child_process from 'child_process';

// ── Mocks ────────────────────────────────────────────────────────────────

let allWindows: any[] = [];

vi.mock('electron', () => {
  const handlers = new Map<string, Function>();
  return {
    ipcMain: {
      handle: vi.fn((channel: string, fn: Function) => {
        handlers.set(channel, fn);
      }),
    },
    BrowserWindow: {
      getAllWindows: vi.fn(() => allWindows),
      fromWebContents: vi.fn(),
    },
    app: {},
    nativeImage: {},
  };
});

vi.mock('child_process', () => ({
  exec: vi.fn(),
  execFile: vi.fn(),
  spawn: vi.fn(() => ({ unref: vi.fn() })),
}));

// linux-vm-executor: keep registerEnvironmentHandlers from pulling heavy deps
vi.mock('../../../agent/tools/linux-vm-executor', () => ({
  ensureDockerContainer: vi.fn(),
  checkEnvironmentDependencies: vi.fn(),
  setupEnvironmentDependencies: vi.fn(),
}));

vi.mock('../../../ocr/ocr', () => ({
  ocrProgressEmitter: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────

// NOTE: imported dynamically per-test (vi.resetModules) because the module
// keeps a `wslInstallPollActive` guard — a poll chain left "active" by a
// previous test would block later polls.
let registerEnvironmentHandlers: () => void;

const mockExec = vi.mocked(child_process.exec);
const mockExecFile = vi.mocked(child_process.execFile);
const mockSpawn = vi.mocked(child_process.spawn);

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

/** exec mock that invokes the callback asynchronously (like real exec). */
function mockExecImpl(impl: (cmd: string, cb: (err: any, stdout: string, stderr: string) => void) => void) {
  mockExec.mockImplementation(((cmd: string, _opts: any, cb: any) => {
    if (typeof cb !== 'function') cb = _opts;
    setImmediate(() => impl(cmd, cb));
  }) as any);
}

/** execFile mock that invokes the callback asynchronously (like real execFile). */
function mockExecFileImpl(impl: (file: string, cb: (err: any, stdout: string) => void) => void) {
  mockExecFile.mockImplementation(((file: string, _a: any, _o: any, cb: any) => {
    if (typeof cb !== 'function') cb = _a;
    setImmediate(() => impl(file, cb));
  }) as any);
}

/** Give pending (real) setImmediate callbacks one event-loop turn to settle. */
async function flushAsync(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

describe('environment-handlers — system:installWSL (MP-XPLAT-03)', () => {
  let originalPlatform: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Only fake setTimeout/clearTimeout — setImmediate must run for real so
    // mocked exec/execFile callbacks resolve inside the handler.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    allWindows = [];
    // Fresh module state per test (resets the wslInstallPollActive guard)
    vi.resetModules();
    ({ registerEnvironmentHandlers } = await import('../environment-handlers'));
    registerEnvironmentHandlers();
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform);
    }
  });

  function setPlatform(platform: string) {
    Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  }

  // ── Platform matrix: fail-fast on non-win32 ─────────────────────────────

  it.each(['darwin', 'linux'])(
    'returns { success: false, error } on %s without spawning anything',
    async (platform) => {
      setPlatform(platform);
      const handler = captureHandler('system:installWSL');
      const result = await handler({} as any);

      expect(result).toEqual({ success: false, error: 'WSL is only available on Windows' });
      expect(mockExec).not.toHaveBeenCalled();
      expect(mockSpawn).not.toHaveBeenCalled();
    }
  );

  // ── win32 happy path: primary install succeeds ───────────────────────────

  it('win32: returns { success: true } when the primary install succeeds', async () => {
    setPlatform('win32');
    mockExecImpl((cmd, cb) => cb(null, 'done', ''));

    const handler = captureHandler('system:installWSL');
    const result = await handler({} as any);

    expect(mockExec).toHaveBeenCalledWith(
      'wsl.exe --install -d Ubuntu --no-launch',
      expect.objectContaining({ timeout: 180000 }),
      expect.any(Function)
    );
    expect(mockSpawn).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true });
  });

  // ── win32 fallback: detached elevated install, handler NOT held ────────

  it('win32: primary fails → spawns detached elevated PowerShell, returns immediately with warning', async () => {
    setPlatform('win32');
    // Primary non-elevated install fails
    mockExecImpl((cmd, cb) => cb(new Error('requires elevation'), '', ''));

    const handler = captureHandler('system:installWSL');
    const startedAt = Date.now();
    const result = await handler({} as any);
    const elapsedMs = Date.now() - startedAt;

    // Handler must resolve immediately (no 180s hold)
    expect(elapsedMs).toBeLessThan(1000);

    // Elevated process spawned DETACHED, never awaited
    expect(mockSpawn).toHaveBeenCalledWith(
      'powershell.exe',
      ['-NoProfile', '-Command', "Start-Process wsl.exe -ArgumentList '--install -d Ubuntu --no-launch' -Verb RunAs"],
      { detached: true, stdio: 'ignore' }
    );
    const spawned = mockSpawn.mock.results[0]?.value as any;
    expect(spawned?.unref).toHaveBeenCalled();

    // Renderer contract: success + warning, no error
    expect(result).toEqual({
      success: true,
      warning: 'Elevated install launched — UAC approval required; installation continues in the background.',
    });
    expect(result.success).toBe(true);
    expect((result as any).error).toBeUndefined();
  });

  it('win32: returns { success: false, error } when even the detached spawn fails', async () => {
    setPlatform('win32');
    mockExecImpl((cmd, cb) => cb(new Error('primary failed'), '', ''));
    mockSpawn.mockImplementation(() => {
      throw new Error('spawn failed');
    });

    const handler = captureHandler('system:installWSL');
    const result = await handler({} as any);

    expect(result.success).toBe(false);
    expect((result as any).error).toBe('spawn failed');

    // Restore the default detached-spawn mock for subsequent tests
    mockSpawn.mockImplementation(() => ({ unref: vi.fn() }) as any);
  });

  // ── Background liveness poll ─────────────────────────────────────────────

  it('polls WSL liveness and broadcasts progress to all non-destroyed windows; stops on install', async () => {
    setPlatform('win32');
    mockExecImpl((cmd, cb) => cb(new Error('requires elevation'), '', '')); // trigger fallback

    const alive = makeFakeWindow();
    const destroyed = makeFakeWindow({ destroyed: true });
    allWindows = [alive, destroyed];

    // First poll: WSL not ready (execFile errors) → 'pending'
    // Second poll: distros appear ('\x00\x00Ubuntu') → 'installed', polling stops
    let pollCount = 0;
    mockExecFileImpl((file, cb) => {
      pollCount += 1;
      if (pollCount === 1) {
        cb(new Error('WslNotInstalled'), '');
      } else {
        cb(null, '\x00\x00Ubuntu');
      }
    });

    const handler = captureHandler('system:installWSL');
    await handler({} as any);

    // First tick (~5s later)
    await vi.advanceTimersByTimeAsync(5000);
    await flushAsync();
    expect(mockExecFile).toHaveBeenCalledWith('wsl.exe', ['-l', '-q'], expect.anything(), expect.any(Function));
    expect(alive.webContents.send).toHaveBeenCalledWith('system:wsl-install-progress', { stage: 'pending' });

    // Second tick: distros present → installed
    await vi.advanceTimersByTimeAsync(5000);
    await flushAsync();
    expect(alive.webContents.send).toHaveBeenCalledWith('system:wsl-install-progress', { stage: 'installed' });

    // Destroyed windows never receive anything
    expect(destroyed.webContents.send).not.toHaveBeenCalled();

    // Polling stopped — further time passes with no more execFile calls or sends
    const execFileCallsAfterStop = mockExecFile.mock.calls.length;
    const sendsAfterStop = alive.webContents.send.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30000);
    await flushAsync();
    expect(mockExecFile.mock.calls.length).toBe(execFileCallsAfterStop);
    expect(alive.webContents.send.mock.calls.length).toBe(sendsAfterStop);
  });

  it('stops polling after ~5 minutes even if WSL never appears', async () => {
    setPlatform('win32');
    mockExecImpl((cmd, cb) => cb(new Error('requires elevation'), '', ''));
    mockExecFileImpl((file, cb) => cb(new Error('WslNotInstalled'), ''));

    const alive = makeFakeWindow();
    allWindows = [alive];

    const handler = captureHandler('system:installWSL');
    await handler({} as any);

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1000);
    await flushAsync();

    // 60 max ticks — never more
    const wslListCalls = mockExecFile.mock.calls.filter(
      (c: any[]) => c[0] === 'wsl.exe' && JSON.stringify(c[1]) === '["-l","-q"]'
    ).length;
    expect(wslListCalls).toBeLessThanOrEqual(60);
    expect(alive.webContents.send).toHaveBeenCalledWith('system:wsl-install-progress', { stage: 'pending' });
  });

  it('broadcasts only once-per-stage per window when multiple fallbacks occur (single poll chain)', async () => {
    setPlatform('win32');
    mockExecImpl((cmd, cb) => cb(new Error('requires elevation'), '', ''));
    mockExecFileImpl((file, cb) => cb(new Error('WslNotInstalled'), ''));

    const alive = makeFakeWindow();
    allWindows = [alive];

    const handler = captureHandler('system:installWSL');
    await handler({} as any);
    await handler({} as any); // second install attempt while poll is active

    await vi.advanceTimersByTimeAsync(5000);
    await flushAsync();
    // One poll chain only: first tick triggered exactly one execFile call
    expect(
      mockExecFile.mock.calls.filter((c: any[]) => c[0] === 'wsl.exe' && JSON.stringify(c[1]) === '["-l","-q"]').length
    ).toBe(1);
    expect(alive.webContents.send.mock.calls.filter((c: any[]) => c[1]?.stage === 'pending').length).toBe(1);
  });
});
