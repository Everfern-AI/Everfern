"use client";

/**
 * Connects workers to EverFern's real agent.
 *
 * - planJob: one model call (acp.chat) that turns the user's job description into
 *   a short reply + concrete numbered steps.
 * - runWorker: a full agent run (acp.stream) with tools, the Linux VM and the
 *   browser, scoped to the worker by conversationId so its events stay separate.
 *
 * Outside Electron (plain browser preview) there is no agent, so both fall back to
 * a local parse and report `live: false` so the UI can say so instead of pretending.
 */

import type { Worker } from "@/lib/workers";
import { APPS } from "@/lib/apps";
import { ASK_ICONS, plannerPrompt, runBrief, runTask } from "@/lib/worker-prompts";

export { ASK_ICONS };

/** A run in the main process: still going, or ended lately (done; `end` is its last chunk). */
export type LiveRun = { conversationId: string; text: string; done: boolean; end?: string };

type Acp = {
  chat: (req: any) => Promise<any>;
  stream: (req: any) => Promise<any>;
  stop: (conversationId?: string) => Promise<any>;
  onStreamChunk: (cb: (c: any) => void) => (() => void) | void;
  onToolStart: (cb: (r: any) => void) => (() => void) | void;
  onThought?: (cb: (d: any) => void) => (() => void) | void;
  onChatChunk?: (cb: (d: { streamId: string; delta?: string; thought?: string }) => void) => (() => void) | void;
  onSubAgentProgress?: (cb: (e: any) => void) => (() => void) | void;
  active?: () => Promise<LiveRun[]>;
};

export function acp(): Acp | null {
  if (typeof window === "undefined") return null;
  const a = (window as any).electronAPI?.acp;
  return a && typeof a.stream === "function" ? (a as Acp) : null;
}
export const hasAgent = () => !!acp();

export const conversationIdFor = (w: Pick<Worker, "id">) => `worker-${w.id}`;

export function parseSteps(prompt: string) {
  const lines = prompt.split(/\n+/).map((l) => l.replace(/^\s*(\d+[.)]|[-*•])\s*/, "").trim()).filter(Boolean);
  return lines.length ? lines : [prompt.trim()];
}

function textOf(res: any): string {
  if (!res) return "";
  if (typeof res === "string") return res;
  const r = res.response ?? res;
  if (typeof r === "string") return r;
  return r.content ?? r.text ?? r.choices?.[0]?.message?.content ?? r.message?.content ?? "";
}

/** A clarifying question the planner asks before it writes the steps. icon: one of ASK_ICONS. */
export type Ask = { question: string; options: { label: string; icon?: string }[] };
/** Something the worker still needs from the user (a login, a name), shown as a "Still open" card. */
export type OpenItem = { title: string; detail: string };
/** "do": a one-off thing to do now (runs straight away); "workflow": a repeatable job to save and schedule; "chat": just a reply. */
export type PlanKind = "do" | "workflow" | "chat";
/** Which provider/model served (or failed) a call, so the UI can say so. */
export type ModelInfo = { provider?: string; model?: string };
export type Plan = { reply: string; steps: string[]; name?: string; live: boolean; error?: string; via?: ModelInfo; ask?: Ask; open?: OpenItem[]; kind: PlanKind };

function askOf(v: any): Ask | undefined {
  const question = typeof v?.question === "string" ? v.question.trim() : "";
  const options = (Array.isArray(v?.options) ? v.options : [])
    .map((o: any) => (typeof o === "string" ? { label: o } : { label: String(o?.label ?? "").trim(), icon: typeof o?.icon === "string" ? o.icon : undefined }))
    .filter((o: { label: string }) => o.label)
    .slice(0, 4);
  return question ? { question, options } : undefined;
}
function openOf(v: any): OpenItem[] {
  return (Array.isArray(v) ? v : [])
    .map((o: any) => ({ title: String(o?.title ?? "").trim(), detail: String(o?.detail ?? "").trim() }))
    .filter((o: OpenItem) => o.title)
    .slice(0, 3);
}

/** The "reply" string from a JSON object that is still streaming in, so far. */
function partialReply(raw: string) {
  const m = raw.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)/);
  if (!m) return "";
  // Drop a half-received escape at the end, then decode the rest.
  const body = m[1].replace(/\\(u[0-9a-fA-F]{0,3})?$/, "");
  return body.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_, e: string) =>
    e[0] === "u" && e.length === 5 ? String.fromCharCode(parseInt(e.slice(1), 16)) : e === "n" ? "\n" : e === "t" ? "\t" : e);
}

