import { ipcMain, Notification } from 'electron';
import { AgentRunner } from '../agent/runner/runner';
import { globalAbortManager } from '../agent/runner/abort-manager';
import { acpManager } from '../acp/manager';
import { AIClient } from '../lib/ai-client';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { dbOps } from '../lib/db';

let agentPermissionResolver: ((granted: boolean) => void) | null = null;
let localExecutionResponseResolver: ((response: { approved: boolean; alwaysAllow: boolean }) => void) | null = null;

function loadConfigSync() {
  try {
    const configPath = path.join(os.homedir(), '.everfern', 'config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

      // Load API keys from ~/.everfern/keys/
      config.keys = {};
      const keysDir = path.join(os.homedir(), '.everfern', 'keys');
      if (fs.existsSync(keysDir)) {
        const files = fs.readdirSync(keysDir);
        for (const file of files) {
          if (file.endsWith('.key')) {
            const baseName = file.replace('.key', '');
            const key = fs.readFileSync(path.join(keysDir, file), 'utf-8').trim();
            config.keys[baseName] = key;
          }
        }
      }
      return config;
    }
  } catch (err) {
    console.error('[Config] Error loading config:', err);
  }
  return null;
}

import { reflectAndRemember } from '../store/memory-manager';
import { getAllModelsFlat, FlatModelEntry, PROVIDER_REGISTRY } from '../lib/providers';

