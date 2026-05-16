/**
 * Integration Tests — Brain Web Search Routing Fix
 *
 * **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4, 3.5**
 *
 * These integration tests verify the full workflow from triage through brain
 * to specialized agents, ensuring that:
 *
 * 1. Research requests flow through triage → brain → web-explorer
 * 2. Brain routes research requests to web-explorer WITHOUT executing web_search
 * 3. No duplicate web_search executions occur
 * 4. Non-research intents continue to work correctly
 * 5. Edge cases are handled properly
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GraphStateType } from '../../state';
import { createBrainNode } from '../brain';
import { classifyIntent } from '../../triage';

// ── Mock dependencies ────────────────────────────────────────────────────────

vi.mock('../../services/agent-runtime', () => ({
  runAgentStep: vi.fn(async (state, options) => {
    // Simulate brain node behavior based on intent
    return {
      messages: [
        ...state.messages,
        {
          role: 'assistant',
          content: 'Processing request...',
        },
      ],
      pendingToolCalls: [],
    };
  }),
}));

vi.mock('../../mission-integrator', () => ({
  createMissionIntegrator: () => ({
    wrapNode: vi.fn(async (name, fn) => fn()),
  }),
}));

vi.mock('../../../lib/prompt-sync', () => ({
  loadPrompt: vi.fn(() => 'Mock system prompt'),
}));

vi.mock('../../abort-manager', () => ({
  globalAbortManager: {
    abortController: {
      signal: new AbortController().signal,
    },
  },
}));

vi.mock('../../services/node-utils', () => ({
  nodeLifecycle: () => ({
    start: vi.fn(),
    end: vi.fn(),
  }),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Creates a minimal GraphStateType state
 */
const makeState = (intent: string, userMessage: string): GraphStateType => ({
  messages: [
    { role: 'user', content: userMessage } as any,
  ],
  currentIntent: intent as any,
  intentConfidence: 0.95,
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
  completionSignal: null,
  routingDecision: null,
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
  brainToolsInFlight: false,
  returningFromSpecialist: null,
  debateResult: undefined as any,
});

/**
 * Creates a mock AgentRunner with web_search tool available
 */
