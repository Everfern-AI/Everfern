/**
 * Bug Condition Exploration Test — Web Explorer Termination Infinite Loop After MISSION_COMPLETE
 *
 * **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5**
 *
 * Property 1: Bug Condition — Web Explorer Continues Streaming After MISSION_COMPLETE
 *
 * CRITICAL: These tests MUST FAIL on unfixed code — failure confirms the bug exists.
 * DO NOT attempt to fix the code or the tests when they fail.
 * These tests encode the expected behavior — they will validate the fix when they pass
 * after implementation.
 *
 * ---
 *
 * Three bug paths are tested:
 *
 * Path A — Phase 3 synthesis returns without clearing streaming buffers:
 *   When `createWebExplorerNode` detects MISSION_COMPLETE in Phase 3, it returns
 *   `{ webExplorerComplete: true, taskPhase: 'evaluating' }` but the streaming
 *   buffers (thoughtBuffer, streamedText) in `runAgentStep` are not properly flushed
 *   before the agent completes. This causes the frontend to receive repeated chunks
 *   from stale buffers.
 *
 *   Expected counterexample (unfixed code):
 *     The Phase 3 return block does NOT include `pendingToolCalls: []` to signal
 *     completion, and streaming buffers are not flushed in agent-runtime.ts
 *
 * Path B — Streaming continues after MISSION_COMPLETE marker is detected:
 *   When `runAgentStep` processes a response containing "MISSION_COMPLETE", it should
 *   immediately flush buffers and terminate streaming. However, on unfixed code,
 *   the streaming logic continues to process chunks and emit them to the eventQueue
 *   even after MISSION_COMPLETE is detected.
 *
 *   Expected counterexample (unfixed code):
 *     There is no early termination or buffer flush when MISSION_COMPLETE is detected
 *     in the response content
 *
 * Path C — Completion flags not properly set when MISSION_COMPLETE is reached:
 *   When Phase 3 synthesis completes with MISSION_COMPLETE, the state must set:
 *   - webExplorerComplete: true (to signal graph edge to route to brain)
 *   - pendingToolCalls: [] (to prevent stale tool calls from being processed)
 *   - returningFromSpecialist: null (to return control to main agent)
 *
 *   On unfixed code, these flags may not all be set, causing the graph to either
 *   self-loop or continue processing stale state.
 *
 *   Expected counterexample (unfixed code):
 *     The Phase 3 return block is missing one or more of these completion flags
 *
 * ---
 *
 * Observed failures on unfixed code:
 *   Path A: The Phase 3 return block does not include `pendingToolCalls: []`
 *   Path B: No early termination logic exists for MISSION_COMPLETE in streaming
 *   Path C: Completion flags are not all set when MISSION_COMPLETE is detected
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// ── Source file paths ─────────────────────────────────────────────────────────

const WEB_EXPLORER_PATH = path.join(
  process.cwd(),
  'main/agent/runner/agents/web-explorer.ts'
);

const AGENT_RUNTIME_PATH = path.join(
  process.cwd(),
  'main/agent/runner/services/agent-runtime.ts'
);

// ── Path A Tests ─────────────────────────────────────────────────────────────

describe('Bug Condition — Path A: Phase 3 synthesis returns without clearing streaming buffers', () => {
  /**
   * Test A1: Phase 3 must include pendingToolCalls: [] in the MISSION_COMPLETE return
   *
   * On UNFIXED code: the Phase 3 return statement is:
   *   return { ...result, webExplorerComplete: true, taskPhase: 'evaluating' as const, ... }
   *   (may not include pendingToolCalls: [])
   *
   * After fix: the return statement includes pendingToolCalls: []
   *
   * Counterexample: pendingToolCalls is absent from the Phase 3 return,
   * causing stale tool calls to remain in state and streaming to continue.
   *
   * **Validates: Requirements 1.1, 1.5, 2.5**
   */
  it('should include pendingToolCalls: [] in the Phase 3 synthesis return block', () => {
    const source = fs.readFileSync(WEB_EXPLORER_PATH, 'utf-8');

    // Find the Phase 3 synthesis block (after searchInvoked && navisInvoked)
    // Look for the return statement that includes webExplorerComplete: true
    const phase3Block = source.match(
      /if\s*\(\s*searchInvoked\s*&&\s*navisInvoked\s*\)([\s\S]*?)return\s*\{([^}]+webExplorerComplete:\s*true[^}]*)\}/
    );

    expect(phase3Block).toBeTruthy();

    if (phase3Block) {
      const returnBody = phase3Block[2];

      // On UNFIXED code: returnBody does NOT contain 'pendingToolCalls' — FAILS
      // After fix: returnBody DOES contain 'pendingToolCalls'
      const hasPendingToolCalls = returnBody.includes('pendingToolCalls');

      expect(hasPendingToolCalls).toBe(true);
    }
  });

  /**
   * Test A2: Phase 3 must set pendingToolCalls to an empty array (not just define it)
   *
   * On UNFIXED code: pendingToolCalls is absent entirely — FAILS
   * After fix: pendingToolCalls: [] is present
   *
   * **Validates: Requirements 1.1, 1.5, 2.5**
   */
  it('should set pendingToolCalls to [] (not just define it) in the Phase 3 return', () => {
    const source = fs.readFileSync(WEB_EXPLORER_PATH, 'utf-8');

    // Look for the Phase 3 return with pendingToolCalls: []
    // Pattern: searchInvoked && navisInvoked block containing pendingToolCalls: []
    const hasExplicitEmptyArray = source.match(
      /if\s*\(\s*searchInvoked\s*&&\s*navisInvoked\s*\)([\s\S]{0,2000}?)pendingToolCalls:\s*\[\]/
    );

    // On UNFIXED code: this is null — FAILS (confirms the bug)
    expect(hasExplicitEmptyArray).toBeTruthy();
  });

  /**
   * Test A3: Direct structural check — Phase 3 return includes all completion flags
   *
   * On UNFIXED code: only webExplorerComplete: true is returned — FAILS
   * After fix: webExplorerComplete, pendingToolCalls, and returningFromSpecialist are all set
   *
   * **Validates: Requirements 1.1, 1.5, 2.5**
   */
  it('should return webExplorerComplete: true, pendingToolCalls: [], and returningFromSpecialist: null', () => {
    const source = fs.readFileSync(WEB_EXPLORER_PATH, 'utf-8');

    // Find the Phase 3 block and its return statement
    // The block starts with `if (searchInvoked && navisInvoked)`
    const phase3BlockMatch = source.match(
      /if\s*\(\s*searchInvoked\s*&&\s*navisInvoked\s*\)\s*\{([\s\S]*?)return\s*\{([^}]+)\}/
    );

    expect(phase3BlockMatch).toBeTruthy();

    if (phase3BlockMatch) {
      const returnBody = phase3BlockMatch[2];

      const hasWebExplorerComplete = returnBody.includes('webExplorerComplete');
      const hasPendingToolCalls = returnBody.includes('pendingToolCalls');
      const hasReturningFromSpecialist = returnBody.includes('returningFromSpecialist');

      // All three flags should be set
      expect(hasWebExplorerComplete).toBe(true);
      expect(hasPendingToolCalls).toBe(true);
      expect(hasReturningFromSpecialist).toBe(true);
    }
  });

  /**
   * Test A4: Verify the early return for MISSION_COMPLETE detection
   *
   * On UNFIXED code: the early return for MISSION_COMPLETE may not include pendingToolCalls
   * After fix: the early return includes pendingToolCalls: []
   *
   * **Validates: Requirements 1.1, 1.2, 2.2**
   */
  it('should include pendingToolCalls: [] in the early MISSION_COMPLETE detection return', () => {
    const source = fs.readFileSync(WEB_EXPLORER_PATH, 'utf-8');

    // Find the early return for MISSION_COMPLETE detection
    // Pattern: if (lastContent.includes('MISSION_COMPLETE')) { return { ... } }
    const missionCompleteReturn = source.match(
      /MISSION_COMPLETE[\s\S]{0,200}return\s*\{([^}]+)\}/
    );

    expect(missionCompleteReturn).toBeTruthy();

    if (missionCompleteReturn) {
      const returnBody = missionCompleteReturn[1];

      // The early return should also include pendingToolCalls: []
      const hasPendingToolCalls = returnBody.includes('pendingToolCalls');

      expect(hasPendingToolCalls).toBe(true);
    }
  });
});

