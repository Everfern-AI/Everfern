/**
 * EverFern Desktop — Worker Tools
 *
 * Provides dedicated OS and workspace primitives for AI Workers:
 * 1. App Lifecycle: open_app, switch_app, list_apps, close_app
 * 2. Sandboxed VM Execution: worker_bash, worker_read_file, worker_write_file, worker_list_files
 *
 * Local workers run every command and file transfer through worker-sandbox.ts: in the
 * worker VM (never the host), as the worker's own Linux user, whose home is its
 * workspace (/root/everfern-workers/<workerId>, mode 700). Cloud workers use their VM.
 */

import { app as electronApp, BrowserWindow, session as electronSession } from 'electron';
import { readFileSync, mkdirSync, promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { AgentTool, ToolResult } from '../runner/types';
import { pickWorkerWindow, baseWorkerKey, workerWindowApps, closeWorkerWindow } from './navis/core/webview-registry';
import { runAsWorker, spawnAsWorker, pipeIntoWorkspace, pipeOutOfWorkspace, stageForVmBrowser, workerHome, shq } from './worker-sandbox';

const safeId = (id: unknown): string | null =>
  typeof id === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(id) ? id : null;

export const getWorkerIdFromConversation = (conversationId?: string): string | null => {
  if (!conversationId || typeof conversationId !== 'string') return null;
  const key = baseWorkerKey(conversationId);
  if (!key) return null;
  return safeId(key.slice('worker-'.length));
};

const getWorkerWorkspace = (workerId: string): string => workerHome(workerId);

/** The worker's saved record (apps, machine) from workers.json, or null. */
function savedWorker(conversationId: string): any | null {
  try {
    const key = baseWorkerKey(conversationId) ?? conversationId;
    const raw = JSON.parse(readFileSync(path.join(electronApp.getPath('userData'), 'workers.json'), 'utf8'));
    const list = Array.isArray(raw) ? raw : Array.isArray(raw?.workers) ? raw.workers : [];
    return list.find((worker: any) => 'worker-' + worker?.id === key) ?? null;
  } catch { return null; }
}

/** The worker's app ids (the apps it was given), plus the built-in ones every worker has. */
const BUILT_IN_APPS = ['files', 'terminal', 'browser', 'chrome', 'websearch', 'sheets'];
function installedApps(conversationId: string): string[] {
  const apps = savedWorker(conversationId)?.apps;
  const mine = Array.isArray(apps) ? apps.filter((a: unknown): a is string => typeof a === 'string').map((a: string) => a.toLowerCase()) : [];
  return [...new Set([...mine, ...BUILT_IN_APPS])];
}

/** Lines of a listing, with a note when there were more than were shown. */
function capped(lines: string[], max: number): string[] {
  return lines.length > max ? [...lines.slice(0, max), `(${lines.length - max} more not shown)`] : lines;
}

// ── App Lifecycle Tools ──────────────────────────────────────────────

function workspaceDriver(conversationId: string) {
  const target = pickWorkerWindow(conversationId);
  if (target?.driver.workspace) return target.driver;
  if (target) return null; // A registered Alpine browser belongs to this local worker.
  // Workers saved before the machine choice existed run on this computer, as the UI shows them.
  const machine = savedWorker(conversationId)?.machine;
  if (machine === 'local' || !machine) return null;
  throw new Error('Worker VM is unavailable. Open its assigned VM app and retry; local fallback is disabled.');
}
const shellQuote = shq;

/** "app" from a tool call, checked against the worker's own apps. */
function pickApp(args: Record<string, unknown>, runner: any): { app: string } | { error: string } {
  const app = String(args.app || '').trim().toLowerCase();
  if (!app) return { error: 'No app ID specified.' };
  const conversationId = String(runner?.currentConversationId || '');
  if (!baseWorkerKey(conversationId)) return { error: 'App tools only work inside a worker session.' };
  const apps = installedApps(conversationId);
  if (!apps.includes(app)) return { error: `"${app}" is not one of this worker's apps. Its apps are: ${apps.join(', ')}.` };
  return { app };
}

export const createOpenAppTool = (runner: any): AgentTool => ({
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
    const picked = pickApp(args, runner);
    if ('error' in picked) return { success: false, output: picked.error };
    const { app } = picked;
    const url = typeof args.url === 'string' && /^https?:\/\//i.test(args.url.trim()) ? args.url.trim() : undefined;
    if (!emitEvent) return { success: false, output: 'The worker desktop is not connected, so the window cannot be opened.' };

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
      output: `Asked the desktop to open "${app}"${url ? ` at ${url}` : ''}. Check the window (navis or a screenshot) before relying on it.`,
      data: { app, url, requested: true },
    };
  },
});

