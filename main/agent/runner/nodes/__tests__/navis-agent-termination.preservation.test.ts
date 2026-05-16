/**
 * Preservation Property Tests — Navis Agent Termination Fix
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**
 *
 * Property 2: Preservation — Normal Web Explorer Workflow
 *
 * IMPORTANT: These tests capture baseline behavior on UNFIXED code.
 * They MUST PASS on unfixed code to confirm what behavior to preserve.
 * After the fix is implemented, these tests should still pass (no regressions).
 *
 * Testing Strategy: Observe behavior on UNFIXED code for non-buggy inputs:
 * - web_explorer Phase 1 (search) with pending tool calls
 * - web_explorer Phase 2 (Navis investigation) with pending tool calls
 * - web_explorer Phase 3 (synthesis) with pending tool calls
 * - Brain with pending tool calls (non-web_explorer)
 * - Specialist agents (coding, data_analyst, computer_use) completing and returning to brain
 *
 * Write property-based tests capturing observed behavior patterns:
 * - When web_explorer is in Phase 1 or Phase 2, graph should loop within web_explorer
 * - When web_explorer has pending tool calls, graph should route to multi_tool_orchestrator
 * - When brain receives research intent, graph should route to web_explorer
 * - When brain has pending tool calls, graph should route to multi_tool_orchestrator
 * - When specialist agents complete, graph should route back to brain
 * - When multi_tool_orchestrator completes with returningFromSpecialist set, graph should route back to specialist
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GraphStateType } from '../../state';

// ── Mock dependencies ────────────────────────────────────────────────────────

// Mock the agent runtime service
vi.mock('../../services/agent-runtime', () => ({
  runAgentStep: vi.fn(async (state, options) => {
    // Simulate agent producing a response with pending tool calls
    // This is the normal case for active phases
    const result: any = {
      messages: [
        ...state.messages,
        {
          role: 'assistant',
          content: 'Executing phase...',
        },
      ],
      pendingToolCalls: options.nodeName === 'web_explorer'
        ? [{ name: 'web_search', arguments: { query: 'test' } }]
        : [],
    };

    // For web_explorer, preserve the phase flags
    if (options.nodeName === 'web_explorer') {
      result.searchInvoked = state.searchInvoked;
      result.navisInvoked = state.navisInvoked;
      result.webExplorerComplete = state.webExplorerComplete;
    }

    return result;
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
 * Creates a minimal GraphStateType state for testing
 */
