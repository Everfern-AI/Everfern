/**
 * Native Sheets + in-app pointer tools.
 *
 * The AI writes to the workbook instantly; the renderer receives the delta and
 * replays it as a human-paced typing/clicking animation.
 */

import { BrowserWindow, ipcMain } from 'electron';
import type { AgentTool, ToolResult } from '../runner/types';
import {
  getWorkerIdFromConversation,
  createWorkerReadFileTool,
  createWorkerWriteFileTool,
} from './worker-tools';
import {
  loadSheet,
  saveSheet,
  writeRange,
  appendRows,
  clearRange,
  readRange,
  importDelimited,
  sheetToCSV,
  blankSheet,
  applyFormat,
  addSheet,
} from './sheets-store';

const workerIdOf = (runner: any): string | null =>
  getWorkerIdFromConversation(runner?.currentConversationId);

function broadcast(channel: string, payload: unknown, delayMs = 0): void {
  const send = () => {
    for (const win of BrowserWindow.getAllWindows()) {
      try { win.webContents.send(channel, payload); } catch { /* window closing */ }
    }
  };
  if (delayMs > 0) setTimeout(send, delayMs);
  else send();
}

function emitAction(
  emitEvent: any,
  app: string,
  description: string,
  coordinate?: { x: number; y: number },
): void {
  emitEvent?.({
    type: 'subagent-progress',
    data: {
      type: 'action',
      workerApp: app,
      action: {
        type: 'ui',
        params: { app, ...(coordinate ? { coordinate } : {}) },
        description,
      },
    },
  });
}

const noWorker = (): ToolResult => ({
  success: false,
  output: 'A worker session is required to use the native Sheets app.',
});

export const createSheetsReadTool = (runner: any): AgentTool => ({
  name: 'sheets_read',
  description:
    'Read the worker\'s native Sheets workbook. Returns tab-separated rows for the requested range ' +
    '(default: the used range). Fast, deterministic; no GUI automation required.',
  parameters: {
    type: 'object',
    properties: {
      range: { type: 'string', description: 'Optional A1 range such as "A1:F20". Omit to read the used range.' },
    },
    required: [],
  },
  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const workerId = workerIdOf(runner);
    if (!workerId) return noWorker();
    const data = loadSheet(workerId);
    const { start, rows } = readRange(data, typeof args.range === 'string' ? args.range : undefined);
    const tsv = rows.map((r) => r.join('\t')).join('\n');
    return {
      success: true,
      output: tsv ? `Sheet "${data.name}" from ${start}:\n${tsv}` : `Sheet "${data.name}" is empty.`,
      data: { name: data.name, start, rows, columns: data.columns, rowsAvailable: data.rows },
    };
  },
});

export const createSheetsWriteTool = (runner: any): AgentTool => ({
  name: 'sheets_write',
  description:
    'Write a 2D block of values/formulas starting at a cell (default A1). The user watches the AI ' +
    'click each cell and type the value. Returns after the sheet state is committed.',
  parameters: {
    type: 'object',
    properties: {
      start: { type: 'string', description: 'Top-left cell, e.g. "A1". Defaults to A1.' },
      values: {
        type: 'array',
        description: 'Rows of cell values. Use "=" prefixed strings for formulas, e.g. "=SUM(B2:B9)".',
        items: { type: 'array', items: {} },
      },
    },
    required: ['values'],
  },
  async execute(args: Record<string, unknown>, onUpdate?, emitEvent?): Promise<ToolResult> {
    const workerId = workerIdOf(runner);
    if (!workerId) return noWorker();
    const values = Array.isArray(args.values) ? (args.values as unknown[][]) : [];
    if (!values.length) return { success: false, output: 'No values supplied.' };
    const start = typeof args.start === 'string' && args.start.trim() ? args.start.trim() : 'A1';
    const data = loadSheet(workerId);
    const result = writeRange(data, start, values);
    saveSheet(workerId, data);
    broadcast('worker:sheets', { type: 'apply', start: result.start, values }, 150);
    onUpdate?.(`Typing ${result.written} cells at ${result.start}`);
    emitAction(emitEvent, 'sheets', `Clicking cell ${result.start} and typing`);
    return {
      success: true,
      output: `Wrote ${result.written} cell(s) starting at ${result.start}.`,
      data: { start: result.start, written: result.written },
    };
  },
});

