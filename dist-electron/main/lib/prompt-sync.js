"use strict";
/**
 * Prompt Synchronization System
 *
 * Ensures that prompts from main/agent/prompts/ are synchronized to ~/.everfern/prompts/
 * and kept up-to-date with runtime updates.
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
exports.syncAllPrompts = syncAllPrompts;
exports.loadPrompt = loadPrompt;
exports.getPromptPath = getPromptPath;
exports.checkPromptStatus = checkPromptStatus;
exports.initializePromptSync = initializePromptSync;
exports.watchPrompts = watchPrompts;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const crypto = __importStar(require("crypto"));
const PROMPTS_SOURCE_DIR = (() => {
    // Try several candidates for the prompts source directory
    const candidates = [
        // 1. Production (dist-electron/main/lib -> dist-electron/main/agent/prompts)
        path.join(__dirname, '../agent/prompts'),
        // 2. Development (apps/desktop/main/lib -> apps/desktop/main/agent/prompts)
        path.join(__dirname, '../../main/agent/prompts'),
        // 3. Absolute project root fallback
        path.join(process.cwd(), 'main/agent/prompts'),
        path.join(process.cwd(), 'apps/desktop/main/agent/prompts'),
    ];
    for (const cand of candidates) {
        if (fs.existsSync(cand)) {
            console.log(`[PromptSync] 📍 Found prompt source: ${cand}`);
            return cand;
        }
    }
    console.error(`[PromptSync] ❌ CRITICAL: Could not find prompt source directory! Checked: ${candidates.join(', ')}`);
    return candidates[0]; // Return default and hope for the best
})();
const PROMPTS_TARGET_DIR = path.join(os.homedir(), '.everfern', 'prompts');
/**
 * Calculate MD5 hash of file content
 */
