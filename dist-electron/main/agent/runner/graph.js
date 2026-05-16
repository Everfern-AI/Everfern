"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildGraph = void 0;
const langgraph_1 = require("@langchain/langgraph");
const state_1 = require("./state");
const triage_1 = require("./nodes/triage");
const planner_1 = require("./nodes/planner");
const execute_tools_1 = require("./nodes/execute_tools");
const brain_1 = require("./nodes/brain");
const decomposer_1 = require("./nodes/decomposer");
const prompt_sync_1 = require("../../lib/prompt-sync");
const debate_chamber_1 = require("./nodes/debate-chamber");
const specialized_agents_1 = require("./nodes/specialized_agents");
const custom_checkpointer_1 = require("./custom-checkpointer");
const hitl_1 = require("../../store/hitl");
const tool_approvals_1 = require("../../store/tool-approvals");
const crypto = __importStar(require("crypto"));
/**
 * Helper to extract ExecutionContext from LangGraph config
 */
const getContext = (config) => {
    const ctx = config?.configurable?.executionContext;
    if (!ctx) {
        throw new Error('ExecutionContext missing from graph config. Ensure it is passed in the configurable field.');
    }
    return ctx;
};
const buildGraph = (runner, toolDefs, tools) => {
    console.log(`[Graph] 🏗️  BUILDING AGENT EXECUTION GRAPH (with debate_chamber)`);
    console.log(`[Graph] Available tools: ${toolDefs.map(t => t.name).join(', ')}`);
    // Warn if computer_use is missing
    if (!toolDefs.find(t => t.name === 'computer_use')) {
        console.warn(`[Graph] ⚠️ WARNING: computer_use tool is missing from tool definitions!`);
    }
    const hitlNode = async (state, config) => {
        const { runner, eventQueue, missionTracker, conversationId, shouldAbort } = getContext(config);
        if (shouldAbort?.()) {
            throw new Error('Execution aborted by user (stop button clicked)');
        }
        runner.telemetry.transition('hitl');
        if (missionTracker)
            missionTracker.startStep('step:hitl');
        try {
            const formatToolCallSummary = (call) => {
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
            const toolSummary = state.pendingToolCalls?.map(formatToolCallSummary).join('\n') || 'No tools pending';
            const reasoning = 'High-risk operation detected';
            const requestId = crypto.randomUUID();
            const timestamp = new Date().toISOString();
            const approvalRequest = {
                id: requestId,
                conversationId: conversationId || 'unknown',
                timestamp,
                question: "High-risk action detected. Please review and approve:",
                details: {
                    tools: state.pendingToolCalls || [],
                    summary: toolSummary,
                    reasoning,
                },
                options: ['approve', 'reject', 'modify']
            };
            if (conversationId) {
                (0, hitl_1.saveHitlRequest)(approvalRequest);
            }
            // Emit tool_start for approve_actions so frontend knows to expect a result
            eventQueue?.push({
                type: 'tool_start',
                toolName: 'approve_actions',
                toolArgs: { questions: reasoning }
            });
            const { askUserTool } = await Promise.resolve().then(() => __importStar(require('../tools/ask-user')));
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
                    toolName: 'approve_actions',
                    args: { questions: hitlResult.data?.questions },
                    result: hitlResult,
                },
            });
            eventQueue?.push({
                type: 'hitl_request',
                request: approvalRequest,
            });
            // Register interruption in stateManager so runStream can find it upon resume
            const { stateManager } = await Promise.resolve().then(() => __importStar(require('./state-manager')));
            if (conversationId) {
                stateManager.setInterrupted(conversationId, approvalRequest);
            }
            runner.telemetry.info('HITL approval required — ending turn, user must respond');
            if (missionTracker)
                missionTracker.completeStep('step:hitl');
            // Use interrupt() to pause the graph and wait for user response.
            // When the user approves/rejects, the runner resumes with Command({ resume: answer }).
            let answer;
            try {
                answer = (0, langgraph_1.interrupt)(approvalRequest);
            }
            catch (interruptErr) {
                // If interrupt throws (e.g. checkpointer doesn't support it), route to END
                // to prevent infinite recursion. The user's next message will restart the flow.
                runner.telemetry.info('HITL interrupt() threw — ending graph turn to prevent recursion');
                return {
                    taskPhase: 'planning',
                    hitlApprovalResult: {
                        approved: null, // null → routes to END
                        response: 'Waiting for user approval',
                        reasoning: 'HITL paused — awaiting user response',
                    },
                    completionSignal: null,
                };
            }
            const answerStr = String(answer);
            const isApproved = answerStr.includes('[HITL_APPROVED]') ||
                answerStr.includes('[HITL_APPROVED_ALWAYS]') ||
                answerStr.includes('[HITL_APPROVED_PREFIX]');
            if (isApproved && (answerStr.includes('[HITL_APPROVED_ALWAYS]') || answerStr.includes('[HITL_APPROVED_PREFIX]'))) {
                const type = answerStr.includes('[HITL_APPROVED_ALWAYS]') ? 'exact' : 'prefix';
                // Register policies for all pending tools
                for (const tc of state.pendingToolCalls || []) {
                    const args = tc.arguments || {};
                    let pattern = '';
                    const cmdTools = ['terminal_execute', 'executePwsh', 'run_command', 'bash'];
                    if (cmdTools.includes(tc.name)) {
                        const cmd = args.command || args.CommandLine || args.cmd || '';
                        if (type === 'prefix') {
                            // Extract prefix (e.g. "npm install" -> "npm")
                            pattern = cmd.split(' ')[0];
                        }
                        else {
                            pattern = cmd;
                        }
                    }
                    else {
                        // For other tools, we use the tool name as the pattern for now
                        pattern = tc.name;
                    }
                    if (pattern) {
                        tool_approvals_1.toolApprovalStore.addPolicy({
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
                taskPhase: 'executing',
                hitlApprovalResult: {
                    approved: isApproved,
                    response: isApproved ? 'Approved by user' : 'Rejected by user',
                    reasoning: isApproved ? 'User approved the action' : 'User rejected the action',
                },
                completionSignal: null,
            };
        }
        catch (error) {
            if (missionTracker)
                missionTracker.failStep('step:hitl', error instanceof Error ? error.message : String(error));
            // Route to END to prevent infinite recursion when interrupt fails
            return {
                taskPhase: 'planning',
                hitlApprovalResult: {
                    approved: null, // null → routes to END in hitl_approval conditional edges
                    response: 'HITL interrupted or failed',
                    reasoning: `HITL approval failed: ${error instanceof Error ? error.message : String(error)}`,
                },
            };
        }
    };
    // Node wrappers that extract context from config at runtime
    const triageNode = async (state, config) => {
        const ctx = getContext(config);
        // Guard: Check abort before node execution
        if (ctx.shouldAbort?.()) {
            throw new Error('Execution aborted by user (stop button clicked)');
        }
        const node = (0, triage_1.createTriageNode)(ctx.runner, ctx.eventQueue, ctx.missionTracker, ctx.shouldAbort);
        return node(state);
    };
    const decomposerNode = async (state, config) => {
        const ctx = getContext(config);
        // Guard: Check abort before node execution
        if (ctx.shouldAbort?.()) {
            throw new Error('Execution aborted by user (stop button clicked)');
        }
        const node = (0, decomposer_1.createDecomposerNode)(ctx.runner, ctx.eventQueue, ctx.missionTracker, ctx.shouldAbort);
        return node(state);
    };
    const plannerNode = async (state, config) => {
        const ctx = getContext(config);
        // Guard: Check abort before node execution
        if (ctx.shouldAbort?.()) {
            throw new Error('Execution aborted by user (stop button clicked)');
        }
        const node = (0, planner_1.createPlannerNode)(ctx.runner, ctx.eventQueue, ctx.missionTracker, ctx.shouldAbort);
        return node(state);
    };
    const debateChamberNode = async (state, config) => {
        const ctx = getContext(config);
        if (ctx.shouldAbort?.()) {
            throw new Error('Execution aborted by user (stop button clicked)');
        }
        const node = (0, debate_chamber_1.createDebateChamberNode)(ctx.runner, ctx.eventQueue, ctx.missionTracker, ctx.shouldAbort);
        return node(state);
    };
    const brainNode = async (state, config) => {
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
            const mainPrompt = (0, prompt_sync_1.loadPrompt)('SYSTEM_PROMPT.md') || '';
            systemPromptOverride = planContext + mainPrompt;
        }
        const node = (0, brain_1.createBrainNode)(ctx.runner, ctx.eventQueue, ctx.missionTracker, toolDefs, ctx.shouldAbort, systemPromptOverride);
        return node(state);
    };
    const computerUseNode = async (state, config) => {
        const ctx = getContext(config);
        // Guard: Check abort before node execution
        if (ctx.shouldAbort?.()) {
            throw new Error('Execution aborted by user (stop button clicked)');
        }
        const node = (0, specialized_agents_1.createComputerUseNode)(ctx.runner, ctx.eventQueue, ctx.missionTracker, toolDefs);
        return node(state);
    };
    const codingNode = async (state, config) => {
        const ctx = getContext(config);
        // Guard: Check abort before node execution
        if (ctx.shouldAbort?.()) {
            throw new Error('Execution aborted by user (stop button clicked)');
        }
        const node = (0, specialized_agents_1.createCodingSpecialistNode)(ctx.runner, ctx.eventQueue, ctx.missionTracker, toolDefs);
        return node(state);
    };
    const dataAnalystNode = async (state, config) => {
        const ctx = getContext(config);
        // Guard: Check abort before node execution
        if (ctx.shouldAbort?.()) {
            throw new Error('Execution aborted by user (stop button clicked)');
        }
        const node = (0, specialized_agents_1.createDataAnalystNode)(ctx.runner, ctx.eventQueue, ctx.missionTracker, toolDefs);
        return node(state);
    };
    const webExplorerNode = async (state, config) => {
        const ctx = getContext(config);
        // Guard: Check abort before node execution
        if (ctx.shouldAbort?.()) {
            throw new Error('Execution aborted by user (stop button clicked)');
        }
        const node = (0, specialized_agents_1.createWebExplorerNode)(ctx.runner, ctx.eventQueue, ctx.missionTracker, toolDefs);
        return node(state);
    };
    const deepResearchNode = async (state, config) => {
        const ctx = getContext(config);
        if (ctx.shouldAbort?.()) {
            throw new Error('Execution aborted by user (stop button clicked)');
        }
        const node = (0, specialized_agents_1.createDeepResearchNode)(ctx.runner, ctx.eventQueue, ctx.missionTracker, toolDefs);
        return node(state);
    };
    const orchestratorNode = async (state, config) => {
        const ctx = getContext(config);
        // Guard: Check abort before node execution
        if (ctx.shouldAbort?.()) {
            throw new Error('Execution aborted by user (stop button clicked)');
        }
        const node = (0, execute_tools_1.createExecuteToolsNode)(ctx.runner, tools, ctx.runner.config, ctx.eventQueue, ctx.conversationId, ctx.missionTracker, ctx.shouldAbort, ctx.runner.client);
        return node(state);
    };
    const compiledGraph = new langgraph_1.StateGraph(state_1.GraphState)
        .addNode('intent_classifier', triageNode)
        .addNode('task_decomposer', decomposerNode)
        .addNode('global_planner', plannerNode)
        .addNode('debate_chamber', debateChamberNode)
        .addNode('brain', brainNode)
        .addNode('computer_use_agent', computerUseNode)
        .addNode('coding_specialist', codingNode)
        .addNode('data_analyst', dataAnalystNode)
        .addNode('web_explorer', webExplorerNode)
        .addNode('deep_research', deepResearchNode)
        .addNode('hitl_approval', hitlNode)
        .addNode('multi_tool_orchestrator', orchestratorNode);
    // New Brain-Centric Routing Architecture
    compiledGraph
        .addEdge(langgraph_1.START, 'intent_classifier')
        .addEdge('intent_classifier', 'task_decomposer')
        .addConditionalEdges('task_decomposer', (state) => {
        console.log(`[Graph] 🔀 task_decomposer complete`);
        console.log(`[Graph] ➡️ Routing to global_planner`);
        return 'global_planner';
    }, {
        global_planner: 'global_planner'
    })
        .addEdge('global_planner', 'debate_chamber')
        // Debate chamber: runs three-agent debate for complex tasks, routes to brain
        .addConditionalEdges('debate_chamber', (state) => {
        const dr = state.debateResult;
        if (dr?.goNogo === 'no-go') {
            console.log('[Graph] 🔀 Debate chamber voted NO-GO → proceeding to brain anyway (best effort)');
            return 'brain';
        }
        console.log('[Graph] 🔀 Debate chamber complete → brain');
        return 'brain';
    }, {
        brain: 'brain'
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
            console.log('[Graph] 🔀 Brain has tools → multi_tool_orchestrator');
            return 'multi_tool_orchestrator';
        }
        // If brain made a routing decision to specialized agents
        if (routingDecision) {
            console.log(`[Graph] 🔀 Brain routing decision: ${routingDecision.decision}`);
            switch (routingDecision.decision) {
                case 'route_coding':
                    return 'coding_specialist';
                case 'route_data_analyst':
                    return 'data_analyst';
                case 'route_computer_use':
                    return 'computer_use_agent';
                case 'route_web_explorer':
                    // Always use web_explorer for web research tasks to ensure navis is used
                    return 'web_explorer';
                case 'complete_task':
                    // Sub-task 3.3: Ensure complete_task routes to END
                    console.log('[Graph] ➡️ Brain routing decision: complete_task → END');
                    return langgraph_1.END;
                case 'continue_brain':
                    // Sub-task 3.3: Ensure continue_brain routes to END (not loop back to brain)
                    console.log('[Graph] ➡️ Brain routing decision: continue_brain → END');
                    return langgraph_1.END;
                default:
                    console.log('[Graph] ➡️ Unknown routing decision, defaulting to END');
                    return langgraph_1.END;
            }
        }
        // Default to END for completion
        console.log('[Graph] ➡️ Task complete → END');
        return langgraph_1.END;
    }, {
        hitl_approval: 'hitl_approval',
        multi_tool_orchestrator: 'multi_tool_orchestrator',
        coding_specialist: 'coding_specialist',
        data_analyst: 'data_analyst',
        computer_use_agent: 'computer_use_agent',
        web_explorer: 'web_explorer',
        deep_research: 'deep_research',
        [langgraph_1.END]: langgraph_1.END,
    })
        // All specialized agents route back to brain for coordination
        .addConditionalEdges('coding_specialist', (state) => {
        const hasTools = state.pendingToolCalls && state.pendingToolCalls.length > 0;
        if (hasTools) {
            console.log('[Graph] 🔀 Coding specialist has tools → multi_tool_orchestrator');
            return 'multi_tool_orchestrator';
        }
        // Keep specialist in control if not complete
        if (!state.codingComplete) {
            console.log('[Graph] 🔀 Coding specialist not complete → coding_specialist');
            return 'coding_specialist';
        }
        console.log('[Graph] 🔀 Coding specialist complete → brain');
        return 'brain';
    }, {
        multi_tool_orchestrator: 'multi_tool_orchestrator',
        coding_specialist: 'coding_specialist',
        brain: 'brain',
    })
        .addConditionalEdges('data_analyst', (state) => {
        const hasTools = state.pendingToolCalls && state.pendingToolCalls.length > 0;
        if (hasTools) {
            console.log('[Graph] 🔀 Data analyst has tools → multi_tool_orchestrator');
            return 'multi_tool_orchestrator';
        }
        // Keep specialist in control if not complete
        if (!state.dataAnalysisComplete) {
            console.log('[Graph] 🔀 Data analyst not complete → data_analyst');
            return 'data_analyst';
        }
        console.log('[Graph] 🔀 Data analyst complete → brain');
        return 'brain';
    }, {
        multi_tool_orchestrator: 'multi_tool_orchestrator',
        data_analyst: 'data_analyst',
        brain: 'brain',
    })
        .addConditionalEdges('computer_use_agent', (state) => {
        const hasTools = state.pendingToolCalls && state.pendingToolCalls.length > 0;
        if (hasTools) {
            console.log('[Graph] 🔀 Computer use agent has tools → multi_tool_orchestrator');
            return 'multi_tool_orchestrator';
        }
        // Keep specialist in control if not complete
        if (!state.computerUseComplete) {
            console.log('[Graph] 🔀 Computer use agent not complete → computer_use_agent');
            return 'computer_use_agent';
        }
        console.log('[Graph] 🔀 Computer use agent complete → brain');
        return 'brain';
    }, {
        multi_tool_orchestrator: 'multi_tool_orchestrator',
        computer_use_agent: 'computer_use_agent',
        brain: 'brain',
    })
        .addConditionalEdges('web_explorer', (state) => {
        const hasTools = state.pendingToolCalls && state.pendingToolCalls.length > 0;
        if (hasTools) {
            console.log('[Graph] 🔀 Web explorer has tools → multi_tool_orchestrator');
            return 'multi_tool_orchestrator';
        }
        // Sub-task 3.4: Check if web explorer workflow is complete
        const webExplorerComplete = state.webExplorerComplete;
        if (webExplorerComplete) {
            console.log('[Graph] 🔀 Web explorer workflow complete (webExplorerComplete: true) → brain');
            return 'brain';
        }
        // Bug 5: Iteration limit for web_explorer self-loop
        const loopCount = state.webExplorerSelfLoopCount || 0;
        const MAX_SELF_LOOPS = 3;
        if (loopCount >= MAX_SELF_LOOPS) {
            console.warn(`[Graph] ⚠️ Web explorer reached MAX_SELF_LOOPS (${MAX_SELF_LOOPS}) → breaking loop to brain`);
            return 'brain';
        }
        // Sub-task 3.4: If no tools and not complete, continue web explorer workflow
        console.log('[Graph] 🔀 Web explorer continuing workflow (webExplorerComplete: false) → web_explorer');
        return 'web_explorer';
    }, {
        multi_tool_orchestrator: 'multi_tool_orchestrator',
        brain: 'brain',
        [langgraph_1.END]: langgraph_1.END,
    })
        .addConditionalEdges('deep_research', (state) => {
        const hasTools = state.pendingToolCalls && state.pendingToolCalls.length > 0;
        if (hasTools) {
            console.log('[Graph] 🔀 Deep research has tools → multi_tool_orchestrator');
            return 'multi_tool_orchestrator';
        }
        // Keep specialist in control if not complete
        if (!state.deepResearchComplete) {
            console.log('[Graph] 🔀 Deep research not complete → deep_research');
            return 'deep_research';
        }
        console.log('[Graph] 🔀 Deep research complete → brain');
        return 'brain';
    }, {
        multi_tool_orchestrator: 'multi_tool_orchestrator',
        deep_research: 'deep_research',
        brain: 'brain',
    })
        // Tool execution flow - direct to orchestrator or HITL based on risk
        .addConditionalEdges('hitl_approval', (state) => {
        const approved = state.hitlApprovalResult?.approved;
        if (approved === true) {
            return 'multi_tool_orchestrator';
        }
        else if (approved === false) {
            return 'brain';
        }
        else {
            return langgraph_1.END;
        }
    }, {
        multi_tool_orchestrator: 'multi_tool_orchestrator',
        brain: 'brain',
        [langgraph_1.END]: langgraph_1.END
    })
        // After tool execution, route back to brain for coordination
        // UNLESS we are in the middle of a specialist workflow
        .addConditionalEdges('multi_tool_orchestrator', (state) => {
        const specialist = state.returningFromSpecialist;
        console.log(`[Graph] 🔀 multi_tool_orchestrator complete. returningFromSpecialist: ${specialist || 'None'}`);
        if (specialist) {
            console.log(`[Graph] ⬅️ Returning to specialist: ${specialist}`);
            switch (specialist) {
                case 'coding_specialist': return 'coding_specialist';
                case 'data_analyst': return 'data_analyst';
                case 'computer_use_agent': return 'computer_use_agent';
                case 'web_explorer': return 'web_explorer';
                case 'deep_research': return 'deep_research';
            }
        }
        console.log('[Graph] ➡️ Returning to brain');
        return 'brain';
    }, {
        coding_specialist: 'coding_specialist',
        data_analyst: 'data_analyst',
        computer_use_agent: 'computer_use_agent',
        web_explorer: 'web_explorer',
        deep_research: 'deep_research',
        brain: 'brain',
    });
    const finalGraph = compiledGraph.compile({
        checkpointer: custom_checkpointer_1.lightweightCheckpointer
    });
    return finalGraph;
};
exports.buildGraph = buildGraph;
