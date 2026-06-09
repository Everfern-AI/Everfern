/**
 * Navis — BrowserSession
 *
 * Manages a single Playwright browser lifecycle for the Navis agent.
 */

import { chromium as pwChromium, firefox as pwFirefox, type Browser, type BrowserContext, type Page } from 'playwright';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn, execFile } from 'child_process';
import { OVERLAY_SCRIPT } from './overlay';
import { NavisLogger } from './logger';
import { findChromiumExecutable } from '../../../lib/playwright-setup';
import { getAvailableBrowsers, type BrowserInfo } from '../../../lib/browser-detector';

const chromium = pwChromium;
const DEFAULT_CDP_PORT = 9222;
const CDP_LAUNCH_TIMEOUT_MS = 20000;

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

export interface NavisDebugBrowserLaunchResult {
  success: boolean;
  message: string;
  endpoint?: string;
  browserName?: string;
  profileDir?: string;
  command?: string;
  usedExistingEndpoint?: boolean;
  usingReusableProfile?: boolean;
}

async function isProcessRunning(exePath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const processName = path.basename(exePath);
    if (process.platform === 'win32') {
      execFile('tasklist', ['/FI', `IMAGENAME eq ${processName}`], (err, stdout) => {
        if (!stdout) return resolve(false);
        resolve(stdout.toLowerCase().includes(processName.toLowerCase()));
      });
    } else {
      execFile('pgrep', ['-f', processName], (err, stdout) => {
        if (!stdout) return resolve(false);
        resolve(!!stdout.trim());
      });
    }
  });
}

function normalizePathForCompare(value: string | undefined): string {
  if (!value) return '';
  return path.normalize(value).replace(/[\\\/]+$/, '').toLowerCase();
}

function isStandardGoogleChromeUserDataDir(executablePath?: string, userDataDir?: string): boolean {
  if (!executablePath || !userDataDir) return false;
  const exe = executablePath.toLowerCase();
  if (!exe.includes('google') || !exe.includes('chrome')) return false;

  const home = os.homedir();
  const standard =
    process.platform === 'win32'
      ? path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Google', 'Chrome', 'User Data')
      : process.platform === 'darwin'
        ? path.join(home, 'Library', 'Application Support', 'Google', 'Chrome')
        : path.join(home, '.config', 'google-chrome');

  return normalizePathForCompare(userDataDir) === normalizePathForCompare(standard);
}

function chromeDefaultProfileRemoteDebuggingNote(): string {
  return 'Google Chrome 136+ ignores --remote-debugging-port for the default Chrome user data directory. ' +
    'To automate logged-in Chrome tabs, Chrome must already be running with a reachable CDP endpoint, or Navis must use a non-default automation profile / isolated browser.';
}

function defaultProfileDebuggingBypassNote(): string {
  return 'Navis will first try Chrome with --disable-features=DevToolsDebuggingRestrictions because the user explicitly selected browser-profile automation. ' +
    'If Chrome still refuses CDP, Navis falls back to the reusable EverFern profile.';
}

function safeProfileSlug(value: string | undefined): string {
  return (value || 'chromium').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'chromium';
}

function getEverFernCdpProfileDir(browserInfo?: BrowserInfo | null): string {
  const profileDir = path.join(
    os.homedir(),
    '.everfern',
    'navis-cdp-profiles',
    safeProfileSlug(browserInfo?.id || browserInfo?.name || 'chrome'),
  );
  fs.mkdirSync(profileDir, { recursive: true });
  return profileDir;
}

async function resolveSelectedBrowserInfo(selectedBrowserId?: string): Promise<BrowserInfo | undefined> {
  if (!selectedBrowserId) return undefined;
  try {
    const browsers = await getAvailableBrowsers();
    let resolvedBrowserInfo = browsers.find(b => b.id === selectedBrowserId);

    if (!resolvedBrowserInfo && (selectedBrowserId === 'chrome' || selectedBrowserId.startsWith('chrome'))) {
      resolvedBrowserInfo = browsers.find(b => b.id.includes('google') || b.id.includes('chrome') || b.name.toLowerCase().includes('chrome'));
    }

    if (!resolvedBrowserInfo && (selectedBrowserId === 'firefox' || selectedBrowserId.startsWith('firefox'))) {
      resolvedBrowserInfo = browsers.find(b => b.engine === 'firefox' || b.name.toLowerCase().includes('firefox'));
    }

    if (!resolvedBrowserInfo) {
      const prefix = selectedBrowserId.split('-').slice(0, 2).join('-');
      resolvedBrowserInfo = browsers.find(b => b.id.startsWith(prefix));
    }

    return resolvedBrowserInfo;
  } catch (e) {
    console.warn(`[Navis] Failed to resolve browser '${selectedBrowserId}':`, e);
    return undefined;
  }
}

