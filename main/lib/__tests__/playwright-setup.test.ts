/**
 * MP-XPLAT-06 · playwright-setup shell:true removal — platform matrix.
 *
 * win32 with a .cmd bin: must exec cmd.exe /d /s /c with explicit args and
 * NO shell:true option. darwin/linux: exec the bin directly, no shell.
 * fs.existsSync is mocked false so findChromiumExecutable() returns null and
 * the install path is forced.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const execFileMock = vi.fn();
const existsSyncMock = vi.fn();

vi.mock('child_process', () => ({
  execFile: (...args: any[]) => execFileMock(...args),
  spawnSync: vi.fn(),
}));
vi.mock('fs', () => ({
  existsSync: (...args: any[]) => existsSyncMock(...args),
  readdirSync: vi.fn(() => []),
}));

import { ensurePlaywrightChromium } from '../playwright-setup';

const withPlatform = (platform: string, fn: () => void) => {
  const original = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  try {
    fn();
  } finally {
    if (original) Object.defineProperty(process, 'platform', original);
  }
};

describe('playwright-setup · ensurePlaywrightChromium (MP-XPLAT-06)', () => {
  beforeEach(() => {
    execFileMock.mockReset();
    existsSyncMock.mockReset();
    // Force the install path: no chromium exe, no local playwright bin.
    existsSyncMock.mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('win32 + .cmd bin: execFile("cmd.exe", ["/d","/s","/c",bin,...args]) with NO shell option', () => {
    withPlatform('win32', () => {
      // Local playwright.cmd "exists" so getPlaywrightBin picks it.
      existsSyncMock.mockImplementation((p: any) => String(p).endsWith('playwright.cmd'));

      ensurePlaywrightChromium();

      expect(execFileMock).toHaveBeenCalledTimes(1);
      const [cmd, args, opts, cb] = execFileMock.mock.calls[0];
      expect(cmd).toBe('cmd.exe');
      expect(args[0]).toBe('/d');
      expect(args[1]).toBe('/s');
      expect(args[2]).toBe('/c');
      expect(String(args[3]).endsWith('playwright.cmd')).toBe(true);
      expect(args.slice(4)).toEqual(['install', 'chromium']);
      expect(opts).toEqual({ timeout: 5 * 60 * 1000 }); // no shell:true
      expect(opts.shell).toBeUndefined();
      expect(typeof cb).toBe('function');
      // Callback drives completion without throwing.
      cb(null, 'done', '');
    });
  });

  it('darwin: execFile(bin, ["install","chromium"]) directly, no shell', () => {
    withPlatform('darwin', () => {
      ensurePlaywrightChromium();

      expect(execFileMock).toHaveBeenCalledTimes(1);
      const [cmd, args, opts, cb] = execFileMock.mock.calls[0];
      expect(String(cmd).endsWith('npx')).toBe(true);
      expect(args).toEqual(['playwright', 'install', 'chromium']); // npx fallback (no local bin)
      expect(opts).toEqual({ timeout: 5 * 60 * 1000 });
      expect(opts.shell).toBeUndefined();
      cb(null, '', '');
    });
  });

  it('linux: execFile(bin, ["install","chromium"]) directly, no shell', () => {
    withPlatform('linux', () => {
      ensurePlaywrightChromium();

      expect(execFileMock).toHaveBeenCalledTimes(1);
      const [cmd, args, opts, cb] = execFileMock.mock.calls[0];
      expect(String(cmd).endsWith('npx')).toBe(true);
      expect(args).toEqual(['playwright', 'install', 'chromium']);
      expect(opts).toEqual({ timeout: 5 * 60 * 1000 });
      expect(opts.shell).toBeUndefined();
      cb(null, '', '');
    });
  });

  it('win32 error callback: install failure logs instead of crashing', () => {
    withPlatform('win32', () => {
      existsSyncMock.mockImplementation((p: any) => String(p).endsWith('playwright.cmd'));
      const errLog = vi.spyOn(console, 'error').mockImplementation(() => {});
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});

      ensurePlaywrightChromium();
      const cb = execFileMock.mock.calls[0][3];
      expect(() => cb(new Error('install failed'), '', 'boom')).not.toThrow();
      expect(errLog).toHaveBeenCalledWith('[Playwright] Failed to install Chromium:', 'install failed');

      errLog.mockRestore();
      log.mockRestore();
    });
  });
});
