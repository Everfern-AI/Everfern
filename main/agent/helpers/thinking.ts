/**
 * EverFern Desktop — Thinking/Reasoning Support
 * 
 * Handles thinking/reasoning parameters for models that support it:
 * - NVIDIA NIM (nemotron, etc.)
 * - OpenAI o1/o3 models
 * - DeepSeek reasoner
 */

export type ThinkLevel = 'off' | 'low' | 'medium' | 'high';

export interface ChatRequestWithExtras {
    messages: unknown[];
    model?: string;
    temperature?: number;
    maxTokens?: number;
    tools?: unknown[];
    extraBody?: Record<string, unknown>;
    [key: string]: unknown;
}

export interface ThinkingConfig {
    enabled: boolean;
    level?: ThinkLevel;
    budget?: number; // tokens
}

export interface ModelThinkingCapabilities {
    supportsThinking: boolean;
    defaultLevel: ThinkLevel;
    supportedLevels: ThinkLevel[];
    maxBudget: number;
    usesExtraBody: boolean; // vs native thinking parameter
}

// Models that support thinking via extra_body (NVIDIA NIM style)
const EXTRA_BODY_THINKING_MODELS = [
    'nvidia/nemotron',
    'qwen',
    'deepseek-v4-pro',
    'gemma',
];

// Models with native thinking support
const NATIVE_THINKING_MODELS = [
    'o1',
    'o3',
    'o4',
    'claude',
];

export function getModelThinkingCapabilities(modelId: string): ModelThinkingCapabilities {
    const lower = modelId.toLowerCase();
    
    // NVIDIA NIM models with thinking
    if (EXTRA_BODY_THINKING_MODELS.some(m => lower.includes(m))) {
        return {
            supportsThinking: true,
            defaultLevel: 'medium',
            supportedLevels: ['off', 'low', 'medium', 'high'],
            maxBudget: 16384,
            usesExtraBody: true
        };
    }
    
    // Native thinking (Anthropic, OpenAI o1/o3)
    if (NATIVE_THINKING_MODELS.some(m => lower.includes(m))) {
        return {
            supportsThinking: true,
            defaultLevel: 'medium',
            supportedLevels: ['off', 'low', 'medium', 'high'],
            maxBudget: 200000,
            usesExtraBody: false
        };
    }
    
    return {
        supportsThinking: false,
        defaultLevel: 'off',
        supportedLevels: ['off'],
        maxBudget: 0,
        usesExtraBody: false
    };
}

export function buildThinkingParams(
    modelId: string,
    config: ThinkingConfig
): Record<string, unknown> | null {
    if (!config.enabled || !config.budget) return null;
    
    const caps = getModelThinkingCapabilities(modelId);
    if (!caps.supportsThinking) return null;
    
    const level = config.level || caps.defaultLevel;
    const budget = Math.min(config.budget, caps.maxBudget);
    
    if (caps.usesExtraBody) {
        // NVIDIA NIM style
        const levelToBudget: Record<ThinkLevel, number> = {
            off: 0,
            low: 1024,
            medium: 4096,
            high: budget
        };
        
        return {
            chat_template_kwargs: {
                enable_thinking: level !== 'off'
            },
            reasoning_budget: levelToBudget[level] || 0
        };
    }
    
    // Native thinking parameter (could be extended for other providers)
    return null;
}

export function applyThinkingToRequest(
    request: ChatRequestWithExtras,
    modelId: string,
    config: ThinkingConfig
): ChatRequestWithExtras {
    const extraBodyParams = buildThinkingParams(modelId, config);
    
    if (!extraBodyParams) {
        return request;
    }
    
    return {
        ...request,
        extraBody: {
            ...(request.extraBody as Record<string, unknown> || {}),
            ...extraBodyParams
        }
    };
}

export function estimateThinkingTokens(response: string): number {
    // Rough estimate based on thinking tag content
    const thinkMatch = response.match(/<think>([\s\S]*?)<\/think>/i);
    if (thinkMatch) {
        const thinkContent = thinkMatch[1];
        // ~4 chars per token
        return Math.ceil(thinkContent.length / 4);
    }
    return 0;
}

export function shouldShowThinking(thinkLevel: ThinkLevel): boolean {
    return thinkLevel !== 'off';
}

export function getThinkLevelFromString(level: string): ThinkLevel {
    const lower = level.toLowerCase().trim();
    if (lower === 'off' || lower === '0') return 'off';
    if (lower === 'low' || lower === '1') return 'low';
    if (lower === 'medium' || lower === '2') return 'medium';
    if (lower === 'high' || lower === '3') return 'high';
    return 'medium'; // default
}

/**
 * Strips all thinking, reasoning, and reflection blocks (closed or unclosed)
 * from LLM text outputs.
 */
