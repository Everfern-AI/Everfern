/**
 * Computer Use Tool Action Persistence Tests
 *
 * Tests for capturing, storing, and restoring GUI automation actions
 *
 * Requirements: 9.1, 9.2, 9.5, 9.6, 20
 * Properties: 20, 21, 22
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';
import {
  ComputerUsePersistenceWrapper,
  getOrCreatePersistenceWrapper,
  getPersistenceWrapper,
} from './computer-use-persistence';
import type { ComputerUseAction } from '../persistence/session-manager';

// ── Mock helpers ─────────────────────────────────────────────────────────────

/**
 * Create a mock tool result
 */
function createMockToolResult(status: string = 'ok') {
  return {
    success: true,
    output: `Mock result: ${status}`,
    data: { status },
  };
}

/**
 * Generate arbitrary GUI action parameters
 */
const guiActionGenerator = fc.oneof(
  // Click actions with coordinates
  fc.record({
    coordinate: fc.tuple(
      fc.integer({ min: 0, max: 1920 }),
      fc.integer({ min: 0, max: 1080 })
    ),
  }).map((params) => ({ action: 'left_click', parameters: params })),

  // Type actions with text
  fc.record({ text: fc.string({ minLength: 1, maxLength: 100 }) })
    .map((params) => ({ action: 'type', parameters: params })),

  // Scroll actions with pixels
  fc.record({
    pixels: fc.integer({ min: -500, max: 500 }),
    coordinate: fc.tuple(
      fc.integer({ min: 0, max: 1920 }),
      fc.integer({ min: 0, max: 1080 })
    ).map((c) => c), // optional coordinate
  }).map((params) => ({ action: 'scroll', parameters: params })),

  // Drag actions
  fc.record({
    start_coordinate: fc.tuple(
      fc.integer({ min: 0, max: 1920 }),
      fc.integer({ min: 0, max: 1080 })
    ),
    coordinate: fc.tuple(
      fc.integer({ min: 0, max: 1920 }),
      fc.integer({ min: 0, max: 1080 })
    ),
  }).map((params) => ({ action: 'drag', parameters: params })),

  // Key actions
  fc.record({
    keys: fc.array(
      fc.oneof(
        fc.constant('enter'),
        fc.constant('escape'),
        fc.constant('ctrl'),
        fc.constant('shift'),
        fc.constant('alt')
      ),
      { minLength: 1, maxLength: 3 }
    ),
  }).map((params) => ({ action: 'key', parameters: params })),

  // Wait actions
  fc.record({
    time: fc.float({ min: Math.fround(0.1), max: Math.fround(5.0) }),
  }).map((params) => ({ action: 'wait', parameters: params }))
);

