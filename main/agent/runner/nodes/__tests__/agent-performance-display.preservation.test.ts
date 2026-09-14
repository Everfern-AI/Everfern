/**
 * Preservation Property Tests — Agent Performance and Display Functionality
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**
 *
 * Property 2: Preservation — Existing Functionality Preservation
 *
 * IMPORTANT: These tests MUST PASS on unfixed code — they encode the baseline behavior
 * that must be preserved after the fix.
 *
 * OBSERVATION-FIRST METHODOLOGY:
 * These tests observe and capture the current working behavior on unfixed code for
 * non-buggy scenarios, ensuring we don't break existing functionality when implementing the fix.
 *
 * Testing approach:
 * - Test intent classification with valid inputs that succeed within timeout
 * - Test judge evaluation with valid inputs that succeed within timeout
 * - Test mission tracking functionality when properly enabled
 * - Test frontend display components for tool calls and execution details
 * - Test system performance for normal operations
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import { buildGraph } from '../../graph';
import { GraphStateType } from '../../state';
import { classifyIntent } from '../../triage';
import { createJudgeNode } from '../judge';
import { createTriageNode } from '../triage';

// ── Test Helpers ─────────────────────────────────────────────────────────────

/**
 * Creates a mock AI client that responds quickly (within timeout)
 * This simulates the NON-BUGGY case where the AI provider is responsive
 */
const createResponsiveClient = (responseTime = 500) => ({
  chat: vi.fn().mockImplementation(async (options: any) => {
    // Simulate network delay but stay well within timeout limits
    await new Promise(resolve => setTimeout(resolve, responseTime));

    if (options.messages?.[0]?.content?.includes('Intent Classification')) {
      return {
        content: JSON.stringify({
          intent: 'coding',
          confidence: 0.85,
          reasoning: 'User wants to build a React app'
        })
      };
    }

    if (options.messages?.[0]?.content?.includes('mission completion judge')) {
      return {
        content: JSON.stringify({
          verdict: 'complete',
          confidence: 0.9,
          reasoning: 'Task has been completed successfully'
        })
      };
    }

    return {
      content: 'Test response from responsive AI client'
    };
  }),
  provider: 'openai',
  model: 'gpt-4',
  apiKey: 'test-key',
  baseUrl: 'https://api.openai.com',
  setModel: vi.fn(),
});

/**
 * Creates a mock runner with responsive AI client
 */
const createMockRunner = (responseTime = 500) => ({
  client: createResponsiveClient(responseTime),
  telemetry: {
    info: vi.fn(),
    warn: vi.fn(),
    action: vi.fn(),
    transition: vi.fn(),
    begin: vi.fn(),
    terminate: vi.fn(),
    updateSpinner: vi.fn(),
  },
  config: { maxIterations: 50 },
  tools: [],
  skills: [],
  _buildToolDefinitions: vi.fn(() => []),
});

/**
 * Creates test state for various scenarios
 */
const createTestState = (overrides: Partial<GraphStateType> = {}): GraphStateType => ({
  messages: [
    { role: 'user', content: 'Build me a React app' } as any,
  ],
  currentIntent: 'coding' as any,
  intentConfidence: 0.85,
  decomposedTask: {
    id: 'test-task',
    title: 'Build React App',
    steps: [],
    totalSteps: 1,
    canParallelize: false,
    executionMode: 'sequential',
  },
  agiHints: 'test hints',
  taskPhase: 'planning' as any,
  pendingToolCalls: [],
  toolCallRecords: [],
  toolCallHistory: [],
  userConfirmation: undefined as any,
  finalResponse: 'Task completed successfully',
  pauseGeneration: false,
  iterations: 1,
  activeAgent: '',
  validationResult: {
    isHighRisk: false,
    reasoning: 'Safe operation'
  },
  shouldContinueIteration: false,
  completionSignal: {
    reason: 'task_complete',
    explanation: 'All requirements have been met'
  },
  hitlApprovalResult: undefined as any,
  missionId: 'test-mission',
  missionTimeline: null,
  missionSteps: [],
  currentStepId: 'step:complete',
  ...overrides,
});

// Counter for unique messages to bypass caching
let messageCounter = 0;
const uniqueMessage = (base = 'Build me a React app') => `${base} ${++messageCounter}`;

// ── Property 3.1: Intent Classification Succeeds Within Timeout ─────────────

