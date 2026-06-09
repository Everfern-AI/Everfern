/**
 * EverFern Desktop — Control Plane Tools
 * 
 * Tools for high-stakes operations that require user confirmation.
 */

import type { AgentTool, ToolResult } from '../runner/types';

/**
 * allow_file_delete
 * 
 * Requests permission to perform permanent file deletions.
 */
export const allowFileDeleteTool: AgentTool = {
  name: 'allow_file_delete',
  description: 'Request permission to delete files in a directory. Call this when a delete operation fails with "Operation not permitted".',
  parameters: {
    type: 'object',
    properties: {
      directory: {
        type: 'string',
        description: 'The directory where deletions are planned.'
      },
      reason: {
        type: 'string',
        description: 'Why you need to delete these files (e.g. cleanup, build reset).'
      }
    },
    required: ['directory']
  },

  async execute(args: Record<string, unknown>, onUpdate?: (msg: string) => void, emitEvent?: (event: any) => void, toolCallId?: string): Promise<ToolResult> {
    const dir = args['directory'];
    return {
      success: true,
      output: `✔ Deletion permission requested for: ${dir}. Please inform the user via chat why this is necessary and wait for their explicit manual approval for the next tool call.`,
      data: { directory: dir, status: 'requested' }
    };
  }
};
