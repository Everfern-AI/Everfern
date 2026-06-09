/**
 * EverFern Desktop — Agent Runner (AGI Edition)
 *
 * This is the main orchestration class for the autonomous agent.
 */

import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { AIClient } from '../../lib/ai-client';
import { getPooledAIClient, releasePooledAIClient } from '../../lib/ai-client';
import type { ToolDefinition, ChatMessage } from '../../lib/ai-client';
import { buildSystemMessages, getSlimSystemPromptAsync } from './system-prompt';
import { ChatHistoryStore } from '../../store/history';
import { AgentTool, ToolCallRecord, AgentRunnerConfig } from './types';
import { buildGraph } from './graph';
import { StreamEvent } from './state';
import { Skill, loadSkills, loadSkillsAsync } from './skills-loader';
import { getSkillsPath } from '../../lib/skills-sync';
import { lookupCache, saveCache } from '../../lib/cache';
import { globalSessionManager } from '../../acp/control-plane/manager.core';
import { getBaseTools } from './tools_manager';
import { loadPrompt } from '../../lib/prompt-sync';
import { TelemetryLogger } from '../helpers/telemetry-logger';
import { stateManager } from './state-manager';
import { globalAbortManager, AbortError } from './abort-manager';

// Tool Imports
import { plannerTool, updateStepTool, executionPlanTool } from '../tools/planner';
import { createComputerUseTool, captureScreen } from '../tools/computer-use';
import { getPiCodingTools } from '../tools/pi-tools';
import { systemFilesTool } from '../tools/system-files';
import { memorySaveTool } from '../tools/memory-save';
import { memorySearchTool } from '../tools/memory-search';
import { webSearchTool } from '../tools/web-search';
import { todoWriteTool } from '../tools/todo-write';
import { askUserTool } from '../tools/ask-user';
import { skillTool } from '../tools/skill-tool';
import { presentFilesTool } from '../tools/present-files';
import { NavisOrchestrator } from '../tools/navis/orchestrator';

// Lifecycle/Infra
import { getAgentEvents, emitLifecycle } from '../infra/agent-events';
import { sessionCreated } from '../sessions';

const DEFAULT_CONFIG: AgentRunnerConfig = {
  maxIterations: 100000,
  enableTerminal: true,
};

export class AgentRunner {
  public client: AIClient;
  public tools: AgentTool[];
  public config: AgentRunnerConfig;
  public skills: Skill[] = [];
  public completionGateRetries: number = 0;
  public currentConversationId?: string;
  /** Session key of the currently executing sub-agent (set by subagent-spawn.ts for depth tracking). */
  public currentAgentSessionKey?: string;
  public workspaceDir?: string;
  public projectId?: string;
  public telemetry: TelemetryLogger;
  public navisOrchestrator?: NavisOrchestrator;

  /** Session lock map to prevent concurrent execution on the same conversation */
  private static sessionLocks: Map<string, Promise<void>> = new Map();

  constructor(client: AIClient, config: Partial<AgentRunnerConfig> = {}) {
    this.client = client;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.skills = []; // Initialize empty, will be loaded asynchronously

    this.tools = getBaseTools(this);
    console.log(`[AgentRunner] Constructor: Initialized ${this.tools.length} base tools.`);

    // Start async initialization but don't block constructor
    this.initializePiTools();
    this.initializeSkills();
    this.telemetry = new TelemetryLogger(this.client.model, this.config.silent);
  }

  /**
   * Ensure all asynchronous tool/skill initialization is complete
   */
  public async waitForToolsReady() {
    console.log('[AgentRunner] 🔄 Waiting for tools/skills to be ready...');

    // Skills are already loaded in initializeSkills call from constructor
    // but we can ensure they are loaded here too if needed
    if (this.skills.length === 0) {
      await this.initializeSkills();
    }

    // Pi tools are already loaded in initializePiTools call from constructor
    await this.initializePiTools();

    console.log(`[AgentRunner] ✅ All tools ready. Total tools: ${this.tools.length}`);
  }

  /**
   * Initialize skills asynchronously to avoid blocking the event loop
   */
  private async initializeSkills() {
    try {
      if (this.skills.length > 0) return;
      this.skills = await loadSkillsAsync();
      console.log(`[AgentRunner] ✅ Skills loaded: ${this.skills.length}`);
    } catch (error) {
      console.error('[AgentRunner] Failed to load skills asynchronously:', error);
      this.skills = []; // Fallback to empty array
    }
  }

