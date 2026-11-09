"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence, MotionConfig } from "framer-motion";
import { createPortal } from "react-dom";
import { SettingsSheet, logoutLocal, type SettingsSection } from "./Settings";
import {
  ArrowLeft, ArrowRight, ArrowUp, ArrowUpRight, Check, ChevronUp, LayoutGrid, List, MessageCircle,
  MessageSquareOff, MessageSquare, Pause, Play, Plus, X, Zap, Pencil, CalendarClock, Trash2, Sparkles, ChevronDown, Settings as SettingsIcon, Monitor, LoaderCircle,
  Sun, Clock, Calendar, Repeat, Mail, Globe, Search, FileText, User, Bell, CircleDot, type LucideIcon,
  FolderOpen, FolderPlus, Pin, PinOff, CircleHelp,
} from "lucide-react";
import WindowControls from "../components/WindowControls";
import { ALPS_PHOTOS, photoUrl } from "../components/onboarding/GlassShell";
import { AppLogo, AppLogoCluster } from "@/components/AppLogo";
import { APPS } from "@/lib/apps";
import { isWorkerChatBusy } from "@/lib/worker-activity";
import { latestAssistantPreview, workerLandscape } from '@/lib/worker-presentation';
import { FEATURED_TEMPLATES, WORKER_TEMPLATES, type WorkerTemplate } from "@/lib/worker-templates";
import { TIERS, newWorker, useWorkers, type Machine, type Worker } from "@/lib/workers";
import { ensureCloudVm, closeCloudApp, cloudToken, API_URL, type Paywall } from "@/lib/cloud-vms";
import { CloudGate, PaywallView, useCloudAuth } from "./ModelSettings";
import { AppsSheet, TemplateCard, TemplatesSheet, registerCustomApps } from "./Sheets";
import { WorkerDesktop, type Win, type AiAct } from "./Desktop";
import { hasAgent, parseSteps, planJob, runWorker, stopWorker, type ChatTurn } from "@/lib/worker-engine";
import "./workers.css";
import "./worker-reference.css";
import "./materials.css";
import { useDialogFocus } from "@/lib/use-dialog-focus";
import { makeWorkerSchedule, advanceWorkerSchedule } from "@/lib/worker-schedule";

type Mode = "home" | "tier" | "machine" | "template" | "desktop";
const MACHINE_KEY = "everfern_worker_machine";
const WORKER_WALLPAPER = '/images/worker-landscape.jpg';
const savedMachine = (): Machine => (typeof window !== "undefined" && localStorage.getItem(MACHINE_KEY) === "cloud" ? "cloud" : "local");
type Sheet = null | "apps" | "templates" | "settings";
type Msg =
  | { kind: "user"; text: string; at?: number }
  | { kind: "thinking"; text: string }
  | { kind: "ai"; text: string; key?: string; streaming?: boolean; at?: number }
  | { kind: "reason"; text: string; key: string; live: boolean }
  | { kind: "tool"; text: string }
  | { kind: "flow"; steps: string[] }
  /** A clarifying question from the planner; `job` is what it was planning, `answered` the user's reply. */
  | { kind: "ask"; question: string; options: { label: string; icon?: string }[]; job: string; answered?: string }
  /** Something the worker still needs from the user before it can run. */
  | { kind: "open"; title: string; detail: string }
  | { kind: "schedule" };

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

