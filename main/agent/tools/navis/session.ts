/**
 * Navis — Browser Session Manager
 *
 * Handles Playwright browser lifecycle: launch, context, page/tab management, cleanup.
 * Uses pure Playwright automation, with an optional Chrome profile helper extension for tab grouping.
 */

import { chromium as pwChromium, Browser, BrowserContext, Page } from 'playwright';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { OVERLAY_SCRIPT } from './overlay';
import { NavisLogger } from './logger';
import { findChromiumExecutable } from '../../../lib/playwright-setup';

const chromium = pwChromium;

export interface SessionConfig {
  headless?: boolean;
  startUrl?: string;
  logger?: NavisLogger;
  useChromeProfile?: boolean;
}

export interface TabInfo {
  id: string;
  url: string;
  title: string;
  isActive: boolean;
}

interface ChromeProfileLaunchConfig {
  executablePath: string;
  userDataDir: string;
  profileDirectory: string;
}

function copyEssentialProfileItem(src: string, dest: string): void {
  try {
    if (!fs.existsSync(src)) return;
    const stat = fs.statSync(src);
    if (stat.isDirectory()) {
      fs.mkdirSync(dest, { recursive: true });
      const entries = fs.readdirSync(src);
      for (const entry of entries) {
        // Skip heavy directories that aren't related to session / logins
        if (entry === 'Cache' || entry === 'Code Cache' || entry === 'GPUCache' || entry === 'Service Worker' || entry === 'WebStorage' || entry === 'BrowserMetrics') {
          continue;
        }
        copyEssentialProfileItem(path.join(src, entry), path.join(dest, entry));
      }
    } else {
      fs.copyFileSync(src, dest);
    }
  } catch (err) {
    console.warn(`[Navis] Warning: failed to copy profile item ${src}:`, err);
  }
}

function getChromeProfileLaunchConfig(): ChromeProfileLaunchConfig {
  const home = os.homedir();

  const candidates =
    process.platform === 'win32'
      ? [
          {
            executablePath: path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
            userDataDir: path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Google', 'Chrome', 'User Data'),
          },
          {
            executablePath: path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
            userDataDir: path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Google', 'Chrome', 'User Data'),
          },
          {
            executablePath: path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Google', 'Chrome', 'Application', 'chrome.exe'),
            userDataDir: path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Google', 'Chrome', 'User Data'),
          },
        ]
      : process.platform === 'darwin'
      ? [
          {
            executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            userDataDir: path.join(home, 'Library', 'Application Support', 'Google', 'Chrome'),
          },
        ]
      : [
          {
            executablePath: '/usr/bin/google-chrome',
            userDataDir: path.join(home, '.config', 'google-chrome'),
          },
          {
            executablePath: '/usr/bin/google-chrome-stable',
            userDataDir: path.join(home, '.config', 'google-chrome'),
          },
        ];

  const match = candidates.find(candidate => fs.existsSync(candidate.executablePath) && fs.existsSync(candidate.userDataDir));
  if (!match) {
    throw new Error('Google Chrome profile not found. Install Chrome or turn off "Run on your Chrome profile" in Navis settings.');
  }

  return {
    ...match,
    profileDirectory: getLastUsedChromeProfile(match.userDataDir),
  };
}

function getLastUsedChromeProfile(userDataDir: string): string {
  const localStatePath = path.join(userDataDir, 'Local State');
  try {
    const localState = JSON.parse(fs.readFileSync(localStatePath, 'utf-8'));
    const lastUsed = localState?.profile?.last_used;
    if (typeof lastUsed === 'string' && fs.existsSync(path.join(userDataDir, lastUsed))) {
      return lastUsed;
    }
  } catch {}

  if (fs.existsSync(path.join(userDataDir, 'Default'))) return 'Default';
  if (fs.existsSync(path.join(userDataDir, 'Profile 1'))) return 'Profile 1';
  return 'Default';
}

