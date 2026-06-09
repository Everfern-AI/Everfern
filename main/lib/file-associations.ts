/**
 * file-associations.ts
 *
 * Cross-platform: resolve which apps can open a given file extension,
 * fetching native icons via Electron's app.getFileIcon().
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { app, shell } from 'electron';

const execAsync = promisify(exec);

export interface FileApp {
  name: string;       // Display name
  path: string;       // Executable / app bundle path
  icon: string;       // base64 data URL icon
}

const COMMON_FILE_EXTENSIONS = [
  'txt', 'md', 'json', 'jsonc', 'log', 'csv', 'xml', 'yaml', 'yml',
  'env', 'gitignore', 'gitmodules', 'npmrc',
  'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'css', 'scss', 'html',
  'py', 'rs', 'go', 'java', 'cs', 'c', 'cpp', 'h', 'hpp', 'sql', 'ps1', 'bat',
  'svg', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'ico',
  'pdf', 'doc', 'docx', 'rtf', 'xls', 'xlsx', 'ppt', 'pptx',
  'mp3', 'wav', 'ogg', 'm4a', 'mp4', 'webm', 'mov',
];

const appsByExt = new Map<string, FileApp[]>();
const pendingAppsByExt = new Map<string, Promise<FileApp[]>>();
let preloadPromise: Promise<void> | null = null;

function normalizeExtension(filePathOrExt: string): string {
  const input = String(filePathOrExt || '').trim();
  const base = path.basename(input).toLowerCase();
  if (base === '.gitignore') return 'gitignore';
  if (base === '.gitmodules') return 'gitmodules';
  if (base === '.npmrc') return 'npmrc';
  if (base === '.env' || base.startsWith('.env.')) return 'env';

  const ext = path.extname(base || input).replace('.', '').toLowerCase();
  if (ext) return ext;
  return input.replace(/^\./, '').toLowerCase();
}

async function resolveAppsForExt(ext: string): Promise<FileApp[]> {
  const normalizedExt = normalizeExtension(ext);
  if (!normalizedExt) return [];
  if (appsByExt.has(normalizedExt)) return appsByExt.get(normalizedExt)!;
  if (pendingAppsByExt.has(normalizedExt)) return pendingAppsByExt.get(normalizedExt)!;

  const loadPromise = (async () => {
    const platform = os.platform();
    try {
      const apps =
        platform === 'win32' ? await getWindowsApps(normalizedExt) :
        platform === 'darwin' ? await getMacApps(normalizedExt) :
        await getLinuxApps(normalizedExt);
      appsByExt.set(normalizedExt, apps);
      return apps;
    } catch (e) {
      console.warn(`[FileAssociations] Failed to get apps for .${normalizedExt}:`, e);
      appsByExt.set(normalizedExt, []);
      return [];
    } finally {
      pendingAppsByExt.delete(normalizedExt);
    }
  })();

  pendingAppsByExt.set(normalizedExt, loadPromise);
  return loadPromise;
}

async function warmExtsInBatches(exts: string[], concurrency = 4): Promise<void> {
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, exts.length) }, async () => {
    while (index < exts.length) {
      const ext = exts[index++];
      await resolveAppsForExt(ext);
    }
  });
  await Promise.all(workers);
}

export function preloadFileAppCache(): Promise<void> {
  if (preloadPromise) return preloadPromise;
  preloadPromise = (async () => {
    await app.whenReady();
    const uniqueExts = [...new Set(COMMON_FILE_EXTENSIONS.map(normalizeExtension).filter(Boolean))];
    await warmExtsInBatches(uniqueExts);
    console.log(`[FileAssociations] Warmed app cache for ${uniqueExts.length} file types`);
  })().catch((err) => {
    console.warn('[FileAssociations] Warm cache failed:', err);
  });
  return preloadPromise;
}

export function getFileAppCacheStatus() {
  return {
    ready: Boolean(preloadPromise) && pendingAppsByExt.size === 0,
    cachedExtensions: Array.from(appsByExt.keys()),
    pendingExtensions: Array.from(pendingAppsByExt.keys()),
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Open a file with a specific app (or default app if appPath not provided)
// ──────────────────────────────────────────────────────────────────────────────
export async function openFileWithApp(filePath: string, appPath?: string): Promise<void> {
  const platform = os.platform();

  if (!appPath) {
    const err = await shell.openPath(filePath);
    if (err) throw new Error(err);
    return;
  }

  if (platform === 'win32') {
    await execAsync(`start "" "${appPath}" "${filePath}"`);
  } else if (platform === 'darwin') {
    await execAsync(`open -a "${appPath}" "${filePath}"`);
  } else {
    // Linux: most apps can be launched directly
    const proc = require('child_process').spawn(appPath, [filePath], {
      detached: true,
      stdio: 'ignore',
    });
    proc.unref();
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Fetch the icon for an app executable / bundle path as a base64 data URL
// ──────────────────────────────────────────────────────────────────────────────
async function fetchIcon(targetPath: string): Promise<string> {
  try {
    await app.whenReady();
    const img = await app.getFileIcon(targetPath, { size: 'normal' });
    return img.toDataURL();
  } catch {
    return '';
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// WINDOWS – query registry for associations, fall back to known editors
// ──────────────────────────────────────────────────────────────────────────────
async function getWindowsApps(ext: string): Promise<FileApp[]> {
  const apps: Map<string, FileApp> = new Map();

  // --- Strategy 1: HKCR\.<ext>\OpenWithProgids → ProgId → shell\open\command
  try {
    const { stdout: progids } = await execAsync(
      `reg query "HKCR\\.${ext}\\OpenWithProgids" /s 2>nul`
    ).catch(() => ({ stdout: '' }));

    const ids = progids
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('HKEY') && !l.startsWith('(Default)'))
      .map(l => l.split(/\s+/)[0])
      .filter(Boolean);

    for (const id of ids) {
      try {
        const { stdout: cmd } = await execAsync(
          `reg query "HKCR\\${id}\\shell\\open\\command" /ve 2>nul`
        ).catch(() => ({ stdout: '' }));

        const match = cmd.match(/"([^"]+\.exe)"|([A-Za-z]:[^"\s]+\.exe)/i);
        if (match) {
          const exePath = match[1] || match[2];
          if (exePath && fs.existsSync(exePath)) {
            const name = path.basename(exePath, '.exe')
              .replace(/[-_]/g, ' ')
              .replace(/\b\w/g, c => c.toUpperCase());
            if (!apps.has(exePath.toLowerCase())) {
              const icon = await fetchIcon(exePath);
              apps.set(exePath.toLowerCase(), { name, path: exePath, icon });
            }
          }
        }
      } catch { /* skip */ }
    }
  } catch { /* skip */ }

  // --- Strategy 2: HKCR\.<ext>\OpenWithList
  try {
    const { stdout } = await execAsync(
      `reg query "HKCR\\.${ext}\\OpenWithList" /s 2>nul`
    ).catch(() => ({ stdout: '' }));

    const exeNames = stdout
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('HKEY') && !l.startsWith('(Default)'))
      .map(l => l.split(/\s+/)[0])
      .filter(n => n.endsWith('.exe'));

    for (const exeName of exeNames) {
      try {
        const { stdout: where } = await execAsync(`where "${exeName}" 2>nul`).catch(() => ({ stdout: '' }));
        const exePath = where.trim().split('\n')[0].trim();
        if (exePath && fs.existsSync(exePath)) {
          const name = path.basename(exePath, '.exe')
            .replace(/[-_]/g, ' ')
            .replace(/\b\w/g, c => c.toUpperCase());
          if (!apps.has(exePath.toLowerCase())) {
            const icon = await fetchIcon(exePath);
            apps.set(exePath.toLowerCase(), { name, path: exePath, icon });
          }
        }
      } catch { /* skip */ }
    }
  } catch { /* skip */ }

  // --- Strategy 3: Well-known editors on Windows (fallback seed)
  const knownEditors: { name: string; paths: string[] }[] = [
    {
      name: 'VS Code',
      paths: [
        'C:\\Program Files\\Microsoft VS Code\\Code.exe',
        path.join(os.homedir(), 'AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe'),
      ],
    },
    {
      name: 'Paint',
      paths: [`${process.env.SystemRoot || 'C:\\Windows'}\\System32\\mspaint.exe`],
    },
    {
      name: 'Notepad++',
      paths: ['C:\\Program Files\\Notepad++\\notepad++.exe', 'C:\\Program Files (x86)\\Notepad++\\notepad++.exe'],
    },
    { name: 'Notepad', paths: [`${process.env.SystemRoot || 'C:\\Windows'}\\System32\\notepad.exe`] },
    {
      name: 'Sublime Text',
      paths: ['C:\\Program Files\\Sublime Text\\sublime_text.exe', 'C:\\Program Files\\Sublime Text 3\\sublime_text.exe'],
    },
    {
      name: 'Microsoft Word',
      paths: [
        'C:\\Program Files\\Microsoft Office\\root\\Office16\\WINWORD.EXE',
        'C:\\Program Files (x86)\\Microsoft Office\\root\\Office16\\WINWORD.EXE',
      ],
    },
    {
      name: 'Microsoft Excel',
      paths: [
        'C:\\Program Files\\Microsoft Office\\root\\Office16\\EXCEL.EXE',
        'C:\\Program Files (x86)\\Microsoft Office\\root\\Office16\\EXCEL.EXE',
      ],
    },
  ];

  const textExts = ['txt', 'md', 'json', 'csv', 'log', 'yaml', 'yml', 'xml', 'ts', 'js', 'tsx', 'jsx', 'py', 'rs', 'go', 'mjs', 'cjs', 'env', 'gitignore', 'gitmodules', 'npmrc', 'svg', 'html', 'css', 'scss'];
  const docExts = ['docx', 'doc', 'rtf'];
  const sheetExts = ['xlsx', 'xls', 'csv'];
  const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'ico'];

  for (const { name, paths: candidates } of knownEditors) {
    if (name === 'Microsoft Word' && !docExts.includes(ext)) continue;
    if (name === 'Microsoft Excel' && !sheetExts.includes(ext)) continue;
    if (name === 'Paint' && !imageExts.includes(ext)) continue;
    if ((name === 'Notepad' || name === 'Notepad++' || name === 'Sublime Text' || name === 'VS Code') && !textExts.includes(ext)) continue;

    for (const candidate of candidates) {
      if (fs.existsSync(candidate) && !apps.has(candidate.toLowerCase())) {
        const icon = await fetchIcon(candidate);
        apps.set(candidate.toLowerCase(), { name, path: candidate, icon });
        break;
      }
    }
  }

  return Array.from(apps.values()).slice(0, 8);
}

