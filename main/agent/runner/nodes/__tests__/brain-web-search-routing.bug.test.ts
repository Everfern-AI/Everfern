/**
 * Bug Condition Exploration Test — Brain Web Search Routing Fix
 *
 * **Validates: Requirements 1.1, 1.2, 1.3, 1.4**
 *
 * Property 1: Bug Condition — Brain Executes Web Search Instead of Routing to Web-Explorer
 *
 * CRITICAL: These tests MUST FAIL on unfixed code — failure confirms the bug exists.
 * DO NOT attempt to fix the code or the tests when they fail.
 *
 * Bug: When a user asks for web research (e.g., "find flights from Hyderabad to Amsterdam"),
 * the brain node incorrectly executes the web_search tool directly instead of immediately
 * routing to the web-explorer agent. This causes duplicate work, inconsistent behavior,
 * and wasted API calls.
 *
 * Root cause: The brain node makes routing decisions AFTER attempting tool execution,
 * not before. For research intents, the routing should happen before any tool execution.
 *
 * Expected counterexamples (unfixed code):
 *   - Brain node executes web_search tool for research intent instead of routing to web-explorer
 *   - pendingToolCalls includes 'web_search' when it should be empty
 *   - routingDecision is not set to 'route_web_explorer' immediately
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GraphStateType } from '../../state';
import { createBrainNode } from '../brain';

// ── Mock dependencies ────────────────────────────────────────────────────────

// Mock the agent runtime service
vi.mock('../../services/agent-runtime', () => ({
  runAgentStep: vi.fn(async (state, options) => {
    // Simulate brain node attempting to execute web_search for research intent
    // This is the buggy behavior we're testing for
    if (state.currentIntent === 'research') {
      // On unfixed code: brain executes web_search tool
      return {
        messages: [
          ...state.messages,
          {
            role: 'assistant',
            content: 'I found some flight information...',
          },
          {
            role: 'tool',
            name: 'web_search',
            content: 'Flight results from web search...',
          },
        ],
        pendingToolCalls: [
          {
            name: 'web_search',
            arguments: { query: 'flights from Hyderabad to Amsterdam' },
          },
        ],
      };
    }
    // For non-research intents, return appropriate routing
    return {
      messages: [...state.messages],
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
 * Creates a minimal GraphStateType state with research intent
 */
