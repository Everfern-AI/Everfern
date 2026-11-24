"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, ArrowRight, House, ChevronRight, LayoutGrid, List, Search, FileText, Download,
  Trash2, HardDrive, FolderPlus, FilePlus, PencilLine, FolderOpen, RotateCw, Save, X, Upload, HardDriveDownload,
} from "lucide-react";
import { NativeCursor, useNativeCursor, typeInto, sleep, pace, shq } from "./native-cursor";

/**
 * EverFern Files: a Finder-style window over the worker's workspace.
 * People use it like Finder. The AI drives it by name (files_action): each op has
 * already happened in the workspace, and this window replays it with the AI's
 * cursor: right-click, New Folder, type the name, Return.
 */

type Entry = { name: string; dir: boolean };
type Storage = { used: number; size: number; free: number };
type FileOp = { id: string; action: "create_folder" | "create_file" | "write_file" | "rename" | "move_to_trash" | "open"; path: string; to?: string | null; content?: string };
type Menu = { x: number; y: number; target: Entry | null };
type Naming = { original: string | null; draft: string; kind: "folder" | "file"; ai?: boolean };
type Binary = { size: number; mime: string; dataUrl?: string };
type Editor = { path: string; text: string; loading: boolean; dirty: boolean; note: string; ai?: boolean; binary?: Binary };