function formatCdpRestartCommand(executablePath: string, userDataDir?: string, profileDirectory?: string, debugPort: number = DEFAULT_CDP_PORT): string {
  const quotedExe = `"${executablePath}"`;
  const args = [
    `--remote-debugging-port=${debugPort}`,
    '--remote-debugging-address=127.0.0.1',
    userDataDir ? `--user-data-dir="${userDataDir}"` : '',
    profileDirectory ? `--profile-directory="${profileDirectory}"` : '',
    '--new-window',
    'about:blank',
  ].filter(Boolean).join(' ');
  return `${quotedExe} ${args}`;
}

/**
 * Attempts to get the Chrome DevTools Protocol (CDP) endpoint from a running browser instance.
 * Returns the WebSocket URL for remote debugging, or null if not found.
 */
async function fetchJsonWithTimeout(url: string, timeoutMs: number): Promise<any | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function getCDPEndpoint(port: number = DEFAULT_CDP_PORT): Promise<string | null> {
  const hosts = ['127.0.0.1', 'localhost'];
  for (const host of hosts) {
    const version = await fetchJsonWithTimeout(`http://${host}:${port}/json/version`, 750);
    if (typeof version?.webSocketDebuggerUrl === 'string' && version.webSocketDebuggerUrl.includes('/devtools/browser/')) {
      return version.webSocketDebuggerUrl;
    }

    const list = await fetchJsonWithTimeout(`http://${host}:${port}/json/list`, 750);
    if (Array.isArray(list)) {
      const target = list.find((item: any) =>
        typeof item?.webSocketDebuggerUrl === 'string' &&
        item.webSocketDebuggerUrl.includes('/devtools/browser/')
      );
      if (target?.webSocketDebuggerUrl) {
        return target.webSocketDebuggerUrl;
      }
    }
  }
  return null;
}

/**
 * Launches a browser (Chrome/Firefox) with remote debugging enabled on a specific port.
 * Returns the WebSocket debugging URL.
 */
