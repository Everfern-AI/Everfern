/**
 * EverFern Desktop — Playwright Chromium Setup
 *
 * Checks whether the Playwright Chromium browser executable is present and,
 * if not, runs `playwright install chromium` in the background so the
 * web-search and web-crawl local-mode tools work out of the box.
 *
 * The check is non-blocking: it runs after the window is ready and any
 * failure is logged but never surfaces as a fatal error.
 */

import { execFile, spawnSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

// Playwright stores its browsers under this directory by default.
function getPlaywrightBrowsersPath(): string {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) {
    return process.env.PLAYWRIGHT_BROWSERS_PATH;
  }
  switch (process.platform) {
    case 'win32':
      return path.join(process.env.LOCALAPPDATA ?? path.join(process.env.USERPROFILE ?? '', 'AppData', 'Local'), 'ms-playwright');
    case 'darwin':
      return path.join(process.env.HOME ?? '', 'Library', 'Caches', 'ms-playwright');
    default:
      return path.join(process.env.HOME ?? '', '.cache', 'ms-playwright');
  }
}

/** Returns the path to the Chromium executable if it exists, otherwise null. */
function findChromiumExecutable(): string | null {
  const browsersPath = getPlaywrightBrowsersPath();
  if (!fs.existsSync(browsersPath)) return null;

  let dirs: string[];
  try {
    dirs = fs.readdirSync(browsersPath).filter(d => d.startsWith('chromium'));
  } catch {
    return null;
  }

  for (const dir of dirs) {
    // Check platform-specific executable paths
    const candidates =
      process.platform === 'win32'
        ? [
            path.join(browsersPath, dir, 'chrome-win64', 'chrome.exe'),
            path.join(browsersPath, dir, 'chrome-win', 'chrome.exe'),
          ]
        : process.platform === 'darwin'
        ? [
            path.join(browsersPath, dir, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
          ]
        : [
            path.join(browsersPath, dir, 'chrome-linux', 'chrome'),
          ];

    for (const exe of candidates) {
      if (fs.existsSync(exe)) return exe;
    }
  }

  return null;
}

function getPlaywrightBin(): { bin: string; args: string[] } {
  // Try the local node_modules/.bin/playwright first
  const binDir = path.join(__dirname, '..', '..', 'node_modules', '.bin');
  const localBin = process.platform === 'win32'
    ? path.join(binDir, 'playwright.cmd')
    : path.join(binDir, 'playwright');

  if (fs.existsSync(localBin)) {
    return { bin: localBin, args: ['install', 'chromium'] };
  }

  // Fall back to npx
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  return { bin: npx, args: ['playwright', 'install', 'chromium'] };
}

export function ensurePlaywrightChromium(): void {
  const exe = findChromiumExecutable();
  if (exe) {
    console.log(`[Playwright] Chromium found at: ${exe}`);
    return;
  }

  console.log('[Playwright] Chromium executable not found — running `playwright install chromium`...');

  const { bin, args } = getPlaywrightBin();

  // On Windows, .cmd files need to be executed via cmd /c
  const isWindows = process.platform === 'win32';
  const finalBin = isWindows && bin.endsWith('.cmd') ? 'cmd' : bin;
  const finalArgs = isWindows && bin.endsWith('.cmd') ? ['/c', bin, ...args] : args;

  execFile(finalBin, finalArgs, { timeout: 5 * 60 * 1000, shell: true }, (err, stdout, stderr) => {
    if (err) {
      console.error('[Playwright] Failed to install Chromium:', err.message);
      if (stderr) console.error('[Playwright] stderr:', stderr.trim());
      return;
    }
    if (stdout) console.log('[Playwright] install output:', stdout.trim());
    console.log('[Playwright] Chromium installed successfully.');
  });
}
