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

// ── Robust JSON Extraction Helpers ───────────────────────────────────────

/**
 * Strips common LLM wrappers from response text:
 * - <thinking>...</thinking> blocks (Claude extended thinking)
 * - markdown code fences (```json ... ```)
 * - plain backtick fences (``` ... ```)
 */
function stripLLMWrappers(raw: string): string {
    let text = raw.trim();

    // Remove <thinking>...</thinking> (Claude extended thinking mode)
    text = text.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '').trim();

    // Remove markdown json code fence: ```json ... ``` or ``` ... ```
    const jsonFenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (jsonFenceMatch) {
        return jsonFenceMatch[1].trim();
    }

    return text;
}

/**
 * Repairs common LLM JSON formatting errors and parses the JSON string.
 */
function repairAndParseJSON(str: string): any {
    // 1. Direct parse attempt
    try {
        return JSON.parse(str);
    } catch {
        // Continue to repair attempts
    }

    // 2. Pre-process common LLM JSON syntax errors:
    let repaired = str
        // Fix missing commas between properties on separate lines
        .replace(/([}\]"\d]|true|false|null)\s*[\r\n]+\s*("[a-zA-Z0-9_]+"\s*:)/g, '$1,\n$2')
        // Fix missing commas between array elements/objects on separate lines
        .replace(/([}\]"\d]|true|false|null)\s*[\r\n]+\s*(\{)/g, '$1,\n$2')
        // Fix trailing commas before closing braces/brackets
        .replace(/,\s*([\}\]])/g, '$1');

    try {
        return JSON.parse(repaired);
    } catch {
        // Continue to string escaping repair
    }

    // 3. Fix unescaped newlines/tabs inside string values
    try {
        const stringEscaped = repaired.replace(/"([^"\\]*(\\.[^"\\]*)*)"/g, (match) => {
            return match
                .replace(/\n/g, '\\n')
                .replace(/\r/g, '\\r')
                .replace(/\t/g, '\\t');
        });
        return JSON.parse(stringEscaped);
    } catch {
        // Continue to bracket auto-closure
    }

    // 4. Handle truncated JSON (missing closing brackets or braces)
    let openBraces = (repaired.match(/\{/g) || []).length - (repaired.match(/\}/g) || []).length;
    let openBrackets = (repaired.match(/\[/g) || []).length - (repaired.match(/\]/g) || []).length;
    let autoClosed = repaired.trim();
    while (openBrackets > 0) { autoClosed += ']'; openBrackets--; }
    while (openBraces > 0) { autoClosed += '}'; openBraces--; }
    return JSON.parse(autoClosed);
}

/**
 * Extracts a JSON object { ... } from text robustly.
 */
function extractJSONObject(text: string): string | null {
    const cleaned = stripLLMWrappers(text);
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace >= firstBrace) {
        return cleaned.substring(firstBrace, lastBrace + 1);
    }
    return null;
}

/**
 * Extracts a JSON array [ ... ] from text robustly.
 * Strategy 1: Try in fence-stripped text.
 * Strategy 2: Fall back to raw bracket scan (handles prose-wrapped output).
 */
function extractJSONArray(text: string): string | null {
    const cleaned = stripLLMWrappers(text);

    // Strategy 1: Try to find array in fence-stripped text
    const firstBracket = cleaned.indexOf('[');
    const lastBracket = cleaned.lastIndexOf(']');
    if (firstBracket !== -1 && lastBracket !== -1 && lastBracket >= firstBracket) {
        const candidate = cleaned.substring(firstBracket, lastBracket + 1);
        try {
            const parsed = JSON.parse(candidate);
            if (Array.isArray(parsed)) return candidate;
        } catch {
            // fall through to strategy 2
        }
    }

    // Strategy 2: Scan raw text for array (covers surrounding prose edge cases)
    const rawFirstBracket = text.indexOf('[');
    const rawLastBracket = text.lastIndexOf(']');
    if (rawFirstBracket !== -1 && rawLastBracket !== -1 && rawLastBracket >= rawFirstBracket) {
        return text.substring(rawFirstBracket, rawLastBracket + 1);
    }

    return null;
}

// ── AI-powered Unified Decomposition ─────────────────────────────────────


