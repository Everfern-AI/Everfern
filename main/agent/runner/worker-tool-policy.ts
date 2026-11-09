import type { AgentTool } from './types';

/**
 * Tools permitted for autonomous Warmwind Workers.
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

  // Structured Planning & Status Tracking
  'create_plan',
  'update_plan_step',
  'execution_plan',
  'todo_write',

  // Web Research & Extraction
  'web_search',
  'web_fetch',

  // Human-in-the-Loop & Memory Graph
  'ask_user',
  'ask_user_question',
  'memory_search',
  'memory_save',
  'remember_fact',
  'recall_fact',
  'update_profile',

  // Lifecycle, delegation and vision the worker needs to finish a job.
  'task_complete',
  'spawn_agent',
  'spawn_swarm',
  'analyze_image',
  'skill',
]);

/**
 * Tools that only make sense for a Warmwind worker's own desktop.
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
]);

export function guardWorkerTools(tools: AgentTool[], runner: any): AgentTool[] {
  return tools.map((tool) => ({
    ...tool,
    execute: async (...args: Parameters<AgentTool['execute']>) => {
      const convId = String(runner.currentConversationId || '');
      const isWorkerRun = convId.startsWith('worker-');

      if (isWorkerRun) {
        // Transparent routing: Route computer_use calls to the VM browser controller (navis)
        if (tool.name === 'computer_use') {
          const browser =
            runner.tools?.find((candidate: AgentTool) => candidate.name === 'navis') ??
            tools.find((candidate) => candidate.name === 'navis');
          if (browser) {
            return browser.execute(...args);
          }
        }

        // Enforce VM sandbox boundary: block host tools
        if (!WORKER_SAFE_TOOLS.has(tool.name)) {
          return {
            success: false,
            output:
              'This worker can control only its registered VM apps. Use navis for DOM inspection and actions inside the VM browser. Host tools are disabled.',
          };
        }
      }

      return tool.execute(...args);
    },
  }));
}
