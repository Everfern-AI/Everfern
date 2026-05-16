"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDataAnalystNode = void 0;
const agent_runtime_1 = require("../services/agent-runtime");
const mission_integrator_1 = require("../mission-integrator");
const sessions_1 = require("../../sessions");
const planner_1 = require("../../tools/planner");
const prompt_sync_1 = require("../../../lib/prompt-sync");
function createProgressStreamer(eventQueue) {
    let totalSteps = 0;
    let completedSteps = 0;
    return {
        emitStart(agentName) {
            eventQueue?.push({
                type: 'thought',
                content: `\n📊 ${agentName}: Initializing analysis...`
            });
        },
        emitProgress(message, percentage) {
            const progressText = percentage !== undefined
                ? `[${percentage}%] ${message}`
                : message;
            eventQueue?.push({
                type: 'thought',
                content: `\n📊 ${progressText}`
            });
        },
        emitStepComplete(stepName, durationMs) {
            const durationSec = (durationMs / 1000).toFixed(2);
            eventQueue?.push({
                type: 'thought',
                content: `\n✅ ${stepName} completed in ${durationSec}s`
            });
        },
        emitError(error, diagnostics) {
            eventQueue?.push({
                type: 'thought',
                content: `\n❌ Error: ${error.message}\n${diagnostics}`
            });
        },
        setTotalSteps(total) {
            totalSteps = total;
            completedSteps = 0;
        },
        incrementCompletedSteps() {
            completedSteps++;
        },
        getPercentage() {
            if (totalSteps === 0)
                return 0;
            return Math.round((completedSteps / totalSteps) * 100);
        }
    };
}
const createDataAnalystNode = (runner, eventQueue, missionTracker, toolDefs) => {
    const integrator = (0, mission_integrator_1.createMissionIntegrator)(missionTracker);
    const progressStreamer = createProgressStreamer(eventQueue);
    return async (state, config) => {
        const tools = toolDefs || runner._buildToolDefinitions();
        // Get conversation ID from execution context (Requirement 5.1)
        const conversationId = config?.configurable?.executionContext?.conversationId || 'default';
        // Get or create analysis session for this conversation (Requirement 5.1)
        const sessionManager = (0, sessions_1.getAnalysisSessionManager)();
        const session = sessionManager.getOrCreateSession(conversationId);
        // Check for session reset commands (Requirement 5.6)
        const lastUserMsg = state.messages.filter(m => m.role === 'user' || m.type === 'human').pop();
        const userContent = lastUserMsg ? (typeof lastUserMsg.content === 'string' ? lastUserMsg.content.toLowerCase() : '') : '';
        if (userContent.includes('reset session') || userContent.includes('clear context') || userContent.includes('clear session')) {
            sessionManager.resetSession(session.id);
            eventQueue?.push({
                type: 'thought',
                content: '\n🔄 Analysis session reset. All data frames, variables, and execution history have been cleared.'
            });
            return {
                messages: [{
                        role: 'assistant',
                        content: 'Analysis session has been reset. All previous data and context have been cleared. You can start a fresh analysis now.'
                    }]
            };
        }
        // Build plan context
        const plan = state.decomposedTask;
        const planContext = plan ? `\n\nCURRENT EXECUTION PLAN:\nTitle: ${plan.title}\nSteps:\n${plan.steps.map(s => `${s.id}: ${s.description} (Tool: ${s.tool})`).join('\n')}` : '';
        // Build session context for the agent (Requirement 5.2)
        const sessionContext = `\n\nANALYSIS SESSION CONTEXT:
Session ID: ${session.id}
Active DataFrames: ${Array.from(session.dataFrames.keys()).join(', ') || 'None'}
Stored Variables: ${Array.from(session.variables.keys()).join(', ') || 'None'}
Execution History: ${session.executionHistory.length} previous executions

You can reference previously loaded DataFrames and variables in your Python code.
Use "reset session" or "clear context" to clear all session data.`;
        // Build plan state context (Bug 1 fix)
        const activePlans = (0, planner_1.getActivePlans)();
        let planStateContext = '';
        if (activePlans.length > 0) {
            const currentPlan = activePlans[0]; // Use the first/active plan
            const stepsWithStatus = currentPlan.steps.map((step, index) => {
                const statusIcon = step.status === 'done' ? '✅' : step.status === 'in_progress' ? '⏳' : '⏳';
                const nextIndicator = step.status === 'pending' &&
                    currentPlan.steps.slice(0, index).every(s => s.status === 'done') ? ' (NEXT)' : '';
                return `  ${statusIcon} Step ${index + 1}: ${step.description}${nextIndicator}`;
            }).join('\n');
            const nextPendingStep = currentPlan.steps.find((step, index) => step.status === 'pending' && currentPlan.steps.slice(0, index).every(s => s.status === 'done'));
            planStateContext = `\n\n## Current Plan
A plan is already in progress. Continue executing the next pending step.

Plan: ${currentPlan.title}
${stepsWithStatus}

${nextPendingStep ? `Proceed directly to ${nextPendingStep.description}. Do not create a new plan.` : 'All steps completed or in progress.'}`;
        }
        // Initialize progress tracking for multi-step analyses (Requirement 1.5)
        if (plan && plan.totalSteps > 0) {
            progressStreamer.setTotalSteps(plan.totalSteps);
        }
        // Emit initial progress event within 100ms (Requirement 1.1)
        const startTime = Date.now();
        progressStreamer.emitStart('Data Analyst');
        try {
            // Load system prompt from synchronized prompts directory
            let systemPrompt = (0, prompt_sync_1.loadPrompt)('data-analyst.md');
            if (!systemPrompt) {
                console.warn('Failed to load data analyst prompt, using fallback');
                systemPrompt = `You are the EverFern Data Analyst.
Your goal is to process data, generate insights, and create visualizations.

AVAILABLE TOOLS:
- readFile: Load data files (CSV, Excel, JSON, Parquet)
- terminal_execute: Run Python code for analysis
- visualize: Generate interactive charts
- fsWrite: Save analysis results and dashboards

CRITICAL RULES:
1. Do NOT narrate. Execute tools DIRECTLY without preamble.
2. WINDOWS PYTHON: ALWAYS use 'python' — NEVER 'python3'. The command 'python3' does not exist on Windows.
3. Always print analysis results to stdout
4. Format numbers with 2-4 decimal precision
5. Include error handling in Python code`;
            }
            const result = await integrator.wrapNode('data_analyst', () => (0, agent_runtime_1.runAgentStep)(state, {
                runner,
                toolDefs: tools,
                eventQueue,
                nodeName: 'data_analyst',
                systemPromptOverride: systemPrompt + planStateContext + planContext + sessionContext
            }), 'Analyzing Data & Processing Results');
            // Emit completion event with percentage if multi-step (Requirement 1.5)
            const duration = Date.now() - startTime;
            if (plan && plan.totalSteps > 0) {
                progressStreamer.incrementCompletedSteps();
                const percentage = progressStreamer.getPercentage();
                progressStreamer.emitProgress(`Data Analysis completed`, percentage);
            }
            progressStreamer.emitStepComplete('Data Analysis', duration);
            const scrubbedContent = result.messages?.[0]?.content || '';
            const isComplete = scrubbedContent.includes('MISSION_COMPLETE') ||
                scrubbedContent.includes('ANALYSIS_FINISHED') ||
                (result.pendingToolCalls?.length === 0 && scrubbedContent.length > 50);
            return {
                ...result,
                returningFromSpecialist: isComplete ? null : 'data_analyst',
                dataAnalysisComplete: isComplete
            };
        }
        catch (error) {
            // Emit error event (Requirement 1.4)
            const diagnostics = error instanceof Error ? error.stack || '' : String(error);
            progressStreamer.emitError(error instanceof Error ? error : new Error(String(error)), diagnostics);
            throw error;
        }
    };
};
exports.createDataAnalystNode = createDataAnalystNode;
