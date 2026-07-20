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

const INTERACTIVE_AUTOMATION_TOOLS = new Set(['navis', 'computer_use', 'synthesize_tool', 'synthesize_skill']);

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

export const buildGraph = (
  runner: AgentRunner,
  toolDefs: any[],
  tools: any[],
) => {
  console.log(`[Graph] 🏗️  BUILDING AGENT EXECUTION GRAPH (with debate_chamber)`);
  console.log(`[Graph] Available tools: ${toolDefs.map(t => t.name).join(', ')}`);

  // Warn if computer_use is missing
  if (!toolDefs.find(t => t.name === 'computer_use')) {
    console.warn(`[Graph] ⚠️ WARNING: computer_use tool is missing from tool definitions!`);
  }

  const hitlNode = async (state: GraphStateType, config?: any) => {
    const { runner, eventQueue, missionTracker, conversationId, shouldAbort, isResuming } = getContext(config);

    if (shouldAbort?.()) {
      throw new Error('Execution aborted by user (stop button clicked)');
    }

    runner.telemetry.transition('hitl');
    if (missionTracker) missionTracker.startStep('step:hitl');

    try {
      const { stateManager } = await import('./state-manager');

      let originalRequest: any = null;
      if (isResuming) {
        originalRequest = stateManager.getInterruptData(conversationId || 'unknown');
        if (!originalRequest && conversationId) {
          const records = listHitlRecords(conversationId);
          if (records.length > 0) {
            originalRequest = records[0].request;
            console.log(`[hitlNode] Found original request on disk: ${originalRequest.id}`);
          }
        }
      }

      const shouldSkipEvents = isResuming && !!originalRequest;

      const formatToolCallSummary = (call: any) => {
        const name = call.name;
        const args = call.arguments || {};

        // Specialize formatting for terminal commands
        if (name === 'terminal_execute' || name === 'executePwsh' || name === 'run_command' || name === 'bash') {
          const cmd = args.command || args.CommandLine || args.cmd || JSON.stringify(args);
          return `**${name}** — \`${cmd}\``;
        }

        // Default formatting for other tools
        return `**${name}** — \`${JSON.stringify(args).slice(0, 120)}\``;
      };

      const buildFallbackActionSummary = () => {
        const signal = state.completionSignal;
        const rationale = String(signal?.hitlRationale || signal?.explanation || '').trim();
        if (!rationale) {
          return '**approval_required** — `Review the security rationale before proceeding.`';
        }

        const backtickCommand = rationale.match(/`([^`]{3,500})`/)?.[1]?.trim();
        if (backtickCommand) {
          return `**approval_required** — \`${backtickCommand}\``;
        }

        const quotedCommand = rationale.match(/["“]([^"”]{3,500})["”]/)?.[1]?.trim();
        if (quotedCommand && /(?:npm|npx|pnpm|yarn|powershell|pwsh|cmd|python|node|git|rm|del|remove|new-item|mkdir|copy|move|curl|invoke-webrequest)/i.test(quotedCommand)) {
          return `**approval_required** — \`${quotedCommand}\``;
        }

        return `**approval_required** — \`${rationale.slice(0, 240)}${rationale.length > 240 ? '…' : ''}\``;
      };

      // If pendingToolCalls is empty but we're in HITL, check the message history for tool calls
      let toolsToDisplay = originalRequest ? originalRequest.details.tools : (state.pendingToolCalls || []);
      if (toolsToDisplay.length === 0 && state.messages && state.messages.length > 0) {
        // Look for tool calls in the last assistant message
        for (let i = state.messages.length - 1; i >= 0; i--) {
          const msg = state.messages[i] as any;
          if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
            toolsToDisplay = msg.tool_calls.map((tc: any) => ({
              name: tc.function?.name || tc.name || 'unknown',
              arguments: tc.function?.arguments ?
                (typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments) : tc.function.arguments)
                : tc.arguments || {}
            }));
            break;
          }
        }
      }

      const toolSummary = originalRequest ? originalRequest.details.summary : (
        toolsToDisplay.length > 0
          ? toolsToDisplay.map(formatToolCallSummary).join('\n')
          : buildFallbackActionSummary()
      );

      const hasInteractiveAutomation = toolsToDisplay.some((tc: any) => INTERACTIVE_AUTOMATION_TOOLS.has(tc.name));
      const hasToolSynthesis = toolsToDisplay.some((tc: any) => tc.name === 'synthesize_tool');
      const hasSkillSynthesis = toolsToDisplay.some((tc: any) => tc.name === 'synthesize_skill');
      const hitlRationale = originalRequest ? originalRequest.details.reasoning : (
        state.completionSignal?.hitlRationale ||
        (hasToolSynthesis
          ? 'An agent is requesting to synthesize and register a new custom tool. Please review the proposed tool code before approving.'
          : hasSkillSynthesis
            ? 'An agent is requesting to synthesize and register a new custom skill. Please review the proposed skill instructions before approving.'
            : hasInteractiveAutomation
              ? 'Interactive browser or desktop automation requires your permission before EverFern can control Navis or the computer.'
              : 'High-risk operation detected')
      );
      const reasoning = hitlRationale;
      const requestId = originalRequest ? originalRequest.id : crypto.randomUUID();
      const timestamp = originalRequest ? originalRequest.timestamp : new Date().toISOString();

      const approvalRequest = originalRequest || {
        id: requestId,
        conversationId: conversationId || 'unknown',
        timestamp,
        question: "High-risk action detected. Please review and approve:",
        details: {
          tools: toolsToDisplay,
          summary: toolSummary,
          reasoning,
        },
        options: ['approve', 'reject', 'modify']
      };

      if (!shouldSkipEvents) {
        if (conversationId) {
          saveHitlRequest(approvalRequest);
        }

        // Emit tool_start for approve_actions so frontend knows to expect a result
        eventQueue?.push({
          type: 'tool_start',
          toolName: 'approve_actions',
          toolCallId: approvalRequest.id,
          toolArgs: { questions: reasoning }
        });

        const { askUserTool } = await import('../tools/ask-user');
        const hitlResult = await askUserTool.execute({
          questions: [
            {
              question: `⚠️ Security Check Required\n\n${reasoning}\n\nActions to execute:\n${toolSummary}`,
              options: [
                '✅ Approve — proceed once',
                '🚀 Approve & Allow Always — never ask for this specific command again',
                '📂 Approve & Allow Prefix — never ask for commands starting with this base (e.g. npm)',
                '❌ Reject — cancel and do not proceed'
              ],
              multiSelect: false,
            }
          ]
        }, (msg) => runner.telemetry.info(msg));

        eventQueue?.push({
          type: 'tool_call',
          toolCall: {
            id: approvalRequest.id,
            toolCallId: approvalRequest.id,
            toolName: 'approve_actions',
            args: { questions: (hitlResult.data as any)?.questions },
            result: hitlResult,
          },
        } as any);

        eventQueue?.push({
          type: 'hitl_request',
          request: approvalRequest,
        } as any);

        // Register interruption in stateManager so runStream can find it upon resume
        if (conversationId) {
          stateManager.setInterrupted(conversationId, approvalRequest);
        }
      }

      runner.telemetry.info(shouldSkipEvents ? 'Resuming HITL approval — skipping request emission' : 'HITL approval required — ending turn, user must respond');
      if (missionTracker) missionTracker.completeStep('step:hitl');

      // Use interrupt() to pause the graph and wait for user response.
      // When the user approves/rejects, the runner resumes with Command({ resume: answer }).
      // BUG-11 FIX: The inner catch must re-throw GraphInterrupt so LangGraph
      // can properly pause the graph. Only catch non-interrupt errors.
      let answer: any;
      try {
        answer = interrupt(approvalRequest);
      } catch (interruptErr: any) {
        // Re-throw GraphInterrupt — this is how LangGraph pauses the graph
        if (interruptErr && (interruptErr instanceof GraphInterrupt || interruptErr.name === 'GraphInterrupt' || interruptErr.constructor?.name === 'GraphInterrupt')) {
          throw interruptErr;
        }
        // Only non-interrupt errors route to END to prevent infinite recursion
        runner.telemetry.info('HITL interrupt() threw a non-interrupt error — ending graph turn to prevent recursion');
        return {
          taskPhase: 'planning' as const,
          hitlApprovalResult: {
            approved: null as any, // null → routes to END
            response: 'Waiting for user approval',
            reasoning: 'HITL paused — awaiting user response',
          },
          completionSignal: null,
        };
      }

      const answerStr = String(answer);
      const isApproved = answerStr.includes('[HITL_APPROVED]') ||
                         answerStr.includes('[HITL_APPROVED_ALWAYS]') ||
                         answerStr.includes('[HITL_APPROVED_PREFIX]') ||
                         answerStr.includes('Approve — proceed once') ||
                         answerStr.includes('proceed once') ||
                         answerStr.includes('Approve & Allow Always') ||
                         answerStr.includes('Approve & Allow Prefix');

      if (isApproved && (
        answerStr.includes('[HITL_APPROVED_ALWAYS]') ||
        answerStr.includes('[HITL_APPROVED_PREFIX]') ||
        answerStr.includes('Approve & Allow Always') ||
        answerStr.includes('Approve & Allow Prefix')
      )) {
        const type = (answerStr.includes('[HITL_APPROVED_ALWAYS]') || answerStr.includes('Approve & Allow Always')) ? 'exact' : 'prefix';

        // Register policies for all pending tools
        for (const tc of toolsToDisplay) {
          const args = tc.arguments || {};
          let pattern = '';

          const cmdTools = ['terminal_execute', 'executePwsh', 'run_command', 'bash'];
          if (cmdTools.includes(tc.name)) {
            const cmd = args.command || args.CommandLine || args.cmd || '';
            if (type === 'prefix') {
              // Extract prefix (e.g. "npm install" -> "npm")
              pattern = cmd.split(' ')[0];
            } else {
              pattern = cmd;
            }
          } else {
            // For other tools, we use the tool name as the pattern for now
            pattern = tc.name;
          }

          if (pattern) {
            toolApprovalStore.addPolicy({
              type,
              toolName: tc.name,
              pattern
            });
            runner.telemetry.info(`Registered auto-approval policy: ${type} match for ${tc.name} with pattern "${pattern}"`);
          }
        }
      }

      runner.telemetry.info(`HITL response received: ${isApproved ? 'APPROVED' : 'REJECTED'}`);

      return {
        taskPhase: 'executing' as const,
        hitlApprovalResult: {
          approved: isApproved,
          response: isApproved ? 'Approved by user' : 'Rejected by user',
          reasoning: isApproved ? 'User approved the action' : 'User rejected the action',
        },
        completionSignal: null,
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
      ['read_file', 'write_to_file', 'replace_file_content', 'multi_replace_file_content', 'grep_search', 'list_dir', 'run_command', 'terminal_execute', 'spawn_agent', 'ask_user_question'].includes(t.name) || 
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
      ['read_file', 'write_to_file', 'replace_file_content', 'multi_replace_file_content', 'list_dir', 'run_command', 'terminal_execute', 'ask_user_question'].includes(t.name) || 
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
      ['navis', 'browser_subagent', 'read_url_content', 'search_web', 'ask_user_question', 'spawn_agent'].includes(t.name)
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
      ['navis', 'browser_subagent', 'read_url_content', 'search_web', 'ask_user_question'].includes(t.name)
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

    // Clean up interrupted state in stateManager
    if (conversationId) {
      stateManager.resumeFromInterrupt(conversationId, null);
    }

    const userMessage = {
      role: 'user',
      content: answerStr,
      id: `msg-user-ans-${Date.now()}`
    };

    // BUG-02 FIX: Return only the NEW message. LangGraph's MessagesAnnotation
    // uses an 'add' reducer — spreading the entire state.messages array causes
    // every existing message to be duplicated.
    return {
      messages: [userMessage],
      returningFromSpecialist: state.returningFromSpecialist,
      codingComplete: false,
      dataAnalysisComplete: false,
      webExplorerComplete: false,
      deepResearchComplete: false,
      resumingFromFormResponse: true,
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
                case 'route_deep_research': return 'web_explorer';
            }
        }
        return 'memory_consolidator';
    }, {
        task_decomposer: 'task_decomposer',
        coding_specialist: 'coding_specialist',
        data_analyst: 'data_analyst',
        web_explorer: 'web_explorer',
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
                case 'route_deep_research':
                    // Always use web_explorer for web research tasks to ensure navis is used
                    return 'web_explorer';
                case 'complete_task':
                    console.log('[Graph] ➡️ Brain routing decision: complete_task → memory_consolidator');
                    return 'memory_consolidator';
                case 'continue_brain':
                    if (!completionSignal) {
                        console.warn('[Graph] ⚠️ continue_brain but completionSignal is null (likely parse error) → memory_consolidator');
                        return 'memory_consolidator';
                    }
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
    // BUG-03 FIX: Added self-loop guard for coding_specialist to prevent infinite loops
    .addConditionalEdges('coding_specialist', (state) => {
        const hasTools = state.pendingToolCalls && state.pendingToolCalls.length > 0;

        if (hasTools) {
            const route = routePendingToolsWithAutomationApproval(state, 'Coding specialist');
            console.log(`[Graph] 🔀 Coding specialist has tools → ${route}`);
            return route;
        }

        // BUG-03 FIX: Loop guard — prevent infinite self-loops
        const loopCount = state.codingSpecialistSelfLoopCount || 0;
        const MAX_SELF_LOOPS = 5;
        if (loopCount >= MAX_SELF_LOOPS) {
            console.warn(`[Graph] ⚠️ Coding specialist reached MAX_SELF_LOOPS (${MAX_SELF_LOOPS}) → breaking loop to ` + (state.currentIntent === 'operator' ? 'operator_coordinator' : 'brain'));
            return state.currentIntent === 'operator' ? 'operator_coordinator' : 'brain';
        }

        // Keep specialist in control if not complete
        if (!state.codingComplete) {
            console.log('[Graph] 🔀 Coding specialist not complete → coding_specialist');
            return 'coding_specialist';
        }

        console.log('[Graph] 🔀 Coding specialist complete → ' + (state.currentIntent === 'operator' ? 'operator_coordinator' : 'brain'));
        return state.currentIntent === 'operator' ? 'operator_coordinator' : 'brain';
    }, {
        hitl_approval: 'hitl_approval',
        multi_tool_orchestrator: 'multi_tool_orchestrator',
        coding_specialist: 'coding_specialist',
        brain: 'brain',
        operator_coordinator: 'operator_coordinator',
    })

    // BUG-03 FIX: Added self-loop guard for data_analyst to prevent infinite loops
    .addConditionalEdges('data_analyst', (state) => {
        const hasTools = state.pendingToolCalls && state.pendingToolCalls.length > 0;

        if (hasTools) {
            const route = routePendingToolsWithAutomationApproval(state, 'Data analyst');
            console.log(`[Graph] 🔀 Data analyst has tools → ${route}`);
            return route;
        }

        // BUG-03 FIX: Loop guard — prevent infinite self-loops
        const loopCount = state.dataAnalysisSelfLoopCount || 0;
        const MAX_SELF_LOOPS = 5;
        if (loopCount >= MAX_SELF_LOOPS) {
            console.warn(`[Graph] ⚠️ Data analyst reached MAX_SELF_LOOPS (${MAX_SELF_LOOPS}) → breaking loop to ` + (state.currentIntent === 'operator' ? 'operator_coordinator' : 'brain'));
            return state.currentIntent === 'operator' ? 'operator_coordinator' : 'brain';
        }

        // Keep specialist in control if not complete
        if (!state.dataAnalysisComplete) {
            console.log('[Graph] 🔀 Data analyst not complete → data_analyst');
            return 'data_analyst';
        }

        console.log('[Graph] 🔀 Data analyst complete → ' + (state.currentIntent === 'operator' ? 'operator_coordinator' : 'brain'));
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

        // Bug 5: Iteration limit for web_explorer self-loop
        const loopCount = state.webExplorerSelfLoopCount || 0;
        const MAX_SELF_LOOPS = 3;
        if (loopCount >= MAX_SELF_LOOPS) {
            console.warn(`[Graph] ⚠️ Web explorer reached MAX_SELF_LOOPS (${MAX_SELF_LOOPS}) → breaking loop to ` + (state.currentIntent === 'operator' ? 'operator_coordinator' : 'brain'));
            return state.currentIntent === 'operator' ? 'operator_coordinator' : 'brain';
        }

        // Sub-task 3.4: Check if web explorer workflow is complete
        const webExplorerComplete = state.webExplorerComplete;
        if (webExplorerComplete) {
            console.log('[Graph] 🔀 Web explorer workflow complete (webExplorerComplete: true) → ' + (state.currentIntent === 'operator' ? 'operator_coordinator' : 'brain'));
            return state.currentIntent === 'operator' ? 'operator_coordinator' : 'brain';
        }

        // Sub-task 3.4: If no tools and not complete, continue web explorer workflow
        console.log('[Graph] 🔀 Web explorer continuing workflow (webExplorerComplete: false) → web_explorer');
        return 'web_explorer';

    }, {
        hitl_approval: 'hitl_approval',
        multi_tool_orchestrator: 'multi_tool_orchestrator',
        brain: 'brain',
        web_explorer: 'web_explorer',
        operator_coordinator: 'operator_coordinator',
        [END]: END,
    })

    // BUG-04 FIX: Added operator_coordinator routing and edge for deep_research
    .addConditionalEdges('deep_research', (state) => {
        const hasTools = state.pendingToolCalls && state.pendingToolCalls.length > 0;

        if (hasTools) {
            const route = routePendingToolsWithAutomationApproval(state, 'Deep research');
            console.log(`[Graph] 🔀 Deep research has tools → ${route}`);
            return route;
        }

        // Loop guard for deep_research
        const loopCount = state.deepResearchSelfLoopCount || 0;
        const MAX_SELF_LOOPS = 5;
        if (loopCount >= MAX_SELF_LOOPS) {
            console.warn(`[Graph] ⚠️ Deep research reached MAX_SELF_LOOPS (${MAX_SELF_LOOPS}) → breaking loop`);
            return state.currentIntent === 'operator' ? 'operator_coordinator' : 'brain';
        }

        // Keep specialist in control if not complete
        if (!state.deepResearchComplete) {
            console.log('[Graph] 🔀 Deep research not complete → deep_research');
            return 'deep_research';
        }

        console.log('[Graph] 🔀 Deep research complete → ' + (state.currentIntent === 'operator' ? 'operator_coordinator' : 'brain'));
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
    });

  const finalGraph = compiledGraph.compile({
    checkpointer: lightweightCheckpointer
  });
  return finalGraph;
};
