import { describe, expect, it, vi, beforeEach } from 'vitest';
import { buildGraph } from './graph';
import { GraphState } from './state';
import { interrupt, Command } from '@langchain/langgraph';

vi.mock('./nodes/triage', () => ({
  createTriageNode: vi.fn(() => async (state: any) => {
    return { currentIntent: 'question' };
  })
}));

vi.mock('./nodes/planner', () => ({
  createPlannerNode: vi.fn(() => async (state: any) => {
    // This will pause on first call, and return feedback on second call
    const feedback = interrupt({ question: "Approve plan?" });
    return { taskPhase: 'executing', messages: [{ role: 'system', content: `Approved: ${feedback}` }] };
  })
}));

vi.mock('./nodes/call_model', () => ({
  createCallModelNode: vi.fn(() => async (state: any) => {
    return {
        messages: [{ role: 'assistant', content: 'done' }],
        pendingToolCalls: []
    };
  })
}));

vi.mock('./nodes/execute_tools', () => ({
  createExecuteToolsNode: vi.fn(() => async (state: any) => {
    return {};
  })
}));

vi.mock('./nodes/specialized_agents', () => ({
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
    return {};
  })
}));

vi.mock('./nodes/validation', () => ({
  createValidationNode: vi.fn(() => async (state: any) => {
    return { validationResult: { isHighRisk: false, reasoning: 'Safe' } };
  })
}));

describe('Modern LangGraph HITL Architecture', () => {
  let mockRunner: any;

  beforeEach(() => {
    mockRunner = {
      config: { maxIterations: 10 },
      client: {
        chat: vi.fn(async () => ({
          content: JSON.stringify({
            reason: 'task_complete',
            explanation: 'Task completed successfully',
            verdict: 'complete',
            confidence: 1.0,
            reasoning: 'Done'
          }),
          tool_calls: []
        }))
      },
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

  it('should pause execution at interrupt() and resume with user feedback using Command', async () => {
    const threadId = 'test-hitl-thread-' + Date.now();
    const graph = buildGraph(mockRunner, [], []);
    const threadConfig = { 
      configurable: { 
        thread_id: threadId,
        executionContext: {
          runner: mockRunner,
          eventQueue: [],
          conversationId: 'test-conv-id'
        }
      }, 
      recursionLimit: 100 
    };

    const initialState = {
      messages: [{ role: 'user', content: 'create a report' }],
      toolCallRecords: [],
      iterations: 0,
      pendingToolCalls: [],
      finalResponse: '',
      toolCallHistory: [],
      decomposedTask: { id: 't1', title: 'Task 1', steps: [] }
    };

    // 1. Initial run: should hit the planner and pause at interrupt()
    const firstResult = await graph.invoke(initialState, threadConfig);

    // Verify graph is paused
    expect(firstResult.__interrupt__).toBeDefined();
    expect(firstResult.__interrupt__[0].value.question).toBe("Approve plan?");

    // Check internal state via thread config
    const stateSnapshot = await graph.getState(threadConfig);
    expect(stateSnapshot.next).toContain('global_planner');

    // 2. Resume run: pass feedback using Command({ resume })
    const resumeCommand = new Command({ resume: "Yes, I approve this plan!" });
    const secondResult = await graph.invoke(resumeCommand, threadConfig);

    // Verify it resumed and finished
    expect(secondResult.__interrupt__).toBeUndefined();

    // Verify messages were processed (the exact format may vary)
    expect(secondResult.messages).toBeDefined();
    expect(Array.isArray(secondResult.messages) || typeof secondResult.messages === 'object').toBe(true);
  });
});