// ──────────────────────────────────────────────────────────────────────────────
// MACOS – use lsregister to find app bundles for a UTI / extension
// ──────────────────────────────────────────────────────────────────────────────
async function getMacApps(ext: string): Promise<FileApp[]> {
  const apps: Map<string, FileApp> = new Map();

  try {
    // Use 'open' to ask the system which apps can open the extension
    const tmpFile = path.join(os.tmpdir(), `everfern-probe.${ext}`);
    fs.writeFileSync(tmpFile, '');

    const { stdout } = await execAsync(
      `/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister -dump 2>/dev/null | grep -i ".${ext}" | grep "app" | head -30`
    ).catch(() => ({ stdout: '' }));

    fs.rmSync(tmpFile, { force: true });

    const appPaths = stdout
      .split('\n')
      .map(l => {
        const m = l.match(/\/[^\s]+\.app/);
        return m ? m[0] : null;
      })
      .filter((p): p is string => !!p && fs.existsSync(p));

    for (const appPath of [...new Set(appPaths)]) {
      const name = path.basename(appPath, '.app');
      if (!apps.has(appPath)) {
        const icon = await fetchIcon(appPath);
        apps.set(appPath, { name, path: appPath, icon });
      }
    }
  } catch { /* skip */ }

  // Fallback: well-known macOS apps
  const knownMacApps: { name: string; appPath: string; exts: string[] }[] = [
    { name: 'VS Code', appPath: '/Applications/Visual Studio Code.app', exts: [] },
    { name: 'TextEdit', appPath: '/System/Applications/TextEdit.app', exts: ['txt', 'md', 'rtf'] },
    { name: 'Preview', appPath: '/System/Applications/Preview.app', exts: ['pdf', 'png', 'jpg', 'jpeg', 'gif', 'svg'] },
    { name: 'Numbers', appPath: '/Applications/Numbers.app', exts: ['csv', 'xlsx', 'xls'] },
    { name: 'Pages', appPath: '/Applications/Pages.app', exts: ['docx', 'doc', 'rtf'] },
    { name: 'Keynote', appPath: '/Applications/Keynote.app', exts: ['pptx', 'ppt'] },
    { name: 'Sublime Text', appPath: '/Applications/Sublime Text.app', exts: [] },
    { name: 'Zed', appPath: '/Applications/Zed.app', exts: [] },
    { name: 'Nova', appPath: '/Applications/Nova.app', exts: [] },
  ];

  for (const { name, appPath, exts } of knownMacApps) {
    if (exts.length > 0 && !exts.includes(ext)) continue;
    if (fs.existsSync(appPath) && !apps.has(appPath)) {
      const icon = await fetchIcon(appPath);
      apps.set(appPath, { name, path: appPath, icon });
    }
  }

  return Array.from(apps.values()).slice(0, 8);
}

