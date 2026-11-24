/**
 * Native Sheets app persistence.
 *
 *  sheets:load (workerId)        → the workbook JSON for that worker
 *  sheets:save (workerId, data)  → persist edits made in the renderer
 */

import { ipcMain } from 'electron';
import { loadSheet, saveSheet } from '../../agent/tools/sheets-store';
import { webSearchTool, cancelWebSearch } from '../../agent/tools/web-search';

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

  // The native Search app: a search the user types runs the same web_search
  // engine the AI uses, without the cursor replay.
  // The Search app's Stop button: one search by id, or (no id) every search the AI has in flight.
  ipcMain.handle('search:cancel', (_e, id?: unknown) => ({ stopped: cancelWebSearch(typeof id === 'string' && id ? id : undefined) }));

  ipcMain.handle('search:query', async (_e, query: unknown, reqId?: unknown) => {
    const q = typeof query === 'string' ? query.trim().slice(0, 500) : '';
    if (q.length < 2) return { results: [], error: 'Type at least two characters.' };
    const searchId = typeof reqId === 'string' && /^[\w-]{1,64}$/.test(reqId) ? reqId : undefined;
    const r = await webSearchTool.execute({ query: q, _fromApp: true, _searchId: searchId });
    if (r.error === 'cancelled') return { results: [], cancelled: true };
    const data = (r.data ?? {}) as { results?: Array<{ title: string; url: string; snippet: string }> };
    return {
      results: (data.results ?? []).map((x) => ({ title: x.title, url: x.url, snippet: x.snippet })),
      error: r.success ? undefined : r.output.replace(/^\W+/, ''),
    };
  });
}