async function decomposeWithAIUnified(userInput: string, availableTools: string[], client: AIClient, strategyContext?: string): Promise<{ analysis: TaskAnalysis; steps: TaskStep[] }> {
    const toolList = availableTools.length > 0 ? availableTools.join(', ') : 'web_search, file_read, terminal_execute, computer_use';

    const prompt = `Analyze and decompose this task for direct handoff to the Coding Specialist or the relevant specialist agent. Respond with ONLY valid JSON in this exact format:
{
  "analysis": {
    "complexity": "simple|moderate|complex",
    "taskType": "coding|research|build|fix|analyze|automate|task",
    "suggestedApproach": "sequential|parallel|hybrid",
    "canParallelize": true
  },
  "steps": [
    {"id":"step_1","title":"Title","description":"...","tool":"tool_name","dependsOn":[],"canParallelize":false,"parallelGroup":1,"agentPrompt":"Specific execution guidance for the specialist or worker."}
  ]
}

Task: "${userInput.slice(0, 500)}"
Tools: ${toolList}${strategyContext ? strategyContext : ''}

COMPUTER USE & MULTI-STEP ROUTING RULES:
- If a task is a simple desktop action (e.g., "open Spotify", "play music", "open a specific app"), output a SINGLE step using the "computer_use" tool.
- If a task involves multiple distinct objectives, sequential workflows, or mixed activities (e.g., "open VS Code, build a tic-tac-toe app, and test it", or "open browser, download a file, and edit it in editor"), DO NOT collapse it into a single computer_use step. Instead, break it down into multiple logical steps.
- Use "computer_use" specifically for GUI-level actions (e.g., opening a specific application, clicking around, or UI inspection), and appropriate developer tools (like file edit/write, terminal execute, etc.) for coding, building, testing, or running commands.

WEB / BOOKING ROUTING RULES:
- Browser-based tasks are research, not desktop automation. This includes opening booking platforms, pulling live prices, comparing flights/hotels/tickets/listings, Gmail/webmail, Google Docs/Drive, SaaS dashboards, website forms, checkout, reservations, and any URL/browser tab workflow.
- For browser-based tasks, use "web_search" for discovery and "navis" for opening pages, filling forms, extracting live prices, booking flows, and login/session-dependent work.
- NEVER output "computer_use" for websites, browser tabs, booking platforms, live web prices, forms, listings, Gmail/webmail, or any other web app. Even if the user says "open" or "go book", the correct tool is "navis".

CODING TASK RULES:
- If taskType is coding/build/fix, write steps as a practical handoff to the Coding Specialist.
- Include exact target-root reasoning if the user names Downloads/Desktop/Documents/C:\\ paths.
- Prefer steps that map to: inspect/resolve target, scaffold/edit, implement feature lanes, validate/repair.
- Use "agentPrompt" to tell the Coding Specialist exactly what to do in that step.
- Mark independent feature lanes with canParallelize=true and the same parallelGroup so the Coding Specialist can spawn workers.
- Do not add approval/doc-writing steps unless the user explicitly asked for specs or documentation.

Respond with ONLY the JSON object.`;

    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            const response = await client.chat({
                messages: [{ role: 'user', content: prompt }],
                temperature: attempt === 1 ? 0 : 0.1,
                maxTokens: 2000,
            }) as any;

            const rawContent = (typeof response.content === 'string' ? response.content : JSON.stringify(response.content || '')).trim();
            const jsonStr = extractJSONObject(rawContent);

            if (jsonStr) {
                const parsed = repairAndParseJSON(jsonStr);
                return {
                    analysis: {
                        complexity: parsed.analysis?.complexity || 'moderate',
                        taskType: parsed.analysis?.taskType || 'task',
                        entities: [],
                        canParallelize: !!parsed.analysis?.canParallelize,
                        suggestedApproach: parsed.analysis?.suggestedApproach || 'sequential',
                        estimatedSteps: parsed.steps?.length || 2,
                        requiresExternalData: true,
                        requiresFileOps: true,
                        requiresCommandExecution: false
                    },
                    steps: Array.isArray(parsed.steps) ? parsed.steps : []
                };
            }
        } catch (err) {
            console.warn(`[TaskDecomposer] decomposeWithAIUnified attempt ${attempt} failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    return {
        analysis: { complexity: 'moderate', taskType: 'task', entities: [], canParallelize: false, suggestedApproach: 'sequential', estimatedSteps: 1, requiresExternalData: true, requiresFileOps: true, requiresCommandExecution: false },
        steps: [{ id: 'step_1', title: 'Execute', description: userInput, tool: 'internal', dependsOn: [], canParallelize: false, estimatedComplexity: 'medium', priority: 'normal' }]
    };
}


/**
 * AI-powered decomposition with unified single-call optimization.
 */
export async function decomposeTaskWithAI(
    userInput: string,
    availableTools: string[],
    client?: AIClient,
    strategyContext?: string
): Promise<DecomposedTask> {


    if (!client) {
        throw new Error('TaskDecomposer requires an AI client for task decomposition.');
    }

    // Unified call: analysis + steps in ONE round-trip (2x faster than sequential calls)
    const { analysis, steps } = await decomposeWithAIUnified(userInput, availableTools, client, strategyContext);

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
    const steps = [{
        id: 'step_1',
        title: 'Execute Request',
        description: userInput,
        tool: 'internal',
        dependsOn: [],
        canParallelize: false,
        estimatedComplexity: 'medium',
        priority: 'normal'
    }];
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
