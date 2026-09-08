/**
 * file-associations.ts
 *
 * Cross-platform: resolve which apps can open a given file extension,
 * fetching native icons via Electron's app.getFileIcon().
 *
 * Platform resolution ORDER (with per-platform fallbacks when the primary
 * source is missing — registry absent, lsregister empty, no MIME match):
 *  - win32:  HKCR registry (OpenWithProgids → OpenWithList), then a
 *            well-known-editors seed list.
 *  - darwin: LaunchServices (lsregister dump), then well-known /Applications
 *            bundles.
 *  - linux:  MIME-matched .desktop files across system + user application
 *            dirs; no xdg-specific fallback list exists, so no matches
 *            simply yields [].
 *
 * Results are cached per normalized extension for the process lifetime.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { exec, execFile, SpawnOptions } from 'child_process';
import { promisify } from 'util';
import { app, shell } from 'electron';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

// ── winreg is Windows-only. Lazy dynamic-import (injected seam, MP-XPLAT-02)
//    so non-Windows platforms never load it and tests can stub 'winreg'. ──
// registryLoadAttempted guards against retrying the import on every call —
// a failed load (missing package) is remembered for the process lifetime.
let registryLib: any = null;
let registryLoadAttempted = false;

/**
 * Resolve the winreg module on Windows (once). Returns the module, or null on
 * non-Windows platforms / failed load — callers must treat null as "registry
 * unavailable" and fall back gracefully.
 */
async function getRegistryLib(): Promise<any> {
  if (!registryLoadAttempted && process.platform === 'win32') {
    registryLoadAttempted = true;
    try {
      const mod: any = await import('winreg');
      registryLib = mod && mod.__esModule && mod.default ? mod.default : mod;
    } catch (e) {
      console.warn('[FileAssociations] winreg unavailable — Windows registry lookup disabled:', e);
    }
  }
  return registryLib;
}

// Registry access helpers (winreg-based — no shell `reg query` string parsing).
// Both resolve empty/null on any failure (graceful degradation).
// Both target HKCR (HKEY_CLASSES_ROOT): the merged system+user view of file
// associations, so one hive covers both machine-wide and per-user entries.
/** List all values under an HKCR key; resolves [] on any failure. */
function regListValues(key: string): Promise<any[]> {
  return new Promise(async (resolve) => {
    const lib = await getRegistryLib();
    if (!lib) return resolve([]);
    try {
      const regKey = new lib({ hive: lib.HKCR, key });
      regKey.values((err: any, values: any[]) => {
        if (err || !Array.isArray(values)) resolve([]);
        else resolve(values);
      });
    } catch {
      resolve([]);
    }
  });
}

/** Read a value under an HKCR key (default value when name omitted); resolves null on any failure. */
function regGetValue(key: string, name: string = ''): Promise<string | null> {
  return new Promise(async (resolve) => {
    const lib = await getRegistryLib();
    if (!lib) return resolve(null);
    try {
      const regKey = new lib({ hive: lib.HKCR, key });
      regKey.get(name, (err: any, item: any) => {
        if (err || !item) resolve(null);
        else resolve(item.value);
      });
    } catch {
      resolve(null);
    }
  });
}

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

// Result cache: normalized ext → resolved apps. Entries persist for the
// process lifetime (successes AND failures — a failed lookup caches [] so it
// is not retried).
const appsByExt = new Map<string, FileApp[]>();
// In-flight lookups: concurrent requests for the same ext share one promise
// (single-flight dedupe) instead of racing duplicate platform scans.
const pendingAppsByExt = new Map<string, Promise<FileApp[]>>();
let preloadPromise: Promise<void> | null = null;

/**
 * Normalize a file path or raw extension string to a cache-key extension
 * (lowercased, dot-stripped). Dotfiles (.gitignore, .env, ...) map to their
 * own keys since path.extname() would not return them.
 */
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

/**
 * Resolve apps for one normalized extension via the platform-specific
 * strategy. Cache-aware and single-flight: a completed cache entry returns
 * immediately, concurrent callers share the in-flight promise. Failures
 * resolve to [] (and are cached as such) rather than rejecting.
 */