export function scrubReasoningTags(text: string): string {
    if (!text) return '';
    return text
        .replace(/<(?:think|thought|reasoning|reflection)>[\s\S]*?<\/(?:think|thought|reasoning|reflection)>/gi, '')
        .replace(/\[(?:Thinking|Reasoning)\][\s\S]*?\[\/(?:Thinking|Reasoning)\]/gi, '')
        .replace(/<(?:think|thought|reasoning|reflection)>[\s\S]*$/gi, '')
        .replace(/\[(?:Thinking|Reasoning)\][\s\S]*$/gi, '')
        .replace(/^\s*(?:Thinking Process|Reasoning Process|Chain-of-thought|Internal Thought):[^\n]*\n?/gim, '')
        .trim();
}

/**
 * State machine for separating streaming thought/reasoning tokens from
 * normal output text across arbitrary chunk boundaries.
 */
export class StreamingThoughtFilter {
    private isThinking = false;
    private buffer = '';
    private readonly startTags = ['<think>', '<thought>', '<reasoning>', '<reflection>', '[Thinking]', '[Reasoning]'];
    private readonly endTags = ['</think>', '</thought>', '</reasoning>', '</reflection>', '[/Thinking]', '[/Reasoning]'];

    process(chunk: string, emitChunk: (c: string) => void, emitThought: (t: string) => void) {
        this.buffer += chunk;

        while (this.buffer.length > 0) {
            if (!this.isThinking) {
                // Check if buffer contains any start tag
                let earliestStart = -1;
                let matchedStartTag = '';

                for (const tag of this.startTags) {
                    const idx = this.buffer.toLowerCase().indexOf(tag.toLowerCase());
                    if (idx !== -1 && (earliestStart === -1 || idx < earliestStart)) {
                        earliestStart = idx;
                        matchedStartTag = tag;
                    }
                }

                if (earliestStart !== -1) {
                    // Content before start tag is regular chunk
                    const before = this.buffer.slice(0, earliestStart);
                    if (before) {
                        emitChunk(before);
                    }
                    this.isThinking = true;
                    this.buffer = this.buffer.slice(earliestStart + matchedStartTag.length);
                } else {
                    // Check for potential partial start tag at end of buffer (e.g. "<th", "<", "[Th")
                    let partialLen = 0;
                    for (const tag of this.startTags) {
                        for (let len = 1; len < tag.length; len++) {
                            if (this.buffer.toLowerCase().endsWith(tag.slice(0, len).toLowerCase())) {
                                if (len > partialLen) partialLen = len;
                            }
                        }
                    }

                    if (partialLen > 0) {
                        // Emit everything except the potential partial tag
                        const safe = this.buffer.slice(0, this.buffer.length - partialLen);
                        if (safe) {
                            emitChunk(safe);
                        }
                        this.buffer = this.buffer.slice(this.buffer.length - partialLen);
                        break; // wait for next chunk
                    } else {
                        // Buffer has no start tags and no partial tags — emit all
                        emitChunk(this.buffer);
                        this.buffer = '';
                    }
                }
            } else {
                // We are in thinking mode: look for end tag
                let earliestEnd = -1;
                let matchedEndTag = '';

                for (const tag of this.endTags) {
                    const idx = this.buffer.toLowerCase().indexOf(tag.toLowerCase());
                    if (idx !== -1 && (earliestEnd === -1 || idx < earliestEnd)) {
                        earliestEnd = idx;
                        matchedEndTag = tag;
                    }
                }

                if (earliestEnd !== -1) {
                    // Content before end tag is thought
                    const thoughtPart = this.buffer.slice(0, earliestEnd);
                    if (thoughtPart) {
                        emitThought(thoughtPart);
                    }
                    this.isThinking = false;
                    this.buffer = this.buffer.slice(earliestEnd + matchedEndTag.length);
                } else {
                    // Check for potential partial end tag at end of buffer (e.g. "</th", "</", "[/Th")
                    let partialLen = 0;
                    for (const tag of this.endTags) {
                        for (let len = 1; len < tag.length; len++) {
                            if (this.buffer.toLowerCase().endsWith(tag.slice(0, len).toLowerCase())) {
                                if (len > partialLen) partialLen = len;
                            }
                        }
                    }

                    if (partialLen > 0) {
                        // Emit everything except potential partial end tag as thought
                        const safeThought = this.buffer.slice(0, this.buffer.length - partialLen);
                        if (safeThought) {
                            emitThought(safeThought);
                        }
                        this.buffer = this.buffer.slice(this.buffer.length - partialLen);
                        break; // wait for next chunk
                    } else {
                        // Whole buffer is thought
                        emitThought(this.buffer);
                        this.buffer = '';
                    }
                }
            }
        }
    }

    flush(emitChunk: (c: string) => void, emitThought: (t: string) => void) {
        if (this.buffer) {
            if (this.isThinking) {
                emitThought(this.buffer);
            } else {
                emitChunk(this.buffer);
            }
            this.buffer = '';
        }
    }
}