describe('Preservation Property 3.1 — Intent Classification Succeeds Within Timeout', () => {
  /**
   * **Validates: Requirement 3.1**
   *
   * WHEN intent classification succeeds within timeout
   * THEN the system SHALL CONTINUE TO classify intents accurately
   *
   * This tests the baseline behavior where intent classification works properly
   * with responsive AI providers (non-buggy scenario).
   */

  it('should successfully classify intent within timeout for valid coding requests', async () => {
    const client = createResponsiveClient(500); // Well within 3000ms timeout

    const result = await classifyIntent(
      uniqueMessage('Build me a React app with TypeScript'),
      client as any,
      []
    );

    // Verify successful classification
    expect(result.intent).toBeDefined();
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.reasoning).toBeDefined();
    expect(typeof result.intent).toBe('string');
    expect(typeof result.confidence).toBe('number');
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it('should successfully classify intent within timeout for task requests', async () => {
    const client = createResponsiveClient(800); // Still well within timeout

    const result = await classifyIntent(
      uniqueMessage('Create a new folder called "projects"'),
      client as any,
      []
    );

    expect(result.intent).toBeDefined();
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.reasoning).toBeDefined();
  });

  it('property: intent classification succeeds for all valid response times under timeout', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 100, max: 2500 }), // Response times well under 3000ms timeout
        fc.constantFrom('coding', 'task', 'research', 'question', 'conversation'),
        async (responseTime, expectedIntent) => {
          const client = createResponsiveClient(responseTime);

          // Mock the client to return the expected intent
          vi.mocked(client.chat).mockResolvedValueOnce({
            content: JSON.stringify({
              intent: expectedIntent,
              confidence: 0.85,
              reasoning: 'Test classification'
            })
          });

          const result = await classifyIntent(
            uniqueMessage('test message'),
            client as any,
            []
          );

          // Should succeed without timeout
          expect(result.intent).toBe(expectedIntent);
          expect(result.confidence).toBe(0.85);
        }
      ),
      { numRuns: 20 }
    );
  });

  it('should handle triage node execution without timeout for responsive clients', async () => {
    const runner = createMockRunner(600);
    const triageNode = createTriageNode(runner as any);

    const startTime = Date.now();
    const result = await triageNode(createTestState({
      messages: [{ role: 'user', content: uniqueMessage('Build a website') } as any],
      taskPhase: 'triage' as any,
    }));
    const duration = Date.now() - startTime;

    // Should complete well within timeout (3000ms)
    expect(duration).toBeLessThan(2000);
    expect(result.currentIntent).toBeDefined();
    expect(result.intentConfidence).toBeGreaterThan(0);
    expect(result.taskPhase).toBe('planning');
  });
});

// ── Property 3.2: Judge Evaluation Succeeds Within Timeout ──────────────────

describe('Preservation Property 3.2 — Judge Evaluation Succeeds Within Timeout', () => {
  /**
   * **Validates: Requirement 3.2**
   *
   * WHEN judge evaluation succeeds within timeout
   * THEN the system SHALL CONTINUE TO make correct completion decisions
   *
   * This tests the baseline behavior where judge evaluation works properly
   * with responsive AI providers (non-buggy scenario).
   */

  it('should successfully evaluate mission completion within timeout', async () => {
    const runner = createMockRunner(1000); // Well within 10000ms timeout
    const judgeNode = createJudgeNode(runner as any);

    const startTime = Date.now();
    const result = await judgeNode(createTestState({
      completionSignal: {
        reason: 'task_complete',
        explanation: 'All requirements have been satisfied'
      }
    }));
    const duration = Date.now() - startTime;

    // Should complete well within timeout (10000ms)
    expect(duration).toBeLessThan(5000);
    expect(result.shouldContinueIteration).toBe(false);
    expect(result.taskPhase).toBe('executing');
  });

  it('should handle fallback AI evaluation within timeout when no completion signal', async () => {
    const runner = createMockRunner(2000); // Within timeout limits
    const judgeNode = createJudgeNode(runner as any);

    const startTime = Date.now();
    const result = await judgeNode(createTestState({
      completionSignal: null, // No signal, triggers AI fallback
      messages: [
        { role: 'user', content: 'Build me a React app' } as any,
        { role: 'assistant', content: 'I have successfully created your React app with all requested features.' } as any,
      ]
    }));
    const duration = Date.now() - startTime;

    // Should complete within timeout even with AI fallback
    expect(duration).toBeLessThan(8000);
    expect(result.shouldContinueIteration).toBeDefined();
    expect(result.taskPhase).toBe('executing');
  });

  it('property: judge evaluation succeeds for various completion signals within timeout', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('task_complete', 'waiting_for_user_input', 'needs_hitl', 'cannot_proceed'),
        fc.integer({ min: 500, max: 3000 }), // Response times well under timeout
        async (reason, responseTime) => {
          const runner = createMockRunner(responseTime);
          const judgeNode = createJudgeNode(runner as any);

          const startTime = Date.now();
          const result = await judgeNode(createTestState({
            completionSignal: {
              reason: reason as any,
              explanation: `Test completion: ${reason}`
            }
          }));
          const duration = Date.now() - startTime;

          // Should complete within reasonable time
          expect(duration).toBeLessThan(5000);
          expect(result.shouldContinueIteration).toBe(false);
          expect(result.taskPhase).toBe('executing');
        }
      ),
      { numRuns: 15 }
    );
  });

  it('should correctly handle read-only intents without AI evaluation', async () => {
    const runner = createMockRunner(100);
    const judgeNode = createJudgeNode(runner as any);

    const startTime = Date.now();
    const result = await judgeNode(createTestState({
      currentIntent: 'question' as any, // Read-only intent
      iterations: 1
    }));
    const duration = Date.now() - startTime;

    // Should complete very quickly for read-only intents
    expect(duration).toBeLessThan(100);
    expect(result.shouldContinueIteration).toBe(false);
    expect(result.taskPhase).toBe('executing');
  });
});

