import { GraphStateType, StreamEvent } from '../state';
import { AgentRunner } from '../runner';
import { ToolDefinition, ChatMessage, ToolCall } from '../../../lib/ai-client';
import type { MissionTracker } from '../mission-tracker';
import { createMissionIntegrator } from '../mission-integrator';
import { loadPrompt } from '../../../lib/prompt-sync';

export const createComputerUseNode = (
  runner: AgentRunner,
  eventQueue?: StreamEvent[],
  missionTracker?: MissionTracker,
  toolDefs?: ToolDefinition[]
) => {
  const integrator = createMissionIntegrator(missionTracker);

  return async (state: GraphStateType): Promise<Partial<GraphStateType>> => {
    integrator.startNode('computer_use_agent', 'Initiating autonomous computer automation');

    try {
      runner.telemetry.transition('computer_use_agent');
      eventQueue?.push({ type: 'thought', content: '🖥️ OS Interaction: Launching autonomous sub-agent for desktop automation...' });

      // Get the original task from the last user message or the decomposition plan
      const lastUserMsg = state.messages.filter(m => (m as any).role === 'user' || (m as any).type === 'human').pop();
      const task = lastUserMsg ? (typeof lastUserMsg.content === 'string' ? lastUserMsg.content : 'Perform automation task') : 'Automate desktop';

      // Directly emit a tool call for the computer_use tool.
      // This bypasses the model call in this node and goes straight to validation/execution.
      const toolCall: ToolCall = {
        id: `tc-auto-${Date.now()}`,
        name: 'computer_use',
        arguments: { task }
      };

      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: `I will now use the computer_use tool to: ${task}`,
        tool_calls: [toolCall]
      };

      integrator.completeNode('computer_use_agent', 'Automation sub-agent triggered');

      return {
        messages: [assistantMsg as any],
        pendingToolCalls: [toolCall],
        taskPhase: 'executing' as const,
        returningFromSpecialist: null,
        computerUseComplete: false
      };


    } catch (error) {
      integrator.failNode('computer_use_agent', error instanceof Error ? error.message : String(error));
      throw error;
    }
  };
};
