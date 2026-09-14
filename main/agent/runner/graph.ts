import { StateGraph, END, START, interrupt, GraphInterrupt } from '@langchain/langgraph';
import { GraphState, GraphStateType, StreamEvent } from './state';
import { createTriageNode } from './nodes/triage';
import { createPlannerNode } from './nodes/planner';
import { createExecuteToolsNode } from './nodes/execute_tools';
import { createMemoryCheckNode } from './nodes/memory-check';
import { createMemoryConsolidatorNode } from './nodes/memory-consolidator';

import { createBrainNode } from './nodes/brain';
import { createDecomposerNode } from './nodes/decomposer';
import { loadPrompt } from '../../lib/prompt-sync';
import { createDebateChamberNode } from './nodes/debate-chamber';
import {
  createCodingSpecialistNode,
  createDataAnalystNode,
  createWebExplorerNode,
  createDeepResearchNode
} from './nodes/specialized_agents';
import { createOperatorCoordinatorNode } from '../operator/coordinator';
import { AgentRunner } from './runner';
import type { MissionTracker } from './mission-tracker';
import { lightweightCheckpointer } from './custom-checkpointer';
import { saveHitlRequest, getHitlRecord, listHitlRecords } from '../../store/hitl';
import { toolApprovalStore } from '../../store/tool-approvals';
import * as crypto from 'crypto';

/**
 * ExecutionContext provides runtime-specific objects (queue, tracker, etc.)
 * passed at graph invocation time.
 */
export interface ExecutionContext {
  runner: AgentRunner;
  eventQueue?: StreamEvent[];
  missionTracker?: MissionTracker;
  conversationId?: string;
  shouldAbort?: () => boolean;
  isResuming?: boolean;
}

/**
 * Helper to extract ExecutionContext from LangGraph config
 */
const getContext = (config: any): ExecutionContext => {
  const ctx = config?.configurable?.executionContext;
  if (!ctx) {
    throw new Error('ExecutionContext missing from graph config. Ensure it is passed in the configurable field.');
  }
  return ctx;
};

const getLatestUserText = (state: GraphStateType): string => {
  const messages = state.messages || [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as any;
    const role = msg.role || msg.type || msg._getType?.();
    if (role === 'user' || role === 'human') {
      return typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content || '');
    }
  }
  return '';
};

const isProjectScaleCodingRequest = (state: GraphStateType): boolean => {
  return ['coding', 'build', 'fix'].includes(state.currentIntent);
};

const INTERACTIVE_AUTOMATION_TOOLS = new Set<string>();

const getToolCallArgs = (call: any): Record<string, any> => {
  const raw = call?.arguments ?? call?.args ?? {};
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return raw && typeof raw === 'object' ? raw : {};
};

const isInteractiveAutomationCall = (call: any): boolean => {
  const name = String(call?.name || call?.toolName || '').trim();
  if (!INTERACTIVE_AUTOMATION_TOOLS.has(name)) return false;
  return !toolApprovalStore.isApproved(name, getToolCallArgs(call));
};

const shouldRequireInteractiveAutomationApproval = (state: GraphStateType): boolean => {
  if (state.isScheduledTaskRun || state.currentIntent === 'background_task') return false;
  return (state.pendingToolCalls || []).some(isInteractiveAutomationCall);
};

const routePendingToolsWithAutomationApproval = (
  state: GraphStateType,
  source: string,
): 'hitl_approval' | 'multi_tool_orchestrator' => {
  if (shouldRequireInteractiveAutomationApproval(state)) {
    console.log(`[Graph] 🔐 ${source} wants Navis/computer_use → hitl_approval`);
    return 'hitl_approval';
  }
  return 'multi_tool_orchestrator';
};