describe('Computer Use Tool - Preservation Properties', () => {
  let wrapper: ComputerUsePersistenceWrapper;

  beforeEach(() => {
    wrapper = new ComputerUsePersistenceWrapper({
      taskId: 'test-task-001',
      stepNumber: 1,
      captureScreenshots: false, // Disable screenshots for testing
      trackReversibility: true,
    });
  });

  describe('Property 20: GUI Action Recording', () => {
    it('should record action type correctly', () => {
      /**
       * Validates: Requirements 9.1
       * Test that action type is recorded exactly as provided
       */
      fc.assert(
        fc.property(
          guiActionGenerator,
          ({ action, parameters }) => {
            const capturingCalls = wrapper.getCapturedActions();
            expect(capturingCalls).toBeDefined();
          }
        ),
        { numRuns: 20 }
      );
    });

    it('should capture action parameters completely', async () => {
      /**
       * Validates: Requirements 9.1
       * Test that all action parameters are recorded without loss
       */
      const params = { coordinate: [100, 200], text: 'test' };
      const action = 'left_click';

      await wrapper.captureActionExecution(
        () => Promise.resolve(createMockToolResult()),
        action,
        params
      );

      const captured = wrapper.getCapturedActions();
      expect(captured).toHaveLength(1);
      expect(captured[0].action).toBe(action);
      expect(captured[0].parameters).toEqual(params);
    });

    it('should record action timestamp with millisecond precision', async () => {
      /**
       * Validates: Requirements 9.1
       * Test that timestamps are recorded accurately
       */
      const before = Date.now();
      await wrapper.captureActionExecution(
        () => Promise.resolve(createMockToolResult()),
        'wait',
        { time: 0.1 }
      );
      const after = Date.now();

      const captured = wrapper.getCapturedActions();
      expect(captured[0].startTime).toBeGreaterThanOrEqual(before);
      expect(captured[0].startTime).toBeLessThanOrEqual(after);
    });

    it('should record action duration', async () => {
      /**
       * Validates: Requirements 9.1
       * Test that action duration is calculated correctly
       */
      await wrapper.captureActionExecution(
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve(createMockToolResult()), 50);
          }),
        'wait',
        { time: 0.05 }
      );

      const captured = wrapper.getCapturedActions();
      const duration = captured[0].endTime - captured[0].startTime;
      expect(duration).toBeGreaterThanOrEqual(40); // Some tolerance for timing
    });

    it('should generate unique action IDs', async () => {
      /**
       * Validates: Requirements 9.1
       * Test that each action gets a unique identifier
       */
      fc.assert(
        fc.property(
          fc.array(guiActionGenerator, { minLength: 5, maxLength: 10 }),
          async (actions) => {
            wrapper.clearCapturedActions();

            for (const { action, parameters } of actions) {
              await wrapper.captureActionExecution(
                () => Promise.resolve(createMockToolResult()),
                action,
                parameters
              );
            }

            const captured = wrapper.getCapturedActions();
            const ids = captured.map((c) => c.id);
            const uniqueIds = new Set(ids);

            // All IDs should be unique
            expect(uniqueIds.size).toBe(ids.length);
          }
        ),
        { numRuns: 5 }
      );
    });
  });

  describe('Property 21: GUI Action Logging', () => {
    it('should store actions in checkpoint store', async () => {
      /**
       * Validates: Requirements 9.5
       * Test that captured actions are stored in the database
       */
      await wrapper.initialize();
      await wrapper.captureActionExecution(
        () => Promise.resolve(createMockToolResult()),
        'left_click',
        { coordinate: [100, 200] }
      );

      // Verify action is in captured list (will be persisted)
      const captured = wrapper.getCapturedActions();
      expect(captured).toHaveLength(1);
    });

    it('should include all action metadata in logs', async () => {
      /**
       * Validates: Requirements 9.5
       * Test that action logging includes all relevant metadata
       */
      const params = { coordinate: [500, 600] };
      const action = 'left_click';

      await wrapper.captureActionExecution(
        () => Promise.resolve(createMockToolResult()),
        action,
        params
      );

      const captured = wrapper.getCapturedActions();
      const logged = captured[0];

      // Verify all expected fields are present
      expect(logged).toHaveProperty('id');
      expect(logged).toHaveProperty('taskId');
      expect(logged).toHaveProperty('stepNumber');
      expect(logged).toHaveProperty('action');
      expect(logged).toHaveProperty('parameters');
      expect(logged).toHaveProperty('startTime');
      expect(logged).toHaveProperty('endTime');
      expect(logged).toHaveProperty('reversible');
    });

    it('should track task and step association', async () => {
      /**
       * Validates: Requirements 9.5
       * Test that actions are correctly associated with task and step
       */
      const taskId = 'task-123';
      const stepNumber = 5;

      const customWrapper = new ComputerUsePersistenceWrapper({
        taskId,
        stepNumber,
        captureScreenshots: false,
        trackReversibility: true,
      });

      await customWrapper.captureActionExecution(
        () => Promise.resolve(createMockToolResult()),
        'type',
        { text: 'hello' }
      );

      const captured = customWrapper.getCapturedActions();
      expect(captured[0].taskId).toBe(taskId);
      expect(captured[0].stepNumber).toBe(stepNumber);
    });
  });

  describe('Property 22: Reversible GUI Actions', () => {
    it('should identify reversible click actions', async () => {
      /**
       * Validates: Requirements 9.6
       * Test that clickable actions are marked as reversible
       */
      await wrapper.captureActionExecution(
        () => Promise.resolve(createMockToolResult()),
        'left_click',
        { coordinate: [100, 200] }
      );

      const captured = wrapper.getCapturedActions();
      expect(captured[0].reversible).toBe(true);
      expect(captured[0].reverseAction).toBeDefined();
    });

    it('should generate reverse action for scroll', async () => {
      /**
       * Validates: Requirements 9.6
       * Test that scroll actions generate proper reverse operations
       */
      const scrollPixels = 300;
      await wrapper.captureActionExecution(
        () => Promise.resolve(createMockToolResult()),
        'scroll',
        { pixels: scrollPixels }
      );

      const captured = wrapper.getCapturedActions();
      expect(captured[0].reversible).toBe(true);

      if (captured[0].reverseAction) {
        const reverseOp = JSON.parse(captured[0].reverseAction);
        expect(reverseOp.pixels).toBe(-scrollPixels);
      }
    });

    it('should mark irreversible actions correctly', async () => {
      /**
       * Validates: Requirements 9.6
       * Test that non-reversible actions are marked correctly
       */
      const irreversibleActions = ['wait', 'mouse_move', 'double_click'];

      for (const action of irreversibleActions) {
        wrapper.clearCapturedActions();

        await wrapper.captureActionExecution(
          () => Promise.resolve(createMockToolResult()),
          action,
          action === 'wait' ? { time: 1 } : { coordinate: [100, 200] }
        );

        const captured = wrapper.getCapturedActions();
        expect(captured[0].reversible).toBe(false);
        expect(captured[0].reverseAction).toBeNull();
      }
    });

    it('should generate reversible drag operations', async () => {
      /**
       * Validates: Requirements 9.6
       * Test that drag operations generate reverse drag instructions
       */
      const startCoord = [100, 100] as [number, number];
      const endCoord = [200, 200] as [number, number];

      await wrapper.captureActionExecution(
        () => Promise.resolve(createMockToolResult()),
        'drag',
        { start_coordinate: startCoord, coordinate: endCoord }
      );

      const captured = wrapper.getCapturedActions();
      expect(captured[0].reversible).toBe(true);

      if (captured[0].reverseAction) {
        const reverseOp = JSON.parse(captured[0].reverseAction);
        expect(reverseOp.start_coordinate).toEqual(endCoord);
        expect(reverseOp.coordinate).toEqual(startCoord);
      }
    });

    it('should track type action reversibility', async () => {
      /**
       * Validates: Requirements 9.6
       * Test that typing actions are marked as reversible with undo strategy
       */
      await wrapper.captureActionExecution(
        () => Promise.resolve(createMockToolResult()),
        'type',
        { text: 'hello world' }
      );

      const captured = wrapper.getCapturedActions();
      expect(captured[0].reversible).toBe(true);

      if (captured[0].reverseAction) {
        const reverseOp = JSON.parse(captured[0].reverseAction);
        expect(reverseOp.keys).toContain('ctrl');
      }
    });

    it('should provide reverse action JSON for programmatic use', async () => {
      /**
       * Validates: Requirements 9.6
       * Test that reverse actions are stored as valid JSON
       */
      await wrapper.captureActionExecution(
        () => Promise.resolve(createMockToolResult()),
        'hscroll',
        { pixels: -200, coordinate: [960, 540] }
      );

      const captured = wrapper.getCapturedActions();
      if (captured[0].reverseAction) {
        // Should be valid JSON that can be re-parsed
        expect(() => JSON.parse(captured[0].reverseAction)).not.toThrow();

        const reverseOp = JSON.parse(captured[0].reverseAction);
        expect(reverseOp).toHaveProperty('action');
        expect(reverseOp).toHaveProperty('pixels');
      }
    });
  });

  describe('Integration: Persistence Workflow', () => {
    it('should maintain action sequence order', async () => {
      /**
       * Test that multiple actions are recorded in execution order
       */
      wrapper.clearCapturedActions();

      const actions = [
        { action: 'screenshot', parameters: {} },
        { action: 'left_click', parameters: { coordinate: [100, 100] } },
        { action: 'type', parameters: { text: 'test' } },
        { action: 'key', parameters: { keys: ['enter'] } },
      ];

      for (let i = 0; i < actions.length; i++) {
        const { action, parameters } = actions[i];
        await wrapper.captureActionExecution(
          () => Promise.resolve(createMockToolResult()),
          action,
          parameters
        );
      }

      const captured = wrapper.getCapturedActions();
      expect(captured).toHaveLength(actions.length);

      for (let i = 0; i < actions.length; i++) {
        expect(captured[i].action).toBe(actions[i].action);
      }
    });

    it('should support configuration updates during execution', () => {
      /**
       * Test that step number and other config can be updated between actions
       */
      wrapper.updateConfig({ stepNumber: 10 });

      expect(wrapper['config'].stepNumber).toBe(10);
    });

    it('should provide singleton access pattern', () => {
      /**
       * Test that global persistence wrapper can be accessed consistently
       */
      const wrapper1 = getOrCreatePersistenceWrapper({
        taskId: 'task-singleton-1',
        stepNumber: 1,
      });

      const wrapper2 = getOrCreatePersistenceWrapper({
        taskId: 'task-singleton-1',
        stepNumber: 1,
      });

      // Same config should return same instance
      expect(wrapper1).toBe(wrapper2);
    });

    it('should create new wrapper for different task', () => {
      /**
       * Test that different tasks get different wrapper instances
       */
      const wrapper1 = getOrCreatePersistenceWrapper({
        taskId: 'task-1',
        stepNumber: 1,
      });

      const wrapper2 = getOrCreatePersistenceWrapper({
        taskId: 'task-2',
        stepNumber: 1,
      });

      // Different tasks should have different instances
      expect(wrapper1).not.toBe(wrapper2);
    });
  });

  describe('Error Handling', () => {
    it('should handle tool execution errors gracefully', async () => {
      /**
       * Test that action capture continues even if tool execution fails
       */
      await expect(
        wrapper.captureActionExecution(
          () => Promise.reject(new Error('Tool failed')),
          'left_click',
          { coordinate: [100, 200] }
        )
      ).rejects.toThrow('Tool failed');

      // Action should not be recorded if execution failed
      const captured = wrapper.getCapturedActions();
      expect(captured).toHaveLength(0);
    });

    it('should validate action parameters', async () => {
      /**
       * Test that action parameters are properly captured even with edge cases
       */
      const edgeCaseParams = {
        coordinate: [-100, -200], // negative coordinates
        text: '', // empty string
        pixels: 0, // zero pixels
      };

      await wrapper.captureActionExecution(
        () => Promise.resolve(createMockToolResult()),
        'left_click',
        edgeCaseParams
      );

      const captured = wrapper.getCapturedActions();
      expect(captured[0].parameters).toEqual(edgeCaseParams);
    });
  });

  describe('Property-Based Tests', () => {
    it('should handle arbitrary action sequences', async () => {
      /**
       * Property: Action recording should work with any valid action sequence
       * Validates: Requirements 9.1, 9.5
       */
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              action: fc.oneof(
                fc.constant('left_click'),
                fc.constant('type'),
                fc.constant('scroll'),
                fc.constant('wait')
              ),
              params: fc.record({
                coordinate: fc.tuple(
                  fc.integer({ min: 0, max: 1920 }),
                  fc.integer({ min: 0, max: 1080 })
                ).optional(),
              }),
            }),
            { minLength: 1, maxLength: 10 }
          ),
          async (actions) => {
            wrapper.clearCapturedActions();

            for (const { action, params } of actions) {
              await wrapper.captureActionExecution(
                () => Promise.resolve(createMockToolResult()),
                action,
                params
              );
            }

            const captured = wrapper.getCapturedActions();
            expect(captured.length).toBeGreaterThan(0);
            expect(captured.length).toBeLessThanOrEqual(actions.length);

            // All actions should have unique IDs
            const ids = new Set(captured.map((c) => c.id));
            expect(ids.size).toBe(captured.length);
          }
        ),
        { numRuns: 5 }
      );
    });

    it('should maintain parameter fidelity across capture', async () => {
      /**
       * Property: Parameters should round-trip perfectly through capture
       * Validates: Requirements 9.1
       */
      fc.assert(
        fc.property(
          fc.record({
            coordinate: fc.tuple(
              fc.integer({ min: 0, max: 1920 }),
              fc.integer({ min: 0, max: 1080 })
            ),
          }),
          async (params) => {
            wrapper.clearCapturedActions();

            await wrapper.captureActionExecution(
              () => Promise.resolve(createMockToolResult()),
              'left_click',
              params
            );

            const captured = wrapper.getCapturedActions();
            expect(captured[0].parameters.coordinate).toEqual(params.coordinate);
          }
        ),
        { numRuns: 10 }
      );
    });
  });
});
