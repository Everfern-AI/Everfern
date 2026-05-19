/**
 * Tests for local execution gate functionality
 *
 * Verifies that:
 * - Missing reason is rejected before emitting event
 * - Approval resumes execution
 * - Denial returns correct error output
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the Linux VM executor
vi.mock('../linux-vm-executor', () => ({
  runInLinuxVM: vi.fn()
}));

import { getPiCodingTools, __setPiCodingAgentModule, getLocalExecutionResolvers } from '../pi-tools';
import * as linuxVmExecutor from '../linux-vm-executor';

// Mock executors
const mockBashExecutor = vi.fn();
const mockReadExecutor = vi.fn();
const mockWriteExecutor = vi.fn();
const mockEditExecutor = vi.fn();
const mockFindExecutor = vi.fn();
const mockGrepExecutor = vi.fn();
const mockLsExecutor = vi.fn();

const mockBashToolDefinition = {
  name: 'bash',
  description: 'Execute shell commands',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Command to execute' },
      timeout: { type: 'number', description: 'Timeout in seconds' }
    },
    required: ['command']
  }
};

const mockPiCodingAgentModule = {
  bashToolDefinition: mockBashToolDefinition,
  bashTool: { execute: mockBashExecutor },
  readToolDefinition: {
    name: 'read',
    description: 'Read files',
    parameters: { type: 'object', properties: {} }
  },
  readTool: { execute: mockReadExecutor },
  writeToolDefinition: {
    name: 'write',
    description: 'Write files',
    parameters: { type: 'object', properties: {} }
  },
  writeTool: { execute: mockWriteExecutor },
  editToolDefinition: {
    name: 'edit',
    description: 'Edit files',
    parameters: { type: 'object', properties: {} }
  },
  editTool: { execute: mockEditExecutor },
  findToolDefinition: {
    name: 'find',
    description: 'Find files',
    parameters: { type: 'object', properties: {} }
  },
  findTool: { execute: mockFindExecutor },
  grepToolDefinition: {
    name: 'grep',
    description: 'Search in files',
    parameters: { type: 'object', properties: {} }
  },
  grepTool: { execute: mockGrepExecutor },
  lsToolDefinition: {
    name: 'ls',
    description: 'List files',
    parameters: { type: 'object', properties: {} }
  },
  lsTool: { execute: mockLsExecutor }
};

describe('Local Execution Gate', () => {
  let tools: any[];
  let executePwshTool: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    __setPiCodingAgentModule(mockPiCodingAgentModule);
    tools = await getPiCodingTools();
    executePwshTool = tools.find(tool => tool.name === 'executePwsh');

    // Clear resolvers before each test
    const resolvers = getLocalExecutionResolvers();
    resolvers.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    const resolvers = getLocalExecutionResolvers();
    resolvers.clear();
  });

  describe('Missing Reason Validation', () => {
    it('should reject local execution without reason field before emitting event', async () => {
      const mockEmitEvent = vi.fn();

      const result = await executePwshTool.execute(
        {
          command: 'echo "test"',
          local: true
        },
        undefined,
        mockEmitEvent
      );

      expect(result).toEqual({
        success: false,
        output: 'ERROR: local execution requires a reason field'
      });
      expect(mockEmitEvent).not.toHaveBeenCalled();
    });

    it('should reject local execution with empty reason field before emitting event', async () => {
      const mockEmitEvent = vi.fn();

      const result = await executePwshTool.execute(
        {
          command: 'echo "test"',
          local: true,
          reason: ''
        },
        undefined,
        mockEmitEvent
      );

      expect(result).toEqual({
        success: false,
        output: 'ERROR: local execution requires a reason field'
      });
      expect(mockEmitEvent).not.toHaveBeenCalled();
    });

    it('should not emit event when reason validation fails', async () => {
      const mockEmitEvent = vi.fn();

      await executePwshTool.execute(
        {
          command: 'ls -la',
          local: true
        },
        undefined,
        mockEmitEvent
      );

      expect(mockEmitEvent).not.toHaveBeenCalled();
    });
  });

  describe('Event Emission', () => {
    it('should emit local_execution_request event with correct shape', async () => {
      const mockEmitEvent = vi.fn();
      const mockNativeResult = {
        content: [{ type: 'text', text: 'Local output' }],
        isError: false
      };
      mockBashExecutor.mockResolvedValue(mockNativeResult);

      // Start the execution but don't wait for it yet
      const executionPromise = executePwshTool.execute(
        {
          command: 'ls -la /home',
          local: true,
          reason: 'Need to list local home directory'
        },
        undefined,
        mockEmitEvent
      );

      // Give it a moment to emit the event
      await new Promise(resolve => setTimeout(resolve, 10));

      // Verify the event was emitted with correct shape
      expect(mockEmitEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'local_execution_request',
          requestId: expect.any(String),
          command: 'ls -la /home',
          shellType: 'Bash',
          reason: 'Need to list local home directory',
          conversationId: undefined
        })
      );

      // Now resolve the approval
      const resolvers = getLocalExecutionResolvers();
      const [requestId, resolver] = resolvers.entries().next().value;
      resolver({ approved: true, alwaysAllow: false });

      const result = await executionPromise;
      expect(result).toEqual({
        success: true,
        output: 'Local output'
      });
    });

    it('should emit event with unique requestId for each request', async () => {
      const mockEmitEvent = vi.fn();
      const mockNativeResult = {
        content: [{ type: 'text', text: 'Output' }],
        isError: false
      };
      mockBashExecutor.mockResolvedValue(mockNativeResult);

      // Start first execution
      const exec1 = executePwshTool.execute(
        {
          command: 'cmd1',
          local: true,
          reason: 'Reason 1'
        },
        undefined,
        mockEmitEvent
      );

      await new Promise(resolve => setTimeout(resolve, 10));

      // Get first requestId
      const firstCall = mockEmitEvent.mock.calls[0][0];
      const firstRequestId = firstCall.requestId;

      // Resolve first request
      const resolvers = getLocalExecutionResolvers();
      const resolver1 = resolvers.get(firstRequestId);
      resolver1({ approved: true, alwaysAllow: false });

      await exec1;

      // Clear for second execution
      mockEmitEvent.mockClear();

      // Start second execution
      const exec2 = executePwshTool.execute(
        {
          command: 'cmd2',
          local: true,
          reason: 'Reason 2'
        },
        undefined,
        mockEmitEvent
      );

      await new Promise(resolve => setTimeout(resolve, 10));

      // Get second requestId
      const secondCall = mockEmitEvent.mock.calls[0][0];
      const secondRequestId = secondCall.requestId;

      // Verify requestIds are different
      expect(secondRequestId).not.toBe(firstRequestId);

      // Resolve second request
      const resolver2 = resolvers.get(secondRequestId);
      resolver2({ approved: true, alwaysAllow: false });

      await exec2;
    });
  });

  describe('Approval and Execution', () => {
    it('should resume execution when approval is granted', async () => {
      const mockEmitEvent = vi.fn();
      const mockNativeResult = {
        content: [{ type: 'text', text: 'Command executed successfully' }],
        isError: false
      };
      mockBashExecutor.mockResolvedValue(mockNativeResult);

      const executionPromise = executePwshTool.execute(
        {
          command: 'echo "approved"',
          local: true,
          reason: 'Testing approval flow'
        },
        undefined,
        mockEmitEvent
      );

      await new Promise(resolve => setTimeout(resolve, 10));

      // Get the requestId and resolve with approval
      const resolvers = getLocalExecutionResolvers();
      const [requestId, resolver] = resolvers.entries().next().value;
      resolver({ approved: true, alwaysAllow: false });

      const result = await executionPromise;

      expect(result).toEqual({
        success: true,
        output: 'Command executed successfully'
      });
      expect(mockBashExecutor).toHaveBeenCalled();
    });

    it('should execute native command after approval', async () => {
      const mockEmitEvent = vi.fn();
      const mockNativeResult = {
        content: [{ type: 'text', text: 'Native execution result' }],
        isError: false
      };
      mockBashExecutor.mockResolvedValue(mockNativeResult);

      const executionPromise = executePwshTool.execute(
        {
          command: 'pwd',
          local: true,
          reason: 'Need current working directory'
        },
        undefined,
        mockEmitEvent
      );

      await new Promise(resolve => setTimeout(resolve, 10));

      const resolvers = getLocalExecutionResolvers();
      const [requestId, resolver] = resolvers.entries().next().value;
      resolver({ approved: true, alwaysAllow: false });

      await executionPromise;

      expect(mockBashExecutor).toHaveBeenCalledWith(
        expect.any(String),
        {
          command: 'pwd',
          local: true,
          reason: 'Need current working directory'
        }
      );
    });
  });

  describe('Denial and Error Handling', () => {
    it('should return error when approval is denied', async () => {
      const mockEmitEvent = vi.fn();

      const executionPromise = executePwshTool.execute(
        {
          command: 'rm -rf /',
          local: true,
          reason: 'Dangerous command'
        },
        undefined,
        mockEmitEvent
      );

      await new Promise(resolve => setTimeout(resolve, 10));

      // Get the requestId and resolve with denial
      const resolvers = getLocalExecutionResolvers();
      const [requestId, resolver] = resolvers.entries().next().value;
      resolver({ approved: false, alwaysAllow: false });

      const result = await executionPromise;

      expect(result).toEqual({
        success: false,
        output: 'Local execution denied by user.'
      });
      expect(mockBashExecutor).not.toHaveBeenCalled();
    });

    it('should not execute command when user denies', async () => {
      const mockEmitEvent = vi.fn();

      const executionPromise = executePwshTool.execute(
        {
          command: 'sensitive-command',
          local: true,
          reason: 'User should deny this'
        },
        undefined,
        mockEmitEvent
      );

      await new Promise(resolve => setTimeout(resolve, 10));

      const resolvers = getLocalExecutionResolvers();
      const [requestId, resolver] = resolvers.entries().next().value;
      resolver({ approved: false, alwaysAllow: false });

      await executionPromise;

      expect(mockBashExecutor).not.toHaveBeenCalled();
      expect(linuxVmExecutor.runInLinuxVM).not.toHaveBeenCalled();
    });

    it('should clean up resolver after denial', async () => {
      const mockEmitEvent = vi.fn();

      const executionPromise = executePwshTool.execute(
        {
          command: 'test',
          local: true,
          reason: 'Test cleanup'
        },
        undefined,
        mockEmitEvent
      );

      await new Promise(resolve => setTimeout(resolve, 10));

      const resolvers = getLocalExecutionResolvers();
      const initialSize = resolvers.size;
      expect(initialSize).toBe(1);

      const [requestId, resolver] = resolvers.entries().next().value;
      resolver({ approved: false, alwaysAllow: false });

      await executionPromise;

      // Resolver should be cleaned up
      expect(resolvers.size).toBe(0);
    });

    it('should clean up resolver after approval', async () => {
      const mockEmitEvent = vi.fn();
      const mockNativeResult = {
        content: [{ type: 'text', text: 'Output' }],
        isError: false
      };
      mockBashExecutor.mockResolvedValue(mockNativeResult);

      const executionPromise = executePwshTool.execute(
        {
          command: 'test',
          local: true,
          reason: 'Test cleanup'
        },
        undefined,
        mockEmitEvent
      );

      await new Promise(resolve => setTimeout(resolve, 10));

      const resolvers = getLocalExecutionResolvers();
      const initialSize = resolvers.size;
      expect(initialSize).toBe(1);

      const [requestId, resolver] = resolvers.entries().next().value;
      resolver({ approved: true, alwaysAllow: false });

      await executionPromise;

      // Resolver should be cleaned up
      expect(resolvers.size).toBe(0);
    });
  });

  describe('Error Output Formatting', () => {
    it('should return correct error output when native execution fails after approval', async () => {
      const mockEmitEvent = vi.fn();
      const mockNativeResult = {
        content: [{ type: 'text', text: 'Command not found' }],
        isError: true
      };
      mockBashExecutor.mockResolvedValue(mockNativeResult);

      const executionPromise = executePwshTool.execute(
        {
          command: 'nonexistent-command',
          local: true,
          reason: 'Testing error handling'
        },
        undefined,
        mockEmitEvent
      );

      await new Promise(resolve => setTimeout(resolve, 10));

      const resolvers = getLocalExecutionResolvers();
      const [requestId, resolver] = resolvers.entries().next().value;
      resolver({ approved: true, alwaysAllow: false });

      const result = await executionPromise;

      expect(result).toEqual({
        success: false,
        output: 'Command not found',
        error: 'Command not found'
      });
    });
  });

  describe('Integration with VM Fallback', () => {
    it('should not emit event when local=false (VM execution)', async () => {
      const mockEmitEvent = vi.fn();
      const mockVmResult = {
        stdout: 'VM output',
        stderr: '',
        exitCode: 0
      };
      vi.mocked(linuxVmExecutor.runInLinuxVM).mockResolvedValue(mockVmResult);

      const result = await executePwshTool.execute(
        {
          command: 'echo "test"',
          local: false
        },
        undefined,
        mockEmitEvent
      );

      expect(mockEmitEvent).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: true,
        output: 'VM output'
      });
    });

    it('should not emit event when local is not specified (VM execution)', async () => {
      const mockEmitEvent = vi.fn();
      const mockVmResult = {
        stdout: 'VM output',
        stderr: '',
        exitCode: 0
      };
      vi.mocked(linuxVmExecutor.runInLinuxVM).mockResolvedValue(mockVmResult);

      const result = await executePwshTool.execute(
        {
          command: 'echo "test"'
        },
        undefined,
        mockEmitEvent
      );

      expect(mockEmitEvent).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: true,
        output: 'VM output'
      });
    });
  });

  describe('Multiple Concurrent Requests', () => {
    it('should handle multiple concurrent local execution requests independently', async () => {
      const mockEmitEvent1 = vi.fn();
      const mockEmitEvent2 = vi.fn();
      const mockNativeResult = {
        content: [{ type: 'text', text: 'Output' }],
        isError: false
      };
      mockBashExecutor.mockResolvedValue(mockNativeResult);

      // Start two concurrent executions
      const exec1 = executePwshTool.execute(
        {
          command: 'cmd1',
          local: true,
          reason: 'Reason 1'
        },
        undefined,
        mockEmitEvent1
      );

      const exec2 = executePwshTool.execute(
        {
          command: 'cmd2',
          local: true,
          reason: 'Reason 2'
        },
        undefined,
        mockEmitEvent2
      );

      await new Promise(resolve => setTimeout(resolve, 20));

      // Both should have emitted events
      expect(mockEmitEvent1).toHaveBeenCalled();
      expect(mockEmitEvent2).toHaveBeenCalled();

      // Get both requestIds
      const requestId1 = mockEmitEvent1.mock.calls[0][0].requestId;
      const requestId2 = mockEmitEvent2.mock.calls[0][0].requestId;

      // Resolve them in different order
      const resolvers = getLocalExecutionResolvers();
      const resolver2 = resolvers.get(requestId2);
      resolver2({ approved: true, alwaysAllow: false });

      const resolver1 = resolvers.get(requestId1);
      resolver1({ approved: true, alwaysAllow: false });

      const [result1, result2] = await Promise.all([exec1, exec2]);

      expect(result1).toEqual({ success: true, output: 'Output' });
      expect(result2).toEqual({ success: true, output: 'Output' });
    });
  });
});
