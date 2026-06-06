/**
 * Navis — BrowserSession
 *
 * Manages a single Playwright browser lifecycle for the Navis agent.
 */

import { chromium as pwChromium, firefox as pwFirefox, type Browser, type BrowserContext, type Page } from 'playwright';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import { OVERLAY_SCRIPT } from './overlay';
import { NavisLogger } from './logger';
import { findChromiumExecutable } from '../../../lib/playwright-setup';
import { getAvailableBrowsers, type BrowserInfo } from '../../../lib/browser-detector';

const chromium = pwChromium;

export interface SessionConfig {
  headless?: boolean;
  startUrl?: string;
  logger?: NavisLogger;
  useChromeProfile?: boolean;
  selectedBrowserId?: string;
  useIsolatedBrowser?: boolean;
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

/**
 * Attempts to get the Chrome DevTools Protocol (CDP) endpoint from a running Chrome instance.
 * Returns the WebSocket URL for remote debugging, or null if not found.
 */
async function getChromeDebugEndpoint(): Promise<string | null> {
  try {
    // Try default local debugging port
    const response = await fetch('http://localhost:9222/json/version');
    if (response.ok) {
      const data = await response.json();
      return data.webSocketDebuggerUrl;
    }
  } catch (err) {
    console.log('[Navis] Chrome CDP not available on default port 9222');
  }
  return null;
}

/**
 * Launches Chrome with remote debugging enabled on a specific port.
 * Returns the WebSocket debugging URL.
 */
function launchChromeWithDebugPort(
  executablePath: string,
  userDataDir: string,
  profileDirectory: string,
  debugPort: number = 9222
): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      const args = [
        `--user-data-dir=${userDataDir}`,
        `--profile-directory=${profileDirectory}`,
        `--remote-debugging-port=${debugPort}`,
        `--load-extension=${ensureNavisTabGroupExtension()}`,
        '--no-first-run',
        '--no-default-browser-check',
        'about:blank',
      ];

      console.log(`[Navis] Launching Chrome with remote debugging on port ${debugPort}...`);

      // Launch Chrome in background
      if (process.platform === 'win32') {
        spawn(executablePath, args, { detached: true, stdio: 'ignore' });
      } else {
        spawn(executablePath, args, { detached: true, stdio: 'ignore' });
      }

      // Wait a moment for Chrome to start and listen
      const maxAttempts = 30; // 3 seconds
      let attempts = 0;

      const checkEndpoint = async () => {
        try {
          const response = await fetch(`http://localhost:${debugPort}/json/version`);
          if (response.ok) {
            const data = await response.json();
            console.log(`[Navis] CDP endpoint found: ${data.webSocketDebuggerUrl}`);
            resolve(data.webSocketDebuggerUrl);
            return;
          }
        } catch {}

        attempts++;
        if (attempts < maxAttempts) {
          setTimeout(checkEndpoint, 100);
        } else {
          reject(new Error(`Failed to get Chrome CDP endpoint after ${maxAttempts * 100}ms`));
        }
      };