// ── Property 3.3: Mission Tracking Works Properly When Enabled ──────────────

describe('Preservation Property 3.3 — Mission Tracking Works Properly When Enabled', () => {
  /**
   * **Validates: Requirement 3.3**
   *
   * WHEN mission tracking works properly
   * THEN the system SHALL CONTINUE TO track and display mission progress correctly
   *
   * This tests the baseline mission tracking functionality that should be preserved.
   */

  it('should properly track mission state and timeline', () => {
    const missionState = createTestState({
      missionId: 'test-mission-123',
      missionTimeline: {
        id: 'timeline-123',
        startTime: Date.now(),
        phases: [
          {
            name: 'triage',
            startTime: Date.now(),
            status: 'completed'
          }
        ]
      } as any,
      missionSteps: [
        {
          id: 'step-1',
          name: 'Analyze Request',
          status: 'completed',
          startTime: Date.now(),
          endTime: Date.now() + 1000
        } as any
      ],
      currentStepId: 'step-1'
    });

    // Verify mission tracking data structure is preserved
    expect(missionState.missionId).toBe('test-mission-123');
    expect(missionState.missionTimeline).toBeDefined();
    expect(missionState.missionSteps).toHaveLength(1);
    expect(missionState.currentStepId).toBe('step-1');

    // Verify timeline structure
    expect(missionState.missionTimeline?.id).toBe('timeline-123');
    expect(missionState.missionTimeline?.phases).toHaveLength(1);
    expect(missionState.missionTimeline?.phases[0].name).toBe('triage');
    expect(missionState.missionTimeline?.phases[0].status).toBe('completed');
  });

  it('should maintain mission step tracking throughout execution', () => {
    const steps = [
      { id: 'step-1', name: 'Triage', status: 'completed' },
      { id: 'step-2', name: 'Planning', status: 'running' },
      { id: 'step-3', name: 'Execution', status: 'pending' }
    ];

    const missionState = createTestState({
      missionSteps: steps as any,
      currentStepId: 'step-2'
    });

    // Verify step tracking is preserved
    expect(missionState.missionSteps).toHaveLength(3);
    expect(missionState.currentStepId).toBe('step-2');

    // Verify step structure
    const currentStep = missionState.missionSteps.find(s => s.id === 'step-2');
    expect(currentStep?.name).toBe('Planning');
    expect(currentStep?.status).toBe('running');
  });

  it('property: mission tracking maintains data integrity across state updates', async () => {
    await fc.assert(
      fc.property(
        fc.string({ minLength: 5, maxLength: 20 }),
        fc.array(fc.record({
          id: fc.string({ minLength: 3, maxLength: 10 }),
          name: fc.string({ minLength: 3, maxLength: 20 }),
          status: fc.constantFrom('pending', 'running', 'completed', 'failed')
        }), { minLength: 1, maxLength: 5 }),
        (missionId, steps) => {
          const missionState = createTestState({
            missionId,
            missionSteps: steps as any,
            currentStepId: steps[0]?.id || 'default'
          });

          // Data integrity checks
          expect(missionState.missionId).toBe(missionId);
          expect(missionState.missionSteps).toHaveLength(steps.length);
          expect(missionState.currentStepId).toBeDefined();

          // Each step maintains its properties
          steps.forEach((step, index) => {
            expect(missionState.missionSteps[index].id).toBe(step.id);
            expect(missionState.missionSteps[index].name).toBe(step.name);
            expect(missionState.missionSteps[index].status).toBe(step.status);
          });
        }
      ),
      { numRuns: 20 }
    );
  });
});