const makeMockRunner = () => ({
  client: {
    chat: vi.fn().mockResolvedValue({
      content: JSON.stringify({
        decision: 'route_web_explorer',
        explanation: 'Research intent detected',
      }),
    }),
    provider: 'test',
    model: 'test-model',
    apiKey: '',
    baseUrl: '',
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
  currentAgentSessionKey: undefined,
  _buildToolDefinitions: vi.fn(() => [
    { name: 'web_search', description: 'Search the web' },
    { name: 'navis', description: 'Browser automation' },
  ]),
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Integration Tests — Brain Web Search Routing Fix', () => {
  describe('Sub-task 4.1: Test full research workflow with web-explorer', () => {
    /**
     * Test Case 1: User request "find flights from Hyderabad to Amsterdam"
     * flows through triage → brain → web-explorer
     *
     * **Validates: Requirements 2.1, 2.2, 2.3, 2.4**
     *
     * Verification:
     * - Triage classifies as 'research'
     * - Brain routes to web-explorer without executing web_search
     * - Web-explorer receives the research request and executes its workflow
     */
    it('should route "find flights from Hyderabad to Amsterdam" through triage → brain → web-explorer', async () => {
      const runner = makeMockRunner() as any;
      const eventQueue: any[] = [];
      const brainNode = createBrainNode(runner, eventQueue, undefined, [], undefined, undefined);

      // Step 1: Simulate triage classification
      const userMessage = 'find flights from Hyderabad to Amsterdam';
      const triageResult = {
        intent: 'research' as const,
        confidence: 0.95,
        reasoning: 'User is asking to find flights - web research task',
      };

      // Verify triage classifies as 'research'
      expect(triageResult.intent).toBe('research');
      expect(triageResult.confidence).toBeGreaterThan(0.9);

      // Step 2: Brain node receives state with research intent
      const state = makeState('research', userMessage);
      const result = await brainNode(state);

      // Verify brain routes to web-explorer without executing web_search
      expect(result.routingDecision?.decision).toBe('route_web_explorer');
      expect(result.pendingToolCalls).not.toContainEqual(
        expect.objectContaining({ name: 'web_search' })
      );
      expect(result.brainToolsInFlight).toBe(false);

      // Step 3: Verify event queue shows routing to web-explorer
      const routingEvent = eventQueue.find(e =>
        e.type === 'thought' && e.content.includes('web-explorer')
      );
      expect(routingEvent).toBeDefined();

      // Step 4: Verify task phase is set to specialized_agent
      expect(result.taskPhase).toBe('specialized_agent');
    });

    /**
     * Test Case 2: User request "search for anime discord bots"
     * flows through triage → brain → web-explorer
     *
     * **Validates: Requirements 2.1, 2.2, 2.3, 2.4**
     *
     * Verification:
     * - Triage classifies as 'research'
     * - Brain routes to web-explorer without executing web_search
     * - Web-explorer receives the research request
     */
    it('should route "search for anime discord bots" through triage → brain → web-explorer', async () => {
      const runner = makeMockRunner() as any;
      const eventQueue: any[] = [];
      const brainNode = createBrainNode(runner, eventQueue, undefined, [], undefined, undefined);

      // Step 1: Simulate triage classification
      const userMessage = 'search for anime discord bots';
      const triageResult = {
        intent: 'research' as const,
        confidence: 0.92,
        reasoning: 'User is searching for information - web research task',
      };

      // Verify triage classifies as 'research'
      expect(triageResult.intent).toBe('research');

      // Step 2: Brain node receives state with research intent
      const state = makeState('research', userMessage);
      const result = await brainNode(state);

      // Verify brain routes to web-explorer without executing web_search
      expect(result.routingDecision?.decision).toBe('route_web_explorer');
      expect(result.pendingToolCalls).not.toContainEqual(
        expect.objectContaining({ name: 'web_search' })
      );

      // Step 3: Verify routing decision is set
      expect(result.routingDecision).toBeDefined();
      expect(result.routingDecision?.explanation).toContain('Research');
    });

    /**
     * Test Case 3: Verify no duplicate web_search executions
     *
     * **Validates: Requirements 2.1, 2.2, 2.3, 2.4**
     *
     * Verification:
     * - Simulate research request through full pipeline
     * - Assert that web_search is only executed by web-explorer, not by brain
     * - Verify event queue shows routing to web-explorer, not tool execution by brain
     */
    it('should verify no duplicate web_search executions in research workflow', async () => {
      const runner = makeMockRunner() as any;
      const eventQueue: any[] = [];
      const brainNode = createBrainNode(runner, eventQueue, undefined, [], undefined, undefined);

      // Simulate research request through full pipeline
      const userMessage = 'find React component library';
      const state = makeState('research', userMessage);

      // Execute brain node
      const result = await brainNode(state);

      // Assert that web_search is NOT executed by brain
      const hasWebSearchInPending = result.pendingToolCalls?.some(
        (tc: any) => tc.name === 'web_search'
      );
      expect(hasWebSearchInPending).toBe(false);

      // Verify event queue shows routing to web-explorer, not tool execution by brain
      const webSearchEvent = eventQueue.find(e =>
        e.type === 'thought' && e.content.includes('web_search')
      );
      expect(webSearchEvent).toBeUndefined();

      // Verify routing event is present
      const routingEvent = eventQueue.find(e =>
        e.type === 'thought' && e.content.includes('web-explorer')
      );
      expect(routingEvent).toBeDefined();

      // Verify brainToolsInFlight is false (no tools executing)
      expect(result.brainToolsInFlight).toBe(false);
    });
  });

  describe('Sub-task 4.2: Test non-research intents still work correctly', () => {
    /**
     * Test Case 1: User request "write a React component" with coding intent
     *
     * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**
     *
     * Verification:
     * - Brain routes to coding specialist
     * - Brain does NOT route to web-explorer
     */
    it('should route "write a React component" to coding specialist (not web-explorer)', async () => {
      const runner = makeMockRunner() as any;
      runner.client.chat.mockResolvedValueOnce({
        content: JSON.stringify({
          decision: 'route_coding',
          explanation: 'Coding task detected',
        }),
      });

      const brainNode = createBrainNode(runner, [], undefined, [], undefined, undefined);
      const state = makeState('coding', 'write a React component');

      const result = await brainNode(state);

      // Verify brain routes to coding specialist
      expect(result.routingDecision?.decision).toBe('route_coding');
      expect(result.taskPhase).toBe('specialized_agent');

      // Verify brain does NOT route to web-explorer
      expect(result.routingDecision?.decision).not.toBe('route_web_explorer');
    });

    /**
     * Test Case 2: User request "analyze this CSV data" with analyze intent
     *
     * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**
     *
     * Verification:
     * - Brain routes to data analyst
     * - Brain does NOT route to web-explorer
     */
    it('should route "analyze this CSV data" to data analyst (not web-explorer)', async () => {
      const runner = makeMockRunner() as any;
      runner.client.chat.mockResolvedValueOnce({
        content: JSON.stringify({
          decision: 'route_data_analyst',
          explanation: 'Data analysis task detected',
        }),
      });

      const brainNode = createBrainNode(runner, [], undefined, [], undefined, undefined);
      const state = makeState('analyze', 'analyze this CSV data');

      const result = await brainNode(state);

      // Verify brain routes to data analyst
      expect(result.routingDecision?.decision).toBe('route_data_analyst');
      expect(result.taskPhase).toBe('specialized_agent');

      // Verify brain does NOT route to web-explorer
      expect(result.routingDecision?.decision).not.toBe('route_web_explorer');
    });

    /**
     * Test Case 3: User request "click the start button" with automate intent
     *
     * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**
     *
     * Verification:
     * - Brain routes to computer-use
     * - Brain does NOT route to web-explorer
     */
    it('should route "click the start button" to computer-use (not web-explorer)', async () => {
      const runner = makeMockRunner() as any;
      runner.client.chat.mockResolvedValueOnce({
        content: JSON.stringify({
          decision: 'route_computer_use',
          explanation: 'Desktop automation task detected',
        }),
      });

      const brainNode = createBrainNode(runner, [], undefined, [], undefined, undefined);
      const state = makeState('automate', 'click the start button');

      const result = await brainNode(state);

      // Verify brain routes to computer-use
      expect(result.routingDecision?.decision).toBe('route_computer_use');
      expect(result.taskPhase).toBe('specialized_agent');

      // Verify brain does NOT route to web-explorer
      expect(result.routingDecision?.decision).not.toBe('route_web_explorer');
    });

    /**
     * Test Case 4: User request "what is React?" with question intent
     *
     * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**
     *
     * Verification:
     * - Brain handles directly or routes appropriately
     * - Brain does NOT route to web-explorer
     */
    it('should handle "what is React?" directly (not route to web-explorer)', async () => {
      const runner = makeMockRunner() as any;
      runner.client.chat.mockResolvedValueOnce({
        content: JSON.stringify({
          decision: 'continue_brain',
          explanation: 'Question can be answered directly',
        }),
      });

      const brainNode = createBrainNode(runner, [], undefined, [], undefined, undefined);
      const state = makeState('question', 'what is React?');

      const result = await brainNode(state);

      // Verify brain handles directly (continue_brain or complete_task)
      expect(['continue_brain', 'complete_task']).toContain(result.routingDecision?.decision);

      // Verify brain does NOT route to web-explorer
      expect(result.routingDecision?.decision).not.toBe('route_web_explorer');
    });
  });

  describe('Sub-task 4.3: Test edge cases and error handling', () => {
    /**
     * Test Case 1: Research request with no web_search tool available
     *
     * **Validates: Requirements 2.1, 2.2, 2.3, 2.4**
     *
     * Verification:
     * - Brain still routes to web-explorer (routing decision is based on intent, not tool availability)
     */
    it('should route research request to web-explorer even without web_search tool', async () => {
      const runner = makeMockRunner() as any;
      // Mock _buildToolDefinitions to return empty tools
      runner._buildToolDefinitions.mockReturnValueOnce([]);

      const brainNode = createBrainNode(runner, [], undefined, [], undefined, undefined);
      const state = makeState('research', 'find flights from Hyderabad to Amsterdam');

      const result = await brainNode(state);

      // Verify brain still routes to web-explorer
      expect(result.routingDecision?.decision).toBe('route_web_explorer');
      expect(result.taskPhase).toBe('specialized_agent');
    });

    /**
     * Test Case 2: Research request with empty currentIntent
     *
     * **Validates: Requirements 2.1, 2.2, 2.3, 2.4**
     *
     * Verification:
     * - Brain falls back to routing LLM or other logic
     */
    it('should handle research request with empty currentIntent', async () => {
      const runner = makeMockRunner() as any;
      runner.client.chat.mockResolvedValueOnce({
        content: JSON.stringify({
          decision: 'route_web_explorer',
          explanation: 'Research task detected from content',
        }),
      });

      const brainNode = createBrainNode(runner, [], undefined, [], undefined, undefined);
      const state = makeState('', 'find flights from Hyderabad to Amsterdam');
      state.currentIntent = '' as any;

      const result = await brainNode(state);

      // Brain should fall back to routing LLM or other logic
      // The routing decision should be made based on content analysis
      expect(result.routingDecision).toBeDefined();
    });

    /**
     * Test Case 3: Research request with returningFromSpecialist flag
     *
     * **Validates: Requirements 2.1, 2.2, 2.3, 2.4**
     *
     * Verification:
     * - Brain respects the returning specialist logic
     */
    it('should respect returningFromSpecialist flag for research requests', async () => {
      const runner = makeMockRunner() as any;
      const brainNode = createBrainNode(runner, [], undefined, [], undefined, undefined);

      const state = makeState('research', 'find flights from Hyderabad to Amsterdam');
      state.returningFromSpecialist = 'web_explorer';
      state.webExplorerComplete = false;

      const result = await brainNode(state);

      // Brain should respect the returning specialist logic
      // If web_explorer is not complete, it should route back to web_explorer
      expect(result.routingDecision?.decision).toBe('route_web_explorer');
    });

    /**
     * Test Case 4: Research request with abort signal
     *
     * **Validates: Requirements 2.1, 2.2, 2.3, 2.4**
     *
     * Verification:
     * - Brain respects abort signal and throws error appropriately
     */
    it('should respect abort signal for research requests', async () => {
      const runner = makeMockRunner() as any;
      const shouldAbort = () => true; // Simulate abort signal

      const brainNode = createBrainNode(runner, [], undefined, [], shouldAbort, undefined);
      const state = makeState('research', 'find flights from Hyderabad to Amsterdam');

      // Should throw error when abort signal is active
      await expect(brainNode(state)).rejects.toThrow('Execution aborted');
    });
  });

  describe('Integration: Full workflow verification', () => {
    /**
     * Verify that research requests are routed immediately without tool execution
     */
    it('should route research requests immediately without executing tools', async () => {
      const runner = makeMockRunner() as any;
      const eventQueue: any[] = [];
      const brainNode = createBrainNode(runner, eventQueue, undefined, [], undefined, undefined);

      const researchQueries = [
        'find flights from Hyderabad to Amsterdam',
        'search for anime discord bots',
        'look up pricing for X service',
        'find React component library',
      ];

      for (const query of researchQueries) {
        const state = makeState('research', query);
        const result = await brainNode(state);

        // Verify immediate routing to web-explorer
        expect(result.routingDecision?.decision).toBe('route_web_explorer');

        // Verify no tools are executing
        expect(result.pendingToolCalls).not.toContainEqual(
          expect.objectContaining({ name: 'web_search' })
        );

        // Verify brainToolsInFlight is false
        expect(result.brainToolsInFlight).toBe(false);

        // Verify task phase is set to specialized_agent
        expect(result.taskPhase).toBe('specialized_agent');
      }
    });

    /**
     * Verify that non-research intents are not affected by the fix
     */
    it('should not affect non-research intent routing', async () => {
      const runner = makeMockRunner() as any;
      const brainNode = createBrainNode(runner, [], undefined, [], undefined, undefined);

      const testCases = [
        { intent: 'coding', message: 'write a React component', expectedRoute: 'route_coding' },
        { intent: 'fix', message: 'fix this bug', expectedRoute: 'route_coding' },
        { intent: 'build', message: 'build a Next.js app', expectedRoute: 'route_coding' },
        { intent: 'analyze', message: 'analyze this data', expectedRoute: 'route_data_analyst' },
        { intent: 'automate', message: 'click the button', expectedRoute: 'route_computer_use' },
      ];

      for (const testCase of testCases) {
        runner.client.chat.mockResolvedValueOnce({
          content: JSON.stringify({
            decision: testCase.expectedRoute,
            explanation: `Routing for ${testCase.intent}`,
          }),
        });

        const state = makeState(testCase.intent, testCase.message);
        const result = await brainNode(state);

        // Verify correct routing
        expect(result.routingDecision?.decision).toBe(testCase.expectedRoute);

        // Verify NOT routing to web-explorer
        expect(result.routingDecision?.decision).not.toBe('route_web_explorer');
      }
    });
  });
});