export const createSheetsAppendTool = (runner: any): AgentTool => ({
  name: 'sheets_append',
  description:
    'Append rows to the bottom of the native Sheets workbook. Ideal for growing tables row by row.',
  parameters: {
    type: 'object',
    properties: {
      values: { type: 'array', description: 'Rows to append.', items: { type: 'array', items: {} } },
    },
    required: ['values'],
  },
  async execute(args: Record<string, unknown>, onUpdate?, emitEvent?): Promise<ToolResult> {
    const workerId = workerIdOf(runner);
    if (!workerId) return noWorker();
    const values = Array.isArray(args.values) ? (args.values as unknown[][]) : [];
    if (!values.length) return { success: false, output: 'No values supplied.' };
    const data = loadSheet(workerId);
    const result = appendRows(data, values);
    saveSheet(workerId, data);
    broadcast('worker:sheets', { type: 'apply', start: result.start, values }, 150);
    onUpdate?.(`Appending ${values.length} row(s) at ${result.start}`);
    emitAction(emitEvent, 'sheets', `Appending rows at ${result.start}`);
    return {
      success: true,
      output: `Appended ${values.length} row(s) at ${result.start}.`,
      data: { start: result.start, written: result.written },
    };
  },
});

export const createSheetsClearTool = (runner: any): AgentTool => ({
  name: 'sheets_clear',
  description: 'Clear a range (or the whole used range) in the native Sheets workbook.',
  parameters: {
    type: 'object',
    properties: {
      range: { type: 'string', description: 'Optional A1 range. Omit to clear the used range.' },
    },
    required: [],
  },
  async execute(args: Record<string, unknown>, onUpdate?, emitEvent?): Promise<ToolResult> {
    const workerId = workerIdOf(runner);
    if (!workerId) return noWorker();
    const data = loadSheet(workerId);
    const cleared = clearRange(data, typeof args.range === 'string' ? args.range : undefined);
    saveSheet(workerId, data);
    broadcast('worker:sheets', { type: 'clear', range: typeof args.range === 'string' ? args.range : undefined }, 150);
    onUpdate?.(`Cleared ${cleared} cell(s)`);
    emitAction(emitEvent, 'sheets', 'Clearing cells');
    return { success: true, output: `Cleared ${cleared} cell(s).`, data: { cleared } };
  },
});

export const createSheetsCreateTool = (runner: any): AgentTool => ({
  name: 'sheets_create',
  description: 'Create or reset the native Sheets workbook, optionally naming it.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Optional workbook name.' },
    },
    required: [],
  },
  async execute(args: Record<string, unknown>, onUpdate?): Promise<ToolResult> {
    const workerId = workerIdOf(runner);
    if (!workerId) return noWorker();
    const name = typeof args.name === 'string' && args.name.trim() ? args.name.trim() : 'Sheet1';
    const data = saveSheet(workerId, blankSheet(name));
    broadcast('worker:sheets', { type: 'load', data }, 150);
    onUpdate?.(`Created sheet "${name}"`);
    return { success: true, output: `Created sheet "${name}".`, data };
  },
});

export const createSheetsImportTool = (runner: any): AgentTool => ({
  name: 'sheets_import',
  description:
    'Import a CSV/TSV file from the worker workspace into the native Sheets workbook. ' +
    'Use this instead of retyping data the worker already has on disk.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Workspace-relative path, e.g. "Reports/leads.csv".' },
    },
    required: ['path'],
  },
  async execute(args: Record<string, unknown>, onUpdate?, emitEvent?): Promise<ToolResult> {
    const workerId = workerIdOf(runner);
    if (!workerId) return noWorker();
    const filePath = String(args.path || '').trim();
    if (!filePath || filePath.includes('..')) return { success: false, output: 'Invalid file path.' };
    const read = await createWorkerReadFileTool(runner).execute({ path: filePath });
    if (!read.success) return read;
    const data = loadSheet(workerId);
    const summary = importDelimited(data, String(read.output || ''));
    const saved = saveSheet(workerId, data);
    broadcast('worker:sheets', { type: 'load', data: saved }, 150);
    onUpdate?.(`Imported ${filePath}`);
    emitAction(emitEvent, 'sheets', `Importing ${filePath}`);
    return {
      success: true,
      output: `Imported ${summary.rows} row(s), ${summary.columns} column(s) from ${filePath}.`,
      data: summary,
    };
  },
});

export const createSheetsExportTool = (runner: any): AgentTool => ({
  name: 'sheets_export',
  description:
    'Export the native Sheets workbook to a CSV file in the worker workspace so it appears in Files.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Workspace-relative destination, e.g. "Reports/leads.csv".' },
    },
    required: ['path'],
  },
  async execute(args: Record<string, unknown>, onUpdate?, emitEvent?): Promise<ToolResult> {
    const workerId = workerIdOf(runner);
    if (!workerId) return noWorker();
    const filePath = String(args.path || '').trim();
    if (!filePath || filePath.includes('..')) return { success: false, output: 'Invalid file path.' };
    const data = loadSheet(workerId);
    const csv = sheetToCSV(data);
    const write = await createWorkerWriteFileTool(runner).execute({ path: filePath, content: csv });
    if (!write.success) return write;
    onUpdate?.(`Exported to ${filePath}`);
    emitAction(emitEvent, 'sheets', `Exporting as ${filePath}`);
    return { success: true, output: `Exported "${data.name}" to ${filePath}.`, data: { path: filePath } };
  },
});

