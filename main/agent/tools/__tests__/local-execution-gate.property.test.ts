/**
 * Property-Based Test: Local Execution Gate - No Silent Execution
 *
 * **Validates: Requirements P-2.A (No Silent Execution)**
 *
 * Property 2.A: No Silent Execution
 *
 * For any `local: true` tool call, the gate must always emit a request event
 * before executing — verified by checking that the mock `emitEvent` is called
 * before the mock native executor.
 *
 * This ensures that users are always presented with a permission prompt
 * before any local command executes, preventing silent execution of
 * potentially dangerous commands.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';

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

const mockPiCodingAgentModule = {
  bashToolDefinition: {
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
  },
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

describe('Local Execution Gate - Property-Based Tests (P-2.A)', () => {
  let tools: any[];
  let executePwshTool: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    __setPiCodingAgentModule(mockPiCodingAgentModule);
    tools = await getPiCodingTools();
    executePwshTool = tools.find(tool => tool.name === 'executePwsh');

    const resolvers = getLocalExecutionResolvers();
    resolvers.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    const resolvers = getLocalExecutionResolvers();
    resolvers.clear();
  });

  describe('P-2.A (No Silent Execution): Event emission before execution', () => {
    it('should always emit event before executing for any local: true command', async () => {
      // Generate arbitrary command strings
      const commandArbitrary = fc.string({
        minLength: 1,
        maxLength: 50
      });

      // Generate arbitrary reason strings
      const reasonArbitrary = fc.string({
        minLength: 1,
        maxLength: 50
      });

      await fc.assert(
        fc.asyncProperty(commandArbitrary, reasonArbitrary, async (command, reason) => {
          const mockEmitEvent = vi.fn();
          const mockNativeResult = {
            content: [{ type: 'text', text: 'Output' }],
            isError: false
          };
          mockBashExecutor.mockResolvedValue(mockNativeResult);

          // Track call order
          const callOrder: string[] = [];
          mockEmitEvent.mockImplementation(() => {
            callOrder.push('emitEvent');
          });
          mockBashExecutor.mockImplementation(() => {
            callOrder.push('bashExecutor');
            return Promise.resolve(mockNativeResult);
          });

          const executionPromise = executePwshTool.execute(
            {
              command,
              local: true,
              reason
            },
            undefined,
            mockEmitEvent
          );

          // Give it a moment to emit the event
          await new Promise(resolve => setTimeout(resolve, 10));

          // Verify emitEvent was called
          expect(mockEmitEvent).toHaveBeenCalled();

          // Get the requestId and resolve
          const resolvers = getLocalExecutionResolvers();
          const [requestId, resolver] = resolvers.entries().next().value;
          resolver({ approved: true, alwaysAllow: false });

          await executionPromise;

          // Verify emitEvent was called before bashExecutor
          const emitEventIndex = callOrder.indexOf('emitEvent');
          const bashExecutorIndex = callOrder.indexOf('bashExecutor');

          expect(emitEventIndex).toBeLessThan(bashExecutorIndex);
          expect(emitEventIndex).toBeGreaterThanOrEqual(0);
        }),
        { numRuns: 50 }
      );
    });

    it('should emit event with valid requestId for any local: true command', async () => {
      const commandArbitrary = fc.string({ minLength: 1, maxLength: 30 });
      const reasonArbitrary = fc.string({ minLength: 1, maxLength: 30 });

      await fc.assert(
        fc.asyncProperty(commandArbitrary, reasonArbitrary, async (command, reason) => {
          const mockEmitEvent = vi.fn();
          const mockNativeResult = {
            content: [{ type: 'text', text: 'Output' }],
            isError: false
          };
          mockBashExecutor.mockResolvedValue(mockNativeResult);

          const executionPromise = executePwshTool.execute(
            {
              command,
              local: true,
              reason
            },
            undefined,
            mockEmitEvent
          );

          await new Promise(resolve => setTimeout(resolve, 10));

          // Verify event was emitted with requestId
          expect(mockEmitEvent).toHaveBeenCalled();
          const emittedEvent = mockEmitEvent.mock.calls[0][0];

          expect(emittedEvent.requestId).toBeDefined();
          expect(typeof emittedEvent.requestId).toBe('string');
          expect(emittedEvent.requestId.length).toBeGreaterThan(0);

          // Resolve and clean up
          const resolvers = getLocalExecutionResolvers();
          const resolver = resolvers.get(emittedEvent.requestId);
          resolver({ approved: true, alwaysAllow: false });

          await executionPromise;
        }),
        { numRuns: 50 }
      );
    });

    it('should emit event with correct command for any local: true call', async () => {
      const commandArbitrary = fc.string({
        minLength: 1,
        maxLength: 40
      });
      const reasonArbitrary = fc.string({ minLength: 1, maxLength: 30 });

      await fc.assert(
        fc.asyncProperty(commandArbitrary, reasonArbitrary, async (command, reason) => {
          const mockEmitEvent = vi.fn();
          const mockNativeResult = {
            content: [{ type: 'text', text: 'Output' }],
            isError: false
          };
          mockBashExecutor.mockResolvedValue(mockNativeResult);

          const executionPromise = executePwshTool.execute(
            {
              command,
              local: true,
              reason
            },
            undefined,
            mockEmitEvent
          );

          await new Promise(resolve => setTimeout(resolve, 10));

          // Verify event contains the correct command
          expect(mockEmitEvent).toHaveBeenCalled();
          const emittedEvent = mockEmitEvent.mock.calls[0][0];

          expect(emittedEvent.command).toBe(command);

          // Resolve and clean up
          const resolvers = getLocalExecutionResolvers();
          const resolver = resolvers.get(emittedEvent.requestId);
          resolver({ approved: true, alwaysAllow: false });

          await executionPromise;
        }),
        { numRuns: 50 }
      );
    });

    it('should emit event with correct reason for any local: true call', async () => {
      const commandArbitrary = fc.string({ minLength: 1, maxLength: 30 });
      const reasonArbitrary = fc.string({
        minLength: 1,
        maxLength: 50
      });

      await fc.assert(
        fc.asyncProperty(commandArbitrary, reasonArbitrary, async (command, reason) => {
          const mockEmitEvent = vi.fn();
          const mockNativeResult = {
            content: [{ type: 'text', text: 'Output' }],
            isError: false
          };
          mockBashExecutor.mockResolvedValue(mockNativeResult);

          const executionPromise = executePwshTool.execute(
            {
              command,
              local: true,
              reason
            },
            undefined,
            mockEmitEvent
          );

          await new Promise(resolve => setTimeout(resolve, 10));

          // Verify event contains the correct reason
          expect(mockEmitEvent).toHaveBeenCalled();
          const emittedEvent = mockEmitEvent.mock.calls[0][0];

          expect(emittedEvent.reason).toBe(reason);

          // Resolve and clean up
          const resolvers = getLocalExecutionResolvers();
          const resolver = resolvers.get(emittedEvent.requestId);
          resolver({ approved: true, alwaysAllow: false });

          await executionPromise;
        }),
        { numRuns: 50 }
      );
    });

    it('should never execute native command before emitting event', async () => {
      const commandArbitrary = fc.string({ minLength: 1, maxLength: 30 });
      const reasonArbitrary = fc.string({ minLength: 1, maxLength: 30 });

      await fc.assert(
        fc.asyncProperty(commandArbitrary, reasonArbitrary, async (command, reason) => {
          const mockEmitEvent = vi.fn();
          const mockNativeResult = {
            content: [{ type: 'text', text: 'Output' }],
            isError: false
          };

          let emitEventCalled = false;
          let bashExecutorCalled = false;

          mockEmitEvent.mockImplementation(() => {
            emitEventCalled = true;
            // At this point, bashExecutor should NOT have been called yet
            expect(bashExecutorCalled).toBe(false);
          });

          mockBashExecutor.mockImplementation(() => {
            bashExecutorCalled = true;
            // At this point, emitEvent should have been called
            expect(emitEventCalled).toBe(true);
            return Promise.resolve(mockNativeResult);
          });

          const executionPromise = executePwshTool.execute(
            {
              command,
              local: true,
              reason
            },
            undefined,
            mockEmitEvent
          );

          await new Promise(resolve => setTimeout(resolve, 10));

          // Resolve and clean up
          const resolvers = getLocalExecutionResolvers();
          const [requestId, resolver] = resolvers.entries().next().value;
          resolver({ approved: true, alwaysAllow: false });

          await executionPromise;

          // Verify both were called in correct order
          expect(emitEventCalled).toBe(true);
          expect(bashExecutorCalled).toBe(true);
        }),
        { numRuns: 50 }
      );
    });

    it('should emit event even for edge case commands', () => {
      const edgeCaseCommands = [
        '',
        ' ',
        'a',
        'rm -rf /',
        'echo "test"',
        'cat /etc/passwd',
        'sudo reboot',
        '$(malicious)',
        '`dangerous`',
        'a'.repeat(100)
      ];

      edgeCaseCommands.forEach(command => {
        const mockEmitEvent = vi.fn();
        const mockNativeResult = {
          content: [{ type: 'text', text: 'Output' }],
          isError: false
        };
        mockBashExecutor.mockResolvedValue(mockNativeResult);

        const executionPromise = executePwshTool.execute(
          {
            command,
            local: true,
            reason: 'Test reason'
          },
          undefined,
          mockEmitEvent
        );

        // For empty command, emitEvent should still be called
        // (the gate validates reason, not command content)
        expect(mockEmitEvent).toHaveBeenCalled();

        // Clean up
        const resolvers = getLocalExecutionResolvers();
        if (resolvers.size > 0) {
          const [requestId, resolver] = resolvers.entries().next().value;
          resolver({ approved: true, alwaysAllow: false });
        }
      });
    });

    it('should emit event with type: local_execution_request for any local: true call', async () => {
      const commandArbitrary = fc.string({ minLength: 1, maxLength: 30 });
      const reasonArbitrary = fc.string({ minLength: 1, maxLength: 30 });

      await fc.assert(
        fc.asyncProperty(commandArbitrary, reasonArbitrary, async (command, reason) => {
          const mockEmitEvent = vi.fn();
          const mockNativeResult = {
            content: [{ type: 'text', text: 'Output' }],
            isError: false
          };
          mockBashExecutor.mockResolvedValue(mockNativeResult);

          const executionPromise = executePwshTool.execute(
            {
              command,
              local: true,
              reason
            },
            undefined,
            mockEmitEvent
          );

          await new Promise(resolve => setTimeout(resolve, 10));

          // Verify event type
          expect(mockEmitEvent).toHaveBeenCalled();
          const emittedEvent = mockEmitEvent.mock.calls[0][0];

          expect(emittedEvent.type).toBe('local_execution_request');

          // Resolve and clean up
          const resolvers = getLocalExecutionResolvers();
          const resolver = resolvers.get(emittedEvent.requestId);
          resolver({ approved: true, alwaysAllow: false });

          await executionPromise;
        }),
        { numRuns: 50 }
      );
    });

    it('should not emit event when local: false or local is not specified', async () => {
      const commandArbitrary = fc.string({ minLength: 1, maxLength: 30 });

      await fc.assert(
        fc.asyncProperty(commandArbitrary, async (command) => {
          const mockEmitEvent = vi.fn();
          const mockVmResult = {
            stdout: 'VM output',
            stderr: '',
            exitCode: 0
          };
          vi.mocked(linuxVmExecutor.runInLinuxVM).mockResolvedValue(mockVmResult);

          // Test with local: false
          await executePwshTool.execute(
            {
              command,
              local: false
            },
            undefined,
            mockEmitEvent
          );

          expect(mockEmitEvent).not.toHaveBeenCalled();

          // Test with local not specified
          mockEmitEvent.mockClear();
          await executePwshTool.execute(
            {
              command
            },
            undefined,
            mockEmitEvent
          );

          expect(mockEmitEvent).not.toHaveBeenCalled();
        }),
        { numRuns: 50 }
      );
    });
  });
});
