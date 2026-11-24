/**
 * Tasks sent from the Navis extension panel ("Send to EverFern").
 *
 * The extension sends { type: 'user-task', text, url?, title? } over its bridge socket. Under
 * Tauri that message wakes this process if it is not running yet. Here it becomes a chat
 * message: the window is shown and the text goes through the same path as Dispatch commands,
 * so the chat sends it exactly as if the user had typed it.
 */
import { BrowserWindow } from 'electron';
import { bridgeServer } from './extension-server';

const MAX_TEXT = 8000;
const WINDOW_WAIT_MS = 30_000;

export interface NavisTask {
  type: 'user-task';
  text?: unknown;
  url?: unknown;
  title?: unknown;
}

/** Chat text for a task, or null when the task should be ignored. */
export function buildTaskCommand(task: NavisTask): string | null {
  const text = typeof task.text === 'string' ? task.text.trim().slice(0, MAX_TEXT) : '';
  if (!text) return null;
  // The chat treats a few bracketed prefixes as approvals or form answers; never accept those from outside.
  if (/^\[(HITL_|INTERNAL_)/i.test(text)) return null;
  const url = typeof task.url === 'string' && /^https?:\/\//i.test(task.url) ? task.url.slice(0, 2000) : '';
  const title = typeof task.title === 'string' ? task.title.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
  if (!url) return text;
  return `${text}\n\n(Sent from the Navis extension. Current tab: ${title ? `${title} - ` : ''}${url})`;
}

function mainWindow(): BrowserWindow | null {
  const w = (global as any).mainWindow as BrowserWindow | null | undefined;
  if (w && !w.isDestroyed()) return w;
  return BrowserWindow.getAllWindows().find(x => !x.isDestroyed()) || null;
}

async function waitForWindow(): Promise<BrowserWindow | null> {
  const started = Date.now();
  while (Date.now() - started < WINDOW_WAIT_MS) {
    const w = mainWindow();
    if (w) return w;
    await new Promise(r => setTimeout(r, 200));
  }
  return null;
}

async function deliver(command: string) {
  const win = await waitForWindow();
  if (!win) {
    console.warn('[NavisTasks] No window to show the task in; dropped it');
    return;
  }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  win.webContents.send('system:dispatch-command', { command });
  console.log(`[NavisTasks] Task from the Navis extension sent to chat (${command.length} chars)`);
}

let registered = false;

export function registerNavisTasks(): void {
  if (registered) return;
  registered = true;
  bridgeServer.on('extension-event', (event: any) => {
    if (event?.type !== 'user-task') return;
    const command = buildTaskCommand(event);
    if (!command) return;
    deliver(command).catch(e => console.error('[NavisTasks] Failed to deliver task:', e));
  });
}
