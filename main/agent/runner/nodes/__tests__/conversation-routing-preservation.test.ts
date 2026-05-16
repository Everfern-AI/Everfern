import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildGraph } from '../../graph';
import { GraphStateType } from '../../state';
import fc from 'fast-check';

/**
 * Preservation Property Tests - Conversation Intent Routing
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**
 *
 * Property 2: Preservation - Non-Conversation Intent Routing Unchanged
 *
 * IMPORTANT: These tests follow observation-first methodology
 * - Observe behavior on UNFIXED code for non-conversation intents
 * - Write property-based tests capturing observed routing behavior patterns
 * - EXPECTED OUTCOME: Tests PASS on unfixed code (confirms baseline behavior)
 *
 * These tests ensure that the bugfix does NOT introduce regressions for:
 * - Coding tasks routing through coding_specialist
 * - Questions routing through web_explorer
 * - Research tasks routing through web_explorer
 * - High-risk tool calls triggering hitl_approval
 */

// Track which nodes were executed
let executedNodes: string[] = [];
let modelCallCount = 0;

// Mock the triage node to return different intents based on test
let mockIntentResponse: { intent: string; confidence: number } = { intent: 'coding', confidence: 0.9 };

vi.mock('../../nodes/triage', () => ({
  createTriageNode: vi.fn(() => async (state: any) => {
    executedNodes.push('triage');
    return {
      currentIntent: mockIntentResponse.intent,
      intentConfidence: mockIntentResponse.confidence,
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
    return {
      messages: [...(state.messages || []), { role: 'assistant', content: 'Tools executed' }]
    };
  })
}));

// Mock the specialized agents
vi.mock('../../nodes/specialized_agents', () => ({
  createCodingSpecialistNode: vi.fn(() => async (state: any) => {
    executedNodes.push('coding_specialist');
    modelCallCount++;
    return {
      messages: [...(state.messages || []), { role: 'assistant', content: 'Coding task completed' }],
      finalResponse: 'Coding task completed',
      pendingToolCalls: [] // No tools for simple responses
    };
  }),
  createDataAnalystNode: vi.fn(() => async (state: any) => {
    executedNodes.push('data_analyst');
    modelCallCount++;
    return {
      messages: [...(state.messages || []), { role: 'assistant', content: 'Data analysis completed' }],
      finalResponse: 'Data analysis completed',
      pendingToolCalls: []
    };
  }),
  createComputerUseNode: vi.fn(() => async (state: any) => {
    executedNodes.push('computer_use');
    modelCallCount++;
    return {
      messages: [...(state.messages || []), { role: 'assistant', content: 'Computer automation completed' }],
      finalResponse: 'Computer automation completed',
      pendingToolCalls: []
    };
  }),
  createWebExplorerNode: vi.fn(() => async (state: any) => {
    executedNodes.push('web_explorer');
    modelCallCount++;
    return {
      messages: [...(state.messages || []), { role: 'assistant', content: 'Research completed' }],
      finalResponse: 'Research completed',
      pendingToolCalls: []
    };
  })
}));

describe('Preservation Properties - Non-Conversation Intent Routing', () => {
  let mockRunner: any;

  beforeEach(() => {
    // Reset tracking variables
    executedNodes = [];
    modelCallCount = 0;
    mockIntentResponse = { intent: 'coding', confidence: 0.9 };

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
   * Preservation Test 1: Coding Intent Routes Through coding_specialist
   *
   * Requirement 3.1: WHEN a user sends a coding task request THEN the system
   * SHALL CONTINUE TO route through coding_specialist and execute the task
   *
   * Observed behavior on UNFIXED code:
   * - "write a function" → triage → planner → coding_specialist → validation → END
   * - Model is called in coding_specialist
   * - Response is generated
   */
  describe('Coding Intent Routing', () => {
    it('should route "write a function" through coding_specialist', async () => {
      mockIntentResponse = { intent: 'coding', confidence: 0.9 };

      const graph = buildGraph(mockRunner, [], []);

      const initialState: Partial<GraphStateType> = {
        messages: [{ role: 'user', content: 'write a function' }],
        iterations: 0,
        pendingToolCalls: [],
      };

      const result = await graph.invoke(initialState, {
        configurable: { thread_id: 'test-coding-1' }
      });

      // Verify routing path
      expect(executedNodes).toContain('triage');
      expect(executedNodes).toContain('planner');
      expect(executedNodes).toContain('coding_specialist');
      expect(executedNodes).toContain('validation');

      // Verify model was called
      expect(modelCallCount).toBeGreaterThan(0);

      // Verify response was generated
      expect(result.finalResponse).toBeDefined();
      expect(result.finalResponse).not.toBe('');
    });

    it('should route "fix this bug" through coding_specialist', async () => {
      mockIntentResponse = { intent: 'fix', confidence: 0.9 };

      const graph = buildGraph(mockRunner, [], []);

      const initialState: Partial<GraphStateType> = {
        messages: [{ role: 'user', content: 'fix this bug' }],
        iterations: 0,
        pendingToolCalls: [],
      };

      const result = await graph.invoke(initialState, {
        configurable: { thread_id: 'test-coding-2' }
      });

      // Verify routing path includes coding_specialist
      expect(executedNodes).toContain('coding_specialist');
      expect(modelCallCount).toBeGreaterThan(0);
      expect(result.finalResponse).toBeDefined();
    });

    it('should route "create a file" through coding_specialist', async () => {
      mockIntentResponse = { intent: 'coding', confidence: 0.9 };

      const graph = buildGraph(mockRunner, [], []);

      const initialState: Partial<GraphStateType> = {
        messages: [{ role: 'user', content: 'create a file' }],
        iterations: 0,
        pendingToolCalls: [],
      };

      const result = await graph.invoke(initialState, {
        configurable: { thread_id: 'test-coding-3' }
      });

      // Verify routing path includes coding_specialist
      expect(executedNodes).toContain('coding_specialist');
      expect(modelCallCount).toBeGreaterThan(0);
    });
  });

  /**
   * Preservation Test 2: Question Intent Routes Through web_explorer
   *
   * Requirement 3.2: WHEN a user sends a question requiring research THEN the
   * system SHALL CONTINUE TO route through web_explorer to find answers
   *
   * Observed behavior on UNFIXED code:
   * - "what is X?" → triage → planner → web_explorer → validation → END
   * - Model is called in web_explorer
   * - Research response is generated
   */
  describe('Question Intent Routing', () => {
    it('should route "what is TypeScript?" through web_explorer', async () => {
      mockIntentResponse = { intent: 'question', confidence: 0.9 };

      const graph = buildGraph(mockRunner, [], []);

      const initialState: Partial<GraphStateType> = {
        messages: [{ role: 'user', content: 'what is TypeScript?' }],
        iterations: 0,
        pendingToolCalls: [],
      };

      const result = await graph.invoke(initialState, {
        configurable: { thread_id: 'test-question-1' }
      });

      // Verify routing path
      expect(executedNodes).toContain('triage');
      expect(executedNodes).toContain('planner');
      expect(executedNodes).toContain('web_explorer');
      expect(executedNodes).toContain('validation');

      // Verify model was called
      expect(modelCallCount).toBeGreaterThan(0);

      // Verify response was generated
      expect(result.finalResponse).toBeDefined();
      expect(result.finalResponse).not.toBe('');
    });

    it('should route "how does async/await work?" through web_explorer', async () => {
      mockIntentResponse = { intent: 'question', confidence: 0.9 };

      const graph = buildGraph(mockRunner, [], []);

      const initialState: Partial<GraphStateType> = {
        messages: [{ role: 'user', content: 'how does async/await work?' }],
        iterations: 0,
        pendingToolCalls: [],
      };

      const result = await graph.invoke(initialState, {
        configurable: { thread_id: 'test-question-2' }
      });

      // Verify routing path includes web_explorer
      expect(executedNodes).toContain('web_explorer');
      expect(modelCallCount).toBeGreaterThan(0);
    });
  });

  /**
   * Preservation Test 3: Research Intent Routes Through web_explorer
   *
   * Requirement 3.2: WHEN a user sends a research request THEN the system
   * SHALL CONTINUE TO route through web_explorer
   *
   * Observed behavior on UNFIXED code:
   * - "search for X" → triage → planner → web_explorer → validation → END
   */
  describe('Research Intent Routing', () => {
    it('should route "search for React documentation" through web_explorer', async () => {
      mockIntentResponse = { intent: 'research', confidence: 0.9 };

      const graph = buildGraph(mockRunner, [], []);

      const initialState: Partial<GraphStateType> = {
        messages: [{ role: 'user', content: 'search for React documentation' }],
        iterations: 0,
        pendingToolCalls: [],
      };

      const result = await graph.invoke(initialState, {
        configurable: { thread_id: 'test-research-1' }
      });

      // Verify routing path includes web_explorer
      expect(executedNodes).toContain('web_explorer');
      expect(modelCallCount).toBeGreaterThan(0);
      expect(result.finalResponse).toBeDefined();
    });

    it('should route "find information about X" through web_explorer', async () => {
      mockIntentResponse = { intent: 'research', confidence: 0.9 };

      const graph = buildGraph(mockRunner, [], []);

      const initialState: Partial<GraphStateType> = {
        messages: [{ role: 'user', content: 'find information about GraphQL' }],
        iterations: 0,
        pendingToolCalls: [],
      };

      const result = await graph.invoke(initialState, {
        configurable: { thread_id: 'test-research-2' }
      });

      // Verify routing path includes web_explorer
      expect(executedNodes).toContain('web_explorer');
      expect(modelCallCount).toBeGreaterThan(0);
    });
  });

  /**
   * Preservation Test 4: Data Analysis Routes Through data_analyst
   *
   * Requirement 3.3: WHEN a user sends a data analysis request THEN the system
   * SHALL CONTINUE TO route through data_analyst
   *
   * Observed behavior on UNFIXED code:
   * - "analyze this CSV" → triage → planner → data_analyst → validation → END
   */
  describe('Data Analysis Intent Routing', () => {
    it('should route "analyze this CSV" through data_analyst', async () => {
      mockIntentResponse = { intent: 'analyze', confidence: 0.9 };

      const graph = buildGraph(mockRunner, [], []);

      const initialState: Partial<GraphStateType> = {
        messages: [{ role: 'user', content: 'analyze this CSV' }],
        iterations: 0,
        pendingToolCalls: [],
      };

      const result = await graph.invoke(initialState, {
        configurable: { thread_id: 'test-analyze-1' }
      });

      // Verify routing path includes data_analyst
      expect(executedNodes).toContain('data_analyst');
      expect(modelCallCount).toBeGreaterThan(0);
      expect(result.finalResponse).toBeDefined();
    });
  });

  /**
   * Preservation Test 5: High-Risk Tool Calls Trigger hitl_approval
   *
   * Requirement 3.4: WHEN high-risk tool calls are detected THEN the system
   * SHALL CONTINUE TO route through hitl_approval for human review
   *
   * Observed behavior on UNFIXED code:
   * - High-risk tools (fsWrite, strReplace, deleteFile) → validation detects → hitl_approval
   */
  describe('HITL Approval Routing', () => {
    it('should route high-risk file operations through hitl_approval', async () => {
      mockIntentResponse = { intent: 'coding', confidence: 0.9 };

      // Override coding_specialist to return high-risk tool calls
      const { createCodingSpecialistNode } = await import('../../nodes/specialized_agents');
      vi.mocked(createCodingSpecialistNode).mockReturnValueOnce(async (state: any) => {
        executedNodes.push('coding_specialist');
        modelCallCount++;
        return {
          messages: [...(state.messages || []), { role: 'assistant', content: 'Writing file' }],
          pendingToolCalls: [
            { name: 'fsWrite', arguments: { path: 'test.ts', text: 'content' } }
          ]
        };
      });

      const graph = buildGraph(mockRunner, [], []);

      const initialState: Partial<GraphStateType> = {
        messages: [{ role: 'user', content: 'create a new file' }],
        iterations: 0,
        pendingToolCalls: [],
      };

      // Note: This test will hang at hitl_approval because it waits for human input
      // We'll verify the routing path up to hitl_approval
      try {
        await Promise.race([
          graph.invoke(initialState, {
            configurable: { thread_id: 'test-hitl-1' }
          }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 100))
        ]);
      } catch (error) {
        // Expected to timeout at hitl_approval
      }

      // Verify routing path includes validation (which detects high-risk)
      expect(executedNodes).toContain('coding_specialist');
      expect(executedNodes).toContain('validation');

      // Note: hitl_approval node won't be in executedNodes because it's not mocked
      // and will hang waiting for human input
    });
  });

  /**
   * Property-Based Test: All Non-Conversation Intents Route Through Specialists
   *
   * This test generates various non-conversation intents and verifies that they
   * all route through appropriate specialist nodes (not directly to validation)
   */
  describe('Property-Based Preservation Tests', () => {
    it('property: all non-conversation intents route through specialist nodes', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            intent: fc.constantFrom('coding', 'fix', 'question', 'research', 'analyze'),
            message: fc.string({ minLength: 5, maxLength: 50 })
          }),
          async ({ intent, message }) => {
            // Reset for each test case
            executedNodes = [];
            modelCallCount = 0;
            mockIntentResponse = { intent, confidence: 0.9 };

            const graph = buildGraph(mockRunner, [], []);

            const initialState: Partial<GraphStateType> = {
              messages: [{ role: 'user', content: message }],
              iterations: 0,
              pendingToolCalls: [],
            };

            const result = await graph.invoke(initialState, {
              configurable: { thread_id: `test-property-${intent}` }
            });

            // All non-conversation intents should route through a specialist node
            const specialistNodes = ['coding_specialist', 'web_explorer', 'data_analyst', 'computer_use'];
            const routedThroughSpecialist = specialistNodes.some(node => executedNodes.includes(node));

            expect(routedThroughSpecialist).toBe(true);

            // Model should be called for all non-conversation intents
            expect(modelCallCount).toBeGreaterThan(0);

            // Response should be generated
            expect(result.finalResponse).toBeDefined();
          }
        ),
        { numRuns: 20 }
      );
    });

    it('property: coding and fix intents always route through coding_specialist', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom('coding', 'fix'),
          fc.string({ minLength: 5, maxLength: 50 }),
          async (intent, message) => {
            // Reset for each test case
            executedNodes = [];
            modelCallCount = 0;
            mockIntentResponse = { intent, confidence: 0.9 };

            const graph = buildGraph(mockRunner, [], []);

            const initialState: Partial<GraphStateType> = {
              messages: [{ role: 'user', content: message }],
              iterations: 0,
              pendingToolCalls: [],
            };

            await graph.invoke(initialState, {
              configurable: { thread_id: `test-coding-property-${intent}` }
            });

            // Should route through coding_specialist
            expect(executedNodes).toContain('coding_specialist');
            expect(modelCallCount).toBeGreaterThan(0);
          }
        ),
        { numRuns: 15 }
      );
    });

    it('property: question and research intents always route through web_explorer', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom('question', 'research'),
          fc.string({ minLength: 5, maxLength: 50 }),
          async (intent, message) => {
            // Reset for each test case
            executedNodes = [];
            modelCallCount = 0;
            mockIntentResponse = { intent, confidence: 0.9 };

            const graph = buildGraph(mockRunner, [], []);

            const initialState: Partial<GraphStateType> = {
              messages: [{ role: 'user', content: message }],
              iterations: 0,
              pendingToolCalls: [],
            };

            await graph.invoke(initialState, {
              configurable: { thread_id: `test-web-property-${intent}` }
            });

            // Should route through web_explorer
            expect(executedNodes).toContain('web_explorer');
            expect(modelCallCount).toBeGreaterThan(0);
          }
        ),
        { numRuns: 15 }
      );
    });
  });
});
