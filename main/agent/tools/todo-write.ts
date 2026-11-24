import * as fs from 'fs';
import * as path from 'path';
import { homedir as osHomedir } from 'os';
import { execFile } from 'child_process';
import type { AgentTool, ToolResult } from '../runner/types';

export const todoWriteTool: AgentTool = {
  name: 'todo_write',
  description:
    'Maintain a structured task list in task.md. ' +
    'Use this for all multi-step tasks to track progress. ' +
    'States: pending, in_progress, completed. ' +
    'Mark as completed ONLY after full verification.',
  parameters: {
    type: 'object',
    properties: {
      tasks: {
        type: 'array',
        description: 'Complete list of tasks for the current goal.',
        items: {
          type: 'object',
          properties: {
            description: { type: 'string', description: 'What needs to be done.' },
            status: {
              type: 'string',
              enum: ['pending', 'in_progress', 'completed'],
              description: 'Current state of the task.'
            }
          },
          required: ['description', 'status']
        }
      },
      planPath: {
        type: 'string',
        description: 'Optional absolute path to the planning directory where task.md should reside. Defaults to ~/.everfern/tasks if not provided.'
      }
    },
    required: ['tasks']
  },

  async execute(args: Record<string, unknown>, onUpdate?: (msg: string) => void, emitEvent?: (event: any) => void, toolCallId?: string): Promise<ToolResult> {
    const tasks = args.tasks as Array<{ description: string; status: string }>;
    let planPath = args.planPath as string;

    if (!tasks || !Array.isArray(tasks)) {
      return { success: false, output: 'Tasks must be an array.', error: 'invalid_args' };
    }

    // If planPath is not provided, use a default location
    if (!planPath || typeof planPath !== 'string') {
      const homedir = osHomedir();
      planPath = path.join(homedir, '.everfern', 'tasks');
      console.warn('[TodoWrite] planPath not provided, using default:', planPath);
    }

    try {
      const taskFile = path.join(planPath, 'task.md');
      const native = process.env.EVERFERN_SHELL === 'tauri' && process.env.EF_NATIVE_EXE;
      if (native) {
        return await new Promise<ToolResult>((resolve, reject) => {
          const child = execFile(native, ['--ef-write-todos'], {
            encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024,
          }, (error, output) => {
            if (error) return reject(error);
            try { resolve(JSON.parse(output)); } catch (parseError) { reject(parseError); }
          });
          child.stdin?.once('error', reject);
          child.stdin?.end(JSON.stringify({ path: taskFile, tasks }));
        });
      }
      // Ensure directory exists
      if (!fs.existsSync(planPath)) {
        fs.mkdirSync(planPath, { recursive: true });
      }


      // Generate Markdown content
      const lines = ['# Task List', ''];
      tasks.forEach(t => {
        const icon = t.status === 'completed' ? '[x]' : t.status === 'in_progress' ? '[/]' : '[ ]';
        lines.push(`- ${icon} ${t.description}`);
      });

      fs.writeFileSync(taskFile, lines.join('\n'), 'utf8');

      return {
        success: true,
        output: `✅ Updated task.md with ${tasks.length} tasks matching current progress.`,
        data: { path: taskFile, tasks }
      };
    } catch (err: any) {
      return { success: false, output: `Failed to write task.md: ${err.message}`, error: err.code };
    }
  }
};
