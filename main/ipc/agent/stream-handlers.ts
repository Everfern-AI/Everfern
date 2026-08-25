import { ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { AgentRunner } from '../../agent/runner/runner';
import { globalAbortManager } from '../../agent/runner/abort-manager';
import { acpManager } from '../../acp/manager';
import { AIClient } from '../../lib/ai-client';
import { hydrateConfigWithIsolatedKeys } from '../../lib/vlm-config';
import { dbOps } from '../../lib/db';
import { reflectAndRemember } from '../../store/memory-manager';
import { showPermissionNotification } from '../../lib/permission-notification';

function loadConfigSync() {
  try {
    const configDir = path.join(os.homedir(), '.everfern');
    const configPath = path.join(configDir, 'config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      return hydrateConfigWithIsolatedKeys(config, configDir);
    }
  } catch (err) {
    console.error('[Config] Error loading config:', err);
  }
  return null;
}

function normalizeRequestedModel(providerType?: string, model?: string): string | undefined {
  if (!model) return model;
  if (providerType === 'ollama' && model.startsWith('ollama:')) return model.slice('ollama:'.length);
  if (providerType === 'lmstudio' && model.startsWith('lmstudio:')) return model.slice('lmstudio:'.length);
  return model;
}

function extractCleanNarrative(explicitNarrative?: string, rawThought?: string): string | undefined {
  if (explicitNarrative && typeof explicitNarrative === 'string' && explicitNarrative.trim()) {
    return explicitNarrative.trim();
  }
  if (!rawThought) return undefined;

  const cleaned = rawThought
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```[\s\S]*?```/gi, '')
    .replace(/^\[(?:BRAIN|TRIAGE|PLANNER|DECOMPOSER|Cognitive Router|CognitiveRouter|Graph|IPC|Network|System|Web Explorer|Deep Research)\][^\n]*/gim, '')
    .replace(/^\s*(?:🌐|🔍|📝|✅|🔬|⚠️|🖥️|💻|📊|📋)[^\n]*/gim, '')
    .trim();

  if (!cleaned) return undefined;

  const lines = cleaned.split('\n').map(l => l.trim()).filter(l => l.length > 5 && !l.startsWith('#') && !l.startsWith('-'));
  if (!lines.length) return undefined;

  const actionLine = lines.find(l => /^(?:I will|I'll|Now|Opening|Navigating|Checking|Inspecting|Searching|Updating|Writing|Creating|Running|Analyzing|Reading|Editing|Fetching|Looking)\b/i.test(l));
  const candidate = actionLine || lines[lines.length - 1];

  return candidate.replace(/^[*\s]+/, '').replace(/[.*]+$/, '').slice(0, 120).trim() || undefined;
}

export function registerStreamHandlers(): void {
  ipcMain.handle('acp:stop', () => {
    globalAbortManager.setAborted();
    return { success: true };
  });

  ipcMain.handle('acp:chat', async (_event, request: {
    messages: any[],
    model?: string,
    providerType?: string,
    conversationId?: string
  }) => {
    let client = acpManager.getClient();
    const config = loadConfigSync();
    const requestedModel = normalizeRequestedModel(request.providerType, request.model);

    if (request.providerType) {
      const currentProvider = acpManager.getActiveConfig()?.provider;
      if (request.providerType !== currentProvider || !client) {
        const apiKey = config?.keys?.[request.providerType] || '';
        client = new AIClient({
          provider: request.providerType as any,
          model: requestedModel,
          apiKey,
        });
      } else if (requestedModel) {
        client.setModel(requestedModel);
      }
    }

    if (!client) return { error: 'No AI provider configured' };

    try {
      const response = await client.chat({
        messages: request.messages,
        model: requestedModel,
      });
      return { success: true, response };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('acp:stream', async (event, request: {
    messages: any[],
    model?: string,
    conversationId?: string,
    projectId?: string,
    providerType?: string,
    apiKey?: string,
    assistantMessageId?: string,
    operatorMode?: boolean,
    reasoningEffort?: string
  }) => {
    (globalThis as any).lastChatMessages = request.messages;
    const streamSender = event.sender;
    const config = loadConfigSync();
    let client = acpManager.getClient();
    const requestedModel = normalizeRequestedModel(request.providerType, request.model);
    let activeConfigForRequest = acpManager.getActiveConfig();

    if (request.providerType) {
      const currentProvider = activeConfigForRequest?.provider;
      if (request.providerType !== currentProvider || !client) {
        const apiKey = config?.keys?.[request.providerType] || request.apiKey || '';
        const baseUrl = request.providerType === 'lmstudio'
          ? (config?.lmstudioBaseUrl || config?.baseUrls?.lmstudio || 'http://localhost:1234/v1')
          : request.providerType === 'ollama'
            ? (config?.ollamaBaseUrl || config?.baseUrls?.ollama || 'http://localhost:11434')
            : undefined;
        client = new AIClient({
          provider: request.providerType as any,
          model: requestedModel,
          apiKey,
          baseUrl,
        });
        activeConfigForRequest = {
          ...(activeConfigForRequest || {}),
          provider: request.providerType as any,
          model: requestedModel,
          apiKey,
          baseUrl,
        } as any;
      } else if (requestedModel) {
        client.setModel(requestedModel);
        activeConfigForRequest = {
          ...(activeConfigForRequest || {}),
          model: requestedModel,
        } as any;
      }
    }

    if (!client) throw new Error('No AI provider configured');

    console.log('[AgentIPC] Active ACP Config:', {
      provider: activeConfigForRequest?.provider,
      model: activeConfigForRequest?.model,
      hasVlm: !!activeConfigForRequest?.vlm,
      vlmModel: activeConfigForRequest?.vlm?.model
    });

    const runnerConfig = {
      visionModel: activeConfigForRequest?.vlm?.model,
      vlm: activeConfigForRequest?.vlm,
      ollamaBaseUrl: activeConfigForRequest?.baseUrl,
    };

    console.log('[AgentIPC] Initializing AgentRunner with config:', JSON.stringify(runnerConfig, null, 2));
    const runner = new AgentRunner(client, runnerConfig);

    let chunkBuffer = '';
    let thoughtBuffer = '';
    let toolCallChunkBuffer: Array<{ index: number; argumentsDelta: string }> = [];
    let lastFlushTime = Date.now();
    const FLUSH_INTERVAL_MS = 16;

    const flushBuffers = () => {
      if (chunkBuffer) {
        try { streamSender.send('acp:stream-chunk', { delta: chunkBuffer, done: false, conversationId: request.conversationId, assistantMessageId: request.assistantMessageId }); } catch (e) {}
        chunkBuffer = '';
      }
      if (thoughtBuffer) {
        try { streamSender.send('acp:thought', { content: thoughtBuffer, conversationId: request.conversationId, assistantMessageId: request.assistantMessageId }); } catch (e) {}
        thoughtBuffer = '';
      }
      if (toolCallChunkBuffer.length > 0) {
        for (const item of toolCallChunkBuffer) {
          try { streamSender.send('acp:tool-call-chunk', { ...item, conversationId: request.conversationId, assistantMessageId: request.assistantMessageId }); } catch (e) {}
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
        if (safeData && typeof safeData === 'object' && !Array.isArray(safeData)) {
          if (!safeData.conversationId) {
            safeData.conversationId = request.conversationId;
          }
          if (!safeData.assistantMessageId && request.assistantMessageId) {
            safeData.assistantMessageId = request.assistantMessageId;
          }
        }
        streamSender.send(channel, safeData);
      } catch (err) {
        console.error(`[IPC] Serialization failed for ${channel}:`, err);
      }
    };

    try {
      const validMessages = request.messages.filter((m: any) => m.content);
      if (validMessages.length === 0) {
        console.error('[AgentIPC] All messages have empty content — aborting stream');
        throw new Error('No valid messages to send. All messages had empty content.');
      }
      const history = validMessages.slice(0, -1);
      const userInput = validMessages[validMessages.length - 1].content;

      const convId = request.conversationId;
      const msgId = request.assistantMessageId || `draft-${Date.now()}`;
      let draftContent = '';
      let draftToolCalls: any[] = [];
      const draftSubAgentProgress = new Map<string, any[]>();
      let lastDraftSave = 0;
      const DRAFT_INTERVAL_MS = 800;

      const sanitizeDraftProgressEvent = (raw: any, fallbackToolCallId?: string) => {
        if (!raw || typeof raw !== 'object') return null;
        const event = {
          ...raw,
          toolCallId: raw.toolCallId || fallbackToolCallId || '',
          timestamp: raw.timestamp || new Date().toISOString(),
        };
        if (event.screenshot) {
          event.screenshot = {
            ...event.screenshot,
            base64: '',
            screenshotPath: event.screenshot.screenshotPath || event.screenshotPath,
          };
        }
        if (!event.screenshotPath && event.screenshot?.screenshotPath) {
          event.screenshotPath = event.screenshot.screenshotPath;
        }
        return event;
      };

      const mergeDraftProgress = (existing: any[] = [], incoming: any[] = []) => {
        const seen = new Set<string>();
        const merged: any[] = [];
        for (const raw of [...existing, ...incoming]) {
          const event = sanitizeDraftProgressEvent(raw);
          if (!event) continue;
          const key = [
            event.toolCallId || '',
            event.type || '',
            event.timestamp || '',
            event.stepNumber ?? ''
          ].join('|');
          if (seen.has(key)) continue;
          seen.add(key);
          merged.push(event);
        }
        return merged.slice(-100);
      };

      const attachDraftProgress = (toolCall: any) => {
        const toolCallId = toolCall?.id || toolCall?.toolCallId || toolCall?.tool_call_id;
        if (!toolCallId) return toolCall;
        const progress = mergeDraftProgress(toolCall.subAgentProgress || [], draftSubAgentProgress.get(toolCallId) || []);
        if (progress.length === 0) return toolCall;
        const screenshotPaths = progress
          .map((event: any) => event.screenshotPath || event.screenshot?.screenshotPath)
          .filter((p: any) => typeof p === 'string' && p.length > 0);
        const existingPaths = Array.isArray(toolCall.data?.screenshotPaths) ? toolCall.data.screenshotPaths : [];
        const mergedPaths = Array.from(new Set([...existingPaths, ...screenshotPaths]));
        return {
          ...toolCall,
          subAgentProgress: progress,
          data: mergedPaths.length > 0
            ? { ...(toolCall.data || {}), screenshotPaths: mergedPaths }
            : toolCall.data,
        };
      };

      let fullResponse = '';
      let lastMissionTimeline: any = null;

      const saveDraft = async () => {
        if (!convId || (!draftContent && draftToolCalls.length === 0 && !thoughtBuffer)) return;
        try {
          await dbOps.run(
            `INSERT OR REPLACE INTO messages
             (id, conversation_id, role, content, thought, reasoning_content, tool_calls, mission_timeline, order_index, created_at)
             VALUES (?, ?, 'assistant', ?, ?, ?, ?, ?, COALESCE((SELECT order_index FROM messages WHERE id = ?), (SELECT COUNT(*) FROM messages WHERE conversation_id = ?)), COALESCE((SELECT created_at FROM messages WHERE id = ?), ?))`,
            [
              msgId,
              convId,
              draftContent,
              thoughtBuffer || null,
              thoughtBuffer || null,
              draftToolCalls.length > 0 ? JSON.stringify(draftToolCalls.map(attachDraftProgress)) : null,
              lastMissionTimeline ? JSON.stringify(lastMissionTimeline) : null,
              msgId,
              convId,
              msgId,
              new Date().toISOString()
            ]
          );
          await dbOps.run(
            `INSERT OR IGNORE INTO conversations (id, title, provider, model, created_at, updated_at)
             VALUES (?, '[In Progress]', 'everfern', ?, ?, ?)`,
            [convId, requestedModel || 'unknown',
             new Date().toISOString(), new Date().toISOString()]
          );
          await dbOps.run(
            `UPDATE conversations SET updated_at = ? WHERE id = ?`,
            [new Date().toISOString(), convId]
          );
        } catch (e) {
          console.warn('[AgentIPC] Draft save error:', e);
        }
      };

      for await (const streamEvent of runner.runStream(userInput, history, requestedModel, request.conversationId, undefined, request.projectId, false, request.assistantMessageId, false, !!request.operatorMode, request.reasoningEffort)) {
        (globalThis as any).lastStreamEvent = streamEvent;
        if (globalAbortManager.streamAborted) {
          flushBuffers();
          try {
            const { getComputerOverlayManager } = require('../../computer-overlay');
            getComputerOverlayManager().hide();
          } catch (e) {
            console.error('[AgentIPC] Failed to hide overlay:', e);
          }
          safeSend('acp:stream-chunk', { delta: '\n\n🛑 Stopped by user.', done: true, conversationId: request.conversationId, assistantMessageId: request.assistantMessageId });
          break;
        }

        if (streamEvent.type === 'chunk') {
          chunkBuffer += streamEvent.content;
          fullResponse += streamEvent.content;
          draftContent += streamEvent.content;
          if (Date.now() - lastFlushTime >= FLUSH_INTERVAL_MS) flushBuffers();
          if (Date.now() - lastDraftSave > DRAFT_INTERVAL_MS) {
            lastDraftSave = Date.now();
            saveDraft().catch(() => {});
          }
        } else if (streamEvent.type === 'thought') {
          thoughtBuffer += streamEvent.content;
          if (Date.now() - lastFlushTime >= FLUSH_INTERVAL_MS) flushBuffers();
        } else if (streamEvent.type === 'tool_start') {
          const rawThought = thoughtBuffer;
          const explicitNarrative = (streamEvent.toolArgs as any)?._narrative ||
                                    (streamEvent.toolArgs as any)?.narrative ||
                                    (streamEvent.toolArgs as any)?.thought ||
                                    (streamEvent.toolArgs as any)?.reason;
          const aiNarrative = extractCleanNarrative(explicitNarrative, rawThought);
          const toolArgs = {
            ...(streamEvent.toolArgs || {}),
            ...(aiNarrative ? { _narrative: aiNarrative } : {})
          };

          safeSend('acp:tool-start', { 
            toolName: streamEvent.toolName, 
            toolArgs,
            toolCallId: (streamEvent as any).toolCallId,
            narrative: aiNarrative
          });
        } else if (streamEvent.type === 'tool_call') {
          const tcPayload = streamEvent.toolCall || {};
          const explicitNarrative = tcPayload?._narrative || tcPayload?.narrative || tcPayload?.thought || tcPayload?.args?._narrative;
          const aiNarrative = extractCleanNarrative(explicitNarrative, thoughtBuffer);
          const enrichedToolCall = {
            ...tcPayload,
            ...(aiNarrative ? { _narrative: aiNarrative } : {}),
            args: {
              ...(tcPayload.args || tcPayload.toolArgs || {}),
              ...(aiNarrative ? { _narrative: aiNarrative } : {})
            }
          };

          safeSend('acp:tool-call', enrichedToolCall);
          if (streamEvent.toolCall) {
            const tc = attachDraftProgress({
              ...enrichedToolCall,
              id: enrichedToolCall.id || enrichedToolCall.toolCallId || enrichedToolCall.tool_call_id,
            });
            const existingIdx = draftToolCalls.findIndex(t => t.id === tc.id);
            if (existingIdx >= 0) {
              draftToolCalls[existingIdx] = { ...draftToolCalls[existingIdx], ...tc };
            } else {
              draftToolCalls.push(tc);
            }
          }
        } else if (streamEvent.type === 'tool_update') {
          safeSend('acp:tool-update', {
            toolName: (streamEvent as any).toolName,
            toolCallId: (streamEvent as any).toolCallId,
            update: (streamEvent as any).update,
          });
        } else if (streamEvent.type === 'tool_call_start') {
          safeSend('acp:tool-call-start', { index: streamEvent.index, toolName: streamEvent.toolName });
        } else if (streamEvent.type === 'tool_call_chunk') {
          toolCallChunkBuffer.push({ index: streamEvent.index, argumentsDelta: streamEvent.argumentsDelta });
          if (Date.now() - lastFlushTime >= FLUSH_INTERVAL_MS) flushBuffers();
        } else if (streamEvent.type === 'tool_call_complete') {
          safeSend('acp:tool-call-complete', { index: streamEvent.index, toolName: streamEvent.toolName, arguments: streamEvent.arguments });
        } else if (streamEvent.type === 'mission_step_update') {
          lastMissionTimeline = (streamEvent as any).timeline || lastMissionTimeline;
          safeSend('acp:mission-step-update', {
            conversationId: (streamEvent as any).conversationId,
            step: (streamEvent as any).step,
            timeline: (streamEvent as any).timeline,
          });
        } else if (streamEvent.type === 'mission_phase_change') {
          lastMissionTimeline = (streamEvent as any).timeline || lastMissionTimeline;
          safeSend('acp:mission-phase-change', {
            conversationId: (streamEvent as any).conversationId,
            phase: (streamEvent as any).phase,
            timeline: (streamEvent as any).timeline,
          });
        } else if (streamEvent.type === 'mission_complete') {
          console.log('[AgentIPC] Mission complete event received');
          lastMissionTimeline = (streamEvent as any).timeline || lastMissionTimeline;
          safeSend('acp:mission-complete', {
            conversationId: (streamEvent as any).conversationId,
            timeline: (streamEvent as any).timeline,
            steps: (streamEvent as any).steps,
            thinkingDuration: (streamEvent as any).thinkingDuration,
            title: (streamEvent as any).title,
          });
        } else if (streamEvent.type === 'done') {
          flushBuffers();

          try {
            const { getComputerOverlayManager } = require('../../computer-overlay');
            getComputerOverlayManager().hide();
          } catch (e) {
            console.error('[AgentIPC] Failed to hide overlay:', e);
          }

          console.log('[AgentIPC] Execution complete, triggering cleanup sequence...');
          try {
            const cleanupStatus = await globalAbortManager.executeCleanupSequence();

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

          safeSend('acp:stream-chunk', { delta: '', done: true });
          await saveDraft();
          reflectAndRemember(history, userInput, fullResponse, client);
        } else if (streamEvent.type === 'subagent-progress') {
          const progressPayload = streamEvent.data !== undefined ? streamEvent.data : streamEvent;
          const toolCallId = String((streamEvent as any).toolCallId || progressPayload?.toolCallId || '');
          if (toolCallId) {
            const event = sanitizeDraftProgressEvent({ ...progressPayload, toolCallId }, toolCallId);
            if (event) {
              draftSubAgentProgress.set(
                toolCallId,
                mergeDraftProgress(draftSubAgentProgress.get(toolCallId) || [], [event])
              );
              draftToolCalls = draftToolCalls.map(attachDraftProgress);
              if (Date.now() - lastDraftSave > DRAFT_INTERVAL_MS) {
                lastDraftSave = Date.now();
                saveDraft().catch(() => {});
              }
            }
          }
          safeSend('acp:sub-agent-progress', progressPayload);
        } else if (streamEvent.type === 'local_execution_request') {
          const req = streamEvent as any;
          safeSend('acp:local-execution-request', {
            requestId: req.requestId,
            command: req.command,
            shellType: req.shellType,
            reason: req.reason,
            conversationId: req.conversationId,
            isHitlApproval: req.isHitlApproval,
          });
          try {
            showPermissionNotification({
              requestId: req.requestId,
              toolName: req.toolName || req.shellType || req.command,
              shellType: req.shellType,
              command: req.command,
              reason: req.reason,
              conversationId: req.conversationId,
            });
          } catch (notifErr) {
            console.error('[AgentIPC] Failed to show permission notification:', notifErr);
          }
        } else if (streamEvent.type === 'debate_event' && (streamEvent as any).debateEvent) {
          const de = (streamEvent as any).debateEvent;
          console.log('[AgentIPC] Forwarding debate event:', de.type, 'debateId:', de.debateId);
          safeSend('debate:stream', de);
        } else {
          const skippedTypes = new Set(['mission_step_update', 'mission_phase_change', 'mission_complete', 'done']);
          if (!skippedTypes.has(streamEvent.type)) {
            safeSend(`acp:${streamEvent.type.replace(/_/g, '-')}`, streamEvent);
          }
        }
      }
    } catch (error) {
      console.error('[AgentIPC] Stream Error:', error);
      try {
        const { getComputerOverlayManager } = require('../../computer-overlay');
        getComputerOverlayManager().hide();
      } catch (e) {}

      try {
        await globalAbortManager.executeCleanupSequence();
      } catch (cleanupErr) {
        console.error('[AgentIPC] Cleanup sequence error on stream crash:', cleanupErr);
      }

      safeSend('acp:stream-chunk', { delta: `\n\n[Error: ${String(error)}]`, done: true, conversationId: request.conversationId, assistantMessageId: request.assistantMessageId });
    }
  });
}
