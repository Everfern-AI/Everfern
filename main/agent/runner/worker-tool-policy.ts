import type { AgentTool } from './types';
import { isPrivateUrl } from '../tools/net-guard';
import { execFile } from 'child_process';

/**
 * Tools permitted for autonomous workers.
 * Workers run inside an isolated VM / sandboxed browser boundary.
 * Host computer manipulation tools are blocked.
 */
export const WORKER_SAFE_TOOLS = new Set([
  // Web & In-App UI Automation
  'navis',

  // Desktop App & Window Lifecycle
  'open_app',
  'switch_app',
  'list_apps',
  'close_app',

  // Sandboxed VM Execution & Filesystem (~/everfern-workers/<id>)
  'worker_bash',
  'worker_exec',
  'worker_read_file',
  'worker_write_file',
  'worker_list_files',
  'worker_upload_files',
  'present_files',

  // Native Sheets app + in-app pixel automation (Files, Sheets, etc.)
  'sheets_read',
  'sheets_write',
  'sheets_append',
  'sheets_clear',
  'sheets_create',
  'sheets_import',
  'sheets_export',
  'sheets_format',
  'sheets_add_sheet',
  'worker_click',
  'worker_type',
  'worker_describe',
  'files_action',
  'terminal_run',

  // Structured Planning & Status Tracking
  'create_plan',
  'update_plan_step',
  'execution_plan',
  'todo_write',

  // Web Research & Extraction
  'web_search',
  'web_fetch',

  // Human-in-the-loop (not in scheduled runs, see guardWorkerTools) and read-only memory.
  // Workers read web pages all day; they must not be able to write the memory and profile
  // that the main assistant trusts in every later chat.
  'ask_user',
  'ask_user_question',
  'memory_search',
  'recall_fact',

  // Lifecycle, delegation and vision the worker needs to finish a job.
  'task_complete',
  'spawn_agent',
  'spawn_swarm',
  'analyze_image',
  'skill',
]);

/**
 * Tools that only make sense for a worker's own desktop.
 * The general "Ask EverFern" chat must not be offered these.
 */
export const WORKER_ONLY_TOOLS = new Set([
  'open_app',
  'switch_app',
  'list_apps',
  'close_app',
  'worker_bash',
  'worker_exec',
  'worker_read_file',
  'worker_write_file',
  'worker_list_files',
  'worker_upload_files',
  'sheets_read',
  'sheets_write',
  'sheets_append',
  'sheets_clear',
  'sheets_create',
  'sheets_import',
  'sheets_export',
  'sheets_format',
  'sheets_add_sheet',
  'worker_click',
  'worker_type',
  'worker_describe',
  'files_action',
  'terminal_run',
]);

const ASK_TOOLS = new Set(['ask_user', 'ask_user_question']);

function nativeWorkerDecision(toolName: string, conversationId: string, args: unknown): Promise<string | null> | undefined {
  const executable = process.env.EVERFERN_SHELL === 'tauri' && process.env.EF_NATIVE_EXE;
  if (!executable) return;
  return new Promise(resolve => {
    let settled = false;
    const finish = (decision: string | null) => {
      if (settled) return;
      settled = true;
      resolve(decision);
    };
    const child = execFile(executable, ['--ef-worker-tool-policy'], {
      encoding: 'utf8', windowsHide: true, timeout: 5000, maxBuffer: 1024 * 1024,
    }, (error, output) => {
      if (error) return finish(null);
      try {
        const result = JSON.parse(output);
        finish(['allow', 'unsafe', 'unattended_ask', 'private_fetch'].includes(result?.decision) ? result.decision : null);
      } catch { finish(null); }
    });
    child.stdin?.once('error', () => finish(null));
    child.stdin?.end(JSON.stringify({ toolName, conversationId, url: (args as any)?.url }));
  });
}

/** A scheduled run ("worker-<id>-auto-<time>"): nobody is there to answer. */
export const isUnattendedRun = (convId: string) => /^worker-.+-auto-\d+$/.test(convId);

// The address checks live with web_fetch so it can apply them to every redirect.
export { isPrivateUrl };

export function guardWorkerTools(tools: AgentTool[], runner: any): AgentTool[] {
  return tools.map((tool) => ({
    ...tool,
    execute: async (...args: Parameters<AgentTool['execute']>) => {
      const convId = String(runner.currentConversationId || '');
      const isWorkerRun = convId.startsWith('worker-');

      if (isWorkerRun) {
        const nativeDecision = await nativeWorkerDecision(tool.name, convId, args[0]);
        if (nativeDecision === 'unsafe' || (nativeDecision == null && !WORKER_SAFE_TOOLS.has(tool.name))) {
          return {
            success: false,
            output:
              'This worker can control only its registered VM apps. Use navis for DOM inspection and actions inside the VM browser. Host tools are disabled.',
          };
        }
        if (nativeDecision === 'unattended_ask' || (nativeDecision == null && ASK_TOOLS.has(tool.name) && isUnattendedRun(convId))) {
          return {
            success: false,
            output:
              'This is a scheduled run and nobody is watching, so you cannot ask questions now. Do what you can without the answer; where you cannot, skip that part and say in your final report exactly what you need from the user.',
          };
        }
        if (nativeDecision === 'private_fetch') {
          return { success: false, output: 'Workers cannot fetch addresses on this computer or its local network. Use a public web address.' };
        }

        // Enforce the fetch redirect boundary in the native tool as well.
        if (tool.name === 'web_fetch') {
          const input = (args[0] ?? {}) as Record<string, unknown>;
          if (nativeDecision == null && isPrivateUrl(input.url)) {
            return { success: false, output: 'Workers cannot fetch addresses on this computer or its local network. Use a public web address.' };
          }
          // web_fetch then checks DNS answers and every redirect too.
          return tool.execute({ ...input, __publicOnly: true } as any, ...(args.slice(1) as any[]));
        }
      }

      return tool.execute(...args);
    },
  }));
}
