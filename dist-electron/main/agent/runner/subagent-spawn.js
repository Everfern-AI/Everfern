"use strict";
/**
 * EverFern Desktop — Subagent Spawner
 *
 * Spawns parallel subagents with session isolation.
 * Implements OpenClaw-style depth limiting and workspace inheritance.
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
exports.SubagentSpawner = exports.AGENT_TIMEOUTS = void 0;
exports.getSubagentSpawner = getSubagentSpawner;
const crypto = __importStar(require("crypto"));
const subagent_registry_1 = require("./subagent-registry");
const swarm_memory_1 = require("./swarm-memory");
const agent_events_1 = require("../infra/agent-events");
const prompt_sync_1 = require("../../lib/prompt-sync");
const session_lifecycle_events_1 = require("../sessions/session-lifecycle-events");
exports.AGENT_TIMEOUTS = {
    'web-explorer': 900000, // 15 minutes
    'coding-specialist': 600000, // 10 minutes
    'data-analyst': 600000,
    'generic': 300000, // 5 minutes
};
class SubagentSpawner {
    maxGlobalDepth = 20; // Effectively unlimited for user needs, but prevents true infinite loops
    activeAgents = 0;
    MAX_CONCURRENT_AGENTS = 10; // Increased from 2 to allow for a true "army" of parallel research
    queue = [];
    async acquireSlot() {
        if (this.activeAgents < this.MAX_CONCURRENT_AGENTS) {
            this.activeAgents++;
            return;
        }
        return new Promise(resolve => this.queue.push(resolve));
    }
    releaseSlot() {
        this.activeAgents--;
        if (this.queue.length > 0) {
            const next = this.queue.shift();
            if (next) {
                this.activeAgents++;
                next();
            }
        }
    }
    getPromptForAgentType(agentType) {
        const PROMPT_MAP = {
            'web-explorer': 'web-explorer.md',
            'coding-specialist': 'coding-specialist.md',
            'data-analyst': 'data-analyst.md',
            'generic': 'SYSTEM_PROMPT.md',
        };
        const promptFile = PROMPT_MAP[agentType] || 'SYSTEM_PROMPT.md';
        return (0, prompt_sync_1.loadPrompt)(promptFile);
    }
    async spawn(options) {
        const { parentSessionId, task, agentType = 'generic', systemPrompt: explicitSystemPrompt, context, model, mode = 'run', workspaceDir, projectId, maxDepth = 20, // Increased default
        parentHistory = [], toolCallId, runner } = options;
        // Auto-load the correct system prompt based on agent type if none was explicitly provided.
        // This ensures that spawning agent_type="web-explorer" actually gets the web-explorer.md prompt
        // (which tells it to use navis) instead of the default SYSTEM_PROMPT.md (which doesn't).
        let systemPrompt = explicitSystemPrompt || this.getPromptForAgentType(agentType) || undefined;
        if (!runner) {
            console.warn('[SubagentSpawner] No runner provided. Spawning failed.');
            throw new Error('SubagentSpawner: No runner provided');
        }
        // HARD GUARD: Sub-agents cannot spawn other agents.
        // This catches ALL direct spawner.spawn() calls from graph nodes
        // (web-explorer, swarm-orchestrator, etc.) that bypass the spawn_agent tool guard.
        if (runner.currentAgentSessionKey) {
            throw new Error('Sub-agents cannot spawn other agents. You are a sub-agent yourself. Complete the task using your own available tools.');
        }
        const registry = (0, subagent_registry_1.getSubagentRegistry)();
        // Compute depth using sponsorSessionKey if available.
        // When a sub-agent spawns another, it passes its own sessionKey as sponsorSessionKey.
        // The root spawns without sponsorSessionKey (depth = 0), so a root-spawned agent gets depth = 1.
        // A sub-agent-spawned agent gets depth = parentDepth + 1.
        const sponsorEntry = options.sponsorSessionKey
            ? registry.getBySessionKey(options.sponsorSessionKey)
            : undefined;
        const currentDepth = (sponsorEntry?.currentDepth || 0) + 1;
        // ENFORCE maxDepth per-agent: check the parent entry's maxDepth against currentDepth
        if (sponsorEntry && currentDepth > sponsorEntry.maxDepth) {
            throw new Error(`Max spawn depth (${sponsorEntry.maxDepth}) reached for this agent. Cannot spawn deeper.`);
        }
        // INJECT SUB-AGENT AWARENESS PROMPT
        const subagentAwareness = `
---
## SUB-AGENT CONTEXT — STRICT RULES
- **Role:** You are a specialized SUB-AGENT spawned for a specific mission. Complete ONLY what was asked.
- **Identity:** You are working as part of an agent army for your parent session: ${parentSessionId}.
- **Nesting Depth:** Your current nesting level is ${currentDepth}.
- **NO SPAWNING:** You MUST NOT spawn any sub-agents. You do NOT have the spawn_agent tool. Complete the task yourself using your own tools.
- **NO DELEGATION:** Do NOT try to delegate to other agents. Do NOT try to launch web-explorer, coding-specialist, or any other specialist. YOU are the specialist.
- **FOCUSED EXECUTION:** Complete ONLY the task you were given. Do not explore, research, or investigate beyond the scope of your assignment.
- **NOT_FOUND PROTOCOL:** If you cannot find or accomplish what was requested, report back clearly: "NOT_FOUND: [specific reason]". Do NOT waste steps trying alternative approaches — just report what failed and why.
- **EFFICIENT REPORTING:** When done, return a clear, structured report of what you found/accomplished. Include specific details, not vague summaries.
---
\n`;
        if (systemPrompt) {
            systemPrompt = subagentAwareness + systemPrompt;
        }
        if (currentDepth > this.maxGlobalDepth) {
            throw new Error(`Maximum spawn depth ceiling (${this.maxGlobalDepth}) reached to prevent recursion. Use a more direct task.`);
        }
        const agentId = (0, subagent_registry_1.generateAgentId)();
        const sessionKey = `agent:${agentId}:${crypto.randomUUID().substring(0, 8)}`;
        const enrichedTask = context ? `[CONTEXT: ${context}]\n\n${task}` : task;
        const entry = registry.register({
            agentId,
            parentSessionId,
            sessionKey,
            task: enrichedTask,
            agentType,
            mode,
            status: 'pending',
            workspaceDir,
            projectId,
            maxDepth,
            currentDepth,
            toolCallId
        });
        const events = (0, agent_events_1.getAgentEvents)(sessionKey);
        events.setSessionKey(sessionKey);
        (0, agent_events_1.emitLifecycle)(parentSessionId, 'agent_spawned', {
            agentId,
            sessionKey,
            agentType,
            task: (enrichedTask || '').substring(0, 100)
        });
        console.log(`[SubagentSpawner] Spawned ${agentId} (${agentType}) for parent ${parentSessionId} (depth: ${currentDepth})`);
        const spawnedAgent = {
            agentId,
            parentSessionId,
            sessionKey,
            task: enrichedTask,
            agentType,
            status: 'pending',
            depth: currentDepth,
            toolCallId,
            abort: () => registry.abort(agentId)
        };
        const completionPromise = this.runSubagent(spawnedAgent, runner, model, systemPrompt, parentHistory);
        spawnedAgent.completion = completionPromise;
        return spawnedAgent;
    }
    async runSubagent(agent, runner, model, systemPrompt, parentHistory = []) {
        const registry = (0, subagent_registry_1.getSubagentRegistry)();
        const swarm = (0, swarm_memory_1.getSwarmMemory)();
        registry.update(agent.agentId, { status: 'running' });
        agent.status = 'running';
        await this.acquireSlot();
        console.log(`[SubagentSpawner] 🎰 Agent ${agent.agentId} acquired execution slot. Active: ${this.activeAgents}`);
        // SWARM SYNC: Subscribe to real-time memory updates from sibling agents
        // This ensures the agent is aware of what its "army" peers are finding
        const swarmMessages = [];
        const unsubscribe = swarm.subscribe(agent.parentSessionId, agent.agentId, (fact) => {
            console.log(`[Subagent] 🧠 ${agent.agentId} received swarm update: ${fact.type}`);
            swarmMessages.push(`[SYNC FROM SWARM]: ${fact.content}`);
        });
        (0, session_lifecycle_events_1.sessionCreated)(agent.sessionKey, {
            parentSessionId: agent.parentSessionId,
            task: agent.task
        });
        (0, agent_events_1.emitTool)(agent.sessionKey, 'agent_start', {
            agentId: agent.agentId,
            agentType: agent.agentType,
            task: agent.task
        });
        const parentEvents = (0, agent_events_1.getAgentEvents)(agent.parentSessionId);
        try {
            const cappedHistory = parentHistory.slice(-40).map((msg) => ({
                role: msg.role || (msg._getType?.() === 'human' ? 'user' : 'assistant'),
                content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
            }));
            // SWARM SYNC: Prepend existing swarm knowledge to the task
            const existingMemory = swarm.getMemory(agent.parentSessionId)
                .filter(f => f.sourceAgentId !== agent.agentId)
                .map(f => `[PRIOR SWARM KNOWLEDGE]: ${f.content}`)
                .join('\n');
            const finalTask = existingMemory ? `${existingMemory}\n\n${agent.task}` : agent.task;
            // Set the agent's session key on the runner so graph nodes (web-explorer, spawn_agent tool)
            // can pass it as sponsorSessionKey when spawning nested sub-agents for depth tracking.
            const originalSessionKey = runner.currentAgentSessionKey;
            if (runner && 'currentAgentSessionKey' in runner) {
                runner.currentAgentSessionKey = agent.sessionKey;
            }
            let finalResponse = '';
            let toolCalls = [];
            let retries = 0;
            const MAX_RETRIES = 2;
            while (retries <= MAX_RETRIES) {
                try {
                    if (runner?.runStream) {
                        console.log(`[SubagentSpawner] ⚡ Attempt ${retries + 1}: Using runStream for ${agent.agentId} to enable real-time piping`);
                        const entry = registry.get(agent.agentId);
                        const stream = runner.runStream(finalTask, cappedHistory, model, agent.parentSessionId, systemPrompt, entry?.projectId, true);
                        let reasoningBuffer = '';
                        let reasoningTimer = null;
                        const flushReasoning = () => {
                            if (!reasoningBuffer)
                                return;
                            parentEvents.emit('subagent-progress', 'reasoning', {
                                toolCallId: agent.toolCallId || agent.agentId,
                                timestamp: new Date().toISOString(),
                                content: reasoningBuffer,
                                metadata: { agentId: agent.agentId, agentType: agent.agentType, attempt: retries + 1 },
                                timelineBranch: {
                                    sessionId: agent.sessionKey,
                                    parentId: agent.toolCallId || agent.parentSessionId,
                                    parentSessionKey: agent.parentSessionId,
                                    agentType: agent.agentType,
                                    taskDescription: agent.task,
                                    branchStatus: 'running',
                                    branchLevel: agent.depth
                                }
                            });
                            reasoningBuffer = '';
                        };
                        const scheduleFlush = () => {
                            if (reasoningTimer)
                                clearTimeout(reasoningTimer);
                            reasoningTimer = setTimeout(() => {
                                reasoningTimer = null;
                                flushReasoning();
                            }, 150);
                        };
                        for await (const event of stream) {
                            if (event.type === 'done') {
                                flushReasoning();
                                break;
                            }
                            if (event.type === 'chunk') {
                                finalResponse += event.content;
                                reasoningBuffer += event.content;
                                scheduleFlush();
                            }
                            if (event.type === 'tool_call') {
                                flushReasoning();
                                toolCalls.push(event.toolCall);
                            }
                            // Forward subagent-progress events (e.g. rich navis browser actions)
                            if (event.type === 'subagent-progress') {
                                flushReasoning();
                                const nestedBranchLevel = event.data?.timelineBranch?.branchLevel
                                    ? event.data.timelineBranch.branchLevel + 1
                                    : agent.depth;
                                // Only emit if it's a meaningful browser action or status update
                                if (event.data?.action || event.data?.stepNumber || event.data?.type === 'screenshot') {
                                    parentEvents.emit('subagent-progress', event.data?.type || 'action', {
                                        toolCallId: agent.toolCallId || agent.agentId,
                                        timestamp: event.timestamp || new Date().toISOString(),
                                        content: event.data?.content || event.data?.action || event.content || '',
                                        action: event.data?.action,
                                        screenshot: event.data?.screenshot,
                                        stepNumber: event.data?.stepNumber,
                                        totalSteps: event.data?.totalSteps,
                                        metadata: { agentId: agent.agentId, agentType: agent.agentType, attempt: retries + 1 },
                                        timelineBranch: {
                                            sessionId: agent.sessionKey,
                                            parentId: agent.toolCallId || agent.parentSessionId,
                                            parentSessionKey: agent.parentSessionId,
                                            agentType: agent.agentType,
                                            taskDescription: agent.task,
                                            branchStatus: 'running',
                                            branchLevel: nestedBranchLevel
                                        }
                                    });
                                }
                            }
                        }
                        if (reasoningTimer)
                            clearTimeout(reasoningTimer);
                    }
                    else {
                        console.log(`[SubagentSpawner] 🐢 Attempt ${retries + 1}: Using standard run for ${agent.agentId}`);
                        const entry = registry.get(agent.agentId);
                        const result = await runner.run(finalTask, cappedHistory, model, agent.parentSessionId, systemPrompt, entry?.projectId);
                        finalResponse = result.response;
                        toolCalls = result.toolCalls;
                    }
                    // If success, break out of retry loop
                    break;
                }
                catch (err) {
                    // ... (rest of catch block)
                }
            }
            registry.complete(agent.agentId, finalResponse);
            // ... (rest of successful completion)
        }
        catch (error) {
            // ... (rest of error handling)
        }
        finally {
            this.releaseSlot();
            console.log(`[SubagentSpawner] 🏁 Agent ${agent.agentId} released execution slot. Active: ${this.activeAgents}`);
            // Clear agent session key if this agent set it
            if (runner && 'currentAgentSessionKey' in runner && runner.currentAgentSessionKey === agent.sessionKey) {
                runner.currentAgentSessionKey = undefined;
            }
            unsubscribe();
        }
    }
    async spawnMultiple(parentSessionId, tasks, options) {
        const spawned = [];
        for (const task of tasks) {
            try {
                const agent = await this.spawn({
                    parentSessionId,
                    task,
                    ...options
                });
                spawned.push(agent);
            }
            catch (error) {
                console.error(`[SubagentSpawner] Failed to spawn agent for task "${(task || '').substring(0, 50)}...":`, error);
            }
        }
        return spawned;
    }
    async waitForAgent(agentId, timeoutMs) {
        const registry = (0, subagent_registry_1.getSubagentRegistry)();
        const startTime = Date.now();
        while (true) {
            const entry = registry.get(agentId);
            if (!entry) {
                await new Promise(resolve => setTimeout(resolve, 100));
                continue;
            }
            if (entry.status === 'completed' || entry.status === 'failed' || entry.status === 'aborted') {
                return entry;
            }
            if (Date.now() - startTime > timeoutMs) {
                throw new Error(`Timeout waiting for agent ${agentId} (${timeoutMs}ms)`);
            }
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }
    async waitForCompletion(parentSessionId, timeoutMs, agentType) {
        const registry = (0, subagent_registry_1.getSubagentRegistry)();
        const effectiveTimeout = timeoutMs ?? exports.AGENT_TIMEOUTS[agentType ?? 'generic'];
        const startTime = Date.now();
        while (registry.hasPendingChildren(parentSessionId)) {
            if (Date.now() - startTime > effectiveTimeout) {
                throw new Error(`Timeout waiting for subagents (${effectiveTimeout}ms)`);
            }
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        return registry.getChildren(parentSessionId);
    }
    /**
     * Aborts all active sub-agents
     * Used during cleanup when execution completes
     */
    async abortAll() {
        const registry = (0, subagent_registry_1.getSubagentRegistry)();
        const allAgents = registry.getAll();
        console.log(`[SubagentSpawner] Aborting ${allAgents.length} active sub-agents...`);
        for (const agent of allAgents) {
            if (agent.status !== 'completed' && agent.status !== 'failed' && agent.status !== 'aborted') {
                try {
                    registry.abort(agent.agentId);
                    console.log(`[SubagentSpawner] Aborted sub-agent: ${agent.agentId}`);
                }
                catch (err) {
                    console.error(`[SubagentSpawner] Error aborting sub-agent ${agent.agentId}:`, err);
                }
            }
        }
    }
}
exports.SubagentSpawner = SubagentSpawner;
// Singleton
let spawnerInstance = null;
function getSubagentSpawner() {
    if (!spawnerInstance) {
        spawnerInstance = new SubagentSpawner();
    }
    return spawnerInstance;
}
