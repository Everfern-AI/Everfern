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

function installInstructions(target: NavisExtensionTarget, extensionPath: string): string[] {
  if (target === 'firefox') {
    return [
      'Open Firefox and go to about:debugging#/runtime/this-firefox.',
      'Click "Load Temporary Add-on".',
      `Select ${path.join(extensionPath, 'manifest.json')}.`,
      'Keep EverFern Desktop open so the extension can connect to ws://127.0.0.1:4001.',
    ];
  }

  return [
    'Open chrome://extensions in Chrome, Edge, Brave, or another Chromium browser.',
    'Enable Developer mode.',
    'Click "Load unpacked".',
    `Select ${extensionPath}.`,
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

  rmrf(extensionPath);
  fs.mkdirSync(extensionPath, { recursive: true });

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
  const connected = bridgeServer.hasConnectedExtensions() || await bridgeServer.waitForExtensionConnection(1200);
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
          `Navis extension is prepared for ${browserInfo?.name || target}, but it is not connected yet.`,
          ...instructions,
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
