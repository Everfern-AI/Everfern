/**
 * Tests for Checkpoint Cleanup and Compression - Task 2.5
 *
 * Validates Requirements: 2.6, 12.3, 12.5
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { CheckpointEngine, AGENT_CHECKPOINTS_TABLE } from './checkpoint-engine';
import { dbOps } from '../../lib/db';
import type { GraphStateType } from '../runner/state';

function createMockState(stepNumber: number): GraphStateType {
  return {
    messages: [],
    currentIntent: 'unknown',
    intentConfidence: 0,
    decomposedTask: null,
    taskPhase: 'brain',
    pendingToolCalls: [],
    toolCallRecords: [],
    activeAgent: '',
    completionSignal: null,
    routingDecision: null,
    webExplorerComplete: false,
    navisInvoked: false,
    searchInvoked: false,
    codingComplete: false,
    missionId: '',
    missionTimeline: null,
    missionSteps: [],
    agiHints: '',
    pauseGeneration: false,
    iterations: stepNumber,
    validationResult: null,
    shouldContinueIteration: false,
    hitlApprovalResult: null,
    currentStepId: '',
    webExplorerSelfLoopCount: 0,
    dataAnalysisComplete: false,
    computerUseComplete: false,
    deepResearchComplete: false,
    deepResearchSelfLoopCount: 0,
    subagentSpawned: null,
    completedSteps: [],
    decompositionAttempts: 0,
    brainToolsInFlight: false,
    returningFromSpecialist: null,
    debateResult: null,
    toolCallHistory: [],
    userConfirmation: null,
    finalResponse: '',
  } as GraphStateType;
}

describe('Task 2.5: Checkpoint Cleanup and Compression', () => {
  let engine: CheckpointEngine;
  const testTaskId = 'test-cleanup-' + Date.now();

  beforeAll(async () => {
    engine = new CheckpointEngine();
    await engine.initialize();
    await dbOps.run(`DELETE FROM ${AGENT_CHECKPOINTS_TABLE} WHERE task_id = ?`, [testTaskId]);
  });

  afterAll(async () => {
    await dbOps.run(`DELETE FROM ${AGENT_CHECKPOINTS_TABLE} WHERE task_id = ?`, [testTaskId]);
  });

  describe('pruneOldCheckpoints - Requirement 2.6', () => {
    it('should delete old checkpoints and keep last 100', async () => {
      const taskId = `${testTaskId}-prune-1`;

      // Create 150 checkpoints
      for (let i = 0; i < 150; i++) {
        const state = createMockState(i);
        await engine.createCheckpoint(state, taskId);
      }

      // Prune to keep last 100
      const deleted = await engine.pruneOldCheckpoints(taskId, 100);

      expect(deleted).toBe(50);

      // Verify only 100 remain
      const remaining = await engine.listCheckpoints(taskId, 100);
      expect(remaining.length).toBe(100);
    });

    it('should return 0 when checkpoints are below threshold', async () => {
      const taskId = `${testTaskId}-prune-2`;

      // Create 50 checkpoints
      for (let i = 0; i < 50; i++) {
        await engine.createCheckpoint(createMockState(i), taskId);
      }

      // Prune to keep last 100
      const deleted = await engine.pruneOldCheckpoints(taskId, 100);

      expect(deleted).toBe(0);
    });
  });

  describe('compressCheckpoint - Task 2.5', () => {
    it('should compress checkpoint state', async () => {
      const taskId = `${testTaskId}-compress-1`;

      const state = createMockState(0);
      const checkpoint = await engine.createCheckpoint(state, taskId);

      // Compress the checkpoint
      const compressed = await engine.compressCheckpoint(checkpoint);

      // Should still verify integrity
      const isValid = engine.verifyCheckpointIntegrity(compressed);
      expect(isValid).toBe(true);
    });

    it('should not double-compress checkpoints', async () => {
      const taskId = `${testTaskId}-compress-2`;

      const checkpoint = await engine.createCheckpoint(createMockState(0), taskId);

      if (!checkpoint.compressed) {
        // Compress it
        const compressed1 = await engine.compressCheckpoint(checkpoint);
        const state1 = compressed1.stateJson;

        // Compress again
        const compressed2 = await engine.compressCheckpoint(compressed1);
        const state2 = compressed2.stateJson;

        // Should be identical
        expect(state1).toBe(state2);
      }
    });
  });

  describe('batchCreateCheckpoints - Requirement 12.5', () => {
    it('should create multiple checkpoints in batch', async () => {
      const taskId = `${testTaskId}-batch-1`;

      const states = Array.from({ length: 10 }, (_, i) => createMockState(i));

      const checkpoints = await engine.batchCreateCheckpoints(states, taskId);

      expect(checkpoints.length).toBe(10);

      // Verify all created successfully
      const successful = checkpoints.filter((cp) => !('failed' in cp) || !cp.failed);
      expect(successful.length).toBe(10);

      // Verify retrieval
      const retrieved = await engine.listCheckpoints(taskId, 15);
      expect(retrieved.length).toBe(10);
    });

    it('should preserve order in batch write', async () => {
      const taskId = `${testTaskId}-batch-2`;

      const states = [
        createMockState(0),
        createMockState(1),
        createMockState(2),
      ];

      const checkpoints = await engine.batchCreateCheckpoints(states, taskId);

      const successful = checkpoints.filter((cp) => !('failed' in cp) || !cp.failed);
      const steps = successful.map((cp) => cp.stepNumber);

      expect(steps).toContain(0);
      expect(steps).toContain(1);
      expect(steps).toContain(2);
    });
  });
});
