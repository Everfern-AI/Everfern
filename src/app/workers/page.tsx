"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowRight, ArrowUp, ArrowUpRight, Check, ChevronUp, LayoutGrid, List, MessageCircle,
  MessageSquareOff, MessageSquare, Pause, Play, Plus, X, Zap, Pencil, CalendarClock,
} from "lucide-react";
import WindowControls from "../components/WindowControls";
import { ALPS_PHOTOS, photoUrl } from "../components/onboarding/GlassShell";
import { AppLogo, AppLogoCluster } from "@/components/AppLogo";
import { APPS } from "@/lib/apps";
import { FEATURED_TEMPLATES, WORKER_TEMPLATES, type WorkerTemplate } from "@/lib/worker-templates";
import { TIERS, newWorker, orbBackground, useWorkers, type Worker } from "@/lib/workers";
import { AppsSheet, TemplateCard, TemplatesSheet, registerCustomApps } from "./Sheets";
import { WorkerDesktop, windowsForApps, type Win } from "./Desktop";
import "./workers.css";

type Mode = "home" | "tier" | "template" | "desktop";
type Sheet = null | "apps" | "templates";
type Msg =
  | { kind: "user"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "ai"; text: string }
  | { kind: "flow"; steps: string[] }
  | { kind: "schedule" };

const EASE = [0.16, 1, 0.3, 1] as const;
const swap = {
  initial: { opacity: 0, y: 14, filter: "blur(8px)" },
  animate: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.55, ease: EASE, staggerChildren: 0.06 } },
  exit: { opacity: 0, y: -10, filter: "blur(6px)", transition: { duration: 0.25, ease: EASE } },
};
const rise = { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE } } };

const parseSteps = (prompt: string) => {
  const lines = prompt.split(/\n+/).map((l) => l.replace(/^\s*(\d+[.)]|[-*•])\s*/, "").trim()).filter(Boolean);
  return lines.length ? lines : [prompt.trim()];
};
const nameFrom = (prompt: string) => {
  const first = parseSteps(prompt)[0] ?? "New worker";
  const words = first.split(/\s+/).slice(0, 4).join(" ");
  return words.length > 26 ? `${words.slice(0, 26)}…` : words;
};

function Avatar({ w, size = 30 }: { w: Pick<Worker, "hue" | "status">; size?: number }) {
  return (
    <span className="wk-avatar" style={{ width: size, height: size, background: orbBackground(w.hue) }}>
      {w.status === "running" && <span className="wk-dot is-running" />}
      {w.status === "paused" && <span className="wk-dot is-paused" />}
    </span>
  );
}

/* ═════════════════════════════════════════════════════════════════ */

