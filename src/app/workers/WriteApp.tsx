"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  Bold, Italic, Underline, Strikethrough, AlignLeft, AlignCenter, AlignRight,
  List, ListOrdered, Undo2, Redo2, Download, FolderOpen, Save, Eraser,
} from "lucide-react";

/**
 * EverFern Write: the worker's native word processor. A single contenteditable page,
 * so the AI can drive it with worker_click / worker_type like any other native app.
 * The document is kept per worker in localStorage.
 */

type Doc = { name: string; html: string };

const keyFor = (workerId?: string) => `everfern_write_${workerId ?? "local"}`;

export function loadDoc(workerId?: string): Doc {
  try {
    const raw = localStorage.getItem(keyFor(workerId));
    if (raw) {
      const d = JSON.parse(raw) as Partial<Doc>;
      return { name: d.name || "Untitled", html: d.html || "" };
    }
  } catch { /* fall through */ }
  return { name: "Untitled", html: "" };
}

const exec = (cmd: string, value?: string) => {
  try { document.execCommand(cmd, false, value); } catch { /* unsupported */ }
};

export function WriteApp({ workerId }: { workerId?: string }) {
  const pageRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("Untitled");
  const [words, setWords] = useState(0);
  const [block, setBlock] = useState("p");
  const [marks, setMarks] = useState({ b: false, i: false, u: false, s: false });
  const [notice, setNotice] = useState("");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const count = () => {
    const text = pageRef.current?.innerText ?? "";
    setWords(text.trim() ? text.trim().split(/\s+/).length : 0);
  };

  useEffect(() => {
    const d = loadDoc(workerId);
    setName(d.name);
    if (pageRef.current) pageRef.current.innerHTML = d.html;
    count();
  }, [workerId]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 1800);
    return () => clearTimeout(t);
  }, [notice]);

  const persist = (docName = name) => {
    try { localStorage.setItem(keyFor(workerId), JSON.stringify({ name: docName, html: pageRef.current?.innerHTML ?? "" })); } catch { /* storage full */ }
  };
  const schedule = (docName = name) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => persist(docName), 400);
  };
  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  const syncState = () => {
    try {
      setMarks({
        b: document.queryCommandState("bold"),
        i: document.queryCommandState("italic"),
        u: document.queryCommandState("underline"),
        s: document.queryCommandState("strikeThrough"),
      });
      const v = String(document.queryCommandValue("formatBlock") || "p").toLowerCase().replace(/[<>]/g, "");
      setBlock(["h1", "h2", "h3"].includes(v) ? v : "p");
    } catch { /* not focused */ }
  };

  useEffect(() => {
    const onSel = () => {
      if (pageRef.current && document.activeElement === pageRef.current) syncState();
    };
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, []);

  const run = (cmd: string, value?: string) => {
    pageRef.current?.focus();
    exec(cmd, value);
    syncState();
    count();
    schedule();
  };

  const exportText = () => {
    const text = pageRef.current?.innerText ?? "";
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url; a.download = `${name || "Untitled"}.txt`; a.click();
    URL.revokeObjectURL(url);
  };

  const importText = async (f: File) => {
    const text = await f.text();
    if (!pageRef.current) return;
    if (/\.html?$/i.test(f.name)) pageRef.current.innerHTML = text;
    else pageRef.current.innerText = text;
    setName(f.name.replace(/\.[^.]+$/, ""));
    count();
    persist(f.name.replace(/\.[^.]+$/, ""));
    setNotice("Opened");
  };

  // Keep the toolbar's mousedown from stealing the page's selection.
  const keep = (e: React.MouseEvent) => e.preventDefault();

  return (
    <div className="wk-write" data-worker-app="write">
      <div className="wk-sh-top">
        <input aria-label="Document name" className="wk-sh-name" value={name}
          onChange={(e) => { setName(e.target.value); schedule(e.target.value); }} />
        <div className="wk-sh-history">
          <button onMouseDown={keep} onClick={() => run("undo")} aria-label="Undo" title="Undo (Ctrl+Z)"><Undo2 size={13} /></button>
          <button onMouseDown={keep} onClick={() => run("redo")} aria-label="Redo" title="Redo (Ctrl+Y)"><Redo2 size={13} /></button>
        </div>
        <div className="wk-sh-file">
          <div className="wk-sh-seg">
            <button onClick={() => fileRef.current?.click()} aria-label="Open file" title="Open a text or HTML file"><FolderOpen size={13} /></button>
            <button onClick={exportText} aria-label="Export as text" title="Export as text"><Download size={13} /></button>
          </div>
          <button className="wk-sh-save" onClick={() => { persist(); setNotice("Saved"); }}><Save size={12} /> Save</button>
        </div>
      </div>

      <div className="wk-sh-tools">
        <select className="wk-sh-select" aria-label="Paragraph style" value={block}
          onChange={(e) => run("formatBlock", e.target.value)}>
          <option value="p">Normal text</option>
          <option value="h1">Title</option>
          <option value="h2">Heading</option>
          <option value="h3">Subheading</option>
        </select>
        <div className="wk-sh-group">
          <button onMouseDown={keep} className={marks.b ? "is-on" : ""} onClick={() => run("bold")} aria-label="Bold" title="Bold"><Bold size={13} /></button>
          <button onMouseDown={keep} className={marks.i ? "is-on" : ""} onClick={() => run("italic")} aria-label="Italic" title="Italic"><Italic size={13} /></button>
          <button onMouseDown={keep} className={marks.u ? "is-on" : ""} onClick={() => run("underline")} aria-label="Underline" title="Underline"><Underline size={13} /></button>
          <button onMouseDown={keep} className={marks.s ? "is-on" : ""} onClick={() => run("strikeThrough")} aria-label="Strikethrough" title="Strikethrough"><Strikethrough size={13} /></button>
        </div>
        <div className="wk-sh-group">
          <button onMouseDown={keep} onClick={() => run("justifyLeft")} aria-label="Align left" title="Align left"><AlignLeft size={13} /></button>
          <button onMouseDown={keep} onClick={() => run("justifyCenter")} aria-label="Align centre" title="Align centre"><AlignCenter size={13} /></button>
          <button onMouseDown={keep} onClick={() => run("justifyRight")} aria-label="Align right" title="Align right"><AlignRight size={13} /></button>
        </div>
        <div className="wk-sh-group">
          <button onMouseDown={keep} onClick={() => run("insertUnorderedList")} aria-label="Bulleted list" title="Bulleted list"><List size={13} /></button>
          <button onMouseDown={keep} onClick={() => run("insertOrderedList")} aria-label="Numbered list" title="Numbered list"><ListOrdered size={13} /></button>
          <button onMouseDown={keep} onClick={() => run("removeFormat")} aria-label="Clear formatting" title="Clear formatting"><Eraser size={13} /></button>
        </div>
        <span className="wk-sh-status">
          <b>{notice || "Ready"}</b>
          <span>{words} {words === 1 ? "word" : "words"}</span>
        </span>
      </div>

      <input ref={fileRef} type="file" accept=".txt,.md,.html,.htm" style={{ display: "none" }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void importText(f); e.currentTarget.value = ""; }} />

      <div className="wk-write-scroll">
        <div
          ref={pageRef}
          className="wk-write-page"
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label="Document"
          data-placeholder="Start writing"
          spellCheck
          onInput={() => { count(); schedule(); }}
          onKeyUp={syncState}
          onMouseUp={syncState}
        />
      </div>
    </div>
  );
}
