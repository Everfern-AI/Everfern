/**
 * Bug Condition Exploration Test — Brain Post-Completion Routing Fix
 *
 * **Validates: Requirements 1.1, 1.2, 1.3, 1.4**
 *
 * Property 1: Bug Condition — Completion Flag Ignored in Routing
 *
 * CRITICAL: These tests MUST FAIL on unfixed code — failure confirms the bug exists.
 * DO NOT attempt to fix the code or the tests when they fail.
 *
 * NOTE: This test encodes the expected behavior - it will validate the fix when it passes
 * after implementation.
 *
 * Bug: When a specialist agent completes its task and sets its completion flag to true
 * (e.g., webExplorerComplete: true), the Brain node's routing logic fails to check this
 * flag before making routing decisions. This causes the Brain to route back to the
 * completed specialist, spawning unnecessary agent transitions and wasting compute resources.
 *
 * Root cause: The Brain node's routing decision execution logic does not check completion
 * flags before routing to specialists. Both the routing LLM success path and the fallback
 * routing path fail to verify if the target specialist has already completed.
 *
 * Expected counterexamples (unfixed code):
 *   - Brain routes to web_explorer when webExplorerComplete is true
 *   - Brain routes to coding_specialist when codingComplete is true
 *   - Fallback routing routes to completed specialists
 *   - Auto-routing routes to completed specialists
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GraphStateType } from '../../state';
import { createBrainNode } from '../brain';

// ── Mock dependencies ────────────────────────────────────────────────────────

// Mock the agent runtime service
vi.mock('../../services/agent-runtime', () => ({
  runAgentStep: vi.fn(async (state, options) => {
    // Simulate brain node producing a response without tool calls
    // This triggers the routing decision logic
    return {
      messages: [
        ...state.messages,
        {
          role: 'assistant',
          content: 'I have analyzed the request and determined the next steps.',
        },
      ],
      pendingToolCalls: [],
    };
  }),
}));

// Mock mission integrator
vi.mock('../../mission-integrator', () => ({
  createMissionIntegrator: () => ({
    wrapNode: vi.fn(async (name, fn) => fn()),
  }),
}));

// Mock prompt loading
vi.mock('../../../lib/prompt-sync', () => ({
  loadPrompt: vi.fn(() => 'Mock system prompt'),
}));

// Mock abort manager
vi.mock('../../abort-manager', () => ({
  globalAbortManager: {
    abortController: {
      signal: new AbortController().signal,
    },
  },
}));

// Mock node utils
vi.mock('../../services/node-utils', () => ({
  nodeLifecycle: () => ({
    start: vi.fn(),
    end: vi.fn(),
  }),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Creates a minimal GraphStateType state with specified completion flags
 */
