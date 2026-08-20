import { ipcMain } from 'electron';
import { searchChatVectors, getChatVectors, deleteChatVectors, initChatVectorDb, getVectorStats as getVecStats } from '../store/chat-vectors';
import { registerContextEngine, setDefaultContextEngine } from '../context-engine';
import { VectorContextEngine } from '../context-engine/vector';

export function setupVectorContextEngine() {
  registerContextEngine('vector', () => new VectorContextEngine(), { force: true });
  setDefaultContextEngine('vector');

  setTimeout(() => {
    initChatVectorDb().then(() => {
      console.log('[Vectors] Database initialized');
    }).catch(err => {
      console.warn('[Vectors] Initialization failed (non-blocking):', err.message);
    });
  }, 5000);
}

export function registerVectorHandlers() {
  setupVectorContextEngine();

  ipcMain.handle('vectors:search', async (_event, query: string, topK: number = 10, chatId?: string) => {
    try {
      return await searchChatVectors(query, topK, chatId);
    } catch (err) {
      console.warn('[Vectors] Search error:', err);
      return [];
    }
  });

  ipcMain.handle('vectors:get', async (_event, chatId: string) => {
    try {
      return await getChatVectors(chatId);
    } catch (err) {
      console.warn('[Vectors] Get error:', err);
      return [];
    }
  });

  ipcMain.handle('vectors:delete', async (_event, chatId: string) => {
    try {
      await deleteChatVectors(chatId);
      return { success: true };
    } catch (err) {
      console.warn('[Vectors] Delete error:', err);
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle('vectors:stats', async () => {
    try {
      return await getVecStats();
    } catch (err) {
      console.warn('[Vectors] Stats error:', err);
      return { messageCount: 0, storageSize: 0, dimensionCount: null, initialized: false, error: String(err) };
    }
  });

  ipcMain.handle('vectors:index-message', async (_event, id: string, chatId: string, role: string, content: string, createdAt: number) => {
    try {
      const { embedAndStoreMessage } = await import('../store/chat-vectors');
      await embedAndStoreMessage(id, chatId, role, content, createdAt);
      return { success: true };
    } catch (err) {
      console.warn('[Vectors] Index error:', err);
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle('vectors:refresh-config', async () => {
    return { success: true };
  });
}
