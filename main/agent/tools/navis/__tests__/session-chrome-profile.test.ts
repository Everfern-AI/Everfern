import { describe, it, expect } from 'vitest';
import { BrowserSession } from '../session';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('BrowserSession - Chrome Profile Fallback & Cleanup', { timeout: 30000 }, () => {
  it('should fall back gracefully to a standard Chromium instance when useChromeProfile is true but Chrome is not configured/installed', async () => {
    const session = new BrowserSession();
    
    // We launch with useChromeProfile: true. Even if Google Chrome is missing on the host running the test,
    // it must fall back cleanly to a standard Chromium browser instead of throwing.
    await expect(session.launch({
      headless: true,
      useChromeProfile: true,
      startUrl: 'about:blank'
    })).resolves.not.toThrow();

    // Verify browser, context, and page are initialized
    expect(session.getContext()).toBeDefined();
    expect(session.page).toBeDefined();
    expect(session.allPages.length).toBeGreaterThan(0);

    // Clean up
    await expect(session.close()).resolves.not.toThrow();
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
