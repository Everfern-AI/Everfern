/**
 * EverFern — task_complete tool
 *
 * A first-class tool that agents call to signal they have finished ALL
 * steps of the assigned task. This replaces magic-string patterns like
 * `[PHASE_COMPLETE: complete]` with a proper tool-call-presence check,
 * consistent with the ReAct / OpenAI Swarm / LangGraph routing pattern:
 *
 *   "Continue if tool calls exist. Done if task_complete was called."
 *
 * The tool itself is a no-op side-effect-wise — it just records the
 * summary and returns success so the graph edge can detect it.
 */

import type { AgentTool, ToolResult } from '../runner/types';
import { execFile } from 'child_process';

export const taskCompleteTool: AgentTool = {
  name: 'task_complete',
  description:
    'Call this tool ONLY when you have finished ALL steps of the assigned task and verified the output (build passing, types clean, etc.). ' +
    'Provide a brief summary of everything you accomplished. ' +
    'Do NOT call this tool mid-task or between phases — only when the entire request is done.',
  parameters: {
    type: 'object',
    properties: {
      summary: {
        type: 'string',
        description: 'A brief summary of everything completed in this task.',
      },
    },
    required: ['summary'],
  },
  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const summary = String(args.summary || 'Task completed.');
    console.log(`[task_complete] ✅ Task completion signalled. Summary: ${summary.slice(0, 200)}`);
    const native = process.env.EVERFERN_SHELL === 'tauri' && process.env.EF_NATIVE_EXE;
    if (native) {
      try {
        return await new Promise<ToolResult>((resolve, reject) => {
          const child = execFile(native, ['--ef-task-complete'], {
            encoding: 'utf8', windowsHide: true, timeout: 10000,
          }, (error, output) => {
            if (error) return reject(error);
            try { resolve(JSON.parse(output)); } catch (parseError) { reject(parseError); }
          });
          child.stdin?.once('error', reject);
          child.stdin?.end(JSON.stringify({ summary }));
        });
      } catch (error) {
        console.warn('[task_complete] Native result unavailable:', error);
      }
    }
    return {
      success: true,
      output: `Task marked as complete. Summary: ${summary}`,
      data: { completed: true, summary },
    };
  },
};
