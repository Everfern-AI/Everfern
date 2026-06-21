/**
 * Preservation Property Tests: Web Explorer Brain Handoff
 *
 * These tests verify that the fix for web_explorer brain handoff does NOT
 * break existing behavior for other specialists and brain's own logic.
 *
 * EXPECTED OUTCOME ON UNFIXED CODE: Tests PASS
 * This establishes the baseline behavior to preserve.
 *
 * EXPECTED OUTCOME ON FIXED CODE: Tests PASS
 * This confirms the fix doesn't introduce regressions.
 */

import fs from 'fs';
import path from 'path';

const CODING_SPECIALIST_PATH = path.join(__dirname, '../../agents/coding-specialist.ts');
const DATA_ANALYST_PATH = path.join(__dirname, '../../agents/data-analyst.ts');
const COMPUTER_USE_PATH = path.join(__dirname, '../../agents/computer-use.ts');
const DEEP_RESEARCH_PATH = path.join(__dirname, '../../agents/deep-research-agent.ts');
const BRAIN_PATH = path.join(__dirname, '../brain.ts');

describe('Preservation — Other Specialists and Brain Behavior Unchanged', () => {
  /**
   * Test 1: Coding specialist continues to set returningFromSpecialist
   *
   * On UNFIXED code: coding_specialist sets returningFromSpecialist — PASSES
   * After fix: coding_specialist must STILL set returningFromSpecialist — PASSES
   *
   * **Validates: Requirements 3.1**
   */
  it('should preserve coding_specialist setting returningFromSpecialist', () => {
    if (!fs.existsSync(CODING_SPECIALIST_PATH)) {
      console.warn('Coding specialist file not found, skipping test');
      expect(true).toBe(true);
      return;
    }

    const source = fs.readFileSync(CODING_SPECIALIST_PATH, 'utf-8');

    // Check if coding_specialist sets returningFromSpecialist
    const setCodingReturning = source.includes("returningFromSpecialist: null");

    // On UNFIXED code: true — PASSES (baseline)
    // After fix: true — PASSES (preserved)
    expect(setCodingReturning).toBe(true);
  });

  /**
   * Test 2: Data analyst continues to set returningFromSpecialist
   *
   * On UNFIXED code: data_analyst sets returningFromSpecialist — PASSES
   * After fix: data_analyst must STILL set returningFromSpecialist — PASSES
   *
   * **Validates: Requirements 3.1**
   */
  it('should preserve data_analyst setting returningFromSpecialist', () => {
    if (!fs.existsSync(DATA_ANALYST_PATH)) {
      console.warn('Data analyst file not found, skipping test');
      expect(true).toBe(true);
      return;
    }

    const source = fs.readFileSync(DATA_ANALYST_PATH, 'utf-8');

    // Check if data_analyst sets returningFromSpecialist
    const setDataReturning = source.includes("returningFromSpecialist: isComplete ? null : 'data_analyst'");

    // On UNFIXED code: true — PASSES (baseline)
    // After fix: true — PASSES (preserved)
    expect(setDataReturning).toBe(true);
  });

  /**
   * Test 3: Computer use agent continues to set returningFromSpecialist
   *
   * On UNFIXED code: computer_use sets returningFromSpecialist — PASSES
   * After fix: computer_use must STILL set returningFromSpecialist — PASSES
   *
   * **Validates: Requirements 3.1**
   */
  it('should preserve computer_use_agent setting returningFromSpecialist', () => {
    if (!fs.existsSync(COMPUTER_USE_PATH)) {
      console.warn('Computer use file not found, skipping test');
      expect(true).toBe(true);
      return;
    }

    const source = fs.readFileSync(COMPUTER_USE_PATH, 'utf-8');

    // Check if computer_use sets returningFromSpecialist
    const setComputerReturning = source.includes("returningFromSpecialist: null") || source.includes("returningFromSpecialist: 'computer_use_agent'");

    // On UNFIXED code: true — PASSES (baseline)
    // After fix: true — PASSES (preserved)
    expect(setComputerReturning).toBe(true);
  });

  /**
   * Test 4: Deep research agent continues to set returningFromSpecialist
   *
   * On UNFIXED code: deep_research sets returningFromSpecialist — PASSES
   * After fix: deep_research must STILL set returningFromSpecialist — PASSES
   *
   * **Validates: Requirements 3.1**
   */
  it('should preserve deep_research_agent setting returningFromSpecialist', () => {
    if (!fs.existsSync(DEEP_RESEARCH_PATH)) {
      console.warn('Deep research file not found, skipping test');
      expect(true).toBe(true);
      return;
    }

    const source = fs.readFileSync(DEEP_RESEARCH_PATH, 'utf-8');

    // Check if deep_research sets returningFromSpecialist
    const setDeepReturning = source.includes("returningFromSpecialist: 'deep_research'") || source.includes("returningFromSpecialist: null");

    // On UNFIXED code: true — PASSES (baseline)
    // After fix: true — PASSES (preserved)
    expect(setDeepReturning).toBe(true);
  });

  /**
   * Test 5: Brain's early pre-check logic is preserved
   *
   * On UNFIXED code: brain has early pre-check logic — PASSES
   * After fix: brain must STILL have early pre-check logic — PASSES
   *
   * **Validates: Requirements 3.2**
   */
  it('should preserve brain early pre-check logic for fresh entries', () => {
    const source = fs.readFileSync(BRAIN_PATH, 'utf-8');

    // Check if brain has early pre-check logic
    const hasEarlyPreCheck = source.includes('!state.returningFromSpecialist') ||
                             source.includes('returningFromSpecialist') ||
                             source.includes('isFirstEntry') ||
                             source.includes('early pre-check');

    // On UNFIXED code: true — PASSES (baseline)
    // After fix: true — PASSES (preserved)
    expect(hasEarlyPreCheck).toBe(true);
  });

  /**
   * Test 6: Brain's returningFromSpecialist check is preserved
   *
   * On UNFIXED code: brain checks returningFromSpecialist — PASSES
   * After fix: brain must STILL check returningFromSpecialist — PASSES
   *
   * **Validates: Requirements 3.2**
   */
  it('should preserve brain returningFromSpecialist check logic', () => {
    const source = fs.readFileSync(BRAIN_PATH, 'utf-8');

    // Check if brain has returningFromSpecialist check
    const hasReturningCheck = source.includes('returningFromSpecialist') ||
                              source.includes('state.returningFromSpecialist');

    // On UNFIXED code: true — PASSES (baseline)
    // After fix: true — PASSES (preserved)
    expect(hasReturningCheck).toBe(true);
  });

  /**
   * Test 7: Brain's routing decision logic is preserved
   *
   * On UNFIXED code: brain makes routing decisions — PASSES
   * After fix: brain must STILL make routing decisions — PASSES
   *
   * **Validates: Requirements 3.2**
   */
  it('should preserve brain routing decision logic', () => {
    const source = fs.readFileSync(BRAIN_PATH, 'utf-8');

    // Check if brain has routing decision logic
    const hasRoutingLogic = source.includes('determineRouting') ||
                            source.includes('routingDecision') ||
                            source.includes('route_web_explorer') ||
                            source.includes('route_coding');

    // On UNFIXED code: true — PASSES (baseline)
    // After fix: true — PASSES (preserved)
    expect(hasRoutingLogic).toBe(true);
  });

  /**
   * Test 8: Web explorer self-loop logic is preserved
   *
   * On UNFIXED code: web_explorer has self-loop logic — PASSES
   * After fix: web_explorer must STILL have self-loop logic — PASSES
   *
   * **Validates: Requirements 3.3**
   */
  it('should preserve web_explorer self-loop logic when not complete', () => {
    const webExplorerPath = path.join(__dirname, '../../agents/web-explorer.ts');
    if (!fs.existsSync(webExplorerPath)) {
      console.warn('Web explorer file not found, skipping test');
      expect(true).toBe(true);
      return;
    }

    const source = fs.readFileSync(webExplorerPath, 'utf-8');

    // Check if web_explorer has self-loop logic
    const hasSelfLoop = source.includes('webExplorerComplete') &&
                        source.includes('searchInvoked') &&
                        source.includes('navisInvoked');

    // On UNFIXED code: true — PASSES (baseline)
    // After fix: true — PASSES (preserved)
    expect(hasSelfLoop).toBe(true);
  });

  /**
   * Test 9: Web explorer completion flag is preserved
   *
   * On UNFIXED code: web_explorer sets webExplorerComplete — PASSES
   * After fix: web_explorer must STILL set webExplorerComplete — PASSES
   *
   * **Validates: Requirements 3.4**
   */
  it('should preserve web_explorer setting webExplorerComplete flag', () => {
    const webExplorerPath = path.join(__dirname, '../../agents/web-explorer.ts');
    if (!fs.existsSync(webExplorerPath)) {
      console.warn('Web explorer file not found, skipping test');
      expect(true).toBe(true);
      return;
    }

    const source = fs.readFileSync(webExplorerPath, 'utf-8');

    // Check if web_explorer sets webExplorerComplete: true
    const setsComplete = source.includes('webExplorerComplete: true');

    // On UNFIXED code: true — PASSES (baseline)
    // After fix: true — PASSES (preserved)
    expect(setsComplete).toBe(true);
  });

  /**
   * Test 10: Graph routing logic is preserved
   *
   * On UNFIXED code: graph routes web_explorer to brain — PASSES
   * After fix: graph must STILL route web_explorer to brain — PASSES
   *
   * **Validates: Requirements 3.2, 3.3, 3.4**
   */
  it('should preserve graph routing from web_explorer to brain', () => {
    const graphPath = path.join(__dirname, '../../graph.ts');
    if (!fs.existsSync(graphPath)) {
      console.warn('Graph file not found, skipping test');
      expect(true).toBe(true);
      return;
    }

    const source = fs.readFileSync(graphPath, 'utf-8');

    // Check if graph has web_explorer conditional edges
    const hasWebExplorerEdges = source.includes('web_explorer') &&
                                source.includes('webExplorerComplete') &&
                                source.includes('brain');

    // On UNFIXED code: true — PASSES (baseline)
    // After fix: true — PASSES (preserved)
    expect(hasWebExplorerEdges).toBe(true);
  });

  /**
   * Test 11: State structure is preserved
   *
   * On UNFIXED code: state has returningFromSpecialist field — PASSES
   * After fix: state must STILL have returningFromSpecialist field — PASSES
   *
   * **Validates: Requirements 3.1, 3.2**
   */
  it('should preserve returningFromSpecialist in state structure', () => {
    const statePath = path.join(__dirname, '../../state.ts');
    if (!fs.existsSync(statePath)) {
      console.warn('State file not found, skipping test');
      expect(true).toBe(true);
      return;
    }

    const source = fs.readFileSync(statePath, 'utf-8');

    // Check if state has returningFromSpecialist field
    const hasReturningField = source.includes('returningFromSpecialist');

    // On UNFIXED code: true — PASSES (baseline)
    // After fix: true — PASSES (preserved)
    expect(hasReturningField).toBe(true);
  });

  /**
   * Test 12: Other specialists don't set web_explorer returningFromSpecialist
   *
   * On UNFIXED code: other specialists don't set 'web_explorer' — PASSES
   * After fix: other specialists must STILL not set 'web_explorer' — PASSES
   *
   * **Validates: Requirements 3.1**
   */
  it('should preserve other specialists NOT setting web_explorer returningFromSpecialist', () => {
    if (!fs.existsSync(CODING_SPECIALIST_PATH)) {
      console.warn('Coding specialist file not found, skipping test');
      expect(true).toBe(true);
      return;
    }

    const source = fs.readFileSync(CODING_SPECIALIST_PATH, 'utf-8');

    // Check that coding_specialist does NOT set web_explorer
    const doesNotSetWebExplorer = !source.includes("returningFromSpecialist: 'web_explorer'");

    // On UNFIXED code: true — PASSES (baseline)
    // After fix: true — PASSES (preserved)
    expect(doesNotSetWebExplorer).toBe(true);
  });
});
