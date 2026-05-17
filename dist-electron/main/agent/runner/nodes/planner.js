"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPlannerNode = void 0;
const task_decomposer_1 = require("../task-decomposer");
const node_utils_1 = require("../services/node-utils");
const messages_1 = require("@langchain/core/messages");
const mission_integrator_1 = require("../mission-integrator");
const triage_1 = require("../triage");
/**
 * AI-based read-only intent detection
 * Replaces keyword-based intent checking with semantic analysis
 */
async function isReadOnlyIntent(intent, client) {
    if (!client) {
        // Fallback: conservative heuristic
        return intent === 'conversation' || intent === 'question';
    }
    try {
        const prompt = `Determine if this intent represents a read-only operation (no system modifications, file changes, or destructive actions).

Intent: "${intent}"

Read-only intents typically include:
- Conversations and greetings
- Questions requiring factual answers
- Information retrieval
- Documentation lookup

Non-read-only intents include:
- Coding (writing/modifying code)
- Building projects
- Fixing bugs (requires code changes)
- Task execution (file operations, commands)
- Automation setup

Respond with JSON:
{
  "isReadOnly": true/false,
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation"
}`;
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('isReadOnlyIntent timed out')), 10000));
        const response = await Promise.race([
            client.chat({
                messages: [{ role: 'user', content: prompt }],
                responseFormat: 'json',
                temperature: 0.1,
                maxTokens: 150
            }),
            timeoutPromise
        ]);
        let content = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
        // Remove markdown code blocks if present
        content = content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
        const analysis = JSON.parse(content);
        return analysis.isReadOnly && analysis.confidence > 0.7;
    }
    catch (err) {
        console.warn('[Planner] AI read-only detection failed:', err);
        // Fallback
        return intent === 'conversation' || intent === 'question';
    }
}
const createPlannerNode = (runner, eventQueue, missionTracker, shouldAbort) => {
    const integrator = (0, mission_integrator_1.createMissionIntegrator)(missionTracker);
    return async (state) => {
        // Check for abort signal before processing
        if (shouldAbort?.()) {
            throw new Error('Execution aborted by user (stop button clicked)');
        }
        integrator.startNode('planner', 'Compiling execution pipeline');
        // Emit phase change event for planning phase
        if (missionTracker) {
            missionTracker.setPhase('planning');
        }
        try {
            const logger = (0, node_utils_1.nodeLifecycle)(runner, 'planner');
            logger.info('Compiling execution pipeline and integrating context hints...');
            if (!state.decomposedTask) {
                logger.warn('Execution plan missing. Proceeding with direct model-driven logic.');
                integrator.completeNode('planner', 'No task decomposition needed');
                return { taskPhase: 'executing' };
            }
            // Fast-path: use synchronous heuristic for unambiguous intents
            const intent = state.currentIntent || 'unknown';
            const NON_READONLY_INTENTS = new Set(['coding', 'fix', 'build', 'task', 'automate', 'research', 'analyze']);
            let isReadOnly;
            if ((0, triage_1.isReadOnlyTask)(intent)) {
                // Definitively read-only (conversation, question) — skip AI call
                isReadOnly = true;
            }
            else if (NON_READONLY_INTENTS.has(intent)) {
                // Definitively non-read-only — skip AI call
                isReadOnly = false;
            }
            else {
                // Ambiguous intent (e.g. 'unknown') — use AI
                isReadOnly = await isReadOnlyIntent(intent, runner.client);
            }
            if (isReadOnly) {
                logger.info('Read-only task detected. Skipping execution pipeline compilation.');
                integrator.completeNode('planner', 'Read-only task identified');
                return {
                    taskPhase: 'executing',
                    messages: [new messages_1.SystemMessage("Proceed with responding to the user's request directly.")]
                };
            }
            const planText = (0, task_decomposer_1.generatePlanText)(state.decomposedTask);
            let agiHints = state.agiHints || '';
            eventQueue?.push({
                type: 'plan_created',
                plan: {
                    id: state.decomposedTask.id,
                    title: state.decomposedTask.title,
                    steps: state.decomposedTask.steps.map((s) => ({
                        id: s.id,
                        title: s.title,
                        description: s.description,
                        tool: s.tool
                    }))
                }
            });
            const systemMessage = `AS AN AGI ORCHESTRATOR, follow this task decomposition plan strictly:\n\n${planText}\n\n${agiHints}\nIMPORTANT: Execute parallel groups using your execution tools concurrently if applicable.`;
            logger.info(`Execution pipeline finalized. System ready for task processing.`);
            const result = {
                taskPhase: 'executing',
                messages: [
                    new messages_1.SystemMessage(systemMessage)
                ]
            };
            integrator.completeNode('planner', 'Execution pipeline compiled');
            return result;
        }
        catch (error) {
            integrator.failNode('planner', error instanceof Error ? error.message : String(error));
            throw error;
        }
    };
};
exports.createPlannerNode = createPlannerNode;
