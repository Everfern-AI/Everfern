"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import type { Terminal as XTerm } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { RotateCw } from "lucide-react";
import { NativeCursor, useNativeCursor, sleep, pace } from "./native-cursor";

/**
 * EverFern Terminal: a real terminal on the worker's computer.
 * xterm.js draws a PTY running bash in the worker's workspace, so full-screen
 * programs (btop, htop, vim, less) render the way they do in any Linux terminal.
 * When the AI runs a command with terminal_run, the cursor clicks in, types it,
 * presses Return and the output appears here.
 */

type Line = { kind: "cmd" | "out" | "err" | "note"; text: string; cwd?: string };
type TermEvent = { id: string; type: "start"; command: string } | { id: string; type: "result"; stdout: string; stderr: string; exitCode: number };
type Result = Extract<TermEvent, { type: "result" }>;
type Status = { state: "starting" | "live" | "exited" | "error"; note: string };

const api = () => (typeof window !== "undefined" ? (window as any).electronAPI?.workers : undefined);
const crlf = (s: string) => s.replace(/\r?\n/g, "\r\n");

/** The last screenful per worker: the 3D-stack preview reads it. */
export const terminalTail = new Map<string, { lines: Line[]; cwd: string }>();
export type TerminalLine = Line;

const THEME = {
  background: "#00000000",
  foreground: "#e7ebef",
  cursor: "#e7ebef",
  cursorAccent: "#101418",
  selectionBackground: "rgba(96, 165, 250, 0.38)",
  black: "#1d2126", red: "#ff7b72", green: "#8fd18f", yellow: "#e3c46b",
  blue: "#6cb6ff", magenta: "#d2a8ff", cyan: "#76e3ea", white: "#d7dde3",
  brightBlack: "#6e7681", brightRed: "#ffa198", brightGreen: "#b4ecb4", brightYellow: "#f2d98f",
  brightBlue: "#9ccbff", brightMagenta: "#e2c5ff", brightCyan: "#a5f0f4", brightWhite: "#ffffff",
};

