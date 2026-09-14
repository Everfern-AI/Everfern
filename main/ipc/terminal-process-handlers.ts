import { BrowserWindow, dialog, ipcMain } from 'electron';
import { CommandRegistry } from '../agent/tools/terminal/registry';
import { isPermissionGranted, grantComputerUsePermission } from './computer-use-permission';

export { isPermissionGranted };

export function registerTerminalProcessHandlers() {
  // MP-SEC-15: the renderer cannot self-grant computer-use permission. The
  // grant only takes effect after the user confirms a native dialog owned by
  // the main process (native prompt = OS-level user gesture).
  ipcMain.handle('permissions:grant', async () => {
    const focused = BrowserWindow.getFocusedWindow();
    const parent = focused && !focused.isDestroyed() ? focused : BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
    const choice = await dialog.showMessageBox(parent!, {
      type: 'warning',
      title: 'Everfern — Computer Use',
      message: 'Grant Computer Use permission?',
      detail:
        'This allows the assistant to control mouse and keyboard on this machine. Only grant this if you initiated it.',
      buttons: ['Grant', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    if (choice.response === 0) {
      grantComputerUsePermission();
      return { success: true, granted: true };
    }
    return { success: true, granted: false };
  });

  ipcMain.handle('permissions:status', () => {
    return { granted: isPermissionGranted() };
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
