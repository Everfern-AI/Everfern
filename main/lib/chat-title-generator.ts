/**
 * EverFern Desktop — Chat Title Generator
 *
 * Generates a short, descriptive title for a conversation from the first
 * user message. Runs non-blocking via a fire-and-forget IPC channel.
 */

import { ipcMain, BrowserWindow } from 'electron';
import { acpManager } from '../acp/manager';
import { AIClient } from './ai-client';
import { dbOps } from './db';

export function registerChatTitleHandler(): void {
  ipcMain.handle('chat:generate-title', async (_event, conversationId: string, firstMessage: string) => {
    // Fire-and-forget: resolve immediately, generate in background
    generateTitle(conversationId, firstMessage).catch(err =>
      console.warn('[ChatTitle] Background title generation failed:', err.message)
    );
    return { queued: true };
  });
}

async function generateTitle(conversationId: string, firstMessage: string): Promise<void> {
  const client = getClient();
  if (!client) return;

  const prompt = firstMessage.slice(0, 500); // cap input

  const response = await client.chat({
    messages: [
      {
        role: 'system',
        content: 'You are a chat title generator. Given the user\'s first message, respond with ONLY a short title (3-6 words, no punctuation, no quotes). Nothing else.',
      },
      { role: 'user', content: prompt },
    ],
  });

  const raw: string = typeof response === 'string'
    ? response
    : (response as any)?.content ?? (response as any)?.text ?? '';

  const title = raw.trim().replace(/^["']|["']$/g, '').slice(0, 80);
  if (!title) return;

  // Update the title in the database
  await dbOps.run(
    `UPDATE conversations SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [title, conversationId]
  );

  console.log(`[ChatTitle] Updated title for ${conversationId}: "${title}"`);

  // Notify all renderer processes to refresh the conversation list
  // This prevents the temporary title from appearing as a separate chat
  const windows = BrowserWindow.getAllWindows();
  for (const window of windows) {
    if (!window.isDestroyed()) {
      window.webContents.send('chat:title-updated', { conversationId, title });
    }
  }
}

function getClient(): AIClient | null {
  try {
    return acpManager.getClient();
  } catch {
    return null;
  }
}