function launchBrowserWithDebugPort(
  executablePath: string,
  engine: 'chromium' | 'firefox',
  userDataDir?: string,
  profileDirectory?: string,
  debugPort: number = DEFAULT_CDP_PORT,
  extraArgs: string[] = [],
): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const resolveOnce = (value: string) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const rejectOnce = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    try {
      let args: string[] = [];

      if (engine === 'firefox') {
        args = [
          `--remote-debugging-port=${debugPort}`,
          '--remote-debugging-address=127.0.0.1',
          '--start-debugger-server',
          '-no-remote',
        ];
        if (userDataDir) args.push(`-profile`, userDataDir);
      } else {
        args = [
          `--remote-debugging-port=${debugPort}`,
          '--remote-debugging-address=127.0.0.1',
          '--remote-allow-origins=*',
          ...extraArgs,
          `--load-extension=${ensureNavisTabGroupExtension()}`,
          '--no-first-run',
          '--no-default-browser-check',
          '--new-window',
          'about:blank',
        ];
        if (userDataDir) args.push(`--user-data-dir=${userDataDir}`);
        if (profileDirectory) args.push(`--profile-directory=${profileDirectory}`);
      }

      console.log(`[Navis] Launching ${engine} with remote debugging on port ${debugPort}...`);

      const child = spawn(executablePath, args, {
        detached: true,
        stdio: ['ignore', 'ignore', 'pipe'],
        windowsHide: false,
      });
      let stderr = '';

      child.stderr?.on('data', chunk => {
        stderr = `${stderr}${String(chunk)}`.slice(-4000);
      });
      child.once('error', err => {
        rejectOnce(new Error(`Failed to launch browser with debug port: ${err.message}`));
      });
      child.once('exit', (code, signal) => {
        if (settled) return;
        const details = stderr.trim() ? ` Stderr: ${stderr.trim()}` : '';
        rejectOnce(new Error(`Browser exited before exposing CDP (code=${code}, signal=${signal}).${details}`));
      });
      child.unref();

      // Wait a moment for the browser to start and listen
      const maxAttempts = Math.ceil(CDP_LAUNCH_TIMEOUT_MS / 250);
      let attempts = 0;

      const checkEndpoint = async () => {
        const endpoint = await getCDPEndpoint(debugPort);
        if (endpoint) {
          console.log(`[Navis] CDP endpoint found: ${endpoint}`);
          child.stderr?.destroy();
          resolveOnce(endpoint);
          return;
        }

        attempts++;
        if (attempts < maxAttempts) {
          setTimeout(checkEndpoint, 250);
        } else {
          const details = stderr.trim() ? ` Browser stderr: ${stderr.trim()}` : '';
          rejectOnce(new Error(`Failed to get CDP endpoint after ${CDP_LAUNCH_TIMEOUT_MS}ms.${details}`));
        }
      };

      checkEndpoint();
    } catch (err) {
      rejectOnce(new Error(`Failed to launch browser with debug port: ${err instanceof Error ? err.message : String(err)}`));
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

function getGenericChromiumUserDataDir(browserInfo: any): string | undefined {
  if (!browserInfo) return undefined;

  const id = browserInfo.id.toLowerCase();
  const home = os.homedir();
  const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');

  if (process.platform === 'win32') {
    if (id.includes('brave')) return path.join(localAppData, 'BraveSoftware', 'Brave-Browser', 'User Data');
    if (id.includes('msedge') || id.includes('edge')) return path.join(localAppData, 'Microsoft', 'Edge', 'User Data');
    if (id.includes('vivaldi')) return path.join(localAppData, 'Vivaldi', 'User Data');
    if (id.includes('arc')) {
      const packagesDir = path.join(localAppData, 'Packages');
      if (fs.existsSync(packagesDir)) {
        const folders = fs.readdirSync(packagesDir);
        const arcFolder = folders.find(f => f.toLowerCase().startsWith('thebrowsercompany.arc'));
        if (arcFolder) {
          return path.join(packagesDir, arcFolder, 'LocalCache', 'Local', 'Arc', 'User Data');
        }
      }
      return path.join(localAppData, 'Packages', 'TheBrowserCompany.Arc_ttt1ap7aakyb4', 'LocalCache', 'Local', 'Arc', 'User Data');
    }
    if (id.includes('shift')) return path.join(localAppData, 'ShiftData', 'UserData');
  } else if (process.platform === 'darwin') {
    const appSupport = path.join(home, 'Library', 'Application Support');
    if (id.includes('brave')) return path.join(appSupport, 'BraveSoftware', 'Brave-Browser');
    if (id.includes('msedge') || id.includes('edge')) return path.join(appSupport, 'Microsoft Edge');
    if (id.includes('vivaldi')) return path.join(appSupport, 'Vivaldi');
    if (id.includes('arc')) return path.join(appSupport, 'Arc', 'User Data');
  } else {
    const config = path.join(home, '.config');
    if (id.includes('brave')) return path.join(config, 'BraveSoftware', 'Brave-Browser');
    if (id.includes('msedge') || id.includes('edge')) return path.join(config, 'microsoft-edge');
    if (id.includes('vivaldi')) return path.join(config, 'vivaldi');
  }

  return undefined;
}

function getFirefoxProfileDir(engineName: string = 'firefox'): string | null {
  const home = os.homedir();

  // 1. Determine base folder based on OS and engine
  let baseFolder = '';
  const isZen = engineName.toLowerCase().includes('zen');

  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    baseFolder = isZen ? path.join(appData, 'Zen') : path.join(appData, 'Mozilla', 'Firefox');
  } else if (process.platform === 'darwin') {
    const appSupport = path.join(home, 'Library', 'Application Support');
    baseFolder = isZen ? path.join(appSupport, 'Zen') : path.join(appSupport, 'Firefox');
  } else {
    // Linux
    baseFolder = isZen ? path.join(home, '.zen') : path.join(home, '.mozilla', 'firefox');
  }

  const profilesIniPath = path.join(baseFolder, 'profiles.ini');
  if (!fs.existsSync(profilesIniPath)) return null;

  try {
    const content = fs.readFileSync(profilesIniPath, 'utf-8');
    const lines = content.split('\n');
    let currentPath = '';
    let currentIsDefault = false;
    let bestPath = '';

    for (const line of lines) {
      const tLine = line.trim();
      if (tLine.startsWith('[Profile')) {
        if (currentIsDefault && currentPath) {
           bestPath = currentPath;
           break;
        }
        currentPath = '';
        currentIsDefault = false;
      } else if (tLine.startsWith('Path=')) {
        currentPath = tLine.substring(5).trim();
      } else if (tLine.startsWith('Default=1')) {
        currentIsDefault = true;
      }
    }

    if (currentIsDefault && currentPath) bestPath = currentPath;
    if (!bestPath && currentPath) bestPath = currentPath; // Fallback to last found

    if (bestPath) {
      if (path.isAbsolute(bestPath)) return bestPath;
      return path.join(baseFolder, bestPath);
    }
  } catch (e) {
    console.warn('[Navis] Failed to parse Firefox profiles.ini', e);
  }
  return null;
}

