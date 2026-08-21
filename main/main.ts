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

// Handle squirrel startup events for Windows
if (process.platform === 'win32') {
  try {
    if (require('electron-squirrel-startup')) {
      app.quit();
      process.exit(0);
    }
  } catch (e) {
    console.error('[Startup] Failed to handle squirrel events:', e);
  }
  try {
    app.setAppUserModelId('com.everfern.desktop');
  } catch (e) {
    console.warn('[Startup] Could not set AppUserModelId:', e);
  }
}

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { acpManager } from './acp/manager';
import { getComputerOverlayManager } from './computer-overlay';
import type { ProviderType } from './acp/types';
import { ChatHistoryStore } from './store/history';
import { scheduledTasksManager } from './scheduled-tasks';
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

// ── Initialize Logging ──────────────────────────────────────────────
setupLogging();
console.log('[Startup] EverFern Main Process starting...');
console.log('[Startup] Platform:', process.platform);
console.log('[Startup] Node version:', process.version);
console.log('[Startup] App path:', app.getAppPath());
console.log('[Startup] User data:', app.getPath('userData'));

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

// Clear any stale GPU / network cache directories left by a previous run.
(function clearStaleCache() {
  try {
    const userData = app.getPath('userData');
    const dirsToWipe = ['GPUCache', 'ShaderCache', 'DawnCache', 'GrShaderCache'];
    for (const dir of dirsToWipe) {
      const full = path.join(userData, dir);
      if (fs.existsSync(full)) {
        fs.rmSync(full, { recursive: true, force: true });
      }
    }
  } catch (e) {
    console.warn('[Startup] Could not clear stale GPU cache:', e);
  }
})();

import { setupIPC } from './ipc';

// ── Singletons ──────────────────────────────────────────────────────

let historyStore: ChatHistoryStore;

try {
  console.log('[Startup] ACPManager singleton already initialized');
  console.log('[Startup] Initializing ChatHistoryStore...');
  historyStore = new ChatHistoryStore();

  // Register all modularized IPC handlers
  setupIPC(historyStore);

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

  console.log('[Startup] Singletons and IPC initialized.');
} catch (err) {
  console.error('[Startup] ❌ Critical failure during singleton initialization:', err);
}

// Computer-Use Permissions (per session)
let permissionsGranted = false;
// System-files write permissions (per chat run/session, shared with sandbox runtime)
(globalThis as any).__everfernSystemFilesPermissionGranted = false;

// Last stream event for JSON viewer
let lastStreamEvent: any = null;
// Full chat messages for JSON viewer
let lastChatMessages: any[] = [];


