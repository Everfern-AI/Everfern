/**
 * EverFern Desktop — Subagent Spawner
 *
 * Spawns parallel subagents with session isolation.
 * Implements OpenClaw-style depth limiting and workspace inheritance.
 */

import * as crypto from 'crypto';
import { getSubagentRegistry, generateAgentId, type SubagentEntry, type AgentType } from './subagent-registry';
import { getSwarmMemory, type MemoryFact } from './swarm-memory';
import {
    getAgentEvents,
    emitTool,
    emitLifecycle
} from '../infra/agent-events';
import { loadPrompt } from '../../lib/prompt-sync';
import {
    sessionCreated,
    sessionCompleted,
    sessionFailed
} from '../sessions/session-lifecycle-events';
import { resolvePromptPlaceholders } from './system-prompt';

export const AGENT_TIMEOUTS: Record<AgentType, number> = {
    'web-explorer': 900000, // 15 minutes
    'coding-specialist': 600000, // 10 minutes
    'data-analyst': 600000,
    'generic': 300000, // 5 minutes
};

export interface SpawnOptions {
    parentSessionId: string;
    task: string;
    agentType?: AgentType;
    systemPrompt?: string;
    context?: string;
    model?: string;
    mode?: 'run' | 'session';
    workspaceDir?: string;
    projectId?: string;
    maxDepth?: number;
    parentHistory?: Array<{ role: 'user' | 'assistant'; content: string | any[] }>;
    /** Session key of the agent that is spawning this sub-agent (for depth tracking).
     *  When set, depth is computed as parent's depth + 1. When unset, depth = 1 (root spawn). */
    sponsorSessionKey?: string;
    /** LLM tool call ID from the spawn_agent tool execution.
     *  Used as timelineBranch.parentId so the frontend can nest subagent branches
     *  under the correct spawning tool call in the agent timeline. */
    toolCallId?: string;
    /** The runner instance to use for executing the sub-agent.
     *  MUST be provided to ensure session isolation and avoid clobbering. */
    runner: SubagentRunner;
}

export interface SpawnedAgent {
    agentId: string;
    parentSessionId: string;
    sessionKey: string;
    task: string;
    agentType: AgentType;
    status: 'pending' | 'running';
    depth: number;
    toolCallId?: string;
    abort: () => void;
    /** Promise that resolves when the subagent completes (success, failure, or abort).
     *  Await this to block until the agent is done. */
    completion?: Promise<void>;
}

export interface SpawnResult {
    success: boolean;
    agentId: string;
    sessionKey: string;
    result?: string;
    error?: string;
}

export interface SubagentRunner {
    /** Session key of the currently executing sub-agent (for depth tracking in nested spawns). */
    currentAgentSessionKey?: string;
    workspaceDir?: string;
    projectId?: string;

    run(
        userInput: string | any[],
        history: Array<{ role: 'user' | 'assistant'; content: string | any[] }>,
        model?: string,
        conversationId?: string,
        systemPromptOverride?: string,
        projectId?: string
    ): Promise<{ response: string; toolCalls: any[] }>;

    runStream?(
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
    ): AsyncGenerator<any, void, unknown>;
}

class SubagentSpawner {
    private maxGlobalDepth: number = 20; // Effectively unlimited for user needs, but prevents true infinite loops
    private activeAgents: number = 0;
    private readonly MAX_CONCURRENT_AGENTS = 10; // Increased from 2 to allow for a true "army" of parallel research
    private queue: Array<() => void> = [];

    private async acquireSlot(abortSignal?: AbortSignal): Promise<void> {
        if (this.activeAgents < this.MAX_CONCURRENT_AGENTS) {
            this.activeAgents++;
            return;
        }
        // Issue #13 Fix: If the parent agent is aborted while a sub-agent is
        // waiting in the concurrency queue, the slot must be released without
        // incrementing activeAgents so future sub-agents are not starved.
        return new Promise((resolve, reject) => {
            const onAbort = () => {
                const idx = this.queue.indexOf(onResolve);
                if (idx !== -1) this.queue.splice(idx, 1);
                reject(new Error('Subagent slot acquisition aborted (parent cancelled)'));
            };
            const onResolve = () => {
                abortSignal?.removeEventListener('abort', onAbort);
                resolve();
            };
            this.queue.push(onResolve);
            abortSignal?.addEventListener('abort', onAbort, { once: true });
        });
    }

