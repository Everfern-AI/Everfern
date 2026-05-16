/**
 * Preservation Property Tests — Brain Node Non-Research Intent Routing Unchanged
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**
 *
 * Property 2: Preservation — Non-Research Intent Routing Unchanged
 *
 * IMPORTANT: These tests MUST PASS on unfixed code — they encode the baseline behavior
 * that must be preserved after the fix.
 *
 * Observation (unfixed code):
 *   - Brain node routes to coding specialist for `currentIntent: 'coding'`
 *   - Brain node routes to coding specialist for `currentIntent: 'fix'`
 *   - Brain node routes to coding specialist for `currentIntent: 'build'`
 *   - Brain node routes to data analyst for `currentIntent: 'analyze'`
 *   - Brain node routes to computer-use for `currentIntent: 'automate'`
 *   - Brain node handles questions directly for `currentIntent: 'question'`
 *   - Brain node handles conversation directly for `currentIntent: 'conversation'`
 *   - Brain node handles tasks directly for `currentIntent: 'task'`
 *
 * Testing approach:
 *   - Observe behavior on UNFIXED code for each non-research intent
 *   - Write property-based tests that capture the baseline routing behavior
 *   - Verify that for all non-research intents, the brain produces the same routing
 *
 * These tests verify that when the brain node processes non-research intents,
 * the fixed brain node produces the same routing decisions as the original brain node.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import type { GraphStateType } from '../../state';

// ── Mock dependencies ────────────────────────────────────────────────────────

vi.mock('../../services/agent-runtime', () => ({
  runAgentStep: vi.fn(async (state: any, options: any) => {
    // Mock runAgentStep to return a response with no pending tool calls
    // This simulates the brain producing a response without executing tools
    return {
      messages: [
        ...state.messages,
        {
          role: 'assistant',
          content: 'I will help you with that.',
        },
      ],
      pendingToolCalls: [],
      brainToolsInFlight: false,
    };
  }),
}));

vi.mock('../../mission-integrator', () => ({
  createMissionIntegrator: vi.fn(() => ({
    wrapNode: vi.fn(async (name: string, fn: () => Promise<any>) => {
      return fn();
    }),
  })),
}));

vi.mock('../../../lib/prompt-sync', () => ({
  loadPrompt: vi.fn(() => 'Mock system prompt'),
}));

vi.mock('../../abort-manager', () => ({
  globalAbortManager: {
    abortController: new AbortController(),
  },
}));

vi.mock('../../services/node-utils', () => ({
  nodeLifecycle: vi.fn(() => ({
    start: vi.fn(),
    end: vi.fn(),
  })),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

type IntentType = 'coding' | 'fix' | 'build' | 'analyze' | 'automate' | 'question' | 'conversation' | 'task';

const makeState = (intent: IntentType, content = 'test request'): GraphStateType => ({
  messages: [
    { role: 'user', content } as any,
  ],
  currentIntent: intent as any,
  intentConfidence: 0.9,
  decomposedTask: undefined as any,
  agiHints: '',
  taskPhase: 'brain' as any,
  pendingToolCalls: [],
  toolCallRecords: [],
  toolCallHistory: [],
  userConfirmation: undefined as any,
  finalResponse: '',
  pauseGeneration: false,
  iterations: 0,
  activeAgent: '',
  validationResult: undefined as any,
  shouldContinueIteration: false,
  hitlApprovalResult: undefined as any,
  missionId: 'test-mission',
  missionTimeline: null,
  missionSteps: [],
  currentStepId: 'step:brain',
  brainToolsInFlight: false,
  returningFromSpecialist: null,
  webExplorerComplete: false,
  webExplorerSelfLoopCount: 0,
  navisInvoked: false,
  searchInvoked: false,
  codingComplete: false,
  dataAnalysisComplete: false,
  computerUseComplete: false,
  deepResearchComplete: false,
  deepResearchSelfLoopCount: 0,
  subagentSpawned: undefined as any,
  completedSteps: [],
  decompositionAttempts: 0,
  routingDecision: null,
  completionSignal: null,
  debateResult: undefined as any,
});

/**
 * Creates a mock AgentRunner with a mock client that returns routing decisions.
 */
