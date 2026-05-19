/**
 * Integration tests for pi-tools VM routing functionality
 *
 * Verifies that:
 * - Default routes to VM
 * - local: true routes to native
 * - Output shape is identical in both cases
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the Linux VM executor
vi.mock('../linux-vm-executor', () => ({
  runInLinuxVM: vi.fn()
}));

import { getPiCodingTools, __setPiCodingAgentModule } from '../pi-tools';
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

describe('Pi Tools VM Routing', () => {
  let tools: any[];
  let executePwshTool: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    __setPiCodingAgentModule(mockPiCodingAgentModule);
    tools = await getPiCodingTools();
    executePwshTool = tools.find(tool => tool.name === 'executePwsh');

  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Tool Schema', () => {
    it('should add local parameter to executePwsh tool schema', () => {
      expect(executePwshTool).toBeDefined();
      expect(executePwshTool.parameters.properties.local).toEqual({
        type: 'boolean',
        description: 'Set to true to execute on local machine instead of Linux VM (requires user permission)',
        default: false
      });
    });

    it('should preserve original command and timeout parameters', () => {
      expect(executePwshTool.parameters.properties.command).toEqual({
        type: 'string',
        description: 'Command to execute'
      });
      expect(executePwshTool.parameters.properties.timeout).toEqual({
        type: 'number',
        description: 'Timeout in seconds'
      });
    });

    it('should update description to mention VM routing', () => {
      expect(executePwshTool.description).toContain('Linux VM by default');
      expect(executePwshTool.description).toContain('local=true');
    });
  });

  describe('VM Routing Behavior', () => {
    it('should route to Linux VM by default (local not specified)', async () => {
      const mockVmResult = {
        stdout: 'VM output',
        stderr: '',
        exitCode: 0
      };

      vi.mocked(linuxVmExecutor.runInLinuxVM).mockResolvedValue(mockVmResult);

      const result = await executePwshTool.execute({
        command: 'echo "test"'
      });

      expect(linuxVmExecutor.runInLinuxVM).toHaveBeenCalledWith('echo "test"');
      expect(mockBashExecutor).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: true,
        output: 'VM output'
      });
    });

    it('should route to Linux VM when local=false', async () => {
      const mockVmResult = {
        stdout: 'VM output',
        stderr: '',
        exitCode: 0
      };

      vi.mocked(linuxVmExecutor.runInLinuxVM).mockResolvedValue(mockVmResult);

      const result = await executePwshTool.execute({
        command: 'echo "test"',
        local: false
      });

      expect(linuxVmExecutor.runInLinuxVM).toHaveBeenCalledWith('echo "test"');
      expect(mockBashExecutor).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: true,
        output: 'VM output'
      });
    });

    it('should route to native executor when local=true', async () => {
      const mockNativeResult = {
        content: [{ type: 'text', text: 'Native output' }],
        isError: false
      };

      mockBashExecutor.mockResolvedValue(mockNativeResult);

      const result = await executePwshTool.execute({
        command: 'echo "test"',
        local: true,
        reason: 'Need to access local files'
      });

      expect(linuxVmExecutor.runInLinuxVM).not.toHaveBeenCalled();
      expect(mockBashExecutor).toHaveBeenCalledWith(
        expect.any(String),
        { command: 'echo "test"', local: true, reason: 'Need to access local files' }
      );
      expect(result).toEqual({
        success: true,
        output: 'Native output'
      });
    });
  });

  describe('Output Format Consistency', () => {
    it('should return identical output structure for VM success', async () => {
      const mockVmResult = {
        stdout: 'Success output',
        stderr: '',
        exitCode: 0
      };

      vi.mocked(linuxVmExecutor.runInLinuxVM).mockResolvedValue(mockVmResult);

      const result = await executePwshTool.execute({
        command: 'echo "success"'
      });

      expect(result).toEqual({
        success: true,
        output: 'Success output'
      });
      expect(result.error).toBeUndefined();
    });

    it('should return identical output structure for VM failure', async () => {
      const mockVmResult = {
        stdout: '',
        stderr: 'Error output',
        exitCode: 1
      };

      vi.mocked(linuxVmExecutor.runInLinuxVM).mockResolvedValue(mockVmResult);

      const result = await executePwshTool.execute({
        command: 'false'
      });

      expect(result).toEqual({
        success: false,
        output: 'Error output',
        error: 'Error output'
      });
    });

    it('should return identical output structure for native success', async () => {
      const mockNativeResult = {
        content: [{ type: 'text', text: 'Native success' }],
        isError: false
      };

      mockBashExecutor.mockResolvedValue(mockNativeResult);

      const result = await executePwshTool.execute({
        command: 'echo "success"',
        local: true,
        reason: 'Need local execution'
      });

      expect(result).toEqual({
        success: true,
        output: 'Native success'
      });
      expect(result.error).toBeUndefined();
    });

    it('should return identical output structure for native failure', async () => {
      const mockNativeResult = {
        content: [{ type: 'text', text: 'Native error' }],
        isError: true
      };

      mockBashExecutor.mockResolvedValue(mockNativeResult);

      const result = await executePwshTool.execute({
        command: 'false',
        local: true,
        reason: 'Need local execution'
      });

      expect(result).toEqual({
        success: false,
        output: 'Native error',
        error: 'Native error'
      });
    });
  });

  describe('Fallback Behavior', () => {
    it('should fallback to native execution when VM fails', async () => {
      const vmError = new Error('VM not available');
      vi.mocked(linuxVmExecutor.runInLinuxVM).mockRejectedValue(vmError);

      const mockNativeResult = {
        content: [{ type: 'text', text: 'Fallback output' }],
        isError: false
      };
      mockBashExecutor.mockResolvedValue(mockNativeResult);

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await executePwshTool.execute({
        command: 'echo "test"'
      });

      expect(linuxVmExecutor.runInLinuxVM).toHaveBeenCalledWith('echo "test"');
      expect(mockBashExecutor).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(
        'Linux VM execution failed, falling back to native:',
        vmError
      );
      expect(result).toEqual({
        success: true,
        output: 'Fallback output'
      });

      consoleSpy.mockRestore();
    });
  });

  describe('Error Handling', () => {
    it('should handle VM execution errors gracefully', async () => {
      const mockVmResult = {
        stdout: 'Some output',
        stderr: 'Command failed with error',
        exitCode: 127
      };

      vi.mocked(linuxVmExecutor.runInLinuxVM).mockResolvedValue(mockVmResult);

      const result = await executePwshTool.execute({
        command: 'nonexistent-command'
      });

      expect(result).toEqual({
        success: false,
        output: 'Command failed with error',
        error: 'Command failed with error'
      });
    });

    it('should handle mixed stdout/stderr from VM', async () => {
      const mockVmResult = {
        stdout: 'Some output',
        stderr: 'Warning message',
        exitCode: 1
      };

      vi.mocked(linuxVmExecutor.runInLinuxVM).mockResolvedValue(mockVmResult);

      const result = await executePwshTool.execute({
        command: 'command-with-warning'
      });

      expect(result).toEqual({
        success: false,
        output: 'Warning message',
        error: 'Warning message'
      });
    });

    it('should prefer stderr over stdout for failed commands', async () => {
      const mockVmResult = {
        stdout: 'Some stdout',
        stderr: 'Error message',
        exitCode: 1
      };

      vi.mocked(linuxVmExecutor.runInLinuxVM).mockResolvedValue(mockVmResult);

      const result = await executePwshTool.execute({
        command: 'failing-command'
      });

      expect(result.output).toBe('Error message');
      expect(result.error).toBe('Error message');
    });

    it('should use stdout if stderr is empty for failed commands', async () => {
      const mockVmResult = {
        stdout: 'Error in stdout',
        stderr: '',
        exitCode: 1
      };

      vi.mocked(linuxVmExecutor.runInLinuxVM).mockResolvedValue(mockVmResult);

      const result = await executePwshTool.execute({
        command: 'failing-command'
      });

      expect(result.output).toBe('Error in stdout');
      expect(result.error).toBe('Error in stdout');
    });
  });

  describe('Parameter Passing', () => {
    it('should pass timeout parameter to native executor when local=true', async () => {
      const mockNativeResult = {
        content: [{ type: 'text', text: 'Output' }],
        isError: false
      };

      mockBashExecutor.mockResolvedValue(mockNativeResult);

      await executePwshTool.execute({
        command: 'echo "test"',
        timeout: 30,
        local: true,
        reason: 'Need local execution'
      });

      expect(mockBashExecutor).toHaveBeenCalledWith(
        expect.any(String),
        { command: 'echo "test"', timeout: 30, local: true, reason: 'Need local execution' }
      );
    });

    it('should not pass timeout to VM executor (VM handles its own timeout)', async () => {
      const mockVmResult = {
        stdout: 'VM output',
        stderr: '',
        exitCode: 0
      };

      vi.mocked(linuxVmExecutor.runInLinuxVM).mockResolvedValue(mockVmResult);

      await executePwshTool.execute({
        command: 'echo "test"',
        timeout: 30
      });

      expect(linuxVmExecutor.runInLinuxVM).toHaveBeenCalledWith('echo "test"');
    });
  });

  describe('Local Execution Reason Validation', () => {
    it('should add reason parameter to executePwsh tool schema', () => {
      expect(executePwshTool.parameters.properties.reason).toEqual({
        type: 'string',
        description: 'Required when local=true. Explain why local execution is needed.'
      });
    });

    it('should reject local execution without reason field', async () => {
      const result = await executePwshTool.execute({
        command: 'echo "test"',
        local: true
      });

      expect(result).toEqual({
        success: false,
        output: 'ERROR: local execution requires a reason field'
      });
      expect(mockBashExecutor).not.toHaveBeenCalled();
      expect(linuxVmExecutor.runInLinuxVM).not.toHaveBeenCalled();
    });

    it('should reject local execution with empty reason field', async () => {
      const result = await executePwshTool.execute({
        command: 'echo "test"',
        local: true,
        reason: ''
      });

      expect(result).toEqual({
        success: false,
        output: 'ERROR: local execution requires a reason field'
      });
      expect(mockBashExecutor).not.toHaveBeenCalled();
      expect(linuxVmExecutor.runInLinuxVM).not.toHaveBeenCalled();
    });

    it('should allow local execution with valid reason field', async () => {
      const mockNativeResult = {
        content: [{ type: 'text', text: 'Local output' }],
        isError: false
      };

      mockBashExecutor.mockResolvedValue(mockNativeResult);

      const result = await executePwshTool.execute({
        command: 'echo "test"',
        local: true,
        reason: 'Need to access local file system'
      });

      expect(mockBashExecutor).toHaveBeenCalled();
      expect(result).toEqual({
        success: true,
        output: 'Local output'
      });
    });

    it('should not require reason field when local=false', async () => {
      const mockVmResult = {
        stdout: 'VM output',
        stderr: '',
        exitCode: 0
      };

      vi.mocked(linuxVmExecutor.runInLinuxVM).mockResolvedValue(mockVmResult);

      const result = await executePwshTool.execute({
        command: 'echo "test"',
        local: false
      });

      expect(linuxVmExecutor.runInLinuxVM).toHaveBeenCalled();
      expect(result).toEqual({
        success: true,
        output: 'VM output'
      });
    });

    it('should not require reason field when local is not specified', async () => {
      const mockVmResult = {
        stdout: 'VM output',
        stderr: '',
        exitCode: 0
      };

      vi.mocked(linuxVmExecutor.runInLinuxVM).mockResolvedValue(mockVmResult);

      const result = await executePwshTool.execute({
        command: 'echo "test"'
      });

      expect(linuxVmExecutor.runInLinuxVM).toHaveBeenCalled();
      expect(result).toEqual({
        success: true,
        output: 'VM output'
      });
    });

    it('should validate reason before attempting execution (no event emission)', async () => {
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
  });
});