function ensureNavisTabGroupExtension(): string {
  const extensionDir = path.join(os.tmpdir(), 'everfern-navis-tab-group-extension');
  fs.mkdirSync(extensionDir, { recursive: true });

  fs.writeFileSync(
    path.join(extensionDir, 'manifest.json'),
    JSON.stringify(
      {
        manifest_version: 3,
        name: 'EverFern Navis Tab Group',
        version: '1.0.0',
        permissions: ['tabs', 'tabGroups'],
        background: { service_worker: 'service-worker.js' },
      },
      null,
      2,
    ),
    'utf-8',
  );

  fs.writeFileSync(
    path.join(extensionDir, 'service-worker.js'),
    `
const NAVIS_GROUP_TITLE = 'Navis Agent';
let navisGroupId = -1;

async function ensureNavisGroup(tabId) {
  if (!tabId) return;
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab || tab.windowId < 0) return;

    if (typeof tab.groupId === 'number' && tab.groupId >= 0) {
      try {
        await chrome.tabGroups.update(tab.groupId, { title: NAVIS_GROUP_TITLE, color: 'blue' });
        navisGroupId = tab.groupId;
        return;
      } catch {}
    }

    if (navisGroupId >= 0) {
      try {
        await chrome.tabs.group({ tabIds: [tabId], groupId: navisGroupId });
        return;
      } catch {
        navisGroupId = -1;
      }
    }

    navisGroupId = await chrome.tabs.group({ tabIds: [tabId] });
    await chrome.tabGroups.update(navisGroupId, { title: NAVIS_GROUP_TITLE, color: 'blue' });
  } catch (error) {
    console.warn('[Navis Tab Group] Failed to group tab', error);
  }
}

chrome.tabs.onCreated.addListener(tab => {
  ensureNavisGroup(tab.id);
});
`.trimStart(),
    'utf-8',
  );

  return extensionDir;
}

export class BrowserSession {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private activePage: Page | null = null;
  private logger: NavisLogger | null = null;
  private tempUserDataDir: string | null = null;

  setActivePage(page: Page) {
    this.activePage = page;
  }

  getContext(): BrowserContext {
    if (!this.context) throw new Error('Browser not initialized. Call launch() first.');
    return this.context;
  }

  get page(): Page {
    if (!this.activePage) throw new Error('No active page. Call openTab() first.');
    return this.activePage;
  }

  get allPages(): Page[] {
    if (!this.context) throw new Error('Browser not initialized.');
    return this.context.pages();
  }

