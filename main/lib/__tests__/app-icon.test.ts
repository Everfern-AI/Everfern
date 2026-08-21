import { describe, it, expect, vi } from 'vitest';
import { getAppIconPath, getAppIcon, setupWindowIcon } from '../app-icon';
import * as fs from 'fs';

describe('app-icon resolver', () => {
  it('should find a valid icon path on the filesystem', () => {
    const iconPath = getAppIconPath();
    expect(iconPath).toBeTruthy();
    expect(fs.existsSync(iconPath)).toBe(true);
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
