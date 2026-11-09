/**
 * Native Sheets app persistence.
 *
 *  sheets:load (workerId)        → the workbook JSON for that worker
 *  sheets:save (workerId, data)  → persist edits made in the renderer
 */

import { ipcMain } from 'electron';
import { loadSheet, saveSheet } from '../../agent/tools/sheets-store';

const safeId = (id: unknown) => (typeof id === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(id) ? id : null);

export function registerSheetHandlers(): void {
  ipcMain.handle('sheets:load', (_e, workerId: string) => {
    const id = safeId(workerId);
    if (!id) return null;
    return loadSheet(id);
  });

  ipcMain.handle('sheets:save', (_e, workerId: string, data: unknown) => {
    const id = safeId(workerId);
    if (!id || !data || typeof data !== 'object') return { success: false };
    return { success: true, data: saveSheet(id, data as any) };
  });
}