      checkEndpoint();
    } catch (err) {
      reject(new Error(`Failed to launch Chrome with debug port: ${err instanceof Error ? err.message : String(err)}`));
    }
  });
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
  const baseExtensionDir = path.join(os.homedir(), '.everfern', 'extensions');
  const chromeDir = path.join(baseExtensionDir, 'chrome-tab-group');
  const firefoxDir = path.join(baseExtensionDir, 'firefox-tab-group');
  
  fs.mkdirSync(chromeDir, { recursive: true });
  fs.mkdirSync(firefoxDir, { recursive: true });

  // --- CHROME EXTENSION ---
  fs.writeFileSync(
    path.join(chromeDir, 'manifest.json'),
    JSON.stringify(
      {
        manifest_version: 3,
        name: 'EverFern Navis Tab Group (Chrome)',
        version: '1.0.0',
        permissions: ['tabs', 'tabGroups'],
        host_permissions: ['<all_urls>'],
        background: { service_worker: 'service-worker.js' },
      },
      null,
      2,
    ),
    'utf-8',
  );

  const chromeServiceWorker = `
const NAVIS_GROUP_TITLE = 'Navis Agent';
let navisGroupId = -1;

async function ensureNavisGroup(tabId) {
  if (!tabId) return;
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab || tab.windowId < 0) return;
    
    // Only group tabs explicitly flagged by Navis to avoid grouping user's personal tabs
    if (!tab.url || !tab.url.includes('navis=true')) return;

    if (navisGroupId < 0) {
      const groups = await chrome.tabGroups.query({ title: NAVIS_GROUP_TITLE });
      if (groups.length > 0) {
        navisGroupId = groups[0].id;
      }
    }

    if (typeof tab.groupId === 'number' && tab.groupId >= 0) {
      if (tab.groupId === navisGroupId) return;
      try {
        const group = await chrome.tabGroups.get(tab.groupId);
        if (group.title === NAVIS_GROUP_TITLE) {
          navisGroupId = group.id;
          return;
        }
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

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url && changeInfo.url.includes('navis=true')) {
    ensureNavisGroup(tabId);
  } else if (tab.url && tab.url.includes('navis=true')) {
    ensureNavisGroup(tabId);
  }
});
`.trimStart();

  fs.writeFileSync(path.join(chromeDir, 'service-worker.js'), chromeServiceWorker, 'utf-8');

  // --- FIREFOX EXTENSION ---
  fs.writeFileSync(
    path.join(firefoxDir, 'manifest.json'),
    JSON.stringify(
      {
        manifest_version: 3,
        name: 'EverFern Navis Tab Group (Firefox)',
        version: '1.0.0',
        permissions: ['tabs'],
        host_permissions: ['<all_urls>'],
        background: { scripts: ['background.js'] },
        browser_specific_settings: {
          gecko: {
            id: "navis-tab-group@everfern.com",
            strict_min_version: "138.0"
          }
        }
      },
      null,
      2,
    ),
    'utf-8',
  );

  const firefoxBackgroundScript = `
const NAVIS_GROUP_TITLE = 'Navis Agent';
let navisGroupId = -1;

async function ensureNavisGroup(tabId) {
  if (!tabId) return;
  try {
    const tab = await browser.tabs.get(tabId);
    if (!tab || tab.windowId < 0) return;
    
    // Only group tabs explicitly flagged by Navis
    if (!tab.url || !tab.url.includes('navis=true')) return;

    if (typeof browser.tabs.group !== 'function') {
      console.warn('[Navis Tab Group] browser.tabs.group API not supported in this Firefox version.');
      return;
    }

    // Since Firefox integrates tab grouping into the tabs API, we can just group it.
    // If we already have a groupId, we can try to use it, or just group the tab without an ID 
    // and let Firefox create the group, then we can capture the new groupId.
    
    const groupOptions = { tabIds: [tabId] };
    if (navisGroupId >= 0) {
      groupOptions.groupId = navisGroupId;
    }
    
    try {
      navisGroupId = await browser.tabs.group(groupOptions);
      // In Firefox, setting the title/color is often omitted or done differently,
      // but we try anyway if there is a way. For now, just grouping is enough.
    } catch (error) {
      // If our cached navisGroupId is invalid, try creating a new group
      navisGroupId = await browser.tabs.group({ tabIds: [tabId] });
    }
  } catch (error) {
    console.warn('[Navis Tab Group] Failed to group tab', error);
  }
}

browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url && changeInfo.url.includes('navis=true')) {
    ensureNavisGroup(tabId);
  } else if (tab.url && tab.url.includes('navis=true')) {
    ensureNavisGroup(tabId);
  }
});
`.trimStart();

  fs.writeFileSync(path.join(firefoxDir, 'background.js'), firefoxBackgroundScript, 'utf-8');

  return chromeDir;
}

export class BrowserSession {
  private static sharedBrowser: any | null = null;
  private static sharedContext: any | null = null;
  private static sharedActivePage: any | null = null;
  private static sharedTempUserDataDir: string | null = null;
  private static sharedRecentDownloads: string[] = [];

  private logger: NavisLogger | null = null;

  // Getters/setters to map instance properties to static shared properties
  private get browser(): any | null { return BrowserSession.sharedBrowser; }
  private set browser(val: any | null) { BrowserSession.sharedBrowser = val; }

