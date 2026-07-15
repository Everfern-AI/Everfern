import { autoUpdater } from 'electron-updater';
import log from 'electron-log';
import { BrowserWindow, ipcMain } from 'electron';

// Track the current update status to allow newly mounted windows to fetch it
export const updateStatus = {
  status: 'idle' as 'idle' | 'available' | 'downloading' | 'downloaded' | 'error',
  version: '',
  progress: null as { percent: number } | null,
  errorMsg: null as string | null
};

export function initializeUpdater(mainWindow: BrowserWindow) {
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
    mainWindow.webContents.send('update-available', info);
  });
  
  autoUpdater.on('update-not-available', (info) => {
    log.info('[Updater] Update not available.', info);
    updateStatus.status = 'idle';
  });
  
  autoUpdater.on('error', (err) => {
    log.error('[Updater] Error in auto-updater. ' + err);
    updateStatus.status = 'error';
    updateStatus.errorMsg = err?.message || 'Unknown error';
    mainWindow.webContents.send('update-error', err?.message || 'Unknown error');
  });
  
  autoUpdater.on('download-progress', (progressObj) => {
    log.info(`[Updater] Download progress: ${progressObj.percent.toFixed(2)}%`);
    updateStatus.status = 'downloading';
    updateStatus.progress = progressObj;
    mainWindow.webContents.send('download-progress', progressObj);
  });
  
  autoUpdater.on('update-downloaded', (info) => {
    log.info('[Updater] Update downloaded.', info);
    updateStatus.status = 'downloaded';
    updateStatus.version = info.version || '';
    updateStatus.progress = null;
    mainWindow.webContents.send('update-downloaded', info);
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
  try {
    autoUpdater.checkForUpdatesAndNotify();
  } catch (error) {
    log.error('[Updater] Failed to check for updates on startup:', error);
  }
}