  private async initializePiTools() {
    try {
      const piTools = await getPiCodingTools();
      if (!this.tools.find(t => t.name === piTools[0].name)) {
        console.log(`[AgentRunner] 🔄 Registering ${piTools.length} Pi coding tools...`);
        this.tools.push(...piTools, this.createSpawnAgentTool());
        console.log(`[AgentRunner] ✅ Pi coding tools registered. Total tools: ${this.tools.length}`);
      }
    } catch (error) {
      console.error('[AgentRunner] Failed to initialize Pi tools:', error);
    }
  }

  /**
   * Get or create a pooled AI client for better performance
   * This ensures we reuse connections instead of creating new clients
   */
  public getClient(config?: { provider?: string; model?: string; apiKey?: string; baseUrl?: string }): AIClient {
    if (!config) {
      return this.client;
    }

    const targetProvider = (config.provider || this.client.provider) as any;
    const targetApiKey = config.apiKey || (targetProvider === this.client.provider ? this.client.apiKey : '');

    // Use pooled client for better performance
    return getPooledAIClient({
      provider: targetProvider,
      model: config.model || this.client.model,
      apiKey: targetApiKey,
      baseUrl: config.baseUrl
    });
  }

  /**
   * Release a pooled client back to the pool
   */
  public releaseClient(client: AIClient, config: { provider?: string; model?: string; apiKey?: string; baseUrl?: string }): void {
    if (client === this.client) {
      return; // Don't release the main client
    }

    const targetProvider = (config.provider || this.client.provider) as any;
    const targetApiKey = config.apiKey || (targetProvider === this.client.provider ? this.client.apiKey : '');

    releasePooledAIClient(client, {
      provider: targetProvider,
      model: config.model || this.client.model,
      apiKey: targetApiKey,
      baseUrl: config.baseUrl
    });
  }

  private createSpawnAgentTool(): AgentTool {
    const AGENT_TYPE_PROMPTS: Record<string, string> = {
      'coding-specialist': 'coding-specialist.md',
      'web-explorer': 'web-explorer.md',
      'data-analyst': 'data-analyst.md',
    };

    const AGENT_TYPE_TIMEOUT: Record<string, number> = {
      'web-explorer': 300000,
      'coding-specialist': 180000,
      'data-analyst': 180000,
      'generic': 120000,
    };

    return {
      name: 'spawn_agent',
      description: 'Launch a specialized sub-agent for parallel/independent tasks. Use agent_type to pick the right specialist. Keep nesting to 2 levels max.',
      parameters: {
        type: 'object',
        properties: {
          task: { type: 'string', description: 'Self-contained task for the sub-agent to accomplish.' },
          agent_type: { type: 'string', description: 'Type of specialist agent. Options: generic, coding-specialist, web-explorer, data-analyst.', enum: ['generic', 'coding-specialist', 'web-explorer', 'data-analyst'] },
          context: { type: 'string', description: 'Additional background information or constraints for the task.' },
          max_depth: { type: 'number', description: 'Maximum spawn depth (default: 2, max: 3)' }
        },
        required: ['task']
      },
      execute: async (args, onUpdate, emitEvent, toolCallId) => {
        // HARD GUARD: Sub-agents cannot spawn other agents
        if (this.currentAgentSessionKey) {
          const errorMsg = 'ERROR: Sub-agents cannot spawn other agents. You are a sub-agent yourself. Complete the task using your own available tools.';
          onUpdate?.(errorMsg);
          return { success: false, output: errorMsg };
        }

        const task = args.task as string;
        const agentType = (args.agent_type as string) || 'generic';
        const context = (args.context as string) || '';
        const maxDepth = Math.min((args.max_depth as number) || 2, 3);
        const agentId = crypto.randomUUID();
        const timeout = AGENT_TYPE_TIMEOUT[agentType] ?? 120000;

        onUpdate?.(`Spawning ${agentType} agent for: ${(task || '').substring(0, 80)}...`);

        if (emitEvent && toolCallId) {
          emitEvent({
            type: 'subagent-progress',
            toolCallId,
            timestamp: new Date().toISOString(),
            data: {
              type: 'step',
              toolCallId,
              timestamp: new Date().toISOString(),
              content: `[Subagent: ${agentType}] Task: ${(task || '').substring(0, 100)}...`
            }
          });
        }

        try {
          let parentHistory: Array<{ role: string; content: string | any[] }> = [];
          try {
            const chatHistoryStore = new ChatHistoryStore();
            const fullConversation = await chatHistoryStore.load(this.currentConversationId || 'default');

            if (fullConversation && fullConversation.messages.length > 0) {
              const reconstructed = reconstructFullHistory(fullConversation.messages, '');
              parentHistory = reconstructed.slice(-40);
              console.log(`[SubagentSpawn] Loaded ${parentHistory.length} messages from parent`);
            }
          } catch (historyErr) {
            console.warn('[SubagentSpawn] Failed to load parent history:', historyErr);
            parentHistory = [];
          }

          let systemPrompt: string | undefined;
          const promptFile = AGENT_TYPE_PROMPTS[agentType];
          if (promptFile) {
            systemPrompt = loadPrompt(promptFile) || undefined;
          }

          const { getSubagentSpawner } = await import('./subagent-spawn');
          const spawner = getSubagentSpawner();

          const spawnedAgent = await spawner.spawn({
            parentSessionId: this.currentConversationId || 'default',
            sponsorSessionKey: this.currentAgentSessionKey,
            task,
            agentType: agentType as any,
            context,
            model: this.client.model,
            maxDepth,
            parentHistory: parentHistory as Array<{ role: 'user' | 'assistant'; content: string | any[] }>,
            workspaceDir: this.workspaceDir,
            projectId: this.projectId,
            runner: this,
            toolCallId: toolCallId
          });

          const child = await spawner.waitForAgent(spawnedAgent.agentId, timeout);
          if (child && child.result) {
            return { success: true, output: `Sub-agent [${agentType}] (ID: ${spawnedAgent.agentId}):\n${child.result}` };
          }
          return { success: false, output: `Sub-agent failed: ${child?.error || 'Unknown error'}` };
        } catch (err) {
          return { success: false, output: `Spawn failed: ${err}` };
        }
      }
    };
  }

