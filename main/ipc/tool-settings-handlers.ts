import { ipcMain } from 'electron';
import { toolSettingsStore, ToolSettingsConfig } from '../store/tool-settings';
import { getAvailableBrowsers } from '../lib/browser-detector';

export function registerToolSettingsHandlers(): void {
  ipcMain.handle('tool-settings:get', () => toolSettingsStore.get());
  ipcMain.handle('tool-settings:set', (_e, config: ToolSettingsConfig) => {
    toolSettingsStore.set(config);
    return { success: true };
  });
  ipcMain.handle('tool-settings:get-browsers', async () => {
    return await getAvailableBrowsers();
  });
}
