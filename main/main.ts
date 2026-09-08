/**
 * EverFern Desktop — Main Process (v2)
 *
 * Electron entry point. Creates the BrowserWindow, initializes the ACP
 * manager and AgentRunner, and registers all IPC handlers.
 *
 * Architecture:
 *   Renderer ─IPC─► Preload Bridge ─IPC─► Main Process
 *     ▲                                        │
 *     │            ACPManager (AIClient)        │
 *     │            AgentRunner (tools, prompt)  │
 *     └────────── ChatHistoryStore ─────────────┘
 */

import { app, BrowserWindow, ipcMain, dialog, protocol, net, clipboard, Notification, Menu, shell } from 'electron';

// Windows-only startup guard. Legacy Squirrel events no longer apply — the app
// is packaged with electron-builder (NSIS target), which never relaunches the
// app with Squirrel command-line switches. Kept as a structural no-op so the
// startup ordering below (AppUserModelId, logging, window creation) stays
// unchanged for Windows upgrades from legacy Squirrel installs.
if (process.platform === 'win32') {
  try {
    app.setAppUserModelId('com.everfern.desktop');
  } catch (e) {
    console.warn('[Startup] Could not set AppUserModelId:', e);
  }
}

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { resolveWithin } from './lib/path-guard';
import { acpManager } from './acp/manager';
import type { ProviderType } from './acp/types';
import { ChatHistoryStore } from './store/history';
import { AgentRunner } from './agent/runner/runner';
import { AIClient } from './lib/ai-client';
import { hydrateConfigWithIsolatedKeys } from './lib/vlm-config';
import { getAllModelsFlat, FlatModelEntry, PROVIDER_REGISTRY, getModelsForProvider, formatModelName } from './lib/providers';
import { toggleDebugWindow, setupLogging } from './lib/debug';
import { systemTrayManager } from './lib/system-tray-manager';
import { autoStartManager } from './lib/auto-start-manager';
import { getAppIconPath, getAppIcon, setupWindowIcon } from './lib/app-icon';
import { integrationService } from './integrations/integration-service';
import { autoStartEnabledBots, initializeBotMessageHandler, shutdownBotMessageHandler } from './ipc/integration-handlers';
import { checkDatabaseConnection, checkVectorStore } from './lib/health-check';
import { warmupFromActiveConfig } from './lib/model-warmup';

// ── Initialize Logging ──────────────────────────────────────────────
setupLogging();
console.log('[Startup] EverFern Main Process starting...');
console.log('[Startup] Platform:', process.platform);
console.log('[Startup] Node version:', process.version);
console.log('[Startup] App path:', app.getAppPath());
console.log('[Startup] User data:', app.getPath('userData'));

// ── Global quit/crash state ─────────────────────────────────────────
// Declared before the fatal-error net below so an early-startup crash
// can never hit a temporal dead zone while reading them.
let isAppQuitting = false;
let rendererCrashCount = 0;

// ── Global Fatal-Error Net ──────────────────────────────────────────
// Prevents silent main-process death: log, keep a breadcrumb, and stay alive
// for recoverable errors. A crash during window creation still relaunches.
process.on('uncaughtException', (err) => {
  console.error('[Fatal] Uncaught exception in main process:', err);
  try {
    // Persist the breadcrumb so crashes leave evidence on disk.
    const logsDir = path.join(app.getPath('userData'), 'crash-logs');
    fs.mkdirSync(logsDir, { recursive: true });
    fs.writeFileSync(
      path.join(logsDir, `main-${Date.now()}.log`),
      `${new Date().toISOString()}\n${err?.stack || String(err)}\n`
    );
  } catch { /* best effort */ }
  if (!isAppQuitting && app.isReady() && !BrowserWindow.getAllWindows().length) {
    // No window to recover into — relaunch rather than vanish.
    app.relaunch();
    app.exit(1);
  }
});
process.on('unhandledRejection', (reason) => {
  console.error('[Fatal] Unhandled rejection in main process:', reason);
});

// ── Check for Auto-Start Mode ───────────────────────────────────────
const isAutoStartMode = process.argv.includes('--auto-start');
console.log('[Startup] Auto-start mode:', isAutoStartMode);

import { globalShortcut } from 'electron';
import { memorySaveTool } from './agent/tools/memory-save';
import { dbOps, closeDb } from './lib/db';
import { listArtifacts, readArtifact, writeArtifact, deleteArtifact } from './store/artifacts';
import { writePlan, readPlan, listPlans, deletePlan } from './store/plans';
import { listSites, readSiteFile, writeSiteFile, deleteSite } from './store/sites';
import { searchChatVectors, getChatVectors, deleteChatVectors, getVectorStats, initChatVectorDb, getVectorStats as getVecStats } from './store/chat-vectors';
import { registerContextEngine, setDefaultContextEngine } from './context-engine';
import { VectorContextEngine } from './context-engine/vector';
import { syncBuiltInSkills, mergeCustomSkills, getCustomSkillsPath, listCustomSkills, listAllSkills, saveCustomSkill, deleteCustomSkill } from './lib/skills-sync';
import { CommandRegistry } from './agent/tools/terminal/registry';
import { initializePromptSync, watchPrompts } from './lib/prompt-sync';
import { initializeOpenClawConfigs, loadSoul, loadAgents, saveGlobalSoul, saveGlobalAgents } from './agent/personality-manager';
import { registerProjectsHandlers } from './ipc/projects';
import { ensurePlaywrightChromium } from './lib/playwright-setup';
import { playSoundFile } from './lib/sound-player';
import { ensureWSLSetup, ensureDockerContainer } from './agent/tools/linux-vm-executor';
import { shutdownMCPTools } from './agent/tools/mcp';
import { backgroundProcessor } from './agent/learning/background-processor';
import { initializeUpdater } from './updater';
import { toolApprovalStore } from './store/tool-approvals';

// ── GPU / Cache Startup Fixes (must run before app.whenReady) ───────────────
// Disable GPU shader disk cache — prevents "Access is denied (0x5)" on Windows
// when a previous Electron process left the GPUCache directory locked.
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
// NOTE: disable-application-cache is deprecated and causes grey screen on macOS — removed.
// Suppress Chromium GPU blocklist — lets the GPU initialise even after a crash.
app.commandLine.appendSwitch('ignore-gpu-blocklist');

