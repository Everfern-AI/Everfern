/**
 * EverFern Desktop — Warmwind Worker Tools
 *
 * Provides dedicated OS and workspace primitives for AI Workers:
 * 1. App Lifecycle: open_app, switch_app, list_apps, close_app
 * 2. Sandboxed VM Execution: worker_bash, worker_read_file, worker_write_file, worker_list_files
 *
 * All filesystem and shell execution is strictly sandboxed to the worker's
 * isolated Linux VM workspace (~/everfern-workers/<workerId>).
 */

import { app as electronApp } from 'electron';
import { readFileSync } from 'fs';
import * as path from 'path';
import type { AgentTool, ToolResult } from '../runner/types';
import { runInLinuxVM } from './linux-vm-executor';
import { pickWorkerWindow, baseWorkerKey } from './navis/core/webview-registry';

const safeId = (id: unknown): string | null =>
  typeof id === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(id) ? id : null;

export const getWorkerIdFromConversation = (conversationId?: string): string | null => {
  if (!conversationId || typeof conversationId !== 'string') return null;
  const key = baseWorkerKey(conversationId);
  if (!key) return null;
  return safeId(key.slice('worker-'.length));
};

const getWorkerWorkspace = (workerId: string): string =>
  `$HOME/everfern-workers/${workerId}`;

// ── App Lifecycle Tools ──────────────────────────────────────────────

function workspaceDriver(conversationId: string) {
  const target = pickWorkerWindow(conversationId);
  if (target?.driver.workspace) return target.driver;
  if (target) return null; // A registered Alpine browser belongs to this local worker.
  try {
    const key = baseWorkerKey(conversationId) ?? conversationId;
    const workers = JSON.parse(readFileSync(path.join(electronApp.getPath('userData'), 'workers.json'), 'utf8'));
    if (workers.find((worker: any) => 'worker-' + worker.id === key)?.machine === 'local') return null;
  } catch { /* No trustworthy machine assignment is available. */ }
  throw new Error('Worker VM is unavailable. Open its assigned VM app and retry; local fallback is disabled.');
}
const shellQuote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";

export const openAppTool: AgentTool = {
  name: 'open_app',
  description:
    'Open, focus, or navigate an installed application window on the worker desktop ' +
    '(e.g., "gmail", "sheets", "notion", "slack", "terminal", "files", "chrome"). ' +
    'Brings that application window to the foreground and aligns the AI cursor with it.',
  parameters: {
    type: 'object',
    properties: {
      app: {
        type: 'string',
        description: 'The app ID to open/focus (e.g., "sheets", "gmail", "notion", "terminal", "files").',
      },
      url: {
        type: 'string',
        description: 'Optional URL to navigate to if this is a web application.',
      },
    },
    required: ['app'],
  },
  async execute(args: Record<string, unknown>, onUpdate?, emitEvent?): Promise<ToolResult> {
    const app = String(args.app || '').trim().toLowerCase();
    const url = typeof args.url === 'string' ? args.url.trim() : undefined;

    if (!app) {
      return { success: false, output: 'No app ID specified to open.' };
    }

    onUpdate?.(`Opening app "${app}"${url ? ` at ${url}` : ''}`);

    emitEvent?.({
      type: 'subagent-progress',
      data: {
        type: 'action',
        workerApp: app,
        action: {
          type: 'open_app',
          params: { app, url },
          description: `Focused window for ${app}`,
        },
      },
    });

    return {
      success: true,
      output: `App window "${app}" is now active and in focus${url ? ` (navigated to ${url})` : ''}.`,
      data: { app, url, active: true },
    };
  },
};

