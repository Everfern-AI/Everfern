"use strict";
/**
 * EverFern Desktop — NEXUS Task Decomposer v5 (Simple Task Skip + Robust JSON)
 *
 * Intelligently decomposes complex tasks into dependency-aware, parallelizable subtasks.
 * Skips AI decomposition for simple tasks (single-step requests).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.decomposeTaskWithAI = decomposeTaskWithAI;
exports.decomposeTask = decomposeTask;
exports.analyzeTask = analyzeTask;
exports.generatePlanText = generatePlanText;
exports.getAGIHints = getAGIHints;
// ── Robust JSON Extraction Helpers ───────────────────────────────────────
/**
 * Strips common LLM wrappers from response text:
 * - <thinking>...</thinking> blocks (Claude extended thinking)
 * - markdown code fences (```json ... ```)
 * - plain backtick fences (``` ... ```)
 */
function stripLLMWrappers(raw) {
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
function extractJSONObject(text) {
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
function extractJSONArray(text) {
    const cleaned = stripLLMWrappers(text);
    // Strategy 1: Try to find array in fence-stripped text
    const firstBracket = cleaned.indexOf('[');
    const lastBracket = cleaned.lastIndexOf(']');
    if (firstBracket !== -1 && lastBracket !== -1 && lastBracket >= firstBracket) {
        const candidate = cleaned.substring(firstBracket, lastBracket + 1);
        try {
            const parsed = JSON.parse(candidate);
            if (Array.isArray(parsed))
                return candidate;
        }
        catch {
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
async function decomposeWithAIUnified(userInput, availableTools, client) {
    const toolList = availableTools.length > 0 ? availableTools.join(', ') : 'web_search, file_read, terminal_execute, computer_use';
    const prompt = `Analyze and decompose this task. Respond with ONLY valid JSON in this exact format:
{
  "analysis": {
    "complexity": "simple|moderate|complex",
    "taskType": "coding|research|build|fix|analyze|automate|task",
    "suggestedApproach": "sequential|parallel|hybrid",
    "canParallelize": true
  },
  "steps": [
    {"id":"step_1","title":"Title","description":"...","tool":"tool_name","dependsOn":[]}
  ]
}

Task: "${userInput.slice(0, 500)}"
Tools: ${toolList}

IMPORTANT: If the task requires "computer_use" (like clicking on the OS, opening a physical app, moving mouse, typing globally), DO NOT break it down into multiple steps. Output a SINGLE step using the "computer_use" tool with the full original instructions.

Respond with ONLY the JSON object.`;
    try {
        const response = await client.chat({
            messages: [{ role: 'user', content: prompt }],
            temperature: 0,
            maxTokens: 2000,
        });
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
    }
    catch (err) {
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
async function decomposeTaskWithAI(userInput, availableTools, client) {
    if (!client) {
        throw new Error('TaskDecomposer requires an AI client for task decomposition.');
    }
    // Unified call: analysis + steps in ONE round-trip (2x faster than sequential calls)
    const { analysis, steps } = await decomposeWithAIUnified(userInput, availableTools, client);
    const groups = new Set(steps.filter(s => s.parallelGroup !== undefined).map(s => s.parallelGroup));
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
function decomposeTask(userInput, availableTools) {
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
function analyzeTask(userInput) {
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
function generatePlanText(decomposed) {
    const lines = [];
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
    const grouped = new Map();
    for (const step of decomposed.steps) {
        const key = step.parallelGroup !== undefined
            ? step.parallelGroup
            : `seq_${step.id}`;
        if (!grouped.has(key))
            grouped.set(key, []);
        grouped.get(key).push(step);
    }
    for (const [key, group] of grouped) {
        const isParallelGroup = typeof key === 'number';
        if (isParallelGroup && group.length > 1) {
            lines.push(`### ⚡ Parallel Group ${key}`);
            for (const step of group) {
                lines.push(`- **${step.id}** ${step.description} (\`${step.tool || 'internal'}\`)`);
            }
        }
        else {
            for (const step of group) {
                const badge = step.priority === 'critical' ? ' 🔴' : '';
                const deps = (step.dependsOn || []).length > 0
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
function getAGIHints(userInput) {
    return "AI-Optimized Execution Plan active.";
}
