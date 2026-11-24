/**
 * AI-native Files and Terminal.
 *
 * The AI names what it wants ("create folder Reports", "run ls -la"); no pixel
 * coordinates. The op runs in the worker's workspace first, so the result the AI
 * gets is real, then the renderer replays it in the visible app at a human pace:
 * the cursor right-clicks, picks "New Folder", types the name, presses Return;
 * or clicks the prompt and types the command before its output appears.
 */

import { BrowserWindow } from 'electron';
import type { AgentTool, ToolResult } from '../runner/types';
import {
  getWorkerIdFromConversation,
  cleanRelPath,
  quoteShell,
  workspaceExec,
  workspaceWrite,
  workspaceRead,
} from './worker-tools';

function broadcast(channel: string, payload: unknown, delayMs = 0): void {
  const send = () => {
    for (const win of BrowserWindow.getAllWindows()) {
      try { win.webContents.send(channel, payload); } catch { /* window closing */ }
    }
  };
  if (delayMs > 0) setTimeout(send, delayMs);
  else send();
}

function emitAction(emitEvent: any, app: string, description: string): void {
  emitEvent?.({
    type: 'subagent-progress',
    data: { type: 'action', workerApp: app, action: { type: 'ui', params: { app }, description } },
  });
}

/** Roughly how long the renderer's replay takes, so the next op does not pile on top of it. */
const replayMs = (typed: number) => Math.min(6000, 1300 + Math.min(typed, 360) * 32);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let seq = 0;
const nextId = () => `${Date.now().toString(36)}-${(seq++).toString(36)}`;

const noWorker = (): ToolResult => ({ success: false, output: 'A worker session is required to use the native Files and Terminal apps.' });
const fail = (e: unknown) => (e instanceof Error ? e.message : String(e));

const FILE_ACTIONS = ['create_folder', 'create_file', 'write_file', 'rename', 'move_to_trash', 'open'] as const;
type FileAction = (typeof FILE_ACTIONS)[number];