  /**
   * Abort the current execution
   * Requirement 1.1: Stop button shall immediately set the Stream_Abort_Flag to true
   */
  public abort(): void {
    globalAbortManager.setAborted();
    console.log('[AgentRunner] 🛑 Abort requested - execution will be terminated');
  }

  /**
   * Check if execution is currently aborted
   */
  public isAborted(): boolean {
    return globalAbortManager.streamAborted;
  }

  /**
   * Get abort timing information for debugging
   */
  public getAbortTiming(): { aborted: boolean; elapsedMs: number | null } {
    return globalAbortManager.getAbortTiming();
  }

  public shouldCaptureScreenshot(userInput: string | any[]): boolean {
    const text = typeof userInput === 'string' ? userInput : JSON.stringify(userInput);
    const explicitVisionKeywords = /take.*screenshot|capture.*screen|see.*screen|show.*screen|look.*at.*screen|view.*screen|desktop|click|open.*app|find.*icon|locate.*button|open.*window|minimize|maximize|close.*window|gui automation|computer use/i;
    return explicitVisionKeywords.test(text);
  }

  public _buildToolDefinitions(): ToolDefinition[] {
    const toolDefs: ToolDefinition[] = [];

    console.log(`[ToolDefinitions] Building tool definitions for ${this.tools.length} tools...`);

    for (const t of this.tools) {
      // Validate that tool has required properties
      if (!t.name || !t.description || !t.parameters) {
        console.warn(`[ToolDefinitions] Skipping tool with missing properties:`, {
          name: t.name || 'MISSING',
          hasDescription: !!t.description,
          hasParameters: !!t.parameters,
        });
        if (t.name === 'computer_use') {
          console.error(`[ToolDefinitions] ❌ CRITICAL: computer_use tool is missing required properties!`, {
            description: t.description ? 'present' : 'missing',
            parameters: t.parameters ? 'present' : 'missing'
          });
        }
        continue;
      }

      // Add valid tool definition
      toolDefs.push({
        name: t.name,
        description: t.description,
        parameters: t.parameters as Record<string, unknown>,
      });

      // Log computer_use tool specifically
      if (t.name === 'computer_use') {
        console.log(`[ToolDefinitions] ✅ computer_use tool included in definitions:`, {
          descLength: t.description.length,
          paramKeys: Object.keys(t.parameters.properties || {})
        });
      }
    }

    console.log(`[ToolDefinitions] Built ${toolDefs.length} tool definitions`);
    console.log(`[ToolDefinitions] Tool names: ${toolDefs.map(t => t.name).join(', ')}`);

    // Warn if computer_use is missing
    if (!toolDefs.find(t => t.name === 'computer_use')) {
      console.warn(`[ToolDefinitions] ⚠️ WARNING: computer_use tool is missing from tool definitions!`);
    }

    return toolDefs;
  }

