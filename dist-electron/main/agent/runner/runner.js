"use strict";
/**
 * EverFern Desktop — Agent Runner (AGI Edition)
 *
 * This is the main orchestration class for the autonomous agent.
 */
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
exports.AgentRunner = void 0;
const os = __importStar(require("os"));
const crypto = __importStar(require("crypto"));
const ai_client_1 = require("../../lib/ai-client");
const system_prompt_1 = require("./system-prompt");
const history_1 = require("../../store/history");
const graph_1 = require("./graph");
const skills_loader_1 = require("./skills-loader");
const tools_manager_1 = require("./tools_manager");
const prompt_sync_1 = require("../../lib/prompt-sync");
const telemetry_logger_1 = require("../helpers/telemetry-logger");
const state_manager_1 = require("./state-manager");
const abort_manager_1 = require("./abort-manager");
const pi_tools_1 = require("../tools/pi-tools");
// Lifecycle/Infra
const agent_events_1 = require("../infra/agent-events");
const sessions_1 = require("../sessions");
const DEFAULT_CONFIG = {
    maxIterations: 100,
    enableTerminal: true,
};
class AgentRunner {
    client;
    tools;
    config;
    skills = [];
    completionGateRetries = 0;
    currentConversationId;
    /** Session key of the currently executing sub-agent (set by subagent-spawn.ts for depth tracking). */
    currentAgentSessionKey;
    workspaceDir;
    projectId;
    telemetry;
    navisOrchestrator;
    /** Session lock map to prevent concurrent execution on the same conversation */
    static sessionLocks = new Map();
    constructor(client, config = {}) {
        this.client = client;
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.skills = []; // Initialize empty, will be loaded asynchronously
        this.tools = (0, tools_manager_1.getBaseTools)(this);
        console.log(`[AgentRunner] Constructor: Initialized ${this.tools.length} base tools.`);
        // Start async initialization but don't block constructor
        this.initializePiTools();
        this.initializeSkills();
        this.telemetry = new telemetry_logger_1.TelemetryLogger(this.client.model, this.config.silent);
    }
    /**
     * Ensure all asynchronous tool/skill initialization is complete
     */
    async waitForToolsReady() {
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
    async initializeSkills() {
        try {
            if (this.skills.length > 0)
                return;
            this.skills = await (0, skills_loader_1.loadSkillsAsync)();
            console.log(`[AgentRunner] ✅ Skills loaded: ${this.skills.length}`);
        }
        catch (error) {
            console.error('[AgentRunner] Failed to load skills asynchronously:', error);
            this.skills = []; // Fallback to empty array
        }
    }
    async initializePiTools() {
        try {
            const piTools = await (0, pi_tools_1.getPiCodingTools)();
            if (!this.tools.find(t => t.name === piTools[0].name)) {
                console.log(`[AgentRunner] 🔄 Registering ${piTools.length} Pi coding tools...`);
                this.tools.push(...piTools, this.createSpawnAgentTool());
                console.log(`[AgentRunner] ✅ Pi coding tools registered. Total tools: ${this.tools.length}`);
            }
        }
        catch (error) {
            console.error('[AgentRunner] Failed to initialize Pi tools:', error);
        }
    }
    /**
     * Get or create a pooled AI client for better performance
     * This ensures we reuse connections instead of creating new clients
     */
    getClient(config) {
        if (!config) {
            return this.client;
        }
        // Use pooled client for better performance
        return (0, ai_client_1.getPooledAIClient)({
            provider: (config.provider || this.client.provider),
            model: config.model || this.client.model,
            apiKey: config.apiKey || this.client.apiKey,
            baseUrl: config.baseUrl
        });
    }
    /**
     * Release a pooled client back to the pool
     */
    releaseClient(client, config) {
        if (client === this.client) {
            return; // Don't release the main client
        }
        (0, ai_client_1.releasePooledAIClient)(client, {
            provider: (config.provider || this.client.provider),
            model: config.model || this.client.model,
            apiKey: config.apiKey || this.client.apiKey,
            baseUrl: config.baseUrl
        });
    }
    createSpawnAgentTool() {
        const AGENT_TYPE_PROMPTS = {
            'coding-specialist': 'coding-specialist.md',
            'web-explorer': 'web-explorer.md',
            'data-analyst': 'data-analyst.md',
            'computer-use': 'computer-use.md',
        };
        const AGENT_TYPE_TIMEOUT = {
            'web-explorer': 300000,
            'coding-specialist': 180000,
            'computer-use': 180000,
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
                    agent_type: { type: 'string', description: 'Type of specialist agent. Options: generic, coding-specialist, web-explorer, data-analyst, computer-use.', enum: ['generic', 'coding-specialist', 'web-explorer', 'data-analyst', 'computer-use'] },
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
                const task = args.task;
                const agentType = args.agent_type || 'generic';
                const context = args.context || '';
                const maxDepth = Math.min(args.max_depth || 2, 3);
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
                    let parentHistory = [];
                    try {
                        const chatHistoryStore = new history_1.ChatHistoryStore();
                        const fullConversation = await chatHistoryStore.load(this.currentConversationId || 'default');
                        if (fullConversation && fullConversation.messages.length > 0) {
                            const reconstructed = reconstructFullHistory(fullConversation.messages, '');
                            parentHistory = reconstructed.slice(-40);
                            console.log(`[SubagentSpawn] Loaded ${parentHistory.length} messages from parent`);
                        }
                    }
                    catch (historyErr) {
                        console.warn('[SubagentSpawn] Failed to load parent history:', historyErr);
                        parentHistory = [];
                    }
                    let systemPrompt;
                    const promptFile = AGENT_TYPE_PROMPTS[agentType];
                    if (promptFile) {
                        systemPrompt = (0, prompt_sync_1.loadPrompt)(promptFile) || undefined;
                    }
                    const { getSubagentSpawner } = await Promise.resolve().then(() => __importStar(require('./subagent-spawn')));
                    const spawner = getSubagentSpawner();
                    const spawnedAgent = await spawner.spawn({
                        parentSessionId: this.currentConversationId || 'default',
                        sponsorSessionKey: this.currentAgentSessionKey,
                        task,
                        agentType: agentType,
                        context,
                        model: this.client.model,
                        maxDepth,
                        parentHistory: parentHistory,
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
                }
                catch (err) {
                    return { success: false, output: `Spawn failed: ${err}` };
                }
            }
        };
    }
    /**
     * Abort the current execution
     * Requirement 1.1: Stop button shall immediately set the Stream_Abort_Flag to true
     */
    abort() {
        abort_manager_1.globalAbortManager.setAborted();
        console.log('[AgentRunner] 🛑 Abort requested - execution will be terminated');
    }
    /**
     * Check if execution is currently aborted
     */
    isAborted() {
        return abort_manager_1.globalAbortManager.streamAborted;
    }
    /**
     * Get abort timing information for debugging
     */
    getAbortTiming() {
        return abort_manager_1.globalAbortManager.getAbortTiming();
    }
    shouldCaptureScreenshot(userInput) {
        const text = typeof userInput === 'string' ? userInput : JSON.stringify(userInput);
        const explicitVisionKeywords = /take.*screenshot|capture.*screen|see.*screen|show.*screen|look.*at.*screen|view.*screen|desktop|click|open.*app|find.*icon|locate.*button|open.*window|minimize|maximize|close.*window|browser|gui automation|computer use/i;
        return explicitVisionKeywords.test(text);
    }
    _buildToolDefinitions() {
        const toolDefs = [];
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
                parameters: t.parameters,
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
    async run(userInput, history, model, conversationId, systemPromptOverride, projectId) {
        const stream = this.runStream(userInput, history, model, conversationId, systemPromptOverride, projectId);
        let lastResponse = '';
        let toolCalls = [];
        for await (const event of stream) {
            if (event.type === 'done')
                break;
            if (event.type === 'chunk')
                lastResponse += event.content;
            if (event.type === 'tool_call')
                toolCalls.push(event.toolCall);
        }
        return { response: lastResponse, toolCalls };
    }
    async *runStream(userInput, history, model, conversationId, systemPromptOverride, projectId, isSubagent) {
        // Reset abort state for new execution
        abort_manager_1.globalAbortManager.reset();
        const convId = conversationId || crypto.randomUUID();
        // UNITY: Ensure only one execution runs at a time for this conversation
        // This prevents clobbering state and "messages being wiped" due to race conditions
        const existingLock = AgentRunner.sessionLocks.get(convId);
        if (existingLock) {
            console.log(`[AgentRunner] ⏳ Waiting for existing execution on session ${convId} to finish...`);
            await existingLock;
        }
        let resolveLock;
        const lockPromise = new Promise(resolve => { resolveLock = resolve; });
        AgentRunner.sessionLocks.set(convId, lockPromise);
        try {
            if (model)
                this.client.setModel(model);
            this.telemetry.setAgentId(this.client.model);
            this.projectId = projectId;
            if (projectId) {
                try {
                    const { projectsStore } = await Promise.resolve().then(() => __importStar(require('../../store/projects/projects')));
                    const project = await projectsStore.get(projectId);
                    if (project) {
                        this.workspaceDir = project.path;
                        console.log(`[AgentRunner] 📂 Project context detected: ${project.name} (${project.path})`);
                    }
                }
                catch (err) {
                    console.warn(`[AgentRunner] Failed to resolve project ${projectId}:`, err);
                }
            }
            this.currentConversationId = convId;
            const sessionKey = `session:${convId}`;
            (0, sessions_1.sessionCreated)(sessionKey);
            (0, agent_events_1.emitLifecycle)(sessionKey, 'session_started', { convId, model: this.client.model });
            // REAL-TIME PERSISTENCE: Initialize ChatHistoryStore and save initial user message
            const chatHistoryStore = new history_1.ChatHistoryStore();
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
                        ],
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString()
                    });
                }
            }
            catch (err) {
                console.warn('[AgentRunner] Failed to initialize real-time persistence:', err);
            }
            // Check if this is a HITL approval/rejection response
            const isHitlResponse = textInput.includes('[HITL_APPROVED]') || textInput.includes('[HITL_REJECTED]');
            if (isHitlResponse) {
                const approved = textInput.includes('[HITL_APPROVED]');
                console.log(`[Runner] HITL response detected: ${approved ? 'APPROVED' : 'REJECTED'}`);
                // Try to find the request ID from state manager
                const state = state_manager_1.stateManager.getState(convId);
                const interruptData = state_manager_1.stateManager.getInterruptData(convId);
                if (interruptData && interruptData.id) {
                    const { saveHitlResponse } = await Promise.resolve().then(() => __importStar(require('../../store/hitl')));
                    const responseId = crypto.randomUUID();
                    const timestamp = new Date().toISOString();
                    saveHitlResponse({
                        id: responseId,
                        requestId: interruptData.id,
                        conversationId: convId,
                        timestamp,
                        approved,
                        response: textInput,
                    });
                    console.log(`[Runner] HITL response saved: ${responseId} (${approved ? 'approved' : 'rejected'})`);
                }
            }
            // Initialize mission tracker for timeline tracking
            const { getMissionTracker } = await Promise.resolve().then(() => __importStar(require('./mission-tracker')));
            const missionTracker = getMissionTracker(convId);
            // Initialize duration tracker for thinking time tracking
            const { DurationTracker } = await Promise.resolve().then(() => __importStar(require('./duration-tracker')));
            const durationTracker = new DurationTracker();
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
                });
            });
            missionTracker.onPhaseChange((phase, timeline) => {
                eventQueue.push({
                    type: 'mission_phase_change',
                    phase,
                    timeline,
                });
            });
            // Check Context Window before proceeding
            const { ContextWindowGuard } = await Promise.resolve().then(() => __importStar(require('./context-window-guard')));
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
                this.skills = await (0, skills_loader_1.loadSkillsAsync)();
            }
            // Create eventQueue early so we can push status updates
            let pushResolver = null;
            const eventQueue = [];
            const originalPush = eventQueue.push.bind(eventQueue);
            eventQueue.push = (...items) => {
                const res = originalPush(...items);
                if (pushResolver) {
                    pushResolver();
                    pushResolver = null;
                }
                return res;
            };
            // Reset abort state for new execution
            abort_manager_1.globalAbortManager.reset();
            // SWARM SYNC: Listen for sub-agent progress events to forward to the stream
            let removeProgressListener;
            if (!isSubagent) {
                const { getAgentEvents } = await Promise.resolve().then(() => __importStar(require('../infra/agent-events')));
                const swarmEvents = getAgentEvents(convId);
                removeProgressListener = swarmEvents.onStream('subagent-progress', (event) => {
                    eventQueue.push({
                        type: 'subagent-progress',
                        toolCallId: event.data.toolCallId,
                        timestamp: event.data.timestamp || new Date().toISOString(),
                        data: { ...event.data, type: event.type }
                    });
                });
            }
            try {
                const shouldAbort = abort_manager_1.globalAbortManager.createShouldAbortCallback();
                let toolDefs = this._buildToolDefinitions();
                if (isSubagent) {
                    toolDefs = toolDefs.filter(t => t.name !== 'spawn_agent');
                }
                const graph = await Promise.resolve().then(() => (0, graph_1.buildGraph)(this, toolDefs, this.tools));
                yield { type: 'thought', content: '🎬 Let\'s do this!' };
                let graphDone = false;
                let currentAssistantMsgId = `msg-ast-${Date.now()}`;
                let currentContent = '';
                let currentThought = '';
                let currentToolCalls = [];
                let lastSyncTime = 0;
                let isSaving = false;
                let pendingSave = false;
                const syncToDb = async (force = false) => {
                    const now = Date.now();
                    if (!force && now - lastSyncTime < 2000)
                        return;
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
                                }
                            ],
                            updatedAt: new Date().toISOString()
                        });
                    }
                    catch (err) {
                        console.warn('[AgentRunner] Real-time sync failed:', err);
                    }
                    finally {
                        isSaving = false;
                        if (pendingSave) {
                            // Ensure we save the last state if a save was requested while we were busy
                            setTimeout(() => syncToDb(true), 100);
                        }
                    }
                };
                (async () => {
                    try {
                        abort_manager_1.globalAbortManager.checkAbort();
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
                            recursionLimit: 100
                        };
                        const currentState = await graph.getState(threadConfig);
                        const { Command } = await Promise.resolve().then(() => __importStar(require('@langchain/langgraph')));
                        abort_manager_1.globalAbortManager.checkAbort();
                        if (currentState && currentState.next && currentState.next.length > 0) {
                            console.log('[AgentRunner] 🔄 Resuming interrupted session...');
                            this.telemetry.info(`Resuming session ${convId} from interrupted state...`);
                            missionTracker.startStep('step:triage');
                            await graph.invoke(new Command({ resume: textInput }), threadConfig);
                        }
                        else {
                            console.log('[AgentRunner] 🔄 Starting new graph invocation...');
                            // Only reconstruct history for NEW invocations
                            // RESUMING invocations already have history in GraphState
                            this.telemetry.updateSpinner('Compiling system messages...');
                            const preloadedPrompt = await (0, system_prompt_1.getSlimSystemPromptAsync)(platform, convId, [], this.skills, projectId);
                            const { messages: initialMessages } = await (0, system_prompt_1.buildSystemMessages)(history, userInput, platform, convId, [], systemPromptOverride || preloadedPrompt, projectId);
                            // Reconstruction logic
                            const chatHistoryStore = new history_1.ChatHistoryStore();
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
                            }
                            catch (err) {
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
                            }, threadConfig);
                        }
                    }
                    catch (err) {
                        // ... (error handling remains same)
                        console.error('[AgentRunner] Graph Error:', err);
                        const errorMsg = err instanceof Error ? err.message : String(err);
                        if (err instanceof abort_manager_1.AbortError || errorMsg.includes('Execution aborted by user')) {
                            eventQueue.push({ type: 'chunk', content: '\n\n🛑 Stopped by user.' });
                            missionTracker.fail('Execution stopped by user');
                        }
                        else {
                            eventQueue.push({ type: 'chunk', content: `\n\n❌ **Error during execution:** ${errorMsg}` });
                            missionTracker.fail(errorMsg);
                        }
                    }
                    finally {
                        graphDone = true;
                        if (pushResolver) {
                            pushResolver();
                            pushResolver = null;
                        }
                    }
                })();
                // Register abort listener to wake up loop immediately
                const unbindAbort = abort_manager_1.globalAbortManager.onAbort(() => {
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
                            let event;
                            if (hitlEventIndex !== -1) {
                                event = eventQueue.splice(hitlEventIndex, 1)[0];
                            }
                            else {
                                event = eventQueue.shift();
                            }
                            // Real-time persistence tracking
                            if (event.type === 'chunk') {
                                currentContent += event.content;
                                await syncToDb();
                            }
                            else if (event.type === 'thought') {
                                currentThought += event.content;
                                durationTracker.onThoughtStart();
                                await syncToDb();
                            }
                            else if (event.type === 'tool_call') {
                                currentToolCalls.push({
                                    name: event.toolCall.toolName,
                                    args: event.toolCall.args,
                                    result: event.toolCall.result
                                });
                                await syncToDb(true); // Force sync on tool completion
                            }
                            yield event;
                            continue; // Immediately check for more events
                        }
                        if (graphDone || abort_manager_1.globalAbortManager.streamAborted) {
                            // Final check to ensure no events were pushed just before graphDone was set
                            if (eventQueue.length === 0)
                                break;
                            continue;
                        }
                        // Wait for next push with built-in race protection
                        // If items were pushed between the check above and this point, resolve immediately
                        await new Promise(r => {
                            if (eventQueue.length > 0 || graphDone || abort_manager_1.globalAbortManager.streamAborted)
                                return r();
                            pushResolver = r;
                        });
                    }
                }
                finally {
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
            }
            finally {
                removeProgressListener?.();
            }
        }
        finally {
            // Release session lock
            if (AgentRunner.sessionLocks.get(convId) === lockPromise) {
                AgentRunner.sessionLocks.delete(convId);
            }
            resolveLock();
        }
    }
}
exports.AgentRunner = AgentRunner;
/**
 * Reconstruct full conversation history from stored ChatMessage entries.
 * Converts stored toolCalls back into the interleaved assistant+tool_calls and tool result format.
 * Skips the very last user message (it will be appended as userInput).
 */
function reconstructFullHistory(storedMessages, currentUserInput) {
    const reconstructed = [];
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
    const existingToolMessageIds = new Set();
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
            const toolCallsWithIds = msg.toolCalls.map((tc, idx) => {
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
                tool_calls: toolCallsWithIds.map((tc) => ({
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
        }
        else {
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
