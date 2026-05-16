"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCodingSpecialistNode = void 0;
const agent_runtime_1 = require("../services/agent-runtime");
const mission_integrator_1 = require("../mission-integrator");
const prompt_sync_1 = require("../../../lib/prompt-sync");
const dependency_manager_1 = require("../dependency-manager");
const smart_refactorer_1 = require("../smart-refactorer");
/**
 * Analyze the current codebase context to provide intelligent suggestions
 */
function analyzeCodeContext(state) {
    const dependencyManager = (0, dependency_manager_1.getDependencyManager)();
    const allFiles = dependencyManager.getAllFiles();
    // Extract project information from actual codebase analysis
    // No hardcoded patterns - AI learns from actual code structure
    const projectStructure = {
        language: 'unknown', // Will be detected by AI from actual code
        dependencies: [],
        framework: undefined, // Will be detected by AI from actual code
        testFramework: undefined // Will be detected by AI from actual code
    };
    return {
        openFiles: allFiles.slice(0, 10), // Limit for performance
        recentChanges: [], // Would be populated from file system events
        projectStructure
    };
}
/**
 * Generate intelligent code suggestions based on context
 */
function generateCodeSuggestions(userInput, context) {
    const suggestions = [];
    const dependencyManager = (0, dependency_manager_1.getDependencyManager)();
    const refactorer = (0, smart_refactorer_1.getSmartRefactorer)();
    // Analyze for potential improvements in open files
    for (const file of context.openFiles.slice(0, 5)) {
        // Check for refactoring opportunities
        const refactorOps = refactorer.analyzeCodeArchitecture([file]);
        for (const op of refactorOps) {
            suggestions.push({
                type: 'refactor',
                description: op.description,
                file: op.file,
                confidence: op.impact === 'high' ? 0.9 : op.impact === 'medium' ? 0.7 : 0.5,
                reasoning: op.suggestion
            });
        }
        // Check for naming convention issues
        const namingIssues = refactorer.improveNamingConventions(file);
        for (const issue of namingIssues.slice(0, 3)) { // Limit suggestions
            suggestions.push({
                type: 'refactor',
                description: `Improve naming: ${issue.currentName} → ${issue.suggestedName}`,
                file: issue.file,
                confidence: 0.8,
                reasoning: issue.reason
            });
        }
    }
    // Detect circular dependencies
    const circularDeps = dependencyManager.detectCircularDependencies();
    for (const cycle of circularDeps.slice(0, 2)) {
        suggestions.push({
            type: 'fix',
            description: `Fix circular dependency: ${cycle.cycle.join(' → ')}`,
            confidence: cycle.severity === 'error' ? 0.95 : 0.8,
            reasoning: cycle.suggestion
        });
    }
    // Suggest tests if none exist
    const hasTests = context.openFiles.some(f => f.includes('.test.') || f.includes('.spec.') || f.includes('__tests__'));
    if (!hasTests) {
        suggestions.push({
            type: 'test',
            description: 'Add unit tests for the implemented functionality',
            confidence: 0.9,
            reasoning: 'No test files detected. Adding tests will improve code reliability and maintainability.'
        });
    }
    // Sort by confidence and return top suggestions
    return suggestions
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 5);
}
/**
 * Provide intelligent context-aware assistance
 */