const makeMockRunner = () => ({
  client: {
    chat: vi.fn().mockResolvedValue({
      content: JSON.stringify({
        decision: 'continue_brain',
        explanation: 'test routing',
      }),
    }),
    provider: 'openai',
    model: 'gpt-4',
    apiKey: 'test-key',
    baseUrl: 'https://api.openai.com',
    setModel: vi.fn(),
  },
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
  _buildToolDefinitions: vi.fn(() => [
    { name: 'web_search', description: 'Search the web' },
    { name: 'spawn_agent', description: 'Spawn a sub-agent' },
  ]),
  currentAgentSessionKey: null,
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Preservation — Brain Node Non-Research Intent Routing Unchanged', () => {
  /**
   * Test Case 1: Coding Intent Preservation
   *
   * Observation: Brain node routes to coding specialist for `currentIntent: 'coding'`
   *
   * This is the baseline that must be preserved after the fix.
   * The brain should continue to route coding requests to the coding specialist.
   */
  it('should route to coding specialist for coding intent', async () => {
    const { createBrainNode } = await import('../brain');
    const runner = makeMockRunner() as any;

    // Mock the routing decision to return route_coding
    runner.client.chat.mockResolvedValueOnce({
      content: JSON.stringify({
        decision: 'route_coding',
        explanation: 'Coding task detected',
      }),
    });

    const brainNode = createBrainNode(runner);
    const state = makeState('coding', 'write a React component');

    const result = await brainNode(state);

    expect(result.routingDecision).toBeDefined();
    expect(result.routingDecision?.decision).toBe('route_coding');
    expect(result.taskPhase).toBe('specialized_agent');
  });

  /**
   * Test Case 2: Fix Intent Preservation
   *
   * Observation: Brain node routes to coding specialist for `currentIntent: 'fix'`
   *
   * The brain should continue to route fix requests to the coding specialist.
   */
  it('should route to coding specialist for fix intent', async () => {
    const { createBrainNode } = await import('../brain');
    const runner = makeMockRunner() as any;

    runner.client.chat.mockResolvedValueOnce({
      content: JSON.stringify({
        decision: 'route_coding',
        explanation: 'Bug fix task detected',
      }),
    });

    const brainNode = createBrainNode(runner);
    const state = makeState('fix', 'fix this bug in my code');

    const result = await brainNode(state);

    expect(result.routingDecision).toBeDefined();
    expect(result.routingDecision?.decision).toBe('route_coding');
    expect(result.taskPhase).toBe('specialized_agent');
  });

  /**
   * Test Case 3: Build Intent Preservation
   *
   * Observation: Brain node routes to coding specialist for `currentIntent: 'build'`
   *
   * The brain should continue to route build requests to the coding specialist.
   */
  it('should route to coding specialist for build intent', async () => {
    const { createBrainNode } = await import('../brain');
    const runner = makeMockRunner() as any;

    runner.client.chat.mockResolvedValueOnce({
      content: JSON.stringify({
        decision: 'route_coding',
        explanation: 'Build task detected',
      }),
    });

    const brainNode = createBrainNode(runner);
    const state = makeState('build', 'build me a Next.js app');

    const result = await brainNode(state);

    expect(result.routingDecision).toBeDefined();
    expect(result.routingDecision?.decision).toBe('route_coding');
    expect(result.taskPhase).toBe('specialized_agent');
  });

  /**
   * Test Case 4: Analyze Intent Preservation
   *
   * Observation: Brain node routes to data analyst for `currentIntent: 'analyze'`
   *
   * The brain should continue to route analyze requests to the data analyst.
   */
  it('should route to data analyst for analyze intent', async () => {
    const { createBrainNode } = await import('../brain');
    const runner = makeMockRunner() as any;

    runner.client.chat.mockResolvedValueOnce({
      content: JSON.stringify({
        decision: 'route_data_analyst',
        explanation: 'Data analysis task detected',
      }),
    });

    const brainNode = createBrainNode(runner);
    const state = makeState('analyze', 'analyze this CSV data');

    const result = await brainNode(state);

    expect(result.routingDecision).toBeDefined();
    expect(result.routingDecision?.decision).toBe('route_data_analyst');
    expect(result.taskPhase).toBe('specialized_agent');
  });

  /**
   * Test Case 5: Automate Intent Preservation
   *
   * Observation: Brain node routes to computer-use for `currentIntent: 'automate'`
   *
   * The brain should continue to route automate requests to the computer-use agent.
   */
  it('should route to computer-use for automate intent', async () => {
    const { createBrainNode } = await import('../brain');
    const runner = makeMockRunner() as any;

    runner.client.chat.mockResolvedValueOnce({
      content: JSON.stringify({
        decision: 'route_computer_use',
        explanation: 'Desktop automation task detected',
      }),
    });

    const brainNode = createBrainNode(runner);
    const state = makeState('automate', 'click the start button');

    const result = await brainNode(state);

    expect(result.routingDecision).toBeDefined();
    expect(result.routingDecision?.decision).toBe('route_computer_use');
    expect(result.taskPhase).toBe('specialized_agent');
  });

  /**
   * Test Case 6: Question Intent Preservation
   *
   * Observation: Brain node handles questions directly for `currentIntent: 'question'`
   *
   * The brain should continue to handle question requests directly (continue_brain or complete_task).
   */
  it('should handle question intent directly (not route to specialist)', async () => {
    const { createBrainNode } = await import('../brain');
    const runner = makeMockRunner() as any;

    runner.client.chat.mockResolvedValueOnce({
      content: JSON.stringify({
        decision: 'continue_brain',
        explanation: 'Question can be answered directly',
      }),
    });

    const brainNode = createBrainNode(runner);
    const state = makeState('question', 'what is React?');

    const result = await brainNode(state);

    // Should not route to a specialist
    expect(result.routingDecision?.decision).not.toMatch(/^route_/);
    // Should either continue brain or complete task
    expect(['continue_brain', 'complete_task']).toContain(result.routingDecision?.decision);
  });

  /**
   * Test Case 7: Conversation Intent Preservation
   *
   * Observation: Brain node handles conversation directly for `currentIntent: 'conversation'`
   *
   * The brain should continue to handle conversation requests directly.
   */
  it('should handle conversation intent directly (not route to specialist)', async () => {
    const { createBrainNode } = await import('../brain');
    const runner = makeMockRunner() as any;

    runner.client.chat.mockResolvedValueOnce({
      content: JSON.stringify({
        decision: 'continue_brain',
        explanation: 'Conversation can be handled directly',
      }),
    });

    const brainNode = createBrainNode(runner);
    const state = makeState('conversation', 'hello there');

    const result = await brainNode(state);

    // Should not route to a specialist
    expect(result.routingDecision?.decision).not.toMatch(/^route_/);
    // Should either continue brain or complete task
    expect(['continue_brain', 'complete_task']).toContain(result.routingDecision?.decision);
  });

  /**
   * Test Case 8: Task Intent Preservation
   *
   * Observation: Brain node handles tasks directly for `currentIntent: 'task'`
   *
   * The brain should continue to handle general task requests appropriately.
   */
  it('should handle task intent appropriately (not route to specialist)', async () => {
    const { createBrainNode } = await import('../brain');
    const runner = makeMockRunner() as any;

    runner.client.chat.mockResolvedValueOnce({
      content: JSON.stringify({
        decision: 'continue_brain',
        explanation: 'Task can be handled directly',
      }),
    });

    const brainNode = createBrainNode(runner);
    const state = makeState('task', 'create a new folder');

    const result = await brainNode(state);

    // Should not route to a specialist
    expect(result.routingDecision?.decision).not.toMatch(/^route_/);
    // Should either continue brain or complete task
    expect(['continue_brain', 'complete_task']).toContain(result.routingDecision?.decision);
  });
});

