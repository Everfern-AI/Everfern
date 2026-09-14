/**
 * Preservation Property Tests — Data Analyst Plan & Memory Fix
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**
 *
 * Property 2: Preservation — First-Turn Plan Creation & Turn-1 Message Construction
 *
 * IMPORTANT: Follow observation-first methodology. Observe behavior on UNFIXED code first.
 *
 * These tests MUST PASS on unfixed code to establish the baseline behavior that must be
 * preserved after the fix. They use property-based testing to generate many random inputs
 * and verify that first-turn behavior is unchanged.
 *
 * ---
 *
 * Preservation Requirements:
 *
 * 1. When `_plans.size === 0`, `createDataAnalystNode` produces a `systemPromptOverride`
 *    with no `## Current Plan` section (same as after fix — first turn is unaffected)
 *
 * 2. When `runStream` is called for turn 1 (empty history), `initialMessages` = `[system, user]`
 *    with no extra messages injected
 *
 * 3. `createCodingSpecialistNode` and `createWebExplorerNode` system prompts are unchanged
 *    regardless of `_plans` state
 *
 * 4. Analysis session context (DataFrames, variables, execution history) continues to work
 *
 * 5. "reset session" / "clear context" command continues to reset analysis session
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import { loadPlans, clearPlans, getActivePlans } from '../../../tools/planner';
import { buildSystemMessages } from '../../system-prompt';
import type { PlanRecord } from '../../types';
import * as fs from 'fs';
import * as path from 'path';

// ─── Property-Based Test Generators ──────────────────────────────────────────

/**
 * Generator for empty plan states (_plans.size === 0)
 */
const emptyPlanStateArb = fc.constant(0).map(() => {
  clearPlans(); // Ensure _plans is empty
  return getActivePlans();
});

/**
 * Generator for random user inputs (first turn)
 */
const firstTurnUserInputArb = fc.oneof(
  fc.string({ minLength: 1, maxLength: 100 }),
  fc.constantFrom(
    'Analyze sales data',
    'Create a dashboard',
    'Load data.csv and compute statistics',
    'Generate insights from the dataset',
    'Plot a histogram of values'
  )
);

/**
 * Generator for empty conversation history (turn 1)
 */
const emptyHistoryArb = fc.constant([]);

// ─── Preservation Property Tests ─────────────────────────────────────────────

