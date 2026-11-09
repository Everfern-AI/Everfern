import { autoUpdater } from 'electron-updater';
import log from 'electron-log';
import { BrowserWindow, ipcMain } from 'electron';
import { existsSync } from 'fs';
import { join } from 'path';
import { app } from 'electron';

// Track the current update status to allow newly mounted windows to fetch it
export const updateStatus = {
  status: 'idle' as 'idle' | 'available' | 'downloading' | 'downloaded' | 'error',
  version: '',
  progress: null as { percent: number } | null,
  errorMsg: null as string | null
};

// Resolve a live window at send time. The window captured at initialization can be
// destroyed and recreated (e.g. macOS activate path), so always re-resolve.
function getMainWindow(): BrowserWindow | null {
  const globalAny = global as any;
  const candidate: BrowserWindow | undefined = globalAny.mainWindow;
  if (candidate && !candidate.isDestroyed()) return candidate;
  const first = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
  return first ?? null;
}

function safeSend(channel: string, payload: unknown) {
  const win = getMainWindow();
  if (win) {
    try {
      win.webContents.send(channel, payload);
    } catch (err) {
      log.warn(`[Updater] Failed to send ${channel} to renderer:`, err);
    }
  }
}

export function initializeUpdater(mainWindow: BrowserWindow) {
  if (process.env.EVERFERN_SHELL === 'tauri') return; // Rust owns the Tauri updater.
  const bridge = existsSync(join(process.resourcesPath, 'native', 'everfern.exe'));
  if (bridge) {
    autoUpdater.setFeedURL({ provider: 'generic', url: 'https://github.com/Everfern-AI/Everfern/releases/latest/download', channel: 'tauri-transition', useMultipleRangeRequest: false });
    autoUpdater.disableDifferentialDownload = true;
  }
  autoUpdater.logger = log;
  (autoUpdater.logger as any).transports.file.level = 'info';
  
  log.info('[Updater] Initializing auto updater...');

  // Whether to automatically download updates once found
  autoUpdater.autoDownload = true; 
  autoUpdater.autoInstallOnAppQuit = true;
  
  // For development testing, you could uncomment the following line
  // autoUpdater.forceDevUpdateConfig = true;

  autoUpdater.on('checking-for-update', () => {
    log.info('[Updater] Checking for update...');
    updateStatus.status = 'idle';
  });
  
  autoUpdater.on('update-available', (info) => {
    log.info('[Updater] Update available.', info);
    updateStatus.status = 'available';
    updateStatus.version = info.version || '';
    safeSend('update-available', info);
  });
  
  autoUpdater.on('update-not-available', (info) => {
    log.info('[Updater] Update not available.', info);
    updateStatus.status = 'idle';
  });
  
  autoUpdater.on('error', (err) => {
    log.error('[Updater] Error in auto-updater. ' + err);
    updateStatus.status = 'error';
    updateStatus.errorMsg = err?.message || 'Unknown error';
    safeSend('update-error', err?.message || 'Unknown error');
  });
  
  autoUpdater.on('download-progress', (progressObj) => {
    log.info(`[Updater] Download progress: ${progressObj.percent.toFixed(2)}%`);
    updateStatus.status = 'downloading';
    updateStatus.progress = progressObj;
    safeSend('download-progress', progressObj);
  });
  
  autoUpdater.on('update-downloaded', (info) => {
    log.info('[Updater] Update downloaded.', info);
    updateStatus.status = 'downloaded';
    updateStatus.version = info.version || '';
    updateStatus.progress = null;
    safeSend('update-downloaded', info);
  });

  // Listen for renderer confirming restart and update (support both send and invoke)
  const performRestart = () => {
    log.info('[Updater] Received restart-and-update from renderer. Quitting and installing...');
    autoUpdater.quitAndInstall(false, true); // (isSilent, isForceRunAfter)
  };

  ipcMain.on('restart-and-update', performRestart);
  ipcMain.handle('restart-and-update', performRestart);

  ipcMain.handle('system:get-update-status', () => {
    return updateStatus;
  });

  // Check for updates
  const check = () => { try {
    autoUpdater.checkForUpdatesAndNotify()?.catch((error: unknown) => {
      log.error('[Updater] Async update check failed:', error);
    });
  } catch (error) {
    log.error('[Updater] Failed to check for updates on startup:', error);
  } };
  if (bridge) {
    // A fresh installation must export before downloading the framework switch.
    const waitForExport = () => {
      if (existsSync(join(app.getPath('userData'), 'renderer-migration.native'))) check();
      else setTimeout(waitForExport, 2000).unref();
    };
    waitForExport();
  } else check();
}
