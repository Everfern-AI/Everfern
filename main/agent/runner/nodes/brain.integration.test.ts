/**
 * Integration Test for Brain Checkpoint Integration
 *
 * Tests that the brain node properly creates checkpoints during execution.
 * This verifies that task 7.1 requirements are met.
 *
 * Requirements: 1.1, 1.6, 2.1, 2.5
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createBrainNode } from './brain';
import { AgentRunner } from '../runner';
import { getCheckpointEngine } from '../../persistence/checkpoint-engine';
import type { GraphStateType } from '../state';

// Mock dependencies
vi.mock('../../persistence/checkpoint-engine', () => ({
  getCheckpointEngine: vi.fn(() => ({
    createCheckpoint: vi.fn().mockResolvedValue({
      id: 'test-checkpoint-id',
      taskId: 'test-task',
      stepNumber: 1,
      timestamp: Date.now(),
      stateJson: '{}',
      stateHash: 'hash',
      deltaOnly: false,
      previousCheckpointId: null,
      compressed: false
    })
  }))
}));

vi.mock('../../../lib/prompt-sync', () => ({
  loadPrompt: vi.fn().mockReturnValue('System prompt content')
}));

vi.mock('../services/agent-runtime', () => ({
  runAgentStep: vi.fn().mockResolvedValue({
    messages: [{ role: 'assistant', content: 'Test response' }],
    iterations: 1,
    pendingToolCalls: []
  })
}));

// Create minimal test state
function createTestState(overrides: Partial<GraphStateType> = {}): GraphStateType {
  return {
    messages: [{ role: 'user', content: 'Hello' }],
    currentIntent: 'unknown',
    intentConfidence: 0,
    decomposedTask: null,
    agiHints: '',
    taskPhase: 'brain',
    pendingToolCalls: [],
    toolCallRecords: [],
    toolCallHistory: [],
    userConfirmation: null,
    finalResponse: '',
    pauseGeneration: false,
    iterations: 0,
    activeAgent: 'brain',
    validationResult: null,
    shouldContinueIteration: false,
    completionSignal: null,
    routingDecision: null,
    hitlApprovalResult: null,
    missionId: 'test-mission',
    missionTimeline: null,
    missionSteps: [],
    currentStepId: 'step-1',
    webExplorerComplete: false,
    webExplorerSelfLoopCount: 0,
    navisInvoked: false,
    searchInvoked: false,
    codingComplete: false,
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
    ...overrides,
  } as GraphStateType;
}

// Create mock agent runner
function createMockRunner() {
  return {
    client: {
      chat: vi.fn().mockResolvedValue({
        content: JSON.stringify({
          reason: 'task_complete',
          explanation: 'Test completed'
        })
      })
    },
    telemetry: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    },
    currentAgentSessionKey: null
  } as unknown as AgentRunner;
}

describe('Brain Checkpoint Integration', () => {
  let mockCheckpointEngine: any;
  let mockRunner: AgentRunner;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckpointEngine = (getCheckpointEngine as any)();
    mockRunner = createMockRunner();
  });

  it('creates checkpoint after successful agent step execution (Requirement 2.1)', async () => {
    const state = createTestState();
    const brainNode = createBrainNode(mockRunner);

    await brainNode(state);

    // Verify checkpoint creation was called
    expect(mockCheckpointEngine.createCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.any(Array),
        iterations: expect.any(Number)
      }),
      'test-mission'
    );
  });

  it('logs telemetry on successful checkpoint creation (Requirement 2.5)', async () => {
    const state = createTestState();
    const brainNode = createBrainNode(mockRunner);

    await brainNode(state);

    // Verify telemetry was called for successful checkpoint
    expect(mockRunner.telemetry.info).toHaveBeenCalledWith(
      expect.stringContaining('Checkpoint created')
    );
  });

  it('handles checkpoint failure gracefully without breaking execution (Requirement 2.5)', async () => {
    // Mock checkpoint engine to fail
    mockCheckpointEngine.createCheckpoint.mockRejectedValue(new Error('Database error'));

    const state = createTestState();
    const brainNode = createBrainNode(mockRunner);

    // Should not throw even if checkpoint fails
    const result = await brainNode(state);

    // Verify execution continued despite checkpoint failure
    expect(result).toBeDefined();
    expect(result.messages).toBeDefined();

    // Verify error was logged but execution didn't stop
    expect(mockRunner.telemetry.warn).toHaveBeenCalledWith(
      expect.stringContaining('Unexpected checkpoint error')
    );
  });

  it('creates checkpoint with correct task ID (Requirement 1.1)', async () => {
    const state = createTestState({ missionId: 'my-special-mission' });
    const brainNode = createBrainNode(mockRunner);

    await brainNode(state);

    // Verify task ID matches mission ID
    expect(mockCheckpointEngine.createCheckpoint).toHaveBeenCalledWith(
      expect.any(Object),
      'my-special-mission'
    );
  });

  it('creates checkpoints at multiple execution points', async () => {
    const state = createTestState();
    const brainNode = createBrainNode(mockRunner);

    // Mock agent step to return with pending tools first, then without
    vi.mocked(require('../services/agent-runtime').runAgentStep)
      .mockResolvedValueOnce({
        messages: [{ role: 'assistant', content: 'Using tools...' }],
        iterations: 1,
        pendingToolCalls: [{ name: 'test_tool', args: {} }]
      });

    await brainNode(state);

    // Should create checkpoint for pending tools scenario
    expect(mockCheckpointEngine.createCheckpoint).toHaveBeenCalled();
  });

  it('handles failed checkpoint creation without throwing (Requirement 2.5)', async () => {
    // Mock to return a failed checkpoint instead of throwing
    mockCheckpointEngine.createCheckpoint.mockResolvedValue({
      id: 'failed-123',
      taskId: 'test-task',
      stepNumber: 0,
      timestamp: Date.now(),
      stateJson: '',
      stateHash: '',
      deltaOnly: false,
      previousCheckpointId: null,
      compressed: false,
      failed: true
    });

    const state = createTestState();
    const brainNode = createBrainNode(mockRunner);

    // Should complete successfully even with failed checkpoint
    const result = await brainNode(state);
    expect(result).toBeDefined();

    // Should log the failure
    expect(mockRunner.telemetry.warn).toHaveBeenCalledWith(
      expect.stringContaining('Checkpoint creation failed')
    );
  });
});
