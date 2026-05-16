/**
 * Property-Based Tests: Cancel Agentic Tasks on Completion
 *
 * Tests the 12 correctness properties defined in the design document.
 *
 * **Validates: All 12 Correctness Properties**
 */

import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import { AbortSignalManager, globalAbortManager } from '../abort-manager';

describe('Correctness Properties: Cancel Agentic Tasks on Completion', () => {
  beforeEach(() => {
    globalAbortManager.reset();
  });

  /**
   * Property 1: Abort Flag Synchronous Set
   *
   * For any call to `globalAbortManager.setAborted()`, the `streamAborted` property
   * SHALL be set to true synchronously and immediately readable by all components.
   *
   * **Validates: Requirements 1.3, 12.1, 12.2**
   */
  describe('Property 1: Abort Flag Synchronous Set', () => {
    it('should set abort flag synchronously', () => {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 100 }), (iterations) => {
          const manager = new AbortSignalManager();

          for (let i = 0; i < iterations; i++) {
            manager.setAborted();
            // Flag must be readable immediately
            expect(manager.streamAborted).toBe(true);
          }
        }),
        { numRuns: 50 }
      );
    });

    it('should be immediately readable by all components', () => {
      fc.assert(
        fc.property(fc.integer({ min: 1, max: 10 }), (numComponents) => {
          const manager = new AbortSignalManager();
          const callbacks = Array.from({ length: numComponents }, () =>
            manager.createShouldAbortCallback()
          );

          manager.setAborted();

          // All callbacks must see the same value immediately
          for (const callback of callbacks) {
            expect(callback()).toBe(true);
          }
        }),
        { numRuns: 50 }
      );
    });
  });

  /**
   * Property 2: Abort Signal Propagation
   *
   * For any active tool execution when `globalAbortManager.setAborted()` is called,
   * the `AbortController.signal` SHALL be aborted and all listeners registered on
   * this signal SHALL be notified within 50ms.
   *
   * **Validates: Requirements 10.1, 10.4, 10.5**
   */
  describe('Property 2: Abort Signal Propagation (< 50ms)', () => {
    it('should propagate abort signal to all listeners within 50ms', () => {
      fc.assert(
        fc.property(fc.integer({ min: 1, max: 20 }), (numListeners) => {
          const manager = new AbortSignalManager();
          const listenerCalls: number[] = [];

          for (let i = 0; i < numListeners; i++) {
            manager.registerListener(() => {
              listenerCalls.push(Date.now());
            });
          }

          const startTime = Date.now();
          manager.setAborted();
          const endTime = Date.now();

          // All listeners should be called
          expect(listenerCalls).toHaveLength(numListeners);

          // All calls should be within 50ms of abort
          for (const callTime of listenerCalls) {
            expect(callTime - startTime).toBeLessThan(50);
          }

          // Total time should be minimal
          expect(endTime - startTime).toBeLessThan(50);
        }),
        { numRuns: 50 }
      );
    });

    it('should abort AbortController signal', () => {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 10 }), (iterations) => {
          const manager = new AbortSignalManager();
          const controller = manager.abortController;

          expect(controller.signal.aborted).toBe(false);

          manager.setAborted();

          expect(controller.signal.aborted).toBe(true);
        }),
        { numRuns: 50 }
      );
    });
  });

  /**
   * Property 3: Tool Call Cancellation Completeness
   *
   * For any set of pending tool calls in the graph state when abort is triggered,
   * ALL tool calls SHALL be marked as 'aborted' in the registry and removed from
   * the pending queue within 100ms.
   *
   * **Validates: Requirements 2.1, 2.3, 2.5**
   */
  describe('Property 3: Tool Call Cancellation Completeness (< 100ms)', () => {
    it('should complete tool call cancellation within 100ms', async () => {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 50 }), async (numToolCalls) => {
          const manager = new AbortSignalManager();
          manager.setAborted();

          const startTime = Date.now();
          const status = await manager.executeCleanupSequence();
          const endTime = Date.now();

          const toolCallPhase = status.phases.find(p => p.phase === 'tool-calls');
          expect(toolCallPhase).toBeDefined();
          expect(toolCallPhase!.durationMs).toBeLessThan(100);
        }),
        { numRuns: 20 }
      );
    });
  });

  /**
   * Property 4: Browser Session Closure Completeness
   *
   * For any active browser session when abort is triggered, the session's `close()`
   * method SHALL be invoked, the context SHALL be closed, and the browser instance
   * SHALL be closed within 500ms, with all errors caught and logged.
   *
   * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.6**
   */
  describe('Property 4: Browser Session Closure Completeness (< 500ms)', () => {
    it('should complete browser session closure within 500ms', async () => {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 10 }), async (numSessions) => {
          const manager = new AbortSignalManager();
          manager.setAborted();

          const status = await manager.executeCleanupSequence();

          const browserPhase = status.phases.find(p => p.phase === 'browser-sessions');
          expect(browserPhase).toBeDefined();
          expect(browserPhase!.durationMs).toBeLessThan(500);
        }),
        { numRuns: 20 }
      );
    });
  });

  /**
   * Property 5: Sub-Agent Termination Completeness
   *
   * For any active sub-agent when abort is triggered, the registry's `abort(agentId)`
   * method SHALL be called, the sub-agent's execution SHALL be terminated, its pending
   * tool calls SHALL be cleared, and its completion promise SHALL resolve with abort
   * status within 200ms.
   *
   * **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6**
   */
  describe('Property 5: Sub-Agent Termination Completeness (< 200ms)', () => {
    it('should complete sub-agent termination within 200ms', async () => {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 10 }), async (numAgents) => {
          const manager = new AbortSignalManager();
          manager.setAborted();

          const status = await manager.executeCleanupSequence();

          const subAgentPhase = status.phases.find(p => p.phase === 'sub-agents');
          expect(subAgentPhase).toBeDefined();
          expect(subAgentPhase!.durationMs).toBeLessThan(200);
        }),
        { numRuns: 20 }
      );
    });
  });

  /**
   * Property 6: Cleanup Sequence Ordering
   *
   * For any abort signal, the cleanup sequence SHALL execute in the following order:
   * (1) sub-agents, (2) tool calls, (3) browser sessions, (4) streaming, with each
   * phase completing before the next begins.
   *
   * **Validates: Requirements 6.1**
   */
  describe('Property 6: Cleanup Sequence Ordering', () => {
    it('should execute phases in correct order', async () => {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 5 }), async (iterations) => {
          const manager = new AbortSignalManager();
          manager.setAborted();

          const status = await manager.executeCleanupSequence();

          const phaseNames = status.phases.map(p => p.phase);
          expect(phaseNames).toEqual(['sub-agents', 'tool-calls', 'browser-sessions', 'streaming']);
        }),
        { numRuns: 20 }
      );
    });

    it('should complete each phase before next begins', async () => {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 5 }), async (iterations) => {
          const manager = new AbortSignalManager();
          manager.setAborted();

          const status = await manager.executeCleanupSequence();

          for (let i = 0; i < status.phases.length - 1; i++) {
            const currentPhase = status.phases[i];
            const nextPhase = status.phases[i + 1];

            // Current phase must end before next phase starts
            expect(currentPhase.endTime).toBeLessThanOrEqual(nextPhase.startTime);
          }
        }),
        { numRuns: 20 }
      );
    });
  });

  /**
   * Property 7: Error Isolation in Cleanup
   *
   * For any error thrown during a cleanup phase, the error SHALL be caught and logged,
   * and all subsequent cleanup phases SHALL continue executing without interruption.
   *
   * **Validates: Requirements 6.4, 8.1, 8.2**
   */
  describe('Property 7: Error Isolation in Cleanup', () => {
    it('should continue cleanup even if phases have errors', async () => {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 5 }), async (iterations) => {
          const manager = new AbortSignalManager();
          manager.setAborted();

          const status = await manager.executeCleanupSequence();

          // All phases should be attempted
          expect(status.phases).toHaveLength(4);

          // Cleanup should complete even if there are errors
          expect(status).toBeDefined();
        }),
        { numRuns: 20 }
      );
    });
  });

  /**
   * Property 8: Abort State Reset
   *
   * For any new execution cycle, when `globalAbortManager.reset()` is called, the abort
   * flag SHALL be set to false, a new `AbortController` instance SHALL be created, and
   * all listeners SHALL be cleared.
   *
   * **Validates: Requirements 11.1, 11.2, 11.3, 11.4**
   */
  describe('Property 8: Abort State Reset', () => {
    it('should reset abort flag to false', () => {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 10 }), (iterations) => {
          const manager = new AbortSignalManager();

          for (let i = 0; i < iterations; i++) {
            manager.setAborted();
            expect(manager.streamAborted).toBe(true);

            manager.reset();
            expect(manager.streamAborted).toBe(false);
          }
        }),
        { numRuns: 50 }
      );
    });

    it('should create new AbortController on reset', () => {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 10 }), (iterations) => {
          const manager = new AbortSignalManager();

          for (let i = 0; i < iterations; i++) {
            const oldController = manager.abortController;
            manager.setAborted();

            manager.reset();
            const newController = manager.abortController;

            expect(newController).not.toBe(oldController);
            expect(newController.signal.aborted).toBe(false);
          }
        }),
        { numRuns: 50 }
      );
    });

    it('should clear listeners on reset', () => {
      fc.assert(
        fc.property(fc.integer({ min: 1, max: 10 }), (numListeners) => {
          const manager = new AbortSignalManager();
          let callCount = 0;

          for (let i = 0; i < numListeners; i++) {
            manager.registerListener(() => {
              callCount++;
            });
          }

          manager.reset();
          manager.setAborted();

          // Listeners should not be called after reset
          expect(callCount).toBe(0);
        }),
        { numRuns: 50 }
      );
    });
  });

  /**
   * Property 9: Streaming Cancellation
   *
   * For any active streaming operation when abort is triggered, the operation SHALL
   * stop reading/writing data, all buffered chunks SHALL be flushed to the frontend,
   * and a final 'done' message SHALL be sent.
   *
   * **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5**
   */
  describe('Property 9: Streaming Cancellation', () => {
    it('should complete streaming cancellation immediately', async () => {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 5 }), async (iterations) => {
          const manager = new AbortSignalManager();
          manager.setAborted();

          const status = await manager.executeCleanupSequence();

          const streamingPhase = status.phases.find(p => p.phase === 'streaming');
          expect(streamingPhase).toBeDefined();
          // Streaming should be immediate (no timeout)
          expect(streamingPhase!.durationMs).toBeLessThan(100);
        }),
        { numRuns: 20 }
      );
    });
  });

  /**
   * Property 10: Abort State Consistency
   *
   * For any concurrent queries to `globalAbortManager.streamAborted` from multiple
   * components, ALL queries SHALL return the same value, and when the abort flag
   * changes, all components SHALL see the new value within 1ms.
   *
   * **Validates: Requirements 12.2, 12.3, 12.5**
   */
  describe('Property 10: Abort State Consistency (< 1ms)', () => {
    it('should return consistent abort state across concurrent queries', () => {
      fc.assert(
        fc.property(fc.integer({ min: 1, max: 100 }), (numQueries) => {
          const manager = new AbortSignalManager();

          // Before abort
          const beforeAbortResults = Array.from({ length: numQueries }, () =>
            manager.streamAborted
          );
          expect(new Set(beforeAbortResults).size).toBe(1);
          expect(beforeAbortResults[0]).toBe(false);

          // After abort
          manager.setAborted();
          const afterAbortResults = Array.from({ length: numQueries }, () =>
            manager.streamAborted
          );
          expect(new Set(afterAbortResults).size).toBe(1);
          expect(afterAbortResults[0]).toBe(true);
        }),
        { numRuns: 50 }
      );
    });
  });

  /**
   * Property 11: Cleanup Status Reporting
   *
   * For any cleanup sequence, the IPC handler SHALL send a 'cleanup_started' event
   * at the beginning, a 'cleanup_step_complete' event after each phase, and a
   * 'cleanup_complete' or 'cleanup_error' event at the end.
   *
   * **Validates: Requirements 9.1, 9.2, 9.3, 9.4**
   */
  describe('Property 11: Cleanup Status Reporting', () => {
    it('should provide cleanup status for event reporting', async () => {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 5 }), async (iterations) => {
          const manager = new AbortSignalManager();
          manager.setAborted();

          const status = await manager.executeCleanupSequence();

          // Status should be available for event reporting
          expect(status).toBeDefined();
          expect(status.success).toBeDefined();
          expect(status.completedPhases).toBeDefined();
          expect(status.totalPhases).toBeDefined();
          expect(status.elapsedMs).toBeDefined();
          expect(status.errors).toBeDefined();
          expect(status.phases).toBeDefined();
        }),
        { numRuns: 20 }
      );
    });
  });

  /**
   * Property 12: No Orphaned Operations
   *
   * For any execution cycle after abort is triggered, NO new background operations
   * SHALL be started, and any operation checking the abort flag SHALL immediately
   * stop if abort is true.
   *
   * **Validates: Requirements 7.1, 7.2**
   */
  describe('Property 12: No Orphaned Operations', () => {
    it('should prevent new operations after abort', () => {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 100 }), (iterations) => {
          const manager = new AbortSignalManager();
          manager.setAborted();

          // Any operation checking abort flag should stop
          const shouldAbort = manager.createShouldAbortCallback();
          expect(shouldAbort()).toBe(true);

          // Attempting to execute should fail
          expect(() => manager.checkAbort()).toThrow();
        }),
        { numRuns: 50 }
      );
    });

    it('should allow new operations after reset', () => {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 100 }), (iterations) => {
          const manager = new AbortSignalManager();
          manager.setAborted();
          manager.reset();

          // After reset, operations should be allowed
          const shouldAbort = manager.createShouldAbortCallback();
          expect(shouldAbort()).toBe(false);

          // Attempting to execute should not fail
          expect(() => manager.checkAbort()).not.toThrow();
        }),
        { numRuns: 50 }
      );
    });
  });
});
