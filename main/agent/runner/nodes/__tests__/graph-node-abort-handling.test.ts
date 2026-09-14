import { describe, expect, it, beforeEach, vi } from 'vitest';
import { globalAbortManager } from '../../abort-manager';
import { createTriageNode } from '../triage';
import { createBrainNode } from '../brain';
import { createValidationNode } from '../validation';
import { createJudgeNode } from '../judge';
import { createExecuteToolsNode } from '../execute_tools';

// Mock dependencies
vi.mock('../../triage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../triage')>();
  return {
    ...actual,
    classifyIntent: vi.fn().mockResolvedValue({
      intent: 'coding',
      confidence: 0.9,
      reasoning: 'test classification'
    }),
  };
});

vi.mock('../../task-decomposer', () => ({
  decomposeTask: vi.fn(() => ({
    id: 'test-task',
    title: 'Test Task',
    steps: [],
    totalSteps: 1,
    canParallelize: false,
    executionMode: 'sequential',
  })),
  getAGIHints: vi.fn(() => 'test hints'),
}));

vi.mock('../../services/agent-runtime', () => ({
  runAgentStep: vi.fn().mockResolvedValue({
    messages: [{ role: 'assistant', content: 'Test response' }],
    pendingToolCalls: [],
    iterations: 1,
  }),
}));

