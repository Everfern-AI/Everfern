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
  description: `Execute a terminal command with persistence and tracking. IMPORTANT: target 'main' runs in the host machine's shell (PowerShell on Windows, Bash/Zsh on macOS/Linux). target 'vm' runs inside the Linux VM (WSL on Windows, Docker on macOS). Check which target you are using and write commands compatible with that target's shell syntax.`,
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The command to execute. For target "main" on a Windows host, you MUST write Windows PowerShell commands (do not use "ls -la", use PowerShell syntax and backslash paths). For target "vm", write Linux Bash commands and use forward-slash Linux paths.' },
      cwd: { type: 'string', description: 'Working directory (defaults to ~/.everfern)' },
      id: { type: 'string', description: 'Optional unique ID for this command session' },
      timeoutMs: { type: 'number', description: 'Optional idle timeout in milliseconds (defaults to 60000). Use 180000-300000 for builds, installs, typechecks, and slow commands.' },
      timeout: { type: 'number', description: 'Optional timeout. Values <= 10000 are treated as seconds; larger values are milliseconds.' },
      timeoutSeconds: { type: 'number', description: 'Optional timeout in seconds.' },
      target: { type: 'string', enum: ['main', 'vm'], description: "Environment target: 'main' (host system: PowerShell on Windows, Bash/Zsh on Unix; requires permission) or 'vm' (Linux VM: WSL on Windows, Docker on macOS; no permission needed). Defaults to 'main'." }
    },
    required: ['command']
  },
  execute: async (args: Record<string, unknown>, onUpdate?: (msg: string) => void, emitEvent?: (event: any) => void, toolCallId?: string): Promise<ToolResult> => {
    const registry = CommandRegistry.getInstance();
    const command = args.command as string;
    if (!command) {
      return {
        success: false,
        output: 'Error: The "command" parameter is required.',
        error: 'missing_parameter'
      };
    }
    const cwd = (args.cwd as string) || AGENT_DEFAULT_CWD;
    const id = (args.id as string) || toolCallId || `term_${Date.now()}`;
    const normalizeTimeoutMs = (value: unknown): number | undefined => {
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0) return undefined;
      return n <= 10000 ? n * 1000 : n;
    };
    const timeoutMs =
      normalizeTimeoutMs(args.timeoutMs) ??
      normalizeTimeoutMs(args.timeout) ??
      normalizeTimeoutMs(args.timeoutSeconds);
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

    const info = await registry.execute(id, command, cwd, timeoutMs, target, onUpdate);

    try {
      const { getAgentContext } = require('../pi-tools');
      const { getRollbackManager } = require('../../persistence/rollback-manager');
      const { taskId, stepNumber } = getAgentContext();
      if (taskId && stepNumber !== undefined) {
        const rollbackManager = getRollbackManager();
        await rollbackManager.initialize();
        const exitCode = info.exitCode ?? (info.status === 'completed' ? 0 : 1);
        await rollbackManager.trackCommandExecution(
          command,
          info.output || '',
          exitCode,
          taskId,
          stepNumber
        );
      }
    } catch (trackError) {
      console.warn(`[terminalTool] Failed to track command execution: ${command}`, trackError);
    }

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
