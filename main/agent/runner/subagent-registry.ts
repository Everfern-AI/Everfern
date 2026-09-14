/**
 * EverFern Desktop — Subagent Registry
 *
 * In-memory + async disk persistence for subagent visibility.
 * Implements a debounced write queue to prevent event loop blocking.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

export type AgentType = 'generic' | 'coding-specialist' | 'web-explorer' | 'data-analyst';

/** An agent's registry record: identity, lineage (parent, session key,
 *  depth), status, and terminal result/error. */
export interface SubagentEntry {
    agentId: string;
    parentSessionId: string;
    sessionKey: string;
    task: string;
    agentType: AgentType;
    mode: 'run' | 'session';
    status: 'pending' | 'running' | 'completed' | 'failed' | 'aborted';
    createdAt: number;
    updatedAt: number;
    completedAt?: number;
    result?: string;
    error?: string;
    workspaceDir?: string;
    projectId?: string;
    maxDepth: number;
    currentDepth: number;
    /** LLM tool call ID from the parent spawn_agent invocation.
     *  Used as timelineBranch.parentId for nested timeline rendering. */
    toolCallId?: string;
}

function getRegistryPath(): string {
    return path.join(os.homedir(), '.everfern', 'subagent-registry.json');
}

async function ensureDirAsync(): Promise<void> {
    const dir = path.dirname(getRegistryPath());
    try {
        await fs.promises.access(dir);
    } catch {
        await fs.promises.mkdir(dir, { recursive: true });
    }
}

class SubagentRegistry {
    private entries: Map<string, SubagentEntry> = new Map();
    private listeners: Map<string, Set<(entry: SubagentEntry) => void>> = new Map();
    private saveTimeout: NodeJS.Timeout | null = null;
    private readonly DEBOUNCE_MS = 500;

    constructor() {
        this.loadSync();
    }

    /**
     * loadSync is used only in constructor to ensure baseline state.
     */
    /**
 * Tolerant loader: unparseable/corrupt registry files are logged and skipped
 * (empty state) rather than crashing startup.
 */
private loadSync(): void {
        const filePath = getRegistryPath();
        if (!fs.existsSync(filePath)) return;

        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const data: SubagentEntry[] = JSON.parse(content);
            // Same 24h retention as cleanup(): entries older than a day are
            // dropped at load so a restart never resurrects stale spawns.
            const cutoff = Date.now() - 24 * 60 * 60 * 1000;

            for (const entry of data) {
                if (entry.updatedAt > cutoff) {
                    this.entries.set(entry.agentId, entry);
                }
            }
            console.log(`[SubagentRegistry] Loaded ${this.entries.size} entries`);
        } catch (e) {
            console.error('[SubagentRegistry] Failed to load registry:', e);
        }
    }

    /**
     * Debounced async save to prevent blocking the event loop.
     */
    private scheduleSave(): void {
        if (this.saveTimeout) return;

        this.saveTimeout = setTimeout(async () => {
            this.saveTimeout = null;
            await this.saveAsync();
        }, this.DEBOUNCE_MS);
    }

    /** Single-flight disk write: failures are logged, never surfaced to callers
     *  (a persistence error must not break agent execution). */
    private async saveAsync(): Promise<void> {
        await ensureDirAsync();
        const filePath = getRegistryPath();

        try {
            const data = Array.from(this.entries.values());
            await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
        } catch (e) {
            console.error('[SubagentRegistry] Failed to save registry:', e);
        }
    }

    /**
     * Registers a new sub-agent entry and notifies both parent-session
     * listeners and any per-agent waiters (waitForAgent).
     */
    register(entry: Omit<SubagentEntry, 'createdAt' | 'updatedAt'>): SubagentEntry {
        const now = Date.now();
        const fullEntry: SubagentEntry = {
            ...entry,
            createdAt: now,
            updatedAt: now
        };

        this.entries.set(entry.agentId, fullEntry);
        this.scheduleSave();
        this.notifyListeners(entry.parentSessionId, fullEntry);

        console.log(`[SubagentRegistry] Registered agent ${entry.agentId} (parent: ${entry.parentSessionId})`);
        return fullEntry;
    }

    get(agentId: string): SubagentEntry | undefined {
        return this.entries.get(agentId);
    }

    /** Looks up an entry by its session key (linear scan — fine for the small
     *  in-memory map; used for nested-spawn depth lookups). */
    getBySessionKey(sessionKey: string): SubagentEntry | undefined {
        for (const entry of this.entries.values()) {
            if (entry.sessionKey === sessionKey) {
                return entry;
            }
        }
        return undefined;
    }

    /** Lists a parent's children, newest-first by createdAt. */
    getChildren(parentSessionId: string): SubagentEntry[] {
        return Array.from(this.entries.values())
            .filter(e => e.parentSessionId === parentSessionId)
            .sort((a, b) => b.createdAt - a.createdAt);
    }

