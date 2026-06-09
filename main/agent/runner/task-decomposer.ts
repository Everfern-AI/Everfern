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

function createFastCodingProjectPlan(userInput: string): DecomposedTask | null {
    const text = userInput.toLowerCase();
    const isCodingProject = /\b(project|app|website|site|dashboard|clone|scaffold|next\.?js|react app|full[- ]stack|frontend|backend|build (?:a|an|the)|make (?:a|an|the)|create (?:a|an|the))\b/.test(text);
    const isCodingIntent = /\b(code|coding|implement|build|make|create|scaffold|fix|next\.?js|react|typescript|javascript|app|website|site)\b/.test(text);

    if (!isCodingProject || !isCodingIntent) {
        return null;
    }

    const isFrontend = /\b(frontend|ui|website|site|dashboard|next\.?js|react|tailwind|html|css|app)\b/.test(text);
    const steps: TaskStep[] = [
        {
            id: 'step_1',
            title: 'Resolve target and inspect',
            description: 'Resolve the exact Windows host target folder and inspect only the files needed before writing.',
            tool: 'ls',
            dependsOn: [],
            canParallelize: false,
            agentPrompt: 'Resolve the exact Windows host target root from the user request. If the project folder does not exist, create it. Inspect only the minimum needed files before scaffolding.',
            estimatedComplexity: 'simple',
            priority: 'normal'
        },
        {
            id: 'step_2',
            title: 'Scaffold project',
            description: 'Create or scaffold the requested project in the target folder on the main Windows host.',
            tool: 'executePwsh',
            dependsOn: ['step_1'],
            canParallelize: false,
            agentPrompt: 'Scaffold the requested project in the resolved host target root. Prefer create-next-app for Next.js. If scaffolding fails twice or becomes interactive/slow, manually create a minimal working project.',
            estimatedComplexity: 'moderate',
            priority: 'normal'
        },
        {
            id: 'step_3',
            title: isFrontend ? 'Implement polished frontend' : 'Implement core code',
            description: isFrontend
                ? 'Build the actual usable frontend experience with responsive layout, real content, and polished states.'
                : 'Implement the requested code/features using the project conventions.',
            tool: 'write',
            dependsOn: ['step_2'],
            canParallelize: false,
            agentPrompt: isFrontend
                ? 'Implement the actual polished frontend experience. Use real content, responsive layout, complete controls/states, and avoid placeholder-only screens.'
                : 'Implement the requested functionality using the scaffolded project conventions. Keep edits focused and coherent.',
            estimatedComplexity: 'complex',
            priority: 'normal'
        },
        {
            id: 'step_4',
            title: 'Validate and repair',
            description: 'Run the relevant build/lint/test command from the target root, then fix any errors before finalizing.',
            tool: 'executePwsh',
            dependsOn: ['step_3'],
            canParallelize: false,
            agentPrompt: 'Run validation from the target root. Fix any build, lint, type, or runtime errors before reporting success.',
            estimatedComplexity: 'moderate',
            priority: 'critical'
        }
    ];

    return {
        id: `task_${Date.now()}`,
        title: userInput.substring(0, 80) + (userInput.length > 80 ? '...' : ''),
        steps,
        canParallelize: false,
        estimatedParallelGroups: 0,
        totalSteps: steps.length,
        executionMode: 'sequential',
        estimatedDurationMs: 20000,
    };
}

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

IMPORTANT: If the task requires "computer_use" (like clicking on the OS, opening a physical app, moving mouse, typing globally), DO NOT break it down into multiple steps. Output a SINGLE step using the "computer_use" tool with the full original instructions.

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

    try {
        const response = await client.chat({
            messages: [{ role: 'user', content: prompt }],
            temperature: 0,
            maxTokens: 2000,
        }) as any;

        const rawContent = (typeof response.content === 'string' ? response.content : JSON.stringify(response.content || '')).trim();
        const jsonStr = extractJSONObject(rawContent);
        
        if (jsonStr) {
            const parsed = JSON.parse(jsonStr);
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
        throw new Error('No JSON object found');
    } catch (err) {
        console.warn(`[TaskDecomposer] decomposeWithAIUnified failed: ${err instanceof Error ? err.message : String(err)}`);
        return {
            analysis: { complexity: 'moderate', taskType: 'task', entities: [], canParallelize: false, suggestedApproach: 'sequential', estimatedSteps: 1, requiresExternalData: true, requiresFileOps: true, requiresCommandExecution: false },
            steps: [{ id: 'step_1', title: 'Execute', description: userInput, tool: 'internal', dependsOn: [], canParallelize: false, estimatedComplexity: 'medium', priority: 'normal' }]
        };
    }
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
    if (!strategyContext) {
        const fastPlan = createFastCodingProjectPlan(userInput);
        if (fastPlan) {
            console.log('[TaskDecomposer] Fast local coding project decomposition selected');
            return fastPlan;
        }
    }

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
