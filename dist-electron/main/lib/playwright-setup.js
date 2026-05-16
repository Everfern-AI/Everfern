"use strict";
/**
 * EverFern Desktop — Playwright Chromium Setup
 *
 * Checks whether the Playwright Chromium browser executable is present and,
 * if not, runs `playwright install chromium` in the background so the
 * web-search and web-crawl local-mode tools work out of the box.
 *
 * The check is non-blocking: it runs after the window is ready and any
 * failure is logged but never surfaces as a fatal error.
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
exports.findChromiumExecutable = findChromiumExecutable;
exports.ensurePlaywrightChromium = ensurePlaywrightChromium;
const child_process_1 = require("child_process");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
// Playwright stores its browsers under this directory by default.
function getPlaywrightBrowsersPath() {
    if (process.env.PLAYWRIGHT_BROWSERS_PATH) {
        return process.env.PLAYWRIGHT_BROWSERS_PATH;
    }
    switch (process.platform) {
        case 'win32':
            return path.join(process.env.LOCALAPPDATA ?? path.join(process.env.USERPROFILE ?? '', 'AppData', 'Local'), 'ms-playwright');
        case 'darwin':
            return path.join(process.env.HOME ?? '', 'Library', 'Caches', 'ms-playwright');
        default:
            return path.join(process.env.HOME ?? '', '.cache', 'ms-playwright');
    }
}
/** Returns the path to the Chromium executable if it exists, otherwise null. */
function findChromiumExecutable() {
    const browsersPath = getPlaywrightBrowsersPath();
    if (!fs.existsSync(browsersPath))
        return null;
    let dirs;
    try {
        dirs = fs.readdirSync(browsersPath).filter(d => d.startsWith('chromium'));
    }
    catch {
        return null;
    }
    for (const dir of dirs) {
        // Check platform-specific executable paths
        const candidates = process.platform === 'win32'
            ? [
                path.join(browsersPath, dir, 'chrome-win64', 'chrome.exe'),
                path.join(browsersPath, dir, 'chrome-win', 'chrome.exe'),
            ]
            : process.platform === 'darwin'
                ? [
                    path.join(browsersPath, dir, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
                ]
                : [
                    path.join(browsersPath, dir, 'chrome-linux', 'chrome'),
                ];
        for (const exe of candidates) {
            if (fs.existsSync(exe))
                return exe;
        }
    }
    return null;
}
function getPlaywrightBin() {
    // Try the local node_modules/.bin/playwright first
    const binDir = path.join(__dirname, '..', '..', 'node_modules', '.bin');
    const localBin = process.platform === 'win32'
        ? path.join(binDir, 'playwright.cmd')
        : path.join(binDir, 'playwright');
    if (fs.existsSync(localBin)) {
        return { bin: localBin, args: ['install', 'chromium'] };
    }
    // Fall back to npx
    const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    return { bin: npx, args: ['playwright', 'install', 'chromium'] };
}
function ensurePlaywrightChromium() {
    const exe = findChromiumExecutable();
    if (exe) {
        console.log(`[Playwright] Chromium found at: ${exe}`);
        return;
    }
    console.log('[Playwright] Chromium executable not found — running `playwright install chromium`...');
    const { bin, args } = getPlaywrightBin();
    // On Windows, .cmd files need to be executed via cmd /c
    const isWindows = process.platform === 'win32';
    const finalBin = isWindows && bin.endsWith('.cmd') ? 'cmd' : bin;
    const finalArgs = isWindows && bin.endsWith('.cmd') ? ['/c', bin, ...args] : args;
    (0, child_process_1.execFile)(finalBin, finalArgs, { timeout: 5 * 60 * 1000, shell: true }, (err, stdout, stderr) => {
        if (err) {
            console.error('[Playwright] Failed to install Chromium:', err.message);
            if (stderr)
                console.error('[Playwright] stderr:', stderr.trim());
            return;
        }
        if (stdout)
            console.log('[Playwright] install output:', stdout.trim());
        console.log('[Playwright] Chromium installed successfully.');
    });
}
