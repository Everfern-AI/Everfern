import { autoUpdater } from 'electron-updater';
import log from 'electron-log';
import { BrowserWindow, ipcMain } from 'electron';

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
  });
  
  autoUpdater.on('update-available', (info) => {
    log.info('[Updater] Update available.', info);
    mainWindow.webContents.send('update-available', info);
  });
  
  autoUpdater.on('update-not-available', (info) => {
    log.info('[Updater] Update not available.', info);
  });
  
  autoUpdater.on('error', (err) => {
    log.error('[Updater] Error in auto-updater. ' + err);
    mainWindow.webContents.send('update-error', err?.message || 'Unknown error');
  });
  
  autoUpdater.on('download-progress', (progressObj) => {
    log.info(`[Updater] Download progress: ${progressObj.percent.toFixed(2)}%`);
    mainWindow.webContents.send('download-progress', progressObj);
  });
  
  autoUpdater.on('update-downloaded', (info) => {
    log.info('[Updater] Update downloaded.', info);
    mainWindow.webContents.send('update-downloaded', info);
  });

  // Listen for renderer confirming restart and update
  ipcMain.on('restart-and-update', () => {
    log.info('[Updater] Received restart-and-update from renderer. Quitting and installing...');
    autoUpdater.quitAndInstall(false, true); // (isSilent, isForceRunAfter)
  });

  // Check for updates
  try {
    autoUpdater.checkForUpdatesAndNotify();
  } catch (error) {
    log.error('[Updater] Failed to check for updates on startup:', error);
  }
}
