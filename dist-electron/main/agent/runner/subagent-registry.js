"use strict";
/**
 * EverFern Desktop — Subagent Registry
 *
 * In-memory + async disk persistence for subagent visibility.
 * Implements a debounced write queue to prevent event loop blocking.
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
exports.getSubagentRegistry = getSubagentRegistry;
exports.generateAgentId = generateAgentId;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const crypto = __importStar(require("crypto"));
function getRegistryPath() {
    return path.join(os.homedir(), '.everfern', 'subagent-registry.json');
}
async function ensureDirAsync() {
    const dir = path.dirname(getRegistryPath());
    try {
        await fs.promises.access(dir);
    }
    catch {
        await fs.promises.mkdir(dir, { recursive: true });
    }
}
class SubagentRegistry {
    entries = new Map();
    listeners = new Map();
    saveTimeout = null;
    DEBOUNCE_MS = 500;
    constructor() {
        this.loadSync();
    }
    /**
     * loadSync is used only in constructor to ensure baseline state.
     */
    loadSync() {
        const filePath = getRegistryPath();
        if (!fs.existsSync(filePath))
            return;
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const data = JSON.parse(content);
            const cutoff = Date.now() - 24 * 60 * 60 * 1000;
            for (const entry of data) {
                if (entry.updatedAt > cutoff) {
                    this.entries.set(entry.agentId, entry);
                }
            }
            console.log(`[SubagentRegistry] Loaded ${this.entries.size} entries`);
        }
        catch (e) {
            console.error('[SubagentRegistry] Failed to load registry:', e);
        }
    }
    /**
     * Debounced async save to prevent blocking the event loop.
     */
    scheduleSave() {
        if (this.saveTimeout)
            return;
        this.saveTimeout = setTimeout(async () => {
            this.saveTimeout = null;
            await this.saveAsync();
        }, this.DEBOUNCE_MS);
    }
    async saveAsync() {
        await ensureDirAsync();
        const filePath = getRegistryPath();
        try {
            const data = Array.from(this.entries.values());
            await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
        }
        catch (e) {
            console.error('[SubagentRegistry] Failed to save registry:', e);
        }
    }
    register(entry) {
        const now = Date.now();
        const fullEntry = {
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
    get(agentId) {
        return this.entries.get(agentId);
    }
    getBySessionKey(sessionKey) {
        for (const entry of this.entries.values()) {
            if (entry.sessionKey === sessionKey) {
                return entry;
            }
        }
        return undefined;
    }
    getChildren(parentSessionId) {
        return Array.from(this.entries.values())
            .filter(e => e.parentSessionId === parentSessionId)
            .sort((a, b) => b.createdAt - a.createdAt);
    }
    getByParent(parentSessionId, status) {
        let children = this.getChildren(parentSessionId);
        if (status) {
            children = children.filter(e => e.status === status);
        }
        return children;
    }
    /**
     * Gets all registered agents
     */
    getAll() {
        return Array.from(this.entries.values());
    }
    hasPendingChildren(parentSessionId) {
        return this.getByParent(parentSessionId, 'pending').length > 0 ||
            this.getByParent(parentSessionId, 'running').length > 0;
    }
    update(agentId, updates) {
        const existing = this.entries.get(agentId);
        if (!existing)
            return undefined;
        const updated = {
            ...existing,
            ...updates,
            updatedAt: Date.now()
        };
        this.entries.set(agentId, updated);
        this.scheduleSave();
        this.notifyListeners(updated.parentSessionId, updated);
        return updated;
    }
    complete(agentId, result, error) {
        return this.update(agentId, {
            status: error ? 'failed' : 'completed',
            completedAt: Date.now(),
            result,
            error
        });
    }
    abort(agentId) {
        return this.update(agentId, {
            status: 'aborted',
            completedAt: Date.now()
        });
    }
    cleanup() {
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
    onUpdate(parentSessionId, callback) {
        if (!this.listeners.has(parentSessionId)) {
            this.listeners.set(parentSessionId, new Set());
        }
        this.listeners.get(parentSessionId).add(callback);
        return () => {
            this.listeners.get(parentSessionId)?.delete(callback);
        };
    }
    notifyListeners(parentSessionId, entry) {
        const callbacks = this.listeners.get(parentSessionId);
        if (callbacks) {
            callbacks.forEach(cb => cb(entry));
        }
    }
}
let registry = null;
function getSubagentRegistry() {
    if (!registry) {
        registry = new SubagentRegistry();
    }
    return registry;
}
function generateAgentId() {
    return `agent_${crypto.randomUUID().replace(/-/g, '').substring(0, 12)}`;
}