export function registerAgentHandlers() {
  // Event-based channels (one-way communication via sender.send):
  // - acp:sub-agent-progress: Sub-agent progress streaming events
  //   Events are sent via sender.send('acp:sub-agent-progress', event)
  //   Used by ProgressEventEmitter in computer-use.ts

  // Provider management
  ipcMain.handle('acp:list-providers', () => acpManager.listProviders());

  // ── Screenshot Loader ─────────────────────────────────────────────────────
  // Allows the renderer to load a screenshot from disk by its absolute path.
  // Security: only files inside ~/.everfern/screenshots/ are allowed.
  ipcMain.handle('screenshot:load', async (_event, filePath: string) => {
    try {
      const allowedDir = path.normalize(path.join(os.homedir(), '.everfern', 'screenshots'));
      const resolved = path.normalize(path.resolve(filePath));

      // Case-insensitive comparison on Windows; case-sensitive on macOS/Linux.
      const isWindows = process.platform === 'win32';
      const allowedDirNorm = isWindows ? allowedDir.toLowerCase() : allowedDir;
      const resolvedNorm   = isWindows ? resolved.toLowerCase()   : resolved;

      // Ensure the resolved path is *inside* the allowed dir (trailing sep prevents path-traversal)
      const prefix = allowedDirNorm.endsWith(path.sep) ? allowedDirNorm : allowedDirNorm + path.sep;
      if (!resolvedNorm.startsWith(prefix)) {
        return { error: 'Access denied: path is outside the screenshots directory.' };
      }
      if (!fs.existsSync(resolved)) {
        return { error: 'File not found.' };
      }
      const buf = fs.readFileSync(resolved);
      const ext = path.extname(resolved).toLowerCase();
      const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
      const base64 = buf.toString('base64');
      return { base64, dataUrl: `data:${mime};base64,${base64}` };
    } catch (err) {
      console.error('[screenshot:load] Error:', err);
      return { error: String(err) };
    }
  });

  ipcMain.handle('acp:set-provider', async (_event, config) => {
    return acpManager.setProvider(config);
  });
  ipcMain.handle('acp:health-check', async () => acpManager.healthCheck());

  ipcMain.handle('acp:list-tools', async () => {
    try {
      const activeConfig = acpManager.getActiveConfig();
      // Create a temporary runner just to get the list of tools
      // This is safe because getBaseTools/initializePiTools are relatively lightweight
      const client = acpManager.getClient();
      if (!client) return { success: true, tools: [] };

      const runner = new AgentRunner(client, {
        visionModel: activeConfig?.vlm?.model,
        vlm: activeConfig?.vlm,
      });

      await runner.waitForToolsReady();

      const tools = runner.tools.map(t => ({
        name: t.name,
        description: t.description,
      }));

      return { success: true, tools };
    } catch (error) {
      console.error('[acp:list-tools] Error:', error);
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('acp:list-models', async () => {
    try {
      const config = acpManager.getActiveConfig();
      let providerType = config ? config.provider : 'everfern';
      if ((providerType as string) === 'google') providerType = 'gemini';

      // 1. Get models for the active configured provider
      const activeModels = getAllModelsFlat().filter(m => m.providerType === providerType);

      if (providerType === 'nvidia' && (config as any)?.customModel) {
        if (!activeModels.find(m => m.id === (config as any).customModel)) {
          activeModels.unshift({
            id: (config as any).customModel,
            name: (config as any).customModel + " (Custom)",
            provider: 'NVIDIA NIM',
            providerType: 'nvidia' as any
          });
        }
      }

      // 2. Fetch local Ollama models dynamically
      let ollamaModels: FlatModelEntry[] = [];
      try {
        const ollamaClient = new AIClient({ provider: 'ollama' });
        const rawOllama = await ollamaClient.listModels();
        ollamaModels = rawOllama.map((m: string) => ({
          id: m,
          name: m,
          provider: 'Ollama',
          providerType: 'ollama' as any
        }));
        if (rawOllama.length === 0) {
          ollamaModels.push({ id: 'ollama-empty', name: 'No models found in Ollama', provider: 'Ollama', providerType: 'ollama' as any });
        }
      } catch {
        ollamaModels.push({ id: 'ollama-error', name: 'Ollama is not running/installed', provider: 'Ollama', providerType: 'ollama' as any });
      }

      // 3. Fetch local LM Studio dynamically
      let lmstudioModels: FlatModelEntry[] = [];
      try {
        const lmClient = new AIClient({ provider: 'lmstudio' });
        const rawLm = await lmClient.listModels();
        lmstudioModels = rawLm.map((m: string) => ({
          id: m,
          name: m,
          provider: 'LM Studio',
          providerType: 'lmstudio' as any
        }));
        if (rawLm.length === 0) {
          lmstudioModels.push({ id: 'lmstudio-empty', name: 'No models found in LM Studio', provider: 'LM Studio', providerType: 'lmstudio' as any });
        }
      } catch {
        lmstudioModels.push({ id: 'lmstudio-error', name: 'LM Studio is not running/installed', provider: 'LM Studio', providerType: 'lmstudio' as any });
      }

      // Deduplicate and combine
      const merged = [...activeModels];
      for (const om of [...ollamaModels, ...lmstudioModels]) {
         if (!merged.find(m => m.id === om.id)) merged.push(om);
      }

      if (merged.length === 0) {
        merged.push({ id: 'everfern-1', name: 'Fern-1', provider: 'EverFern Cloud', providerType: 'everfern' as any });
      }

      return { success: true, models: merged };
    } catch (error) {
      console.error('[acp:list-models] Error:', error);
      return { success: false, models: [], error: String(error) };
    }
  });

  // Stop/Abort
  ipcMain.handle('acp:stop', () => {
    globalAbortManager.setAborted();
    return { success: true };
  });

  ipcMain.handle('agent:permission-response', (_event, granted: boolean) => {
    if (agentPermissionResolver) {
      agentPermissionResolver(granted);
      agentPermissionResolver = null;
    }
  });

  ipcMain.handle('agent:rollback-turn', async (_event, conversationId: string, timestamp: number) => {
    const { getRollbackManager } = require('../agent/persistence/rollback-manager');
    const manager = getRollbackManager();
    await manager.initialize();
    const result = await manager.rollbackSinceTimestamp(conversationId, timestamp);
    return result;
  });

  // NOTE: Must use ipcMain.on (not ipcMain.handle) here because the renderer preload
  // uses ipcRenderer.send (one-way fire-and-forget), not ipcRenderer.invoke.
  // ipcMain.handle only receives messages from ipcRenderer.invoke.
  ipcMain.on('acp:local-execution-response', (_event, response: { requestId: string; approved: boolean; alwaysAllow: boolean }) => {
    console.log('[local-execution-response] Received IPC response:', JSON.stringify(response));
    // Import here to avoid circular dependencies
    const { getLocalExecutionResolvers } = require('../agent/tools/pi-tools');
    const resolvers = getLocalExecutionResolvers();
    
    console.log(`[local-execution-response] Resolvers Map size: ${resolvers.size}. Keys:`, Array.from(resolvers.keys()));

    // Resolve the specific request
    const resolver = resolvers.get(response.requestId);
    if (resolver) {
      console.log(`[local-execution-response] ✅ Found and executing resolver for requestId: ${response.requestId}`);
      resolver({ approved: response.approved, alwaysAllow: response.alwaysAllow });
    } else {
      console.warn('[local-execution-response] ❌ No resolver found for requestId:', response?.requestId);
    }
  });

  ipcMain.handle('terminal:get-status', (_event, id: string) => {
    const { CommandRegistry } = require('../agent/tools/terminal/registry');
    const registry = CommandRegistry.getInstance();
    const info = registry.listCommands().find((c: any) => c.id === id);
    if (!info) return { success: false, error: 'Command not found' };
    return { success: true, status: info.status, output: info.output, exitCode: info.exitCode };
  });

  // ACP Chat Handler (Non-streaming)
  ipcMain.handle('acp:chat', async (_event, request: {
    messages: any[],
    model?: string,
    providerType?: string,
    conversationId?: string
  }) => {
    let client = acpManager.getClient();
    const config = loadConfigSync();

    if (request.providerType) {
      const currentProvider = acpManager.getActiveConfig()?.provider;
      if (request.providerType !== currentProvider || !client) {
        const apiKey = config?.keys?.[request.providerType] || '';
        client = new AIClient({
          provider: request.providerType as any,
          model: request.model,
          apiKey,
        });
      } else if (request.model) {
        client.setModel(request.model);
      }
    }

    if (!client) return { error: 'No AI provider configured' };

    try {
      const response = await client.chat({
        messages: request.messages,
        model: request.model,
      });
      return { success: true, response };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Main Streaming Handler
  ipcMain.handle('acp:stream', async (event, request: {
    messages: any[],
    model?: string,
    conversationId?: string,
    projectId?: string,
    providerType?: string,
    apiKey?: string,
    assistantMessageId?: string
  }) => {
    const streamSender = event.sender;
    const config = loadConfigSync();
    let client = acpManager.getClient();

    // Dynamic provider switch
    if (request.providerType) {
      const currentProvider = acpManager.getActiveConfig()?.provider;
      if (request.providerType !== currentProvider || !client) {
        const apiKey = config?.keys?.[request.providerType] || request.apiKey || '';
        client = new AIClient({
          provider: request.providerType as any,
          model: request.model,
          apiKey,
        });
      } else if (request.model) {
        client.setModel(request.model);
      }
    }

    if (!client) throw new Error('No AI provider configured');

    // Construct AgentRunnerConfig from active ACP config
    const activeConfig = acpManager.getActiveConfig();
    console.log('[AgentIPC] Active ACP Config:', {
      provider: activeConfig?.provider,
      model: activeConfig?.model,
      hasVlm: !!activeConfig?.vlm,
      vlmModel: activeConfig?.vlm?.model
    });

    const runnerConfig = {
      visionModel: activeConfig?.vlm?.model,
      vlm: activeConfig?.vlm,
      ollamaBaseUrl: activeConfig?.baseUrl, // Fallback
    };

    console.log('[AgentIPC] Initializing AgentRunner with config:', JSON.stringify(runnerConfig, null, 2));
    const runner = new AgentRunner(client, runnerConfig);

    // IPC Batching State
    let chunkBuffer = '';
    let thoughtBuffer = '';
    let toolCallChunkBuffer: Array<{ index: number; argumentsDelta: string }> = [];
    let lastFlushTime = Date.now();
    const FLUSH_INTERVAL_MS = 16;

    const flushBuffers = () => {
      if (chunkBuffer) {
        try { streamSender.send('acp:stream-chunk', { delta: chunkBuffer, done: false }); } catch (e) {}
        chunkBuffer = '';
      }
      if (thoughtBuffer) {
        try { streamSender.send('acp:thought', { content: thoughtBuffer }); } catch (e) {}
        thoughtBuffer = '';
      }
      if (toolCallChunkBuffer.length > 0) {
        for (const item of toolCallChunkBuffer) {
          try { streamSender.send('acp:tool-call-chunk', item); } catch (e) {}
        }
        toolCallChunkBuffer = [];
      }
      lastFlushTime = Date.now();
    };

    const safeSend = (channel: string, data: any) => {
      flushBuffers();
      if (data === undefined) {
        console.warn(`[IPC] Skipping undefined data for channel ${channel}`);
        return;
      }
      try {
        const safeData = JSON.parse(JSON.stringify(data, (key, value) => {
          if (value instanceof Error) return { message: value.message, stack: value.stack };
          return value;
        }));
        streamSender.send(channel, safeData);
      } catch (err) {
        console.error(`[IPC] Serialization failed for ${channel}:`, err);
      }
    };

    try {
      const history = request.messages.slice(0, -1);
      const userInput = request.messages[request.messages.length - 1].content;

      // ── In-progress draft persistence ────────────────────────────────────
      // Save a draft of the streaming message every ~3 seconds so that if
      // the app force-closes, the partial response is not lost.
      const convId = request.conversationId;
      const msgId = request.assistantMessageId || `draft-${Date.now()}`;
      let draftContent = '';
      let draftToolCalls: any[] = [];
      let lastDraftSave = 0;
      const DRAFT_INTERVAL_MS = 3000;

      const saveDraft = async () => {
        if (!convId || (!draftContent && draftToolCalls.length === 0)) return;
        try {
          await dbOps.run(
            `INSERT OR REPLACE INTO messages
             (id, conversation_id, role, content, tool_calls, order_index, created_at)
             VALUES (?, ?, 'assistant', ?, ?, 9999, COALESCE((SELECT created_at FROM messages WHERE id = ?), ?))`,
            [msgId, convId, draftContent,
             draftToolCalls.length > 0 ? JSON.stringify(draftToolCalls) : null,
             msgId, new Date().toISOString()]
          );
          // Also ensure the conversation row exists
          await dbOps.run(
            `INSERT OR IGNORE INTO conversations (id, title, provider, model, created_at, updated_at)
             VALUES (?, '[In Progress]', 'everfern', ?, ?, ?)`,
            [convId, request.model || 'unknown',
             new Date().toISOString(), new Date().toISOString()]
          );
        } catch { /* DB may not have draft_messages table yet */ }
      };

      const cleanupDraft = async () => {
        if (!convId) return;
        try {
          // Remove the draft — the frontend will do a proper save via history:save
          // Only delete if content is empty (meaning the real save hasn't happened)
          // We leave it if the save failed so the user can recover it on next load
        } catch { }
      };
      // ── End draft setup ──────────────────────────────────────────────────

      let fullResponse = '';
      for await (const streamEvent of runner.runStream(userInput, history, request.model, request.conversationId, undefined, request.projectId, false, request.assistantMessageId)) {
        if (globalAbortManager.streamAborted) {
          flushBuffers();
          try {
            const { getComputerOverlayManager } = require('../computer-overlay');
            getComputerOverlayManager().hide();
          } catch (e) {
            console.error('[AgentIPC] Failed to hide overlay:', e);
          }
          streamSender.send('acp:stream-chunk', { delta: '\n\n🛑 Stopped by user.', done: true });
          break;
        }

        if (streamEvent.type === 'chunk') {
          chunkBuffer += streamEvent.content;
          fullResponse += streamEvent.content;
          draftContent += streamEvent.content;
          if (Date.now() - lastFlushTime >= FLUSH_INTERVAL_MS) flushBuffers();
          // Periodically save draft
          if (Date.now() - lastDraftSave > DRAFT_INTERVAL_MS) {
            lastDraftSave = Date.now();
            saveDraft().catch(() => {});
          }
        } else if (streamEvent.type === 'thought') {
          thoughtBuffer += streamEvent.content;
          if (Date.now() - lastFlushTime >= FLUSH_INTERVAL_MS) flushBuffers();
        } else if (streamEvent.type === 'tool_start') {
          safeSend('acp:tool-start', { 
            toolName: streamEvent.toolName, 
            toolArgs: streamEvent.toolArgs,
            toolCallId: (streamEvent as any).toolCallId
          });
        } else if (streamEvent.type === 'tool_call') {
          safeSend('acp:tool-call', streamEvent.toolCall);
          // Track tool call in draft for persistence
          if (streamEvent.toolCall) {
            const tc = streamEvent.toolCall;
            const existingIdx = draftToolCalls.findIndex(t => t.id === tc.id);
            if (existingIdx >= 0) {
              draftToolCalls[existingIdx] = { ...draftToolCalls[existingIdx], ...tc };
            } else {
              draftToolCalls.push(tc);
            }
          }
        } else if (streamEvent.type === 'tool_call_start') {
          safeSend('acp:tool-call-start', { index: streamEvent.index, toolName: streamEvent.toolName });
        } else if (streamEvent.type === 'tool_call_chunk') {
          // Buffer tool call chunks and debounce like text chunks
          toolCallChunkBuffer.push({ index: streamEvent.index, argumentsDelta: streamEvent.argumentsDelta });
          if (Date.now() - lastFlushTime >= FLUSH_INTERVAL_MS) flushBuffers();
        } else if (streamEvent.type === 'tool_call_complete') {
          safeSend('acp:tool-call-complete', { index: streamEvent.index, toolName: streamEvent.toolName, arguments: streamEvent.arguments });
        } else if (streamEvent.type === 'mission_step_update') {
          // ── Mission Step Update → acp:mission-step-update ──────────────
          safeSend('acp:mission-step-update', {
            step: (streamEvent as any).step,
            timeline: (streamEvent as any).timeline,
          });
        } else if (streamEvent.type === 'mission_phase_change') {
          // ── Mission Phase Change → acp:mission-phase-change ────────────
          safeSend('acp:mission-phase-change', {
            phase: (streamEvent as any).phase,
            timeline: (streamEvent as any).timeline,
          });
        } else if (streamEvent.type === 'mission_complete') {
          // ── Mission Complete — send BEFORE done:true so listeners are still alive ──
          console.log('[AgentIPC] Mission complete event received');
          safeSend('acp:mission-complete', {
            timeline: (streamEvent as any).timeline,
            steps: (streamEvent as any).steps,
            thinkingDuration: (streamEvent as any).thinkingDuration,
            title: (streamEvent as any).title,
          });
        } else if (streamEvent.type === 'done') {
          flushBuffers();

          try {
            const { getComputerOverlayManager } = require('../computer-overlay');
            getComputerOverlayManager().hide();
          } catch (e) {
            console.error('[AgentIPC] Failed to hide overlay:', e);
          }

          // Trigger cleanup sequence when execution completes
          console.log('[AgentIPC] Execution complete, triggering cleanup sequence...');
          try {
            const cleanupStatus = await globalAbortManager.executeCleanupSequence();

            // Send cleanup status to frontend
            safeSend('acp:cleanup-complete', {
              success: cleanupStatus.success,
              completedPhases: cleanupStatus.completedPhases,
              totalPhases: cleanupStatus.totalPhases,
              elapsedMs: cleanupStatus.elapsedMs,
              errors: cleanupStatus.errors
            });

            console.log('[AgentIPC] Cleanup sequence completed:', {
              success: cleanupStatus.success,
              elapsedMs: cleanupStatus.elapsedMs
            });
          } catch (cleanupErr) {
            console.error('[AgentIPC] Cleanup sequence error:', cleanupErr);
            safeSend('acp:cleanup-error', {
              message: String(cleanupErr),
              stack: cleanupErr instanceof Error ? cleanupErr.stack : undefined
            });
          }

          // NOTE: done:true fires AFTER mission_complete so the frontend
          // still has listeners active when mission_complete arrives.
          safeSend('acp:stream-chunk', { delta: '', done: true });

          // Save final draft with complete content (marks message as persisted)
          await saveDraft();

          // Self-Improvement: Trigger non-blocking memory reflection
          reflectAndRemember(history, userInput, fullResponse, client);
        } else if (streamEvent.type === 'subagent-progress') {
          const progressPayload = streamEvent.data !== undefined ? streamEvent.data : streamEvent;
          safeSend('acp:sub-agent-progress', progressPayload);
        } else if (streamEvent.type === 'local_execution_request') {
          // Forward local execution request to renderer
          safeSend('acp:local-execution-request', {
            requestId: (streamEvent as any).requestId,
            command: (streamEvent as any).command,
            shellType: (streamEvent as any).shellType,
            reason: (streamEvent as any).reason,
            conversationId: (streamEvent as any).conversationId
          });
        } else if (streamEvent.type === 'debate_event' && (streamEvent as any).debateEvent) {
          const de = (streamEvent as any).debateEvent;
          console.log('[AgentIPC] Forwarding debate event:', de.type, 'debateId:', de.debateId);
          safeSend('debate:stream', de);
        } else {
          // Generic fallback — skip already-handled event types to avoid double-sending
          const skippedTypes = new Set(['mission_step_update', 'mission_phase_change', 'mission_complete', 'done']);
          if (!skippedTypes.has(streamEvent.type)) {
            safeSend(`acp:${streamEvent.type.replace(/_/g, '-')}`, streamEvent);
          }
        }
      }
    } catch (error) {
      console.error('[AgentIPC] Stream Error:', error);
      try {
        const { getComputerOverlayManager } = require('../computer-overlay');
        getComputerOverlayManager().hide();
      } catch (e) {}
      streamSender.send('acp:stream-chunk', { delta: `\n\n[Error: ${String(error)}]`, done: true });
    }
  });
}
