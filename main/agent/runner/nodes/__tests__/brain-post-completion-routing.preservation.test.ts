/**
 * Preservation Property Tests — Brain Post-Completion Routing Fix
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**
 *
 * Property 2: Preservation — Incomplete Specialist Routing
 *
 * IMPORTANT: These tests follow observation-first methodology
 * - Observe behavior on UNFIXED code for non-buggy inputs
 * - Write property-based tests capturing observed behavior patterns
 * - EXPECTED OUTCOME: Tests PASS on unfixed code (confirms baseline behavior)
 *
 * These tests ensure that the bugfix does NOT introduce regressions for:
 * - Routing to specialists that have NOT completed (webExplorerComplete: false)
 * - First-time routing to specialists (webExplorerComplete: undefined)
 * - Routing to different specialists than the completed one
 * - Normal routing LLM success when no completion flags are set
 * - Multi-iteration specialist workflows
 *
 * Preservation Scope:
 * All routing decisions where the target specialist has NOT completed its task
 * should be completely unaffected by this fix.
 */

import { describe, it, expect, vi } from 'vitest';
import type { GraphStateType } from '../../state';
import { createBrainNode } from '../brain';
import fc from 'fast-check';

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
  },
  iterations: number = 1
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
  iterations,
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
  webExplorerComplete: completionFlags.webExplorerComplete,
  webExplorerSelfLoopCount: 0,
  navisInvoked: false,
  searchInvoked: false,
  codingComplete: completionFlags.codingComplete,
  dataAnalysisComplete: completionFlags.dataAnalysisComplete,
  computerUseComplete: completionFlags.computerUseComplete,
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

