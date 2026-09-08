import { ipcMain } from 'electron';
import * as os from 'os';
import * as path from 'path';
import { getAppsForFile, getFileAppCacheStatus, openFileWithApp, preloadFileAppCache } from '../lib/file-associations';

function expandTilde(p: string): string {
  if (p.startsWith('~/') || p === '~') {
    return path.join(os.homedir(), p.slice(1));
  }
  return p;
}

export function registerFileAssociationHandlers(): void {
  void preloadFileAppCache();

  // Get all apps that can open a given file path (returns FileApp[])
  ipcMain.handle('system:get-file-apps', async (_e, filePath: string) => {
    try {
      return await getAppsForFile(expandTilde(filePath));
    } catch (err: any) {
      console.error('[FileAssociations] get-file-apps error:', err);
      return [];
    }
  });

  // Open a file with the default or specified app
  ipcMain.handle('system:open-file', async (_e, filePath: string, appPath?: string) => {
    try {
      await openFileWithApp(expandTilde(filePath), appPath);
      return { success: true };
    } catch (err: any) {
      console.error('[FileAssociations] open-file error:', err);
      return { success: false, error: err.message };
    }
  });

  // f13.A census: reveal the file's parent folder in the OS file manager
  // (Finder/Explorer); previously the preload bridge/handler were missing so
  // FileArtifact's "Show in Finder" silently no-opped.
  ipcMain.handle('system:show-item-in-folder', async (_e, filePath: string) => {
    try {
      const { shell } = require('electron') as typeof import('electron');
      shell.showItemInFolder(expandTilde(filePath));
    } catch (err: any) {
      console.error('[FileAssociations] show-item-in-folder error:', err);
    }
  });

  ipcMain.handle('system:get-file-app-cache-status', async () => {
    return getFileAppCacheStatus();
  });
}