function ReplyText({ text }: { text: string }) {
  const inline = (line: string) => line.split(/(\*\*[^*]+\*\*)/g).map((part, index) => part.startsWith('**') && part.endsWith('**') ? <strong key={index}>{part.slice(2, -2)}</strong> : part);
  return <>{text.split(/\n\s*\n/).map((block, index) => {
    const heading = block.match(/^#{1,3}\s+(.+)$/);
    if (heading) return <h2 key={index}>{inline(heading[1])}</h2>;
    const lines = block.split('\n');
    if (lines.every(line => /^[-*]\s+/.test(line))) return <ul key={index}>{lines.map((line, item) => <li key={item}>{inline(line.replace(/^[-*]\s+/, ''))}</li>)}</ul>;
    return <p key={index}>{inline(block)}</p>;
  })}</>;
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
  const { workers, ready, save, remove } = useWorkers();
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
  const [completedResult, setCompletedResult] = useState<{
    title: string;
    subtitle: string;
    timeWorked: string;
    durationLabel: string;
    cost: string;
    costLabel: string;
    status: string;
    summary: string;
    accomplishments: string[];
  } | null>(null);
  const [completedStepIndex, setCompletedStepIndex] = useState<number>(-1);
  const [planningJobText, setPlanningJobText] = useState("");
  const [streamingSteps, setStreamingSteps] = useState<string[]>([]);
  const [streamingPartial, setStreamingPartial] = useState<string | undefined>();
  const [loginApps, setLoginApps] = useState<string[]>([]);
  const [chats, setChats] = useState<Record<string, Msg[]>>({});
  const [chatHidden, setChatHidden] = useState(false);
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

  const update = useCallback((w: Worker) => {
    if (draft && draft.id === w.id) setDraft(w);
    else save(w);
  }, [draft, save]);

  const workersRef = useRef(workers);
  workersRef.current = workers;
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
    if (!chats[w.id] && w.prompt) {
      setChats((c) => ({ ...c, [w.id]: [{ kind: "user", text: w.prompt }, { kind: "flow", steps: parseSteps(w.prompt) }] }));
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
      upsert(w.id, { kind: "ai", key: `${k}-a`, text: plan.reply });
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
        const named = { ...w, name };
        if (name !== w.name) update(named);
        await run(named, plan.steps);
      }
      return;
    }

    // Detect all apps mentioned across steps and user input
    const allAppsList = Object.keys(APPS);
    const detected = new Set<string>();
    for (const st of plan.steps) {
      for (const a of appsInStep(st, allAppsList)) {
        detected.add(a);
      }
    }
    const combinedText = (job + " " + said + " " + plan.steps.join(" ")).toLowerCase();
    if (combinedText.includes("amazon")) detected.add("amazon");
    if (combinedText.includes("canva")) detected.add("canva");
    if (combinedText.includes("moss")) detected.add("moss");
    if (combinedText.includes("linkedin")) detected.add("linkedin");

    const updatedApps = Array.from(new Set([...w.apps, ...Array.from(detected)]));
    const namedWorker: Worker = { ...w, prompt: plan.steps.map((st, i) => `${i + 1}. ${st}`).join("\n"), name, apps: updatedApps };
    update(namedWorker);

    // Do not pre-open windows here. Apps only appear once the AI actually opens them.

    upsert(w.id, { kind: "ai", key: `${k}-a`, text: plan.live ? plan.reply : `${plan.reply} (Preview mode: open the EverFern desktop app to run it on a real computer.)` });
    // The workflow card goes up only now, once the steps really exist.
    push(w.id, ...open, { kind: "flow", steps: plan.steps });

    // Ensure steps are visible in center card before transition
    setStreamingSteps(plan.steps);
    setStreamingPartial(undefined);

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
      const top = Math.max(0, ...ws.map((x) => x.z)) + 1;
      const has = ws.some((x) => x.app === app);
      return has ? ws.map((x) => (x.app === app ? { ...x, min: false, z: top } : x)) : [...ws, { app, min: false, max: false, z: top }];
    });
  const followUrl = (url: string, w: Worker) => {
    const app = appForUrl(url, w);
    if (!app) return;
    setWins((ws) => {
      const top = Math.max(0, ...ws.map((x) => x.z)) + 1;
      const has = ws.some((x) => x.app === app);
      return has ? ws.map((x) => (x.app === app ? { ...x, min: false, z: top } : x)) : [...ws, { app, min: false, max: false, z: top }];
    });
    setNavTo((n) => ({ app, url, n: (n?.n ?? 0) + 1 }));
  };

  /** Run the worker's workflow, or `only` these steps (a one-off job from the chat). */
  const run = async (target?: Worker, only?: string[]) => {
    const w = target ?? active;
    if (!w || w.status === "running") return;
    const steps = only ?? parseSteps(w.prompt);
    const startTime = Date.now();
    setCompletedStepIndex(0);
    setCompletedResult(null);
    update({ ...w, status: "running" });
    if (!live) {
      push(w.id, { kind: "ai", text: "Preview mode: there's no agent in this browser tab. Open the EverFern desktop app and press Run there to do the job for real." });
      update({ ...w, status: "idle" });
      return;
    }
    push(w.id, { kind: "thinking", text: `Starting: ${steps[0] ?? "first step"}` });
    // Let the user watch the windows while it works; the chat is one click away.
    setChatHidden(true);
    setAi(null);
    // Its browser runs use a window on its desktop, so make sure one is open.
    const controllable = (app: string) => !!(APPS[app]?.domain || APPS[app]?.url || ['chrome', 'browser', 'terminal', 'files'].includes(app));
    let executionWorker = w;
    if (w.machine === 'cloud') {
      try {
        const assigned = await ensureCloudVm({ preferId: w.cloudVmId, workerId: w.id, name: w.name });
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
        const registered = await Promise.all(w.apps.filter(controllable).map(app => api.registerCloudVm(`persist:worker-${w.id}`, app, assigned.vm.id, API_URL, token)));
        if (registered.some(result => result !== true)) throw new Error('Could not register the worker’s cloud apps.');
      } catch (error) {
        update({ ...executionWorker, status: 'paused' });
        setChatHidden(false);
        setChats(chats => ({ ...chats, [w.id]: (chats[w.id] || []).filter(message => message.kind !== 'thinking') }));
        push(w.id, { kind: 'ai', text: error instanceof Error ? error.message : 'Could not prepare the cloud apps.' });
        return;
      }
    }
    let lastTool = "";
    const currentRun = workersRef.current.find(worker => worker.id === w.id);
    if (w.machine === 'cloud' && currentRun && currentRun.status !== 'running') return;
    let lastApp: string | undefined;
    const k = `run-${Date.now()}`;
    const clean = (t: string) => t.replace(/<think>[\s\S]*?(<\/think>|$)/g, "").trim();
    let said = false;
    const res = await runWorker(executionWorker, steps, {
      onText: (t) => {
        setAi(null);
        const text = clean(t);
        if (!text) return;
        said = true;
        upsert(w.id, { kind: "ai", key: `${k}-a`, text, streaming: true });
      },
      onThought: (t) => { setAi(null); upsert(w.id, { kind: "reason", key: `${k}-r`, text: t, live: true }); },
      onAction: ({ label, x, y, url, app }) => {
        // The agent is driving one of this worker's windows: keep it up front.
        if (app) { if (app !== lastApp) showApp(app); lastApp = app; }
        else if (url && /^https?:\/\//.test(url)) lastApp = appForUrl(url, w) ?? lastApp;
        setAi((a) => ({ app: lastApp, label, x, y, n: (a?.n ?? 0) + 1 }));
        if (controlTimer.current) clearTimeout(controlTimer.current);
        controlTimer.current = setTimeout(() => setAi(null), 10000);
      },
      onTool: (label, args) => {
        if (label === lastTool) return;
        lastTool = label;
        const url = typeof args.url === "string" ? args.url : "";
        if (/^https?:\/\//.test(url)) followUrl(url, w);
        setChats((c) => {
          const list = (c[w.id] ?? []).filter((x) => x.kind !== "thinking");
          const nextIndex = Math.min(steps.length - 1, list.filter(item => item.kind === "tool").length);
          setCompletedStepIndex(nextIndex);
          return { ...c, [w.id]: [...list, { kind: "tool", text: label }, { kind: "thinking", text: "Working" }] };
        });
      },
    });
    setAi(null);
    endReason(w.id, `${k}-r`);
    const latest = workersRef.current.find((x) => x.id === w.id) ?? w;
    if (latest.status !== "running") { // stopped by the user
      if (said) upsert(w.id, { kind: "ai", key: `${k}-a`, text: clean(res.text) || "Stopped." });
      return;
    }
    update({ ...latest, status: "idle" });
    setChats((c) => ({ ...c, [w.id]: (c[w.id] ?? []).filter((x) => x.kind !== "thinking") }));
    upsert(w.id, { kind: "ai", key: `${k}-a`, text: res.error ? `I hit a problem: ${res.error}` : clean(res.text) || "Done." });

    if (!res.error) {
      // Minimize open windows back to 3D stack on the left so center is clear for completed UI
      setWins((ws) => ws.map((win) => ({ ...win, min: true })));
      setCompletedStepIndex(steps.length);
      const elapsedSeconds = Math.max(1, Math.round((Date.now() - startTime) / 1000));
      setCompletedResult({
        title: "Run finished",
        subtitle: "The agent finished this run. Review its report below.",
        timeWorked: elapsedSeconds < 60 ? `${elapsedSeconds} secs` : `${Math.round(elapsedSeconds / 60)} mins`,
        durationLabel: "Duration",
        cost: "Not reported",
        costLabel: "Total cost",
        status: "Finished",
        summary: clean(res.text) || "The agent did not provide a final report. Review the conversation before assuming the task is complete.",
        accomplishments: [],
      });
      setCreationStage("completed");
    }
  };
  const stop = (w: Worker) => {
    update({ ...w, status: w.status === "running" ? "paused" : "idle" });
    if (w.status === "running") { stopWorker(); setAi(null); }
    setChats((c) => ({ ...c, [w.id]: [...(c[w.id] ?? []).filter((x) => x.kind !== "thinking"), { kind: "ai", text: "Paused. Pick it back up whenever you like." }] }));
  };
  const schedule = async (label: string) => {
    if (!active) return;
    try {
      const api = (window as any).electronAPI?.workers;
      if (!live || !api?.save) throw new Error('Scheduling needs the EverFern desktop app.');
      const next = { ...active, schedule: label === 'Remove schedule' ? undefined : makeWorkerSchedule(label) };
      const result = await api.save(next);
      if (result?.success === false) throw new Error(result.error || 'Couldn’t save this schedule.');
      update(next);
      push(active.id, { kind: 'ai', text: next.schedule ? `Scheduled: ${label}. Keep EverFern open on the Workers screen. Paused workers wait until you resume them; missed runs are combined into one run when available.` : 'Schedule removed.' });
    } catch (error) { push(active.id, { kind: 'ai', text: error instanceof Error ? error.message : 'Couldn’t save this schedule.' }); }
  };
  const scheduledRun = useRef(run);
  scheduledRun.current = run;
  const scheduledOpen = useRef(openWorker);
  scheduledOpen.current = openWorker;
  const scheduleClaim = useRef(false);
  useEffect(() => {
    if (!ready || !live) return;
    const tick = async () => {
      if (scheduleClaim.current || chatBusy || sheet || promptOpen || draft || document.querySelector('[role="alertdialog"]') || workersRef.current.some(worker => worker.status === 'running')) return;
      const due = workersRef.current.find(worker => worker.schedule && worker.status !== 'paused' && worker.prompt.trim() && Date.parse(worker.schedule.nextRun) <= Date.now());
      const api = (window as any).electronAPI?.workers;
      if (!due?.schedule || !api?.save) return;
      scheduleClaim.current = true;
      try {
        const next = { ...due, schedule: advanceWorkerSchedule(due.schedule) };
        const result = await api.save(next);
        if (result?.success === false) throw new Error('Couldn’t claim scheduled run.');
        update(next);
        scheduledOpen.current(next);
        await scheduledRun.current(next);
      } catch (error) { push(due.id, { kind: 'ai', text: `Scheduled run could not start: ${error instanceof Error ? error.message : String(error)}` }); }
      finally { scheduleClaim.current = false; }
    };
    const timer = setInterval(() => { void tick(); }, 15000);
    void tick();
    return () => clearInterval(timer);
  }, [ready, live, chatBusy, sheet, promptOpen, draft]);

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
  const chatShown = mode === "desktop" && !!active && !sheet && creationStage === "idle" && (noWindows || (!chatHidden && msgs.length > 0));
  const chatMsgs: Msg[] = msgs.length ? msgs : [{ kind: "ai", text: active?.prompt
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
      {mode === 'desktop' && <>
        <button className="wk-sidebar-toggle" onClick={toggleSidebar} aria-label={sidebarOpen ? 'Collapse worker sidebar' : 'Expand worker sidebar'} title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}>{sidebarOpen ? <PinOff size={18} /> : <Pin size={18} />}</button>
        <AnimatePresence>{sidebarOpen && <motion.nav className="wk-workspace-nav" aria-label="Workers and folders" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} transition={{ duration: 0.24, ease: EASE }}>
          <button className="wk-new-worker" onClick={startNew}>New worker<Plus size={20} /></button>
          <form className="wk-folder-create" onSubmit={event => { event.preventDefault(); createFolder(); }}><input aria-label="New folder name" placeholder="Create new folder..." value={folderName} onChange={event => setFolderName(event.target.value)} /><button type="submit" aria-label="Create worker folder"><FolderPlus size={18} /></button></form>
          {['Home', ...folders].map(folder => <div className="wk-folder-group" key={folder}>
            <button className="wk-folder-heading" onClick={() => setSelectedFolder(folder)} aria-expanded={selectedFolder === folder}><FolderOpen size={18} />{folder}</button>
            {selectedFolder === folder && workers.filter(worker => (worker.folder || 'Home') === folder).map(worker => <button className={`wk-sidebar-worker${worker.id === activeId ? ' is-active' : ''}`} key={worker.id} onClick={() => openWorker(worker)}><Avatar w={worker} /><span>{worker.name}</span><span className="wk-sidebar-status"><MessageCircle size={13} /></span></button>)}
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
          <span className="wk-notch-sep" />
          <button className="wk-notch-btn" onClick={() => router.push("/chat")} aria-label="Ask EverFern" title="Ask EverFern"><MessageCircle size={14} /></button>
        </div>
        )}

        {mode === "home" && !sheet && <div className="ef-glass ef-screen-content"><Home ready={ready} workers={workers} onOpen={openWorker} onNew={startNew} onDelete={remove} /></div>}

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
            hideThumbs={!!sheet || creationStage === "writing" || creationStage === "logins"}
            behind={chatShown || creationStage === "ready" || creationStage === "completed"}
            onPick={() => { setChatHidden(true); setCreationStage("idle"); }}
            partition={active ? `persist:worker-${active.id}` : undefined}
            navTo={navTo}
            machine={active?.machine}
            cloudVmId={active?.cloudVmId}
            ai={running ? ai : null}
          />
        )}
        {paywall && <PaywallView info={paywall} onClose={() => setPaywall(null)} />}
        {mode === "desktop" && creationStage === "idle" && <button className="wk-history wk-gpill" onClick={() => setChatHidden(false)}><Clock size={18} />History</button>}

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

          {mode === "desktop" && creationStage === "completed" && completedResult && (
            <WorkflowCompletedCard
              key="workflow-completed"
              result={completedResult}
              onRunAgain={() => {
                if (active) void run(active);
              }}
              onClose={() => setCreationStage("idle")}
            />
          )}
        </AnimatePresence>

        {/* chat column */}
        {chatShown && !noWindows && (
          <motion.div className="wk-chat-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} />
        )}
        {chatShown && (
          <Chat msgs={chatMsgs} running={running} paused={active?.status === "paused" && !chatBusy} canHide={!noWindows} withPlan={!!active?.prompt} onHide={() => setChatHidden(true)} onRun={() => run()} onStop={() => active && stop(active)} onEdit={() => { setPromptText(active?.prompt ?? ""); setPromptOpen(true); }} onSchedule={schedule} onAnswer={answer} />
        )}
        <AnimatePresence>
          {(chatShown || (mode === "desktop" && (creationStage === "ready" || creationStage === "completed"))) && active?.prompt && (
            <PlanPanel
            scheduleLabel={active?.schedule?.label}
              key="plan"
              steps={parseSteps(active.prompt)}
              apps={active.apps}
              running={running}
              completed={creationStage === "completed"}
              completedStepIndex={completedStepIndex}
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
                  onClick={(e) => { e.stopPropagation(); if (w.status === "running") stop(w); else if (w.prompt) { openWorker(w); run(w); } else openWorker(w); }}
                  aria-label={w.status === "running" ? `Pause ${w.name}` : `Run ${w.name}`}
                  title={w.status === "running" ? "Pause" : "Run"}
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
                <button className="wk-continue" onClick={(e) => { e.stopPropagation(); run(); }}>
                  <Play size={13} fill="currentColor" strokeWidth={0} /> Continue
                </button>
              )}
              <button className={`wk-mini wk-teach${composerText.trim() ? ' is-send' : ''}`} onClick={(e) => { e.stopPropagation(); if (composerText.trim()) { const text = composerText.trim(); setComposerText(''); setChatHidden(false); void planFor(active, text, text); return; } if (!promptOpen) setPromptText((t) => (t.trim() === (active.prompt ?? "").trim() ? "" : t)); setPromptOpen((o) => !o); }} aria-label={composerText.trim() ? 'Send message' : 'Open prompt'}>
                {composerText.trim() ? <ArrowUp size={23} /> : <><TeachIcon /><span>Teach</span></>}
              </button>
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
          <button className="wk-lpill wk-ask" style={{ padding: "0 14px 0 12px" }} onClick={() => router.push("/chat")} aria-label="Ask EverFern" title="Ask EverFern"><CircleHelp size={20} /><span className="wk-ask-label">Ask EverFern</span></button>
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
        <p className="wk-modal-p">Its job, schedule and chat history are removed. This can&apos;t be undone.</p>
        <div className="wk-modal-row">
          <button className="wk-gpill" onClick={onCancel} autoFocus>Cancel</button>
          <button className="wk-gpill is-danger" onClick={onConfirm}><Trash2 size={14} /> Delete worker</button>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}

function Home({ ready, workers, onOpen, onNew, onDelete }: {
  ready: boolean; workers: Worker[]; onOpen: (w: Worker) => void; onNew: () => void; onDelete: (id: string) => void;
}) {
  const [doomed, setDoomed] = useState<Worker | null>(null);
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
        <motion.button className="wk-card wk-add-card" {...rise} onClick={onNew}><Plus size={18} /> New worker</motion.button>
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
              <span className="wk-tier-price" aria-label={`Price ${t.price.length} of 4`}>{t.price}</span>
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

/** Which installed apps a step mentions, for the chips under each step. */
function appsInStep(step: string, apps: string[]) {
  const t = step.toLowerCase();
  return apps.filter((id) => {
    const app = APPS[id];
    if (!app) return false;
    const n = app.name.toLowerCase();
    if (t.includes(id)) return true;
    if (t.includes(n)) return true;
    if (id === "amazon" && (t.includes("amazon") || t.includes("amazon (.de)"))) return true;
    if (n.startsWith("google ") && t.includes(n.slice(7))) return true;
    return false;
  });
}

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
  const isSinglePill = allSteps.length === 0;

  if (isSinglePill) {
    return (
      <motion.div
        className="wk-center-steps is-single-pill"
        initial={{ opacity: 0, scale: 0.985, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0, transition: TASK_SPRING }}
        exit={{ opacity: 0, scale: 0.985, y: 8, transition: { duration: 0.16 } }}
      >
        <div className="wk-center-pill">
          <span className="wk-step-spinner" />
          <span className="wk-center-pill-text">{jobText}</span>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      className="wk-center-steps"
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
      <div className="wk-login-card pointer-events-auto flex flex-col items-center w-[400px] select-none text-center">
        <h2 className="text-2xl font-medium tracking-tight text-white mb-1.5">App logins</h2>
        <p className="text-xs text-white/60 mb-5">Set up logins for the apps below, then continue.</p>

        <div className="flex flex-col gap-2 w-full mb-6">
          {apps.map((app) => (
            <button
              key={app}
              className="flex items-center justify-between w-full px-4 py-3 rounded-2xl bg-black/40 hover:bg-black/55 backdrop-blur-2xl border border-white/10 transition cursor-pointer text-white shadow-xl group"
              onClick={() => handleAppClick(app)}
            >
              <div className="flex items-center gap-3">
                <AppLogo app={app} size={22} radius={6} />
                <span className="text-xs font-medium text-white/90 group-hover:text-white">{APPS[app]?.name ?? app}</span>
              </div>
              <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full transition ${visited[app] ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40" : "text-white/20 border border-white/10"}`}>
                <Check size={12} strokeWidth={2.4} />
              </span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-4">
          <button
            className="px-6 py-2.5 rounded-full bg-white text-black font-semibold text-xs hover:bg-white/90 transition cursor-pointer shadow-lg active:scale-95"
            onClick={onContinue}
          >
            Continue
          </button>
          <button
            className="px-4 py-2 text-xs text-white/50 hover:text-white transition cursor-pointer"
            onClick={onDismiss}
          >
            Dismiss login
          </button>
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

function WorkflowCompletedCard({
  result,
  onRunAgain,
  onClose,
}: {
  result: {
    title: string;
    subtitle: string;
    timeWorked: string;
    durationLabel: string;
    cost: string;
    costLabel: string;
    status: string;
    summary: string;
    accomplishments: string[];
  };
  onRunAgain: () => void;
  onClose: () => void;
}) {
  return (
    <motion.div
      className="absolute inset-0 flex items-center justify-center pointer-events-none z-30 px-6 py-6"
      initial={{ opacity: 0, scale: 0.985, y: 8 }}
      animate={{ opacity: 1, scale: 1, y: 0, transition: TASK_SPRING }}
      exit={{ opacity: 0, scale: 0.985, y: 8, transition: { duration: 0.16 } }}
    >
      <div className="wk-report pointer-events-auto max-w-[580px] w-full flex flex-col items-center select-none">
        {/* Subtle top indicator bar */}
        <div className="w-8 h-1 bg-white/20 rounded-full mb-3" />

        {/* Subtitle caption */}
        <p className="text-center text-xs text-white/65 font-normal leading-relaxed max-w-lg mb-2">
          {result.subtitle}
        </p>

        {/* Large Heading */}
        <h1 className="text-center text-3xl font-medium tracking-tight text-white mb-6">
          {result.title}
        </h1>

        {/* 3 Stat Cards Row */}
        <div className="grid grid-cols-3 gap-3 w-full mb-3">
          {/* Status Card */}
          <div className="wk-report-section rounded-2xl p-4 flex flex-col justify-between">
            <div className="flex items-center gap-1.5 text-xs text-white/50 mb-3">
              <CircleDot size={13} className="text-white/60" />
              <span>Status</span>
            </div>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 rounded-full text-xs font-medium w-fit">
              <Check size={12} strokeWidth={2.8} />
              <span>{result.status}</span>
            </div>
          </div>

          {/* Time Worked Card */}
          <div className="wk-report-section rounded-2xl p-4 flex flex-col justify-between">
            <div className="flex items-center gap-1.5 text-xs text-white/50 mb-2">
              <Clock size={13} className="text-white/60" />
              <span>Time Worked</span>
            </div>
            <div>
              <div className="text-xl font-semibold text-white tracking-tight">
                {result.timeWorked}
              </div>
              <div className="text-[11px] text-white/40 mt-0.5">
                {result.durationLabel}
              </div>
            </div>
          </div>

          {/* Cost Card */}
          <div className="wk-report-section rounded-2xl p-4 flex flex-col justify-between">
            <div className="flex items-center gap-1.5 text-xs text-white/50 mb-2">
              <span className="text-xs text-white/60 font-semibold">€</span>
              <span>Cost</span>
            </div>
            <div>
              <div className="text-xl font-semibold text-white tracking-tight">
                {result.cost}
              </div>
              <div className="text-[11px] text-white/40 mt-0.5">
                {result.costLabel}
              </div>
            </div>
          </div>
        </div>

        {/* Summary Card */}
        <div className="wk-report-section w-full rounded-2xl p-4 mb-3">
          <h2 className="text-sm font-semibold text-white mb-2">Summary</h2>
          <div className="wk-result-summary text-xs text-white/70 leading-relaxed font-normal"><ReplyText text={result.summary} /></div>
        </div>

        {/* Only show accomplishments explicitly supplied with a report. */}
        {result.accomplishments.length > 0 && <div className="wk-report-section w-full rounded-2xl p-4 mb-4">
          <h2 className="text-sm font-semibold text-white mb-3">Accomplishments</h2>
          <div className="space-y-3">
            {result.accomplishments.map((item, idx) => (
              <div key={idx} className="flex items-start gap-2.5 text-xs text-white/75 leading-relaxed">
                <span className="inline-flex items-center justify-center mt-0.5 text-white/50 shrink-0">
                  <CircleDot size={12} />
                </span>
                <span>{item}</span>
              </div>
            ))}
          </div>
        </div>}

        {/* Action buttons */}
        <div className="flex items-center justify-center gap-3 w-full">
          <button
            onClick={onRunAgain}
            className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-white/10 hover:bg-white/20 border border-white/15 text-white text-xs font-medium transition cursor-pointer backdrop-blur-md active:scale-95"
          >
            <Play size={12} fill="currentColor" strokeWidth={0} />
            <span>Run Again</span>
          </button>
          <button
            onClick={onClose}
            className="flex items-center gap-2 px-6 py-2.5 rounded-full bg-white text-black font-semibold text-xs hover:bg-white/90 transition cursor-pointer shadow-lg active:scale-95"
          >
            <Check size={13} strokeWidth={2.8} />
            <span>Done</span>
          </button>
        </div>
      </div>
    </motion.div>
  );
}

function PlanPanel({
  scheduleLabel,
  steps,
  apps,
  running,
  completed,
  completedStepIndex = -1,
  onEdit,
  onSchedule,
}: {
  scheduleLabel?: string;
  steps: string[];
  apps: string[];
  running: boolean;
  completed?: boolean;
  completedStepIndex?: number;
  onEdit: () => void;
  onSchedule: (label: string) => void;
}) {
  const [picking, setPicking] = useState(false);
  return (
    <motion.aside
      className="wk-task-panel absolute right-5 top-5 w-[310px] flex flex-col gap-2.5 pointer-events-auto z-40 select-none"
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0, transition: { type: "spring", duration: 0.35, bounce: 0 } }}
      exit={{ opacity: 0, x: 16, transition: { duration: 0.25 } }}
    >
      <div className="w-full flex justify-end">
        {picking ? (
          <div className="wk-task-schedule-menu w-full bg-black/40 backdrop-blur-2xl border border-white/10 rounded-2xl p-2.5 shadow-2xl flex flex-col gap-1.5 text-xs text-white">
            <p className="px-3 py-2 text-white/80">Runs while EverFern stays open on Workers. Times use this computer’s timezone.</p>
            {["Every weekday at 9:00", "Every hour", "Tomorrow at 8:00", ...(scheduleLabel ? ["Remove schedule"] : [])].map((l) => (
              <button
                key={l}
                className="text-left px-3 py-2 rounded-xl bg-white/5 hover:bg-white/15 transition cursor-pointer"
                onClick={() => { setPicking(false); onSchedule(l); }}
              >
                {l}
              </button>
            ))}
            <button className="text-left px-3 py-1.5 text-white/40 hover:text-white text-xs transition cursor-pointer" onClick={() => setPicking(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <button
            className="wk-task-schedule flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-black/40 hover:bg-black/60 backdrop-blur-2xl border border-white/15 text-xs text-white/80 transition cursor-pointer shadow-lg active:scale-95"
            onClick={() => setPicking(true)}
          >
            <CalendarClock size={13} className="text-white/60" />
            <span>{scheduleLabel || "Schedule: nothing set"}</span>
          </button>
        )}
      </div>

      <div className="wk-task-surface w-full bg-black/40 backdrop-blur-2xl border border-white/10 rounded-3xl p-4 shadow-2xl flex flex-col h-fit max-h-[calc(100vh-140px)] overflow-hidden">
        <button
          className="wk-task-edit w-full flex items-center justify-center gap-1.5 px-4 py-2 rounded-full bg-white text-black font-semibold text-xs hover:bg-white/90 transition shadow-sm mb-3.5 cursor-pointer active:scale-95"
          onClick={onEdit}
        >
          <Pencil size={11} strokeWidth={2.5} />
          <span>Edit task</span>
        </button>

        <div className="overflow-y-auto pr-1 space-y-2.5 max-h-[calc(100vh-210px)]">
          {steps.map((st, k) => {
            const { title, rest } = parseStepParts(st);
            const chips = appsInStep(st, apps);
            const primaryApp = chips[0];
            const isDone = completed || (completedStepIndex >= 0 && k < completedStepIndex);
            const isActive = running && !completed && k === (completedStepIndex >= 0 ? completedStepIndex : 0);

            return (
              <div
                key={k}
                className={`flex items-start gap-2.5 p-2 rounded-xl transition ${
                  isActive ? "bg-white/10 border border-white/15" : "hover:bg-white/5"
                }`}
              >
                <div className="pt-0.5 shrink-0">
                  {isDone ? (
                    <span className="inline-flex items-center justify-center w-4 h-4 rounded-full border border-emerald-400 bg-emerald-400/20 text-emerald-400">
                      <Check size={9} strokeWidth={3} />
                    </span>
                  ) : isActive ? (
                    <span className="inline-flex items-center justify-center w-4 h-4 rounded-full border border-emerald-400 bg-emerald-400/20 text-emerald-300 animate-pulse">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    </span>
                  ) : (
                    <span className="inline-flex items-center justify-center w-4 h-4 rounded-full border border-white/30" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className={`text-xs leading-snug font-medium line-clamp-3 ${isDone ? "text-white/80" : isActive ? "text-white font-semibold" : "text-white/85"}`}>
                    {title}
                  </div>
                  {rest && <div className="text-[11px] text-white/45 mt-0.5 line-clamp-2">{rest}</div>}
                </div>
                {primaryApp && (
                  <div className="shrink-0 pt-0.5 ml-1.5">
                    <AppLogo app={primaryApp} size={16} radius={4} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </motion.aside>
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

function Chat({ msgs, running, paused, canHide, withPlan, onHide, onRun, onStop, onEdit, onSchedule, onAnswer }: {
  msgs: Msg[]; running: boolean; paused?: boolean; canHide?: boolean; withPlan: boolean; onHide: () => void; onRun: () => void; onStop: () => void; onEdit: () => void; onSchedule: (label: string) => void;
  onAnswer: (index: number, text: string) => void;
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
  const opened = useMemo(() => Date.now(), []);
  const time = (at?: number) => new Date(at ?? opened).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });
  const thinking = [...msgs].reverse().find((m) => m.kind === "thinking") as { text: string } | undefined;
  // How far the run has got: one step per tool call since the latest plan, capped at the last step.
  const toolsSinceFlow = lastFlow === undefined ? 0 : msgs.slice(lastFlow).filter((m) => m.kind === "tool").length;
  const reasoning = msgs.some((m) => m.kind === "reason" && m.live);
  const busy = isWorkerChatBusy(msgs);
  const status = reasoning ? "Reasoning carefully..." : thinking?.text ? `${thinking.text.replace(/\.+$/, "")}...` : running ? "Working..." : "";

  const row = (m: Msg, i: number) => (
    m.kind === "thinking" ? null : (
    <motion.div key={`${i}-${m.kind}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE } }} exit={{ opacity: 0 }}
      style={{ display: "flex", flexDirection: "column" }}>
      {m.kind === "user" && <div className="wk-msg-user"><span>{m.text}</span><span className="wk-msg-time">{time(m.at)}</span></div>}
      {m.kind === "ai" && (
        <div className={`wk-msg-ai${m.text.includes('\n\n') || /^#{1,3}\s/m.test(m.text) ? ' is-document' : ''}`}>
          <div className="wk-reply-content"><ReplyText text={m.text} />{m.streaming && <span className="wk-caret" aria-hidden />}</div>
          {!m.streaming && <span className="wk-msg-time">{time(m.at)}</span>}
        </div>
      )}
      {m.kind === "reason" && !m.live && <Reasoning text={m.text} live={false} />}
      {m.kind === "tool" && <div className="wk-msg-tool"><Check size={11} strokeWidth={2.6} /> {m.text}</div>}
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
    <motion.div className={`wk-chat${running ? " is-running" : ""}${withPlan || msgs.some(m => m.kind === 'ai' && /\n\n|^#{1,3}\s/m.test(m.text)) ? ' has-plan' : ''}`} initial={{ x: "-50%", opacity: 0, y: 14, scale: 0.98 }} animate={{ x: "-50%", opacity: 1, y: 0, scale: 1, transition: { duration: 0.45, ease: EASE } }}>
      <div className="wk-chat-card">
        <div className="wk-chat-scroll" ref={ref} onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60; }}>
          {folded && <div className="wk-chat-prev" aria-hidden>{msgs.slice(prevFrom, lastUser).map((m, k) => row(m, prevFrom + k))}</div>}
          {folded && fold}
          <AnimatePresence initial={false}>
            {(folded ? msgs.slice(lastUser) : msgs).flatMap((m, k) => {
              const i = folded ? lastUser + k : k;
              return !folded && i === lastUser && fold ? [fold, row(m, i)] : [row(m, i)];
            })}
          </AnimatePresence>
          {busy && <div className="wk-activity" role="status" aria-live="polite"><DotSpinner size={22} /><span>{status}</span></div>}
        </div>
      </div>
      <AnimatePresence>
        {paused && !running && !busy && (
          <motion.div className="wk-paused" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE } }} exit={{ opacity: 0 }}>
            <button className="wk-paused-btn" onClick={onRun} aria-label="Continue" title="Continue"><Play size={20} fill="currentColor" strokeWidth={0} /></button>
            <p>Your worker is currently paused.</p>
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

/** The model's reasoning: streams in while it thinks, then folds into a "Reasoned" line you can open. */
function Reasoning({ text, live }: { text: string; live: boolean }) {
  const [open, setOpen] = useState(false);
  const shown = live || open;
  const body = (live ? text.slice(-700) : text).trim();
  return (
    <div className={`wk-reason${live ? " is-live" : ""}`}>
      <button className="wk-reason-head" onClick={() => !live && setOpen((o) => !o)} aria-expanded={shown} disabled={live}>
        {live ? <DotSpinner size={20} /> : <Sparkles size={13} />}
        <span>{live ? "Reasoning carefully..." : "Reasoned"}</span>
        {!live && body && <ChevronDown size={13} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .2s" }} />}
      </button>
      <AnimatePresence initial={false}>
        {open && !live && body && (
          <motion.div className="wk-reason-body" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
            {body}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