export const createFilesActionTool = (runner: any): AgentTool => ({
  name: 'files_action',
  description:
    'Operate the native EverFern Files app (a Finder-style window over the worker workspace) by name, never by coordinates. ' +
    'The change is made immediately and the user watches the cursor do it in the Files window: right-click, New Folder, ' +
    'type the name, Return; or open a file and type its text. Paths are relative to the workspace home, e.g. "Documents/q3.md". ' +
    'Actions: create_folder (path), create_file (path, optional content), write_file (path, content; replaces the text), ' +
    'rename (path, to: new name or new relative path), move_to_trash (path), open (path: shows a folder or a file).',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: [...FILE_ACTIONS], description: 'What to do.' },
      path: { type: 'string', description: 'Relative path of the file or folder, e.g. "Documents/Reports".' },
      to: { type: 'string', description: 'rename only: the new name (same folder) or a new relative path.' },
      content: { type: 'string', description: 'create_file / write_file: the text to put in the file.' },
    },
    required: ['action', 'path'],
  },
  async execute(args: Record<string, unknown>, onUpdate?, emitEvent?): Promise<ToolResult> {
    const workerId = getWorkerIdFromConversation(runner?.currentConversationId);
    if (!workerId) return noWorker();
    const action = String(args.action || '') as FileAction;
    if (!FILE_ACTIONS.includes(action)) return { success: false, output: `Unknown action. Use one of: ${FILE_ACTIONS.join(', ')}.` };
    const rel = cleanRelPath(args.path);
    if (!rel) return { success: false, output: 'Give a relative path inside the workspace (no "..").' };
    const name = rel.split('/').pop()!;
    const parent = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
    const content = typeof args.content === 'string' ? args.content : '';
    let to: string | null = null;
    if (action === 'rename') {
      const raw = String(args.to ?? '').trim();
      to = raw.includes('/') ? cleanRelPath(raw) : raw && !/[\\/]/.test(raw) ? (parent ? `${parent}/${raw}` : raw) : null;
      if (!to) return { success: false, output: 'rename needs "to": a new name or a relative path.' };
    }

    const label: Record<FileAction, string> = {
      create_folder: `Creating folder ${name}`,
      create_file: `Creating file ${name}`,
      write_file: `Writing ${name}`,
      rename: `Renaming ${name}`,
      move_to_trash: `Moving ${name} to Trash`,
      open: `Opening ${name}`,
    };
    onUpdate?.(label[action]);
    emitAction(emitEvent, 'files', label[action]);

    let output = '';
    try {
      if (action === 'create_folder') {
        const r = await workspaceExec(workerId, `mkdir -p -- ${quoteShell(rel)}`);
        if (r.exitCode !== 0) return { success: false, output: r.stderr || 'Could not create the folder.' };
        output = `Created folder ${rel}.`;
      } else if (action === 'create_file' || action === 'write_file') {
        if (action === 'create_file') {
          const exists = await workspaceExec(workerId, `test -e ${quoteShell(rel)} && echo yes || true`);
          if (exists.stdout.trim() === 'yes') return { success: false, output: `${rel} already exists. Use write_file to replace its text.` };
        }
        const r = await workspaceWrite(workerId, rel, content);
        if (!r.ok) return { success: false, output: r.error || 'Could not write the file.' };
        output = `${action === 'create_file' ? 'Created' : 'Wrote'} ${rel} (${content.length} characters).`;
      } else if (action === 'rename') {
        const r = await workspaceExec(workerId, `test -e ${quoteShell(rel)} && test ! -e ${quoteShell(to!)} && mkdir -p -- "$(dirname -- ${quoteShell(to!)})" && mv -- ${quoteShell(rel)} ${quoteShell(to!)}`);
        if (r.exitCode !== 0) return { success: false, output: r.stderr || `Could not rename ${rel} (missing, or ${to} already exists).` };
        output = `Renamed ${rel} to ${to}.`;
      } else if (action === 'move_to_trash') {
        const dest = `.Trash/${name}`;
        const r = await workspaceExec(workerId, `test -e ${quoteShell(rel)} && mkdir -p .Trash && d=${quoteShell(dest)} && { test -e "$d" && d="$d.$(date +%s)"; mv -- ${quoteShell(rel)} "$d"; }`);
        if (r.exitCode !== 0) return { success: false, output: r.stderr || `${rel} was not found.` };
        output = `Moved ${rel} to Trash.`;
      } else {
        const r = await workspaceExec(workerId, `if test -d ${quoteShell(rel)}; then echo dir; elif test -f ${quoteShell(rel)}; then echo file; fi`);
        const kind = r.stdout.trim();
        if (!kind) return { success: false, output: `${rel} was not found.` };
        if (kind === 'file') {
          const f = await workspaceRead(workerId, rel);
          output = f.error ? `Opened ${rel}: ${f.error}` : `Opened ${rel}:\n${(f.content ?? '').slice(0, 20000)}`;
        } else {
          output = `Opened folder ${rel}.`;
        }
      }
    } catch (e) {
      return { success: false, output: fail(e) };
    }

    const typed = action === 'create_folder' || action === 'create_file' ? name.length + content.length
      : action === 'write_file' ? content.length : action === 'rename' ? (to ?? '').length : 0;
    broadcast('worker:files', { id: nextId(), action, path: rel, to, content: action === 'create_file' || action === 'write_file' ? content : undefined }, 120);
    await sleep(replayMs(typed));
    return { success: true, output, data: { action, path: rel, to } };
  },
});

export const createTerminalRunTool = (runner: any): AgentTool => ({
  name: 'terminal_run',
  description:
    'Run a shell command in the native EverFern Terminal app (a macOS-style Terminal over the worker workspace). ' +
    'The user watches the command being typed at the prompt and its output appear. No coordinates. ' +
    'Returns stdout, stderr and the exit code. Use worker_bash instead for long silent scripts.',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The command line to run, e.g. "ls -la" or "python3 report.py".' },
    },
    required: ['command'],
  },
  async execute(args: Record<string, unknown>, onUpdate?, emitEvent?): Promise<ToolResult> {
    const workerId = getWorkerIdFromConversation(runner?.currentConversationId);
    if (!workerId) return noWorker();
    const command = String(args.command ?? '').trim();
    if (!command) return { success: false, output: 'No command given.' };
    const id = nextId();
    onUpdate?.(`Running ${command.slice(0, 80)}`);
    emitAction(emitEvent, 'terminal', `Typing ${command.slice(0, 60)}`);
    broadcast('worker:terminal', { id, type: 'start', command });
    const typedFor = replayMs(command.length);
    const started = Date.now();
    let res: { stdout: string; stderr: string; exitCode: number };
    try {
      res = await workspaceExec(workerId, command);
    } catch (e) {
      res = { stdout: '', stderr: fail(e), exitCode: -1 };
    }
    // Let the typing finish on screen before the output lands.
    const wait = typedFor - (Date.now() - started);
    if (wait > 0) await sleep(wait);
    broadcast('worker:terminal', { id, type: 'result', stdout: res.stdout.slice(0, 200000), stderr: res.stderr.slice(0, 50000), exitCode: res.exitCode });
    const out = [res.stdout, res.stderr].filter(Boolean).join('\n').trim() || '(no output)';
    return { success: res.exitCode === 0, output: `exit ${res.exitCode}\n${out.slice(0, 30000)}`, data: { exitCode: res.exitCode } };
  },
});
