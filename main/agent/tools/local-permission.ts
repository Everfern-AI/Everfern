import type { AgentTool, ToolResult } from '../runner/types';
import { getLocalExecutionResolvers } from './pi-tools';
import * as os from 'os';
import * as path from 'path';

function getHostExecutionContext(cwd?: string, shell?: string): string {
  const home = os.homedir();
  return [
    'Host execution context:',
    `- Platform: ${process.platform} ${os.release()}`,
    `- Current working directory: ${cwd || process.cwd()}`,
    `- User profile/home: ${home}`,
    `- Downloads: ${path.join(home, 'Downloads')}`,
    `- Desktop: ${path.join(home, 'Desktop')}`,
    `- Shell: ${shell || 'host default'}`,
  ].join('\n');
}

export const localPermissionTool: AgentTool = {
  name: 'local_permission',
  description:
    'Request permission from the user to execute a command on the host machine (outside the Linux VM). ' +
    `Host machine details: USERPROFILE/Home=${os.homedir()}, Downloads=${path.join(os.homedir(), 'Downloads')}. ` +
    'Use this instead of setting local=true on executePwsh. ' +
    'Required when you need to access Windows-only files, run native executables, or interact with local hardware/GUI. ' +
    'The system will show a permission dialog to the user with your reason.',
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The command to execute on the host machine.'
      },
      reason: {
        type: 'string',
        description: 'Required. Explain to the user why local execution is needed (e.g. accessing Windows-only files, running native executables, interacting with local hardware).'
      },
      shellType: {
        type: 'string',
        description: 'The shell type to use. Default: "Bash". Use "PowerShell" for Windows-specific commands.',
        enum: ['Bash', 'PowerShell', 'PowerShell7', 'CMD']
      }
    },
    required: ['command', 'reason']
  },

  async execute(args: Record<string, unknown>, onUpdate?: (msg: string) => void, emitEvent?: (event: any) => void, toolCallId?: string): Promise<ToolResult> {
    const command = args.command as string;
    const reason = args.reason as string;
    const shellType = (args.shellType as string) || 'Bash';

    if (!command) {
      return { success: false, output: 'command is required', error: 'Missing required parameter: command' };
    }

    if (!reason) {
      return { success: false, output: 'reason is required — explain why local execution is needed', error: 'Missing required parameter: reason' };
    }

    if (!emitEvent) {
      return { success: false, output: 'Cannot request permission: no event emitter available', error: 'emitEvent not available' };
    }

    const requestId = `local-exec-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    emitEvent({
      type: 'local_execution_request',
      requestId,
      command,
      shellType,
      reason,
      conversationId: undefined
    });

    onUpdate?.(`⏳ Requesting permission for local execution: ${reason}`);

    const approvalPromise = new Promise<{ approved: boolean; alwaysAllow: boolean }>((resolve) => {
      const resolvers = getLocalExecutionResolvers();
      console.log(`[local-permission] 🔑 Registering resolver for requestId: ${requestId}. Map size before: ${resolvers.size}`);
      resolvers.set(requestId, resolve);
    });

    const response = await approvalPromise;

    const resolvers = getLocalExecutionResolvers();
    console.log(`[local-permission] 🔓 Resolving requestId: ${requestId}, approved: ${response.approved}. Map size before delete: ${resolvers.size}`);
    resolvers.delete(requestId);

    if (!response.approved) {
      return { success: false, output: 'Local execution denied by user.' };
    }

    // Approved — execute the command on the host machine
    onUpdate?.(`🚀 Execution approved. Running command on host machine...`);

    let shell: string | undefined;
    try {
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);

      // Select shell based on platform and request
      if (process.platform === 'win32') {
        if (shellType === 'PowerShell') {
          shell = 'powershell.exe';
        } else if (shellType === 'PowerShell7') {
          shell = 'pwsh.exe';
        } else if (shellType === 'CMD') {
          shell = 'cmd.exe';
        } else {
          shell = 'powershell.exe';
        }
      } else {
        if (shellType === 'PowerShell' || shellType === 'PowerShell7') {
          shell = 'pwsh';
        } else {
          shell = '/bin/bash';
        }
      }

      const { stdout, stderr } = await execAsync(command, { shell, timeout: 300000 });

      const combined = [stdout, stderr].filter(Boolean).join('\n');
      const output = combined.trim() || '(Command succeeded with no output)';

      const stripAnsi = (str: string) => str.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*\x07)/g, '');

      return {
        success: true,
        output: stripAnsi(`Success: local command completed\n${getHostExecutionContext(process.cwd(), shell)}\nCommand: ${command}\nOutput:\n${output}`),
        data: {
          approved: true,
          alwaysAllow: response.alwaysAllow,
          command,
          shellType,
          cwd: process.cwd(),
          homeDir: os.homedir(),
          downloadsDir: path.join(os.homedir(), 'Downloads'),
          shell,
        }
      };
    } catch (execError: any) {
      const combined = [execError.stdout, execError.stderr, execError.message].filter(Boolean).join('\n');
      const output = combined.trim() || '(Command failed with no output)';
      const stripAnsi = (str: string) => str.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*\x07)/g, '');

      return {
        success: false,
        output: stripAnsi(`Error: local command failed\n${getHostExecutionContext(process.cwd(), shell)}\nCommand: ${command}\nOutput:\n${output}`),
        error: stripAnsi(output),
        data: {
          approved: true,
          alwaysAllow: response.alwaysAllow,
          command,
          shellType,
          cwd: process.cwd(),
          homeDir: os.homedir(),
          downloadsDir: path.join(os.homedir(), 'Downloads'),
          shell,
        }
      };
    }
  }
};