// Clear stale GPU / network cache directories — ONLY after a previous run
// crashed (MP-LEAK-10 / battery A3: unconditional wipes discarded a warm
// shader cache on every launch). Async so the ready path is never blocked.
let previousSessionCrashed = false;
try {
  const crashFlagPath = path.join(app.getPath('userData'), 'session-crash-flag');
  previousSessionCrashed = fs.existsSync(crashFlagPath);
  fs.writeFileSync(crashFlagPath, '1');
} catch (e) {
  // Cannot access userData yet — keep the (already existing) conservative behavior off.
  previousSessionCrashed = false;
}

if (previousSessionCrashed) {
  console.log('[Startup] Previous session crashed — clearing stale GPU caches.');
  (async () => {
    try {
      const fsp = require('fs/promises') as typeof import('fs/promises');
      const userData = app.getPath('userData');
      const dirsToWipe = ['GPUCache', 'ShaderCache', 'DawnCache', 'GrShaderCache'];
      await Promise.all(dirsToWipe.map((dir) =>
        fsp.rm(path.join(userData, dir), { recursive: true, force: true }).catch(() => { })
      ));
    } catch (e) {
      console.warn('[Startup] Could not clear stale GPU cache:', e);
    }
  })();
}

import { setupIPC } from './ipc';

// ── Singletons ──────────────────────────────────────────────────────

let historyStore: ChatHistoryStore;

// MP-LIFE-05: ChatHistoryStore + IPC registration are the app's critical
// spine — continuing without them yields a half-broken app (a window whose
// every invoke fails). Bounded retry with small backoff; on final failure,
// leave a crash-log breadcrumb and exit. No relaunch loop.
(async () => {
  const MAX_INIT_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_INIT_ATTEMPTS; attempt++) {
    try {
      console.log('[Startup] ACPManager singleton already initialized');
      console.log(`[Startup] Initializing ChatHistoryStore + IPC (attempt ${attempt}/${MAX_INIT_ATTEMPTS})...`);
      historyStore = new ChatHistoryStore();

      // Register all modularized IPC handlers
      setupIPC(historyStore);

      console.log('[Startup] Singletons and IPC initialized.');
      return;
    } catch (err) {
      console.error(`[Startup] ❌ Critical init attempt ${attempt}/${MAX_INIT_ATTEMPTS} failed:`, err);
      if (attempt < MAX_INIT_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
      }
    }
  }

  // All attempts failed — fail fast instead of limping on half-initialized.
  console.error('[Startup] ❌ Critical failure during singleton initialization — exiting.');
  try {
    const logsDir = path.join(app.getPath('userData'), 'crash-logs');
    fs.mkdirSync(logsDir, { recursive: true });
    fs.writeFileSync(
      path.join(logsDir, `main-init-${Date.now()}.log`),
      `${new Date().toISOString()}\n[MP-LIFE-05] ChatHistoryStore/IPC init failed after ${MAX_INIT_ATTEMPTS} attempts\n`
    );
  } catch { /* best effort */ }
  app.exit(1);
})();

// ── Non-critical startup steps (each owns its error handling — never fatal) ──
try {
  /**
   * Ensures that ~/.everfern/SYSTEM_PROMPT.md exists, creating it with defaults if not.
   */
  function ensureSystemPromptExists() {
    const everfernDir = path.join(os.homedir(), '.everfern');
    const promptPath = path.join(everfernDir, 'SYSTEM_PROMPT.md');

    try {
      if (!fs.existsSync(everfernDir)) {
        fs.mkdirSync(everfernDir, { recursive: true });
      }

      if (!fs.existsSync(promptPath)) {
        console.log('[Startup] 📝 Creating default SYSTEM_PROMPT.md in ~/.everfern/');
        const defaultPrompt = `# EverFern System Prompt

You are EverFern, an autonomous AI workplace agent designed to help users with their daily tasks.
You have access to a variety of tools, including GUI automation, terminal access, and web search.

## Guidelines:
1. Be concise and professional.
2. Use tools whenever necessary to fulfill the user's request.
3. For GUI automation, use the 'computer_use' tool.
4. MANDATORY: Always describe actions and intent in clear, human-readable English sentences (e.g. "Pressing the Windows key to open Start menu", "Analyzing screenshot to locate the search bar") instead of raw technical codes or cryptic action names.
5. If you are unsure about a command, ask for clarification.

## Terminal Commands & Environment Targets
All terminal commands run through the terminal_execute tool. Ensure you set the correct 'target' parameter:
- **target: "main" (Default)**: Executes commands on the Host machine (PowerShell on Windows, Bash/Zsh on macOS). You MUST use host-compatible syntax and paths. Do NOT run Linux-specific bash commands (like "ls -la") on a Windows host.
- **target: "vm"**: Executes commands inside the Linux VM (WSL running Bash on Windows, Docker on macOS, native on Linux). You MUST use Linux Bash syntax and paths.
  - The VM sandbox has a dedicated virtual environment pre-configured at \`~/.everfern/venv\` with pre-installed document and data packages (\`pypdf\`, \`pdfplumber\`, \`reportlab\`, \`openpyxl\`, \`python-pptx\`, \`pandas\`, \`numpy\`, \`matplotlib\`, \`python-docx\`) and Node tools (\`pptxgenjs\`, \`docx\`, \`pdf-lib\`, \`exceljs\`).
  - Write any temporary scripts to \`/tmp\` or the workspace directory and execute with \`python3 script.py\` or \`node script.js\`.

Your goal is to be the ultimate workplace companion.
`;
        fs.writeFileSync(promptPath, defaultPrompt, 'utf-8');
      } else {
        console.log('[Startup] ✅ SYSTEM_PROMPT.md already exists in ~/.everfern/');
      }
    } catch (err) {
      console.error('[Startup] ❌ Failed to ensure SYSTEM_PROMPT.md existence:', err);
    }
  }

  // Ensure system prompt exists
  ensureSystemPromptExists();

  // VM prewarm matrix (MP-XPLAT-06): win32→WSL prewarm, darwin→Docker container
  // prewarm, linux→none needed: runInLinuxVM executes natively on Linux (see
  // linux-vm-executor) so there is no VM image to prewarm.

  // Fire-and-forget: ensure WSL has python3 and .everfern/ venv set up at startup
  if (process.platform === 'win32') {
    ensureWSLSetup().catch((err: any) =>
      console.error('[Startup] WSL setup failed (non-blocking):', err)
    );
  }

  // Fire-and-forget: ensure Docker Ubuntu container is ready on macOS
  if (process.platform === 'darwin') {
    ensureDockerContainer().catch((err: any) =>
      console.warn('[Startup] Docker container pre-warm failed (non-blocking — Docker may not be running):', err)
    );
  }
} catch (err) {
  // MP-LIFE-05: non-fatal zone — a missing SYSTEM_PROMPT.md or failed WSL/
  // Docker prewarm must never take the app down.
  console.error('[Startup] ❌ Non-critical startup step failed:', err);
}

