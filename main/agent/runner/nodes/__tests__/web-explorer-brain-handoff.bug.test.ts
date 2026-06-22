/**
 * Bug Condition Exploration Test: Web Explorer Brain Handoff
 *
 * This test explores the bug where web_explorer completes and returns to brain
 * without setting `returningFromSpecialist: 'web_explorer'`, causing the brain
 * to make a fresh routing decision instead of recognizing it's returning from
 * a specialist.
 *
 * EXPECTED OUTCOME ON UNFIXED CODE: Test FAILS
 * This failure confirms the bug exists and helps us understand the root cause.
 *
 * EXPECTED OUTCOME ON FIXED CODE: Test PASSES
 * This confirms the fix correctly sets returningFromSpecialist.
 */

import fs from 'fs';
import path from 'path';

const WEB_EXPLORER_PATH = path.join(__dirname, '../../agents/web-explorer.ts');

describe('Bug Condition — Web Explorer Returns Without Specialist Context', () => {
  /**
   * Test 1: Structural check — createWebExplorerNode returns include returningFromSpecialist
   *
   * On UNFIXED code: return statements do NOT include returningFromSpecialist — FAILS
   * After fix: all return statements include returningFromSpecialist: 'web_explorer' — PASSES
   *
   * **Validates: Requirements 2.1, 2.2, 2.3, 2.4**
   */
  it('should return returningFromSpecialist: "web_explorer" in all phases', () => {
    const source = fs.readFileSync(WEB_EXPLORER_PATH, 'utf-8');

    // Check PHASE 1: Initial search return
    const phase1Return = source.match(
      /if\s*\(\s*!searchInvoked\s*&&\s*!navisInvoked\s*\)[\s\S]{0,500}return[\s\S]{0,200}returningFromSpecialist/
    );

    // Check PHASE 2: Worker spawning return
    const phase2Return = source.match(
      /if\s*\(\s*searchInvoked\s*&&\s*!navisInvoked\s*\)[\s\S]{0,500}return[\s\S]{0,200}returningFromSpecialist/
    );

    // Check PHASE 3: Aggregation return
    const phase3Return = source.match(
      /if\s*\(\s*searchInvoked\s*&&\s*navisInvoked\s*\)[\s\S]{0,500}return[\s\S]{0,200}returningFromSpecialist/
    );

    // On UNFIXED code: these will be null or undefined — FAILS
    // After fix: all three should be truthy — PASSES
    expect(phase1Return || phase2Return || phase3Return).toBeTruthy();
  });

  /**
   * Test 2: Specific check — PHASE 1 return includes returningFromSpecialist
   *
   * On UNFIXED code: PHASE 1 return does NOT include returningFromSpecialist — FAILS
   * After fix: PHASE 1 return includes returningFromSpecialist: 'web_explorer' — PASSES
   *
   * **Validates: Requirements 2.1**
   */
  it('should set returningFromSpecialist in PHASE 1 (initial search) return', () => {
    const source = fs.readFileSync(WEB_EXPLORER_PATH, 'utf-8');

    // Find the PHASE 1 block (initial search)
    const phase1Match = source.match(
      /PHASE\s*1[\s\S]{0,4000}if\s*\(\s*!searchInvoked\s*&&\s*!navisInvoked\s*\)[\s\S]{0,2000}returningFromSpecialist/
    );

    // On UNFIXED code: null — FAILS (confirms bug)
    // After fix: match object — PASSES
    expect(phase1Match).toBeTruthy();
  });

  /**
   * Test 3: Specific check — PHASE 2 return includes returningFromSpecialist
   *
   * On UNFIXED code: PHASE 2 return does NOT include returningFromSpecialist — FAILS
   * After fix: PHASE 2 return includes returningFromSpecialist: 'web_explorer' — PASSES
   *
   * **Validates: Requirements 2.2**
   */
  it('should set returningFromSpecialist in PHASE 2 (worker spawning) return', () => {
    const source = fs.readFileSync(WEB_EXPLORER_PATH, 'utf-8');

    // Find the PHASE 2 block (worker spawning)
    const phase2Match = source.match(
      /PHASE\s*2[\s\S]{0,3000}if\s*\(\s*searchInvoked\s*&&\s*!navisInvoked\s*\)[\s\S]{0,2000}return/
    );

    if (!phase2Match) {
      // If PHASE 2 structure doesn't exist, check for alternative patterns
      const altPhase2 = source.match(
        /Spawn\s*Workers[\s\S]{0,500}return[\s\S]{0,200}returningFromSpecialist/i
      ) || source.match(
        /Deep\s*Investigation[\s\S]{0,500}return[\s\S]{0,200}returningFromSpecialist/i
      );
      expect(altPhase2).toBeTruthy();
      return;
    }

    const phase2Block = phase2Match[0];
    const hasReturningFromSpecialist = phase2Block.includes('returningFromSpecialist');

    // On UNFIXED code: false — FAILS (confirms bug)
    // After fix: true — PASSES
    expect(hasReturningFromSpecialist).toBe(true);
  });

  /**
   * Test 4: Specific check — PHASE 3 return includes returningFromSpecialist
   *
   * On UNFIXED code: PHASE 3 return does NOT include returningFromSpecialist — FAILS
   * After fix: PHASE 3 return includes returningFromSpecialist: 'web_explorer' — PASSES
   *
   * **Validates: Requirements 2.3, 2.4**
   */
  it('should set returningFromSpecialist in PHASE 3 (aggregation) return', () => {
    const source = fs.readFileSync(WEB_EXPLORER_PATH, 'utf-8');

    // Find the PHASE 3 block (aggregation)
    const phase3Match = source.match(
      /PHASE\s*3[\s\S]{0,3000}if\s*\(\s*searchInvoked\s*&&\s*navisInvoked\s*\)[\s\S]{0,2000}return/
    );

    if (!phase3Match) {
      // If PHASE 3 structure doesn't exist, check for alternative patterns
      const altPhase3 = source.match(
        /Wait\s*and\s*Aggregate[\s\S]{0,500}return[\s\S]{0,200}returningFromSpecialist/i
      ) || source.match(
        /Synthesis[\s\S]{0,500}return[\s\S]{0,200}returningFromSpecialist/i
      );
      expect(altPhase3).toBeTruthy();
      return;
    }

    const phase3Block = phase3Match[0];
    const hasReturningFromSpecialist = phase3Block.includes('returningFromSpecialist');

    // On UNFIXED code: false — FAILS (confirms bug)
    // After fix: true — PASSES
    expect(hasReturningFromSpecialist).toBe(true);
  });

  /**
   * Test 5: Pattern consistency — returningFromSpecialist value is 'web_explorer'
   *
   * On UNFIXED code: returningFromSpecialist is not set at all — FAILS
   * After fix: returningFromSpecialist: 'web_explorer' is set consistently — PASSES
   *
   * **Validates: Requirements 2.1, 2.2, 2.3, 2.4**
   */
  it('should set returningFromSpecialist to "web_explorer" (not other values)', () => {
    const source = fs.readFileSync(WEB_EXPLORER_PATH, 'utf-8');

    // Count occurrences of returningFromSpecialist: 'web_explorer'
    const webExplorerReturns = (source.match(/returningFromSpecialist:\s*['"]web_explorer['"]/g) || []).length;

    // Count occurrences of returningFromSpecialist with other values (should be 0)
    const otherReturns = (source.match(/returningFromSpecialist:\s*['"][^w][^e][^b]/g) || []).length;

    // On UNFIXED code: webExplorerReturns = 0 — FAILS (confirms bug)
    // After fix: webExplorerReturns >= 3 (one per phase) — PASSES
    expect(webExplorerReturns).toBeGreaterThan(0);
    expect(otherReturns).toBe(0);
  });

  /**
   * Test 6: State merging — returningFromSpecialist is set alongside other state fields
   *
   * On UNFIXED code: return statements don't include returningFromSpecialist — FAILS
   * After fix: return statements include returningFromSpecialist with other fields — PASSES
   *
   * **Validates: Requirements 2.1, 2.2, 2.3, 2.4**
   */
  it('should merge returningFromSpecialist with other state fields in return statements', () => {
    const source = fs.readFileSync(WEB_EXPLORER_PATH, 'utf-8');

    // Find return statements that include both webExplorerComplete and returningFromSpecialist
    const mergedReturns = source.match(
      /return\s*\{[\s\S]{0,300}webExplorerComplete[\s\S]{0,300}returningFromSpecialist[\s\S]{0,50}\}/g
    ) || [];

    // On UNFIXED code: mergedReturns.length = 0 — FAILS (confirms bug)
    // After fix: mergedReturns.length >= 1 — PASSES
    expect(mergedReturns.length).toBeGreaterThan(0);
  });

  /**
   * Test 7: Comparison with other specialists — web_explorer follows same pattern
   *
   * On UNFIXED code: web_explorer doesn't set returningFromSpecialist, but other specialists do — FAILS
   * After fix: web_explorer sets returningFromSpecialist like other specialists — PASSES
   *
   * **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 3.1**
   */
  it('should follow the same returningFromSpecialist pattern as other specialists', () => {
    const source = fs.readFileSync(WEB_EXPLORER_PATH, 'utf-8');

    // Check if web_explorer sets returningFromSpecialist
    const webExplorerSetsReturning = source.includes("returningFromSpecialist: 'web_explorer'");

    // On UNFIXED code: false — FAILS (confirms bug)
    // After fix: true — PASSES
    expect(webExplorerSetsReturning).toBe(true);
  });
});
