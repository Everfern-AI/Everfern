/**
 * Skills-sync WSL tests (MP-XPLAT-04)
 *
 * syncSkillsToWSLAsync replaced a startup-blocking `execSync` WSL sync that:
 *  (a) blocked app launch up to 60s when WSL hung, and
 *  (b) mapped Windows paths via a drive-letter regex that broke on UNC
 *      paths (\\server\share\...) — producing garbage /mnt paths.
 *
 * Fix under test:
 *  - always resolves (never rejects; failures warn + are non-fatal)
 *  - non-win32 → no exec at all
 *  - UNC skills dir → skipped with a notice, no exec call
 *  - drive-letter path → wslpath tried first, /mnt/<drive>/ regex fallback
 *
 * Platform matrix: win32 (drive-letter / UNC / wslpath-success /
 * wslpath-failure) + darwin + linux.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { exec as cpExec } from 'child_process';

vi.mock('child_process', () => ({
  exec: vi.fn(),
}));

vi.mock('os', () => ({
  homedir: vi.fn(() => '/home/user'),
}));

// skills-sync imports skills-loader (fs-heavy); mock it out.
vi.mock('../../agent/runner/skills-loader', () => ({
  invalidateSkillsCache: vi.fn(),
  loadSkillsAsync: vi.fn(async () => []),
}));

const mockExec = vi.mocked(cpExec);

function mockExecImpl(impl: (cmd: string, cb: (err: any, stdout: string, stderr: string) => void) => void) {
  mockExec.mockImplementation(((cmd: string, _opts: any, cb: any) => {
    if (typeof cb !== 'function') cb = _opts;
    setImmediate(() => impl(cmd, cb));
  }) as any);
}

describe('syncSkillsToWSLAsync (MP-XPLAT-04)', () => {
  let originalPlatform: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    // Fresh module state per test
    vi.resetModules();
  });

  afterEach(() => {
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform);
    }
  });

  function setPlatform(platform: string) {
    Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  }

  async function importTarget() {
    const mod = await import('../skills-sync');
    return mod.syncSkillsToWSLAsync;
  }

  // ── Non-win32 matrix: never touches child_process ────────────────────────

  it.each(['darwin', 'linux'])(
    '%s: resolves without any exec call',
    async (platform) => {
      setPlatform(platform);
      const syncSkillsToWSLAsync = await importTarget();
      await expect(syncSkillsToWSLAsync('/home/user/.everfern/skills')).resolves.toBeUndefined();
      expect(mockExec).not.toHaveBeenCalled();
    }
  );

  // ── win32 + UNC: skipped with notice, no exec ────────────────────────────

  it('win32 + UNC skills dir: skips with notice, no exec call', async () => {
    setPlatform('win32');
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const syncSkillsToWSLAsync = await importTarget();
    const uncDir = '\\\\server\\share\\home\\user\\.everfern\\skills';
    await expect(syncSkillsToWSLAsync(uncDir)).resolves.toBeUndefined();

    expect(mockExec).not.toHaveBeenCalled();
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining('UNC paths cannot be mapped')
    );

    infoSpy.mockRestore();
    warnSpy.mockRestore();
  });

  // ── win32 + drive letter: wslpath first ──────────────────────────────────

  it('win32 + drive-letter path: uses wslpath mapping when it succeeds', async () => {
    setPlatform('win32');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    mockExecImpl((cmd, cb) => {
      if (cmd.includes('wslpath')) {
        cb(null, '/mnt/c/Users/user/.everfern/skills\n', '');
      } else {
        cb(null, '', '');
      }
    });

    const syncSkillsToWSLAsync = await importTarget();
    const skillsDir = 'C:\\Users\\user\\.everfern\\skills';
    await expect(syncSkillsToWSLAsync(skillsDir)).resolves.toBeUndefined();

    // wslpath was consulted with the (sh-quoted) Windows path
    expect(mockExec).toHaveBeenCalledWith(
      expect.stringContaining("wsl.exe --exec wslpath -- 'C:\\Users\\user\\.everfern\\skills'"),
      expect.objectContaining({ timeout: 60000 }),
      expect.any(Function)
    );
    // copy command uses the wslpath-mapped source
    expect(mockExec).toHaveBeenCalledWith(
      expect.stringContaining("cp -r '/mnt/c/Users/user/.everfern/skills/.' /everfern/skills/"),
      expect.anything(),
      expect.any(Function)
    );
    // No fallback warning — wslpath succeeded
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('falling back'));

    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('win32 + drive-letter path: falls back to /mnt/<drive>/ regex mapping when wslpath fails', async () => {
    setPlatform('win32');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    mockExecImpl((cmd, cb) => {
      if (cmd.includes('wslpath')) {
        cb(new Error('wslpath: command not found'), '', '');
      } else {
        cb(null, '', '');
      }
    });

    const syncSkillsToWSLAsync = await importTarget();
    const skillsDir = 'C:\\Users\\user\\.everfern\\skills';
    await expect(syncSkillsToWSLAsync(skillsDir)).resolves.toBeUndefined();

    // Fallback warning logged
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('falling back'));
    // Copy command uses the regex-derived /mnt/c/ path
    expect(mockExec).toHaveBeenCalledWith(
      expect.stringContaining("cp -r '/mnt/c/Users/user/.everfern/skills/.' /everfern/skills/"),
      expect.anything(),
      expect.any(Function)
    );

    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('win32 + wslpath returns non-/mnt garbage: falls back to regex mapping', async () => {
    setPlatform('win32');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    mockExecImpl((cmd, cb) => {
      if (cmd.includes('wslpath')) {
        cb(null, 'not-a-mount\n', '');
      } else {
        cb(null, '', '');
      }
    });

    const syncSkillsToWSLAsync = await importTarget();
    await expect(syncSkillsToWSLAsync('D:\\data\\skills')).resolves.toBeUndefined();

    expect(mockExec).toHaveBeenCalledWith(
      expect.stringContaining("cp -r '/mnt/d/data/skills/.' /everfern/skills/"),
      expect.anything(),
      expect.any(Function)
    );

    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('win32 + drive-letter path with apostrophe: sh-quotes safely for wslpath', async () => {
    setPlatform('win32');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    mockExecImpl((cmd, cb) => cb(new Error('wslpath fail'), '', ''));

    const syncSkillsToWSLAsync = await importTarget();
    await expect(syncSkillsToWSLAsync("C:\\Users\\o'brien\\.everfern\\skills")).resolves.toBeUndefined();

    // Apostrophe escaped sh-style ('\'') in the wslpath invocation
    const wslpathCall = mockExec.mock.calls.find((c: any[]) => String(c[0]).includes('wslpath'));
    expect(wslpathCall).toBeDefined();
    expect(String(wslpathCall![0])).toContain(String.raw`'C:\Users\o'\''brien\.everfern\skills'`);

    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('win32 + wslpath ok but copy fails: resolves with a non-fatal warning (no unhandled rejection)', async () => {
    setPlatform('win32');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    mockExecImpl((cmd, cb) => {
      if (cmd.includes('wslpath')) {
        cb(null, '/mnt/c/Users/user/.everfern/skills', '');
      } else {
        cb(new Error('WSL hung'), '', '');
      }
    });

    const syncSkillsToWSLAsync = await importTarget();
    await expect(syncSkillsToWSLAsync('C:\\Users\\user\\.everfern\\skills')).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('WSL skills sync failed (non-fatal)'));

    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('win32 + non-drive-letter, non-UNC path: skips with unsupported-path warning', async () => {
    setPlatform('win32');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    mockExecImpl((cmd, cb) => cb(new Error('wslpath fail'), '', ''));

    const syncSkillsToWSLAsync = await importTarget();
    await expect(syncSkillsToWSLAsync('relative/path/skills')).resolves.toBeUndefined();

    const wslListCalls = mockExec.mock.calls.filter((c: any[]) => !String(c[0]).includes('wslpath')).length;
    expect(wslListCalls).toBe(0); // no copy command ran
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('unsupported skills directory path'));

    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  // ── Async contract ────────────────────────────────────────────────────────

  it('returns a promise (async, non-blocking API shape)', async () => {
    setPlatform('win32');
    const syncSkillsToWSLAsync = await importTarget();
    const p = syncSkillsToWSLAsync('C:\\Users\\user\\.everfern\\skills');
    expect(p).toBeInstanceOf(Promise);
    await p;
  });
});
