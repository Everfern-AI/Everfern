import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildGraph } from '../../graph';
import { GraphStateType } from '../../state';

/**
 * Bug Condition Exploration Test - Conversation Intent No Response
 *
 * **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5**
 *
 * Property 1: Bug Condition - Conversation Intents Skip Model Call
 *
 * CRITICAL: This test MUST FAIL on unfixed code - failure confirms the bug exists
 * DO NOT attempt to fix the test or the code when it fails
 *
 * This test verifies that when users send conversational messages like greetings
 * ("hi", "hello", "how are you?"), the system routes directly to validation without
 * calling the AI model, resulting in no response being generated.
 *
 * Expected behavior (after fix): Model should be called and generate a friendly greeting
 * Current behavior (unfixed): Routes to validation → END without calling model
 */

// Track which nodes were called and model call count
let modelCallCount = 0;
let executedNodes: string[] = [];

// Mock the triage node to return conversation intent
vi.mock('../../nodes/triage', () => ({
  createTriageNode: vi.fn(() => async (state: any) => {
    executedNodes.push('triage');
    return {
      currentIntent: 'conversation',
      intentConfidence: 0.95,
      taskPhase: 'planning'
    };
  })
}));

// Mock the planner node
vi.mock('../../nodes/planner', () => ({
  createPlannerNode: vi.fn(() => async (state: any) => {
    executedNodes.push('planner');
    return {
      taskPhase: 'routing',
      shouldContinueIteration: false
    };
  })
}));

// Mock the execute_tools node
vi.mock('../../nodes/execute_tools', () => ({
  createExecuteToolsNode: vi.fn(() => async (state: any) => {
    executedNodes.push('execute_tools');
    return {};
  })
}));

// Mock the specialized agents - web_explorer should call the model
vi.mock('../../nodes/specialized_agents', () => ({
  createCodingSpecialistNode: vi.fn(() => async (state: any) => {
    executedNodes.push('coding_specialist');
    modelCallCount++;
    return {
      messages: [...(state.messages || []), { role: 'assistant', content: 'Coding response' }],
      finalResponse: 'Coding response'
    };
  }),
  createDataAnalystNode: vi.fn(() => async (state: any) => {
    executedNodes.push('data_analyst');
    modelCallCount++;
    return {
      messages: [...(state.messages || []), { role: 'assistant', content: 'Analysis response' }],
      finalResponse: 'Analysis response'
    };
  }),
  createComputerUseNode: vi.fn(() => async (state: any) => {
    executedNodes.push('computer_use');
    modelCallCount++;
    return {
      messages: [...(state.messages || []), { role: 'assistant', content: 'Computer use response' }],
      finalResponse: 'Computer use response'
    };
  }),
  createWebExplorerNode: vi.fn(() => async (state: any) => {
    executedNodes.push('web_explorer');
    modelCallCount++;
    return {
      messages: [...(state.messages || []), { role: 'assistant', content: 'Hello! How can I help you today?' }],
      finalResponse: 'Hello! How can I help you today?'
    };
  })
}));

