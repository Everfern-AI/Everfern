/**
 * Native Sheets app store.
 *
 * The workbook lives in userData so the main-process AI tools and the renderer
 * share one source of truth. The renderer animates changes; the tools only
 * commit rows and broadcast the delta.
 *
 * Schema v2 adds cell styles, column widths, merges and multiple sheet tabs.
 * Top-level `cells/styles/...` always mirror the active tab so existing tools
 * keep working unchanged.
 */

import { app as electronApp } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

export type CellAlign = 'left' | 'center' | 'right';
export type NumberFormat = 'general' | 'number' | 'currency' | 'percent';

export type CellStyle = {
  b?: boolean;            // bold
  i?: boolean;            // italic
  u?: boolean;            // underline
  s?: boolean;            // strikethrough
  color?: string;         // text colour (hex)
  bg?: string;            // fill colour (hex)
  align?: CellAlign;
  fs?: number;            // font size 6-48
  fmt?: NumberFormat;
  decimals?: number;      // 0-10
};

export type SheetTab = {
  id: string;
  name: string;
  cells: Record<string, string>;
  styles: Record<string, CellStyle>;
  colWidths: Record<string, number>;
  rowHeights: Record<string, number>;
  merges: string[];
};

export type SheetData = {
  name: string;
  columns: number;
  rows: number;
  /** Active tab mirror (kept for the existing AI tools). */
  cells: Record<string, string>;
  styles: Record<string, CellStyle>;
  colWidths: Record<string, number>;
  rowHeights: Record<string, number>;
  merges: string[];
  sheets: SheetTab[];
  active: number;
};

export const DEFAULT_COLUMNS = 12;
export const DEFAULT_ROWS = 60;
const MAX_COLUMNS = 100;
const MAX_ROWS = 2000;
const MAX_CELL_LENGTH = 50000;
const MAX_SHEETS = 20;

export function blankSheet(name = 'Sheet1'): SheetData {
  const tab = blankTab(name);
  return {
    name,
    columns: DEFAULT_COLUMNS,
    rows: DEFAULT_ROWS,
    cells: tab.cells,
    styles: tab.styles,
    colWidths: tab.colWidths,
    rowHeights: tab.rowHeights,
    merges: tab.merges,
    sheets: [tab],
    active: 0,
  };
}

function blankTab(name: string): SheetTab {
  return { id: `tab-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name, cells: {}, styles: {}, colWidths: {}, rowHeights: {}, merges: [] };
}

const clampInt = (value: unknown, min: number, max: number, fallback: number) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
};

const DIR = () => path.join(electronApp.getPath('userData'), 'worker-sheets');
const fileFor = (workerId: string) => path.join(DIR(), `${workerId}.json`);

export function columnToIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) {
    const code = ch.charCodeAt(0);
    if (code < 65 || code > 90) return -1;
    n = n * 26 + (code - 64);
  }
  return n - 1;
}

export function indexToColumn(index: number): string {
  let n = Math.max(0, Math.trunc(index));
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

/** "B3" -> { row: 2, col: 1 } (zero-based). */
export function parseRef(ref: string): { row: number; col: number } | null {
  const m = /^([A-Za-z]{1,3})([1-9][0-9]{0,4})$/.exec(String(ref || '').trim());
  if (!m) return null;
  const col = columnToIndex(m[1]);
  const row = Number(m[2]) - 1;
  if (col < 0 || !Number.isSafeInteger(row)) return null;
  return { row, col };
}

export function makeRef(row: number, col: number): string {
  return `${indexToColumn(col)}${row + 1}`;
}

const CELL_KEY = /^[A-Z]{1,3}[1-9][0-9]{0,4}$/;
const HEX = /^#[0-9a-fA-F]{3,8}$/;
const ALIGNS: CellAlign[] = ['left', 'center', 'right'];
const FORMATS: NumberFormat[] = ['general', 'number', 'currency', 'percent'];
const MERGE = /^[A-Z]{1,3}[1-9][0-9]{0,4}(:[A-Z]{1,3}[1-9][0-9]{0,4})?$/;

function sanitizeCells(cells: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cells || typeof cells !== 'object') return out;
  for (const [key, value] of Object.entries(cells as Record<string, unknown>)) {
    if (!CELL_KEY.test(key)) continue;
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') continue;
    const text = String(value);
    if (text.length > MAX_CELL_LENGTH || text === '') continue;
    out[key] = text;
  }
  return out;
}

export function sanitizeStyle(raw: unknown): CellStyle | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  const out: CellStyle = {};
  if (s.b === true) out.b = true;
  if (s.i === true) out.i = true;
  if (s.u === true) out.u = true;
  if (s.s === true) out.s = true;
  if (typeof s.color === 'string' && HEX.test(s.color)) out.color = s.color;
  if (typeof s.bg === 'string' && HEX.test(s.bg)) out.bg = s.bg;
  if (ALIGNS.includes(s.align as CellAlign)) out.align = s.align as CellAlign;
  if (Number.isFinite(Number(s.fs))) out.fs = clampInt(s.fs, 6, 48, 12);
  if (FORMATS.includes(s.fmt as NumberFormat)) out.fmt = s.fmt as NumberFormat;
  if (Number.isFinite(Number(s.decimals))) out.decimals = clampInt(s.decimals, 0, 10, 2);
  return Object.keys(out).length ? out : null;
}

function sanitizeStyles(styles: unknown): Record<string, CellStyle> {
  const out: Record<string, CellStyle> = {};
  if (!styles || typeof styles !== 'object') return out;
  for (const [key, value] of Object.entries(styles as Record<string, unknown>)) {
    if (!CELL_KEY.test(key)) continue;
    const style = sanitizeStyle(value);
    if (style) out[key] = style;
  }
  return out;
}

function sanitizeWidths(raw: unknown, min: number, max: number): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const idx = Number(key);
    if (!Number.isInteger(idx) || idx < 0 || idx > 500) continue;
    const n = Number(value);
    if (Number.isFinite(n)) out[key] = Math.max(min, Math.min(max, Math.round(n)));
  }
  return out;
}

function sanitizeMerges(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((m): m is string => typeof m === 'string' && MERGE.test(m)).slice(0, 200);
}

function sanitizeTab(raw: any, fallbackName: string): SheetTab {
  return {
    id: typeof raw?.id === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(raw.id) ? raw.id : `tab-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: typeof raw?.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 60) : fallbackName,
    cells: sanitizeCells(raw?.cells),
    styles: sanitizeStyles(raw?.styles),
    colWidths: sanitizeWidths(raw?.colWidths, 24, 600),
    rowHeights: sanitizeWidths(raw?.rowHeights, 18, 400),
    merges: sanitizeMerges(raw?.merges),
  };
}

