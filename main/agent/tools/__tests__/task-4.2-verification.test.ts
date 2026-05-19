/**
 * Task 4.2 Verification Test
 *
 * Verifies that when args.local === true and reason is present,
 * the pi-tools integration emits a local_execution_request stream event
 * with the correct shape.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getPiCodingTools, __setPiCodingAgentModule, resetPiCodingToolsCache, getLocalExecutionResolvers } from '../pi-tools';
import * as linuxVmExecutor from '../linux-vm-executor';

// Mock the Linux VM executor
vi.mock('../linux-vm-executor', () => ({
  runInLinuxVM: vi.fn()
}));

describe('Task 4.2: Emit local_execution_request event', () => {
  let mockBashExecutor: any;
  let executePwshTool: any;

  beforeEach(async () => {
    // Reset the cache
    resetPiCodingToolsCache();

    // Create mock bash executor
    mockBashExecutor = vi.fn();

    // Mock the pi-coding-agent module
    const mockModule = {
      readToolDefinition: { name: 'read', description: 'Read file', parameters: { type: 'object', properties: {}, required: [] } },
      readTool: { execute: vi.fn() },
      writeToolDefinition: { name: 'write', description: 'Write file', parameters: { type: 'object', properties: {}, required: [] } },
      writeTool: { execute: vi.fn() },
      editToolDefinition: { name: 'edit', description: 'Edit file', parameters: { type: 'object', properties: {}, required: [] } },
      editTool: { execute: vi.fn() },
      findToolDefinition: { name: 'find', description: 'Find files', parameters: { type: 'object', properties: {}, required: [] } },
      findTool: { execute: vi.fn() },
      grepToolDefinition: { name: 'grep', description: 'Search content', parameters: { type: 'object', properties: {}, required: [] } },
      grepTool: { execute: vi.fn() },
      lsToolDefinition: { name: 'ls', description: 'List directory', parameters: { type: 'object', properties: {}, required: [] } },
      lsTool: { execute: vi.fn() },
      bashToolDefinition: { name: 'bash', description: 'Execute bash', parameters: { type: 'object', properties: {}, required: [] } },
      bashTool: { execute: mockBashExecutor }
    };

    __setPiCodingAgentModule(mockModule);

    // Load tools
    const tools = await getPiCodingTools();
    executePwshTool = tools.find(t => t.name === 'executePwsh');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('Task 4.2: Should emit local_execution_request event with correct shape when local=true and reason is present', async () => {
    // Arrange
    const mockEmitEvent = vi.fn();
    const mockNativeResult = {
      content: [{ type: 'text', text: 'Command output' }],
      isError: false
    };
    mockBashExecutor.mockResolvedValue(mockNativeResult);

    const testCommand = 'echo "test"';
    const testReason = 'Need to test local execution';

    // Act - Start execution (don't await yet)
    const executionPromise = executePwshTool.execute(
      {
        command: testCommand,
        local: true,
        reason: testReason
      },
      undefined,
      mockEmitEvent
    );

    // Wait for event emission
    await new Promise(resolve => setTimeout(resolve, 10));

    // Assert - Verify event was emitted with correct shape
    expect(mockEmitEvent).toHaveBeenCalledTimes(1);
    expect(mockEmitEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'local_execution_request',
        requestId: expect.stringMatching(/^local-exec-\d+-[a-z0-9]+$/),
        command: testCommand,
        shellType: 'Bash',
        reason: testReason,
        conversationId: undefined
      })
    );

    // Verify the event shape has all required fields
    const emittedEvent = mockEmitEvent.mock.calls[0][0];
    expect(emittedEvent).toHaveProperty('type', 'local_execution_request');
    expect(emittedEvent).toHaveProperty('requestId');
    expect(emittedEvent).toHaveProperty('command', testCommand);
    expect(emittedEvent).toHaveProperty('shellType', 'Bash');
    expect(emittedEvent).toHaveProperty('reason', testReason);
    expect(emittedEvent).toHaveProperty('conversationId');

    // Verify requestId is unique and properly formatted
    expect(emittedEvent.requestId).toMatch(/^local-exec-\d+-[a-z0-9]+$/);

    // Clean up - approve the request to complete execution
    const resolvers = getLocalExecutionResolvers();
    const [requestId, resolver] = resolvers.entries().next().value;
    resolver({ approved: true, alwaysAllow: false });

    await executionPromise;
  });

  it('Task 4.2: Should generate unique requestId for each request', async () => {
    // Arrange
    const mockEmitEvent = vi.fn();
    const mockNativeResult = {
      content: [{ type: 'text', text: 'Output' }],
      isError: false
    };
    mockBashExecutor.mockResolvedValue(mockNativeResult);

    // Act - Start two executions
    const exec1 = executePwshTool.execute(
      { command: 'cmd1', local: true, reason: 'Reason 1' },
      undefined,
      mockEmitEvent
    );

    await new Promise(resolve => setTimeout(resolve, 10));

    const exec2 = executePwshTool.execute(
      { command: 'cmd2', local: true, reason: 'Reason 2' },
      undefined,
      mockEmitEvent
    );

    await new Promise(resolve => setTimeout(resolve, 10));

    // Assert - Verify both events were emitted with different requestIds
    expect(mockEmitEvent).toHaveBeenCalledTimes(2);

    const event1 = mockEmitEvent.mock.calls[0][0];
    const event2 = mockEmitEvent.mock.calls[1][0];

    expect(event1.requestId).not.toBe(event2.requestId);
    expect(event1.requestId).toMatch(/^local-exec-\d+-[a-z0-9]+$/);
    expect(event2.requestId).toMatch(/^local-exec-\d+-[a-z0-9]+$/);

    // Clean up
    const resolvers = getLocalExecutionResolvers();
    for (const [requestId, resolver] of resolvers.entries()) {
      resolver({ approved: true, alwaysAllow: false });
    }

    await Promise.all([exec1, exec2]);
  });

  it('Task 4.2: Should not emit event when local=false (VM execution)', async () => {
    // Arrange
    const mockEmitEvent = vi.fn();
    vi.mocked(linuxVmExecutor.runInLinuxVM).mockResolvedValue({
      stdout: 'VM output',
      stderr: '',
      exitCode: 0
    });

    // Act
    await executePwshTool.execute(
      {
        command: 'echo "test"',
        local: false,
        reason: 'This should not trigger event'
      },
      undefined,
      mockEmitEvent
    );

    // Assert - Event should NOT be emitted for VM execution
    expect(mockEmitEvent).not.toHaveBeenCalled();
  });

  it('Task 4.2: Should not emit event when reason is missing', async () => {
    // Arrange
    const mockEmitEvent = vi.fn();

    // Act
    const result = await executePwshTool.execute(
      {
        command: 'echo "test"',
        local: true
        // reason is missing
      },
      undefined,
      mockEmitEvent
    );

    // Assert - Event should NOT be emitted when reason is missing
    expect(mockEmitEvent).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.output).toContain('ERROR: local execution requires a reason field');
  });

  it('Task 4.2: Should include conversationId field in event (even if undefined)', async () => {
    // Arrange
    const mockEmitEvent = vi.fn();
    const mockNativeResult = {
      content: [{ type: 'text', text: 'Output' }],
      isError: false
    };
    mockBashExecutor.mockResolvedValue(mockNativeResult);

    // Act
    const executionPromise = executePwshTool.execute(
      {
        command: 'test',
        local: true,
        reason: 'Testing conversationId field'
      },
      undefined,
      mockEmitEvent
    );

    await new Promise(resolve => setTimeout(resolve, 10));

    // Assert - Verify conversationId field exists in the event
    const emittedEvent = mockEmitEvent.mock.calls[0][0];
    expect(emittedEvent).toHaveProperty('conversationId');

    // Note: conversationId is undefined at this level and will be set by the runner
    expect(emittedEvent.conversationId).toBeUndefined();

    // Clean up
    const resolvers = getLocalExecutionResolvers();
    const [requestId, resolver] = resolvers.entries().next().value;
    resolver({ approved: true, alwaysAllow: false });

    await executionPromise;
  });
});