export const createSwitchAppTool = (runner: any): AgentTool => ({
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
    const picked = pickApp(args, runner);
    if ('error' in picked) return { success: false, output: picked.error };
    const { app } = picked;
    if (!emitEvent) return { success: false, output: 'The worker desktop is not connected, so the window cannot be focused.' };

    onUpdate?.(`Switching to "${app}"`);

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

    const open = workerWindowApps(String(runner?.currentConversationId || ''));
    return {
      success: true,
      output: open.includes(app)
        ? `Brought "${app}" to the front.`
        : `Asked the desktop to bring up "${app}"; its window was not open yet, so it opens now. Check it before acting on it.`,
      data: { app, wasOpen: open.includes(app) },
    };
  },
});

export const createListAppsTool = (runner: any): AgentTool => ({
  name: 'list_apps',
  description:
    'List all installed applications on this worker desktop and check their current status.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  async execute(): Promise<ToolResult> {
    const conversationId = String(runner?.currentConversationId || '');
    if (!baseWorkerKey(conversationId)) return { success: false, output: 'list_apps only works inside a worker session.' };
    const apps = installedApps(conversationId);
    const open = new Set(workerWindowApps(conversationId));
    return {
      success: true,
      output: `This worker's apps: ${apps.map((a) => (open.has(a) ? `${a} (open)` : a)).join(', ')}. ` +
        'Use open_app or switch_app to bring one forward. "sheets" is the native EverFern spreadsheet (sheets_* tools).',
      data: { apps, open: [...open] },
    };
  },
});

