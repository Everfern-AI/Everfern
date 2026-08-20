import { ipcMain } from 'electron';

export function registerDispatchHandlers(): void {
  ipcMain.handle('system:start-dispatch', async (event, config: { sessionId: string, pinCode: string, url: string, apiUrl: string, key: string, token: string, userId: string, isForever?: boolean }) => {
    try {
      const { DispatchService } = await import('../../lib/dispatch');
      const service = DispatchService.getInstance();

      service.onCommand = (command: string, model?: string) => {
        import('electron').then(({ BrowserWindow }) => {
          BrowserWindow.getAllWindows().forEach(win => {
            if (!win.isDestroyed()) {
              win.show();
              win.webContents.send('system:dispatch-command', { command, model });
            }
          });
        });
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
        import('electron').then(({ BrowserWindow }) => {
          BrowserWindow.getAllWindows().forEach(win => {
            if (!win.isDestroyed()) {
              win.show();
              win.webContents.send('system:dispatch-command', { command, model });
            }
          });
        });
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