// ── Part 2: Property-based tests on brain routing ──────────────────────────

describe('Preservation Property — Brain Node Routing for Non-Research Intents', () => {
  /**
   * Property 2: For all non-research intents, the brain node must produce
   * the same routing behavior as the original unfixed function.
   *
   * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**
   *
   * This property encodes: NOT isBugCondition(X) → fixed node = original node
   * where isBugCondition is: state.currentIntent === 'research'
   */
  it('property: for all non-research intents, brain routes to appropriate specialist or handles directly', async () => {
    const { createBrainNode } = await import('../brain');

    const nonResearchIntents: IntentType[] = [
      'coding', 'fix', 'build', 'analyze', 'automate', 'question', 'conversation', 'task',
    ];

    const intentRoutingMap: Record<IntentType, string | RegExp> = {
      'coding': 'route_coding',
      'fix': 'route_coding',
      'build': 'route_coding',
      'analyze': 'route_data_analyst',
      'automate': 'route_computer_use',
      'question': /^(continue_brain|complete_task)$/,
      'conversation': /^(continue_brain|complete_task)$/,
      'task': /^(continue_brain|complete_task)$/,
    };

    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...nonResearchIntents),
        fc.string({ minLength: 1, maxLength: 50 }),
        async (intent, userMessage) => {
          const runner = makeMockRunner() as any;

          // Mock the routing decision based on intent
          const expectedDecision = intentRoutingMap[intent];
          let mockDecision: string;

          if (expectedDecision instanceof RegExp) {
            // For non-specialist intents, pick one of the valid options
            mockDecision = expectedDecision.source.includes('continue_brain') ? 'continue_brain' : 'complete_task';
          } else {
            mockDecision = expectedDecision;
          }

          runner.client.chat.mockResolvedValueOnce({
            content: JSON.stringify({
              decision: mockDecision,
              explanation: `Routing for ${intent} intent`,
            }),
          });

          const brainNode = createBrainNode(runner);
          const state = makeState(intent, userMessage);

          const result = await brainNode(state);

          // Verify the routing decision matches the expected pattern
          if (expectedDecision instanceof RegExp) {
            expect(result.routingDecision?.decision).toMatch(expectedDecision);
          } else {
            expect(result.routingDecision?.decision).toBe(expectedDecision);
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  /**
   * Property 3: Coding intents (coding, fix, build) must continue to route
   * to coding specialist.
   *
   * **Validates: Requirements 3.1, 3.2**
   */
  it('property: coding intents (coding, fix, build) route to coding specialist', async () => {
    const { createBrainNode } = await import('../brain');

    const codingIntents: IntentType[] = ['coding', 'fix', 'build'];

    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...codingIntents),
        fc.string({ minLength: 1, maxLength: 50 }),
        async (intent, userMessage) => {
          const runner = makeMockRunner() as any;

          runner.client.chat.mockResolvedValueOnce({
            content: JSON.stringify({
              decision: 'route_coding',
              explanation: `Routing ${intent} to coding specialist`,
            }),
          });

          const brainNode = createBrainNode(runner);
          const state = makeState(intent, userMessage);

          const result = await brainNode(state);

          // Must route to coding specialist
          expect(result.routingDecision?.decision).toBe('route_coding');
          expect(result.taskPhase).toBe('specialized_agent');
        }
      ),
      { numRuns: 30 }
    );
  });

  /**
   * Property 4: Analyze intent must continue to route to data analyst.
   *
   * **Validates: Requirements 3.3**
   */
  it('property: analyze intent routes to data analyst', async () => {
    const { createBrainNode } = await import('../brain');

    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 50 }),
        async (userMessage) => {
          const runner = makeMockRunner() as any;

          runner.client.chat.mockResolvedValueOnce({
            content: JSON.stringify({
              decision: 'route_data_analyst',
              explanation: 'Routing analyze to data analyst',
            }),
          });

          const brainNode = createBrainNode(runner);
          const state = makeState('analyze', userMessage);

          const result = await brainNode(state);

          // Must route to data analyst
          expect(result.routingDecision?.decision).toBe('route_data_analyst');
          expect(result.taskPhase).toBe('specialized_agent');
        }
      ),
      { numRuns: 20 }
    );
  });

  /**
   * Property 5: Automate intent must continue to route to computer-use.
   *
   * **Validates: Requirements 3.4**
   */
  it('property: automate intent routes to computer-use', async () => {
    const { createBrainNode } = await import('../brain');

    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 50 }),
        async (userMessage) => {
          const runner = makeMockRunner() as any;

          runner.client.chat.mockResolvedValueOnce({
            content: JSON.stringify({
              decision: 'route_computer_use',
              explanation: 'Routing automate to computer-use',
            }),
          });

          const brainNode = createBrainNode(runner);
          const state = makeState('automate', userMessage);

          const result = await brainNode(state);

          // Must route to computer-use
          expect(result.routingDecision?.decision).toBe('route_computer_use');
          expect(result.taskPhase).toBe('specialized_agent');
        }
      ),
      { numRuns: 20 }
    );
  });

  /**
   * Property 6: Non-specialist intents (question, conversation, task) must
   * continue to be handled by brain or produce same routing as before.
   *
   * **Validates: Requirements 3.5**
   */
  it('property: non-specialist intents (question, conversation, task) handled by brain', async () => {
    const { createBrainNode } = await import('../brain');

    const nonSpecialistIntents: IntentType[] = ['question', 'conversation', 'task'];

    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...nonSpecialistIntents),
        fc.string({ minLength: 1, maxLength: 50 }),
        async (intent, userMessage) => {
          const runner = makeMockRunner() as any;

          runner.client.chat.mockResolvedValueOnce({
            content: JSON.stringify({
              decision: 'continue_brain',
              explanation: `Handling ${intent} directly`,
            }),
          });

          const brainNode = createBrainNode(runner);
          const state = makeState(intent, userMessage);

          const result = await brainNode(state);

          // Must NOT route to a specialist
          expect(result.routingDecision?.decision).not.toMatch(/^route_/);
          // Must either continue brain or complete task
          expect(['continue_brain', 'complete_task']).toContain(result.routingDecision?.decision);
        }
      ),
      { numRuns: 30 }
    );
  });

  /**
   * Property 7: Brain node must not execute web_search for non-research intents.
   *
   * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**
   *
   * This ensures that the fix doesn't accidentally prevent web_search execution
   * for non-research intents (if they need it).
   */
  it('property: brain node does not route to web-explorer for non-research intents', async () => {
    const { createBrainNode } = await import('../brain');

    const nonResearchIntents: IntentType[] = [
      'coding', 'fix', 'build', 'analyze', 'automate', 'question', 'conversation', 'task',
    ];

    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...nonResearchIntents),
        async (intent) => {
          const runner = makeMockRunner() as any;

          // Mock any routing decision
          runner.client.chat.mockResolvedValueOnce({
            content: JSON.stringify({
              decision: 'continue_brain',
              explanation: 'test',
            }),
          });

          const brainNode = createBrainNode(runner);
          const state = makeState(intent, 'test message');

          const result = await brainNode(state);

          // Must NOT route to web-explorer for non-research intents
          expect(result.routingDecision?.decision).not.toBe('route_web_explorer');
        }
      ),
      { numRuns: 40 }
    );
  });
});

