import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';

// ── Mock electron before importing the module under test ──
vi.mock('electron', () => ({
  app: {
    whenReady: vi.fn(async () => Promise.resolve()),
    getFileIcon: vi.fn(async () => ({ toDataURL: () => 'data:image/png;base64,TEST' })),
  },
  shell: { openPath: vi.fn(async () => '') },
}));

// Mock fs with a controllable existsSync that delegates to the real fs by default.
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  (globalThis as any).__actualFsExistsSync = actual.existsSync;
  const existsSync = vi.fn(actual.existsSync);
  return { ...actual, default: { ...actual, existsSync }, existsSync };
});

// ── Mock winreg via a scriptable registry database ──
// Keys are stored under their `key` path (e.g. "\.md\OpenWithProgids");
// default (unnamed) values live in a separate map, mirroring `get('')`.
type RegValue = { name: string; type: string; value: string };
const winregState = {
  values: new Map<string, RegValue[]>(),
  defaults: new Map<string, string>(),
};

class WinregMock {
  static HKCR = 'HKCR';
  hive: string;
  key: string;
  constructor(opts: { hive: string; key: string }) {
    this.hive = opts.hive;
    this.key = opts.key;
  }
  values(cb: (err: Error | null, values: RegValue[]) => void) {
    if (winregState.values.has(this.key)) cb(null, winregState.values.get(this.key)!);
    else cb(new Error(`key not found: ${this.key}`), []);
  }
  get(name: string, cb: (err: Error | null, item: { name: string; value: string } | null) => void) {
    const def = winregState.defaults.get(this.key);
    if (def !== undefined && name === '') cb(null, { name: '(Default)', value: def });
    else cb(new Error(`value not found: ${this.key}/${name}`), null);
  }
}

let winregAvailable = true;
vi.mock('winreg', () => {
  if (!winregAvailable) throw new Error('winreg unavailable');
  return { default: WinregMock, __esModule: true };
});

import { getAppsForFile } from '../file-associations';

const existsSyncMock = vi.mocked(fs.existsSync);
const actualExistsSync = (p: fs.PathLike) =>
  (globalThis as any).__actualFsExistsSync(p) as boolean;

