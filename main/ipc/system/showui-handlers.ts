import { ipcMain } from 'electron';

/**
 * ShowUI install/launch bridges existed in preload since the first commit
 * (f13.A census: renderer setup page invokes showui.install() unguarded),
 * but no main-side handlers were ever registered — the invoke rejected with
 * "No handler registered". Until a real installer implementation lands,
 * these handlers keep the documented bridge contract
 * (Promise<{ success: boolean; showuiDir?: string; error?: string }>)
 * so the setup page's error path renders instead of throwing.
 */
export function registerShowuiHandlers(): void {
  ipcMain.handle('showui:install', async () => {
    return { success: false, error: 'ShowUI installer is not available in this build.' };
  });

  ipcMain.handle('showui:launch', async () => {
    return { success: false, error: 'ShowUI is not installed.' };
  });
}