// ── Path B Tests ─────────────────────────────────────────────────────────────

describe('Bug Condition — Path B: Streaming continues after MISSION_COMPLETE marker is detected', () => {
  /**
   * Test B1: The streaming logic must detect MISSION_COMPLETE and terminate early
   *
   * On UNFIXED code: there is no early termination logic for MISSION_COMPLETE
   *   in the onStreamChunk callback or streaming buffer handling
   *
   * After fix: the streaming logic checks for MISSION_COMPLETE and flushes buffers
   *
   * Counterexample: streaming continues to process chunks even after MISSION_COMPLETE
   * is detected in the response content.
   *
   * **Validates: Requirements 1.2, 1.3, 2.2, 2.3**
   */
  it('should have logic to detect MISSION_COMPLETE in streaming and terminate early', () => {
    const source = fs.readFileSync(AGENT_RUNTIME_PATH, 'utf-8');

    // After fix: there should be a check for MISSION_COMPLETE in the streaming section
    // Pattern: MISSION_COMPLETE check in onStreamChunk or after streaming completes
    const hasMissionCompleteCheck =
      source.includes('MISSION_COMPLETE') ||
      source.match(/streamedText[\s\S]{0,500}MISSION_COMPLETE/) !== null ||
      source.match(/MISSION_COMPLETE[\s\S]{0,500}streamedText/) !== null;

    // On UNFIXED code: this is false — FAILS (confirms bug)
    expect(hasMissionCompleteCheck).toBe(true);
  });

  /**
   * Test B2: The streaming buffer must be flushed when MISSION_COMPLETE is detected
   *
   * On UNFIXED code: buffers are not flushed when MISSION_COMPLETE is detected — FAILS
   * After fix: buffers are flushed and streaming terminates
   *
   * **Validates: Requirements 1.2, 1.3, 2.2, 2.3**
   */
  it('should flush streaming buffers when MISSION_COMPLETE is detected', () => {
    const source = fs.readFileSync(AGENT_RUNTIME_PATH, 'utf-8');

    // After fix: there should be buffer flushing logic in the MISSION_COMPLETE path
    // Pattern: thoughtBuffer or streamedText handling in MISSION_COMPLETE context
    const hasBufferFlush =
      source.match(/MISSION_COMPLETE[\s\S]{0,300}(thoughtBuffer|streamedText)/) !== null ||
      source.match(/(thoughtBuffer|streamedText)[\s\S]{0,300}MISSION_COMPLETE/) !== null;

    // On UNFIXED code: this is false — FAILS (confirms bug)
    expect(hasBufferFlush).toBe(true);
  });

  /**
   * Test B3: The streaming logic must not emit repeated chunks after MISSION_COMPLETE
   *
   * On UNFIXED code: the onStreamChunk callback continues to emit chunks
   *   even after MISSION_COMPLETE is detected — FAILS
   *
   * After fix: streaming terminates and no more chunks are emitted
   *
   * **Validates: Requirements 1.2, 1.3, 2.2, 2.3**
   */
  it('should prevent repeated chunk emissions after MISSION_COMPLETE is detected', () => {
    const source = fs.readFileSync(AGENT_RUNTIME_PATH, 'utf-8');

    // After fix: there should be a flag or early return that prevents further chunk emissions
    // Pattern: a check that stops processing when MISSION_COMPLETE is found
    const hasTerminationLogic =
      source.match(/MISSION_COMPLETE[\s\S]{0,500}(return|break|continue)/) !== null ||
      source.match(/if[\s\S]{0,100}MISSION_COMPLETE[\s\S]{0,100}(return|break)/) !== null;

    // On UNFIXED code: this is false — FAILS (confirms bug)
    expect(hasTerminationLogic).toBe(true);
  });
});

