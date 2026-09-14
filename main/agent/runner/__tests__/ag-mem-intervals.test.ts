/**
 * AG-MEM-12 tests: module-level cleanup intervals
 *
 * Verifies:
 * - stopStateCleanup / stopAnalysisSessionCleanup / stopPromptCacheCleanup exist
 *   and are safe to call (idempotent, no throw)
 * - clearAllAgentEvents (AG-MEM-07) exists and safely clears all sessions
 */

import { stateManager, stopStateCleanup } from '../state-manager';
import { getAnalysisSessionManager, stopAnalysisSessionCleanup } from '../../sessions/analysis-session';
import { stopPromptCacheCleanup } from '../system-prompt';
import { getAgentEvents, removeAgentEvents, clearAllAgentEvents } from '../../infra/agent-events';

describe('AG-MEM-12: module interval teardown hooks', () => {
  it('exports stopStateCleanup and calling it is safe (repeat calls too)', () => {
    expect(typeof stopStateCleanup).toBe('function');
    expect(() => stopStateCleanup()).not.toThrow();
    expect(() => stopStateCleanup()).not.toThrow();
  });

  it('exports stopAnalysisSessionCleanup and calling it is safe (repeat calls too)', () => {
    expect(typeof stopAnalysisSessionCleanup).toBe('function');
    // Instantiate the singleton so the interval actually exists before stopping.
    const mgr = getAnalysisSessionManager();
    expect(mgr).toBeDefined();
    expect(() => stopAnalysisSessionCleanup()).not.toThrow();
    expect(() => stopAnalysisSessionCleanup()).not.toThrow();
  });

  it('exports stopPromptCacheCleanup and calling it is safe (repeat calls too)', () => {
    expect(typeof stopPromptCacheCleanup).not.toBe('undefined');
    expect(typeof stopPromptCacheCleanup).toBe('function');
    expect(() => stopPromptCacheCleanup()).not.toThrow();
    expect(() => stopPromptCacheCleanup()).not.toThrow();
  });

  it('modules still function after their cleanup intervals are stopped', async () => {
    // stateManager sanity: cleanup() is invocable directly
    expect(typeof stateManager.cleanup).toBe('function');
    expect(() => stateManager.cleanup()).not.toThrow();

    // analysis session manager still hands out the singleton
    expect(getAnalysisSessionManager()).toBe(getAnalysisSessionManager());

    // system-prompt module still exports its synchronous resolver
    const mod = await import('../system-prompt');
    expect(typeof mod.resolvePromptPlaceholdersSync).toBe('function');
    expect(() => mod.resolvePromptPlaceholdersSync('test', 'win32', 'conv-1')).not.toThrow();
  });
});

describe('AG-MEM-07: clearAllAgentEvents', () => {
  it('exists and removes all registered event sessions', () => {
    expect(typeof clearAllAgentEvents).toBe('function');

    const a = getAgentEvents('ag-mem-test-a');
    const b = getAgentEvents('ag-mem-test-b');
    expect(a).toBeDefined();
    expect(b).toBeDefined();

    // Sessions are gone after clearAll
    clearAllAgentEvents();

    // A fresh emitter is created for the same key (old one was removed)
    const a2 = getAgentEvents('ag-mem-test-a');
    expect(a2).not.toBe(a);

    removeAgentEvents('ag-mem-test-a');
    removeAgentEvents('ag-mem-test-b');
  });

  it('is safe to call with zero sessions', () => {
    expect(() => clearAllAgentEvents()).not.toThrow();
    expect(() => clearAllAgentEvents()).not.toThrow();
  });
});