  private get context(): any | null { return BrowserSession.sharedContext; }
  private set context(val: any | null) { BrowserSession.sharedContext = val; }

  private get activePage(): any | null { return BrowserSession.sharedActivePage; }
  private set activePage(val: any | null) { BrowserSession.sharedActivePage = val; }

  private get tempUserDataDir(): string | null { return BrowserSession.sharedTempUserDataDir; }
  private set tempUserDataDir(val: string | null) { BrowserSession.sharedTempUserDataDir = val; }

  public get recentDownloads(): string[] { return BrowserSession.sharedRecentDownloads; }
  public set recentDownloads(val: string[]) { BrowserSession.sharedRecentDownloads = val; }

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

  async ensureOverlay(page: Page): Promise<void> {
    try {
      await page.evaluate((overlayScript) => {
        if (!(window as any).__navis_controls) {
          const script = document.createElement('script');
          script.textContent = overlayScript;
          document.documentElement.appendChild(script);
        }
      }, OVERLAY_SCRIPT).catch(() => {});
    } catch (err) {
      console.warn('[Navis] Failed to ensure overlay:', err);
    }
  }

  async launch(config: SessionConfig = {}): Promise<void> {
    const { headless = false, startUrl, logger, useChromeProfile = false, selectedBrowserId = 'chrome', useIsolatedBrowser = true } = config;
    this.logger = logger || null;

    // Resolve browser info from the selectedBrowserId if not using isolated mode
    let resolvedBrowserInfo: BrowserInfo | undefined;
    if (!useIsolatedBrowser && selectedBrowserId) {
      try {
        const browsers = await getAvailableBrowsers();
        // 1. Exact match
        resolvedBrowserInfo = browsers.find(b => b.id === selectedBrowserId);
        // 2. Fuzzy match: legacy 'chrome' → any google/chrome browser
        if (!resolvedBrowserInfo && (selectedBrowserId === 'chrome' || selectedBrowserId.startsWith('chrome'))) {
          resolvedBrowserInfo = browsers.find(b => b.id.includes('google') || b.id.includes('chrome') || b.name.toLowerCase().includes('chrome'));
        }
        // 3. Fuzzy match: legacy 'firefox' → any firefox browser
        if (!resolvedBrowserInfo && (selectedBrowserId === 'firefox' || selectedBrowserId.startsWith('firefox'))) {
          resolvedBrowserInfo = browsers.find(b => b.engine === 'firefox' || b.name.toLowerCase().includes('firefox'));
        }
        // 4. Prefix match: e.g. 'google-chrome-f0dc...' → 'google-chrome'
        if (!resolvedBrowserInfo) {
          const prefix = selectedBrowserId.split('-').slice(0, 2).join('-');
          resolvedBrowserInfo = browsers.find(b => b.id.startsWith(prefix));
        }
        if (resolvedBrowserInfo) {
          console.log(`[Navis] Resolved selected browser: ${resolvedBrowserInfo.name} (${resolvedBrowserInfo.engine}) at ${resolvedBrowserInfo.path}`);
        } else {
          console.warn(`[Navis] Selected browser '${selectedBrowserId}' not found, falling back to isolated mode`);
        }
      } catch (e) {
        console.warn(`[Navis] Failed to resolve browser '${selectedBrowserId}':`, e);
      }
    }

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

      // Determine if we should use a system browser (via new selection or legacy useChromeProfile)
      // Note: CDP and profile copying only work for chromium-based browsers.
      const isChromiumSystem = resolvedBrowserInfo ? resolvedBrowserInfo.engine === 'chromium' : false;
      const useSystemBrowser = useChromeProfile || (isChromiumSystem && !useIsolatedBrowser);

      if (useSystemBrowser) {
        // Use the resolved browser path if available, otherwise fall back to Chrome profile detection
        const systemBrowserPath = resolvedBrowserInfo?.path;
        const systemBrowserEngine = resolvedBrowserInfo?.engine || 'chromium';
        console.log(`[Navis] 🌐 System browser mode: ${resolvedBrowserInfo?.name || 'Chrome Profile'} (engine: ${systemBrowserEngine})`);

        try {
          const chromeProfile = getChromeProfileLaunchConfig();
          const executablePath = systemBrowserPath || chromeProfile.executablePath || findChromiumExecutable() || undefined;


          // TRY 1: Connect to existing Chrome via CDP (non-isolated mode)
          console.log(`[Navis] 🔌 CDP MODE: Attempting to connect to existing Chrome instance...`);
          console.log(`[Navis] Looking for Chrome with remote debugging on port 9222...`);
          let cdpEndpoint = await getChromeDebugEndpoint();

          if (!cdpEndpoint) {
            console.log(`[Navis] ❌ No Chrome instance found with CDP enabled on port 9222`);
            console.log(`[Navis] 💡 TIP: To use your real Chrome profile, manually launch Chrome with:`);
            console.log(`[Navis]    Windows: "${chromeProfile.executablePath}" --remote-debugging-port=9222 --user-data-dir="${chromeProfile.userDataDir}" --profile-directory="${chromeProfile.profileDirectory}"`);
            console.log(`[Navis] 🚀 Auto-launching Chrome with CDP for you...`);

            try {
              cdpEndpoint = await launchChromeWithDebugPort(
                executablePath!,
                chromeProfile.userDataDir,
                chromeProfile.profileDirectory,
                9222
              );
            } catch (launchErr: any) {
              console.warn(`[Navis] ⚠️ Failed to auto-launch Chrome with CDP: ${launchErr.message}`);
              console.log(`[Navis] This is usually because Chrome is already running. Close all Chrome windows and try again.`);
              throw launchErr; // Fall through to isolated context fallback
            }
          } else {
            console.log(`[Navis] ✅ Found existing Chrome with CDP at: ${cdpEndpoint}`);
          }

          // Connect to Chrome via CDP endpoint
          try {
            console.log(`[Navis] 🔗 Connecting to Chrome via CDP WebSocket: ${cdpEndpoint}`);
            this.browser = await chromium.connectOverCDP(cdpEndpoint);
            this.context = this.browser.contexts()[0] || await this.browser.newContext({
              viewport: { width: 1280, height: 1024 },
              userAgent: realUA,
              locale: 'en-US',
              timezoneId: 'America/New_York',
              acceptDownloads: true,
            });
            console.log(`[Navis] ✅✅✅ SUCCESS: Connected to your REAL Chrome browser via CDP!`);
            console.log(`[Navis] You can now see Navis actions in your actual Chrome window.`);
            console.log(`[Navis] 💡 TIP: For Navis tabs to be grouped automatically, manually install the Navis Tab Group extension from:`);
            console.log(`[Navis]    ~/.everfern/extensions/chrome-tab-group/`);
            this.logger?.browserLaunch(`Connected via CDP to system Chrome (profile: ${chromeProfile.profileDirectory})`);
          } catch (cdpErr: any) {
            console.warn(`[Navis] ❌ Failed to connect via CDP: ${cdpErr.message}`);
            throw cdpErr; // Fall through to isolated context fallback
          }
        } catch (chromeProfileErr: any) {
          // FALLBACK 1: Try launchPersistentContext with isolated profile copy
          console.warn(`[Navis] ⚠️ CDP connection failed, falling back to isolated browser with profile copy...`);
          console.log(`[Navis] (This means Navis will run in a separate browser window, not your main Chrome)`);

          try {
            const chromeProfile = getChromeProfileLaunchConfig();
            const executablePath = chromeProfile.executablePath || findChromiumExecutable() || undefined;
            // FALLBACK 1: Create temporary copy of the profile to bypass locks
            const tempUserDataDir = path.join(os.tmpdir(), `everfern-navis-chrome-profile-${Date.now()}`);
            const srcProfileDir = path.join(chromeProfile.userDataDir, chromeProfile.profileDirectory);
            const destProfileDir = path.join(tempUserDataDir, chromeProfile.profileDirectory);

            console.log(`[Navis] Copying profile files from ${srcProfileDir} to ${destProfileDir}...`);

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

            this.tempUserDataDir = tempUserDataDir;

            const profileLaunchArgs = [
              ...launchArgs,
              `--profile-directory=${chromeProfile.profileDirectory}`,
              `--load-extension=${ensureNavisTabGroupExtension()}`,
            ];

            console.log(`[Navis] Launching Playwright with temporary profile: ${tempUserDataDir}`);
            this.context = await chromium.launchPersistentContext(tempUserDataDir, {
              headless,
              executablePath,
              args: profileLaunchArgs,
              viewport: { width: 1280, height: 1024 },
              userAgent: realUA,
              locale: 'en-US',
              timezoneId: 'America/New_York',
            });
            console.log(`[Navis] ✅ Launched with isolated temporary profile copy`);
            this.logger?.browserLaunch(`Isolated browser with temporary profile copy (fallback mode)`);
          } catch (fallbackErr: any) {
            // FALLBACK 2: Fresh Chromium context (last resort)
            console.warn(`[Navis] Temporary profile copy failed: ${fallbackErr.message}`);
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
              acceptDownloads: true,
            });
            console.log(`[Navis] ✅ Launched with fresh isolated Chromium context`);
            this.logger?.browserLaunch(`Fresh isolated Chromium browser (last resort fallback)`);
          }
        }