// ──────────────────────────────────────────────────────────────────────────────
// LINUX – parse .desktop files for MIME type matches
// ──────────────────────────────────────────────────────────────────────────────
async function getLinuxApps(ext: string): Promise<FileApp[]> {
  const apps: Map<string, FileApp> = new Map();

  try {
    // Resolve MIME type for extension
    const { stdout: mime } = await execAsync(`xdg-mime query default application/x-${ext} 2>/dev/null || echo ""`).catch(() => ({ stdout: '' }));
    const mimeTypes = [`application/x-${ext}`, `text/x-${ext}`, `text/${ext}`, `application/${ext}`];

    const desktopDirs = [
      '/usr/share/applications',
      '/usr/local/share/applications',
      path.join(os.homedir(), '.local/share/applications'),
    ];

    for (const dir of desktopDirs) {
      if (!fs.existsSync(dir)) continue;
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.desktop'));

      for (const file of files) {
        try {
          const content = fs.readFileSync(path.join(dir, file), 'utf-8');
          const mimeMatch = mimeTypes.some(mt => content.includes(mt));
          if (!mimeMatch) continue;

          const nameMatch = content.match(/^Name=(.+)/m);
          const execMatch = content.match(/^Exec=(.+)/m);
          if (!nameMatch || !execMatch) continue;

          let execPath = execMatch[1].replace(/%[uUfF]/g, '').trim().split(' ')[0];
          if (!execPath.startsWith('/')) {
            const { stdout: which } = await execAsync(`which "${execPath}" 2>/dev/null`).catch(() => ({ stdout: '' }));
            execPath = which.trim();
          }

          if (execPath && !apps.has(execPath)) {
            const icon = await fetchIcon(execPath).catch(() => '');
            apps.set(execPath, { name: nameMatch[1].trim(), path: execPath, icon });
          }
        } catch { /* skip */ }
      }
    }
  } catch { /* skip */ }

  return Array.from(apps.values()).slice(0, 8);
}

// ──────────────────────────────────────────────────────────────────────────────
// Main export: get apps for a file extension, cross-platform
// ──────────────────────────────────────────────────────────────────────────────
export async function getAppsForFile(filePath: string): Promise<FileApp[]> {
  const ext = normalizeExtension(filePath);
  return resolveAppsForExt(ext);
}