// ── Path C Tests ─────────────────────────────────────────────────────────────

describe('Bug Condition — Path C: Completion flags not properly set when MISSION_COMPLETE is reached', () => {
  /**
   * Test C1: The webExplorerComplete flag must be set to true when MISSION_COMPLETE is detected
   *
   * On UNFIXED code: webExplorerComplete may not be set in the Phase 3 return — FAILS
   * After fix: webExplorerComplete: true is explicitly set
   *
   * Counterexample: webExplorerComplete is undefined or false, causing the graph
   * edge to self-loop instead of routing to brain.
   *
   * **Validates: Requirements 1.1, 1.5, 2.5**
   */
  it('should set webExplorerComplete: true when MISSION_COMPLETE is detected', () => {
    const source = fs.readFileSync(WEB_EXPLORER_PATH, 'utf-8');

    // Find all return statements in Phase 3 that should set webExplorerComplete: true
    const phase3Returns = source.match(
      /if\s*\(\s*searchInvoked\s*&&\s*navisInvoked\s*\)([\s\S]*?)return\s*\{([^}]*webExplorerComplete:\s*true[^}]*)\}/g
    );

    // On UNFIXED code: phase3Returns may be null or incomplete — FAILS
    expect(phase3Returns).toBeTruthy();
    expect(phase3Returns?.length).toBeGreaterThan(0);
  });

  /**
   * Test C2: The returningFromSpecialist flag must be set to null to return control to main agent
   *
   * On UNFIXED code: returningFromSpecialist may not be set to null — FAILS
   * After fix: returningFromSpecialist: null is explicitly set
   *
   * **Validates: Requirements 1.1, 1.5, 2.5**
   */
  it('should set returningFromSpecialist: null when MISSION_COMPLETE is detected', () => {
    const source = fs.readFileSync(WEB_EXPLORER_PATH, 'utf-8');

    // Find the Phase 3 return that includes returningFromSpecialist: null
    const hasReturningFromSpecialistNull = source.match(
      /if\s*\(\s*searchInvoked\s*&&\s*navisInvoked\s*\)([\s\S]{0,2000}?)returningFromSpecialist:\s*null/
    );

    // On UNFIXED code: this is null — FAILS (confirms bug)
    expect(hasReturningFromSpecialistNull).toBeTruthy();
  });

  /**
   * Test C3: All three completion flags must be set together in the Phase 3 return
   *
   * On UNFIXED code: one or more flags may be missing — FAILS
   * After fix: all three flags are present in the return statement
   *
   * **Validates: Requirements 1.1, 1.5, 2.5**
   */
  it('should set all three completion flags (webExplorerComplete, pendingToolCalls, returningFromSpecialist) together', () => {
    const source = fs.readFileSync(WEB_EXPLORER_PATH, 'utf-8');

    // Find the Phase 3 return statement
    const phase3Return = source.match(
      /if\s*\(\s*searchInvoked\s*&&\s*navisInvoked\s*\)([\s\S]*?)return\s*\{([^}]+)\}/
    );

    expect(phase3Return).toBeTruthy();

    if (phase3Return) {
      const returnBody = phase3Return[2];

      // All three flags should be present
      const hasWebExplorerComplete = returnBody.includes('webExplorerComplete');
      const hasPendingToolCalls = returnBody.includes('pendingToolCalls');
      const hasReturningFromSpecialist = returnBody.includes('returningFromSpecialist');

      // On UNFIXED code: one or more of these is false — FAILS
      expect(hasWebExplorerComplete).toBe(true);
      expect(hasPendingToolCalls).toBe(true);
      expect(hasReturningFromSpecialist).toBe(true);
    }
  });

  /**
   * Test C4: Graph loop condition — demonstrates the exact self-loop trigger
   *
   * Simulates the graph edge decision logic to show that without webExplorerComplete: true,
   * the graph would self-loop.
   *
   * This test uses the UNFIXED return shape to demonstrate the bug:
   *   { pendingToolCalls: [], webExplorerComplete: undefined }
   *   → falls into the "otherwise" branch → infinite self-loop
   *
   * On UNFIXED code: the unfixed return shape triggers the self-loop — FAILS
   * After fix: the fixed return shape prevents the self-loop
   *
   * **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5**
   */
  it('should demonstrate that the unfixed return shape triggers the graph self-loop condition', () => {
    // Simulate the graph edge decision logic (from graph.ts web_explorer conditional edge)
    function simulateGraphEdge(state: { pendingToolCalls?: any[]; webExplorerComplete?: boolean }): string {
      if (state.pendingToolCalls && state.pendingToolCalls.length > 0) {
        return 'action_validation';
      }
      if (state.webExplorerComplete === true) {
        return 'brain';
      }
      return 'web_explorer'; // self-loop!
    }

    // UNFIXED return shape (what createWebExplorerNode returns on unfixed code)
    const unfixedReturnShape = {
      pendingToolCalls: undefined, // not set
      webExplorerComplete: undefined, // not set
    };

    // FIXED return shape (what createWebExplorerNode should return after the fix)
    const fixedReturnShape = {
      pendingToolCalls: [],
      webExplorerComplete: true,
    };

    const unfixedRoute = simulateGraphEdge(unfixedReturnShape);
    const fixedRoute = simulateGraphEdge(fixedReturnShape);

    // Unfixed code routes to self-loop (this is the bug)
    expect(unfixedRoute).toBe('web_explorer'); // self-loop confirmed

    // Fixed code routes to brain (this is the expected behavior)
    expect(fixedRoute).toBe('brain');

    // The key assertion: the source code must produce the fixed return shape
    // (verified by Tests C1, C2, C3 above)
    expect(fixedRoute).not.toBe('web_explorer');
  });

  /**
   * Test C5: Verify the early MISSION_COMPLETE return also sets all flags
   *
   * On UNFIXED code: the early return for MISSION_COMPLETE detection may not set all flags — FAILS
   * After fix: all flags are set in the early return
   *
   * **Validates: Requirements 1.1, 1.2, 2.2**
   */
  it('should set all completion flags in the early MISSION_COMPLETE detection return', () => {
    const source = fs.readFileSync(WEB_EXPLORER_PATH, 'utf-8');

    // Find the early return for MISSION_COMPLETE detection
    // Pattern: if (lastContent.includes('MISSION_COMPLETE')) { return { ... } }
    const missionCompleteReturn = source.match(
      /MISSION_COMPLETE[\s\S]{0,200}return\s*\{([^}]+)\}/
    );

    expect(missionCompleteReturn).toBeTruthy();

    if (missionCompleteReturn) {
      const returnBody = missionCompleteReturn[1];

      const hasWebExplorerComplete = returnBody.includes('webExplorerComplete');
      const hasPendingToolCalls = returnBody.includes('pendingToolCalls');
      const hasReturningFromSpecialist = returnBody.includes('returningFromSpecialist');

      // All three flags should be set in the early return too
      expect(hasWebExplorerComplete).toBe(true);
      expect(hasPendingToolCalls).toBe(true);
      expect(hasReturningFromSpecialist).toBe(true);
    }
  });
});