export const switchAppTool: AgentTool = {
  name: 'switch_app',
  description:
    'Bring a specific installed app window to the foreground on the worker desktop ' +
    'so that your subsequent actions target that window.',
  parameters: {
    type: 'object',
    properties: {
      app: {
        type: 'string',
        description: 'The app ID to focus (e.g., "sheets", "gmail", "notion", "slack").',
      },
    },
    required: ['app'],
  },
  async execute(args: Record<string, unknown>, onUpdate?, emitEvent?): Promise<ToolResult> {
    const app = String(args.app || '').trim().toLowerCase();
    if (!app) {
      return { success: false, output: 'No app ID specified to switch to.' };
    }

    onUpdate?.(`Switched active window to "${app}"`);

    emitEvent?.({
      type: 'subagent-progress',
      data: {
        type: 'action',
        workerApp: app,
        action: {
          type: 'switch_app',
          params: { app },
          description: `Switched focus to ${app}`,
        },
      },
    });

    return {
      success: true,
      output: `Switched active window to "${app}". Subsequent actions will target this app.`,
      data: { app, active: true },
    };
  },
};

export const listAppsTool: AgentTool = {
  name: 'list_apps',
  description:
    'List all installed applications on this worker desktop and check their current status.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  async execute(_args: Record<string, unknown>): Promise<ToolResult> {
    return {
      success: true,
      output:
        'Installed worker apps available on your desktop include: ' +
        'Files, Mail (Gmail/Webmail), Sheets (native EverFern spreadsheet with sheets_* tools), ' +
        'Google Sheets (opt-in only — use it only when the user explicitly asks for Google Sheets), ' +
        'Docs (Google Docs), Slides, Browser, Chrome, Web search, Terminal (Alpine Linux VM), ' +
        'Notion, Slack, LinkedIn, HubSpot, Salesforce, GitHub, Jira, and PDF. ' +
        'Use switch_app or open_app to focus any window; use worker_click/worker_type to drive native windows by pixel coordinates.',
      data: { status: 'ready' },
    };
  },
};

export const closeAppTool: AgentTool = {
  name: 'close_app',
  description: 'Minimize or close an application window on the worker desktop.',
  parameters: {
    type: 'object',
    properties: {
      app: {
        type: 'string',
        description: 'The app ID to close/minimize.',
      },
    },
    required: ['app'],
  },
  async execute(args: Record<string, unknown>, onUpdate?): Promise<ToolResult> {
    const app = String(args.app || '').trim().toLowerCase();
    onUpdate?.(`Minimized app "${app}"`);
    return {
      success: true,
      output: `App window "${app}" minimized.`,
      data: { app, closed: true },
    };
  },
};

// ── Sandboxed VM Workspace Tools (Isolated to ~/everfern-workers/<workerId>) ──

export const createWorkerBashTool = (runner: any): AgentTool => ({
  name: 'worker_bash',
  description:
    'Execute a shell command inside your assigned VM workspace (/workspace on VPS, ~/everfern-workers/<id> in Alpine). ' +
    'Use this for Python data analysis, jq JSON manipulation, file conversion, and scripting. ' +
    'Commands are strictly sandboxed to your worker workspace; host access is disabled.',
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The shell command to execute in your private workspace directory.',
      },
    },
    required: ['command'],
  },
  async execute(args: Record<string, unknown>, onUpdate?): Promise<ToolResult> {
    const rawCmd = String(args.command || '').trim();
    if (!rawCmd) {
      return { success: false, output: 'No command specified.' };
    }

    const workerId = getWorkerIdFromConversation(runner?.currentConversationId);
    if (!workerId) {
      return {
        success: false,
        output: 'Cannot execute worker_bash outside of an active worker session.',
      };
    }

    const ws = getWorkerWorkspace(workerId);
    const sandboxedCommand = `mkdir -p "${ws}" && cd "${ws}" && ${rawCmd}`;

    onUpdate?.(`Running command in worker workspace: ${rawCmd.slice(0, 80)}`);

    try {
      const cloud = workspaceDriver(String(runner?.currentConversationId));
      const res = cloud ? await cloud.workspace!({ action: 'exec', command: rawCmd }) : await runInLinuxVM(sandboxedCommand);
      const isSuccess = res.exitCode === 0;
      const combinedOutput = [res.stdout, res.stderr].filter(Boolean).join('\n').trim() || '(No output)';

      return {
        success: isSuccess,
        output: combinedOutput,
        data: { exitCode: res.exitCode, workspace: res.workspace || ws },
      };
    } catch (err: any) {
      return {
        success: false,
        output: `Command failed: ${err?.message || String(err)}`,
        error: String(err),
      };
    }
  },
});