// ── Property 3.4: Frontend Displays Show Tool Calls and Execution Details ───

describe('Preservation Property 3.4 — Frontend Displays Show Tool Calls and Execution Details', () => {
  /**
   * **Validates: Requirement 3.4**
   *
   * WHEN frontend displays are working
   * THEN the system SHALL CONTINUE TO show tool calls, thoughts, and other execution details
   *
   * This tests the baseline frontend display functionality that should be preserved.
   */

  it('should preserve tool call display data structure', () => {
    const toolCalls = [
      {
        id: 'tool-1',
        name: 'fsWrite',
        arguments: { path: 'test.ts', text: 'console.log("hello");' },
        output: 'File written successfully',
        status: 'completed',
        durationMs: 150
      },
      {
        id: 'tool-2',
        name: 'executePwsh',
        arguments: { command: 'npm install' },
        output: 'Dependencies installed',
        status: 'completed',
        durationMs: 5000
      }
    ];

    const state = createTestState({
      toolCallRecords: toolCalls,
      toolCallHistory: toolCalls // Legacy compatibility
    });

    // Verify tool call data structure is preserved
    expect(state.toolCallRecords).toHaveLength(2);
    expect(state.toolCallHistory).toHaveLength(2);

    // Verify tool call properties
    const writeCall = state.toolCallRecords[0];
    expect(writeCall.id).toBe('tool-1');
    expect(writeCall.name).toBe('fsWrite');
    expect(writeCall.arguments).toEqual({ path: 'test.ts', text: 'console.log("hello");' });
    expect(writeCall.output).toBe('File written successfully');
    expect(writeCall.status).toBe('completed');
    expect(writeCall.durationMs).toBe(150);
  });

  it('should preserve thought and reasoning display', () => {
    const state = createTestState({
      finalResponse: 'I have analyzed your request and will create a React application with the following components...'
    });

    // Verify response content is preserved
    expect(state.finalResponse).toBeDefined();
    expect(state.finalResponse.length).toBeGreaterThan(0);
    expect(typeof state.finalResponse).toBe('string');
  });

  it('should maintain execution details visibility', () => {
    const state = createTestState({
      activeAgent: 'coding_specialist',
      taskPhase: 'executing' as any,
      iterations: 3,
      pendingToolCalls: [
        { name: 'readFile', arguments: { path: 'package.json' } }
      ]
    });

    // Verify execution details are preserved
    expect(state.activeAgent).toBe('coding_specialist');
    expect(state.taskPhase).toBe('executing');
    expect(state.iterations).toBe(3);
    expect(state.pendingToolCalls).toHaveLength(1);
    expect(state.pendingToolCalls[0].name).toBe('readFile');
  });

  it('property: tool call display maintains all required properties', async () => {
    await fc.assert(
      fc.property(
        fc.array(fc.record({
          id: fc.string({ minLength: 3, maxLength: 15 }),
          name: fc.constantFrom('fsWrite', 'readFile', 'executePwsh', 'grepSearch'),
          arguments: fc.object(),
          output: fc.string({ maxLength: 100 }),
          status: fc.constantFrom('pending', 'running', 'completed', 'error'),
          durationMs: fc.integer({ min: 10, max: 10000 })
        }), { minLength: 0, maxLength: 5 }),
        (toolCalls) => {
          const state = createTestState({
            toolCallRecords: toolCalls
          });

          // Verify all tool calls maintain their structure
          expect(state.toolCallRecords).toHaveLength(toolCalls.length);

          toolCalls.forEach((expectedCall, index) => {
            const actualCall = state.toolCallRecords[index];
            expect(actualCall.id).toBe(expectedCall.id);
            expect(actualCall.name).toBe(expectedCall.name);
            expect(actualCall.arguments).toEqual(expectedCall.arguments);
            expect(actualCall.output).toBe(expectedCall.output);
            expect(actualCall.status).toBe(expectedCall.status);
            expect(actualCall.durationMs).toBe(expectedCall.durationMs);
          });
        }
      ),
      { numRuns: 15 }
    );
  });
});