export function normalizeSheetData(raw: any): SheetData {
  const name = typeof raw?.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 120) : 'Sheet1';
  const columns = clampInt(raw?.columns, 1, MAX_COLUMNS, DEFAULT_COLUMNS);
  const rows = clampInt(raw?.rows, 1, MAX_ROWS, DEFAULT_ROWS);

  let sheets: SheetTab[] = [];
  if (Array.isArray(raw?.sheets) && raw.sheets.length) {
    sheets = raw.sheets.slice(0, MAX_SHEETS).map((tab: any, i: number) => sanitizeTab(tab, i === 0 ? name : `Sheet${i + 1}`));
  } else {
    sheets = [sanitizeTab({ ...raw, name }, name)];
  }

  const active = clampInt(raw?.active, 0, sheets.length - 1, 0);
  const tab = sheets[active];

  return {
    name,
    columns,
    rows,
    cells: tab.cells,
    styles: tab.styles,
    colWidths: tab.colWidths,
    rowHeights: tab.rowHeights,
    merges: tab.merges,
    sheets,
    active,
  };
}

export function loadSheet(workerId: string): SheetData {
  try {
    return normalizeSheetData(JSON.parse(fs.readFileSync(fileFor(workerId), 'utf-8')));
  } catch {
    return blankSheet();
  }
}

export function saveSheet(workerId: string, data: Partial<SheetData>): SheetData {
  const safe = normalizeSheetData(data);
  // The AI tools write to the top-level mirror; fold that back into the active tab.
  const tab = safe.sheets[safe.active];
  safe.sheets[safe.active] = {
    ...tab,
    cells: sanitizeCells(data.cells ?? tab.cells),
    styles: sanitizeStyles(data.styles ?? tab.styles),
    colWidths: sanitizeWidths(data.colWidths ?? tab.colWidths, 24, 600),
    rowHeights: sanitizeWidths(data.rowHeights ?? tab.rowHeights, 18, 400),
    merges: sanitizeMerges(data.merges ?? tab.merges),
  };
  safe.cells = safe.sheets[safe.active].cells;
  safe.styles = safe.sheets[safe.active].styles;
  safe.colWidths = safe.sheets[safe.active].colWidths;
  safe.rowHeights = safe.sheets[safe.active].rowHeights;
  safe.merges = safe.sheets[safe.active].merges;

  fs.mkdirSync(DIR(), { recursive: true });
  fs.writeFileSync(fileFor(workerId), JSON.stringify(safe), 'utf-8');
  return safe;
}

const usedBounds = (data: SheetData) => {
  let maxRow = -1;
  let maxCol = -1;
  for (const key of Object.keys(data.cells)) {
    const ref = parseRef(key);
    if (!ref) continue;
    maxRow = Math.max(maxRow, ref.row);
    maxCol = Math.max(maxCol, ref.col);
  }
  return { maxRow, maxCol };
};

