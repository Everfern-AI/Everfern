import { ipcMain } from 'electron';
import { CommandRegistry } from '../agent/tools/terminal/registry';

let permissionsGranted = false;

export function isPermissionGranted() {
  return permissionsGranted;
}

export function registerTerminalProcessHandlers() {
  ipcMain.handle('permissions:grant', () => {
    permissionsGranted = true;
    return { success: true };
  });

  ipcMain.handle('permissions:status', () => {
    return { granted: permissionsGranted };
  });

  ipcMain.handle('terminal:list-processes', () => {
    const registry = CommandRegistry.getInstance();
    return registry.listCommands();
  });

  ipcMain.handle('terminal:kill-process', (_event, id: string) => {
    const registry = CommandRegistry.getInstance();
    return { success: registry.terminate(id) };
  });
}