export const createWorkerReadFileTool = (runner: any): AgentTool => ({
  name: 'worker_read_file',
  description:
    'Read the contents of a file inside your assigned VM workspace (/workspace on VPS, ~/everfern-workers/<id> in Alpine).',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Relative path of the file to read (e.g., "report.txt", "data/export.csv").',
      },
    },
    required: ['path'],
  },
  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const filePath = String(args.path || '').trim();
    if (!filePath || filePath.includes('..')) {
      return { success: false, output: 'Invalid file path. Path must be relative without ".." traversal.' };
    }

    const workerId = getWorkerIdFromConversation(runner?.currentConversationId);
    if (!workerId) {
      return { success: false, output: 'Cannot read worker file outside an active worker session.' };
    }

    const ws = getWorkerWorkspace(workerId);
    try {
      const cloud = workspaceDriver(String(runner?.currentConversationId));
      if (cloud) {
        const file = await cloud.workspace!({ action: 'read', path: filePath });
        const data = Buffer.from(file.data, 'base64');
        if (data.includes(0)) return { success: true, output: `Binary file: ${file.name} (${file.size} bytes). Use worker_upload_files to attach it to an app.` };
        return { success: true, output: data.toString('utf8').slice(0, 200000) };
      }
      const res = await runInLinuxVM(`cd "${ws}" && cat -- "${ws}/"${shellQuote(filePath)}`);
      if (res.exitCode !== 0) {
        return { success: false, output: `File not found or unreadable: ${res.stderr || 'error'}` };
      }
      return { success: true, output: res.stdout };
    } catch (err: any) {
      return { success: false, output: `Failed to read file: ${err?.message || err}` };
    }
  },
});

export const createWorkerWriteFileTool = (runner: any): AgentTool => ({
  name: 'worker_write_file',
  description:
    'Write text or data to a file inside your assigned VM workspace (/workspace on VPS, ~/everfern-workers/<id> in Alpine).',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Relative path of the file to write (e.g., "summary.md", "leads.csv").',
      },
      content: {
        type: 'string',
        description: 'Text content to write into the file.',
      },
    },
    required: ['path', 'content'],
  },
  async execute(args: Record<string, unknown>, onUpdate?): Promise<ToolResult> {
    const filePath = String(args.path || '').trim();
    const content = String(args.content || '');

    if (!filePath || filePath.includes('..')) {
      return { success: false, output: 'Invalid file path. Path must be relative without ".." traversal.' };
    }

    const workerId = getWorkerIdFromConversation(runner?.currentConversationId);
    if (!workerId) {
      return { success: false, output: 'Cannot write worker file outside an active worker session.' };
    }

    const ws = getWorkerWorkspace(workerId);
    onUpdate?.(`Writing file "${filePath}" in worker workspace`);

    try {
      const cloud = workspaceDriver(String(runner?.currentConversationId));
      if (cloud) {
        const result = await cloud.workspace!({ action: 'write', path: filePath, content });
        return { success: true, output: `Saved ${result.path} (${result.size} bytes) in Files.` };
      }
      const b64 = Buffer.from(content, 'utf-8').toString('base64');
      const res = await runInLinuxVM(
        `mkdir -p "${ws}/"${shellQuote(path.posix.dirname(filePath))} && echo "${b64}" | base64 -d > "${ws}/"${shellQuote(filePath)}`
      );
      if (res.exitCode !== 0) {
        return { success: false, output: `Write failed: ${res.stderr || 'error'}` };
      }
      return { success: true, output: `Successfully wrote file: ${filePath} (${content.length} characters).` };
    } catch (err: any) {
      return { success: false, output: `Failed to write file: ${err?.message || err}` };
    }
  },
});

