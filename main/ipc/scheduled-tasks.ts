/**
 * EverFern Desktop — Scheduled Tasks IPC Handlers
 */

import { ipcMain } from 'electron';
import { scheduledTasksStore } from '../store/scheduled-tasks';

export function setupScheduledTasksIPC() {
  ipcMain.handle('scheduled-tasks:list', async (_event, projectId?: string) => {
    try {
      return await scheduledTasksStore.list(projectId);
    } catch (err) {
      console.error('[IPC] Failed to list scheduled tasks:', err);
      return [];
    }
  });

  ipcMain.handle('scheduled-tasks:get', async (_event, id: string) => {
    try {
      return await scheduledTasksStore.get(id);
    } catch (err) {
      console.error(`[IPC] Failed to get scheduled task ${id}:`, err);
      return null;
    }
  });

  ipcMain.handle('scheduled-tasks:save', async (_event, task: any) => {
    try {
      return await scheduledTasksStore.save(task);
    } catch (err) {
      console.error('[IPC] Failed to save scheduled task:', err);
      throw err;
    }
  });

  ipcMain.handle('scheduled-tasks:delete', async (_event, id: string) => {
    try {
      await scheduledTasksStore.delete(id);
      return { success: true };
    } catch (err) {
      console.error(`[IPC] Failed to delete scheduled task ${id}:`, err);
      return { success: false, error: String(err) };
    }
  });
}