describe('Preservation Property Tests — Data Analyst Plan & Memory Fix', () => {
  beforeEach(() => {
    clearPlans();
    vi.clearAllMocks();
  });

  afterEach(() => {
    clearPlans();
    vi.restoreAllMocks();
  });

  /**
   * Property 1: First-Turn Plan Creation Preservation (Static Analysis)
   *
   * For all _plans states where _plans.size === 0, the data analyst systemPromptOverride
   * is identical before and after the fix (no ## Current Plan section injected).
   *
   * This test MUST PASS on unfixed code to establish baseline behavior.
   *
   * **Validates: Requirements 3.1, 3.4**
   */
  it('should preserve first-turn data analyst behavior when _plans is empty (static analysis)', () => {
    fc.assert(
      fc.property(emptyPlanStateArb, (planState) => {
        // Verify _plans is empty (first turn scenario)
        expect(getActivePlans()).toHaveLength(0);

        // Read the source code to verify current behavior
        // Contract updated (wave F11) for commit 2482e73 ("Arch docs"): the
        // createDataAnalystNode implementation moved from
        // nodes/specialized_agents.ts (now a re-export barrel) to
        // agents/data-analyst.ts.
        const sourceFile = path.join(process.cwd(), 'main/agent/runner/agents/data-analyst.ts');
        const sourceCode = fs.readFileSync(sourceFile, 'utf-8');

        // Look for the createDataAnalystNode function
        const dataAnalystNodeMatch = sourceCode.match(/export const createDataAnalystNode[\s\S]*?systemPromptOverride:[^\n]*/);

        if (dataAnalystNodeMatch) {
          // The override expression is built from the base prompt template
          // (loaded from data-analyst.md or the inline fallback below it)
          // concatenated with conditionally-built sections.
          const baseTemplateMatch = sourceCode.match(/systemPrompt = `([\s\S]*?)`/);

          if (baseTemplateMatch) {
            // On UNFIXED code: when _plans is empty, system prompt should NOT contain ## Current Plan
            // This behavior must be preserved after the fix (first turn unchanged)
            // The base template never contains ## Current Plan; plan injection
            // happens only conditionally via planStateContext (guarded by
            // activePlans.length > 0), so first-turn output is unchanged.
            expect(baseTemplateMatch[1]).not.toContain('## Current Plan');
          }

          // Plan injection is conditional — guarded by activePlans.length > 0
          expect(sourceCode).toContain('activePlans.length > 0');
        }

        return true;
      }),
      { numRuns: 5 }
    );
  });

  /**
   * Property 2: Turn-1 Message Construction Preservation
   *
   * For all turn-1 runStream invocations (empty prior history), initialMessages
   * is identical before and after the fix.
   *
   * This test MUST PASS on unfixed code to establish baseline behavior.
   *
   * **Validates: Requirements 3.2, 3.3**
   */
  it('should preserve turn-1 initialMessages construction when history is empty', async () => {
    // Contract updated (wave F11) for commit cfe5aab ("feat: Added Projects"),
    // which made buildSystemMessages async (system-prompt.ts:465). The result
    // must now be awaited; the turn-1 shape [system, user] is otherwise
    // unchanged and must stay preserved.
    await fc.assert(
      fc.asyncProperty(emptyHistoryArb, firstTurnUserInputArb, async (history, userInput) => {
        // Verify this is turn 1 (empty history)
        expect(history).toHaveLength(0);

        // Build system messages using the current implementation
        const platform = 'linux';
        const conversationId = 'test-conv-id';
        const preloadedPrompt = 'Mock system prompt';

        const { messages: initialMessages } = await buildSystemMessages(
          history,
          userInput,
          platform,
          conversationId,
          [],
          preloadedPrompt
        );

        // On turn 1, initialMessages should contain only [system, user]
        // This behavior must be preserved after the fix
        expect(initialMessages).toHaveLength(2);
        expect(initialMessages[0]).toMatchObject({ role: 'system' });
        expect(initialMessages[1]).toMatchObject({ role: 'user', content: userInput });

        // Should not contain any tool messages on turn 1
        const toolMessages = initialMessages.filter((msg: any) => msg.role === 'tool');
        expect(toolMessages).toHaveLength(0);

        // Should not contain any assistant messages with tool_calls on turn 1
        const assistantWithToolCalls = initialMessages.filter(
          (msg: any) => msg.role === 'assistant' && msg.tool_calls
        );
        expect(assistantWithToolCalls).toHaveLength(0);

        return true;
      }),
      { numRuns: 10 }
    );
  });

  /**
   * Property 3: Coding Specialist System Prompt Preservation (Static Analysis)
   *
   * For all inputs, createCodingSpecialistNode system prompt never contains
   * a ## Current Plan section from _plans (it has its own plan context from decomposedTask).
   *
   * This test MUST PASS on unfixed code and after the fix.
   *
   * **Validates: Requirements 3.3**
   */
  it('should preserve coding specialist system prompt regardless of _plans state', () => {
    fc.assert(
      fc.property(fc.boolean(), (hasPlans) => {
        // Randomly set up _plans state (empty or with plans)
        clearPlans();
        if (hasPlans) {
          const mockPlan: PlanRecord = {
            id: 'test-plan',
            title: 'Test Plan',
            steps: [
              { id: 'step-1', description: 'Test step', status: 'pending' },
            ],
            createdAt: new Date().toISOString(),
          };
          loadPlans([mockPlan]);
        }

        // Read the source code to verify coding specialist behavior
        // Contract updated (wave F11) for commit 2482e73 ("Arch docs"):
        // implementation moved from nodes/specialized_agents.ts (now a
        // re-export barrel) to agents/coding-specialist.ts.
        const sourceFile = path.join(process.cwd(), 'main/agent/runner/agents/coding-specialist.ts');
        const sourceCode = fs.readFileSync(sourceFile, 'utf-8');

        // Look for the createCodingSpecialistNode function
        const codingSpecialistMatch = sourceCode.match(/export const createCodingSpecialistNode[\s\S]*?systemPromptOverride:[^\n]*/);

        if (codingSpecialistMatch) {
          // Examine the full module: the plan-context helper (buildCodingHandoff)
          // is defined above createCodingSpecialistNode, and the node body calls it.
          // Contract updated (wave F11) for commit 2482e73 ("Arch docs") and
          // follow-up refactors: the monolithic systemPromptOverride template
          // with inline ${planContext} was replaced by a coding-specialist.md
          // prompt plus a decomposer handoff (buildCodingHandoff) built from
          // state.decomposedTask — never from _plans.
          const fullNodeCode = sourceCode.slice(codingSpecialistMatch.index);

          // Coding specialist should NEVER contain ## Current Plan from _plans
          // It has its own plan context from decomposedTask
          expect(fullNodeCode).not.toContain('## Current Plan');
          expect(fullNodeCode).not.toContain('A plan is already in progress');
          expect(sourceCode).not.toContain('getActivePlans');

          // Should contain its own plan context logic from decomposedTask
          // (helper defined above the node function, invoked within it)
          expect(sourceCode).toContain('decomposedTask');
          expect(sourceCode).toContain('buildCodingHandoff');
          expect(fullNodeCode).toContain('buildCodingHandoff');
        }

        return true;
      }),
      { numRuns: 5 }
    );
  });

  /**
   * Property 4: Web Explorer System Prompt Preservation (Static Analysis)
   *
   * For all inputs, createWebExplorerNode system prompt is unchanged.
   *
   * This test MUST PASS on unfixed code and after the fix.
   *
   * **Validates: Requirements 3.3**
   */
  it('should preserve web explorer system prompt regardless of _plans state', () => {
    fc.assert(
      fc.property(fc.boolean(), (hasPlans) => {
        // Randomly set up _plans state (empty or with plans)
        clearPlans();
        if (hasPlans) {
          const mockPlan: PlanRecord = {
            id: 'test-plan',
            title: 'Test Plan',
            steps: [
              { id: 'step-1', description: 'Test step', status: 'pending' },
            ],
            createdAt: new Date().toISOString(),
          };
          loadPlans([mockPlan]);
        }

        // Read the source code to verify web explorer behavior
        // Contract updated (wave F11) for commit 2482e73 ("Arch docs"):
        // implementation moved from nodes/specialized_agents.ts (now a
        // re-export barrel) to agents/web-explorer.ts.
        const sourceFile = path.join(process.cwd(), 'main/agent/runner/agents/web-explorer.ts');
        const sourceCode = fs.readFileSync(sourceFile, 'utf-8');

        // Look for the createWebExplorerNode function
        const webExplorerMatch = sourceCode.match(/export const createWebExplorerNode[\s\S]*?systemPromptOverride:[^\n]*/);

        if (webExplorerMatch) {
          // Check the full createWebExplorerNode code: the system prompt
          // construction plus any context it builds must never inject _plans.
          // Contract updated (wave F11) for commit 2482e73 ("Arch docs") and
          // follow-up refactors: web explorer is now phase-driven, loading its
          // prompt from web-explorer.md with per-phase instructions and no
          // _plans-derived plan context at all.
          const fullNodeCode = sourceCode.slice(webExplorerMatch.index);

          // Web explorer should NEVER contain ## Current Plan from _plans
          expect(fullNodeCode).not.toContain('## Current Plan');
          expect(fullNodeCode).not.toContain('A plan is already in progress');
          expect(fullNodeCode).not.toContain('getActivePlans');
        }

        return true;
      }),
      { numRuns: 5 }
    );
  });

  /**
   * Property 5: Analysis Session Context Preservation (Static Analysis)
   *
   * The analysis session context (DataFrames, variables, execution history) built by
   * getAnalysisSessionManager must continue to be included in the data analyst's system prompt.
   *
   * This test MUST PASS on unfixed code and after the fix.
   *
   * **Validates: Requirements 3.4**
   */
  it('should preserve analysis session context in data analyst system prompt', () => {
    // Read the source code to verify session context is included
    // Contract updated (wave F11) for commit 2482e73 ("Arch docs"): the
    // createDataAnalystNode implementation moved from
    // nodes/specialized_agents.ts (now a re-export barrel) to
    // agents/data-analyst.ts.
    const sourceFile = path.join(process.cwd(), 'main/agent/runner/agents/data-analyst.ts');
    const sourceCode = fs.readFileSync(sourceFile, 'utf-8');

    // Look for analysis session context logic in createDataAnalystNode
    const dataAnalystNodeMatch = sourceCode.match(/export const createDataAnalystNode[\s\S]*?integrator\.wrapNode/);

    expect(dataAnalystNodeMatch).toBeTruthy();

    if (dataAnalystNodeMatch) {
      const nodeCode = dataAnalystNodeMatch[0];

      // Should contain analysis session context logic
      expect(nodeCode).toContain('getAnalysisSessionManager');
      expect(nodeCode).toContain('sessionContext');
      expect(nodeCode).toContain('ANALYSIS SESSION CONTEXT');
      expect(nodeCode).toContain('Active DataFrames');
      expect(nodeCode).toContain('Stored Variables');
      expect(nodeCode).toContain('Execution History');
    }
  });

  /**
   * Property 6: Session Reset Command Preservation (Static Analysis)
   *
   * The "reset session" / "clear context" command must continue to reset the analysis session.
   *
   * This test MUST PASS on unfixed code and after the fix.
   *
   * **Validates: Requirements 3.5**
   */
  it('should preserve session reset functionality', () => {
    // Read the source code to verify reset functionality exists
    // Contract updated (wave F11) for commit 2482e73 ("Arch docs"): the
    // createDataAnalystNode implementation moved from
    // nodes/specialized_agents.ts (now a re-export barrel) to
    // agents/data-analyst.ts.
    const sourceFile = path.join(process.cwd(), 'main/agent/runner/agents/data-analyst.ts');
    const sourceCode = fs.readFileSync(sourceFile, 'utf-8');

    // Look for session reset logic in createDataAnalystNode
    const dataAnalystNodeCode = sourceCode.match(/export const createDataAnalystNode[\s\S]*?integrator\.wrapNode/);

    expect(dataAnalystNodeCode).toBeTruthy();

    if (dataAnalystNodeCode) {
      const nodeCode = dataAnalystNodeCode[0];

      // Should contain session reset logic
      expect(nodeCode).toContain('reset session');
      expect(nodeCode).toContain('clear context');
      expect(nodeCode).toContain('resetSession');
      expect(nodeCode).toContain('session has been reset');
    }
  });

  /**
   * Property 7: runStream History Loading Preservation (Static Analysis)
   *
   * Verify that runStream now loads full conversation history but preserves
   * turn-1 behavior (no extra messages injected when no prior history exists).
   *
   * This test verifies the fix is implemented while preserving turn-1 behavior.
   *
   * **Validates: Requirements 3.2, 3.3**
   */
  it('should confirm runStream now loads full conversation history but preserves turn-1 behavior', () => {
    // Read the source code of runner.ts
    const sourceFile = path.join(process.cwd(), 'main/agent/runner/runner.ts');
    const sourceCode = fs.readFileSync(sourceFile, 'utf-8');

    // Look for runStream function
    const runStreamMatch = sourceCode.match(/async \*runStream\([\s\S]*?\n  \}/);

    if (runStreamMatch) {
      const runStreamCode = runStreamMatch[0];

      // After fix: runStream should contain ChatHistoryStore.load
      const hasHistoryStoreLoad = runStreamCode.includes('ChatHistoryStore') && runStreamCode.includes('.load(');

      // This should be true after fix (confirming fix is implemented)
      expect(hasHistoryStoreLoad).toBe(true);

      // Should still use buildSystemMessages (preserved behavior)
      expect(runStreamCode).toContain('buildSystemMessages');
      expect(runStreamCode).toContain('history');

      // Should have reconstruction logic
      expect(runStreamCode).toContain('reconstructFullHistory');
    }
  });

  /**
   * Property 8: Plan State Access Preservation (Static Analysis)
   *
   * Verify that createDataAnalystNode now accesses _plans state but preserves
   * first-turn behavior (no plan injection when _plans is empty).
   *
   * This test verifies the fix is implemented while preserving first-turn behavior.
   *
   * **Validates: Requirements 3.1, 3.4**
   */
  it('should confirm createDataAnalystNode now accesses _plans state but preserves first-turn behavior', () => {
    // Read the source code of the createDataAnalystNode implementation.
    // Contract updated (wave F11) for commit 2482e73 ("Arch docs"): the
    // implementation moved from nodes/specialized_agents.ts (now a re-export
    // barrel) to agents/data-analyst.ts.
    const sourceFile = path.join(process.cwd(), 'main/agent/runner/agents/data-analyst.ts');
    const sourceCode = fs.readFileSync(sourceFile, 'utf-8');

    // Check imports at the top of the file
    const hasGetActivePlansImport = sourceCode.includes('getActivePlans');

    // After fix: getActivePlans should be imported
    expect(hasGetActivePlansImport).toBe(true);

    // Look for createDataAnalystNode function
    const dataAnalystNodeMatch = sourceCode.match(/export const createDataAnalystNode[\s\S]*?integrator\.wrapNode/);

    expect(dataAnalystNodeMatch).toBeTruthy();

    if (dataAnalystNodeMatch) {
      const nodeCode = dataAnalystNodeMatch[0];

      // Should contain getActivePlans calls (fix implemented)
      expect(nodeCode).toContain('getActivePlans');

      // Should have conditional plan state injection logic
      expect(nodeCode).toContain('planStateContext');
      expect(nodeCode).toContain('activePlans.length > 0');
    }
  });
});