// System-files write permissions (per chat run/session, shared with sandbox runtime)
(globalThis as any).__everfernSystemFilesPermissionGranted = false;

// Last stream event for JSON viewer
let lastStreamEvent: any = null;
// Full chat messages for JSON viewer
let lastChatMessages: any[] = [];


let mainWindow: BrowserWindow | null = null;

// MP-CORR-24: deep link received while no window exists (cold start, macOS
// activate, hidden window) is stashed here and flushed once a window is live.
let pendingDeepLink: string | null = null;

function flushPendingDeepLink(win: BrowserWindow): void {
  if (!pendingDeepLink) return;
  const url = pendingDeepLink;
  pendingDeepLink = null;
  try {
    if (!win.isDestroyed()) {
      console.log('[Startup] Delivering pending protocol link:', url);
      win.webContents.send('acp:protocol-link', url);
    }
  } catch (err) {
    console.warn('[Startup] Failed to deliver pending protocol link:', err);
  }
}

// macOS: links clicked while the app is already running arrive as open-url
// events (no second instance). MP-CORR-24 — previously lost entirely.
app.on('open-url', (_event, url) => {
  if (typeof url === 'string' && url.startsWith('everfern-app://')) {
    console.log('[Startup] open-url received:', url);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('acp:protocol-link', url);
    } else {
      pendingDeepLink = url;
    }
  }
});

// Cold start on macOS/Linux: protocol link arrives via argv.
(function scanArgvForDeepLink() {
  const url = process.argv.find((arg) => arg.startsWith('everfern-app://'));
  if (url) pendingDeepLink = url;
})();

// Handle protocol links on Windows
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  console.log('[Startup] ⚠️ Already running, quitting...');
  app.quit();
  process.exit(0);
} else {
  app.on('second-instance', (event, commandLine) => {
    console.log('[Startup] second-instance received:', commandLine);
    // Someone tried to run a second instance, we should focus our window.
    const url = commandLine.find(arg => arg.startsWith('everfern-app://'));
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();

      // commandLine is an array of strings that contains the extra parameters,
      // like the protocol link.
      if (url) {
        console.log('[Startup] Protocol URL detected in second-instance:', url);
        mainWindow.webContents.send('acp:protocol-link', url);
      }
    } else if (url) {
      // MP-CORR-24: window not ready (null/destroyed) — stash instead of drop.
      console.log('[Startup] Window unavailable; stashing protocol link for post-create delivery:', url);
      pendingDeepLink = url;
    }
  });
}


// ── Window ──────────────────────────────────────────────────────────

