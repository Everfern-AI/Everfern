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
import { toolApprovalStore } from '../../store/tool-approvals';


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
import { NavisOrchestrator } from '../tools/navis/agent/orchestrator';

// Tool Truncator
import { truncateTools } from './tool-truncator';

// Lifecycle/Infra
import { getAgentEvents, emitLifecycle } from '../infra/agent-events';
import { sessionCreated } from '../sessions';

const DEFAULT_CONFIG: AgentRunnerConfig = {
  // Issue #4 Fix: 100000 was effectively no cap — a stuck agent could run for hours.
  // 250 is generous enough for any real task while preventing runaway loops.
  maxIterations: 250,
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
  /** Truncation metadata from the most recent tool-schema truncation (used by call_model to emit usage stats). */
  public lastTruncationDetails?: { toolSchemaTokens: number; truncatedTools: number; schemaTokenSavings: number };
  public workspaceDir?: string;
  public projectId?: string;
  public telemetry: TelemetryLogger;
  public navisOrchestrator?: NavisOrchestrator;
  public reasoningEffort?: string;

  /** Session lock map to prevent concurrent execution on the same conversation */
  private static sessionLocks: Map<string, Promise<void>> = new Map();

  /** Issue #2 Fix: Serialise initializePiTools() calls so concurrent invocations
   *  from the constructor and waitForToolsReady() share one promise instead of
   *  both reading the tools array as empty and double-registering tools. */
  private piToolsInitPromise: Promise<void> | null = null;

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
    // Issue #2 Fix: Serialize concurrent calls through a shared promise so that
    // if both the constructor and waitForToolsReady() fire simultaneously they
    // share a single initialization, preventing double-registered tools.
    if (this.piToolsInitPromise) return this.piToolsInitPromise;
    this.piToolsInitPromise = (async () => {
      try {
        const piTools = await getPiCodingTools();
        if (!this.tools.find(t => t.name === piTools[0]?.name)) {
          console.log(`[AgentRunner] 🔄 Registering ${piTools.length} Pi coding tools and swarm tools...`);
          this.tools.push(
            ...piTools,
            this.createSpawnAgentTool(),
            this.createSpawnSwarmTool(),
            this.createBroadcastSwarmFactTool(),
            this.createReadSwarmMemoryTool()
          );
          console.log(`[AgentRunner] ✅ Pi coding tools and swarm tools registered. Total tools: ${this.tools.length}`);
        }
      } catch (error) {
        console.error('[AgentRunner] Failed to initialize Pi tools:', error);
        // Reset so a subsequent call can try again
        this.piToolsInitPromise = null;
      }
    })();
    return this.piToolsInitPromise;
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
        const { getSubagentRegistry } = await import('./subagent-registry');
        const registry = getSubagentRegistry();
        const entry = this.currentAgentSessionKey ? registry.getBySessionKey(this.currentAgentSessionKey) : undefined;
        const currentDepth = entry ? entry.currentDepth : 0;
        const proposedDepth = currentDepth + 1;

        if (proposedDepth > 4) {
          const errorMsg = `ERROR: Max spawn depth ceiling (4) reached. You cannot spawn deeper sub-agents. Complete the task yourself.`;
          onUpdate?.(errorMsg);
          return { success: false, output: errorMsg };
        }

        const task = args.task as string;
        const agentType = (args.agent_type as string) || 'generic';
        const context = (args.context as string) || '';
        const maxDepth = Math.min((args.max_depth as number) || 2, 3);
        const timeout = AGENT_TYPE_TIMEOUT[agentType] ?? 120000;
        const emitSubagentPhase = (
          subagentEventType: 'phase_start' | 'phase_complete' | 'phase_error',
          agentId: string,
          data: Record<string, unknown> = {},
        ) => {
          if (!emitEvent) return;
          emitEvent({
            type: 'subagent_event',
            subagentEventType,
            phase: agentType,
            agent: agentType,
            toolCallId,
            timestamp: new Date().toISOString(),
            data: {
              agentId,
              description: task,
              agentType,
              toolCallId,
              ...data,
            },
          } as any);
        };

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

          emitSubagentPhase('phase_start', spawnedAgent.agentId, {
            initialMetrics: {
              mode: 'parallel',
              maxDepth,
            },
          });

          const child = await spawner.waitForAgent(spawnedAgent.agentId, timeout);
          if (child && child.result) {
            emitSubagentPhase('phase_complete', spawnedAgent.agentId, {
              output: child.result,
              metrics: {
                status: child.status,
                durationMs: child.completedAt ? child.completedAt - child.createdAt : undefined,
              },
            });
            return { success: true, output: `Sub-agent [${agentType}] (ID: ${spawnedAgent.agentId}):\n${child.result}` };
          }
          emitSubagentPhase('phase_error', spawnedAgent.agentId, {
            error: child?.error || 'Unknown error',
          });
          return { success: false, output: `Sub-agent failed: ${child?.error || 'Unknown error'}` };
        } catch (err) {
          if (toolCallId) {
            emitSubagentPhase('phase_error', toolCallId, {
              error: String(err),
            });
          }
          return { success: false, output: `Spawn failed: ${err}` };
        }
      }
    };
  }

  private createSpawnSwarmTool(): AgentTool {
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
      name: 'spawn_swarm',
      description: 'Launch a cohort of specialized sub-agents in parallel to perform independent tasks. Speeds up parallel operations.',
      parameters: {
        type: 'object',
        properties: {
          tasks: {
            type: 'array',
            description: 'Array of self-contained tasks for the sub-agents to accomplish in parallel.',
            items: {
              type: 'object',
              properties: {
                task: { type: 'string', description: 'Task description.' },
                agent_type: { type: 'string', description: 'Type of specialist agent. Options: generic, coding-specialist, web-explorer, data-analyst.', enum: ['generic', 'coding-specialist', 'web-explorer', 'data-analyst'] }
              },
              required: ['task']
            }
          },
          context: { type: 'string', description: 'Shared background information or constraints for all tasks.' },
          max_depth: { type: 'number', description: 'Maximum spawn depth (default: 2, max: 3)' }
        },
        required: ['tasks']
      },
      execute: async (args, onUpdate, emitEvent, toolCallId) => {
        const { getSubagentRegistry } = await import('./subagent-registry');
        const registry = getSubagentRegistry();
        const entry = this.currentAgentSessionKey ? registry.getBySessionKey(this.currentAgentSessionKey) : undefined;
        const currentDepth = entry ? entry.currentDepth : 0;
        const proposedDepth = currentDepth + 1;

        if (proposedDepth > 4) {
          const errorMsg = `ERROR: Max spawn depth ceiling (4) reached. Cannot spawn a parallel swarm.`;
          onUpdate?.(errorMsg);
          return { success: false, output: errorMsg };
        }

        const tasks = args.tasks as Array<{ task: string; agent_type?: string }>;
        const context = (args.context as string) || '';
        const maxDepth = Math.min((args.max_depth as number) || 2, 3);

        onUpdate?.(`Spawning swarm of ${tasks.length} agents in parallel...`);

        try {
          let parentHistory: Array<{ role: string; content: string | any[] }> = [];
          try {
            const chatHistoryStore = new ChatHistoryStore();
            const fullConversation = await chatHistoryStore.load(this.currentConversationId || 'default');

            if (fullConversation && fullConversation.messages.length > 0) {
              const reconstructed = reconstructFullHistory(fullConversation.messages, '');
              parentHistory = reconstructed.slice(-40);
            }
          } catch (historyErr) {
            console.warn('[SubagentSpawn] Failed to load parent history:', historyErr);
            parentHistory = [];
          }

          const { getSubagentSpawner } = await import('./subagent-spawn');
          const spawner = getSubagentSpawner();

          // Spawn all sub-agents in the swarm in parallel
          const spawnedAgents = await Promise.all(tasks.map(async (t) => {
            const agentType = t.agent_type || 'generic';
            let systemPrompt: string | undefined;
            const promptFile = AGENT_TYPE_PROMPTS[agentType];
            if (promptFile) {
              systemPrompt = loadPrompt(promptFile) || undefined;
            }

            return spawner.spawn({
              parentSessionId: this.currentConversationId || 'default',
              sponsorSessionKey: this.currentAgentSessionKey,
              task: t.task,
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
          }));

          // Emit phase start events for each spawned agent in the swarm
          spawnedAgents.forEach((sa) => {
            if (!emitEvent) return;
            emitEvent({
              type: 'subagent_event',
              subagentEventType: 'phase_start',
              phase: sa.agentType,
              agent: sa.agentType,
              toolCallId,
              timestamp: new Date().toISOString(),
              data: {
                agentId: sa.agentId,
                description: sa.task,
                agentType: sa.agentType,
                toolCallId,
                initialMetrics: { mode: 'parallel', maxDepth },
              },
            } as any);
          });

          // Wait for all sub-agents to complete in parallel
          const results = await Promise.all(spawnedAgents.map(async (sa) => {
            const timeout = AGENT_TYPE_TIMEOUT[sa.agentType] ?? 120000;
            try {
              const child = await spawner.waitForAgent(sa.agentId, timeout);
              if (child && child.result) {
                if (emitEvent) {
                  emitEvent({
                    type: 'subagent_event',
                    subagentEventType: 'phase_complete',
                    phase: sa.agentType,
                    agent: sa.agentType,
                    toolCallId,
                    timestamp: new Date().toISOString(),
                    data: {
                      agentId: sa.agentId,
                      output: child.result,
                      metrics: {
                        status: child.status,
                        durationMs: child.completedAt ? child.completedAt - child.createdAt : undefined,
                      },
                    },
                  } as any);
                }
                return { agentId: sa.agentId, type: sa.agentType, success: true, result: child.result };
              }
              if (emitEvent) {
                emitEvent({
                  type: 'subagent_event',
                  subagentEventType: 'phase_error',
                  phase: sa.agentType,
                  agent: sa.agentType,
                  toolCallId,
                  timestamp: new Date().toISOString(),
                  data: { agentId: sa.agentId, error: child?.error || 'Unknown error' },
                } as any);
              }
              return { agentId: sa.agentId, type: sa.agentType, success: false, error: child?.error || 'Unknown error' };
            } catch (err) {
              if (emitEvent) {
                emitEvent({
                  type: 'subagent_event',
                  subagentEventType: 'phase_error',
                  phase: sa.agentType,
                  agent: sa.agentType,
                  toolCallId,
                  timestamp: new Date().toISOString(),
                  data: { agentId: sa.agentId, error: String(err) },
                } as any);
              }
              return { agentId: sa.agentId, type: sa.agentType, success: false, error: String(err) };
            }
          }));

          const successCount = results.filter(r => r.success).length;
          const outputString = results.map((r, i) => {
            const status = r.success ? 'SUCCESS' : 'FAILED';
            const details = r.success ? r.result : r.error;
            return `--- Swarm Agent #${i + 1} [ID: ${r.agentId}] [Type: ${r.type}] [Status: ${status}] ---\n${details}`;
          }).join('\n\n');

          onUpdate?.(`Parallel swarm execution finished. Successful: ${successCount}/${tasks.length}`);
          return { success: successCount > 0, output: outputString };
        } catch (err) {
          return { success: false, output: `Swarm execution failed: ${err}` };
        }
      }
    };
  }

  private createBroadcastSwarmFactTool(): AgentTool {
    return {
      name: 'broadcast_swarm_fact',
      description: 'Broadcast a critical fact or finding to the shared real-time swarm memory bus so all active sibling agents can immediately see it.',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', description: 'The category of the fact. Options: fact, goal_update, error, pivot.', enum: ['fact', 'goal_update', 'error', 'pivot'] },
          content: { type: 'string', description: 'The key findings or updates to share with other agents in the swarm.' }
        },
        required: ['content']
      },
      execute: async (args, onUpdate) => {
        const type = (args.type as any) || 'fact';
        const content = args.content as string;
        
        try {
          const { getSwarmMemory } = await import('./swarm-memory');
          const swarm = getSwarmMemory();
          
          const agentId = this.currentAgentSessionKey || 'commander';
          const parentSessionId = this.currentConversationId || 'default';
          
          swarm.broadcast({
            sourceAgentId: agentId,
            sessionId: parentSessionId,
            type,
            content
          });
          
          onUpdate?.(`Successfully broadcast fact to the swarm memory.`);
          return { success: true, output: `Successfully broadcast: "${content}"` };
        } catch (err) {
          return { success: false, output: `Failed to broadcast: ${err}` };
        }
      }
    };
  }

  private createReadSwarmMemoryTool(): AgentTool {
    return {
      name: 'read_swarm_memory',
      description: 'Query the shared real-time swarm memory bus to read findings and facts broadcasted by sibling sub-agents.',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      },
      execute: async (args, onUpdate) => {
        try {
          const { getSwarmMemory } = await import('./swarm-memory');
          const swarm = getSwarmMemory();
          const parentSessionId = this.currentConversationId || 'default';
          
          const facts = swarm.getMemory(parentSessionId);
          if (facts.length === 0) {
            return { success: true, output: 'Swarm memory is currently empty. No facts have been broadcasted yet.' };
          }
          
          const formatted = facts.map(f => {
            const date = new Date(f.timestamp).toLocaleTimeString();
            return `[${date}] [Agent: ${f.sourceAgentId}] [Type: ${f.type}]: ${f.content}`;
          }).join('\n');
          
          return { success: true, output: `Current Swarm Memory Bus:\n${formatted}` };
        } catch (err) {
          return { success: false, output: `Failed to read swarm memory: ${err}` };
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
    reasoningEffort?: string,
  ): AsyncGenerator<StreamEvent, void, unknown> {
    this.reasoningEffort = reasoningEffort;
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

    // Issue #1 Fix: Initialize resolveLock to a no-op so that if an early error
    // occurs before the Promise constructor executes the callback, the finally
    // block's resolveLock() call never throws, preventing an eternal session lock.
    let resolveLock: () => void = () => {};
    const lockPromise = new Promise<void>(resolve => { resolveLock = resolve; });
    AgentRunner.sessionLocks.set(convId, lockPromise);

    let syncToDb: ((force?: boolean) => Promise<void>) | undefined;
    // Issue #21 Fix: Track whether telemetry.terminate() was already called on the
    // success path (inside the inner try) so the outer finally doesn't fire a second
    // terminate() and emit duplicate telemetry events. missionTracker is scoped
    // to the inner block and cannot be referenced here directly.
    let telemetryTerminated = false;

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

      if (!textInput || !textInput.trim()) {
        console.warn('[AgentRunner] Empty textInput received — aborting stream to prevent blank LLM prompt');
        yield { type: 'chunk', content: '⚠️ No message content received. Please try again.' };
        yield { type: 'done' };
        return;
      }

      let initialMessageCount = 0;
      try {
        const existingConv = await chatHistoryStore.load(convId);
        if (existingConv) {
          initialMessageCount = existingConv.messages.length;
        } else {
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
          initialMessageCount = 1;
        }
      } catch (err) {
        console.warn('[AgentRunner] Failed to initialize real-time persistence:', err);
      }

      // Check if this is a HITL approval/rejection response
      // BUG-17 FIX: Use exact structured markers or full option strings only.
      // Previously, bare 'Reject' substring matched normal messages like
      // "Don't reject the hypothesis".
      const isHitlResponse = textInput.includes('[HITL_APPROVED]') ||
                             textInput.includes('[HITL_APPROVED_ALWAYS]') ||
                             textInput.includes('[HITL_APPROVED_PREFIX]') ||
                             textInput.includes('[HITL_REJECTED]') ||
                             textInput.includes('[Form Response]') ||
                             textInput.includes('✅ Approve — proceed once') ||
                             textInput.includes('🚀 Approve & Allow Always') ||
                             textInput.includes('📂 Approve & Allow Prefix') ||
                             textInput.includes('❌ Reject — cancel and do not proceed');

      if (isHitlResponse) {
        const approved = textInput.includes('[HITL_APPROVED]') ||
                         textInput.includes('[HITL_APPROVED_ALWAYS]') ||
                         textInput.includes('[HITL_APPROVED_PREFIX]') ||
                         textInput.includes('✅ Approve — proceed once') ||
                         textInput.includes('🚀 Approve & Allow Always') ||
                         textInput.includes('📂 Approve & Allow Prefix');
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
          conversationId: convId,
          step,
          timeline,
        } as any); // Cast as any if type mismatch
      });

      missionTracker.onPhaseChange((phase, timeline) => {
        eventQueue.push({
          type: 'mission_phase_change',
          conversationId: convId,
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

      // BUG-05 FIX: Removed duplicate globalAbortManager.reset() that was here.
      // The first reset at line 702 is sufficient. A second reset here can race
      // with the async graph invocation IIFE, clearing an abort signal that was
      // set between the two resets and also wiping abort listeners.

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

        // Dynamic Tool-Schema Truncator: strip irrelevant tool definitions
        {
          const recentAssistant = history
            .filter((m) => m.role === 'assistant')
            .slice(-3)
            .map((m) => (typeof m.content === 'string' ? m.content : ''))
            .join('\n');
          const userText = typeof userInput === 'string' ? userInput : userInput.map((p: any) => p.text || '').filter(Boolean).join(' ');
          const truncated = truncateTools(toolDefs, userText, recentAssistant);
          toolDefs = truncated.tools;
          this.lastTruncationDetails = {
            toolSchemaTokens: truncated.details.totalSchemaTokens,
            truncatedTools: truncated.details.toolsRemoved,
            schemaTokenSavings: truncated.details.totalSchemaTokens - truncated.details.keptSchemaTokens,
          };
        }

        let currentDepth = 0;
        if (this.currentAgentSessionKey) {
          try {
            const { getSubagentRegistry } = await import('./subagent-registry');
            const registry = getSubagentRegistry();
            const entry = registry.getBySessionKey(this.currentAgentSessionKey);
            if (entry) {
              currentDepth = entry.currentDepth;
            }
          } catch (e) {
            console.warn('[AgentRunner] Failed to fetch current agent depth:', e);
          }
        }
        if (isSubagent && currentDepth >= 4) {
          toolDefs = toolDefs.filter(t => t.name !== 'spawn_agent' && t.name !== 'spawn_swarm');
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
        const currentSubAgentProgress = new Map<string, any[]>();
        let lastSyncTime = 0;

        const sanitizeProgressEventForPersistence = (raw: any, fallbackToolCallId?: string) => {
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

        const mergeProgressEvents = (existing: any[] = [], incoming: any[] = []) => {
          const seen = new Set<string>();
          const merged: any[] = [];
          for (const raw of [...existing, ...incoming]) {
            const event = sanitizeProgressEventForPersistence(raw);
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

        const attachProgressToToolCall = (toolCall: any) => {
          const toolCallId = toolCall?.id || toolCall?.toolCallId || toolCall?.tool_call_id;
          if (!toolCallId) return toolCall;
          const progress = mergeProgressEvents(toolCall.subAgentProgress || [], currentSubAgentProgress.get(toolCallId) || []);
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

        let isSaving = false;
        let pendingSave = false;

        syncToDb = async (force = false) => {
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
                  toolCalls: currentToolCalls.map(attachProgressToToolCall),
                  missionTimeline: missionTracker.getTimeline(),
                  orderIndex: initialMessageCount,
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
              setTimeout(() => syncToDb?.(true), 100);
            }
          }
        };

        (async () => {
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
          let activeSanitizedMessages: any[] = [];

          try {
            globalAbortManager.checkAbort();

            const currentState = await graph.getState(threadConfig);
            const { Command } = await import('@langchain/langgraph');

            globalAbortManager.checkAbort();

            const isWaitingForAnswer = stateManager.isInterrupted(convId) && !!stateManager.getInterruptData(convId);
            const shouldResume = isHitlResponse || isWaitingForAnswer;

            if (shouldResume) {
              console.log('[AgentRunner] 🔄 Resuming interrupted session...');
              this.telemetry.info(`Resuming session ${convId} from interrupted state...`);

              // Restore mission tracker timeline from persisted state if available
              const persistedTimeline = currentState?.values?.missionTimeline;
              const persistedSteps = currentState?.values?.missionSteps;
              if (persistedTimeline && persistedSteps) {
                missionTracker.restoreTimeline(persistedTimeline, persistedSteps);
              }

              // Create a resume config that sets isResuming flag in the execution context
              const resumeConfig = {
                ...threadConfig,
                configurable: {
                  ...threadConfig.configurable,
                  executionContext: {
                    ...threadConfig.configurable.executionContext,
                    isResuming: true,
                  }
                }
              };

              try {
                await graph.invoke(new Command({ resume: textInput }), resumeConfig);
                stateManager.resumeFromInterrupt(convId, textInput);
              } catch (resumeErr: any) {
                console.warn('[AgentRunner] Resume via Command finished or error occurred in graph:', resumeErr);
                stateManager.resumeFromInterrupt(convId, textInput);

                const errStr = resumeErr instanceof Error ? resumeErr.message : (typeof resumeErr === 'object' ? JSON.stringify(resumeErr) : String(resumeErr));
                const isRateLimit = /429|daily_limit_reached|rate_limit|quota|limit_exceeded/i.test(errStr);
                const isApiError = isRateLimit || /401|403|500|502|503|504|invalid_api_key|authentication/i.test(errStr);

                if (isApiError) {
                  let userFacingErr = errStr;
                  if (isRateLimit) {
                    userFacingErr = "You have reached your tier's daily token limit or API rate limit (429 Too Many Requests). Your usage resets at midnight, or you can upgrade for higher limits.";
                  }
                  eventQueue.push({
                    type: 'chunk',
                    content: `\n\n⚠️ **API Error (429 Rate Limit Exceeded):** ${userFacingErr}`
                  });
                  if (missionTracker) missionTracker.fail(userFacingErr);
                } else if (isHitlResponse) {
                  const approved = textInput.includes('[HITL_APPROVED]') ||
                                   textInput.includes('[HITL_APPROVED_ALWAYS]') ||
                                   textInput.includes('[HITL_APPROVED_PREFIX]') ||
                                   textInput.includes('Approve');
                  eventQueue.push({
                    type: 'chunk',
                    content: approved
                      ? '\n\n✅ Security approval recorded.'
                      : '\n\n❌ Action rejected by user. Operation cancelled.'
                  });
                  missionTracker.completeStep('step:hitl');
                }
              }
            } else {
              console.log('[AgentRunner] 🔄 Starting new graph invocation for user message...');
              stateManager.resumeFromInterrupt(convId, null);

              // Guard against treating leftover HITL responses as new user prompts
              if (isHitlResponse) {
                console.log('[AgentRunner] 🛡️ Ignored standalone HITL form response in new graph invocation');
                // Issue #22 Fix: Removed bare 'Approve' substring — it matched
                // real user messages like "I don't approve of this approach".
                // Only structured markers are reliable HITL approval indicators.
                const approved = textInput.includes('[HITL_APPROVED]') || textInput.includes('[HITL_APPROVED_ALWAYS]') ||
                                 textInput.includes('[HITL_APPROVED_PREFIX]') ||
                                 textInput.includes('✅ Approve — proceed once') ||
                                 textInput.includes('🚀 Approve & Allow Always') ||
                                 textInput.includes('📂 Approve & Allow Prefix');
                eventQueue.push({
                  type: 'chunk',
                  content: approved ? '\n\n✅ Security approval recorded.' : '\n\n❌ Action rejected by user. Operation cancelled.'
                });
                return;
              }

              // Only reconstruct history for NEW invocations
              // RESUMING invocations already have history in GraphState
              this.telemetry.updateSpinner('Compiling system messages...');
              const preloadedPrompt = await getSlimSystemPromptAsync(platform, convId, [], this.skills, projectId);
              let promptText = systemPromptOverride || preloadedPrompt;
              if (this.reasoningEffort === 'ultra-delegate') {
                promptText += "\n\nCRITICAL SYSTEM INSTRUCTION: You are in ULTRA DELEGATION MODE. You must aggressively delegate sub-tasks to independent specialized sub-agents by calling the `spawn_agent` tool. Break down any complex task into components and spawn sub-agents for them immediately. Do not attempt to execute multi-file edits, complex searches, or large terminal sequences yourself; instead, spawn dedicated sub-agents to handle these tasks in parallel and coordinate their results.";
              }
              // Continuation context injection: expand short prompts like "continue" or "yes build it" with the original goal
              let activeUserInput = userInput;
              const userStr = typeof userInput === 'string' ? userInput : (Array.isArray(userInput) ? JSON.stringify(userInput) : String(userInput));
              // Issue #16 Fix: Removed 'the apop' (OCR artifact) from the pattern.
              // Also added a minimum word-length guard: single-word 'yes'/'ok' are
              // fine, but multi-word phrases are only matched if they appear exactly.
              const isShortContinuation = /^(continue|yes|go ahead|do it|keep going|ok|okay|yes build it|build it|proceed)$/i.test(userStr.trim());
              
              const { messages: builtInitialMessages } = await buildSystemMessages(history, activeUserInput, platform, convId, [], promptText, projectId);
              let initialMessages = [...builtInitialMessages];

              const chatHistoryStore = new ChatHistoryStore();
              try {
                const fullConversation = await chatHistoryStore.load(convId);
                if (fullConversation && fullConversation.messages.length > 0) {
                  const priorMessages = reconstructFullHistory(fullConversation.messages, activeUserInput);
                  
                  // Preserve the first user message if it exists (the initial prompt/task request)
                  const firstMessage = priorMessages.length > 0 ? priorMessages[0] : null;
                  const hasFirstUserMsg = firstMessage && firstMessage.role === 'user';

                  if (isShortContinuation && hasFirstUserMsg && typeof firstMessage.content === 'string') {
                    const originalTask = firstMessage.content.slice(0, 400).replace(/[\r\n]+/g, ' ').trim();
                    console.log(`[AgentRunner] 🧠 Short continuation detected ("${userStr}"). Injecting original task objective: "${originalTask.slice(0, 80)}..."`);
                    activeUserInput = `[User Continuation Request for Task: "${originalTask}"] ${userStr}`;
                    const rebuilt = await buildSystemMessages(history, activeUserInput, platform, convId, [], promptText, projectId);
                    initialMessages = rebuilt.messages;
                  }
                  
                  const maxMessages = 20;
                  let limitedPriorMessages: any[];
                  if (priorMessages.length > maxMessages) {
                    const sliceStart = priorMessages.length - maxMessages;
                    limitedPriorMessages = priorMessages.slice(sliceStart);
                    if (hasFirstUserMsg && sliceStart > 0) {
                      // Prepend the first user message so the agent remembers the original task
                      limitedPriorMessages.unshift(firstMessage);
                    }
                  } else {
                    limitedPriorMessages = priorMessages;
                  }
                  
                  const systemMessage = initialMessages[0];
                  const newUserMessage = initialMessages[initialMessages.length - 1];
                  initialMessages = [systemMessage, ...limitedPriorMessages, newUserMessage];
                }
              } catch (err) {
                console.warn('[AgentRunner] Failed to load history:', err);
              }

              const sanitizedInitialMessages = sanitizeMessagesRoleAlternation(initialMessages);
              activeSanitizedMessages = sanitizedInitialMessages;

              // Inject truncation awareness into the system message
              if (this.lastTruncationDetails && this.lastTruncationDetails.truncatedTools > 0) {
                const sysMsg = sanitizedInitialMessages[0];
                if (sysMsg && typeof sysMsg.content === 'string') {
                  const allToolNames = this.tools
                    .filter(t => t.name && t.description)
                    .map(t => `- **${t.name}**: ${t.description.split('\n')[0].substring(0, 100)}`);
                  sysMsg.content += `\n\n**Available Tool Registry (${this.tools.length} tools):**\n${allToolNames.join('\n')}\n\n> To optimize your context window, ${this.lastTruncationDetails.truncatedTools} tools were omitted from your active tool set (only the most relevant were kept). If you need a tool listed above that isn't currently available, explicitly mention it by name and describe why you need it so it can be made available.`;
                }
              }

              missionTracker.startStep('step:triage');
              await graph.invoke({
                messages: sanitizedInitialMessages,
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
                isScheduledTaskRun: !!isBackground,
                operatorMode: !!operatorMode,
                codingComplete: false,
                dataAnalysisComplete: false,
                webExplorerComplete: false,
                deepResearchComplete: false,
                computerUseComplete: false,
                completionSignal: null,
                routingDecision: null,
                decomposedTask: undefined,
                returningFromSpecialist: null,
              }, threadConfig);
            }
          } catch (err) {
            console.error('[AgentRunner] Graph Error:', err);
            const errorMsg = err instanceof Error ? err.message : (typeof err === 'object' ? JSON.stringify(err) : String(err));

            if (errorMsg.includes('pregelTaskId')) {
              console.log('[AgentRunner] 🔄 Detected Pregel checkpointer task collision from previous turn. Auto-healing with fresh thread context...');
              const freshConfig = {
                ...threadConfig,
                configurable: {
                  ...threadConfig.configurable,
                  thread_id: `${convId}_t_${Date.now()}`
                }
              };
              try {
                await graph.invoke({
                  messages: activeSanitizedMessages,
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
                  isScheduledTaskRun: !!isBackground,
                  operatorMode: !!operatorMode,
                  codingComplete: false,
                  dataAnalysisComplete: false,
                  webExplorerComplete: false,
                  deepResearchComplete: false,
                  computerUseComplete: false,
                  completionSignal: null,
                  routingDecision: null,
                  decomposedTask: undefined,
                  returningFromSpecialist: null,
                }, freshConfig);
                return;
              } catch (retryErr: any) {
                console.error('[AgentRunner] Auto-heal retry graph execution error:', retryErr);
              }
            }

            const isRateLimit = /429|daily_limit_reached|rate_limit|quota|limit_exceeded/i.test(errorMsg);
            if (err instanceof AbortError || errorMsg.includes('Execution aborted by user')) {
              eventQueue.push({ type: 'chunk', content: '\n\n🛑 Stopped by user.' });
              missionTracker.fail('Execution stopped by user');
            } else if (isRateLimit) {
              const friendly = "You have reached your tier's daily output token limit or API rate limit (429 Too Many Requests). Your quota will reset at midnight, or you can upgrade to Pro / Max for higher limits.";
              eventQueue.push({ type: 'chunk', content: `\n\n⚠️ **API Error (429 Rate Limit Exceeded):** ${friendly}` });
              missionTracker.fail(friendly);
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
                currentToolCalls.push(attachProgressToToolCall({
                  id: (event as any).toolCall.toolCallId || (event as any).toolCall.id || crypto.randomUUID(),
                  toolName: (event as any).toolCall.toolName,
                  args: (event as any).toolCall.args,
                  result: (event as any).toolCall.result,
                  status: 'done'
                }));
                await syncToDb(true); // Force sync on tool completion
              } else if (event.type === 'subagent-progress') {
                const toolCallId = String((event as any).toolCallId || (event as any).data?.toolCallId || '');
                if (toolCallId) {
                  const progressEvent = sanitizeProgressEventForPersistence(
                    { ...((event as any).data || {}), toolCallId },
                    toolCallId
                  );
                  if (progressEvent) {
                    currentSubAgentProgress.set(
                      toolCallId,
                      mergeProgressEvents(currentSubAgentProgress.get(toolCallId) || [], [progressEvent])
                    );
                    currentToolCalls = currentToolCalls.map(attachProgressToToolCall);
                    await syncToDb();
                  }
                }
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
        const success = !missionTracker.getTimeline().error && !globalAbortManager.streamAborted;
        this.telemetry.terminate(success, currentContent || undefined);
        telemetryTerminated = true;

        yield {
          type: 'mission_complete',
          conversationId: convId,
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
      // Issue #21 Fix: Only terminate telemetry in the outer finally if it was not
      // already called on the success path (tracked by telemetryTerminated flag).
      // missionTracker is scoped to the inner try block and cannot be referenced here.
      if (!telemetryTerminated) {
        this.telemetry.terminate(false);
      }
      
      // Ensure the final state of the assistant message and timeline is persisted on errors/aborts
      if (syncToDb) {
        syncToDb(true).catch((syncErr: any) => {
          console.warn('[AgentRunner] Final syncToDb in outer finally block failed:', syncErr);
        });
      }

      // Check for pending HITL to decide whether to clean up the browser session
      try {
        const { listHitlRecords } = await import('../../store/hitl');
        const records = listHitlRecords(convId);
        const hasPendingHitl = records.some(r => r.status === 'pending');
        
        // Issue #11 Fix: Only attempt browser cleanup if the NavisOrchestrator was
        // actually used in this session. Unconditionally instantiating BrowserSession
        // fires Chromium cleanup on every stream end (even text-only sessions) and
        // can throw on systems without Chromium, blocking the session lock release.
        if (!hasPendingHitl && this.navisOrchestrator) {
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
      // Issue #17 Fix: Always delete the entry so sessionLocks doesn't grow
      // without bound (one entry per completed conversation = memory leak).
      // Issue #5 Fix: Use resolveLock() instead of resolveLock!() — the '!' is
      // a TypeScript lie; we initialise it to a safe no-op above so it never throws.

      // Issue #15 Fix: Clear session-scoped tool approval policies so that
      // 'allow for this session' HITL approvals don't persist into future sessions.
      try {
        toolApprovalStore.clearSessionPolicies(convId);
      } catch (policyErr) {
        console.warn('[Runner] Failed to clear session approval policies:', policyErr);
      }

      AgentRunner.sessionLocks.delete(convId);
      resolveLock();

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

  // Issue #10 Fix: Normalize both sides to string before comparing.
  // For multimodal inputs (any[]), JSON.stringify is used but the stored content
  // may have been serialized differently. Normalize whitespace to avoid missed dedup.
  const normalizeContent = (c: unknown): string => {
    if (typeof c === 'string') return c.trim();
    try { return JSON.stringify(c); } catch { return String(c); }
  };
  const currentInputText = normalizeContent(currentUserInput);
  let messagesToProcess = storedMessages;

  // Remove the last user message if it matches current input (avoid duplication)
  if (storedMessages.length > 0) {
    const lastMsg = storedMessages[storedMessages.length - 1];
    if (lastMsg.role === 'user' && normalizeContent(lastMsg.content) === currentInputText) {
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
        // BUG-13 FIX: Use a single canonical ID for both the assistant tool_calls
        // entry and the tool result message. Previously tc.id vs tc.toolCallId could
        // differ, causing "tool_call_id mismatch" errors from the LLM API.
        const stableId = tc.id || tc.toolCallId || `call_${msg.id || 'stub'}_${idx}`;
        return {
          id: stableId,
          name: tc.toolName || tc.name,
          arguments: tc.args || tc.arguments || {},
          result: tc.result,
          _canonicalId: stableId  // Used below for tool result messages
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

/**
 * Ensures strict alternation of message roles (user/assistant) before invoking the graph,
 * and merges consecutive user/assistant messages together to prevent rate-limitation/resume context loss.
 */
function sanitizeMessagesRoleAlternation(messages: any[]): any[] {
  if (messages.length === 0) return messages;

  const sanitized: any[] = [];
  let currentMsg = messages[0];

  for (let i = 1; i < messages.length; i++) {
    const nextMsg = messages[i];
    
    // Do not merge tool messages
    if (nextMsg.role === currentMsg.role && currentMsg.role !== 'tool') {
      const currentContent = typeof currentMsg.content === 'string' ? currentMsg.content : JSON.stringify(currentMsg.content);
      const nextContent = typeof nextMsg.content === 'string' ? nextMsg.content : JSON.stringify(nextMsg.content);
      
      let mergedContent = currentContent;
      if (currentMsg.role === 'user') {
        mergedContent = `${currentContent}\n\n[User continued execution]: ${nextContent}`;
      } else {
        mergedContent = `${currentContent}\n\n${nextContent}`;
      }
      
      currentMsg = {
        ...currentMsg,
        content: mergedContent,
        reasoning_content: currentMsg.reasoning_content || nextMsg.reasoning_content || currentMsg.thought || nextMsg.thought,
      };
    } else {
      sanitized.push(currentMsg);
      currentMsg = nextMsg;
    }
  }
  sanitized.push(currentMsg);
  return sanitized;
}