async function resolveAppsForExt(ext: string): Promise<FileApp[]> {
  const normalizedExt = normalizeExtension(ext);
  if (!normalizedExt) return [];
  if (appsByExt.has(normalizedExt)) return appsByExt.get(normalizedExt)!;
  if (pendingAppsByExt.has(normalizedExt)) return pendingAppsByExt.get(normalizedExt)!;

  const loadPromise = (async () => {
    // Dispatch by os.platform() (runtime value) — mirrors how tests stub the
    // platform to exercise each strategy.
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

/**
 * Warm the cache for many extensions with a small worker pool — bounded
 * concurrency keeps registry/lsregister/.desktop scans from stampeding the
 * system all at once.
 */
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

/**
 * Warm the app-association cache for COMMON_FILE_EXTENSIONS after Electron
 * is ready. Idempotent: repeated calls share one preload promise; a warm
 * failure is logged and swallowed (cache fills lazily on demand later).
 */
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

/**
 * Cache introspection for diagnostics: readiness (preload done, no lookups
 * in flight), which extensions are cached, and which are still resolving.
 */
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
/**
 * Open `filePath` with the app at `appPath`, or with the OS default handler
 * when appPath is omitted (Electron shell.openPath). All platform branches
 * spawn detached so the launched app outlives the main process.
 *
 * @throws When shell.openPath reports an error, or the Windows `start`
 *         command exits non-zero. Linux fire-and-forget spawn never rejects.
 */
export async function openFileWithApp(filePath: string, appPath?: string): Promise<void> {
  const platform = os.platform();

  if (!appPath) {
    const err = await shell.openPath(filePath);
    if (err) throw new Error(err);
    return;
  }

  if (platform === 'win32') {
    const proc = require('child_process').spawn(
      'cmd.exe',
      ['/d', '/s', '/c', 'start', '', appPath, filePath],
      { windowsHide: true, detached: true, stdio: 'ignore' }
    );
    proc.unref();
    await new Promise<void>((resolve, reject) => {
      proc.once('error', reject);
      proc.once('close', (code: number | null) => {
        // `start` returns immediately after delegating to the app — a
        // non-zero code means the launch itself failed (bad path, bad app).
        if (code) reject(new Error(`start exited with code ${code}`));
        else resolve();
      });
    });
  } else if (platform === 'darwin') {
    const openOpts: SpawnOptions = { detached: true, stdio: 'ignore' };
    await execFileAsync('open', ['-a', appPath, filePath], openOpts);
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
/**
 * Best-effort icon fetch; resolves '' when Electron is not ready or the
 * icon lookup fails, so a missing icon never drops the app from results.
 */
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
// Strategy ORDER: (1) OpenWithProgids ProgIds, (2) OpenWithList exe names,
// (3) well-known editors. Strategies append (deduped by lowercase exe path,
// registry results first) so earlier strategies never shadow later ones.
// Each strategy degrades independently — a failure/miss just moves on.
async function getWindowsApps(ext: string): Promise<FileApp[]> {
  const apps: Map<string, FileApp> = new Map();

  // --- Strategy 1: HKCR\.<ext>\OpenWithProgids → ProgId → shell\open\command
  // (winreg-based — replaces shell `reg query` string parsing, MP-XPLAT-02)
  try {
    const progidValues = await regListValues(`\\.${ext}\\OpenWithProgids`);
    const ids = progidValues.map((v: any) => v && v.name).filter((n: any) => n && n !== '@');

    for (const id of ids) {
      try {
        const commandVal = await regGetValue(`\\${id}\\shell\\open\\command`);
        if (commandVal) {
          let exePath = String(commandVal).trim();
          if (exePath.startsWith('"')) {
            const nextQuote = exePath.indexOf('"', 1);
            if (nextQuote !== -1) exePath = exePath.substring(1, nextQuote);
          } else {
            // Unquoted: strip trailing args — take up to .exe boundary
            const m = exePath.match(/^([A-Za-z]:\\[^"]+?\.exe)/i) || exePath.match(/^(\S+\.exe)/i);
            exePath = m ? m[1] : exePath.split(/\s+-/)[0];
          }
          if (exePath && fs.existsSync(exePath)) {
            const name = path.win32.basename(exePath)
              .replace(/\.exe$/i, '')
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

  // --- Strategy 2: HKCR\.<ext>\OpenWithList (winreg-based)
  // Values are bare exe names (e.g. "Code.exe") — resolve via fs probe of common
  // dirs + execFile('where', [name]) fallback (no shell, no string interpolation).
  // ProgIds are absent for some legacy associations; OpenWithList covers them.
  try {
    const owlValues = await regListValues(`\\.${ext}\\OpenWithList`);
    const exeNames = owlValues.map((v: any) => v && v.name).filter((n: any) => n && n !== '@' && /\.exe$/i.test(n));

    const systemRoot = process.env.SystemRoot || 'C:\\Windows';
    const searchDirs = [
      `${systemRoot}\\System32`,
      `${systemRoot}`,
      'C:\\Program Files',
      'C:\\Program Files (x86)',
    ];
    const whereFallback = (exeName: string): Promise<string | null> =>
      new Promise((resolve) => {
        try {
          execFile('where', [exeName], { encoding: 'utf8' }, (err: any, stdout: string) => {
            if (err || !stdout) return resolve(null);
            resolve(String(stdout).trim().split('\n')[0].trim() || null);
          });
        } catch {
          resolve(null);
        }
      });

    for (const exeName of exeNames) {
      try {
        let exePath: string | null = null;
        for (const dir of searchDirs) {
          const candidate = path.join(dir, exeName);
          try {
            if (fs.existsSync(candidate)) { exePath = candidate; break; }
          } catch { /* skip */ }
        }
        if (!exePath) exePath = await whereFallback(exeName);
        if (exePath && fs.existsSync(exePath)) {
          const name = path.win32.basename(exePath)
            .replace(/\.exe$/i, '')
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

  // Registry yielded nothing on this platform? Surface it — the known-editors
  // fallback below IS the surfaced state for the UI (MP-XPLAT-02).
  // Fires once per extension when both registry strategies came up empty
  // (including the winreg-unavailable case) — the fallback list then carries
  // the result on its own.
  if (apps.size === 0) {
    console.warn(`[FileAssociations] No apps found via registry for .${ext} — falling back to known editors list`);
  }

  // --- Strategy 3: Well-known editors on Windows (fallback seed)
  // Last resort when the registry has no association for the extension:
  // probe common install locations for popular editors and filter them by
  // extension category so an image ext doesn't offer Word, etc.
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
    {
      name: 'Microsoft PowerPoint',
      paths: [
        'C:\\Program Files\\Microsoft Office\\root\\Office16\\POWERPNT.EXE',
        'C:\\Program Files (x86)\\Microsoft Office\\root\\Office16\\POWERPNT.EXE',
        'C:\\Program Files\\Microsoft Office\\Office16\\POWERPNT.EXE',
        'C:\\Program Files (x86)\\Microsoft Office\\Office16\\POWERPNT.EXE',
        'C:\\Program Files\\Microsoft Office\\Office15\\POWERPNT.EXE',
        'C:\\Program Files (x86)\\Microsoft Office\\Office15\\POWERPNT.EXE',
      ],
    },
  ];

  const textExts = ['txt', 'md', 'json', 'csv', 'log', 'yaml', 'yml', 'xml', 'ts', 'js', 'tsx', 'jsx', 'py', 'rs', 'go', 'mjs', 'cjs', 'env', 'gitignore', 'gitmodules', 'npmrc', 'svg', 'html', 'css', 'scss'];
  const docExts = ['docx', 'doc', 'rtf'];
  const sheetExts = ['xlsx', 'xls', 'csv'];
  const pptExts = ['pptx', 'ppt'];
  const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'ico'];

  for (const { name, paths: candidates } of knownEditors) {
    // Category filter: only offer an editor when the extension plausibly
    // belongs to it (VS Code/Sublime accept all text-ish types via textExts).
    if (name === 'Microsoft Word' && !docExts.includes(ext)) continue;
    if (name === 'Microsoft Excel' && !sheetExts.includes(ext)) continue;
    if (name === 'Microsoft PowerPoint' && !pptExts.includes(ext)) continue;
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
// Primary source is the LaunchServices database (lsregister -dump) — the
// authoritative list of registered handlers, including user installs outside
// /Applications. Known-apps probing is the fallback when LaunchServices has
// nothing (or the dump/parse fails) for this extension.
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
        // Extract the first .app bundle path from each lsregister line;
        // existence-checked because the dump may reference stale entries.
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
  // An empty exts array means "accepts any extension" (general editors);
  // otherwise the app is offered only for its listed extensions.
  const knownMacApps: { name: string; appPath: string; exts: string[] }[] = [
    { name: 'VS Code', appPath: '/Applications/Visual Studio Code.app', exts: [] },
    { name: 'TextEdit', appPath: '/System/Applications/TextEdit.app', exts: ['txt', 'md', 'rtf'] },
    { name: 'Preview', appPath: '/System/Applications/Preview.app', exts: ['pdf', 'png', 'jpg', 'jpeg', 'gif', 'svg'] },
    { name: 'Numbers', appPath: '/Applications/Numbers.app', exts: ['csv', 'xlsx', 'xls'] },
    { name: 'Pages', appPath: '/Applications/Pages.app', exts: ['docx', 'doc', 'rtf'] },
    { name: 'Keynote', appPath: '/Applications/Keynote.app', exts: ['pptx', 'ppt'] },
    { name: 'Microsoft PowerPoint', appPath: '/Applications/Microsoft PowerPoint.app', exts: ['pptx', 'ppt'] },
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
// Resolution chain: (optional) xdg-mime query for the default handler, then a
// direct scan of system + user .desktop directories matching the extension's
// candidate MIME types. There is no hardcoded known-apps fallback on Linux —
// no matches simply returns [].
async function getLinuxApps(ext: string): Promise<FileApp[]> {
  const apps: Map<string, FileApp> = new Map();

  try {
    // Resolve MIME type for extension
    // xdg-mime names the *default* handler (stdout feeds nothing below — the
    // scan matches on the candidate MIME types, not on this output); failures
    // degrade to an unconditional .desktop scan.
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
            // Relative Exec= commands (e.g. "code") must be resolved to an
            // absolute path via which, or getFileIcon/spawn can't use them.
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
/**
 * Get the apps that can open the given file, cross-platform, via the
 * per-platform strategy chain. Cache-backed: the first call for an extension
 * performs the (slow) platform scan; subsequent calls for the same extension
 * are instant, and concurrent calls share a single in-flight scan.
 *
 * @param filePath A file path (or bare extension) whose associations to resolve.
 * @returns Promise of up to 8 apps with display name, path, and icon.
 *          Never rejects — a total resolution failure resolves to [].
 */
export async function getAppsForFile(filePath: string): Promise<FileApp[]> {
  const ext = normalizeExtension(filePath);
  return resolveAppsForExt(ext);
}