function createWindow(): void {
  const isDev = !app.isPackaged;
  console.log(`[Window] Creating window (app.isPackaged: ${app.isPackaged}, isDev: ${isDev})`);
  console.log(`[Window] NODE_ENV: ${process.env.NODE_ENV}`);

  const appIconPath = getAppIconPath();
  const appIcon = getAppIcon();
  console.log(`[Window] Resolved icon path: ${appIconPath}`);

  mainWindow = new BrowserWindow({
    width: 1400, height: 900,
    minWidth: 800, minHeight: 600,
    frame: false,
    icon: appIconPath || (appIcon ?? undefined),
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#1a1a1a',
    show: !isAutoStartMode, // Don't show window immediately in auto-start mode
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false,
      webSecurity: true,
    },
  });

  // Explicitly set window icon for taskbar on Windows/Linux
  setupWindowIcon(mainWindow);

  // Make mainWindow available globally for IPC handlers
  (global as any).mainWindow = mainWindow;
  console.log('[Window] mainWindow assigned to global');


  // Fallback: Show window after 5 seconds if ready-to-show never fires (only in normal mode)
  const showFallback = setTimeout(() => {
    if (mainWindow && !mainWindow.isVisible() && !isAutoStartMode) {
      console.warn('[Window] ready-to-show timed out, forcing show()');
      setupWindowIcon(mainWindow);
      mainWindow.show();
    }
  }, 5000);

  mainWindow.once('ready-to-show', () => {
    console.log('[Window] ready-to-show received');
    clearTimeout(showFallback);
    setupWindowIcon(mainWindow);

    // Initialize system tray first
    try {
      if (systemTrayManager.isSupported() && mainWindow) {
        systemTrayManager.createTray(mainWindow);
        systemTrayManager.setupWindowEvents();
        console.log('[Window] System tray initialized');
      } else {
        console.warn('[Window] System tray not supported on this platform or window not available');
      }
    } catch (error) {
      console.error('[Window] Failed to initialize system tray:', error);
    }

    // Handle auto-start mode
    if (isAutoStartMode) {
      console.log('[Window] Auto-start mode: minimizing to tray');
      if (systemTrayManager.isSupported()) {
        // Hide to tray instead of showing window
        systemTrayManager.hideToTray();
      } else {
        // If tray not supported, minimize window
        mainWindow?.minimize();
      }
    } else {
      // Normal startup: show window
      mainWindow?.show();
    }
  });

  if (isDev) {
    console.log('[Window] Loading dev URL: http://localhost:3001');

    // Wait for Next.js to be ready
    const waitForNext = () => new Promise<void>((resolve, reject) => {
      const net = require('net');
      const client = new net.Socket();
      client.connect(3001, '127.0.0.1', () => {
        client.destroy();
        console.log('[Window] Next.js is ready on port 3001');
        resolve();
      });
      client.on('error', () => {
        client.destroy();
        reject(new Error('Next.js not ready'));
      });
    });

    // Try to load, with retry logic
    const tryLoad = async () => {
      if (!mainWindow) {
        console.log('[Window] mainWindow is null, aborting');
        return;
      }
      for (let attempt = 1; attempt <= 30; attempt++) {
        try {
          console.log(`[Window] Attempt ${attempt}: checking if Next.js is ready...`);
          await waitForNext();
          console.log(`[Window] Next.js ready, calling loadURL...`);
          await mainWindow.loadURL('http://localhost:3001');
          console.log('[Window] ✅ Dev URL loaded successfully!');
          return;
        } catch (err) {
          console.log(`[Window] Attempt ${attempt}/30 failed: ${err}, waiting...`);
          await new Promise(r => setTimeout(r, 1000));
        }
      }
      console.error('[Window] ❌ Next.js did not start in time');
    };

    console.log('[Window] Starting tryLoad...');
    tryLoad();
  } else {
    console.log('[Window] Production mode detected, using everfern-app protocol');
    mainWindow.loadURL('everfern-app://./index.html').catch(err => {
      console.error('[Window] ❌ loadURL failed for everfern-app protocol:', err);
    });
  }

  // MP-LIFE-07: track load failures so we can retry instead of leaving a
  // blank window — and when retries run out, show the window and make one
  // final cache-bypassing attempt rather than leaving it hidden.
  let loadRetryCount = 0;
  let finalCacheBypassAttempted = false;
  const win = mainWindow;
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (errorCode === -3) return; // ERR_ABORTED: interrupted navigation, not a real failure
    console.error(`[Window] ❌ did-fail-load: ${errorCode} (${errorDescription}) for URL: ${validatedURL}`);
    if (isAppQuitting || !isMainFrame) return;
    if (loadRetryCount < 2) {
      loadRetryCount += 1;
      console.warn(`[Window] Retrying load (attempt ${loadRetryCount}/2)...`);
      setTimeout(() => {
        try {
          if (!win.isDestroyed()) win.webContents.reload();
        } catch { /* window may be gone */ }
      }, 1000);
    } else if (!finalCacheBypassAttempted) {
      // MP-LIFE-07: both reloads failed — final attempt ignoring cache, and
      // show the window so the user sees state instead of a hidden shell.
      finalCacheBypassAttempted = true;
      console.error('[Window] Load retries exhausted — final reloadIgnoringCache attempt.');
      setTimeout(() => {
        try {
          if (!win.isDestroyed()) {
            if (!isAutoStartMode) win.show();
            win.webContents.reloadIgnoringCache();
          }
        } catch { /* window may be gone */ }
      }, 1000);
    } else {
      // MP-LIFE-07: every attempt failed — keep the window visible (the user
      // can then see the error state / use the 5s show fallback) and log.
      console.error('[Window] ❌ All load attempts (incl. cache bypass) failed — showing window in current state.');
      try {
        if (!win.isDestroyed() && !isAutoStartMode) win.show();
      } catch { /* window may be gone */ }
    }
  });

  // MP-LIFE-06: forward only renderer warnings/errors to main stdout —
  // logging every console.log line from the renderer floods main logs.
  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    if (typeof level !== 'number' || level < 2) return; // 0=verbose, 1=info dropped
    const levelStr = level >= 3 ? 'Error' : 'Warn';
    const log = level >= 3 ? console.error : console.warn;
    log(`[Renderer ${levelStr}] ${message} (at ${sourceId}:${line})`);
  });

  mainWindow.webContents.on('render-process-gone', (event, details) => {
    console.error('[Window] ❌ Renderer process gone:', details);
    // Auto-recover from renderer crashes (grey screen prevention): reload a few
    // times before giving up and relaunching the whole app.
    if (isAppQuitting) return;
    const reason = details?.reason || '';
    if (reason === 'clean-exit') return;
    rendererCrashCount += 1;
    if (rendererCrashCount <= 3) {
      console.warn(`[Window] Auto-reloading after renderer crash (${rendererCrashCount}/3)...`);
      setTimeout(() => {
        try {
          if (!win.isDestroyed()) win.webContents.reload();
        } catch { /* window gone */ }
      }, 500);
    } else {
      console.error('[Window] Too many renderer crashes — relaunching app.');
      app.relaunch();
      app.exit(1);
    }
  });

  mainWindow.webContents.on('unresponsive', () => {
    console.warn('[Window] ⚠️ Renderer is unresponsive');
  });

   mainWindow.webContents.on('did-finish-load', () => {
    console.log('[Window] Page finished loading');
    rendererCrashCount = 0;
    // MP-CORR-24: deliver any deep link that arrived before the window was ready.
    if (mainWindow && !mainWindow.isDestroyed()) {
      flushPendingDeepLink(mainWindow);
    }
  });

  // Open external links securely in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        shell.openExternal(url);
      } else {
        console.warn('[Window] Blocked non-http external URL opening:', url);
      }
    } catch (err) {
      console.warn('[Window] Blocked malformed window open URL:', url);
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('http') && !url.includes('localhost')) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.on('closed', () => {
    console.log('[Window] Window closed');
    // MP-LEAK-09: window destroyed before ready-to-show fired — cancel the
    // fallback-show timer so it never dereferences a dead window.
    clearTimeout(showFallback);
    mainWindow = null;
    (global as any).mainWindow = null;
    console.log('[Window] mainWindow cleared from global');
  });
}

// ── Protocol: Local App & Sites ──────────────────────────────────────────
// registerSchemesAsPrivileged must be called BEFORE app is ready
protocol.registerSchemesAsPrivileged([
  { scheme: 'everfern-app', privileges: { standard: true, secure: true, supportFetchAPI: true, allowServiceWorkers: true } },
  { scheme: 'everfern-site', privileges: { standard: true, secure: true, supportFetchAPI: true, allowServiceWorkers: true } }
]);

/**
 * Set up a standard macOS application menu to support native window management
 * and keyboard shortcuts (Cmd+C, Cmd+V, Cmd+M, etc.).
 */
