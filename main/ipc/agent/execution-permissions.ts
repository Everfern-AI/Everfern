import { ipcMain } from 'electron';
import { dismissPermissionNotification } from '../../lib/permission-notification';
import { getLocalExecutionResolvers } from '../../agent/tools/pi-tools';
import { requestDebateSkip } from '../../agent/runner/debate-skip';

let agentPermissionResolver: ((granted: boolean) => void) | null = null;
const handledLocalExecutionResponses = new Set<string>();

export function setAgentPermissionResolver(resolver: ((granted: boolean) => void) | null) {
  agentPermissionResolver = resolver;
}

export function registerExecutionPermissionHandlers(): void {
  ipcMain.handle('debate:skip', (_event, debateId: string) => {
    return { success: requestDebateSkip(debateId) };
  });

  ipcMain.handle('agent:permission-response', (_event, granted: boolean) => {
    if (agentPermissionResolver) {
      agentPermissionResolver(granted);
      agentPermissionResolver = null;
    }
  });

  ipcMain.on('acp:local-execution-response', (_event, response: { requestId: string; approved: boolean; alwaysAllow: boolean; allowPrefix?: boolean }) => {
    console.log('[local-execution-response] Received IPC response:', JSON.stringify(response));
    if (!response?.requestId) {
      console.warn('[local-execution-response] Missing requestId');
      return;
    }
    if (handledLocalExecutionResponses.has(response.requestId)) {
      console.log('[local-execution-response] Duplicate response ignored for requestId:', response.requestId);
      return;
    }

    const resolvers = getLocalExecutionResolvers();
    console.log(`[local-execution-response] Resolvers Map size: ${resolvers.size}. Keys:`, Array.from(resolvers.keys()));

    try {
      dismissPermissionNotification(response.requestId);
    } catch {}

    const resolver = resolvers.get(response.requestId);
    if (resolver) {
      console.log(`[local-execution-response] ✅ Found and executing resolver for requestId: ${response.requestId}`);
      handledLocalExecutionResponses.add(response.requestId);
      setTimeout(() => handledLocalExecutionResponses.delete(response.requestId), 10 * 60 * 1000);
      resolvers.delete(response.requestId);
      resolver({ approved: response.approved, alwaysAllow: response.alwaysAllow, allowPrefix: response.allowPrefix ?? false });
    } else {
      console.warn('[local-execution-response] ❌ No resolver found for requestId:', response?.requestId);
    }
  });

  ipcMain.handle('tool-settings:list-synthesized', async () => {
    const { getSynthesizedToolsList } = require('../../agent/tools/tool-synthesizer');
    return getSynthesizedToolsList();
  });

  ipcMain.handle('tool-settings:delete-synthesized', async (_event, name: string) => {
    const { deleteSynthesizedTool } = require('../../agent/tools/tool-synthesizer');
    try {
      deleteSynthesizedTool(name);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || String(err) };
    }
  });

  ipcMain.handle('terminal:get-status', (_event, id: string) => {
    const { CommandRegistry } = require('../../agent/tools/terminal/registry');
    const registry = CommandRegistry.getInstance();
    const info = registry.listCommands().find((c: any) => c.id === id);
    if (!info) return { success: false, error: 'Command not found' };
    return { success: true, status: info.status, output: info.output, exitCode: info.exitCode, cwd: info.cwd };
  });

  ipcMain.handle('acp:get-interrupted-state', async (_event, conversationId: string) => {
    if (!conversationId) return { interrupted: false };
    try {
      const { stateManager } = require('../../agent/runner/state-manager');
      const isInterrupted = stateManager.isInterrupted(conversationId);
      const interruptData = stateManager.getInterruptData(conversationId);

      if (isInterrupted && interruptData) {
        console.log(`[acp:get-interrupted-state] Found interrupted state for conversation ${conversationId}:`, JSON.stringify(interruptData, null, 2));
        return {
          interrupted: true,
          interruptData,
        };
      }
    } catch (err: any) {
      console.warn('[acp:get-interrupted-state] Failed to query interrupted state:', err);
    }
    return { interrupted: false };
  });
}
