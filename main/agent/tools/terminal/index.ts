import { AgentTool, ToolResult } from '../../runner/types';
import { CommandRegistry } from './registry';
import * as os from 'os';
import * as path from 'path';

/** Default working directory for agent commands — ~/.everfern (cross-platform) */
const AGENT_DEFAULT_CWD = path.join(os.homedir(), '.everfern');

/**
 * Enhanced Terminal Tool
 * Provides persistent command execution with status tracking.
 */
export const terminalTool: AgentTool = {
  name: 'terminal_execute',
  description: 'Execute a terminal command with persistence and tracking. Use for long-running tasks or when you need to monitor output.',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The command to execute' },
      cwd: { type: 'string', description: 'Working directory (defaults to ~/.everfern)' },
      id: { type: 'string', description: 'Optional unique ID for this command session' },
      timeoutMs: { type: 'number', description: 'Optional idle timeout in milliseconds (defaults to 60000)' },
      target: { type: 'string', enum: ['main', 'vm'], description: "Environment target: 'main' (host system, requires permission) or 'vm' (Linux VM, no permission needed). Defaults to 'main'." }
    },
    required: ['command']
  },
  execute: async (args: Record<string, unknown>, onUpdate?: (msg: string) => void, emitEvent?: (event: any) => void, toolCallId?: string): Promise<ToolResult> => {
    const registry = CommandRegistry.getInstance();
    const command = args.command as string;
    const cwd = (args.cwd as string) || AGENT_DEFAULT_CWD;
    const id = (args.id as string) || toolCallId || `term_${Date.now()}`;
    const timeoutMs = args.timeoutMs as number | undefined;
    const target = (args.target as 'main' | 'vm') || 'main';

    // Safety check: block command if target is main and it tries to kill node processes
    const normalizedCmd = (command || '').toLowerCase();
    if (target === 'main' && normalizedCmd.includes('node') && (normalizedCmd.includes('stop-process') || normalizedCmd.includes('kill') || normalizedCmd.includes('taskkill'))) {
      return {
        success: false,
        output: 'Security Warning: Execution of commands that terminate Node.js/agent processes is blocked to prevent application crash.',
        error: 'blocked_command'
      };
    }

    onUpdate?.(`Terminal [${id}] (${target}): Executing "${command}"...`);

    const info = await registry.execute(id, command, cwd, timeoutMs, target);

    if (info.status === 'completed') {
      return {
        success: true,
        output: info.output || 'Command completed with no output.',
        data: info
      };
    } else {
      return {
        success: false,
        output: info.output || 'Command failed.',
        error: `Exit code: ${info.exitCode}`,
        data: info
      };
    }
  }
};

/**
 * Terminal Status Tool
 * Check output of a running command.
 */
export const terminalStatusTool: AgentTool = {
  name: 'terminal_status',
  description: 'Check the status and output of a previously started terminal command.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'The unique ID of the command session' }
    },
    required: ['id']
  },
  execute: async (args: Record<string, unknown>, onUpdate?: (msg: string) => void, emitEvent?: (event: any) => void, toolCallId?: string): Promise<ToolResult> => {
    const registry = CommandRegistry.getInstance();
    const id = args.id as string;
    const commands = registry.listCommands();
    const info = commands.find(c => c.id === id);

    if (!info) {
      return { success: false, output: `No command found with ID: ${id}`, error: 'not_found' };
    }

    return {
      success: true,
      output: info.output || 'No output yet.',
      data: info
    };
  }
};
