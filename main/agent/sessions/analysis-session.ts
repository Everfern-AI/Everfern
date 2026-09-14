/**
 * EverFern Desktop — Analysis Session Manager
 *
 * Manages stateful data analysis sessions with DataFrame persistence,
 * variable storage, and execution history tracking.
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { randomUUID } from 'crypto';

/**
 * Serialized DataFrame metadata and data
 */
export interface SerializedDataFrame {
    name: string;
    shape: [number, number]; // [rows, columns]
    columns: string[];
    dtypes: Record<string, string>;
    pickledData: Buffer; // Serialized pandas DataFrame via pickle
}

/**
 * Record of a single Python execution
 */
export interface ExecutionRecord {
    timestamp: number;
    code: string;
    result: {
        success: boolean;
        stdout: string;
        stderr: string;
        executionTimeMs: number;
    };
}

/**
 * Cached computation result
 * Requirements: 10.4
 */
export interface CachedResult {
    key: string;
    value: any;
    computedAt: number;
    /** Hash of the data state when this result was computed, used for invalidation */
    dataStateHash: string;
}

/**
 * Analysis session maintaining state across multiple analysis steps
 */
export interface AnalysisSession {
    id: string;
    conversationId: string;
    createdAt: number;
    lastAccessedAt: number;
    dataFrames: Map<string, SerializedDataFrame>;
    variables: Map<string, any>;
    executionHistory: ExecutionRecord[];
    /** Cache for computed results to avoid redundant calculations (Requirement 10.4) */
    resultCache: Map<string, CachedResult>;
    /** Tracks cache hits and misses for monitoring */
    cacheStats: { hits: number; misses: number };
}

/**
 * Manager interface for analysis sessions
 */
export interface AnalysisSessionManager {
    getOrCreateSession(conversationId: string): AnalysisSession;
    storeDataFrame(sessionId: string, name: string, df: SerializedDataFrame): void;
    retrieveDataFrame(sessionId: string, name: string): SerializedDataFrame | null;
    getExecutionHistory(sessionId: string): ExecutionRecord[];
    resetSession(sessionId: string): void;
    cleanupInactiveSessions(inactivityThresholdMs: number): void;
    /** Cache a computed result keyed by an operation identifier (Requirement 10.4) */
    cacheResult(sessionId: string, key: string, value: any, dataStateHash: string): void;
    /** Retrieve a cached result; returns null on miss or stale data (Requirement 10.4) */
    getCachedResult(sessionId: string, key: string, currentDataStateHash: string): any | null;
    /** Invalidate all cached results for a session (e.g. after data changes) */
    invalidateCache(sessionId: string): void;
    /** Get cache hit/miss statistics for a session */
    getCacheStats(sessionId: string): { hits: number; misses: number };
}

/**
 * Default inactivity threshold: 30 minutes
 */
const DEFAULT_INACTIVITY_THRESHOLD_MS = 30 * 60 * 1000;

/**
 * Get the temporary directory for analysis session data
 */
function getAnalysisSessionDir(): string {
    return path.join(os.tmpdir(), 'everfern-analysis-sessions');
}

/**
 * Ensure the analysis session directory exists
 */
