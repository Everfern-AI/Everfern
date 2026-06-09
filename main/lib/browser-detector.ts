import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { app } from 'electron';
import Registry from 'winreg';

export interface BrowserInfo {
  id: string;          // e.g. "chrome", "msedge", "firefox", "brave"
  name: string;        // "Google Chrome"
  engine: 'chromium' | 'firefox';
  path: string;        // Absolute executable path
  logo: string;        // base64 data URL
  supportsCDP: boolean; 
}

function getSubKeys(hive: string, key: string): Promise<Registry.Registry[]> {
  return new Promise((resolve) => {
    const regKey = new Registry({ hive, key });
    regKey.keys((err, keys) => {
      if (err) {
        resolve([]);
      } else {
        resolve(keys);
      }
    });
  });
}

function getRegistryValue(hive: string, key: string, name: string = ''): Promise<string | null> {
  return new Promise((resolve) => {
    const regKey = new Registry({ hive, key });
    regKey.get(name, (err, item) => {
      if (err || !item) {
        resolve(null);
      } else {
        resolve(item.value);
      }
    });
  });
}

// Helper to expand environment variables like %LocalAppData%
function expandEnvVars(pathStr: string): string {
  return pathStr.replace(/%([^%]+)%/g, (_, n) => process.env[n] || '');
}

// Windows browser detection using registry + fallbacks
async function getWindowsBrowsers(): Promise<BrowserInfo[]> {
  const browsersMap = new Map<string, BrowserInfo>();
  const registryPaths = [
    { hive: Registry.HKLM, key: '\\SOFTWARE\\Clients\\StartMenuInternet' },
    { hive: Registry.HKCU, key: '\\SOFTWARE\\Clients\\StartMenuInternet' }
  ];

  for (const { hive, key } of registryPaths) {
    const keys = await getSubKeys(hive, key);
    for (const subKey of keys) {
      try {
        const keyName = subKey.key.split('\\').pop() || '';
        const commandVal = await getRegistryValue(hive, subKey.key + '\\shell\\open\\command');
        if (commandVal) {
          // Clean quotes around executable path
          let exePath = commandVal.trim();
          if (exePath.startsWith('"')) {
            const nextQuote = exePath.indexOf('"', 1);
            if (nextQuote !== -1) {
              exePath = exePath.substring(1, nextQuote);
            }
          }
          exePath = expandEnvVars(exePath);
          if (fs.existsSync(exePath)) {
            let name = await getRegistryValue(hive, subKey.key) || keyName.replace(/\.exe/i, '');
            // Clean up weird hexadecimal suffixes like Firefox-F0DC299D809B9700
            if (/-[A-F0-9]{8,}/i.test(name) || name === keyName) {
              const folderName = path.basename(path.dirname(exePath));
              if (folderName.toLowerCase() === 'application' || folderName.toLowerCase() === 'bin') {
                name = path.basename(path.dirname(path.dirname(exePath)));
              } else {
                name = folderName;
              }
            }

            const id = name.toLowerCase().replace(/[^a-z0-9]/g, '-');
            const isFirefoxBased = id.includes('firefox') || exePath.toLowerCase().includes('firefox') || id.includes('zen') || exePath.toLowerCase().includes('zen');
            const engine = isFirefoxBased ? 'firefox' : 'chromium';
            
            // Generate icon
            let logo = '';
            try {
              const iconImage = await app.getFileIcon(exePath, { size: 'normal' });
              logo = iconImage.toDataURL();
            } catch (iconErr) {
              console.warn(`[BrowserDetector] Failed to get file icon for ${exePath}:`, iconErr);
            }

            browsersMap.set(exePath.toLowerCase(), {
              id,
              name,
              engine,
              path: exePath,
              logo,
              supportsCDP: true
            });
          }
        }
      } catch (e) {
        console.warn('[BrowserDetector] Registry parse error:', e);
      }
    }
  }

  // Windows Common Path Fallbacks
  const commonPaths = [
    { id: 'chrome', name: 'Google Chrome', engine: 'chromium' as const, paths: [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      '%LocalAppData%\\Google\\Chrome\\Application\\chrome.exe'
    ]},
    { id: 'msedge', name: 'Microsoft Edge', engine: 'chromium' as const, paths: [
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
    ]},
    { id: 'firefox', name: 'Mozilla Firefox', engine: 'firefox' as const, paths: [
      'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
      'C:\\Program Files (x86)\\Mozilla Firefox\\firefox.exe'
    ]},
    { id: 'brave', name: 'Brave Browser', engine: 'chromium' as const, paths: [
      'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
      '%LocalAppData%\\BraveSoftware\\Brave-Browser\\Application\\brave.exe'
    ]},
    { id: 'zen', name: 'Zen Browser', engine: 'firefox' as const, paths: [
      'C:\\Program Files\\Zen Browser\\zen.exe',
      '%LocalAppData%\\Programs\\Zen Browser\\zen.exe',
      '%LocalAppData%\\Zen\\zen.exe'
    ]},
    { id: 'opera', name: 'Opera', engine: 'chromium' as const, paths: [
      'C:\\Program Files\\Opera\\launcher.exe',
      '%LocalAppData%\\Programs\\Opera\\launcher.exe'
    ]},
    { id: 'arc', name: 'Arc', engine: 'chromium' as const, paths: [
      '%LocalAppData%\\Microsoft\\Arc\\Arc.exe'
    ]},
    { id: 'shift', name: 'Shift', engine: 'chromium' as const, paths: [
      '%LocalAppData%\\Shift\\chromium\\shift.exe'
    ]}
  ];

  for (const item of commonPaths) {
    for (const p of item.paths) {
      const resolved = expandEnvVars(p);
      if (fs.existsSync(resolved) && !browsersMap.has(resolved.toLowerCase())) {
        let logo = '';
        try {
          const iconImage = await app.getFileIcon(resolved, { size: 'normal' });
          logo = iconImage.toDataURL();
        } catch (e) {
          console.warn(`[BrowserDetector] Failed to get fallback icon for ${resolved}:`, e);
        }
        browsersMap.set(resolved.toLowerCase(), {
          id: item.id,
          name: item.name,
          engine: item.engine,
          path: resolved,
          logo,
          supportsCDP: true
        });
      }
    }
  }

  return Array.from(browsersMap.values());
}

