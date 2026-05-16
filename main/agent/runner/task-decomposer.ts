/**
 * EverFern Desktop — NEXUS Task Decomposer v5 (Simple Task Skip + Robust JSON)
 *
 * Intelligently decomposes complex tasks into dependency-aware, parallelizable subtasks.
 * Skips AI decomposition for simple tasks (single-step requests).
 */

import { DecomposedTask, TaskStep } from './state';
import type { AIClient } from '../../lib/ai-client';

export interface TaskAnalysis {
    complexity: 'simple' | 'moderate' | 'complex';
    taskType: 'coding' | 'research' | 'build' | 'fix' | 'analyze' | 'automate' | 'task' | 'conversation';
    entities: string[];
    canParallelize: boolean;
    suggestedApproach: 'sequential' | 'parallel' | 'hybrid';
    estimatedSteps: number;
    requiresExternalData: boolean;
    requiresFileOps: boolean;
    requiresCommandExecution: boolean;
}

// ── Simple Task Detection ─────────────────────────────────────────────────

function isSimpleTask(userInput: string): boolean {
    const lower = userInput.toLowerCase().trim();

    // Single action indicators - these are simple tasks
    const simplePatterns = [
        /^open\s+/,           // "Open Spotify"
        /^search\s+/,         // "Search for..."
        /^play\s+/,           // "Play some music"
        /^show\s+/,          // "Show me..."
        /^find\s+/,          // "Find the file"
        /^go\s+to\s+/,       // "Go to google.com"
        /^click\s+/,         // "Click the button"
        /^type\s+/,          // "Type this text"
        /^write\s+.*to\s+/,  // "Write hello to file.txt"
        /^read\s+/,          // "Read the file"
        /^what\s+is\s+/,     // "What is the weather"
        /^how\s+do\s+/,      // "How do I..."
        /^tell\s+me\s+/,     // "Tell me about..."
        /^create\s+a\s+/,    // "Create a new file"
        /^make\s+a\s+/,      // "Make a note"
        /^check\s+/,         // "Check my email"
        /^send\s+/,          // "Send a message"
    ];

    // Check for simple patterns
    for (const pattern of simplePatterns) {
        if (pattern.test(lower)) return true;
    }

    // Check for question marks - typically simple queries
    if (lower.endsWith('?') && lower.split(' ').length < 10) return true;

    // Check for single sentence without compound conjunctions
    const words = lower.split(/\s+/);
    if (words.length <= 8 && !lower.includes(' and ') && !lower.includes(' then ')) {
        return true;
    }

    return false;
}

// ── Fast Fallback Step Generation (No AI needed) ─────────────────────────

function generateSimpleSteps(userInput: string): TaskStep[] {
    const lower = userInput.toLowerCase();

    // Web search tasks
    if (lower.includes('search') || lower.includes('find') || lower.includes('look up') || lower.includes('research')) {
        return [{
            id: 'step_1',
            description: `Search the web for: ${userInput}`,
            tool: 'web_search',
            dependsOn: [],
            canParallelize: false,
            estimatedComplexity: 'low',
            priority: 'normal'
        }];
    }

    // Computer use tasks
    if (lower.includes('open') || lower.includes('click') || lower.includes('type') || lower.includes('browse')) {
        return [{
            id: 'step_1',
            description: `Perform desktop automation: ${userInput}`,
            tool: 'computer_use',
            dependsOn: [],
            canParallelize: false,
            estimatedComplexity: 'medium',
            priority: 'normal'
        }];
    }

    // File operations
    if (lower.includes('read') || lower.includes('write') || lower.includes('create') || lower.includes('delete')) {
        return [{
            id: 'step_1',
            description: `Handle file operation: ${userInput}`,
            tool: 'file_read',
            dependsOn: [],
            canParallelize: false,
            estimatedComplexity: 'low',
            priority: 'normal'
        }];
    }

    // Default - single step
    return [{
        id: 'step_1',
        description: userInput.length > 100 ? userInput.substring(0, 100) + '...' : userInput,
        tool: 'internal',
        dependsOn: [],
        canParallelize: false,
        estimatedComplexity: 'medium',
        priority: 'normal'
    }];
}

// ── AI-powered Task Analysis ──────────────────────────────────────────────