const makeStateWithCompletion = (
  userMessage: string,
  intent: 'research' | 'coding' | 'analyze' | 'automate',
  completionFlags: {
    webExplorerComplete?: boolean;
    codingComplete?: boolean;
    dataAnalysisComplete?: boolean;
    computerUseComplete?: boolean;
  }
): GraphStateType => ({
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
  iterations: 1, // Simulate returning from specialist
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
  webExplorerComplete: completionFlags.webExplorerComplete || false,
  webExplorerSelfLoopCount: 0,
  navisInvoked: false,
  searchInvoked: false,
  codingComplete: completionFlags.codingComplete || false,
  dataAnalysisComplete: completionFlags.dataAnalysisComplete || false,
  computerUseComplete: completionFlags.computerUseComplete || false,
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
 * Creates a mock AgentRunner with configurable routing LLM response
 */
const makeMockRunner = (routingDecision: string | null) => ({
  client: {
    chat: vi.fn().mockImplementation(async (options) => {
      // Check if this is a routing decision call or completion signal call
      const prompt = options.messages[0].content;

      if (prompt.includes('routing decision')) {
        // Routing decision call
        if (routingDecision === null) {
          // Simulate JSON parse failure
          return { content: 'invalid json response' };
        }
        return {
          content: JSON.stringify({
            decision: routingDecision,
            explanation: `Routing to ${routingDecision}`,
          }),
        };
      } else if (prompt.includes('completion signal')) {
        // Completion signal call
        return {
          content: JSON.stringify({
            reason: 'task_complete',
            explanation: 'Task completed successfully',
          }),
        };
      }

      return { content: '{}' };
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

describe('Bug Condition Exploration — Brain Post-Completion Routing Fix', () => {
  /**
   * Test Case 1: Web Explorer completion ignored
   *
   * Scenario:
   *   - User requests: "find flights from Hyderabad to Amsterdam"
   *   - Brain routes to web_explorer
   *   - Web_explorer completes and sets webExplorerComplete: true
   *   - Brain receives control back
   *   - Routing LLM returns route_web_explorer
   *
   * Expected behavior (after fix):
   *   - Brain should override routing decision and route to END
   *   - routingDecision.decision should be 'complete_task' or null
   *
   * On UNFIXED code: Brain routes back to web_explorer (test FAILS)
   * Counterexample: Brain ignores webExplorerComplete flag
   *
   * **Validates: Requirements 1.1, 2.1, 2.4**
   */
  it('should route to END when webExplorerComplete is true and routing LLM returns route_web_explorer', async () => {
    const runner = makeMockRunner('route_web_explorer') as any;
    const brainNode = createBrainNode(runner, [], undefined, [], undefined, undefined);
    const state = makeStateWithCompletion(
      'find flights from Hyderabad to Amsterdam',
      'research',
      { webExplorerComplete: true }
    );

    const result = await brainNode(state);

    // On unfixed code: routingDecision.decision === 'route_web_explorer'
    // After fix: routingDecision.decision should be 'complete_task' or null
    // This assertion FAILS on unfixed code — confirms the bug
    expect(result.routingDecision?.decision).not.toBe('route_web_explorer');

    // Verify it routes to END (complete_task) instead
    if (result.routingDecision) {
      expect(result.routingDecision.decision).toBe('complete_task');
    }
  });

  /**
   * Test Case 2: Fallback routing ignores completion
   *
   * Scenario:
   *   - User requests: "research the best anime discord bots"
   *   - Brain routes to web_explorer
   *   - Web_explorer completes and sets webExplorerComplete: true
   *   - Brain receives control back
   *   - Routing LLM fails to parse JSON (returns null)
   *   - Brain falls back to intent-based routing
   *   - Intent is "research" → fallback maps to route_web_explorer
   *
   * Expected behavior (after fix):
   *   - Brain should check webExplorerComplete before fallback routing
   *   - Brain should route to END instead of route_web_explorer
   *
   * On UNFIXED code: Fallback routing routes to web_explorer (test FAILS)
   * Counterexample: Fallback routing ignores completion flag
   *
   * **Validates: Requirements 1.2, 2.2**
   */
  it('should route to END when webExplorerComplete is true and fallback routing would route to web_explorer', async () => {
    const runner = makeMockRunner(null) as any; // null = routing LLM fails
    const brainNode = createBrainNode(runner, [], undefined, [], undefined, undefined);
    const state = makeStateWithCompletion(
      'research the best anime discord bots',
      'research',
      { webExplorerComplete: true }
    );

    const result = await brainNode(state);

    // On unfixed code: fallback routing routes to 'route_web_explorer'
    // After fix: should route to END (complete_task) instead
    // This assertion FAILS on unfixed code — confirms the bug
    expect(result.routingDecision?.decision).not.toBe('route_web_explorer');

    // Verify it routes to END instead
    if (result.routingDecision) {
      expect(result.routingDecision.decision).toBe('complete_task');
    }
  });

  /**
   * Test Case 3: Coding specialist completion ignored
   *
   * Scenario:
   *   - User requests: "create a React app with TypeScript"
   *   - Brain routes to coding_specialist
   *   - Coding specialist completes and sets codingComplete: true
   *   - Brain receives control back
   *   - Routing LLM returns route_coding
   *
   * Expected behavior (after fix):
   *   - Brain should override routing decision and route to END
   *   - routingDecision.decision should be 'complete_task' or null
   *
   * On UNFIXED code: Brain routes back to coding_specialist (test FAILS)
   * Counterexample: Brain ignores codingComplete flag
   *
   * **Validates: Requirements 1.1, 2.1, 2.4**
   */
  it('should route to END when codingComplete is true and routing LLM returns route_coding', async () => {
    const runner = makeMockRunner('route_coding') as any;
    const brainNode = createBrainNode(runner, [], undefined, [], undefined, undefined);
    const state = makeStateWithCompletion(
      'create a React app with TypeScript',
      'coding',
      { codingComplete: true }
    );

    const result = await brainNode(state);

    // On unfixed code: routingDecision.decision === 'route_coding'
    // After fix: routingDecision.decision should be 'complete_task' or null
    // This assertion FAILS on unfixed code — confirms the bug
    expect(result.routingDecision?.decision).not.toBe('route_coding');

    // Verify it routes to END instead
    if (result.routingDecision) {
      expect(result.routingDecision.decision).toBe('complete_task');
    }
  });

  /**
   * Test Case 4: Multiple specialists complete
   *
   * Scenario:
   *   - User requests: "analyze this CSV and create a dashboard"
   *   - Brain routes to data_analyst → completes, sets dataAnalysisComplete: true
   *   - Brain routes to coding_specialist → completes, sets codingComplete: true
   *   - Brain receives control back with both flags true
   *   - Routing LLM returns route_data_analyst
   *
   * Expected behavior (after fix):
   *   - Brain should check dataAnalysisComplete before routing
   *   - Brain should route to END instead of route_data_analyst
   *
   * On UNFIXED code: Brain routes back to data_analyst (test FAILS)
   * Counterexample: Brain ignores multiple completion flags
   *
   * **Validates: Requirements 1.1, 2.1, 2.4**
   */
  it('should route to END when multiple specialists are complete and routing LLM returns route to completed specialist', async () => {
    const runner = makeMockRunner('route_data_analyst') as any;
    const brainNode = createBrainNode(runner, [], undefined, [], undefined, undefined);
    const state = makeStateWithCompletion(
      'analyze this CSV and create a dashboard',
      'analyze',
      { dataAnalysisComplete: true, codingComplete: true }
    );

    const result = await brainNode(state);

    // On unfixed code: routingDecision.decision === 'route_data_analyst'
    // After fix: routingDecision.decision should be 'complete_task' or null
    // This assertion FAILS on unfixed code — confirms the bug
    expect(result.routingDecision?.decision).not.toBe('route_data_analyst');

    // Verify it routes to END instead
    if (result.routingDecision) {
      expect(result.routingDecision.decision).toBe('complete_task');
    }
  });

  /**
   * Property-Based Test: For all completed specialists, brain must route to END
   *
   * Property: For any state where a specialist completion flag is true AND
   * the routing decision would route back to that specialist, the Brain node
   * MUST override the routing decision and route to END instead.
   *
   * **Validates: Requirements 2.1, 2.2, 2.3, 2.4**
   *
   * On UNFIXED code: Brain routes to completed specialists (test FAILS)
   * Counterexample: Brain ignores completion flags in routing logic
   */
  it('should route to END for ALL completed specialists when routing decision routes back to them', async () => {
    // Test all specialist completion scenarios
    const scenarios = [
      {
        intent: 'research' as const,
        completionFlag: { webExplorerComplete: true },
        routingDecision: 'route_web_explorer',
        description: 'web_explorer completed',
      },
      {
        intent: 'coding' as const,
        completionFlag: { codingComplete: true },
        routingDecision: 'route_coding',
        description: 'coding_specialist completed',
      },
      {
        intent: 'analyze' as const,
        completionFlag: { dataAnalysisComplete: true },
        routingDecision: 'route_data_analyst',
        description: 'data_analyst completed',
      },
      {
        intent: 'automate' as const,
        completionFlag: { computerUseComplete: true },
        routingDecision: 'route_computer_use',
        description: 'computer_use completed',
      },
    ];

    for (const scenario of scenarios) {
      const runner = makeMockRunner(scenario.routingDecision) as any;
      const brainNode = createBrainNode(runner, [], undefined, [], undefined, undefined);
      const state = makeStateWithCompletion(
        `Test request for ${scenario.description}`,
        scenario.intent,
        scenario.completionFlag
      );

      const result = await brainNode(state);

      // CRITICAL: On unfixed code, these assertions FAIL because brain routes to completed specialists
      // This confirms the bug exists

      // Assertion 1: routingDecision must NOT route back to completed specialist
      expect(result.routingDecision?.decision).not.toBe(scenario.routingDecision);

      // Assertion 2: routingDecision should be 'complete_task' or null
      if (result.routingDecision) {
        expect(result.routingDecision.decision).toBe('complete_task');
      }
    }
  });
});