export async function openNavisDebugBrowser(selectedBrowserId: string = 'chrome'): Promise<NavisDebugBrowserLaunchResult> {
  const cdpPort = DEFAULT_CDP_PORT;
  const existingEndpoint = await getCDPEndpoint(cdpPort);
  if (existingEndpoint) {
    return {
      success: true,
      endpoint: existingEndpoint,
      usedExistingEndpoint: true,
      usingReusableProfile: false,
      message: `Chrome DevTools Protocol is already reachable on port ${cdpPort}. Navis will attach to this browser.`,
    };
  }

  const resolvedBrowserInfo = await resolveSelectedBrowserInfo(selectedBrowserId);
  const isGoogleChrome =
    !resolvedBrowserInfo ||
    resolvedBrowserInfo.id.startsWith('chrome') ||
    resolvedBrowserInfo.id.startsWith('google') ||
    resolvedBrowserInfo.name.toLowerCase().includes('chrome');

  if (resolvedBrowserInfo && resolvedBrowserInfo.engine !== 'chromium') {
    return {
      success: false,
      browserName: resolvedBrowserInfo.name,
      message: `${resolvedBrowserInfo.name} is not a Chromium CDP browser. Choose Chrome, Edge, Brave, or the isolated browser option for Navis CDP preparation.`,
    };
  }

  let chromeProfile: ChromeProfileLaunchConfig | null = null;
  if (isGoogleChrome) {
    try {
      chromeProfile = getChromeProfileLaunchConfig();
    } catch {
      chromeProfile = null;
    }
  }

  const executablePath = resolvedBrowserInfo?.path || chromeProfile?.executablePath || findChromiumExecutable() || undefined;
  if (!executablePath) {
    return {
      success: false,
      message: 'No Chromium browser executable was found for Navis CDP preparation.',
    };
  }

  const reusableCdpProfileDir = getEverFernCdpProfileDir(resolvedBrowserInfo || {
    id: isGoogleChrome ? 'chrome' : 'chromium',
    name: isGoogleChrome ? 'Chrome' : 'Chromium',
    engine: 'chromium',
    path: executablePath,
    logo: '',
    supportsCDP: true,
  });

  const realUserDataDir = chromeProfile?.userDataDir || getGenericChromiumUserDataDir(resolvedBrowserInfo);
  const realProfileDirectory = chromeProfile?.profileDirectory;
  const isDefaultChromeProfile = isStandardGoogleChromeUserDataDir(executablePath, realUserDataDir);
  const browserAlreadyRunning = await isProcessRunning(executablePath);

  let launchUserDataDir = realUserDataDir;
  let launchProfileDirectory = realProfileDirectory;
  let usingReusableProfile = false;
  let extraArgs: string[] = [];

  if (browserAlreadyRunning) {
    launchUserDataDir = reusableCdpProfileDir;
    launchProfileDirectory = undefined;
    usingReusableProfile = true;
  } else if (isDefaultChromeProfile) {
    extraArgs = ['--disable-features=DevToolsDebuggingRestrictions'];
  }

  try {
    const endpoint = await launchBrowserWithDebugPort(
      executablePath,
      'chromium',
      launchUserDataDir,
      launchProfileDirectory,
      cdpPort,
      extraArgs,
    );
    return {
      success: true,
      endpoint,
      browserName: resolvedBrowserInfo?.name || 'Chrome',
      profileDir: launchUserDataDir,
      command: formatCdpRestartCommand(executablePath, launchUserDataDir, launchProfileDirectory, cdpPort),
      usingReusableProfile,
      usedExistingEndpoint: false,
      message: usingReusableProfile
        ? `Opened the reusable EverFern Navis CDP profile on port ${cdpPort}. Your normal browser was already running, so Navis did not try to reuse its locked profile.`
        : `Opened ${resolvedBrowserInfo?.name || 'Chrome'} with CDP on port ${cdpPort}. Navis will attach to this browser.`,
    };
  } catch (firstErr: any) {
    if (!usingReusableProfile) {
      try {
        const endpoint = await launchBrowserWithDebugPort(
          executablePath,
          'chromium',
          reusableCdpProfileDir,
          undefined,
          cdpPort,
        );
        return {
          success: true,
          endpoint,
          browserName: resolvedBrowserInfo?.name || 'Chrome',
          profileDir: reusableCdpProfileDir,
          command: formatCdpRestartCommand(executablePath, reusableCdpProfileDir, undefined, cdpPort),
          usingReusableProfile: true,
          usedExistingEndpoint: false,
          message: `Chrome did not expose CDP for the selected profile, so EverFern opened its reusable Navis CDP profile on port ${cdpPort}. ${chromeDefaultProfileRemoteDebuggingNote()}`,
        };
      } catch (fallbackErr: any) {
        return {
          success: false,
          browserName: resolvedBrowserInfo?.name || 'Chrome',
          profileDir: reusableCdpProfileDir,
          command: formatCdpRestartCommand(executablePath, reusableCdpProfileDir, undefined, cdpPort),
          usingReusableProfile: true,
          usedExistingEndpoint: false,
          message: `Failed to open Navis CDP browser. First attempt: ${firstErr?.message || firstErr}. Reusable profile attempt: ${fallbackErr?.message || fallbackErr}.`,
        };
      }
    }

    return {
      success: false,
      browserName: resolvedBrowserInfo?.name || 'Chrome',
      profileDir: launchUserDataDir,
      command: formatCdpRestartCommand(executablePath, launchUserDataDir, launchProfileDirectory, cdpPort),
      usingReusableProfile,
      usedExistingEndpoint: false,
      message: `Failed to open Navis CDP browser: ${firstErr?.message || firstErr}`,
    };
  }
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
  private static sharedAttachedToExternalBrowser = false;
  private static sharedAttachedProfileLabel = 'browser profile';
  private static sharedNavisPages = new Set<Page>();

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

  private get attachedToExternalBrowser(): boolean { return BrowserSession.sharedAttachedToExternalBrowser; }
  private set attachedToExternalBrowser(val: boolean) { BrowserSession.sharedAttachedToExternalBrowser = val; }

  private get attachedProfileLabel(): string { return BrowserSession.sharedAttachedProfileLabel; }
  private set attachedProfileLabel(val: string) { BrowserSession.sharedAttachedProfileLabel = val; }

  private get navisPages(): Set<Page> { return BrowserSession.sharedNavisPages; }

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
      const hasOverlay = await page.evaluate(() => !!(window as any).__navis_controls).catch(() => false);
      if (!hasOverlay) {
        await page.evaluate(OVERLAY_SCRIPT).catch(() => {});
      }
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
      resolvedBrowserInfo = await resolveSelectedBrowserInfo(selectedBrowserId);
      if (resolvedBrowserInfo) {
        console.log(`[Navis] Resolved selected browser: ${resolvedBrowserInfo.name} (${resolvedBrowserInfo.engine}) at ${resolvedBrowserInfo.path}`);
      } else {
        console.warn(`[Navis] Selected browser '${selectedBrowserId}' not found, falling back to isolated mode`);
      }
    }

    const realUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

    if (this.browser) {
      this.logger?.browserLaunch('already launched, opening new tab');
      await this.openTab(startUrl || 'about:blank');
      return;
    }

    this.attachedToExternalBrowser = false;
    this.attachedProfileLabel = 'browser profile';
    this.navisPages.clear();

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
      const isChromiumSystem = resolvedBrowserInfo ? resolvedBrowserInfo.engine === 'chromium' : true;
      const useSystemBrowser = !headless && (useChromeProfile || !useIsolatedBrowser);

      if (useSystemBrowser && isChromiumSystem) {
        // Use the resolved browser path if available, otherwise fall back to Chrome profile detection
        const systemBrowserPath = resolvedBrowserInfo?.path;
        const isGoogleChrome = !resolvedBrowserInfo || resolvedBrowserInfo.id.startsWith('chrome') || resolvedBrowserInfo.id.startsWith('google');

        console.log(`[Navis] 🌐 System browser mode: ${resolvedBrowserInfo?.name || 'Chrome Profile'} (engine: chromium)`);

        let activeUserDataDir: string | undefined;
        let launchArgsToUse: string[] = [...launchArgs];
        let attemptedRealProfileAttach = false;
        let cdpProfileLabel = 'existing CDP browser';

        try {
          const chromeProfile = isGoogleChrome ? getChromeProfileLaunchConfig() : null;
          const executablePath = systemBrowserPath || chromeProfile?.executablePath || findChromiumExecutable() || undefined;

          activeUserDataDir = chromeProfile?.userDataDir || getGenericChromiumUserDataDir(resolvedBrowserInfo);

          const isDefaultChromeProfile = isStandardGoogleChromeUserDataDir(executablePath, activeUserDataDir);
          const cdpPort = DEFAULT_CDP_PORT;
          const reusableCdpProfileDir = getEverFernCdpProfileDir(resolvedBrowserInfo || {
            id: isGoogleChrome ? 'chrome' : 'chromium',
            name: 'Chrome',
            engine: 'chromium',
            path: executablePath || '',
            logo: '',
            supportsCDP: true,
          });

          // TRY 1: Connect to existing browser via CDP
          console.log(`[Navis] 🔌 CDP MODE: Attempting to connect to existing instance on port ${cdpPort}...`);
          let cdpEndpoint = await getCDPEndpoint(cdpPort);
          attemptedRealProfileAttach = Boolean(cdpEndpoint && executablePath && activeUserDataDir);

          if (!cdpEndpoint) {
            console.log(`[Navis] ❌ No instance found with CDP enabled on port ${cdpPort}`);

            const browserAlreadyRunning = executablePath ? await isProcessRunning(executablePath) : false;
            let cdpLaunchUserDataDir = activeUserDataDir;
            let cdpLaunchProfileDirectory = chromeProfile?.profileDirectory;
            let cdpLaunchExtraArgs: string[] = [];

            if (browserAlreadyRunning) {
              console.log(
                `[Navis] ⚠️ ${resolvedBrowserInfo?.name || 'Chrome'} is already running without CDP. ` +
                'A running browser cannot be retrofitted with remote debugging, so Navis will use its reusable CDP profile instead.'
              );
              cdpLaunchUserDataDir = reusableCdpProfileDir;
              cdpLaunchProfileDirectory = undefined;
              cdpProfileLabel = 'reusable EverFern CDP profile';
            } else if (isDefaultChromeProfile) {
              console.log(`[Navis] ⚠️ ${chromeDefaultProfileRemoteDebuggingNote()}`);
              console.log(`[Navis] ${defaultProfileDebuggingBypassNote()}`);
              cdpLaunchExtraArgs = ['--disable-features=DevToolsDebuggingRestrictions'];
              cdpProfileLabel = 'selected Chrome profile';
            } else {
              cdpProfileLabel = 'selected browser profile';
            }

            console.log(`[Navis] 🚀 Auto-launching browser with CDP for you...`);

            try {
              cdpEndpoint = await launchBrowserWithDebugPort(
                executablePath!,
                'chromium',
                cdpLaunchUserDataDir,
                cdpLaunchProfileDirectory,
                cdpPort,
                cdpLaunchExtraArgs,
              );
            } catch (launchErr: any) {
              console.warn(`[Navis] ⚠️ Failed to auto-launch browser with CDP: ${launchErr.message}`);
              if (isDefaultChromeProfile && !browserAlreadyRunning && cdpLaunchUserDataDir === activeUserDataDir) {
                console.warn(`[Navis] ⚠️ Default Chrome profile did not expose CDP. Retrying with reusable EverFern profile: ${reusableCdpProfileDir}`);
                try {
                  cdpProfileLabel = 'reusable EverFern CDP profile';
                  cdpEndpoint = await launchBrowserWithDebugPort(
                    executablePath!,
                    'chromium',
                    reusableCdpProfileDir,
                    undefined,
                    cdpPort,
                  );
                } catch (fallbackLaunchErr: any) {
                  const command = executablePath
                    ? formatCdpRestartCommand(executablePath, reusableCdpProfileDir, undefined, cdpPort)
                    : '';
                  throw new Error(
                    `${fallbackLaunchErr.message} ${chromeDefaultProfileRemoteDebuggingNote()} ` +
                    `Try launching the reusable EverFern Navis profile manually: ${command}`
                  );
                }
              } else {
                const command = executablePath
                  ? formatCdpRestartCommand(executablePath, reusableCdpProfileDir, undefined, cdpPort)
                  : '';
                const chrome136Note = isDefaultChromeProfile ? ` ${chromeDefaultProfileRemoteDebuggingNote()}` : '';
                throw new Error(
                  `${launchErr.message}${chrome136Note} ` +
                  `Try launching the reusable EverFern Navis profile manually: ${command}`
                );
              }
            }
          } else {
            console.log(`[Navis] ✅ Found existing browser with CDP at: ${cdpEndpoint}`);
          }

          // Connect to browser via CDP
          try {
            this.browser = await chromium.connectOverCDP(cdpEndpoint);
            this.attachedToExternalBrowser = true;
            this.attachedProfileLabel = cdpProfileLabel;
            this.context = this.browser.contexts()[0] || await this.browser.newContext({
              viewport: { width: 1280, height: 1024 },
              userAgent: realUA,
              locale: 'en-US',
              timezoneId: 'America/New_York',
              acceptDownloads: true,
            });
            this.logger?.browserLaunch(`Connected via CDP to ${cdpProfileLabel}`);
          } catch (cdpErr: any) {
            throw cdpErr;
          }
        } catch (err: any) {
          if (
            err.message &&
            (err.message.includes('Please close') || err.message.includes('already running without a remote debugging endpoint'))
          ) {
            throw err;
          }
          if (attemptedRealProfileAttach) {
            throw new Error(
              `Navis could not attach to ${resolvedBrowserInfo?.name || 'your browser'} using the real profile. ` +
              `Close all ${resolvedBrowserInfo?.name || 'browser'} windows and try again, or launch it with --remote-debugging-port=9222. ` +
              `Navis will not create a copied/photocopy profile. Original error: ${err?.message || String(err)}`
            );
          }
          console.warn(`[Navis] ⚠️ CDP connection failed, falling back to isolated browser...`);

          const fallbackUserDataDir = getEverFernCdpProfileDir(resolvedBrowserInfo);
          try {
            this.context = await chromium.launchPersistentContext(fallbackUserDataDir, {
              headless: false,
              executablePath: systemBrowserPath || findChromiumExecutable() || undefined,
              args: launchArgsToUse,
              viewport: { width: 1280, height: 1024 },
              userAgent: realUA,
              locale: 'en-US',
              timezoneId: 'America/New_York',
              acceptDownloads: true,
            });
          } catch (persistentErr: any) {
            console.warn(`[Navis] ⚠️ Safe profile persistent launch failed: ${persistentErr?.message || persistentErr}. Retrying with bundled Chromium.`);
            this.browser = await chromium.launch({
              headless: false,
              args: launchArgsToUse,
            });

            this.context = await this.browser.newContext({
              viewport: { width: 1280, height: 1024 },
              userAgent: realUA,
              locale: 'en-US',
              timezoneId: 'America/New_York',
              acceptDownloads: true,
            });
          }
          this.logger?.browserLaunch(`Isolated Chromium browser (safe fallback)`);
        }

        if (this.context) {
          this.browser = this.context.browser();
        }
      } else if (useSystemBrowser && !isChromiumSystem) {
        // Firefox / Zen system browser mode via CDP
        const systemBrowserPath = resolvedBrowserInfo?.path;
        console.log(`[Navis] 🌐 System browser mode: ${resolvedBrowserInfo?.name || 'Firefox/Zen Profile'} (engine: firefox)`);

        try {
          const userProfileDir = getFirefoxProfileDir(resolvedBrowserInfo?.name || 'firefox');

          // TRY 1: Connect to existing Firefox browser via CDP
          console.log(`[Navis] 🔌 CDP MODE: Attempting to connect to existing Firefox instance on port 9222...`);
          let cdpEndpoint = await getCDPEndpoint(9222);

          if (!cdpEndpoint) {
            console.log(`[Navis] ❌ No instance found with CDP enabled on port 9222`);
            console.log(`[Navis] 🚀 Auto-launching Firefox with CDP for you...`);

            try {
              if (await isProcessRunning(systemBrowserPath!)) {
                throw new Error(`${resolvedBrowserInfo?.name || 'Firefox/Zen'} is already running without a remote debugging endpoint. Close it and try again, or launch it with remote debugging enabled.`);
              }

              cdpEndpoint = await launchBrowserWithDebugPort(
                systemBrowserPath!,
                'firefox',
                userProfileDir || undefined,
                undefined,
                9222
              );
            } catch (launchErr: any) {
              console.warn(`[Navis] ⚠️ Failed to auto-launch Firefox with CDP: ${launchErr.message}`);
              throw launchErr;
            }
          } else {
            console.log(`[Navis] ✅ Found existing Firefox with CDP at: ${cdpEndpoint}`);
          }

          // Connect to browser via Chromium CDP (Playwright CDP client works with Firefox BiDi/CDP too)
          try {
            this.browser = await chromium.connectOverCDP(cdpEndpoint);
            this.attachedToExternalBrowser = true;
            this.context = this.browser.contexts()[0] || await this.browser.newContext({
              viewport: { width: 1280, height: 1024 },
              userAgent: realUA,
              locale: 'en-US',
              timezoneId: 'America/New_York',
              acceptDownloads: true,
            });
            this.logger?.browserLaunch(`Connected via CDP to Firefox system browser`);
          } catch (cdpErr: any) {
            throw cdpErr;
          }
        } catch (err: any) {
          if (err.message && err.message.includes('Please close')) {
            throw err;
          }
          console.warn(`[Navis] ⚠️ Firefox CDP connection failed: ${err.message}. Falling back to isolated browser...`);

          ensureNavisTabGroupExtension();
          const firefoxExtDir = path.join(os.homedir(), '.everfern', 'extensions', 'firefox-tab-group');
          const firefoxProfileDir = path.join(os.homedir(), '.everfern', 'navis-firefox-profile');

          fs.mkdirSync(firefoxProfileDir, { recursive: true });

          this.context = await pwFirefox.launchPersistentContext(firefoxProfileDir, {
            headless: false,
            // DO NOT pass executablePath here to avoid Playwright protocol mismatch errors with custom Zen/Firefox binaries
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
          this.logger?.browserLaunch(`Isolated Firefox browser (fallback)`);

          if (this.context) {
            this.browser = this.context.browser();
          }
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
            console.warn(`[Navis] Firefox with extension failed (${firefoxExtErr.message}), falling back to basic Playwright Firefox`);
            this.browser = await pwFirefox.launch({
              headless,
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

    if (this.attachedToExternalBrowser) {
      console.log(`[Navis] Attached via CDP to ${this.attachedProfileLabel}; overlay will be injected only into Navis-owned tabs`);
      this.context.on('page', async (newPage: Page) => {
        const opener = await newPage.opener().catch(() => null);
        if (opener && this.navisPages.has(opener)) {
          this.navisPages.add(newPage);
          newPage.on('framenavigated', async (frame: any) => {
            if (frame === newPage.mainFrame()) {
              await this.ensureOverlay(newPage).catch(() => {});
            }
          });
          await this.ensureOverlay(newPage).catch(() => {});
        }
      });
    } else {
      // Inject overlay into all future pages in Navis-owned contexts.
      await this.context.addInitScript(OVERLAY_SCRIPT);
      await this.context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      });

      console.log('[Navis] Overlay script registered at context level');

      // Register 'page' listener on context to handle tabs opened dynamically (e.g. click with target="_blank")
      this.context.on('page', async (newPage: Page) => {
        this.navisPages.add(newPage);
        newPage.on('framenavigated', async (frame: any) => {
          if (frame === newPage.mainFrame()) {
            await this.ensureOverlay(newPage).catch(() => {});
          }
        });
        await this.ensureOverlay(newPage).catch(() => {});
      });

      // Ensure overlay and navigation listener are running on all already-open pages in this Navis-owned context
      const existingPages = this.context.pages();
      for (const page of existingPages) {
        this.navisPages.add(page);
        await this.ensureOverlay(page);
        page.on('framenavigated', async (frame: any) => {
          if (frame === page.mainFrame()) {
            await this.ensureOverlay(page).catch(() => {});
          }
        });
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
    }

    } catch (err) {
      if (this.browser && !this.attachedToExternalBrowser) {
        await this.browser.close().catch(() => {});
      }
      this.context = null;
      this.browser = null;
      this.activePage = null;
      this.attachedToExternalBrowser = false;
      this.attachedProfileLabel = 'browser profile';
      this.navisPages.clear();
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
    this.navisPages.add(targetPage);

    // Flag this tab as a Navis tab so the persistent extension knows to group it
    await targetPage.goto('about:blank?navis=true').catch(() => {});

    if (url && url !== 'about:blank') {
      // Use a more robust goto that doesn't hang on domcontentloaded
      await targetPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 12000 }).catch(async (err: any) => {
        console.warn(`[Navis] goto failed, retrying with commit: ${err.message}`);
        return targetPage!.goto(url, { waitUntil: 'commit', timeout: 5000 }).catch(() => {});
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
      if (this.attachedToExternalBrowser) {
        console.log('[Navis] 🔴 Attached browser cleanup: closing Navis-owned tabs only');
        const pagesToClose = new Set<Page>(this.navisPages);
        if (this.activePage) pagesToClose.add(this.activePage);

        for (const page of pagesToClose) {
          try {
            if (!page.isClosed()) {
              await page.close().catch(() => {});
            }
          } catch (pageErr) {
            console.warn(`[Navis] ⚠️ Error closing Navis tab: ${pageErr instanceof Error ? pageErr.message : String(pageErr)}`);
          }
        }

        this.navisPages.clear();
        this.activePage = null;
        this.context = null;
        this.browser = null;
        this.attachedToExternalBrowser = false;
        this.attachedProfileLabel = 'browser profile';

        const totalCloseTime = Date.now() - closeStartTime;
        console.log(`[Navis] ✅ Detached from CDP browser without closing profile (${totalCloseTime}ms)`);
        return;
      }

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