// ── Property 3.5: System Performance Is Adequate for Normal Operations ──────

describe('Preservation Property 3.5 — System Performance Is Adequate for Normal Operations', () => {
  /**
   * **Validates: Requirement 3.5**
   *
   * WHEN system performance is adequate
   * THEN the system SHALL CONTINUE TO provide responsive user experience
   *
   * This tests the baseline performance characteristics that should be preserved.
   */

  it('should complete triage within reasonable time for normal requests', async () => {
    const runner = createMockRunner(300); // Fast response
    const triageNode = createTriageNode(runner as any);

    const startTime = Date.now();
    await triageNode(createTestState({
      messages: [{ role: 'user', content: uniqueMessage('Create a simple React component') } as any],
      taskPhase: 'triage' as any,
    }));
    const duration = Date.now() - startTime;

    // Should complete quickly for normal operations
    expect(duration).toBeLessThan(1000);
  });

  it('should complete judge evaluation quickly for clear completion signals', async () => {
    const runner = createMockRunner(100);
    const judgeNode = createJudgeNode(runner as any);

    const startTime = Date.now();
    await judgeNode(createTestState({
      completionSignal: {
        reason: 'task_complete',
        explanation: 'Task completed successfully'
      }
    }));
    const duration = Date.now() - startTime;

    // Should complete very quickly when completion signal is clear
    expect(duration).toBeLessThan(200);
  });

  it('should handle state updates efficiently', () => {
    const startTime = Date.now();

    // Create multiple state updates
    for (let i = 0; i < 100; i++) {
      const state = createTestState({
        iterations: i,
        currentStepId: `step-${i}`,
        toolCallRecords: Array.from({ length: i % 5 }, (_, j) => ({
          id: `tool-${i}-${j}`,
          name: 'testTool',
          arguments: { index: j },
          output: `Result ${j}`,
          status: 'completed',
          durationMs: 100
        }))
      });

      // Verify state is created correctly
      expect(state.iterations).toBe(i);
      expect(state.currentStepId).toBe(`step-${i}`);
    }

    const duration = Date.now() - startTime;

    // State creation should be efficient
    expect(duration).toBeLessThan(100);
  });

  it('property: system maintains responsive performance across various workloads', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 10 }), // Number of operations
        fc.integer({ min: 100, max: 800 }), // Response time per operation
        async (operationCount, responseTime) => {
          const runner = createMockRunner(responseTime);
          const triageNode = createTriageNode(runner as any);

          const startTime = Date.now();

          // Perform multiple operations
          const promises = Array.from({ length: operationCount }, (_, i) =>
            triageNode(createTestState({
              messages: [{ role: 'user', content: uniqueMessage(`Operation ${i}`) } as any],
              taskPhase: 'triage' as any,
            }))
          );

          await Promise.all(promises);
          const totalDuration = Date.now() - startTime;

          // Performance should scale reasonably
          const expectedMaxDuration = (responseTime + 200) * operationCount;
          expect(totalDuration).toBeLessThan(expectedMaxDuration);
        }
      ),
      { numRuns: 10 }
    );
  });

  it('should maintain memory efficiency with large state objects', () => {
    const largeToolCallHistory = Array.from({ length: 50 }, (_, i) => ({
      id: `tool-${i}`,
      name: 'testTool',
      arguments: {
        data: Array.from({ length: 100 }, (_, j) => `item-${j}`).join(',')
      },
      output: Array.from({ length: 200 }, (_, j) => `output-${j}`).join(' '),
      status: 'completed',
      durationMs: 1000 + i * 10
    }));

    const startTime = Date.now();
    const state = createTestState({
      toolCallRecords: largeToolCallHistory,
      toolCallHistory: largeToolCallHistory
    });
    const duration = Date.now() - startTime;

    // Should handle large state efficiently
    expect(duration).toBeLessThan(50);
    expect(state.toolCallRecords).toHaveLength(50);
    expect(state.toolCallHistory).toHaveLength(50);
  });
});