async function analyzeTaskWithAI(userInput: string, client: AIClient): Promise<TaskAnalysis> {
    // For simple tasks, return simple analysis immediately
    if (isSimpleTask(userInput)) {
        return {
            complexity: 'simple',
            taskType: 'task',
            entities: [],
            canParallelize: false,
            suggestedApproach: 'sequential',
            estimatedSteps: 1,
            requiresExternalData: false,
            requiresFileOps: false,
            requiresCommandExecution: false
        };
    }

    const prompt = `Analyze this user request and respond with ONLY valid JSON (no markdown, no explanation):

{"complexity":"simple|moderate|complex","taskType":"coding|research|build|fix|analyze|automate|task|conversation","entities":["subject1"],"canParallelize":true|false,"suggestedApproach":"sequential|parallel|hybrid","estimatedSteps":1-10,"requiresExternalData":true|false,"requiresFileOps":true|false,"requiresCommandExecution":true|false}

User request: "${userInput.slice(0, 500)}"

Respond with ONLY the JSON object, nothing else.`;

    try {
        const response = await client.chat({
            messages: [{ role: 'user', content: prompt }],
            temperature: 0,
            maxTokens: 300,
        }) as any;

        const rawContent = (typeof response.content === 'string' ? response.content : JSON.stringify(response.content || '')).trim();

        // Direct parse - expect clean JSON from prompt
        const firstBrace = rawContent.indexOf('{');
        const lastBrace = rawContent.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace >= firstBrace) {
            const jsonStr = rawContent.substring(firstBrace, lastBrace + 1);
            const parsed = JSON.parse(jsonStr);
            return {
                complexity: parsed.complexity || 'moderate',
                taskType: parsed.taskType || 'task',
                entities: parsed.entities || [],
                canParallelize: !!parsed.canParallelize,
                suggestedApproach: parsed.suggestedApproach || 'sequential',
                estimatedSteps: parsed.estimatedSteps || 3,
                requiresExternalData: !!parsed.requiresExternalData,
                requiresFileOps: !!parsed.requiresFileOps,
                requiresCommandExecution: !!parsed.requiresCommandExecution
            };
        }

        throw new Error('No JSON found in response');
    } catch (err) {
        console.warn(`[TaskDecomposer] analyzeTaskWithAI failed: ${err instanceof Error ? err.message : String(err)}`);
        // Fallback to moderate for ambiguous cases
        return {
            complexity: 'moderate',
            taskType: 'task',
            entities: [],
            canParallelize: false,
            suggestedApproach: 'sequential',
            estimatedSteps: 2,
            requiresExternalData: true,
            requiresFileOps: true,
            requiresCommandExecution: false
        };
    }
}

// ── AI-powered Step Generation ────────────────────────────────────────────