  async launch(config: SessionConfig = {}): Promise<void> {
    const { headless = false, startUrl, logger, useChromeProfile = false } = config;
    this.logger = logger || null;

    const realUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

    if (this.browser) {
      this.logger?.browserLaunch('already launched, opening new tab');
      await this.openTab(startUrl || 'about:blank');
      return;
    }

    // Always launch fresh browser
    try {
      const launchArgs = [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-infobars',
        '--disable-blink-features=AutomationControlled',
        '--disable-default-apps',
        '--no-first-run',
        '--disable-translate',
        '--disable-features=ChromeWhatsNewUI',
        '--disable-background-networking',
        '--disable-sync',
        '--metrics-recording-only',
        '--disable-component-update',
        '--safebrowsing-disable-auto-update',
        '--disable-hang-monitor',
        '--disable-popup-blocking',
        '--disable-prompt-on-repost',
        '--disable-domain-reliability',
        '--disable-features=IsolateOrigins,site-per-process',
        '--lang=en-US',
        '--window-size=1280,1024',
      ];

      if (useChromeProfile) {
        try {
          const chromeProfile = getChromeProfileLaunchConfig();
          const executablePath = chromeProfile.executablePath || findChromiumExecutable() || undefined;
          if (executablePath) {
            console.log(`[Navis] Using Chromium executable: ${executablePath}`);
          }

          const profileLaunchArgs = [
            ...launchArgs,
            `--profile-directory=${chromeProfile.profileDirectory}`,
            `--load-extension=${ensureNavisTabGroupExtension()}`,
          ];

          let finalUserDataDir = chromeProfile.userDataDir;

          try {
            console.log(`[Navis] Attempting to launch with Chrome profile directly...`);
            this.context = await chromium.launchPersistentContext(finalUserDataDir, {
              headless,
              executablePath,
              args: profileLaunchArgs,
              viewport: { width: 1280, height: 1024 },
              userAgent: realUA,
              locale: 'en-US',
              timezoneId: 'America/New_York',
            });
          } catch (launchErr: any) {
            console.warn(`[Navis] Failed to launch with direct Chrome profile (usually because Chrome is running): ${launchErr.message}`);
            console.log(`[Navis] Falling back to launching with a copied temporary Chrome profile...`);

            // Create temporary copy of the profile to bypass locks
            const tempUserDataDir = path.join(os.tmpdir(), `everfern-navis-chrome-profile-${Date.now()}`);
            const srcProfileDir = path.join(chromeProfile.userDataDir, chromeProfile.profileDirectory);
            const destProfileDir = path.join(tempUserDataDir, chromeProfile.profileDirectory);

            console.log(`[Navis] Copying profile files from ${srcProfileDir} to ${destProfileDir}...`);
            try {
              fs.mkdirSync(destProfileDir, { recursive: true });
              
              // Copy essential session & cookie files/dirs
              const essentials = [
                'Preferences',
                'Secure Preferences',
                'Login Data',
                'Cookies',
                'Network',
                'Local Storage',
                'Session Storage',
              ];

              for (const item of essentials) {
                const srcPath = path.join(srcProfileDir, item);
                const destPath = path.join(destProfileDir, item);
                copyEssentialProfileItem(srcPath, destPath);
              }

              // Copy Local State from user data dir root to temp user data dir root (crucial for DPAPI decrypting cookies/logins on Windows)
              const srcLocalState = path.join(chromeProfile.userDataDir, 'Local State');
              const destLocalState = path.join(tempUserDataDir, 'Local State');
              if (fs.existsSync(srcLocalState)) {
                try {
                  fs.copyFileSync(srcLocalState, destLocalState);
                  console.log(`[Navis] Copied Local State file to ${destLocalState}`);
                } catch (localStateErr) {
                  console.warn(`[Navis] Warning: failed to copy Local State:`, localStateErr);
                }
              }

              // Remove any lock files in the destination to ensure clean launch
              const lockFiles = ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'lockfile'];
              for (const lockFile of lockFiles) {
                const lockPath = path.join(tempUserDataDir, lockFile);
                if (fs.existsSync(lockPath)) {
                  try { fs.unlinkSync(lockPath); } catch {}
                }
                const lockPathProfile = path.join(destProfileDir, lockFile);
                if (fs.existsSync(lockPathProfile)) {
                  try { fs.unlinkSync(lockPathProfile); } catch {}
                }
              }

              finalUserDataDir = tempUserDataDir;
              this.tempUserDataDir = tempUserDataDir;

              console.log(`[Navis] Launching Playwright with temporary profile: ${finalUserDataDir}`);
              this.context = await chromium.launchPersistentContext(finalUserDataDir, {
                headless,
                executablePath,
                args: profileLaunchArgs,
                viewport: { width: 1280, height: 1024 },
                userAgent: realUA,
                locale: 'en-US',
                timezoneId: 'America/New_York',
              });
            } catch (copyErr: any) {
              console.error(`[Navis] Failed to copy temporary profile: ${copyErr.message}`);
              throw copyErr; // Rethrow to fall back to clean standard Chromium launch below
            }
          }
        } catch (chromeProfileErr: any) {
          console.warn(`[Navis] Chrome profile setup/launch failed completely: ${chromeProfileErr.message}`);
          console.log(`[Navis] Falling back to fresh Chromium context...`);

          this.browser = await chromium.launch({
            headless: false,
            executablePath: findChromiumExecutable() || undefined,
            args: launchArgs,
          });

          this.context = await this.browser.newContext({
            viewport: { width: 1280, height: 1024 },
            userAgent: realUA,
            locale: 'en-US',
            timezoneId: 'America/New_York',
          });
        }

        if (this.context) {
          this.browser = this.context.browser();
        }
      } else {
        const executablePath = findChromiumExecutable() || undefined;
        if (executablePath) {
          console.log(`[Navis] Using Chromium executable: ${executablePath}`);
        }

        this.browser = await chromium.launch({
          headless,
          executablePath,
          args: launchArgs,
        });

        this.context = await this.browser.newContext({
          viewport: { width: 1280, height: 1024 },
          userAgent: realUA,
          locale: 'en-US',
          timezoneId: 'America/New_York',
        });
      }

    // Inject overlay into all future pages in this context
    await this.context.addInitScript(OVERLAY_SCRIPT);
    await this.context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    console.log('[Navis] Overlay script registered at context level');


    } catch (err) {
      if (this.browser) await this.browser.close().catch(() => {});
      this.browser = null;
      throw err;
    }

