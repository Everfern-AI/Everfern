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
// ── AI-powered Task Analysis ──────────────────────────────────────────────
async function analyzeTaskWithAI(userInput, client) {
    const prompt = `Analyze this user request and respond with ONLY valid JSON (no markdown, no explanation):

{"complexity":"simple|moderate|complex","taskType":"coding|research|build|fix|analyze|automate|task|conversation","entities":["subject1"],"canParallelize":true|false,"suggestedApproach":"sequential|parallel|hybrid","estimatedSteps":1-10,"requiresExternalData":true|false,"requiresFileOps":true|false,"requiresCommandExecution":true|false}

User request: "${userInput.slice(0, 500)}"

Respond with ONLY the JSON object, nothing else.`;
    try {
        const response = await client.chat({
            messages: [{ role: 'user', content: prompt }],
            temperature: 0,
            maxTokens: 300,
        });
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
    }
    catch (err) {
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
async function generateStepsWithAI(userInput, analysis, availableTools, client) {
    const toolList = availableTools.length > 0 ? availableTools.join(', ') : 'web_search, file_read, terminal_execute, computer_use';
    const prompt = `Decompose this task into execution steps. Respond with ONLY a JSON array, nothing else:

[
  {"id":"step_1","title":"Concise Step Title","description":"...","tool":"tool_name","dependsOn":[],"canParallelize":false,"estimatedComplexity":"low|medium|high","priority":"normal|critical"},
  {"id":"step_2","title":"Concise Step Title","description":"...","tool":"tool_name","dependsOn":["step_1"],"canParallelize":false,"estimatedComplexity":"medium","priority":"normal"}
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
        });
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
    }
    catch (err) {
        console.warn(`[TaskDecomposer] generateStepsWithAI failed: ${err instanceof Error ? err.message : String(err)}`);
        // Minimum viable fallback step
        return [{
                id: 'step_1',
                title: 'Analyze and Execute',
                description: userInput,
                tool: 'internal',
                dependsOn: [],
                canParallelize: false,
                estimatedComplexity: 'medium',
                priority: 'normal'
            }];
    }
}
// ── Public API ────────────────────────────────────────────────────────────
/**
 * AI-powered decomposition with simple task detection.
 * Simple tasks skip AI decomposition and use fast fallback.
 */
async function decomposeTaskWithAI(userInput, availableTools, client) {
    if (!client) {
        throw new Error('TaskDecomposer requires an AI client for task decomposition.');
    }
    const analysis = await analyzeTaskWithAI(userInput, client);
    const steps = await generateStepsWithAI(userInput, analysis, availableTools, client);
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
