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
import { spawnSync } from 'child_process';

export type AgentType = 'generic' | 'coding-specialist' | 'web-explorer' | 'data-analyst';

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

function nativeRegistryCall<T>(request: Record<string, unknown>): T | null {
    const executable = process.env.EVERFERN_SHELL === 'tauri' && process.env.EF_NATIVE_EXE;
    if (!executable) return null;
    try {
        const result = spawnSync(executable, ['--ef-subagent-registry'], {
            input: JSON.stringify(request),
            encoding: 'utf-8',
            windowsHide: true,
            timeout: 5000,
            maxBuffer: 8 * 1024 * 1024
        });
        if (result.error || result.status !== 0 || !result.stdout) return null;
        return JSON.parse(result.stdout) as T;
    } catch {
        return null;
    }
}

interface NativeRegistryMutation<T> {
    result: T;
    entries: SubagentEntry[];
    cleaned: number;
    trimmed: number;
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
    private nativeStorage = false;
    private readonly DEBOUNCE_MS = 500;

    constructor() {
        this.loadSync();
    }

    /**
     * loadSync is used only in constructor to ensure baseline state.
     */
    private loadSync(): void {
        const nativeEntries = nativeRegistryCall<SubagentEntry[]>({ operation: 'load' });
        if (Array.isArray(nativeEntries)) {
            this.nativeStorage = true;
            for (const entry of nativeEntries) this.entries.set(entry.agentId, entry);
            console.log(`[SubagentRegistry] Loaded ${this.entries.size} entries`);
            return;
        }

        const filePath = getRegistryPath();
        if (!fs.existsSync(filePath)) return;

        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const data: SubagentEntry[] = JSON.parse(content);
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

    private async saveAsync(): Promise<void> {
        if (this.nativeStorage) return;
        await ensureDirAsync();
        const filePath = getRegistryPath();

        try {
            const data = Array.from(this.entries.values());
            await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
        } catch (e) {
            console.error('[SubagentRegistry] Failed to save registry:', e);
        }
    }

    register(entry: Omit<SubagentEntry, 'createdAt' | 'updatedAt'>): SubagentEntry {
        if (this.nativeStorage) {
            const native = nativeRegistryCall<NativeRegistryMutation<SubagentEntry>>({
                operation: 'register', entry, entries: this.getAll()
            });
            if (native && Array.isArray(native.entries) && native.result) {
                this.replaceEntries(native.entries);
                if (native.cleaned > 0) console.log(`[SubagentRegistry] Cleaned up ${native.cleaned} old entries`);
                this.notifyListeners(entry.parentSessionId, native.result);
                console.log(`[SubagentRegistry] Registered agent ${entry.agentId} (parent: ${entry.parentSessionId})`);
                return native.result;
            }
            this.nativeStorage = false;
        }

        const now = Date.now();
        const fullEntry: SubagentEntry = {
            ...entry,
            createdAt: now,
            updatedAt: now
        };

        this.entries.set(entry.agentId, fullEntry);
        // cleanup() was never called, so every finished agent's full result stayed in memory
        // and was re-serialized on every save for the life of the app.
        this.cleanup();
        this.trimFinished();
        this.scheduleSave();
        this.notifyListeners(entry.parentSessionId, fullEntry);

        console.log(`[SubagentRegistry] Registered agent ${entry.agentId} (parent: ${entry.parentSessionId})`);
        return fullEntry;
    }

    get(agentId: string): SubagentEntry | undefined {
        return this.entries.get(agentId);
    }

    getBySessionKey(sessionKey: string): SubagentEntry | undefined {
        for (const entry of this.entries.values()) {
            if (entry.sessionKey === sessionKey) {
                return entry;
            }
        }
        return undefined;
    }

    getChildren(parentSessionId: string): SubagentEntry[] {
        return Array.from(this.entries.values())
            .filter(e => e.parentSessionId === parentSessionId)
            .sort((a, b) => b.createdAt - a.createdAt);
    }

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

    hasPendingChildren(parentSessionId: string): boolean {
        return this.getByParent(parentSessionId, 'pending').length > 0 ||
               this.getByParent(parentSessionId, 'running').length > 0;
    }

    resolveSpawnDepth(sponsorSessionKey: string | undefined, maxGlobalDepth: number, maxSpawnDepth: number): number {
        if (this.nativeStorage) {
            const native = nativeRegistryCall<NativeRegistryMutation<{ currentDepth: number; error?: string | null }>>({
                operation: 'spawn_depth',
                sponsorSessionKey,
                maxGlobalDepth,
                maxSpawnDepth,
                entries: this.getAll()
            });
            if (native && Array.isArray(native.entries) && native.result) {
                if (native.result.error) throw new Error(native.result.error);
                return native.result.currentDepth;
            }
            this.nativeStorage = false;
        }

        const sponsor = sponsorSessionKey ? this.getBySessionKey(sponsorSessionKey) : undefined;
        const currentDepth = (sponsor?.currentDepth || 0) + 1;
        if (sponsor && currentDepth > sponsor.maxDepth) {
            throw new Error(`Maximum spawn depth (${sponsor.maxDepth}) exceeded`);
        }
        if (currentDepth > maxSpawnDepth) {
            throw new Error(`Max spawn depth ceiling (${maxSpawnDepth}) reached. Finish this task with your own tools.`);
        }
        if (currentDepth > maxGlobalDepth) {
            throw new Error(`Maximum spawn depth ceiling (${maxGlobalDepth}) reached to prevent recursion. Use a more direct task.`);
        }
        return currentDepth;
    }

    update(agentId: string, updates: Partial<SubagentEntry>): SubagentEntry | undefined {
        if (this.nativeStorage) {
            const native = nativeRegistryCall<NativeRegistryMutation<SubagentEntry | null>>({
                operation: 'update', agentId, updates, entries: this.getAll()
            });
            if (native && Array.isArray(native.entries)) {
                this.replaceEntries(native.entries);
                const updated = native.result || undefined;
                if (updated) this.notifyListeners(updated.parentSessionId, updated);
                return updated;
            }
            this.nativeStorage = false;
        }

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

    complete(agentId: string, result?: string, error?: string): SubagentEntry | undefined {
        if (this.nativeStorage) {
            const native = nativeRegistryCall<NativeRegistryMutation<SubagentEntry | null>>({
                operation: 'complete', agentId, result, error, entries: this.getAll()
            });
            if (native && Array.isArray(native.entries)) {
                this.replaceEntries(native.entries);
                const updated = native.result || undefined;
                if (updated) this.notifyListeners(updated.parentSessionId, updated);
                return updated;
            }
            this.nativeStorage = false;
        }

        return this.update(agentId, {
            status: error ? 'failed' : 'completed',
            completedAt: Date.now(),
            result,
            error
        });
    }

    abort(agentId: string): SubagentEntry | undefined {
        if (this.nativeStorage) {
            const native = nativeRegistryCall<NativeRegistryMutation<SubagentEntry | null>>({
                operation: 'abort', agentId, entries: this.getAll()
            });
            if (native && Array.isArray(native.entries)) {
                this.replaceEntries(native.entries);
                const updated = native.result || undefined;
                if (updated) this.notifyListeners(updated.parentSessionId, updated);
                return updated;
            }
            this.nativeStorage = false;
        }

        return this.update(agentId, {
            status: 'aborted',
            completedAt: Date.now()
        });
    }

    /** Keep at most `maxFinished` completed/failed/aborted entries (oldest go first). */
    trimFinished(maxFinished = 100): number {
        if (this.nativeStorage) {
            const native = nativeRegistryCall<NativeRegistryMutation<number>>({
                operation: 'trim_finished', maxFinished, entries: this.getAll()
            });
            if (native && Array.isArray(native.entries)) {
                this.replaceEntries(native.entries);
                return native.result || 0;
            }
            this.nativeStorage = false;
        }

        const finished = Array.from(this.entries.values())
            .filter(e => e.status === 'completed' || e.status === 'failed' || e.status === 'aborted')
            .sort((a, b) => a.updatedAt - b.updatedAt);
        const excess = finished.length - maxFinished;
        for (let i = 0; i < excess; i++) this.entries.delete(finished[i].agentId);
        return Math.max(0, excess);
    }

    cleanup(): number {
        if (this.nativeStorage) {
            const native = nativeRegistryCall<NativeRegistryMutation<number>>({
                operation: 'cleanup', entries: this.getAll()
            });
            if (native && Array.isArray(native.entries)) {
                this.replaceEntries(native.entries);
                if (native.result > 0) console.log(`[SubagentRegistry] Cleaned up ${native.result} old entries`);
                return native.result;
            }
            this.nativeStorage = false;
        }

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
    }

    private replaceEntries(entries: SubagentEntry[]): void {
        this.entries.clear();
        for (const entry of entries) this.entries.set(entry.agentId, entry);
    }
}

let registry: SubagentRegistry | null = null;

export function getSubagentRegistry(): SubagentRegistry {
    if (!registry) {
        registry = new SubagentRegistry();
    }
    return registry;
}

export function generateAgentId(): string {
    const native = nativeRegistryCall<string>({ operation: 'generate_id' });
    if (native) return native;
    return `agent_${crypto.randomUUID().replace(/-/g, '').substring(0, 12)}`;
}