  async run(
    userInput: string | any[],
    history: Array<{ role: 'user' | 'assistant'; content: string | any[] }>,
    model?: string,
    conversationId?: string,
    systemPromptOverride?: string,
    projectId?: string,
  ): Promise<{ response: string; toolCalls: ToolCallRecord[] }> {
    const stream = this.runStream(userInput, history, model, conversationId, systemPromptOverride, projectId);
    let lastResponse = '';
    let toolCalls: ToolCallRecord[] = [];
    for await (const event of stream) {
      if (event.type === 'done') break;
      if (event.type === 'chunk') lastResponse += event.content;
      if (event.type === 'tool_call') toolCalls.push(event.toolCall);
    }
    return { response: lastResponse, toolCalls };
  }

  async *runStream(
    userInput: string | any[],
    history: Array<{ role: 'user' | 'assistant'; content: string | any[] }>,
    model?: string,
    conversationId?: string,
    systemPromptOverride?: string,
    projectId?: string,
    isSubagent?: boolean,
    assistantMessageId?: string,
    isBackground?: boolean,
    operatorMode?: boolean,
  ): AsyncGenerator<StreamEvent, void, unknown> {
    // Reset abort state for new execution
    globalAbortManager.reset();

    const convId = conversationId || crypto.randomUUID();

    // UNITY: Ensure only one execution runs at a time for this conversation
    // This prevents clobbering state and "messages being wiped" due to race conditions
    const existingLock = AgentRunner.sessionLocks.get(convId);
    if (existingLock) {
      console.log(`[AgentRunner] ⏳ Waiting for existing execution on session ${convId} to finish...`);
      await existingLock;
    }

    let resolveLock: () => void;
    const lockPromise = new Promise<void>(resolve => { resolveLock = resolve; });
    AgentRunner.sessionLocks.set(convId, lockPromise);

    try {
      if (model) this.client.setModel(model);
      this.telemetry.setAgentId(this.client.model);
      this.projectId = projectId;

      if (projectId) {
        try {
          const { projectsStore } = await import('../../store/projects/projects');
          const project = await projectsStore.get(projectId);
          if (project) {
            this.workspaceDir = project.path;
            console.log(`[AgentRunner] 📂 Project context detected: ${project.name} (${project.path})`);
          }
        } catch (err) {
          console.warn(`[AgentRunner] Failed to resolve project ${projectId}:`, err);
        }
      }

      this.currentConversationId = convId;
      const sessionKey = `session:${convId}`;
      sessionCreated(sessionKey);
      emitLifecycle(sessionKey, 'session_started', { convId, model: this.client.model });

      // REAL-TIME PERSISTENCE: Initialize ChatHistoryStore and save initial user message
      const chatHistoryStore = new ChatHistoryStore();
      const textInput = typeof userInput === 'string' ? userInput : JSON.stringify(userInput);

      try {
        const existingConv = await chatHistoryStore.load(convId);
        if (!existingConv) {
          await chatHistoryStore.save({
            id: convId,
            title: textInput.slice(0, 60),
            provider: this.client.provider,
            model: this.client.model,
            projectId: projectId || null,
            messages: [
              {
                id: `msg-user-${Date.now()}`,
                role: 'user',
                content: textInput,
                created_at: new Date().toISOString()
              }
            ] as any,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          } as any);
        }
      } catch (err) {
        console.warn('[AgentRunner] Failed to initialize real-time persistence:', err);
      }

      // Check if this is a HITL approval/rejection response
      const isHitlResponse = textInput.includes('[HITL_APPROVED]') || textInput.includes('[HITL_REJECTED]');

      if (isHitlResponse) {
        const approved = textInput.includes('[HITL_APPROVED]');
        console.log(`[Runner] HITL response detected: ${approved ? 'APPROVED' : 'REJECTED'}`);

        // Try to find the request ID from state manager
        const state = stateManager.getState(convId);
        const interruptData = stateManager.getInterruptData(convId);
        let requestId = (interruptData as any)?.id;

        if (!requestId) {
          // Fallback: get the most recent pending HITL record from disk
          try {
            const { listHitlRecords } = await import('../../store/hitl');
            const records = listHitlRecords(convId);
            const pending = records.find(r => r.status === 'pending');
            if (pending) {
              requestId = pending.request.id;
              console.log(`[Runner] Falling back to disk pending request ID: ${requestId}`);
            }
          } catch (diskErr) {
            console.warn('[Runner] Failed to read pending HITL records from disk:', diskErr);
          }
        }

        if (requestId) {
          const { saveHitlResponse } = await import('../../store/hitl');
          const responseId = crypto.randomUUID();
          const timestamp = new Date().toISOString();

          saveHitlResponse({
            id: responseId,
            requestId,
            conversationId: convId,
            timestamp,
            approved,
            response: textInput,
          });

          console.log(`[Runner] HITL response saved: ${responseId} (${approved ? 'approved' : 'rejected'})`);
        } else {
          console.warn('[Runner] No pending HITL request ID found to resolve.');
        }
      }

      // Initialize mission tracker for timeline tracking
      const { getMissionTracker, clearMissionTracker } = await import('./mission-tracker');
      clearMissionTracker(convId);
      const missionTracker = getMissionTracker(convId);

      // Initialize duration tracker for thinking time tracking
      const { DurationTracker } = await import('./duration-tracker');
      const durationTracker = new DurationTracker();

      // Create eventQueue early so we can push status updates
      let pushResolver: any = null;
      const eventQueue: StreamEvent[] = [];
      const originalPush = eventQueue.push.bind(eventQueue);
      eventQueue.push = (...items: StreamEvent[]) => {
        const res = originalPush(...items);
        if (pushResolver) {
          pushResolver();
          pushResolver = null;
        }
        return res;
      };

      // Add initial mission steps
      missionTracker.addStep({
        id: 'step:triage',
        name: 'Analyzing Intent',
        description: 'Classifying user request and identifying task type',
        phase: 'triage',
      });

      // Setup mission tracker event emission to IPC
      missionTracker.onStepUpdate((step, timeline) => {
        eventQueue.push({
          type: 'mission_step_update',
          step,
          timeline,
        } as any); // Cast as any if type mismatch
      });

      missionTracker.onPhaseChange((phase, timeline) => {
        eventQueue.push({
          type: 'mission_phase_change',
          phase,
          timeline,
        } as any);
      });

      // Check Context Window before proceeding
      const { ContextWindowGuard } = await import('./context-window-guard');
      const guard = new ContextWindowGuard(this.client.model);
      const status = guard.check(history);
      if (status.level === 'critical') {
        history = guard.compactHistory(history);
        this.telemetry.warn(`Critical context pressure detected. Compacted history proactively (${status.estimatedTokens} tokens).`);
      }

      this.telemetry.begin(textInput);

      // Ensure all tools and skills are fully loaded before proceeding
      await this.waitForToolsReady();

      this.telemetry.updateSpinner('Pre-loading system prompt...');
      const platform = os.platform();

      // Ensure skills are loaded before building system prompt
      if (this.skills.length === 0) {
        console.log('[AgentRunner] Skills not yet loaded, loading now...');
        this.skills = await loadSkillsAsync();
      }

      // Reset abort state for new execution
      globalAbortManager.reset();

      // SWARM SYNC: Listen for sub-agent progress events to forward to the stream
      let removeProgressListener: (() => void) | undefined;
      if (!isSubagent) {
        const { getAgentEvents } = await import('../infra/agent-events');
        const swarmEvents = getAgentEvents(convId);

        removeProgressListener = swarmEvents.onStream('subagent-progress', (event: any) => {
          eventQueue.push({
            type: 'subagent-progress',
            toolCallId: event.data.toolCallId,
            timestamp: event.data.timestamp || new Date().toISOString(),
            data: { ...event.data, type: event.type }
          } as any);
        });
      }

      try {
        const shouldAbort = globalAbortManager.createShouldAbortCallback();
        let toolDefs = this._buildToolDefinitions();
        if (isSubagent) {
          toolDefs = toolDefs.filter(t => t.name !== 'spawn_agent');
        }
        const graph = await Promise.resolve().then(() => buildGraph(
          this,
          toolDefs,
          this.tools,
        ));



        let graphDone = false;
        let currentAssistantMsgId = assistantMessageId || `msg-ast-${Date.now()}`;
        let currentContent = '';
        let currentThought = '';
        let currentToolCalls: any[] = [];
        let lastSyncTime = 0;

        let isSaving = false;
        let pendingSave = false;

        const syncToDb = async (force = false) => {
          const now = Date.now();
          if (!force && now - lastSyncTime < 2000) return;

          if (isSaving) {
            pendingSave = true;
            return;
          }

          isSaving = true;
          pendingSave = false;
          lastSyncTime = now;

          try {
            await chatHistoryStore.save({
              id: convId,
              messages: [
                {
                  id: currentAssistantMsgId,
                  role: 'assistant',
                  content: currentContent,
                  thought: currentThought,
                  toolCalls: currentToolCalls,
                  missionTimeline: missionTracker.getTimeline(),
                }
              ] as any,
              isFullSave: false, // Flag to prevent deleting previous messages during partial saves
              updatedAt: new Date().toISOString()
            } as any);
          } catch (err) {
            console.warn('[AgentRunner] Real-time sync failed:', err);
          } finally {
            isSaving = false;
            if (pendingSave) {
              // Ensure we save the last state if a save was requested while we were busy
              setTimeout(() => syncToDb(true), 100);
            }
          }
        };

        (async () => {
          try {
            globalAbortManager.checkAbort();

            const threadConfig = {
              configurable: {
                thread_id: convId,
                executionContext: {
                  runner: this,
                  eventQueue,
                  missionTracker,
                  conversationId: convId,
                  shouldAbort,
                }
              },
              recursionLimit: 250
            };

            const currentState = await graph.getState(threadConfig);
            const { Command } = await import('@langchain/langgraph');

            globalAbortManager.checkAbort();

            if (currentState && currentState.next && currentState.next.length > 0) {
              console.log('[AgentRunner] 🔄 Resuming interrupted session...');
              this.telemetry.info(`Resuming session ${convId} from interrupted state...`);
              missionTracker.startStep('step:triage');
              await graph.invoke(new Command({ resume: textInput }), threadConfig);
            } else {
              console.log('[AgentRunner] 🔄 Starting new graph invocation...');

              // Only reconstruct history for NEW invocations
              // RESUMING invocations already have history in GraphState
              this.telemetry.updateSpinner('Compiling system messages...');
              const preloadedPrompt = await getSlimSystemPromptAsync(platform, convId, [], this.skills, projectId);
              const { messages: initialMessages } = await buildSystemMessages(history, userInput, platform, convId, [], systemPromptOverride || preloadedPrompt, projectId);

              // Reconstruction logic
              const chatHistoryStore = new ChatHistoryStore();
              try {
                const fullConversation = await chatHistoryStore.load(convId);
                if (fullConversation && fullConversation.messages.length > 0) {
                  const priorMessages = reconstructFullHistory(fullConversation.messages, userInput);
                  const maxMessages = 50;
                  const limitedPriorMessages = priorMessages.slice(-maxMessages);
                  const systemMessage = initialMessages[0];
                  const newUserMessage = initialMessages[initialMessages.length - 1];
                  initialMessages.length = 0;
                  initialMessages.push(systemMessage, ...limitedPriorMessages, newUserMessage);
                }
              } catch (err) {
                console.warn('[AgentRunner] Failed to load history:', err);
              }

              missionTracker.startStep('step:triage');
              await graph.invoke({
                messages: initialMessages,
                toolCallRecords: [],
                iterations: 0,
                pendingToolCalls: [],
                finalResponse: '',
                toolCallHistory: [],
                missionId: convId,
                missionTimeline: missionTracker.getTimeline(),
                missionSteps: missionTracker.getSteps(),
                currentStepId: 'step:triage',
                decompositionAttempts: 0,
                currentIntent: isBackground ? 'background_task' as any : undefined,
                operatorMode: !!operatorMode,
              }, threadConfig);
            }
          } catch (err) {
            // ... (error handling remains same)
            console.error('[AgentRunner] Graph Error:', err);
            const errorMsg = err instanceof Error ? err.message : String(err);
            if (err instanceof AbortError || errorMsg.includes('Execution aborted by user')) {
              eventQueue.push({ type: 'chunk', content: '\n\n🛑 Stopped by user.' });
              missionTracker.fail('Execution stopped by user');
            } else if (/recursion\s+limit|recursionLimit|GraphRecursion/i.test(errorMsg)) {
              const friendly = 'The agent stopped because the execution graph repeated too many steps without reaching a completion state. I prevented the runaway loop; narrow the target files or ask me to continue from the latest checkpoint.';
              eventQueue.push({ type: 'chunk', content: `\n\n⚠️ ${friendly}` });
              missionTracker.fail(friendly);
            } else {
              eventQueue.push({ type: 'chunk', content: `\n\n❌ **Error during execution:** ${errorMsg}` });
              missionTracker.fail(errorMsg);
            }
          } finally {
            graphDone = true;
            if (pushResolver) {
              pushResolver();
              pushResolver = null;
            }
          }
        })();

        // Register abort listener to wake up loop immediately
        const unbindAbort = globalAbortManager.onAbort(() => {
          if (pushResolver) {
            const r = pushResolver;
            pushResolver = null;
            r();
          }
        });

        try {
          while (true) {
            if (eventQueue.length > 0) {
              const hitlEventIndex = eventQueue.findIndex(e => e.type === 'hitl_request');
              let event: StreamEvent;
              if (hitlEventIndex !== -1) {
                event = eventQueue.splice(hitlEventIndex, 1)[0];
              } else {
                event = eventQueue.shift()!;
              }

              // Real-time persistence tracking
              if (event.type === 'chunk') {
                currentContent += event.content;
                await syncToDb();
              } else if (event.type === 'thought') {
                currentThought += event.content;
                durationTracker.onThoughtStart();
                await syncToDb();
              } else if (event.type === 'tool_call') {
                currentToolCalls.push({
                  id: (event as any).toolCall.toolCallId || crypto.randomUUID(),
                  toolName: (event as any).toolCall.toolName,
                  args: (event as any).toolCall.args,
                  result: (event as any).toolCall.result,
                  status: 'done'
                });
                await syncToDb(true); // Force sync on tool completion
              }

              yield event;
              continue; // Immediately check for more events
            }

            if (graphDone || globalAbortManager.streamAborted) {
              // Final check to ensure no events were pushed just before graphDone was set
              if (eventQueue.length === 0) break;
              continue;
            }

            // Wait for next push with built-in race protection
            // If items were pushed between the check above and this point, resolve immediately
            await new Promise<void>(r => {
              if (eventQueue.length > 0 || graphDone || globalAbortManager.streamAborted) return r();
              pushResolver = r;
            });
          }
        } finally {
          unbindAbort();
        }

        // Final sync after graph completes
        await syncToDb(true);

        await new Promise(r => setTimeout(r, 50));
        if (!missionTracker.getTimeline().isComplete && !missionTracker.getTimeline().error) {
          missionTracker.complete();

          // Yield any pending phase change events before mission_complete
          // This ensures the frontend receives the completion phase change
          while (eventQueue.length > 0) {
            const event = eventQueue.shift();
            if (event) {
              yield event;
            }
          }
        }

        const thinkingDuration = durationTracker.onMissionComplete();
        yield {
          type: 'mission_complete',
          timeline: missionTracker.getTimeline(),
          steps: missionTracker.getSteps(),
          thinkingDuration,
          title: 'Completed',
        };
        yield { type: 'done' };
      } finally {
        removeProgressListener?.();
      }
    } finally {
      // Check for pending HITL to decide whether to clean up the browser session
      try {
        const { listHitlRecords } = await import('../../store/hitl');
        const records = listHitlRecords(convId);
        const hasPendingHitl = records.some(r => r.status === 'pending');
        
        if (!hasPendingHitl) {
          console.log('[Runner] No pending HITL, closing browser sessions if any');
          const { BrowserSession } = await import('../tools/navis/session');
          const session = new BrowserSession();
          await session.close(true).catch(() => {});
        } else {
          console.log('[Runner] Pending HITL detected, keeping browser session alive');
        }
      } catch (err) {
        console.warn('[Runner] Failed to run final browser session cleanup:', err);
      }

      // Release session lock
      if (AgentRunner.sessionLocks.get(convId) === lockPromise) {
        AgentRunner.sessionLocks.delete(convId);
      }
      resolveLock!();
    }
  }
}