describe('file-associations — getWindowsApps (MP-XPLAT-02)', () => {
  let originalPlatform: PropertyDescriptor;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    winregState.values.clear();
    winregState.defaults.clear();
    winregAvailable = true;
    originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;
    Object.defineProperty(process, 'platform', {
      value: 'win32',
      configurable: true,
    });
    existsSyncMock.mockImplementation(((p: fs.PathLike) => actualExistsSync(p)) as any);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.resetModules();
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', originalPlatform);
    warnSpy.mockRestore();
  });

  it('Strategy 1: OpenWithProgids values → ProgId command default → app added', async () => {
    winregState.values.set('\\.md\\OpenWithProgids', [
      { name: 'VSCode.md', type: 'REG_SZ', value: '' },
      { name: 'txtfile', type: 'REG_SZ', value: '' },
    ]);
    winregState.defaults.set(
      '\\VSCode.md\\shell\\open\\command',
      '"C:\\Apps\\Code.exe" "%1"'
    );

    existsSyncMock.mockImplementation(((p: fs.PathLike) =>
      String(p).toLowerCase() === 'c:\\apps\\code.exe' ? true : actualExistsSync(p)
    ) as any);

    const { getAppsForFile: fresh } = await import('../file-associations');
    const apps = await fresh('notes.md');

    const code = apps.find((a) => a.path.toLowerCase() === 'c:\\apps\\code.exe');
    expect(code).toBeDefined();
    expect(code!.name).toBe('Code'); // basename of Code.exe, capitalized
    expect(code!.icon).toBe('data:image/png;base64,TEST');
    // txtfile has no command default → no bogus entry
    expect(apps.find((a) => a.path.includes('txtfile'))).toBeUndefined();
  });

  it('Strategy 1: unquoted command value with trailing args is parsed correctly', async () => {
    winregState.values.set('\\.py\\OpenWithProgids', [
      { name: 'Python.File', type: 'REG_SZ', value: '' },
    ]);
    winregState.defaults.set(
      '\\Python.File\\shell\\open\\command',
      'C:\\Python\\python.exe "%1" %*'
    );

    existsSyncMock.mockImplementation(((p: fs.PathLike) =>
      String(p).toLowerCase() === 'c:\\python\\python.exe' ? true : actualExistsSync(p)
    ) as any);

    const { getAppsForFile: fresh } = await import('../file-associations');
    const apps = await fresh('script.py');

    const py = apps.find((a) => a.path.toLowerCase() === 'c:\\python\\python.exe');
    expect(py).toBeDefined();
    expect(py!.name).toBe('Python');
  });

  it('Strategy 2: OpenWithList exe name → resolved via fs probe of common dirs', async () => {
    winregState.values.set('\\.txt\\OpenWithList', [
      { name: 'NOTEPAD.EXE', type: 'REG_NONE', value: '' },
      { name: 'MRUList', type: 'REG_SZ', value: 'abc' }, // non-.exe → ignored
    ]);

    const systemRoot = process.env.SystemRoot || 'C:\\Windows';
    const notepadPath = `${systemRoot}\\System32\\NOTEPAD.EXE`;
    existsSyncMock.mockImplementation(((p: fs.PathLike) =>
      String(p).toLowerCase() === notepadPath.toLowerCase() ? true : actualExistsSync(p)
    ) as any);

    const { getAppsForFile: fresh } = await import('../file-associations');
    const apps = await fresh('readme.txt');

    const notepad = apps.find((a) => a.path.toLowerCase() === notepadPath.toLowerCase());
    expect(notepad).toBeDefined();
    expect(notepad!.name).toBe('Notepad');
  });

  it('registry error path → resolves to list without throwing; empty-registry warns once per ext', async () => {
    // No registry content at all → both strategies yield zero apps.
    existsSyncMock.mockReturnValue(false);

    const { getAppsForFile: fresh } = await import('../file-associations');
    const apps = await fresh('zzz-unknown');

    expect(Array.isArray(apps)).toBe(true);
    // No apps anywhere (registry empty, known editors all miss) → warn surfaced
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('No apps found via registry for .zzz-unknown')
    );
  });

  it('empty registry + known editor present → editor included, no empty-registry warn', async () => {
    winregState.values.clear();
    const systemRoot = process.env.SystemRoot || 'C:\\Windows';
    const notepadPath = `${systemRoot}\\System32\\notepad.exe`;
    existsSyncMock.mockImplementation(((p: fs.PathLike) =>
      String(p).toLowerCase() === notepadPath.toLowerCase() ? true : actualExistsSync(p)
    ) as any);

    const { getAppsForFile: fresh } = await import('../file-associations');
    const apps = await fresh('readme.txt');

    expect(apps.length).toBeGreaterThan(0);
    expect(apps.find((a) => a.name === 'Notepad')).toBeDefined();
    // Registry empty → empty-registry state surfaced (known editors appended)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('No apps found via registry for .txt')
    );
  });

  it('winreg missing (load throws) → graceful degradation to known editors list', async () => {
    winregAvailable = false;
    vi.resetModules();

    const systemRoot = process.env.SystemRoot || 'C:\\Windows';
    const notepadPath = `${systemRoot}\\System32\\notepad.exe`;
    existsSyncMock.mockImplementation(((p: fs.PathLike) =>
      String(p).toLowerCase() === notepadPath.toLowerCase() ? true : actualExistsSync(p)
    ) as any);

    const { getAppsForFile: fresh } = await import('../file-associations');
    const apps = await fresh('notes.txt');

    expect(Array.isArray(apps)).toBe(true);
    expect(apps.find((a) => a.name === 'Notepad')).toBeDefined();
  });

  it('non-win32 platform never loads winreg (linux path, darwin dispatch unaffected)', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    existsSyncMock.mockReturnValue(false);

    const { getAppsForFile: fresh } = await import('../file-associations');
    const apps = await fresh('notes.md');

    // No crash; linux strategy returns empty (no desktop files matched in mock env)
    expect(Array.isArray(apps)).toBe(true);
    // No registry warn on non-win32 — warn is win32-registry-specific
    expect(warnSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('No apps found via registry')
    );
  });
});
