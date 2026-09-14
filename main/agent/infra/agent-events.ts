/**
 * EverFern Desktop — Agent Events System
 * 
 * Event-driven architecture for streaming agent events.
 * Implements OpenClaw-style event streams with sequential numbering.
 */

import { EventEmitter } from 'events';

export type EventStream = 'lifecycle' | 'tool' | 'assistant' | 'error' | 'compaction' | 'subagent-progress';

export interface AgentEvent {
    seq: number;
    ts: number;
    stream: EventStream;
    type: string;
    data: Record<string, unknown>;
    sessionKey?: string;
}

export interface RunContext {
    sessionKey: string;
    verboseLevel: number;
    heartbeat: boolean;
}

type EventCallback = (event: AgentEvent) => void;

class AgentEventEmitter {
    private emitter = new EventEmitter();
    private seqCounter = 0;
    private sessionKey: string = '';
    private listenersByStream: Map<EventStream, Set<EventCallback>> = new Map();
    private globalListeners: Set<EventCallback> = new Set();

    setSessionKey(key: string) {
        this.sessionKey = key;
        this.seqCounter = 0;
    }

    getSessionKey(): string {
        return this.sessionKey;
    }

    emit(stream: EventStream, type: string, data: Record<string, unknown> = {}) {
        const event: AgentEvent = {
            seq: ++this.seqCounter,
            ts: Date.now(),
            stream,
            type,
            data,
            sessionKey: this.sessionKey
        };

        // Emit to stream-specific listeners
        const streamListeners = this.listenersByStream.get(stream);
        if (streamListeners) {
            streamListeners.forEach(cb => cb(event));
        }

        // Emit to global listeners
        this.globalListeners.forEach(cb => cb(event));

        // Emit via EventEmitter for compatibility
        this.emitter.emit(type, event);
        this.emitter.emit('event', event);

        return event;
    }

    onStream(stream: EventStream, callback: EventCallback): () => void {
        if (!this.listenersByStream.has(stream)) {
            this.listenersByStream.set(stream, new Set());
        }
        this.listenersByStream.get(stream)!.add(callback);

        return () => {
            this.listenersByStream.get(stream)?.delete(callback);
        };
    }

    onAny(callback: EventCallback): () => void {
        this.globalListeners.add(callback);
        return () => {
            this.globalListeners.delete(callback);
        };
    }

    on(type: string, callback: (event: AgentEvent) => void): () => void {
        this.emitter.on(type, callback);
        return () => this.emitter.off(type, callback);
    }

    once(type: string, callback: (event: AgentEvent) => void): void {
        this.emitter.once(type, callback);
    }

    removeAllListeners(): void {
        this.emitter.removeAllListeners();
        this.listenersByStream.clear();
        this.globalListeners.clear();
    }

    getSeq(): number {
        return this.seqCounter;
    }
}

// Singleton instance per session
const sessions = new Map<string, AgentEventEmitter>();

export function getAgentEvents(sessionKey: string): AgentEventEmitter {
    if (!sessions.has(sessionKey)) {
        const events = new AgentEventEmitter();
        events.setSessionKey(sessionKey);
        sessions.set(sessionKey, events);
    }
    return sessions.get(sessionKey)!;
}

export function removeAgentEvents(sessionKey: string): void {
    const events = sessions.get(sessionKey);
    if (events) {
        events.removeAllListeners();
        sessions.delete(sessionKey);
    }
}

// Convenience event emitters for common event types
export function emitLifecycle(sessionKey: string, type: string, data: Record<string, unknown> = {}) {
    return getAgentEvents(sessionKey).emit('lifecycle', type, data);
}

export function emitTool(sessionKey: string, type: string, data: Record<string, unknown> = {}) {
    return getAgentEvents(sessionKey).emit('tool', type, data);
}

export function emitAssistant(sessionKey: string, type: string, data: Record<string, unknown> = {}) {
    return getAgentEvents(sessionKey).emit('assistant', type, data);
}

export function emitError(sessionKey: string, type: string, data: Record<string, unknown> = {}) {
    return getAgentEvents(sessionKey).emit('error', type, data);
}

export function emitCompaction(sessionKey: string, type: string, data: Record<string, unknown> = {}) {
    return getAgentEvents(sessionKey).emit('compaction', type, data);
}