export function parseStreamingSteps(raw: string): { steps: string[]; partialCurrent?: string } {
  const match = raw.match(/"steps"\s*:\s*\[([\s\S]*?)(\]|$)/);
  if (!match) return { steps: [] };
  const inside = match[1];
  const steps: string[] = [];
  const re = /"((?:[^"\\]|\\.)*)"/g;
  let m;
  let lastIdx = 0;
  while ((m = re.exec(inside)) !== null) {
    steps.push(m[1].replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\t/g, '\t'));
    lastIdx = re.lastIndex;
  }
  const remaining = inside.slice(lastIdx);
  const unclosed = remaining.match(/"((?:[^"\\]|\\.)*)$/);
  const partialCurrent = unclosed ? unclosed[1].replace(/\\"/g, '"').replace(/\\n/g, '\n') : undefined;
  return { steps, partialCurrent };
}

export type PlanEvents = {
  onReply?: (text: string) => void;
  onThought?: (text: string) => void;
  onSteps?: (steps: string[], partialCurrent?: string) => void;
};
/** Earlier chat with this worker, oldest first, so the planner knows what was said and done. */
export type ChatTurn = { role: "user" | "assistant"; content: string };

export async function planJob(w: Worker, job: string, ev: PlanEvents = {}, history: ChatTurn[] = []): Promise<Plan> {
  const fallback = (error?: string): Plan => {
    const steps = parseSteps(job);
    return {
      live: false,
      error,
      kind: "workflow",
      steps,
      reply: steps.length > 1
        ? `I turned that into ${steps.length} steps. Check them, then run it now or put it on a schedule.`
        : "Check the step, then run it now or put it on a schedule.",
    };
  };
  const api = acp();
  if (!api) return fallback();
  let via: ModelInfo | undefined;
  // The model answered but not with a plan (empty, a tool call, broken JSON) is not a connection problem.
  const failed = (error: string): Plan => ({
    live: false, kind: "chat", steps: [], error, via,
    reply: /unreadable plan|no steps/i.test(error)
      ? "The model didn't send back a usable plan. Please try again; your workflow has not been changed."
      : "The model connection failed. Please try again; your workflow has not been changed.",
  });
  const decode = (text: string): Plan => {
    // Some models answer a plain question in prose instead of JSON: show it as a chat reply.
    if (!text.includes("{") && text.trim()) return { live: true, kind: "chat", steps: [], reply: text.trim() };
    const json = firstJsonObject(text);
    if (!json) {
      // Prose with a stray brace is still a chat reply, not a failure.
      const prose = text.replace(/```[a-z]*|```/gi, "").trim();
      if (prose && !/"steps"\s*:/.test(prose)) return { live: true, kind: "chat", steps: [], reply: prose };
      throw new Error("The model returned an unreadable plan.");
    }
    const steps = Array.isArray(json.steps) ? json.steps.map(String).filter(Boolean) : [];
    const ask = askOf(json.ask);
    const open = openOf(json.open);
    const kind: PlanKind = json.kind === "chat" || json.kind === "do" ? json.kind : "workflow";
    if (!steps.length && !ask && kind !== "chat") throw new Error("The model returned no steps.");
    return { live: true, kind: ask ? "workflow" : kind, steps: ask || kind === "chat" ? [] : steps, ask, open, reply: String(json.reply || (ask ? "One question first." : "Here is the plan.")), name: json.name ? String(json.name) : undefined };
  };
  // Stream the reply and the model's reasoning as they arrive, when the app supports it.
  const streamId = `plan-${w.id}-${Date.now()}`;
  let raw = "", thought = "";
  const off = api.onChatChunk?.((c) => {
    if (c?.streamId !== streamId) return;
    if (c.thought) { thought += c.thought; ev.onThought?.(thought); }
    if (c.delta) {
      raw += c.delta;
      const r = partialReply(raw);
      if (r) ev.onReply?.(r);
      const parsed = parseStreamingSteps(raw);
      if (parsed.steps.length || parsed.partialCurrent) {
        ev.onSteps?.(parsed.steps, parsed.partialCurrent);
      }
    }
  });
  try {
    const messages = [
      { role: "system", content: plannerPrompt(w) },
      ...history.slice(-12),
      { role: "user", content: job },
    ];
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await api.chat({
          ...(off && attempt === 0 ? { streamId } : {}),
          messages,
        });
        if (res?.provider || res?.model) via = { provider: res.provider, model: res.model };
        if (res?.error) {
          // A transport may fail after the complete JSON has already arrived.
          try { return decode(raw); } catch { throw new Error(String(res.error)); }
        }
        raw = textOf(res) || raw;
        return decode(raw);
      } catch (e: any) {
        const message = e?.message || String(e);
        console.warn("[planJob] model call failed", { ...via, error: message });
        if (attempt > 0 || !/stream|premature|interrupt|network|fetch|connection|timeout|unexpected end|json/i.test(message)) return failed(message);
        raw = "";
        ev.onReply?.("");
      }
    }
    return failed("The model did not return a complete response.");
  } catch (e: any) {
    return failed(e?.message || String(e));
  } finally {
    if (typeof off === "function") off();
  }
}