export default function WorkersPage() {
  const router = useRouter();
  const { workers, ready, save, remove } = useWorkers();
  const [mode, setMode] = useState<Mode>("home");
  const [draft, setDraft] = useState<Worker | null>(null); // unsaved worker during creation
  const [activeId, setActiveId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [wins, setWins] = useState<Win[]>([]);
  const [promptOpen, setPromptOpen] = useState(false);
  const [promptText, setPromptText] = useState("");
  const [chats, setChats] = useState<Record<string, Msg[]>>({});
  const [chatHidden, setChatHidden] = useState(false);
  const timers = useRef<number[]>([]);

  useEffect(() => { registerCustomApps(); return () => timers.current.forEach(clearTimeout); }, []);

  const active: Worker | null = draft && draft.id === activeId ? draft : workers.find((w) => w.id === activeId) ?? null;
  const msgs = (activeId && chats[activeId]) || [];

  const update = useCallback((w: Worker) => {
    if (draft && draft.id === w.id) setDraft(w);
    else save(w);
  }, [draft, save]);

  const later = (fn: () => void, ms: number) => { timers.current.push(window.setTimeout(fn, ms)); };

  /* ── flow ─────────────────────────────────────────────────────── */
  const startNew = () => {
    const w = newWorker();
    setDraft(w); setActiveId(w.id); setSheet(null); setPromptOpen(false); setWins([]);
    setMode("tier");
  };

  const discardDraft = () => {
    setDraft(null); setActiveId(null); setMode("home"); setPromptOpen(false);
  };

  const commitDraft = (patch: Partial<Worker>) => {
    if (!draft) return null;
    const w: Worker = { ...draft, ...patch, status: "idle" };
    save(w); setDraft(null); setActiveId(w.id);
    return w;
  };

  const pickTemplate = (t: WorkerTemplate) => {
    setSheet(null);
    const fresh = !!draft || !active;
    const base = draft ?? active ?? newWorker();
    const apps = Array.from(new Set([...t.apps, ...(fresh ? ["files"] : base.apps)]));
    const w: Worker = { ...base, apps, templateId: t.id, name: fresh ? t.title : base.name, status: fresh ? "idle" : base.status };
    save(w); setDraft(null); setActiveId(w.id);
    setWins(windowsForApps(t.apps));
    setPromptText(t.prompt);
    setPromptOpen(false);
    setMode("desktop");
    later(() => setPromptOpen(true), 900);
  };

  const startBlank = () => {
    const w = commitDraft({});
    if (!w) return;
    setWins([]); setPromptText(""); setMode("desktop");
    later(() => setPromptOpen(true), 500);
  };

  const openWorker = (w: Worker) => {
    if (draft) setDraft(null);
    setActiveId(w.id); setSheet(null); setPromptOpen(false);
    setWins(windowsForApps(w.apps.filter((a) => a !== "files" || w.apps.length === 1)));
    if (!chats[w.id] && w.prompt) {
      setChats((c) => ({ ...c, [w.id]: [{ kind: "user", text: w.prompt }, { kind: "flow", steps: parseSteps(w.prompt) }] }));
    }
    setMode("desktop");
  };

  const push = (id: string, ...m: Msg[]) => setChats((c) => ({ ...c, [id]: [...(c[id] ?? []).filter((x) => x.kind !== "thinking"), ...m] }));

  const submitPrompt = () => {
    const text = promptText.trim();
    if (!text || !active) return;
    const id = active.id;
    const steps = parseSteps(text);
    update({ ...active, prompt: text, name: active.templateId ? active.name : active.name === "New worker" ? nameFrom(text) : active.name });
    setPromptOpen(false); setChatHidden(false);
    push(id, { kind: "user", text }, { kind: "thinking", text: "Thinking it through" });
    later(() => push(id,
      { kind: "ai", text: steps.length > 1 ? `Got it. I turned that into ${steps.length} steps. Check them, then run it now or put it on a schedule.` : "Got it. Check the step, then run it now or put it on a schedule." },
      { kind: "flow", steps },
    ), 1500);
  };

  const run = () => {
    if (!active) return;
    update({ ...active, status: "running" });
    push(active.id, { kind: "thinking", text: `Starting: ${parseSteps(active.prompt)[0] ?? "first step"}` });
  };
  const stop = (w: Worker) => {
    update({ ...w, status: w.status === "running" ? "paused" : "idle" });
    setChats((c) => ({ ...c, [w.id]: [...(c[w.id] ?? []).filter((x) => x.kind !== "thinking"), { kind: "ai", text: "Paused. Pick it back up whenever you like." }] }));
  };
  const schedule = (label: string) => {
    if (!active) return;
    update({ ...active, status: "idle" });
    push(active.id, { kind: "ai", text: `Scheduled: ${label}. I'll run on my own and tell you when I need you.` });
  };

  const toggleApp = (id: string) => {
    if (!active) return;
    const on = active.apps.includes(id);
    update({ ...active, apps: on ? active.apps.filter((a) => a !== id) : [...active.apps, id] });
    if (mode === "desktop") setWins((ws) => (on ? ws.filter((w) => w.app !== id) : [...ws, { app: id, min: true, max: false, z: 1 }]));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (sheet) setSheet(null);
      else if (promptOpen) setPromptOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheet, promptOpen]);

  const sharp = mode === "desktop" && !sheet;
  const running = active?.status === "running";

  /* ── render ───────────────────────────────────────────────────── */
  return (
    <div className="ef-shell wk">
      <div className="ef-shell-titlebar">
        <div className="ef-shell-controls"><WindowControls /></div>
      </div>

      <motion.div className="ef-screen" initial={{ opacity: 0, scale: 0.985 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.9, ease: EASE }}>
        <div className="ef-screen-fallback" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={photoUrl(ALPS_PHOTOS.lake)}
          alt=""
          aria-hidden
          draggable={false}
          className="ef-screen-photo wk-photo"
          style={{
            filter: sharp ? "blur(0px) saturate(110%)" : `blur(${mode === "desktop" ? 14 : 26}px) brightness(0.92) saturate(125%)`,
            transform: `scale(${sharp ? 1.02 : 1.1})`,
          }}
          onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")}
        />
        <div className="ef-screen-tint" style={{ opacity: sharp ? 0.45 : 1, transition: "opacity .6s" }} />

        {/* notch dock */}
        <div className="ef-notch" style={{ gap: 4 }}>
          <button className="wk-notch-btn" style={{ width: "auto", padding: "0 6px 0 2px", gap: 6 }} onClick={() => { setMode("home"); setSheet(null); setPromptOpen(false); setDraft(null); setActiveId(null); }} aria-label="All workers">
            <Image src="/images/logos/black-logo-withoutbg.png" alt="" width={26} height={26} priority style={{ margin: "-4px" }} />
            <span className="ef-notch-word">everfern</span>
          </button>
          <span className="wk-notch-sep" />
          <button className="wk-notch-btn" onClick={() => setSheet(sheet === "apps" ? null : "apps")} aria-label="Apps" title="Apps"><LayoutGrid size={15} /></button>
          <button className="wk-notch-btn" onClick={() => router.push("/chat")} aria-label="Ask EverFern" title="Ask EverFern"><MessageCircle size={15} /></button>
        </div>

        {/* worker computer */}
        {mode === "desktop" && <WorkerDesktop wins={wins} setWins={setWins} hideThumbs={!!sheet} />}

        {/* creation + home screens */}
        <AnimatePresence mode="wait">
          {mode !== "desktop" && (
            <motion.div key={mode} className="ef-glass ef-screen-content" {...swap}>
              {mode === "home" && <Home ready={ready} workers={workers} onOpen={openWorker} onNew={startNew} onDelete={remove} />}
              {mode === "tier" && draft && (
                <TierStep value={draft.tier} onChange={(tier) => setDraft({ ...draft, tier })} onContinue={() => setMode("template")} />
              )}
              {mode === "template" && (
                <TemplateStep onPick={pickTemplate} onAll={() => setSheet("templates")} onBlank={startBlank} />
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* chat column */}
        {mode === "desktop" && !chatHidden && msgs.length > 0 && !sheet && (
          <motion.div className="wk-chat-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} />
        )}
        {mode === "desktop" && !chatHidden && msgs.length > 0 && !sheet && (
          <Chat msgs={msgs} running={running} onRun={run} onEdit={() => { setPromptText(active?.prompt ?? ""); setPromptOpen(true); }} onSchedule={schedule} />
        )}

        {/* side rail + sheets */}
        <AnimatePresence>
          {sheet && (
            <>
              <motion.div key="scrim" className="wk-scrim" onClick={() => setSheet(null)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
              <motion.nav key="rail" className="wk-rail wk-glass" initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0, transition: { duration: 0.4, ease: EASE } }} exit={{ opacity: 0, x: -12 }}>
                <button className={sheet === "apps" ? "is-on" : ""} onClick={() => setSheet("apps")} aria-label="Apps" title="Apps"><LayoutGrid size={16} /></button>
                <button className={sheet === "templates" ? "is-on" : ""} onClick={() => setSheet("templates")} aria-label="Templates" title="Templates"><List size={16} /></button>
              </motion.nav>
              {sheet === "apps" ? (
                <AppsSheet key="apps" installed={active?.apps ?? []} canInstall={!!active} onToggle={toggleApp} onClose={() => setSheet(null)} />
              ) : (
                <TemplatesSheet key="templates" onPick={pickTemplate} onClose={() => setSheet(null)} />
              )}
            </>
          )}
        </AnimatePresence>

        {/* prompt card */}
        <AnimatePresence>
          {promptOpen && active && (
            <PromptCard
              worker={active}
              text={promptText}
              setText={setPromptText}
              onSubmit={submitPrompt}
              onClose={() => setPromptOpen(false)}
              onApps={() => setSheet("apps")}
            />
          )}
        </AnimatePresence>
      </motion.div>

      {/* bottom bar */}
      <div className="wk-bar">
        <div className="wk-bar-side">
          <button className="wk-lpill is-icon" onClick={startNew} aria-label="New worker" title="New worker"><Plus size={17} /></button>
          <div className="wk-workers-scroll">
            {draft && (
              <span className="wk-lpill is-active">
                <Avatar w={draft} />
                <span className="wk-lpill-name">New worker</span>
                <button className="wk-mini" onClick={discardDraft} aria-label="Discard new worker" title="Discard"><X size={13} /></button>
              </span>
            )}
            {workers.map((w) => (
              <span key={w.id} className={`wk-lpill${w.id === activeId && mode === "desktop" ? " is-active" : ""}`} onClick={() => openWorker(w)} role="button" tabIndex={0}
                onKeyDown={(e) => e.key === "Enter" && openWorker(w)}>
                <Avatar w={w} />
                <span className="wk-lpill-name">{w.name}</span>
                <button
                  className={`wk-mini${w.status === "running" ? " is-stop" : ""}`}
                  onClick={(e) => { e.stopPropagation(); if (w.status === "running") stop(w); else if (w.prompt) { openWorker(w); update({ ...w, status: "running" }); push(w.id, { kind: "thinking", text: `Starting: ${parseSteps(w.prompt)[0]}` }); } else openWorker(w); }}
                  aria-label={w.status === "running" ? `Pause ${w.name}` : `Run ${w.name}`}
                  title={w.status === "running" ? "Pause" : "Run"}
                >
                  {w.status === "running" ? <Pause size={12} fill="currentColor" strokeWidth={0} /> : <Play size={12} fill="currentColor" strokeWidth={0} style={{ marginLeft: 1 }} />}
                </button>
              </span>
            ))}
          </div>
        </div>

        <div>
          {mode === "desktop" && active ? (
            <div className="wk-chatpill" onClick={() => { if (!promptOpen) { setPromptText((t) => t || ""); setPromptOpen(true); } }} role="button" tabIndex={0}>
              <span className="wk-chatpill-text">
                {running ? `${active.name} is working…` : active.prompt ? "Suggest changes, or ask me something…" : "Hi, I'm ready. Which repetitive task should I take off your plate?"}
              </span>
              {msgs.length > 0 && (
                <button className="wk-mini" onClick={(e) => { e.stopPropagation(); setChatHidden((h) => !h); }} aria-label={chatHidden ? "Show chat" : "Hide chat"} title={chatHidden ? "Show chat" : "Hide chat"}>
                  {chatHidden ? <MessageSquare size={14} /> : <MessageSquareOff size={14} />}
                </button>
              )}
              <button className="wk-mini" onClick={(e) => { e.stopPropagation(); setPromptOpen((o) => !o); }} aria-label="Open prompt">
                <ChevronUp size={16} style={{ transform: promptOpen ? "rotate(180deg)" : "none", transition: "transform .28s" }} />
              </button>
            </div>
          ) : mode === "home" ? (
            <button className="wk-chatpill" onClick={startNew}>
              <span className="wk-chatpill-text">Describe a job for a new worker…</span>
              <span className="wk-mini"><ArrowRight size={15} /></span>
            </button>
          ) : null}
        </div>

        <div className="wk-bar-side wk-bar-right">
          <button className="wk-lpill is-icon" onClick={() => setSheet(sheet === "apps" ? null : "apps")} aria-label="Apps" title="Apps"><LayoutGrid size={16} /></button>
          <button className="wk-lpill" style={{ padding: "0 14px 0 12px" }} onClick={() => router.push("/chat")}><MessageCircle size={15} /> Ask EverFern</button>
        </div>
      </div>
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════════ */

function Home({ ready, workers, onOpen, onNew, onDelete }: {
  ready: boolean; workers: Worker[]; onOpen: (w: Worker) => void; onNew: () => void; onDelete: (id: string) => void;
}) {
  if (!ready) return null;
  if (!workers.length) {
    return (
      <div className="wk-step">
        <motion.h1 className="wk-title" {...rise}>Hire your first worker</motion.h1>
        <motion.p className="wk-sub" {...rise}>A worker is an AI teammate with its own computer. Teach it a job once and it keeps doing it.</motion.p>
        <motion.div {...rise}><button className="wk-gpill is-lg" onClick={onNew}><Plus size={16} /> New worker</button></motion.div>
      </div>
    );
  }
  return (
    <div className="wk-step" style={{ maxWidth: 900 }}>
      <motion.h1 className="wk-title" {...rise}>Your workers</motion.h1>
      <motion.p className="wk-sub" {...rise}>Open a worker to watch it, change its job or run it.</motion.p>
      <div className="wk-home-grid">
        {workers.map((w) => (
          <motion.div key={w.id} className="wk-card wk-wcard" {...rise} onClick={() => onOpen(w)} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && onOpen(w)}>
            <div className="wk-wcard-head">
              <span className="wk-avatar" style={{ width: 36, height: 36, background: orbBackground(w.hue) }} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="wk-wcard-name">{w.name}</div>
                <div className="wk-wcard-meta">
                  <span className={`wk-dot${w.status === "running" ? " is-running" : w.status === "paused" ? " is-paused" : ""}`} />
                  {w.status} · {TIERS.find((t) => t.id === w.tier)?.name}
                </div>
              </div>
              <button className="wk-app-btn" style={{ marginLeft: 0 }} onClick={(e) => { e.stopPropagation(); if (confirm(`Delete ${w.name}?`)) onDelete(w.id); }} aria-label={`Delete ${w.name}`} title="Delete"><X size={13} /></button>
            </div>
            <div className="wk-wcard-job">{w.prompt ? parseSteps(w.prompt).join(" · ") : "No job yet. Open it to teach it one."}</div>
            <div style={{ marginTop: "auto" }}><AppLogoCluster apps={w.apps.slice(0, 5)} size={24} /></div>
          </motion.div>
        ))}
        <motion.button className="wk-card wk-add-card" {...rise} onClick={onNew}><Plus size={18} /> New worker</motion.button>
      </div>
    </div>
  );
}

function TierStep({ value, onChange, onContinue }: { value: Worker["tier"]; onChange: (t: Worker["tier"]) => void; onContinue: () => void }) {
  return (
    <div className="wk-step">
      <motion.h1 className="wk-title" {...rise}>Choose an intelligence level</motion.h1>
      <motion.p className="wk-sub" {...rise}>This defines how capable your worker will be.</motion.p>
      <div className="wk-row3" role="radiogroup" aria-label="Intelligence level">
        {TIERS.map((t, i) => (
          <motion.button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={value === t.id}
            className={`wk-card wk-tier${value === t.id ? " is-selected" : ""}`}
            onClick={() => onChange(t.id)}
            onDoubleClick={onContinue}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE, delay: 0.08 + i * 0.06 } }}
          >
            <div className="wk-tier-top">
              <span className="wk-orb" />
              {t.tag && <span className="wk-tag"><Zap size={12} /> {t.tag}</span>}
            </div>
            <div className="wk-tier-row">
              <span className="wk-tier-name">{t.name}</span>
              <span className="wk-tier-price" aria-label={`Price ${t.price.length} of 4`}>{t.price}</span>
            </div>
            <div className="wk-tier-desc">{t.desc}</div>
          </motion.button>
        ))}
      </div>
      <motion.p className="wk-note" {...rise}>This can be changed at any time later.</motion.p>
      <motion.div {...rise}><button className="wk-gpill" onClick={onContinue}>Continue <ArrowRight size={15} /></button></motion.div>
    </div>
  );
}

