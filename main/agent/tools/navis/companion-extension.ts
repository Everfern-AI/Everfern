import { exec } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getAvailableBrowsers, type BrowserInfo } from '../../../lib/browser-detector';
import { bridgeServer } from '../../../lib/extension-server';

type NavisExtensionTarget = 'chrome' | 'firefox';

export interface NavisCompanionPrepareResult {
  success: boolean;
  message: string;
  extensionPath: string;
  browserName?: string;
  browserEngine?: NavisExtensionTarget;
  connected: boolean;
  installInstructions?: string[];
}

function extensionBaseDir(): string {
  return path.join(os.homedir(), '.everfern', 'extensions');
}

async function resolveBrowser(selectedBrowserId: string): Promise<BrowserInfo | null> {
  const browsers = await getAvailableBrowsers().catch(() => []);
  const lower = selectedBrowserId.toLowerCase();
  return (
    browsers.find(b => b.id === selectedBrowserId) ||
    browsers.find(b => b.id.toLowerCase().includes(lower) || b.name.toLowerCase().includes(lower)) ||
    (lower.includes('firefox') ? browsers.find(b => b.engine === 'firefox') : undefined) ||
    (lower.includes('chrome') ? browsers.find(b => b.name.toLowerCase().includes('chrome') || b.id.includes('chrome')) : undefined) ||
    browsers.find(b => b.engine === 'chromium') ||
    browsers.find(b => b.engine === 'firefox') ||
    null
  );
}

function findExtensionSourceDir(): string {
  const candidates = [
    process.env.EVERFERN_NAVIS_EXTENSION_DIR,
    path.resolve(process.cwd(), '..', 'extension-navis'),
    path.resolve(process.cwd(), 'apps', 'extension-navis'),
    path.resolve(__dirname, '..', '..', '..', '..', '..', 'extension-navis'),
    path.resolve(__dirname, '..', '..', '..', '..', '..', '..', 'extension-navis'),
    process.resourcesPath ? path.join(process.resourcesPath, 'extension-navis') : '',
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'manifest.chrome.json')) && fs.existsSync(path.join(candidate, 'src', 'background.js'))) {
      return candidate;
    }
  }

  throw new Error(
    `Navis extension source was not found. Expected apps/extension-navis next to apps/desktop. Checked: ${candidates.join(', ')}`,
  );
}

function rmrf(target: string): void {
  fs.rmSync(target, { recursive: true, force: true });
}

function copyDir(src: string, dst: string): void {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

function cleanDirContents(dir: string): void {
  if (!fs.existsSync(dir)) return;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        fs.rmSync(entryPath, { recursive: true, force: true });
      } else {
        fs.rmSync(entryPath, { force: true });
      }
    }
  } catch (err) {
    console.warn('[Navis Companion] Failed to clean directory contents:', err);
  }
}

export const CHROME_EXTENSION_STORE_URL = "https://chromewebstore.google.com/detail/everfern-navis/pipkiglicdhcacieghoinohgfibhkmgf?hl=en&authuser=0";
export const FIREFOX_EXTENSION_STORE_URL = "https://addons.mozilla.org/en-US/firefox/addon/everfern-navis/";

function installInstructions(target: NavisExtensionTarget, extensionPath: string): string[] {
  if (target === 'firefox') {
    return [
      `Install from Firefox Add-ons: ${FIREFOX_EXTENSION_STORE_URL}`,
      'Or load temporarily: Open Firefox and go to about:debugging#/runtime/this-firefox, click "Load Temporary Add-on", and select ' + path.join(extensionPath, 'manifest.json'),
      'Keep EverFern Desktop open so the extension can connect to ws://127.0.0.1:4001.',
    ];
  }

  return [
    `Install from Chrome Web Store: ${CHROME_EXTENSION_STORE_URL}`,
    `Or load unpacked: Open chrome://extensions in Chrome/Brave/Edge, enable Developer mode, click "Load unpacked", and select ${extensionPath}.`,
    'Click Details on the EverFern Navis extension and ensure "Site access" is set to "On all sites" (required for automation and screenshots).',
    'Keep EverFern Desktop open so the extension can connect to ws://127.0.0.1:4001.',
  ];
}