/**
 * The first {...} in `text` that parses as JSON, skipping code fences and prose around it.
 * Braces inside strings are handled, so `{"reply": "use {name}"}` works.
 */
export function firstJsonObject(text: string): any | null {
  for (let start = text.indexOf("{"); start >= 0; start = text.indexOf("{", start + 1)) {
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) {
        try {
          const v = JSON.parse(text.slice(start, i + 1));
          if (v && typeof v === "object" && !Array.isArray(v)) return v;
        } catch { /* try the next "{" */ }
        break;
      }
    }
  }
  return null;
}

/** The reasoning effort each tier asks the model for. */
export const TIER_REASONING: Record<Worker["tier"], "low" | "medium" | "high"> = { lite: "low", balanced: "medium", pro: "high" };

/** The run each worker has going (worker id -> conversation id), so Stop ends only that one. */
const activeRuns = new Map<string, string>();
export const activeRunOf = (workerId: string) => activeRuns.get(workerId);

export type RunEvents = {
  onText: (full: string) => void;
  onTool: (label: string, args: Record<string, unknown>, name?: string) => void;
  onThought?: (text: string) => void;
  /** A browser action the agent is taking, for the on-window AI cursor. x/y are 0..1 of the page when known. */
  /** `app` is set when the agent drives one of the worker's own windows. */
  /** `space: "window"`: x/y are 0..1 of the whole app window (worker_click), not of the page inside it. */
  /** `aspect`: the VM screen's width/height when x/y are on that whole screen (the window letterboxes it). */
  onAction?: (a: { label: string; x?: number; y?: number; url?: string; app?: string; space?: "window"; aspect?: number }) => void;
};

/** Navis reports clicks in its 1280x720 viewport; computer-use tools in screen pixels;
 *  worker_click in 0-1000 of the app window. */
const NAVIS_VIEW = { w: 1280, h: 720 };
const WINDOW_1000 = { w: 1000, h: 1000 };
export function pointOf(coord: unknown, view = NAVIS_VIEW): { x?: number; y?: number } {
  const pair = Array.isArray(coord) ? coord : coord && typeof coord === "object" ? [(coord as any).x, (coord as any).y] : null;
  if (!pair || pair.length < 2) return {};
  const [x, y] = pair.map(Number);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return {};
  // The exact spot: only keep it inside the window, no inset.
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return { x: clamp(x / view.w), y: clamp(y / view.h) };
}