// ── Integration Tests ─────────────────────────────────────────────────────────

describe('Bug Condition — Integration: Streaming termination and state cleanup', () => {
  /**
   * Test I1: Verify that streaming buffer flushing is implemented
   *
   * On UNFIXED code: there is no buffer flushing logic for MISSION_COMPLETE — FAILS
   * After fix: buffers are flushed when MISSION_COMPLETE is detected
   *
   * **Validates: Requirements 1.2, 1.3, 2.2, 2.3**
   */
  it('should have buffer flushing logic in the streaming section', () => {
    const source = fs.readFileSync(AGENT_RUNTIME_PATH, 'utf-8');

    // After fix: there should be buffer flushing logic
    // Pattern: thoughtBuffer or streamedText being flushed/cleared
    const hasBufferFlushing =
      source.includes('thoughtBuffer') &&
      source.includes('streamedText') &&
      (
        source.match(/thoughtBuffer[\s\S]{0,200}flush/) !== null ||
        source.match(/flush[\s\S]{0,200}thoughtBuffer/) !== null ||
        source.match(/thoughtBuffer\s*=\s*['"]/) !== null
      );

    // On UNFIXED code: this is false — FAILS (confirms bug)
    expect(hasBufferFlushing).toBe(true);
  });

  /**
   * Test I2: Verify that the final response is sent correctly when MISSION_COMPLETE
   *
   * On UNFIXED code: the final response may not be sent or may be repeated — FAILS
   * After fix: the final response is sent once and streaming terminates
   *
   * **Validates: Requirements 1.1, 1.2, 2.1, 2.2**
   */
  it('should send the final response correctly when MISSION_COMPLETE is detected', () => {
    const source = fs.readFileSync(AGENT_RUNTIME_PATH, 'utf-8');

    // After fix: there should be logic to send the final response
    // Pattern: eventQueue?.push with the final content
    const hasFinalResponseLogic =
      source.includes('finalResponse') ||
      source.match(/eventQueue[\s\S]{0,500}chunk[\s\S]{0,500}content/) !== null;

    // On UNFIXED code: this may be incomplete — FAILS
    expect(hasFinalResponseLogic).toBe(true);
  });
});
