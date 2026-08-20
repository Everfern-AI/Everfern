import { ipcMain, app } from 'electron';

export function registerUpdateHandlers(): void {
  ipcMain.handle('system:check-for-updates', async () => {
    try {
      const { autoUpdater } = require('electron-updater');
      const result = await autoUpdater.checkForUpdates();

      if (result && result.updateInfo && result.updateInfo.version !== app.getVersion()) {
        return {
          hasUpdate: true,
          latestVersion: result.updateInfo.version,
          notes: typeof result.updateInfo.releaseNotes === 'string' ? result.updateInfo.releaseNotes : ''
        };
      }
      return { hasUpdate: false };
    } catch (err) {
      console.error('[UpdateCheck] Failed to check for updates:', err);
      return { hasUpdate: false, error: String(err) };
    }
  });
}