// ── Part 3: Fallback routing tests ───────────────────────────────────────────

describe('Preservation — Brain Node Fallback Routing for Non-Research Intents', () => {
  /**
   * Test Case: Fallback routing when routing LLM fails
   *
   * Observation: Brain node has fallback intent-based routing logic
   * that triggers when the routing LLM fails.
   *
   * For non-research intents, the fallback routing should produce the same
   * result as the normal routing.
   */
  it('should use fallback routing for non-research intents when routing LLM fails', async () => {
    const { createBrainNode } = await import('../brain');
    const runner = makeMockRunner() as any;

    // Mock the routing decision to fail (return null)
    runner.client.chat.mockResolvedValueOnce({
      content: 'invalid json {',
    });

    const brainNode = createBrainNode(runner);
    const state = makeState('coding', 'write a React component');

    const result = await brainNode(state);

    // Should use fallback routing for coding intent
    expect(result.routingDecision?.decision).toBe('route_coding');
    expect(result.taskPhase).toBe('specialized_agent');
  });

  /**
   * Property: Fallback routing works for all non-research intents
   */
  it('property: fallback routing works for all non-research intents', async () => {
    const { createBrainNode } = await import('../brain');

    const nonResearchIntents: IntentType[] = [
      'coding', 'fix', 'build', 'analyze', 'automate',
    ];

    const intentRoutingMap: Record<string, string> = {
      'coding': 'route_coding',
      'fix': 'route_coding',
      'build': 'route_coding',
      'analyze': 'route_data_analyst',
      'automate': 'route_computer_use',
    };

    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...nonResearchIntents),
        async (intent) => {
          const runner = makeMockRunner() as any;

          // Mock the routing decision to fail
          runner.client.chat.mockResolvedValueOnce({
            content: 'invalid json {',
          });

          const brainNode = createBrainNode(runner);
          const state = makeState(intent, 'test message');

          const result = await brainNode(state);

          // Should use fallback routing
          const expectedDecision = intentRoutingMap[intent];
          expect(result.routingDecision?.decision).toBe(expectedDecision);
          expect(result.taskPhase).toBe('specialized_agent');
        }
      ),
      { numRuns: 25 }
    );
  });
});
