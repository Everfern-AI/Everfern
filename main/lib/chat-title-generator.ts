/**
 * EverFern Desktop — Chat Title Generator
 *
 * Generates a short, descriptive title for a conversation from the first
 * user message. Runs non-blocking via a fire-and-forget IPC channel in parallel
 * with main agent activities.
 */

import { ipcMain, BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { acpManager } from '../acp/manager';
import { AIClient } from './ai-client';
import { dbOps } from './db';

interface TitleOptions {
  providerType?: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
}

export function registerChatTitleHandler(): void {
  ipcMain.handle('chat:generate-title', async (_event, conversationId: string, firstMessage: string, options?: TitleOptions) => {
    // Fire-and-forget: resolve immediately, generate title concurrently in the background
    generateTitle(conversationId, firstMessage, options).catch(err =>
      console.warn('[ChatTitle] Background title generation failed:', err?.message || err)
    );
    return { queued: true };
  });
}

function loadConfigSync(): any {
  try {
    const configDir = path.join(os.homedir(), '.everfern');
    const configPath = path.join(configDir, 'config.json');
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (err) {
    console.warn('[ChatTitle] Error loading config:', err);
  }
  return null;
}

function getClient(options?: TitleOptions): AIClient | null {
  // 1. Check if explicit options were passed from renderer
  if (options?.providerType) {
    const provider = options.providerType as any;
    const config = loadConfigSync();
    const isCustomUrl = Boolean(options.baseUrl && !['lmstudio', 'ollama'].includes(provider));
    const apiKey = options.apiKey || (isCustomUrl ? '' : (config?.keys?.[provider] || config?.apiKey || ''));
    const baseUrl = options.baseUrl ||
      (provider === 'lmstudio' ? (config?.lmstudioBaseUrl || 'http://localhost:1234/v1') :
       provider === 'ollama' ? (config?.ollamaBaseUrl || 'http://localhost:11434') : undefined);

    try {
      return new AIClient({
        provider,
        model: options.model,
        apiKey,
        baseUrl,
      });
    } catch (err) {
      console.warn('[ChatTitle] Failed to create custom AIClient for title:', err);
    }
  }

  // 2. Try acpManager singleton client
  try {
    const client = acpManager.getClient();
    if (client) return client;
  } catch {}

  // 3. Fallback to active config from disk
  const config = loadConfigSync();
  if (config?.provider) {
    try {
      const apiKey = config.keys?.[config.provider] || config.apiKey || '';
      return new AIClient({
        provider: config.provider,
        model: config.model || config.customModel,
        apiKey,
        baseUrl: config.baseUrl,
      });
    } catch (err) {
      console.warn('[ChatTitle] Fallback AIClient creation failed:', err);
    }
  }

  return null;
}

async function generateTitle(conversationId: string, firstMessage: string, options?: TitleOptions): Promise<void> {
  if (!conversationId || !firstMessage || firstMessage.trim().length === 0) return;

  // Cap input message to 600 chars for title prompt
  const cleanInput = firstMessage.replace(/\[Shared folder context\][\s\S]*$/i, '').trim();
  if (!cleanInput) {
    try {
      await dbOps.run(
        `UPDATE conversations SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        ['Shared Workspace', conversationId]
      );
      const windows = BrowserWindow.getAllWindows();
      for (const window of windows) {
        if (!window.isDestroyed()) {
          window.webContents.send('chat:title-updated', { conversationId, title: 'Shared Workspace' });
        }
      }
    } catch {}
    return;
  }
  const prompt = cleanInput.slice(0, 600);

  const client = getClient(options);
  if (!client) {
    console.warn('[ChatTitle] No AI client available for title generation');
    return;
  }

  try {
    const response = await client.chat({
      messages: [
        {
          role: 'system',
          content: 'You are a concise conversation title generator. Output ONLY a 3-6 word title that summarizes what the user wants to accomplish. No quotes, no markdown, no punctuation at the end, no prefix like "Title:".',
        },
        { role: 'user', content: prompt },
      ],
      maxTokens: 30,
      temperature: 0.3,
    });

    const raw: string = typeof response === 'string'
      ? response
      : (response as any)?.content ?? (response as any)?.text ?? '';

    let title = raw
      .trim()
      .replace(/^["'`#\s]+|["'`\s]+$/g, '')
      .replace(/^(Title:\s*|Subject:\s*|Topic:\s*)/i, '')
      .slice(0, 75)
      .trim();

    if (!title || title.length < 2) return;

    // Update the title in the central SQLite DB
    await dbOps.run(
      `UPDATE conversations SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [title, conversationId]
    );

    console.log(`[ChatTitle] ✅ Auto-titled conversation ${conversationId}: "${title}"`);

    // Notify all active renderer windows to update their sidebar / chat headers live
    const windows = BrowserWindow.getAllWindows();
    for (const window of windows) {
      if (!window.isDestroyed()) {
        window.webContents.send('chat:title-updated', { conversationId, title });
      }
    }
  } catch (err: any) {
    console.warn('[ChatTitle] Non-blocking title generation failed:', err?.message || err);
  }
}
