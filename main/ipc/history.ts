import { ipcMain } from 'electron';
import { ChatHistoryStore } from '../store/history';
import { listHitlRecords, saveHitlResponse } from '../store/hitl';

export function registerHistoryHandlers(historyStore: ChatHistoryStore) {
  ipcMain.handle('history:list', async () => {
    return await historyStore.list();
  });

  ipcMain.handle('history:load', async (_event, id: string) => {
    const conv = await historyStore.load(id);
    return conv ?? { error: 'Not found' };
  });

  ipcMain.handle('history:save', async (_event, conv) => {
    return await historyStore.save(conv);
  });

  ipcMain.handle('history:delete', async (_event, id: string) => {
    return await historyStore.delete(id);
  });

  ipcMain.handle('history:search', async (_event, query: string, limit?: number) => {
    return await historyStore.search(query, limit);
  });

  ipcMain.handle('history:backfill', async () => {
    // Run backfill asynchronously so it doesn't block IPC
    historyStore.backfillVectors().catch(console.error);
    return { success: true, message: 'Backfill started in background' };
  });

  ipcMain.handle('history:get-vectors', async (_event, limit?: number) => {
    return await historyStore.getVectors(limit);
  });

  // ── HITL Persistence ─────────────────────────────────────────────
  // Returns the most recent pending HITL request for a conversation, or null.
  ipcMain.handle('hitl:get-pending', async (_event, conversationId: string) => {
    try {
      const records = listHitlRecords(conversationId);
      if (records.length > 0 && records[0].status === 'pending') {
        return records[0];
      }
      return null;
    } catch {
      return null;
    }
  });

  // Mark a HITL request as resolved (approved or rejected) on disk.
  ipcMain.handle('hitl:resolve', async (_event, conversationId: string, requestId: string, approved: boolean) => {
    try {
      saveHitlResponse({
        id: `resp-${Date.now()}`,
        requestId,
        conversationId,
        timestamp: new Date().toISOString(),
        approved,
        response: approved ? '[HITL_APPROVED]' : '[HITL_REJECTED]',
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });
}