function setupMacOSMenu() {
  if (process.platform !== 'darwin') return;

  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'delete' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
        { type: 'separator' },
        { role: 'window' }
      ]
    },
    {
      role: 'help',
      submenu: [
        {
          label: 'Learn More',
          click: async () => {
            await shell.openExternal('https://everfern.com');
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// ── App lifecycle ───────────────────────────────────────────────────

// MP-LIFE-03: voice overlay lazily created on FIRST ARM/USE via
// getVoiceOverlayManager() (see voice-overlay.ts) — the overlay BrowserWindow
// + everfern-app:// page load cost ~120MB RSS at cold start, which is wasted
// when voice features are never used. registerVoiceOverlayIpcBridge() wires
// lightweight forwarders; the first renderer voice IPC constructs the
// manager. Quit path uses shutdownVoiceOverlayIfCreated() (never constructs).
import { registerVoiceOverlayIpcBridge, shutdownVoiceOverlayIfCreated } from './voice-overlay';

import { bridgeServer } from './lib/extension-server';

import { schedulerService } from './integrations/scheduler-service';

app.whenReady().then(async () => {
  console.log('[App] App ready, starting initialization...');

  // Set up macOS application menu
  setupMacOSMenu();

  // Start the scheduler service
  schedulerService.start();

  // Warm pricing cache off the critical ready path (MP-LEAK-08 / battery A5)
  try {
    const { warmUpPricingCache } = require('./store/analytics');
    setImmediate(() => warmUpPricingCache());
  } catch { /* analytics module may not be loadable — non-fatal */ }

  // LP-11: warm the local model (ollama keep_alive / lmstudio ping) off the
  // ready path so the first turn doesn't pay a 10–60s cold reload. void+catch:
  // warmupLocalModel never throws, but never block startup either way.
  // Re-fire on provider config change: see journal — patch spec handed to the
  // config-handlers owner (this wave's ownership boundary).
  setImmediate(() => {
    void warmupFromActiveConfig(() => acpManager.getActiveConfig());
  });

  // Start the extension bridge server (localhost:4001)
  bridgeServer.start();

  // Start the Agent Gateway Control Plane server (localhost:4002)
  try {
    const { agentGatewayServer } = require('./agent/gateway');
    agentGatewayServer.start();
  } catch (gatewayErr) {
    console.error('[Startup] Failed to start Agent Gateway:', gatewayErr);
  }

  // ── Initialize Prompt Synchronization System ──────────────────────
  console.log('[Startup] 🔄 Initializing prompt synchronization...');
  initializePromptSync(true); // Force sync to ensure latest prompts are always loaded
  initializeOpenClawConfigs();

  // ── Ensure Playwright Chromium is installed (non-blocking) ─────────
  ensurePlaywrightChromium();

  // Watch for prompt changes in development mode
  if (process.env.NODE_ENV === 'development') {
    watchPrompts();
  }

  // ── Initialize Skill Synchronization System ──────────────────────
  console.log('[Startup] 🔄 Initializing skill synchronization...');
  syncBuiltInSkills();
  mergeCustomSkills();

  /**
   * Ensures that ~/.everfern/SYSTEM_PROMPT.md exists, creating it with defaults if not.
   * NOTE: This is now handled by the prompt sync system, but kept for backward compatibility.
   */
  function ensureSystemPromptExists() {
    const everfernDir = path.join(os.homedir(), '.everfern');
    const promptPath = path.join(everfernDir, 'SYSTEM_PROMPT.md');

    try {
      if (!fs.existsSync(everfernDir)) {
        console.log('[Startup] 📂 Creating .everfern directory...');
        fs.mkdirSync(everfernDir, { recursive: true });
      }

      if (!fs.existsSync(promptPath)) {
        console.log('[Startup] 📝 Creating default SYSTEM_PROMPT.md in ~/.everfern/');
        const defaultPrompt = `# EverFern System Prompt

You are EverFern, an autonomous AI workplace agent designed to help users with their daily tasks.
You have access to a variety of tools, including GUI automation, terminal access, and web search.

## Guidelines:
1. Be concise and professional.
2. Use tools whenever necessary to fulfill the user's request.
3. For GUI automation, use the 'computer_use' tool.
4. If you are unsure about a command, ask for clarification.

## Terminal Commands & Environment Targets
All terminal commands run through the terminal_execute tool. Ensure you set the correct 'target' parameter:
- **target: "main" (Default)**: Executes commands on the Host machine (PowerShell on Windows, Bash/Zsh on macOS). You MUST use host-compatible syntax and paths. Do NOT run Linux-specific bash commands (like "ls -la") on a Windows host.
- **target: "vm"**: Executes commands inside the Linux VM (WSL running Bash on Windows, Docker on macOS, native on Linux). You MUST use Linux Bash syntax and paths.
  - The VM sandbox has a dedicated virtual environment pre-configured at \`~/.everfern/venv\` with pre-installed document and data packages (\`pypdf\`, \`pdfplumber\`, \`reportlab\`, \`openpyxl\`, \`python-pptx\`, \`pandas\`, \`numpy\`, \`matplotlib\`, \`python-docx\`) and Node tools (\`pptxgenjs\`, \`docx\`, \`pdf-lib\`, \`exceljs\`).
  - Write any temporary scripts to \`/tmp\` or the workspace directory and execute with \`python3 script.py\` or \`node script.js\`.

Your goal is to be the ultimate workplace companion.
`;
        fs.writeFileSync(promptPath, defaultPrompt, 'utf-8');
      } else {
        console.log('[Startup] ✅ SYSTEM_PROMPT.md already exists in ~/.everfern/');
      }
    } catch (err) {
      console.error('[Startup] ❌ Failed to ensure SYSTEM_PROMPT.md existence:', err);
    }
  }

  // Ensure system prompt exists (fallback for prompt sync)
  ensureSystemPromptExists();

  // NOTE: VoiceOverlayManager and ComputerOverlayManager are initialized AFTER
  // the protocol handlers below — their constructors call loadURL('everfern-app://...')
  // which requires the custom protocol to be registered first.
  // ── Protocol Handlers ──────────────────────────────────────────────

  // Custom protocol for the main application (Next.js out folder)
  let everfernAppRequests = 0;
  protocol.handle('everfern-app', async (request) => {
    everfernAppRequests += 1;
    if (everfernAppRequests % 200 === 0) {
      console.info(`[Protocol] Served ${everfernAppRequests} requests`);
    }
    try {
      const url = new URL(request.url);
      const cacheControl = url.pathname.startsWith('/_next/static/')
        ? 'public, max-age=31536000, immutable'
        : 'no-cache';
      let filePath: string;
      try {
        filePath = decodeURIComponent(url.pathname);
      } catch {
        return new Response('Bad Request', { status: 400 });
      }
      if (filePath === '/' || !filePath || filePath === '.') filePath = '/index.html';

      // Normalize path (handle leading slashes and dots)
      if (filePath.startsWith('./')) filePath = filePath.substring(1);
      if (!filePath.startsWith('/')) filePath = '/' + filePath;

      // In production, extraResources are in process.resourcesPath
      // In dev, they're in the project root
      const baseDir = app.isPackaged
        ? path.join(process.resourcesPath, 'out')
        : path.join(__dirname, '../../out');

      // Containment (MP-SEC-12): strip the leading separator so resolveWithin
      // sees a relative segment, then guarantee the result stays inside baseDir
      // (lexical '..' climbs and symlinked files cannot escape).
      const relPath = filePath.replace(/^\/+/, '');
      let absPath = resolveWithin(baseDir, relPath);

      // Async helper to get stats
      const getStats = async (p: string) => { try { return await fs.promises.stat(p); } catch { return null; } };

      let stats = await getStats(absPath);

      // If it's a directory, try to serve index.html from that directory
      if (stats && stats.isDirectory()) {
        const dirIndexPath = path.join(absPath, 'index.html');
        if (await getStats(dirIndexPath)) {
          const data = await fs.promises.readFile(dirIndexPath);
          return new Response(data, { headers: { 'Content-Type': 'text/html', 'Cache-Control': cacheControl } });
        }
        // Directory exists but no index.html — fall back to root index.html for SPA routing
        absPath = path.join(baseDir, 'index.html');
        stats = await getStats(absPath);
      }

      // It's a file — serve it
      if (stats && stats.isFile()) {
        const extension = path.extname(absPath).toLowerCase();
        const mimeTypes: Record<string, string> = {
          '.html': 'text/html',
          '.js':   'text/javascript',
          '.css':  'text/css',
          '.json': 'application/json',
          '.png':  'image/png',
          '.jpg':  'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.gif':  'image/gif',
          '.svg':  'image/svg+xml',
          '.ico':  'image/x-icon',
          '.woff': 'font/woff',
          '.woff2': 'font/woff2',
          '.ttf':  'font/ttf',
          '.otf':  'font/otf',
          '.webp': 'image/webp',
          '.avif': 'image/avif',
          '.map':  'application/json',
          '.txt':  'text/plain',
          '.wasm': 'application/wasm',
          '.mp4':  'video/mp4',
        };

        const contentType = mimeTypes[extension] || 'application/octet-stream';
        const data = await fs.promises.readFile(absPath);

        return new Response(data, { headers: { 'Content-Type': contentType, 'Cache-Control': cacheControl } });
      }

      // File not found — try index.html for client-side routing (SPA fallback)
      console.warn(`[Protocol] ⚠️ 404: ${absPath}, trying index.html for client-side routing`);
      const indexPath = path.join(baseDir, 'index.html');

      if (await getStats(indexPath)) {
        const data = await fs.promises.readFile(indexPath);
        return new Response(data, { headers: { 'Content-Type': 'text/html', 'Cache-Control': cacheControl } });
      }

      console.warn(`[Protocol] ❌ 404: ${absPath} and index.html not found`);
      if (await getStats(baseDir)) {
        try {
          const files = (await fs.promises.readdir(baseDir)).slice(0, 10);
          console.warn(`[Protocol] Files in baseDir: ${files.join(', ')}`);
        } catch { /* ignore */ }
      }
      return new Response('Not Found', { status: 404 });
    } catch (err) {
      console.error('[Protocol] ❌ Error handling request:', err);
      const errorMsg = err instanceof Error ? err.message : String(err);
      return new Response(`Internal Server Error: ${errorMsg}`, { status: 500 });
    }
  });

  // Custom protocol for local sites
  protocol.handle('everfern-site', async (request) => {
    // Accepted intra-user exposure (single-user threat model): any local frame may read any chatId's site.
    const url = new URL(request.url);
    const chatId = url.hostname;
    let filePath: string;
    try {
      filePath = decodeURIComponent(url.pathname);
    } catch {
      return new Response('Bad Request', { status: 400 });
    }

    if (filePath === '/' || !filePath) filePath = '/index.html';

    // Async file existence check helper
    const fileExists = async (p: string) => { try { await fs.promises.access(p); return true; } catch { return false; } };

    // Containment (MP-SEC-12): resolve under the sites/artifacts roots via
    // resolveWithin (rejects '..' climbs, absolute overrides and symlink
    // escapes) rather than raw path.join + lexical prefix compare.
    const sitesRoot = path.join(os.homedir(), '.everfern', 'sites');
    const artifactsRoot = path.join(os.homedir(), '.everfern', 'artifacts');

    let absPath: string | null = null;
    const relPath = filePath.replace(/^\/+/, '');
    try {
      let candidate = resolveWithin(sitesRoot, chatId, relPath);
      if (await fileExists(candidate)) {
        absPath = candidate;
      } else {
        candidate = resolveWithin(artifactsRoot, chatId, relPath);
        if (await fileExists(candidate)) {
          absPath = candidate;
        }
      }
    } catch {
      // Escaped (or unsafe id) — fall through to the 403/404 paths below.
    }

    if (!absPath) return new Response('Not Found', { status: 404 });

    // Safety check: ensure path is within ~/.everfern/sites or ~/.everfern/artifacts
    const isUnderSites = absPath.startsWith(sitesRoot.endsWith(path.sep) ? sitesRoot : sitesRoot + path.sep);
    const isUnderArtifacts = absPath.startsWith(artifactsRoot.endsWith(path.sep) ? artifactsRoot : artifactsRoot + path.sep);

    if (!isUnderSites && !isUnderArtifacts) {
      return new Response('Forbidden', { status: 403 });
    }

    // Percent-encode each path segment so spaces/#/? stay intact in the file:// URL.
    const encoded = absPath
      .split(path.sep)
      .map((seg) => encodeURIComponent(seg))
      .join('/');
    return net.fetch(`file:///${encoded}`);
  });

  // ── Overlay Managers (lazy — MP-LIFE-03) ─────────────────────────
  // Both overlay windows cost ~120MB RSS at cold start for features the user
  // may never use, so neither is constructed here. Each manager is created on
  // FIRST ARM/USE via its lazy factory:
  //   - getComputerOverlayManager() — called by the agent stream handlers on
  //     the first computer_use show/hide.
  //   - getVoiceOverlayManager() — called on the first renderer voice IPC
  //     ('voice-overlay:set-state' / 'voice-overlay:audio-levels').
  // Their constructors call loadURL('everfern-app://...') which requires the
  // custom protocol to already be registered — lazy first use can only
  // originate from a loaded renderer, which is always later than the protocol
  // registration above, so the URLs resolve safely.
  registerVoiceOverlayIpcBridge();

  // ── Create Main Window ─────────────────────────────────────────────
  createWindow();
  
  if (mainWindow) {
    initializeUpdater(mainWindow);
  }

  // Register as default protocol client for everfern-app
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient('everfern-app', process.execPath, [path.resolve(process.argv[1])]);
    }
  } else {
    app.setAsDefaultProtocolClient('everfern-app');
  }

  // Register Ctrl+Shift+P global shortcut for Debug Window & Command Palette
  try {
    const success = globalShortcut.register('CommandOrControl+Shift+P', () => {
      console.log('[Shortcut] Ctrl+Shift+P triggered — toggling Debug Window & Command Palette...');
      toggleDebugWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('shortcut:command-palette');
      }
    });
    if (!success) {
      console.error('[Shortcut] ❌ Failed to register Ctrl+Shift+P shortcut');
    } else {
      console.log('[Shortcut] ✅ Ctrl+Shift+P registered successfully');
    }
  } catch (error) {
    console.error('[Shortcut] ❌ Error registering Ctrl+Shift+P:', error);
  }

  // Register Ctrl+Alt+B global shortcut to resume the chat
  try {
    const success = globalShortcut.register('Alt+CommandOrControl+B', () => {
      console.log('[Shortcut] Ctrl+Alt+B triggered, sending resume event...');
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('shortcut:resume-chat');
      }
    });
    if (!success) {
      console.error('[Shortcut] ❌ Failed to register Ctrl+Alt+B shortcut');
    } else {
      console.log('[Shortcut] ✅ Ctrl+Alt+B registered successfully');
    }
  } catch (error) {
    console.error('[Shortcut] ❌ Error registering Ctrl+Alt+B:', error);
  }

  // Register Ctrl+Alt+H global shortcut to show history
  try {
    const success = globalShortcut.register('Alt+CommandOrControl+H', () => {
      console.log('[Shortcut] Ctrl+Alt+H triggered, sending show history event...');
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('shortcut:show-history');
      }
    });
    if (!success) {
      console.error('[Shortcut] ❌ Failed to register Ctrl+Alt+H shortcut');
    } else {
      console.log('[Shortcut] ✅ Ctrl+Alt+H registered successfully');
    }
  } catch (error) {
    console.error('[Shortcut] ❌ Error registering Ctrl+Alt+H:', error);
  }

  // ── Initialize Integration Services ─────────────────────────────────
  try {
    console.log('[App] Initializing integration services...');
    await integrationService.initialize();
    console.log('[App] Integration services initialized successfully');

    // Auto-start enabled and connected bots
    await autoStartEnabledBots();
    await initializeBotMessageHandler();
  } catch (error) {
    console.error('[App] Failed to initialize integration services:', error);
    // Don't block app startup if integration services fail
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  // On macOS, re-create the window when the dock icon is clicked and no windows are open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  } else if (mainWindow) {
    // If the window exists but is hidden or minimized, show and focus it
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

// ── Graceful shutdown & cleanup on quit ──────────────────────────────
// NOTE: isAppQuitting / rendererCrashCount live at the top of this file.

// Run one shutdown step with a hard timeout so a hung socket/DB/MCP call can
// never block quitting. Returns 'timeout' instead of throwing.
async function withShutdownTimeout(name: string, step: () => any, ms = 3000): Promise<void> {
  try {
    await Promise.race([
      Promise.resolve(step()).catch((err) => {
        console.error(`[Shutdown] ${name} failed:`, err);
      }),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), ms)),
    ]).then((result) => {
      if (result === 'timeout') console.warn(`[Shutdown] ${name} timed out after ${ms}ms — continuing.`);
    });
  } catch (err) {
    console.error(`[Shutdown] ${name} unexpected failure:`, err);
  }
}

