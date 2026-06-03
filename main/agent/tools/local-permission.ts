import type { AgentTool, ToolResult } from '../runner/types';
import { getLocalExecutionResolvers } from './pi-tools';

export const localPermissionTool: AgentTool = {
  name: 'local_permission',
  description:
    'Request permission from the user to execute a command on the host machine (outside the Linux VM). ' +
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

    // Approved — return success for the agent to follow up with actual execution
    return {
      success: true,
      output: `Local execution approved. You may now execute the command on the host machine:\n\n\`${command}\`\n\nUse executePwsh with local: true to run this command.`,
      data: { approved: true, alwaysAllow: response.alwaysAllow, command, shellType }
    };
  }
};