let mainWindow: BrowserWindow | null = null;

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
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();

      // commandLine is an array of strings that contains the extra parameters,
      // like the protocol link.
      const url = commandLine.find(arg => arg.startsWith('everfern-app://'));
      if (url) {
        console.log('[Startup] Protocol URL detected in second-instance:', url);
        mainWindow.webContents.send('acp:protocol-link', url);
      }
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

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`[Window] ❌ did-fail-load: ${errorCode} (${errorDescription}) for URL: ${validatedURL}`);
  });

  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    const levels = ['Log', 'Info', 'Warn', 'Error'];
    const levelStr = levels[level] || 'Log';
    console.log(`[Renderer ${levelStr}] ${message} (at ${sourceId}:${line})`);
  });

  mainWindow.webContents.on('render-process-gone', (event, details) => {
    console.error('[Window] ❌ Renderer process gone:', details);
  });

  mainWindow.webContents.on('unresponsive', () => {
    console.warn('[Window] ⚠️ Renderer is unresponsive');
  });

  mainWindow.webContents.on('did-finish-load', () => {
    console.log('[Window] Page finished loading');
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

import { VoiceOverlayManager } from './voice-overlay';

let voiceOverlayManager: VoiceOverlayManager;

import { bridgeServer } from './lib/extension-server';

import { schedulerService } from './integrations/scheduler-service';

app.whenReady().then(async () => {
  console.log('[App] App ready, starting initialization...');

  // Set up macOS application menu
  setupMacOSMenu();

  // Start the scheduler service
  schedulerService.start();

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
  protocol.handle('everfern-app', async (request) => {
    try {
      const url = new URL(request.url);
      let filePath = url.pathname;
      if (filePath === '/' || !filePath || filePath === '.') filePath = '/index.html';

      // Normalize path (handle leading slashes and dots)
      if (filePath.startsWith('./')) filePath = filePath.substring(1);
      if (!filePath.startsWith('/')) filePath = '/' + filePath;

      // In production, extraResources are in process.resourcesPath
      // In dev, they're in the project root
      const baseDir = app.isPackaged
        ? path.join(process.resourcesPath, 'out')
        : path.join(__dirname, '../../out');

      let absPath = path.join(baseDir, filePath);
      console.log(`[Protocol] Request: ${request.url} -> ${absPath} (baseDir: ${baseDir}, isPackaged: ${app.isPackaged})`);

      // Async helper to get stats
      const getStats = async (p: string) => { try { return await fs.promises.stat(p); } catch { return null; } };

      let stats = await getStats(absPath);

      // If it's a directory, try to serve index.html from that directory
      if (stats && stats.isDirectory()) {
        const dirIndexPath = path.join(absPath, 'index.html');
        if (await getStats(dirIndexPath)) {
          console.log(`[Protocol] Directory detected, serving ${dirIndexPath}`);
          const data = await fs.promises.readFile(dirIndexPath);
          return new Response(data, { headers: { 'Content-Type': 'text/html' } });
        }
        // Directory exists but no index.html — fall back to root index.html for SPA routing
        console.log(`[Protocol] Directory ${absPath} has no index.html, falling back to root index.html`);
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
        };

        const contentType = mimeTypes[extension] || 'application/octet-stream';
        const data = await fs.promises.readFile(absPath);

        return new Response(data, { headers: { 'Content-Type': contentType } });
      }

      // File not found — try index.html for client-side routing (SPA fallback)
      console.warn(`[Protocol] ⚠️ 404: ${absPath}, trying index.html for client-side routing`);
      const indexPath = path.join(baseDir, 'index.html');
      console.log(`[Protocol] Checking for index.html at: ${indexPath}`);

      if (await getStats(indexPath)) {
        console.log(`[Protocol] ✅ Found index.html, serving for SPA routing`);
        const data = await fs.promises.readFile(indexPath);
        return new Response(data, { headers: { 'Content-Type': 'text/html' } });
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
// ... existing site logic ...
    const url = new URL(request.url);
    const chatId = url.hostname;
    let filePath = url.pathname;

    if (filePath === '/' || !filePath) filePath = '/index.html';

    // Async file existence check helper
    const fileExists = async (p: string) => { try { await fs.promises.access(p); return true; } catch { return false; } };

    // Try sites folder first, then artifacts folder
    let absPath = path.join(os.homedir(), '.everfern', 'sites', chatId, filePath);
    if (!(await fileExists(absPath))) {
      absPath = path.join(os.homedir(), '.everfern', 'artifacts', chatId, filePath);
    }

    if (!(await fileExists(absPath))) return new Response('Not Found', { status: 404 });

    // Safety check: ensure path is within ~/.everfern/sites or ~/.everfern/artifacts
    const sitesRoot = path.join(os.homedir(), '.everfern', 'sites');
    const artifactsRoot = path.join(os.homedir(), '.everfern', 'artifacts');

    const isUnderSites = absPath.startsWith(sitesRoot);
    const isUnderArtifacts = absPath.startsWith(artifactsRoot);

    if (!isUnderSites && !isUnderArtifacts) {
      return new Response('Forbidden', { status: 403 });
    }

    return net.fetch(`file://${absPath.replace(/\\/g, '/')}`);
  });

  // ── Overlay Managers (must come AFTER protocol handlers) ──────────
  // Their constructors call loadURL('everfern-app://...') which requires
  // the custom protocol to already be registered.
  voiceOverlayManager = new VoiceOverlayManager();
  getComputerOverlayManager();

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
let isAppQuitting = false;
app.on('before-quit', async (event) => {
  if (isAppQuitting) return;
  event.preventDefault();
  isAppQuitting = true;
  console.log('[Shutdown] Graceful app shutdown initiated...');

  // Stop Agent Gateway Control Plane
  try {
    const { agentGatewayServer } = require('./agent/gateway');
    agentGatewayServer.stop();
  } catch (gatewayErr) {
    console.error('[Shutdown] Failed to stop Agent Gateway:', gatewayErr);
  }

  // Clean up MessageHandler
  await shutdownBotMessageHandler();

  // Stop integration services
  try {
    console.log('[App] Stopping integration services...');
    await integrationService.stop();
    console.log('[App] Integration services stopped successfully');
  } catch (error) {
    console.error('[App] Error stopping integration services:', error);
  }

  // Stop extension bridge server
  try {
    console.log('[App] Stopping extension bridge server...');
    bridgeServer.stop();
    console.log('[App] Extension bridge server stopped successfully');
  } catch (error) {
    console.error('[App] Error stopping extension bridge server:', error);
  }

  // Shutdown background processor
  try {
    console.log('[App] Shutting down background processor...');
    await backgroundProcessor.shutdown();
    console.log('[App] Background processor shutdown complete');
  } catch (error) {
    console.error('[App] Error shutting down background processor:', error);
  }

  // Shutdown MCP tools
  try {
    console.log('[App] Shutting down MCP tools...');
    await shutdownMCPTools();
    console.log('[App] MCP tools shutdown complete');
  } catch (error) {
    console.error('[App] Error shutting down MCP tools:', error);
  }

  // Close database connection cleanly
  try {
    console.log('[App] Closing database connection...');
    await closeDb();
    console.log('[App] Database connection closed successfully');
  } catch (error) {
    console.error('[App] Error closing database connection:', error);
  }

  // Clean up system tray
  try {
    systemTrayManager.destroy();
  } catch (trayErr) {
    console.error('[App] Error destroying system tray:', trayErr);
  }

  console.log('[Shutdown] Cleanup finished, exiting process.');
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
    const { execFile } = require('child_process');
    const os = require('os');

    // Construct full path to sound file
    const soundFilePath = path.join(__dirname, '../../public/sounds', soundPath);

    console.log(`[Audio] Playing sound: ${soundFilePath}`);

    if (!fs.existsSync(soundFilePath)) {
      console.warn(`[Audio] Sound file not found: ${soundFilePath}`);
      return false;
    }

    // Use platform-specific audio player
    const platform = os.platform();

    if (platform === 'win32') {
      // Windows: Use PowerShell to play sound
      execFile('powershell.exe', [
        '-Command',
        `(New-Object System.Media.SoundPlayer '${soundFilePath}').PlaySync()`
      ], { maxBuffer: 10 * 1024 * 1024 });
    } else if (platform === 'darwin') {
      // macOS: Use afplay command
      execFile('afplay', [soundFilePath]);
    } else if (platform === 'linux') {
      // Linux: Try paplay or other available audio player
      execFile('paplay', [soundFilePath], (err: any) => {
        if (err) {
          console.warn('[Audio] paplay failed, trying aplay:', err);
          execFile('aplay', [soundFilePath]);
        }
      });
    }

    return true;
  } catch (err) {
    console.error('[Audio] Error playing sound:', err);
    return false;
  }
});
// ── All IPC Handlers are modularized in main/ipc/ ──────────────────
export { isPermissionGranted } from './ipc/terminal-process-handlers';