    // Navigate to startUrl or open initial tab
    if (startUrl && startUrl !== 'about:blank') {
      await this.openTab(startUrl);
    } else if (!this.activePage) {
      await this.openTab('about:blank');
    }

    this.logger?.browserLaunch(`headless=${useChromeProfile ? false : headless}, 1280x1024, ${useChromeProfile ? 'Chrome profile' : 'real Chrome'}`);
  }

  async openTab(url?: string): Promise<Page> {
    if (!this.context) throw new Error('Browser not initialized.');

    const targetPage = await this.context.newPage();

    if (url && url !== 'about:blank') {
      // Use a more robust goto that doesn't hang on domcontentloaded
      await targetPage.goto(url, { waitUntil: 'load', timeout: 30000 }).catch(async (err) => {
        console.warn(`[Navis] goto failed, retrying with commit: ${err.message}`);
        return targetPage!.goto(url, { waitUntil: 'commit', timeout: 10000 }).catch(() => {});
      });
    }

    // Inject overlay script directly into the page after load to ensure it's present
    // This handles cases where addInitScript didn't work or the page loaded too fast
    try {
      await targetPage.evaluate((overlayScript) => {
        // Check if overlay is already initialized
        if (!(window as any).__navis_controls) {
          // Inject the overlay script directly
          const script = document.createElement('script');
          script.textContent = overlayScript;
          document.documentElement.appendChild(script);
        }
      }, OVERLAY_SCRIPT).catch(() => {});
    } catch (err) {
      console.warn('[Navis] Failed to inject overlay into new tab:', err);
    }

    // Set up navigation listener to re-inject overlay on every page navigation
    targetPage.on('framenavigated', async (frame) => {
      if (frame === targetPage.mainFrame()) {
        console.log('[Navis] Page navigated, re-injecting overlay...');
        try {
          await targetPage.evaluate((overlayScript) => {
            // Check if overlay is already initialized
            if (!(window as any).__navis_controls) {
              // Inject the overlay script directly
              const script = document.createElement('script');
              script.textContent = overlayScript;
              document.documentElement.appendChild(script);
            }
          }, OVERLAY_SCRIPT).catch(() => {});
        } catch (err) {
          console.warn('[Navis] Failed to re-inject overlay after navigation:', err);
        }
      }
    });

    await targetPage.bringToFront();
    this.activePage = targetPage;
    return targetPage;
  }

  async closeTab(page: Page): Promise<void> {
    if (!this.context) return;

    await page.close().catch(() => {});

    const remaining = this.context.pages();
    if (remaining.length > 0) {
      this.activePage = remaining[remaining.length - 1];
    }
  }

  async getTabs(): Promise<TabInfo[]> {
    if (!this.context) return [];

    const pages = this.context.pages();
    const tabs: TabInfo[] = [];

    for (let i = 0; i < pages.length; i++) {
      const p = pages[i];
      let title = '';
      try {
        title = await p.title();
      } catch {
        title = 'Loading...';
      }
      tabs.push({
        id: `tab-${i + 1}`,
        url: p.url(),
        title,
        isActive: p === this.activePage,
      });
    }

    return tabs;
  }

  async switchToTab(indexOrTitle: number | string): Promise<void> {
    const pages = this.allPages;

    if (typeof indexOrTitle === 'number') {
      if (indexOrTitle < 0 || indexOrTitle >= pages.length) {
        throw new Error(`Tab index ${indexOrTitle} out of range. Available tabs: 0-${pages.length - 1}`);
      }
      this.activePage = pages[indexOrTitle];
    } else {
      const page = pages.find(p => {
        try {
          return p.title().then(t => t.toLowerCase().includes(indexOrTitle.toLowerCase()));
        } catch {
          return false;
        }
      });
      if (!page) {
        throw new Error(`No tab found matching "${indexOrTitle}". Available: ${pages.map((p, i) => `#${i}: ${p.url()}`).join(', ')}`);
      }
      this.activePage = page;
    }

    await this.activePage.bringToFront();
  }

  async close(): Promise<void> {
    const closeStartTime = Date.now();
    console.log('[Navis] 🔴 CLOSURE INITIATED - Starting browser session cleanup');

    try {
      // Force close all pages first to prevent hanging
      if (this.context) {
        console.log('[Navis] 🔴 Force closing all pages...');
        const pages = this.context.pages();
        for (const page of pages) {
          try {
            await page.close().catch(() => {});
          } catch (pageErr) {
            console.warn(`[Navis] ⚠️ Error closing page: ${pageErr instanceof Error ? pageErr.message : String(pageErr)}`);
          }
        }
        console.log(`[Navis] ✅ All pages closed (${pages.length} pages)`);
      }

      // Close context with timeout
      if (this.context) {
        console.log('[Navis] 🔴 Closing browser context...');
        const contextCloseStart = Date.now();
        try {
          // Use Promise.race to enforce timeout on context close
          await Promise.race([
            this.context.close(),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Context close timeout')), 5000)
            )
          ]);
          const contextCloseTime = Date.now() - contextCloseStart;
          console.log(`[Navis] ✅ Browser context closed successfully (${contextCloseTime}ms)`);
        } catch (contextErr) {
          const contextCloseTime = Date.now() - contextCloseStart;
          console.warn(`[Navis] ⚠️ Context close timeout or error (${contextCloseTime}ms): ${contextErr instanceof Error ? contextErr.message : String(contextErr)}`);
        }
        this.context = null;
      } else {
        console.log('[Navis] ℹ️ No context to close');
      }

      // Close browser with timeout
      if (this.browser) {
        console.log('[Navis] 🔴 Closing browser instance...');
        const browserCloseStart = Date.now();
        try {
          // Use Promise.race to enforce timeout on browser close
          await Promise.race([
            this.browser.close(),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Browser close timeout')), 5000)
            )
          ]);
          const browserCloseTime = Date.now() - browserCloseStart;
          console.log(`[Navis] ✅ Browser instance closed successfully (${browserCloseTime}ms)`);
        } catch (browserErr) {
          const browserCloseTime = Date.now() - browserCloseStart;
          console.warn(`[Navis] ⚠️ Browser close timeout or error (${browserCloseTime}ms): ${browserErr instanceof Error ? browserErr.message : String(browserErr)}`);
        }
        this.browser = null;
      } else {
        console.log('[Navis] ℹ️ No browser instance to close');
      }

      // Clear active page reference
      this.activePage = null;

      // Clean up temporary user data directory if it was created
      if (this.tempUserDataDir && fs.existsSync(this.tempUserDataDir)) {
        console.log(`[Navis] 🔴 Cleaning up temporary Chrome profile: ${this.tempUserDataDir}`);
        try {
          fs.rmSync(this.tempUserDataDir, { recursive: true, force: true });
          console.log('[Navis] ✅ Temporary Chrome profile cleaned up');
        } catch (rmErr) {
          console.warn('[Navis] ⚠️ Failed to delete temporary Chrome profile folder:', rmErr);
        }
        this.tempUserDataDir = null;
      }

      const totalCloseTime = Date.now() - closeStartTime;
      console.log(`[Navis] ✅ CLOSURE COMPLETE - Total cleanup time: ${totalCloseTime}ms`);

    } catch (err) {
      const totalCloseTime = Date.now() - closeStartTime;
      console.error(`[Navis] ❌ CLOSURE FAILED - Unexpected error during cleanup (${totalCloseTime}ms):`, err);
      this.activePage = null;
    }
  }

  async setOverlayStatus(text: string): Promise<void> {
    if (!this.activePage) return;
    await this.activePage.evaluate((t) => {
      const controls = (window as any).__navis_controls;
      if (controls) controls.setStatus(t);
    }, text).catch(() => {});
  }

  async highlightElement(rect: { x: number; y: number; width: number; height: number }): Promise<void> {
    if (!this.activePage) return;
    await this.activePage.evaluate((r) => {
      const controls = (window as any).__navis_controls;
      if (controls) controls.highlight(r);
    }, rect).catch(() => {});
  }

  async moveCursor(x: number, y: number, click = false): Promise<void> {
    if (!this.activePage) return;
    await this.activePage.evaluate(({ x, y, click }) => {
      const controls = (window as any).__navis_controls;
      if (controls) controls.moveCursor(x, y, click);
    }, { x, y, click }).catch(() => {});
  }


  /**
   * Annotates interactive elements with visual labels (e1, e2, etc.) directly on the page.
   * This is used for vision-mode grounding so the AI can "see" the refs on the screenshot.
   */
  async annotateElements(): Promise<void> {
    if (!this.activePage) return;
    try {
      await this.activePage.evaluate(() => {
        // Remove existing first to avoid double-labeling
        document.querySelectorAll('.__navis_ref_label').forEach(el => el.remove());

        const elements = document.querySelectorAll('button, a, input, select, textarea, [role="button"], [role="link"], [role="textbox"], [role="combobox"], [data-scroll-ref]');
        elements.forEach((el: Element) => {
          const ref = el.getAttribute('data-ref') || el.getAttribute('data-scroll-ref');
          if (!ref) return;

          const rect = el.getBoundingClientRect();
          // Only label visible elements
          if (rect.width > 2 && rect.height > 2 && rect.top < window.innerHeight && rect.left < window.innerWidth) {
            const label = document.createElement('div');
            label.className = '__navis_ref_label';
            label.textContent = ref;
            const isScroll = ref.startsWith('s');
            Object.assign(label.style, {
              position: 'fixed',
              top: `${Math.max(0, rect.top)}px`,
              left: `${Math.max(0, rect.left)}px`,
              backgroundColor: isScroll ? '#007AFF' : '#ff3366',
              color: 'white',
              fontSize: '11px',
              fontWeight: 'bold',
              padding: '2px 4px',
              borderRadius: '4px',
              zIndex: '2147483640',
              pointerEvents: 'none',
              boxShadow: '0 2px 4px rgba(0,0,0,0.4)',
              lineHeight: '1',
              fontFamily: 'system-ui, sans-serif',
              border: '1px solid white',
              transform: 'translate(-50%, -50%)',
            });
            document.body.appendChild(label);
          }
        });
      });
    } catch (err) {
      console.warn('[Navis] Failed to annotate elements:', err);
    }
  }

  /**
   * Removes all visual ref labels from the page.
   */
  async removeAnnotations(): Promise<void> {
    if (!this.activePage) return;
    try {
      await this.activePage.evaluate(() => {
        document.querySelectorAll('.__navis_ref_label').forEach(el => el.remove());
      });
    } catch (err) {
      console.warn('[Navis] Failed to remove annotations:', err);
    }
  }
}