app.on('before-quit', async (event) => {
  if (isAppQuitting) return;
  event.preventDefault();
  isAppQuitting = true;
  console.log('[Shutdown] Graceful app shutdown initiated...');

  // Hard failsafe: no matter what happens below, the app WILL exit.
  // NOTE: this 8s budget intentionally overrides individual step timeouts (5×3s+2×4s=23s worst case).
  const forceExitTimer = setTimeout(() => {
    console.error('[Shutdown] Cleanup exceeded budget — forcing exit.');
    app.exit(0);
  }, 8000);
  // Never keep the process alive just for this timer.
  forceExitTimer.unref?.();

  // Release OS-global hooks first so hotkeys never outlive the process.
  try {
    globalShortcut.unregisterAll();
  } catch (shortcutErr) {
    console.error('[Shutdown] Failed to unregister global shortcuts:', shortcutErr);
  }

  // Stop the idle-scoped uIOhook global keyboard hook (MP-SEC-07).
  // MP-LIFE-03: shutdown only if the lazy factory ever constructed one —
  // never construct here at quit time.
  try {
    shutdownVoiceOverlayIfCreated();
  } catch (voiceErr) {
    console.error('[Shutdown] Failed to shut down voice overlay:', voiceErr);
  }

  // Terminate the local STT child (app.exit below skips will-quit listeners).
  try {
    const { shutdownLocalStt } = require('./ipc/system/ollama-audio-handlers');
    shutdownLocalStt();
  } catch { /* module may not be loaded */ }

  // MP-CORR-27: stop periodic update checks.
  try {
    const { stopPeriodicUpdateChecks } = require('./updater');
    stopPeriodicUpdateChecks();
  } catch { /* module may not be loaded */ }

  // Stop Agent Gateway Control Plane
  await withShutdownTimeout('Agent Gateway', () => {
    const { agentGatewayServer } = require('./agent/gateway');
    agentGatewayServer.stop();
  });

  // Clean up MessageHandler
  await withShutdownTimeout('MessageHandler', () => shutdownBotMessageHandler());

  // Stop integration services
  console.log('[App] Stopping integration services...');
  await withShutdownTimeout('Integration services', () => integrationService.stop());
  console.log('[App] Integration services stopped successfully');

  // Stop the scheduled-task service (MP-LEAK-02)
  try {
    schedulerService.stop();
  } catch (schedErr) {
    console.error('[Shutdown] Failed to stop scheduler:', schedErr);
  }

  // Stop module-singleton cleanup timers (MP-LEAK-01: security monitor, error logger)
  try {
    const { stopGlobalSecurityMonitor } = require('./integrations/security-monitor');
    stopGlobalSecurityMonitor();
  } catch { /* module may not be loaded */ }
  try {
    const { stopGlobalErrorLogger } = require('./integrations/error-logger');
    stopGlobalErrorLogger();
  } catch { /* module may not be loaded */ }
  // MP-LEAK-01: the admin-notification SINGLETON (used by the global error
  // logger) is a different instance from the one IntegrationService owns —
  // stop it too so no retry/drain timers survive quit.
  try {
    const { adminNotificationManager } = require('./integrations/admin-notification');
    adminNotificationManager.stop();
  } catch { /* module may not be loaded */ }

  // Stop the permission-notification cleanup interval (MP-LEAK-07)
  try {
    const { stopPermissionNotificationCleanup } = require('./lib/permission-notification');
    stopPermissionNotificationCleanup();
  } catch { /* module may not be loaded */ }

  // Flush debounced learning.json writes (MP-LEAK-11)
  try {
    const { learningMemoryManager } = require('./store/memory-manager');
    void Promise.resolve(learningMemoryManager.flush?.()).catch(() => { });
  } catch { /* module may not be loaded */ }

  // Close the dev-only prompt watcher (MP-LEAK-07)
  try {
    const { stopWatchingPrompts } = require('./lib/prompt-sync');
    stopWatchingPrompts();
  } catch { /* module may not be loaded */ }

  // AG-MEM-01/02: destroy leaked capture/overlay BrowserWindows.
  try {
    const cu = require('./agent/tools/computer-use');
    cu.shutdownComputerUseCapture?.();
    cu.destroyAllComputerUseOverlays?.();
  } catch { /* module may not be loaded */ }

  // AG-MEM-12: stop module-level agent cleanup intervals.
  try {
    const { stopStateCleanup } = require('./agent/runner/state-manager');
    stopStateCleanup?.();
  } catch { /* module may not be loaded */ }
  try {
    const { stopAnalysisSessionCleanup } = require('./agent/sessions/analysis-session');
    stopAnalysisSessionCleanup?.();
  } catch { /* module may not be loaded */ }
  try {
    const { stopPromptCacheCleanup } = require('./agent/runner/system-prompt');
    stopPromptCacheCleanup?.();
  } catch { /* module may not be loaded */ }

  // AG-MEM-07: final sweep of per-conversation/per-subagent emitters.
  try {
    const { clearAllAgentEvents } = require('./agent/infra/agent-events');
    clearAllAgentEvents?.();
  } catch { /* module may not be loaded */ }

  // Stop extension bridge server
  console.log('[App] Stopping extension bridge server...');
  await withShutdownTimeout('Extension bridge', () => bridgeServer.stop());

  // Shutdown background processor
  console.log('[App] Shutting down background processor...');
  await withShutdownTimeout('Background processor', () => backgroundProcessor.shutdown());

  // Shutdown MCP tools
  console.log('[App] Shutting down MCP tools...');
  await withShutdownTimeout('MCP tools', () => shutdownMCPTools(), 4000);

  // Close database connection cleanly
  console.log('[App] Closing database connection...');
  await withShutdownTimeout('Database', () => closeDb(), 4000);

  // Close chat vector store
  await withShutdownTimeout('Chat vector DB', () => {
    const { closeChatVectorDb } = require('./store/chat-vectors');
    closeChatVectorDb();
  }, 3000);

  // Clean up system tray
  try {
    systemTrayManager.destroy();
  } catch (trayErr) {
    console.error('[App] Error destroying system tray:', trayErr);
  }

  console.log('[Shutdown] Cleanup finished, exiting process.');
  // MP-LEAK-10: mark the session as having shut down cleanly so the next
  // launch keeps its warm GPU/shader caches.
  try {
    fs.rmSync(path.join(app.getPath('userData'), 'session-crash-flag'), { force: true });
  } catch { /* best-effort */ }
  clearTimeout(forceExitTimer);
  app.exit(0);
});