function provideIntelligentAssistance(userInput, context, suggestions) {
    let assistance = '';
    // Proactive suggestions based on confidence
    const highConfidenceSuggestions = suggestions.filter(s => s.confidence > 0.8);
    if (highConfidenceSuggestions.length > 0) {
        assistance += '💡 **Proactive suggestions based on your codebase:**\n';
        for (const suggestion of highConfidenceSuggestions.slice(0, 2)) {
            assistance += `• ${suggestion.description}\n  *${suggestion.reasoning}*\n\n`;
        }
    }
    return assistance;
}
const createCodingSpecialistNode = (runner, eventQueue, missionTracker, toolDefs) => {
    const integrator = (0, mission_integrator_1.createMissionIntegrator)(missionTracker);
    return async (state) => {
        const tools = toolDefs || runner._buildToolDefinitions();
        // Detect if the user has already approved the plan
        const messages = state.messages || [];
        const planApproved = messages.some((m) => {
            const role = m.role || m._getType?.();
            const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '');
            return (role === 'user' || role === 'human') && content.includes('APPROVED');
        });
        // Detect task type from the user's original request
        const firstUserMsg = messages.find((m) => {
            const role = m.role || m._getType?.();
            return role === 'user' || role === 'human';
        });
        const userInput = firstUserMsg
            ? (typeof firstUserMsg.content === 'string'
                ? firstUserMsg.content
                : JSON.stringify(firstUserMsg.content))
            : '';
        // Build plan context from decomposed task
        const plan = state.decomposedTask;
        const planContext = plan
            ? `\n\nDECOMPOSED TASK:\nTitle: ${plan.title}\nSteps:\n${plan.steps.map((s) => `${s.id}: ${s.description} (Tool: ${s.tool})`).join('\n')}`
            : '';
        if (!planApproved) {
            // PHASE 1: Planning — instruct the agent to produce plan docs and ask for approval
            eventQueue?.push({ type: 'thought', content: '\n💻 Coding Specialist: Analysing request and preparing plan...' });
            const phaseHint = `\n\n## CURRENT PHASE: PLANNING\nThe user has NOT yet approved a plan. You MUST:\n1. Write necessary plan files (e.g. .everfern/plan/design.md, .everfern/plan/tasks.md)\n2. Call ask_user_question to present the plan for approval\nDO NOT write any application code yet. The LLM will decide whether this is a bug fix, new feature, or refactor based on the request.`;
            const systemPrompt = ((0, prompt_sync_1.loadPrompt)('coding-specialist.md') || '') + planContext + phaseHint;
            const result = await integrator.wrapNode('coding_specialist', () => (0, agent_runtime_1.runAgentStep)(state, {
                runner,
                toolDefs: tools,
                eventQueue,
                nodeName: 'coding_specialist',
                systemPromptOverride: systemPrompt,
            }), 'Preparing implementation plan');
            return {
                ...result,
                returningFromSpecialist: 'coding_specialist',
                codingComplete: false // Still in planning
            };
        }
        // PHASE 2: Execution — plan approved, now implement
        eventQueue?.push({ type: 'thought', content: '\n💻 Coding Specialist: Plan approved — beginning implementation...' });
        const executionHint = `\n\n## CURRENT PHASE: EXECUTION\nThe user has approved the plan. Now implement it:\n1. Read your plan files\n2. BATCH ALL FILE CREATION — use batch_write with ALL files in ONE call, or use executePwsh with a heredoc script. NEVER write files one-by-one.\n3. Call getDiagnostics after each batch\n4. Fix errors before moving to the next task\nDO NOT re-present the plan or ask for approval again.
When all tasks are completed successfully, output 'MISSION_COMPLETE' to signal the end of implementation.`;
        const systemPrompt = ((0, prompt_sync_1.loadPrompt)('coding-specialist.md') || '') + planContext + executionHint;
        const result = await integrator.wrapNode('coding_specialist', () => (0, agent_runtime_1.runAgentStep)(state, {
            runner,
            toolDefs: tools,
            eventQueue,
            nodeName: 'coding_specialist',
            systemPromptOverride: systemPrompt,
        }), 'Writing Code & Implementing Features');
        const scrubbedContent = result.messages?.[0]?.content || '';
        const isComplete = scrubbedContent.includes('MISSION_COMPLETE') ||
            scrubbedContent.includes('TASK_FINISHED') ||
            (result.pendingToolCalls?.length === 0 && scrubbedContent.length > 50);
        return {
            ...result,
            returningFromSpecialist: isComplete ? null : 'coding_specialist',
            codingComplete: isComplete
        };
    };
};
exports.createCodingSpecialistNode = createCodingSpecialistNode;
