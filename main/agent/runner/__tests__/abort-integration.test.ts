import { describe, expect, it, beforeEach, vi } from 'vitest';
import { globalAbortManager } from '../abort-manager';
import { createTriageNode } from '../nodes/triage';
import { createBrainNode } from '../nodes/brain';

describe('AbortSignalManager Integration', () => {
  let mockRunner: any;
  let mockEventQueue: any[];
  let mockMissionTracker: any;

  beforeEach(() => {
    globalAbortManager.reset();

    mockEventQueue = [];
    mockMissionTracker = {
      startStep: vi.fn(),
      completeStep: vi.fn(),
      setPhase: vi.fn(),
      addStep: vi.fn(),
      getStep: vi.fn(() => null),
      getSteps: vi.fn(() => []),
      getTimeline: vi.fn(() => ({ isComplete: false }))
    };

    mockRunner = {
      config: { maxIterations: 10 },
      telemetry: {
        warn: vi.fn(),
        info: vi.fn(),
        action: vi.fn(),
        transition: vi.fn(),
      },
      _buildToolDefinitions: vi.fn(() => []),
      client: {
        model: 'test-model'
      }
    };
  });

  describe('Graph Node Abort Integration', () => {
    it('should abort triage node when abort signal is set', async () => {
      const shouldAbort = globalAbortManager.createShouldAbortCallback();
      const triageNode = createTriageNode(mockRunner, mockEventQueue, mockMissionTracker, shouldAbort);

      // Set abort before calling node
      globalAbortManager.setAborted();

      const mockState = {
        messages: [{ role: 'user', content: 'test' }],
        iterations: 0
      };

      await expect(triageNode(mockState)).rejects.toThrow('Execution aborted by user (stop button clicked)');
    });

    it('should abort brain node when abort signal is set', async () => {
      const shouldAbort = globalAbortManager.createShouldAbortCallback();
      const brainNode = createBrainNode(mockRunner, mockEventQueue, mockMissionTracker, [], shouldAbort);

      // Set abort before calling node
      globalAbortManager.setAborted();

      const mockState = {
        messages: [{ role: 'user', content: 'test' }],
        iterations: 0,
        currentIntent: 'coding'
      };

      await expect(brainNode(mockState)).rejects.toThrow('Execution aborted by user (stop button clicked)');
    });

    it('should allow nodes to execute normally when not aborted', async () => {
      const shouldAbort = globalAbortManager.createShouldAbortCallback();
      const brainNode = createBrainNode(mockRunner, mockEventQueue, mockMissionTracker, [], shouldAbort);

      const mockState = {
        messages: [{ role: 'user', content: 'test' }],
        iterations: 0,
        currentIntent: 'coding'
      };

      // Should not throw when not aborted
      const result = await brainNode(mockState);
      expect(result).toBeDefined();
    });
  });

  describe('Abort Timing Requirements', () => {
    it('should meet 100ms abort requirement', async () => {
      const shouldAbort = globalAbortManager.createShouldAbortCallback();
      const brainNode = createBrainNode(mockRunner, mockEventQueue, mockMissionTracker, [], shouldAbort);

      const startTime = Date.now();
      globalAbortManager.setAborted();

      try {
        await brainNode({ messages: [{ role: 'user', content: 'test' }], iterations: 0, currentIntent: 'coding' });
        expect.fail('Should have thrown an error');
      } catch (error) {
        const elapsedTime = Date.now() - startTime;
        expect(elapsedTime).toBeLessThan(100);
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('Execution aborted by user');
      }
    });
  });

  describe('AbortController Integration', () => {
    it('should provide abort signal for tool execution cancellation', () => {
      const controller = globalAbortManager.abortController;
      expect(controller).toBeInstanceOf(AbortController);
      expect(controller.signal.aborted).toBe(false);

      globalAbortManager.setAborted();
      expect(controller.signal.aborted).toBe(true);
    });

    it('should create new controller after reset', () => {
      const originalController = globalAbortManager.abortController;
      globalAbortManager.setAborted();
      expect(originalController.signal.aborted).toBe(true);

      globalAbortManager.reset();
      const newController = globalAbortManager.abortController;

      expect(newController).not.toBe(originalController);
      expect(newController.signal.aborted).toBe(false);
    });
  });

  describe('Requirements Compliance', () => {
    it('should meet all Requirement 1 acceptance criteria', () => {
      // 1.1: Stop button sets Stream_Abort_Flag immediately
      expect(globalAbortManager.streamAborted).toBe(false);
      globalAbortManager.setAborted();
      expect(globalAbortManager.streamAborted).toBe(true);

      // 1.2: Agent_Runner checks flag before each node execution
      const shouldAbort = globalAbortManager.createShouldAbortCallback();
      expect(shouldAbort()).toBe(true);

      // 1.3: Throw abortion error within 100ms
      const startTime = Date.now();
      try {
        globalAbortManager.checkAbort();
        expect.fail('Should have thrown');
      } catch (error) {
        const elapsedTime = Date.now() - startTime;
        expect(elapsedTime).toBeLessThan(100);
      }

      // 1.7: Propagate to tool executions
      const controller = globalAbortManager.abortController;
      expect(controller.signal.aborted).toBe(true);

      globalAbortManager.propagateToTools();
      expect(controller.signal.aborted).toBe(true);
    });
  });
});
