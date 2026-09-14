import { app, nativeImage, BrowserWindow } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Resolves the absolute path to the application icon for the current platform.
 * Supports Windows (.ico), macOS (.icns / .png), and Linux (.png).
 */
export function getAppIconPath(): string {
  const isWin = process.platform === 'win32';
  const isMac = process.platform === 'darwin';

  const preferredIcon = isWin
    ? 'everfern.ico'
    : isMac
    ? 'everfern.icns'
    : 'everfern-rounded.png';

  const fallbackIcons = ['everfern-rounded.png', 'everfern.png', 'everfern.ico'];

  const appPath = typeof app?.getAppPath === 'function' ? app.getAppPath() : '';
  const resPath = process.resourcesPath || '';

  const searchDirs = [
    path.join(__dirname, '../../public/images/logos'),
    path.join(__dirname, '../public/images/logos'),
    path.join(__dirname, '../../../public/images/logos'),
    path.join(resPath, 'public/images/logos'),
    path.join(resPath, 'images/logos'),
    path.join(appPath, 'public/images/logos'),
    path.join(appPath, 'dist-electron/public/images/logos'),
    path.join(process.cwd(), 'public/images/logos'),
  ];

  // First look for platform's preferred icon
  for (const dir of searchDirs) {
    const candidate = path.join(dir, preferredIcon);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  // Fallback to other icon formats
  for (const iconName of fallbackIcons) {
    for (const dir of searchDirs) {
      const candidate = path.join(dir, iconName);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return '';
}

/**
 * Returns an Electron NativeImage for the application icon if available.
 */
export function getAppIcon(): Electron.NativeImage | undefined {
  const iconPath = getAppIconPath();
  if (iconPath && typeof nativeImage?.createFromPath === 'function') {
    const image = nativeImage.createFromPath(iconPath);
    if (!image.isEmpty()) {
      return image;
    }
  }
  if (typeof nativeImage?.createEmpty === 'function') {
    return nativeImage.createEmpty();
  }
  return undefined;
}

/**
 * Reliably sets the window icon on the given BrowserWindow instance.
 * Dispatches WM_SETICON on Windows to ensure taskbar shows the correct logo.
 */
export function setupWindowIcon(window: BrowserWindow | null): void {
  if (!window || typeof window.setIcon !== 'function') return;

  try {
    const iconPath = getAppIconPath();
    if (iconPath) {
      if (typeof nativeImage?.createFromPath === 'function') {
        const icon = nativeImage.createFromPath(iconPath);
        if (!icon.isEmpty()) {
          window.setIcon(icon);
          return;
        }
      }
      window.setIcon(iconPath);
    }
  } catch (err) {
    console.warn('[AppIcon] Failed to set window icon:', err);
  }
}