// macOS browser detection using standard paths
async function getMacBrowsers(): Promise<BrowserInfo[]> {
  const browsersMap = new Map<string, BrowserInfo>();
  const appPaths = [
    { id: 'chrome', name: 'Google Chrome', engine: 'chromium' as const, app: '/Applications/Google Chrome.app', exe: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' },
    { id: 'msedge', name: 'Microsoft Edge', engine: 'chromium' as const, app: '/Applications/Microsoft Edge.app', exe: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge' },
    { id: 'firefox', name: 'Mozilla Firefox', engine: 'firefox' as const, app: '/Applications/Firefox.app', exe: '/Applications/Firefox.app/Contents/MacOS/firefox' },
    { id: 'brave', name: 'Brave Browser', engine: 'chromium' as const, app: '/Applications/Brave Browser.app', exe: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser' },
    { id: 'arc', name: 'Arc', engine: 'chromium' as const, app: '/Applications/Arc.app', exe: '/Applications/Arc.app/Contents/MacOS/Arc' },
    { id: 'opera', name: 'Opera', engine: 'chromium' as const, app: '/Applications/Opera.app', exe: '/Applications/Opera.app/Contents/MacOS/Opera' }
  ];

  for (const item of appPaths) {
    if (fs.existsSync(item.app) && fs.existsSync(item.exe)) {
      let logo = '';
      try {
        const iconImage = await app.getFileIcon(item.app, { size: 'normal' });
        logo = iconImage.toDataURL();
      } catch (e) {
        console.warn(`[BrowserDetector] Failed to get macOS icon for ${item.app}:`, e);
      }
      browsersMap.set(item.id, {
        id: item.id,
        name: item.name,
        engine: item.engine,
        path: item.exe,
        logo,
        supportsCDP: true
      });
    }
  }

  return Array.from(browsersMap.values());
}

// Linux browser detection using which / standard locations
async function getLinuxBrowsers(): Promise<BrowserInfo[]> {
  const { execSync } = require('child_process');
  const browsersMap = new Map<string, BrowserInfo>();
  const candidates = [
    { id: 'chrome', name: 'Google Chrome', engine: 'chromium' as const, bin: 'google-chrome' },
    { id: 'chrome-stable', name: 'Google Chrome Stable', engine: 'chromium' as const, bin: 'google-chrome-stable' },
    { id: 'chromium', name: 'Chromium', engine: 'chromium' as const, bin: 'chromium-browser' },
    { id: 'chromium-alt', name: 'Chromium', engine: 'chromium' as const, bin: 'chromium' },
    { id: 'msedge', name: 'Microsoft Edge', engine: 'chromium' as const, bin: 'microsoft-edge' },
    { id: 'firefox', name: 'Mozilla Firefox', engine: 'firefox' as const, bin: 'firefox' },
    { id: 'brave', name: 'Brave Browser', engine: 'chromium' as const, bin: 'brave-browser' },
    { id: 'opera', name: 'Opera', engine: 'chromium' as const, bin: 'opera' }
  ];

  for (const item of candidates) {
    try {
      const exePath = execSync(`which ${item.bin}`, { encoding: 'utf8' }).trim();
      if (exePath && fs.existsSync(exePath)) {
        let logo = '';
        try {
          const iconImage = await app.getFileIcon(exePath, { size: 'normal' });
          logo = iconImage.toDataURL();
        } catch (e) {
          // Ignore icon errors on linux
        }
        browsersMap.set(item.id, {
          id: item.id,
          name: item.name,
          engine: item.engine,
          path: exePath,
          logo,
          supportsCDP: true
        });
      }
    } catch (e) {
      // which returned non-zero, binary not found
    }
  }

  return Array.from(browsersMap.values());
}

export async function getAvailableBrowsers(): Promise<BrowserInfo[]> {
  const platform = os.platform();
  try {
    if (platform === 'win32') {
      return await getWindowsBrowsers();
    } else if (platform === 'darwin') {
      return await getMacBrowsers();
    } else {
      return await getLinuxBrowsers();
    }
  } catch (e) {
    console.error('[BrowserDetector] Error detecting browsers:', e);
    return [];
  }
}
