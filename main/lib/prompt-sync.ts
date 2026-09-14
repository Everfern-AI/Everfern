/**
 * Prompt Synchronization System
 *
 * Ensures that prompts from main/agent/prompts/ are synchronized to ~/.everfern/prompts/
 * and kept up-to-date with runtime updates.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

function getAppPathSafe(): string | null {
  try {
    const { app } = require('electron');
    if (app && typeof app.getAppPath === 'function') {
      return app.getAppPath();
    }
  } catch (_) {}
  return null;
}

/**
 * Dynamically resolves the prompts source directory across dev and production packaged apps.
 */
export function getPromptsSourceDir(): string {
  const appPath = getAppPathSafe();
  const candidates = [
    // 1. Electron app.getAppPath() candidates (most reliable for packaged app)
    appPath ? path.join(appPath, 'main', 'agent', 'prompts') : '',
    appPath ? path.join(appPath, 'dist-electron', 'main', 'agent', 'prompts') : '',
    // 2. Packaged resources fallback (production exe)
    process.resourcesPath ? path.join(process.resourcesPath, 'prompts') : '',
    process.resourcesPath ? path.join(process.resourcesPath, 'main', 'agent', 'prompts') : '',
    process.resourcesPath ? path.join(process.resourcesPath, 'app.asar.unpacked', 'dist-electron', 'main', 'agent', 'prompts') : '',
    // 3. __dirname resolution relative to compiled output
    path.join(__dirname, '..', 'agent', 'prompts'),
    path.join(__dirname, '..', '..', 'main', 'agent', 'prompts'),
    path.join(__dirname, '..', '..', '..', 'main', 'agent', 'prompts'),
    // 4. Working directory fallbacks
    path.join(process.cwd(), 'main', 'agent', 'prompts'),
    path.join(process.cwd(), 'apps', 'desktop', 'main', 'agent', 'prompts'),
  ].filter(Boolean);

  for (const cand of candidates) {
    try {
      if (fs.existsSync(cand)) {
        return cand;
      }
    } catch (_) {}
  }

  console.error(`[PromptSync] ❌ CRITICAL: Could not find prompt source directory! Checked: ${candidates.join(', ')}`);
  return candidates[0] || path.join(process.cwd(), 'main', 'agent', 'prompts');
}



const PROMPTS_TARGET_DIR = path.join(os.homedir(), '.everfern', 'prompts');

interface PromptSyncInfo {
  filename: string;
  sourceHash: string;
  targetHash?: string;
  lastSync: Date;
  needsUpdate: boolean;
}

/**
 * Calculate MD5 hash of file content
 */
function calculateFileHash(filePath: string): string {
  if (!fs.existsSync(filePath)) {
    return '';
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  return crypto.createHash('md5').update(content).digest('hex');
}

/**
 * Ensure target directory exists
 */
function ensureTargetDirectory(): void {
  if (!fs.existsSync(PROMPTS_TARGET_DIR)) {
    fs.mkdirSync(PROMPTS_TARGET_DIR, { recursive: true });
    console.log(`[PromptSync] Created prompts directory: ${PROMPTS_TARGET_DIR}`);
  }
}

/**
 * Get all prompt files from source directory
 */
function getPromptFiles(): string[] {
  const sourceDir = getPromptsSourceDir();
  if (!fs.existsSync(sourceDir)) {
    console.warn(`[PromptSync] Source directory not found: ${sourceDir}`);
    return [];
  }

  return fs.readdirSync(sourceDir)
    .filter(file => file.endsWith('.md') && file.toLowerCase() !== 'soul.md' && file.toLowerCase() !== 'agents.md')
    .sort();
}

/**
 * Check if a prompt file needs synchronization
 */
function checkPromptSync(filename: string): PromptSyncInfo {
  const sourcePath = path.join(getPromptsSourceDir(), filename);
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
function syncPromptFile(filename: string): boolean {
  try {
    const sourcePath = path.join(getPromptsSourceDir(), filename);
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
  } catch (error) {
    console.error(`[PromptSync] ❌ Failed to sync ${filename}:`, error);
    return false;
  }
}

/**
 * Synchronize all prompt files
 */
export function syncAllPrompts(forceSync: boolean = false): PromptSyncInfo[] {
  console.log('[PromptSync] 🔄 Starting prompt synchronization...');

  ensureTargetDirectory();

  const promptFiles = getPromptFiles();
  const syncResults: PromptSyncInfo[] = [];

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
    } else {
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
export function loadPrompt(filename: string): string | null {
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
          const sourcePath = path.join(getPromptsSourceDir(), filename);
          if (fs.existsSync(sourcePath)) {
            const content = fs.readFileSync(sourcePath, 'utf-8');
            console.log(`[PromptSync] 📖 Loaded prompt from source (sync failed): ${filename} (${content.length} chars)`);
            return content;
          }
        } catch (_) { /* ignore */ }
        return null;
      }
    }
  }

  try {
    const content = fs.readFileSync(targetPath, 'utf-8');
    console.log(`[PromptSync] 📖 Loaded prompt: ${filename} (${content.length} chars)`);
    return content;
  } catch (error) {
    console.error(`[PromptSync] Failed to load prompt ${filename}:`, error);
    // Last-resort fallback: try reading directly from source directory
    try {
      const sourcePath = path.join(getPromptsSourceDir(), filename);
      if (fs.existsSync(sourcePath)) {
        const content = fs.readFileSync(sourcePath, 'utf-8');
        console.log(`[PromptSync] 📖 Loaded prompt from source fallback: ${filename} (${content.length} chars)`);
        return content;
      }
    } catch (_) { /* ignore */ }
    return null;
  }
}

/**
 * Get the path to a synchronized prompt file
 */
export function getPromptPath(filename: string): string {
  return path.join(PROMPTS_TARGET_DIR, filename);
}

/**
 * Check if prompts need synchronization (without syncing)
 */
export function checkPromptStatus(): PromptSyncInfo[] {
  const promptFiles = getPromptFiles();
  return promptFiles.map(filename => checkPromptSync(filename));
}

/**
 * Initialize prompt synchronization on startup
 * Always syncs prompts to ensure the latest version is loaded
 */
export function initializePromptSync(forceSync: boolean = false): void {
  console.log('[PromptSync] 🚀 Initializing prompt synchronization system...');

  try {
    const results = syncAllPrompts(forceSync);
    const needsUpdate = results.filter(r => r.needsUpdate).length;

    if (needsUpdate === 0) {
      console.log('[PromptSync] ✅ All prompts are up-to-date');
    } else {
      console.log(`[PromptSync] ⚠️  ${needsUpdate} prompts needed updates`);
    }
  } catch (error) {
    console.error('[PromptSync] ❌ Failed to initialize prompt sync:', error);
  }
}

/**
 * Watch for changes and auto-sync (for development)
 */
export function watchPrompts(): void {
  const sourceDir = getPromptsSourceDir();
  if (!fs.existsSync(sourceDir)) {
    console.warn('[PromptSync] Cannot watch prompts - source directory not found');
    return;
  }

  console.log('[PromptSync] 👀 Watching for prompt changes...');

  fs.watch(sourceDir, { recursive: false }, (eventType, filename) => {
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

