import { ipcMain } from 'electron';
import { toolSettingsStore, ToolSettingsConfig } from '../store/tool-settings';
import { getAvailableBrowsers } from '../lib/browser-detector';
import { openNavisDebugBrowser } from '../agent/tools/navis/session';
import { getNavisCompanionStatus, prepareNavisMainProfileExtension } from '../agent/tools/navis/companion-extension';

export function registerToolSettingsHandlers(): void {
  ipcMain.handle('tool-settings:get', () => toolSettingsStore.get());
  ipcMain.handle('tool-settings:set', (_e, config: ToolSettingsConfig) => {
    toolSettingsStore.set(config);
    return { success: true };
  });
  ipcMain.handle('tool-settings:get-browsers', async () => {
    return await getAvailableBrowsers();
  });
  ipcMain.handle('debug:open-browser', async () => {
    const config = toolSettingsStore.get();
    return await openNavisDebugBrowser(config.navis.selectedBrowserId || 'chrome');
  });
  ipcMain.handle('navis-extension:prepare-main-profile', async (_event, startUrl?: string) => {
    const config = toolSettingsStore.get();
    return await prepareNavisMainProfileExtension(config.navis.selectedBrowserId || 'chrome', startUrl);
  });
  ipcMain.handle('navis-extension:status', async () => {
    return getNavisCompanionStatus();
  });
}