describe('Bug Condition Exploration - Conversation Intent No Response', () => {
  let mockRunner: any;

  beforeEach(() => {
    // Reset tracking variables
    modelCallCount = 0;
    executedNodes = [];

    mockRunner = {
      config: { maxIterations: 50 },
      telemetry: {
        warn: vi.fn(),
        info: vi.fn(),
        action: vi.fn(),
        transition: vi.fn(),
      },
      _buildToolDefinitions: vi.fn(() => [])
    };
  });

  /**
   * Test Case 1: "hi" greeting
   *
   * Scenario: User sends "hi"
   * Expected (after fix): Model is called (web_explorer node), response contains greeting
   * Current (unfixed): Model is NOT called, routes directly to validation → END
   */
  it('should call model and generate response for "hi" greeting', async () => {
    const graph = buildGraph(mockRunner, [], []);

    // Create initial state with conversation intent
    const initialState: Partial<GraphStateType> = {
      messages: [
        { role: 'user', content: 'hi' }
      ],
      iterations: 0,
      pendingToolCalls: [],
    };

    // Invoke the graph
    const result = await graph.invoke(initialState, {
      configurable: { thread_id: 'test-conversation-1' }
    });

    // ASSERTIONS - These will FAIL on unfixed code (proving the bug exists)

    // 1. Model should have been called (web_explorer should be in execution path)
    expect(modelCallCount).toBeGreaterThan(0);

    // 2. web_explorer node should have been executed
    expect(executedNodes).toContain('web_explorer');

    // 3. Final response should not be empty
    expect(result.finalResponse).toBeDefined();
    expect(result.finalResponse).not.toBe('');

    // 4. Response should contain greeting-like content
    const response = result.finalResponse?.toLowerCase() || '';
    const hasGreeting = response.includes('hello') ||
                       response.includes('hi') ||
                       response.includes('help') ||
                       response.includes('how can i');
    expect(hasGreeting).toBe(true);
  });

  /**
   * Test Case 2: "hello" greeting
   *
   * Scenario: User sends "hello"
   * Expected (after fix): Model is called (web_explorer node), response contains greeting
   * Current (unfixed): Model is NOT called, routes directly to validation → END
   */
  it('should call model and generate response for "hello" greeting', async () => {
    const graph = buildGraph(mockRunner, [], []);

    const initialState: Partial<GraphStateType> = {
      messages: [
        { role: 'user', content: 'hello' }
      ],
      iterations: 0,
      pendingToolCalls: [],
    };

    const result = await graph.invoke(initialState, {
      configurable: { thread_id: 'test-conversation-2' }
    });

    // ASSERTIONS - These will FAIL on unfixed code
    expect(modelCallCount).toBeGreaterThan(0);
    expect(executedNodes).toContain('web_explorer');
    expect(result.finalResponse).toBeDefined();
    expect(result.finalResponse).not.toBe('');

    const response = result.finalResponse?.toLowerCase() || '';
    const hasGreeting = response.includes('hello') ||
                       response.includes('hi') ||
                       response.includes('help');
    expect(hasGreeting).toBe(true);
  });

  /**
   * Test Case 3: "how are you?" greeting
   *
   * Scenario: User sends "how are you?"
   * Expected (after fix): Model is called (web_explorer node), response contains greeting
   * Current (unfixed): Model is NOT called, routes directly to validation → END
   */
  it('should call model and generate response for "how are you?" greeting', async () => {
    const graph = buildGraph(mockRunner, [], []);

    const initialState: Partial<GraphStateType> = {
      messages: [
        { role: 'user', content: 'how are you?' }
      ],
      iterations: 0,
      pendingToolCalls: [],
    };

    const result = await graph.invoke(initialState, {
      configurable: { thread_id: 'test-conversation-3' }
    });

    // ASSERTIONS - These will FAIL on unfixed code
    expect(modelCallCount).toBeGreaterThan(0);
    expect(executedNodes).toContain('web_explorer');
    expect(result.finalResponse).toBeDefined();
    expect(result.finalResponse).not.toBe('');
  });

  /**
   * Test Case 4: Routing Path Verification
   *
   * This test verifies the bug at the routing level:
   * Current (unfixed): global_planner → action_validation → END (no model call)
   * Expected (after fix): global_planner → web_explorer → action_validation → END (model called)
   */
  it('should demonstrate bug: conversation intent routes to validation without calling model', async () => {
    const graph = buildGraph(mockRunner, [], []);

    const initialState: Partial<GraphStateType> = {
      messages: [
        { role: 'user', content: 'hi' }
      ],
      iterations: 0,
      pendingToolCalls: [],
    };

    await graph.invoke(initialState, {
      configurable: { thread_id: 'test-conversation-routing' }
    });

    // On unfixed code: web_explorer is NOT in executedNodes, model is never called
    // After fix: web_explorer should be in executedNodes, model should be called
    expect(executedNodes).toContain('web_explorer');
    expect(modelCallCount).toBeGreaterThan(0);
  });

  /**
   * Edge Case: Mixed Intent Test
   *
   * Scenario: User sends "hi, can you help me code?"
   * Expected: Should classify as "coding" (not "conversation") and route to coding_specialist
   *
   * This test ensures the fix doesn't break legitimate coding requests with greetings
   */
  it('should classify "hi, can you help me code?" as coding intent, not conversation', async () => {
    // Override the triage mock for this specific test
    const { createTriageNode } = await import('../../nodes/triage');
    vi.mocked(createTriageNode).mockReturnValueOnce(async (state: any) => {
      executedNodes.push('triage');
      return {
        currentIntent: 'coding', // Should be classified as coding, not conversation
        intentConfidence: 0.85,
        taskPhase: 'planning'
      };
    });

    const graph = buildGraph(mockRunner, [], []);

    const initialState: Partial<GraphStateType> = {
      messages: [
        { role: 'user', content: 'hi, can you help me code?' }
      ],
      iterations: 0,
      pendingToolCalls: [],
    };

    const result = await graph.invoke(initialState, {
      configurable: { thread_id: 'test-mixed-intent' }
    });

    // Should route through coding_specialist, not web_explorer (conversation handler)
    expect(executedNodes).toContain('coding_specialist');
    expect(executedNodes).not.toContain('web_explorer');
    expect(result.currentIntent).toBe('coding');
  });
});
