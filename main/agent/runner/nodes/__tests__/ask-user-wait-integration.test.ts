import { describe, expect, it, vi, beforeEach } from 'vitest';
import { buildGraph } from '../../graph';
import { interrupt, Command } from '@langchain/langgraph';
import { ToolMessage } from '@langchain/core/messages';
import { stateManager } from '../../state-manager';

// Mock other nodes to prevent real LLM/tool calls
vi.mock('../triage', () => ({
  createTriageNode: vi.fn(() => async (state: any) => {
    return { currentIntent: 'research' };
  })
}));

vi.mock('../planner', () => ({
  createPlannerNode: vi.fn(() => async (state: any) => {
    return { taskPhase: 'executing' };
  })
}));

vi.mock('../brain', () => ({
  createBrainNode: vi.fn(() => async (state: any) => {
    const messages = state.messages || [];
    const lastMessage = messages[messages.length - 1] as any;
    
    // Simulate LLM receiving the user's answer and wrapping up
    const hasUserAnswer = messages.some((m: any) => m.content === 'user@example.com');
    if (hasUserAnswer) {
      return {
        messages: [{ role: 'assistant', content: 'Task completed successfully with recipient email user@example.com.' }],
        pendingToolCalls: []
      };
    }
    
    // Initial brain node invocation: ask user for clarification
    return {
      messages: [{ role: 'assistant', content: 'thinking...' }],
      pendingToolCalls: [{ id: 'ask-123', name: 'ask_user_question', arguments: {} }]
    };
  })
}));

// Mock execute_tools to simulate returning ask_user_question tool result and clearing pendingToolCalls
vi.mock('../execute_tools', () => ({
  createExecuteToolsNode: vi.fn(() => async (state: any) => {
    return {
      messages: [
        new ToolMessage({
          content: 'Please provide recipient email.',
          tool_call_id: 'ask-123',
          name: 'ask_user_question'
        })
      ],
      toolCallRecords: [{
        id: 'ask-123',
        toolName: 'ask_user_question',
        result: { success: true, output: 'Awaiting email' }
      }],
      pendingToolCalls: [], // Real execute_tools clears pendingToolCalls
      returningFromSpecialist: 'web_explorer'
    };
  })
}));

vi.mock('../specialized_agents', () => ({
  createCodingSpecialistNode: vi.fn(() => async (state: any) => {
    return {};
  }),
  createDataAnalystNode: vi.fn(() => async (state: any) => {
    return {};
  }),
  createComputerUseNode: vi.fn(() => async (state: any) => {
    return {};
  }),
  createWebExplorerNode: vi.fn(() => async (state: any) => {
    // Web explorer completes when called after resumption
    return { webExplorerComplete: true };
  }),
  createDeepResearchNode: vi.fn(() => async (state: any) => {
     return {};
  })
}));

vi.mock('../validation', () => ({
  createValidationNode: vi.fn(() => async (state: any) => {
    return { validationResult: { isHighRisk: false, reasoning: 'Safe' } };
  })
}));

vi.mock('../memory-consolidator', () => ({
  createMemoryConsolidatorNode: vi.fn(() => async (state: any) => {
    return { messages: state.messages };
  })
}));

describe('ask_user_wait Graph Node Integration', () => {
  let mockRunner: any;

  beforeEach(() => {
    mockRunner = {
      config: { maxIterations: 10 },
      telemetry: {
        warn: vi.fn(),
        info: vi.fn(),
        action: vi.fn(),
        transition: vi.fn(),
        metrics: vi.fn(),
      },
      tools: [],
      _buildToolDefinitions: vi.fn(() => []),
      shouldCaptureScreenshot: vi.fn(() => false)
    };
  });

  it('should route to ask_user_wait when ask_user_question finishes, interrupt the graph, and resume with user input preserving specialized agent context', async () => {
    const threadId = 'test-wait-thread-' + Date.now();
    const conversationId = 'test-conv-id-' + Date.now();
    
    // Initialize session in stateManager so setInterrupted won't fail
    stateManager.saveState(conversationId, {});

    const graph = buildGraph(mockRunner, [], []);
    const threadConfig = {
      configurable: {
        thread_id: threadId,
        executionContext: {
          runner: mockRunner,
          eventQueue: [],
          conversationId,
          isResuming: false
        }
      },
      recursionLimit: 100
    };

    const initialState = {
      messages: [{ role: 'user', content: 'do listing research' }],
      toolCallRecords: [],
      iterations: 0,
      pendingToolCalls: [],
      finalResponse: '',
      toolCallHistory: [],
      decomposedTask: { id: 't1', title: 'Task 1', steps: [] },
      returningFromSpecialist: 'web_explorer'
    };

    // 1. Initial run: execute tools, tool executes ask_user_question, conditional edge routes to ask_user_wait
    // and it should pause at interrupt()
    const firstResult = await graph.invoke(initialState, threadConfig);

    // Verify graph is paused
    expect(firstResult.__interrupt__).toBeDefined();
    expect(firstResult.__interrupt__[0].value.details.tools[0].toolName).toBe('ask_user_question');

    // Verify the stateManager registers the interruption
    expect(stateManager.isInterrupted(conversationId)).toBe(true);
    const interruptData = stateManager.getInterruptData(conversationId);
    expect(interruptData).toBeDefined();
    expect(interruptData.details.summary).toBe('Awaiting email');

    // 2. Resume run: pass user answer using Command({ resume })
    const resumeCommand = new Command({ resume: 'user@example.com' });
    const resumeConfig = {
      configurable: {
        thread_id: threadId,
        executionContext: {
          runner: mockRunner,
          eventQueue: [],
          conversationId,
          isResuming: true // Mark as resume
        }
      },
      recursionLimit: 100
    };

    const secondResult = await graph.invoke(resumeCommand, resumeConfig);

    // Verify it resumed and finished
    expect(secondResult.__interrupt__).toBeUndefined();

    // Verify stateManager is cleaned up
    expect(stateManager.isInterrupted(conversationId)).toBe(false);

    // Verify user answer message is appended to the messages
    const userAnsMsg = secondResult.messages.find((m: any) => m.content === 'user@example.com');
    expect(userAnsMsg).toBeDefined();

    // Verify returningFromSpecialist is preserved and routed to web_explorer
    expect(secondResult.returningFromSpecialist).toBe('web_explorer');
    expect(secondResult.webExplorerComplete).toBe(true);
  });
});