        if (this.context) {
          this.browser = this.context.browser();
        }
      } else {
        const engine = resolvedBrowserInfo?.engine || 'chromium';
        const executablePath = resolvedBrowserInfo?.path || findChromiumExecutable() || undefined;

        console.log(`[Navis] 🌐 Isolated browser mode (engine: ${engine})`);
        if (executablePath) {
          console.log(`[Navis] Using executable: ${executablePath}`);
        }

        if (engine === 'firefox') {
          // Build the firefox extension dir and load it via a persistent profile
          ensureNavisTabGroupExtension(); // ensure extension files are written to disk
          const firefoxExtDir = path.join(os.homedir(), '.everfern', 'extensions', 'firefox-tab-group');
          const firefoxProfileDir = path.join(os.homedir(), '.everfern', 'navis-firefox-profile');
          fs.mkdirSync(firefoxProfileDir, { recursive: true });

          try {
            this.context = await pwFirefox.launchPersistentContext(firefoxProfileDir, {
              headless,
              executablePath,
              args: [
                '--no-remote',
                `--load-extension=${firefoxExtDir}`,
              ],
              firefoxUserPrefs: {
                'xpinstall.signatures.required': false,
                'extensions.autoDisableScopes': 0,
                'extensions.enableScopes': 15,
              },
              viewport: { width: 1280, height: 1024 },
              userAgent: realUA,
              locale: 'en-US',
              timezoneId: 'America/New_York',
              acceptDownloads: true,
            });
            this.browser = this.context.browser();
            console.log(`[Navis] ✅ Firefox launched with Navis tab group extension`);
          } catch (firefoxExtErr: any) {
            console.warn(`[Navis] Firefox with extension failed (${firefoxExtErr.message}), falling back to basic Firefox`);
            this.browser = await pwFirefox.launch({
              headless,
              executablePath,
              args: ['--no-remote'],
            });
            this.context = await this.browser.newContext({
              viewport: { width: 1280, height: 1024 },
              userAgent: realUA,
              locale: 'en-US',
              timezoneId: 'America/New_York',
              acceptDownloads: true,
            });
          }
        } else {
          const extensionPath = ensureNavisTabGroupExtension();
          const profileLaunchArgs = [
            ...launchArgs,
            `--disable-extensions-except=${extensionPath}`,
            `--load-extension=${extensionPath}`,
          ];

          this.context = await chromium.launchPersistentContext('', {
            headless,
            executablePath,
            args: profileLaunchArgs,
            viewport: { width: 1280, height: 1024 },
            userAgent: realUA,
            locale: 'en-US',
            timezoneId: 'America/New_York',
            acceptDownloads: true,
          });
          this.browser = this.context.browser(); // Will be null, which is expected for persistent contexts
        }

        this.logger?.browserLaunch(`Isolated Playwright Chromium (headless=${headless})`);
      }

    // Inject overlay into all future pages in this context
    await this.context.addInitScript(OVERLAY_SCRIPT);
    await this.context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

     console.log('[Navis] Overlay script registered at context level');

    // Ensure overlay is running on all already-open pages in this context
    const existingPages = this.context.pages();
    for (const page of existingPages) {
      await this.ensureOverlay(page);
    }

    // Trigger tab grouping via extension service worker if available
    try {
      let sw = this.context.serviceWorkers()[0];
      if (!sw) {
        sw = await Promise.race([
          this.context.waitForEvent('serviceworker'),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000))
        ]).catch(() => null);
      }
      if (sw) {
        console.log('[Navis] Extension service worker detected, triggering initial tab grouping...');
        await sw.evaluate(() => {
          if (typeof (globalThis as any).groupAllTabs === 'function') {
            (globalThis as any).groupAllTabs();
          }
        }).catch((e: any) => console.warn('[Navis] Failed to trigger groupAllTabs inside SW:', e.message));
      }
    } catch (swErr) {
      console.warn('[Navis] Extension service worker detection/invocation failed:', swErr);
    }

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

    // Only log generic message if we haven't already logged a specific one (CDP vs isolated)
    if (!this.logger) {
      console.log(`[Navis] Browser ready: headless=${useChromeProfile ? false : headless}, 1280x1024`);
    }
  }

  async openTab(url?: string): Promise<Page> {
    if (!this.context) throw new Error('Browser not initialized.');

    const targetPage = await this.context.newPage();

    // Flag this tab as a Navis tab so the persistent extension knows to group it
    await targetPage.goto('about:blank?navis=true').catch(() => {});

    if (url && url !== 'about:blank') {
      // Use a more robust goto that doesn't hang on domcontentloaded
      await targetPage.goto(url, { waitUntil: 'load', timeout: 30000 }).catch(async (err: any) => {
        console.warn(`[Navis] goto failed, retrying with commit: ${err.message}`);
        return targetPage!.goto(url, { waitUntil: 'commit', timeout: 10000 }).catch(() => {});
      });
    }

    // Inject overlay script directly into the page after load to ensure it's present
    // This handles cases where addInitScript didn't work or the page loaded too fast
    await this.ensureOverlay(targetPage);

    // Set up navigation listener to re-inject overlay on every page navigation
    targetPage.on('framenavigated', async (frame: any) => {
      if (frame === targetPage.mainFrame()) {
        console.log('[Navis] Page navigated, re-injecting overlay...');
        try {
          await targetPage.evaluate((overlayScript: string) => {
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

    // Track downloads
    targetPage.on('download', async (download: any) => {
      try {
        const fileName = download.suggestedFilename() || 'downloaded_file';
        const downloadsDir = path.join(os.homedir(), '.everfern', 'downloads');
        fs.mkdirSync(downloadsDir, { recursive: true });
        
        const savePath = path.join(downloadsDir, fileName);
        console.log(`[Navis] ⬇️ Download started: saving to ${savePath}`);
        
        await download.saveAs(savePath);
        this.recentDownloads.push(savePath);
        console.log(`[Navis] ✅ Download complete: ${savePath}`);
      } catch (err) {
        console.warn(`[Navis] ❌ Failed to save download:`, err);
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
    await this.ensureOverlay(this.activePage);
  }

  async close(force = true): Promise<void> {
    if (!force) {
      console.log('[Navis] Keeping browser session open for persistence.');
      return;
    }
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
    await this.activePage.evaluate((t: string) => {
      const controls = (window as any).__navis_controls;
      if (controls) controls.setStatus(t);
    }, text).catch(() => {});
  }

  async highlightElement(rect: { x: number; y: number; width: number; height: number }): Promise<void> {
    if (!this.activePage) return;
    await this.activePage.evaluate((r: { x: number; y: number; width: number; height: number }) => {
      const controls = (window as any).__navis_controls;
      if (controls) controls.highlight(r);
    }, rect).catch(() => {});
  }

  async moveCursor(x: number, y: number, click = false): Promise<void> {
    if (!this.activePage) return;
    await this.activePage.evaluate(({ x, y, click }: { x: number; y: number; click: boolean }) => {
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