/** Pretty label for a tool event in the worker UI. */
export function toolLabel(name: string, args: Record<string, unknown>) {
  const url = String(args.url ?? args.href ?? "");
  const host = url ? url.replace(/^https?:\/\//, "").split("/")[0] : "";
  const n = name.toLowerCase();
  const appId = String(args.app || "").trim();
  const appName = (APPS[appId]?.name ?? appId) || "app";

  // Worker app lifecycle & Window Management
  if (n === "open_app" || n === "switch_app") return `Switching window to ${appName}`;
  if (n === "list_apps") return "Checking desktop apps";
  if (n === "close_app") return `Minimizing ${appName}`;

  // Native window pixel tools (Files, Sheets, Terminal) + Navis
  if (n === "worker_describe") return `Reading the ${appName} window`;
  if (n === "worker_click") return `Clicking in ${appName}`;
  if (n === "worker_type") return `Typing in ${appName}`;
  if (n === "files_action") {
    const f = String(args.path || "").split(/[\\/]/).pop() || "a file";
    const verbs: Record<string, string> = { create_folder: "Creating folder", create_file: "Creating", write_file: "Writing", rename: "Renaming", move_to_trash: "Moving to Trash:", open: "Opening" };
    return `${verbs[String(args.action)] ?? "Working on"} ${f}`;
  }
  if (n === "terminal_run") return `Running ${String(args.command || "").slice(0, 50)}`;
  if (n === "navis") return appId ? `Driving ${appName}` : "Driving the browser";

  // Sandboxed VM Workspace Operations
  if (n === "worker_bash" || n === "worker_exec") return `Running workspace script: ${String(args.command || "").slice(0, 50)}`;
  if (n === "worker_read_file") return `Reading ${String(args.path || "workspace file").split(/[\\/]/).pop()}`;
  if (n === "worker_write_file") return `Writing ${String(args.path || "workspace file").split(/[\\/]/).pop()}`;
  if (n === "worker_list_files") return "Checking workspace files";
  if (n === "present_files") return "Presenting deliverables to user";

  // General tools
  if (host) return `Opening ${host}`;
  if (n.includes("search")) return `Searching: ${String(args.query ?? args.q ?? "").slice(0, 60)}`;
  if (n.includes("bash") || n.includes("terminal") || n.includes("exec") || n.includes("vm")) return "Running command in workspace";
  if (n.includes("write") || n.includes("edit")) return `Writing ${String(args.path ?? args.file_path ?? "a file").split(/[\\/]/).pop()}`;
  if (n.includes("read")) return `Reading ${String(args.path ?? args.file_path ?? "a file").split(/[\\/]/).pop()}`;
  if (n.includes("computer") || n.includes("click") || n.includes("screenshot")) return "Operating on screen";
  if (n.includes("ask_user")) return "Awaiting your approval";
  return name.replace(/_/g, " ");
}

type RunResult = { live: boolean; text: string; error?: string };

/** Subscribes `ev` to one conversation's events. The reply text starts from `text` (what already streamed). */
function listen(api: Acp, conversationId: string, ev: RunEvents, text = "") {
  let full = text;
  const offs: Array<(() => void) | void> = [];
  // Only events tagged with this run. Untagged events could belong to any chat or worker.
  const mine = (d: any) => d?.conversationId === conversationId;

  offs.push(api.onStreamChunk((c) => { if (mine(c) && c.delta) { full += c.delta; ev.onText(full); } }));
  offs.push(api.onToolStart((r) => {
    if (!mine(r)) return;
    const args = r.toolArgs ?? {};
    const label = toolLabel(r.toolName ?? "tool", args);
    ev.onTool(label, args, r.toolName);
    const targetApp = typeof args.app === "string" ? args.app : undefined;
    const inWindow = r.toolName === "worker_click";
    ev.onAction?.({
      label,
      app: targetApp,
      url: typeof args.url === "string" ? args.url : undefined,
      ...(inWindow
        ? { ...pointOf([args.x, args.y], WINDOW_1000), space: "window" as const }
        : pointOf(args.coordinate, { w: window.screen.width, h: window.screen.height })),
    });
  }));

  if (api.onSubAgentProgress && ev.onAction) {
    offs.push(api.onSubAgentProgress((e) => {
      if (!mine(e)) return;
      const a = e?.action;
      if (!a?.description) return;
      const params = a.params ?? {};
      // Native windows (worker_click) send {x, y} in 0-1000 of the window; Navis sends [x, y] in its view.
      const native = a.type === "ui" && params.coordinate && !Array.isArray(params.coordinate);
      ev.onAction!({
        label: String(a.description).slice(0, 80),
        url: typeof params.url === "string" ? params.url : undefined,
        app: typeof e.workerApp === "string" ? e.workerApp : typeof params.app === "string" ? params.app : undefined,
        ...(native ? { ...pointOf(params.coordinate, WINDOW_1000), space: "window" as const } : pointOf(params.coordinate)),
        ...(typeof params.aspect === "number" && params.aspect > 0 ? { aspect: params.aspect } : {}),
      });
    }));
  }

  let thought = "";
  if (api.onThought && ev.onThought) {
    offs.push(api.onThought((d) => { if (mine(d) && d.content) { thought += d.content; ev.onThought!(thought); } }));
  }

  return {
    mine,
    offs,
    text: () => full,
    off: () => offs.forEach((off) => typeof off === "function" && off()),
  };
}

/** Run the worker's job on the real agent. Resolves with the final text.
 *  `onStart` gets the run's conversation id, so the page can save it and reattach after a reload. */
export async function runWorker(w: Worker, steps: string[], ev: RunEvents, opts: { auto?: boolean; onStart?: (conversationId: string) => void } = {}): Promise<RunResult> {
  const api = acp();
  if (!api) return { live: false, text: "" };
  if (activeRuns.has(w.id)) return { live: true, text: "", error: "This worker is already running." };
  // A fresh thread per task. The agent's LangGraph checkpointer and chat history
  // are keyed by conversationId; reusing worker-<id> made every new task resume
  // the previous task's messages (so Navis replayed the old job). The worker's
  // long-term memory is stored separately, so this only resets the run context.
  // Scheduled runs are marked "-auto-": nobody is watching, so they may not stop to ask questions.
  const conversationId = `${conversationIdFor(w)}-${opts.auto ? "auto" : "run"}-${Date.now()}`;
  activeRuns.set(w.id, conversationId);
  const l = listen(api, conversationId, ev);
  opts.onStart?.(conversationId);

  try {
    const res = await api.stream({
      conversationId,
      assistantMessageId: `${conversationId}-${Date.now()}`,
      operatorMode: true,
      reasoningEffort: TIER_REASONING[w.tier] ?? "medium",
      // The worker's operating prompt goes on top of the base agent prompt.
      systemPromptAppend: runBrief(w),
      messages: [{ role: "user", content: runTask(steps) }],
    });
    if (res?.error) return { live: true, text: l.text(), error: String(res.error) };
    return { live: true, text: l.text() || textOf(res) };
  } catch (e: any) {
    return { live: true, text: l.text(), error: e?.message || String(e) };
  } finally {
    l.off();
    if (activeRuns.get(w.id) === conversationId) activeRuns.delete(w.id);
  }
}

/** The agent runs still going in the main process. They outlive a page reload. */
export async function liveRuns(): Promise<LiveRun[]> {
  try { return (await acp()?.active?.()) ?? []; } catch { return []; }
}

/** The error a run ended with, from its last stream chunk ("[Error: ...]"), if any. */
export function endError(delta: unknown): string | undefined {
  const m = /\[Error: ([\s\S]*)\]\s*$/.exec(String(delta ?? ""));
  return m ? m[1] : undefined;
}

/** Picks a run back up after a page reload. The agent kept going in the main process; only
 *  the page's listeners were lost. Resolves like runWorker when the run ends. */
export async function attachRun(w: Worker, run: LiveRun, ev: RunEvents): Promise<RunResult> {
  const api = acp();
  if (!api) return { live: false, text: "" };
  const { conversationId } = run;
  // It ended while the page was away: only its result is left to show.
  if (run.done) { const error = endError(run.end); return { live: true, text: run.text, ...(error ? { error } : {}) }; }
  if (activeRuns.has(w.id)) return { live: true, text: "", error: "This worker is already running." };
  activeRuns.set(w.id, conversationId);
  if (run.text) ev.onText(run.text);
  const l = listen(api, conversationId, ev, run.text);
  let poll: ReturnType<typeof setInterval> | undefined;
  try {
    const end = await new Promise<{ error?: string; text?: string }>((resolve) => {
      l.offs.push(api.onStreamChunk((c) => { if (l.mine(c) && c.done) resolve({ error: endError(c.delta) }); }));
      // The run may have ended before we subscribed, or its last chunk may be missed: check now and then.
      const check = async () => {
        const now = (await liveRuns()).find((r) => r.conversationId === conversationId);
        if (!now || now.done) resolve({ error: endError(now?.end), text: now?.text });
      };
      poll = setInterval(check, 4000);
      void check();
    });
    // Main's copy is complete; ours misses whatever streamed before we subscribed.
    const text = end.text && end.text.length > l.text().length ? end.text : l.text();
    return { live: true, text, ...(end.error ? { error: end.error } : {}) };
  } finally {
    if (poll) clearInterval(poll);
    l.off();
    if (activeRuns.get(w.id) === conversationId) activeRuns.delete(w.id);
  }
}

/** Stops this worker's run only; other workers and chats keep going. */
export async function stopWorker(workerId: string) {
  const conversationId = activeRuns.get(workerId);
  if (!conversationId) return;
  try { await acp()?.stop(conversationId); } catch { /* ignore */ }
}