export const createWorkerListFilesTool = (runner: any): AgentTool => ({
  name: 'worker_list_files',
  description:
    'List files and directories inside your assigned VM workspace (/workspace on VPS, ~/everfern-workers/<id> in Alpine).',
  parameters: {
    type: 'object',
    properties: {
      subpath: {
        type: 'string',
        description: 'Optional relative subfolder to list (default: root workspace).',
      },
    },
    required: [],
  },
  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const subpath = String(args.subpath || '').trim();
    if (subpath.includes('..')) {
      return { success: false, output: 'Invalid subpath. Path must not contain ".." traversal.' };
    }

    const workerId = getWorkerIdFromConversation(runner?.currentConversationId);
    if (!workerId) {
      return { success: false, output: 'Cannot list files outside an active worker session.' };
    }

    const ws = getWorkerWorkspace(workerId);
    const targetDir = subpath ? `"${ws}/"${shellQuote(subpath)}` : `"${ws}"`;

    try {
      const cloud = workspaceDriver(String(runner?.currentConversationId));
      if (cloud) {
        const result = await cloud.workspace!({ action: 'list', path: subpath || '.' });
        return { success: true, output: result.files.map((file: any) => file.name + (file.directory ? '/' : '')).join('\n') || '(Workspace is empty)', data: result };
      }
      const res = await runInLinuxVM(
        `mkdir -p ${targetDir} && cd ${targetDir} && ls -1Ap --group-directories-first 2>/dev/null | head -100`
      );
      if (res.exitCode !== 0) {
        return { success: false, output: `Directory listing failed: ${res.stderr || 'error'}` };
      }
      const files = res.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
      return {
        success: true,
        output: files.length > 0 ? files.join('\n') : '(Workspace is currently empty)',
        data: { files, path: `~/everfern-workers/${workerId}/${subpath}` },
      };
    } catch (err: any) {
      return { success: false, output: `Failed to list files: ${err?.message || err}` };
    }
  },
});


export const createWorkerUploadFilesTool = (runner: any): AgentTool => ({
  name: 'worker_upload_files',
  description: 'Attach files from this worker Files/Downloads to a file input in one of its cloud apps. Open the upload form first. This selects files; verify the app result before claiming submission.',
  parameters: { type: 'object', properties: { app: { type: 'string', description: 'Installed app ID, such as moss or gmail.' }, paths: { type: 'array', items: { type: 'string' }, description: 'Workspace-relative paths, e.g. Downloads/invoice.pdf.' }, selector: { type: 'string', description: 'Optional CSS selector of the file input.' } }, required: ['app', 'paths'] },
  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const conversationId = String(runner?.currentConversationId || '');
    if (!getWorkerIdFromConversation(conversationId)) return { success: false, output: 'A worker session is required.' };
    const paths = args.paths;
    if (!Array.isArray(paths) || !paths.length || paths.length > 10 || !paths.every(value => typeof value === 'string' && value && !value.split(/[\\/]/).includes('..'))) return { success: false, output: 'Provide 1-10 paths inside this worker workspace.' };
    const target = pickWorkerWindow(conversationId, undefined, String(args.app || ''));
    if (!target?.driver.uploadFiles) return { success: false, output: 'Open this worker cloud app before attaching files.' };
    try {
      const result = await target.driver.uploadFiles(paths as string[], typeof args.selector === 'string' ? args.selector : undefined);
      return { success: true, output: `Selected ${result.uploaded} file(s) in ${target.app}. Check the app to finish or confirm the upload.`, data: result };
    } catch (error: any) { return { success: false, output: error.message || String(error) }; }
  },
});
