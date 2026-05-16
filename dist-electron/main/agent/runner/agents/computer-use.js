"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createComputerUseNode = void 0;
const mission_integrator_1 = require("../mission-integrator");
const createComputerUseNode = (runner, eventQueue, missionTracker, toolDefs) => {
    const integrator = (0, mission_integrator_1.createMissionIntegrator)(missionTracker);
    return async (state) => {
        integrator.startNode('computer_use_agent', 'Initiating autonomous computer automation');
        try {
            runner.telemetry.transition('computer_use_agent');
            eventQueue?.push({ type: 'thought', content: '🖥️ OS Interaction: Launching autonomous sub-agent for desktop automation...' });
            // Get the original task from the last user message or the decomposition plan
            const lastUserMsg = state.messages.filter(m => m.role === 'user' || m.type === 'human').pop();
            const task = lastUserMsg ? (typeof lastUserMsg.content === 'string' ? lastUserMsg.content : 'Perform automation task') : 'Automate desktop';
            // Directly emit a tool call for the computer_use tool.
            // This bypasses the model call in this node and goes straight to validation/execution.
            const toolCall = {
                id: `tc-auto-${Date.now()}`,
                name: 'computer_use',
                arguments: { task }
            };
            const assistantMsg = {
                role: 'assistant',
                content: `I will now use the computer_use tool to: ${task}`,
                tool_calls: [toolCall]
            };
            integrator.completeNode('computer_use_agent', 'Automation sub-agent triggered');
            return {
                messages: [assistantMsg],
                pendingToolCalls: [toolCall],
                taskPhase: 'executing',
                returningFromSpecialist: null,
                computerUseComplete: false
            };
        }
        catch (error) {
            integrator.failNode('computer_use_agent', error instanceof Error ? error.message : String(error));
            throw error;
        }
    };
};
exports.createComputerUseNode = createComputerUseNode;
