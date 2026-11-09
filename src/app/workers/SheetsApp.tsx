"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bold, Italic, Underline, Strikethrough, AlignLeft, AlignCenter, AlignRight,
  Download, Upload, Plus, Trash2, Copy, Undo2, Redo2, Merge, ArrowUpDown,
  ChartBar, Eraser, Check, Sparkles, X,
} from "lucide-react";

const workersApi = () => (typeof window !== "undefined" ? (window as any).electronAPI?.workers : undefined);

export type CellAlign = "left" | "center" | "right";
export type NumberFormat = "general" | "number" | "currency" | "percent";
export type CellStyle = {
  b?: boolean; i?: boolean; u?: boolean; s?: boolean;
  color?: string; bg?: string; align?: CellAlign;
  fs?: number; fmt?: NumberFormat; decimals?: number;
};
export type SheetTab = {
  id: string; name: string;
  cells: Record<string, string>;
  styles: Record<string, CellStyle>;
  colWidths: Record<string, number>;
  rowHeights: Record<string, number>;
  merges: string[];
};
export type SheetData = {
  name: string; columns: number; rows: number;
  cells: Record<string, string>;
  styles: Record<string, CellStyle>;
  colWidths: Record<string, number>;
  rowHeights: Record<string, number>;
  merges: string[];
  sheets?: SheetTab[];
  active?: number;
};
type Pos = { r: number; c: number };
type ActiveTyping = { ref: string; typing: string; shown: string } | null;
type SheetCommand = { type?: string; data?: SheetData; start?: string; values?: unknown[][]; range?: string };

const DEFAULT_COLUMNS = 12;
const DEFAULT_ROWS = 60;
const BASE_COL_WIDTH = 108;
const ROW_HEIGHT = 24;

export const colName = (index: number): string => {
  let n = Math.max(0, index);
  let out = "";
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
};

