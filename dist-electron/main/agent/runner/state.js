"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GraphState = void 0;
exports.isMissionCompleteEvent = isMissionCompleteEvent;
exports.hasThinkingDuration = hasThinkingDuration;
exports.isValidThinkingDuration = isValidThinkingDuration;
const langgraph_1 = require("@langchain/langgraph");
// Type guard for mission_complete events
function isMissionCompleteEvent(event) {
    return event.type === 'mission_complete';
}
// Type guard for events with thinking duration
function hasThinkingDuration(event) {
    return isMissionCompleteEvent(event) && event.thinkingDuration !== undefined;
}
// Validate thinking duration data
function isValidThinkingDuration(duration) {
    if (!duration)
        return false;
    const { startTime, endTime, duration: durationMs } = duration;
    // Validate required fields
    if (typeof startTime !== 'number' || startTime < 0)
        return false;
    // If endTime is present, validate it
    if (endTime !== undefined) {
        if (typeof endTime !== 'number' || endTime < startTime)
            return false;
    }
    // If duration is present, validate it
    if (durationMs !== undefined) {
        if (typeof durationMs !== 'number' || durationMs < 0)
            return false;
        // If both endTime and startTime are present, duration should match
        if (endTime !== undefined && Math.abs(durationMs - (endTime - startTime)) > 1) {
            return false;
        }
    }
    return true;
}
exports.GraphState = langgraph_1.Annotation.Root({
    ...langgraph_1.MessagesAnnotation.spec,
    currentIntent: (0, langgraph_1.Annotation)(),
    intentConfidence: (0, langgraph_1.Annotation)(),
    decomposedTask: (0, langgraph_1.Annotation)(),
    agiHints: (0, langgraph_1.Annotation)(),
    taskPhase: (0, langgraph_1.Annotation)(),
    pendingToolCalls: (0, langgraph_1.Annotation)(),
    toolCallRecords: (0, langgraph_1.Annotation)(),
    toolCallHistory: (0, langgraph_1.Annotation)(), // Compatibility
    userConfirmation: (0, langgraph_1.Annotation)(), // Compatibility
    finalResponse: (0, langgraph_1.Annotation)(), // Compatibility
    pauseGeneration: (0, langgraph_1.Annotation)(),
    iterations: (0, langgraph_1.Annotation)(),
    // Multi-Agent State
    activeAgent: (0, langgraph_1.Annotation)(),
    validationResult: (0, langgraph_1.Annotation)(),
    shouldContinueIteration: (0, langgraph_1.Annotation)(),
    // Completion signal — brain sets this before routing to judge
    // to explain why it believes the mission should end
    completionSignal: (0, langgraph_1.Annotation)(),
    // Routing decision — brain sets this to route to specialized agents
    routingDecision: (0, langgraph_1.Annotation)(),
    // HITL Approval State
    hitlApprovalResult: (0, langgraph_1.Annotation)(),
    // Mission Tracking (OpenClaw style)
    missionId: (0, langgraph_1.Annotation)(),
    missionTimeline: (0, langgraph_1.Annotation)(),
    missionSteps: (0, langgraph_1.Annotation)(),
    currentStepId: (0, langgraph_1.Annotation)(),
    // Specialized Agent State
    webExplorerComplete: (0, langgraph_1.Annotation)(),
    webExplorerSelfLoopCount: (0, langgraph_1.Annotation)(),
    navisInvoked: (0, langgraph_1.Annotation)(),
    searchInvoked: (0, langgraph_1.Annotation)(),
    codingComplete: (0, langgraph_1.Annotation)(),
    dataAnalysisComplete: (0, langgraph_1.Annotation)(),
    computerUseComplete: (0, langgraph_1.Annotation)(),
    deepResearchComplete: (0, langgraph_1.Annotation)(),
    // Subagent State
    subagentSpawned: (0, langgraph_1.Annotation)(),
    completedSteps: (0, langgraph_1.Annotation)(),
    decompositionAttempts: (0, langgraph_1.Annotation)(),
    // Bugfixes: Routing state persistence
    brainToolsInFlight: (0, langgraph_1.Annotation)(),
    returningFromSpecialist: (0, langgraph_1.Annotation)(),
    // Debate system: stores the result of the three-agent debate chamber
    debateResult: (0, langgraph_1.Annotation)(),
});