/**
 * List a parent's children, optionally filtered by status (e.g. all 'running').
 * Newest-first, matching getChildren's ordering.
 */
    getByParent(parentSessionId: string, status?: SubagentEntry['status']): SubagentEntry[] {
        let children = this.getChildren(parentSessionId);
        if (status) {
            children = children.filter(e => e.status === status);
        }
        return children;
    }

    /**
     * Gets all registered agents
     */
    getAll(): SubagentEntry[] {
        return Array.from(this.entries.values());
    }

    /** True while the parent still has children in 'pending' or 'running'
     *  (drives waitForCompletion's termination check). */
    hasPendingChildren(parentSessionId: string): boolean {
        return this.getByParent(parentSessionId, 'pending').length > 0 ||
               this.getByParent(parentSessionId, 'running').length > 0;
    }

    /**
     * Updates an entry's fields, bumps updatedAt, and notifies listeners.
     */
    update(agentId: string, updates: Partial<SubagentEntry>): SubagentEntry | undefined {
        const existing = this.entries.get(agentId);
        if (!existing) return undefined;

        const updated: SubagentEntry = {
            ...existing,
            ...updates,
            updatedAt: Date.now()
        };

        this.entries.set(agentId, updated);
        this.scheduleSave();
        this.notifyListeners(updated.parentSessionId, updated);

        return updated;
    }

    /**
     * Marks an agent completed, or failed when an error is supplied.
     */
    complete(agentId: string, result?: string, error?: string): SubagentEntry | undefined {
        return this.update(agentId, {
            status: error ? 'failed' : 'completed',
            completedAt: Date.now(),
            result,
            error
        });
    }

    /** Marks an entry 'aborted' and resolves any parked waitForAgent waiters
     *  via the shared update/notify path. */
    abort(agentId: string): SubagentEntry | undefined {
        return this.update(agentId, {
            status: 'aborted',
            completedAt: Date.now()
        });
    }

    /** Drops entries untouched for 24h and persists the shrunk registry;
     *  returns how many were removed. */
    cleanup(): number {
        let cleaned = 0;
        const cutoff = Date.now() - 24 * 60 * 60 * 1000;

        for (const [agentId, entry] of this.entries.entries()) {
            if (entry.updatedAt < cutoff) {
                this.entries.delete(agentId);
                cleaned++;
            }
        }

        if (cleaned > 0) {
            this.scheduleSave();
            console.log(`[SubagentRegistry] Cleaned up ${cleaned} old entries`);
        }

        return cleaned;
    }

    /**
     * Subscribes to entry updates for a parent session; returns an unsubscribe fn.
     */
    onUpdate(parentSessionId: string, callback: (entry: SubagentEntry) => void): () => void {
        if (!this.listeners.has(parentSessionId)) {
            this.listeners.set(parentSessionId, new Set());
        }
        this.listeners.get(parentSessionId)!.add(callback);

        return () => {
            this.listeners.get(parentSessionId)?.delete(callback);
        };
    }

    private notifyListeners(parentSessionId: string, entry: SubagentEntry): void {
        const callbacks = this.listeners.get(parentSessionId);
        if (callbacks) {
            callbacks.forEach(cb => cb(entry));
        }
        // AG-CORR-20: wake any per-agent waiters (event-driven waitForAgent).
        // Waiters are only resolved on terminal statuses and removed from the
        // map in one pass — a non-terminal update must leave them queued.
        const agentWaiters = this.agentWaiters.get(entry.agentId);
        if (agentWaiters && this.isTerminal(entry)) {
            this.agentWaiters.delete(entry.agentId);
            agentWaiters.forEach(resolve => resolve(entry));
        }
    }

    private isTerminal(entry: SubagentEntry): boolean {
        return entry.status === 'completed' || entry.status === 'failed' || entry.status === 'aborted';
    }

    // AG-CORR-20: promise-based wait map replaces the 100ms busy-wait loop.
    // Invariant: a waiter array exists only while its agent is non-terminal —
    // notifyListeners deletes the whole array in one pass on the first
    // terminal update, so the map can never accumulate stale waiters.
    private agentWaiters: Map<string, Array<(entry: SubagentEntry) => void>> = new Map();

    /** AG-CORR-20: event-driven wait for an agent to reach a terminal status.
     * Resolves immediately if already terminal; if the entry isn't registered
     * yet, resolves once it registers AND reaches a terminal status. Rejects on
     * timeout. */
    waitForAgent(agentId: string, timeoutMs: number): Promise<SubagentEntry | undefined> {
        const existing = this.entries.get(agentId);
        if (existing && this.isTerminal(existing)) {
            return Promise.resolve(existing);
        }
        return new Promise<SubagentEntry | undefined>((resolve, reject) => {
            // settled guards against double-resolution: the same agent can hit
            // both the parent-session listener and the per-agent waiter path.
            let settled = false;
            let timer: NodeJS.Timeout;
            const finish = (entry: SubagentEntry | undefined): void => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve(entry ?? undefined);
            };
            const onEntry = (entry: SubagentEntry): void => {
                if (entry.agentId !== agentId || !this.isTerminal(entry)) return;
                finish(this.entries.get(agentId) ?? entry);
            };
        // The `parent` lookup here can be undefined for a not-yet-registered
        // agentId (waitForAgent registers the waiter before register() runs).
        // Parent-session listener (covers status updates via update()).
        const parent = existing?.parentSessionId;
            const unsub = parent ? this.onUpdate(parent, onEntry) : null;
            // Per-agent waiter (covers the not-yet-registered case via register()).
            // It also unsubscribes the parent listener before finishing, so the
            // promise never leaks a dangling onUpdate subscription.
            const waiter = (entry: SubagentEntry): void => { unsub?.(); finish(entry); };
            let arr = this.agentWaiters.get(agentId);
            if (!arr) { arr = []; this.agentWaiters.set(agentId, arr); }
            arr.push(waiter);
            // Timeout ordering: set the timer only after both listeners are
            // armed. If timeoutMs is 0 (or very small), the timer fires on a
            // later macrotask, so an already-terminal entry still wins via the
            // synchronous terminal check above or a same-tick notify.
            timer = setTimeout(() => {
                if (settled) return;
                settled = true;
                // Remove only this waiter so a timeout on one caller doesn't
                // drop waiters registered by other callers for the same agent.
                const w = this.agentWaiters.get(agentId);
                if (w) this.agentWaiters.set(agentId, w.filter(x => x !== waiter));
                reject(new Error(`Timeout waiting for agent ${agentId} (${timeoutMs}ms)`));
            }, timeoutMs);
        });
    }
}

let registry: SubagentRegistry | null = null;

/**
 * Lazily creates and returns the shared SubagentRegistry singleton.
 */
export function getSubagentRegistry(): SubagentRegistry {
    if (!registry) {
        registry = new SubagentRegistry();
    }
    return registry;
}

/**
 * Generates a short unique agent ID (12 hex chars, no dashes).
 */
/**
 * Generates a fresh agent ID (`agent_<12 hex>`); callers embed it in the
 * session key and register it via register().
 */
export function generateAgentId(): string {
    return `agent_${crypto.randomUUID().replace(/-/g, '').substring(0, 12)}`;
}