const colIndex = (letters: string): number => {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

export const parseRef = (ref: string): Pos | null => {
  const m = /^([A-Za-z]{1,3})([1-9][0-9]{0,4})$/.exec(String(ref || "").trim());
  if (!m) return null;
  const c = colIndex(m[1]);
  const r = Number(m[2]) - 1;
  return c >= 0 && Number.isSafeInteger(r) ? { r, c } : null;
};

export const cellRef = (r: number, c: number) => `${colName(c)}${r + 1}`;

const rectOf = (a: Pos, b: Pos) => ({
  r1: Math.min(a.r, b.r), r2: Math.max(a.r, b.r),
  c1: Math.min(a.c, b.c), c2: Math.max(a.c, b.c),
});

const inRect = (r: number, c: number, a: Pos, b: Pos) => {
  const q = rectOf(a, b);
  return r >= q.r1 && r <= q.r2 && c >= q.c1 && c <= q.c2;
};

/* ── formula engine ─────────────────────────────────────────────── */

const flatten = (args: unknown[]): unknown[] => args.flat(Infinity);
const toNum = (v: unknown): number => {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const nums = (args: unknown[]): number[] => flatten(args).map(toNum);
const finite = (a: number[]) => a.filter((n) => Number.isFinite(n));
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const roundTo = (x: number, d = 0) => {
  const f = 10 ** d;
  return Math.round((x + Number.EPSILON) * f) / f;
};

function makeFns() {
  return {
    SUM: (...a: unknown[]) => sum(nums(a)),
    AVERAGE: (...a: unknown[]) => { const v = finite(nums(a)); return v.length ? sum(v) / v.length : 0; },
    AVG: (...a: unknown[]) => { const v = finite(nums(a)); return v.length ? sum(v) / v.length : 0; },
    MIN: (...a: unknown[]) => { const v = finite(nums(a)); return v.length ? Math.min(...v) : 0; },
    MAX: (...a: unknown[]) => { const v = finite(nums(a)); return v.length ? Math.max(...v) : 0; },
    COUNT: (...a: unknown[]) => finite(nums(a)).length,
    COUNTA: (...a: unknown[]) => flatten(a).filter((v) => v !== "" && v !== null && v !== undefined).length,
    PRODUCT: (...a: unknown[]) => finite(nums(a)).reduce((x, y) => x * y, 1),
    MEDIAN: (...a: unknown[]) => { const v = finite(nums(a)).sort((x, y) => x - y); if (!v.length) return 0; const m = Math.floor(v.length / 2); return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; },
    IF: (cond: unknown, a: unknown, b: unknown) => (cond ? a : b),
    ROUND: (x: unknown, d: unknown = 0) => roundTo(toNum(x), toNum(d)),
    ROUNDUP: (x: unknown, d: unknown = 0) => { const f = 10 ** toNum(d); return Math.ceil(toNum(x) * f) / f; },
    ROUNDDOWN: (x: unknown, d: unknown = 0) => { const f = 10 ** toNum(d); return Math.floor(toNum(x) * f) / f; },
    ABS: (x: unknown) => Math.abs(toNum(x)),
    SQRT: (x: unknown) => Math.sqrt(toNum(x)),
    POWER: (x: unknown, y: unknown) => Math.pow(toNum(x), toNum(y)),
    MOD: (x: unknown, y: unknown) => toNum(x) % toNum(y),
    INT: (x: unknown) => Math.trunc(toNum(x)),
    CONCATENATE: (...a: unknown[]) => flatten(a).map((v) => String(v ?? "")).join(""),
    CONCAT: (...a: unknown[]) => flatten(a).map((v) => String(v ?? "")).join(""),
    LEN: (x: unknown) => String(x ?? "").length,
    UPPER: (x: unknown) => String(x ?? "").toUpperCase(),
    LOWER: (x: unknown) => String(x ?? "").toLowerCase(),
    TRIM: (x: unknown) => String(x ?? "").trim(),
    LEFT: (x: unknown, n: unknown = 1) => String(x ?? "").slice(0, toNum(n)),
    RIGHT: (x: unknown, n: unknown = 1) => { const s = String(x ?? ""); const k = toNum(n); return k <= 0 ? "" : s.slice(-k); },
    MID: (x: unknown, start: unknown, n: unknown) => { const s = String(x ?? ""); const st = Math.max(1, toNum(start)); return s.slice(st - 1, st - 1 + toNum(n)); },
    TODAY: () => new Date().toISOString().slice(0, 10),
    NOW: () => new Date().toLocaleString(),
    PI: () => Math.PI,
    AND: (...a: unknown[]) => flatten(a).every((v) => !!v),
    OR: (...a: unknown[]) => flatten(a).some((v) => !!v),
    NOT: (x: unknown) => !x,
  } as Record<string, (...a: unknown[]) => unknown>;
}

const FNS = makeFns();
const FN_NAMES = Object.keys(FNS).join("|");
const STR = "\u0001";

function splitStrings(expr: string): { text: string; strings: string[] } {
  const strings: string[] = [];
  let out = "";
  let i = 0;
  let inStr = false;
  let buf = '"';
  while (i < expr.length) {
    const ch = expr[i];
    if (!inStr) {
      if (ch === '"') { inStr = true; buf = '"'; }
      else out += ch;
    } else if (ch === '"') {
      if (expr[i + 1] === '"') { buf += '""'; i++; }
      else { buf += '"'; strings.push(buf); out += `${STR}${strings.length - 1}${STR}`; inStr = false; }
    } else buf += ch;
    i++;
  }
  if (inStr) buf += '"';
  return { text: out, strings };
}

export function evaluateFormula(raw: string, cells: Record<string, string>, seen: Set<string>): string | number {
  const { text, strings } = splitStrings(raw.slice(1));
  let e = text.toUpperCase();
  if (!/^[A-Z0-9_+\-*/^%(),.:<>=&"'!\s\u0001]*$/.test(e)) return "#ERROR";
  if (/\b(CONSTRUCTOR|PROTOTYPE|__PROTO__|WINDOW|DOCUMENT|GLOBALTHIS|THIS|IMPORT|REQUIRE|PROCESS|FETCH|EVAL|FUNCTION|ALERT|LOCALSTORAGE)\b/.test(e)) return "#ERROR";
  e = e.replace(new RegExp(`\\b(${FN_NAMES})\\s*\\(`, "g"), "__fn.$1(");
  e = e.replace(/\bTRUE\b/g, "true").replace(/\bFALSE\b/g, "false");
  e = e.replace(/([A-Z]{1,3}[1-9][0-9]{0,4}):([A-Z]{1,3}[1-9][0-9]{0,4})/g, '__range("$1","$2")');
  e = e.replace(/\b([A-Z]{1,3}[1-9][0-9]{0,4})\b/g, '__cell("$1")');
  e = e.replace(/([0-9.]+)%/g, "($1/100)");
  e = e.replace(/<>/g, "!=").replace(/(?<![<>=!])=(?!=)/g, "==").replace(/\^/g, "**").replace(/&/g, "+");
  e = e.replace(new RegExp(`${STR}(\\d+)${STR}`, "g"), (_m, i) => strings[Number(i)]);
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function("__cell", "__range", "__fn", `"use strict";return (${e});`);
    const value = fn(
      (ref: string) => evaluateCell(cells, ref, seen),
      (a: string, b: string) => {
        const p = parseRef(a), q = parseRef(b);
        if (!p || !q) return [];
        const out: Array<string | number> = [];
        for (let r = Math.min(p.r, q.r); r <= Math.max(p.r, q.r); r++) {
          for (let c = Math.min(p.c, q.c); c <= Math.max(p.c, q.c); c++) out.push(evaluateCell(cells, cellRef(r, c), seen));
        }
        return out;
      },
      FNS,
    );
    if (typeof value === "string") return value;
    if (typeof value === "number") return Number.isFinite(value) ? value : "#ERROR";
    if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
    return value == null ? "" : String(value);
  } catch {
    return "#ERROR";
  }
}

export function evaluateCell(cells: Record<string, string>, ref: string, seen: Set<string>): string | number {
  const raw = cells[ref];
  if (raw === undefined || raw === "") return "";
  if (!raw.startsWith("=")) return raw;
  if (seen.has(ref)) return "#CYCLE";
  return evaluateFormula(raw, cells, new Set(seen).add(ref));
}

export const cellValue = (cells: Record<string, string>, ref: string, seen: Set<string>): string => {
  const v = evaluateCell(cells, ref, seen);
  return v == null ? "" : String(v);
};

function formatNumber(n: number, style?: CellStyle): string {
  if (!style || !style.fmt || style.fmt === "general") return String(n);
  const d = Number.isFinite(style.decimals) ? Number(style.decimals) : 2;
  try {
    if (style.fmt === "currency") return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", minimumFractionDigits: d, maximumFractionDigits: d }).format(n);
    if (style.fmt === "percent") return `${(n * 100).toFixed(d)}%`;
    return n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
  } catch {
    return String(n);
  }
}

const displayValue = (cells: Record<string, string>, ref: string, style?: CellStyle): string => {
  const v = evaluateCell(cells, ref, new Set());
  if (typeof v === "number") return formatNumber(v, style);
  return v;
};

const parseDelimited = (text: string): string[][] => {
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = (first.match(/\t/g) || []).length > (first.match(/,/g) || []).length ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (ch !== "\r") field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  while (rows.length && rows[rows.length - 1].every((v) => v === "")) rows.pop();
  return rows;
};

const toCSV = (tab: SheetTab, rows: number, columns: number): string => {
  let maxR = -1, maxC = -1;
  for (const key of Object.keys(tab.cells)) {
    const p = parseRef(key);
    if (!p) continue;
    maxR = Math.max(maxR, p.r); maxC = Math.max(maxC, p.c);
  }
  if (maxR < 0) return "";
  const lines: string[] = [];
  for (let r = 0; r <= Math.min(maxR, rows - 1); r++) {
    const out: string[] = [];
    for (let c = 0; c <= Math.min(maxC, columns - 1); c++) {
      const v = cellValue(tab.cells, cellRef(r, c), new Set());
      out.push(/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    }
    lines.push(out.join(","));
  }
  return lines.join("\n");
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const blankTab = (name: string): SheetTab => ({
  id: `tab-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  name, cells: {}, styles: {}, colWidths: {}, rowHeights: {}, merges: [],
});

const normalize = (raw: SheetData | null | undefined): { name: string; columns: number; rows: number; tabs: SheetTab[]; active: number } => {
  const name = raw?.name || "Sheet1";
  const columns = Math.max(1, Math.min(100, raw?.columns || DEFAULT_COLUMNS));
  const rows = Math.max(1, Math.min(2000, raw?.rows || DEFAULT_ROWS));
  let tabs: SheetTab[] = [];
  if (Array.isArray(raw?.sheets) && raw.sheets.length) {
    tabs = raw.sheets.map((t, i) => ({
      id: t.id || `tab-${i}`, name: t.name || `Sheet${i + 1}`,
      cells: t.cells || {}, styles: t.styles || {}, colWidths: t.colWidths || {}, rowHeights: t.rowHeights || {}, merges: t.merges || [],
    }));
  } else if (raw) {
    tabs = [{ id: "tab-0", name: name, cells: raw.cells || {}, styles: raw.styles || {}, colWidths: raw.colWidths || {}, rowHeights: raw.rowHeights || {}, merges: raw.merges || [] }];
  }
  if (!tabs.length) tabs = [blankTab(name)];
  const active = Math.max(0, Math.min(tabs.length - 1, raw?.active ?? 0));
  return { name, columns, rows, tabs, active };
};

const buildSheetData = (name: string, columns: number, rows: number, tabs: SheetTab[], active: number): SheetData => {
  const tab = tabs[active] ?? tabs[0];
  return {
    name, columns, rows,
    cells: tab.cells, styles: tab.styles, colWidths: tab.colWidths, rowHeights: tab.rowHeights, merges: tab.merges,
    sheets: tabs, active,
  };
};

/* ── component ──────────────────────────────────────────────────── */

export function SheetsApp({ workerId }: { workerId?: string }) {
  const api = workersApi();
  const [workbookName, setWorkbookName] = useState("Sheet1");
  const [columns, setColumns] = useState(DEFAULT_COLUMNS);
  const [rows, setRows] = useState(DEFAULT_ROWS);
  const [tabs, setTabs] = useState<SheetTab[]>([blankTab("Sheet1")]);
  const [active, setActive] = useState(0);
  const [selA, setSelA] = useState<Pos>({ r: 0, c: 0 });
  const [selB, setSelB] = useState<Pos>({ r: 0, c: 0 });
  const [editing, setEditing] = useState<{ r: number; c: number; draft: string } | null>(null);
  const [activeTyping, setActiveTyping] = useState<ActiveTyping>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [chart, setChart] = useState<{ type: "bar" | "line"; labels: string[]; values: number[] } | null>(null);
  const [loaded, setLoaded] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const queueRef = useRef<Array<{ ref: string; value: string }>>([]);
  const pumpingRef = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const undoRef = useRef<Array<{ tabs: SheetTab[]; active: number }>>([]);
  const redoRef = useRef<Array<{ tabs: SheetTab[]; active: number }>>([]);
  const dragSel = useRef(false);

  useEffect(() => {
    const up = () => { dragSel.current = false; };
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, []);

  const tab = tabs[active] ?? tabs[0];
  const cells = tab.cells;
  const styles = tab.styles;
  const selRef = cellRef(selA.r, selA.c);
  const selRaw = cells[selRef] ?? "";
  const selRange = useMemo(() => {
    const q = rectOf(selA, selB);
    const a = cellRef(q.r1, q.c1);
    const b = cellRef(q.r2, q.c2);
    return a === b ? a : `${a}:${b}`;
  }, [selA, selB]);

  const updateTab = useCallback((patch: Partial<SheetTab>) => {
    setTabs((ts) => ts.map((t, i) => (i === active ? { ...t, ...patch } : t)));
  }, [active]);

  const pushHistory = useCallback((currentTabs: SheetTab[], currentActive: number) => {
    undoRef.current.push({ tabs: structuredClone(currentTabs), active: currentActive });
    if (undoRef.current.length > 60) undoRef.current.shift();
    redoRef.current = [];
  }, []);

  const mutateTab = useCallback((fn: (t: SheetTab) => SheetTab) => {
    setTabs((ts) => {
      pushHistory(ts, active);
      return ts.map((t, i) => (i === active ? fn(t) : t));
    });
  }, [active, pushHistory]);

  /* load */
  useEffect(() => {
    let alive = true;
    (async () => {
      let raw: SheetData | null = null;
      try { if (api?.sheetLoad && workerId) raw = await api.sheetLoad(workerId); } catch { /* ignore */ }
      if (!raw && typeof window !== "undefined") {
        try { raw = JSON.parse(localStorage.getItem(`everfern_sheet_${workerId ?? "local"}`) || "null"); } catch { /* ignore */ }
      }
      if (!alive) return;
      const n = normalize(raw);
      setWorkbookName(n.name); setColumns(n.columns); setRows(n.rows); setTabs(n.tabs); setActive(n.active);
      setLoaded(true);
    })();
    return () => { alive = false; };
  }, [api, workerId]);

  /* persist */
  useEffect(() => {
    if (!loaded) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const data = buildSheetData(workbookName, columns, rows, tabs, active);
      try { localStorage.setItem(`everfern_sheet_${workerId ?? "local"}`, JSON.stringify(data)); } catch { /* ignore */ }
      try { if (api?.sheetSave && workerId) void api.sheetSave(workerId, data); } catch { /* ignore */ }
    }, 350);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [api, workerId, loaded, workbookName, columns, rows, tabs, active]);

  /* AI replay */
  const runQueue = useCallback(async () => {
    if (pumpingRef.current) return;
    pumpingRef.current = true;
    setAiBusy(true);
    while (queueRef.current.length) {
      const op = queueRef.current.shift()!;
      const fast = queueRef.current.length > 60;
      const pos = parseRef(op.ref);
      if (pos) { setSelA(pos); setSelB(pos); }
      requestAnimationFrame(() => document.querySelector(`[data-sheet-cell="${op.ref}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" }));
      if (fast || op.value.length > 120) {
        setActiveTyping({ ref: op.ref, typing: op.value, shown: op.value });
        await sleep(fast ? 18 : 220);
      } else {
        let shown = "";
        for (const ch of Array.from(op.value)) {
          shown += ch;
          setActiveTyping({ ref: op.ref, typing: op.value, shown });
          await sleep(16);
        }
      }
      setTabs((ts) => ts.map((t, i) => {
        if (i !== active) return t;
        const next = { ...t.cells };
        if (op.value === "") delete next[op.ref];
        else next[op.ref] = op.value;
        return { ...t, cells: next };
      }));
      await sleep(55);
      setActiveTyping(null);
    }
    setAiBusy(false);
    pumpingRef.current = false;
  }, [active]);

  const enqueue = useCallback((ops: Array<{ ref: string; value: string }>) => {
    if (!ops.length) return;
    queueRef.current.push(...ops);
    void runQueue();
  }, [runQueue]);

  useEffect(() => {
    const off = api?.onSheetCommand?.((cmd: SheetCommand) => {
      if (!cmd || typeof cmd !== "object") return;
      if (cmd.type === "load" && cmd.data?.cells) {
        const n = normalize(cmd.data);
        setWorkbookName(n.name); setColumns(n.columns); setRows(n.rows); setTabs(n.tabs); setActive(n.active);
        setNotice("Imported into Sheets");
        return;
      }
      if (cmd.type === "clear") { mutateTab((t) => ({ ...t, cells: {} })); return; }
      if (cmd.type === "apply" && Array.isArray(cmd.values)) {
        const start = parseRef(String(cmd.start || "A1")) ?? { r: 0, c: 0 };
        const ops: Array<{ ref: string; value: string }> = [];
        (cmd.values as unknown[][]).forEach((row, r) => {
          if (!Array.isArray(row)) return;
          row.forEach((value, c) => ops.push({ ref: cellRef(start.r + r, start.c + c), value: value == null ? "" : String(value) }));
        });
        enqueue(ops);
      }
    });
    return () => { try { off?.(); } catch { /* ignore */ } };
  }, [api, enqueue, mutateTab]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 2200);
    return () => clearTimeout(t);
  }, [notice]);

  /* editing + selection */
  const beginEdit = useCallback((r: number, c: number, initial?: string) => {
    setEditing({ r, c, draft: initial ?? cells[cellRef(r, c)] ?? "" });
  }, [cells]);

  const commitEdit = useCallback((r: number, c: number, value: string, move?: "down" | "right") => {
    mutateTab((t) => {
      const next = { ...t.cells };
      const ref = cellRef(r, c);
      if (value === "") delete next[ref];
      else next[ref] = value;
      return { ...t, cells: next };
    });
    setEditing(null);
    if (move === "down") setSelA({ r: Math.min(rows - 1, r + 1), c });
    if (move === "right") setSelA({ r, c: Math.min(columns - 1, c + 1) });
  }, [columns, mutateTab, rows]);

  const onCellKeyDown = (e: React.KeyboardEvent, r: number, c: number) => {
    if (editing) return;
    if (e.key === "Enter") { beginEdit(r, c); e.preventDefault(); return; }
    if (e.key === "Tab") { e.preventDefault(); setSelA({ r, c: Math.min(columns - 1, c + 1) }); setSelB({ r, c: Math.min(columns - 1, c + 1) }); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); const n = Math.min(rows - 1, r + 1); setSelA({ r: n, c }); setSelB({ r: n, c }); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); const n = Math.max(0, r - 1); setSelA({ r: n, c }); setSelB({ r: n, c }); return; }
    if (e.key === "ArrowLeft") { e.preventDefault(); const n = Math.max(0, c - 1); setSelA({ r, c: n }); setSelB({ r, c: n }); return; }
    if (e.key === "ArrowRight") { e.preventDefault(); const n = Math.min(columns - 1, c + 1); setSelA({ r, c: n }); setSelB({ r, c: n }); return; }
    if (e.key === "Backspace" || e.key === "Delete") { mutateTab((t) => { const n = { ...t.cells }; delete n[cellRef(r, c)]; return { ...t, cells: n }; }); e.preventDefault(); return; }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { beginEdit(r, c, e.key); e.preventDefault(); }
  };

  /* formatting */
  const applyStyle = useCallback((patch: CellStyle) => {
    mutateTab((t) => {
      const next = { ...t.styles };
      const q = rectOf(selA, selB);
      for (let r = q.r1; r <= q.r2; r++) {
        for (let c = q.c1; c <= q.c2; c++) {
          const ref = cellRef(r, c);
          const merged = { ...(next[ref] ?? {}), ...patch };
          const cleaned = Object.fromEntries(Object.entries(merged).filter(([, v]) => v !== false && v !== undefined && v !== "")) as CellStyle;
          if (Object.keys(cleaned).length) next[ref] = cleaned;
          else delete next[ref];
        }
      }
      return { ...t, styles: next };
    });
  }, [mutateTab, selA, selB]);

  const activeStyle = styles[selRef] ?? {};

  const mergeCells = () => {
    const q = rectOf(selA, selB);
    if (q.r1 === q.r2 && q.c1 === q.c2) return;
    mutateTab((t) => {
      const range = `${cellRef(q.r1, q.c1)}:${cellRef(q.r2, q.c2)}`;
      const merges = [...t.merges.filter((m) => m !== range), range];
      const next = { ...t.cells };
      for (let r = q.r1; r <= q.r2; r++) for (let c = q.c1; c <= q.c2; c++) if (!(r === q.r1 && c === q.c1)) delete next[cellRef(r, c)];
      return { ...t, cells: next, merges };
    });
  };

  const unmerge = () => {
    const q = rectOf(selA, selB);
    mutateTab((t) => ({ ...t, merges: t.merges.filter((m) => {
      const [a, b] = m.split(":");
      const p = parseRef(a), s = parseRef(b ?? a);
      if (!p || !s) return false;
      return !(p.r <= q.r2 && s.r >= q.r1 && p.c <= q.c2 && s.c >= q.c1);
    }) }));
  };

  /* structure */
  const insertRow = (before: boolean) => {
    const at = selA.r + (before ? 0 : 1);
    mutateTab((t) => {
      const next: Record<string, string> = {};
      const nextStyles: Record<string, CellStyle> = {};
      for (const [ref, value] of Object.entries(t.cells)) {
        const p = parseRef(ref); if (!p) continue;
        next[cellRef(p.r >= at ? p.r + 1 : p.r, p.c)] = value;
      }
      for (const [ref, value] of Object.entries(t.styles)) {
        const p = parseRef(ref); if (!p) continue;
        nextStyles[cellRef(p.r >= at ? p.r + 1 : p.r, p.c)] = value;
      }
      return { ...t, cells: next, styles: nextStyles };
    });
    setRows((n) => Math.min(2000, n + 1));
  };

  const deleteRow = () => {
    const at = selA.r;
    mutateTab((t) => {
      const next: Record<string, string> = {};
      const nextStyles: Record<string, CellStyle> = {};
      for (const [ref, value] of Object.entries(t.cells)) {
        const p = parseRef(ref); if (!p || p.r === at) continue;
        next[cellRef(p.r > at ? p.r - 1 : p.r, p.c)] = value;
      }
      for (const [ref, value] of Object.entries(t.styles)) {
        const p = parseRef(ref); if (!p || p.r === at) continue;
        nextStyles[cellRef(p.r > at ? p.r - 1 : p.r, p.c)] = value;
      }
      return { ...t, cells: next, styles: nextStyles };
    });
  };

  const insertCol = (before: boolean) => {
    const at = selA.c + (before ? 0 : 1);
    mutateTab((t) => {
      const next: Record<string, string> = {};
      const nextStyles: Record<string, CellStyle> = {};
      for (const [ref, value] of Object.entries(t.cells)) {
        const p = parseRef(ref); if (!p) continue;
        next[cellRef(p.r, p.c >= at ? p.c + 1 : p.c)] = value;
      }
      for (const [ref, value] of Object.entries(t.styles)) {
        const p = parseRef(ref); if (!p) continue;
        nextStyles[cellRef(p.r, p.c >= at ? p.c + 1 : p.c)] = value;
      }
      return { ...t, cells: next, styles: nextStyles };
    });
    setColumns((n) => Math.min(100, n + 1));
  };

  const deleteCol = () => {
    const at = selA.c;
    mutateTab((t) => {
      const next: Record<string, string> = {};
      const nextStyles: Record<string, CellStyle> = {};
      for (const [ref, value] of Object.entries(t.cells)) {
        const p = parseRef(ref); if (!p || p.c === at) continue;
        next[cellRef(p.r, p.c > at ? p.c - 1 : p.c)] = value;
      }
      for (const [ref, value] of Object.entries(t.styles)) {
        const p = parseRef(ref); if (!p || p.c === at) continue;
        nextStyles[cellRef(p.r, p.c > at ? p.c - 1 : p.c)] = value;
      }
      return { ...t, cells: next, styles: nextStyles };
    });
  };

  const sort = (dir: 1 | -1) => {
    const q = rectOf(selA, selB);
    const col = selA.c;
    mutateTab((t) => {
      const order = Array.from({ length: q.r2 - q.r1 + 1 }, (_, i) => q.r1 + i);
      const key = (r: number) => {
        const v = evaluateCell(t.cells, cellRef(r, col), new Set());
        const n = Number(v);
        return { num: Number.isFinite(n) && v !== "", n, s: String(v).toLowerCase() };
      };
      order.sort((a, b) => {
        const ka = key(a), kb = key(b);
        if (ka.num && kb.num) return (ka.n - kb.n) * dir;
        if (ka.num !== kb.num) return ka.num ? -1 : 1;
        return ka.s.localeCompare(kb.s) * dir;
      });
      const nextCells = { ...t.cells };
      const nextStyles = { ...t.styles };
      const lastCol = Math.max(columns, 1);
      for (let r = q.r1; r <= q.r2; r++) {
        for (let c = 0; c <= lastCol; c++) { delete nextCells[cellRef(r, c)]; delete nextStyles[cellRef(r, c)]; }
      }
      order.forEach((sourceRow, i) => {
        const target = q.r1 + i;
        for (let c = 0; c <= lastCol; c++) {
          const val = t.cells[cellRef(sourceRow, c)];
          if (val !== undefined) nextCells[cellRef(target, c)] = val;
          const st = t.styles[cellRef(sourceRow, c)];
          if (st) nextStyles[cellRef(target, c)] = st;
        }
      });
      return { ...t, cells: nextCells, styles: nextStyles };
    });
  };

  const undo = () => {
    const prev = undoRef.current.pop();
    if (!prev) return;
    redoRef.current.push({ tabs: structuredClone(tabs), active });
    setTabs(prev.tabs); setActive(prev.active);
  };
  const redo = () => {
    const next = redoRef.current.pop();
    if (!next) return;
    undoRef.current.push({ tabs: structuredClone(tabs), active });
    setTabs(next.tabs); setActive(next.active);
  };

  /* clipboard */
  const selectionTSV = () => {
    const q = rectOf(selA, selB);
    const lines: string[] = [];
    for (let r = q.r1; r <= q.r2; r++) {
      const row: string[] = [];
      for (let c = q.c1; c <= q.c2; c++) row.push(cellValue(cells, cellRef(r, c), new Set()));
      lines.push(row.join("\t"));
    }
    return lines.join("\n");
  };

  const copySelection = async () => {
    try { await navigator.clipboard.writeText(selectionTSV()); setNotice("Copied"); } catch { setNotice("Copy failed"); }
  };

  const cutSelection = async () => {
    await copySelection();
    mutateTab((t) => {
      const next = { ...t.cells };
      const q = rectOf(selA, selB);
      for (let r = q.r1; r <= q.r2; r++) for (let c = q.c1; c <= q.c2; c++) delete next[cellRef(r, c)];
      return { ...t, cells: next };
    });
  };

  const pasteSelection = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) return;
      const grid = parseDelimited(text);
      mutateTab((t) => {
        const next = { ...t.cells };
        grid.forEach((row, r) => row.forEach((value, c) => {
          const ref = cellRef(selA.r + r, selA.c + c);
          if (value === "") delete next[ref];
          else next[ref] = value;
        }));
        return { ...t, cells: next };
      });
      setNotice(`Pasted ${grid.length} row(s)`);
    } catch { setNotice("Paste failed"); }
  };

  const fillDown = () => {
    const q = rectOf(selA, selB);
    if (q.r1 === q.r2) return;
    mutateTab((t) => {
      const next = { ...t.cells };
      for (let c = q.c1; c <= q.c2; c++) {
        const source = t.cells[cellRef(q.r1, c)] ?? "";
        for (let r = q.r1 + 1; r <= q.r2; r++) {
          if (source === "") delete next[cellRef(r, c)];
          else next[cellRef(r, c)] = source;
        }
      }
      return { ...t, cells: next };
    });
  };

  const onGridKeyDown = (e: React.KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    const k = e.key.toLowerCase();
    if (k === "c") { e.preventDefault(); void copySelection(); }
    else if (k === "x") { e.preventDefault(); void cutSelection(); }
    else if (k === "v") { e.preventDefault(); void pasteSelection(); }
    else if (k === "d") { e.preventDefault(); fillDown(); }
    else if (k === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
    else if (k === "y" || (k === "z" && e.shiftKey)) { e.preventDefault(); redo(); }
    else if (k === "b") { e.preventDefault(); applyStyle({ b: !activeStyle.b }); }
    else if (k === "i") { e.preventDefault(); applyStyle({ i: !activeStyle.i }); }
    else if (k === "u") { e.preventDefault(); applyStyle({ u: !activeStyle.u }); }
  };

  /* import / export */
  const exportCSV = () => {
    const csv = toCSV(tab, rows, columns);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${workbookName.replace(/[^\w.-]+/g, "_") || "sheet"}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    setNotice("Exported CSV");
  };

  const importCSV = async (file: File) => {
    const text = await file.text();
    const grid = parseDelimited(text);
    const next: Record<string, string> = {};
    grid.forEach((row, r) => row.forEach((value, c) => { if (value !== "") next[cellRef(r, c)] = value; }));
    mutateTab((t) => ({ ...t, cells: next, merges: [] }));
    setColumns(Math.max(DEFAULT_COLUMNS, grid.reduce((m, r) => Math.max(m, r.length), 0)));
    setRows(Math.max(DEFAULT_ROWS, grid.length));
    setWorkbookName(file.name.replace(/\.[^.]+$/, "") || "Sheet1");
    setNotice(`Imported ${grid.length} row(s)`);
  };

  /* tabs */
  const addTab = () => {
    if (tabs.length >= 20) return;
    pushHistory(tabs, active);
    const next = [...tabs, blankTab(`Sheet${tabs.length + 1}`)];
    setTabs(next); setActive(next.length - 1);
  };
  const deleteTab = (index: number) => {
    if (tabs.length <= 1) return;
    pushHistory(tabs, active);
    const next = tabs.filter((_, i) => i !== index);
    setTabs(next); setActive(Math.max(0, Math.min(next.length - 1, active >= index ? active - 1 : active)));
  };
  const renameTab = (index: number, name: string) => {
    setTabs((ts) => ts.map((t, i) => (i === index ? { ...t, name } : t)));
  };

  /* column resize */
  const startResize = (c: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = tab.colWidths[String(c)] ?? BASE_COL_WIDTH;
    const move = (ev: PointerEvent) => {
      const w = Math.max(40, Math.min(600, startW + ev.clientX - startX));
      setTabs((ts) => ts.map((t, i) => (i === active ? { ...t, colWidths: { ...t.colWidths, [c]: w } } : t)));
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /* merge map */
  const mergeMap = useMemo(() => {
    const map: Record<string, { rs: number; cs: number } | "covered"> = {};
    for (const m of tab.merges) {
      const [a, b] = m.split(":");
      const p = parseRef(a), q = parseRef(b ?? a);
      if (!p || !q) continue;
      const r1 = Math.min(p.r, q.r), r2 = Math.max(p.r, q.r), c1 = Math.min(p.c, q.c), c2 = Math.max(p.c, q.c);
      map[cellRef(r1, c1)] = { rs: r2 - r1 + 1, cs: c2 - c1 + 1 };
      for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) if (!(r === r1 && c === c1)) map[cellRef(r, c)] = "covered";
    }
    return map;
  }, [tab.merges]);

  const showChart = () => {
    const q = rectOf(selA, selB);
    const labels: string[] = [];
    const values: number[] = [];
    for (let r = q.r1; r <= q.r2; r++) {
      const label = cellValue(cells, cellRef(r, q.c1), new Set()) || String(r + 1);
      let value = Number(cellValue(cells, cellRef(r, q.c1 + (q.c2 > q.c1 ? 1 : 0)), new Set()));
      if (!Number.isFinite(value)) value = r - q.r1 + 1;
      labels.push(label); values.push(value);
    }
    setChart({ type: "bar", labels: labels.slice(0, 24), values: values.slice(0, 24) });
  };

  const displayRows = Math.min(rows, 150);
  const displayCols = Math.min(columns, 24);

  return (
    <div className="wk-sheets" data-worker-app="sheets">
      <div className="wk-sheets-bar">
        <div className="wk-sheets-title">
          <span className="wk-sheets-logo">▦</span>
          <input aria-label="Workbook name" className="wk-sheets-name" value={workbookName} onChange={(e) => setWorkbookName(e.target.value)} />
        </div>
        <div className="wk-sheets-formula">
          <span>{selRef}</span>
          <input
            aria-label="Formula bar"
            value={editing && editing.r === selA.r && editing.c === selA.c ? editing.draft : selRaw}
            onChange={(e) => setEditing({ r: selA.r, c: selA.c, draft: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") { commitEdit(selA.r, selA.c, (e.target as HTMLInputElement).value, "down"); }
              if (e.key === "Escape") setEditing(null);
            }}
            onBlur={() => { if (editing) commitEdit(selA.r, selA.c, editing.draft); }}
          />
        </div>
        <div className="wk-sheets-actions">
          <button onClick={() => fileRef.current?.click()} title="Import CSV"><Upload size={13} /></button>
          <button onClick={exportCSV} title="Export CSV"><Download size={13} /></button>
          <button onClick={undo} title="Undo (Ctrl+Z)"><Undo2 size={13} /></button>
          <button onClick={redo} title="Redo (Ctrl+Y)"><Redo2 size={13} /></button>
        </div>
      </div>

      <div className="wk-sheets-format">
        <div className="wk-sheets-group">
          <button className={activeStyle.b ? "is-on" : ""} onClick={() => applyStyle({ b: !activeStyle.b })} title="Bold"><Bold size={13} /></button>
          <button className={activeStyle.i ? "is-on" : ""} onClick={() => applyStyle({ i: !activeStyle.i })} title="Italic"><Italic size={13} /></button>
          <button className={activeStyle.u ? "is-on" : ""} onClick={() => applyStyle({ u: !activeStyle.u })} title="Underline"><Underline size={13} /></button>
          <button className={activeStyle.s ? "is-on" : ""} onClick={() => applyStyle({ s: !activeStyle.s })} title="Strikethrough"><Strikethrough size={13} /></button>
        </div>
        <div className="wk-sheets-group">
          <label className="wk-sheets-color" title="Text colour"><input type="color" value={activeStyle.color ?? "#1c2421"} onChange={(e) => applyStyle({ color: e.target.value })} /><span>A</span></label>
          <label className="wk-sheets-color is-fill" title="Fill colour"><input type="color" value={activeStyle.bg ?? "#ffffff"} onChange={(e) => applyStyle({ bg: e.target.value })} /><span>▧</span></label>
        </div>
        <div className="wk-sheets-group">
          <button className={activeStyle.align === "left" ? "is-on" : ""} onClick={() => applyStyle({ align: "left" })} title="Align left"><AlignLeft size={13} /></button>
          <button className={activeStyle.align === "center" ? "is-on" : ""} onClick={() => applyStyle({ align: "center" })} title="Align centre"><AlignCenter size={13} /></button>
          <button className={activeStyle.align === "right" ? "is-on" : ""} onClick={() => applyStyle({ align: "right" })} title="Align right"><AlignRight size={13} /></button>
        </div>
        <select
          className="wk-sheets-select"
          aria-label="Number format"
          value={activeStyle.fmt ?? "general"}
          onChange={(e) => applyStyle({ fmt: e.target.value as NumberFormat })}
        >
          <option value="general">General</option>
          <option value="number">Number</option>
          <option value="currency">Currency</option>
          <option value="percent">Percent</option>
        </select>
        <select
          className="wk-sheets-select is-narrow"
          aria-label="Font size"
          value={activeStyle.fs ?? 12}
          onChange={(e) => applyStyle({ fs: Number(e.target.value) })}
        >
          {[9, 10, 11, 12, 13, 14, 16, 18, 20, 24].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <div className="wk-sheets-group">
          <button onClick={mergeCells} title="Merge cells"><Merge size={13} /></button>
          <button onClick={unmerge} title="Unmerge"><X size={13} /></button>
        </div>
        <div className="wk-sheets-group">
          <button onClick={() => sort(1)} title="Sort ascending"><ArrowUpDown size={13} /></button>
        </div>
        <div className="wk-sheets-group">
          <button onClick={() => insertRow(true)} title="Insert row above">R+</button>
          <button onClick={deleteRow} title="Delete row">R−</button>
          <button onClick={() => insertCol(true)} title="Insert column left">C+</button>
          <button onClick={deleteCol} title="Delete column">C−</button>
        </div>
        <div className="wk-sheets-group">
          <button onClick={showChart} title="Chart from selection"><ChartBar size={13} /></button>
          <button onClick={() => mutateTab((t) => ({ ...t, cells: {}, styles: {}, merges: [] }))} title="Clear sheet"><Eraser size={13} /></button>
        </div>
        <span className="wk-sheets-hint">{selRange}</span>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".csv,.tsv,.txt"
        style={{ display: "none" }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void importCSV(f); e.currentTarget.value = ""; }}
      />

      {(notice || aiBusy) && (
        <div className="wk-sheets-notice">
          {aiBusy && <span className="wk-sheets-ai"><Sparkles size={12} /> AI is working{activeTyping ? ` · typing ${activeTyping.ref}` : ""}</span>}
          {notice && <span className="wk-sheets-ok"><Check size={12} /> {notice}</span>}
        </div>
      )}

      <div className="wk-sheets-grid" ref={gridRef} tabIndex={0} onKeyDown={onGridKeyDown}>
        <table>
          <colgroup>
            <col style={{ width: 38 }} />
            {Array.from({ length: displayCols }, (_, c) => <col key={c} style={{ width: tab.colWidths[String(c)] ?? BASE_COL_WIDTH }} />)}
          </colgroup>
          <thead>
            <tr>
              <th className="wk-sheets-corner" />
              {Array.from({ length: displayCols }, (_, c) => (
                <th key={c} className={c === selA.c ? "is-sel" : ""}>
                  {colName(c)}
                  <span className="wk-sheets-resize" onPointerDown={startResize(c)} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: displayRows }, (_, r) => (
              <tr key={r} style={{ height: ROW_HEIGHT }}>
                <th className={r === selA.r ? "is-sel" : ""}>{r + 1}</th>
                {Array.from({ length: displayCols }, (_, c) => {
                  const ref = cellRef(r, c);
                  const merge = mergeMap[ref];
                  if (merge === "covered") return null;
                  const isSel = inRect(r, c, selA, selB);
                  const isActive = activeTyping?.ref === ref;
                  const isEditing = !!editing && editing.r === r && editing.c === c;
                  const style = styles[ref] ?? {};
                  const value = displayValue(cells, ref, style);
                  return (
                    <td
                      key={c}
                      data-sheet-cell={ref}
                      colSpan={merge ? merge.cs : undefined}
                      rowSpan={merge ? merge.rs : undefined}
                      className={`${isSel ? "is-sel" : ""}${isActive ? " is-ai" : ""}${merge ? " is-merged" : ""}`}
                      style={{
                        fontWeight: style.b ? 700 : undefined,
                        fontStyle: style.i ? "italic" : undefined,
                        textDecoration: [style.u ? "underline" : "", style.s ? "line-through" : ""].filter(Boolean).join(" ") || undefined,
                        color: style.color,
                        background: style.bg,
                        textAlign: style.align,
                        fontSize: style.fs ? `${style.fs}px` : undefined,
                      }}
                      onMouseDown={() => { dragSel.current = true; setSelA({ r, c }); setSelB({ r, c }); }}
                      onMouseEnter={() => { if (dragSel.current) setSelB({ r, c }); }}
                      onMouseUp={() => { dragSel.current = false; }}
                      onDoubleClick={() => beginEdit(r, c)}
                      tabIndex={-1}
                      onKeyDown={(e) => onCellKeyDown(e, r, c)}
                    >
                      {isEditing ? (
                        <input
                          autoFocus
                          className="wk-sheets-input"
                          value={editing.draft}
                          onChange={(e) => setEditing({ r, c, draft: e.target.value })}
                          onBlur={() => commitEdit(r, c, editing.draft)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") { commitEdit(r, c, editing.draft, "down"); e.preventDefault(); }
                            if (e.key === "Escape") setEditing(null);
                            if (e.key === "Tab") { commitEdit(r, c, editing.draft, "right"); e.preventDefault(); }
                          }}
                        />
                      ) : isActive ? (
                        <span className="wk-sheets-ghost">{activeTyping!.shown}<span className="wk-sheets-caret" /></span>
                      ) : value}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="wk-sheets-tabs">
        {tabs.map((t, i) => (
          <div key={t.id} className={`wk-sheets-tab${i === active ? " is-active" : ""}`}>
            <input
              aria-label={`Sheet ${i + 1}`}
              value={t.name}
              onChange={(e) => renameTab(i, e.target.value)}
              onFocus={() => { setActive(i); setSelA({ r: 0, c: 0 }); setSelB({ r: 0, c: 0 }); }}
            />
            {tabs.length > 1 && <button onClick={(e) => { e.stopPropagation(); deleteTab(i); }} aria-label={`Delete ${t.name}`}><X size={10} /></button>}
          </div>
        ))}
        <button className="wk-sheets-addtab" onClick={addTab} title="Add sheet"><Plus size={13} /></button>
      </div>

      {chart && (
        <div className="wk-sheets-chart" role="dialog" aria-label="Chart">
          <div className="wk-sheets-chart-head">
            <span>Chart</span>
            <div>
              <button className={chart.type === "bar" ? "is-on" : ""} onClick={() => setChart({ ...chart, type: "bar" })}>Bar</button>
              <button className={chart.type === "line" ? "is-on" : ""} onClick={() => setChart({ ...chart, type: "line" })}>Line</button>
              <button onClick={() => setChart(null)} aria-label="Close chart"><X size={12} /></button>
            </div>
          </div>
          <ChartSvg data={chart} />
        </div>
      )}
    </div>
  );
}

function ChartSvg({ data }: { data: { type: "bar" | "line"; labels: string[]; values: number[] } }) {
  const w = 520, h = 180, pad = 26;
  const max = Math.max(1, ...data.values);
  const n = data.values.length || 1;
  const slot = (w - pad * 2) / n;
  const y = (v: number) => h - pad - (v / max) * (h - pad * 2);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="wk-sheets-chart-svg" role="img" aria-label="Chart">
      <line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} stroke="#cfd8d3" />
      {data.type === "bar"
        ? data.values.map((v, i) => (
            <rect key={i} x={pad + i * slot + slot * 0.18} y={y(v)} width={slot * 0.64} height={Math.max(0, h - pad - y(v))} fill="#43d17a" rx={2} />
          ))
        : <polyline
            fill="none"
            stroke="#169c4b"
            strokeWidth={2}
            points={data.values.map((v, i) => `${pad + i * slot + slot / 2},${y(v)}`).join(" ")}
          />}
      {data.labels.map((l, i) => (
        <text key={i} x={pad + i * slot + slot / 2} y={h - 8} textAnchor="middle" fontSize={8} fill="#6b7a72">{l.slice(0, 8)}</text>
      ))}
    </svg>
  );
}
