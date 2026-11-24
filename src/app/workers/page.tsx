"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ReplyMarkdown } from "./ReplyMarkdown";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence, MotionConfig } from "framer-motion";
import { createPortal } from "react-dom";
import { SettingsSheet, logoutLocal, type SettingsSection } from "./Settings";
import {
  ArrowLeft, ArrowRight, ArrowUp, ArrowUpRight, Check, ChevronRight, ChevronUp, LayoutGrid, List, MessageCircle,
  MessageSquareOff, MessageSquare, Pause, Play, Plus, X, Zap, Pencil, CalendarClock, Trash2, Sparkles, ChevronDown, Settings as SettingsIcon, Monitor, LoaderCircle,
  Sun, Clock, Calendar, Repeat, Mail, Globe, Search, FileText, User, Bell, CircleDot, type LucideIcon,
  FolderOpen, FolderPlus, Pin, PinOff, Cpu, TriangleAlert, ListChecks, PanelRightClose, Workflow,
} from "lucide-react";
import WindowControls from "../components/WindowControls";
import { ALPS_PHOTOS, photoUrl } from "../components/onboarding/GlassShell";
import { AppLogo, AppLogoCluster } from "@/components/AppLogo";
import { APPS, startUrlFor } from "@/lib/apps";
import { appsInStep, planStepDone, stepApps } from "./step-apps";
import { isWorkerChatBusy } from "@/lib/worker-activity";
import { latestAssistantPreview, workerLandscape } from '@/lib/worker-presentation';
import { FEATURED_TEMPLATES, WORKER_TEMPLATES, type WorkerTemplate } from "@/lib/worker-templates";
import { TIERS, newWorker, useWorkers, withRun, loadWorkerChat, saveWorkerChat, type Machine, type Worker } from "@/lib/workers";
import { ensureCloudVm, prewarmCloudVm, closeCloudApp, releaseCloudVm, cloudToken, API_URL, type Paywall } from "@/lib/cloud-vms";
import { CloudGate, PaywallView, useCloudAuth } from "./ModelSettings";
import { AppsSheet, TemplateCard, TemplatesSheet, registerCustomApps } from "./Sheets";
import { WorkerDesktop, type Win, type AiAct } from "./Desktop";
import { activeRunOf, attachRun, hasAgent, liveRuns, parseSteps, planJob, runWorker, stopWorker, type ChatTurn, type LiveRun, type RunEvents } from "@/lib/worker-engine";
import { dropRun, patchRun, pickLive, saveRun, savedRuns, savedView, saveView, type SavedRun, type SavedView } from "./live-run";
import "./workers.css";
import { pushWithTransition } from "@/lib/route-transition";
import "./worker-reference.css";
import "./materials.css";
import "./liquid-glass.css";
import { LiquidGlassDefs } from "./liquid-glass";
import { useDialogFocus } from "@/lib/use-dialog-focus";
import { makeWorkerSchedule, SCHEDULE_LABELS, REMOVE_SCHEDULE } from "@/lib/worker-schedule";
import { missedNote, setScheduledRunHandler } from "@/lib/worker-scheduled-run";

type Mode = "home" | "tier" | "machine" | "template" | "desktop";
const MACHINE_KEY = "everfern_worker_machine";
const WORKER_WALLPAPER = '/images/worker-landscape.jpg';
const savedMachine = (): Machine => (typeof window !== "undefined" && localStorage.getItem(MACHINE_KEY) === "cloud" ? "cloud" : "local");
type Sheet = null | "apps" | "templates" | "settings";
type Msg =
  | { kind: "user"; text: string; at?: number }
  | { kind: "thinking"; text: string }
  | { kind: "ai"; text: string; key?: string; streaming?: boolean; at?: number; failure?: { provider?: string; model?: string; error?: string } }
  | { kind: "reason"; text: string; key: string; live: boolean }
  | { kind: "tool"; text: string }
  | { kind: "flow"; steps: string[] }
  /** A clarifying question from the planner; `job` is what it was planning, `answered` the user's reply. */
  | { kind: "ask"; question: string; options: { label: string; icon?: string }[]; job: string; answered?: string }
  /** Something the worker still needs from the user before it can run. */
  | { kind: "open"; title: string; detail: string }
  | { kind: "schedule" }
  /** `steps`: what that run did; `oneOff`: a task from the chat that is not the worker's saved workflow. */
  | { kind: "report"; result: RunReport; at?: number; steps?: string[]; oneOff?: boolean };

type ChatSession = { start: number; end: number; title: string; at?: number; finished: boolean };

/**
 * A worker keeps one running conversation; History splits it into sessions. A new
 * session starts at something you asked after a run finished, or after a 30 minute break.
 */
function chatSessions(msgs: Msg[]): ChatSession[] {
  const out: ChatSession[] = [];
  let lastAt: number | undefined;
  let reported = false;
  msgs.forEach((m, i) => {
    const at = "at" in m ? m.at : undefined;
    if (m.kind === "user") {
      const gap = at !== undefined && lastAt !== undefined && at - lastAt > 30 * 60_000;
      if (!out.length || reported || gap) {
        if (out.length) out[out.length - 1].end = i;
        out.push({ start: out.length ? i : 0, end: msgs.length, title: m.text, at, finished: false });
        reported = false;
      }
    }
    if (m.kind === "report") { reported = true; if (out.length) out[out.length - 1].finished = true; }
    if (at !== undefined) lastAt = at;
  });
  return out;
}

type RunReport = { title: string; subtitle: string; timeWorked: string; durationLabel: string; cost: string; costLabel: string; status: string; summary: string; accomplishments: string[] };

const EASE = [0.16, 1, 0.3, 1] as const;
const TASK_SPRING = { type: "spring" as const, stiffness: 340, damping: 37, mass: 1 };
const swap = {
  initial: { opacity: 0, y: 14, filter: "blur(8px)" },
  animate: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.55, ease: EASE, staggerChildren: 0.06 } },
  exit: { opacity: 0, y: -10, filter: "blur(6px)", transition: { duration: 0.25, ease: EASE } },
};
const rise = { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE } } };

const nameFrom = (prompt: string) => {
  const first = parseSteps(prompt)[0] ?? "New worker";
  const words = first.split(/\s+/).slice(0, 4).join(" ");
  return words.length > 26 ? `${words.slice(0, 26)}…` : words;
};

