// AG-SAF-05: production arming of the rollback allowlist
import { describe, it, expect, vi, beforeAll } from 'vitest';
import * as os from 'os';
import * as path from 'path';

const setAllowedRootsMock = vi.fn();

vi.mock('../../../persistence/rollback-manager', () => ({
  getRollbackManager: vi.fn(() => ({ setAllowedRoots: setAllowedRootsMock })),
}));

vi.mock('../../parallel-executor', () => ({
  analyzeToolDependencies: vi.fn(() => ({})),
  groupParallelTools: vi.fn(() => []),
  executeSynchronizedParallelGroup: vi.fn(async () => ({ results: [] })),
}));

vi.mock('../../harness', () => ({
  createHarnessConfig: vi.fn(() => ({})),
  preExecutionCheck: vi.fn(() => ({ shouldProceed: true })),
  postExecutionCheck: vi.fn(() => ({ valid: true, validationErrors: [] })),
  recordExecution: vi.fn(),
  getPhasePrompt: vi.fn(() => null),
  workflowEngine: { getContext: vi.fn(() => ({ currentPhase: null })) },
  handleFailedStep: vi.fn(async () => null),
  rollbackOrchestrator: {
    rollbackToPhase: vi.fn(async () => null),
    planRollback: vi.fn(async () => null),
    executeRollback: vi.fn(async () => null),
    clearHistory: vi.fn(),
  },
}));

vi.mock('../../../tools/pi-tools', () => ({
  runWithAgentContext: vi.fn(async (_id: string, _name: string, fn: () => any) => fn()),
}));

vi.mock('../../tool-routing', () => ({
  redirectComputerUseCallsToNavis: vi.fn((calls: any[]) => ({ calls, redirected: 0 })),
}));

vi.mock('../../utils', () => ({
  validateAndCorrectToolArgs: vi.fn((_n: string, args: any) => args),
}));

vi.mock('../../../tools/computer-use', () => ({
  captureScreen: vi.fn(),
}));

vi.mock('../../loop-detection', () => ({
  detectToolCallLoop: vi.fn(() => null),
  recordToolCall: vi.fn(),
  recordToolOutcome: vi.fn(),
}));

vi.mock('../../tool-policy', () => ({
  getDefaultToolPolicyPipeline: vi.fn(() => null),
}));

vi.mock('../../task-plan-helper', () => ({
  syncTaskPlan: vi.fn(async () => {}),
}));

vi.mock('../../mission-integrator', () => ({
  createMissionIntegrator: vi.fn(() => ({
    startNode: vi.fn(),
    completeNode: vi.fn(),
    failNode: vi.fn(),
  })),
}));

import { createExecuteToolsNode } from '../execute_tools';

const makeRunner = (workspaceDir?: string) => ({
  telemetry: { transition: vi.fn(), info: vi.fn(), warn: vi.fn() },
  workspaceDir,
});

const makeState = () => ({
  pendingToolCalls: [{ name: 'nonexistent_tool_xyz', arguments: {}, id: 't1' }],
  iterations: 0,
});

describe('AG-SAF-05: execute_tools arms rollback allowed roots', () => {
  beforeAll(() => {
    vi.clearAllMocks();
  });

  it('sets allowed roots to runner.workspaceDir when defined', async () => {
    const node = createExecuteToolsNode(makeRunner('/tmp/saf05-root'), [] as any, {} as any);
    await node(makeState() as any).catch(() => {});
    expect(setAllowedRootsMock).toHaveBeenCalledWith(['/tmp/saf05-root']);
  });

  it('falls back to ~/.everfern when workspaceDir is undefined', async () => {
    setAllowedRootsMock.mockClear();
    const node = createExecuteToolsNode(makeRunner(undefined), [] as any, {} as any);
    await node(makeState() as any).catch(() => {});
    expect(setAllowedRootsMock).toHaveBeenCalledWith([path.join(os.homedir(), '.everfern')]);
  });
});
