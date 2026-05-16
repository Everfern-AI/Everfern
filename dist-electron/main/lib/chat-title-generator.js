"use strict";
/**
 * EverFern Desktop — Chat Title Generator
 *
 * Generates a short, descriptive title for a conversation from the first
 * user message. Runs non-blocking via a fire-and-forget IPC channel.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerChatTitleHandler = registerChatTitleHandler;
const electron_1 = require("electron");
const manager_1 = require("../acp/manager");
const db_1 = require("./db");
function registerChatTitleHandler() {
    electron_1.ipcMain.handle('chat:generate-title', async (_event, conversationId, firstMessage) => {
        // Fire-and-forget: resolve immediately, generate in background
        generateTitle(conversationId, firstMessage).catch(err => console.warn('[ChatTitle] Background title generation failed:', err.message));
        return { queued: true };
    });
}
async function generateTitle(conversationId, firstMessage) {
    const client = getClient();
    if (!client)
        return;
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
    const raw = typeof response === 'string'
        ? response
        : response?.content ?? response?.text ?? '';
    const title = raw.trim().replace(/^["']|["']$/g, '').slice(0, 80);
    if (!title)
        return;
    // Update the title in the database
    await db_1.dbOps.run(`UPDATE conversations SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [title, conversationId]);
    console.log(`[ChatTitle] Updated title for ${conversationId}: "${title}"`);
    // Notify all renderer processes to refresh the conversation list
    // This prevents the temporary title from appearing as a separate chat
    const windows = electron_1.BrowserWindow.getAllWindows();
    for (const window of windows) {
        if (!window.isDestroyed()) {
            window.webContents.send('chat:title-updated', { conversationId, title });
        }
    }
}
function getClient() {
    try {
        return manager_1.acpManager.getClient();
    }
    catch {
        return null;
    }
}