const makeResearchState = (userMessage: string): GraphStateType => ({
  messages: [
    { role: 'user', content: userMessage } as any,
  ],
  currentIntent: 'research' as any,
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

describe('Bug Condition Exploration — Brain Web Search Routing Fix', () => {
  /**
   * Test Case 1: Research Intent - Flight Search
   *
   * User asks: "find flights from Hyderabad to Amsterdam"
   * Triage classifies as: "research" intent
   *
   * Expected behavior (after fix):
   *   - Brain node should route to web-explorer WITHOUT executing web_search
   *   - routingDecision.decision === 'route_web_explorer'
   *   - pendingToolCalls must NOT include 'web_search'
   *
   * On UNFIXED code: brain node will execute web_search tool (test FAILS)
   * Counterexample: brain executes web_search instead of routing to web-explorer
   */
  it('should route to web-explorer for research intent: "find flights from Hyderabad to Amsterdam"', async () => {
    const runner = makeMockRunner() as any;
    const brainNode = createBrainNode(runner, [], undefined, [], undefined, undefined);
    const state = makeResearchState('find flights from Hyderabad to Amsterdam');

    const result = await brainNode(state);

    // On unfixed code: brain executes web_search, so pendingToolCalls includes 'web_search'
    // This assertion FAILS on unfixed code — confirms the bug
    expect(result.pendingToolCalls).not.toContainEqual(
      expect.objectContaining({ name: 'web_search' })
    );

    // On unfixed code: routingDecision is not set because brain is executing tools
    // This assertion FAILS on unfixed code
    expect(result.routingDecision?.decision).toBe('route_web_explorer');
  });

  /**
   * Test Case 2: Research Intent - Bot Search
   *
   * User asks: "search for the best anime discord bots"
   * Triage classifies as: "research" intent
   *
   * Expected behavior (after fix):
   *   - Brain node should route to web-explorer WITHOUT executing web_search
   *   - routingDecision.decision === 'route_web_explorer'
   *   - pendingToolCalls must NOT include 'web_search'
   *
   * On UNFIXED code: brain node will execute web_search tool (test FAILS)
   * Counterexample: brain executes web_search instead of routing to web-explorer
   */
  it('should route to web-explorer for research intent: "search for the best anime discord bots"', async () => {
    const runner = makeMockRunner() as any;
    const brainNode = createBrainNode(runner, [], undefined, [], undefined, undefined);
    const state = makeResearchState('search for the best anime discord bots');

    const result = await brainNode(state);

    // On unfixed code: brain executes web_search, so pendingToolCalls includes 'web_search'
    // This assertion FAILS on unfixed code — confirms the bug
    expect(result.pendingToolCalls).not.toContainEqual(
      expect.objectContaining({ name: 'web_search' })
    );

    // On unfixed code: routingDecision is not set because brain is executing tools
    // This assertion FAILS on unfixed code
    expect(result.routingDecision?.decision).toBe('route_web_explorer');
  });

  /**
   * Test Case 3: Research Intent - Pricing Lookup
   *
   * User asks: "look up pricing for X service"
   * Triage classifies as: "research" intent
   *
   * Expected behavior (after fix):
   *   - Brain node should route to web-explorer WITHOUT executing web_search
   *   - routingDecision.decision === 'route_web_explorer'
   *   - pendingToolCalls must NOT include 'web_search'
   *
   * On UNFIXED code: brain node will execute web_search tool (test FAILS)
   * Counterexample: brain executes web_search instead of routing to web-explorer
   */
  it('should route to web-explorer for research intent: "look up pricing for X service"', async () => {
    const runner = makeMockRunner() as any;
    const brainNode = createBrainNode(runner, [], undefined, [], undefined, undefined);
    const state = makeResearchState('look up pricing for X service');

    const result = await brainNode(state);

    // On unfixed code: brain executes web_search, so pendingToolCalls includes 'web_search'
    // This assertion FAILS on unfixed code — confirms the bug
    expect(result.pendingToolCalls).not.toContainEqual(
      expect.objectContaining({ name: 'web_search' })
    );

    // On unfixed code: routingDecision is not set because brain is executing tools
    // This assertion FAILS on unfixed code
    expect(result.routingDecision?.decision).toBe('route_web_explorer');
  });

  /**
   * Test Case 4: Research Intent - Component Library Search
   *
   * User asks: "find React component library"
   * Triage classifies as: "research" intent
   *
   * Expected behavior (after fix):
   *   - Brain node should route to web-explorer WITHOUT executing web_search
   *   - routingDecision.decision === 'route_web_explorer'
   *   - pendingToolCalls must NOT include 'web_search'
   *
   * On UNFIXED code: brain node will execute web_search tool (test FAILS)
   * Counterexample: brain executes web_search instead of routing to web-explorer
   */
  it('should route to web-explorer for research intent: "find React component library"', async () => {
    const runner = makeMockRunner() as any;
    const brainNode = createBrainNode(runner, [], undefined, [], undefined, undefined);
    const state = makeResearchState('find React component library');

    const result = await brainNode(state);

    // On unfixed code: brain executes web_search, so pendingToolCalls includes 'web_search'
    // This assertion FAILS on unfixed code — confirms the bug
    expect(result.pendingToolCalls).not.toContainEqual(
      expect.objectContaining({ name: 'web_search' })
    );

    // On unfixed code: routingDecision is not set because brain is executing tools
    // This assertion FAILS on unfixed code
    expect(result.routingDecision?.decision).toBe('route_web_explorer');
  });

  /**
   * Property-Based Test: For all research intent inputs, brain must route to web-explorer
   *
   * Property: For any user request where `state.currentIntent === 'research'`,
   * the brain node MUST return `routingDecision.decision === 'route_web_explorer'`
   * and `pendingToolCalls` must NOT include 'web_search'.
   *
   * **Validates: Requirements 1.1, 1.2, 1.3, 1.4**
   *
   * On UNFIXED code: brain executes web_search for research intent (test FAILS)
   * Counterexample: brain node executes web_search tool instead of routing to web-explorer
   */
  it('should route to web-explorer for ALL research intent inputs without executing web_search', async () => {
    const runner = makeMockRunner() as any;
    const brainNode = createBrainNode(runner, [], undefined, [], undefined, undefined);

    // Test multiple research queries to ensure consistent behavior
    const researchQueries = [
      'find flights from Hyderabad to Amsterdam',
      'search for the best anime discord bots',
      'look up pricing for X service',
      'find React component library',
      'investigate the latest AI trends',
      'search for React hooks documentation',
      'find the best TypeScript linter',
      'look up Node.js performance benchmarks',
    ];

    for (const query of researchQueries) {
      const state = makeResearchState(query);
      const result = await brainNode(state);

      // CRITICAL: On unfixed code, these assertions FAIL because brain executes web_search
      // This confirms the bug exists

      // Assertion 1: pendingToolCalls must NOT include 'web_search'
      const hasWebSearch = result.pendingToolCalls?.some(
        (tc: any) => tc.name === 'web_search'
      );
      expect(hasWebSearch).toBe(false);

      // Assertion 2: routingDecision must be set to 'route_web_explorer'
      expect(result.routingDecision?.decision).toBe('route_web_explorer');

      // Assertion 3: brainToolsInFlight must be false (no tools executing)
      expect(result.brainToolsInFlight).toBe(false);
    }
  });
});