    private releaseSlot(): void {
        this.activeAgents--;
        if (this.queue.length > 0) {
            const next = this.queue.shift();
            if (next) {
                this.activeAgents++;
                next();
            }
        }
    }

    private getPromptForAgentType(agentType: AgentType): string {
        const PROMPT_MAP: Record<AgentType, string> = {
            'web-explorer': 'web-explorer.md',
            'coding-specialist': 'coding-specialist.md',
            'data-analyst': 'data-analyst.md',
            'generic': 'SYSTEM_PROMPT.md',
        };
        const promptFile = PROMPT_MAP[agentType] || 'SYSTEM_PROMPT.md';
        const loaded = loadPrompt(promptFile);
        if (loaded) return loaded;

        // Fallback 1: Try default SYSTEM_PROMPT.md if specialist prompt failed to load
        if (promptFile !== 'SYSTEM_PROMPT.md') {
            const defaultPrompt = loadPrompt('SYSTEM_PROMPT.md');
            if (defaultPrompt) return defaultPrompt;
        }

        // Fallback 2: Minimal structured agent prompt if disk I/O failed completely
        console.warn(`[SubagentSpawner] ⚠️ Failed to load prompt file "${promptFile}". Using hardcoded fallback.`);
        return `# EverFern ${agentType} Sub-Agent\nYou are an autonomous specialized sub-agent tasked with executing: ${agentType}. Perform the task carefully using available tools.`;
    }