function calculateFileHash(filePath) {
    if (!fs.existsSync(filePath)) {
        return '';
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    return crypto.createHash('md5').update(content).digest('hex');
}
/**
 * Ensure target directory exists
 */
function ensureTargetDirectory() {
    if (!fs.existsSync(PROMPTS_TARGET_DIR)) {
        fs.mkdirSync(PROMPTS_TARGET_DIR, { recursive: true });
        console.log(`[PromptSync] Created prompts directory: ${PROMPTS_TARGET_DIR}`);
    }
}
/**
 * Get all prompt files from source directory
 */
function getPromptFiles() {
    if (!fs.existsSync(PROMPTS_SOURCE_DIR)) {
        console.warn(`[PromptSync] Source directory not found: ${PROMPTS_SOURCE_DIR}`);
        return [];
    }
    return fs.readdirSync(PROMPTS_SOURCE_DIR)
        .filter(file => file.endsWith('.md'))
        .sort();
}
/**
 * Check if a prompt file needs synchronization
 */
function checkPromptSync(filename) {
    const sourcePath = path.join(PROMPTS_SOURCE_DIR, filename);
    const targetPath = path.join(PROMPTS_TARGET_DIR, filename);
    const sourceHash = calculateFileHash(sourcePath);
    const targetHash = calculateFileHash(targetPath);
    const needsUpdate = sourceHash !== targetHash || !fs.existsSync(targetPath);
    return {
        filename,
        sourceHash,
        targetHash: targetHash || undefined,
        lastSync: fs.existsSync(targetPath) ? fs.statSync(targetPath).mtime : new Date(0),
        needsUpdate
    };
}
/**
 * Synchronize a single prompt file
 */
function syncPromptFile(filename) {
    try {
        const sourcePath = path.join(PROMPTS_SOURCE_DIR, filename);
        const targetPath = path.join(PROMPTS_TARGET_DIR, filename);
        if (!fs.existsSync(sourcePath)) {
            console.warn(`[PromptSync] Source file not found: ${sourcePath}`);
            return false;
        }
        // Ensure target directory exists before writing
        ensureTargetDirectory();
        const content = fs.readFileSync(sourcePath, 'utf-8');
        fs.writeFileSync(targetPath, content, 'utf-8');
        console.log(`[PromptSync] ✅ Synchronized: ${filename}`);
        return true;
    }
    catch (error) {
        console.error(`[PromptSync] ❌ Failed to sync ${filename}:`, error);
        return false;
    }
}
/**
 * Synchronize all prompt files
 */
function syncAllPrompts(forceSync = false) {
    console.log('[PromptSync] 🔄 Starting prompt synchronization...');
    ensureTargetDirectory();
    const promptFiles = getPromptFiles();
    const syncResults = [];
    if (promptFiles.length === 0) {
        console.warn('[PromptSync] No prompt files found to synchronize');
        return syncResults;
    }
    let syncedCount = 0;
    let skippedCount = 0;
    for (const filename of promptFiles) {
        const syncInfo = checkPromptSync(filename);
        syncResults.push(syncInfo);
        // Force sync always updates, otherwise only sync if needsUpdate
        const shouldSync = forceSync || syncInfo.needsUpdate;
        if (shouldSync) {
            const success = syncPromptFile(filename);
            if (success) {
                syncedCount++;
                syncInfo.needsUpdate = false;
                syncInfo.lastSync = new Date();
            }
        }
        else {
            console.log(`[PromptSync] ⏭️  Skipped (up-to-date): ${filename}`);
            skippedCount++;
        }
    }
    console.log(`[PromptSync] ✅ Synchronization complete: ${syncedCount} synced, ${skippedCount} skipped`);
    return syncResults;
}
/**
 * Load a prompt from the synchronized directory
 */
function loadPrompt(filename) {
    const targetPath = path.join(PROMPTS_TARGET_DIR, filename);
    if (!fs.existsSync(targetPath)) {
        console.warn(`[PromptSync] Prompt not found: ${filename}, attempting sync...`);
        // Try to sync this specific file
        const syncInfo = checkPromptSync(filename);
        if (syncInfo.needsUpdate) {
            const success = syncPromptFile(filename);
            if (!success) {
                // Sync failed — try reading directly from source as fallback
                try {
                    const sourcePath = path.join(PROMPTS_SOURCE_DIR, filename);
                    if (fs.existsSync(sourcePath)) {
                        const content = fs.readFileSync(sourcePath, 'utf-8');
                        console.log(`[PromptSync] 📖 Loaded prompt from source (sync failed): ${filename} (${content.length} chars)`);
                        return content;
                    }
                }
                catch (_) { /* ignore */ }
                return null;
            }
        }
    }
    try {
        const content = fs.readFileSync(targetPath, 'utf-8');
        console.log(`[PromptSync] 📖 Loaded prompt: ${filename} (${content.length} chars)`);
        return content;
    }
    catch (error) {
        console.error(`[PromptSync] Failed to load prompt ${filename}:`, error);
        // Last-resort fallback: try reading directly from source directory
        try {
            const sourcePath = path.join(PROMPTS_SOURCE_DIR, filename);
            if (fs.existsSync(sourcePath)) {
                const content = fs.readFileSync(sourcePath, 'utf-8');
                console.log(`[PromptSync] 📖 Loaded prompt from source fallback: ${filename} (${content.length} chars)`);
                return content;
            }
        }
        catch (_) { /* ignore */ }
        return null;
    }
}
/**
 * Get the path to a synchronized prompt file
 */
function getPromptPath(filename) {
    return path.join(PROMPTS_TARGET_DIR, filename);
}
/**
 * Check if prompts need synchronization (without syncing)
 */
function checkPromptStatus() {
    const promptFiles = getPromptFiles();
    return promptFiles.map(filename => checkPromptSync(filename));
}
/**
 * Initialize prompt synchronization on startup
 * Always syncs prompts to ensure the latest version is loaded
 */
function initializePromptSync(forceSync = false) {
    console.log('[PromptSync] 🚀 Initializing prompt synchronization system...');
    try {
        const results = syncAllPrompts(forceSync);
        const needsUpdate = results.filter(r => r.needsUpdate).length;
        if (needsUpdate === 0) {
            console.log('[PromptSync] ✅ All prompts are up-to-date');
        }
        else {
            console.log(`[PromptSync] ⚠️  ${needsUpdate} prompts needed updates`);
        }
    }
    catch (error) {
        console.error('[PromptSync] ❌ Failed to initialize prompt sync:', error);
    }
}
/**
 * Watch for changes and auto-sync (for development)
 */
function watchPrompts() {
    if (!fs.existsSync(PROMPTS_SOURCE_DIR)) {
        console.warn('[PromptSync] Cannot watch prompts - source directory not found');
        return;
    }
    console.log('[PromptSync] 👀 Watching for prompt changes...');
    fs.watch(PROMPTS_SOURCE_DIR, { recursive: false }, (eventType, filename) => {
        if (filename && filename.endsWith('.md')) {
            console.log(`[PromptSync] 📝 Detected change in ${filename}, syncing...`);
            setTimeout(() => {
                const syncInfo = checkPromptSync(filename);
                if (syncInfo.needsUpdate) {
                    syncPromptFile(filename);
                }
            }, 100); // Small delay to ensure file write is complete
        }
    });
}