const TRASH = ".Trash";
const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);
const parentOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const baseOf = (p: string) => p.split("/").pop() || p;
const api = () => (typeof window !== "undefined" ? (window as any).electronAPI?.workers : undefined);
/** The folder Files last showed for a worker, so it opens there again. */
const cwdKey = (id?: string) => `everfern:files:cwd:${id ?? ""}`;
const savedCwd = (id?: string) => { try { return id ? localStorage.getItem(cwdKey(id)) ?? "" : ""; } catch { return ""; } };
const fmtBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const esc = (v: string) => (typeof CSS !== "undefined" && CSS.escape ? CSS.escape(v) : v.replace(/["\\]/g, "\\$&"));

const FAVORITES: { id: string; label: string; dir: string }[] = [
  { id: "home", label: "Home", dir: "" },
  { id: "documents", label: "Documents", dir: "Documents" },
  { id: "downloads", label: "Downloads", dir: "Downloads" },
];

/** Kilobytes -> "1.4 GB". */
function fmtKb(kb: number) {
  const units = ["KB", "MB", "GB", "TB"];
  let v = kb, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

function FolderGlyph({ size = 64 }: { size?: number }) {
  return (
    <svg width={size} height={size * 0.8} viewBox="0 0 80 64" aria-hidden="true">
      <defs>
        <linearGradient id="wk-fd-back" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#62aef5" /><stop offset="1" stopColor="#3f8fe6" /></linearGradient>
        <linearGradient id="wk-fd-front" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#8cc8fb" /><stop offset="1" stopColor="#58a6f1" /></linearGradient>
      </defs>
      <path d="M6 10a6 6 0 0 1 6-6h17.5a6 6 0 0 1 4.4 1.9L37.6 10H68a6 6 0 0 1 6 6v6H6z" fill="url(#wk-fd-back)" />
      <rect x="4" y="17" width="72" height="44" rx="6" fill="url(#wk-fd-front)" />
      <rect x="4" y="17" width="72" height="2" rx="1" fill="#ffffff" opacity=".45" />
    </svg>
  );
}

function FileGlyph({ name, size = 64 }: { name: string; size?: number }) {
  const ext = name.includes(".") ? name.split(".").pop()!.slice(0, 4).toUpperCase() : "";
  return (
    <svg width={size * 0.78} height={size} viewBox="0 0 50 64" aria-hidden="true">
      <path d="M6 2h26l14 14v42a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V6a4 4 0 0 1 4-4z" fill="#fff" stroke="#d5dbe3" strokeWidth="1.5" />
      <path d="M32 2v10a4 4 0 0 0 4 4h10" fill="#eef2f7" stroke="#d5dbe3" strokeWidth="1.5" strokeLinejoin="round" />
      {[24, 30, 36].map((y) => <rect key={y} x="10" y={y} width={y === 36 ? 18 : 28} height="2.4" rx="1.2" fill="#dfe4eb" />)}
      {ext && <text x="25" y="53" textAnchor="middle" fontSize="9" fontWeight="700" fill="#3b7ddd" fontFamily="Satoshi, Inter, sans-serif">{ext}</text>}
    </svg>
  );
}

export function FilesApp({ workerId }: { workerId?: string }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const cursor = useNativeCursor(rootRef);

  const [storage, setStorage] = useState<Storage | null>(null);
  const [cwd, setCwd] = useState(() => savedCwd(workerId));
  const [back, setBack] = useState<string[]>([]);
  const [fwd, setFwd] = useState<string[]>([]);
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState("");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [naming, setNaming] = useState<Naming | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [ghosts, setGhosts] = useState<Entry[]>([]);
  const [leaving, setLeaving] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [aiBusy, setAiBusy] = useState(false);

  const cwdRef = useRef(cwd); cwdRef.current = cwd;
  const entriesRef = useRef(entries); entriesRef.current = entries;
  const busyRef = useRef(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const w = api();
  const ready = Boolean(w?.vmLs && workerId);

  const load = useCallback(async (dir: string = cwdRef.current) => {
    if (!w?.vmLs || !workerId) { setError("Files live on the worker's computer in the EverFern desktop app."); setEntries([]); return [] as Entry[]; }
    let r: { files?: string[]; error?: string } | null;
    try {
      r = await Promise.race([
        w.vmLs(workerId, dir || undefined),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error("The worker's computer is taking too long to answer.")), 20000)),
      ]);
    } catch (e) { r = { error: e instanceof Error ? e.message : String(e) }; }
    if (!alive.current || dir !== cwdRef.current) return [] as Entry[];
    if (r?.error) { setError(String(r.error)); setEntries([]); return [] as Entry[]; }
    const list: Entry[] = (r?.files ?? [])
      .filter((f: string) => f && f !== "./" && f !== "../" && !f.startsWith("."))
      .map((f: string) => ({ name: f.replace(/\/$/, ""), dir: f.endsWith("/") }));
    setError("");
    setEntries(list);
    return list;
  }, [w, workerId]);

  // First open: make the Finder favourites real folders.
  useEffect(() => {
    if (!ready) { void load(""); return; }
    // Folder list and the folder setup run side by side, so a slow setup never blocks the list.
    const start = cwdRef.current;
    const first = async () => {
      await load(start);
      // The remembered folder was removed: open Home instead.
      if (start && cwdRef.current === start && !entriesRef.current?.length) {
        const r = await w.vmExec(workerId!, `test -d ${shq(start)}`).catch(() => null);
        if (r && r.exitCode !== 0 && alive.current && cwdRef.current === start) { setCwd(""); cwdRef.current = ""; setError(""); await load(""); }
      }
    };
    void first();
    void w.vmExec(workerId!, `mkdir -p Documents Downloads ${TRASH}`).catch(() => undefined).then(() => load());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, workerId]);

  // Pick up files the worker writes some other way, unless the AI or the user is mid-gesture.
  useEffect(() => {
    if (!ready) return;
    const t = setInterval(() => {
      // Re-arms the watcher too (a no-op while it runs; it ends if the VM went idle).
      void Promise.resolve(w?.filesWatch?.(workerId, cwdRef.current)).catch(() => undefined);
      if (!busyRef.current && !naming && !menu) void load();
    }, 15000);
    return () => clearInterval(t);
  }, [ready, naming, menu, load]);

  // Live: main watches the folder on show and says the moment it changes (a download,
  // a command in Terminal, the AI writing a file), so the window updates like Finder.
  const quietRef = useRef(false); quietRef.current = Boolean(naming || menu);
  useEffect(() => {
    if (!ready || !w?.onFilesChanged) return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const off = w.onFilesChanged((ev: { workerId: string; subpath?: string }) => {
      if (ev?.workerId !== workerId) return;
      if (ev.subpath !== undefined && ev.subpath !== null && ev.subpath !== cwdRef.current) return;
      if (t) clearTimeout(t);
      t = setTimeout(() => { if (!busyRef.current && !quietRef.current) void load(); }, 120);
    });
    return () => { if (t) clearTimeout(t); off?.(); };
  }, [ready, w, workerId, load]);
  useEffect(() => {
    if (!ready || !w?.filesWatch) return;
    void Promise.resolve(w.filesWatch(workerId, cwd)).catch(() => undefined);
    try { localStorage.setItem(cwdKey(workerId), cwd); } catch { /* private mode */ }
  }, [ready, w, workerId, cwd]);
  useEffect(() => () => { if (workerId) void Promise.resolve(api()?.filesUnwatch?.(workerId)).catch(() => undefined); }, [workerId]);

  // Storage comes from the worker's machine: space the workspace uses, and the disk it sits on.
  useEffect(() => {
    if (!ready) return;
    let on = true;
    const read = async () => {
      try {
        const r = await w.vmExec(workerId!, "du -sk . 2>/dev/null | cut -f1; df -Pk . | tail -1");
        const [du, df] = String(r?.stdout ?? "").trim().split("\n");
        const cols = (df ?? "").trim().split(/\s+/);
        const used = Number(du), size = Number(cols[1]), free = Number(cols[3]);
        if (on && Number.isFinite(used) && size > 0) setStorage({ used, size, free: Number.isFinite(free) ? free : 0 });
      } catch { /* the meter just stays hidden */ }
    };
    void read();
    const t = setInterval(read, 30_000);
    return () => { on = false; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, workerId]);

  const openDir = useCallback(async (dir: string, record = true) => {
    if (record && dir !== cwdRef.current) { setBack((b) => [...b, cwdRef.current].slice(-50)); setFwd([]); }
    setCwd(dir); cwdRef.current = dir;
    setSelected(null); setQuery(""); setMenu(null);
    setEntries(null);
    return load(dir);
  }, [load]);

  const goBack = () => {
    const prev = back[back.length - 1];
    if (prev === undefined) return;
    setBack((b) => b.slice(0, -1)); setFwd((f) => [...f, cwdRef.current]);
    void openDir(prev, false);
  };
  const goFwd = () => {
    const next = fwd[fwd.length - 1];
    if (next === undefined) return;
    setFwd((f) => f.slice(0, -1)); setBack((b) => [...b, cwdRef.current]);
    void openDir(next, false);
  };

  const openFile = useCallback(async (path: string, ai = false, blank = false) => {
    setMenu(null);
    setEditor({ path, text: "", loading: !blank, dirty: false, note: "", ai });
    if (blank || !w?.vmRead || !workerId) return;
    let r: any;
    try {
      r = await Promise.race([
        w.vmRead(workerId, path),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error("The worker's computer is taking too long to open this file.")), 30000)),
      ]);
    } catch (e) { r = { error: e instanceof Error ? e.message : String(e) }; }
    if (!alive.current) return;
    const binary: Binary | undefined = r?.binary ? { size: Number(r.size) || 0, mime: String(r.mime || "application/octet-stream"), dataUrl: r.dataUrl } : undefined;
    setEditor((e) => (e && e.path === path ? { ...e, loading: false, binary, text: binary ? "" : r?.content ?? "", note: r?.error ? String(r.error) : "" } : e));
  }, [w, workerId]);

  const addFromComputer = async () => {
    setMenu(null);
    if (!w?.vmImport || !workerId) return;
    const r = await w.vmImport(workerId, cwdRef.current || undefined);
    if (r?.error) setError(String(r.error));
    await load();
  };
  const saveToComputer = async (path: string) => {
    setMenu(null);
    if (!w?.vmExport || !workerId) return;
    const r = await w.vmExport(workerId, path);
    if (r?.error) setEditor((e) => (e && e.path === path ? { ...e, note: String(r.error) } : e));
  };

  const run = async (cmd: string) => {
    if (!w?.vmExec || !workerId) return { exitCode: -1, stderr: "Unavailable", stdout: "" };
    return w.vmExec(workerId, cmd);
  };

  /* ── user actions ─────────────────────────────────────────── */

  const startNew = (kind: "folder" | "file") => {
    setMenu(null);
    setNaming({ original: null, draft: kind === "folder" ? "untitled folder" : "untitled.txt", kind });
  };

  const commitNaming = async () => {
    const n = naming;
    if (!n || n.ai) return;
    setNaming(null);
    const name = n.draft.trim();
    if (!name || name.includes("/") || name === "." || name === "..") return;
    if (n.original === null) {
      const p = join(cwdRef.current, name);
      await run(n.kind === "folder" ? `mkdir -p -- ${shq(p)}` : `test -e ${shq(p)} || : > ${shq(p)}`);
    } else if (name !== n.original) {
      await run(`mv -n -- ${shq(join(cwdRef.current, n.original))} ${shq(join(cwdRef.current, name))}`);
    }
    await load();
    setSelected(name);
  };

  const trash = async (e: Entry) => {
    setMenu(null);
    const p = join(cwdRef.current, e.name);
    if (cwdRef.current === TRASH || cwdRef.current.startsWith(`${TRASH}/`)) {
      if (!window.confirm(`Delete "${e.name}" permanently? This cannot be undone.`)) return;
      await run(`rm -rf -- ${shq(p)}`);
    } else {
      await run(`mkdir -p ${TRASH} && d=${shq(`${TRASH}/${e.name}`)} && { test -e "$d" && d="$d.$(date +%s)"; mv -- ${shq(p)} "$d"; }`);
    }
    await load();
  };

  const emptyTrash = async () => {
    setMenu(null);
    if (!window.confirm("Empty the Trash? Everything in it is deleted permanently.")) return;
    await run(`rm -rf ${TRASH} && mkdir -p ${TRASH}`);
    await load();
  };

  const open = (e: Entry) => {
    const p = join(cwdRef.current, e.name);
    if (e.dir) void openDir(p);
    else void openFile(p);
  };

  const saveEditor = async () => {
    if (!editor || !w?.vmWrite || !workerId) return;
    setEditor((e) => (e ? { ...e, note: "Saving" } : e));
    const r = await w.vmWrite(workerId, editor.path, editor.text);
    setEditor((e) => (e ? { ...e, dirty: r?.ok ? false : e.dirty, note: r?.ok ? "Saved" : String(r?.error ?? "Could not save") } : e));
  };

  const showMenu = (ev: React.MouseEvent, target: Entry | null) => {
    ev.preventDefault();
    if (busyRef.current) return;
    const r = rootRef.current?.getBoundingClientRect();
    if (!r) return;
    setSelected(target?.name ?? null);
    setMenu({ x: Math.min(ev.clientX - r.left, r.width - 200), y: Math.min(ev.clientY - r.top, r.height - 170), target });
  };

  /* ── AI replay ────────────────────────────────────────────── */

  const q = (sel: string) => rootRef.current?.querySelector(sel) ?? null;
  const waitFor = async (sel: string, ms = 2000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { const el = q(sel); if (el) return el; await sleep(60); }
    return null;
  };
  const tileSel = (name: string) => `[data-ef-file="${esc(name)}"]`;

  /** A free spot in the folder view to right-click on, plus where its menu opens. */
  const emptySpot = () => {
    const root = rootRef.current?.getBoundingClientRect();
    const main = mainRef.current?.getBoundingClientRect();
    if (!root || !main) return { pt: { x: 0.6, y: 0.7 }, px: { x: 200, y: 200 } };
    const x = main.left + main.width * 0.66 - root.left;
    const y = main.top + Math.min(main.height - 60, Math.max(150, main.height * 0.6)) - root.top;
    return { pt: { x: x / root.width, y: y / root.height }, px: { x: Math.min(x, root.width - 200), y: Math.min(y, root.height - 170) } };
  };
  const menuAt = (el: Element | null, target: Entry | null) => {
    const root = rootRef.current?.getBoundingClientRect();
    const r = el?.getBoundingClientRect();
    if (!root || !r) return;
    setMenu({ x: Math.min(r.left + r.width / 2 - root.left, root.width - 200), y: Math.min(r.top + r.height / 2 - root.top, root.height - 170), target });
  };

  /** Walk to `dir` the way a person would: a sidebar favourite, then double-click folders. */
  const navigate = async (dir: string) => {
    if (cwdRef.current === dir) { if (!entriesRef.current) await load(dir); return; }
    const segs = dir ? dir.split("/") : [];
    const fav = segs[0] === "Documents" || segs[0] === "Downloads" ? segs[0] : "";
    let at = fav;
    const inside = (dir === cwdRef.current || dir.startsWith(cwdRef.current ? `${cwdRef.current}/` : ""));
    if (inside && cwdRef.current.length >= fav.length) {
      at = cwdRef.current;
    } else {
      const side = q(`[data-nav="${fav ? fav.toLowerCase() : "home"}"]`);
      await cursor.moveTo(side, "Click", { at: "left" });
      await cursor.click();
      await openDir(fav);
    }
    const rest = (at ? dir.slice(at.length).replace(/^\//, "") : dir).split("/").filter(Boolean);
    for (const seg of rest) {
      const tile = await waitFor(tileSel(seg));
      if (tile) { await cursor.moveTo(tile, "Double-click"); await cursor.click("Double-click", 2); }
      at = join(at, seg);
      await openDir(at);
      await sleep(pace(200));
    }
  };

  const replay = async (op: FileOp) => {
    const name = baseOf(op.path);
    const dir = parentOf(op.path);
    const labels: Record<FileOp["action"], string> = {
      create_folder: `Creating folder ${name}`, create_file: `Creating ${name}`, write_file: `Writing ${name}`,
      rename: `Renaming ${name}`, move_to_trash: `Moving ${name} to Trash`, open: `Opening ${name}`,
    };
    cursor.say("Move", labels[op.action]);
    setMenu(null); setNaming(null);
    if (editor && op.action !== "write_file") setEditor(null);

    // The op already happened; keep its result out of view until the cursor has done it.
    if (op.action === "create_folder" || op.action === "create_file") setHidden((h) => new Set(h).add(op.path));
    const toName = op.to ? baseOf(op.to) : "";
    const sameDir = op.to ? parentOf(op.to) === dir : true;
    if (op.action === "rename" && op.to && sameDir) setHidden((h) => new Set(h).add(op.to!));

    await navigate(dir);
    let list = entriesRef.current ?? (await load(dir));

    if (op.action === "rename" || op.action === "move_to_trash") {
      if (!list.some((e) => e.name === name)) {
        const isDir = op.to ? (list.find((e) => e.name === toName)?.dir ?? false) : false;
        setGhosts([{ name, dir: isDir }]);
        await sleep(60);
      }
    }

    if (op.action === "create_folder" || op.action === "create_file") {
      const kind = op.action === "create_folder" ? "folder" : "file";
      const spot = emptySpot();
      await cursor.moveTo(spot.pt, "Right-click");
      await cursor.click("Right-click");
      setMenu({ ...spot.px, target: null });
      await sleep(pace(260));
      await cursor.moveTo(await waitFor(`[data-menu="new-${kind}"]`), "Click", { at: "left", dwell: 420 });
      await cursor.click();
      setMenu(null);
      setNaming({ original: null, draft: kind === "folder" ? "untitled folder" : "untitled.txt", kind, ai: true });
      const field = await waitFor("[data-ef-naming]");
      await cursor.moveTo(field, "Type", { dwell: 380 });
      await typeInto(name, (v) => setNaming((n) => (n ? { ...n, draft: v } : n)), "", 120, () => !alive.current);
      cursor.say("Return");
      await sleep(pace(320));
      setNaming(null);
      setHidden((h) => { const n = new Set(h); n.delete(op.path); return n; });
      list = await load(dir);
      setSelected(name);
      if (op.action === "create_file" && op.content) {
        const tile = await waitFor(tileSel(name));
        await cursor.moveTo(tile, "Double-click");
        await cursor.click("Double-click", 2);
        await typeIntoEditor(op.path, op.content);
      }
    } else if (op.action === "write_file") {
      const tile = await waitFor(tileSel(name));
      if (tile) { await cursor.moveTo(tile, "Double-click"); await cursor.click("Double-click", 2); }
      await typeIntoEditor(op.path, op.content ?? "");
    } else if (op.action === "rename") {
      const tile = await waitFor(tileSel(name));
      await cursor.moveTo(tile, "Right-click");
      await cursor.click("Right-click");
      menuAt(tile, { name, dir: false });
      await sleep(pace(260));
      await cursor.moveTo(await waitFor('[data-menu="rename"]'), "Click", { at: "left", dwell: 420 });
      await cursor.click();
      setMenu(null);
      setNaming({ original: name, draft: name, kind: "file", ai: true });
      await sleep(pace(200));
      cursor.say("Type");
      await typeInto(sameDir ? toName : name, (v) => setNaming((n) => (n ? { ...n, draft: v } : n)), "", 120, () => !alive.current);
      cursor.say("Return");
      await sleep(pace(320));
      setNaming(null); setGhosts([]);
      if (op.to) setHidden((h) => { const n = new Set(h); n.delete(op.to!); return n; });
      await load(dir);
      setSelected(sameDir ? toName : null);
    } else if (op.action === "move_to_trash") {
      const tile = await waitFor(tileSel(name));
      await cursor.moveTo(tile, "Right-click");
      await cursor.click("Right-click");
      menuAt(tile, { name, dir: false });
      await sleep(pace(260));
      await cursor.moveTo(await waitFor('[data-menu="trash"]'), "Click", { at: "left", dwell: 420 });
      await cursor.click();
      setMenu(null);
      setLeaving(name);
      await sleep(pace(380));
      setLeaving(null); setGhosts([]);
      await load(dir);
    } else if (op.action === "open") {
      const tile = await waitFor(tileSel(name));
      if (tile) { await cursor.moveTo(tile, "Double-click"); await cursor.click("Double-click", 2); }
      const entry = (entriesRef.current ?? []).find((e) => e.name === name);
      if (entry?.dir) await openDir(op.path);
      else await openFile(op.path, true);
      await sleep(pace(500));
    }
  };

  const typeIntoEditor = async (path: string, text: string) => {
    await openFile(path, true, true);
    const area = await waitFor("[data-ef-editor]");
    await cursor.moveTo(area, "Click", { dwell: 380 });
    await cursor.click();
    cursor.say("Type");
    await typeInto(text, (v) => setEditor((e) => (e ? { ...e, text: v, dirty: false } : e)), "", 360, () => !alive.current);
    const save = await waitFor("[data-ef-save]");
    await cursor.moveTo(save, "Click", { dwell: 380 });
    await cursor.click();
    setEditor((e) => (e ? { ...e, note: "Saved", ai: false } : e));
  };

  const queue = useRef<FileOp[]>([]);
  const replayRef = useRef(replay); replayRef.current = replay;
  const drain = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true; setAiBusy(true);
    try {
      while (queue.current.length && alive.current) {
        const op = queue.current.shift()!;
        try { await replayRef.current(op); } catch { /* a failed replay must not stop the next one */ }
        await sleep(pace(240));
      }
    } finally {
      busyRef.current = false;
      if (alive.current) { setAiBusy(false); setHidden(new Set()); setGhosts([]); cursor.hide(); void load(); }
    }
  }, [cursor, load]);

  useEffect(() => {
    const off = w?.onFilesCommand?.((op: FileOp) => {
      if (!op || typeof op.path !== "string") return;
      queue.current.push(op);
      void drain();
    });
    return () => { if (typeof off === "function") off(); };
  }, [w, drain]);

  // Cursor follows the editor caret area while the AI types; keep the caret at the end.
  useEffect(() => {
    const el = editorRef.current;
    if (el && editor?.ai) el.scrollTop = el.scrollHeight;
  }, [editor?.text, editor?.ai]);

  /* ── render ───────────────────────────────────────────────── */

  const inTrash = cwd === TRASH || cwd.startsWith(`${TRASH}/`);
  const shown = useMemo(() => {
    const base = (entries ?? []).filter((e) => !hidden.has(join(cwd, e.name)));
    const merged = [...base, ...ghosts.filter((g) => !base.some((e) => e.name === g.name))];
    const filtered = query.trim() ? merged.filter((e) => e.name.toLowerCase().includes(query.trim().toLowerCase())) : merged;
    return filtered.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.dir ? -1 : 1));
  }, [entries, hidden, ghosts, cwd, query]);
  const folders = shown.filter((e) => e.dir).length;
  const files = shown.length - folders;

  const crumbs = useMemo(() => {
    if (inTrash) return [{ label: "Trash", dir: TRASH as string | null }, ...cwd.split("/").slice(1).map((s, i, a) => ({ label: s, dir: [TRASH, ...a.slice(0, i + 1)].join("/") as string | null }))];
    return [{ label: "Home", dir: "" as string | null }, ...(cwd ? cwd.split("/") : []).map((s, i, a) => ({ label: s, dir: a.slice(0, i + 1).join("/") as string | null }))];
  }, [cwd, inTrash]);

  const activeNav = inTrash ? "trash" : cwd === "" ? "home" : cwd === "Documents" ? "documents" : cwd === "Downloads" ? "downloads" : "";

  const nameField = (n: Naming) => (
    <input
      className="wk-fi-naming"
      data-ef-naming=""
      value={n.draft}
      autoFocus={!n.ai}
      readOnly={n.ai}
      spellCheck={false}
      aria-label={n.original ? `Rename ${n.original}` : `Name the new ${n.kind}`}
      onFocus={(e) => { const dot = n.kind === "file" ? e.target.value.lastIndexOf(".") : -1; e.target.setSelectionRange(0, dot > 0 ? dot : e.target.value.length); }}
      onChange={(e) => setNaming({ ...n, draft: e.target.value })}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") void commitNaming(); if (e.key === "Escape") setNaming(null); }}
      onBlur={() => { if (!n.ai) void commitNaming(); }}
      onClick={(e) => e.stopPropagation()}
    />
  );

  const item = (e: Entry) => {
    const renamingThis = naming && naming.original === e.name;
    return (
      <div
        key={e.name}
        role="listitem"
        tabIndex={0}
        className={`wk-fi-item${selected === e.name ? " is-sel" : ""}${leaving === e.name ? " is-leaving" : ""}`}
        data-ef-file={e.name}
        data-ef-kind={e.dir ? "folder" : "file"}
        onClick={(ev) => { ev.stopPropagation(); setSelected(e.name); setMenu(null); }}
        onDoubleClick={() => !busyRef.current && open(e)}
        onContextMenu={(ev) => showMenu(ev, e)}
        onKeyDown={(ev) => {
          if (busyRef.current) return;
          if (ev.key === "Enter") { ev.preventDefault(); setNaming({ original: e.name, draft: e.name, kind: e.dir ? "folder" : "file" }); }
          if (ev.key === "Delete" || (ev.key === "Backspace" && (ev.metaKey || ev.ctrlKey))) void trash(e);
          if (ev.key === "o" && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); open(e); }
        }}
        title={e.name}
      >
        <span className="wk-fi-glyph">{e.dir ? <FolderGlyph size={view === "grid" ? 64 : 20} /> : <FileGlyph name={e.name} size={view === "grid" ? 56 : 18} />}</span>
        {renamingThis ? nameField(naming!) : <span className="wk-fi-name">{e.name}</span>}
        {view === "list" && <span className="wk-fi-kind">{e.dir ? "Folder" : e.name.includes(".") ? `${e.name.split(".").pop()!.toUpperCase()} file` : "Document"}</span>}
      </div>
    );
  };

  return (
    <div ref={rootRef} className={`wk-fi${aiBusy ? " is-ai" : ""}`} data-worker-app="files" onClick={() => setMenu(null)}>
      <aside className="wk-fi-side" aria-label="Sidebar">
        <p className="wk-fi-side-h">Favorites</p>
        {FAVORITES.map((f) => (
          <button
            key={f.id}
            data-nav={f.id}
            className={`wk-fi-nav${activeNav === f.id ? " is-on" : ""}`}
            onClick={() => void openDir(f.dir)}
          >
            {f.id === "home" ? <House size={17} /> : f.id === "documents" ? <FileText size={17} /> : <Download size={17} />}
            <span>{f.label}</span>
          </button>
        ))}
        <div className="wk-fi-side-foot">
          <button data-nav="trash" className={`wk-fi-nav${activeNav === "trash" ? " is-on" : ""}`} onClick={() => void openDir(TRASH)}>
            <Trash2 size={17} /><span>Trash</span>
          </button>
          {storage && (
            <div className="wk-fi-storage" title={`${fmtKb(storage.free)} free on the worker's disk`}>
              <div className="wk-fi-storage-h"><HardDrive size={14} /><span>Worker storage</span></div>
              <div className="wk-fi-storage-bar"><i style={{ width: `${Math.min(100, Math.max(2, (storage.used / storage.size) * 100))}%` }} /></div>
              <span className="wk-fi-storage-note">{fmtKb(storage.used)} used · {fmtKb(storage.free)} free</span>
            </div>
          )}
        </div>
      </aside>

      <section className="wk-fi-main">
        <header className="wk-fi-bar">
          <div className="wk-fi-hist">
            <button onClick={goBack} disabled={!back.length || aiBusy} aria-label="Back" title="Back"><ArrowLeft size={15} /></button>
            <button onClick={goFwd} disabled={!fwd.length || aiBusy} aria-label="Forward" title="Forward"><ArrowRight size={15} /></button>
          </div>
          <button className="wk-fi-icon" onClick={() => void openDir("")} disabled={aiBusy} aria-label="Home" title="Home"><House size={15} /></button>
          <nav className="wk-fi-crumbs" aria-label="Path">
            {crumbs.map((c, i) => (
              <React.Fragment key={`${c.label}-${i}`}>
                {i > 0 && <ChevronRight size={12} className="wk-fi-crumb-sep" />}
                <button className={`wk-fi-crumb${i === crumbs.length - 1 ? " is-last" : ""}`} disabled={c.dir === null || aiBusy}
                  onClick={() => c.dir !== null && void openDir(c.dir)}>{c.label}</button>
              </React.Fragment>
            ))}
          </nav>
          <div className="wk-fi-tools">
            <div className="wk-fi-seg" role="group" aria-label="View">
              <button className={view === "grid" ? "is-on" : ""} onClick={() => setView("grid")} aria-label="Icons" title="Icons"><LayoutGrid size={14} /></button>
              <button className={view === "list" ? "is-on" : ""} onClick={() => setView("list")} aria-label="List" title="List"><List size={14} /></button>
            </div>
            <label className="wk-fi-search">
              <Search size={13} />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" aria-label="Search this folder" spellCheck={false} />
            </label>
          </div>
        </header>

        <div
          ref={mainRef}
          className={`wk-fi-view is-${view}`}
          onContextMenu={(ev) => showMenu(ev, null)}
          onClick={() => { setSelected(null); setMenu(null); }}
        >
          {error ? (
            <div className="wk-fi-empty"><strong>Can't open this folder</strong><span>{error}</span>
              <button className="wk-fi-btn" onClick={() => void load()}><RotateCw size={13} /> Try again</button></div>
          ) : entries === null ? (
            <div className="wk-fi-empty"><span>Loading</span></div>
          ) : !shown.length && !naming ? (
            <div className="wk-fi-empty">
              <strong>{query ? "No matches" : inTrash ? "Trash is empty" : "This folder is empty"}</strong>
              {!query && !inTrash && <span>Right-click to make a folder or file. Files the worker creates show up here.</span>}
            </div>
          ) : (
            <div className="wk-fi-items" role="list">
              {shown.map(item)}
              {naming && naming.original === null && (
                <div className="wk-fi-item is-sel is-new" role="listitem">
                  <span className="wk-fi-glyph">{naming.kind === "folder" ? <FolderGlyph size={view === "grid" ? 64 : 20} /> : <FileGlyph name={naming.draft} size={view === "grid" ? 56 : 18} />}</span>
                  {nameField(naming)}
                </div>
              )}
            </div>
          )}
        </div>

        <footer className="wk-fi-foot">
          {`${folders} ${folders === 1 ? "folder" : "folders"} · ${files} ${files === 1 ? "file" : "files"}`}
          {inTrash && files + folders > 0 && <button className="wk-fi-link" onClick={() => void emptyTrash()} disabled={aiBusy}>Empty Trash</button>}
        </footer>

        {editor && (
          <div className="wk-fi-editor" role="dialog" aria-label={`Edit ${baseOf(editor.path)}`} onClick={(e) => e.stopPropagation()}>
            <div className="wk-fi-editor-bar">
              <FileGlyph name={baseOf(editor.path)} size={18} />
              <strong>{baseOf(editor.path)}</strong>
              {editor.dirty && <span className="wk-fi-dot" aria-label="Unsaved changes" />}
              <span className="wk-fi-note">{editor.note}</span>
              {editor.binary
                ? <button className="wk-fi-btn" onClick={() => void saveToComputer(editor.path)}><HardDriveDownload size={13} /> Save to computer</button>
                : <button className="wk-fi-btn is-primary" data-ef-save="" onClick={() => void saveEditor()} disabled={editor.ai || !editor.dirty}><Save size={13} /> Save</button>}
              <button className="wk-fi-icon" onClick={() => setEditor(null)} disabled={editor.ai} aria-label="Close file" title="Close"><X size={15} /></button>
            </div>
            {editor.loading
              ? <div className="wk-fi-empty"><span>Loading</span></div>
              : editor.binary ? (
                <div className="wk-fi-preview">
                  {editor.binary.dataUrl && editor.binary.mime.startsWith("image/") ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={editor.binary.dataUrl} alt={baseOf(editor.path)} />
                  ) : editor.binary.dataUrl && editor.binary.mime === "application/pdf" ? (
                    <iframe src={editor.binary.dataUrl} title={baseOf(editor.path)} />
                  ) : (
                    <div className="wk-fi-empty">
                      <FileGlyph name={baseOf(editor.path)} size={64} />
                      <strong>{baseOf(editor.path)}</strong>
                      <span>{editor.binary.mime} · {fmtBytes(editor.binary.size)}</span>
                      <span>This file can't be shown here. Apps can still upload it, or you can save it to your computer.</span>
                    </div>
                  )}
                </div>
              ) : (
                <textarea
                  ref={editorRef}
                  data-ef-editor=""
                  className="wk-fi-text"
                  value={editor.text}
                  readOnly={editor.ai}
                  spellCheck={false}
                  aria-label="File contents"
                  onChange={(e) => setEditor({ ...editor, text: e.target.value, dirty: true, note: "" })}
                  onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); void saveEditor(); } }}
                />
              )}
          </div>
        )}
      </section>

      {menu && (
        <div className="wk-fi-menu" role="menu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          {menu.target ? (
            <>
              <button role="menuitem" data-menu="open" onClick={() => { const t = menu.target!; setMenu(null); open(t); }}><FolderOpen size={14} /> Open</button>
              {!menu.target.dir && <button role="menuitem" data-menu="export" onClick={() => void saveToComputer(join(cwdRef.current, menu.target!.name))}><HardDriveDownload size={14} /> Save to Computer...</button>}
              <button role="menuitem" data-menu="rename" onClick={() => { const t = menu.target!; setMenu(null); setNaming({ original: t.name, draft: t.name, kind: t.dir ? "folder" : "file" }); }}><PencilLine size={14} /> Rename</button>
              <hr />
              <button role="menuitem" data-menu="trash" className="is-danger" onClick={() => void trash(menu.target!)}><Trash2 size={14} /> {inTrash ? "Delete Immediately" : "Move to Trash"}</button>
            </>
          ) : (
            <>
              {!inTrash && <button role="menuitem" data-menu="new-folder" onClick={() => startNew("folder")}><FolderPlus size={14} /> New Folder</button>}
              {!inTrash && <button role="menuitem" data-menu="new-file" onClick={() => startNew("file")}><FilePlus size={14} /> New File</button>}
              {!inTrash && <button role="menuitem" data-menu="import" onClick={() => void addFromComputer()}><Upload size={14} /> Add Files from Computer...</button>}
              {inTrash && <button role="menuitem" data-menu="empty-trash" className="is-danger" onClick={() => void emptyTrash()}><Trash2 size={14} /> Empty Trash</button>}
              <hr />
              <button role="menuitem" data-menu="refresh" onClick={() => { setMenu(null); void load(); }}><RotateCw size={14} /> Refresh</button>
            </>
          )}
        </div>
      )}

      <NativeCursor cur={cursor.cur} />
    </div>
  );
}
