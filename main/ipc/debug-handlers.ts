import { ipcMain, clipboard } from 'electron';

export function registerDebugHandlers() {
  ipcMain.handle('debug:get-last-event', () => {
    return (globalThis as any).lastStreamEvent || null;
  });

  ipcMain.handle('debug:get-chat-history', () => {
    const lastChatMessages = (globalThis as any).lastChatMessages || [];
    const lastStreamEvent = (globalThis as any).lastStreamEvent || null;

    const fullHistory: any[] = [];

    if (lastChatMessages.length > 0) {
      for (const m of lastChatMessages) {
        const msg: any = { role: m.role };
        if (m.role === 'system') {
          msg.content = '[SYSTEM PROMPT - HIDDEN]';
          msg.contentPreview = typeof m.content === 'string' ? m.content.substring(0, 200) + '...' : '[Complex system prompt]';
        } else if (typeof m.content === 'string') {
          msg.content = m.content;
          msg.contentLength = m.content.length;
        } else if (Array.isArray(m.content)) {
          msg.content = m.content.map((c: any) => c.type === 'text' ? c.text : c.type === 'image_url' ? '[Image]' : '[Content]').join('\n');
          msg.hasMultimodal = true;
        }
        if (m.tool_calls) {
          msg.toolCalls = m.tool_calls.map((tc: any) => ({ name: tc.function?.name || tc.name, arguments: tc.function?.arguments || tc.arguments, id: tc.id }));
        }
        if (m.role === 'tool') {
          msg.toolName = m.tool_name;
          msg.toolCallId = m.tool_call_id;
          msg.resultPreview = typeof m.content === 'string' ? m.content.substring(0, 500) + (m.content.length > 500 ? '...' : '') : '[Complex result]';
        }
        fullHistory.push(msg);
      }
    }

    if (lastStreamEvent) {
      const eventMsg: any = { role: 'event', eventType: lastStreamEvent.type };

      if (lastStreamEvent.type === 'chunk') {
        eventMsg.content = lastStreamEvent.content;
      } else if (lastStreamEvent.type === 'tool_start') {
        eventMsg.toolName = lastStreamEvent.toolName;
        eventMsg.toolArgs = lastStreamEvent.toolArgs;
        eventMsg.description = `Starting: ${lastStreamEvent.toolName}`;
      } else if (lastStreamEvent.type === 'tool_call') {
        eventMsg.toolCall = lastStreamEvent.toolCall;
        eventMsg.description = `Tool called: ${lastStreamEvent.toolCall?.toolName || 'unknown'}`;
      } else if (lastStreamEvent.type === 'thought') {
        eventMsg.thinking = lastStreamEvent.content;
      } else {
        eventMsg.data = lastStreamEvent;
      }

      if (fullHistory.length > 0 || Object.keys(eventMsg).length > 2) {
        fullHistory.push(eventMsg);
      }
    }

    return { type: 'full_chat_history', messageCount: fullHistory.length, messages: fullHistory };
  });

  ipcMain.handle('debug:copy-to-clipboard', (_e, text: string) => {
    clipboard.writeText(text);
    return true;
  });
}