describe('Preservation Properties — Incomplete Specialist Routing', () => {
  /**
   * Preservation Test 1: Incomplete Specialist Routing
   *
   * Requirement 3.1: WHEN web_explorer has NOT completed its task
   * (webExplorerComplete is false or undefined) AND Brain receives control back
   * THEN the system SHALL CONTINUE TO allow routing back to web_explorer for
   * continued work
   *
   * Observed behavior on UNFIXED code:
   * - webExplorerComplete: false → Brain routes to web_explorer
   * - webExplorerComplete: undefined → Brain routes to web_explorer
   * - Routing decision is executed as normal
   */
  describe('Incomplete Specialist Routing', () => {
    it('should route to web_explorer when webExplorerComplete is false', async () => {
      const runner = makeMockRunner('route_web_explorer') as any;
      const brainNode = createBrainNode(runner, [], undefined, [], undefined, undefined);
      const state = makeStateWithCompletion(
        'find flights from Hyderabad to Amsterdam',
        'research',
        { webExplorerComplete: false }
      );

      const result = await brainNode(state);

      // Observed: Brain routes to web_explorer when completion flag is false
      expect(result.routingDecision?.decision).toBe('route_web_explorer');
    });

    it('should route to web_explorer when webExplorerComplete is undefined (first-time routing)', async () => {
      const runner = makeMockRunner('route_web_explorer') as any;
      const brainNode = createBrainNode(runner, [], undefined, [], undefined, undefined);
      const state = makeStateWithCompletion(
        'research the best anime discord bots',
        'research',
        {} // No completion flags set
      );

      const result = await brainNode(state);

      // Observed: Brain routes to web_explorer when completion flag is undefined
      expect(result.routingDecision?.decision).toBe('route_web_explorer');
    });

    it('should route to coding_specialist when codingComplete is false', async () => {
      const runner = makeMockRunner('route_coding') as any;
      const brainNode = createBrainNode(runner, [], undefined, [], undefined, undefined);
      const state = makeStateWithCompletion(
        'create a React app with TypeScript',
        'coding',
        { codingComplete: false }
      );

      const result = await brainNode(state);

      // Observed: Brain routes to coding_specialist when completion flag is false
      expect(result.routingDecision?.decision).toBe('route_coding');
    });

    it('should route to data_analyst when dataAnalysisComplete is false', async () => {
      const runner = makeMockRunner('route_data_analyst') as any;
      const brainNode = createBrainNode(runner, [], undefined, [], undefined, undefined);
      const state = makeStateWithCompletion(
        'analyze this CSV file',
        'analyze',
        { dataAnalysisComplete: false }
      );

      const result = await brainNode(state);

      // Observed: Brain routes to data_analyst when completion flag is false
      expect(result.routingDecision?.decision).toBe('route_data_analyst');
    });

    it('should route to computer_use when computerUseComplete is false', async () => {
      const runner = makeMockRunner('route_computer_use') as any;
      const brainNode = createBrainNode(runner, [], undefined, [], undefined, undefined);
      const state = makeStateWithCompletion(
        'click the submit button',
        'automate',
        { computerUseComplete: false }
      );

      const result = await brainNode(state);

      // Observed: Brain routes to computer_use when completion flag is false
      expect(result.routingDecision?.decision).toBe('route_computer_use');
    });
  });

  /**
   * Preservation Test 2: Different Specialist Routing
   *
   * Requirement 3.2: WHEN Brain's routing LLM successfully parses JSON and
   * returns a valid routing decision AND no specialist completion flags are set
   * THEN the system SHALL CONTINUE TO follow the routing decision as normal
   *
   * Observed behavior on UNFIXED code:
   * - webExplorerComplete: true, routing decision: route_coding → routes to coding_specialist
   * - Routing to a different specialist than the completed one works as normal
   */
  describe('Different Specialist Routing', () => {
    it('should route to coding_specialist when webExplorerComplete is true but routing decision is route_coding', async () => {
      const runner = makeMockRunner('route_coding') as any;
      const brainNode = createBrainNode(runner, [], undefined, [], undefined, undefined);
      const state = makeStateWithCompletion(
        'research React docs and create a component',
        'coding',
        { webExplorerComplete: true } // web_explorer completed, but routing to coding
      );

      const result = await brainNode(state);

      // Observed: Brain routes to coding_specialist (different specialist)
      expect(result.routingDecision?.decision).toBe('route_coding');
    });

    it('should route to web_explorer when codingComplete is true but routing decision is route_web_explorer', async () => {
      const runner = makeMockRunner('route_web_explorer') as any;
      const brainNode = createBrainNode(runner, [], undefined, [], undefined, undefined);
      const state = makeStateWithCompletion(
        'create a component and research best practices',
        'research',
        { codingComplete: true } // coding completed, but routing to web_explorer
      );

      const result = await brainNode(state);

      // Observed: Brain routes to web_explorer (different specialist)
      expect(result.routingDecision?.decision).toBe('route_web_explorer');
    });

    it('should route to data_analyst when codingComplete is true but routing decision is route_data_analyst', async () => {
      const runner = makeMockRunner('route_data_analyst') as any;
      const brainNode = createBrainNode(runner, [], undefined, [], undefined, undefined);
      const state = makeStateWithCompletion(
        'create a dashboard and analyze the data',
        'analyze',
        { codingComplete: true } // coding completed, but routing to data_analyst
      );

      const result = await brainNode(state);

      // Observed: Brain routes to data_analyst (different specialist)
      expect(result.routingDecision?.decision).toBe('route_data_analyst');
    });
  });

  /**
   * Preservation Test 3: Normal Routing LLM Success
   *
   * Requirement 3.2: WHEN Brain's routing LLM successfully parses JSON and
   * returns a valid routing decision AND no specialist completion flags are set
   * THEN the system SHALL CONTINUE TO follow the routing decision as normal
   *
   * Observed behavior on UNFIXED code:
   * - All completion flags false → routing decision is executed as normal
   * - Routing LLM success path works correctly
   */
  describe('Normal Routing LLM Success', () => {
    it('should follow routing decision when all completion flags are false', async () => {
      const runner = makeMockRunner('route_web_explorer') as any;
      const brainNode = createBrainNode(runner, [], undefined, [], undefined, undefined);
      const state = makeStateWithCompletion(
        'research the best anime discord bots',
        'research',
        {
          webExplorerComplete: false,
          codingComplete: false,
          dataAnalysisComplete: false,
          computerUseComplete: false,
        }
      );

      const result = await brainNode(state);

      // Observed: Brain follows routing decision when all flags are false
      expect(result.routingDecision?.decision).toBe('route_web_explorer');
    });

    it('should follow routing decision when no completion flags are set', async () => {
      const runner = makeMockRunner('route_coding') as any;
      const brainNode = createBrainNode(runner, [], undefined, [], undefined, undefined);
      const state = makeStateWithCompletion(
        'create a React app',
        'coding',
        {} // No completion flags set
      );

      const result = await brainNode(state);

      // Observed: Brain follows routing decision when no flags are set
      expect(result.routingDecision?.decision).toBe('route_coding');
    });
  });

  /**
   * Preservation Test 4: Multi-Iteration Specialist Workflows
   *
   * Requirement 3.3: WHEN a research task requires multiple iterations AND
   * web_explorer has not signaled completion THEN the system SHALL CONTINUE TO
   * route back to web_explorer as needed
   *
   * Observed behavior on UNFIXED code:
   * - webExplorerComplete: false, multiple iterations → continues routing to web_explorer
   * - Multi-iteration workflows work correctly
   */
  describe('Multi-Iteration Specialist Workflows', () => {
    it('should continue routing to web_explorer across multiple iterations when not complete', async () => {
      const runner = makeMockRunner('route_web_explorer') as any;
      const brainNode = createBrainNode(runner, [], undefined, [], undefined, undefined);

      // Iteration 1
      const state1 = makeStateWithCompletion(
        'research the best anime discord bots',
        'research',
        { webExplorerComplete: false },
        1
      );
      const result1 = await brainNode(state1);
      expect(result1.routingDecision?.decision).toBe('route_web_explorer');

      // Iteration 2
      const state2 = makeStateWithCompletion(
        'research the best anime discord bots',
        'research',
        { webExplorerComplete: false },
        2
      );
      const result2 = await brainNode(state2);
      expect(result2.routingDecision?.decision).toBe('route_web_explorer');

      // Iteration 3
      const state3 = makeStateWithCompletion(
        'research the best anime discord bots',
        'research',
        { webExplorerComplete: false },
        3
      );
      const result3 = await brainNode(state3);
      expect(result3.routingDecision?.decision).toBe('route_web_explorer');
    });

    it('should continue routing to coding_specialist across multiple iterations when not complete', async () => {
      const runner = makeMockRunner('route_coding') as any;
      const brainNode = createBrainNode(runner, [], undefined, [], undefined, undefined);

      // Iteration 1
      const state1 = makeStateWithCompletion(
        'create a React app with TypeScript',
        'coding',
        { codingComplete: false },
        1
      );
      const result1 = await brainNode(state1);
      expect(result1.routingDecision?.decision).toBe('route_coding');

      // Iteration 2
      const state2 = makeStateWithCompletion(
        'create a React app with TypeScript',
        'coding',
        { codingComplete: false },
        2
      );
      const result2 = await brainNode(state2);
      expect(result2.routingDecision?.decision).toBe('route_coding');
    });
  });

  /**
   * Preservation Test 5: Fallback Routing for Incomplete Specialists
   *
   * Requirement 3.4: WHEN Brain falls back to intent-based routing for
   * non-research intents (coding, analyze, automate) AND the corresponding
   * specialist has not completed THEN the system SHALL CONTINUE TO route to
   * the appropriate specialist
   *
   * Observed behavior on UNFIXED code:
   * - Routing LLM fails, intent: research, webExplorerComplete: false → fallback routes to web_explorer
   * - Fallback routing works correctly for incomplete specialists
   */
  describe('Fallback Routing for Incomplete Specialists', () => {
    it('should fallback route to web_explorer when routing LLM fails and webExplorerComplete is false', async () => {
      const runner = makeMockRunner(null) as any; // null = routing LLM fails
      const brainNode = createBrainNode(runner, [], undefined, [], undefined, undefined);
      const state = makeStateWithCompletion(
        'research the best anime discord bots',
        'research',
        { webExplorerComplete: false }
      );

      const result = await brainNode(state);

      // Observed: Fallback routing routes to web_explorer when completion flag is false
      expect(result.routingDecision?.decision).toBe('route_web_explorer');
    });

    it('should fallback route to coding_specialist when routing LLM fails and codingComplete is false', async () => {
      const runner = makeMockRunner(null) as any; // null = routing LLM fails
      const brainNode = createBrainNode(runner, [], undefined, [], undefined, undefined);
      const state = makeStateWithCompletion(
        'create a React app',
        'coding',
        { codingComplete: false }
      );

      const result = await brainNode(state);

      // Observed: Fallback routing routes to coding_specialist when completion flag is false
      expect(result.routingDecision?.decision).toBe('route_coding');
    });

    it('should fallback route to data_analyst when routing LLM fails and dataAnalysisComplete is false', async () => {
      const runner = makeMockRunner(null) as any; // null = routing LLM fails
      const brainNode = createBrainNode(runner, [], undefined, [], undefined, undefined);
      const state = makeStateWithCompletion(
        'analyze this CSV',
        'analyze',
        { dataAnalysisComplete: false }
      );

      const result = await brainNode(state);

      // Observed: Fallback routing routes to data_analyst when completion flag is false
      expect(result.routingDecision?.decision).toBe('route_data_analyst');
    });
  });

  /**
   * Property-Based Test: All Incomplete Specialist Routing Preserved
   *
   * Property: For all states where specialist completion flag is NOT true
   * (false or undefined) AND routing decision routes to that specialist,
   * Brain SHALL execute routing decision as normal.
   *
   * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**
   */
  describe('Property-Based Preservation Tests', () => {
    it('property: incomplete specialists are routed to correctly', () => {
      fc.assert(
        fc.property(
          fc.record({
            // Exclude research intent from property-based test due to early routing logic
            intent: fc.constantFrom('coding', 'analyze', 'automate'),
            completionValue: fc.constantFrom(false, undefined),
            iterations: fc.integer({ min: 1, max: 5 }),
          }),
          async ({ intent, completionValue, iterations }) => {
            // Map intent to routing decision and completion flag
            const routingMap: Record<string, { decision: string; flag: string }> = {
              coding: { decision: 'route_coding', flag: 'codingComplete' },
              analyze: { decision: 'route_data_analyst', flag: 'dataAnalysisComplete' },
              automate: { decision: 'route_computer_use', flag: 'computerUseComplete' },
            };

            const { decision, flag } = routingMap[intent];
            const runner = makeMockRunner(decision) as any;
            const brainNode = createBrainNode(runner, [], undefined, [], undefined, undefined);

            // Create state with incomplete specialist
            const completionFlags: any = {};
            completionFlags[flag] = completionValue;

            const state = makeStateWithCompletion(
              `Test request for ${intent}`,
              intent as any,
              completionFlags,
              iterations
            );

            const result = await brainNode(state);

            // Property: Brain should route to the specialist when completion flag is NOT true
            expect(result.routingDecision?.decision).toBe(decision);
          }
        ),
        { numRuns: 20 }
      );
    });

    it('property: routing to different specialists is preserved', () => {
      fc.assert(
        fc.property(
          fc.record({
            completedSpecialist: fc.constantFrom('web_explorer', 'coding', 'data_analyst', 'computer_use'),
            // Exclude research intent from property-based test due to early routing logic
            targetSpecialist: fc.constantFrom('coding', 'data_analyst', 'computer_use'),
          }),
          async ({ completedSpecialist, targetSpecialist }) => {
            // Map specialists to routing decisions and completion flags
            const specialistMap: Record<string, { decision: string; flag: string; intent: string }> = {
              web_explorer: { decision: 'route_web_explorer', flag: 'webExplorerComplete', intent: 'research' },
              coding: { decision: 'route_coding', flag: 'codingComplete', intent: 'coding' },
              data_analyst: { decision: 'route_data_analyst', flag: 'dataAnalysisComplete', intent: 'analyze' },
              computer_use: { decision: 'route_computer_use', flag: 'computerUseComplete', intent: 'automate' },
            };

            const targetInfo = specialistMap[targetSpecialist];
            const completedInfo = specialistMap[completedSpecialist];

            // Skip if routing to the same specialist (that's the bug condition)
            if (completedInfo.decision === targetInfo.decision) {
              return;
            }

            const runner = makeMockRunner(targetInfo.decision) as any;
            const brainNode = createBrainNode(runner, [], undefined, [], undefined, undefined);

            // Create state with completed specialist flag set to true
            const completionFlags: any = {};
            completionFlags[completedInfo.flag] = true;

            const state = makeStateWithCompletion(
              `Test request for ${targetInfo.intent}`,
              targetInfo.intent as any,
              completionFlags
            );

            const result = await brainNode(state);

            // Property: Brain should route to the target specialist (different from completed one)
            expect(result.routingDecision?.decision).toBe(targetInfo.decision);
          }
        ),
        { numRuns: 20 }
      );
    });

    it('property: fallback routing for incomplete specialists is preserved', () => {
      fc.assert(
        fc.property(
          fc.record({
            // Exclude research intent from property-based test due to early routing logic
            intent: fc.constantFrom('coding', 'analyze', 'automate'),
            completionValue: fc.constantFrom(false, undefined),
          }),
          async ({ intent, completionValue }) => {
            // Map intent to routing decision and completion flag
            const routingMap: Record<string, { decision: string; flag: string }> = {
              coding: { decision: 'route_coding', flag: 'codingComplete' },
              analyze: { decision: 'route_data_analyst', flag: 'dataAnalysisComplete' },
              automate: { decision: 'route_computer_use', flag: 'computerUseComplete' },
            };

            const { decision, flag } = routingMap[intent];
            const runner = makeMockRunner(null) as any; // null = routing LLM fails
            const brainNode = createBrainNode(runner, [], undefined, [], undefined, undefined);

            // Create state with incomplete specialist
            const completionFlags: any = {};
            completionFlags[flag] = completionValue;

            const state = makeStateWithCompletion(
              `Test request for ${intent}`,
              intent as any,
              completionFlags
            );

            const result = await brainNode(state);

            // Property: Fallback routing should route to the specialist when completion flag is NOT true
            expect(result.routingDecision?.decision).toBe(decision);
          }
        ),
        { numRuns: 20 }
      );
    });
  });

  /**
   * Preservation Summary Test
   *
   * Documents all preservation requirements:
   * 1. Incomplete specialist routing preserved (webExplorerComplete: false → routes to web_explorer)
   * 2. First-time routing preserved (webExplorerComplete: undefined → routes to web_explorer)
   * 3. Different specialist routing preserved (webExplorerComplete: true, routes to coding → routes to coding_specialist)
   * 4. Normal routing LLM success preserved (all flags false → follows routing decision)
   * 5. Multi-iteration specialist preserved (webExplorerComplete: false, multiple iterations → continues routing to web_explorer)
   *
   * On UNFIXED code: All preservation requirements are met
   * Expected (after fix): All preservation requirements continue to be met
   */
  it('should document preservation requirements', async () => {
    // Preservation Requirement 1: Incomplete specialist routing preserved
    const runner1 = makeMockRunner('route_web_explorer') as any;
    const brainNode1 = createBrainNode(runner1, [], undefined, [], undefined, undefined);
    const state1 = makeStateWithCompletion(
      'research anime bots',
      'research',
      { webExplorerComplete: false }
    );
    const result1 = await brainNode1(state1);
    expect(result1.routingDecision?.decision).toBe('route_web_explorer');

    // Preservation Requirement 2: First-time routing preserved
    const runner2 = makeMockRunner('route_web_explorer') as any;
    const brainNode2 = createBrainNode(runner2, [], undefined, [], undefined, undefined);
    const state2 = makeStateWithCompletion(
      'research anime bots',
      'research',
      {} // No completion flags set
    );
    const result2 = await brainNode2(state2);
    expect(result2.routingDecision?.decision).toBe('route_web_explorer');

    // Preservation Requirement 3: Different specialist routing preserved
    const runner3 = makeMockRunner('route_coding') as any;
    const brainNode3 = createBrainNode(runner3, [], undefined, [], undefined, undefined);
    const state3 = makeStateWithCompletion(
      'create a component',
      'coding',
      { webExplorerComplete: true } // web_explorer completed, but routing to coding
    );
    const result3 = await brainNode3(state3);
    expect(result3.routingDecision?.decision).toBe('route_coding');

    // Preservation Requirement 4: Normal routing LLM success preserved
    const runner4 = makeMockRunner('route_web_explorer') as any;
    const brainNode4 = createBrainNode(runner4, [], undefined, [], undefined, undefined);
    const state4 = makeStateWithCompletion(
      'research anime bots',
      'research',
      {
        webExplorerComplete: false,
        codingComplete: false,
        dataAnalysisComplete: false,
        computerUseComplete: false,
      }
    );
    const result4 = await brainNode4(state4);
    expect(result4.routingDecision?.decision).toBe('route_web_explorer');

    // Preservation Requirement 5: Multi-iteration specialist preserved
    const runner5 = makeMockRunner('route_web_explorer') as any;
    const brainNode5 = createBrainNode(runner5, [], undefined, [], undefined, undefined);
    const state5a = makeStateWithCompletion(
      'research anime bots',
      'research',
      { webExplorerComplete: false },
      1
    );
    const result5a = await brainNode5(state5a);
    expect(result5a.routingDecision?.decision).toBe('route_web_explorer');

    const state5b = makeStateWithCompletion(
      'research anime bots',
      'research',
      { webExplorerComplete: false },
      2
    );
    const result5b = await brainNode5(state5b);
    expect(result5b.routingDecision?.decision).toBe('route_web_explorer');
  });
});