export function parseRange(range: string | undefined, data: SheetData) {
  const text = String(range || '').trim();
  if (text) {
    const [startRaw, endRaw] = text.split(':');
    const start = parseRef(startRaw);
    if (start) {
      const end = endRaw ? parseRef(endRaw) : start;
      if (end) {
        return {
          startRow: Math.min(start.row, end.row),
          startCol: Math.min(start.col, end.col),
          endRow: Math.max(start.row, end.row),
          endCol: Math.max(start.col, end.col),
        };
      }
    }
  }
  const { maxRow, maxCol } = usedBounds(data);
  if (maxRow < 0 || maxCol < 0) return { startRow: 0, startCol: 0, endRow: 0, endCol: 0 };
  return { startRow: 0, startCol: 0, endRow: maxRow, endCol: maxCol };
}

export function readRange(data: SheetData, range?: string): { start: string; rows: string[][] } {
  const rect = parseRange(range, data);
  const rows: string[][] = [];
  for (let r = rect.startRow; r <= rect.endRow; r++) {
    const row: string[] = [];
    for (let c = rect.startCol; c <= rect.endCol; c++) row.push(data.cells[makeRef(r, c)] ?? '');
    rows.push(row);
  }
  return { start: makeRef(rect.startRow, rect.startCol), rows };
}

export function writeRange(data: SheetData, start: string, values: unknown[][]): { written: number; start: string } {
  const origin = parseRef(start) ?? { row: 0, col: 0 };
  let written = 0;
  values.forEach((row, r) => {
    if (!Array.isArray(row)) return;
    row.forEach((value, c) => {
      const ref = makeRef(origin.row + r, origin.col + c);
      const text = value === null || value === undefined ? '' : String(value);
      if (text === '') delete data.cells[ref];
      else if (text.length <= MAX_CELL_LENGTH) { data.cells[ref] = text; written++; }
      data.rows = Math.max(data.rows, origin.row + r + 1);
      data.columns = Math.max(data.columns, origin.col + c + 1);
    });
  });
  return { written, start: makeRef(origin.row, origin.col) };
}

export function appendRows(data: SheetData, values: unknown[][]): { written: number; start: string } {
  const { maxRow } = usedBounds(data);
  return writeRange(data, makeRef(maxRow + 1, 0), values);
}

export function clearRange(data: SheetData, range?: string): number {
  const rect = parseRange(range, data);
  let cleared = 0;
  for (let r = rect.startRow; r <= rect.endRow; r++) {
    for (let c = rect.startCol; c <= rect.endCol; c++) {
      const ref = makeRef(r, c);
      if (data.cells[ref] !== undefined) { delete data.cells[ref]; cleared++; }
    }
  }
  return cleared;
}

export function applyFormat(data: SheetData, range: string | undefined, patch: CellStyle): number {
  const rect = parseRange(range, data);
  let changed = 0;
  for (let r = rect.startRow; r <= rect.endRow; r++) {
    for (let c = rect.startCol; c <= rect.endCol; c++) {
      const ref = makeRef(r, c);
      const next = sanitizeStyle({ ...(data.styles[ref] ?? {}), ...patch });
      if (next) { data.styles[ref] = next; changed++; } else delete data.styles[ref];
    }
  }
  return changed;
}

export function addSheet(data: SheetData, name?: string): SheetData {
  if (data.sheets.length >= MAX_SHEETS) return data;
  const tab = blankTab(name?.trim().slice(0, 60) || `Sheet${data.sheets.length + 1}`);
  data.sheets.push(tab);
  data.active = data.sheets.length - 1;
  data.cells = tab.cells;
  data.styles = tab.styles;
  data.colWidths = tab.colWidths;
  data.rowHeights = tab.rowHeights;
  data.merges = tab.merges;
  return data;
}

function parseDelimited(text: string): string[][] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const tabs = (firstLine.match(/\t/g) || []).length;
  const commas = (firstLine.match(/,/g) || []).length;
  const delimiter = tabs > commas ? '\t' : ',';

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === delimiter) { row.push(field); field = ''; continue; }
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    if (ch === '\r') continue;
    field += ch;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  while (rows.length && rows[rows.length - 1].every((v) => v === '')) rows.pop();
  return rows;
}

export function importDelimited(data: SheetData, text: string): { written: number; rows: number; columns: number } {
  const rows = parseDelimited(text);
  data.cells = {};
  data.styles = {};
  data.merges = [];
  const result = rows.length ? writeRange(data, 'A1', rows) : { written: 0, start: 'A1' };
  data.rows = Math.max(DEFAULT_ROWS, rows.length);
  data.columns = Math.max(DEFAULT_COLUMNS, rows.reduce((m, r) => Math.max(m, r.length), 0));
  return { written: result.written, rows: rows.length, columns: data.columns };
}

export function sheetToCSV(data: SheetData): string {
  const { maxRow, maxCol } = usedBounds(data);
  if (maxRow < 0 || maxCol < 0) return '';
  const lines: string[] = [];
  for (let r = 0; r <= maxRow; r++) {
    const row: string[] = [];
    for (let c = 0; c <= maxCol; c++) {
      const value = data.cells[makeRef(r, c)] ?? '';
      row.push(/[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
    }
    lines.push(row.join(','));
  }
  return lines.join('\n');
}