function ensureAnalysisSessionDir(): void {
    const dir = getAnalysisSessionDir();
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

/**
 * Implementation of AnalysisSessionManager
 */
export class AnalysisSessionManagerImpl implements AnalysisSessionManager {
    private sessions: Map<string, AnalysisSession>;
    private conversationToSessionMap: Map<string, string>;

    constructor() {
        this.sessions = new Map();
        this.conversationToSessionMap = new Map();
        ensureAnalysisSessionDir();
    }

    /**
     * Get existing session for conversation or create a new one
     * Requirements: 5.1
     */
    getOrCreateSession(conversationId: string): AnalysisSession {
        // Check if session already exists for this conversation
        const existingSessionId = this.conversationToSessionMap.get(conversationId);
        if (existingSessionId) {
            const session = this.sessions.get(existingSessionId);
            if (session) {
                // Update last accessed time
                session.lastAccessedAt = Date.now();
                return session;
            }
        }

        // Create new session
        const sessionId = randomUUID();
        const now = Date.now();
        const session: AnalysisSession = {
            id: sessionId,
            conversationId,
            createdAt: now,
            lastAccessedAt: now,
            dataFrames: new Map(),
            variables: new Map(),
            executionHistory: [],
            resultCache: new Map(),
            cacheStats: { hits: 0, misses: 0 }
        };

        this.sessions.set(sessionId, session);
        this.conversationToSessionMap.set(conversationId, sessionId);

        console.log(`[AnalysisSession] Created new session ${sessionId} for conversation ${conversationId}`);
        return session;
    }

    /**
     * Store a DataFrame in the session
     * Requirements: 5.2
     *
     * Note: DataFrame serialization using pickle is handled by the Python executor.
     * This method stores the already-serialized DataFrame data.
     */
    storeDataFrame(sessionId: string, name: string, df: SerializedDataFrame): void {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error(`Session ${sessionId} not found`);
        }

        // Store DataFrame in memory
        session.dataFrames.set(name, df);
        session.lastAccessedAt = Date.now();

        // Persist to disk
        const sessionDir = path.join(getAnalysisSessionDir(), sessionId);
        if (!fs.existsSync(sessionDir)) {
            fs.mkdirSync(sessionDir, { recursive: true });
        }

        const dfPath = path.join(sessionDir, `${name}.pkl`);
        try {
            fs.writeFileSync(dfPath, df.pickledData);
            console.log(`[AnalysisSession] Stored DataFrame '${name}' for session ${sessionId}`);
        } catch (error) {
            console.error(`[AnalysisSession] Failed to persist DataFrame '${name}':`, error);
        }
    }

    /**
     * Retrieve a DataFrame from the session
     * Requirements: 5.2
     */
    retrieveDataFrame(sessionId: string, name: string): SerializedDataFrame | null {
        const session = this.sessions.get(sessionId);
        if (!session) {
            return null;
        }

        session.lastAccessedAt = Date.now();

        // Check in-memory first
        const df = session.dataFrames.get(name);
        if (df) {
            return df;
        }

        // Try to load from disk
        const sessionDir = path.join(getAnalysisSessionDir(), sessionId);
        const dfPath = path.join(sessionDir, `${name}.pkl`);

        if (fs.existsSync(dfPath)) {
            try {
                const pickledData = fs.readFileSync(dfPath);
                // Note: We don't have full metadata here, so return minimal structure
                // In practice, metadata should be stored separately or the Python executor
                // should handle full deserialization
                const serializedDf: SerializedDataFrame = {
                    name,
                    shape: [0, 0], // Unknown without deserializing
                    columns: [],
                    dtypes: {},
                    pickledData
                };
                session.dataFrames.set(name, serializedDf);
                return serializedDf;
            } catch (error) {
                console.error(`[AnalysisSession] Failed to load DataFrame '${name}':`, error);
                return null;
            }
        }

        return null;
    }

    /**
     * Get execution history for a session
     * Requirements: 5.3
     */
    getExecutionHistory(sessionId: string): ExecutionRecord[] {
        const session = this.sessions.get(sessionId);
        if (!session) {
            return [];
        }

        session.lastAccessedAt = Date.now();
        return [...session.executionHistory]; // Return copy
    }

    /**
     * Add an execution record to the session history
     * Requirements: 5.3
     */
    addExecutionRecord(sessionId: string, record: ExecutionRecord): void {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error(`Session ${sessionId} not found`);
        }

        session.executionHistory.push(record);
        session.lastAccessedAt = Date.now();
    }

    /**
     * Store a variable in the session
     * Requirements: 5.1
     */
    storeVariable(sessionId: string, name: string, value: any): void {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error(`Session ${sessionId} not found`);
        }

        session.variables.set(name, value);
        session.lastAccessedAt = Date.now();
    }

    /**
     * Retrieve a variable from the session
     * Requirements: 5.1
     */
    retrieveVariable(sessionId: string, name: string): any {
        const session = this.sessions.get(sessionId);
        if (!session) {
            return undefined;
        }

        session.lastAccessedAt = Date.now();
        return session.variables.get(name);
    }

    /**
     * Reset a session, clearing all data
     * Requirements: 5.6
     */
    resetSession(sessionId: string): void {
        const session = this.sessions.get(sessionId);
        if (!session) {
            return;
        }

        // Clear in-memory data
        session.dataFrames.clear();
        session.variables.clear();
        session.executionHistory = [];
        session.resultCache.clear();
        session.cacheStats = { hits: 0, misses: 0 };
        session.lastAccessedAt = Date.now();

        // Delete persisted files
        const sessionDir = path.join(getAnalysisSessionDir(), sessionId);
        if (fs.existsSync(sessionDir)) {
            try {
                fs.rmSync(sessionDir, { recursive: true, force: true });
                console.log(`[AnalysisSession] Reset session ${sessionId}`);
            } catch (error) {
                console.error(`[AnalysisSession] Failed to delete session directory:`, error);
            }
        }
    }

    /**
     * Cache a computed result to avoid redundant calculations
     * Requirements: 10.4
     */
    cacheResult(sessionId: string, key: string, value: any, dataStateHash: string): void {
        const session = this.sessions.get(sessionId);
        if (!session) {
            throw new Error(`Session ${sessionId} not found`);
        }

        const cached: CachedResult = {
            key,
            value,
            computedAt: Date.now(),
            dataStateHash
        };
        session.resultCache.set(key, cached);
        session.lastAccessedAt = Date.now();
        console.log(`[AnalysisSession] Cached result '${key}' for session ${sessionId}`);
    }

    /**
     * Retrieve a cached result; returns null on cache miss or stale data
     * Requirements: 10.4
     */
    getCachedResult(sessionId: string, key: string, currentDataStateHash: string): any | null {
        const session = this.sessions.get(sessionId);
        if (!session) {
            return null;
        }

        session.lastAccessedAt = Date.now();
        const cached = session.resultCache.get(key);

        if (!cached) {
            session.cacheStats.misses++;
            return null;
        }

        // Invalidate if data has changed since the result was computed
        if (cached.dataStateHash !== currentDataStateHash) {
            session.resultCache.delete(key);
            session.cacheStats.misses++;
            console.log(`[AnalysisSession] Cache miss (stale) for '${key}' in session ${sessionId}`);
            return null;
        }

        session.cacheStats.hits++;
        console.log(`[AnalysisSession] Cache hit for '${key}' in session ${sessionId}`);
        return cached.value;
    }

    /**
     * Invalidate all cached results for a session (e.g. after data changes)
     * Requirements: 10.4
     */
    invalidateCache(sessionId: string): void {
        const session = this.sessions.get(sessionId);
        if (!session) {
            return;
        }

        const count = session.resultCache.size;
        session.resultCache.clear();
        session.lastAccessedAt = Date.now();
        console.log(`[AnalysisSession] Invalidated ${count} cached results for session ${sessionId}`);
    }

    /**
     * Get cache hit/miss statistics for a session
     * Requirements: 10.4
     */
    getCacheStats(sessionId: string): { hits: number; misses: number } {
        const session = this.sessions.get(sessionId);
        if (!session) {
            return { hits: 0, misses: 0 };
        }
        return { ...session.cacheStats };
    }

    /**
     * Clean up inactive sessions
     * Requirements: 5.5
     */
    cleanupInactiveSessions(inactivityThresholdMs: number = DEFAULT_INACTIVITY_THRESHOLD_MS): void {
        const now = Date.now();
        const sessionsToDelete: string[] = [];

        for (const [sessionId, session] of this.sessions.entries()) {
            const inactiveTime = now - session.lastAccessedAt;
            if (inactiveTime > inactivityThresholdMs) {
                sessionsToDelete.push(sessionId);
            }
        }

        for (const sessionId of sessionsToDelete) {
            const session = this.sessions.get(sessionId);
            if (session) {
                // Remove from conversation map
                this.conversationToSessionMap.delete(session.conversationId);

                // Delete session directory
                const sessionDir = path.join(getAnalysisSessionDir(), sessionId);
                if (fs.existsSync(sessionDir)) {
                    try {
                        fs.rmSync(sessionDir, { recursive: true, force: true });
                    } catch (error) {
                        console.error(`[AnalysisSession] Failed to delete session directory:`, error);
                    }
                }

                // Remove from sessions map
                this.sessions.delete(sessionId);
            }
        }

        if (sessionsToDelete.length > 0) {
            console.log(`[AnalysisSession] Cleaned up ${sessionsToDelete.length} inactive sessions`);
        }
    }

    /**
     * Get all active sessions (for debugging/monitoring)
     */
    getActiveSessions(): AnalysisSession[] {
        return Array.from(this.sessions.values());
    }
}

/**
 * Singleton instance
 */
let analysisSessionManagerInstance: AnalysisSessionManagerImpl | null = null;

/**
 * Get the singleton AnalysisSessionManager instance
 */
export function getAnalysisSessionManager(): AnalysisSessionManager {
    if (!analysisSessionManagerInstance) {
        analysisSessionManagerInstance = new AnalysisSessionManagerImpl();

        // Set up periodic cleanup (every 10 minutes)
        setInterval(() => {
            analysisSessionManagerInstance?.cleanupInactiveSessions();
        }, 10 * 60 * 1000);
    }
    return analysisSessionManagerInstance;
}