// ── IPC: Window Controls ────────────────────────────────────────────

ipcMain.handle('window:minimize',    () => { mainWindow?.minimize(); });
ipcMain.handle('window:maximize',    () => { mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow?.maximize(); });
ipcMain.handle('window:close',       () => { mainWindow?.close(); });
ipcMain.handle('window:is-maximized', () => mainWindow?.isMaximized() || false);

// ── IPC: Health Check ────────────────────────────────────────────────

ipcMain.handle('db:checkConnection', async () => {
  return await checkDatabaseConnection();
});

ipcMain.handle('db:checkVectors', async () => {
  return await checkVectorStore();
});

// ── IPC: System Tray ────────────────────────────────────────────────

ipcMain.handle('tray:show-window', () => {
  systemTrayManager.showWindow();
  return { success: true };
});

ipcMain.handle('tray:hide-to-tray', () => {
  systemTrayManager.hideToTray();
  return { success: true };
});

ipcMain.handle('tray:is-supported', () => {
  return { supported: systemTrayManager.isSupported() };
});

ipcMain.handle('tray:update-menu', () => {
  systemTrayManager.updateTrayMenu();
  return { success: true };
});

// ── IPC: Auto-Start ─────────────────────────────────────────────────

ipcMain.handle('autostart:get-status', async () => {
  try {
    const enabled = await autoStartManager.isEnabled();
    return { success: true, enabled };
  } catch (error) {
    console.error('[AutoStart] Failed to get status:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('autostart:enable', async () => {
  try {
    await autoStartManager.enable();
    console.log('[AutoStart] Auto-start enabled via IPC');
    return { success: true };
  } catch (error) {
    console.error('[AutoStart] Failed to enable:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('autostart:disable', async () => {
  try {
    await autoStartManager.disable();
    console.log('[AutoStart] Auto-start disabled via IPC');
    return { success: true };
  } catch (error) {
    console.error('[AutoStart] Failed to disable:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('autostart:get-info', () => {
  try {
    const info = autoStartManager.getPlatformInfo();
    return { success: true, info };
  } catch (error) {
    console.error('[AutoStart] Failed to get platform info:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('autostart:validate-support', async () => {
  try {
    const validation = await autoStartManager.validatePlatformSupport();
    return { success: true, validation };
  } catch (error) {
    console.error('[AutoStart] Failed to validate platform support:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

// ── IPC: Audio ──────────────────────────────────────────────────────

ipcMain.handle('audio:play-sound', async (_event, soundPath: string) => {
  try {
    const path = require('path');
    const fs = require('fs');

    // MP-SEC-01: never join raw renderer input into a path — only accept a
    // validated bare filename, resolved against our own sounds directories.
    const safeName = path.basename(soundPath || '');
    if (safeName === '.' || safeName === '..' || !/^[A-Za-z0-9._-]{1,64}$/.test(safeName)) {
      console.warn(`[Audio] Rejected invalid sound name`);
      return false;
    }

    // MAC-10: public/sounds ships as extraResources (outside the asar) in
    // packaged builds; probe candidate roots and use the first containing the file.
    const soundDirs = [
      process.resourcesPath ? path.join(process.resourcesPath, 'public', 'sounds') : '',
      path.join(__dirname, '../../public/sounds'),
      path.join(app.getAppPath(), 'public', 'sounds')
    ].filter(Boolean);

    let soundFilePath = '';
    let soundFound = false;
    for (const dir of soundDirs) {
      const candidate = path.join(dir, safeName);
      if (fs.existsSync(candidate)) {
        soundFilePath = candidate;
        soundFound = true;
        break;
      }
    }

    if (!soundFound) {
      console.warn(`[Audio] Sound file not found: ${safeName}`);
      return false;
    }

    console.log(`[Audio] Playing sound: ${soundFilePath}`);

    // MP-XPLAT-01: platform dispatch + error handling lives in
    // lib/sound-player (every execFile carries an error callback so a
    // missing player logs instead of crashing; linux probes
    // paplay/aplay/ffplay/canberra-gtk-play once and caches the result).
    return await playSoundFile(soundFilePath);
  } catch (err) {
    console.error('[Audio] Error playing sound:', err);
    return false;
  }
});
// ── All IPC Handlers are modularized in main/ipc/ ──────────────────
export { isPermissionGranted } from './ipc/terminal-process-handlers';