export const cleanCommandNarrative = (rawCmd: string): string => {
  if (!rawCmd || typeof rawCmd !== 'string') return '';
  let cmd = rawCmd;
  // Issue #23 Fix: Only strip Windows/PowerShell boilerplate on Windows.
  // On macOS/Linux these patterns don't appear so stripping is a no-op,
  // but applying it unconditionally masked bash-specific noise.
  if (process.platform === 'win32') {
    const tryMatch = cmd.match(/try\s*\{\s*&\s*\{\s*\$global:LASTEXITCODE\s*=\s*\$null;\s*([\s\S]*?)\s*\}\s*;/i);
    if (tryMatch && tryMatch[1]) cmd = tryMatch[1];
    cmd = cmd
      .replace(/\[Console\]::OutputEncoding\s*=\s*.*?(?:\r?\n|;|$)/gi, '')
      .replace(/\$OutputEncoding\s*=\s*.*?(?:\r?\n|;|$)/gi, '')
      .replace(/\$ProgressPreference\s*=\s*.*?(?:\r?\n|;|$)/gi, '')
      .replace(/\$global:EF_\w+\s*=\s*.*?(?:\r?\n|;|$)/gi, '')
      .replace(/Set-Location\s+-LiteralPath\s+.*?(?:\r?\n|;|$)/gi, '')
      .replace(/;\s*if\s*\(\$LASTEXITCODE[\s\S]*$/i, '')
      .trim();
  } else {
    // On POSIX, strip common bash preamble (e.g. export TERM=, cd <dir>)
    cmd = cmd
      .replace(/^export\s+\w+=.*?(?:\n|;|$)/gm, '')
      .replace(/^cd\s+.*?(?:\n|;|$)/gm, '')
      .trim();
  }
  return cmd.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
};

const compiledGraphCache = new Map<string, any>();

export const buildGraph = (
  runner: AgentRunner,
  toolDefs: any[],
  tools: any[],
) => {
  // Issue #14 Fix: Include model + provider in cache key so that switching models
  // mid-session (e.g. fern-1 → claude) gets a fresh graph instead of reusing a
  // stale cached one compiled for a different provider configuration.
  const cacheKey = `${runner.client.provider}:${runner.client.model}:${runner.currentAgentSessionKey || 'default'}:${toolDefs.map(t => t.name).sort().join(',')}`;
  if (compiledGraphCache.has(cacheKey)) {
    return compiledGraphCache.get(cacheKey)!;
  }

  console.log(`[Graph] 🏗️  BUILDING AGENT EXECUTION GRAPH (with debate_chamber)`);
  console.log(`[Graph] Available tools: ${toolDefs.map(t => t.name).join(', ')}`);

  // Warn if computer_use is missing
  if (!toolDefs.find(t => t.name === 'computer_use')) {
    console.warn(`[Graph] ⚠️ WARNING: computer_use tool is missing from tool definitions!`);
  }

  const hitlNode = async (state: GraphStateType, config?: any) => {
    const { runner, eventQueue, missionTracker, conversationId, shouldAbort } = getContext(config);

    if (shouldAbort?.()) {
      throw new Error('Execution aborted by user (stop button clicked)');
    }

    runner.telemetry.transition('hitl');
    if (missionTracker) missionTracker.startStep('step:hitl');

    try {
      const getTcName = (call: any) => String(call?.name || call?.toolName || call?.function?.name || '').trim();



      const formatToolCallSummary = (call: any) => {
        const name = getTcName(call) || 'tool';
        let rawArgs = call?.arguments || call?.args || call?.function?.arguments || {};
        if (typeof rawArgs === 'string') {
          try { rawArgs = JSON.parse(rawArgs); } catch {}
        }

        // Specialize formatting for terminal commands
        if (['terminal_execute', 'executePwsh', 'run_command', 'bash', 'terminal_status'].includes(name)) {
          const cmd = (typeof rawArgs === 'object' ? (rawArgs.command || rawArgs.CommandLine || rawArgs.cmd) : rawArgs) || JSON.stringify(rawArgs);
          const cleanedCmd = cleanCommandNarrative(String(cmd));
          return `**${name}** — \`${cleanedCmd.slice(0, 160)}\``;
        }

        // Specialize formatting for navis (web browser) tool calls
        if (name === 'navis') {
          const taskDesc = (typeof rawArgs === 'object' ? (rawArgs.task || rawArgs.taskName || rawArgs.url) : rawArgs) || JSON.stringify(rawArgs);
          return `**navis** — \`${String(taskDesc).slice(0, 160)}\``;
        }

        // Specialize formatting for computer_use (desktop automation) tool calls
        if (name === 'computer_use') {
          const actionDesc = (typeof rawArgs === 'object' ? (rawArgs.action || rawArgs.task || rawArgs.taskName) : rawArgs) || JSON.stringify(rawArgs);
          return `**computer_use** — \`${String(actionDesc).slice(0, 160)}\``;
        }

        // Default formatting for other tools
        const summaryStr = typeof rawArgs === 'object' ? JSON.stringify(rawArgs) : String(rawArgs);
        return `**${name}** — \`${summaryStr.slice(0, 120)}\``;
      };

      const buildFallbackActionSummary = () => {
        const signal = state.completionSignal;
        const rationale = String(signal?.hitlRationale || signal?.explanation || '').trim();
        if (!rationale) return 'Review the security rationale before proceeding.';
        const backtickCommand = rationale.match(/`([^`]{3,500})`/)?.[1]?.trim();
        if (backtickCommand) return backtickCommand;
        return `${rationale.slice(0, 240)}${rationale.length > 240 ? '...' : ''}`;
      };

      // Collect tools to display
      let toolsToDisplay = state.pendingToolCalls || [];
      if (toolsToDisplay.length === 0 && state.messages && state.messages.length > 0) {
        for (let i = state.messages.length - 1; i >= 0; i--) {
          const msg = state.messages[i] as any;
          if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
            toolsToDisplay = msg.tool_calls.map((tc: any) => ({
              name: getTcName(tc),
              arguments: tc.function?.arguments
                ? (typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments) : tc.function.arguments)
                : tc.arguments || tc.args || {}
            }));
            break;
          }
        }
      }

      const hasInteractiveAutomation = toolsToDisplay.some((tc: any) => INTERACTIVE_AUTOMATION_TOOLS.has(getTcName(tc)));
      const hasToolSynthesis = toolsToDisplay.some((tc: any) => getTcName(tc) === 'synthesize_tool');
      const hasSkillSynthesis = toolsToDisplay.some((tc: any) => getTcName(tc) === 'synthesize_skill');

      // Extract actual AI narrative from the last assistant message (if present)
      const lastAssistantMsg = [...(state.messages || [])].reverse().find((m: any) => {
        const role = m.role || m._getType?.() || m.type;
        return role === 'assistant' || role === 'ai';
      });
      const lastAiText = typeof lastAssistantMsg?.content === 'string'
        ? lastAssistantMsg.content.trim()
        : '';
      const cleanAiNarrative = lastAiText ? lastAiText.slice(0, 300) : '';

      const hitlRationale = state.completionSignal?.hitlRationale ||
        (cleanAiNarrative ? cleanAiNarrative : undefined) ||
        (hasToolSynthesis
          ? 'An agent is requesting to synthesize and register a new custom tool. Please review the proposed tool code before approving.'
          : hasSkillSynthesis
            ? 'An agent is requesting to synthesize and register a new custom skill. Please review the proposed skill instructions before approving.'
            : hasInteractiveAutomation
              ? 'Interactive browser or desktop automation requires your permission before EverFern can control Navis or the computer.'
              : 'High-risk operation detected');

      const toolSummary = toolsToDisplay.length > 0
        ? toolsToDisplay.map(formatToolCallSummary).join('\n')
        : buildFallbackActionSummary();

      // ── IPC Turn Intercept (same pattern as LocalExecutionPermissionCard) ──
      // Emit local_execution_request -> frontend renders inline card ->
      // user clicks a button -> acp:local-execution-response resolves the Promise.
      // No graph interrupt(), no new messages, no LangGraph resume needed.
      const { getLocalExecutionResolvers } = await import('../tools/pi-tools');
      const { toolApprovalStore } = await import('../../store/tool-approvals');

      const requestId = `hitl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

      runner.telemetry.info(`HITL — emitting IPC turn intercept card (requestId: ${requestId})`);

      eventQueue?.push({
        type: 'tool_start',
        toolName: 'approve_actions',
        toolCallId: requestId,
        toolArgs: { questions: hitlRationale }
      });

      eventQueue?.push({
        type: 'local_execution_request',
        requestId,
        command: toolSummary,
        shellType: 'Security Check',
        reason: hitlRationale,
        conversationId: conversationId || undefined,
        isHitlApproval: true, // tells card to show Allow Prefix button
      });

      // Await IPC response with abort check (releases immediately on user Stop)
      const approvalPromise = new Promise<{ approved: boolean; alwaysAllow: boolean; allowPrefix?: boolean }>((resolve) => {
        const checkAbortInterval = setInterval(() => {
          if (shouldAbort?.()) {
            clearInterval(checkAbortInterval);
            getLocalExecutionResolvers().delete(requestId);
            resolve({ approved: false, alwaysAllow: false });
          }
        }, 300);

        getLocalExecutionResolvers().set(requestId, (res) => {
          clearInterval(checkAbortInterval);
          resolve(res);
        });
      });

      runner.telemetry.info('HITL — awaiting user IPC response...');
      const response = await approvalPromise;
      getLocalExecutionResolvers().delete(requestId);

      const isApproved = response.approved;
      runner.telemetry.info(`HITL IPC response: ${isApproved ? 'APPROVED' : 'REJECTED'} alwaysAllow=${response.alwaysAllow} allowPrefix=${response.allowPrefix}`);

      // Register auto-approval policies
      if (isApproved && (response.alwaysAllow || response.allowPrefix)) {
        const type = response.allowPrefix ? 'prefix' : 'exact';
        for (const tc of toolsToDisplay) {
          const toolName = getTcName(tc);
          if (!toolName) continue;
          const args = tc.arguments || tc.args || {};
          let pattern = '';
          const cmdTools = ['terminal_execute', 'executePwsh', 'run_command', 'bash'];
          if (cmdTools.includes(toolName)) {
            const cmd = (args.command || args.CommandLine || args.cmd || '').trim();
            if (response.allowPrefix) {
              const parts = cmd.split(/\s+/);
              pattern = (parts.length >= 2 && ['run','push','pull','commit','checkout','add','install','build','exec'].includes(parts[1].toLowerCase()))
                ? `${parts[0]} ${parts[1]}` : (parts[0] || cmd);
            } else {
              pattern = cmd;
            }
          } else {
            pattern = toolName;
          }
          if (pattern) {
            toolApprovalStore.addPolicy({ type, toolName, pattern });
            runner.telemetry.info(`Auto-approval policy: ${type} for ${toolName} pattern="${pattern}"`);
          }
        }
      }

      if (missionTracker) missionTracker.completeStep('step:hitl');

      return {
        taskPhase: 'executing' as const,
        hitlApprovalResult: {
          approved: isApproved,
          response: isApproved ? 'Approved by user' : 'Rejected by user',
          reasoning: isApproved ? 'User approved the action' : 'User rejected the action',
        },
        completionSignal: isApproved
          ? null
          : {
              // Issue #8 Fix: When the user rejects a HITL request, set completionSignal
              // to 'cannot_proceed' so the brain edge routes to END instead of looping
              // back and retrying the same rejected tool call indefinitely.
              reason: 'cannot_proceed' as const,
              explanation: 'User rejected the requested tool execution. Cannot proceed without approval.',
            },
        pendingToolCalls: isApproved ? state.pendingToolCalls : [],
      };

    } catch (error) {
      if (missionTracker) missionTracker.failStep('step:hitl', error instanceof Error ? error.message : String(error));
      // Route to END to prevent infinite recursion when interrupt fails
      return {
        taskPhase: 'planning' as const,
        hitlApprovalResult: {
          approved: null as any, // null → routes to END in hitl_approval conditional edges
          response: 'HITL interrupted or failed',
          reasoning: `HITL approval failed: ${error instanceof Error ? error.message : String(error)}`,
        },
      };
    }
  };

  // Node wrappers that extract context from config at runtime
  const triageNode = async (state: GraphStateType, config?: any) => {
    const ctx = getContext(config);
    // Guard: Check abort before node execution
    if (ctx.shouldAbort?.()) {
      throw new Error('Execution aborted by user (stop button clicked)');
    }
    const node = createTriageNode(ctx.runner, ctx.eventQueue, ctx.missionTracker, ctx.shouldAbort);
    return node(state);
  };

  const decomposerNode = async (state: GraphStateType, config?: any) => {
    const ctx = getContext(config);
    // Guard: Check abort before node execution
    if (ctx.shouldAbort?.()) {
      throw new Error('Execution aborted by user (stop button clicked)');
    }
    const node = createDecomposerNode(ctx.runner, ctx.eventQueue, ctx.missionTracker, ctx.shouldAbort);
    return node(state);
  };

  const plannerNode = async (state: GraphStateType, config?: any) => {
    const ctx = getContext(config);
    // Guard: Check abort before node execution
    if (ctx.shouldAbort?.()) {
      throw new Error('Execution aborted by user (stop button clicked)');
    }
    const node = createPlannerNode(ctx.runner, ctx.eventQueue, ctx.missionTracker, ctx.shouldAbort);
    return node(state);
  };

  const debateChamberNode = async (state: GraphStateType, config?: any) => {
    const ctx = getContext(config);
    if (ctx.shouldAbort?.()) {
      throw new Error('Execution aborted by user (stop button clicked)');
    }
    const node = createDebateChamberNode(ctx.runner, ctx.eventQueue, ctx.missionTracker, ctx.shouldAbort);
    return node(state);
  };

  const brainNode = async (state: GraphStateType, config?: any) => {
    const ctx = getContext(config);
    // Guard: Check abort before node execution
    if (ctx.shouldAbort?.()) {
      throw new Error('Execution aborted by user (stop button clicked)');
    }

    // Inject plan context into brain prompt if it exists
    let systemPromptOverride = undefined;
    const plan = state.decomposedTask;
    if (plan) {
        const intentGuard = state.currentIntent
            ? `\nTRIAGE INTENT: ${state.currentIntent} — routing MUST respect this intent. If intent is 'research', route to web_explorer, NOT computer_use.\n`
            : '';
        // Bug 4: Prepend plan context to brain prompt instead of replacing it
        const planContext = `You are the EverFern Orchestrator.
Your goal is to ensure the following execution plan is completed successfully.
${intentGuard}
CURRENT EXECUTION PLAN:
Title: ${plan.title}
Steps:
${plan.steps.map(s => `${s.id}: ${s.description} (Tool: ${s.tool})`).join('\n')}

If a specialized agent failed to complete a step, identify the issue and use your tools to proceed.\n\n`;

        const mainPrompt = loadPrompt('SYSTEM_PROMPT.md') || '';
        systemPromptOverride = planContext + mainPrompt;
    }


    const node = createBrainNode(ctx.runner, ctx.eventQueue, ctx.missionTracker, toolDefs, ctx.shouldAbort, systemPromptOverride);
    return node(state);
  };


  const codingNode = async (state: GraphStateType, config?: any) => {
    const ctx = getContext(config);
    // Guard: Check abort before node execution
    if (ctx.shouldAbort?.()) {
      throw new Error('Execution aborted by user (stop button clicked)');
    }
    const codingTools = toolDefs.filter(t => 
      ['read_file', 'write_to_file', 'replace_file_content', 'multi_replace_file_content', 'grep_search', 'list_dir', 'run_command', 'terminal_execute', 'spawn_agent', 'ask_user_question', 'task_complete', 'view_file', 'executePwsh', 'grep', 'find', 'ls', 'read', 'write', 'edit', 'view_image', 'generate_image'].includes(t.name) || 
      t.name.includes('mcp')
    );
    const node = createCodingSpecialistNode(ctx.runner, ctx.eventQueue, ctx.missionTracker, codingTools);
    return node(state);
  };

  const dataAnalystNode = async (state: GraphStateType, config?: any) => {
    const ctx = getContext(config);
    // Guard: Check abort before node execution
    if (ctx.shouldAbort?.()) {
      throw new Error('Execution aborted by user (stop button clicked)');
    }
    const dataTools = toolDefs.filter(t => 
      ['read_file', 'write_to_file', 'replace_file_content', 'multi_replace_file_content', 'list_dir', 'run_command', 'terminal_execute', 'ask_user_question', 'task_complete', 'view_file', 'executePwsh', 'grep_search', 'python_execute'].includes(t.name) || 
      t.name.includes('mcp')
    );
    const node = createDataAnalystNode(ctx.runner, ctx.eventQueue, ctx.missionTracker, dataTools);
    return node(state);
  };

  const webExplorerNode = async (state: GraphStateType, config?: any) => {
    const ctx = getContext(config);
    // Guard: Check abort before node execution
    if (ctx.shouldAbort?.()) {
      throw new Error('Execution aborted by user (stop button clicked)');
    }
    const browserTools = toolDefs.filter(t => 
      ['navis', 'browser_subagent', 'web_search', 'web_fetch', 'read_url_content', 'search_web', 'ask_user_question', 'spawn_agent', 'task_complete', 'view_file'].includes(t.name)
    );
    const node = createWebExplorerNode(ctx.runner, ctx.eventQueue, ctx.missionTracker, browserTools);
    return node(state);
  };

  const deepResearchNode = async (state: GraphStateType, config?: any) => {
    const ctx = getContext(config);
    if (ctx.shouldAbort?.()) {
      throw new Error('Execution aborted by user (stop button clicked)');
    }
    const browserTools = toolDefs.filter(t => 
      ['navis', 'browser_subagent', 'web_search', 'web_fetch', 'read_url_content', 'search_web', 'ask_user_question', 'task_complete', 'view_file'].includes(t.name)
    );
    const node = createDeepResearchNode(ctx.runner, ctx.eventQueue, ctx.missionTracker, browserTools);
    return node(state);
  };



  const orchestratorNode = async (state: GraphStateType, config?: any) => {
    const ctx = getContext(config);
    // Guard: Check abort before node execution
    if (ctx.shouldAbort?.()) {
      throw new Error('Execution aborted by user (stop button clicked)');
    }
    const node = createExecuteToolsNode(ctx.runner, tools, (ctx.runner as any).config, ctx.eventQueue, ctx.conversationId, ctx.missionTracker, ctx.shouldAbort, (ctx.runner as any).client);
    return node(state);
  };

  const operatorNode = async (state: GraphStateType, config?: any) => {
    const ctx = getContext(config);
    if (ctx.shouldAbort?.()) {
      throw new Error('Execution aborted by user (stop button clicked)');
    }
    const node = createOperatorCoordinatorNode(ctx.runner, ctx.eventQueue, ctx.missionTracker, ctx.shouldAbort);
    return node(state);
  };

  const memoryCheckNode = async (state: GraphStateType, config?: any) => {
    const ctx = getContext(config);
    if (ctx.shouldAbort?.()) {
      throw new Error('Execution aborted by user (stop button clicked)');
    }
    const node = createMemoryCheckNode(ctx.runner, ctx.eventQueue, ctx.missionTracker, ctx.shouldAbort);
    return node(state, config);
  };

  const memoryConsolidatorNode = async (state: GraphStateType, config?: any) => {
    const ctx = getContext(config);
    if (ctx.shouldAbort?.()) {
      throw new Error('Execution aborted by user (stop button clicked)');
    }
    const node = createMemoryConsolidatorNode(ctx.runner, ctx.eventQueue, ctx.missionTracker, ctx.shouldAbort);
    return node(state, config);
  };

  const wasAskUserQuestionExecutedInLastTurn = (state: GraphStateType): boolean => {
    const messages = state.messages || [];
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i] as any;
      const role = msg.role || msg.type || msg._getType?.();
      if (role === 'assistant' || role === 'ai') {
        break;
      }
      if (role === 'tool' || role === 'function') {
        const name = msg.name || msg.tool_name || msg.toolName || '';
        if (name === 'ask_user_question') {
          return true;
        }
      }
    }
    return false;
  };

  const wasTaskCompleteExecutedInLastTurn = (state: GraphStateType): boolean => {
    const messages = state.messages || [];
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i] as any;
      const role = msg.role || msg.type || msg._getType?.();
      if (role === 'assistant' || role === 'ai') {
        break;
      }
      if (role === 'tool' || role === 'function') {
        const name = msg.name || msg.tool_name || msg.toolName || '';
        if (name === 'task_complete') {
          return true;
        }
      }
    }
    return false;
  };


  const askUserWaitNode = async (state: GraphStateType, config?: any) => {
    const { runner, conversationId } = getContext(config);

    runner.telemetry.transition('ask_user_wait');

    // Find the ask_user_question tool call in records to know what we are waiting for
    const askUserRecord = state.toolCallRecords?.find(r => r.toolName === 'ask_user_question');
    const reasoning = askUserRecord?.result?.output || 'Awaiting clarification...';

    const interruptRequest = {
      id: askUserRecord?.id || crypto.randomUUID(),
      conversationId: conversationId || 'unknown',
      timestamp: new Date().toISOString(),
      question: 'Clarification required:',
      details: {
        tools: [askUserRecord].filter(Boolean),
        summary: reasoning,
        reasoning,
      },
      options: []
    };

    // Register interruption in stateManager so runStream can find it upon resume
    const { stateManager } = await import('./state-manager');
    if (conversationId) {
      stateManager.setInterrupted(conversationId, interruptRequest);
    }

    let answer: any;
    try {
      answer = interrupt(interruptRequest);
    } catch (interruptErr: any) {
      if (interruptErr && (interruptErr instanceof GraphInterrupt || interruptErr.name === 'GraphInterrupt' || interruptErr.constructor?.name === 'GraphInterrupt')) {
        throw interruptErr;
      }
      runner.telemetry.info('ask_user_wait interrupt() failed — ending graph turn');
      return {
        returningFromSpecialist: state.returningFromSpecialist,
      };
    }

    const answerStr = String(answer);
    console.log(`[ask_user_wait] Received user answer: ${answerStr}`);

    const isHitlActionResponse = answerStr.includes('[HITL_APPROVED]') ||
                                 answerStr.includes('[HITL_APPROVED_ALWAYS]') ||
                                 answerStr.includes('[HITL_APPROVED_PREFIX]') ||
                                 answerStr.includes('[HITL_REJECTED]') ||
                                 answerStr.includes('Approve — proceed once') ||
                                 answerStr.includes('proceed once') ||
                                 answerStr.includes('Approve & Allow Always') ||
                                 answerStr.includes('Approve & Allow Prefix') ||
                                 answerStr.includes('Reject — cancel');

    let formattedContent = answerStr;
    if (isHitlActionResponse) {
      const isApproved = !answerStr.includes('[HITL_REJECTED]') && !answerStr.includes('Reject — cancel');
      formattedContent = isApproved
        ? `[User approved tool execution request (${answerStr}). Permission granted. Execute the requested tool now and proceed with the task.]`
        : `[User rejected tool execution request (${answerStr}).]`;
    }

    // Clean up interrupted state in stateManager
    if (conversationId) {
      stateManager.resumeFromInterrupt(conversationId, null);
    }

    const userMessage = {
      role: 'user',
      content: formattedContent,
      id: `msg-user-ans-${Date.now()}`
    };

    return {
      messages: [userMessage],
      returningFromSpecialist: state.returningFromSpecialist,
      codingComplete: false,
      dataAnalysisComplete: false,
      webExplorerComplete: false,
      deepResearchComplete: false,
      resumingFromFormResponse: true,
      // Issue #9 Fix: Increment the clarification counter so the brain edge can
      // detect repeated clarification loops and break out after 3 consecutive asks.
      clarificationCount: ((state as any).clarificationCount || 0) + 1,
    };
  };

  const compiledGraph = new StateGraph(GraphState)
    .addNode('memory_check', memoryCheckNode)
    .addNode('intent_classifier', triageNode)
    .addNode('operator_coordinator', operatorNode)
    .addNode('task_decomposer', decomposerNode)
    .addNode('global_planner', plannerNode)
    .addNode('debate_chamber', debateChamberNode)
    .addNode('brain', brainNode)
    .addNode('coding_specialist', codingNode)
    .addNode('data_analyst', dataAnalystNode)
    .addNode('web_explorer', webExplorerNode)
    .addNode('deep_research', deepResearchNode)

    .addNode('hitl_approval', hitlNode)
    .addNode('multi_tool_orchestrator', orchestratorNode)
    .addNode('memory_consolidator', memoryConsolidatorNode)
    .addNode('ask_user_wait', askUserWaitNode);

  // New Brain-Centric Routing Architecture
  compiledGraph
    .addEdge(START, 'memory_check')
    .addEdge('memory_check', 'intent_classifier')
    // BUG-08 FIX: Removed unreachable code paths — coding/build/fix were matched
    // before the complexIntents check, making debate_chamber unreachable for those.
    // BUG-18 FIX: Added deep_research to edge map for consistency.
    .addConditionalEdges('intent_classifier', (state) => {
        const intent = state.currentIntent || 'unknown';
        if (intent === 'operator') {
            console.log('[Graph] 🔀 Operator intent detected → operator_coordinator');
            return 'operator_coordinator';
        }
        if (['question', 'conversation'].includes(intent)) {
            console.log('[Graph] 🔀 Question or conversation intent detected → brain');
            return 'brain';
        }
        if (['coding', 'build', 'fix'].includes(intent) && isProjectScaleCodingRequest(state)) {
            console.log('[Graph] 🔀 Project-scale coding intent detected → task_decomposer');
            return 'task_decomposer';
        }
        if (['coding', 'build', 'fix'].includes(intent)) {
            console.log('[Graph] 🔀 Direct coding intent detected → coding_specialist');
            return 'coding_specialist';
        }
        if (intent === 'research') {
            console.log('[Graph] 🔀 Research/browser intent detected → brain');
            return 'brain';
        }
        if (['automate', 'task'].includes(intent)) {
            console.log('[Graph] 🔀 Complex intent detected → debate_chamber');
            return 'debate_chamber';
        }
        console.log('[Graph] 🔀 Simple/unknown intent detected → task_decomposer');
        return 'task_decomposer';
    }, {
        operator_coordinator: 'operator_coordinator',
        debate_chamber: 'debate_chamber',
        coding_specialist: 'coding_specialist',
        web_explorer: 'web_explorer',
        deep_research: 'deep_research',
        task_decomposer: 'task_decomposer',
        brain: 'brain'
    })
    .addConditionalEdges('debate_chamber', (state) => {
        const dr = state.debateResult;
        if (dr?.goNogo === 'no-go') {
            console.log('[Graph] 🔀 Debate chamber voted NO-GO → proceeding to decomposer anyway (best effort)');
            return 'task_decomposer';
        }
        console.log('[Graph] 🔀 Debate chamber complete → task_decomposer');
        return 'task_decomposer';
    }, {
        task_decomposer: 'task_decomposer'
    })
    .addConditionalEdges('task_decomposer', (state) => {
        console.log(`[Graph] 🔀 task_decomposer complete`);
        if (['coding', 'build', 'fix'].includes(state.currentIntent || '')) {
            console.log(`[Graph] ➡️ Decomposed coding project → coding_specialist`);
            return 'coding_specialist';
        }
        if (state.currentIntent === 'research') {
            console.log(`[Graph] ➡️ Decomposed research/browser task → brain`);
            return 'brain';
        }
        console.log(`[Graph] ➡️ Routing to global_planner`);
        return 'global_planner';
    }, {
        coding_specialist: 'coding_specialist',
        web_explorer: 'web_explorer',
        global_planner: 'global_planner',
        brain: 'brain'
    })
    .addEdge('global_planner', 'brain')
    .addEdge('memory_consolidator', END)

    .addConditionalEdges('operator_coordinator', (state) => {
        const routingDecision = state.routingDecision;
        if (routingDecision) {
            console.log(`[Graph] 🔀 Operator routing decision: ${routingDecision.decision}`);
            switch (routingDecision.decision) {
                case 'route_coding':
                    if (isProjectScaleCodingRequest(state)) {
                        console.log('[Graph] 🔀 Operator project-scale coding route → task_decomposer');
                        return 'task_decomposer';
                    }
                    console.log('[Graph] 🔀 Operator coding route → coding_specialist');
                    return 'coding_specialist';
                case 'route_data_analyst': return 'data_analyst';
                case 'route_web_explorer': return 'web_explorer';
                case 'route_deep_research': return 'deep_research';
            }
        }
        return 'memory_consolidator';
    }, {
        task_decomposer: 'task_decomposer',
        coding_specialist: 'coding_specialist',
        data_analyst: 'data_analyst',
        web_explorer: 'web_explorer',
        deep_research: 'deep_research',
        memory_consolidator: 'memory_consolidator'
    })

    // Brain is the central router - it decides whether to handle tasks itself or route to specialists
    .addConditionalEdges('brain', (state) => {
        const hasTools = state.pendingToolCalls && state.pendingToolCalls.length > 0;
        const routingDecision = state.routingDecision;
        const completionSignal = state.completionSignal;

        // Check if brain indicated need for HITL approval
        if (completionSignal?.reason === 'needs_hitl') {
            console.log('[Graph] 🔀 Brain completion signal: needs_hitl → hitl_approval');
            return 'hitl_approval';
        }

        // If brain has tools to execute, execute them directly
        if (hasTools) {
            const route = routePendingToolsWithAutomationApproval(state, 'Brain');
            console.log(`[Graph] 🔀 Brain has tools → ${route}`);
            return route;
        }

        // If brain made a routing decision to specialized agents
        if (routingDecision) {
            console.log(`[Graph] 🔀 Brain routing decision: ${routingDecision.decision}`);

            switch (routingDecision.decision) {
                case 'route_coding':
                    return 'coding_specialist';
                case 'route_data_analyst':
                    return 'data_analyst';
                case 'route_web_explorer':
                    return 'web_explorer';
                case 'route_deep_research':
                    // Issue #3 Fix: deep_research was silently routed to web_explorer,
                    // bypassing the dedicated node and its research-specific prompts.
                    return 'deep_research';
                case 'complete_task':
                    console.log('[Graph] ➡️ Brain routing decision: complete_task → memory_consolidator');
                    return 'memory_consolidator';
                case 'continue_brain':
                    if (completionSignal) {
                        if (
                            completionSignal.reason === 'waiting_for_user_input' ||
                            completionSignal.reason === 'cannot_proceed'
                        ) {
                            console.log(`[Graph] ➡️ continue_brain but completionSignal=${completionSignal.reason} → END (avoid loop)`);
                            return END;
                        }
                        if (completionSignal.reason === 'task_complete') {
                            console.log(`[Graph] ➡️ continue_brain but completionSignal=task_complete → memory_consolidator`);
                            return 'memory_consolidator';
                        }
                    }
                    // Issue #9 Fix: If the agent has clarified 3+ times in a row,
                    // break the ask_user_wait loop and route to END to prevent
                    // infinite clarification cycles.
                    if ((state as any).clarificationCount >= 3) {
                        console.log('[Graph] ⚠️ Max clarifications (3) reached → END');
                        return END;
                    }
                    console.log('[Graph] ➡️ Brain routing decision: continue_brain → brain');
                    return 'brain';
                default:
                    console.log('[Graph] ➡️ Unknown routing decision, defaulting to memory_consolidator');
                    return 'memory_consolidator';
            }
        }

        // Default to memory_consolidator for completion
        console.log('[Graph] ➡️ Task complete → memory_consolidator');
        return 'memory_consolidator';
    }, {
        hitl_approval: 'hitl_approval',
        multi_tool_orchestrator: 'multi_tool_orchestrator',
        coding_specialist: 'coding_specialist',
        data_analyst: 'data_analyst',
        web_explorer: 'web_explorer',
        deep_research: 'deep_research',
        brain: 'brain',
        memory_consolidator: 'memory_consolidator',
        [END]: END,
    })

    // All specialized agents route back to brain for coordination
    // Tool-call-presence routing (ReAct / LangGraph / OpenAI Swarm pattern).
    // "Continue if tools requested. Done if task_complete was called."
    // No magic-string parsing required — everything is structural.
    .addConditionalEdges('coding_specialist', (state) => {
        const pendingTools = state.pendingToolCalls || [];
        const hasTools = pendingTools.length > 0;

        if (hasTools) {
            // Check if this IS the task_complete call — if so, specialist is done
            const calledTaskComplete = pendingTools.some(
                (tc: any) => (tc.name || tc.toolName || tc.function?.name || '') === 'task_complete'
            );

            if (calledTaskComplete) {
                console.log('[Graph] ✅ Coding specialist called task_complete → returning to brain/operator');
                // task_complete still gets executed by orchestrator; then routes back here.
                // Let it flow through orchestrator so the tool result is recorded.
                const route = routePendingToolsWithAutomationApproval(state, 'Coding specialist (task_complete)');
                return route;
            }

            // Normal tool call — execute and loop back to specialist
            const route = routePendingToolsWithAutomationApproval(state, 'Coding specialist');
            console.log(`[Graph] 🔀 Coding specialist has tools → ${route}`);
            return route;
        }

        // No tool calls at all (text-only response).
        // Give the specialist 2 grace passes to emit a tool call before deferring to brain.
        // This handles the rare case where the model produces a bridging response
        // without tools (e.g. "I'll now implement...") and needs another turn.
        const noToolCount = state.codingSpecialistSelfLoopCount || 0;
        if (noToolCount < 2 && !state.codingComplete) {
            console.log(`[Graph] 🔄 Coding specialist: text-only response (grace pass ${noToolCount + 1}/2) → self-looping`);
            return 'coding_specialist';
        }

        // Text-only after 2 grace passes or codingComplete — return to coordinator
        console.log('[Graph] 🔀 Coding specialist finished turn → ' + (state.currentIntent === 'operator' ? 'operator_coordinator' : 'brain'));
        return state.currentIntent === 'operator' ? 'operator_coordinator' : 'brain';
    }, {
        hitl_approval: 'hitl_approval',
        multi_tool_orchestrator: 'multi_tool_orchestrator',
        coding_specialist: 'coding_specialist',
        brain: 'brain',
        operator_coordinator: 'operator_coordinator',
    })



    .addConditionalEdges('data_analyst', (state) => {
        const hasTools = state.pendingToolCalls && state.pendingToolCalls.length > 0;

        if (hasTools) {
            const route = routePendingToolsWithAutomationApproval(state, 'Data analyst');
            console.log(`[Graph] 🔀 Data analyst has tools → ${route}`);
            return route;
        }

        console.log('[Graph] 🔀 Data analyst finished turn (no pending tools) → ' + (state.currentIntent === 'operator' ? 'operator_coordinator' : 'brain'));
        return state.currentIntent === 'operator' ? 'operator_coordinator' : 'brain';
    }, {
        hitl_approval: 'hitl_approval',
        multi_tool_orchestrator: 'multi_tool_orchestrator',
        data_analyst: 'data_analyst',
        brain: 'brain',
        operator_coordinator: 'operator_coordinator',
    })

    .addConditionalEdges('web_explorer', (state) => {
        const hasTools = state.pendingToolCalls && state.pendingToolCalls.length > 0;

        if (hasTools) {
            const route = routePendingToolsWithAutomationApproval(state, 'Web explorer');
            console.log(`[Graph] 🔀 Web explorer has tools → ${route}`);
            return route;
        }

        console.log('[Graph] 🔀 Web explorer finished turn (no pending tools) → ' + (state.currentIntent === 'operator' ? 'operator_coordinator' : 'brain'));
        return state.currentIntent === 'operator' ? 'operator_coordinator' : 'brain';
    }, {
        hitl_approval: 'hitl_approval',
        multi_tool_orchestrator: 'multi_tool_orchestrator',
        brain: 'brain',
        web_explorer: 'web_explorer',
        operator_coordinator: 'operator_coordinator',
        [END]: END,
    })

    .addConditionalEdges('deep_research', (state) => {
        const hasTools = state.pendingToolCalls && state.pendingToolCalls.length > 0;

        if (hasTools) {
            const route = routePendingToolsWithAutomationApproval(state, 'Deep research');
            console.log(`[Graph] 🔀 Deep research has tools → ${route}`);
            return route;
        }

        console.log('[Graph] 🔀 Deep research finished turn (no pending tools) → ' + (state.currentIntent === 'operator' ? 'operator_coordinator' : 'brain'));
        return state.currentIntent === 'operator' ? 'operator_coordinator' : 'brain';
    }, {
        hitl_approval: 'hitl_approval',
        multi_tool_orchestrator: 'multi_tool_orchestrator',
        deep_research: 'deep_research',
        brain: 'brain',
        operator_coordinator: 'operator_coordinator',
    })


    // Tool execution flow - direct to orchestrator or HITL based on risk


    .addConditionalEdges('hitl_approval', (state) => {
        const approved = state.hitlApprovalResult?.approved;
        if (approved === true) {
          return 'multi_tool_orchestrator';
        } else if (approved === false) {
          return 'brain';
        } else {
          return END;
        }
    }, {
        multi_tool_orchestrator: 'multi_tool_orchestrator',
        brain: 'brain',
        [END]: END
    })

    // After tool execution, route back to brain for coordination
    // UNLESS we are in the middle of a specialist workflow
    .addConditionalEdges('multi_tool_orchestrator', (state) => {
        const specialist = state.returningFromSpecialist;
        console.log(`[Graph] 🔀 multi_tool_orchestrator complete. returningFromSpecialist: ${specialist || 'None'}`);

        if (wasAskUserQuestionExecutedInLastTurn(state)) {
            console.log('[Graph] 🔀 ask_user_question tool executed → routing to ask_user_wait');
            return 'ask_user_wait';
        }

        if (wasTaskCompleteExecutedInLastTurn(state)) {
            console.log('[Graph] ✅ task_complete tool executed → returning to brain/operator for turn completion');
            return state.currentIntent === 'operator' ? 'operator_coordinator' : 'brain';
        }

        if (specialist) {
            console.log(`[Graph] ⬅️ Returning to specialist: ${specialist}`);
            switch (specialist) {
                case 'coding_specialist': return 'coding_specialist';
                case 'data_analyst': return 'data_analyst';
                case 'web_explorer': return 'web_explorer';
                case 'deep_research': return 'deep_research';
            }
        }
        console.log('[Graph] ➡️ Returning to brain');
        return 'brain';
    }, {
        coding_specialist: 'coding_specialist',
        data_analyst: 'data_analyst',
        web_explorer: 'web_explorer',
        deep_research: 'deep_research',
        brain: 'brain',
        operator_coordinator: 'operator_coordinator',
        ask_user_wait: 'ask_user_wait',
    })

    .addConditionalEdges('ask_user_wait', (state) => {
        const specialist = state.returningFromSpecialist;
        console.log(`[ask_user_wait] Routing after user answer. Specialist: ${specialist || 'None'}`);
        if (specialist) {
            switch (specialist) {
                case 'coding_specialist': return 'coding_specialist';
                case 'data_analyst': return 'data_analyst';
                case 'web_explorer': return 'web_explorer';
                case 'deep_research': return 'deep_research';
            }
        }
        return 'brain';
    }, {
        coding_specialist: 'coding_specialist',
        data_analyst: 'data_analyst',
        web_explorer: 'web_explorer',
        deep_research: 'deep_research',
        brain: 'brain',
    })

    .addEdge('memory_consolidator', END);

  const finalGraph = compiledGraph.compile({
    checkpointer: lightweightCheckpointer
  });
  compiledGraphCache.set(cacheKey, finalGraph);
  return finalGraph;
};