/**
 * Reconstruct full conversation history from stored ChatMessage entries.
 * Converts stored toolCalls back into the interleaved assistant+tool_calls and tool result format.
 * Skips the very last user message (it will be appended as userInput).
 */
function reconstructFullHistory(storedMessages: any[], currentUserInput: string | any[]): any[] {
  const reconstructed: any[] = [];

  // Skip the very last user message if it matches the current input
  const currentInputText = typeof currentUserInput === 'string' ? currentUserInput : JSON.stringify(currentUserInput);
  let messagesToProcess = storedMessages;

  // Remove the last user message if it matches current input (avoid duplication)
  if (storedMessages.length > 0) {
    const lastMsg = storedMessages[storedMessages.length - 1];
    if (lastMsg.role === 'user' && lastMsg.content === currentInputText) {
      messagesToProcess = storedMessages.slice(0, -1);
    }
  }

  // Pre-collect all existing tool message IDs to avoid duplication
  const existingToolMessageIds = new Set<string>();
  for (const m of messagesToProcess) {
    if (m.role === 'tool' && (m.tool_call_id || m.toolCallId)) {
      existingToolMessageIds.add(m.tool_call_id || m.toolCallId);
    }
  }

  for (const msg of messagesToProcess) {
    if (msg.toolCalls && msg.toolCalls.length > 0) {
      // This is an assistant message with tool calls
      // Ensure all tool calls have IDs and they are consistent.
      // We use the message ID + index to generate a STABLE ID if one is missing.
      const toolCallsWithIds = msg.toolCalls.map((tc: any, idx: number) => {
        const stableId = tc.id || tc.toolCallId || `call_${msg.id || 'stub'}_${idx}`;
        return {
          id: stableId,
          name: tc.toolName || tc.name,
          arguments: tc.args || tc.arguments || {},
          result: tc.result
        };
      });

      // First emit the assistant message with tool_calls array
      reconstructed.push({
        role: 'assistant',
        content: msg.content || '',
        reasoning_content: msg.reasoning_content || msg.thought,
        tool_calls: toolCallsWithIds.map((tc: any) => ({
          id: tc.id,
          name: tc.name,
          arguments: tc.arguments
        }))
      });

      // Then emit individual tool result messages ONLY if they are missing from the original history
      // We MUST provide a tool result for every tool call to satisfy LLM API requirements,
      // even if the tool was interrupted or failed to return a result.
      for (const tc of toolCallsWithIds) {
        if (!existingToolMessageIds.has(tc.id)) {
          reconstructed.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: tc.result
              ? (typeof tc.result === 'string' ? tc.result : JSON.stringify(tc.result))
              : JSON.stringify({ success: false, output: 'Tool execution was aborted by user or failed to return a result.' })
          });
          // Add to seen set to prevent further duplicates of this specific ID in this turn
          existingToolMessageIds.add(tc.id);
        }
      }
    } else {
      // Plain user/assistant/tool message - emit as-is
      // If it's a tool message, ensure it has an ID
      if (msg.role === 'tool' && !(msg.tool_call_id || msg.toolCallId)) {
        // This is a rare case where a tool message exists but has no ID.
        // Since we don't have its parent assistant message easily accessible here,
        // we hope it's rare. But for safety, we skip it as an orphan.
        console.warn('[Runner] Skipping orphan tool message with no ID');
        continue;
      }

      reconstructed.push({
        role: msg.role,
        content: msg.content,
        reasoning_content: msg.reasoning_content || msg.thought,
        tool_call_id: msg.tool_call_id || msg.toolCallId
      });
    }
  }

  return reconstructed;
}