// ── In-app pointer automation (pixel coordinates) ─────────────────────

const clamp = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1000, Math.round(n))) : null;
};

/**
 * The only windows that take pixel input. Every web app (Docs, Gmail, Notion,
 * Amazon, …) is a real browser page and must be driven by Navis, which reads the
 * page and clicks by ref; pointing at pixels there is what made workers flail.
 */
const NATIVE_GUI_APPS = new Set(['files', 'sheets', 'terminal']);

const webAppRedirect = (app: string, tool: string): ToolResult | null =>
  NATIVE_GUI_APPS.has(app)
    ? null
    : {
        success: false,
        output:
          `${tool} only drives EverFern's native windows (files, sheets, terminal). ` +
          `"${app}" is a web app — call the navis tool with app: "${app}" and a clear task instead; ` +
          'it reads the page and clicks by element ref.',
      };

export const createWorkerClickTool = (runner: any): AgentTool => ({
  name: 'worker_click',
  description:
    'Click inside one of EverFern\'s native system windows — files, sheets or terminal — using normalized ' +
    'pixel coordinates (0-1000 on each axis, relative to the window). Never use this on web apps ' +
    '(docs, gmail, notion, amazon, …): drive those with the navis tool, which clicks by element ref.',
  parameters: {
    type: 'object',
    properties: {
      app: { type: 'string', description: 'Native app ID: "files", "sheets" or "terminal".' },
      x: { type: 'number', description: 'Horizontal position 0-1000.' },
      y: { type: 'number', description: 'Vertical position 0-1000.' },
      action: {
        type: 'string',
        description: 'Click kind.',
        enum: ['click', 'double_click', 'right_click'],
      },
    },
    required: ['app', 'x', 'y'],
  },
  async execute(args: Record<string, unknown>, onUpdate?, emitEvent?): Promise<ToolResult> {
    const app = String(args.app || '').trim().toLowerCase();
    const x = clamp(args.x);
    const y = clamp(args.y);
    if (!app || x === null || y === null) {
      return { success: false, output: 'Provide app plus x and y (0-1000).' };
    }
    const redirect = webAppRedirect(app, 'worker_click');
    if (redirect) return redirect;
    const kind = args.action === 'double_click' || args.action === 'right_click' ? args.action : 'click';
    const payload = { app, x, y, action: kind };
    broadcast('worker:pointer', payload);
    onUpdate?.(`Clicking ${app} at ${x},${y}`);
    emitAction(emitEvent, app, `${kind.replace('_', ' ')} ${app} at ${x},${y}`, { x, y });
    return { success: true, output: `Dispatched ${kind} in ${app} at ${x},${y}.`, data: payload };
  },
});

export const createWorkerTypeTool = (runner: any): AgentTool => ({
  name: 'worker_type',
  description:
    'Type into the focused field of a native system window (files, sheets, terminal) the way a person would. ' +
    'Click the field first with worker_click. Never use on web apps — use the navis tool there.',
  parameters: {
    type: 'object',
    properties: {
      app: { type: 'string', description: 'Native app ID: "files", "sheets" or "terminal".' },
      text: { type: 'string', description: 'Text to type.' },
      submit: { type: 'boolean', description: 'Press Enter after typing.' },
    },
    required: ['app', 'text'],
  },
  async execute(args: Record<string, unknown>, onUpdate?, emitEvent?): Promise<ToolResult> {
    const app = String(args.app || '').trim().toLowerCase();
    const text = String(args.text ?? '');
    if (!app) return { success: false, output: 'Provide the target app.' };
    const redirect = webAppRedirect(app, 'worker_type');
    if (redirect) return redirect;
    const payload = { app, text, submit: args.submit === true };
    broadcast('worker:type', payload);
    onUpdate?.(`Typing into ${app}`);
    emitAction(emitEvent, app, `Typing into ${app}`);
    return { success: true, output: `Typing ${text.length} character(s) into ${app}.`, data: payload };
  },
});

