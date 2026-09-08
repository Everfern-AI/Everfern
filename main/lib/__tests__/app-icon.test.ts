import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import { getAppIconPath, getAppIcon, setupWindowIcon, resetAppIconPathCacheForTests } from '../app-icon';

// Mock fs with a controllable existsSync that delegates to the real fs by default.
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  (globalThis as any).__actualFsExistsSync = actual.existsSync;
  const existsSync = vi.fn(actual.existsSync);
  return { ...actual, default: { ...actual, existsSync }, existsSync };
});

const existsSyncMock = vi.mocked(fs.existsSync);
const actualExistsSync = (p: fs.PathLike) => (globalThis as any).__actualFsExistsSync(p) as boolean;

describe('app-icon resolver', () => {
  beforeEach(() => {
    resetAppIconPathCacheForTests();
    existsSyncMock.mockImplementation(((p: fs.PathLike) => actualExistsSync(p)) as any);
  });

  it('should find a valid icon path on the filesystem', () => {
    const iconPath = getAppIconPath();
    expect(iconPath).toBeTruthy();
    expect(actualExistsSync(iconPath)).toBe(true);
  });

  it('should handle getAppIcon safely', () => {
    const image = getAppIcon();
    // In Node test environment, returns undefined or image object safely without crashing
    expect(image === undefined || typeof image === 'object').toBe(true);
  });

  it('should call setIcon on BrowserWindow instance', () => {
    const mockWindow = {
      setIcon: vi.fn(),
    } as any;

    setupWindowIcon(mockWindow);
    expect(mockWindow.setIcon).toHaveBeenCalled();
  });
});

/**
 * MP-XPLAT-06: getAppIconPath must memoize its probe — one fs probe pass per
 * process, covering both success and '' failure outcomes, across all
 * platforms (icon name selection differs: win32→everfern.ico,
 * darwin→everfern.icns, linux→everfern-rounded.png).
 */
describe('app-icon probe memoization (MP-XPLAT-06)', () => {
  const platforms = ['win32', 'darwin', 'linux'];
  let originalPlatform: string;

  beforeEach(() => {
    resetAppIconPathCacheForTests();
    originalPlatform = process.platform;
    existsSyncMock.mockReset();
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
      configurable: true,
    });
  });

  platforms.forEach((platform) => {
    describe(`platform=${platform}`, () => {
      beforeEach(() => {
        Object.defineProperty(process, 'platform', {
          value: platform,
          configurable: true,
        });
      });

      it('second call performs ZERO additional fs.existsSync probes (hit)', () => {
        existsSyncMock.mockReturnValue(true); // first candidate hits

        resetAppIconPathCacheForTests();
        const first = getAppIconPath();
        expect(first).toBeTruthy();

        const probesAfterFirst = existsSyncMock.mock.calls.length;
        expect(probesAfterFirst).toBeGreaterThan(0);

        const second = getAppIconPath();
        const third = getAppIconPath();

        // No additional probing after the first (successful) resolution
        expect(existsSyncMock.mock.calls.length).toBe(probesAfterFirst);
        expect(second).toBe(first);
        expect(third).toBe(first);
      });

      it("failure ('') is also cached — no re-probe after miss", () => {
        existsSyncMock.mockReturnValue(false); // nothing found anywhere

        resetAppIconPathCacheForTests();
        const first = getAppIconPath();
        expect(first).toBe('');

        const probesAfterFirst = existsSyncMock.mock.calls.length;
        expect(probesAfterFirst).toBeGreaterThan(0);

        expect(getAppIconPath()).toBe('');
        expect(getAppIconPath()).toBe('');

        expect(existsSyncMock.mock.calls.length).toBe(probesAfterFirst);
      });
    });
  });

  it('probe respects platform preferred icon name (preferred first, then fallbacks)', () => {
    const seen: string[] = [];
    existsSyncMock.mockImplementation(((p: any) => {
      seen.push(String(p));
      return false;
    }) as any);

    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    resetAppIconPathCacheForTests();
    getAppIconPath();

    // The very first probed candidate must be the win32 preferred icon
    expect(seen[0]).toContain('everfern.ico');
    // Probe order: preferred icon across all dirs, then fallback icons
    expect(seen.some((p) => p.includes('everfern-rounded.png'))).toBe(true);
    expect(seen.some((p) => p.includes('everfern.png'))).toBe(true);

    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    seen.length = 0;
    resetAppIconPathCacheForTests();
    getAppIconPath();
    expect(seen[0]).toContain('everfern.icns');

    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    seen.length = 0;
    resetAppIconPathCacheForTests();
    getAppIconPath();
    expect(seen[0]).toContain('everfern-rounded.png');
  });
});