/** Law 8 on the way in: drop reasoning, internal markers, IDs and emoji the model should not have written. */
function tidyReply(t: string): string {
  return t
    .replace(/<think>[\s\S]*?(<\/think>|$)/g, "")
    .replace(/\[(PHASE_COMPLETE|PHASE|STEP_DONE|TASK_COMPLETE)[^\]]*\]/gi, "")
    .replace(/\(\s*(Step|Plan) ID:?\s*`?[\w-]+`?\s*\)/gi, "")
    .replace(/[✅☑☐⏳❌✔✖]️?/g, "")
    .replace(/\p{Extended_Pictographic}️?/gu, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Playful loading words in the style of Claude Code's spinner, shown while the worker plans or thinks. */
const LOADING_WORDS = [
  "Accomplishing", "Actualizing", "Baking", "Booping", "Brewing", "Calculating", "Cerebrating", "Channelling",
  "Churning", "Coalescing", "Cogitating", "Combobulating", "Concocting", "Conjuring", "Considering", "Contemplating",
  "Cooking", "Crafting", "Crunching", "Deciphering", "Deliberating", "Discombobulating", "Divining", "Elucidating",
  "Enchanting", "Envisioning", "Finagling", "Flibbertigibbeting", "Forging", "Frolicking", "Germinating", "Hatching",
  "Herding", "Honking", "Hustling", "Ideating", "Imagining", "Incubating", "Inferring", "Jiving", "Manifesting",
  "Marinating", "Meandering", "Moseying", "Mulling", "Mustering", "Musing", "Noodling", "Percolating", "Perusing",
  "Philosophising", "Pondering", "Pontificating", "Puttering", "Puzzling", "Reticulating", "Ruminating", "Schlepping",
  "Shimmying", "Simmering", "Smooshing", "Spelunking", "Stewing", "Synthesizing", "Tinkering", "Transmuting",
  "Unfurling", "Unravelling", "Vibing", "Whirring", "Wibbling", "Wizarding", "Wrangling",
];
const pickWord = (not?: string) => {
  let w = not;
  while (w === not) w = LOADING_WORDS[Math.floor(Math.random() * LOADING_WORDS.length)];
  return w as string;
};

function LoadingWord() {
  const [word, setWord] = useState(() => pickWord());
  useEffect(() => {
    const t = setInterval(() => setWord((w) => pickWord(w)), 2600);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="wk-shimmer wk-loading-word">
      <AnimatePresence mode="wait" initial={false}>
        <motion.span key={word} initial={{ opacity: 0, y: 4, filter: "blur(3px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} exit={{ opacity: 0, y: -4, filter: "blur(3px)" }} transition={{ duration: 0.22, ease: EASE }}>
          {word}…
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/** Generic statuses become loading words; specific ones ("Starting: Search Gmail") stay as written. */
const GENERIC_STATUS = /^(planning the job|thinking it through|thinking|working|reasoning carefully)\.*$/i;

function ReplyText({ text }: { text: string }) {
  return <ReplyMarkdown text={text} />;
}

function TeachIcon() {
  return <svg className="wk-teach-icon" width="23" height="23" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m10 9 3.4 12 2.1-5.1 5.1-2.1L10 9Z" fill="currentColor" stroke="currentColor" strokeLinejoin="round" /><path d="M8 2.5 9 5M2.5 8l2.5 1M3 15l2.5-1M15 3l-1 2.5M18 8l2.5-1M6 6 4.3 4.3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>;
}

function IntelligenceIcon() {
  return <svg className="wk-model-dot" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">{Array.from({ length: 16 }, (_, index) => <circle key={index} cx="8" cy="1.75" r=".6" fill="currentColor" transform={`rotate(${index * 22.5} 8 8)`} />)}</svg>;
}

function Avatar({ w, size = 30 }: { w: Pick<Worker, "id" | "hue" | "status">; size?: number }) {
  return (
    <span className="wk-avatar" style={{ width: size, height: size, background: `url(${workerLandscape(w.id)}) center / cover` }}>
      {w.status === "running" && <span className="wk-dot is-running" />}
      {w.status === "paused" && <span className="wk-dot is-paused" />}
    </span>
  );
}

/* ═════════════════════════════════════════════════════════════════ */

export default function WorkersPage() {
  const router = useRouter();
  const goToChat = useCallback(() => pushWithTransition("to-chat", () => router.push("/chat")), [router]);
  const { workers, ready, error: storeError, clearError, save, remove } = useWorkers();
  const [mode, setMode] = useState<Mode>("home");
  const [draft, setDraft] = useState<Worker | null>(null); // unsaved worker during creation
  const [activeId, setActiveId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('account');
  const [wins, setWins] = useState<Win[]>([]);
  const [promptOpen, setPromptOpen] = useState(false);
  const [promptText, setPromptText] = useState("");
  const [composerText, setComposerText] = useState("");
  useEffect(() => setComposerText(""), [activeId]);
  const [creationStage, setCreationStage] = useState<"idle" | "writing" | "logins" | "ready" | "completed">("idle");
  const [completedStepIndex, setCompletedStepIndex] = useState<number>(-1);
  const [planningJobText, setPlanningJobText] = useState("");
  const [streamingSteps, setStreamingSteps] = useState<string[]>([]);
  /** The plan the agent wrote for this run (create_plan / update_plan_step), shown in the right column. */
  // steps: the list the person sees (the workflow's own steps when it has them). agent: the agent's
  // own create_plan list, when it differs, only used to move the ticks along the person's list.
  const [runPlan, setRunPlan] = useState<{ workerId: string; steps: string[]; done: number; used: string[][]; agent?: { total: number; done: number } } | null>(null);
  /** The steps each worker's current run covers, for the pause point when it has no plan of its own. */
  const runSteps = useRef<Record<string, { steps: string[]; base: number }>>({});
  const [streamingPartial, setStreamingPartial] = useState<string | undefined>();
  const [loginApps, setLoginApps] = useState<string[]>([]);
  const [chats, setChats] = useState<Record<string, Msg[]>>({});
  const [chatHidden, setChatHidden] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  /** The past session shown in the chat (its first message's index), or null for the whole conversation. */
  const [sessionAt, setSessionAt] = useState<number | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [folders, setFolders] = useState<string[]>([]);
  const [folderName, setFolderName] = useState('');
  const [selectedFolder, setSelectedFolder] = useState('Home');
  useEffect(() => {
    try { setSidebarOpen(localStorage.getItem('everfern_sidebar_pinned') === '1'); setFolders(JSON.parse(localStorage.getItem('everfern_worker_folders') || '[]').filter((item: unknown) => typeof item === 'string')); } catch { /* Use the default Home group. */ }
  }, []);
  const toggleSidebar = () => setSidebarOpen(open => { localStorage.setItem('everfern_sidebar_pinned', open ? '0' : '1'); return !open; });
  const createFolder = () => {
    const name = folderName.trim().slice(0, 64);
    if (!name || name === 'Home') return;
    const next = Array.from(new Set([...folders, name]));
    setFolders(next); setSelectedFolder(name); setFolderName('');
    localStorage.setItem('everfern_worker_folders', JSON.stringify(next));
  };
  const timers = useRef<number[]>([]);

  useEffect(() => { registerCustomApps(); return () => timers.current.forEach(clearTimeout); }, []);

  const active: Worker | null = draft && draft.id === activeId ? draft : workers.find((w) => w.id === activeId) ?? null;
  const msgs = (activeId && chats[activeId]) || [];
  const recentChatText = latestAssistantPreview(msgs);
  const chatBusy = isWorkerChatBusy(msgs);
  const sessions = useMemo(() => chatSessions(msgs), [msgs]);
  const viewing = sessionAt === null ? null : sessions.find((s) => s.start === sessionAt) ?? null;
  // Another worker, or anything new said, goes back to the live conversation.
  useEffect(() => { setSessionAt(null); setHistoryOpen(false); }, [activeId]);
  useEffect(() => { setSessionAt(null); }, [msgs.length]);

  const update = useCallback((w: Worker) => {
    if (draft && draft.id === w.id) setDraft(w);
    else save(w);
  }, [draft, save]);

  const workersRef = useRef(workers);
  workersRef.current = workers;
  // Each worker's chat is saved to disk a moment after it changes (without the live "thinking" lines).
  const savedChats = useRef<Record<string, Msg[]>>({});
  useEffect(() => {
    const t = window.setTimeout(() => {
      for (const [id, list] of Object.entries(chats)) {
        if (savedChats.current[id] === list || !workersRef.current.some((w) => w.id === id)) continue;
        savedChats.current[id] = list;
        saveWorkerChat(id, list.filter((m) => m.kind !== "thinking").map((m) => ("live" in m || "streaming" in m ? { ...m, live: false, streaming: false } : m)));
      }
    }, 800);
    return () => window.clearTimeout(t);
  }, [chats]);

  /**
   * Warm a worker's computer before its windows ask for it: the local Alpine VM
   * (boot, setup, desktop stream) or its stopped cloud VM. Pointing at a worker is
   * enough, so by the time a window opens the VM is already up.
   */
  const prewarm = useCallback((w?: Worker | null) => {
    if (!w) return;
    if (w.machine === "cloud") void prewarmCloudVm(w.cloudVmId);
    else if (w.machine === "local") void (window as any).electronAPI?.system?.prewarmVM?.(w.id);
  }, []);
  // The worker you are on, as soon as the page shows it.
  useEffect(() => { prewarm(workers.find((x) => x.id === activeId)); }, [activeId, workers.length, prewarm]); // eslint-disable-line react-hooks/exhaustive-deps
  const later = (fn: () => void, ms: number) => { timers.current.push(window.setTimeout(fn, ms)); };

  /* ── flow ─────────────────────────────────────────────────────── */
  const startNew = () => {
    const w: Worker = { ...newWorker(), machine: savedMachine(), ...(selectedFolder !== 'Home' ? { folder: selectedFolder } : {}) };
    setDraft(w); setActiveId(w.id); setSheet(null); setPromptOpen(false); setWins([]); setPromptText("");
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
    setWins([]);
    setPromptText(t.prompt);
    setPromptOpen(false);
    setMode("desktop");
    later(() => setPromptOpen(true), 900);
  };

  /** Where the worker's computer runs. Cloud sets up (or reuses) the user's EverFern Cloud VM. */
  const [machineBusy, setMachineBusy] = useState(false);
  const [machineErr, setMachineErr] = useState("");
  const [paywall, setPaywall] = useState<Paywall | null>(null);
  const chooseMachine = async (machine: Machine) => {
    if (!draft || machineBusy) return;
    try { localStorage.setItem(MACHINE_KEY, machine); } catch { /* storage off */ }
    setMachineErr("");
    if (machine === "local") { setDraft({ ...draft, machine, cloudVmId: undefined }); setMode("template"); return; }
    setMachineBusy(true);
    const r = await ensureCloudVm({ preferId: draft.cloudVmId, name: draft.name ? `${draft.name} computer` : "Worker computer", workerId: draft.id });
    setMachineBusy(false);
    if ("paywall" in r) { setPaywall(r.paywall); return; }
    if ("error" in r) { setMachineErr(r.error); return; }
    setDraft({ ...draft, machine, cloudVmId: r.vm.id });
    setMode("template");
  };

  const startBlank = () => {
    const w = commitDraft({});
    if (!w) return;
    setWins([]); setPromptText(""); setMode("desktop");
    // A blank worker starts by picking its apps, like setting up a new computer.
    later(() => setSheet("apps"), 450);
  };

  const openWorker = (w: Worker) => {
    if (draft) setDraft(null);
    if (w.id !== activeId) setPromptText("");
    setCreationStage("idle");
    setActiveId(w.id); setSheet(null); setPromptOpen(false);
    setWins([]);
    if (!chats[w.id]) {
      void loadWorkerChat<Msg>(w.id).then((saved) => setChats((c) => {
        if (c[w.id]) return c; // something was said meanwhile
        if (saved.length) return { ...c, [w.id]: saved };
        return w.prompt ? { ...c, [w.id]: [{ kind: "user", text: w.prompt }, { kind: "flow", steps: parseSteps(w.prompt) }] } : c;
      }));
    }
    setMode("desktop");
  };

  /** Messages you and the worker write carry the time they were sent. */
  const stamp = (m: Msg): Msg => (m.kind === "user" || m.kind === "ai" ? { ...m, at: m.at ?? Date.now() } : m);
  const push = (id: string, ...m: Msg[]) => setChats((c) => ({ ...c, [id]: [...(c[id] ?? []).filter((x) => x.kind !== "thinking"), ...m.map(stamp)] }));
  /** Add a message, or update it in place if one with the same key is already there (streamed text). */
  const upsert = (id: string, m: Extract<Msg, { kind: "ai" | "reason" }>) => setChats((c) => {
    const list = c[id] ?? [];
    const at = list.findIndex((x) => (x.kind === "ai" || x.kind === "reason") && !!x.key && x.key === m.key);
    const was = at < 0 ? undefined : list[at];
    const next = m.kind === "ai" ? { ...m, at: m.at ?? (was?.kind === "ai" ? was.at : undefined) ?? Date.now() } : m;
    return { ...c, [id]: at < 0 ? [...list, next] : list.map((x, j) => (j === at ? next : x)) };
  });
  /** Mark a streamed reasoning block finished (it folds away). */
  const endReason = (id: string, key: string) => setChats((c) => ({
    ...c, [id]: (c[id] ?? []).map((x) => (x.kind === "reason" && x.key === key ? { ...x, live: false } : x)),
  }));

  const [navTo, setNavTo] = useState<{ app: string; url: string; n: number } | null>(null);
  /** What the AI is doing right now, drawn on its window as a cursor + bubble. */
  const [ai, setAi] = useState<AiAct>(null);
  const controlTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (controlTimer.current) clearTimeout(controlTimer.current); }, []);
  const live = hasAgent();

  const submitPrompt = async () => {
    const text = promptText.trim();
    if (!text || !active) return;
    setPromptOpen(false); setChatHidden(false); setPromptText("");
    await planFor(active, text, text);
  };

  /** The user answered a clarifying question (picked an option or typed their own): plan again with it. */
  const answer = async (idx: number, reply: string) => {
    const text = reply.trim();
    const w = active;
    const m = msgs[idx];
    if (!text || !w || m?.kind !== "ask" || m.answered) return;
    setChats((c) => ({ ...c, [w.id]: (c[w.id] ?? []).map((x, j) => (j === idx && x.kind === "ask" ? { ...x, answered: text } : x)) }));
    await planFor(w, `${m.job}

You asked: ${m.question}
My answer: ${text}`, text);
  };

  /** Plan `job` (shown in the chat as `said`): the AI either asks one clarifying question or writes the workflow. */
  const planFor = async (w: Worker, job: string, said: string) => {
    // What was said and done so far, so a follow-up ("continue", "use the other sheet") makes sense.
    const history: ChatTurn[] = (chats[w.id] ?? []).flatMap((m): ChatTurn[] =>
      m.kind === "user" ? [{ role: "user", content: m.text }]
        : m.kind === "ai" && m.text ? [{ role: "assistant", content: m.text }]
        : m.kind === "ask" ? [{ role: "assistant", content: `I asked: ${m.question}${m.answered ? ` (you answered: ${m.answered})` : ""}` }]
        : m.kind === "flow" ? [{ role: "assistant", content: `Workflow saved:\n${m.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}` }]
        : []);
    setCreationStage("writing");
    setPlanningJobText(said);
    setStreamingSteps([]);
    setStreamingPartial(undefined);
    // Minimize open windows so wallpaper is calm and focused
    setWins((ws) => ws.map((win) => ({ ...win, min: true })));
    push(w.id, { kind: "user", text: said }, { kind: "thinking", text: live ? "Planning the job" : "Thinking it through" });
    const k = `plan-${Date.now()}`;
    const plan = await planJob(w, job, {
      onThought: (t) => { setAi(null); upsert(w.id, { kind: "reason", key: `${k}-r`, text: t, live: true }); },
      onReply: (t) => upsert(w.id, { kind: "ai", key: `${k}-a`, text: t, streaming: true }),
      onSteps: (steps, partial) => {
        setStreamingSteps(steps);
        setStreamingPartial(partial);
      },
    }, history);
    endReason(w.id, `${k}-r`);
    if (plan.error) {
      setCreationStage("idle");
      setChats((c) => ({ ...c, [w.id]: (c[w.id] ?? []).filter((x) => x.kind !== "thinking") }));
      upsert(w.id, { kind: "ai", key: `${k}-a`, text: plan.reply, failure: { ...plan.via, error: plan.error } });
      return;
    }
    const open: Msg[] = (plan.open ?? []).map((o) => ({ kind: "open", title: o.title, detail: o.detail }));
    if (plan.ask) {
      // Not enough to go on yet: ask, and write the workflow once the user answers.
      setCreationStage("idle");
      setChats((c) => ({ ...c, [w.id]: (c[w.id] ?? []).filter((x) => x.kind !== "thinking") }));
      upsert(w.id, { kind: "ai", key: `${k}-a`, text: plan.reply });
      push(w.id, ...open, { kind: "ask", question: plan.ask.question, options: plan.ask.options, job });
      return;
    }
    const name = w.templateId ? w.name : w.name === "New worker" ? (plan.name || nameFrom(job)) : w.name;
    setChats((c) => ({ ...c, [w.id]: (c[w.id] ?? []).filter((x) => x.kind !== "thinking") }));
    if (plan.live && plan.kind !== "workflow") {
      // A question, or a one-off job: answer it or just do it, no workflow card.
      setCreationStage("idle");
      upsert(w.id, { kind: "ai", key: `${k}-a`, text: plan.reply });
      if (open.length) push(w.id, ...open);
      if (plan.kind === "do" && plan.steps.length) {
        const apps = withJobApps(w.apps, `${job} ${said}`, plan.steps);
        const named = { ...w, name, apps };
        if (name !== w.name || apps.length !== w.apps.length) update(named);
        await run(named, plan.steps);
      }
      return;
    }

    // Detect all apps mentioned across steps and user input
    const updatedApps = withJobApps(w.apps, `${job} ${said}`, plan.steps);
    const detected = new Set(updatedApps.filter((a) => !w.apps.includes(a)));
    const namedWorker: Worker = { ...w, prompt: plan.steps.map((st, i) => `${i + 1}. ${st}`).join("\n"), name, apps: updatedApps };
    update(namedWorker);

    // Do not pre-open windows here. Apps only appear once the AI actually opens them.

    upsert(w.id, { kind: "ai", key: `${k}-a`, text: plan.live ? plan.reply : `${plan.reply} (Preview mode: open the EverFern desktop app to run it on a real computer.)` });
    // The workflow card goes up only now, once the steps really exist.
    push(w.id, ...open, { kind: "flow", steps: plan.steps });

    // Ensure steps are visible in center card before transition
    setStreamingSteps(plan.steps);
    setStreamingPartial(undefined);
    // Let the finished list sit centred for a moment, then it morphs into the top-right panel.
    await new Promise((r) => setTimeout(r, 2000));

    const webAppsNeedingLogin = Array.from(detected).filter(
      (a) => APPS[a]?.domain || ["amazon", "linkedin", "canva", "moss"].includes(a)
    );

    if (webAppsNeedingLogin.length > 0) {
      setLoginApps(webAppsNeedingLogin);
      setCreationStage("logins");
    } else {
      setCreationStage("ready");
    }
  };

  /** Point the matching app window at a URL the agent opened, so you watch what it does. */
  const appForUrl = (url: string, w: Worker) => {
    const host = url.replace(/^https?:\/\//, "").split("/")[0].replace(/^www\./, "");
    return w.apps.find((a) => APPS[a]?.domain && host.endsWith(APPS[a].domain!.replace(/^www\./, "").split("/")[0])) ?? (w.apps.includes("browser") ? "browser" : null);
  };
  /** Bring an app's window up (opening it if needed). */
  const showApp = (app: string) =>
    setWins((ws) => {
      return bringUp(ws, app);
    });
  const followUrl = (url: string, w: Worker) => {
    const app = appForUrl(url, w);
    if (!app) return;
    setWins((ws) => {
      return bringUp(ws, app);
    });
    setNavTo((n) => ({ app, url, n: (n?.n ?? 0) + 1, agent: true }));
  };
  // A result clicked in EverFern Search opens in the worker's browser window.
  useEffect(() => {
    const open = (e: Event) => {
      const url = (e as CustomEvent<{ url?: string }>).detail?.url;
      if (!url || !/^https?:\/\//.test(url)) return;
      setWins((ws) => bringUp(ws, "browser"));
      setNavTo((n) => ({ app: "browser", url, n: (n?.n ?? 0) + 1 }));
    };
    window.addEventListener("everfern:worker-open-url", open);
    return () => window.removeEventListener("everfern:worker-open-url", open);
  }, []);

  /** Run the worker's workflow, or `only` these steps (a one-off job from the chat). */
  const run = async (target?: Worker, only?: string[], opts: { auto?: boolean; from?: { steps: string[]; done: number } } = {}) => {
    const picked = target ?? active;
    // "running" with no run behind it (left from a crash) does not block a new run.
    if (!picked || (picked.status === "running" && activeRunOf(picked.id))) return;
    // Any new run replaces a saved pause point.
    const w: Worker = picked.resume || picked.pausedBy ? { ...picked, resume: undefined, pausedBy: undefined } : picked;
    // Resuming: the full plan stays on screen, with the steps already done ticked off.
    const from = opts.from;
    const base = from?.done ?? 0;
    const steps = only ?? parseSteps(w.prompt);
    runSteps.current[w.id] = { steps: from?.steps ?? steps, base };
    const startTime = Date.now();
    setCompletedStepIndex(base);
    update({ ...w, status: "running" });
    if (!live) {
      push(w.id, { kind: "ai", text: "Preview mode: there's no agent in this browser tab. Open the EverFern desktop app and press Run there to do the job for real." });
      update({ ...w, status: "idle" });
      return;
    }
    // One step list: the plan panel shows the same steps as the chat's workflow card from the start.
    setRunPlan((p) => from
      ? { workerId: w.id, steps: from.steps, done: from.done, used: p?.workerId === w.id ? p.used : [] }
      : steps.length >= 2 ? { workerId: w.id, steps, done: 0, used: [] }
      : (p?.workerId === w.id ? null : p));
    const controllable = (app: string) => !!(APPS[app]?.domain || APPS[app]?.url || ['chrome', 'browser', 'terminal', 'files'].includes(app));
    // The first app the job names (Amazon for "search Amazon for ..."), opened now so its
    // window loads while the agent thinks, instead of the desktop sitting empty.
    const firstApp = steps.map((st) => appsInStep(st, w.apps).find(controllable)).find(Boolean)
      ?? (w.apps.includes("browser") && steps.some((st) => /\b(search|browse|website|online|web)\b/i.test(st)) ? "browser" : undefined);
    const stage = (text: string) => push(w.id, { kind: "thinking", text });
    const opening = from ? `Resuming at step ${base + 1}: ${parseStepParts(steps[0] ?? "").title}` : `Starting: ${steps[0] ?? "first step"}`;
    stage(w.machine === 'cloud' ? "Starting your cloud computer" : opening);
    // Let the user watch the windows while it works; the chat is one click away.
    setChatHidden(true);
    setAi(null);
    if (firstApp) showApp(firstApp);
    let executionWorker = w;
    if (w.machine === 'cloud') {
      try {
        const assigned = await ensureCloudVm({ preferId: w.cloudVmId, workerId: w.id, name: w.name });
        stage(firstApp ? `Opening ${APPS[firstApp]?.name ?? firstApp}` : "Opening your apps");
        const current = workersRef.current.find(worker => worker.id === w.id);
        if (current && current.status !== 'running') return;
        if (!('vm' in assigned)) throw new Error('error' in assigned ? assigned.error : 'Your cloud plan needs attention before this worker can run.');
        executionWorker = { ...w, cloudVmId: assigned.vm.id };
        update({ ...executionWorker, status: 'running' });
        const api = (window as any).electronAPI?.workers;
        if (!api?.registerCloudVm) throw new Error('Cloud app control is unavailable in this desktop build.');
        const token = cloudToken();
        if (!token) throw new Error('Sign in to EverFern Cloud before running this worker.');
        // Register installed apps before the first tool call, including apps whose
        // viewer has not opened yet. Their browser is created lazily by the API.
        const registered = await Promise.all(w.apps.filter(controllable).map(app => api.registerCloudVm(`persist:worker-${w.id}`, app, assigned.vm.id, API_URL, token, startUrlFor(app) ?? undefined)));
        if (registered.some(result => result !== true)) throw new Error('Could not register the worker’s cloud apps.');
        stage(opening);
      } catch (error) {
        update({ ...executionWorker, status: 'paused' });
        setChatHidden(false);
        setChats(chats => ({ ...chats, [w.id]: (chats[w.id] || []).filter(message => message.kind !== 'thinking') }));
        push(w.id, { kind: 'ai', text: error instanceof Error ? error.message : 'Could not prepare the cloud apps.' });
        return;
      }
    }
    const currentRun = workersRef.current.find(worker => worker.id === w.id);
    if (w.machine === 'cloud' && currentRun && currentRun.status !== 'running') return;
    const rec: SavedRun = { workerId: w.id, conversationId: "", steps, from, startTime, auto: opts.auto, key: `run-${Date.now()}` };
    const t = track(w, rec);
    // The run's id is kept, so a page reload can pick it back up (the agent keeps going in main).
    const res = await runWorker(executionWorker, steps, t.ev, { auto: opts.auto, onStart: (conversationId) => saveRun({ ...rec, conversationId }) });
    t.finish(res);
  };

  /** What a run's events do on screen, and how it ends. Shared by a new run and by a run picked
   *  back up after a page reload, so both look and finish the same. */
  const track = (w: Worker, rec: SavedRun) => {
    const { steps, from, startTime } = rec;
    const base = from?.done ?? 0;
    const k = rec.key;
    let lastTool = "";
    let lastApp: string | undefined;
    const clean = tidyReply;
    let said = false;
    const ev: RunEvents = {
      // Keep the AI overlay and the window it drives up for the whole run;
      // thinking/text between actions must not drop it (cleared when the run ends).
      onText: (t) => {
        const text = clean(t);
        if (!text) return;
        said = true;
        upsert(w.id, { kind: "ai", key: `${k}-a`, text, streaming: true });
      },
      onThought: (t) => { upsert(w.id, { kind: "reason", key: `${k}-r`, text: t, live: true }); },
      onAction: ({ label, x, y, url, app, space, aspect }) => {
        // The agent is driving one of this worker's windows: keep it up front.
        if (app) { if (app !== lastApp) showApp(app); lastApp = app; }
        // Remember which app each plan step really used: the plan shows its icon.
        if (lastApp) {
          const used = lastApp;
          setRunPlan((p) => {
            if (!p || p.workerId !== w.id || p.done >= p.steps.length || (p.used[p.done] ?? []).includes(used)) return p;
            const next = p.used.slice(); next[p.done] = [...(next[p.done] ?? []), used];
            return { ...p, used: next };
          });
        }
        else if (url && /^https?:\/\//.test(url)) lastApp = appForUrl(url, w) ?? lastApp;
        // No point given (reading, typing): the cursor stays where it last was in that window.
        setAi((a) => {
          const keep = x === undefined && a && a.app === lastApp;
          return { app: lastApp, label, x: keep ? a.x : x, y: keep ? a.y : y, space: keep ? a.space : space, aspect: keep ? a.aspect : aspect, n: (a?.n ?? 0) + 1 };
        });
        if (controlTimer.current) clearTimeout(controlTimer.current);
      },
      onTool: (label, args, name) => {
        // The agent's own plan goes to the plan column on the right, not into the chat.
        const tool = String(name ?? "").toLowerCase();
        if (PLAN_TOOLS.has(tool)) {
          const list = Array.isArray(args.steps) ? (args.steps as unknown[]).filter((x): x is string => typeof x === "string" && !!x.trim()) : [];
          // A resumed run keeps the plan it was paused in; the agent only sees the steps left.
          if (tool === "create_plan" && list.length && !from) {
            // The workflow's steps stay on screen; the agent's own list only paces the ticks.
            setRunPlan((p) => steps.length >= 2
              ? { workerId: w.id, steps, done: 0, used: p?.workerId === w.id ? p.used : [], agent: { total: list.length, done: 0 } }
              : { workerId: w.id, steps: list, done: 0, used: [] });
          } else if (tool === "update_plan_step") {
            const st = String(args.status ?? "");
            setRunPlan((p) => (p && p.workerId === w.id && st === "done" ? planStepDone(p) : p));
          }
          return;
        }
        if (label === lastTool) return;
        lastTool = label;
        const url = typeof args.url === "string" ? args.url : "";
        if (/^https?:\/\//.test(url)) followUrl(url, w);
        setChats((c) => {
          const list = (c[w.id] ?? []).filter((x) => x.kind !== "thinking");
          const nextIndex = Math.min(base + steps.length - 1, base + list.filter(item => item.kind === "tool").length);
          setCompletedStepIndex(nextIndex);
          return { ...c, [w.id]: [...list, { kind: "tool", text: label }, { kind: "thinking", text: "Working" }] };
        });
      },
    };
    const finish = (res: { text: string; error?: string }) => {
      dropRun(w.id);
      if (controlTimer.current) clearTimeout(controlTimer.current);
      setAi(null);
      endReason(w.id, `${k}-r`);
      const latest = workersRef.current.find((x) => x.id === w.id) ?? w;
      const task = steps.join("; ");
      // Paused by the user. ("closed" is main's word for a run it no longer sees; after a reload that
      // means it ended while the page was away, so it finishes normally.)
      if (latest.status !== "running" && !(latest.status === "paused" && latest.pausedBy === "closed")) {
        // Keep what it had said so far; the pause itself is already in the chat.
        const soFar = said ? clean(res.text) : "";
        if (soFar) upsert(w.id, { kind: "ai", key: `${k}-a`, text: soFar });
        else if (said) setChats((c) => ({ ...c, [w.id]: (c[w.id] ?? []).filter((x) => !(x.kind === "ai" && x.key === `${k}-a`)) }));
        const at = latest.resume;
        const summary = at
          ? `Paused by you after ${at.done} of ${at.steps.length} steps. Already done: ${at.steps.slice(0, at.done).map((st) => parseStepParts(st).title).join("; ")}.`
          : "Paused by you before it finished.";
        update(withRun(latest, { at: new Date().toISOString(), task, summary, ok: false, auto: rec.auto }));
        return;
      }
      // Remember this run, so the next one knows what was already done.
      update(withRun({ ...latest, status: "idle", resume: undefined, pausedBy: undefined }, {
        at: new Date().toISOString(), task, ok: !res.error, auto: rec.auto,
        summary: res.error ? `Failed: ${res.error}` : (clean(res.text) || "Finished without a report."),
      }));
      setChats((c) => ({ ...c, [w.id]: (c[w.id] ?? []).filter((x) => x.kind !== "thinking") }));
      if (res.error) upsert(w.id, { kind: "ai", key: `${k}-a`, text: `I hit a problem: ${res.error}` });
      else {
        setCompletedStepIndex(base + steps.length);
        // The agent may finish without ticking its last step; a finished run has done them all.
        setRunPlan((p) => (p && p.workerId === w.id ? { ...p, done: p.steps.length, agent: p.agent && { ...p.agent, done: p.agent.total } } : p));
        const elapsedSeconds = Math.max(1, Math.round((Date.now() - startTime) / 1000));
        // The report arrives as the AI's reply in the chat, not as a separate screen.
        setChats((c) => ({ ...c, [w.id]: (c[w.id] ?? []).filter((x) => !(x.kind === "ai" && x.key === `${k}-a`)) }));
        const ran = from?.steps ?? steps;
        const oneOff = parseSteps(latest.prompt).join("\n") !== ran.join("\n");
        push(w.id, { kind: "report", at: Date.now(), steps: ran, oneOff, result: {
          title: "Run finished",
          subtitle: "The agent finished this run. Review its report below.",
          timeWorked: elapsedSeconds < 60 ? `${elapsedSeconds} secs` : `${Math.round(elapsedSeconds / 60)} mins`,
          durationLabel: "Duration",
          cost: "Not reported",
          costLabel: "Total cost",
          status: "Finished",
          summary: clean(res.text) || "The agent did not provide a final report. Review the conversation before assuming the task is complete.",
          accomplishments: [],
        } });
        setChatHidden(false);
      }
    };
    return { ev, finish };
  };

  /** Picks up a run that kept going in the main process while this page reloaded: its chat,
   *  plan and windows come back, and its events flow to the screen again. */
  const reattach = async (w: Worker, r: LiveRun, saved: SavedRun | undefined, view: SavedView | null) => {
    const from = saved?.from ?? (w.resume && w.resume.done > 0 ? w.resume : undefined);
    const rec: SavedRun = saved ?? {
      workerId: w.id, conversationId: r.conversationId,
      steps: from ? from.steps.slice(from.done) : parseSteps(w.prompt),
      from, startTime: Date.now(), key: `run-${Date.now()}`,
    };
    saveRun({ ...rec, conversationId: r.conversationId });
    const base = rec.from?.done ?? 0;
    runSteps.current[w.id] = { steps: rec.from?.steps ?? rec.steps, base };
    const chat = await loadWorkerChat<Msg>(w.id);
    setChats((c) => (c[w.id] ? c : { ...c, [w.id]: chat }));
    // The plan as it was, or the run's steps with the progress saved as it went.
    const all = rec.from?.steps ?? rec.steps;
    const plan = rec.plan?.workerId === w.id ? rec.plan
      : all.length >= 2 ? { workerId: w.id, steps: all, done: w.resume?.steps.length === all.length ? w.resume.done : base, used: [] }
      : null;
    if (plan) setRunPlan(plan);
    setCompletedStepIndex(rec.completed ?? plan?.done ?? base);
    if (view?.activeId === w.id) {
      setDraft(null); setActiveId(w.id); setSheet(null); setPromptOpen(false);
      setWins(Array.isArray(view.wins) ? (view.wins as Win[]) : []);
      setChatHidden(!!view.chatHidden && !r.done);
      setMode("desktop");
    }
    if (!r.done) push(w.id, { kind: "thinking", text: "Working" });
    const t = track(w, rec);
    t.finish(await attachRun(w, r, t.ev));
  };
  // After a reload: runs the agent is still doing (or finished meanwhile) come back on screen.
  const bootView = useRef<SavedView | null | undefined>(undefined);
  if (bootView.current === undefined) bootView.current = typeof window === "undefined" ? null : savedView();
  const pickedUp = useRef(false);
  useEffect(() => {
    if (!ready || !live || pickedUp.current) return;
    pickedUp.current = true;
    void (async () => {
      const runs = await liveRuns();
      const saved = savedRuns();
      for (const w of workersRef.current) {
        const rec = saved[w.id];
        if (activeRunOf(w.id)) continue;
        // Main calls a "running" worker whose run it no longer sees "closed"; with a saved run
        // that only means the run ended during the reload, and its result may still be there.
        const wasRunning = w.status === "running" || (w.status === "paused" && w.pausedBy === "closed" && !!rec);
        const r = wasRunning ? pickLive(w.id, rec, runs) : undefined;
        if (!r) { if (rec) dropRun(w.id); continue; }
        void reattach(w, r, rec, bootView.current ?? null);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, live]);
  // Keep the screen and each run's plan saved, for the next reload.
  useEffect(() => {
    if (pickedUp.current) saveView({ activeId: mode === "desktop" ? activeId : null, mode, wins, chatHidden });
  }, [activeId, mode, wins, chatHidden]);
  useEffect(() => { if (runPlan) patchRun(runPlan.workerId, { plan: runPlan }); }, [runPlan]);
  useEffect(() => {
    const id = runPlan?.workerId ?? activeId;
    if (id) patchRun(id, { completed: completedStepIndex });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completedStepIndex]);
  const deleteWorker = async (id: string) => {
    const gone = workersRef.current.find((w) => w.id === id);
    const r = await remove(id);
    setChats(({ [id]: _gone, ...rest }) => rest);
    delete savedChats.current[id];
    const warnings = [...(r.warnings ?? [])];
    // Its runs are stopped by now, so the cloud machine can be given back.
    if (r.success && gone?.machine === 'cloud') {
      const problem = await releaseCloudVm(id, gone.cloudVmId);
      if (problem) warnings.push(problem);
    }
    if (r.success && warnings.length) console.warn('[Workers] deleted with leftovers:', warnings);
  };
  /** Where the current run of `w` has got to: its plan and how many steps are done. */
  const progressOf = (w: Worker) => {
    if (runPlan?.workerId === w.id) return { steps: runPlan.steps, done: runPlan.done };
    const r = runSteps.current[w.id];
    return r ? { steps: r.steps, done: Math.max(r.base, completedStepIndex) } : undefined;
  };
  const stop = (w: Worker) => {
    setChats((c) => ({ ...c, [w.id]: (c[w.id] ?? []).filter((x) => x.kind !== "thinking") }));
    if (w.status !== "running") {
      if (w.status === "paused") update({ ...w, status: "idle", resume: undefined, pausedBy: undefined });
      return;
    }
    const p = progressOf(w);
    const resumeAt = p && p.done > 0 && p.done < p.steps.length ? { steps: p.steps, done: p.done } : undefined;
    update({ ...w, status: "paused", resume: resumeAt, pausedBy: "you" });
    void stopWorker(w.id);
    setAi(null);
    push(w.id, { kind: "ai", text: resumeAt
      ? `Paused after step ${resumeAt.done} of ${resumeAt.steps.length}. Continue picks up at "${parseStepParts(resumeAt.steps[resumeAt.done]).title}".`
      : "Paused. Continue starts the job again from the first step." });
  };
  /** Continue a paused worker from the first step it had not finished. */
  const resume = (w: Worker) => {
    const p = w.resume ?? (runPlan?.workerId === w.id ? { steps: runPlan.steps, done: runPlan.done } : undefined);
    if (!p || p.done <= 0 || p.done >= p.steps.length) return run(w);
    return run(w, p.steps.slice(p.done), { from: { steps: p.steps, done: p.done } });
  };
  const schedule = async (label: string, patch: Partial<Worker> = {}) => {
    if (!active) return;
    try {
      const api = (window as any).electronAPI?.workers;
      if (!live || !api?.save) throw new Error('Scheduling needs the EverFern desktop app.');
      const next = { ...active, ...patch, schedule: label === REMOVE_SCHEDULE ? undefined : makeWorkerSchedule(label) };
      const result = await api.save(next);
      if (result?.success === false) throw new Error(result.error || 'Couldn’t save this schedule.');
      update(next);
      push(active.id, { kind: 'ai', text: next.schedule ? `Scheduled: ${next.schedule.label}. Runs happen while EverFern is open (on any screen). Paused workers wait until you resume them; runs missed while EverFern was closed are combined into one run, and I'll tell you when that happens.` : 'Schedule removed.' });
    } catch (error) { push(active.id, { kind: 'ai', text: error instanceof Error ? error.message : 'Couldn’t save this schedule.' }); }
  };
  const asPrompt = (steps: string[]) => steps.map((st, i) => `${i + 1}. ${st}`).join("\n");
  /** Keeps a task done from the chat as this worker's workflow, so it can run again or on a schedule. */
  const saveWorkflow = (steps: string[]) => {
    if (!active || !steps.length) return;
    update({ ...active, prompt: asPrompt(steps) });
    push(active.id, { kind: "flow", steps });
  };
  /** What the paused notice says: who paused the task and where Continue picks it up. */
  const pauseNote = (w: Worker | null) => {
    if (!w || w.status !== "paused") return undefined;
    const at = w.resume;
    const where = at
      ? ` after step ${at.done} of ${at.steps.length}. Continue picks up at "${parseStepParts(at.steps[at.done]).title}".`
      : " before it finished a step. Continue starts it again from the first step.";
    if (w.pausedBy === "closed") return `EverFern closed while this task was running, so it stopped${where}`;
    if (w.pausedBy === "you") return `You paused this task${where}`;
    return `This task stopped${where}`;
  };
  // Save how far a run has got as it goes, so a run cut off by closing EverFern continues from there.
  useEffect(() => {
    const id = runPlan?.workerId ?? activeId;
    const w = workersRef.current.find((x) => x.id === id);
    if (!w || w.status !== "running") return;
    const p = progressOf(w);
    if (!p || p.done <= 0 || p.done >= p.steps.length) return;
    if (w.resume?.done === p.done && w.resume.steps.length === p.steps.length) return;
    update({ ...w, resume: { steps: p.steps, done: p.done } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runPlan?.done, runPlan?.workerId, completedStepIndex]);
  const scheduledRun = useRef(run);
  scheduledRun.current = run;
  const scheduledOpen = useRef(openWorker);
  scheduledOpen.current = openWorker;
  const draftRef = useRef(draft);
  draftRef.current = draft;
  // The main process keeps the schedule clock (worker-scheduler.ts) and hands each due worker
  // over already claimed. While this screen is open the run happens here, in the chat.
  useEffect(() => {
    if (!ready || !live) return;
    setScheduledRunHandler(async (next) => {
      update(next);
      // Opening it would pull you out of the worker you are creating; it still runs.
      if (!draftRef.current) scheduledOpen.current(next);
      const note = missedNote(next);
      if (note) push(next.id, { kind: 'ai', text: note });
      await scheduledRun.current(next, undefined, { auto: true });
    });
    return () => setScheduledRunHandler(null);
  }, [ready, live]);

  const [removeApp, setRemoveApp] = useState<string | null>(null);
  const removeDialogRef = useDialogFocus<HTMLDivElement>(!!removeApp, () => setRemoveApp(null));
  const [addingApp, setAddingApp] = useState<string>();
  const toggleApp = async (id: string, confirmed = false) => {
    if (!active) return;
    const on = active.apps.includes(id);
    if (on && !confirmed) { setRemoveApp(id); return; }
    if (on && active.status === 'running') return;
    if (on && active.machine === 'cloud' && active.cloudVmId) await closeCloudApp(active.cloudVmId, active.id, id, () => setWins(ws => ws.filter(w => w.app !== id)));
    if (!on) { setAddingApp(id); setTimeout(() => setAddingApp(current => current === id ? undefined : current), 1600); }
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

  // With every app closed (or minimized) the worker's chat is the screen; with apps open it is opt-in.
  const noWindows = !wins.some((x) => !x.min);
  // While the plan is being written but no step has streamed yet, the chat (with what you just sent) stays up.
  const planEmpty = creationStage === "writing" && !streamingSteps.length && !streamingPartial;
  // A paused worker's saved stopping point stands in for the run plan after a restart.
  const livePlan = runPlan && runPlan.workerId === active?.id ? runPlan
    : active?.status === "paused" && active.resume ? { workerId: active.id, steps: active.resume.steps, done: active.resume.done, used: [] as string[][] } : null;
  // A run's plan stays on the right while the agent works in its windows, not only while the chat is open.
  const planDuringRun = !!livePlan && livePlan.steps.length > 0 && (active?.status === "running" || active?.status === "paused");
  const chatShown = mode === "desktop" && !!active && !sheet && (creationStage === "idle" || planEmpty) && (noWindows || (!chatHidden && msgs.length > 0));
  const chatMsgs: Msg[] = viewing ? msgs.slice(viewing.start, viewing.end) : msgs.length ? msgs : [{ kind: "ai", text: active?.prompt
    ? "Ready when you are. Run the workflow, or tell me what to change."
    : "Hi, I'm ready. Which repetitive task should I take off your plate?" }];
  const sharp = mode === "desktop" && !sheet && !chatShown;
  const running = active?.status === "running";
  // The task bar keeps every app the worker has (open, minimized or closed), so icons never drop out of it.
  const taskApps = useMemo(() => {
    const open = wins.map((x) => x.app);
    const own = active?.apps ?? [];
    return Array.from(new Set([...own, ...open])).filter((a) => APPS[a]);
  }, [wins, active?.apps]);

  /* ── render ───────────────────────────────────────────────────── */
  return (
    <MotionConfig reducedMotion="user" transition={{ duration: 0.3, ease: EASE }}>
    <div className={`ef-shell wk${mode === "desktop" ? " is-desktop" : ""}${running ? " is-working" : ""}${sidebarOpen ? " has-sidebar" : ""}${sheet === 'settings' ? ' is-settings-open' : ''}`}>
      <LiquidGlassDefs />
      {mode === 'desktop' && <>
        <button className="wk-sidebar-toggle" onClick={toggleSidebar} aria-label={sidebarOpen ? 'Collapse worker sidebar' : 'Expand worker sidebar'} title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}>{sidebarOpen ? <PinOff size={18} /> : <Pin size={18} />}</button>
        <AnimatePresence>{sidebarOpen && <motion.nav className="wk-workspace-nav" aria-label="Workers and folders" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} transition={{ duration: 0.24, ease: EASE }}>
          <button className="wk-new-worker" onClick={startNew}>New worker<Plus size={20} /></button>
          <form className="wk-folder-create" onSubmit={event => { event.preventDefault(); createFolder(); }}><input aria-label="New folder name" placeholder="Create new folder..." value={folderName} onChange={event => setFolderName(event.target.value)} /><button type="submit" aria-label="Create worker folder"><FolderPlus size={18} /></button></form>
          {['Home', ...folders].map(folder => <div className="wk-folder-group" key={folder}>
            <button className="wk-folder-heading" onClick={() => setSelectedFolder(folder)} aria-expanded={selectedFolder === folder}><FolderOpen size={18} />{folder}</button>
            {selectedFolder === folder && workers.filter(worker => (worker.folder || 'Home') === folder).map(worker => <button className={`wk-sidebar-worker${worker.id === activeId ? ' is-active' : ''}`} key={worker.id} onMouseEnter={() => prewarm(worker)} onClick={() => openWorker(worker)}><Avatar w={worker} /><span>{worker.name}</span><span className="wk-sidebar-status"><MessageCircle size={13} /></span></button>)}
          </div>)}
          <button className="wk-overview" onClick={() => { setMode('home'); setActiveId(null); setSheet(null); }}>All workers</button>
        </motion.nav>}</AnimatePresence>
      </>}
      <div className="ef-shell-titlebar">
        <div className="ef-shell-controls"><WindowControls /></div>
      </div>

      <motion.div className="ef-screen" initial={{ opacity: 0, scale: 0.985 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.9, ease: EASE }}>
        <div className="ef-screen-fallback" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={WORKER_WALLPAPER}
          alt=""
          aria-hidden
          draggable={false}
          className="ef-screen-photo wk-photo"
          style={{
            filter: sharp ? "blur(0px) saturate(110%)" : `blur(${mode === "desktop" ? 22 : 26}px) brightness(${mode === "desktop" ? 0.88 : 0.92}) saturate(125%)`,
            transform: `scale(${sharp ? 1.02 : 1.1})`,
          }}
          onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")}
        />
        <div className="ef-screen-tint" style={{ opacity: sharp ? 0.45 : 1, transition: "opacity .6s" }} />
        <div className={`wk-vignette${mode === "desktop" ? " is-on" : ""}`} aria-hidden />

        {/* notch dock: when the worker has apps open it becomes their task bar */}
        {mode === "desktop" && active && taskApps.length > 0 ? (
          <div className="ef-notch wk-tasks" role="toolbar" aria-label="Open apps">
            <div className="wk-tasks-scroll">
            {(() => {
              const focusedApp = sheet ? undefined : wins.filter((w) => !w.min).sort((a, b) => b.z - a.z)[0]?.app;
              return taskApps.map((app) => {
                const win = wins.find((x) => x.app === app);
                const focused = app === focusedApp;
                return (
                  <button
                    key={app}
                    className={`wk-task${focused ? " is-focused" : win && !win.min ? " is-open" : ""}`}
                    title={APPS[app]?.name ?? app}
                    aria-label={`${APPS[app]?.name ?? app}${focused ? " (in front)" : !win ? " (closed)" : win.min ? " (minimized)" : ""}`}
                    aria-pressed={focused}
                    onClick={() => {
                      if (running) return;
                      setSheet(null);
                      if (focused) setWins((ws) => ws.map((x) => (x.app === app ? { ...x, min: true, max: false } : x)));
                      else showApp(app);
                    }}
                  >
                    <AppLogo app={app} size={50} radius={12} />
                    {addingApp === app && <span className="wk-task-install" role="status" aria-label={`Installing ${APPS[app]?.name ?? "app"}`} />}
                    {addingApp !== app && <span className="wk-task-delete" role="button" tabIndex={0} aria-label={`Remove ${APPS[app]?.name}`} onClick={e => { e.stopPropagation(); toggleApp(app); }} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); toggleApp(app); } }}><X size={11} strokeWidth={2.4} aria-hidden="true" /></span>}
                    <span className="wk-task-dot" aria-hidden />
                  </button>
                );
              });
            })()}
            <button className={`wk-task is-add${sheet === "apps" ? " is-focused" : ""}`} onClick={() => setSheet(sheet === "apps" ? null : "apps")} aria-label={sheet === 'apps' ? 'Close apps' : 'Add an app'} title={sheet === 'apps' ? 'Close apps' : 'Add an app'}>{sheet === 'apps' ? <X size={22} /> : <Plus size={22} />}</button>
            </div>
          </div>
        ) : (
        <div className="ef-notch" style={{ gap: 4 }}>
          {/* One button each side so the logo sits on the window's centre line. */}
          <button className={`wk-notch-btn${sheet === "apps" ? " is-on" : ""}`} onClick={() => setSheet(sheet === "apps" ? null : "apps")} aria-label="Apps" title="Apps"><LayoutGrid size={14} /></button>
          <span className="wk-notch-sep" />
          <button className="wk-notch-btn wk-notch-logo" onClick={() => { setMode("home"); setSheet(null); setPromptOpen(false); setDraft(null); setActiveId(null); }} aria-label="All workers">
            <Image src="/images/logos/black-logo-withoutbg.png" alt="" width={18} height={18} priority style={{ display: "block" }} />
            <span className="ef-notch-word">everfern</span>
          </button>
        </div>
        )}

        {storeError && (
          <div className="wk-store-error" role="alert">
            <TriangleAlert size={14} aria-hidden />
            <span>{storeError}</span>
            <button onClick={clearError} aria-label="Dismiss"><X size={13} /></button>
          </div>
        )}
        {mode === "home" && !sheet && <div className="ef-glass ef-screen-content"><Home ready={ready} workers={workers} onOpen={openWorker} onNew={startNew} onAsk={goToChat} onDelete={deleteWorker} /></div>}

        {/* hire flow: intelligence -> computer -> template */}
        {mode === "tier" && draft && (
          <div className="ef-glass ef-screen-content">
            <TierStep
              value={draft.tier}
              onChange={(tier) => setDraft((d) => (d ? { ...d, tier } : d))}
              onContinue={() => setMode("machine")}
              onBack={discardDraft}
            />
          </div>
        )}
        {mode === "machine" && draft && (
          <div className="ef-glass ef-screen-content">
            <MachineStep
              value={draft.machine ?? "local"}
              busy={machineBusy}
              error={machineErr}
              onChange={(machine) => setDraft((d) => (d ? { ...d, machine } : d))}
              onContinue={() => void chooseMachine(draft.machine ?? "local")}
            />
          </div>
        )}
        {mode === "template" && draft && (
          <div className="ef-glass ef-screen-content">
            <TemplateStep
              onPick={pickTemplate}
              onAll={() => setSheet("templates")}
              onBlank={startBlank}
            />
          </div>
        )}

        {/* worker computer */}
        {mode === "desktop" && (
          <WorkerDesktop
            onRemove={id => toggleApp(id)}
            adding={addingApp}
            wins={wins}
            setWins={setWins}
            // The marketplace keeps the 3D stack in view: open windows step aside into it, and apps you add land there.
            hideThumbs={(!!sheet && sheet !== "apps") || creationStage === "writing" || creationStage === "logins"}
            behind={chatShown || sheet === "apps" || creationStage === "ready" || creationStage === "completed"}
            onPick={() => { setChatHidden(true); setCreationStage("idle"); }}
            partition={active ? `persist:worker-${active.id}` : undefined}
            navTo={navTo}
            machine={active?.machine}
            cloudVmId={active?.cloudVmId}
            ai={running ? ai : null}
          />
        )}
        {paywall && <PaywallView info={paywall} onClose={() => setPaywall(null)} />}
        {mode === "desktop" && creationStage === "idle" && (
          <button className="wk-history wk-gpill" aria-expanded={historyOpen} aria-haspopup="dialog" onClick={() => setHistoryOpen((v) => !v)}><Clock size={18} />History</button>
        )}
        <AnimatePresence>
          {historyOpen && mode === "desktop" && creationStage === "idle" && (
            <>
              <div className="wk-hist-scrim" onClick={() => setHistoryOpen(false)} />
              <motion.div key="hist" className="wk-hist" role="dialog" aria-label="Chat history"
                initial={{ opacity: 0, y: 8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1, transition: { duration: 0.28, ease: EASE } }} exit={{ opacity: 0, y: 6, transition: { duration: 0.16 } }}
                onKeyDown={(e) => { if (e.key === "Escape") setHistoryOpen(false); }}>
                <div className="wk-hist-head">
                  <strong>History</strong>
                  <span>{sessions.length} {sessions.length === 1 ? "session" : "sessions"}</span>
                </div>
                {sessions.length ? (
                  <ul className="wk-hist-list">
                    {[...sessions].reverse().map((s, k) => {
                      const latest = k === 0;
                      const on = latest ? sessionAt === null : sessionAt === s.start;
                      return (
                        <li key={s.start}>
                          <button className={`wk-hist-item${on ? " is-on" : ""}`} autoFocus={on}
                            onClick={() => { setSessionAt(latest ? null : s.start); setChatHidden(false); setHistoryOpen(false); }}>
                            <span className="wk-hist-title">{s.title}</span>
                            <span className="wk-hist-meta">
                              {s.at ? new Date(s.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true }) : "Earlier"}
                              {" · "}{latest ? (chatBusy ? "Running" : "Latest") : s.finished ? "Finished" : "Ended"}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="wk-hist-empty">No sessions yet. What you ask this worker shows up here.</p>
                )}
              </motion.div>
            </>
          )}
        </AnimatePresence>

        {/* ── Workflow Creation Sequence Components ── */}
        <AnimatePresence>
          {mode === "desktop" && creationStage === "writing" && (
            <CenterStepsCard
              key="center-steps"
              jobText={planningJobText}
              steps={streamingSteps}
              partial={streamingPartial}
              availableApps={active?.apps ?? []}
            />
          )}

          {mode === "desktop" && creationStage === "logins" && (
            <AppLoginsModal
              key="app-logins"
              apps={loginApps}
              onOpenApp={(app) => showApp(app)}
              onContinue={() => setCreationStage("ready")}
              onDismiss={() => setCreationStage("ready")}
            />
          )}

          {mode === "desktop" && creationStage === "ready" && (
            <WorkflowCreatedBanner
              key="workflow-created"
              onRunNow={() => {
                setCreationStage("idle");
                if (active) void run(active);
              }}
              onRunLater={() => {
                setCreationStage("idle");
                schedule("Tomorrow at 9:00");
              }}
              onRecurring={() => {
                setCreationStage("idle");
                schedule("Every weekday at 9:00");
              }}
            />
          )}
        </AnimatePresence>

        {/* chat column */}
        {chatShown && !noWindows && (
          <motion.div className="wk-chat-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} />
        )}
        {chatShown && (
          <Chat msgs={chatMsgs} running={running} pauseNote={chatBusy ? undefined : pauseNote(active)} workflow={active?.prompt} canHide={!noWindows} withPlan={!!active?.prompt || !!livePlan} onHide={() => setChatHidden(true)} onRun={() => active && resume(active)} onRunSteps={(st) => active && run(active, st)} onSaveWorkflow={saveWorkflow} onStop={() => active && stop(active)} onEdit={() => { setPromptText(active?.prompt ?? ""); setPromptOpen(true); }} onSchedule={schedule} onAnswer={(i, t) => answer(i + (viewing?.start ?? 0), t)}
            past={viewing && viewing.start !== sessions[sessions.length - 1]?.start ? { at: viewing.at, onLatest: () => setSessionAt(null) } : undefined} />
        )}
        <AnimatePresence>
          {(chatShown || (mode === "desktop" && !sheet && (creationStage === "logins" || creationStage === "ready" || creationStage === "completed" || planDuringRun))) && (active?.prompt || livePlan) && active && (
            <PlanPanel
            scheduleLabel={active?.schedule?.label}
              key="plan"
              steps={livePlan ? livePlan.steps : parseSteps(active.prompt ?? "")}
              apps={active.apps}
              running={running}
              paused={active.status === "paused" && !running}
              completed={creationStage === "completed"}
              completedStepIndex={livePlan ? livePlan.done : completedStepIndex}
              used={livePlan?.used}
              planKey={`${active.id}|${livePlan ? livePlan.steps.join("\n") : active.prompt ?? ""}`}
              onEdit={() => {
                setCreationStage("idle");
                setPromptText(active.prompt ?? "");
                setPromptOpen(true);
              }}
              onSchedule={(l) => {
                setCreationStage("idle");
                schedule(l);
              }}
            />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {sheet === "settings" && (
            <SettingsSheet
              key="settings"
              workers={workers}
              initialTab={settingsSection}
              onSaveWorker={update}
              onClose={() => setSheet(null)}
              onLogout={() => { logoutLocal(); setSheet(null); router.push("/auth"); }}
            />
          )}
        </AnimatePresence>

        {/* side rail + sheets */}
        <AnimatePresence>
          {sheet && sheet !== "settings" && (
            <>
              <motion.div key="scrim" className="wk-scrim" onClick={() => setSheet(null)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
              <motion.nav key="rail" className="wk-rail wk-glass" initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0, transition: { duration: 0.4, ease: EASE } }} exit={{ opacity: 0, x: -12 }}>
                <button className={sheet === "apps" ? "is-on" : ""} onClick={() => setSheet("apps")} aria-label="Apps" title="Apps"><LayoutGrid size={16} /></button>
                <button className={sheet === "templates" ? "is-on" : ""} onClick={() => setSheet("templates")} aria-label="Templates" title="Templates"><List size={16} /></button>
              </motion.nav>
              {sheet === "apps" ? (
                <AppsSheet key="apps" installed={active?.apps ?? []} canInstall={!!active} onToggle={id => toggleApp(id)} onClose={() => setSheet(null)} />
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

      {removeApp && createPortal(<div className="wk-remove-overlay" onClick={() => setRemoveApp(null)}><div ref={removeDialogRef} tabIndex={-1} className="wk-remove-dialog" role="alertdialog" aria-modal="true" aria-labelledby="remove-app-title" onClick={e => e.stopPropagation()} onKeyDown={e => { if (e.key === 'Escape') setRemoveApp(null); }}><AppLogo app={removeApp} size={48} radius={13} /><h2 id="remove-app-title">Remove {APPS[removeApp]?.name}?</h2><p>{running ? "Pause the worker before removing an app it may be using." : "This removes the app from this worker. You can add it again from the marketplace."}</p><div><button autoFocus className="st-btn" onClick={() => setRemoveApp(null)}>Keep app</button><button className="st-btn is-remove" disabled={running} onClick={() => { toggleApp(removeApp, true); setRemoveApp(null); }}>Remove app</button></div></div></div>, document.body)}
      {/* bottom bar */}
      <div className="wk-bar">
        <div className="wk-bar-side">
          {mode !== "home" && <button className="wk-lpill is-icon" onClick={startNew} aria-label="New worker" title="New worker"><Plus size={17} /></button>}
          <div className="wk-workers-scroll">
            {draft && (
              <span className="wk-lpill is-active">
                <Avatar w={draft} />
                <span className="wk-lpill-name">New worker</span>
                <button className="wk-mini" onClick={discardDraft} aria-label="Discard new worker" title="Discard"><X size={13} /></button>
              </span>
            )}
            {workers.map((w) => (
              <span key={w.id} className={`wk-lpill${w.id === activeId && mode === "desktop" ? " is-active" : ""}`} onMouseEnter={() => prewarm(w)} onClick={() => openWorker(w)} role="button" tabIndex={0}
                onKeyDown={(e) => e.key === "Enter" && openWorker(w)}>
                <Avatar w={w} />
                <span className="wk-lpill-name">{w.name}</span>
                <button
                  className={`wk-mini${w.status === "running" ? " is-stop" : ""}`}
                  onClick={(e) => { e.stopPropagation(); if (w.status === "running") stop(w); else if (w.prompt) { openWorker(w); if (w.status === "paused") resume(w); else run(w); } else openWorker(w); }}
                  aria-label={w.status === "running" ? `Pause ${w.name}` : w.status === "paused" ? `Continue ${w.name}` : `Run ${w.name}`}
                  title={w.status === "running" ? "Pause" : w.status === "paused" ? "Continue" : "Run"}
                >
                  {w.status === "running" ? <Pause size={12} fill="currentColor" strokeWidth={0} /> : <Play size={12} fill="currentColor" strokeWidth={0} style={{ marginLeft: 1 }} />}
                </button>
              </span>
            ))}
          </div>
        </div>

        <div className={mode === "desktop" ? "wk-bar-mid is-notch" : undefined}>
          {mode === "desktop" && active ? (
            <>
            {chatHidden && !noWindows && !sheet && recentChatText && <button className="wk-chat-peek" onClick={() => setChatHidden(false)} aria-label="Expand conversation" title={recentChatText}><span>{recentChatText}</span><ChevronUp size={18} /></button>}
            <button className="wk-model-status" onClick={() => { setSettingsSection(active.tier === 'pro' ? 'model' : 'subscription'); setSheet('settings'); }} aria-label={active.tier === 'pro' ? 'Change worker intelligence' : 'View Pro subscription'}><IntelligenceIcon />{TIERS.find(tier => tier.id === active.tier)?.name ?? "Lite"} intelligence<span>{active.tier === 'pro' ? 'Change' : 'Unlock Pro'}</span></button>
            <div className="wk-chatpill">
              {running && <button className="wk-composer-pause" aria-label="Pause worker" onClick={event => { event.stopPropagation(); stop(active); }}><Pause size={19} fill="currentColor" strokeWidth={0} /></button>}
              <input className="wk-composer-input" aria-label="Describe your task" placeholder={active.status === "paused" ? "Suggest changes…" : "Describe your task"} value={composerText} disabled={running} onChange={event => setComposerText(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing && composerText.trim()) { event.preventDefault(); const text = composerText.trim(); setComposerText(''); setChatHidden(false); void planFor(active, text, text); } }} />
              {active.status === "paused" && !chatBusy && (
                <button className="wk-continue" onClick={(e) => { e.stopPropagation(); resume(active); }}>
                  <Play size={13} fill="currentColor" strokeWidth={0} /> Continue
                </button>
              )}
              {/* Teach is in beta and hidden for now; only the send button shows, once something is typed.
                  To bring Teach back, restore this button in place of the one below:
              <button className={`wk-mini wk-teach${composerText.trim() ? ' is-send' : ''}`} onClick={(e) => { e.stopPropagation(); if (composerText.trim()) { const text = composerText.trim(); setComposerText(''); setChatHidden(false); void planFor(active, text, text); return; } if (!promptOpen) setPromptText((t) => (t.trim() === (active.prompt ?? "").trim() ? "" : t)); setPromptOpen((o) => !o); }} aria-label={composerText.trim() ? 'Send message' : 'Open prompt'}>
                {composerText.trim() ? <ArrowUp size={23} /> : <><TeachIcon /><span>Teach</span></>}
              </button>
              */}
              {composerText.trim() && (
                <button className="wk-mini wk-teach is-send" onClick={(e) => { e.stopPropagation(); const text = composerText.trim(); setComposerText(''); setChatHidden(false); void planFor(active, text, text); }} aria-label="Send message">
                  <ArrowUp size={23} />
                </button>
              )}
            </div>
            </>
          ) : mode === "home" ? (
            <button className="wk-chatpill" onClick={startNew}>
              <span className="wk-chatpill-text">Describe a job for a new worker…</span>
              <span className="wk-mini"><ArrowRight size={15} /></span>
            </button>
          ) : null}
        </div>

        <div className="wk-bar-side wk-bar-right">
          <button className={`wk-lpill is-icon${sheet === "settings" ? " is-active" : ""}`} onClick={() => { setSettingsSection('account'); setSheet(sheet === "settings" ? null : "settings"); }} aria-label="Settings" title="Settings"><User size={20} /></button>
          <button className="wk-lpill is-icon" onClick={() => { setSettingsSection('notifications'); setSheet('settings'); }} aria-label="Notification settings" title="Notifications"><Bell size={20} /></button>
          <button className="wk-lpill wk-ask" style={{ padding: "0 14px 0 12px" }} onClick={goToChat} aria-label="Ask EverFern" title="Ask EverFern"><MessageCircle size={18} /><span className="wk-ask-label">Ask EverFern</span></button>
        </div>
      </div>
    </div>
    </MotionConfig>
  );
}

/* ═════════════════════════════════════════════════════════════════ */

function ConfirmDelete({ worker, onCancel, onConfirm }: { worker: Worker; onCancel: () => void; onConfirm: () => void }) {
  const dialogRef = useDialogFocus<HTMLDivElement>(true, onCancel);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onCancel]);
  // Portal to <body>: the home view sits inside transformed, filtered layers that would trap a fixed overlay.
  return createPortal(
    <motion.div className="wk-modal-scrim" onClick={onCancel} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
      <motion.div
        ref={dialogRef} tabIndex={-1} className="wk-modal wk-glass" role="alertdialog" aria-modal="true" aria-labelledby="wk-del-t" onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, y: 14, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1, transition: { duration: 0.35, ease: [0.16, 1, 0.3, 1] } }}
        exit={{ opacity: 0, y: 8, scale: 0.98, transition: { duration: 0.18 } }}
      >
        <Avatar w={worker} size={44} />
        <h2 id="wk-del-t" className="wk-modal-t">Delete {worker.name}?</h2>
        <p className="wk-modal-p">Its job, schedule, chat history, files, and saved logins are removed, and any run it has going is stopped. This can&apos;t be undone.</p>
        <div className="wk-modal-row">
          <button className="wk-gpill" onClick={onCancel} autoFocus>Cancel</button>
          <button className="wk-gpill is-danger" onClick={onConfirm}><Trash2 size={14} /> Delete worker</button>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}

function Home({ ready, workers, onOpen, onNew, onAsk, onDelete }: {
  ready: boolean; workers: Worker[]; onOpen: (w: Worker) => void; onNew: () => void; onAsk: () => void; onDelete: (id: string) => void;
}) {
  const [doomed, setDoomed] = useState<Worker | null>(null);
  if (!ready) return null;
  if (!workers.length) {
    return (
      <div className="wk-step">
        <motion.h1 className="wk-title" {...rise}>Hire your first worker</motion.h1>
        <motion.p className="wk-sub" {...rise}>A worker is an AI teammate with its own computer. Teach it a job once and it keeps doing it.</motion.p>
        <motion.div {...rise} style={{ display: "flex", gap: 10, justifyContent: "center" }}>
          <button className="wk-gpill is-lg" onClick={onAsk}><MessageCircle size={16} /> Ask EverFern</button>
          <button className="wk-gpill is-lg" onClick={onNew}><Plus size={16} /> New worker</button>
        </motion.div>
      </div>
    );
  }
  return (
    <div className="wk-step" style={{ maxWidth: 900 }}>
      <motion.h1 className="wk-title" {...rise}>Your workers</motion.h1>
      <motion.p className="wk-sub" {...rise}>Chat with EverFern, or open a worker to watch it, change its job or run it.</motion.p>
      <div className="wk-home-grid">
        {/* Chat is always the first place you can go: ask, and hand work to a worker from there. */}
        <motion.div className="wk-card wk-wcard wk-ask-card" {...rise} onClick={onAsk} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && onAsk()}>
          <div className="wk-wcard-head">
            <span className="wk-ask-card-icon" aria-hidden><MessageCircle size={18} /></span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="wk-wcard-name">Ask EverFern</div>
              <div className="wk-wcard-meta">Chat</div>
            </div>
          </div>
          <div className="wk-wcard-job">Ask a question, think something through, or plan a job before you give it to a worker.</div>
        </motion.div>
        <motion.button className="wk-card wk-add-card" {...rise} onClick={onNew}><Plus size={18} /> New worker</motion.button>
        {workers.map((w) => (
          <motion.div key={w.id} className="wk-card wk-wcard" {...rise} onClick={() => onOpen(w)} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && onOpen(w)}>
            <div className="wk-wcard-head">
              <Avatar w={w} size={36} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="wk-wcard-name">{w.name}</div>
                <div className="wk-wcard-meta">
                  <span className={`wk-dot${w.status === "running" ? " is-running" : w.status === "paused" ? " is-paused" : ""}`} />
                  {w.status} · {TIERS.find((t) => t.id === w.tier)?.name}
                </div>
              </div>
              <button className="wk-app-btn" style={{ marginLeft: 0 }} onClick={(e) => { e.stopPropagation(); setDoomed(w); }} aria-label={`Delete ${w.name}`} title="Delete"><X size={13} /></button>
            </div>
            <div className="wk-wcard-job">{w.prompt ? parseSteps(w.prompt).join(" · ") : "No job yet. Open it to teach it one."}</div>
            <div style={{ marginTop: "auto" }}><AppLogoCluster apps={w.apps.slice(0, 5)} size={24} /></div>
          </motion.div>
        ))}
      </div>
      <AnimatePresence>
        {doomed && <ConfirmDelete key="del" worker={doomed} onCancel={() => setDoomed(null)} onConfirm={() => { onDelete(doomed.id); setDoomed(null); }} />}
      </AnimatePresence>
    </div>
  );
}

/** One sphere per level: Lite 1, Balanced 2, Pro 3. */
function TierGlyph({ tier }: { tier: Worker["tier"] }) {
  const n = tier === "lite" ? 1 : tier === "balanced" ? 2 : 3;
  return (
    <span className={`wk-glyph is-${tier}`} aria-hidden="true">
      {Array.from({ length: n }, (_, i) => <span key={i} className={`wk-ball b${i}`} />)}
    </span>
  );
}

function TierStep({ value, onChange, onContinue, onBack }: { value: Worker["tier"]; onChange: (t: Worker["tier"]) => void; onContinue: () => void; onBack: () => void }) {
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
              <TierGlyph tier={t.id} />
              {t.tag && <span className="wk-tag"><Zap size={12} /> {t.tag}</span>}
            </div>
            <div className="wk-tier-row">
              <span className="wk-tier-name">{t.name}</span>
              <span className="wk-tier-price">{t.price}</span>
            </div>
            <div className="wk-tier-desc">{t.desc}</div>
          </motion.button>
        ))}
      </div>
      <motion.p className="wk-note" {...rise}>This can be changed at any time later.</motion.p>
      <motion.div className="wk-step-nav" {...rise}>
        <button className="wk-gpill is-ghost" onClick={onBack}><ArrowLeft size={15} /> Back</button>
        <button className="wk-gpill" onClick={onContinue}>Continue <ArrowRight size={15} /></button>
      </motion.div>
    </div>
  );
}

function MachineStep({ value, busy, error, onChange, onContinue }: { value: Machine; busy: boolean; error: string; onChange: (m: Machine) => void; onContinue: () => void }) {
  const auth = useCloudAuth();
  const needsSignIn = value === "cloud" && !auth.signedIn;
  const options: { id: Machine; name: string; desc: string; icon: React.ReactNode }[] = [
    { id: "local", name: "This computer", desc: "Runs in EverFern's private Linux VM on this PC. Free, and your files stay here.", icon: <Monitor size={22} strokeWidth={1.6} /> },
    { id: "cloud", name: "EverFern Cloud VM", desc: "Runs on its own cloud computer, so it keeps working when this PC is off or asleep.", icon: <Image src="/images/logos/black-logo-withoutbg.png" alt="" width={24} height={24} className="wk-machine-logo" /> },
  ];
  return (
    <div className="wk-step">
      <motion.h1 className="wk-title" {...rise}>Where should your worker&apos;s computer run?</motion.h1>
      <motion.p className="wk-sub" {...rise}>Your worker uses its own computer with a browser and apps.</motion.p>
      <div className="wk-row2" role="radiogroup" aria-label="Computer">
        {options.map((o, i) => (
          <motion.button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={value === o.id}
            className={`wk-card wk-tier wk-machine${value === o.id ? " is-selected" : ""}`}
            onClick={() => onChange(o.id)}
            onDoubleClick={() => { if (!busy && !(o.id === "cloud" && !auth.signedIn)) onContinue(); }}
            disabled={busy}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE, delay: 0.08 + i * 0.06 } }}
          >
            <div className="wk-tier-top">
              <span className="wk-machine-ico">{o.icon}</span>
              {o.id === "cloud" && <span className="wk-tag">Always on</span>}
            </div>
            <div className="wk-tier-row"><span className="wk-tier-name">{o.name}</span></div>
            <div className="wk-tier-desc">{o.desc}</div>
          </motion.button>
        ))}
      </div>
      {needsSignIn && <motion.div className="wk-machine-gate" {...rise}><CloudGate auth={auth} what="A cloud computer" /></motion.div>}
      {error && <motion.p className="wk-machine-err" role="alert" {...rise}>{error}</motion.p>}
      {!needsSignIn && (
        <motion.p className="wk-note" {...rise}>
          {busy ? "Setting up your cloud computer. This takes a few seconds." : "You can change this later in Settings."}
        </motion.p>
      )}
      <motion.div {...rise}>
        <button className="wk-gpill" onClick={onContinue} disabled={busy || needsSignIn}>
          {busy ? <><LoaderCircle size={15} className="wk-spin" /> Setting up</> : <>Continue <ArrowRight size={15} /></>}
        </button>
      </motion.div>
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

/** The worker's apps plus every app the job or its steps name (one-off jobs and workflows alike). */
function withJobApps(apps: string[], text: string, steps: string[]): string[] {
  const all = Object.keys(APPS);
  const found = new Set<string>();
  for (const st of [text, ...steps]) for (const a of appsInStep(st, all)) found.add(a);
  const t = `${text} ${steps.join(" ")}`.toLowerCase();
  for (const id of ["amazon", "canva", "moss", "linkedin"]) if (t.includes(id)) found.add(id);
  // A web job with no named site still needs a browser window to show.
  if (!found.size && /\b(search|browse|website|online|web|look ?up)\b/i.test(t) && !apps.includes("browser")) found.add("browser");
  return Array.from(new Set([...apps, ...found]));
}

/** Which installed apps a step mentions, for the chips under each step. */
/** One app in front: the chosen window opens and every other one goes to the 3D stack on the side. */
function bringUp(ws: Win[], app: string): Win[] {
  const top = Math.max(0, ...ws.map((x) => x.z)) + 1;
  const rest = ws.map((x) => (x.app === app ? x : { ...x, min: true, max: false }));
  return rest.some((x) => x.app === app)
    ? rest.map((x) => (x.app === app ? { ...x, min: false, z: top } : x))
    : [...rest, { app, min: false, max: false, z: top }];
}

/** Planning tools: shown as the plan column, never as chat pills. */
const PLAN_TOOLS = new Set(["create_plan", "update_plan_step", "execution_plan", "todo_write", "update_todos"]);

function parseStepParts(st: string) {
  if (st.includes("\n")) {
    const lines = st.split("\n").map(s => s.trim()).filter(Boolean);
    return { title: lines[0] || st, rest: lines.slice(1).join(" ") };
  }
  const cut = st.search(/[.:]\s/);
  if (cut > 0 && cut < st.length - 10) {
    return { title: st.slice(0, cut + 1), rest: st.slice(cut + 2) };
  }
  return { title: st, rest: "" };
}

function CenterStepsCard({
  jobText,
  steps,
  partial,
  availableApps,
}: {
  jobText: string;
  steps: string[];
  partial?: string;
  availableApps: string[];
}) {
  const allSteps = partial ? [...steps, partial] : steps;
  const [sentAt] = useState(() => new Date().toLocaleString("en-GB", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true }));
  const isSinglePill = allSteps.length === 0;

  // No centred message pill while the plan is still empty: the chat already shows what was sent.
  if (isSinglePill) return null;

  return (
    <motion.div
      className="wk-center-steps"
      layoutId="wk-plan-surface"
      transition={{ layout: { duration: 0.7, ease: EASE } }}
      initial={{ opacity: 0, scale: 0.985, y: 8 }}
      animate={{ opacity: 1, scale: 1, y: 0, transition: TASK_SPRING }}
      exit={{ opacity: 0, scale: 0.985, y: 8, transition: { duration: 0.16 } }}
    >
      <div className="wk-center-steps-list">
        {allSteps.map((st, i) => {
          const isCurrent = i === allSteps.length - 1 && !!partial;
          const { title, rest } = parseStepParts(st);
          const chips = appsInStep(st, availableApps);
          return (
            <motion.div
              key={i}
              className="wk-center-step-item"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0, transition: TASK_SPRING }}
            >
              {isCurrent ? (
                <span className="wk-step-spinner" />
              ) : (
                <span className="wk-step-bullet" />
              )}
              <div className="wk-step-content">
                <div className="wk-step-title">{title}</div>
                {rest && <div className="wk-step-desc">{rest}</div>}
                {chips.length > 0 && (
                  <div className="wk-step-chips">
                    {chips.map((c) => (
                      <span key={c} className="wk-step-chip">
                        <AppLogo app={c} size={12} radius={3} /> {APPS[c]?.name ?? c}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
}

function AppLoginsModal({
  apps,
  onOpenApp,
  onContinue,
  onDismiss,
}: {
  apps: string[];
  onOpenApp: (app: string) => void;
  onContinue: () => void;
  onDismiss: () => void;
}) {
  const [visited, setVisited] = useState<Record<string, boolean>>({});

  const handleAppClick = (app: string) => {
    setVisited((prev) => ({ ...prev, [app]: true }));
    onOpenApp(app);
  };

  return (
    <motion.div
      className="absolute inset-0 flex items-center justify-center pointer-events-none z-30"
      initial={{ opacity: 0, scale: 0.985, y: 8 }}
      animate={{ opacity: 1, scale: 1, y: 0, transition: TASK_SPRING }}
      exit={{ opacity: 0, scale: 0.985, y: 8, transition: { duration: 0.16 } }}
    >
      <div className="wk-lg-backdrop" />
      <div className="wk-lg pointer-events-auto select-none">
        <h2 className="wk-lg-title">App logins</h2>
        <p className="wk-lg-sub">Set up logins for the apps below, then continue.</p>
        <div className="wk-lg-list">
          {apps.map((app) => (
            <button key={app} className="wk-lg-row" onClick={() => handleAppClick(app)}>
              <AppLogo app={app} size={16} radius={4} />
              <span className="wk-lg-name">{APPS[app]?.name ?? app}</span>
              <Check size={12} strokeWidth={2.4} className={`wk-lg-check${visited[app] ? " is-on" : ""}`} />
            </button>
          ))}
        </div>
        <div className="wk-lg-actions">
          <button className="wk-lg-continue" onClick={onContinue}>Continue</button>
          <span className="wk-lg-divider" />
          <button className="wk-lg-dismiss" onClick={onDismiss}>Dismiss login</button>
        </div>
      </div>
    </motion.div>
  );
}

// ── Workflow Banners & Panels (Tailwind CSS) ──
function WorkflowCreatedBanner({
  onRunNow,
  onRunLater,
  onRecurring,
}: {
  onRunNow: () => void;
  onRunLater: () => void;
  onRecurring: () => void;
}) {
  return (
    <motion.div
      className="absolute inset-0 flex items-center justify-center pointer-events-none z-30"
      initial={{ opacity: 0, scale: 0.985, y: 8 }}
      animate={{ opacity: 1, scale: 1, y: 0, transition: TASK_SPRING }}
      exit={{ opacity: 0, scale: 0.985, y: 8, transition: { duration: 0.16 } }}
    >
      <div className="wk-ready-card pointer-events-auto flex flex-col items-center gap-3.5 text-center select-none">
        <div className="w-8 h-1 bg-white/20 rounded-full mb-1" />
        <p className="text-sm text-white/80 max-w-md font-normal leading-relaxed">
          The workflow is created and ready. When would you like to execute this task?
        </p>
        <div className="flex items-center gap-3 mt-1">
          <button
            className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-white/10 hover:bg-white/20 border border-white/15 text-white text-xs font-medium transition cursor-pointer backdrop-blur-xl shadow-lg active:scale-95"
            onClick={onRunNow}
          >
            <Play size={12} fill="currentColor" strokeWidth={0} /> Run now
          </button>
          <button
            className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-white/10 hover:bg-white/20 border border-white/15 text-white text-xs font-medium transition cursor-pointer backdrop-blur-xl shadow-lg active:scale-95"
            onClick={onRunLater}
          >
            <Calendar size={13} strokeWidth={2} /> Run later
          </button>
          <button
            className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-white/10 hover:bg-white/20 border border-white/15 text-white text-xs font-medium transition cursor-pointer backdrop-blur-xl shadow-lg active:scale-95"
            onClick={onRecurring}
          >
            <Repeat size={13} strokeWidth={2} /> Recurring
          </button>
        </div>
      </div>
    </motion.div>
  );
}

/** The end-of-run report, posted in the chat as the AI's reply. */
function RunReportCard({ result, at, onRunAgain, actions }: { result: RunReport; at: string; onRunAgain: () => void; actions?: React.ReactNode }) {
  return (
    <div className="wk-msg-ai wk-run-report">
      {/* Only show a cost tile when the run actually reported one; "Not reported" tells the reader nothing. */}
      {result.cost && result.cost !== "Not reported" && (
        <div className="wk-run-report-stats">
          <div><span>{result.costLabel}</span><b>{result.cost}</b></div>
        </div>
      )}
      <div className="wk-run-report-summary wk-reply-content"><ReplyText text={result.summary} /></div>
      {result.accomplishments.length > 0 && (
        <ul className="wk-run-report-list">
          {result.accomplishments.map((item, idx) => <li key={idx}><Check size={11} strokeWidth={2.6} /> {item}</li>)}
        </ul>
      )}
      <div className="wk-run-report-foot">
        <span className="wk-run-report-actions">
          <button onClick={onRunAgain}><Play size={11} fill="currentColor" strokeWidth={0} /> Run again</button>
          {actions}
        </span>
        <span className="wk-msg-time">{result.timeWorked ? `Took ${result.timeWorked} · ` : ""}{at}</span>
      </div>
    </div>
  );
}

function PlanPanel({
  scheduleLabel,
  steps,
  apps,
  running,
  paused,
  completed,
  completedStepIndex = -1,
  used,
  planKey,
  onEdit,
  onSchedule,
}: {
  scheduleLabel?: string;
  steps: string[];
  apps: string[];
  running: boolean;
  paused?: boolean;
  completed?: boolean;
  completedStepIndex?: number;
  used?: string[][];
  planKey: string;
  onEdit: () => void;
  onSchedule: (label: string) => void;
}) {
  const [picking, setPicking] = useState(false);
  const [docked, setDocked] = useState(false);
  // A new plan always opens in full on the right; it only steps aside when you move it.
  useEffect(() => {
    setDocked(false);
    setPicking(false);
  }, [planKey]);

  const doneCount = completed ? steps.length : Math.max(0, Math.min(steps.length, completedStepIndex));
  const current = completed ? -1 : running || paused ? Math.min(steps.length - 1, doneCount) : -1;
  const stateOf = (k: number) => `${k < doneCount ? "is-done" : ""}${k === current ? (paused ? " is-paused" : " is-active") : ""}`;
  const appsFor = (k: number) => stepApps(steps[k] ?? "", apps, used?.[k]);
  const allApps = Array.from(new Set(steps.flatMap((_, k) => appsFor(k)))).slice(0, 6);

  return (
    <AnimatePresence initial={false} mode="popLayout">
      {docked ? (
        <div key="dock" className="wk-pl-dock">
          <motion.button
            className="wk-thumb wk-pl-thumb"
            onClick={() => setDocked(false)}
            initial={{ opacity: 0, x: 60, rotateY: -50 }}
            animate={{ opacity: 1, x: 0, rotateY: -16, transition: { type: "spring", duration: 0.45, bounce: 0 } }}
            exit={{ opacity: 0, x: 40, rotateY: -40, transition: { duration: 0.2, ease: EASE } }}
            whileHover={{ rotateY: -5, x: -6, scale: 1.015, transition: { type: "spring", duration: 0.3, bounce: 0 } }}
            title="Open the plan"
          >
            <div className="wk-thumb-bar">
              <ListChecks size={14} strokeWidth={2} aria-hidden="true" />
              <span className="wk-thumb-name">Plan</span>
              <span className="wk-pl-count">{paused ? "Paused · " : ""}{doneCount}/{steps.length}</span>
            </div>
            <div className="wk-thumb-card wk-pl-mini">
              <ol>
                {steps.slice(0, 4).map((st, k) => (
                  <li key={k} className={stateOf(k)}>
                    <span className="wk-pl-mdot" aria-hidden="true">{k < doneCount && <Check size={6} strokeWidth={4} />}</span>
                    <span className="wk-pl-mtext">{parseStepParts(st).title}</span>
                    {appsFor(k).length > 0 && (
                      <span className="wk-pl-mapp" title={appsFor(k).map((id) => APPS[id]?.name ?? id).join(", ")}>
                        {appsFor(k).slice(0, 2).map((id) => <AppLogo key={id} app={id} size={12} radius={3} />)}
                      </span>
                    )}
                  </li>
                ))}
                {steps.length > 4 && <li className="wk-pl-more">{steps.length - 4} more</li>}
              </ol>
              {allApps.length > 0 && (
                <div className="wk-pl-mapps">
                  {allApps.map((id) => <AppLogo key={id} app={id} size={14} radius={3.5} />)}
                </div>
              )}
            </div>
          </motion.button>
        </div>
      ) : (
        <motion.aside
          key="open"
          className="wk-lp"
          aria-label="Task plan"
          initial={{ opacity: 0, x: 28, scale: 0.97, filter: "blur(6px)" }}
          animate={{ opacity: 1, x: 0, scale: 1, filter: "blur(0px)", transition: { type: "spring", duration: 0.5, bounce: 0 } }}
          exit={{ opacity: 0, x: 40, scale: 0.94, filter: "blur(6px)", transition: { duration: 0.28, ease: EASE } }}
        >
          {picking ? (
            <div className="wk-lp-card wk-lp-menu lg-glass" role="menu" aria-label="Task schedule">
              <p>Runs while EverFern is open, in this computer's time zone.</p>
              {[...SCHEDULE_LABELS, ...(scheduleLabel ? [REMOVE_SCHEDULE] : [])].map((l) => (
                <button key={l} role="menuitem" className={l === scheduleLabel ? "is-on" : ""} onClick={() => { setPicking(false); onSchedule(l); }}>
                  {l}{l === scheduleLabel && <Check size={13} strokeWidth={2.5} aria-hidden="true" />}
                </button>
              ))}
              <button className="is-quiet" onClick={() => setPicking(false)}>Cancel</button>
            </div>
          ) : (
            <button className="wk-lp-card wk-lp-sched lg-glass" onClick={() => setPicking(true)} aria-haspopup="menu">
              <span className="wk-lp-sched-icon"><CalendarClock size={17} strokeWidth={1.8} /></span>
              <span className="wk-lp-sched-text">
                <b>{scheduleLabel || "Set a task schedule"}</b>
                <small>{scheduleLabel ? "Scheduled" : "Run it on its own, daily or weekly"}</small>
              </span>
              <ChevronRight size={16} className="wk-lp-chev" aria-hidden="true" />
            </button>
          )}

          <section className="wk-lp-card wk-lp-task lg-glass">
            <header className="wk-lp-head">
              <span className="wk-lp-status">
                <span className={`wk-lp-led${completed ? " is-done" : paused ? " is-paused" : running ? " is-live" : ""}`} aria-hidden="true" />
                {completed ? "Done" : paused ? "Paused" : running ? "Working" : "Plan"}
              </span>
              <span className="wk-lp-count">{doneCount} of {steps.length}</span>
              <button className="wk-lp-iconbtn" onClick={() => setDocked(true)} title="Move to the side" aria-label="Move the plan to the side"><PanelRightClose size={15} /></button>
            </header>
            <button className="wk-lp-edit" onClick={onEdit}><Pencil size={14} strokeWidth={2} /> Edit task</button>

            <ol className="wk-lp-steps">
              {steps.map((st, k) => {
                const { title, rest } = parseStepParts(st);
                const chips = appsFor(k);
                const isDone = k < doneCount;
                return (
                  <motion.li
                    key={k}
                    className={stateOf(k)}
                    aria-current={k === current ? "step" : undefined}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0, transition: { delay: Math.min(k, 10) * 0.04, type: "spring", duration: 0.4, bounce: 0 } }}
                  >
                    <span className="wk-lp-dot" aria-hidden="true">{isDone && <Check size={9} strokeWidth={3.5} />}</span>
                    <div className="wk-lp-body">
                      <div className="wk-lp-t">{title}</div>
                      {rest && <div className="wk-lp-d">{rest}</div>}
                      {chips.length > 0 && (
                        <div className="wk-lp-chips">
                          {chips.map((id) => (
                            <span key={id} className="wk-lp-chip"><AppLogo app={id} size={16} radius={4} />{APPS[id]?.name ?? id}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </motion.li>
                );
              })}
            </ol>
          </section>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

const ASK_ICON: Record<string, LucideIcon> = {
  sun: Sun, clock: Clock, calendar: Calendar, repeat: Repeat, mail: Mail, globe: Globe, search: Search,
  file: FileText, user: User, bell: Bell, check: Check, x: X,
};

/** A clarifying question: type your own answer, or pick one of the AI's suggestions. */
function AskCard({ question, options, disabled, onAnswer }: { question: string; options: { label: string; icon?: string }[]; disabled: boolean; onAnswer: (text: string) => void }) {
  const [text, setText] = useState("");
  const send = (v: string) => { if (!disabled && v.trim()) { onAnswer(v); setText(""); } };
  return (
    <div className="wk-q">
      <p className="wk-q-title">{question}</p>
      <form className="wk-q-input" onSubmit={(e) => { e.preventDefault(); send(text); }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Type your own answer..." aria-label={question} disabled={disabled} />
        <button type="submit" aria-label="Send answer" disabled={disabled || !text.trim()}><ArrowUp size={16} /></button>
      </form>
      {options.length > 0 && (
        <div className="wk-q-opts">
          {options.map((o) => {
            const Icon = (o.icon && ASK_ICON[o.icon]) || CircleDot;
            return <button key={o.label} className="wk-q-opt" disabled={disabled} onClick={() => send(o.label)}><Icon size={16} /> <span>{o.label}</span></button>;
          })}
        </div>
      )}
    </div>
  );
}

function Chat({ msgs, running, pauseNote, workflow, canHide, withPlan, onHide, onRun, onRunSteps, onSaveWorkflow, onStop, onEdit, onSchedule, onAnswer, past }: {
  msgs: Msg[]; running: boolean;
  /** Set while the worker is paused mid-task: what happened and where Continue picks up. */
  pauseNote?: string;
  /** The worker's saved workflow (its prompt), to tell a one-off task from it. */
  workflow?: string;
  canHide?: boolean; withPlan: boolean; onHide: () => void; onRun: () => void; onStop: () => void; onEdit: () => void;
  onRunSteps: (steps: string[]) => void; onSaveWorkflow: (steps: string[]) => void;
  onSchedule: (label: string, patch?: Partial<Worker>) => void;
  onAnswer: (index: number, text: string) => void;
  /** Set while a past session from History is shown. */
  past?: { at?: number; onLatest: () => void };
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Follow new and streaming text, unless the user has scrolled up to read.
  const stick = useRef(true);
  const last = msgs[msgs.length - 1];
  const tail = last && "text" in last ? last.text.length : 0;
  // Earlier turns fold behind a divider; the latest turn (from the last thing you said) stays open.
  const lastUser = useMemo(() => msgs.map((m, i) => (m.kind === "user" ? i : -1)).filter((i) => i >= 0).pop() ?? 0, [msgs]);
  const [showAll, setShowAll] = useState(false);
  useEffect(() => { setShowAll(false); }, [lastUser]);
  const folded = lastUser > 0 && !showAll;
  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [msgs.length, tail, folded]);
  const lastFlow = useMemo(() => msgs.map((m, i) => (m.kind === "flow" ? i : -1)).filter((i) => i >= 0).pop(), [msgs]);
  const lastReport = useMemo(() => msgs.map((m, i) => (m.kind === "report" ? i : -1)).filter((i) => i >= 0).pop(), [msgs]);
  const saved = parseSteps(workflow ?? "").join("\n");
  const opened = useMemo(() => Date.now(), []);
  const time = (at?: number) => new Date(at ?? opened).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });
  const thinking = [...msgs].reverse().find((m) => m.kind === "thinking") as { text: string } | undefined;
  // How far the run has got: one step per tool call since the latest plan, capped at the last step.
  const toolsSinceFlow = lastFlow === undefined ? 0 : msgs.slice(lastFlow).filter((m) => m.kind === "tool").length;
  const liveReason = [...msgs].reverse().find((m) => m.kind === "reason" && m.live) as { text: string } | undefined;
  const reasoning = !!liveReason;
  const busy = isWorkerChatBusy(msgs);
  // A reply with a wide table (4+ columns) gets a wider column so the table isn't squeezed into a scroller.
  const wide = useMemo(() => msgs.some((m) => {
    const t = m.kind === "ai" ? m.text : m.kind === "report" ? m.result.summary : "";
    return /^\s*\|(?:[^|\n]*\|){4,}\s*$/m.test(t);
  }), [msgs]);
  const status = reasoning ? "Reasoning carefully..." : thinking?.text ? `${thinking.text.replace(/\.+$/, "")}...` : running ? "Working..." : "";

  const row = (m: Msg, i: number) => (
    // Tool steps are kept for the model's context but not shown; the plan panel already tracks progress.
    m.kind === "thinking" || m.kind === "tool" ? null : (
    <motion.div key={`${i}-${m.kind}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE } }} exit={{ opacity: 0 }}
      style={{ display: "flex", flexDirection: "column" }}>
      {m.kind === "user" && <div className="wk-msg-user"><span>{m.text}</span><span className="wk-msg-time">{time(m.at)}</span></div>}
      {m.kind === "ai" && (
        <div className={`wk-msg-ai${m.text.includes('\n\n') || /^#{1,3}\s/m.test(m.text) || /^```cards?\b|^\|.+\|$/m.test(m.text) ? ' is-document' : ''}`}>
          <div className="wk-reply-content"><ReplyText text={m.text} />{m.streaming && <span className="wk-caret" aria-hidden />}</div>
          {m.failure && <ModelFailure {...m.failure} />}
          {!m.streaming && <span className="wk-msg-time">{time(m.at)}</span>}
        </div>
      )}
      {m.kind === "report" && (() => {
        const steps = m.steps ?? [];
        // A task from the chat can be kept as the workflow; the worker's own workflow already is one.
        const unsaved = !!steps.length && m.oneOff !== false && steps.join("\n") !== saved;
        const latest = i === lastReport && !running && !busy;
        return (
          <RunReportCard result={m.result} at={time(m.at)} onRunAgain={() => (steps.length ? onRunSteps(steps) : onRun())}
            actions={latest ? (
              <>
                {unsaved && <button onClick={() => onSaveWorkflow(steps)}><Workflow size={12} /> Save as workflow</button>}
                <button onClick={() => onSchedule("Every weekday at 9:00", unsaved ? { prompt: steps.map((st, k) => `${k + 1}. ${st}`).join("\n") } : {})}><CalendarClock size={12} /> Schedule</button>
              </>
            ) : undefined} />
        );
      })()}
      {m.kind === "reason" && !m.live && <Reasoning text={m.text} live={false} />}
      {m.kind === "open" && (
        <div className="wk-open">
          <MessageCircle size={22} strokeWidth={1.6} className="wk-open-ic" />
          <h4>Still open: {m.title}</h4>
          {m.detail && <p>{m.detail}</p>}
        </div>
      )}
      {m.kind === "ask" && (m.answered
        ? <div className="wk-q-done">{m.question}</div>
        : <AskCard question={m.question} options={m.options} disabled={busy} onAnswer={(t) => onAnswer(i, t)} />)}
      {m.kind === "flow" && (
        <div className="wk-wf">
          <div className="wk-wf-head">
            {i === lastFlow && running
              ? <><LoaderCircle size={14} className="wk-spin" /> <span className="wk-shimmer">Running the workflow</span></>
              : <><span className="wk-wf-ok"><Check size={11} strokeWidth={3} /></span> Workflow created</>}
          </div>
          <ol className="wk-wf-steps">
            {m.steps.map((st, k) => {
              const done = i === lastFlow ? running && k < Math.min(toolsSinceFlow, m.steps.length - 1) : i < (lastFlow ?? 0);
              const now = i === lastFlow && running && k === Math.min(toolsSinceFlow, m.steps.length - 1);
              return (
                <li key={k} className={done ? "is-done" : now ? "is-now" : ""}>
                  <span className="wk-wf-dot">{done ? <Check size={10} strokeWidth={3} /> : now ? <LoaderCircle size={11} className="wk-spin" /> : k + 1}</span>
                  <span>{st}</span>
                </li>
              );
            })}
          </ol>
          {i === lastFlow && !running && (
            <div className="wk-wf-actions">
              <button className="wk-gpill is-sm is-white" onClick={onRun}><Play size={12} fill="currentColor" strokeWidth={0} /> Run now</button>
              <button className={`wk-gpill is-sm${withPlan ? " wk-only-narrow" : ""}`} onClick={() => onSchedule("Every weekday at 9:00")}><CalendarClock size={13} /> Schedule</button>
              <button className={`wk-gpill is-sm${withPlan ? " wk-only-narrow" : ""}`} onClick={onEdit}><Pencil size={12} /> Edit</button>
            </div>
          )}
        </div>
      )}
    </motion.div>
    )
  );

  const fold = lastUser > 0 ? (
    <div className="wk-chat-fold" key="fold">
      <button onClick={() => setShowAll((v) => !v)} aria-label={folded ? "Show earlier messages" : "Hide earlier messages"} title={folded ? "Show earlier messages" : "Hide earlier messages"}>
        {folded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
    </div>
  ) : null;
  const prevFrom = Math.max(0, lastUser - 2);

  return (
    <motion.div className={`wk-chat${running ? " is-running" : ""}${wide ? " has-wide" : ""}${withPlan ? " beside-plan" : ""}${withPlan || msgs.some(m => m.kind === 'ai' && /\n\n|^#{1,3}\s/m.test(m.text)) ? ' has-plan' : ''}`} initial={{ x: "-50%", opacity: 0, y: 14, scale: 0.98 }} animate={{ x: "-50%", opacity: 1, y: 0, scale: 1, transition: { duration: 0.45, ease: EASE } }}>
      <div className="wk-chat-card">
        {past && (
          <div className="wk-chat-past" role="status">
            <span>Past session{past.at ? ` · ${time(past.at)}` : ""}</span>
            <button onClick={past.onLatest}>Back to latest</button>
          </div>
        )}
        <div className="wk-chat-scroll" ref={ref} onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60; }}>
          {folded && <div className="wk-chat-prev" aria-hidden>{msgs.slice(prevFrom, lastUser).map((m, k) => row(m, prevFrom + k))}</div>}
          {folded && fold}
          <AnimatePresence initial={false}>
            {(folded ? msgs.slice(lastUser) : msgs).flatMap((m, k) => {
              const i = folded ? lastUser + k : k;
              return !folded && i === lastUser && fold ? [fold, row(m, i)] : [row(m, i)];
            })}
          </AnimatePresence>
          {busy && (liveReason
            ? <Reasoning text={liveReason.text} live />
            : <div className="wk-activity" role="status" aria-live="polite"><DotSpinner size={22} />{GENERIC_STATUS.test(status) ? <LoadingWord /> : <span className="wk-shimmer">{status}</span>}</div>)}
        </div>
      </div>
      <AnimatePresence>
        {pauseNote && !running && !busy && (
          <motion.div className="wk-paused" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE } }} exit={{ opacity: 0 }}>
            <button className="wk-paused-btn" onClick={onRun} aria-label="Continue" title="Continue"><Play size={20} fill="currentColor" strokeWidth={0} /></button>
            <p>{pauseNote}</p>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="wk-chat-foot">
        {canHide && <button className="wk-hidechat" onClick={onHide}>Hide chat <ChevronDown size={14} /></button>}
      </div>
      <AnimatePresence>
        {running && (
          <motion.div key="notch" className="wk-run-notch" initial={{ y: 48 }} animate={{ y: 0, transition: { duration: 0.45, ease: EASE } }} exit={{ y: 48, transition: { duration: 0.25 } }}>
            <button className="wk-run-stop" onClick={onStop} aria-label="Pause the worker" title="Pause"><Pause size={15} fill="currentColor" strokeWidth={0} /><span>Pause worker</span></button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/** Small orbiting particles shared by reasoning, planning, and working. */
function DotSpinner({ size = 16 }: { size?: number }) {
  return (
    <svg className="wk-atom" width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
      {[0, 60, 120].map((angle, k) => (
        <g key={angle} transform={`rotate(${angle} 12 12)`}>
          <ellipse className="wk-atom-orbit" cx="12" cy="12" rx="10" ry="4" fill="none" stroke="currentColor" strokeWidth=".6" />
          <circle className={`wk-atom-electron wk-atom-electron-${k}`} cx="0" cy="0" r="1.15" fill="currentColor" />
        </g>
      ))}
    </svg>
  );
}

const REASON_PHRASES = ["Thinking it through...", "Weighing the options...", "Checking the details...", "Forming a clear response..."];

/** The model's reasoning: streams in under a rotating header while it thinks, then folds into a "Reasoned" line you can open. */
function Reasoning({ text, live }: { text: string; live: boolean }) {
  const [open, setOpen] = useState(false);
  const [phrase, setPhrase] = useState(0);
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setPhrase((n) => Math.min(n + 1, REASON_PHRASES.length - 1)), 3500);
    return () => clearInterval(t);
  }, [live]);
  // The label shimmers only while new thoughts are streaming in; once they stop it rests.
  const [thinking, setThinking] = useState(live);
  useEffect(() => {
    if (!live) { setThinking(false); return; }
    setThinking(true);
    const t = setTimeout(() => setThinking(false), 1500);
    return () => clearTimeout(t);
  }, [live, text]);
  const body = (live ? text.slice(-900) : text).trim();
  if (live) {
    return (
      <div className="wk-reason is-live" role="status" aria-live="polite">
        <div className="wk-reason-head">
          <DotSpinner size={18} />
          <AnimatePresence mode="wait" initial={false}>
            <motion.span key={phrase} className={thinking ? "wk-shimmer" : "wk-reason-label"} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.25 }}>
              {REASON_PHRASES[phrase]}
            </motion.span>
          </AnimatePresence>
        </div>
        {body && <div className="wk-reason-body"><div className="wk-reason-stream">{body}</div></div>}
      </div>
    );
  }
  return (
    <div className="wk-reason">
      <button className="wk-reason-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Sparkles size={13} />
        <span className="wk-reason-label">Reasoned</span>
        {body && <ChevronDown size={13} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .2s" }} />}
      </button>
      <AnimatePresence initial={false}>
        {open && body && (
          <motion.div className="wk-reason-body" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
            {body}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const PROVIDER_NAMES: Record<string, string> = {
  openai: "OpenAI", anthropic: "Anthropic", gemini: "Google Gemini", google: "Google", deepseek: "DeepSeek",
  nvidia: "NVIDIA NIM", minimax: "MiniMax", ollama: "Ollama", "ollama-cloud": "Ollama Cloud",
  lmstudio: "LM Studio", llamacpp: "llama.cpp", openrouter: "OpenRouter", groq: "Groq", everfern: "EverFern Cloud",
};

/** Which provider and model failed, with the raw error tucked behind a toggle. */
function ModelFailure({ provider, model, error }: { provider?: string; model?: string; error?: string }) {
  const [open, setOpen] = useState(false);
  if (!provider && !model && !error) return null;
  const name = provider ? PROVIDER_NAMES[provider] ?? provider : undefined;
  return (
    <div className="wk-fail">
      <div className="wk-fail-row">
        {name && <span className="wk-fail-chip"><Cpu size={11} strokeWidth={2.2} />{name}</span>}
        {model && <span className="wk-fail-chip is-model">{model}</span>}
        {error && (
          <button type="button" className="wk-fail-toggle" onClick={() => setOpen((v) => !v)}>
            <TriangleAlert size={11} strokeWidth={2.2} />{open ? "Hide details" : "Details"}
          </button>
        )}
      </div>
      {open && error && <pre className="wk-fail-err">{error}</pre>}
    </div>
  );
}