function TemplateStep({ onPick, onAll, onBlank }: { onPick: (t: WorkerTemplate) => void; onAll: () => void; onBlank: () => void }) {
  return (
    <div className="wk-step">
      <motion.h1 className="wk-title" {...rise}>Quick start with a template.</motion.h1>
      <motion.p className="wk-sub" {...rise}>Or start blank and describe the job yourself.</motion.p>
      <motion.div className="wk-row3" initial="hidden" animate="show" variants={{ hidden: {}, show: { transition: { delayChildren: 0.08, staggerChildren: 0.06 } } }}>
        {FEATURED_TEMPLATES.slice(0, 3).map((t) => <TemplateCard key={t.id} t={t} onPick={onPick} />)}
      </motion.div>
      <motion.div className="wk-actions" {...rise}>
        <button className="wk-gpill" onClick={onAll}><List size={15} /> All templates <span style={{ opacity: 0.6 }}>{WORKER_TEMPLATES.length}</span></button>
        <button className="wk-gpill" onClick={onBlank}><ArrowUpRight size={15} /> Start new</button>
      </motion.div>
    </div>
  );
}

function PromptCard({ worker, text, setText, onSubmit, onClose, onApps }: {
  worker: Worker; text: string; setText: (t: string) => void; onSubmit: () => void; onClose: () => void; onApps: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const t = setTimeout(() => { ref.current?.focus(); ref.current?.setSelectionRange(text.length, text.length); }, 280);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(300, Math.max(128, el.scrollHeight))}px`;
  }, [text]);
  const apps = worker.apps.slice(0, 6);
  return (
    <motion.div
      className="wk-prompt"
      initial={{ opacity: 0, y: 30, scale: 0.97, x: "-50%" }}
      animate={{ opacity: 1, y: 0, scale: 1, x: "-50%", transition: { duration: 0.45, ease: EASE } }}
      exit={{ opacity: 0, y: 24, scale: 0.97, x: "-50%", transition: { duration: 0.22, ease: EASE } }}
    >
      <div className="wk-prompt-label">
        <Avatar w={worker} size={20} />
        <span style={{ marginRight: "auto" }}>{worker.prompt ? "Change the job, or ask a question" : "Describe the job. Once you send the prompt, the worker will start."}</span>
        <button className="wk-ghost" style={{ height: 26, width: 26, padding: 0, justifyContent: "center" }} onClick={onClose} aria-label="Close"><X size={14} /></button>
      </div>
      <textarea
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onSubmit(); } }}
        placeholder={"1. Open my inbox every morning\n2. Find invoices from this week\n3. Add them to the bookkeeping sheet"}
      />
      <div className="wk-prompt-foot">
        <button className="wk-ghost" onClick={onApps} title="Apps this worker can use">
          <span style={{ display: "inline-flex" }}>
            {apps.map((a, i) => <AppLogo key={a} app={a} size={18} radius={5} style={{ marginLeft: i ? -4 : 0, boxShadow: "0 0 0 1.5px #fff" }} />)}
          </span>
          {apps.length ? `${worker.apps.length} app${worker.apps.length === 1 ? "" : "s"}` : "Add apps"}
        </button>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11.5, color: "#a2a6aa" }}>Ctrl ↵</span>
          <button className="wk-send" onClick={onSubmit} disabled={!text.trim()} aria-label="Send"><ArrowUp size={17} /></button>
        </span>
      </div>
    </motion.div>
  );
}

function Chat({ msgs, running, onRun, onEdit, onSchedule }: {
  msgs: Msg[]; running: boolean; onRun: () => void; onEdit: () => void; onSchedule: (label: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [picking, setPicking] = useState(false);
  useEffect(() => { ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: "smooth" }); }, [msgs.length]);
  const lastFlow = useMemo(() => msgs.map((m, i) => (m.kind === "flow" ? i : -1)).filter((i) => i >= 0).pop(), [msgs]);

  return (
    <div className="wk-chat">
      <div className="wk-chat-scroll" ref={ref}>
        <AnimatePresence initial={false}>
          {msgs.map((m, i) => (
            <motion.div key={`${i}-${m.kind}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE } }} exit={{ opacity: 0 }}
              style={{ display: "flex", flexDirection: "column" }}>
              {m.kind === "user" && <div className="wk-msg-user">{m.text}</div>}
              {m.kind === "ai" && <div className="wk-msg-ai">{m.text}</div>}
              {m.kind === "thinking" && <div className="wk-msg-ai"><span className="wk-shimmer">{m.text}<i /><i /><i /></span></div>}
              {m.kind === "flow" && (
                <div className="wk-flow wk-glass">
                  <div className="wk-flow-head">
                    <span className="wk-flow-check"><Check size={15} strokeWidth={2.6} /></span>
                    <div>
                      <div className="wk-flow-title">Workflow ready</div>
                      <div className="wk-flow-sub">{m.steps.length} step{m.steps.length === 1 ? "" : "s"}</div>
                    </div>
                  </div>
                  <ol className="wk-flow-steps">
                    {m.steps.map((s, j) => (
                      <li key={j} className={`wk-flow-step${running && i === lastFlow && j === 0 ? " is-active" : ""}`}>
                        <span className="wk-flow-num">{j + 1}</span><span>{s}</span>
                      </li>
                    ))}
                  </ol>
                  {i === lastFlow && !running && (
                    picking ? (
                      <div className="wk-choices">
                        {["Every weekday at 9:00", "Every hour", "Tomorrow at 8:00"].map((l) => (
                          <button key={l} className="wk-gpill is-sm" onClick={() => { setPicking(false); onSchedule(l); }}>{l}</button>
                        ))}
                      </div>
                    ) : (
                      <div className="wk-choices">
                        <button className="wk-gpill is-sm is-white" onClick={onRun}><Play size={12} fill="currentColor" strokeWidth={0} /> Run now</button>
                        <button className="wk-gpill is-sm" onClick={() => setPicking(true)}><CalendarClock size={13} /> Schedule</button>
                        <button className="wk-gpill is-sm" onClick={onEdit}><Pencil size={12} /> Edit</button>
                      </div>
                    )
                  )}
                </div>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
