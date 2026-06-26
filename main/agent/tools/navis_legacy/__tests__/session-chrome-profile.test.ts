import { describe, it, expect } from 'vitest';
import { BrowserSession, openNavisDebugBrowser } from '../session';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('BrowserSession - extension-first profile handling', { timeout: 30000 }, () => {
  it('keeps legacy profile preparation disabled and points users to the extension', async () => {
    const result = await openNavisDebugBrowser('chrome');

    expect(result.success).toBe(false);
    expect(result.message).toContain('Navis profile automation now requires the companion extension');
    expect(result.message).toContain('logged-in Chrome/Firefox control');
  });

  it('should not expose the old Navis profile preparation handler to the renderer', () => {
    const ipcSource = fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'ipc', 'tool-settings-handlers.ts'), 'utf-8');
    const preloadSource = fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', '..', 'preload', 'preload.ts'), 'utf-8');

    expect(ipcSource).not.toContain("ipcMain.handle('debug:open-browser'");
    expect(ipcSource).not.toContain('openNavisDebugBrowser');
    expect(preloadSource).not.toContain("openDebugBrowser: () => ipcRenderer.invoke('debug:open-browser')");
  });

  it('should not copy the default Chrome profile for Navis automation', () => {
    const sessionSource = fs.readFileSync(path.join(__dirname, '..', 'session.ts'), 'utf-8');

    expect(sessionSource).not.toContain('function copyEssentialProfileItem');
    expect(sessionSource).not.toContain('Creating safe fallback profile copy');
  });

  it('should coerce direct profile launches back to isolated Playwright source path', () => {
    const sessionSource = fs.readFileSync(path.join(__dirname, '..', 'session.ts'), 'utf-8');

    expect(sessionSource).toContain('Browser profile automation now requires the Navis extension');
    expect(sessionSource).toContain('useChromeProfile = false;');
    expect(sessionSource).toContain('useIsolatedBrowser = true;');
    expect(sessionSource).not.toContain('connectOverCDP');
    expect(sessionSource).not.toContain('--remote-debugging-port');
  });

  it('should successfully clean up tempUserDataDir when BrowserSession.close is called', async () => {
    const session = new BrowserSession();

    // Manually inject a tempUserDataDir to test the cleanup functionality
    const testTempDir = path.join(os.tmpdir(), `everfern-navis-chrome-profile-test-${Date.now()}`);
    fs.mkdirSync(testTempDir, { recursive: true });
    
    // Create a mock file inside the temp directory
    const testFile = path.join(testTempDir, 'Preferences');
    fs.writeFileSync(testFile, '{}', 'utf-8');

    expect(fs.existsSync(testFile)).toBe(true);

    // Inject the temporary directory into the session
    (session as any).tempUserDataDir = testTempDir;

    // Call close to trigger cleanup
    await session.close();

    // Verify temp directory and the file inside it are deleted
    expect(fs.existsSync(testFile)).toBe(false);
    expect(fs.existsSync(testTempDir)).toBe(false);
  });
});