export function ensureNavisCompanionExtension(
  baseDir = extensionBaseDir(),
  target: NavisExtensionTarget = 'chrome',
): string {
  const sourceDir = findExtensionSourceDir();
  const extensionPath = path.join(baseDir, `navis-${target}`);
  const builtDir = path.join(sourceDir, 'dist', target);
  const manifestName = target === 'firefox' ? 'manifest.firefox.json' : 'manifest.chrome.json';

  if (!fs.existsSync(extensionPath)) {
    fs.mkdirSync(extensionPath, { recursive: true });
  } else {
    cleanDirContents(extensionPath);
  }

  if (fs.existsSync(path.join(builtDir, 'manifest.json'))) {
    copyDir(builtDir, extensionPath);
  } else {
    copyDir(path.join(sourceDir, 'src'), extensionPath);
    fs.copyFileSync(path.join(sourceDir, manifestName), path.join(extensionPath, 'manifest.json'));
  }

  fs.writeFileSync(
    path.join(extensionPath, 'INSTALL.txt'),
    installInstructions(target, extensionPath).join('\n'),
    'utf-8',
  );

  return extensionPath;
}

export async function prepareNavisMainProfileExtension(
  selectedBrowserId = 'chrome',
  _startUrl?: string,
): Promise<NavisCompanionPrepareResult> {
  const browserInfo = await resolveBrowser(selectedBrowserId);
  const target: NavisExtensionTarget = browserInfo?.engine === 'firefox' ? 'firefox' : 'chrome';
  const extensionPath = ensureNavisCompanionExtension(extensionBaseDir(), target);
  let connected = bridgeServer.hasConnectedExtensions() || await bridgeServer.waitForExtensionConnection(1200);

  if (!connected && browserInfo?.path) {
    console.log(`[Navis Companion] Attempting to wake up extension by launching: ${browserInfo.path} http://127.0.0.1:4001/wake`);
    exec(`"${browserInfo.path}" http://127.0.0.1:4001/wake`, (err) => {
      if (err) {
        console.error('[Navis Companion] Failed to launch browser to wake extension:', err);
      }
    });
    // Wait for connection again after wake attempt
    connected = bridgeServer.hasConnectedExtensions() || await bridgeServer.waitForExtensionConnection(3000);
  }

  const instructions = installInstructions(target, extensionPath);

  return {
    success: connected,
    connected,
    extensionPath,
    browserName: browserInfo?.name || (target === 'firefox' ? 'Firefox' : 'Chromium browser'),
    browserEngine: target,
    installInstructions: instructions,
    message: connected
      ? `Navis extension is connected in ${browserInfo?.name || target}.`
      : [
          `The EverFern Navis browser extension is not installed or connected in ${browserInfo?.name || target}. Please install it to allow browser automation:`,
          `\n**Installation Links:**`,
          `- **Chrome / Edge / Brave**: [Install from Chrome Web Store](${CHROME_EXTENSION_STORE_URL})`,
          `- **Firefox**: [Install from Firefox Add-ons](${FIREFOX_EXTENSION_STORE_URL})`,
          `\n**Setup Instructions:**`,
          ...instructions.map((inst, i) => `${i + 1}. ${inst}`),
          `\nOnce installed, make sure "Site access" is set to "On all sites" in extension details, keep EverFern Desktop running, and retry the request.`,
        ].join('\n'),
  };
}

export function getNavisCompanionStatus() {
  let chromePath = '';
  let firefoxPath = '';
  let sourceDir = '';
  try {
    sourceDir = findExtensionSourceDir();
    chromePath = ensureNavisCompanionExtension(extensionBaseDir(), 'chrome');
    firefoxPath = ensureNavisCompanionExtension(extensionBaseDir(), 'firefox');
  } catch (error) {
    sourceDir = error instanceof Error ? error.message : String(error);
  }

  const bridge = bridgeServer.getStatus();
  return {
    ...bridge,
    sourceDir,
    extensionPath: chromePath,
    chromeExtensionPath: chromePath,
    firefoxExtensionPath: firefoxPath,
    connected: bridge.connectedExtensions > 0,
  };
}

export function broadcastNavisCompanionProgress(event: Record<string, unknown>): void {
  bridgeServer.broadcastCommand('navis-progress', event);
}

export async function sendNavisCompanionCommand(command: string, data: any = {}, timeoutMs = 10000): Promise<any> {
  return await bridgeServer.sendRequest(command, data, timeoutMs);
}