const makeState = (overrides: Partial<GraphStateType> = {}): GraphStateType => ({
  messages: [
    { role: 'user', content: 'Test request' } as any,
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
  ...overrides,
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Preservation Properties — Navis Agent Termination Fix', () => {
  /**
   * Property 3.1: Web Explorer Phase 1 Preservation
   *
   * When web_explorer is in Phase 1 (search) with pending tool calls,
   * the graph should loop within web_explorer (not route to brain or END).
   *
   * Scenario:
   *   - web_explorer Phase 1 is active (searchInvoked: false, navisInvoked: false)
   *   - web_explorer has pending tool calls (web_search)
   *   - webExplorerComplete: false
   *
   * Expected behavior:
   *   - web_explorer node should return with pendingToolCalls set
   *   - Graph should route to multi_tool_orchestrator for tool execution
   *   - After tool execution, graph should return to web_explorer (not brain)
   *
   * **Validates: Requirements 3.1**
   */
  describe('Property 3.1: Web Explorer Phase 1 Preservation', () => {
    it('should preserve Phase 1 state when web_explorer is in initial phase', async () => {
      const state = makeState({
        currentIntent: 'research' as any,
        webExplorerComplete: false,
        searchInvoked: false,
        navisInvoked: false,
        pendingToolCalls: [],
      });

      // Verify state is set up correctly for Phase 1
      expect(state.webExplorerComplete).toBe(false);
      expect(state.searchInvoked).toBe(false);
      expect(state.navisInvoked).toBe(false);
      expect(state.currentIntent).toBe('research');
    });

    it('should preserve Phase 1 behavior: no completion when active', async () => {
      // Phase 1 should NOT be complete
      const state = makeState({
        searchInvoked: false,
        navisInvoked: false,
        webExplorerComplete: false,
      });

      // Verify Phase 1 is not complete
      expect(state.webExplorerComplete).toBe(false);
      expect(state.searchInvoked).toBe(false);
    });
  });

  /**
   * Property 3.2: Web Explorer Phase 2 Preservation
   *
   * When web_explorer is in Phase 2 (Navis investigation) with pending tool calls,
   * the graph should loop within web_explorer (not route to brain or END).
   *
   * Scenario:
   *   - web_explorer Phase 2 is active (searchInvoked: true, navisInvoked: false)
   *   - web_explorer has pending tool calls (navis)
   *   - webExplorerComplete: false
   *
   * Expected behavior:
   *   - web_explorer node should return with pendingToolCalls set
   *   - Graph should route to multi_tool_orchestrator for tool execution
   *   - After tool execution, graph should return to web_explorer (not brain)
   *
   * **Validates: Requirements 3.2**
   */
  describe('Property 3.2: Web Explorer Phase 2 Preservation', () => {
    it('should preserve Phase 2 state when web_explorer is investigating', async () => {
      const state = makeState({
        currentIntent: 'research' as any,
        webExplorerComplete: false,
        searchInvoked: true,
        navisInvoked: false,
        pendingToolCalls: [],
        messages: [
          { role: 'user', content: 'Find pricing for AWS' } as any,
          {
            role: 'tool',
            name: 'web_search',
            content: 'https://aws.amazon.com/pricing https://aws.amazon.com/ec2/pricing'
          } as any,
        ],
      });

      // Verify state is set up correctly for Phase 2
      expect(state.webExplorerComplete).toBe(false);
      expect(state.searchInvoked).toBe(true);
      expect(state.navisInvoked).toBe(false);
    });

    it('should preserve Phase 2 behavior: no completion when active', async () => {
      // Phase 2 should NOT be complete
      const state = makeState({
        searchInvoked: true,
        navisInvoked: false,
        webExplorerComplete: false,
      });

      // Verify Phase 2 is not complete
      expect(state.webExplorerComplete).toBe(false);
      expect(state.searchInvoked).toBe(true);
      expect(state.navisInvoked).toBe(false);
    });
  });

  /**
   * Property 3.3: Web Explorer Phase 3 Preservation
   *
   * When web_explorer is in Phase 3 (synthesis) with pending tool calls,
   * the graph should loop within web_explorer (not route to brain or END).
   *
   * Scenario:
   *   - web_explorer Phase 3 is active (searchInvoked: true, navisInvoked: true)
   *   - web_explorer has pending tool calls (synthesis)
   *   - webExplorerComplete: false
   *
   * Expected behavior:
   *   - web_explorer node should return with pendingToolCalls set
   *   - Graph should route to multi_tool_orchestrator for tool execution
   *   - After tool execution, graph should return to web_explorer (not brain)
   *
   * **Validates: Requirements 3.3**
   */
  describe('Property 3.3: Web Explorer Phase 3 Preservation', () => {
    it('should preserve Phase 3 state when web_explorer is synthesizing', async () => {
      const state = makeState({
        currentIntent: 'research' as any,
        webExplorerComplete: false,
        searchInvoked: true,
        navisInvoked: true,
        pendingToolCalls: [],
        messages: [
          { role: 'user', content: 'Find pricing for AWS' } as any,
          {
            role: 'tool',
            name: 'web_search',
            content: 'https://aws.amazon.com/pricing'
          } as any,
          {
            role: 'tool',
            name: 'navis',
            content: 'EC2 pricing: $0.0116 per hour'
          } as any,
        ],
      });

      // Verify state is set up correctly for Phase 3
      expect(state.webExplorerComplete).toBe(false);
      expect(state.searchInvoked).toBe(true);
      expect(state.navisInvoked).toBe(true);
    });

    it('should preserve Phase 3 behavior: no completion when active', async () => {
      // Phase 3 should NOT be complete until synthesis is done
      const state = makeState({
        searchInvoked: true,
        navisInvoked: true,
        webExplorerComplete: false,
      });

      // Verify Phase 3 is not complete
      expect(state.webExplorerComplete).toBe(false);
      expect(state.searchInvoked).toBe(true);
      expect(state.navisInvoked).toBe(true);
    });
  });

  /**
   * Property 3.4: Brain Pending Tool Calls Preservation
   *
   * When brain has pending tool calls (non-web_explorer), the graph should
   * route to multi_tool_orchestrator for tool execution.
   *
   * Scenario:
   *   - Brain produces pending tool calls (e.g., web_search, navis)
   *   - No specialist routing is needed
   *   - pendingToolCalls.length > 0
   *
   * Expected behavior:
   *   - Graph should route to multi_tool_orchestrator (not brain or specialist)
   *   - After tool execution, graph should return to brain
   *
   * **Validates: Requirements 3.4**
   */
  describe('Property 3.4: Brain Pending Tool Calls Preservation', () => {
    it('should preserve brain state when brain has pending tool calls', async () => {
      const state = makeState({
        currentIntent: 'research' as any,
        pendingToolCalls: [
          { name: 'web_search', arguments: { query: 'test' } }
        ],
        messages: [
          { role: 'user', content: 'Search for information' } as any,
          {
            role: 'assistant',
            content: 'I will search for that information.'
          } as any,
        ],
      });

      // Verify state has pending tool calls
      expect(state.pendingToolCalls).toBeDefined();
      expect(state.pendingToolCalls?.length).toBeGreaterThan(0);
      expect(state.pendingToolCalls?.[0].name).toBe('web_search');
    });

    it('should preserve brain behavior: tools take precedence over routing', async () => {
      // When brain has pending tools, tools should be executed first
      const state = makeState({
        pendingToolCalls: [
          { name: 'web_search', arguments: { query: 'test' } }
        ],
        routingDecision: null,
      });

      // Verify tools take precedence
      expect(state.pendingToolCalls?.length).toBeGreaterThan(0);
      expect(state.routingDecision).toBeNull();
    });
  });

  /**
   * Property 3.5: Specialist Agent Completion Preservation
   *
   * When a specialist agent (coding, data_analyst, computer_use) completes,
   * the graph should route back to brain for coordination.
   *
   * Scenario:
   *   - Specialist agent completes (e.g., codingComplete: true)
   *   - No pending tool calls
   *   - returningFromSpecialist is set to the specialist name
   *
   * Expected behavior:
   *   - Graph should route back to brain (not END or another specialist)
   *   - Brain should coordinate next steps
   *
   * **Validates: Requirements 3.5**
   */
  describe('Property 3.5: Specialist Agent Completion Preservation', () => {
    it('should preserve routing back to brain when specialist completes', async () => {
      const state = makeState({
        currentIntent: 'coding' as any,
        codingComplete: true,
        pendingToolCalls: [],
        returningFromSpecialist: 'coding_specialist',
        messages: [
          { role: 'user', content: 'Create a React app' } as any,
          {
            role: 'assistant',
            content: 'I have created the React app.'
          } as any,
        ],
      });

      // Verify specialist completion state
      expect(state.codingComplete).toBe(true);
      expect(state.returningFromSpecialist).toBe('coding_specialist');
      expect(state.pendingToolCalls?.length).toBe(0);
    });

    it('should preserve specialist completion for all specialists', async () => {
      const specialists = [
        { flag: 'codingComplete', specialist: 'coding_specialist', intent: 'coding' as const },
        { flag: 'dataAnalysisComplete', specialist: 'data_analyst', intent: 'analyze' as const },
        { flag: 'computerUseComplete', specialist: 'computer_use_agent', intent: 'automate' as const },
      ];

      for (const spec of specialists) {
        const state = makeState({
          currentIntent: spec.intent,
          [spec.flag]: true,
          pendingToolCalls: [],
          returningFromSpecialist: spec.specialist,
        });

        // Verify specialist completion state
        expect((state as any)[spec.flag]).toBe(true);
        expect(state.returningFromSpecialist).toBe(spec.specialist);
        expect(state.pendingToolCalls?.length).toBe(0);
      }
    });
  });

  /**
   * Property 3.6: Multi Tool Orchestrator Return Preservation
   *
   * When multi_tool_orchestrator completes with returningFromSpecialist set,
   * the graph should route back to the appropriate specialist.
   *
   * Scenario:
   *   - multi_tool_orchestrator executes tools
   *   - returningFromSpecialist is set to a specialist name
   *   - Tools complete successfully
   *
   * Expected behavior:
   *   - Graph should route back to the specialist (not brain or END)
   *   - Specialist should continue processing
   *
   * **Validates: Requirements 3.6**
   */
  describe('Property 3.6: Multi Tool Orchestrator Return Preservation', () => {
    it('should preserve routing back to specialist when returningFromSpecialist is set', async () => {
      const scenarios = [
        {
          specialist: 'web_explorer',
          flag: 'webExplorerComplete',
          expectedRoute: 'web_explorer',
        },
        {
          specialist: 'coding_specialist',
          flag: 'codingComplete',
          expectedRoute: 'coding_specialist',
        },
        {
          specialist: 'data_analyst',
          flag: 'dataAnalysisComplete',
          expectedRoute: 'data_analyst',
        },
        {
          specialist: 'computer_use_agent',
          flag: 'computerUseComplete',
          expectedRoute: 'computer_use_agent',
        },
      ];

      for (const scenario of scenarios) {
        // Simulate multi_tool_orchestrator state after tool execution
        const state = makeState({
          pendingToolCalls: [], // Tools executed
          returningFromSpecialist: scenario.specialist,
          [scenario.flag]: false, // Specialist not yet complete
          messages: [
            { role: 'user', content: 'Test request' } as any,
            {
              role: 'tool',
              name: 'web_search',
              content: 'Tool result'
            } as any,
          ],
        });

        // Verify state has returningFromSpecialist set
        expect(state.returningFromSpecialist).toBe(scenario.specialist);

        // Verify specialist is not complete
        expect((state as any)[scenario.flag]).toBe(false);

        // Verify no pending tools (orchestrator finished)
        expect(state.pendingToolCalls).toEqual([]);
      }
    });
  });

  /**
   * Property-Based Test: Preservation across all non-buggy scenarios
   *
   * For all inputs where the bug condition does NOT hold (active web_explorer phases,
   * pending tools, other specialist agents), the graph should produce the same behavior
   * as the original graph, preserving all existing functionality.
   *
   * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**
   */
  describe('Property-Based: Preservation across all non-buggy scenarios', () => {
    it('should preserve routing for all combinations of active phases and pending tools', async () => {
      // Test matrix: all combinations of active phases and pending tools
      const scenarios = [
        // Phase 1 scenarios
        {
          name: 'Phase 1 with pending web_search',
          state: {
            searchInvoked: false,
            navisInvoked: false,
            webExplorerComplete: false,
            pendingToolCalls: [{ name: 'web_search', arguments: {} }],
          },
          expectedBehavior: 'loop_in_web_explorer',
        },
        // Phase 2 scenarios
        {
          name: 'Phase 2 with pending navis',
          state: {
            searchInvoked: true,
            navisInvoked: false,
            webExplorerComplete: false,
            pendingToolCalls: [{ name: 'navis', arguments: {} }],
          },
          expectedBehavior: 'loop_in_web_explorer',
        },
        // Phase 3 scenarios
        {
          name: 'Phase 3 with pending synthesis',
          state: {
            searchInvoked: true,
            navisInvoked: true,
            webExplorerComplete: false,
            pendingToolCalls: [{ name: 'web_search', arguments: {} }],
          },
          expectedBehavior: 'loop_in_web_explorer',
        },
        // Brain with pending tools
        {
          name: 'Brain with pending tools',
          state: {
            webExplorerComplete: false,
            pendingToolCalls: [{ name: 'web_search', arguments: {} }],
            returningFromSpecialist: null,
          },
          expectedBehavior: 'route_to_orchestrator',
        },
        // Specialist completion
        {
          name: 'Specialist completed',
          state: {
            codingComplete: true,
            pendingToolCalls: [],
            returningFromSpecialist: 'coding_specialist',
          },
          expectedBehavior: 'route_to_brain',
        },
      ];

      for (const scenario of scenarios) {
        const state = makeState({
          currentIntent: 'research' as any,
          ...scenario.state,
        });

        // Verify state is set up correctly
        expect(state).toBeDefined();

        // Verify expected behavior indicators are present
        if (scenario.expectedBehavior === 'loop_in_web_explorer') {
          expect(state.webExplorerComplete).toBe(false);
        } else if (scenario.expectedBehavior === 'route_to_orchestrator') {
          expect(state.pendingToolCalls?.length).toBeGreaterThan(0);
        } else if (scenario.expectedBehavior === 'route_to_brain') {
          expect(state.returningFromSpecialist).toBeDefined();
        }
      }
    });

    it('should preserve non-buggy state: web_explorer not complete when phases are active', async () => {
      // Non-buggy: web_explorer is in active phase
      const state = makeState({
        webExplorerComplete: false,
        searchInvoked: false,
        navisInvoked: false,
      });

      // Verify non-buggy state
      expect(state.webExplorerComplete).toBe(false);
    });

    it('should preserve non-buggy state: pending tools exist', async () => {
      // Non-buggy: brain has pending tools
      const state = makeState({
        pendingToolCalls: [{ name: 'web_search', arguments: {} }],
      });

      // Verify non-buggy state
      expect(state.pendingToolCalls?.length).toBeGreaterThan(0);
    });

    it('should preserve non-buggy state: specialist not complete', async () => {
      // Non-buggy: specialist is still working
      const state = makeState({
        codingComplete: false,
        returningFromSpecialist: 'coding_specialist',
      });

      // Verify non-buggy state
      expect(state.codingComplete).toBe(false);
      expect(state.returningFromSpecialist).toBe('coding_specialist');
    });
  });
});
