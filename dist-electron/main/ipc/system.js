"use strict";
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
exports.registerSystemHandlers = registerSystemHandlers;
const electron_1 = require("electron");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const memory_save_1 = require("../agent/tools/memory-save");
const linux_vm_executor_1 = require("../agent/tools/linux-vm-executor");
function registerSystemHandlers() {
    electron_1.ipcMain.handle('system:checkWSL', async () => {
        try {
            const { execSync } = require('child_process');
            execSync('wsl.exe -e echo ok', { stdio: 'ignore', timeout: 5000 });
            const list = execSync('wsl.exe --list --quiet', { encoding: 'utf8', timeout: 5000 });
            return list && list.trim().length > 0;
        }
        catch {
            return false;
        }
    });
    electron_1.ipcMain.handle('system:checkDocker', async () => {
        try {
            const { execSync } = require('child_process');
            execSync('docker info', { stdio: 'ignore', timeout: 5000 });
            return true;
        }
        catch {
            return false;
        }
    });
    electron_1.ipcMain.handle('system:installWSL', async () => {
        return new Promise((resolve) => {
            const { spawn } = require('child_process');
            const proc = spawn('powershell.exe', [
                '-NoProfile',
                '-ExecutionPolicy',
                'Bypass',
                '-Command',
                'Start-Process wsl.exe -ArgumentList "--install -d Ubuntu --no-launch" -Verb RunAs -Wait'
            ], { shell: false });
            proc.on('close', (code) => {
                try {
                    const { execSync } = require('child_process');
                    execSync('wsl.exe -d Ubuntu -e echo ok', { stdio: 'ignore', timeout: 5000 });
                    resolve({ success: true });
                }
                catch {
                    resolve({ success: true, warning: 'Reboot may be required' });
                }
            });
            proc.on('error', (err) => {
                resolve({ success: false, error: err.message });
            });
        });
    });
    electron_1.ipcMain.handle('system:setupDockerUbuntu', async () => {
        try {
            await (0, linux_vm_executor_1.ensureDockerContainer)();
            return { success: true };
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('system:get-username', () => {
        return os.userInfo().username;
    });
    electron_1.ipcMain.handle('system:get-version', () => {
        return electron_1.app.getVersion();
    });
    electron_1.ipcMain.handle('system:check-for-updates', async () => {
        try {
            const currentVersion = electron_1.app.getVersion();
            const response = await electron_1.net.fetch('https://api.github.com/repos/CodenRust/Everfern/releases/latest');
            if (!response.ok)
                return { hasUpdate: false };
            const data = await response.json();
            const latestVersion = data.tag_name.replace(/^v/, '');
            // Simple version comparison (semver-lite)
            const currentParts = currentVersion.split('.').map(Number);
            const latestParts = latestVersion.split('.').map(Number);
            let hasUpdate = false;
            for (let i = 0; i < 3; i++) {
                if ((latestParts[i] || 0) > (currentParts[i] || 0)) {
                    hasUpdate = true;
                    break;
                }
                else if ((latestParts[i] || 0) < (currentParts[i] || 0)) {
                    break;
                }
            }
            return {
                hasUpdate,
                latestVersion,
                url: data.html_url,
                notes: data.body
            };
        }
        catch (err) {
            console.error('[UpdateCheck] Failed to check for updates:', err);
            return { hasUpdate: false, error: String(err) };
        }
    });
    electron_1.ipcMain.handle('system:open-file-picker', async (_event, options) => {
        console.log('[IPC] system:open-file-picker called with options:', options);
        const mainWindow = global.mainWindow;
        if (!mainWindow) {
            console.error('[IPC] system:open-file-picker: mainWindow not available');
            return { success: false, error: 'Main window not available' };
        }
        try {
            console.log('[IPC] Opening file dialog...');
            const { canceled, filePaths } = await electron_1.dialog.showOpenDialog(mainWindow, {
                properties: ['openFile'],
                filters: options?.filters || [
                    { name: 'All Files', extensions: ['*'] },
                    { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] },
                    { name: 'Text & Documents', extensions: ['txt', 'md', 'json', 'csv', 'js', 'ts', 'py', 'log', 'html', 'css'] }
                ]
            });
            console.log('[IPC] Dialog result - canceled:', canceled, 'filePaths:', filePaths);
            if (canceled || filePaths.length === 0) {
                console.log('[IPC] User canceled or no file selected');
                return { success: false, canceled: true };
            }
            const originalFilePath = filePaths[0];
            console.log('[IPC] Processing file:', originalFilePath);
            const stats = fs.statSync(originalFilePath);
            const ext = path.extname(originalFilePath).toLowerCase();
            // Copy to ~/.everfern/attachments
            const attachmentsDir = path.join(os.homedir(), '.everfern', 'attachments');
            if (!fs.existsSync(attachmentsDir)) {
                fs.mkdirSync(attachmentsDir, { recursive: true });
            }
            const safeFileName = `${Date.now()}-${path.basename(originalFilePath)}`;
            const newFilePath = path.join(attachmentsDir, safeFileName);
            fs.copyFileSync(originalFilePath, newFilePath);
            console.log('[IPC] File copied to:', newFilePath);
            let mimeType = 'application/octet-stream';
            if (['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext)) {
                mimeType = `image/${ext === '.jpg' ? 'jpeg' : ext.slice(1)}`;
                const base64 = fs.readFileSync(newFilePath).toString('base64');
                const uri = `data:${mimeType};base64,${base64}`;
                console.log('[IPC] Returning image file, size:', stats.size);
                return { path: newFilePath, name: path.basename(originalFilePath), size: stats.size, mimeType, base64: uri, success: true };
            }
            else {
                const content = fs.readFileSync(newFilePath, 'utf-8');
                console.log('[IPC] Returning text file, size:', stats.size);
                return { path: newFilePath, name: path.basename(originalFilePath), size: stats.size, mimeType: 'text/plain', content, success: true };
            }
        }
        catch (err) {
            console.error('[IPC] Error in open-file-picker:', err);
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('system:open-folder-picker', async () => {
        const mainWindow = global.mainWindow;
        if (!mainWindow)
            return null;
        const { canceled, filePaths } = await electron_1.dialog.showOpenDialog(mainWindow, {
            properties: ['openDirectory'],
        });
        if (canceled || filePaths.length === 0)
            return null;
        const folderPath = filePaths[0];
        try {
            const stats = fs.statSync(folderPath);
            if (!stats.isDirectory())
                return { success: false, error: 'Selected path is not a folder.' };
            return { path: folderPath, name: path.basename(folderPath), success: true };
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('system:to-host-path', (_event, pathStr) => {
        try {
            const { translateLinuxPathToHost } = require('../agent/tools/linux-vm-executor');
            return translateLinuxPathToHost(pathStr);
        }
        catch {
            return pathStr;
        }
    });
    electron_1.ipcMain.handle('system:open-folder', async (_event, folderPath) => {
        if (folderPath) {
            try {
                const { translateLinuxPathToHost } = require('../agent/tools/linux-vm-executor');
                const hostPath = translateLinuxPathToHost(folderPath);
                electron_1.shell.openPath(hostPath);
                return { success: true };
            }
            catch (err) {
                return { success: false, error: err.message };
            }
        }
        return { success: false, error: 'Folder not found' };
    });
    function getOllamaBinary() {
        const isWin = process.platform === 'win32';
        if (isWin) {
            const home = os.homedir();
            const ollamaPath = path.join(home, 'AppData', 'Local', 'Programs', 'ollama', 'ollama.exe');
            if (fs.existsSync(ollamaPath))
                return `"${ollamaPath}"`;
            return 'ollama';
        }
        return '/usr/local/bin/ollama';
    }
    electron_1.ipcMain.handle('system:ollama-status', () => {
        try {
            const { execSync } = require('child_process');
            const bin = getOllamaBinary();
            // Check if Ollama is installed
            try {
                execSync(`${bin} -v`, { stdio: 'ignore' });
            }
            catch {
                return { installed: false, modelInstalled: false };
            }
            // Check if the specific model is pulled
            try {
                const list = execSync(`"${bin}" list`, { encoding: 'utf8' });
                const modelInstalled = list.includes('qwen3-vl:2b');
                return { installed: true, modelInstalled };
            }
            catch {
                return { installed: true, modelInstalled: false };
            }
        }
        catch {
            return { installed: false, modelInstalled: false };
        }
    });
    electron_1.ipcMain.handle('system:ollama-install', async (event) => {
        return new Promise((resolve) => {
            const { spawn } = require('child_process');
            // Switch command based on platform
            const isWin = process.platform === 'win32';
            const shellCmd = isWin ? 'powershell.exe' : 'sh';
            const command = isWin
                ? 'irm https://ollama.com/install.ps1 | Invoke-Expression'
                : 'curl -fsSL https://ollama.com/install.sh | sh';
            const args = isWin
                ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command]
                : ['-c', command];
            const proc = spawn(shellCmd, args, { shell: false });
            proc.stdout.on('data', (d) => {
                d.toString().split('\n').filter(Boolean).forEach((line) => {
                    event.sender.send('system:ollama-install-line', { line: line.trim(), type: 'stdout' });
                });
            });
            proc.stderr.on('data', (d) => {
                d.toString().split('\n').filter(Boolean).forEach((line) => {
                    event.sender.send('system:ollama-install-line', { line: line.trim(), type: 'stderr' });
                });
            });
            proc.on('close', (code) => {
                resolve({ success: code === 0, code });
            });
        });
    });
    electron_1.ipcMain.handle('system:ollama-pull', async (event, modelName) => {
        return new Promise((resolve) => {
            const { spawn } = require('child_process');
            const bin = getOllamaBinary();
            const isWin = process.platform === 'win32';
            const proc = spawn(bin, ['pull', modelName], { shell: isWin && bin !== 'ollama' });
            proc.stdout.on('data', (d) => {
                d.toString().split('\n').filter(Boolean).forEach((line) => {
                    event.sender.send('system:ollama-pull-line', { line: line.trim(), type: 'stdout' });
                });
            });
            proc.stderr.on('data', (d) => {
                d.toString().split('\n').filter(Boolean).forEach((line) => {
                    event.sender.send('system:ollama-pull-line', { line: line.trim(), type: 'stderr' });
                });
            });
            proc.on('close', (code) => resolve({ success: code === 0 || code === null, code }));
        });
    });
    electron_1.ipcMain.handle('memory:save-direct', async (_event, content, metadata) => {
        return memory_save_1.memorySaveTool.execute({ content, metadata });
    });
    electron_1.ipcMain.handle('system:wipe-account', async () => {
        const everfernDir = path.join(os.homedir(), '.everfern');
        try {
            // Close all open database connections before wiping files
            try {
                const { closeDb } = await Promise.resolve().then(() => __importStar(require('../lib/db')));
                await closeDb();
                console.log('[IPC] system:wipe-account: main DB closed');
            }
            catch (dbErr) {
                console.warn('[IPC] system:wipe-account: main DB close warning:', dbErr.message);
            }
            try {
                const { closeChatVectorDb } = await Promise.resolve().then(() => __importStar(require('../store/chat-vectors')));
                await closeChatVectorDb();
                console.log('[IPC] system:wipe-account: chat vector DB closed');
            }
            catch (vecErr) {
                console.warn('[IPC] system:wipe-account: chat vector DB close warning:', vecErr.message);
            }
            // Wipe .everfern directory
            if (fs.existsSync(everfernDir)) {
                fs.rmSync(everfernDir, { recursive: true, force: true });
            }
            fs.mkdirSync(everfernDir, { recursive: true });
            console.log('[IPC] system:wipe-account: .everfern (including sql databases) wiped');
            return { success: true };
        }
        catch (err) {
            console.error('[IPC] system:wipe-account error:', err);
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('system:open-external', async (_event, url) => {
        if (url) {
            try {
                if (url.startsWith('file://')) {
                    let decodedUrl = decodeURIComponent(url);
                    let filePath = decodedUrl.replace(/^file:\/\/\/?/, '');
                    const { translateLinuxPathToHost } = require('../agent/tools/linux-vm-executor');
                    const hostPath = translateLinuxPathToHost(filePath);
                    console.log(`[IPC] system:open-external: Original file:// url: ${url}, Translated host path: ${hostPath}`);
                    const resultMsg = await electron_1.shell.openPath(hostPath);
                    if (resultMsg) {
                        return { success: false, error: resultMsg };
                    }
                    return { success: true };
                }
                await electron_1.shell.openExternal(url);
                return { success: true };
            }
            catch (err) {
                console.error('[IPC] Error in system:open-external:', err);
                return { success: false, error: err.message };
            }
        }
        return { success: false, error: 'No URL provided' };
    });
    electron_1.ipcMain.handle('system:fetch-metadata', async (_event, url) => {
        if (!url)
            return null;
        try {
            const controller = new AbortController();
            const id = setTimeout(() => controller.abort(), 4000);
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
                },
                signal: controller.signal
            });
            clearTimeout(id);
            const html = await response.text();
            // Basic meta extraction
            const getMeta = (prop) => {
                const regex = new RegExp(`<meta[^>]*?(?:name|property)=["']${prop}["'][^>]*?content=["'](.*?)["']`, 'i');
                const match = html.match(regex);
                if (match)
                    return match[1];
                const altRegex = new RegExp(`<meta[^>]*?content=["'](.*?)["'][^>]*?(?:name|property)=["']${prop}["']`, 'i');
                const altMatch = html.match(altRegex);
                return altMatch ? altMatch[1] : null;
            };
            const cleanText = (text) => {
                if (!text)
                    return '';
                return text
                    .replace(/&amp;/g, '&')
                    .replace(/&lt;/g, '<')
                    .replace(/&gt;/g, '>')
                    .replace(/&quot;/g, '"')
                    .replace(/&#39;/g, "'")
                    .replace(/&apos;/g, "'")
                    .replace(/\s+/g, ' ')
                    .trim();
            };
            const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
            const rawTitle = getMeta('og:title') || (titleMatch ? titleMatch[1] : '') || '';
            const title = cleanText(rawTitle);
            const rawDescription = getMeta('og:description') || getMeta('description') || '';
            const description = cleanText(rawDescription);
            let favicon = html.match(/<link[^>]*?rel=["'](?:shortcut )?icon["'][^>]*?href=["'](.*?)["']/i)?.[1] || '';
            if (favicon && !favicon.startsWith('http')) {
                try {
                    const base = new URL(url);
                    favicon = new URL(favicon, base.origin).href;
                }
                catch { /* ignore */ }
            }
            return { title, description, favicon };
        }
        catch (err) {
            console.warn(`[IPC] system:fetch-metadata failed for ${url}:`, err);
            return null;
        }
    });
    electron_1.ipcMain.handle('system:start-dispatch', async (event, config) => {
        try {
            const { DispatchService } = await Promise.resolve().then(() => __importStar(require('../lib/dispatch')));
            await DispatchService.getInstance().initialize(config, () => {
                // Send event to the window that initiated the dispatch
                event.sender.send('system:dispatch-active');
            });
            return { success: true };
        }
        catch (err) {
            console.error('[IPC] system:start-dispatch error:', err);
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('system:restore-dispatch', async (event, config) => {
        try {
            const { DispatchService } = await Promise.resolve().then(() => __importStar(require('../lib/dispatch')));
            // Pass a dummy sessionId and pinCode for initialization since restoreSession will overwrite them
            await DispatchService.getInstance().initialize({ ...config, sessionId: '', pinCode: '' }, () => {
                event.sender.send('system:dispatch-active');
            });
            return await DispatchService.getInstance().restoreSession();
        }
        catch (err) {
            console.error('[IPC] system:restore-dispatch error:', err);
            return { success: false, error: err.message };
        }
    });
    electron_1.ipcMain.handle('system:stop-dispatch', async () => {
        try {
            const { DispatchService } = await Promise.resolve().then(() => __importStar(require('../lib/dispatch')));
            await DispatchService.getInstance().disconnect();
            return { success: true };
        }
        catch (err) {
            console.error('[IPC] system:stop-dispatch error:', err);
            return { success: false, error: err.message };
        }
    });
}