    async spawn(options: SpawnOptions): Promise<SpawnedAgent> {
        const {
            parentSessionId,
            task,
            agentType = 'generic',
            systemPrompt: explicitSystemPrompt,
            context,
            model,
            mode = 'run',
            workspaceDir,
            projectId,
            maxDepth = 20, // Increased default
            parentHistory = [],
            toolCallId,
            runner
        } = options;

        // Auto-load the correct system prompt based on agent type if none was explicitly provided.
        // This ensures that spawning agent_type="web-explorer" actually gets the web-explorer.md prompt
        // (which tells it to use navis) instead of the default SYSTEM_PROMPT.md (which doesn't).
        let systemPrompt = explicitSystemPrompt || this.getPromptForAgentType(agentType) || undefined;

        if (!runner) {
            console.warn('[SubagentSpawner] No runner provided. Spawning failed.');
            throw new Error('SubagentSpawner: No runner provided');
        }

        const registry = getSubagentRegistry();

        // Compute depth using sponsorSessionKey if available.
        // When a sub-agent spawns another, it passes its own sessionKey as sponsorSessionKey.
        // The root spawns without sponsorSessionKey (depth = 0), so a root-spawned agent gets depth = 1.
        // A sub-agent-spawned agent gets depth = parentDepth + 1.
        const sponsorKey = options.sponsorSessionKey || (parentSessionId.startsWith('agent:') ? parentSessionId : undefined);
        const sponsorEntry = sponsorKey
            ? registry.getBySessionKey(sponsorKey)
            : undefined;
        const currentDepth = (sponsorEntry?.currentDepth || 0) + 1;

        // ENFORCE maxDepth per-agent: check the parent entry's maxDepth against currentDepth
        if (sponsorEntry && currentDepth > sponsorEntry.maxDepth) {
            throw new Error(`Maximum spawn depth (${sponsorEntry.maxDepth}) exceeded`);
        }

        if (currentDepth > 4) {
            throw new Error(`Maximum spawn depth (3) exceeded`);
        }

        // INJECT SUB-AGENT AWARENESS PROMPT
        const subagentAwareness = `
---
## SUB-AGENT CONTEXT — STRICT RULES
- **Role:** You are a specialized SUB-AGENT spawned for a specific mission. Complete ONLY what was asked.
- **Identity:** You are working as part of an agent army for your parent session: ${parentSessionId}.
- **Nesting Depth:** Your current nesting level is ${currentDepth}.
- **SPAWNING RULES:** You can spawn nested sub-agents (using spawn_agent or spawn_swarm) ONLY if your current nesting depth (${currentDepth}) is less than 4. Otherwise, you must complete the task yourself using your own tools.
- **NO DELEGATION:** Do NOT try to delegate to other agents unnecessarily. Do NOT try to launch web-explorer, coding-specialist, or any other specialist unless independent work can proceed in parallel. YOU are the specialist.
- **FOCUSED EXECUTION:** Complete ONLY the task you were given. Do not explore, research, or investigate beyond the scope of your assignment.
- **NOT_FOUND PROTOCOL:** If you cannot find or accomplish what was requested, report back clearly: "NOT_FOUND: [specific reason]". Do NOT waste steps trying alternative approaches — just report what failed and why.
- **EFFICIENT REPORTING:** When done, return a clear, structured report of what you found/accomplished. Include specific details, not vague summaries.
---
\n`;
        if (systemPrompt) {
            systemPrompt = subagentAwareness + systemPrompt;
            systemPrompt = await resolvePromptPlaceholders(
                systemPrompt,
                process.platform,
                parentSessionId,
                [],
                projectId
            );
        }

        if (currentDepth > this.maxGlobalDepth) {
            throw new Error(`Maximum spawn depth ceiling (${this.maxGlobalDepth}) reached to prevent recursion. Use a more direct task.`);
        }

        const agentId = generateAgentId();
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

        const events = getAgentEvents(sessionKey);
        events.setSessionKey(sessionKey);

        emitLifecycle(parentSessionId, 'agent_spawned', {
            agentId,
            sessionKey,
            agentType,
            task: (enrichedTask || '').substring(0, 100)
        });

        console.log(`[SubagentSpawner] Spawned ${agentId} (${agentType}) for parent ${parentSessionId} (depth: ${currentDepth})`);

        const spawnedAgent: SpawnedAgent = {
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

        // Clone the runner dynamically using its constructor to isolate session states
        let subRunner: SubagentRunner;
        if (runner.constructor && runner.constructor !== Object) {
            subRunner = new (runner.constructor as any)((runner as any).client, (runner as any).config);
            subRunner.workspaceDir = (runner as any).workspaceDir;
            subRunner.projectId = (runner as any).projectId;
        } else {
            subRunner = Object.create(runner);
        }
        subRunner.currentAgentSessionKey = sessionKey;

        const completionPromise = this.runSubagent(spawnedAgent, subRunner, model, systemPrompt, parentHistory);
        spawnedAgent.completion = completionPromise;

        return spawnedAgent;
    }

    private async runSubagent(agent: SpawnedAgent, runner: SubagentRunner, model?: string, systemPrompt?: string, parentHistory: Array<{ role: 'user' | 'assistant'; content: string | any[] }> = []): Promise<void> {
        const registry = getSubagentRegistry();
        const swarm = getSwarmMemory();

        registry.update(agent.agentId, { status: 'running' });
        agent.status = 'running';

        try {
          const { globalAbortManager } = await import('./abort-manager');
          await this.acquireSlot(globalAbortManager.abortController.signal);
        } catch (slotErr) {
          // Issue #13 Fix: Slot acquisition was aborted (parent cancelled while queued).
          // Mark the agent as aborted and exit cleanly without running it.
          registry.update(agent.agentId, { status: 'aborted', error: String(slotErr) });
          return;
        }
        console.log(`[SubagentSpawner] 🎰 Agent ${agent.agentId} acquired execution slot. Active: ${this.activeAgents}`);


        // SWARM SYNC: Subscribe to real-time memory updates from sibling agents
        // This ensures the agent is aware of what its "army" peers are finding
        const swarmMessages: string[] = [];
        const unsubscribe = swarm.subscribe(agent.parentSessionId, agent.agentId, (fact) => {
            console.log(`[Subagent] 🧠 ${agent.agentId} received swarm update: ${fact.type}`);
            swarmMessages.push(`[SYNC FROM SWARM]: ${fact.content}`);
        });

        sessionCreated(agent.sessionKey, {
            parentSessionId: agent.parentSessionId,
            task: agent.task
        });

        emitTool(agent.sessionKey, 'agent_start', {
            agentId: agent.agentId,
            agentType: agent.agentType,
            task: agent.task
        });

        const parentEvents = getAgentEvents(agent.parentSessionId);

        try {
            // Issue #20 Fix: Pin the first user message before capping so sub-agents
            // always know the original task goal even when the history window is full.
            const MAX_HISTORY = 40;
            const firstUserMsg = parentHistory.find((m: any) => (m.role || '') === 'user');
            const sliceStart = parentHistory.length > MAX_HISTORY ? parentHistory.length - MAX_HISTORY : 0;
            let historySample = parentHistory.slice(sliceStart).map((msg: any) => {
                const role = msg.role || (msg._getType?.() === 'human' ? 'user' : 'assistant');
                const mapped: any = {
                    role,
                    content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
                };
                if (msg.tool_calls) {
                    mapped.tool_calls = msg.tool_calls;
                }
                if (msg.tool_call_id) {
                    mapped.tool_call_id = msg.tool_call_id;
                }
                if (msg.reasoning_content) {
                    mapped.reasoning_content = msg.reasoning_content;
                }
                return mapped;
            });
            // Prepend the first user message if it was cut by the slice, so the
            // sub-agent remembers what the root task objective is.
            if (firstUserMsg && sliceStart > 0 && historySample[0]?.content !== firstUserMsg.content) {
                const firstMapped: any = {
                    role: 'user',
                    content: typeof firstUserMsg.content === 'string' ? firstUserMsg.content : JSON.stringify(firstUserMsg.content)
                };
                historySample = [firstMapped, ...historySample];
            }
            const cappedHistory = historySample;

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
                (runner as any).currentAgentSessionKey = agent.sessionKey;
            }

            let finalResponse = '';
            let toolCalls: any[] = [];
            let retries = 0;
            const MAX_RETRIES = 2;

            while (retries <= MAX_RETRIES) {
                try {
                    if (runner?.runStream) {
                        console.log(`[SubagentSpawner] ⚡ Attempt ${retries + 1}: Using runStream for ${agent.agentId} to enable real-time piping`);
                        const entry = registry.get(agent.agentId);
                        const stream = runner.runStream(
                            finalTask,
                            cappedHistory,
                            model,
                            agent.parentSessionId,
                            systemPrompt,
                            entry?.projectId,
                            true,
                            undefined,
                            false,
                            false,
                            (runner as any).reasoningEffort
                        );

                        let reasoningBuffer = '';
                        let reasoningTimer: ReturnType<typeof setTimeout> | null = null;
                        const flushReasoning = () => {
                            if (!reasoningBuffer) return;
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
                            if (reasoningTimer) clearTimeout(reasoningTimer);
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
                                    ? (event.data.timelineBranch.branchLevel as number) + 1
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

                        if (reasoningTimer) clearTimeout(reasoningTimer);
                    } else {
                        console.log(`[SubagentSpawner] 🐢 Attempt ${retries + 1}: Using standard run for ${agent.agentId}`);
                        const entry = registry.get(agent.agentId);
                        const result = await runner!.run(finalTask, cappedHistory, model, agent.parentSessionId, systemPrompt, entry?.projectId);
                        finalResponse = result.response;
                        toolCalls = result.toolCalls;
                    }
                    // If success, break out of retry loop
                    break;
                } catch (err: any) {
                    console.warn(`[SubagentSpawner] Attempt ${retries + 1} failed for agent ${agent.agentId}:`, err);
                    retries++;
                    if (retries > MAX_RETRIES) {
                        throw err;
                    }
                }
            }

            registry.complete(agent.agentId, finalResponse);
            sessionCompleted(agent.sessionKey, { result: finalResponse });
            emitLifecycle(agent.parentSessionId, 'agent_completed', {
                agentId: agent.agentId,
                result: finalResponse.substring(0, 100)
            });

        } catch (error) {
            const errMsg = error instanceof Error ? error.message : String(error);
            console.error(`[SubagentSpawner] Agent ${agent.agentId} failed:`, error);
            registry.complete(agent.agentId, undefined, errMsg);
            sessionFailed(agent.sessionKey, { error: errMsg });
            emitLifecycle(agent.parentSessionId, 'agent_failed', {
                agentId: agent.agentId,
                error: errMsg
            });
        } finally {
            this.releaseSlot();
            console.log(`[SubagentSpawner] 🏁 Agent ${agent.agentId} released execution slot. Active: ${this.activeAgents}`);
            // Clear agent session key if this agent set it
            if (runner && 'currentAgentSessionKey' in runner && (runner as any).currentAgentSessionKey === agent.sessionKey) {
                (runner as any).currentAgentSessionKey = undefined;
            }
            unsubscribe();
        }
    }

    async spawnMultiple(
        parentSessionId: string,
        tasks: string[],
        options: Omit<SpawnOptions, 'task' | 'parentSessionId'> & { runner: SubagentRunner }
    ): Promise<{ spawned: SpawnedAgent[]; errors: Array<{ task: string; error: string }> }> {
        const spawned: SpawnedAgent[] = [];
        // Issue #25 Fix: Collect spawn errors and return them to the caller instead
        // of silently dropping them. Callers that assumed all tasks were spawned
        // would receive a partial list with no indication of how many failed.
        const errors: Array<{ task: string; error: string }> = [];

        for (const task of tasks) {
            try {
                const agent = await this.spawn({
                    parentSessionId,
                    task,
                    ...options
                });
                spawned.push(agent);
            } catch (error) {
                const msg = error instanceof Error ? error.message : String(error);
                console.error(`[SubagentSpawner] Failed to spawn agent for task "${(task || '').substring(0, 50)}...": ${msg}`);
                errors.push({ task, error: msg });
            }
        }

        if (errors.length > 0) {
            console.warn(`[SubagentSpawner] spawnMultiple: ${errors.length}/${tasks.length} tasks failed to spawn.`);
        }

        return { spawned, errors };
    }

    async waitForAgent(
        agentId: string,
        timeoutMs: number
    ): Promise<SubagentEntry | undefined> {
        const registry = getSubagentRegistry();
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

    async waitForCompletion(
        parentSessionId: string,
        timeoutMs?: number,
        agentType?: AgentType
    ): Promise<SubagentEntry[]> {
        const registry = getSubagentRegistry();
        const effectiveTimeout = timeoutMs ?? AGENT_TIMEOUTS[agentType ?? 'generic'];
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
    async abortAll(): Promise<void> {
        const registry = getSubagentRegistry();
        const allAgents = registry.getAll();

        console.log(`[SubagentSpawner] Aborting ${allAgents.length} active sub-agents...`);

        for (const agent of allAgents) {
            if (agent.status !== 'completed' && agent.status !== 'failed' && agent.status !== 'aborted') {
                try {
                    registry.abort(agent.agentId);
                    console.log(`[SubagentSpawner] Aborted sub-agent: ${agent.agentId}`);
                } catch (err) {
                    console.error(`[SubagentSpawner] Error aborting sub-agent ${agent.agentId}:`, err);
                }
            }
        }
    }
}

export { SubagentSpawner };

// Singleton
let spawnerInstance: SubagentSpawner | null = null;

export function getSubagentSpawner(): SubagentSpawner {
    if (!spawnerInstance) {
        spawnerInstance = new SubagentSpawner();
    }
    return spawnerInstance;
}
