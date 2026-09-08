import { ipcMain, BrowserWindow } from 'electron';

/**
 * MP-LIFE-04: overlay windows (voice/computer) must never be shown/focused on a
 * dispatch command — only the main window should surface the command.
 * main.ts maintains (global as any).mainWindow (nulled on close).
 */
function getMainWindow(): BrowserWindow | null {
  const g = globalThis as any;
  const win = g?.mainWindow;
  if (win && !win.isDestroyed()) {
    return win as BrowserWindow;
  }

  // Fallback: first non-destroyed window that is not an overlay
  // (overlays are identified by their URL containing 'voice' or 'computer').
  try {
    const nonOverlay = BrowserWindow.getAllWindows().find(w => {
      try {
        if (!w || w.isDestroyed()) return false;
        const url = w.webContents?.getURL?.() || '';
        return !url.includes('voice') && !url.includes('computer');
      } catch {
        return false;
      }
    });
    if (nonOverlay) return nonOverlay;
  } catch {
    // BrowserWindow.getAllWindows unavailable — fall through
  }

  console.warn('[IPC] No main window available for dispatch command');
  return null;
}

/**
 * MP-LIFE-04: show/focus ONLY the main window and send the dispatch command
 * ONLY to it. Previously every window (incl. voice/computer overlays) was
 * shown → overlay flicker + focus steal.
 */
function dispatchCommandToMainWindow(command: string, model?: string): void {
  const mainWin = getMainWindow();
  if (!mainWin) return;

  try {
    if (mainWin.isMinimized()) {
      mainWin.restore();
    }
    mainWin.show();
    mainWin.focus();
    mainWin.webContents.send('system:dispatch-command', { command, model });
  } catch (err) {
    console.error('[IPC] Failed to deliver dispatch command to main window:', err);
  }
}

export function registerDispatchHandlers(): void {
  ipcMain.handle('system:start-dispatch', async (event, config: { sessionId: string, pinCode: string, url: string, apiUrl: string, key: string, token: string, userId: string, isForever?: boolean }) => {
    try {
      const { DispatchService } = await import('../../lib/dispatch');
      const service = DispatchService.getInstance();

      service.onCommand = (command: string, model?: string) => {
        dispatchCommandToMainWindow(command, model);
      };

      await service.initialize(config, () => {
        event.sender.send('system:dispatch-active');
      });
      return { success: true };
    } catch (err: any) {
      console.error('[IPC] system:start-dispatch error:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('system:restore-dispatch', async (event, config: { url: string, apiUrl: string, key: string, token: string, userId: string }) => {
    try {
      const { DispatchService } = await import('../../lib/dispatch');
      const service = DispatchService.getInstance();

      service.onCommand = (command: string, model?: string) => {
        dispatchCommandToMainWindow(command, model);
      };

      await service.initialize({ ...config, sessionId: '', pinCode: '' }, () => {
        event.sender.send('system:dispatch-active');
      });
      return await service.restoreSession();
    } catch (err: any) {
      console.error('[IPC] system:restore-dispatch error:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('system:stop-dispatch', async () => {
    try {
      const { DispatchService } = await import('../../lib/dispatch');
      await DispatchService.getInstance().disconnect();
      return { success: true };
    } catch (err: any) {
      console.error('[IPC] system:stop-dispatch error:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('system:broadcast-dispatch', async (_event, { event, data }: { event: string; data: any }) => {
    try {
      const { DispatchService } = await import('../../lib/dispatch');
      DispatchService.getInstance().broadcastToWeb(event, data);
    } catch (err) {
      console.error('[IPC] system:broadcast-dispatch error:', err);
    }
  });
}
