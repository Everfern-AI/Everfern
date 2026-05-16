"use strict";
/**
 * EverFern Desktop — NEXUS Task Decomposer v4 (Full AI Edition)
 *
 * Intelligently decomposes complex tasks into dependency-aware, parallelizable subtasks.
 * This version relies entirely on AI for classification, structural analysis, and step generation,
 * removing all regex-based heuristics and keyword signals.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.decomposeTaskWithAI = decomposeTaskWithAI;
exports.decomposeTask = decomposeTask;
exports.analyzeTask = analyzeTask;
exports.generatePlanText = generatePlanText;
exports.getAGIHints = getAGIHints;
// ── AI-powered Task Analysis ────────────────────────────────────────────
async function analyzeTaskWithAI(userInput, client) {
    const prompt = `Analyze the following user request and determine its structural requirements for execution.

USER REQUEST: "${userInput.slice(0, 1000)}"

Respond ONLY with a JSON block like this:
{
  "complexity": "simple" | "moderate" | "complex",
  "taskType": "coding" | "research" | "build" | "fix" | "analyze" | "automate" | "task" | "conversation",
  "entities": ["list", "of", "key", "subjects"],
  "canParallelize": boolean,
  "suggestedApproach": "sequential" | "parallel" | "hybrid",
  "estimatedSteps": number,
  "requiresExternalData": boolean,
  "requiresFileOps": boolean,
  "requiresCommandExecution": boolean
}`;
    let rawContent = '';
    try {
        const response = await client.chat({
            messages: [{ role: 'user', content: prompt }],
            temperature: 0,
            maxTokens: 500,
        });
        rawContent = (typeof response.content === 'string' ? response.content : JSON.stringify(response.content || '')).trim();
        if (!rawContent || rawContent === '""' || rawContent === 'null') {
            throw new Error('AI returned empty content');
        }
        // Clean up markdown code blocks and log prefixes
        let cleanedContent = rawContent
            .replace(/```json\s*/g, '')
            .replace(/```\s*/g, '')
            .replace(/\[1\]\s*/g, '') // Remove [1] log prefixes
            .replace(/\[\d+\]\s*/g, '') // Remove any [N] log prefixes
            .trim();
        // Extremely robust JSON extraction: find the first '{' and last '}'
        const firstBrace = cleanedContent.indexOf('{');
        const lastBrace = cleanedContent.lastIndexOf('}');
        if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
            throw new Error('No JSON object found in response');
        }
        const jsonStr = cleanedContent.substring(firstBrace, lastBrace + 1);
        const parsed = JSON.parse(jsonStr);
        // Ensure critical fields exist
        return {
            complexity: parsed.complexity || 'moderate',
            taskType: parsed.taskType || 'task',
            entities: parsed.entities || [],
            canParallelize: !!parsed.canParallelize,
            suggestedApproach: parsed.suggestedApproach || 'sequential',
            estimatedSteps: parsed.estimatedSteps || 3,
            requiresExternalData: parsed.requiresExternalData !== undefined ? !!parsed.requiresExternalData : true,
            requiresFileOps: parsed.requiresFileOps !== undefined ? !!parsed.requiresFileOps : true,
            requiresCommandExecution: parsed.requiresCommandExecution !== undefined ? !!parsed.requiresCommandExecution : true
        };
    }
    catch (err) {
        console.warn(`[TaskDecomposer] analyzeTaskWithAI failed. Raw snippet: "${rawContent.substring(0, 200)}". Error: ${err instanceof Error ? err.message : String(err)}`);
        return {
            complexity: 'moderate',
            taskType: 'task',
            entities: [],
            canParallelize: false,
            suggestedApproach: 'sequential',
            estimatedSteps: 2,
            requiresExternalData: true,
            requiresFileOps: true,
            requiresCommandExecution: true
        };
    }
}
// ── AI-powered Step Generation ──────────────────────────────────────────
async function generateStepsWithAI(userInput, analysis, availableTools, client) {
    const prompt = `Decompose the following task into a list of dependency-aware execution steps.

USER REQUEST: "${userInput.slice(0, 1000)}"
TASK TYPE: ${analysis.taskType}
APPROACH: ${analysis.suggestedApproach}
AVAILABLE TOOLS: ${availableTools.join(', ')}

Respond ONLY with a JSON array of steps:
[
  {
    "id": "step_1",
    "description": "...",
    "tool": "...",
    "dependsOn": [],
    "canParallelize": boolean,
    "estimatedComplexity": "low" | "medium" | "high",
    "priority": "normal" | "critical"
  }
]`;
    let rawContent = '';
    try {
        const response = await client.chat({
            messages: [{ role: 'user', content: prompt }],
            temperature: 0,
            maxTokens: 2000,
        });
        rawContent = (typeof response.content === 'string' ? response.content : JSON.stringify(response.content || '')).trim();
        if (!rawContent || rawContent === '""' || rawContent === 'null') {
            throw new Error('AI returned empty content');
        }
        // Clean up markdown code blocks and log prefixes
        let cleanedContent = rawContent
            .replace(/```json\s*/g, '')
            .replace(/```\s*/g, '')
            .replace(/\[1\]\s*/g, '') // Remove [1] log prefixes
            .replace(/\[\d+\]\s*/g, '') // Remove any [N] log prefixes
            .trim();
        // Robust JSON array extraction: find first '[' and last ']'
        const firstBracket = cleanedContent.indexOf('[');
        const lastBracket = cleanedContent.lastIndexOf(']');
        if (firstBracket === -1 || lastBracket === -1 || lastBracket <= firstBracket) {
            throw new Error('No JSON array found in response');
        }
        const jsonStr = cleanedContent.substring(firstBracket, lastBracket + 1);
        const steps = JSON.parse(jsonStr);
        if (!Array.isArray(steps) || steps.length === 0)
            throw new Error('Invalid or empty steps array');
        return steps;
    }
    catch (err) {
        console.warn(`[TaskDecomposer] generateStepsWithAI failed. Raw snippet: "${rawContent.substring(0, 200)}". Error: ${err instanceof Error ? err.message : String(err)}`);
        const fallbackSteps = [];
        // Sequential fallback plan based on user intent keywords if AI failed
        const lowerInput = userInput.toLowerCase();
        if (analysis.requiresExternalData || lowerInput.includes('search') || lowerInput.includes('find') || lowerInput.includes('look up')) {
            fallbackSteps.push({
                id: 'step_1',
                description: 'Search web for relevant information',
                tool: 'web_search',
                dependsOn: [],
                canParallelize: true,
                estimatedComplexity: 'low',
                priority: 'critical'
            });
        }
        fallbackSteps.push({
            id: `step_${fallbackSteps.length + 1}`,
            description: 'Process user request and execute findings',
            tool: analysis.taskType === 'coding' ? 'view_file' : 'internal',
            dependsOn: fallbackSteps.map(s => s.id),
            canParallelize: false,
            estimatedComplexity: 'medium',
            priority: 'normal'
        });
        return fallbackSteps;
    }
}
// ── Public API ────────────────────────────────────────────────────────────
/**
 * AI-powered decomposition. Uses the model to classify, analyze, and build
 * the execution plan. Removes all regex-based heuristics.
 */
async function decomposeTaskWithAI(userInput, availableTools, client) {
    if (!client) {
        throw new Error('TaskDecomposer v4 requires an AI client for decomposition.');
    }
    const analysis = await analyzeTaskWithAI(userInput, client);
    const steps = await generateStepsWithAI(userInput, analysis, availableTools, client);
    const groups = new Set(steps.filter(s => s.parallelGroup !== undefined).map(s => s.parallelGroup));
    // Calculate duration based on a simple heuristic (could also be AI-estimated)
    const estimatedDurationMs = steps.length * 5000;
    return {
        id: `task_${Date.now()}`,
        title: userInput.substring(0, 80) + (userInput.length > 80 ? '...' : ''),
        steps,
        canParallelize: analysis.canParallelize,
        estimatedParallelGroups: groups.size,
        totalSteps: steps.length,
        executionMode: analysis.suggestedApproach,
        estimatedDurationMs,
    };
}
/**
 * Synchronous fallback (DEPRECATED).
 * Now throws error as v4 is fully AI-driven.
 */
function decomposeTask(userInput, availableTools) {
    throw new Error('decomposeTask (sync) is deprecated. Use decomposeTaskWithAI.');
}
function analyzeTask(userInput) {
    throw new Error('analyzeTask (sync) is deprecated. Use analyzeTaskWithAI (async).');
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