export const createWorkerDescribeTool = (runner: any): AgentTool => ({
  name: 'worker_describe',
  description:
    'List the interactive controls in a native system window (files, sheets, terminal) with normalized ' +
    '0-1000 coordinates, so worker_click can aim at them. For web apps use navis instead — it reads the ' +
    'page and clicks by element ref, which is far more reliable than pixel coordinates.',
  parameters: {
    type: 'object',
    properties: {
      app: { type: 'string', description: 'Native app ID: "files", "sheets" or "terminal".' },
    },
    required: ['app'],
  },
  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const app = String(args.app || '').trim().toLowerCase();
    if (!app) return { success: false, output: 'Provide the target app.' };
    const redirect = webAppRedirect(app, 'worker_describe');
    if (redirect) return redirect;
    const requestId = `d${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
    const result = await new Promise<any>((resolve) => {
      let settled = false;
      const cleanup = () => {
        clearTimeout(timer);
        ipcMain.removeListener('worker:describe-result', handler);
      };
      const handler = (_e: any, payload: any) => {
        if (payload?.requestId !== requestId) return;
        settled = true;
        cleanup();
        resolve(payload);
      };
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(null);
      }, 5000);
      ipcMain.on('worker:describe-result', handler);
      broadcast('worker:describe', { app, requestId });
    });
    if (!result) {
      return { success: false, output: `The "${app}" window did not respond. Open it first with open_app.` };
    }
    const elements = Array.isArray(result.elements) ? result.elements : [];
    const lines = elements.map((el: any) => `- ${el.role} "${el.label}" at ${el.x},${el.y}`);
    return {
      success: true,
      output: lines.length
        ? `Interactive elements in ${app}:\n${lines.join('\n')}\n\nUse worker_click with these x,y values.`
        : `No interactive elements found in ${app}.`,
      data: { app, elements },
    };
  },
});

export const createSheetsFormatTool = (runner: any): AgentTool => ({
  name: 'sheets_format',
  description:
    'Format a range in the native Sheets app: bold, italic, underline, strikethrough, text colour, ' +
    'fill colour, alignment, font size and number format. Use it to make a report readable.',
  parameters: {
    type: 'object',
    properties: {
      range: { type: 'string', description: 'A1 range, e.g. "A1:D1" or "B2:B20".' },
      bold: { type: 'boolean', description: 'Bold text.' },
      italic: { type: 'boolean', description: 'Italic text.' },
      underline: { type: 'boolean', description: 'Underline text.' },
      strikethrough: { type: 'boolean', description: 'Strikethrough text.' },
      textColor: { type: 'string', description: 'Text colour as a hex value, e.g. "#1c2421".' },
      fillColor: { type: 'string', description: 'Fill colour as a hex value, e.g. "#e4f9ed".' },
      align: { type: 'string', enum: ['left', 'center', 'right'], description: 'Horizontal alignment.' },
      fontSize: { type: 'number', description: '6-48.' },
      numberFormat: { type: 'string', enum: ['general', 'number', 'currency', 'percent'], description: 'Number display format.' },
    },
    required: ['range'],
  },
  async execute(args: Record<string, unknown>, onUpdate?, emitEvent?): Promise<ToolResult> {
    const workerId = workerIdOf(runner);
    if (!workerId) return noWorker();
    const range = String(args.range || '').trim();
    if (!range) return { success: false, output: 'Provide a range, e.g. A1:D1.' };
    const patch: Record<string, unknown> = {};
    if (typeof args.bold === 'boolean') patch.b = args.bold;
    if (typeof args.italic === 'boolean') patch.i = args.italic;
    if (typeof args.underline === 'boolean') patch.u = args.underline;
    if (typeof args.strikethrough === 'boolean') patch.s = args.strikethrough;
    if (typeof args.textColor === 'string') patch.color = args.textColor;
    if (typeof args.fillColor === 'string') patch.bg = args.fillColor;
    if (args.align === 'left' || args.align === 'center' || args.align === 'right') patch.align = args.align;
    if (Number.isFinite(Number(args.fontSize))) patch.fs = Number(args.fontSize);
    if (args.numberFormat === 'general' || args.numberFormat === 'number' || args.numberFormat === 'currency' || args.numberFormat === 'percent') patch.fmt = args.numberFormat;
    const data = loadSheet(workerId);
    const changed = applyFormat(data, range, patch as any);
    const saved = saveSheet(workerId, data);
    broadcast('worker:sheets', { type: 'load', data: saved }, 150);
    onUpdate?.(`Formatted ${range}`);
    emitAction(emitEvent, 'sheets', `Formatting ${range}`);
    return { success: true, output: `Formatted ${changed} cell(s) in ${range}.`, data: { range, changed } };
  },
});

export const createSheetsAddSheetTool = (runner: any): AgentTool => ({
  name: 'sheets_add_sheet',
  description: 'Add a new tab to the native Sheets workbook.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Optional tab name.' },
    },
    required: [],
  },
  async execute(args: Record<string, unknown>, onUpdate?): Promise<ToolResult> {
    const workerId = workerIdOf(runner);
    if (!workerId) return noWorker();
    const data = addSheet(loadSheet(workerId), typeof args.name === 'string' ? args.name : undefined);
    const saved = saveSheet(workerId, data);
    broadcast('worker:sheets', { type: 'load', data: saved }, 150);
    onUpdate?.('Added a sheet tab');
    return { success: true, output: `Added sheet "${saved.sheets[saved.active].name}".`, data: { active: saved.active } };
  },
});
