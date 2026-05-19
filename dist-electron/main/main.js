"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.isPermissionGranted = isPermissionGranted;
const electron_1 = require("electron");
// Handle squirrel startup events for Windows
if (process.platform === 'win32') {
    try {
        if (require('electron-squirrel-startup')) {
            electron_1.app.quit();
            process.exit(0);
        }
    }
    catch (e) {
        console.error('[Startup] Failed to handle squirrel events:', e);
    }
}
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const manager_1 = require("./acp/manager");
const history_1 = require("./store/history");
const showui_server_1 = require("./agent/runner/showui-server");
const providers_1 = require("./lib/providers");
const debug_1 = require("./lib/debug");
const system_tray_manager_1 = require("./lib/system-tray-manager");
const auto_start_manager_1 = require("./lib/auto-start-manager");
const integration_service_1 = require("./integrations/integration-service");
const message_handler_1 = require("./integrations/message-handler");
// ── Initialize Logging ──────────────────────────────────────────────
(0, debug_1.setupLogging)();
console.log('[Startup] EverFern Main Process starting...');
console.log('[Startup] Platform:', process.platform);
console.log('[Startup] Node version:', process.version);
console.log('[Startup] App path:', electron_1.app.getAppPath());
console.log('[Startup] User data:', electron_1.app.getPath('userData'));
// ── Check for Auto-Start Mode ───────────────────────────────────────
const isAutoStartMode = process.argv.includes('--auto-start');
console.log('[Startup] Auto-start mode:', isAutoStartMode);
const electron_2 = require("electron");
const chat_vectors_1 = require("./store/chat-vectors");
const context_engine_1 = require("./context-engine");
const vector_1 = require("./context-engine/vector");
const electron_3 = require("electron");
const skills_sync_1 = require("./lib/skills-sync");
const registry_1 = require("./agent/tools/terminal/registry");
const prompt_sync_1 = require("./lib/prompt-sync");
const playwright_setup_1 = require("./lib/playwright-setup");
// ── GPU / Cache Startup Fixes (must run before app.whenReady) ───────────────
// Disable GPU shader disk cache — prevents "Access is denied (0x5)" on Windows
// when a previous Electron process left the GPUCache directory locked.
electron_1.app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
// Disable the net disk cache for the same reason (net\disk_cache errors).
electron_1.app.commandLine.appendSwitch('disable-application-cache');
// Suppress Chromium GPU blocklist — lets the GPU initialise even after a crash.
electron_1.app.commandLine.appendSwitch('ignore-gpu-blocklist');
// Clear any stale GPU / network cache directories left by a previous run.
(function clearStaleCache() {
    try {
        const userData = electron_1.app.getPath('userData');
        const dirsToWipe = ['GPUCache', 'ShaderCache', 'DawnCache', 'GrShaderCache'];
        for (const dir of dirsToWipe) {
            const full = path.join(userData, dir);
            if (fs.existsSync(full)) {
                fs.rmSync(full, { recursive: true, force: true });
            }
        }
    }
    catch (e) {
        console.warn('[Startup] Could not clear stale GPU cache:', e);
    }
})();
const ipc_1 = require("./ipc");
// ── Singletons ──────────────────────────────────────────────────────
let historyStore;
try {
    console.log('[Startup] ACPManager singleton already initialized');
    console.log('[Startup] Initializing ChatHistoryStore...');
    historyStore = new history_1.ChatHistoryStore();
    // Register all modularized IPC handlers
    (0, ipc_1.setupIPC)(historyStore);
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
4. If you are unsure about a command, ask for clarification.

Your goal is to be the ultimate workplace companion.
`;
                fs.writeFileSync(promptPath, defaultPrompt, 'utf-8');
            }
            else {
                console.log('[Startup] ✅ SYSTEM_PROMPT.md already exists in ~/.everfern/');
            }
        }
        catch (err) {
            console.error('[Startup] ❌ Failed to ensure SYSTEM_PROMPT.md existence:', err);
        }
    }
    // Ensure system prompt exists
    ensureSystemPromptExists();
    console.log('[Startup] Singletons and IPC initialized.');
}
catch (err) {
    console.error('[Startup] ❌ Critical failure during singleton initialization:', err);
}
// Computer-Use Permissions (per session)
let permissionsGranted = false;
// System-files write permissions (per chat run/session, shared with sandbox runtime)
globalThis.__everfernSystemFilesPermissionGranted = false;
// Last stream event for JSON viewer
let lastStreamEvent = null;
// Full chat messages for JSON viewer
let lastChatMessages = [];
let mainWindow = null;
// Handle protocol links on Windows
const gotTheLock = electron_1.app.requestSingleInstanceLock();
if (!gotTheLock) {
    console.log('[Startup] ⚠️ Already running, quitting...');
    electron_1.app.quit();
    process.exit(0);
}
else {
    electron_1.app.on('second-instance', (event, commandLine) => {
        console.log('[Startup] second-instance received:', commandLine);
        // Someone tried to run a second instance, we should focus our window.
        if (mainWindow) {
            if (mainWindow.isMinimized())
                mainWindow.restore();
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
// Tracks the ShowUI install/run process so we can kill it on app quit
let installProc = null;
// Message handler for bot integrations
let messageHandler = null;
// ── Window ──────────────────────────────────────────────────────────
function createWindow() {
    const isDev = !electron_1.app.isPackaged;
    console.log(`[Window] Creating window (app.isPackaged: ${electron_1.app.isPackaged}, isDev: ${isDev})`);
    console.log(`[Window] NODE_ENV: ${process.env.NODE_ENV}`);
    mainWindow = new electron_1.BrowserWindow({
        width: 1400, height: 900,
        minWidth: 800, minHeight: 600,
        frame: false,
        icon: isDev
            ? path.join(__dirname, '../../public/images/logos/everfern-rounded.png')
            : path.join(electron_1.app.getAppPath(), process.platform === 'win32'
                ? 'public/images/logos/everfern.ico'
                : 'public/images/logos/everfern-rounded.png'),
        titleBarStyle: 'hidden',
        trafficLightPosition: { x: 16, y: 16 },
        backgroundColor: '#1a1a1a',
        show: !isAutoStartMode, // Don't show window immediately in auto-start mode
        webPreferences: {
            preload: path.join(__dirname, '../preload/preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            backgroundThrottling: false,
            webSecurity: false, // Temporarily disabled for production path debugging
        },
    });
    // Make mainWindow available globally for IPC handlers
    global.mainWindow = mainWindow;
    console.log('[Window] mainWindow assigned to global');
    // Fallback: Show window after 5 seconds if ready-to-show never fires (only in normal mode)
    const showFallback = setTimeout(() => {
        if (mainWindow && !mainWindow.isVisible() && !isAutoStartMode) {
            console.warn('[Window] ready-to-show timed out, forcing show()');
            mainWindow.show();
        }
    }, 5000);
    mainWindow.once('ready-to-show', () => {
        console.log('[Window] ready-to-show received');
        clearTimeout(showFallback);
        // Initialize system tray first
        try {
            if (system_tray_manager_1.systemTrayManager.isSupported() && mainWindow) {
                system_tray_manager_1.systemTrayManager.createTray(mainWindow);
                system_tray_manager_1.systemTrayManager.setupWindowEvents();
                console.log('[Window] System tray initialized');
            }
            else {
                console.warn('[Window] System tray not supported on this platform or window not available');
            }
        }
        catch (error) {
            console.error('[Window] Failed to initialize system tray:', error);
        }
        // Handle auto-start mode
        if (isAutoStartMode) {
            console.log('[Window] Auto-start mode: minimizing to tray');
            if (system_tray_manager_1.systemTrayManager.isSupported()) {
                // Hide to tray instead of showing window
                system_tray_manager_1.systemTrayManager.hideToTray();
            }
            else {
                // If tray not supported, minimize window
                mainWindow?.minimize();
            }
        }
        else {
            // Normal startup: show window
            mainWindow?.show();
        }
    });
    if (isDev) {
        console.log('[Window] Loading dev URL: http://localhost:3001');
        // Wait for Next.js to be ready
        const waitForNext = () => new Promise((resolve, reject) => {
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
                }
                catch (err) {
                    console.log(`[Window] Attempt ${attempt}/30 failed: ${err}, waiting...`);
                    await new Promise(r => setTimeout(r, 1000));
                }
            }
            console.error('[Window] ❌ Next.js did not start in time');
        };
        console.log('[Window] Starting tryLoad...');
        tryLoad();
    }
    else {
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
    // Open external links in default browser
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('http')) {
            electron_3.shell.openExternal(url);
            return { action: 'deny' };
        }
        return { action: 'allow' };
    });
    mainWindow.webContents.on('will-navigate', (event, url) => {
        if (url.startsWith('http') && !url.includes('localhost')) {
            event.preventDefault();
            electron_3.shell.openExternal(url);
        }
    });
    mainWindow.on('closed', () => {
        console.log('[Window] Window closed');
        mainWindow = null;
        global.mainWindow = null;
        console.log('[Window] mainWindow cleared from global');
    });
}
// ── Protocol: Local App & Sites ──────────────────────────────────────────
// registerSchemesAsPrivileged must be called BEFORE app is ready
electron_1.protocol.registerSchemesAsPrivileged([
    { scheme: 'everfern-app', privileges: { standard: true, secure: true, supportFetchAPI: true, allowServiceWorkers: true } },
    { scheme: 'everfern-site', privileges: { standard: true, secure: true, supportFetchAPI: true, allowServiceWorkers: true } }
]);
// ── Auto-start enabled bots ──────────────────────────────────────────────
/**
 * Auto-start enabled bots on app launch
 * Requirements: 8.1, 8.2, 8.3
 */
async function autoStartEnabledBots() {
    try {
        console.log('[Integration] Checking for bots to auto-start...');
        // Get the bot integration manager from the integration service
        const botManager = integration_service_1.integrationService.getService('bot-integration-manager');
        if (!botManager) {
            console.warn('[Integration] Bot integration manager not available');
            return;
        }
        // Check Discord - start if enabled and has bot token
        if (integrationConfig.discord.enabled && integrationConfig.discord.botToken) {
            // Requirement 8.1: Check for configured model and provider
            if (!integrationConfig.discord.model || !integrationConfig.discord.provider) {
                // Requirement 8.2: Log warning for enabled bot without model configuration
                console.warn('[Integration] Discord bot is enabled but missing model/provider configuration. Message handler will not be initialized.');
                console.warn('[Integration] Please configure a model and provider in Discord settings.');
            }
            console.log('[Integration] Auto-starting Discord bot...');
            try {
                // Check if Discord platform is already registered
                const discordPlatform = botManager.getPlatform?.('discord');
                if (!discordPlatform) {
                    // Platform needs to be configured and registered
                    const { DiscordPlatform } = await Promise.resolve().then(() => __importStar(require('./integrations/discord-platform')));
                    const platform = new DiscordPlatform({
                        enabled: true,
                        config: {
                            botToken: integrationConfig.discord.botToken,
                            applicationId: integrationConfig.discord.applicationId,
                            respondToDMs: true,
                            respondToGuilds: true,
                            guildMentionOnly: true,
                            allowedGuilds: integrationConfig.discord.allowedGuilds || [],
                            allowedUsers: integrationConfig.discord.allowedUsers || []
                        }
                    });
                    await platform.initialize();
                    botManager.registerPlatform('discord', platform);
                    // Update connected status
                    integrationConfig.discord.connected = true;
                    saveIntegrationConfig(integrationConfig);
                    console.log('[Integration] Discord bot auto-started successfully');
                }
                else {
                    console.log('[Integration] Discord bot already running');
                }
            }
            catch (error) {
                console.error('[Integration] Failed to auto-start Discord bot:', error);
                integrationConfig.discord.connected = false;
                saveIntegrationConfig(integrationConfig);
            }
        }
        // Check Telegram - start if enabled and has bot token
        if (integrationConfig.telegram.enabled && integrationConfig.telegram.botToken) {
            // Requirement 8.1: Check for configured model and provider
            if (!integrationConfig.telegram.model || !integrationConfig.telegram.provider) {
                // Requirement 8.2: Log warning for enabled bot without model configuration
                console.warn('[Integration] Telegram bot is enabled but missing model/provider configuration. Message handler will not be initialized.');
                console.warn('[Integration] Please configure a model and provider in Telegram settings.');
            }
            console.log('[Integration] Auto-starting Telegram bot...');
            try {
                // Check if Telegram platform is already registered
                const telegramPlatform = botManager.getPlatform?.('telegram');
                if (!telegramPlatform) {
                    // Platform needs to be configured and registered
                    const { TelegramPlatform } = await Promise.resolve().then(() => __importStar(require('./integrations/telegram-platform')));
                    const platform = new TelegramPlatform({
                        enabled: true,
                        config: {
                            botToken: integrationConfig.telegram.botToken,
                            respondToGroups: true,
                            groupMentionOnly: true
                        }
                    });
                    await platform.initialize();
                    botManager.registerPlatform('telegram', platform);
                    // Update connected status
                    integrationConfig.telegram.connected = true;
                    saveIntegrationConfig(integrationConfig);
                    console.log('[Integration] Telegram bot auto-started successfully');
                }
                else {
                    console.log('[Integration] Telegram bot already running');
                }
            }
            catch (error) {
                console.error('[Integration] Failed to auto-start Telegram bot:', error);
                integrationConfig.telegram.connected = false;
                saveIntegrationConfig(integrationConfig);
            }
        }
        console.log('[Integration] Auto-start check complete');
    }
    catch (error) {
        console.error('[Integration] Error during auto-start:', error);
    }
}
// ── App lifecycle ───────────────────────────────────────────────────
const voice_overlay_1 = require("./voice-overlay");
let voiceOverlayManager;
const extension_server_1 = require("./lib/extension-server");
const scheduler_service_1 = require("./integrations/scheduler-service");
electron_1.app.whenReady().then(async () => {
    console.log('[App] App ready, starting initialization...');
    // Start the scheduler service
    scheduler_service_1.schedulerService.start();
    // Start the extension bridge server (localhost:4001)
    extension_server_1.bridgeServer.start();
    // ── Initialize Prompt Synchronization System ──────────────────────
    console.log('[Startup] 🔄 Initializing prompt synchronization...');
    (0, prompt_sync_1.initializePromptSync)(true); // Force sync to ensure latest prompts are always loaded
    // ── Ensure Playwright Chromium is installed (non-blocking) ─────────
    (0, playwright_setup_1.ensurePlaywrightChromium)();
    // Watch for prompt changes in development mode
    if (process.env.NODE_ENV === 'development') {
        (0, prompt_sync_1.watchPrompts)();
    }
    // ── Initialize Skill Synchronization System ──────────────────────
    console.log('[Startup] 🔄 Initializing skill synchronization...');
    (0, skills_sync_1.syncBuiltInSkills)();
    (0, skills_sync_1.mergeCustomSkills)();
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

Your goal is to be the ultimate workplace companion.
`;
                fs.writeFileSync(promptPath, defaultPrompt, 'utf-8');
            }
            else {
                console.log('[Startup] ✅ SYSTEM_PROMPT.md already exists in ~/.everfern/');
            }
        }
        catch (err) {
            console.error('[Startup] ❌ Failed to ensure SYSTEM_PROMPT.md existence:', err);
        }
    }
    // Ensure system prompt exists (fallback for prompt sync)
    ensureSystemPromptExists();
    voiceOverlayManager = new voice_overlay_1.VoiceOverlayManager();
    // ── Protocol Handlers ──────────────────────────────────────────────
    // Custom protocol for the main application (Next.js out folder)
    electron_1.protocol.handle('everfern-app', async (request) => {
        try {
            const url = new URL(request.url);
            let filePath = url.pathname;
            if (filePath === '/' || !filePath || filePath === '.')
                filePath = '/index.html';
            // Normalize path (handle leading slashes and dots)
            if (filePath.startsWith('./'))
                filePath = filePath.substring(1);
            if (!filePath.startsWith('/'))
                filePath = '/' + filePath;
            // In production, extraResources are in process.resourcesPath
            // In dev, they're in the project root
            const baseDir = electron_1.app.isPackaged
                ? path.join(process.resourcesPath, 'out')
                : path.join(__dirname, '../../out');
            let absPath = path.join(baseDir, filePath);
            console.log(`[Protocol] Request: ${request.url} -> ${absPath} (baseDir: ${baseDir}, isPackaged: ${electron_1.app.isPackaged})`);
            // Check if path exists
            if (fs.existsSync(absPath)) {
                const stats = fs.statSync(absPath);
                // If it's a directory, try to serve index.html from that directory
                if (stats.isDirectory()) {
                    const dirIndexPath = path.join(absPath, 'index.html');
                    if (fs.existsSync(dirIndexPath)) {
                        console.log(`[Protocol] Directory detected, serving ${dirIndexPath}`);
                        const data = fs.readFileSync(dirIndexPath);
                        return new Response(data, {
                            headers: { 'Content-Type': 'text/html' }
                        });
                    }
                    // Directory exists but no index.html — fall back to root index.html for SPA routing
                    console.log(`[Protocol] Directory ${absPath} has no index.html, falling back to root index.html`);
                    absPath = path.join(baseDir, 'index.html');
                }
                // It's a file — serve it
                if (fs.existsSync(absPath) && fs.statSync(absPath).isFile()) {
                    const extension = path.extname(absPath).toLowerCase();
                    const mimeTypes = {
                        '.html': 'text/html',
                        '.js': 'text/javascript',
                        '.css': 'text/css',
                        '.json': 'application/json',
                        '.png': 'image/png',
                        '.jpg': 'image/jpeg',
                        '.jpeg': 'image/jpeg',
                        '.gif': 'image/gif',
                        '.svg': 'image/svg+xml',
                        '.ico': 'image/x-icon',
                        '.woff': 'font/woff',
                        '.woff2': 'font/woff2',
                        '.ttf': 'font/ttf',
                        '.otf': 'font/otf',
                    };
                    const contentType = mimeTypes[extension] || 'application/octet-stream';
                    const data = fs.readFileSync(absPath);
                    return new Response(data, {
                        headers: { 'Content-Type': contentType }
                    });
                }
            }
            // File not found — try index.html for client-side routing (SPA fallback)
            console.warn(`[Protocol] ⚠️ 404: ${absPath}, trying index.html for client-side routing`);
            const indexPath = path.join(baseDir, 'index.html');
            console.log(`[Protocol] Checking for index.html at: ${indexPath}`);
            if (fs.existsSync(indexPath)) {
                console.log(`[Protocol] ✅ Found index.html, serving for SPA routing`);
                const data = fs.readFileSync(indexPath);
                return new Response(data, {
                    headers: { 'Content-Type': 'text/html' }
                });
            }
            console.warn(`[Protocol] ❌ 404: ${absPath} and index.html not found`);
            console.warn(`[Protocol] baseDir exists: ${fs.existsSync(baseDir)}`);
            if (fs.existsSync(baseDir)) {
                const files = fs.readdirSync(baseDir).slice(0, 10);
                console.warn(`[Protocol] Files in baseDir: ${files.join(', ')}`);
            }
            return new Response('Not Found', { status: 404 });
        }
        catch (err) {
            console.error('[Protocol] ❌ Error handling request:', err);
            const errorMsg = err instanceof Error ? err.message : String(err);
            return new Response(`Internal Server Error: ${errorMsg}`, { status: 500 });
        }
    });
    // Custom protocol for local sites
    electron_1.protocol.handle('everfern-site', (request) => {
        // ... existing site logic ...
        const url = new URL(request.url);
        const chatId = url.hostname;
        let filePath = url.pathname;
        if (filePath === '/' || !filePath)
            filePath = '/index.html';
        // Try sites folder first, then artifacts folder
        let absPath = path.join(os.homedir(), '.everfern', 'sites', chatId, filePath);
        if (!fs.existsSync(absPath)) {
            absPath = path.join(os.homedir(), '.everfern', 'artifacts', chatId, filePath);
        }
        if (!fs.existsSync(absPath))
            return new Response('Not Found', { status: 404 });
        // Safety check: ensure path is within ~/.everfern/sites or ~/.everfern/artifacts
        const sitesRoot = path.join(os.homedir(), '.everfern', 'sites');
        const artifactsRoot = path.join(os.homedir(), '.everfern', 'artifacts');
        const isUnderSites = absPath.startsWith(sitesRoot);
        const isUnderArtifacts = absPath.startsWith(artifactsRoot);
        if (!isUnderSites && !isUnderArtifacts) {
            return new Response('Forbidden', { status: 403 });
        }
        return electron_1.net.fetch(`file://${absPath.replace(/\\/g, '/')}`);
    });
    // ── Create Main Window ─────────────────────────────────────────────
    createWindow();
    // Register as default protocol client for everfern-app
    if (process.defaultApp) {
        if (process.argv.length >= 2) {
            electron_1.app.setAsDefaultProtocolClient('everfern-app', process.execPath, [path.resolve(process.argv[1])]);
        }
    }
    else {
        electron_1.app.setAsDefaultProtocolClient('everfern-app');
    }
    // Register Ctrl+Shift+P global shortcut for Debug Window
    try {
        const success = electron_2.globalShortcut.register('CommandOrControl+Shift+P', () => {
            console.log('[Shortcut] Ctrl+Shift+P triggered, toggling Debug Window...');
            (0, debug_1.toggleDebugWindow)();
        });
        if (!success) {
            console.error('[Shortcut] ❌ Failed to register Ctrl+Shift+P shortcut');
        }
        else {
            console.log('[Shortcut] ✅ Ctrl+Shift+P registered successfully');
        }
    }
    catch (error) {
        console.error('[Shortcut] ❌ Error registering Ctrl+Shift+P:', error);
    }
    // ── Initialize Integration Services ─────────────────────────────────
    try {
        console.log('[App] Initializing integration services...');
        await integration_service_1.integrationService.initialize();
        console.log('[App] Integration services initialized successfully');
        // Auto-start enabled and connected bots
        await autoStartEnabledBots();
        // Requirement 7.1, 8.3: Initialize MessageHandler after bot integration manager is ready
        const botManager = integration_service_1.integrationService.getService('bot-integration-manager');
        if (botManager) {
            // Check if at least one bot has model/provider configured
            const hasConfiguredBot = (integrationConfig.discord.enabled && integrationConfig.discord.connected &&
                integrationConfig.discord.model && integrationConfig.discord.provider) ||
                (integrationConfig.telegram.enabled && integrationConfig.telegram.connected &&
                    integrationConfig.telegram.model && integrationConfig.telegram.provider);
            if (hasConfiguredBot) {
                messageHandler = new message_handler_1.MessageHandler({
                    integrationConfig,
                    acpManager: manager_1.acpManager,
                    botManager
                });
                console.log('[App] MessageHandler initialized successfully');
            }
            else {
                console.log('[App] No configured bots found, MessageHandler not initialized');
            }
        }
    }
    catch (error) {
        console.error('[App] Failed to initialize integration services:', error);
        // Don't block app startup if integration services fail
    }
});
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin')
        electron_1.app.quit();
});
electron_1.app.on('activate', () => {
    // On macOS, re-create the window when the dock icon is clicked and no windows are open.
    if (electron_1.BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});
// ── ShowUI process cleanup on quit ──────────────────────────────────
electron_1.app.on('before-quit', async () => {
    // Requirement 7.2: Clean up MessageHandler
    if (messageHandler) {
        try {
            console.log('[App] Shutting down MessageHandler...');
            await messageHandler.shutdown();
            messageHandler = null;
            console.log('[App] MessageHandler shutdown complete');
        }
        catch (error) {
            console.error('[App] Error shutting down MessageHandler:', error);
        }
    }
    // Stop integration services
    try {
        console.log('[App] Stopping integration services...');
        await integration_service_1.integrationService.stop();
        console.log('[App] Integration services stopped successfully');
    }
    catch (error) {
        console.error('[App] Error stopping integration services:', error);
    }
    // Kill the install/run process spawned by showui:install
    if (installProc) {
        try {
            installProc.kill('SIGTERM');
        }
        catch { /* ignore */ }
        installProc = null;
    }
    // Kill the server managed by showui-server.ts (e.g. from showui:launch)
    (0, showui_server_1.killShowUIServer)();
    // Clean up system tray
    system_tray_manager_1.systemTrayManager.destroy();
});
// ── IPC: Window Controls ────────────────────────────────────────────
electron_1.ipcMain.handle('window:minimize', () => { mainWindow?.minimize(); });
electron_1.ipcMain.handle('window:maximize', () => { mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow?.maximize(); });
electron_1.ipcMain.handle('window:close', () => { mainWindow?.close(); });
electron_1.ipcMain.handle('window:is-maximized', () => mainWindow?.isMaximized() || false);
// ── IPC: System Tray ────────────────────────────────────────────────
electron_1.ipcMain.handle('tray:show-window', () => {
    system_tray_manager_1.systemTrayManager.showWindow();
    return { success: true };
});
electron_1.ipcMain.handle('tray:hide-to-tray', () => {
    system_tray_manager_1.systemTrayManager.hideToTray();
    return { success: true };
});
electron_1.ipcMain.handle('tray:is-supported', () => {
    return { supported: system_tray_manager_1.systemTrayManager.isSupported() };
});
electron_1.ipcMain.handle('tray:update-menu', () => {
    system_tray_manager_1.systemTrayManager.updateTrayMenu();
    return { success: true };
});
// ── IPC: Auto-Start ─────────────────────────────────────────────────
electron_1.ipcMain.handle('autostart:get-status', async () => {
    try {
        const enabled = await auto_start_manager_1.autoStartManager.isEnabled();
        return { success: true, enabled };
    }
    catch (error) {
        console.error('[AutoStart] Failed to get status:', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
});
electron_1.ipcMain.handle('autostart:enable', async () => {
    try {
        await auto_start_manager_1.autoStartManager.enable();
        console.log('[AutoStart] Auto-start enabled via IPC');
        return { success: true };
    }
    catch (error) {
        console.error('[AutoStart] Failed to enable:', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
});
electron_1.ipcMain.handle('autostart:disable', async () => {
    try {
        await auto_start_manager_1.autoStartManager.disable();
        console.log('[AutoStart] Auto-start disabled via IPC');
        return { success: true };
    }
    catch (error) {
        console.error('[AutoStart] Failed to disable:', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
});
electron_1.ipcMain.handle('autostart:get-info', () => {
    try {
        const info = auto_start_manager_1.autoStartManager.getPlatformInfo();
        return { success: true, info };
    }
    catch (error) {
        console.error('[AutoStart] Failed to get platform info:', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
});
electron_1.ipcMain.handle('autostart:validate-support', async () => {
    try {
        const validation = await auto_start_manager_1.autoStartManager.validatePlatformSupport();
        return { success: true, validation };
    }
    catch (error) {
        console.error('[AutoStart] Failed to validate platform support:', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
});
// ── IPC: Audio ──────────────────────────────────────────────────────
electron_1.ipcMain.handle('audio:play-sound', async (_event, soundPath) => {
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
        }
        else if (platform === 'darwin') {
            // macOS: Use afplay command
            execFile('afplay', [soundFilePath]);
        }
        else if (platform === 'linux') {
            // Linux: Try paplay or other available audio player
            execFile('paplay', [soundFilePath], (err) => {
                if (err) {
                    console.warn('[Audio] paplay failed, trying aplay:', err);
                    execFile('aplay', [soundFilePath]);
                }
            });
        }
        return true;
    }
    catch (err) {
        console.error('[Audio] Error playing sound:', err);
        return false;
    }
});
// ── IPC: Config ─────────────────────────────────────────────────────
electron_1.ipcMain.handle('save-config', async (_event, config) => {
    try {
        const configDir = path.join(os.homedir(), '.everfern');
        const configPath = path.join(configDir, 'config.json');
        if (!fs.existsSync(configDir)) {
            fs.mkdirSync(configDir, { recursive: true });
        }
        // Multi-file Key Isolation (Main Provider)
        if (config.apiKey && config.provider) {
            const keysDir = path.join(configDir, 'keys');
            if (!fs.existsSync(keysDir))
                fs.mkdirSync(keysDir, { recursive: true });
            const keyPath = path.join(keysDir, `${config.provider}.key`);
            fs.writeFileSync(keyPath, config.apiKey.trim());
            console.log(`[Config] Isolated key saved for ${config.provider}`);
        }
        // Key Isolation (Vision Model)
        if (config.vlm?.apiKey && config.vlm?.provider) {
            const keysDir = path.join(configDir, 'keys');
            if (!fs.existsSync(keysDir))
                fs.mkdirSync(keysDir, { recursive: true });
            const vlmKeyPath = path.join(keysDir, `vlm-${config.vlm.provider}.key`);
            fs.writeFileSync(vlmKeyPath, config.vlm.apiKey.trim());
            console.log(`[Config] Isolated vision key saved for ${config.vlm.provider}`);
        }
        // Save config WITHOUT the sensitive API keys
        const scrubbedConfig = { ...config };
        delete scrubbedConfig.apiKey;
        if (scrubbedConfig.vlm) {
            const scrubbedVlm = { ...scrubbedConfig.vlm };
            delete scrubbedVlm.apiKey;
            scrubbedConfig.vlm = scrubbedVlm;
        }
        fs.writeFileSync(configPath, JSON.stringify(scrubbedConfig, null, 2));
        // Immediately activate the new provider (with the key)
        if (config.provider) {
            manager_1.acpManager.setProvider({
                provider: config.provider,
                apiKey: config.apiKey,
                model: scrubbedConfig.model,
                baseUrl: scrubbedConfig.baseUrl,
                vlm: config.vlm, // Pass full VLM config including apiKey
            });
        }
        return { success: true };
    }
    catch (error) {
        console.error('[Config] Failed to save:', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
});
// ── Helper: loadConfigSync ──────────────────────────────────────────
function loadConfigSync() {
    try {
        const configDir = path.join(os.homedir(), '.everfern');
        const configPath = path.join(configDir, 'config.json');
        if (fs.existsSync(configPath)) {
            const data = fs.readFileSync(configPath, 'utf8');
            const config = JSON.parse(data);
            // Auto-migrate hf.co/Qwen/Qwen3-VL-2B-Thinking-GGUF -> qwen3-vl:2b
            if (config.vlm?.model?.includes('hf.co/Qwen/Qwen3-VL-2B-Thinking-GGUF')) {
                config.vlm.model = 'qwen3-vl:2b';
            }
            config.keys = {};
            const keysDir = path.join(configDir, 'keys');
            if (fs.existsSync(keysDir)) {
                const files = fs.readdirSync(keysDir);
                for (const file of files) {
                    if (file.endsWith('.key')) {
                        const baseName = file.replace('.key', '');
                        const key = fs.readFileSync(path.join(keysDir, file), 'utf-8').trim();
                        if (baseName.startsWith('vlm-')) {
                            const vlmProvider = baseName.replace('vlm-', '');
                            if (config.vlm && config.vlm.provider === vlmProvider) {
                                config.vlm.apiKey = key;
                            }
                        }
                        else {
                            config.keys[baseName] = key;
                            if (config.provider === baseName) {
                                config.apiKey = key;
                            }
                        }
                    }
                }
            }
            return config;
        }
        return null;
    }
    catch (err) {
        console.error('[Config] Error loading config:', err);
        return null;
    }
}
electron_1.ipcMain.handle('load-config', async () => {
    try {
        const config = loadConfigSync();
        if (!config)
            return { success: true, config: null };
        return { success: true, config };
    }
    catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
});
// ── IPC Handlers (Modularized) ──────────────────────────────────────
// Most IPC handlers have been moved to main/ipc/ for better maintainability.
// See setupIPC(historyStore) call in the singleton initialization block.
// ── IPC: Debug / JSON Viewer ───────────────────────────────────────────
electron_1.ipcMain.handle('debug:get-last-event', () => {
    return lastStreamEvent;
});
electron_1.ipcMain.handle('debug:get-chat-history', () => {
    // Build full chat history from lastStreamEvent and stored messages
    const fullHistory = [];
    // Add stored chat messages
    if (lastChatMessages.length > 0) {
        for (const m of lastChatMessages) {
            const msg = { role: m.role };
            if (m.role === 'system') {
                msg.content = '[SYSTEM PROMPT - HIDDEN]';
                msg.contentPreview = typeof m.content === 'string' ? m.content.substring(0, 200) + '...' : '[Complex system prompt]';
            }
            else if (typeof m.content === 'string') {
                msg.content = m.content;
                msg.contentLength = m.content.length;
            }
            else if (Array.isArray(m.content)) {
                msg.content = m.content.map((c) => c.type === 'text' ? c.text : c.type === 'image_url' ? '[Image]' : '[Content]').join('\n');
                msg.hasMultimodal = true;
            }
            if (m.tool_calls) {
                msg.toolCalls = m.tool_calls.map((tc) => ({ name: tc.function?.name || tc.name, arguments: tc.function?.arguments || tc.arguments, id: tc.id }));
            }
            if (m.role === 'tool') {
                msg.toolName = m.tool_name;
                msg.toolCallId = m.tool_call_id;
                msg.resultPreview = typeof m.content === 'string' ? m.content.substring(0, 500) + (m.content.length > 500 ? '...' : '') : '[Complex result]';
            }
            fullHistory.push(msg);
        }
    }
    // Add current stream event as the last message
    if (lastStreamEvent) {
        const eventMsg = { role: 'event', eventType: lastStreamEvent.type };
        if (lastStreamEvent.type === 'chunk') {
            eventMsg.content = lastStreamEvent.content;
        }
        else if (lastStreamEvent.type === 'tool_start') {
            eventMsg.toolName = lastStreamEvent.toolName;
            eventMsg.toolArgs = lastStreamEvent.toolArgs;
            eventMsg.description = `Starting: ${lastStreamEvent.toolName}`;
        }
        else if (lastStreamEvent.type === 'tool_call') {
            eventMsg.toolCall = lastStreamEvent.toolCall;
            eventMsg.description = `Tool called: ${lastStreamEvent.toolCall?.toolName || 'unknown'}`;
        }
        else if (lastStreamEvent.type === 'thought') {
            eventMsg.thinking = lastStreamEvent.content;
        }
        else {
            eventMsg.data = lastStreamEvent;
        }
        if (fullHistory.length > 0 || Object.keys(eventMsg).length > 2) {
            fullHistory.push(eventMsg);
        }
    }
    return { type: 'full_chat_history', messageCount: fullHistory.length, messages: fullHistory };
});
electron_1.ipcMain.handle('debug:copy-to-clipboard', (_e, text) => {
    electron_1.clipboard.writeText(text);
    return true;
});
// ── IPC: ShowUI Local Install ─────────────────────────────────────────
/**
 * Runs the ShowUI installation pipeline step-by-step.
 * Streams each line of stdout/stderr back via 'showui:install-line' events.
 * Emits 'showui:install-done' when all steps complete (or on failure).
 *
 * Steps:
 *   1. conda create -n showui python=3.11 -y
 *   2. conda run -n showui git clone https://github.com/showlab/ShowUI.git <dest>
 *   3. conda run -n showui pip install -r requirements.txt  (in cloned dir)
 */
electron_1.ipcMain.handle('showui:install', async (event) => {
    const { spawn, execSync } = require('child_process');
    const installSender = event.sender;
    const isWindows = process.platform === 'win32';
    const scriptsDir = path.join(electron_1.app.getAppPath(), 'scripts');
    const emit = (line, step, kind, pkg, pct, speed, eta) => {
        if (!installSender.isDestroyed()) {
            installSender.send('showui:install-line', { line, step, kind, pkg, pct, speed, eta });
        }
    };
    // ── Determine which command to run ────────────────────────────────
    let cmd;
    let args;
    let spawnOpts;
    if (isWindows) {
        // Windows: always use setup-showui.bat which internally calls WSL
        const batScript = path.join(scriptsDir, 'setup-showui.bat');
        cmd = batScript;
        args = [];
        spawnOpts = { shell: true, env: { ...process.env, PYTHONUNBUFFERED: '1' } };
        emit('Windows detected — will use WSL if available, then native Python fallback.', 1, 'info');
    }
    else {
        // macOS / Linux: run setup-unix.sh directly
        const shScript = path.join(scriptsDir, 'setup-unix.sh');
        try {
            execSync(`chmod +x "${shScript}"`);
        }
        catch { /* ignore */ }
        cmd = 'bash';
        args = [shScript];
        spawnOpts = { shell: false, env: { ...process.env, PYTHONUNBUFFERED: '1' } };
        emit('Unix detected — running native setup-unix.sh.', 1, 'info');
    }
    try {
        emit('Initializing EverFern ShowUI Installer...', 1, 'info');
        return new Promise((resolve) => {
            const proc = spawn(cmd, args, spawnOpts);
            installProc = proc; // track for cleanup on app quit
            let resolvedAlready = false;
            // Fallback: actively poll the server in case logs are swallowed
            const pollTimer = setInterval(async () => {
                if (resolvedAlready) {
                    clearInterval(pollTimer);
                    return;
                }
                try {
                    // Send a quick GET to the Gradio port. Any response (even 404/405) means it's alive.
                    const res = await fetch('http://127.0.0.1:7860/', { method: 'GET', signal: AbortSignal.timeout(1500) });
                    if (res.status && !resolvedAlready) {
                        resolvedAlready = true;
                        clearInterval(pollTimer);
                        emit('EVERFERN_PROGRESS:100', 1, 'info', undefined, 100);
                        emit('✅ ShowUI is running on port 7860! Setup complete.', 3, 'done', undefined, 100);
                        resolve({ success: true });
                    }
                }
                catch (e) { /* ignore ECONNREFUSED */ }
            }, 3000);
            const parseLine = (l) => {
                const line = l.trim();
                if (!line)
                    return;
                // Progress markers
                if (line.includes('EVERFERN_PROGRESS:')) {
                    const pct = parseInt(line.split('EVERFERN_PROGRESS:')[1], 10);
                    if (!isNaN(pct)) {
                        emit(line, 1, 'info', undefined, pct);
                        return;
                    }
                }
                // ── ShowUI Gradio server is live ────────────────────────────────
                if (line.includes('Running on local URL:') || line.includes('Running on public URL:')) {
                    emit(line, 1, 'out');
                    if (!resolvedAlready) {
                        resolvedAlready = true;
                        emit('EVERFERN_PROGRESS:100', 1, 'info', undefined, 100);
                        emit('✅ ShowUI is running! Setup complete.', 3, 'done', undefined, 100);
                        resolve({ success: true });
                    }
                    return;
                }
                // Reboot required (exit 11 from bat)
                if (line.includes('REBOOT')) {
                    emit('⚠️ WSL installed! Please REBOOT your PC and re-run EverFern.', 1, 'info', undefined, 0);
                    return;
                }
                // pip Collecting
                if (line.startsWith('Collecting ')) {
                    emit(line, 1, 'pip', line.split(' ')[1]);
                    // fall through to print the log
                }
                // pip Downloading
                if (line.startsWith('Downloading ')) {
                    emit(line, 1, 'pip', line.split(' ')[1]);
                    // fall through to print the log
                }
                // pip progress: ━━━━━━━━━━━━━━━━ 1.2/3.4 MB 2.5 MB/s eta 0:00:01
                const progressMatch = line.match(/([\d\.]+)\/([\d\.]+)\s+([kMGPE]?B)/i);
                if (progressMatch) {
                    const dl = parseFloat(progressMatch[1]);
                    const total = parseFloat(progressMatch[2]);
                    if (total > 0) {
                        const pct = Math.round((dl / total) * 100);
                        const speedMatch = line.match(/([\d\.]+\s+[kMGPE]?B\/s)/i);
                        const etaMatch = line.match(/eta\s+([\d:]+)/i);
                        emit('', 1, 'pip', undefined, pct, speedMatch?.[1], etaMatch?.[1]);
                        // Don't return, let it print the progress bar cleanly or drop it? Let's hide the raw pip bar to keep logs clean
                        return;
                    }
                }
                emit(line, 1, 'out');
            };
            let bufferedOut = '';
            proc.stdout?.on('data', (d) => {
                bufferedOut += d.toString();
                let idx;
                while ((idx = bufferedOut.search(/[\r\n]/)) !== -1) {
                    const line = bufferedOut.substring(0, idx);
                    bufferedOut = bufferedOut.substring(idx + 1);
                    parseLine(line);
                }
            });
            let bufferedErr = '';
            proc.stderr?.on('data', (d) => {
                bufferedErr += d.toString();
                let idx;
                while ((idx = bufferedErr.search(/[\r\n]/)) !== -1) {
                    const line = bufferedErr.substring(0, idx).trim();
                    bufferedErr = bufferedErr.substring(idx + 1);
                    if (!line)
                        continue;
                    // Gradio prints "Running on local URL:" to stderr — run through parseLine
                    // so our URL-detection / progress logic fires correctly.
                    if (line.includes('Running on local URL:') || line.includes('Running on public URL:') || line.includes('EVERFERN_PROGRESS:')) {
                        parseLine(line);
                    }
                    else {
                        emit(line, 1, 'err');
                    }
                }
            });
            proc.on('close', (code) => {
                clearInterval(pollTimer);
                if (resolvedAlready)
                    return; // already resolved when Gradio URL appeared
                if (code === 0) {
                    emit('✅ ShowUI installation complete!', 3, 'done', undefined, 100);
                    resolve({ success: true });
                }
                else if (code === 11) {
                    // Special: reboot required for WSL
                    emit('⚠️ Reboot required to finish WSL setup. Please restart your PC.', 2, 'info');
                    resolve({ success: false, error: 'reboot_required' });
                }
                else {
                    const msg = `Installation failed with exit code ${code}`;
                    emit(`❌ ${msg}`, 0, 'fail');
                    resolve({ success: false, error: msg });
                }
            });
            proc.on('error', (err) => {
                clearInterval(pollTimer);
                emit(`❌ Process Error: ${err.message}`, 0, 'fail');
                resolve({ success: false, error: err.message });
            });
        });
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        emit(`❌ Setup Exception: ${msg}`, 0, 'fail');
        return { success: false, error: msg };
    }
});
electron_1.ipcMain.handle('showui:launch', async (event) => {
    const launchSender = event.sender;
    const emit = (line, kind) => {
        if (!launchSender.isDestroyed())
            launchSender.send('showui:install-line', { line, step: 4, kind });
    };
    try {
        const success = await (0, showui_server_1.ensureShowUIServer)((line) => emit(line, 'info'));
        return { success };
    }
    catch (error) {
        emit(`[Launch] Error: ${error}`, 'err');
        return { success: false, error: String(error) };
    }
});
// ── IPC: Permissions ──────────────────────────────────────────────────
electron_1.ipcMain.handle('permissions:grant', () => {
    permissionsGranted = true;
    return { success: true };
});
electron_1.ipcMain.handle('permissions:status', () => {
    return { granted: permissionsGranted };
});
// ── IPC: Terminal Processes ───────────────────────────────────────────
electron_1.ipcMain.handle('terminal:list-processes', () => {
    const registry = registry_1.CommandRegistry.getInstance();
    return registry.listCommands();
});
electron_1.ipcMain.handle('terminal:kill-process', (_event, id) => {
    const registry = registry_1.CommandRegistry.getInstance();
    return { success: registry.terminate(id) };
});
// ── IPC: Vector Store (Text-based search, no SQLite-vec) ─────────────
(0, context_engine_1.registerContextEngine)('vector', () => new vector_1.VectorContextEngine());
(0, context_engine_1.setDefaultContextEngine)('vector');
// Initialize vector DB asynchronously, won't block app startup
setTimeout(() => {
    (0, chat_vectors_1.initChatVectorDb)().then(() => {
        console.log('[Vectors] Database initialized');
    }).catch(err => {
        console.warn('[Vectors] Initialization failed (non-blocking):', err.message);
    });
}, 5000);
electron_1.ipcMain.handle('vectors:search', async (_event, query, topK = 10, chatId) => {
    try {
        return await (0, chat_vectors_1.searchChatVectors)(query, topK, chatId);
    }
    catch (err) {
        console.warn('[Vectors] Search error:', err);
        return [];
    }
});
electron_1.ipcMain.handle('vectors:get', async (_event, chatId) => {
    try {
        return await (0, chat_vectors_1.getChatVectors)(chatId);
    }
    catch (err) {
        console.warn('[Vectors] Get error:', err);
        return [];
    }
});
electron_1.ipcMain.handle('vectors:delete', async (_event, chatId) => {
    try {
        await (0, chat_vectors_1.deleteChatVectors)(chatId);
        return { success: true };
    }
    catch (err) {
        console.warn('[Vectors] Delete error:', err);
        return { success: false, error: String(err) };
    }
});
electron_1.ipcMain.handle('vectors:stats', async () => {
    try {
        return await (0, chat_vectors_1.getVectorStats)();
    }
    catch (err) {
        console.warn('[Vectors] Stats error:', err);
        return { messageCount: 0, storageSize: 0, dimensionCount: null, initialized: false, error: String(err) };
    }
});
electron_1.ipcMain.handle('vectors:index-message', async (_event, id, chatId, role, content, createdAt) => {
    try {
        const { embedAndStoreMessage } = await Promise.resolve().then(() => __importStar(require('./store/chat-vectors')));
        await embedAndStoreMessage(id, chatId, role, content, createdAt);
        return { success: true };
    }
    catch (err) {
        console.warn('[Vectors] Index error:', err);
        return { success: false, error: String(err) };
    }
});
electron_1.ipcMain.handle('vectors:refresh-config', async () => {
    return { success: true };
});
// ── Custom Skills IPC Handlers ─────────────────────────────────────────────
electron_1.ipcMain.handle('skills:list-custom', async () => {
    return (0, skills_sync_1.listCustomSkills)();
});
electron_1.ipcMain.handle('skills:save-custom', async (_event, data) => {
    const result = (0, skills_sync_1.saveCustomSkill)(data);
    if (result.success) {
        (0, skills_sync_1.mergeCustomSkills)();
    }
    return result;
});
electron_1.ipcMain.handle('skills:delete-custom', async (_event, name) => {
    const result = (0, skills_sync_1.deleteCustomSkill)(name);
    if (result.success) {
        (0, skills_sync_1.syncBuiltInSkills)();
        (0, skills_sync_1.mergeCustomSkills)();
    }
    return result;
});
electron_1.ipcMain.handle('skills:get-custom-path', async () => {
    return (0, skills_sync_1.getCustomSkillsPath)();
});
// Store integration config in memory (will be persisted to file later)
let integrationConfig = {
    telegram: {
        enabled: false,
        botToken: '',
        connected: false,
    },
    discord: {
        enabled: false,
        botToken: '',
        applicationId: '',
        connected: false,
    },
};
// Load integration config from file
const loadIntegrationConfig = () => {
    try {
        const configPath = path.join(os.homedir(), '.everfern', 'integration-config.json');
        if (fs.existsSync(configPath)) {
            const data = fs.readFileSync(configPath, 'utf8');
            const loaded = JSON.parse(data);
            // Deep merge to ensure backward compatibility with configs missing model/provider fields
            return {
                telegram: {
                    ...integrationConfig.telegram,
                    ...loaded.telegram,
                },
                discord: {
                    ...integrationConfig.discord,
                    ...loaded.discord,
                },
            };
        }
    }
    catch (error) {
        console.warn('[Integration] Failed to load config:', error);
    }
    return integrationConfig;
};
// Save integration config to file
const saveIntegrationConfig = (config) => {
    try {
        const configDir = path.join(os.homedir(), '.everfern');
        if (!fs.existsSync(configDir)) {
            fs.mkdirSync(configDir, { recursive: true });
        }
        const configPath = path.join(configDir, 'integration-config.json');
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    }
    catch (error) {
        console.error('[Integration] Failed to save config:', error);
        throw error;
    }
};
// Test Telegram bot connection
const testTelegramConnection = async (botToken) => {
    try {
        if (!botToken || !botToken.trim()) {
            return false;
        }
        // Test the bot token by calling getMe API
        const response = await fetch(`https://api.telegram.org/bot${botToken}/getMe`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
        });
        if (!response.ok) {
            console.warn('[Integration] Telegram API error:', response.status, response.statusText);
            return false;
        }
        const data = await response.json();
        if (data.ok && data.result) {
            console.log('[Integration] Telegram bot connected:', data.result.username);
            return true;
        }
        return false;
    }
    catch (error) {
        console.error('[Integration] Telegram connection test failed:', error);
        return false;
    }
};
// Test Discord bot connection
const testDiscordConnection = async (botToken, applicationId) => {
    try {
        if (!botToken || !botToken.trim() || !applicationId || !applicationId.trim()) {
            return false;
        }
        // Test the bot token by calling Discord API to get application info
        const response = await fetch(`https://discord.com/api/v10/applications/${applicationId}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bot ${botToken}`,
                'Content-Type': 'application/json',
            },
        });
        if (!response.ok) {
            console.warn('[Integration] Discord API error:', response.status, response.statusText);
            return false;
        }
        const data = await response.json();
        if (data.id && data.name) {
            console.log('[Integration] Discord bot connected:', data.name);
            return true;
        }
        return false;
    }
    catch (error) {
        console.error('[Integration] Discord connection test failed:', error);
        return false;
    }
};
// Load config on startup
integrationConfig = loadIntegrationConfig();
electron_1.ipcMain.handle('integration:get-config', () => {
    return Promise.resolve(integrationConfig);
});
electron_1.ipcMain.handle('integration:save-config', async (_event, config) => {
    try {
        integrationConfig = { ...config };
        saveIntegrationConfig(integrationConfig);
        console.log('[Integration] Configuration saved successfully');
        // Reinitialize MessageHandler if config changed
        const botManager = integration_service_1.integrationService.getService('bot-integration-manager');
        if (botManager) {
            // Check if at least one bot has model/provider configured
            const hasConfiguredBot = (integrationConfig.discord.enabled && integrationConfig.discord.connected &&
                integrationConfig.discord.model && integrationConfig.discord.provider) ||
                (integrationConfig.telegram.enabled && integrationConfig.telegram.connected &&
                    integrationConfig.telegram.model && integrationConfig.telegram.provider);
            if (hasConfiguredBot) {
                // Shutdown existing MessageHandler if it exists
                if (messageHandler) {
                    console.log('[Integration] Shutting down existing MessageHandler...');
                    await messageHandler.shutdown();
                    messageHandler = null;
                }
                // Create new MessageHandler with updated config
                messageHandler = new message_handler_1.MessageHandler({
                    integrationConfig,
                    acpManager: manager_1.acpManager,
                    botManager
                });
                console.log('[Integration] MessageHandler reinitialized with updated config');
            }
            else if (messageHandler) {
                // No configured bots, shutdown MessageHandler
                console.log('[Integration] No configured bots, shutting down MessageHandler...');
                await messageHandler.shutdown();
                messageHandler = null;
            }
            // Update Discord platform config if it's running
            const discordPlatform = botManager.getPlatform?.('discord');
            if (discordPlatform && integrationConfig.discord.enabled) {
                console.log('[Integration] Updating Discord platform configuration...');
                // Disconnect and reconnect with new config
                await discordPlatform.disconnect();
                const { DiscordPlatform } = await Promise.resolve().then(() => __importStar(require('./integrations/discord-platform')));
                const newPlatform = new DiscordPlatform({
                    enabled: true,
                    config: {
                        botToken: integrationConfig.discord.botToken,
                        applicationId: integrationConfig.discord.applicationId,
                        respondToDMs: true,
                        respondToGuilds: true,
                        guildMentionOnly: true,
                        allowedGuilds: integrationConfig.discord.allowedGuilds || [],
                        allowedUsers: integrationConfig.discord.allowedUsers || []
                    }
                });
                await newPlatform.initialize();
                botManager.registerPlatform('discord', newPlatform);
                console.log('[Integration] Discord platform updated with new config');
            }
        }
    }
    catch (error) {
        console.error('[Integration] Failed to save configuration:', error);
        throw error;
    }
});
electron_1.ipcMain.handle('integration:test-connection', async (_event, platform) => {
    try {
        console.log(`[Integration] Testing ${platform} connection...`);
        let result = false;
        if (platform === 'telegram') {
            result = await testTelegramConnection(integrationConfig.telegram.botToken);
            console.log(`[Integration] Telegram test result: ${result}`);
        }
        else if (platform === 'discord') {
            result = await testDiscordConnection(integrationConfig.discord.botToken, integrationConfig.discord.applicationId);
            console.log(`[Integration] Discord test result: ${result}`);
        }
        else {
            console.warn(`[Integration] Unknown platform: ${platform}`);
            return false;
        }
        // Update the connected status based on test result
        if (platform === 'telegram') {
            integrationConfig.telegram.connected = result;
        }
        else if (platform === 'discord') {
            integrationConfig.discord.connected = result;
        }
        // Persist the updated configuration to disk
        saveIntegrationConfig(integrationConfig);
        console.log(`[Integration] Updated ${platform} connected status to: ${result}`);
        // If test succeeded and platform is enabled, start the bot
        if (result) {
            const botManager = integration_service_1.integrationService.getService('bot-integration-manager');
            if (botManager) {
                try {
                    if (platform === 'discord' && integrationConfig.discord.enabled) {
                        // Check if Discord platform is already registered
                        const existingPlatform = botManager.getPlatform?.('discord');
                        if (!existingPlatform) {
                            console.log('[Integration] Starting Discord bot after successful test...');
                            const { DiscordPlatform } = await Promise.resolve().then(() => __importStar(require('./integrations/discord-platform')));
                            const discordPlatform = new DiscordPlatform({
                                enabled: true,
                                config: {
                                    botToken: integrationConfig.discord.botToken,
                                    applicationId: integrationConfig.discord.applicationId,
                                    respondToDMs: true,
                                    respondToGuilds: true,
                                    guildMentionOnly: true,
                                    allowedGuilds: integrationConfig.discord.allowedGuilds || [],
                                    allowedUsers: integrationConfig.discord.allowedUsers || []
                                }
                            });
                            await discordPlatform.initialize();
                            botManager.registerPlatform('discord', discordPlatform);
                            console.log('[Integration] Discord bot started and registered');
                        }
                        else {
                            console.log('[Integration] Discord bot already running');
                        }
                    }
                    else if (platform === 'telegram' && integrationConfig.telegram.enabled) {
                        // Check if Telegram platform is already registered
                        const existingPlatform = botManager.getPlatform?.('telegram');
                        if (!existingPlatform) {
                            console.log('[Integration] Starting Telegram bot after successful test...');
                            const { TelegramPlatform } = await Promise.resolve().then(() => __importStar(require('./integrations/telegram-platform')));
                            const telegramPlatform = new TelegramPlatform({
                                enabled: true,
                                config: {
                                    botToken: integrationConfig.telegram.botToken,
                                    respondToGroups: true,
                                    groupMentionOnly: false
                                }
                            });
                            await telegramPlatform.initialize();
                            botManager.registerPlatform('telegram', telegramPlatform);
                            console.log('[Integration] Telegram bot started and registered');
                        }
                        else {
                            console.log('[Integration] Telegram bot already running');
                        }
                    }
                }
                catch (startError) {
                    console.error(`[Integration] Failed to start ${platform} bot after test:`, startError);
                    // Don't fail the test connection, just log the error
                }
            }
        }
        return result;
    }
    catch (error) {
        console.error(`[Integration] Connection test failed for ${platform}:`, error);
        // Set connected to false on error
        if (platform === 'telegram') {
            integrationConfig.telegram.connected = false;
        }
        else if (platform === 'discord') {
            integrationConfig.discord.connected = false;
        }
        saveIntegrationConfig(integrationConfig);
        return false;
    }
});
electron_1.ipcMain.handle('integration:get-service-status', (_event, serviceName) => {
    try {
        return integration_service_1.integrationService.getServiceStatus(serviceName);
    }
    catch (error) {
        console.error('[Integration] Failed to get service status:', error);
        return { name: serviceName || 'unknown', status: 'error', error: String(error) };
    }
});
electron_1.ipcMain.handle('integration:get-system-status', () => {
    try {
        return integration_service_1.integrationService.getSystemStatus();
    }
    catch (error) {
        console.error('[Integration] Failed to get system status:', error);
        return {
            initialized: false,
            started: false,
            servicesRunning: 0,
            servicesTotal: 0,
            errors: [String(error)]
        };
    }
});
electron_1.ipcMain.handle('integration:start-service', async (_event, serviceName) => {
    try {
        const service = integration_service_1.integrationService.getService(serviceName);
        if (service && typeof service.start === 'function') {
            await service.start();
            return { success: true };
        }
        return { success: false, error: 'Service not found or not startable' };
    }
    catch (error) {
        console.error(`[Integration] Failed to start service ${serviceName}:`, error);
        return { success: false, error: String(error) };
    }
});
electron_1.ipcMain.handle('integration:stop-service', async (_event, serviceName) => {
    try {
        const service = integration_service_1.integrationService.getService(serviceName);
        if (service && typeof service.stop === 'function') {
            await service.stop();
            return { success: true };
        }
        return { success: false, error: 'Service not found or not stoppable' };
    }
    catch (error) {
        console.error(`[Integration] Failed to stop service ${serviceName}:`, error);
        return { success: false, error: String(error) };
    }
});
electron_1.ipcMain.handle('integration:restart-service', async (_event, serviceName) => {
    try {
        const service = integration_service_1.integrationService.getService(serviceName);
        if (service) {
            if (typeof service.stop === 'function') {
                await service.stop();
            }
            if (typeof service.start === 'function') {
                await service.start();
            }
            return { success: true };
        }
        return { success: false, error: 'Service not found' };
    }
    catch (error) {
        console.error(`[Integration] Failed to restart service ${serviceName}:`, error);
        return { success: false, error: String(error) };
    }
});
// ── IPC: Providers ──────────────────────────────────────────────────
electron_1.ipcMain.handle('providers:get-all', () => {
    const providers = Object.values(providers_1.PROVIDER_REGISTRY);
    // Check which providers have API keys configured
    const providersWithStatus = providers.map((provider) => {
        let enabled = true;
        // For providers that require API keys, check if they're configured
        if (provider.requiresApiKey) {
            try {
                const config = loadConfigSync();
                if (config && config.keys) {
                    // Check if the provider has an API key in the keys object
                    const apiKey = config.keys[provider.type];
                    enabled = !!apiKey && apiKey.trim().length > 0;
                }
                else {
                    enabled = false;
                }
            }
            catch {
                enabled = false;
            }
        }
        // Local providers (ollama, lmstudio) are always enabled
        // everfern is always enabled (no API key required)
        return {
            ...provider,
            enabled
        };
    });
    return providersWithStatus;
});
electron_1.ipcMain.handle('providers:get-models', (_event, providerType) => {
    const type = providerType;
    const models = (0, providers_1.getModelsForProvider)(type);
    const providerMeta = providers_1.PROVIDER_REGISTRY[type];
    return models.map(modelId => ({
        id: modelId,
        name: (0, providers_1.formatModelName)(modelId),
        provider: providerMeta?.name || providerType,
        providerType: type
    }));
});
function isPermissionGranted() { return permissionsGranted; }