describe('Graph Node Abort Handling', () => {
  let mockRunner: any;
  let mockEventQueue: any[];
  let mockMissionTracker: any;
  let mockState: any;

  beforeEach(() => {
    globalAbortManager.reset();

    mockEventQueue = [];
    mockMissionTracker = {
      startStep: vi.fn(),
      completeStep: vi.fn(),
      setPhase: vi.fn(),
      getTimeline: vi.fn(() => ({ isComplete: false })),
    };

    mockRunner = {
      config: { maxIterations: 10 },
      telemetry: {
        warn: vi.fn(),
        info: vi.fn(),
        transition: vi.fn(),
      },
      _buildToolDefinitions: vi.fn(() => []),
      client: {
        model: 'test-model',
        chat: vi.fn().mockResolvedValue({
          content: JSON.stringify({ reason: 'task_complete', explanation: 'Test' })
        }),
      },
    };

    mockState = {
      messages: [],
      currentIntent: 'coding',
      iterations: 0,
      pendingToolCalls: [],
    };
  });

  describe('Triage Node Abort Handling', () => {
    it('should abort when shouldAbort returns true', async () => {
      const shouldAbort = vi.fn().mockReturnValue(true);
      const triageNode = createTriageNode(mockRunner, mockEventQueue, mockMissionTracker, shouldAbort);

      await expect(triageNode(mockState)).rejects.toThrow('Execution aborted by user (stop button clicked)');
      expect(shouldAbort).toHaveBeenCalled();
    });

    it('should execute normally when shouldAbort returns false', async () => {
      const shouldAbort = vi.fn().mockReturnValue(false);
      const triageNode = createTriageNode(mockRunner, mockEventQueue, mockMissionTracker, shouldAbort);

      const result = await triageNode(mockState);
      expect(result).toBeDefined();
      expect(shouldAbort).toHaveBeenCalled();
    });
  });

  describe('Brain Node Abort Handling', () => {
    it('should abort when shouldAbort returns true', async () => {
      const shouldAbort = vi.fn().mockReturnValue(true);
      const brainNode = createBrainNode(mockRunner, mockEventQueue, mockMissionTracker, [], shouldAbort);

      await expect(brainNode(mockState)).rejects.toThrow('Execution aborted by user (stop button clicked)');
      expect(shouldAbort).toHaveBeenCalled();
    });

    it('should execute normally when shouldAbort returns false', async () => {
      const shouldAbort = vi.fn().mockReturnValue(false);
      const brainNode = createBrainNode(mockRunner, mockEventQueue, mockMissionTracker, [], shouldAbort);

      const result = await brainNode(mockState);
      expect(result).toBeDefined();
      expect(shouldAbort).toHaveBeenCalled();
    });
  });

  describe('Validation Node Abort Handling', () => {
    it('should abort when shouldAbort returns true', async () => {
      const shouldAbort = vi.fn().mockReturnValue(true);
      const validationNode = createValidationNode(mockRunner, mockMissionTracker, shouldAbort);

      await expect(validationNode(mockState)).rejects.toThrow('Execution aborted by user (stop button clicked)');
      expect(shouldAbort).toHaveBeenCalled();
    });

    it('should execute normally when shouldAbort returns false', async () => {
      const shouldAbort = vi.fn().mockReturnValue(false);
      const validationNode = createValidationNode(mockRunner, mockMissionTracker, shouldAbort);

      const result = await validationNode(mockState);
      expect(result).toBeDefined();
      expect(shouldAbort).toHaveBeenCalled();
    });
  });

  describe('Judge Node Abort Handling', () => {
    it('should abort when shouldAbort returns true', async () => {
      const shouldAbort = vi.fn().mockReturnValue(true);
      const judgeNode = createJudgeNode(mockRunner, mockEventQueue, mockMissionTracker, shouldAbort);

      await expect(judgeNode(mockState)).rejects.toThrow('Execution aborted by user (stop button clicked)');
      expect(shouldAbort).toHaveBeenCalled();
    });

    it('should execute normally when shouldAbort returns false', async () => {
      const shouldAbort = vi.fn().mockReturnValue(false);
      const judgeNode = createJudgeNode(mockRunner, mockEventQueue, mockMissionTracker, shouldAbort);

      const result = await judgeNode(mockState);
      expect(result).toBeDefined();
      expect(shouldAbort).toHaveBeenCalled();
    });
  });

  describe('Execute Tools Node Abort Handling', () => {
    it('should abort when shouldAbort returns true', async () => {
      const shouldAbort = vi.fn().mockReturnValue(true);
      const executeToolsNode = createExecuteToolsNode(
        mockRunner,
        [],
        mockRunner.config,
        mockEventQueue,
        'test-conversation',
        mockMissionTracker,
        shouldAbort,
        mockRunner.client
      );

      await expect(executeToolsNode(mockState)).rejects.toThrow('Execution aborted by user (stop button clicked)');
      expect(shouldAbort).toHaveBeenCalled();
    });

    it('should execute normally when shouldAbort returns false', async () => {
      const shouldAbort = vi.fn().mockReturnValue(false);
      const executeToolsNode = createExecuteToolsNode(
        mockRunner,
        [],
        mockRunner.config,
        mockEventQueue,
        'test-conversation',
        mockMissionTracker,
        shouldAbort,
        mockRunner.client
      );

      const result = await executeToolsNode(mockState);
      expect(result).toBeDefined();
      expect(shouldAbort).toHaveBeenCalled();
    });
  });

  describe('Abort Timing Requirements', () => {
    it('should abort within 100ms timing requirement', async () => {
      const shouldAbort = vi.fn().mockReturnValue(true);
      const triageNode = createTriageNode(mockRunner, mockEventQueue, mockMissionTracker, shouldAbort);

      const startTime = Date.now();

      try {
        await triageNode(mockState);
        expect.fail('Should have thrown an error');
      } catch (error) {
        const elapsedTime = Date.now() - startTime;
        expect(elapsedTime).toBeLessThan(100);
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('Execution aborted by user');
      }
    });
  });

  describe('Cross-Node Consistency', () => {
    it('should propagate abort signal consistently across all nodes', async () => {
      const shouldAbort = globalAbortManager.createShouldAbortCallback();

      const triageNode = createTriageNode(mockRunner, mockEventQueue, mockMissionTracker, shouldAbort);
      const brainNode = createBrainNode(mockRunner, mockEventQueue, mockMissionTracker, [], shouldAbort);
      const validationNode = createValidationNode(mockRunner, mockMissionTracker, shouldAbort);
      const judgeNode = createJudgeNode(mockRunner, mockEventQueue, mockMissionTracker, shouldAbort);
      const executeToolsNode = createExecuteToolsNode(
        mockRunner,
        [],
        mockRunner.config,
        mockEventQueue,
        'test-conversation',
        mockMissionTracker,
        shouldAbort,
        mockRunner.client
      );

      globalAbortManager.setAborted();

      const expectedError = 'Execution aborted by user (stop button clicked)';

      await expect(triageNode(mockState)).rejects.toThrow(expectedError);
      await expect(brainNode(mockState)).rejects.toThrow(expectedError);
      await expect(validationNode(mockState)).rejects.toThrow(expectedError);
      await expect(judgeNode(mockState)).rejects.toThrow(expectedError);
      await expect(executeToolsNode(mockState)).rejects.toThrow(expectedError);
    });

    it('should reset abort state properly for new execution', async () => {
      const shouldAbort = globalAbortManager.createShouldAbortCallback();
      const triageNode = createTriageNode(mockRunner, mockEventQueue, mockMissionTracker, shouldAbort);

      globalAbortManager.setAborted();
      await expect(triageNode(mockState)).rejects.toThrow('Execution aborted by user');

      globalAbortManager.reset();
      const newShouldAbort = globalAbortManager.createShouldAbortCallback();
      const newTriageNode = createTriageNode(mockRunner, mockEventQueue, mockMissionTracker, newShouldAbort);

      const result = await newTriageNode(mockState);
      expect(result).toBeDefined();
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