export function TerminalApp({ workerId }: { workerId?: string }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const ptyRef = useRef<string | null>(null);
  const cursor = useNativeCursor(rootRef);
  const w = api();

  const [status, setStatus] = useState<Status>({ state: "starting", note: "" });
  const [title, setTitle] = useState("bash");
  const [attempt, setAttempt] = useState(0);
  const [aiBusy, setAiBusy] = useState(false);
  const aiRef = useRef(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  /* ── The terminal and its PTY ── */

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !w?.ptyOpen || !workerId) { setStatus({ state: "error", note: "The worker's terminal runs in the EverFern desktop app." }); return; }
    let disposed = false;
    const cleanup: Array<() => void> = [];
    setStatus({ state: "starting", note: "" });

    void (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([import("@xterm/xterm"), import("@xterm/addon-fit")]);
      if (disposed) return;
      const term = new Terminal({
        allowTransparency: true,
        cursorBlink: true,
        fontFamily: '"SF Mono", "JetBrains Mono", Menlo, Consolas, ui-monospace, monospace',
        fontSize: 12.5,
        lineHeight: 1.15,
        scrollback: 5000,
        macOptionIsMeta: true,
        theme: THEME,
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(host);
      try { fit.fit(); } catch { /* not laid out yet */ }
      termRef.current = term;
      cleanup.push(() => { termRef.current = null; term.dispose(); });

      const offData = w.onPtyData?.((ev: { id: string; data: string }) => { if (ev?.id && ev.id === ptyRef.current) term.write(ev.data); });
      const offExit = w.onPtyExit?.((ev: { id: string }) => {
        if (!ev?.id || ev.id !== ptyRef.current) return;
        ptyRef.current = null;
        term.write("\r\n\x1b[2m[Process completed]\x1b[0m\r\n");
        if (alive.current) setStatus({ state: "exited", note: "" });
      });
      cleanup.push(() => { if (typeof offData === "function") offData(); if (typeof offExit === "function") offExit(); });

      const onInput = term.onData((d) => { if (!aiRef.current && ptyRef.current) w.ptyWrite(ptyRef.current, d); });
      const onBinary = term.onBinary((d) => { if (!aiRef.current && ptyRef.current) w.ptyWrite(ptyRef.current, d); });
      const onSize = term.onResize(({ cols, rows }) => { if (ptyRef.current) w.ptyResize(ptyRef.current, cols, rows); });
      const onTitle = term.onTitleChange((t) => { if (alive.current && t) setTitle(t); });
      cleanup.push(() => { onInput.dispose(); onBinary.dispose(); onSize.dispose(); onTitle.dispose(); });

      let raf = 0;
      const ro = new ResizeObserver(() => {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => { try { fit.fit(); } catch { /* hidden */ } });
      });
      ro.observe(host);
      cleanup.push(() => { cancelAnimationFrame(raf); ro.disconnect(); });

      // The 3D-stack preview shows the last rows of the screen.
      const tail = setInterval(() => {
        const b = term.buffer.active;
        const rows: string[] = [];
        for (let i = b.baseY + b.cursorY; i >= 0 && rows.length < 9; i--) rows.unshift(b.getLine(i)?.translateToString(true) ?? "");
        while (rows.length && !rows[0].trim()) rows.shift();
        terminalTail.set(workerId, { lines: rows.map((text) => ({ kind: "out" as const, text })), cwd: "" });
      }, 1500);
      cleanup.push(() => clearInterval(tail));

      const r = await w.ptyOpen(workerId, term.cols, term.rows).catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }));
      if (disposed) return;
      if (!r || r.error || !r.id) { setStatus({ state: "error", note: r?.error || "The terminal did not start." }); return; }
      ptyRef.current = r.id;
      if (r.backlog) term.write(r.backlog);
      setStatus({ state: "live", note: "" });
      term.focus();
    })();

    return () => {
      disposed = true;
      ptyRef.current = null;
      // The shell keeps running on the worker's computer; reopening the window reattaches.
      for (const fn of cleanup.reverse()) { try { fn(); } catch { /* already gone */ } }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workerId, attempt]);

  /* ── AI replay: click into the terminal, type, Return, show the output ── */

  const results = useRef(new Map<string, Result>());
  const waiters = useRef(new Map<string, (r: Result) => void>());
  const queue = useRef<string[][]>([]);
  const busyRef = useRef(false);

  const awaitResult = (id: string, ms = 10 * 60_000) => new Promise<Result | null>((resolve) => {
    const have = results.current.get(id);
    if (have) { results.current.delete(id); resolve(have); return; }
    const t = setTimeout(() => { waiters.current.delete(id); resolve(null); }, ms);
    waiters.current.set(id, (r) => { clearTimeout(t); waiters.current.delete(id); resolve(r); });
  });

  /** Where the text cursor is, as a 0-1 point inside the app. */
  const caretPoint = () => {
    const term = termRef.current, root = rootRef.current;
    const screen = hostRef.current?.querySelector(".xterm-screen") ?? hostRef.current;
    if (!term || !root || !screen) return { x: 0.5, y: 0.5 };
    const s = screen.getBoundingClientRect(), r = root.getBoundingClientRect();
    const b = term.buffer.active;
    const cw = s.width / Math.max(1, term.cols), ch = s.height / Math.max(1, term.rows);
    return {
      x: (s.left + (b.cursorX + 0.5) * cw - r.left) / Math.max(1, r.width),
      y: (s.top + (b.cursorY + 0.5) * ch - r.top) / Math.max(1, r.height),
    };
  };

  const replay = async (id: string, command: string) => {
    const term = termRef.current;
    // A full-screen program owns the screen: leave it alone and just wait.
    const fullScreen = term?.buffer.active.type === "alternate";
    cursor.say("Move", `Running ${command.length > 48 ? `${command.slice(0, 48)}…` : command}`);
    await cursor.moveTo(caretPoint(), "Click", { dwell: 480 });
    await cursor.click();
    aiRef.current = true;
    try {
      if (term && !fullScreen) {
        cursor.say("Type");
        const step = Math.max(8, Math.min(45, Math.round(2400 / Math.max(1, command.length))));
        for (const ch of command) {
          if (!alive.current) return;
          term.write(ch === "\n" ? "\r\n> " : ch);
          await sleep(pace(step));
        }
        await sleep(pace(180));
      }
      cursor.say("Return");
      const r = await awaitResult(id);
      if (!alive.current) return;
      if (!term || fullScreen) return;
      if (command.trim() === "clear") { term.clear(); }
      else if (!r) term.write("\r\n\x1b[2m(no result: the command is still running or was stopped)\x1b[0m");
      else {
        const out = (r.stdout || "").replace(/\n+$/, "");
        const err = (r.stderr || "").replace(/\n+$/, "");
        if (out) term.write("\r\n" + crlf(out));
        if (err) term.write("\r\n\x1b[31m" + crlf(err) + "\x1b[0m");
      }
      // Ctrl+U, Return: the shell drops any half-typed line and prints a fresh prompt below.
      if (ptyRef.current) w?.ptyWrite?.(ptyRef.current, "\x15\r");
      await sleep(pace(260));
    } finally {
      aiRef.current = false;
    }
  };

  const replayRef = useRef(replay); replayRef.current = replay;
  const drain = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true; setAiBusy(true);
    try {
      while (queue.current.length && alive.current) {
        const [id, command] = queue.current.shift()!;
        try { await replayRef.current(id, command); } catch { /* keep going */ }
      }
    } finally {
      busyRef.current = false;
      if (alive.current) { setAiBusy(false); cursor.hide(); termRef.current?.focus(); }
    }
  }, [cursor]);

  useEffect(() => {
    const off = w?.onTerminalCommand?.((ev: TermEvent) => {
      if (!ev || !ev.id) return;
      if (ev.type === "start" && typeof ev.command === "string") { queue.current.push([ev.id, ev.command]); void drain(); return; }
      if (ev.type === "result") {
        const fn = waiters.current.get(ev.id);
        if (fn) fn(ev); else results.current.set(ev.id, ev);
      }
    });
    return () => { if (typeof off === "function") off(); };
  }, [w, drain]);

  return (
    <div ref={rootRef} className={`wk-tm${aiBusy ? " is-ai" : ""}`} data-worker-app="terminal">
      <div className="wk-tm-title" aria-hidden="true">worker — {title}</div>
      <div className="wk-tm-xterm" ref={hostRef} onMouseDown={() => termRef.current?.focus()} />
      {status.state !== "live" && (
        <div className={`wk-tm-status is-${status.state}`} role="status">
          {status.state === "starting" && <span>Starting the shell</span>}
          {status.state === "error" && <span>{status.note || "The terminal did not start."}</span>}
          {(status.state === "exited" || status.state === "error") && (
            <button onClick={() => setAttempt((n) => n + 1)}><RotateCw size={12} /> {status.state === "exited" ? "New session" : "Try again"}</button>
          )}
        </div>
      )}
      <NativeCursor cur={cursor.cur} />
    </div>
  );
}
