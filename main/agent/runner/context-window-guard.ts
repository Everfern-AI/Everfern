/**
 * EverFern Desktop — Context Window Guard
 * 
 * Guards against context overflow with token estimation.
 * Implements OpenClaw-style warning thresholds and hard blocks.
 */

export interface ContextWindowConfig {
    modelContextWindow: number;  // Max tokens for this model
    warningThreshold: number;    // Warn at this percentage (0-1)
    hardBlockThreshold: number;  // Block new calls at this percentage (0-1)
    safetyMargin: number;       // Extra buffer for estimation inaccuracy
}

export interface ContextUsage {
    used: number;
    max: number;
    percentage: number;
    available: number;
}

// Model context windows (approximate)
const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
    'gpt-4o': 128000,
    'gpt-4o-mini': 128000,
    'gpt-4-turbo': 128000,
    'gpt-4': 8192,
    'claude-3-5-sonnet-202410': 200000,
    'claude-3-opus-202402': 200000,
    'claude-3-sonnet-202402': 200000,
    'claude-3-haiku-202403': 200000,
    'deepseek-v4-flash': 64000,
    'deepseek-v4-pro': 128000,
    'deepseek-coder': 16000,
    'o1-preview': 128000,
    'o1-mini': 128000,
    'o3-mini': 128000,
    'gemini-1.5-pro': 1000000,
    'gemini-1.5-flash': 1000000,
    'llama-3.1-70b': 128000,
    'llama-3.1-8b': 128000,
};

export function getContextWindowForModel(model: string): number {
    // Try exact match first
    if (MODEL_CONTEXT_WINDOWS[model]) {
        return MODEL_CONTEXT_WINDOWS[model];
    }

    const lower = model.toLowerCase();

    // Check known provider prefixes/patterns first for better estimation
    if (lower.includes('gemini')) return 1000000;
    if (lower.includes('claude')) return 200000;
    if (lower.includes('deepseek')) {
        if (lower.includes('flash')) return 64000;
        return 128000;
    }
    if (lower.includes('gpt-4') || lower.includes('gpt-3.5') || lower.includes('o1') || lower.includes('o3') || lower.includes('llama-3.1')) {
        return 128000;
    }

    // Try partial match against the dictionary
    for (const [key, value] of Object.entries(MODEL_CONTEXT_WINDOWS)) {
        if (lower.includes(key.toLowerCase())) {
            return value;
        }
    }

    // Default to 128k (industry standard for modern LLMs) instead of 8k
    return 128000;
}

export class ContextWindowGuard {
    private config: ContextWindowConfig;

    constructor(model: string, customConfig?: Partial<ContextWindowConfig>) {
        const maxTokens = getContextWindowForModel(model);
        
        this.config = {
            modelContextWindow: maxTokens,
            warningThreshold: customConfig?.warningThreshold ?? 0.75,
            hardBlockThreshold: customConfig?.hardBlockThreshold ?? 0.90,
            safetyMargin: customConfig?.safetyMargin ?? 0.10
        };
    }

    estimateTokens(text: string): number {
        // Rough estimation: ~4 chars per token for English
        return Math.ceil(text.length / 4);
    }

    estimateMessageTokens(messages: Array<{ role: string; content: string | unknown[] }>): number {
        // Base tokens per message + content tokens
        let total = 0;
        for (const msg of messages) {
            total += 4; // Role overhead
            if (typeof msg.content === 'string') {
                total += this.estimateTokens(msg.content);
            } else if (Array.isArray(msg.content)) {
                for (const block of msg.content) {
                    if (block && typeof block === 'object' && 'text' in block) {
                        total += this.estimateTokens((block as { text: string }).text);
                    }
                }
            }
        }
        return total;
    }

    getUsage(tokens: number): ContextUsage {
        const effectiveMax = Math.floor(
            this.config.modelContextWindow * (1 - this.config.safetyMargin)
        );
        
        return {
            used: tokens,
            max: this.config.modelContextWindow,
            percentage: tokens / effectiveMax,
            available: Math.max(0, effectiveMax - tokens)
        };
    }

    shouldWarn(tokens: number): boolean {
        const usage = this.getUsage(tokens);
        return usage.percentage >= this.config.warningThreshold;
    }

    canAccept(tokens: number): boolean {
        const usage = this.getUsage(tokens);
        return usage.percentage < this.config.hardBlockThreshold;
    }

    getWarningLevel(tokens: number): 'ok' | 'warning' | 'critical' {
        const usage = this.getUsage(tokens);
        if (usage.percentage >= this.config.hardBlockThreshold) {
            return 'critical';
        }
        if (usage.percentage >= this.config.warningThreshold) {
            return 'warning';
        }
        return 'ok';
    }

    getStatus(tokens: number): {
        allowed: boolean;
        level: 'ok' | 'warning' | 'critical';
        usage: ContextUsage;
        message: string;
    } {
        const usage = this.getUsage(tokens);
        const level = this.getWarningLevel(tokens);
        const allowed = level !== 'critical';

        let message = '';
        if (level === 'critical') {
            message = `Context window critically low (${Math.round(usage.percentage * 100)}%). Compaction required.`;
        } else if (level === 'warning') {
            message = `Context window running low (${Math.round(usage.percentage * 100)}%). Consider compacting soon.`;
        }

        return { allowed, level, usage, message };
    }

    check(messages: any[]): { 
        allowed: boolean; 
        level: 'ok' | 'warning' | 'critical'; 
        usage: ContextUsage; 
        message: string;
        estimatedTokens: number;
    } {
        const tokens = this.estimateMessageTokens(messages);
        const status = this.getStatus(tokens);
        return {
            ...status,
            estimatedTokens: tokens
        };
    }

    compactHistory(history: any[]): any[] {
        // Advanced compaction logic:
        // 1. Keep system message
        // 2. Keep last 10 messages
        // 3. Drop middle chunks (especially tool results if they are large)
        if (history.length < 15) return history;

        const systemMsgs = history.filter(m => m.role === 'system');
        const tail = history.slice(-10);
        
        // Remove duplicates if system msg is in tail
        const combined = [...systemMsgs, ...tail];
        return Array.from(new Set(combined));
    }
}

// Singleton factory
const guards = new Map<string, ContextWindowGuard>();

export function getContextWindowGuard(model: string): ContextWindowGuard {
    if (!guards.has(model)) {
        guards.set(model, new ContextWindowGuard(model));
    }
    return guards.get(model)!;
}
