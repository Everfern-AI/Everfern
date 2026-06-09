import { ipcMain } from 'electron';
import { projectsStore } from '../store/projects/projects';

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

export function registerProjectsHandlers() {
  ipcMain.handle('projects:list', async () => {
    return projectsStore.list();
  });

  ipcMain.handle('projects:create', async (_event, data: { name: string; instructions?: string; path: string }) => {
    return projectsStore.create(data);
  });

  ipcMain.handle('projects:delete', async (_event, id: string) => {
    return projectsStore.delete(id);
  });

  ipcMain.handle('projects:getDefaultPath', async () => {
    const { app } = require('electron');
    const path = require('path');
    return path.join(app.getPath('documents'), 'Everfern', 'Projects');
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
    const path = require('path');
    const fullPath = path.join(projectPath, filePath);
    try {
      return fs.readFileSync(fullPath, 'utf-8');
    } catch {
      return null;
    }
  });

  ipcMain.handle('projects:readFileDataUrl', async (_event, projectPath: string, filePath: string) => {
    const fs = require('fs');
    const path = require('path');
    const fullPath = path.join(projectPath, filePath);
    const maxPreviewBytes = 32 * 1024 * 1024;
    try {
      const stat = fs.statSync(fullPath);
      if (!stat.isFile()) return { success: false, error: 'Path is not a file' };
      if (stat.size > maxPreviewBytes) {
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
