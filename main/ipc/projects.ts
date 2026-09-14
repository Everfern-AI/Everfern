import { ipcMain } from 'electron';
import { projectsStore } from '../store/projects/projects';
import { resolveWithin } from '../lib/path-guard';

/**
 * Maps a file extension (with or without a leading dot) to a MIME type,
 * defaulting to application/octet-stream for unknown extensions.
 */
function mimeFromExt(ext: string): string {
  const clean = ext.replace(/^\./, '').toLowerCase();
  const map: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    avif: 'image/avif',
    ico: 'image/x-icon',
    pdf: 'application/pdf',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    m4a: 'audio/mp4',
    mp4: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
  };
  return map[clean] || 'application/octet-stream';
}

/**
 * Registers all projects:* IPC handlers: CRUD against the projects store,
 * folder/file pickers, and sandboxed file reads within a project directory.
 * Side effect: installs ipcMain.handle listeners; must be called exactly once.
 */
export function registerProjectsHandlers() {
  ipcMain.handle('projects:list', async () => {
    return projectsStore.list();
  });

  ipcMain.handle('projects:create', async (_event, data: { name: string; instructions?: string; path: string }) => {
    return projectsStore.create(data);
  });

  ipcMain.handle('projects:update', async (_event, id: string, updates: any) => {
    return projectsStore.update(id, updates);
  });

  ipcMain.handle('projects:toggleBookmark', async (_event, id: string) => {
    return projectsStore.toggleBookmark(id);
  });

  ipcMain.handle('projects:openFolder', async (_event, folderPath: string) => {
    const { shell } = require('electron');
    if (folderPath) {
      shell.openPath(folderPath);
      return { success: true };
    }
    return { success: false, error: 'No path provided' };
  });

  ipcMain.handle('projects:delete', async (_event, id: string) => {
    return projectsStore.delete(id);
  });

  ipcMain.handle('projects:getDefaultPath', async () => {
    const { app } = require('electron');
    const path = require('path');
    return path.join(app.getPath('documents'), 'Everfern', 'Projects');
  });

  ipcMain.handle('projects:getEverfernPath', async () => {
    const os = require('os');
    const path = require('path');
    return path.join(os.homedir(), '.everfern');
  });

  ipcMain.handle('projects:selectFolder', async () => {
    const { dialog } = require('electron');
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory']
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('projects:selectFiles', async () => {
    const { dialog } = require('electron');
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections']
    });
    if (result.canceled || result.filePaths.length === 0) return [];
    return result.filePaths;
  });

  ipcMain.handle('projects:listFiles', async (_event, projectPath: string) => {
    const fs = require('fs');
    const path = require('path');
    const results: string[] = [];

    /**
     * Depth-first walk collecting relative file paths; skips dot-directories
     * and node_modules so the listing stays bounded and relevant.
     */
    function walk(dir: string, relativePath: string = '') {
      let entries: string[];
      try {
        entries = fs.readdirSync(dir);
      } catch {
        return;
      }
      for (const entry of entries) {
        const fullPath = path.join(dir, entry);
        const relPath = relativePath ? path.join(relativePath, entry) : entry;
        try {
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            if (!entry.startsWith('.') && entry !== 'node_modules') {
              walk(fullPath, relPath);
            }
          } else {
            results.push(relPath);
          }
        } catch {
          // skip files we can't stat
        }
      }
    }

    if (projectPath) {
      walk(projectPath);
    }

    return { files: results.sort() };
  });

  ipcMain.handle('projects:readFile', async (_event, projectPath: string, filePath: string) => {
    const fs = require('fs');
    try {
      // Security: resolve the project root to its physical (symlink-free)
      // location before containment checks — a symlinked root would let
      // resolveWithin compare against a fake prefix and approve escapes.
      const root = fs.realpathSync(projectPath);
      const fullPath = resolveWithin(root, filePath);
      return fs.readFileSync(fullPath, 'utf-8');
    } catch {
      return null;
    }
  });

  ipcMain.handle('projects:readFileDataUrl', async (_event, projectPath: string, filePath: string) => {
    const fs = require('fs');
    const path = require('path');
    const maxPreviewBytes = 32 * 1024 * 1024;
    try {
      // Security: realpath the root (and let resolveWithin realpath the
      // target) so symlinks planted inside the project cannot redirect the
      // read outside it; unresolvable paths fail closed.
      const root = fs.realpathSync(projectPath);
      let fullPath: string;
      try {
        fullPath = resolveWithin(root, filePath);
      } catch {
        return { success: false, error: 'Invalid file path' };
      }
      const stat = fs.statSync(fullPath);
      if (!stat.isFile()) return { success: false, error: 'Path is not a file' };
      if (stat.size > maxPreviewBytes) {
        // 32 MB cap: the whole file is base64-inlined into the IPC payload,
        // so an unbounded read would balloon renderer memory (~1.37x size).
        return { success: false, error: 'File is too large to preview inline', size: stat.size };
      }
      const ext = path.extname(fullPath);
      const mimeType = mimeFromExt(ext);
      const base64 = fs.readFileSync(fullPath).toString('base64');
      return {
        success: true,
        mimeType,
        size: stat.size,
        dataUrl: `data:${mimeType};base64,${base64}`,
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });
}
