import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';

// ── Mock electron before importing the module under test ──
vi.mock('electron', () => ({
  app: {
    getFileIcon: vi.fn(async () => ({ toDataURL: () => 'data:image/png;base64,TEST' })),
  },
}));

// Mock fs with a controllable existsSync that delegates to the real fs by default.
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  (globalThis as any).__actualFsExistsSync = actual.existsSync;
  const existsSync = vi.fn(actual.existsSync);
  return { ...actual, default: { ...actual, existsSync }, existsSync };
});

// Capture every execFile call: every call must be shell-free (args array form).
// Signature-preserving mock: delegates args to a scriptable handler.
const execFileCalls: Array<{ cmd: string; args: string[] }> = [];
let execFileHandler: ((cmd: string, args: string[], cb: (err: Error | null, stdout: string) => void) => void) | null = null;

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    execFile: vi.fn(((...argv: any[]) => {
      const cmd = String(argv[0]);
      const args = Array.isArray(argv[1]) ? argv[1] : [];
      execFileCalls.push({ cmd, args });
      const cb = argv[argv.length - 1];
      if (typeof cb === 'function') {
        if (execFileHandler) execFileHandler(cmd, args, cb);
        else cb(new Error('not found'), '');
      } else {
        // promisified form — not used by getLinuxBrowsers; fail via throw is
        // not needed since whichFallback only uses the callback form.
      }
    }) as any),
  };
});

import { getAvailableBrowsers } from '../browser-detector';

const existsSyncMock = vi.mocked(fs.existsSync);
const actualExistsSync = (p: fs.PathLike) =>
  (globalThis as any).__actualFsExistsSync(p) as boolean;

describe('browser-detector — getLinuxBrowsers (MP-XPLAT-02)', () => {
  let originalPlatform: PropertyDescriptor;

  beforeEach(() => {
    vi.clearAllMocks();
    execFileCalls.length = 0;
    execFileHandler = null;
    originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;
    Object.defineProperty(process, 'platform', {
      value: 'linux',
      configurable: true,
    });
    existsSyncMock.mockImplementation(((p: fs.PathLike) => actualExistsSync(p)) as any);
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', originalPlatform);
  });

  it('linux: fs probe hit → Chrome entry, ZERO subprocess invocations', async () => {
    existsSyncMock.mockImplementation(((p: fs.PathLike) =>
      String(p) === '/usr/bin/google-chrome' ? true : actualExistsSync(p)
    ) as any);

    const browsers = await getAvailableBrowsers();
    const chrome = browsers.find((b) => b.id === 'chrome');

    expect(chrome).toBeDefined();
    expect(chrome!.path).toBe('/usr/bin/google-chrome');
    expect(chrome!.name).toBe('Google Chrome');
    expect(chrome!.engine).toBe('chromium');
    expect(chrome!.logo).toBe('data:image/png;base64,TEST');
    // fs probe sufficed for the found candidate — `which` never invoked for it
    expect(
      execFileCalls.find((c) => c.cmd === 'which' && c.args[0] === 'google-chrome')
    ).toBeUndefined();
  });

  it('linux: fs probe misses → execFile("which", [bin]) fallback, args-array form (no shell)', async () => {
    execFileHandler = (cmd, args, cb) => {
      // Simulate `which` resolving firefox only, nothing else
      if (cmd === 'which' && args[0] === 'firefox') cb(null, '/opt/custom/firefox\n');
      else cb(new Error('which: no X in (path)'), '');
    };
    existsSyncMock.mockImplementation(((p: fs.PathLike) =>
      String(p) === '/opt/custom/firefox' ? true : false
    ) as any);

    const browsers = await getAvailableBrowsers();
    const firefox = browsers.find((b) => b.id === 'firefox');

    expect(firefox).toBeDefined();
    expect(firefox!.path).toBe('/opt/custom/firefox');
    expect(firefox!.engine).toBe('firefox');

    // Fallback mechanics: execFile with args array, never a shell string
    const whichCalls = execFileCalls.filter((c) => c.cmd === 'which');
    expect(whichCalls.length).toBeGreaterThan(0);
    for (const call of whichCalls) {
      expect(Array.isArray(call.args)).toBe(true);
      expect(call.args.length).toBe(1);
      expect(typeof call.args[0]).toBe('string');
    }
  });

  it('linux: `which` itself missing (ENOENT) → silent fail, other candidates continue', async () => {
    execFileHandler = (_cmd, _args, cb) =>
      cb(Object.assign(new Error('spawn which ENOENT'), { code: 'ENOENT' }), '');

    // google-chrome-stable present in /usr/local/bin (fs probe hits before fallback)
    existsSyncMock.mockImplementation(((p: fs.PathLike) =>
      String(p) === '/usr/local/bin/google-chrome-stable' ? true : false
    ) as any);

    const browsers = await getAvailableBrowsers();
    const chrome = browsers.find((b) => b.id === 'chrome-stable');
    expect(chrome).toBeDefined();
    expect(chrome!.path).toBe('/usr/local/bin/google-chrome-stable');

    // Missing-`which` never crashed the loop — the found candidate skipped fallback
    expect(
      execFileCalls.find((c) => c.cmd === 'which' && c.args[0] === 'google-chrome-stable')
    ).toBeUndefined();
  });

  it('linux: all probes fail → empty list, no crash', async () => {
    execFileHandler = (_cmd, _args, cb) => cb(new Error('which: not found'), '');
    existsSyncMock.mockReturnValue(false);

    const browsers = await getAvailableBrowsers();
    expect(browsers).toEqual([]);
    // one which attempt per candidate — none resolved
    expect(execFileCalls.filter((c) => c.cmd === 'which').length).toBe(8);
  });

  it('platform matrix: darwin/win32 dispatch never invokes `which` (linux-only probe)', async () => {
    execFileHandler = (_cmd, _args, cb) => cb(new Error('not found'), '');
    existsSyncMock.mockReturnValue(false);

    for (const p of ['darwin', 'win32'] as const) {
      execFileCalls.length = 0;
      Object.defineProperty(process, 'platform', { value: p, configurable: true });
      const browsers = await getAvailableBrowsers();
      expect(Array.isArray(browsers)).toBe(true);
      expect(execFileCalls.filter((c) => c.cmd === 'which').length).toBe(0);
    }
  });
});