export const createCloseAppTool = (runner: any): AgentTool => ({
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
  async execute(args: Record<string, unknown>, onUpdate?, emitEvent?): Promise<ToolResult> {
    const picked = pickApp(args, runner);
    if ('error' in picked) return { success: false, output: picked.error };
    const { app } = picked;
    const conversationId = String(runner?.currentConversationId || '');
    if (!workerWindowApps(conversationId).includes(app)) return { success: true, output: `"${app}" was not open.`, data: { app, closed: false } };
    if (!emitEvent) return { success: false, output: 'The worker desktop is not connected, so the window cannot be closed.' };
    onUpdate?.(`Closing "${app}"`);
    emitEvent({ type: 'subagent-progress', data: { type: 'action', workerApp: app, action: { type: 'close_app', params: { app }, description: `Closed ${app}` } } });
    closeWorkerWindow(conversationId, app);
    return { success: true, output: `Closed "${app}".`, data: { app, closed: true } };
  },
});

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

    onUpdate?.(`Running command in worker workspace: ${rawCmd.slice(0, 80)}`);

    try {
      const cloud = workspaceDriver(String(runner?.currentConversationId));
      const res = cloud ? await cloud.workspace!({ action: 'exec', command: rawCmd }) : await runAsWorker(workerId, rawCmd);
      notifyFilesChanged(workerId);
      const isSuccess = res.exitCode === 0;
      const combinedOutput = [res.stdout, res.stderr].filter(Boolean).join('\n').trim() || '(No output)';
      const cut = /\[Output truncated\]/.test(combinedOutput)
        ? '\n(The output was cut because it was very long. Write it to a file and read parts of it.)' : '';

      return {
        success: isSuccess,
        output: combinedOutput + cut,
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
    const filePath = cleanRelPath(args.path);
    if (!filePath) {
      return { success: false, output: 'Invalid file path. Use a path inside the workspace, without "..".' };
    }

    const workerId = getWorkerIdFromConversation(runner?.currentConversationId);
    if (!workerId) {
      return { success: false, output: 'Cannot read worker file outside an active worker session.' };
    }

    try {
      const cloud = workspaceDriver(String(runner?.currentConversationId));
      if (cloud) {
        const file = await cloud.workspace!({ action: 'read', path: filePath });
        const data = Buffer.from(file.data, 'base64');
        if (data.includes(0)) return { success: true, output: `Binary file: ${file.name} (${file.size} bytes). Use worker_upload_files to attach it to an app.` };
        const text = data.toString('utf8');
        return { success: true, output: text.length > 200000 ? `${text.slice(0, 200000)}\n(File continues: ${text.length - 200000} more characters not shown.)` : text };
      }
      const file = await workspaceRead(workerId, filePath);
      if (file.error) return { success: false, output: `File not found or unreadable: ${file.error}` };
      if (file.binary) return { success: true, output: `Binary file: ${filePath} (${file.size} bytes, ${file.mime}). Use worker_upload_files to attach it to an app.` };
      const more = file.size && file.content !== undefined && file.size > Buffer.byteLength(file.content) ? `\n(File continues: only the first 200,000 bytes of ${file.size} are shown.)` : '';
      return { success: true, output: (file.content ?? '') + more };
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
    const filePath = cleanRelPath(args.path);
    const content = String(args.content || '');

    if (!filePath) {
      return { success: false, output: 'Invalid file path. Use a path inside the workspace, without "..".' };
    }

    const workerId = getWorkerIdFromConversation(runner?.currentConversationId);
    if (!workerId) {
      return { success: false, output: 'Cannot write worker file outside an active worker session.' };
    }

    onUpdate?.(`Writing file "${filePath}" in worker workspace`);

    try {
      const cloud = workspaceDriver(String(runner?.currentConversationId));
      if (cloud) {
        const result = await cloud.workspace!({ action: 'write', path: filePath, content });
        notifyFilesChanged(workerId);
        return { success: true, output: `Saved ${result.path} (${result.size} bytes) in Files.` };
      }
      const res = await workspaceWriteBytes(workerId, filePath, Buffer.from(content, 'utf-8'));
      if (!res.ok) {
        return { success: false, output: `Write failed: ${res.error || 'error'}` };
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
    const subpath = cleanRelPath(args.subpath ?? '');
    if (subpath === null) {
      return { success: false, output: 'Invalid subpath. Use a folder inside the workspace, without "..".' };
    }

    const workerId = getWorkerIdFromConversation(runner?.currentConversationId);
    if (!workerId) {
      return { success: false, output: 'Cannot list files outside an active worker session.' };
    }

    try {
      const cloud = workspaceDriver(String(runner?.currentConversationId));
      if (cloud) {
        const result = await cloud.workspace!({ action: 'list', path: subpath || '.' });
        return { success: true, output: capped(result.files.map((file: any) => file.name + (file.directory ? '/' : '')), 300).join('\n') || '(Workspace is empty)', data: result };
      }
      const res = await workspaceList(workerId, subpath);
      if (res.error) {
        return { success: false, output: `Directory listing failed: ${res.error}` };
      }
      const lines = res.more ? [...res.files, `(${res.more} more not shown)`] : res.files;
      return {
        success: true,
        output: lines.length > 0 ? lines.join('\n') : '(Folder is empty)',
        data: { files: res.files, more: res.more ?? 0, path: `${getWorkerWorkspace(workerId)}${subpath ? '/' + subpath : ''}` },
      };
    } catch (err: any) {
      return { success: false, output: `Failed to list files: ${err?.message || err}` };
    }
  },
});


export const createWorkerUploadFilesTool = (runner: any): AgentTool => ({
  name: 'worker_upload_files',
  description: 'Attach files from this worker\'s Files (its shared workspace) to a file input in one of its apps. ' +
    'Every app shares that workspace: a file downloaded in any app lands in Downloads/, and anything you write with worker_write_file or worker_bash is there too, ' +
    'so to move a file from app A to app B: download it in A (or write it), check it with worker_list_files subpath "Downloads", then open B\'s upload form and call this. ' +
    'This selects files; verify the app result before claiming submission.',
  parameters: { type: 'object', properties: { app: { type: 'string', description: 'Installed app ID, such as moss or gmail.' }, paths: { type: 'array', items: { type: 'string' }, description: 'Workspace-relative paths, e.g. Downloads/invoice.pdf.' }, selector: { type: 'string', description: 'Optional ref or CSS selector of the file input.' } }, required: ['app', 'paths'] },
  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const conversationId = String(runner?.currentConversationId || '');
    if (!getWorkerIdFromConversation(conversationId)) return { success: false, output: 'A worker session is required.' };
    const paths = args.paths;
    if (!Array.isArray(paths) || !paths.length || paths.length > 10 || !paths.every(value => typeof value === 'string' && Boolean(cleanRelPath(value)))) return { success: false, output: 'Provide 1-10 paths inside this worker workspace.' };
    const target = pickWorkerWindow(conversationId, undefined, String(args.app || ''));
    if (!target?.driver.uploadFiles) return { success: false, output: 'Open this app\'s window before attaching files.' };
    const workerId = getWorkerIdFromConversation(conversationId)!;
    try {
      // The cloud VM resolves workspace paths itself; a window on this computer needs real paths
      // (inside the Alpine VM for its browser, on this computer for a webview).
      const clean = (paths as string[]).map((p) => cleanRelPath(p) ?? '');
      if (clean.some((p) => !p)) return { success: false, output: 'Provide paths inside this worker workspace.' };
      const real = target.driver.workspace ? clean
        : target.driver.uploadFrom === 'vm' ? await Promise.all(clean.map((p) => stageForVmBrowser(workerId, p)))
        : await Promise.all(clean.map((p) => copyOutOfWorkspace(workerId, p)));
      const result = await target.driver.uploadFiles(real, typeof args.selector === 'string' ? args.selector : undefined);
      return { success: true, output: `Selected ${result.uploaded} file(s) in ${target.app}. Check the app to finish or confirm the upload.`, data: result };
    } catch (error: any) { return { success: false, output: error.message || String(error) }; }
  },
});

/* ── Shared workspace access for the native Files and Terminal apps ──────────
 * One path for the renderer's IPC and the AI-native tools: the cloud VM's
 * workspace when this worker runs on EverFern Cloud, else the local Linux VM. */

export type WorkspaceExec = { stdout: string; stderr: string; exitCode: number };

export const workspaceDir = (workerId: string) => getWorkerWorkspace(workerId);
export const quoteShell = shellQuote;

/** "a/b/../c" and absolute paths are refused; returns the clean relative path or null. */
export function cleanRelPath(p: unknown): string | null {
  if (typeof p !== 'string') return null;
  const clean = p.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').replace(/\/{2,}/g, '/');
  if (clean.split('/').some((seg) => seg === '..')) return null;
  return clean;
}

/** True when this worker's workspace is its cloud VM (a window registered it); throws if neither VM is reachable. */
export function workspaceIsCloud(workerId: string): boolean {
  return Boolean(workspaceDriver(`worker-${workerId}`));
}

export async function workspaceExec(workerId: string, command: string): Promise<WorkspaceExec> {
  const cloud = workspaceDriver(`worker-${workerId}`);
  if (cloud) {
    const r = await cloud.workspace!({ action: 'exec', command });
    return { stdout: String(r?.stdout ?? ''), stderr: String(r?.stderr ?? ''), exitCode: Number(r?.exitCode ?? 0) };
  }
  return runAsWorker(workerId, command);
}

const LIST_MAX = 300;

/** A folder's entries, folders first; `more` counts entries past the first 300. */
export async function workspaceList(workerId: string, sub: string): Promise<{ files: string[]; more?: number; error?: string }> {
  const cloud = workspaceDriver(`worker-${workerId}`);
  if (cloud) {
    const r = await cloud.workspace!({ action: 'list', path: sub || '.' });
    const files = (r?.files ?? []) as { name: string; directory?: boolean }[];
    const dirs = files.filter((f) => f.directory).map((f) => f.name + '/');
    const plain = files.filter((f) => !f.directory).map((f) => f.name);
    const all = [...dirs.sort(), ...plain.sort()];
    return { files: all.slice(0, LIST_MAX), more: Math.max(0, all.length - LIST_MAX) };
  }
  const dir = sub ? shellQuote(sub) : '.';
  const r = await runAsWorker(workerId, `cd -- ${dir} 2>/dev/null || { echo 'Folder not found' >&2; exit 1; }; ls -1Ap --group-directories-first 2>/dev/null | awk 'NR<=${LIST_MAX}{print} END{if(NR>${LIST_MAX}) print "#more " NR-${LIST_MAX}}'`);
  if (r.exitCode !== 0) return { files: [], error: r.stderr.trim() || 'Folder not found' };
  const lines = r.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  const tail = lines[lines.length - 1]?.match(/^#more (\d+)$/);
  return { files: tail ? lines.slice(0, -1) : lines, more: tail ? Number(tail[1]) : 0 };
}

/* ── Binary-safe file transfer between this computer and the workspace ──
 * Bytes are piped through `cat` running as the worker in the VM (worker-sandbox.ts),
 * so there is no command-line or stdout size cap, and a symlink in the workspace can
 * only reach what the worker itself may read. */

const MAX_FILE_BYTES = 200 * 1024 * 1024;
const PREVIEW_BYTES = 15 * 1024 * 1024;

/** This worker's scratch folder on this computer (created synchronously, so it is ready at once). */
export const hostScratchDir = (workerId: string) => {
  const dir = path.join(os.tmpdir(), 'everfern-worker-files', workerId);
  mkdirSync(dir, { recursive: true });
  return dir;
};
const hostScratch = async (workerId: string) => hostScratchDir(workerId);

/** Copies a workspace file to this computer; returns its path here. */
export async function copyOutOfWorkspace(workerId: string, rel: string): Promise<string> {
  const dir = await hostScratch(workerId);
  const out = path.join(dir, `${Date.now().toString(36)}-${path.posix.basename(rel).replace(/[^\w.\- ]+/g, '_')}`);
  const cloud = workspaceDriver(`worker-${workerId}`);
  if (cloud) {
    const file = await cloud.workspace!({ action: 'read', path: rel });
    await fsp.writeFile(out, Buffer.from(String(file?.data ?? ''), 'base64'));
    return out;
  }
  const clean = cleanRelPath(rel);
  if (!clean) throw new Error('Invalid path');
  try {
    await pipeOutOfWorkspace(workerId, clean, out, MAX_FILE_BYTES);
  } catch (e) {
    void fsp.rm(out, { force: true }).catch(() => undefined);
    throw e;
  }
  return out;
}

/** Copies a file on this computer into the workspace at `rel` (folders are created). */
export async function copyIntoWorkspace(workerId: string, hostPath: string, rel: string): Promise<void> {
  const cloud = workspaceDriver(`worker-${workerId}`);
  if (cloud) {
    const data = await fsp.readFile(hostPath);
    await cloud.workspace!({ action: 'write', path: rel, data: data.toString('base64') });
    return;
  }
  const clean = cleanRelPath(rel);
  if (!clean) throw new Error('Invalid path');
  await pipeIntoWorkspace(workerId, hostPath, clean);
}

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon',
  pdf: 'application/pdf', zip: 'application/zip', mp3: 'audio/mpeg', wav: 'audio/wav', mp4: 'video/mp4', webm: 'video/webm',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};
export const mimeOf = (name: string) => MIME[path.posix.extname(name).slice(1).toLowerCase()] ?? 'application/octet-stream';

/** Text is valid UTF-8 with no NUL bytes. */
function looksBinary(buf: Buffer): boolean {
  const head = buf.subarray(0, 8192);
  if (head.includes(0)) return true;
  return Buffer.from(head.toString('utf8'), 'utf8').length !== head.length && !head.toString('utf8').endsWith('�');
}

export type WorkspaceFile = { content?: string; binary?: boolean; size?: number; mime?: string; dataUrl?: string; error?: string };

/** A workspace file for Files and the AI: text as text; binary with its type, size and (images, PDFs) a preview. */
export async function workspaceRead(workerId: string, rel: string): Promise<WorkspaceFile> {
  let host: string | null = null;
  try {
    host = await copyOutOfWorkspace(workerId, rel);
    const st = await fsp.stat(host);
    if (st.size > MAX_FILE_BYTES) return { binary: true, size: st.size, mime: mimeOf(rel), error: 'File is too large to open here.' };
    const buf = await fsp.readFile(host);
    const mime = mimeOf(rel);
    const binary = looksBinary(buf) || /^(image\/(?!svg)|audio\/|video\/|application\/(pdf|zip|vnd))/.test(mime);
    if (!binary) return { content: buf.subarray(0, 200000).toString('utf8'), size: buf.length, mime };
    const previewable = /^(image\/|application\/pdf)/.test(mime) && buf.length <= PREVIEW_BYTES;
    return { binary: true, size: buf.length, mime, dataUrl: previewable ? `data:${mime};base64,${buf.toString('base64')}` : undefined };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  } finally {
    if (host) void fsp.rm(host, { force: true }).catch(() => undefined);
  }
}

/** Writes bytes into the workspace, any size, any content. */
export async function workspaceWriteBytes(workerId: string, rel: string, data: Buffer): Promise<{ ok: boolean; error?: string }> {
  const dir = await hostScratch(workerId);
  const tmp = path.join(dir, `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
  try {
    await fsp.writeFile(tmp, data);
    await copyIntoWorkspace(workerId, tmp, rel);
    notifyFilesChanged(workerId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    void fsp.rm(tmp, { force: true }).catch(() => undefined);
  }
}

export async function workspaceWrite(workerId: string, rel: string, content: string): Promise<{ ok: boolean; error?: string }> {
  return workspaceWriteBytes(workerId, rel, Buffer.from(content, 'utf-8'));
}

/* ── Live Files: change notifications ──
 * Files reloads the moment its folder changes instead of every few seconds. On this
 * computer one long-lived process in the VM checks the folder's listing (names,
 * sizes, times) twice a second and prints a line when it changes, so no new
 * wsl.exe is spawned per check; on a cloud VM main checks over the API every 2 s.
 * Every workspace write in this file (AI tools, downloads, uploads) also announces
 * itself straight away. */

export function notifyFilesChanged(workerId: string, subpath?: string): void {
  for (const win of BrowserWindow.getAllWindows()) {
    try { win.webContents.send('worker:files-changed', { workerId, subpath }); } catch { /* closing */ }
  }
}

type Watch = { sub: string; stop: () => void };
const watches = new Map<string, Watch>();

export function unwatchWorkspace(workerId: string): void {
  watches.get(workerId)?.stop();
  watches.delete(workerId);
}
export function unwatchAllWorkspaces(): void {
  for (const id of [...watches.keys()]) unwatchWorkspace(id);
}

/** Watches one folder of a worker's workspace (the one Files shows); replaces any earlier watch for it. */
export async function watchWorkspace(workerId: string, sub: string): Promise<void> {
  const cur = watches.get(workerId);
  if (cur && cur.sub === sub) return;
  unwatchWorkspace(workerId);
  let stopped = false;
  const watch: Watch = { sub, stop: () => { stopped = true; } };
  watches.set(workerId, watch);

  // `stat` over the folder's entries, hashed: the same on BusyBox and GNU.
  const sig = `stat -c '%n|%s|%Y' -- * .[!.]* 2>/dev/null | md5sum`;
  const cloud = workspaceDriver(`worker-${workerId}`);
  if (cloud) {
    let last = '';
    const tick = async () => {
      if (stopped) return;
      try {
        const r = await cloud.workspace!({ action: 'exec', command: `cd ${sub ? shellQuote(sub) : '.'} 2>/dev/null && ${sig}` });
        const now = String(r?.stdout ?? '').trim();
        if (last && now && now !== last) notifyFilesChanged(workerId, sub);
        if (now) last = now;
      } catch { /* the next tick tries again */ }
      if (!stopped) setTimeout(tick, 2000).unref?.();
    };
    void tick();
    return;
  }

  const dir = sub ? shellQuote(sub) : '.';
  // Prints C on a change and a heartbeat every ~10 s; once main stops reading, the
  // heartbeat's write fails and the loop ends by itself even if the kill is missed.
  const loop = `cd ${dir} 2>/dev/null || exit 0; last=""; n=0; while :; do s=$(${sig}); ` +
    `if [ "$s" != "$last" ]; then [ -n "$last" ] && echo C; last="$s"; fi; ` +
    `n=$((n+1)); [ $((n % 20)) -eq 0 ] && { echo . || exit 0; }; sleep 0.5; done`;
  try {
    const proc = await spawnAsWorker(workerId, loop);
    if (stopped) { proc.kill(); return; }
    watch.stop = () => { stopped = true; try { proc.kill(); } catch { /* gone */ } };
    proc.stdout.on('data', (d: Buffer) => { if (!stopped && d.toString().includes('C')) notifyFilesChanged(workerId, sub); });
    proc.on('close', () => { if (watches.get(workerId) === watch) watches.delete(workerId); });
  } catch {
    if (watches.get(workerId) === watch) watches.delete(workerId);
  }
}

/* ── Downloads from any of the worker's windows land in its Files ── */

const downloadSessions = new Set<string>();

/**
 * A worker webview's downloads (partition "persist:worker-<id>") are saved on this
 * computer, then copied into the workspace's Downloads/, the folder every app and the
 * AI share, so a file downloaded in one app can be uploaded in another.
 */
export function routeDownloadsToWorkspace(partition: string): void {
  const m = partition.match(/^persist:worker-([A-Za-z0-9-]{1,64})$/);
  if (!m || downloadSessions.has(partition)) return;
  downloadSessions.add(partition);
  const workerId = m[1];
  electronSession.fromPartition(partition).on('will-download', (_e, item) => {
    const name = (item.getFilename() || 'download').replace(/[\\/:*?"<>|]+/g, '_').replace(/^\.+/, '_').slice(0, 180) || 'download';
    // The save path must be set before this handler returns, or Electron asks the user where to save.
    let tmp: string;
    try {
      tmp = path.join(hostScratchDir(workerId), `dl-${Date.now().toString(36)}-${name}`);
      item.setSavePath(tmp);
    } catch (err: any) {
      console.warn('[Files] download could not be routed to the workspace:', err?.message || err);
      return;
    }
    item.once('done', (_ev, state) => {
      if (state !== 'completed') { void fsp.rm(tmp, { force: true }).catch(() => undefined); return; }
      void (async () => {
        const rel = await freeDownloadName(workerId, name);
        await copyIntoWorkspace(workerId, tmp, rel);
        notifyFilesChanged(workerId, 'Downloads');
      })().catch((err) => console.warn('[Files] download copy failed:', err?.message || err))
        .finally(() => void fsp.rm(tmp, { force: true }).catch(() => undefined));
    });
  });
}

/** "Downloads/report.pdf", or "Downloads/report (2).pdf" when that name is taken. */
async function freeDownloadName(workerId: string, name: string): Promise<string> {
  try {
    const { files } = await workspaceList(workerId, 'Downloads');
    const taken = new Set(files.map((f) => f.replace(/\/$/, '')));
    if (!taken.has(name)) return `Downloads/${name}`;
    const ext = path.posix.extname(name), base = name.slice(0, name.length - ext.length);
    for (let i = 2; i < 1000; i++) if (!taken.has(`${base} (${i})${ext}`)) return `Downloads/${base} (${i})${ext}`;
  } catch { /* fall through */ }
  return `Downloads/${Date.now()}-${name}`;
}