async function generateStepsWithAI(userInput: string, analysis: TaskAnalysis, availableTools: string[], client: AIClient): Promise<TaskStep[]> {
    // For simple tasks, skip AI and generate directly
    if (analysis.complexity === 'simple') {
        return generateSimpleSteps(userInput);
    }

    const toolList = availableTools.length > 0 ? availableTools.join(', ') : 'web_search, file_read, terminal_execute, computer_use';

    const prompt = `Decompose this task into execution steps. Respond with ONLY a JSON array, nothing else:

[
  {"id":"step_1","description":"...","tool":"tool_name","dependsOn":[],"canParallelize":false,"estimatedComplexity":"low|medium|high","priority":"normal|critical"},
  {"id":"step_2","description":"...","tool":"tool_name","dependsOn":["step_1"],"canParallelize":false,"estimatedComplexity":"medium","priority":"normal"}
]

Task: "${userInput.slice(0, 500)}"
Task Type: ${analysis.taskType}
Approach: ${analysis.suggestedApproach}
Available Tools: ${toolList}

Respond with ONLY the JSON array, no markdown, no explanation.`;

    try {
        const response = await client.chat({
            messages: [{ role: 'user', content: prompt }],
            temperature: 0,
            maxTokens: 1500,
        }) as any;

        const rawContent = (typeof response.content === 'string' ? response.content : JSON.stringify(response.content || '')).trim();

        // Direct extraction
        const firstBracket = rawContent.indexOf('[');
        const lastBracket = rawContent.lastIndexOf(']');
        if (firstBracket !== -1 && lastBracket !== -1 && lastBracket >= firstBracket) {
            const jsonStr = rawContent.substring(firstBracket, lastBracket + 1);
            const steps = JSON.parse(jsonStr);
            if (Array.isArray(steps) && steps.length > 0) {
                return steps;
            }
        }

        throw new Error('No valid JSON array found');
    } catch (err) {
        console.warn(`[TaskDecomposer] generateStepsWithAI failed: ${err instanceof Error ? err.message : String(err)}`);
        // Fallback to simple steps
        return generateSimpleSteps(userInput);
    }
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * AI-powered decomposition with simple task detection.
 * Simple tasks skip AI decomposition and use fast fallback.
 */
export async function decomposeTaskWithAI(
    userInput: string,
    availableTools: string[],
    client?: AIClient
): Promise<DecomposedTask> {
    // Fast path for simple tasks - no AI needed
    if (isSimpleTask(userInput)) {
        console.log('[TaskDecomposer] Simple task detected - using fast fallback');
        const steps = generateSimpleSteps(userInput);
        return {
            id: `task_${Date.now()}`,
            title: userInput.substring(0, 80) + (userInput.length > 80 ? '...' : ''),
            steps,
            canParallelize: false,
            estimatedParallelGroups: 0,
            totalSteps: 1,
            executionMode: 'sequential',
            estimatedDurationMs: 5000,
        };
    }

    if (!client) {
        throw new Error('TaskDecomposer requires an AI client for complex task decomposition.');
    }

    const analysis = await analyzeTaskWithAI(userInput, client);

    // Double-check after analysis - if AI says simple, use fallback
    if (analysis.complexity === 'simple') {
        console.log('[TaskDecomposer] AI classified as simple - using fast fallback');
        const steps = generateSimpleSteps(userInput);
        return {
            id: `task_${Date.now()}`,
            title: userInput.substring(0, 80) + (userInput.length > 80 ? '...' : ''),
            steps,
            canParallelize: false,
            estimatedParallelGroups: 0,
            totalSteps: 1,
            executionMode: 'sequential',
            estimatedDurationMs: 5000,
        };
    }

    const steps = await generateStepsWithAI(userInput, analysis, availableTools, client);

    const groups = new Set(
        steps.filter(s => s.parallelGroup !== undefined).map(s => s.parallelGroup)
    );

    return {
        id: `task_${Date.now()}`,
        title: userInput.substring(0, 80) + (userInput.length > 80 ? '...' : ''),
        steps,
        canParallelize: analysis.canParallelize,
        estimatedParallelGroups: groups.size,
        totalSteps: steps.length,
        executionMode: analysis.suggestedApproach,
        estimatedDurationMs: steps.length * 5000,
    };
}

/**
 * Synchronous fallback (DEPRECATED).
 */
export function decomposeTask(userInput: string, availableTools: string[]): DecomposedTask {
    const steps = generateSimpleSteps(userInput);
    return {
        id: `task_${Date.now()}`,
        title: userInput.substring(0, 80) + (userInput.length > 80 ? '...' : ''),
        steps,
        canParallelize: false,
        estimatedParallelGroups: 0,
        totalSteps: 1,
        executionMode: 'sequential',
        estimatedDurationMs: 5000,
    };
}

export function analyzeTask(userInput: string): TaskAnalysis {
    if (isSimpleTask(userInput)) {
        return {
            complexity: 'simple',
            taskType: 'task',
            entities: [],
            canParallelize: false,
            suggestedApproach: 'sequential',
            estimatedSteps: 1,
            requiresExternalData: false,
            requiresFileOps: false,
            requiresCommandExecution: false
        };
    }
    return {
        complexity: 'moderate',
        taskType: 'task',
        entities: [],
        canParallelize: false,
        suggestedApproach: 'sequential',
        estimatedSteps: 2,
        requiresExternalData: true,
        requiresFileOps: true,
        requiresCommandExecution: false
    };
}

// ── Plan Text Generator ───────────────────────────────────────────────────

export function generatePlanText(decomposed: DecomposedTask): string {
    const lines: string[] = [];

    const duration = (decomposed.estimatedDurationMs || 0) < 60_000
        ? `~${Math.round((decomposed.estimatedDurationMs || 0) / 1000)}s`
        : `~${Math.round((decomposed.estimatedDurationMs || 0) / 60_000)}m`;

    lines.push(`# Execution Plan: ${decomposed.title}`);
    lines.push('');
    lines.push(`| Property | Value |`);
    lines.push(`|----------|-------|`);
    lines.push(`| Strategy | ${decomposed.executionMode.charAt(0).toUpperCase() + decomposed.executionMode.slice(1)} Execution |`);
    lines.push(`| Steps | ${decomposed.totalSteps} |`);
    if ((decomposed.estimatedParallelGroups || 0) > 0) {
        lines.push(`| Parallel Groups | ${decomposed.estimatedParallelGroups} |`);
    }
    lines.push(`| Est. Duration | ${duration} |`);
    lines.push('');
    lines.push('## Steps');
    lines.push('');

    const grouped = new Map<number | string, TaskStep[]>();
    for (const step of decomposed.steps) {
        const key: number | string = step.parallelGroup !== undefined
            ? step.parallelGroup
            : `seq_${step.id}`;
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key)!.push(step);
    }

    for (const [key, group] of grouped) {
        const isParallelGroup = typeof key === 'number';
        if (isParallelGroup && group.length > 1) {
            lines.push(`### ⚡ Parallel Group ${key}`);
            for (const step of group) {
                lines.push(`- **${step.id}** ${step.description} (\`${step.tool || 'internal'}\`)`);
            }
        } else {
            for (const step of group) {
                const badge = step.priority === 'critical' ? ' 🔴' : '';
                const deps  = (step.dependsOn || []).length > 0
                    ? ` → depends: ${(step.dependsOn || []).join(', ')}`
                    : '';
                lines.push(`### ${step.id}: ${step.description}${badge}`);
                lines.push(`**Tool:** \`${step.tool || 'none'}\` | **Complexity:** ${step.estimatedComplexity || 'moderate'}${deps}`);
                lines.push('');
            }
        }
        lines.push('');
    }

    return lines.join('\n');
}

export function getAGIHints(userInput: string): string {
    return "AI-Optimized Execution Plan active.";
}
