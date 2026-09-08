/**
 * computer-use.ts
 * Clean TypeScript port of qwen-computer.py.
 * Keeps AgentTool / AIClient / progress-event integration points;
 * strips worker threads, PowerShell probing, overlay calls, and batching bloat.
 */

import * as fs from "fs";
import * as path from "path";

import type { AgentTool, ToolResult as AgentToolResult } from "../runner/types";
import { AIClient, ChatMessage } from "../../lib/ai-client";
import { globalAbortManager } from "../runner/abort-manager";
import DesktopOverlay from "./desktop-overlay";
import { checkToolPermission } from "./permission-checker";
import { isPermissionGranted } from "../../ipc/computer-use-permission";

// ── Optional native deps ─────────────────────────────────────────────────────

let robot: any = null;
try { robot = require("@jitsi/robotjs"); }
catch { console.warn("[ComputerUse] robotjs unavailable"); }

let sharp: typeof import("sharp") | null = null;
try { sharp = require("sharp"); }
catch { console.warn("[ComputerUse] sharp unavailable — cursor circle disabled"); }

// ── LP-10: local-VLM screenshot downscale decision ──────────────────────────

/** Local VLM ceiling for screenshot payloads (audit §X.C LP-09): fit inside
 * 1024×1024, never upscale. */
export const LOCAL_VLM_MAX_DIM = 1024;

/**
 * LP-10 (audit LP-09): should this provider's screenshots be downscaled before
 * base64? LOCAL vision models (ollama/lmstudio/loopback) run on user hardware
 * with no payload budget — a 1–2MB full-res frame per iteration is pure cost —
 * so they get the ≤1024px/JPEG-q70 path. CLOUD coordinate VLMs keep the
 * full-res physical capture untouched: on HiDPI displays the crisp pixels are
 * what the VLM reads coordinates from (see the capture comment in
 * attachScreenshot), and cloud payload budgets are fine. Signal comes from
 * AIClient.isLocal() (ai-client.ts) — never reimplemented here.
 */
export function shouldDownscaleForVlm(
  client: { isLocal?: () => boolean; provider?: string } | null | undefined,
): boolean {
  if (!client) return false;
  if (typeof client.isLocal === "function") return client.isLocal();
  return false;
}

// Removed screenshot-desktop import - using native desktopCapturer

// ── Sub-agent progress types (kept for app integration) ──────────────────────

export type SubAgentProgressEventType =
  | "step" | "reasoning" | "action" | "screenshot"
  | "complete" | "abort"
  | "branch_start" | "branch_update" | "branch_complete" | "branch_abort";

export interface SubAgentProgressEvent {
  type: SubAgentProgressEventType;
  toolCallId: string;
  timestamp: string;
  stepNumber?: number;
  totalSteps?: number;
  content?: string;
  action?: { type: string; params: Record<string, unknown>; description: string };
  screenshot?: { base64: string; width: number; height: number };
  metadata?: Record<string, unknown>;
  timelineBranch?: Record<string, unknown>;
}

// ── Tool spec (matches Python exactly) ───────────────────────────────────────

const COMPUTER_USE_TOOL_SPEC = {
  type: "function",
  function: {
    name: "computer_use",
    description: [
      "Use a mouse and keyboard to interact with native desktop applications, and take screenshots.",
      "* This is an interface to a desktop GUI. You do not have access to a terminal or applications menu. You must click on desktop icons to start applications.",
      "* Do not use this for websites, browser tabs, web apps, Gmail, Google Docs, booking sites, listings, or forms in a browser. Use the navis browser automation tool for those.",
      "* Some applications may take time to start or process actions, so you may need to wait and take successive screenshots to see the results of your actions.",
      "* The screen's resolution is dynamically detected from the host system.",
      "* Whenever you intend to move the cursor to click on an element like an icon, you should consult a screenshot to determine the coordinates of the element before moving the cursor.",
      "* Make sure to click any buttons, links, icons, etc with the cursor tip in the center of the element.",
    ].join("\n"),
    parameters: {
      type: "object",
      required: ["action"],
      properties: {
        action: {
          type: "string",
          enum: [
            "key",
            "type",
            "mouse_move",
            "left_click",
            "left_click_drag",
            "right_click",
            "middle_click",
            "double_click",
            "triple_click",
            "scroll",
            "hscroll",
            "hold",
            "release",
            "drag",
            "wait",
            "terminate",
            "answer",
          ],
          description: "The action to perform.",
        },
        keys: {
          type: "array",
          items: { type: "string" },
          description: "Keys used with action=key, hold, or release.",
        },
        text: {
          type: "string",
          description: "Text for action=type or action=answer.",
        },
        coordinate: {
          type: "array",
          items: { type: "number" },
          description: "Target coordinate [x, y] for mouse actions.",
        },
        start_coordinate: {
          type: "array",
          items: { type: "number" },
          description: "Start coordinate [x, y] for drag action.",
        },
        pixels: {
          type: "number",
          description: "Scroll amount for action=scroll or action=hscroll.",
        },
        hold_time: {
          type: "number",
          description: "Time in milliseconds to hold before releasing (optional).",
        },
        time: {
          type: "number",
          description: "Seconds to wait for action=wait.",
        },
        status: {
          type: "string",
          enum: ["success", "failure"],
          description: "Task status for action=terminate.",
        },
      },
    },
  },
};

const GEMINI_SYSTEM_PROMPT = `You are operating a Windows computer.
* To provide an answer to the user, *do not use any tools* and output your answer on a separate line. IMPORTANT: Do not add any formatting or additional punctuation/text, just output the answer by itself after two empty lines.
* Make sure you scroll down to see everything before deciding something isn't available.
* You can open an app from anywhere. The icon doesn't have to currently be on screen.
* Unless explicitly told otherwise, make sure to save any changes you make.
* If text is cut off or incomplete, scroll or click into the element to get the full text before providing an answer.
* IMPORTANT: Complete the given task EXACTLY as stated. DO NOT make any assumptions that completing a similar task is correct. If you can't find what you're looking for, SCROLL to find it.
* MANDATORY: In your reasoning, describe your action as a complete, natural English sentence (e.g. "Opening the Windows Start menu to search for Spotify", "Analyzing the screen to locate the search input", "Typing the application name into the search bar", "Clicking on the target result") instead of raw action codes or single-word commands like "Press" or "Key".
* To open an application (e.g. Spotify, Discord, Chrome, VS Code), use the Start Menu (hotkey 'win', type the app name, press Enter) or execute commands. NEVER refuse or ask the user "Would you like me to...". Always execute the action.
* If you want to edit some text, ONLY USE THE 'type_text_at' tool.
* The given task may already be completed. If so, there is no need to do anything.`;

// Compact prompt for GPT-5.4 — saves ~200 tokens per turn vs the full Gemini prompt
const GPT5_SYSTEM_PROMPT = `You are a Windows desktop automation agent. Use the provided tools to complete the task.
Rules:
- In your reasoning, describe your action as a complete, natural English sentence (e.g. "Opening the Windows Start menu to search for the application", "Analyzing the screen to find the play button") instead of raw action codes or single-word "Press" commands.
- Use scroll_document/scroll_at if content may be below the fold before concluding something is missing.
- Open apps using the Start menu (key: win, type app name, press Enter) if not visible on screen. NEVER ask the user "Would you like me to try executing...". Always perform the action.
- Save changes unless explicitly told not to.
- Do nothing if the task is already complete.
- To answer the user, output ONLY the answer text (no tools, no formatting).`;

const CLAUDE_COMPUTER_USE_PROMPT = `You are a Windows desktop automation agent powered by Claude. Use the computer_use tool or actions to operate the computer.
Rules:
- In your reasoning, describe your action as a complete, natural English sentence.
- Consult the screenshot coordinates carefully before clicking, typing, or moving the cursor.
- To open an application, use the Start Menu (key 'win', type the app name, press Enter).
- If content may be below the visible view, scroll before concluding it is absent.
- When the task is complete, stop taking actions and provide your final response to the user.`;

const SYSTEM_PROMPT = `You are a GUI automation agent. You control a desktop by outputting structured actions.

## CRITICAL OUTPUT FORMAT — YOU MUST FOLLOW THIS EXACTLY

Your response MUST use this exact structure, nothing else:

\`\`\`
Thought: <Step-by-step reasoning: 1. Analyze current screen state and previous action result. 2. Identify the goal. 3. Decide on the best next action.>
Action: <single action call from the Action Space below>
\`\`\`

## Action Space (copy syntax exactly, no paraphrasing)

click(start_box='<|box_start|>(x1,y1)<|box_end|>')
left_double(start_box='<|box_start|>(x1,y1)<|box_end|>')
right_single(start_box='<|box_start|>(x1,y1)<|box_end|>')
drag(start_box='<|box_start|>(x1,y1)<|box_end|>', end_box='<|box_start|>(x3,y3)<|box_end|>')
hotkey(key='ctrl c')
type(content='text here\\n')
scroll(start_box='<|box_start|>(x1,y1)<|box_end|>', direction='down')
wait()
finished()
call_user()

## Coordinate System
- Coordinates are on a 1000×1000 normalized grid
- (0,0) is top-left, (1000,1000) is bottom-right
- Look at the screenshot carefully to find the exact pixel location of UI elements
- x increases left→right, y increases top→bottom
- The current cursor position is marked with a prominent red crosshair on the screenshot.

## Advanced Reasoning & Rules (Frontier Vision)
- ONE action per response only.
- DO NOT hallucinate elements. If an element is not visible, use search, scrolling, or the Start Menu to find it.
- NEVER repeat the exact same action or click the exact same coordinates if the previous attempt failed to change the screen state. If you are stuck, try a different approach, wait, or use keyboard shortcuts.
- TRANSIENT UI STATES (MICRO-ANIMATIONS): Some actions (like clicking 'Copy') trigger a very fast animation (e.g., a checkmark) that vanishes before your next screenshot. If you just clicked a button and the screen looks identical, DO NOT assume it failed. ASSUME IT SUCCEEDED and proceed to the next step. Do not click it repeatedly.
- Always verify if the previous action succeeded by checking the current screen state (keeping transient states in mind).
- Use ONLY the action functions listed above — never describe actions in plain English.
- Coordinates must be inside <|box_start|>...<|box_end|> tags.
- To click a taskbar icon at the bottom of the screen, use y values close to 1000.
- To open applications not visible, use hotkey(key='win') to open Start Menu, then type the app name.

## Examples of CORRECT output:
\`\`\`
Thought: The previous click on the text box didn't focus it. I'll try double-clicking it now.
Action: left_double(start_box='<|box_start|>(500,400)<|box_end|>')
\`\`\`

\`\`\`
Thought: VSCode is not visible; I will open the Start Menu to search for it.
Action: hotkey(key='win')
\`\`\`

\`\`\`
Thought: I will type "code" to search for VSCode in the Start Menu.
Action: type(content='code\\n')
\`\`\`

## WRONG — never do this:
\`\`\`
Action: Click on the taskbar icon for VSCode to open it.
Action: Open VSCode by pressing Win key
\`\`\``;

const FORMAT_CORRECTION = `Your previous response contained a plain-English action description instead of a structured action call. You MUST use the exact function syntax from the Action Space.

For example, instead of:
  Action: Click on the taskbar icon for VSCode to open it.

Write:
  Action: click(start_box='<|box_start|>(50,980)<|box_end|>')

Or if you cannot see the element, use:
  Action: hotkey(key='win')
  (then in the next step type the application name)

Now output ONLY:
Thought: <why you are taking this action>
Action: <structured action call>`;

// Remove reasoning blocks (some providers emit them inline)
// before action parsing — the Action: regexes would otherwise match inside
// the model's deliberation text instead of its final answer.
function stripThinking(text: string): string {
  let clean = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  clean = clean.replace(/<\/?think>/gi, "");
  return clean.trim();
}

// Parse the strict "Thought: ... Action: ..." format. Only ONE action is
// taken from the Action block (first non-empty line) — the protocol is
// single-action-per-turn, matching the prompt's explicit rule.
function parseOutput(raw: string): { thought: string; actions: string[] } {
  let thought = "";
  const actions: string[] = [];

  raw = stripThinking(raw);
  raw = raw.replace(/^```[a-z]*\n?/gmi, "");
  raw = raw.replace(/```$/gmi, "");

  const thoughtMatch = raw.match(/Thought:\s*([\s\S]*?)(?=Action:|$)/i);
  if (thoughtMatch) {
    thought = thoughtMatch[1].trim();
  }

  const actionMatch = raw.match(/Action:\s*([\s\S]*?)$/i);
  if (actionMatch) {
    const block = actionMatch[1].trim();
    const lines = block.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) {
        actions.push(trimmed);
        break;
      }
    }
  }

  // Fallback: if actions is empty but the raw response contains a structured action, parse it directly
  if (actions.length === 0) {
    const lines = raw.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (isStructuredAction(trimmed)) {
        actions.push(trimmed);
        break;
      }
    }
  }

  return { thought, actions };
}

const KNOWN_ACTION_PREFIXES = [
  "click(", "left_double(", "right_single(", "drag(",
  "hotkey(", "type(", "scroll(", "wait(", "finished(", "call_user("
];

// Match a known action prefix exactly (trim + lowercase first) — this is the
// gate between "structured action" and "natural-language ramble" that drives
// format-correction retries.
function isStructuredAction(line: string): boolean {
  const stripped = line.trim().toLowerCase();
  return KNOWN_ACTION_PREFIXES.some(p => stripped.startsWith(p));
}

function parseBox(s: string): [number, number] | null {
  const m = s.match(/\(\s*(\d+)\s*,\s*(\d+)\s*\)/);
  if (m) {
    return [parseInt(m[1], 10), parseInt(m[2], 10)];
  }
  return null;
}

const COMPUTER_USE_ACTION_TOOL = {
  name: COMPUTER_USE_TOOL_SPEC.function.name,
  description: COMPUTER_USE_TOOL_SPEC.function.description,
  parameters: COMPUTER_USE_TOOL_SPEC.function.parameters,
};

const COMPUTER_USE_OUTPUT_INSTRUCTIONS = [
  "You are controlling the user's real Windows desktop, not a Linux VM or sandbox.",
  "Respond by calling the computer_use tool for the next single GUI action.",
  "Do not describe the action in prose when a GUI action is needed.",
  "For mouse actions, include exact coordinate [x, y] from the screenshot.",
  "Use wait when the UI needs time, answer for final user-facing text, and terminate when the task is finished.",
].join("\n");

function brainPrompt(objective: string): string {
  return `You are a desktop task agent. Look at the screenshot and decide the next action.

Rules:
1. If the task is COMPLETE (song playing, file saved, result displayed, app open), output ONLY: done
2. Otherwise output ONLY a plain-English instruction — no coords, no explanation.
3. Do NOT repeat failed actions.
4. Be specific: 'click the search bar' beats 'click something'.

Task: ${objective}

Output done if complete, otherwise plain English action.`;
}

const HAND_PROMPT = `Parse this instruction and output a JSON array of action strings.
Example: ["click(450,380)", "type(search query)", "drag([100,200], [300,400])", "hold(500,600, 1000)"]
Note: drag takes [start_x, start_y], [end_x, end_y]. hold takes x, y, time_ms.
Another example: ["click(200,500)", "press(space)", "hold_w", "release_w"]
Format rules:
- click(x,y) / move(x,y) / smooth(x,y) — TWO numbers only, no text. click(450,380) NOT click(start_box=...)
- type(text) — text in parentheses
- press(key) — single key name
- hold(x, y, ms) — hold mouse at x,y for ms
- drag([x1,y1], [x2,y2]) — drag mouse from x1,y1 to x2,y2
- Booleans/flags like start_box= are not allowed
Valid actions:
click(x,y) | move(x,y) | smooth(x,y) | double_click(x,y)
type(text) | press(key) | scroll(up/down)
right_click() | left_click()
ctrl_a() | ctrl_c() | ctrl_v() | win()
alt tab | alt f4
hold_w | release_w | hold_a | release_a | hold_d | release_d | hold_s | release_s
press(enter) | press(escape) | press(tab) | press(space)
press(1) through press(9) | sprint() | sneak() | interact() | center()
Output ONLY the JSON array. No explanation.`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function nowTs(): string {
  const d = new Date();
  return (
    d.getFullYear() +
    String(d.getMonth() + 1).padStart(2, "0") +
    String(d.getDate()).padStart(2, "0") + "-" +
    String(d.getHours()).padStart(2, "0") +
    String(d.getMinutes()).padStart(2, "0") +
    String(d.getSeconds()).padStart(2, "0")
  );
}

function sleep(seconds: number): Promise<void> {
  return new Promise(r => setTimeout(r, seconds * 1000));
}

function sleepMs(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// ── AG-SAF-06: external URL guard ────────────────────────────────────────────
// Only http(s) URLs may ever reach shell.openExternal; model-provided strings
// such as `javascript:` or `file:` are blocked fail-closed.

/** AG-SAF-06: allow only http(s) URLs through to shell.openExternal.
 * Fails closed on any parse error — model-provided `javascript:`/`file:`
 * schemes must never reach the OS default browser. */
export function isSafeExternalUrl(url: unknown): boolean {
  if (typeof url !== 'string' || !url) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

// ── AG-SAF-11: destructive-action heuristic ──────────────────────────────────
// Backstop for the model-driven safetyDecision: if any in-scope text names a
// destructive verb, interactive user confirmation is required before dispatch.

export const DESTRUCTIVE_ACTION_PATTERN = /\b(delete|remove|uninstall|format|purge|wipe|erase|trash|shred|reset|clear)\b/i;

/** AG-SAF-11: true if any text part names a destructive verb.
 * Deliberately over-broad (false positives just trigger a confirm dialog) —
 * a missed "delete" is far worse than an unnecessary prompt. */
export function looksDestructive(parts: Array<string | undefined | null>): boolean {
  return parts.some(p => typeof p === 'string' && p.length > 0 && DESTRUCTIVE_ACTION_PATTERN.test(p));
}

// AG-SAF-07: maximum duration any hold action may keep a button/key down.
export const MAX_HOLD_MS = 30_000;

// ── Memory hygiene ────────────────────────────────────────────────────────────

const MAX_HISTORY_STEPS = 8;

// Replace (not drop) screenshots in history entries older than the window:
// entry count/thought/action stay for trajectory context while the heavy
// base64 payload is freed — keeps prompt assembly cheap.
function trimHistory(history: any[]): any[] {
  const overflow = history.length - MAX_HISTORY_STEPS;
  for (let i = 0; i < overflow; i++) {
    const h = history[i];
    if (h && typeof h === "object") {
      h.screenshot = `[step ${i + 1} screenshot archived]`;
    }
  }
  return history;
}

/**
 * Keep only the newest `maxFiles` PNGs in `dir` (oldest by mtime are deleted).
 * Every capture writes a full screenshot, so long sessions grow unboundedly;
 * per-file try/catch (not one blanket catch) keeps a race with a vanished
 * file from aborting the whole prune. Never throws — callers fire-and-forget.
 */
export async function pruneScreenshotDir(dir: string, maxFiles = 500): Promise<void> {
  try {
    const entries = await fs.promises.readdir(dir);
    const files: { name: string; mtimeMs: number }[] = [];
    for (const name of entries) {
      if (!name.endsWith(".png")) continue;
      try {
        const st = await fs.promises.stat(path.join(dir, name));
        files.push({ name, mtimeMs: st.mtimeMs });
      } catch { /* file vanished mid-prune */ }
    }
    if (files.length <= maxFiles) return;
    files.sort((a, b) => b.mtimeMs - a.mtimeMs);
    for (const f of files.slice(maxFiles)) {
      try { await fs.promises.unlink(path.join(dir, f.name)); }
      catch { /* already gone */ }
    }
    console.log(`[ComputerUse] Pruned ${files.length - maxFiles} old screenshots from ${dir}`);
  } catch (err) {
    console.warn("[ComputerUse] pruneScreenshotDir failed:", err);
  }
}

// One-way latch: once a settle capture throws (e.g. desktopCapturer denied),
// never retry it — repeated failing captures cost far more than the short
// fixed waits we fall back to.
let settleCaptureFailed = false;

/**
 * Cheap "has the screen changed?" probe for waitForScreenSettle.
 * Grabs a tiny 160x90 desktopCapturer thumbnail and FNV-1a hashes its PNG
 * bytes into a `size:hash` string — small enough to poll rapidly, and only
 * the digest is ever compared, never the image itself.
 * Side effects: none on success; latches settleCaptureFailed on first error.
 * Returns null when capture is unavailable (latched failure / empty thumbnail).
 */
async function captureScreenFingerprint(): Promise<string | null> {
  if (settleCaptureFailed) return null;
  try {
    const { desktopCapturer } = require("electron");
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: 160, height: 90 },
    });
    const thumb = sources[0]?.thumbnail;
    if (!thumb || thumb.isEmpty()) return null;
    // PNG bytes are hashed directly (size included in the fingerprint) —
    // identical screens → identical digest; any pixel change flips the hash.
    const buf = thumb.toPNG();
    // FNV-1a: cheap 32-bit rolling hash, fast enough for a full ~14KB PNG
    // on every poll. Math.imul keeps 32-bit wraparound correct in JS.
    let hash = 0x811c9dc5;
    for (let i = 0; i < buf.length; i++) {
      hash ^= buf[i];
      hash = Math.imul(hash, 0x01000193);
    }
    return `${buf.length}:${(hash >>> 0).toString(16)}`;
  } catch (err) {
    settleCaptureFailed = true;
    console.warn("[ComputerUse] settle fingerprint unavailable:", err);
    return null;
  }
}

/**
 * Block until the screen stops changing (two consecutive identical
 * fingerprints) or `maxMs` elapses. Screenshots taken mid-animation are
 * stale, so the agent waits for the UI to settle before re-capturing.
 * Falls back to a short fixed sleep whenever fingerprinting is unavailable.
 */
async function waitForScreenSettle(pollMs = 120, maxMs = 900): Promise<void> {
  let last = await captureScreenFingerprint();
  if (last === null) {
    // Fingerprinting unavailable (latched failure) — best-effort fixed wait
    // so the caller still gives animations roughly one poll-and-change cycle.
    await sleepMs(180);
    return;
  }
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    await sleepMs(pollMs);
    const current = await captureScreenFingerprint();
    if (current === null) {
      await sleepMs(180);
      return;
    }
    if (current === last) return;
    // Screen still animating: keep polling — the deadline, not this loop,
    // is the only bound when pixels never stop changing.
    last = current;
  }
}

// WHY: screenshots taken mid-animation show stale UI state, which makes the
// VLM hallucinate elements and click wrong targets. Polling until the
// fingerprint stops changing guarantees the next capture is post-animation.
// Fixed 900ms default deadline bounds the wait even when pixels keep
// changing (videos, animated spinners) — settle is best-effort, never blocking.
function ensureXy(coordinate?: [number, number] | null): [number, number] {
  // Floor to integers: robotjs takes pixel indices; fractional model output
  // would otherwise be silently truncated (or rejected) downstream.
  if (!coordinate || coordinate.length !== 2) throw new Error("coordinate=[x, y] is required.");
  return [Math.floor(coordinate[0]), Math.floor(coordinate[1])];
}

function maybeInt(v: number | undefined | null, def = 0): number {
  return v != null ? Math.floor(v) : def;
}

// ── ToolResult ────────────────────────────────────────────────────────────────
// Mirrors Python's ToolResult.as_content()

class ToolResult {
  constructor(public payload: Record<string, any>) {}

  /** Flatten the payload into provider content parts: human-readable text
   * lines first, then the screenshot part. Works on a shallow copy — the
   * original payload (kept by callers) is never mutated. */
  asContent(): any[] {
    const p = { ...this.payload };
    const screenshot = p.screenshot as string | undefined; delete p.screenshot;
    const action     = p._action   as string | undefined; delete p._action;
    const detail     = p.detail    as string | undefined; delete p.detail;
    const textValue  = p.text      as string | undefined; delete p.text;

    const meta: Record<string, any> = {};
    for (const k of ["cursor", "display", "downscaled_size", "screenshot_path", "result"]) {
      if (k in p) { meta[k] = p[k]; delete p[k]; }
    }

    const lines: string[] = [];
    if (action)    lines.push(`action=${action}`);
    const status = p.status as string | undefined; delete p.status;
    if (status)    lines.push(`status=${status}`);
    if (detail)    lines.push(detail);
    if (textValue) lines.push(`text: ${textValue}`);
    if (Object.keys(meta).length)  lines.push(JSON.stringify(meta));
    if (Object.keys(p).length)     lines.push(JSON.stringify(p));

    const content: any[] = [];
    if (lines.length) content.push({ type: "text", text: lines.join("\n") });
    if (screenshot)   content.push({ type: "image_url", image_url: { url: screenshot, detail: "low" } });
    if (!content.length) content.push({ type: "text", text: "tool call completed." });
    return content;
  }
}

// ── ComputerUseTool ───────────────────────────────────────────────────────────

export class ComputerUseTool {
  public lastViewport: Record<string, any> = {};
  public overlay: DesktopOverlay | null = null;
  public client: AIClient | null = null;

  // AG-SAF-07: mouse buttons currently held down by holdAction's coordinate
  // path, so releaseAll() can physically release them at abort / turn end.
  private heldMouse = new Set<'left' | 'right' | 'middle'>();

  // AG-MEM-02: track every tool whose overlay window is still alive so
  // destroyAllComputerUseOverlays() can reap them on app quit.
  private static readonly liveToolOverlays = new Set<ComputerUseTool>();
  static getLiveToolOverlays(): Set<ComputerUseTool> { return ComputerUseTool.liveToolOverlays; }

  // AG-CORR-07: cross-instance hardware mutex (robotjs drives one physical
  // desktop — even distinct ComputerUseTool instances must serialize).
  private static hardwareMutex: Promise<void> = Promise.resolve();

  /** Acquire the cross-instance hardware lock; resolves with a release fn.
   * Promise-chaining (no separate queue): each waiter holds `prev` and only
   * then resolves release — FIFO by construction. */
  static acquireGlobalMutex(): Promise<() => void> {
    let release!: () => void;
    const prev = ComputerUseTool.hardwareMutex;
    ComputerUseTool.hardwareMutex = new Promise<void>(resolve => { release = resolve; });
    return prev.then(() => release);
  }

  constructor(
    private screenshotDir: string,
    private monitorIndex   = 1,
    private mouseMoveDuration = 0.0,   // unused in robotjs; kept for parity
    private dragDuration   = 0.15,     // unused in robotjs; kept for parity
    private imageQuality   = 95,
  ) {
    fs.mkdirSync(this.screenshotDir, { recursive: true });

    void pruneScreenshotDir(this.screenshotDir);

    // Initialize overlay
    try {
      this.overlay = new DesktopOverlay();
      console.log("[ComputerUse] Desktop overlay initialized");
    } catch (err) {
      console.warn("[ComputerUse] Failed to initialize overlay:", err);
    }
    // AG-MEM-02 registration half of the invariant: constructor adds,
    // cleanup() removes — so a quit-time sweep of liveToolOverlays finds
    // every overlay still holding a BrowserWindow.
    ComputerUseTool.liveToolOverlays.add(this);

    // Configure mouse delay after robotjs availability check
    if (!robot) {
      const hint = process.platform === 'linux'
        ? 'On Linux, run: npm run rebuild:electron'
        : process.platform === 'darwin'
        ? 'On macOS, ensure Xcode CLT is installed (xcode-select --install), then run: npm run rebuild:electron'
        : 'Run: npm run rebuild:electron';
      console.warn(`[ComputerUse] robotjs unavailable — OS automation (click/type/scroll) will be disabled. ${hint}`);
    } else {
      try {
        robot.setMouseDelay(20);
        console.log("[ComputerUse] robotjs initialized with 20ms mouse delay");
      } catch (err) {
        console.error("[ComputerUse] Failed to set mouse delay:", err);
      }
    }
  }

  // ── Public entry point ──────────────────────────────────────────────────────

  async call(params: Record<string, any>): Promise<ToolResult> {
    const { action } = params;

    // MP-SEC-15: fail closed — no computer-use action runs unless the user
    // granted permission through the native main-process dialog. Checked
    // before the AG-CORR-07 mutex so a denied call never queues behind (or
    // delays) real hardware actions.
    if (!isPermissionGranted()) {
      return new ToolResult({
        status: 'error',
        detail: 'Computer-use permission not granted: the user must approve computer use via the permission dialog before any action can run.',
      });
    }

    // AG-CORR-07: serialize all hardware-affecting calls through an internal
    // promise queue. The parallel executor can run multiple computer_use calls
    // concurrently; interleaved robotjs sequences corrupt automation.
    const releaseMutex = await ComputerUseTool.acquireGlobalMutex();

    try {
    // Handle execute_actions specially - dispatch multiple actions
    if (action === 'execute_actions' && Array.isArray(params.actions)) {
      console.log(`[ComputerUse] Executing ${params.actions.length} actions`);
      for (const actionStr of params.actions) {
        console.log(`[ComputerUse] Dispatching: ${actionStr}`);
        // AG-CORR-08: abort a long execute_actions run between queued actions.
        if (activeAgent && activeAgent.isAborted()) {
          return new ToolResult({ status: "error", detail: "execute_actions aborted" });
        }
        // Parse and execute each action using dispatchAction logic
        await this.executeActionString(actionStr);
      }
      return new ToolResult(await this.attachScreenshot({ status: "ok", detail: `Executed ${params.actions.length} actions` }));
    }

    const handlers: Record<string, (p: any) => Promise<Record<string, any>>> = {
      mouse_move:      p => this.mouseMove(p),
      left_click:      p => this.leftClick(p),
      right_click:     p => this.rightClick(p),
      middle_click:    p => this.middleClick(p),
      double_click:    p => this.doubleClick(p),
      triple_click:    p => this.tripleClick(p),
      left_click_drag: p => this.leftClickDrag(p),
      scroll:          p => this.scroll(p),
      hscroll:         p => this.hscroll(p),
      type:            p => this.typeAction(p),
      key:             p => this.keyAction(p),
      hold:            p => this.holdAction(p),
      release:         p => this.releaseAction(p),
      drag:            p => this.dragAction(p),
      wait:            p => this.waitAction(p),
      answer:          p => this.answer(p),
      terminate:       p => this.terminate(p),
    };

    const handler = handlers[action];
    if (!handler) throw new Error(`Unsupported action: ${action}`);

    const result = await handler(params);
    result._action = action;

    // answer / terminate don't get a screenshot (matches Python)
    if (action === "answer" || action === "terminate") {
      return new ToolResult(result);
    }
    return new ToolResult(await this.attachScreenshot(result));
    } finally {
      // AG-CORR-07: release the hardware mutex on every path, including throws.
      releaseMutex();
    }
  }

  private async executeActionString(text: string): Promise<void> {
    text = text.trim();
    if (!text || text.startsWith("#")) return;

    const has = (pat: string | RegExp, s: string) => new RegExp(pat, "i").test(s);

    // Helper to extract (x, y) coordinates from formats like "<|box_start|>(835,138)<|box_end|>", "(835,138)", or "835, 138"
    const extractCoords = (str: string): [number, number] | null => {
      const m = str.match(/\(?\s*(-?\d+)\s*,\s*(-?\d+)\s*\)?/);
      if (m) {
        return [parseInt(m[1], 10), parseInt(m[2], 10)];
      }
      return null;
    };

    // ── 1. hotkey(key='ctrl ,') or hotkey('ctrl c') or press(key='win') ──
    const hotkeyMatch = text.match(/^(?:hotkey|press)\s*\(\s*(?:key\s*=\s*)?['"]?([\s\S]*?)['"]?\s*\)$/i);
    if (hotkeyMatch) {
      const rawKey = hotkeyMatch[1].trim();
      // Handle hotkey combinations like 'ctrl ,', 'ctrl c', 'ctrl+c', 'alt+tab', 'win', 'ctrl, shift, esc'
      const keyParts = rawKey.split(/[\s,+]+/).map(k => k.trim()).filter(Boolean);
      if (keyParts.length > 0) {
        await this.call({ action: "key", keys: keyParts });
        return;
      }
    }

    // ── 2. Double Click (left_double or double_click) ──
    if (has(/^(?:left_double|double_click)/i, text)) {
      const coords = extractCoords(text);
      if (coords) {
        const [rx, ry] = this.absoluteXy(coords);
        console.log(`[ComputerUse] Double Click: input=(${coords[0]},${coords[1]}) final=(${rx},${ry})`);
        this.doubleClickAt(rx, ry);
      } else {
        await this.call({ action: "double_click" });
      }
      return;
    }

    // ── 3. Right Click (right_single or right_click) ──
    if (has(/^(?:right_single|right_click)/i, text)) {
      const coords = extractCoords(text);
      if (coords) {
        const [rx, ry] = this.absoluteXy(coords);
        console.log(`[ComputerUse] Right Click: input=(${coords[0]},${coords[1]}) final=(${rx},${ry})`);
        this.click(rx, ry, "right");
      } else {
        this.click(undefined, undefined, "right");
      }
      return;
    }

    // ── 4. Left Click (click or left_click) ──
    if (has(/^(?:click|left_click|mouse_click)/i, text)) {
      const coords = extractCoords(text);
      if (coords) {
        if (!robot) {
          throw new Error(`robotjs unavailable - cannot execute click`);
        }
        const [rx, ry] = this.absoluteXy(coords);
        console.log(`[ComputerUse] Click: input=(${coords[0]},${coords[1]}) final=(${rx},${ry})`);
        this.moveMouse(rx, ry);
        this.click(rx, ry, "left");
      } else {
        this.click(undefined, undefined, "left");
      }
      return;
    }

    // ── 5. Type text ──
    const typeMatch = text.match(/^type\s*\(\s*(?:content|text)?\s*[:=]?\s*['"]?([\s\S]*?)['"]?\s*\)$/i);
    if (typeMatch) {
      let rawText = typeMatch[1];
      const hasTrailingNewline = rawText.endsWith('\\n') || rawText.endsWith('\n');
      rawText = rawText.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
      
      const cleanType = hasTrailingNewline ? rawText.replace(/[\r\n]+$/, '') : rawText;
      if (cleanType) {
        await this.call({ action: "type", text: cleanType });
      }
      if (hasTrailingNewline) {
        await sleep(0.1);
        await this.call({ action: "key", keys: ["enter"] });
      }
      return;
    }

    // ── 6. scroll(direction: down|up|left|right [, coordinate: [x, y]] [, amount: N]) ──
    if (has(/^scroll\s*\(/i, text)) {
      const dirMatch = text.match(/direction\s*[:=]\s*["']?(up|down|left|right)["']?/i);
      const amtMatch = text.match(/(?:amount|pixels)\s*[:=]\s*(-?\d+)/i);
      const direction = dirMatch ? dirMatch[1].toLowerCase() : (text.toLowerCase().includes("up") ? "up" : "down");
      const coords = extractCoords(text);
      const pixels = amtMatch ? parseInt(amtMatch[1], 10) : 300;
      const isHoriz = direction === "left" || direction === "right";
      const sign = (direction === "down" || direction === "right") ? pixels : -pixels;

      const scrollParams: any = { action: isHoriz ? "hscroll" : "scroll", pixels: sign };
      if (coords) scrollParams.coordinate = coords;

      await this.call(scrollParams);
      return;
    }

    // ── 7. drag(start_box=..., end_box=...) or drag([x1,y1], [x2,y2]) ──
    if (has(/^drag\s*\(/i, text)) {
      const coordMatches = [...text.matchAll(/\(?\s*(-?\d+)\s*,\s*(-?\d+)\s*\)?/g)];
      if (coordMatches.length >= 2 && robot) {
        const p1: [number, number] = [parseInt(coordMatches[0][1], 10), parseInt(coordMatches[0][2], 10)];
        const p2: [number, number] = [parseInt(coordMatches[1][1], 10), parseInt(coordMatches[1][2], 10)];
        const [sx, sy] = this.absoluteXy(p1);
        const [ex, ey] = this.absoluteXy(p2);
        robot.moveMouse(sx, sy);
        robot.mouseToggle("down", "left");
        await sleep(0.15);
        robot.moveMouse(ex, ey);
        robot.mouseToggle("up", "left");
        console.log(`[ComputerUse] Drag from (${sx},${sy}) to (${ex},${ey})`);
      } else {
        console.warn(`[ComputerUse] drag: could not parse coordinates from: ${text}`);
      }
      return;
    }

    // ── 8. hover(coordinate: [x, y]) / mouse_move ──
    if (has(/^(?:hover|move_to|mouse_move)\s*\(/i, text)) {
      const coords = extractCoords(text);
      if (coords && robot) {
        const [rx, ry] = this.absoluteXy(coords);
        this.moveMouse(rx, ry);
        console.log(`[ComputerUse] Hover to (${rx},${ry})`);
      }
      return;
    }

    // ── 9. wait(time: N) ──
    if (has(/^wait\s*\(/i, text)) {
      const numMatch = text.match(/(\d+(?:\.\d+)?)/);
      const secs = numMatch ? parseFloat(numMatch[1]) : 1;
      await sleep(secs);
      console.log(`[ComputerUse] Waited ${secs}s`);
      return;
    }

    // ── 10. finished / terminate / done / call_user ──
    if (has(/^(?:finished|terminate|done|call_user)/i, text)) {
      console.log(`[ComputerUse] Automation step complete: ${text}`);
      return;
    }

    // ── 11. screenshot() / observe() ──
    if (has(/^(?:screenshot|observe|capture)\s*\(/i, text)) {
      await this.captureObservation();
      return;
    }

    console.warn(`[ComputerUse] Unhandled action: ${text}`);
  }

  async captureObservation(): Promise<Record<string, any>> {
    return this.attachScreenshot({ status: "observe" });
  }

  /** AG-SAF-07: physically release every tracked held mouse button.
   * Physical (robotjs) release is required — dropping the JS Set alone leaves
   * the OS-level button latched down. */
  releaseHeldMouse(): void {
    for (const btn of this.heldMouse) {
      try {
        if (robot) {
          robot.mouseToggle("up", btn);
        }
      } catch (err) {
        console.warn(`[ComputerUse] releaseHeldMouse: failed to release '${btn}':`, err);
      }
    }
    this.heldMouse.clear();
  }

  /** Tear down this tool's overlay window and drop it from the live registry.
   * AG-MEM-02 invariant: constructor adds to liveToolOverlays, cleanup() removes —
   * so destroyAllComputerUseOverlays() always reaps every live instance. */
  cleanup(): void {
    ComputerUseTool.liveToolOverlays.delete(this);
    if (this.overlay) {
      this.overlay.hide();
      this.overlay.destroy();
      this.overlay = null;
      console.log("[ComputerUse] Overlay cleaned up");
    }
  }

  // ── Action handlers ─────────────────────────────────────────────────────────

  private async mouseMove(p: any) {
    if (!robot) {
      throw new Error(`robotjs unavailable - cannot execute mouse_move`);
    }
    const [x, y] = this.absoluteXy(p.coordinate);
    console.log(`[Move] Target=(${x}, ${y})`);
    try {
      this.moveMouse(x, y);
      console.log(`[Move] Executed successfully`);
      return { status: "ok", detail: `Moved to (${x}, ${y}).` };
    } catch (err) {
      console.error(`[Move] Error:`, err);
      throw err;
    }
  }

  private async leftClick(p: any) {
    if (!robot) {
      throw new Error(`robotjs unavailable - cannot execute left_click`);
    }
    if (p.coordinate) {
      const [x, y] = this.absoluteXy(p.coordinate);
      console.log(`[Left Click] Target=(${x}, ${y})`);
      try {
        this.moveMouse(x, y);
        this.click(x, y, "left");

        // Update overlay status
        if (this.overlay) {
          this.overlay.setStatus(`Clicked at (${x}, ${y})`);
        }

        console.log(`[Left Click] Executed successfully`);
        return { status: "ok", detail: `Left click at (${x}, ${y}).` };
      } catch (err) {
        console.error(`[Left Click] Error:`, err);
        throw err;
      }
    }
    console.log(`[Left Click] At current cursor`);
    try {
      this.click(undefined, undefined, "left");

      // Update overlay status
      if (this.overlay) {
        this.overlay.setStatus(`Clicked at current cursor`);
      }

      console.log(`[Left Click] Executed successfully`);
      return { status: "ok", detail: "Left click at current cursor." };
    } catch (err) {
      console.error(`[Left Click] Error:`, err);
      throw err;
    }
  }

  private async rightClick(p: any) {
    if (!robot) {
      throw new Error(`robotjs unavailable - cannot execute right_click`);
    }
    if (p.coordinate) {
      const [x, y] = this.absoluteXy(p.coordinate);
      console.log(`[Right Click] Target=(${x}, ${y})`);
      try {
        this.click(x, y, "right");
        console.log(`[Right Click] Executed successfully`);
        return { status: "ok", detail: `Right click at (${x}, ${y}).` };
      } catch (err) {
        console.error(`[Right Click] Error:`, err);
        throw err;
      }
    }
    console.log(`[Right Click] At current cursor`);
    try {
      this.click(undefined, undefined, "right");
      console.log(`[Right Click] Executed successfully`);
      return { status: "ok", detail: "Right click at current cursor." };
    } catch (err) {
      console.error(`[Right Click] Error:`, err);
      throw err;
    }
  }

  private async middleClick(p: any) {
    if (!robot) {
      throw new Error(`robotjs unavailable - cannot execute middle_click`);
    }
    if (p.coordinate) {
      const [x, y] = this.absoluteXy(p.coordinate);
      console.log(`[Middle Click] Target=(${x}, ${y})`);
      try {
        this.click(x, y, "middle");
        console.log(`[Middle Click] Executed successfully`);
        return { status: "ok", detail: `Middle click at (${x}, ${y}).` };
      } catch (err) {
        console.error(`[Middle Click] Error:`, err);
        throw err;
      }
    }
    console.log(`[Middle Click] At current cursor`);
    try {
      this.click(undefined, undefined, "middle");
      console.log(`[Middle Click] Executed successfully`);
      return { status: "ok", detail: "Middle click at current cursor." };
    } catch (err) {
      console.error(`[Middle Click] Error:`, err);
      throw err;
    }
  }

  private async doubleClick(p: any) {
    if (!robot) {
      throw new Error(`robotjs unavailable - cannot execute double_click`);
    }
    const [x, y] = this.absoluteXy(p.coordinate);
    console.log(`[Double Click] Target=(${x}, ${y})`);
    try {
      this.doubleClickAt(x, y);
      console.log(`[Double Click] Executed successfully`);
      return { status: "ok", detail: `Double click at (${x}, ${y}).` };
    } catch (err) {
      console.error(`[Double Click] Error:`, err);
      throw err;
    }
  }

  private async tripleClick(p: any) {
    if (!robot) {
      throw new Error(`robotjs unavailable - cannot execute triple_click`);
    }
    const [x, y] = this.absoluteXy(p.coordinate);
    console.log(`[Triple Click] Target=(${x}, ${y})`);
    try {
      robot.moveMouse(x, y);
      robot.mouseClick("left");
      robot.mouseClick("left");
      robot.mouseClick("left");
      console.log(`[Triple Click] Executed successfully`);
      return { status: "ok", detail: `Triple click at (${x}, ${y}).` };
    } catch (err) {
      console.error(`[Triple Click] Error:`, err);
      throw err;
    }
  }

  private async leftClickDrag(p: any) {
    if (!robot) {
      throw new Error(`robotjs unavailable - cannot execute left_click_drag`);
    }
    const [x, y] = this.absoluteXy(p.coordinate);
    console.log(`[Drag] Target=(${x}, ${y})`);
    try {
      robot.dragMouse(x, y);
      console.log(`[Drag] Executed successfully`);
      return { status: "ok", detail: `Drag to (${x}, ${y}).` };
    } catch (err) {
      console.error(`[Drag] Error:`, err);
      throw err;
    }
  }

  private async scroll(p: any) {
    if (!robot) {
      throw new Error(`robotjs unavailable - cannot execute scroll`);
    }
    if (p.coordinate) {
      const [x, y] = this.absoluteXy(p.coordinate);
      console.log(`[Scroll] Moving to (${x}, ${y})`);
      this.moveMouse(x, y);
    }
    const pixels = maybeInt(p.pixels);
    console.log(`[Scroll] Scrolling ${pixels} pixels vertically`);
    try {
      // robotjs scrolls in discrete wheel clicks (~100px each on Windows);
      // the || fallback preserves sign for sub-100px requests (0 rounds to 0,
      // which would silently no-op a small scroll).
      const amount = Math.round(pixels / 100) || (pixels > 0 ? 1 : -1);
      robot.scrollMouse(0, amount);
      console.log(`[Scroll] Executed successfully`);
      return { status: "ok", detail: `Scroll ${pixels} vertically.` };
    } catch (err) {
      console.error(`[Scroll] Error:`, err);
      throw err;
    }
  }

  private async hscroll(p: any) {
    if (!robot) {
      throw new Error(`robotjs unavailable - cannot execute hscroll`);
    }
    if (p.coordinate) {
      const [x, y] = this.absoluteXy(p.coordinate);
      console.log(`[HScroll] Moving to (${x}, ${y})`);
      this.moveMouse(x, y);
    }
    const pixels = maybeInt(p.pixels);
    console.log(`[HScroll] Scrolling ${pixels} pixels horizontally`);
    try {
      const amount = Math.round(pixels / 100) || (pixels > 0 ? 1 : -1);
      robot.scrollMouse(amount, 0);
      console.log(`[HScroll] Executed successfully`);
      return { status: "ok", detail: `Scroll ${pixels} horizontally.` };
    } catch (err) {
      console.error(`[HScroll] Error:`, err);
      throw err;
    }
  }

  private async typeAction(p: any) {
    if (!robot) {
      throw new Error(`robotjs unavailable - cannot execute type`);
    }
    if (p.text == null) throw new Error("text is required for action=type.");
    console.log(`[Type] Typing "${String(p.text).substring(0, 50)}"`);
    try {
      robot.typeString(p.text);

      // Update overlay status
      if (this.overlay) {
        this.overlay.setStatus(`Typed: "${String(p.text).substring(0, 30)}"`);
      }

      console.log(`[Type] Executed successfully`);
      return { status: "ok", detail: `Typed "${String(p.text).substring(0, 50)}".` };
    } catch (err) {
      console.error(`[Type] Error:`, err);
      throw err;
    }
  }

  private async keyAction(p: any) {
    if (!robot) {
      throw new Error(`robotjs unavailable - cannot execute key`);
    }
    const keys: string[] = p.keys || [];
    if (!keys.length) throw new Error("keys is required for action=key.");
    console.log(`[Key] Pressing keys ${keys}`);
    try {
      // pressKeys maps model key names to robotjs ones (win→command, ctrl→
      // command for common macOS shortcuts) and applies last-key-as-main,
      // prefix-as-modifiers semantics.
      this.pressKeys(keys);
      console.log(`[Key] Executed successfully`);
      return { status: "ok", detail: `Pressed keys ${keys}.` };
    } catch (err) {
      console.error(`[Key] Error:`, err);
      throw err;
    }
  }

  private async waitAction(p: any) {
    if (p.time == null) throw new Error("time is required for action=wait.");
    await sleep(p.time);
    return { status: "ok", detail: `Waited ${p.time} seconds.` };
  }

  /** hold without explicit hold_time returns immediately with the key/button
   * still physically down — the auto-release timer is the only thing that can
   * un-stick it if the model never sends a matching release action. */
  private async holdAction(p: any) {
    if (!robot) throw new Error("robotjs unavailable");
    const keys: string[] = p.keys || [];
    const holdTime = p.hold_time;
    // AG-SAF-07: cap every hold at MAX_HOLD_MS. Absent/invalid hold_time means
    // "hold indefinitely" for the model — schedule an auto-release instead.
    const clampedHold = Math.min(Number(holdTime) > 0 ? Number(holdTime) : MAX_HOLD_MS, MAX_HOLD_MS);

    const KEY_MAP: Record<string, string> = {
      control: "control", ctrl: "control", alt: "alt", shift: "shift",
      win: "command", command: "command"
    };

    if (p.coordinate) {
      const [x, y] = this.absoluteXy(p.coordinate);
      robot.moveMouse(x, y);
      robot.mouseToggle("down", "left");
      this.heldMouse.add("left");
      console.log(`[Hold] Holding left mouse button at (${x}, ${y})`);
      // AG-SAF-07: always schedule an auto-release so an unbounded hold
      // can never leave the physical mouse button stuck down.
      const autoRelease = setTimeout(() => {
        try { robot.mouseToggle("up", "left"); } catch { /* robot died */ }
        this.heldMouse.delete("left");
      }, clampedHold);
      autoRelease.unref?.();
      if (holdTime) {
        await new Promise(r => setTimeout(r, clampedHold));
        clearTimeout(autoRelease);
        try { robot.mouseToggle("up", "left"); } catch { /* already up */ }
        this.heldMouse.delete("left");
        return { status: "ok", detail: `Held left mouse button for ${clampedHold}ms at (${x}, ${y})` };
      }
      return { status: "ok", detail: `Holding left mouse button at (${x}, ${y}) (auto-release in ${clampedHold}ms)` };
    }

    if (!keys.length) throw new Error("keys or coordinate required for hold");

    for (const k of keys) {
      const key = KEY_MAP[k.toLowerCase()] ?? k.toLowerCase();
      robot.keyToggle(key, "down");
    }

    // AG-SAF-07: same auto-release guarantee for held keys.
    const autoReleaseKeys = setTimeout(() => {
      for (const k of keys) {
        const key = KEY_MAP[k.toLowerCase()] ?? k.toLowerCase();
        try { robot.keyToggle(key, "up"); } catch { /* robot died */ }
      }
    }, clampedHold);
    autoReleaseKeys.unref?.();
    if (holdTime) {
      await new Promise(r => setTimeout(r, clampedHold));
      clearTimeout(autoReleaseKeys);
      for (const k of keys) {
        const key = KEY_MAP[k.toLowerCase()] ?? k.toLowerCase();
        try { robot.keyToggle(key, "up"); } catch { /* already up */ }
      }
      return { status: "ok", detail: `Held keys ${keys} for ${clampedHold}ms` };
    }

    return { status: "ok", detail: `Held keys ${keys} (auto-release in ${clampedHold}ms)` };
  }

  private async releaseAction(p: any) {
    if (!robot) throw new Error("robotjs unavailable");
    const keys: string[] = p.keys || [];

    if (p.coordinate || (!keys.length && !p.keys)) {
      robot.mouseToggle("up", "left");
      this.heldMouse.delete("left");
      return { status: "ok", detail: "Released left mouse button" };
    }

    const KEY_MAP: Record<string, string> = {
      control: "control", ctrl: "control", alt: "alt", shift: "shift",
      win: "command", command: "command"
    };
    for (const k of keys) {
      const key = KEY_MAP[k.toLowerCase()] ?? k.toLowerCase();
      robot.keyToggle(key, "up");
    }
    return { status: "ok", detail: `Released keys ${keys}` };
  }

  private async dragAction(p: any) {
    if (!robot) throw new Error("robotjs unavailable");
    if (!p.start_coordinate || !p.coordinate) {
      throw new Error("start_coordinate and coordinate (target) are required for drag");
    }

    const [sx, sy] = this.absoluteXy(p.start_coordinate);
    const [ex, ey] = this.absoluteXy(p.coordinate);

    console.log(`[Drag] Dragging from (${sx}, ${sy}) to (${ex}, ${ey})`);
    
    try {
      // Throw path releases the button before rethrowing — otherwise a failed
      // drag leaves the OS thinking left-click is still held (poisoning every
      // subsequent user interaction until the next releaseAll).
      robot.moveMouse(sx, sy);
      robot.mouseToggle("down", "left");
      await new Promise(r => setTimeout(r, 200)); // Small pause to ensure drag is registered
      robot.dragMouse(ex, ey);
      robot.mouseToggle("up", "left");
      return { status: "ok", detail: `Dragged from (${sx}, ${sy}) to (${ex}, ${ey})` };
    } catch (err) {
      console.error(`[Drag] Error:`, err);
      robot.mouseToggle("up", "left"); // Safety release
      throw err;
    }
  }

  private async answer(p: any) {
    return { status: "answer", text: p.text || "" };
  }

  private async terminate(p: any) {
    if (p.status !== "success" && p.status !== "failure") {
      throw new Error("status must be success or failure for action=terminate.");
    }
    return { status: "terminate", result: p.status };
  }

  // ── OS automation ────────────────────────────────────────────────────────────

  private moveMouse(x: number, y: number): void {
    if (!robot) {
      console.warn("[Move] robotjs unavailable");
      return;
    }
    try {
      console.log(`[Move] Moving to (${x}, ${y})`);
      robot.moveMouse(x, y);

      // Update overlay cursor position
      if (this.overlay) {
        this.overlay.moveCursor(x, y);
      }

      console.log(`[Move] Successfully moved to (${x}, ${y})`);
    } catch (err) {
      console.error(`[Move] Error moving to (${x}, ${y}):`, err);
      throw err;
    }
  }

  private click(x?: number, y?: number, button: "left" | "right" | "middle" = "left"): void {
    if (!robot) {
      console.warn("[Click] robotjs unavailable");
      return;
    }
    try {
      console.log(`[Click] Clicking ${button} at (${x ?? "current"}, ${y ?? "current"})`);
      if (x !== undefined && y !== undefined) {
        robot.moveMouse(x, y);

        // Update overlay cursor with click animation
        if (this.overlay) {
          this.overlay.moveCursor(x, y, true);
        }
      }
      robot.mouseToggle("down", button);
      robot.mouseToggle("up",   button);
      console.log(`[Click] Successfully clicked ${button}`);
    } catch (err) {
      console.error(`[Click] Error clicking ${button}:`, err);
      throw err;
    }
  }

  private doubleClickAt(x: number, y: number): void {
    if (!robot) {
      console.warn("[DoubleClick] robotjs unavailable");
      return;
    }
    try {
      console.log(`[DoubleClick] Double-clicking at (${x}, ${y})`);
      robot.moveMouse(x, y);
      robot.mouseClick("left", true);
      console.log(`[DoubleClick] Successfully double-clicked`);
    } catch (err) {
      console.error(`[DoubleClick] Error double-clicking:`, err);
      throw err;
    }
  }

  private pressKeys(keys: string[]): void {
    if (!robot) {
      console.warn("[PressKeys] robotjs unavailable");
      return;
    }
    try {
      const KEY_MAP: Record<string, string> = {
        control: "control", ctrl: "control",
        alt: "alt", shift: "shift",
        // In robotjs (macOS, Windows, Linux), the OS meta/Win/Cmd key is 'command'
        win: "command", windows: "command", super: "command", meta: "command",
        command: "command", cmd: "command",
        enter: "enter", return: "enter",
        escape: "escape", esc: "escape",
        tab: "tab", delete: "delete", del: "delete",
        backspace: "backspace", space: "space",
        up: "up", down: "down", left: "left", right: "right",
        home: "home", end: "end", pageup: "pageup", pagedown: "pagedown",
        f1: "f1", f2: "f2", f3: "f3", f4: "f4", f5: "f5", f6: "f6",
        f7: "f7", f8: "f8", f9: "f9", f10: "f10", f11: "f11", f12: "f12",
        ",": ",", ".": ".", "/": "/", "\\": "\\", ";": ";", "'": "'",
        "-": "-", "=": "=", "[": "[", "]": "]", "`": "`"
      };

      const normalizedKeys = [...keys];
      if (process.platform === "darwin") {
        // macOS remap: models trained on Windows emit ctrl+c/ctrl+v etc., but
        // the same shortcuts on macOS use Cmd — so translate only the common
        // editing shortcuts (other ctrl combos like ctrl+tab stay literal).
        const commandShortcuts = new Set(["c", "v", "a", "x", "z", "f", "t", "w", "n", "s", "r"]);
        if (
          normalizedKeys.length === 2 &&
          (normalizedKeys[0].toLowerCase() === "ctrl" || normalizedKeys[0].toLowerCase() === "control") &&
          commandShortcuts.has(normalizedKeys[1].toLowerCase())
        ) {
          normalizedKeys[0] = "command";
        }
      }

      const parts = normalizedKeys.map(k => KEY_MAP[k.toLowerCase()] ?? k.toLowerCase());
      console.log(`[PressKeys] Pressing keys: ${parts}`);
      if (parts.length === 1) {
        robot.keyTap(parts[0]);
      } else {
        robot.keyTap(parts[parts.length - 1], parts.slice(0, -1));
      }
      console.log(`[PressKeys] Successfully pressed keys`);
    } catch (err) {
      console.error(`[PressKeys] Error pressing keys:`, err);
      throw err;
    }
  }

  // ── Screenshot (inline, no worker thread) ────────────────────────────────────
  // Mirrors Python's _attach_screenshot: capture → draw cursor circle →
  // [LP-10: local VLMs only] resize ≤1024 inside → JPEG q70; cloud VLMs keep
  // full-res webp q75 (physical-pixel capture is intentional for coordinate VLMs).

  private async attachScreenshot(payload: Record<string, any>): Promise<Record<string, any>> {
    // Timestamp + hrtime + random suffix: multiple captures can land in the
    // same second, so a pure timestamp filename would collide/overwrite.
    const imgPath = path.join(this.screenshotDir, `${nowTs()}-${process.hrtime.bigint().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}.png`);

    // 1. Capture via Electron native API
    let rawBuffer: Buffer;
    let monLeft = 0, monTop = 0;

    try {
      const { screen, desktopCapturer } = require("electron");
      const displays = screen.getAllDisplays();
      const d = displays[this.monitorIndex - 1] ?? screen.getPrimaryDisplay();
      monLeft = d.bounds.x;
      monTop  = d.bounds.y;
      
      const scaleFactor = d.scaleFactor || 1;
      // Capture at PHYSICAL pixels: on HiDPI displays (Retina scale 2), a
      // logical-size thumbnail would be upscaled/blurry — real pixels give
      // the VLM crisp text to read coordinates from.
      const physicalWidth = Math.floor(d.size.width * scaleFactor);
      const physicalHeight = Math.floor(d.size.height * scaleFactor);

      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: physicalWidth, height: physicalHeight }
      });
      const source = sources[this.monitorIndex - 1] || sources[0];
      
      if (!source) {
         throw new Error("No displays found via desktopCapturer");
      }
      
      rawBuffer = source.thumbnail.toPNG();
      
      // Async write to disk for history/logs (non-blocking)
      fs.writeFile(imgPath, rawBuffer, (err) => {
         if (err) console.warn("[ComputerUse] Failed to write history screenshot to disk:", err);
      });
    } catch (err) {
      console.error("[ComputerUse] Screenshot failed:", err);
      return { ...payload, status: "error", detail: "Screenshot failed." };
    }

    // 2. Get dimensions from PNG header
    const { width: rawW, height: rawH } = this.pngDimensions(rawBuffer);

    // 3. Cursor position
    const cursor = robot ? robot.getMousePos() : { x: 0, y: 0 };

    // 4. Draw cursor circle (matches Python: red outer ring + yellow inner dot)
    const relX = cursor.x - monLeft;
    const relY = cursor.y - monTop;
    const radius = 18;

    // LP-10 (audit LP-09): local VLMs get a downscaled payload — fit inside
    // 1024×1024, JPEG q70 — before base64. Cloud VLMs keep the full-res path
    // (physical-pixel capture is intentional, see step 1) so this gate uses
    // AIClient.isLocal() and never a reimplemented heuristic.
    const downscale = shouldDownscaleForVlm(this.client);

    let encoded: string;
    let mime = "webp";
    let newW = rawW;
    let newH = rawH;
    if (sharp) {
      try {
        const svgCircle = `
          <svg width="${rawW}" height="${rawH}" xmlns="http://www.w3.org/2000/svg">
            <circle cx="${relX}" cy="${relY}" r="${radius}"
                    fill="none" stroke="red" stroke-width="4"/>
            <circle cx="${relX}" cy="${relY}" r="4" fill="yellow"/>
          </svg>`;
        // LP-10: cursor composite stays BEFORE resize so the circle shrinks
        // with the image and stays aligned with the content it marks.
        let pipeline = sharp(rawBuffer)
          .composite([{ input: Buffer.from(svgCircle), top: 0, left: 0 }]);
        if (downscale) {
          // resolveWithObject gives the OUTPUT dims — the payload the VLM
          // sees — so image_width/height stay consistent with the base64.
          pipeline = pipeline.resize(LOCAL_VLM_MAX_DIM, LOCAL_VLM_MAX_DIM, {
            fit: "inside",          // shrink only — never upscale small displays
            withoutEnlargement: true,
          });
          const { data, info } = await pipeline
            .jpeg({ quality: 70 })
            .toBuffer({ resolveWithObject: true });
          encoded = data.toString("base64");
          mime = "jpeg";
          newW = info.width;
          newH = info.height;
        } else {
          const webp = await pipeline.webp({ quality: 75 }).toBuffer();
          encoded = webp.toString("base64");
        }
      } catch (e) {
        console.warn("[ComputerUse] sharp composite failed, skipping cursor circle:", e);
        encoded = rawBuffer.toString("base64");
        // Composite failed → raw PNG payload; dims unchanged.
        if (downscale) mime = "png";
      }
    } else {
      // LP-10: sharp-less fallback cannot downscale (no decoder available) —
      // rare path (sharp is a packaged dep); keep current raw-PNG behavior.
      encoded = rawBuffer.toString("base64");
      mime = "png";
    }

    // 5. Compute display-scale dims for viewport
    // LP-10: image_width/height reflect the DOWNSCALED image while
    // raw_/display_ keep display truth — absoluteXy maps image→display via
    // these ratios, so coords stay correct only when dims match the payload.

    console.log(`[Screenshot] ${imgPath} cursor=(${cursor.x}, ${cursor.y})${downscale ? ` downscale=${newW}x${newH}` : ""}`);

    this.lastViewport = {
      monitor_left:   monLeft,
      monitor_top:    monTop,
      display_width:  rawW,
      display_height: rawH,
      image_width:    newW,
      image_height:   newH,
      raw_width:      rawW,
      raw_height:     rawH,
    };

    return {
      ...payload,
      // LP-10: mime tracks the actual encoded payload (jpeg=downscaled local,
      // webp=full-res cloud, png=sharp-less/composite-failure fallback).
      screenshot:      `data:image/${mime};base64,${encoded}`,
      screenshot_path: imgPath,
      cursor,
      display:         { width: rawW, height: rawH },
      downscaled_size: { width: newW, height: newH },
    };
  }

  // ── Coordinate transform (identical logic to Python) ─────────────────────────

  /**
   * AG-CORR-16: provider-declared coordinate space. `absoluteXy` previously
   * treated ANY value ≤1000 from "normalized" providers as grid coords, so
   * genuine pixel coordinates ≤1000 (e.g. (835,138) on a small display) were
   * mis-scaled. The provider (adapter metadata) now declares its space:
   *   'grid'    → 0–1000 normalized grid (UI-TARS style)
   *   'pixel'   → genuine pixels (scaled image → display)
   *   undefined → legacy magnitude heuristic (unchanged behavior)
   */
  public declaredCoordinateSpace: 'grid' | 'pixel' | undefined = undefined;

  private absoluteXy(coordinate?: [number, number] | null): [number, number] {
    const [x, y] = ensureXy(coordinate);
    const vp     = this.lastViewport;
    const left   = vp.monitor_left  ?? 0;
    const top    = vp.monitor_top   ?? 0;
    const dw     = vp.display_width  ?? 0;
    const dh     = vp.display_height ?? 0;
    const iw     = vp.image_width;
    const ih     = vp.image_height;

    const isNormalized = this.client && ["everfern", "openrouter", "ollama-cloud", "gemini"].includes(this.client.provider);
    // Fallback flag only (legacy path): when declaredCoordinateSpace is set
    // upstream, isNormalized is ignored — this heuristic remains solely for
    // providers that never declare a space.
    if (!dw || !dh) {
      console.warn("[Coord] Viewport not initialized - using offset-only fallback");
    }

    if (dw && dh) {
      // AG-CORR-16: declared space wins over the magnitude heuristic.
      const useGrid =
        this.declaredCoordinateSpace === 'grid' ||
        (this.declaredCoordinateSpace === undefined && isNormalized && x <= 1000 && y <= 1000);
      if (useGrid) {
        // Normalised 0–1000 coords (UI-TARS raw output via OpenRouter)
        const absX = left + Math.floor((x / 1000) * dw);
        const absY = top  + Math.floor((y / 1000) * dh);
        console.log(`[Coord] rel=(${x},${y}) display=(${dw}x${dh}) offset=(${left},${top}) → abs=(${absX},${absY})`);
        return [absX, absY];
      }
      if (iw && ih) {
        // Pixel coords scaled from image to display
        const absX = left + Math.round(x * dw / iw);
        const absY = top  + Math.round(y * dh / ih);
        console.log(`[Coord] px=(${x},${y}) scale=(${(dw/iw).toFixed(2)},${(dh/ih).toFixed(2)}) → abs=(${absX},${absY})`);
        return [absX, absY];
      }
    }
    console.log(`[Coord] No viewport/scale, using offset only: (${left + x}, ${top + y})`);
    return [left + x, top + y];
  }

  // ── PNG header reader ─────────────────────────────────────────────────────────

  // Read width/height straight from the IHDR header (bytes 16/20) — no image
  // decode needed just to know the capture size. 1080p fallback keeps the
  // pipeline moving on malformed buffers instead of hard-crashing a turn.
  private pngDimensions(buf: Buffer): { width: number; height: number } {
    if (buf.length >= 24 && buf.toString("ascii", 1, 4) === "PNG") {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    return { width: 1920, height: 1080 };
  }
}

// ── ComputerUseAgent ──────────────────────────────────────────────────────────
// Mirrors Python's ComputerUseAgent.run() very closely.

export class ComputerUseAgent {
  private messages: ChatMessage[] = [];
  private baseCount: number;
  public finalAnswer: string | null = null;
  public terminated: string | null = null;
  private lastScreenshot?: string;
  private aborted = false;

  // Game state for tars-test parity. heldKeys mirrors every key physically
  // held down (hold_w etc.) so releaseAll() can un-stick them at abort/turn end.
  private heldKeys = new Set<string>();
  private lastX: number | null = null;
  private lastY: number | null = null;
  private history: string[] = [];

  private REASONER_MODEL = "openai/gpt-5.6-luna";
  private ACTION_MODEL = "bytedance/ui-tars-1.5-7b";

  private planSteps: { description: string; status: 'pending' | 'in_progress' | 'completed' | 'failed' }[] = [];
  private lastActionDescription = "";

  private async generateExecutionPlan(screenshot: string): Promise<void> {
    try {
      console.log("[ComputerUse] Generating GUI execution plan...");
      const planPrompt = `Given the user's high-level task: "${this.task}"
And the current desktop screenshot.
Create a step-by-step checklist of GUI actions (3 to 6 steps) required to complete this task.
Examples of steps:
- Open Start Menu and search for "Spotify"
- Click Spotify search bar and type "Beast"
- Click play button

Return ONLY a numbered list of steps (e.g., "1. Action description"), one per line. Do not include introductory text, markdown code blocks, or comments.`;

      const response = await this.ask(this.model, [
        {
          role: "system",
          content: "You are a professional Windows desktop automation planner."
        },
        {
          role: "user",
          content: [
            { type: "text", text: planPrompt },
            { type: "image_url", image_url: { url: screenshot } }
          ]
        }
      ], 512);

      const lines = response.split('\n').map(l => l.trim()).filter(l => /^\d+\./.test(l));
      if (lines.length > 0) {
        this.planSteps = lines.map(line => {
          const description = line.replace(/^\d+\.\s*/, '');
          return { description, status: 'pending' };
        });
        console.log("[ComputerUse] Plan generated:", this.planSteps);
      } else {
        this.planSteps = [
          { description: `Start execution for: ${this.task}`, status: 'in_progress' },
          { description: "Interact with GUI elements", status: 'pending' },
          { description: "Verify completion and finish", status: 'pending' }
        ];
      }
    } catch (err) {
      console.warn("[ComputerUse] Failed to generate plan:", err);
      this.planSteps = [
        { description: `Interact with desktop to: ${this.task}`, status: 'in_progress' }
      ];
    }
  }

  private getPlanMarkdown(): string {
    const lines: string[] = [];
    lines.push(`# GUI Task Execution Plan`);
    lines.push(`**Goal:** ${this.task}`);
    lines.push("");
    lines.push("## Plan Steps");
    
    this.planSteps.forEach((step) => {
      const bullet = step.status === 'completed' ? '- [x]' : step.status === 'in_progress' ? '- [/]' : '- [ ]';
      const statusSuffix = step.status === 'in_progress' ? ' *(in progress...)*' : '';
      lines.push(`${bullet} ${step.description}${statusSuffix}`);
    });

    if (this.lastActionDescription) {
      lines.push("");
      lines.push("## Latest Action");
      lines.push(`* ${this.lastActionDescription}`);
    }

    return lines.join("\n");
  }

  private updatePlanStatus(currentAction: string): void {
    if (this.planSteps.length === 0) return;
    
    const currentIdx = this.planSteps.findIndex(s => s.status === 'in_progress');
    if (currentIdx !== -1) {
      const nextPendingIdx = this.planSteps.findIndex(s => s.status === 'pending');
      if (nextPendingIdx !== -1) {
        const nextStepText = this.planSteps[nextPendingIdx].description.toLowerCase();
        const actionLower = currentAction.toLowerCase();
        
        const keywords = nextStepText.split(/\s+/).filter(w => w.length > 3);
        const match = keywords.some(k => actionLower.includes(k));
        
        if (match) {
          this.planSteps[currentIdx].status = 'completed';
          this.planSteps[nextPendingIdx].status = 'in_progress';
          return;
        }
      }
    } else {
      this.planSteps[0].status = 'in_progress';
    }
  }

  constructor(
    private client: AIClient,
    private tool: ComputerUseTool,
    private model: string,
    private task: string,
    private temperature  = 0,
    private maxTurns     = 200,
    private historyWindow = 12,
    private toolCallId   = "",
  ) {
    // Clamp to >=1: a 0/negative window would slice to an empty prompt.
    this.historyWindow = Math.max(1, historyWindow);
    this.messages  = [{ role: "system", content: SYSTEM_PROMPT }];
    this.baseCount = this.messages.length;
  }

  public abort(): void {
    this.aborted = true;
    this.terminated = "aborted";
    // AG-CORR-06: release any held keys so an aborted turn doesn't leave the
    // keyboard stuck (e.g. W held in a game loop).
    try { void this.releaseAll(); } catch (err) {
      console.warn("[ComputerUse] releaseAll during abort failed:", err);
    }
    this.tool.overlay?.hide();
  }

  /** AG-CORR-08: exposed so mid-dispatch abort checks don't poke privates. */
  public isAborted(): boolean {
    return this.aborted;
  }

  private async getScreenshotBase64(): Promise<string> {
    const obs = await this.tool.captureObservation();
    this.lastScreenshot = obs.screenshot;
    return obs.screenshot;
  }

  private async ask(model: string, messages: any[], maxTokens = 8192): Promise<string> {
    const response = await this.client.chat({
      model,
      messages,
      temperature: 0.1,
      maxTokens: maxTokens,
    });
    return (response.content as string) || "";
  }

  /** AG-CORR-06/AG-SAF-07: public so the tool's turn-end finally can call it.
   * Physical keyToggle("up") is mandatory: abort() only flips flags, but the
   * OS keyboard still has the key down — without this, a stuck modifier (e.g.
   * W in a game loop, or shift) keeps firing into whatever the user types next. */
  async releaseAll(): Promise<void> {
    for (const rawKey of Array.from(this.heldKeys)) {
      const key = rawKey.toLowerCase();
      const mapped =
        key === "win" || key === "windows" || key === "super" || key === "meta" || key === "cmd" || key === "command"
          ? (process.platform === "win32" ? "win" : "command")
          : key;
      try {
        if (robot) {
          await robot.keyToggle(mapped, "up");
        }
      } catch (err) {
        console.warn(`[ComputerUse] releaseAll: failed to release '${mapped}':`, err);
      }
    }
    this.heldKeys.clear();
    // AG-SAF-07: also release any held mouse buttons (keyboard-only release
    // left physical buttons stuck after an aborted mouse hold).
    try {
      this.tool.releaseHeldMouse();
    } catch (err) {
      console.warn(`[ComputerUse] releaseAll: failed to release held mouse:`, err);
    }
    // Resetting last coords makes the next turn re-anchor cursor state
    // instead of trusting positions from the aborted session.
    this.lastX = null;
    this.lastY = null;
  }

  async run(
    onUpdate?:   (msg: string) => void,
    onProgress?: (event: SubAgentProgressEvent) => void,
  ): Promise<{ finalAnswer: string; lastScreenshot?: string }> {

    const isGemini = this.client.provider === "gemini" || this.model.toLowerCase().includes("gemini");
    const isOpenAI = this.client.provider === "openai" || this.model.toLowerCase().includes("gpt") || this.model.toLowerCase().includes("openai") || this.model.toLowerCase().includes("o1") || this.model.toLowerCase().includes("o3") || this.model.toLowerCase().includes("computer-use");
    const isAnthropic = this.client.provider === "anthropic" || this.model.toLowerCase().includes("claude") || this.model.toLowerCase().includes("anthropic");
    const isGpt5 = isOpenAI;
    const useToolCallRunner = isGemini || isOpenAI || isAnthropic;

    if (useToolCallRunner) {
      if (isGemini) {
        // Validate model is supported for Gemini Computer Use
        const isSupported = this.model.includes('computer-use') || 
                            this.model.includes('gemini-3-flash-preview') || 
                            this.model.includes('gemini-3-flash') ||
                            this.model.includes('gemini-2.5-flash');
        if (!isSupported) {
          throw new Error(`Google Gemini Computer Use is not supported on "${this.model}". Supported: gemini-2.5-flash, gemini-3-flash-preview.`);
        }
      }

      const agentName = isAnthropic ? "Claude" : isOpenAI ? "OpenAI" : isGemini ? "Gemini" : "VLM";
      const systemPrompt = isAnthropic ? CLAUDE_COMPUTER_USE_PROMPT : isGpt5 ? GPT5_SYSTEM_PROMPT : GEMINI_SYSTEM_PROMPT;
      // Token budget: Claude / OpenAI action turns
      const maxTokensPerTurn = isAnthropic ? 2048 : isOpenAI ? 1024 : undefined;

      let step = 0;
      onUpdate?.(`Starting ${agentName} Computer Use runner...`);

      this.messages = [];
      if (systemPrompt) {
        this.messages.push({ role: "system", content: systemPrompt });
      }

      const firstImg = await this.getScreenshotBase64();
      await this.generateExecutionPlan(firstImg);
      onProgress?.({
        type: "screenshot",
        toolCallId: this.toolCallId,
        timestamp: new Date().toISOString(),
        stepNumber: 0,
        screenshot: {
          base64: firstImg?.split(",")?.[1] || "",
          width: 1920,
          height: 1080
        },
        navisReport: this.getPlanMarkdown()
      } as any);

      this.messages.push({
        role: "user",
        content: [
          { type: "text" as const, text: `Task: ${this.task}` },
          { type: "image_url" as const, image_url: { url: firstImg } }
        ]
      });

      let consecutiveErrors = 0;
      while (step <= this.maxTurns) {
        if (this.aborted || globalAbortManager.streamAborted) break;
        step++;

        console.log(`\n[${agentName} Agent] Step ${step}/${this.maxTurns}`);
        onUpdate?.(`Turn ${step}/${this.maxTurns}...`);

        let chatResponse;
        try {
          chatResponse = await this.client.chat({
            messages: this.messages,
            model: this.model,
            temperature: 0.1,
            ...(maxTokensPerTurn ? { maxTokens: maxTokensPerTurn } : {}),
          });
          consecutiveErrors = 0;
        } catch (err: any) {
          console.error(`[${agentName} Agent] API error:`, err);
          consecutiveErrors++;
          if (consecutiveErrors >= 3) {
            this.finalAnswer = `Unable to reach VLM provider. Please verify that the API endpoint is running and reachable. Error: ${err.message || err}`;
            break;
          }
          if (step === this.maxTurns) break;
          await sleepMs(500);
          continue;
        }

        const content = typeof chatResponse.content === "string" ? chatResponse.content : "";
        const toolCalls = chatResponse.toolCalls || [];

        console.log(`[${agentName} Agent] Content: ${content}`);
        console.log(`[${agentName} Agent] Tool Calls:`, JSON.stringify(toolCalls));

        if (content) {
          this.lastActionDescription = content;
          this.updatePlanStatus(content);
          onProgress?.({
            type: "reasoning",
            toolCallId: this.toolCallId,
            timestamp: new Date().toISOString(),
            stepNumber: step,
            content: content,
            navisReport: this.getPlanMarkdown()
          } as any);
        }

        this.messages.push({
          role: "assistant" as const,
          content: content,
          tool_calls: toolCalls
        });

        if (toolCalls.length === 0) {
          console.log(`[${agentName} Agent] No tool calls, task finished.`);
          this.finalAnswer = content || "Task finished.";
          break;
        }

        // Check safety decision / user confirmation requirement
        const safetyDecision = chatResponse.safetyDecision as any;
        // AG-SAF-11: heuristic backstop — the model may omit/fabricate
        // safetyDecision, so independently scan the task, the model's stated
        // intent, and the queued action names/args for destructive verbs.
        const heuristicHit = looksDestructive([
          this.task,
          content,
          ...toolCalls.map((tc: any) => tc?.name),
          ...toolCalls.map((tc: any) => {
            try { return typeof tc?.arguments === 'object' ? JSON.stringify(tc.arguments) : String(tc?.arguments ?? ''); }
            catch { return ''; }
          }),
        ]);
        const requiresConfirmation = heuristicHit || (safetyDecision && (
          safetyDecision === 'require_confirmation' ||
          safetyDecision === 'OFF-NOMINAL' ||
          (typeof safetyDecision === 'object' && (
            safetyDecision.decision === 'require_confirmation' ||
            safetyDecision.decision === 'OFF-NOMINAL'
          ))
        ));

        let userConfirmed = true; // only meaningful when requiresConfirmation
        if (requiresConfirmation) {
          console.log(`[${agentName} Agent] Action requires confirmation${heuristicHit ? ' (destructive heuristic)' : ''}. Prompting user...`);
          onUpdate?.("⚠️ Action requires security confirmation...");
          try {
            const { dialog, BrowserWindow } = require("electron");
            const win = BrowserWindow.getAllWindows()[0];
            const explanation = heuristicHit
              ? `\n\nExplanation: The action text matches a destructive-action pattern (e.g. delete/format/uninstall).`
              : typeof safetyDecision === 'object' && (safetyDecision as any).explanation
              ? `\n\nExplanation: ${(safetyDecision as any).explanation}`
              : "";
            const dialogResponse = await dialog.showMessageBox(win || undefined, {
              type: "warning",
              title: "EverFern Security Authorization",
              message: `${agentName} has requested an action that requires your confirmation.${explanation}\n\nDo you want to authorize this action?`,
              buttons: ["Approve", "Deny"],
              defaultId: 0,
              cancelId: 1
            });
            userConfirmed = dialogResponse.response === 0;
            console.log(`[${agentName} Agent] User confirmation result: ${userConfirmed ? "Approved" : "Denied"}`);
          } catch (dialogErr) {
            console.error(`[${agentName} Agent] Failed to show confirmation dialog:`, dialogErr);
            userConfirmed = false;
          }
        }

        const results = [];
        for (const tc of toolCalls) {
          if (this.aborted || globalAbortManager.streamAborted) break;
          
          console.log(`  Executing ${agentName} Action: ${tc.name}`);
          onUpdate?.(`Executing action ${tc.name}...`);

          onProgress?.({
            type: "action",
            toolCallId: this.toolCallId,
            timestamp: new Date().toISOString(),
            stepNumber: step,
            action: { type: tc.name, params: tc.arguments, description: tc.name },
            navisReport: this.getPlanMarkdown()
          } as any);

          let actionResult: Record<string, any> = { status: "success", error: undefined as string | undefined };
          if (!userConfirmed) {
            actionResult = { status: "error", error: "User denied confirmation for this action." };
          } else {
            try {
              const fname = tc.name;
              const args = (tc.arguments || {}) as Record<string, any>;

            if (fname === "computer_use" || fname === "computer" || fname === "computer_20241022") {
              await this.tool.call(args);
            } else if (fname === "open_web_browser") {
              // noop
            } else if (fname === "wait_5_seconds") {
              await this.tool.call({ action: "wait", time: 5 });
            } else if (fname === "go_back") {
              await this.tool.call({ action: "key", keys: ["alt", "left"] });
            } else if (fname === "go_forward") {
              await this.tool.call({ action: "key", keys: ["alt", "right"] });
            } else if (fname === "search") {
              const { shell } = require("electron");
              // AG-SAF-06: only http(s) may reach shell.openExternal.
              if (!isSafeExternalUrl("https://www.google.com")) {
                actionResult = { status: "error", error: "Blocked non-http(s) URL: " + "https://www.google.com".slice(0, 120) };
              } else {
                await shell.openExternal("https://www.google.com");
                await sleep(2);
              }
            } else if (fname === "navigate") {
              const { shell } = require("electron");
              // AG-SAF-06: model-provided URL — validate protocol fail-closed.
              if (!isSafeExternalUrl(args.url)) {
                actionResult = { status: "error", error: "Blocked non-http(s) URL: " + String(args.url).slice(0, 120) };
              } else {
                await shell.openExternal(args.url);
                await sleep(2);
              }
            } else if (fname === "click_at" || fname === "left_click" || fname === "click") {
              const coord = args.coordinate || (args.x != null && args.y != null ? [args.x, args.y] : undefined);
              if (coord) {
                await this.tool.call({ action: "left_click", coordinate: coord });
              } else {
                await this.tool.call({ action: "left_click", ...args });
              }
            } else if (fname === "right_click" || fname === "right_single") {
              const coord = args.coordinate || (args.x != null && args.y != null ? [args.x, args.y] : undefined);
              if (coord) {
                await this.tool.call({ action: "right_click", coordinate: coord });
              } else {
                await this.tool.call({ action: "right_click", ...args });
              }
            } else if (fname === "double_click" || fname === "left_double") {
              const coord = args.coordinate || (args.x != null && args.y != null ? [args.x, args.y] : undefined);
              if (coord) {
                await this.tool.call({ action: "double_click", coordinate: coord });
              } else {
                await this.tool.call({ action: "double_click", ...args });
              }
            } else if (fname === "hover_at" || fname === "mouse_move" || fname === "move") {
              const coord = args.coordinate || (args.x != null && args.y != null ? [args.x, args.y] : undefined);
              if (coord) {
                await this.tool.call({ action: "mouse_move", coordinate: coord });
              } else {
                await this.tool.call({ action: "mouse_move", ...args });
              }
            } else if (fname === "type_text_at") {
              if (args.x != null && args.y != null && args.text != null) {
                await this.tool.call({ action: "left_click", coordinate: [args.x, args.y] });
                await sleep(0.5);
                const clear = args.clear_before_typing !== false;
                if (clear) {
                  const isMac = process.platform === "darwin";
                  const selectAllKey = isMac ? ["command", "a"] : ["control", "a"];
                  await this.tool.call({ action: "key", keys: selectAllKey });
                  await this.tool.call({ action: "key", keys: ["backspace"] });
                  await sleep(0.2);
                }
                await this.tool.call({ action: "type", text: args.text });
                const enter = args.press_enter !== false;
                if (enter) {
                  await sleep(0.2);
                  await this.tool.call({ action: "key", keys: ["enter"] });
                }
              } else {
                throw new Error("x, y, and text are required for type_text_at");
              }
            } else if (fname === "type") {
              await this.tool.call({ action: "type", text: args.text || args.content || "" });
            } else if (fname === "key_combination" || fname === "hotkey" || fname === "key" || fname === "press") {
              if (args.keys) {
                const keysList = Array.isArray(args.keys) ? args.keys : String(args.keys).toLowerCase().split("+");
                await this.tool.call({ action: "key", keys: keysList });
              } else if (args.key) {
                const keysList = String(args.key).toLowerCase().split("+");
                await this.tool.call({ action: "key", keys: keysList });
              } else {
                throw new Error("keys is required for key_combination");
              }
            } else if (fname === "scroll_document") {
              const dir = typeof args.direction === "string" ? args.direction.toLowerCase() : "down";
              if (dir === "up" || dir === "down") {
                await this.tool.call({ action: "scroll", pixels: dir === "up" ? 500 : -500 });
              } else {
                await this.tool.call({ action: "hscroll", pixels: dir === "left" ? 500 : -500 });
              }
            } else if (fname === "scroll_at" || fname === "scroll") {
              if (args.x != null && args.y != null) {
                await this.tool.call({ action: "mouse_move", coordinate: [args.x, args.y] });
                await sleep(0.2);
              }
              const dir = typeof args.direction === "string" ? args.direction.toLowerCase() : "down";
              const mag = args.magnitude != null ? Number(args.magnitude) : (args.pixels != null ? Number(args.pixels) : 800);
              if (dir === "up" || dir === "down") {
                await this.tool.call({ action: "scroll", pixels: dir === "up" ? mag : -mag });
              } else {
                await this.tool.call({ action: "hscroll", pixels: dir === "left" ? mag : -mag });
              }
            } else if (fname === "drag_and_drop" || fname === "drag") {
              const start = args.start_coordinate || (args.x != null && args.y != null ? [args.x, args.y] : undefined);
              const dest = args.coordinate || (args.destination_x != null && args.destination_y != null ? [args.destination_x, args.destination_y] : undefined);
              if (start && dest) {
                await this.tool.call({
                  action: "drag",
                  start_coordinate: start,
                  coordinate: dest
                });
              } else {
                throw new Error("start and destination coordinates are required for drag");
              }
            } else if (fname === "terminate" || fname === "finished" || fname === "done") {
              this.terminated = args.status || "success";
            } else {
              console.warn(`Warning: Unimplemented or custom function ${fname}`);
              actionResult = { status: "error", error: `Unimplemented function ${fname}` };
            }
          } catch (e: any) {
            console.error(`Error executing ${tc.name}:`, e);
            actionResult = { status: "error", error: e.message || String(e) };
          }
        }

        if (requiresConfirmation && userConfirmed) {
          actionResult.safety_acknowledgement = true;
        }

        results.push({ name: tc.name, result: actionResult });
        await waitForScreenSettle();
      }

        const newImg = await this.getScreenshotBase64();
        onProgress?.({
          type: "screenshot",
          toolCallId: this.toolCallId,
          timestamp: new Date().toISOString(),
          stepNumber: step,
          screenshot: {
            base64: newImg?.split(",")?.[1] || "",
            width: 1920,
            height: 1080
          },
          navisReport: this.getPlanMarkdown()
        } as any);

        const toolParts = results.map((r, i) => {
          const tcId = toolCalls[i]?.id || ('tc-' + step + '-' + i);
          return {
            role: "tool" as const,
            tool_call_id: tcId,
            tool_name: r.name,
            content: [
              { type: "text" as const, text: JSON.stringify(r.result) }
            ]
          };
        });

        if (toolParts.length > 0) {
          const lastPart = toolParts[toolParts.length - 1];
          if (Array.isArray(lastPart.content)) {
            (lastPart.content as any[]).push({ type: "image_url", image_url: { url: newImg } });
          }
        }

        for (const tp of toolParts) {
          this.messages.push(tp);
        }
        this.trimMessages(); // AG-MEM-03: bound history growth each step

        await waitForScreenSettle();
      }

      return {
        finalAnswer: this.finalAnswer || `Task ended: ${this.terminated || "unknown"}`,
        lastScreenshot: this.lastScreenshot,
      };
    }

    const isTars = ["everfern", "openrouter", "ollama-cloud"].includes(this.client.provider);

    if (isTars) {
      let step = 0;
      const history: any[] = [];
      let noActionRetries = 0;
      let badFormatCount = 0;
      let lastActionSig: string | null = null;
      let stuckCount = 0;

      const MAX_BAD_FORMAT = 3;
      const MAX_STUCK = 3;

      while (step <= this.maxTurns) {
        if (this.aborted || globalAbortManager.streamAborted) break;
        step++;

        console.log(`\n[UI-TARS Agent] Step ${step}/${this.maxTurns}`);
        onUpdate?.(`Turn ${step}/${this.maxTurns}...`);

        const img = await this.getScreenshotBase64();
        onProgress?.({
          type: "screenshot",
          toolCallId: this.toolCallId,
          timestamp: new Date().toISOString(),
          stepNumber: step,
          screenshot: {
            base64: img?.split(",")?.[1] || "",
            width: 1920,
            height: 1080
          }
        } as any);

        const histLines: string[] = [];
        // Same windowing rationale as historyWindow: only the last 6 steps
        // enter the per-turn prompt; the VLM screenshot carries current state,
        // and older steps cost tokens without improving the next decision.
        const startIdx = Math.max(0, history.length - 6);
        for (let i = startIdx; i < history.length; i++) {
          const h = history[i];
          histLines.push(`Step ${i + 1}:`);
          histLines.push(`  Thought: ${h.thought}`);
          histLines.push(`  Action : ${h.actions && h.actions.length ? h.actions.join("; ") : "(none)"}`);
        }
        const historyText = histLines.join("\n") || "No actions taken yet.";

        const cursor = robot ? robot.getMousePos() : { x: 0, y: 0 };
        const vp = this.tool.lastViewport;
        const dw = vp.display_width || 1920;
        const dh = vp.display_height || 1080;
        // Report cursor in the SAME 0–1000 normalized grid the model outputs —
        // mixing coordinate spaces between input and output confuses grounding.
        const norm_x = Math.round((cursor.x / dw) * 1000);
        const norm_y = Math.round((cursor.y / dh) * 1000);

        const isFinalTurn = step > this.maxTurns;
        let finalTurnPrompt = "";
        if (isFinalTurn) {
          console.log(`[ComputerUse] 🚨 Max turns (${this.maxTurns}) reached. FORCING FINAL ANSWER STEP.`);
          finalTurnPrompt = `\n\n[URGENT: FINAL TURN]: You have reached the maximum turn limit. DO NOT take any more actions. Instead, provide the FINAL ANSWER to the user now. Use the 'finished()' action.`;
        }

        const userText = `Task: ${this.task}\n\n` +
          `Current Cursor Position: (${norm_x}, ${norm_y}) normalized\n\n` +
          `Action History:\n${historyText}\n\n` +
          `Current Screenshot:${finalTurnPrompt}`;

        // Use the VLM model alias; fall back if model is a plain chat alias like "fern-1"/"everfern-1"
        const CHAT_ONLY_ALIASES = new Set(["fern-1", "everfern-1", "fern"]);
        const modelName = this.client.provider === "everfern"
          ? (this.model && !CHAT_ONLY_ALIASES.has(this.model) ? this.model : "everfern-tars-v1")
          : (this.model || "everfern-tars-v1");

        console.log("[ComputerUse] Querying UI-TARS model...");
        let rawResponse = "";
        let chatResponse: any = null;
        try {
          chatResponse = await this.client.chat({
            messages: [
              { role: "system", content: SYSTEM_PROMPT },
              {
                role: "user",
                content: [
                  { type: "text", text: userText },
                  { type: "image_url", image_url: { url: img } }
                ]
              }
            ],
            model: modelName,
            temperature: 0.1,
            maxTokens: 2048,
          });
          rawResponse = (chatResponse.content as string) || "";
        } catch (err: any) {
          console.error("[ComputerUse] API error:", err);
          if (step === this.maxTurns) break;
          await sleepMs(500);
          continue;
        }

        console.log(`\n[RAW OUTPUT]\n${rawResponse}\n`);

        let cleanResponse = stripThinking(rawResponse);
        const trimmedLower = cleanResponse.toLowerCase().trim();
        if (trimmedLower === "done" || trimmedLower === "done()" || trimmedLower === "finished" || trimmedLower === "finished()") {
          console.log("\n[TASK COMPLETE — done/finished received]");
          this.finalAnswer = "Task finished successfully";
          break;
        }
        let { thought, actions } = parseOutput(cleanResponse);

        const responseToolCalls = (chatResponse as any).toolCalls || [];
        if (responseToolCalls.length > 0) {
          for (const tc of responseToolCalls) {
            if (tc.name === "computer_use" && tc.arguments) {
              const tcArgs = typeof tc.arguments === "string" ? JSON.parse(tc.arguments) : tc.arguments;
              if (tcArgs.action === "execute_actions" && Array.isArray(tcArgs.actions)) {
                actions = tcArgs.actions;
                break;
              }
            }
          }
        }

        console.log(`[THOUGHT] ${thought}`);
        console.log(`[ACTIONS] ${actions}`);

        if (thought) {
          onProgress?.({
            type: "reasoning",
            toolCallId: this.toolCallId,
            timestamp: new Date().toISOString(),
            stepNumber: step,
            content: thought
          });
        }

        if (actions.length > 0 && !isStructuredAction(actions[0])) {
          badFormatCount++;
          console.log(`[FORMAT ERROR #${badFormatCount}] Model returned natural language action.`);

          if (badFormatCount >= MAX_BAD_FORMAT) {
            console.log("[ABORT] Model repeatedly ignored format instructions. Exiting.");
            break;
          }

          const correctionText = `Task: ${this.task}\n\n` +
            `Current Cursor Position: (${norm_x}, ${norm_y}) normalized\n\n` +
            `Action History:\n${historyText}\n\n` +
            `${FORMAT_CORRECTION}`;

          console.log("[ComputerUse] Sending format correction prompt...");
          try {
            const correctionResponse = await this.client.chat({
              messages: [
                { role: "system", content: SYSTEM_PROMPT },
                {
                  role: "user",
                  content: [
                    { type: "text", text: correctionText }
                  ]
                }
              ],
              model: modelName,
              temperature: 0.1,
              maxTokens: 512,
            });
            const raw2 = (correctionResponse.content as string) || "";
            console.log(`[CORRECTION RAW]\n${raw2}\n`);
            const parsedCorr = parseOutput(stripThinking(raw2));
            thought = parsedCorr.thought;
            actions = parsedCorr.actions;

            const corrToolCalls = (correctionResponse as any).toolCalls || [];
            if (corrToolCalls.length > 0) {
              for (const tc of corrToolCalls) {
                if (tc.name === "computer_use" && tc.arguments) {
                  const tcArgs = typeof tc.arguments === "string" ? JSON.parse(tc.arguments) : tc.arguments;
                  if (tcArgs.action === "execute_actions" && Array.isArray(tcArgs.actions)) {
                    actions = tcArgs.actions;
                    break;
                  }
                }
              }
            }

            console.log(`[CORRECTED THOUGHT] ${thought}`);
            console.log(`[CORRECTED ACTIONS] ${actions}`);
          } catch (err) {
            console.error(`[ERROR] Correction API call failed: ${err}`);
            await sleep(2);
            continue;
          }

          if (actions.length === 0 || !isStructuredAction(actions[0])) {
            console.log("[WARN] Correction also failed — skipping step.");
            history.push({ thought, actions: [], screenshot: img });
            trimHistory(history);
            await waitForScreenSettle();
            continue;
          } else {
            badFormatCount = 0;
          }
        } else {
          badFormatCount = 0;
        }

        if (actions.length === 0) {
          console.log("[WARN] No actions parsed — skipping step.");
          history.push({ thought, actions: [], screenshot: img });
          trimHistory(history);
          await waitForScreenSettle();
          continue;
        }

        // AG-SAF-11: text-action loop bypasses the toolCall safetyDecision gate
        // — run the destructive heuristic over thought + queued actions.
        if (!(await this.confirmDestructive([thought, ...actions], onUpdate))) {
          console.log("  [EXEC] destructive actions denied by user — skipping step");
          history.push({ thought, actions: [], screenshot: img });
          trimHistory(history);
          continue;
        }

        let done = false;
        const dispatched: string[] = [];

        for (const act of actions) {
          console.log(`  [EXEC] ${act}`);
          onUpdate?.(`Executing ${act}...`);

          onProgress?.({
            type: "action",
            toolCallId: this.toolCallId,
            timestamp: new Date().toISOString(),
            stepNumber: step,
            action: { type: act, params: {}, description: act },
          });

          const result = await this.dispatchAction(act);
          if (result === "__bad_format__") {
            break;
          }
          dispatched.push(act);
          if (result === "__done__") {
            done = true;
            break;
          }

          // Action-aware settle: slow UI transitions need more time, but exit early once the screen settles
          if (/hotkey.*key=.*win/i.test(act) || /hotkey.*key=.*super/i.test(act)) {
            // Start Menu takes 600-900ms to animate open
            await waitForScreenSettle(150, 1500);
          } else if (/hotkey/i.test(act)) {
            await waitForScreenSettle(150, 800);
          } else if (/left_double|double_click/i.test(act)) {
            // App launch via double-click can be slow
            await waitForScreenSettle(150, 1500);
          } else {
            await waitForScreenSettle(120, 400);
          }
        }

        history.push({ thought, actions: dispatched, screenshot: img });
        trimHistory(history);

        if (done) {
          console.log("\n[TASK COMPLETE — finished() called]");
          this.finalAnswer = "Task finished successfully via finished()";
          break;
        }

        // Stuck detection on the exact action signature: identical repeats
        // mean the model is looping on an unchanging screen (a modal/menu is
        // probably blocking); recovery click dismisses it rather than burning
        // more turns on the same failed action.
        const sig = actions.join("|");
        if (sig === lastActionSig) {
          stuckCount++;
        } else {
          stuckCount = 0;
        }
        lastActionSig = sig;

        if (stuckCount >= MAX_STUCK) {
          console.log(`\n[STUCK] Same actions repeated ${MAX_STUCK}x — trying recovery (click desktop + wait)...`);
          stuckCount = 0;
          lastActionSig = null; // reset so next different action isn't double-counted
          // Click center of the active monitor (AG-CORR-19: real viewport center,
          // not hardcoded (500,500)) to dismiss any stuck menu, then wait.
          if (robot) {
            const vp = this.tool.lastViewport || {};
            const cx = Math.floor((vp.monitor_left ?? 0) + (vp.display_width ?? 1000) / 2);
            const cy = Math.floor((vp.monitor_top ?? 0) + (vp.display_height ?? 1000) / 2);
            const pos = robot.getMousePos();
            robot.moveMouse(cx, cy);
            robot.mouseClick();
            robot.moveMouse(pos.x, pos.y); // restore
          }
          await sleep(2);
        }

        // Give the screen extra time to settle between steps
        await waitForScreenSettle();
      }

      return {
        finalAnswer: this.finalAnswer ?? `Task ended: ${this.terminated ?? "unknown"}`,
        lastScreenshot: this.lastScreenshot,
      };
    } else {
      // Original execution loop
      let step = 0;
      const history: any[] = [];
      let noActionRetries = 0;
      let consecutiveErrors = 0;

      while (step <= this.maxTurns) {
        if (this.aborted || globalAbortManager.streamAborted) break;
        step++;

        console.log(`\n[Dumb-Agent] Step ${step}/${this.maxTurns}`);
        onUpdate?.(`Turn ${step}/${this.maxTurns}...`);

        const img = await this.getScreenshotBase64();
        onProgress?.({
          type: "screenshot",
          toolCallId: this.toolCallId,
          timestamp: new Date().toISOString(),
          stepNumber: step,
          screenshot: {
            base64: img?.split(",")?.[1] || "",
            width: 1920,
            height: 1080
          }
        } as any);

        const isFinalTurn = step > this.maxTurns;
        let finalTurnPrompt = "";
        if (isFinalTurn) {
          console.log(`[ComputerUse] 🚨 Max turns (${this.maxTurns}) reached. FORCING FINAL ANSWER STEP.`);
          finalTurnPrompt = `\n\n[URGENT: FINAL TURN]: You have reached the maximum turn limit. DO NOT take any more actions (no click, type, etc.). Instead, provide the FINAL ANSWER to the user now. Use the 'answer' action or simply state your final summary.`;
        }

        let response: any;
        try {
          const brainHand = await this.runBrainHandTurn(img, step, finalTurnPrompt);
          if (brainHand) {
            const { instruction, actions } = brainHand;
            if (instruction) {
              console.log(`[Dumb-Agent] Brain: ${instruction}`);
              onProgress?.({ type: "reasoning", toolCallId: this.toolCallId, timestamp: new Date().toISOString(), stepNumber: step, content: instruction });
            }

            if (/\bdone\b/i.test(instruction)) {
              this.finalAnswer = "Task completed.";
              break;
            }

            if (actions.length) {
              console.log(`[Dumb-Agent] Hand: ${actions.join(", ")}`);
              await this.dispatchAll(actions, onUpdate, onProgress, step);
              this.history.push(`${instruction} -> ${actions.join(", ")}`);
              // Keep only the last historyWindow entries — the prompt already
              // carries full screenshots; older action lines cost tokens without
              // adding decision-relevant context.
              if (this.history.length > this.historyWindow) this.history = this.history.slice(-this.historyWindow);
              consecutiveErrors = 0;
              if (this.terminated || this.finalAnswer) break;
              await waitForScreenSettle();
              continue;
            }

            noActionRetries++;
            if (noActionRetries <= 2 && !isFinalTurn) {
              console.warn(`[Dumb-Agent] Brain/HAND produced no executable action; retrying (${noActionRetries}/2)`);
              await waitForScreenSettle();
              consecutiveErrors = 0;
              continue;
            }
            console.warn("[Dumb-Agent] No actions received from brain/hand path");
            break;
          }

          const modelName = this.client.provider === "everfern"
            ? "everfern-tars-v1"
            : (this.model || "everfern-tars-v1");
          const actionReminder = noActionRetries > 0
            ? "\n\nYour previous response did not contain an executable action. This time output ONLY a computer_use tool call or a compact action JSON with coordinates."
            : "";

          response = await this.client.chat({
            messages: [
              { role: "system", content: SYSTEM_PROMPT },
              {
                role: "user",
                content: [
                  { type: "text", text: `${COMPUTER_USE_OUTPUT_INSTRUCTIONS}\n\nTask: ${this.task}\nStep: ${step}${finalTurnPrompt}${actionReminder}` },
                  { type: "image_url", image_url: { url: img } }
                ]
              }
            ],
            model: modelName,
            temperature: 0.1,
            tools: [COMPUTER_USE_ACTION_TOOL],
            toolChoice: isFinalTurn ? "auto" : "required",
          });
          consecutiveErrors = 0;
        } catch (err: any) {
          console.error("[Dumb-Agent] API error:", err);
          consecutiveErrors++;
          if (consecutiveErrors >= 3) {
            this.finalAnswer = `Unable to reach VLM provider. Please verify that the API endpoint is running and reachable. Error: ${err.message || err}`;
            break;
          }
          if (step === this.maxTurns) break;
          continue;
        }

        const content: string = typeof response.content === "string" ? response.content : "";
        if (content) {
          console.log(`[Dumb-Agent] Brain: ${content}`);
          onProgress?.({ type: "reasoning", toolCallId: this.toolCallId, timestamp: new Date().toISOString(), stepNumber: step, content });
        }

        const toolCalls: any[] = response.toolCalls || [];
        if (!toolCalls.length) {
          const textActions = this.parseModelOutput(content);
          if (textActions.length) {
            console.log(`[Dumb-Agent] Parsed ${textActions.length} text action(s) from model output`);
            await this.dispatchAll(textActions, onUpdate, onProgress, step);
            noActionRetries = 0;
            if (this.terminated || this.finalAnswer) break;
            await waitForScreenSettle();
            continue;
          }

          if (content.toLowerCase().includes("done") || content.toLowerCase().includes("complete")) {
             this.finalAnswer = content;
             break;
          }
          noActionRetries++;
          if (noActionRetries <= 2 && !isFinalTurn) {
            console.warn(`[Dumb-Agent] No executable action received from API; retrying with stricter instruction (${noActionRetries}/2)`);
            await waitForScreenSettle();
            continue;
          }
          console.warn("[Dumb-Agent] No actions received from API");
          break;
        }
        noActionRetries = 0;

        for (const toolCall of toolCalls) {
          let args: any;
          try {
            args = typeof toolCall.arguments === "string" ? JSON.parse(toolCall.arguments) : toolCall.arguments;
          } catch { continue; }

          console.log(`[Dumb-Agent] ▶ ${args.action}`);
          onUpdate?.(`Executing ${args.action}...`);

          try {
            const result = await this.tool.call(args);
            const pl     = result.payload;

            if (pl.status === "answer") {
              this.finalAnswer = (pl.text as string) || "Task finished.";
            }
            if (pl.status === "terminate") {
              this.terminated = (pl.result as string) || "success";
            }

            onProgress?.({
              type: "action",
              toolCallId: this.toolCallId,
              timestamp: new Date().toISOString(),
              stepNumber: step,
              action: { type: args.action, params: args, description: args.action },
            });
          } catch (toolErr) {
            console.error("[Dumb-Agent] Tool error:", toolErr);
          }
        }

        if (this.terminated || this.finalAnswer) break;
        await waitForScreenSettle();
      }

      return {
        finalAnswer:    this.finalAnswer ?? `Task ended: ${this.terminated ?? "unknown"}`,
        lastScreenshot: this.lastScreenshot,
      };
    }
  }

  private isBrainHandProvider(): boolean {
    return false;
  }

  private getBrainHandModels(): { brain: string; hand: string } | null {
    if (!this.isBrainHandProvider()) return null;
    return {
      brain: this.REASONER_MODEL,
      hand: this.ACTION_MODEL,
    };
  }

  private async runBrainHandTurn(
    screenshot: string,
    step: number,
    finalTurnPrompt: string,
  ): Promise<{ instruction: string; actions: string[] } | null> {
    const models = this.getBrainHandModels();
    if (!models) return null;

    console.log(`[Dumb-Agent] Brain/HAND provider=${this.client.provider} brain=${models.brain} hand=${models.hand}`);
    // Hard 8-step cap (tighter than historyWindow) for the brain prompt —
    // reasoning models only need recent trajectory, and this keeps the
    // instruction request small enough for its 512-token budget.
    const historyText = this.history.slice(-8).join("\n");
    const instruction = (await this.ask(models.brain, [
      {
        role: "system",
        content: brainPrompt(this.task),
      },
      {
        role: "user",
        content: [
          { type: "text", text: `Task: ${this.task}\nStep: ${step}${finalTurnPrompt}\n\nHistory:\n${historyText}` },
          { type: "image_url", image_url: { url: screenshot } },
        ],
      },
    ], 512)).trim();

    if (!instruction || /\bdone\b/i.test(instruction)) {
      return { instruction: instruction || "done", actions: [] };
    }

    const rawActions = (await this.ask(models.hand, [
      { role: "system", content: HAND_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: `Instruction: ${instruction}` },
          { type: "image_url", image_url: { url: screenshot } },
        ],
      },
    ], 1024)).trim();

    const actions = this.parseModelOutput(rawActions);
    return { instruction, actions };
  }

  private parseModelOutput(raw: string): string[] {
    if (!raw || !raw.trim()) return [];
    raw = raw.trim();

    // Try JSON parse
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed
          .map(x => typeof x === "string" ? x : this.actionObjectToString(x))
          .filter((x): x is string => Boolean(x?.trim()));
      }
      const action = this.actionObjectToString(parsed);
      if (action) {
        return [action];
      }
    } catch {}

    // Regex fallback for array-like structures
    const actions: string[] = [];
    const arrayMatch = raw.match(/\[\s*(.*?)\s*\]/s);
    if (arrayMatch) {
      const content = arrayMatch[1];
      const items = content.split(/",\s*"/);
      for (let item of items) {
        item = item.replace(/^"/, "").replace(/"$/, "").trim();
        if (item) actions.push(item);
      }
      if (actions.length > 0) return actions;
    }

    // Line by line fallback
    const lines = raw.split("\n");
    const validated: string[] = [];
    const validPatterns = [
      /^click\s*\(\s*[^)]+\s*\)$/i,
      /^(left|right)_click\s*\(\s*[^)]+\s*\)$/i,
      /^move\s*\(\s*[^)]+\s*\)$/i,
      /^smooth\s*\(\s*[^)]+\s*\)$/i,
      /^look\s*\(\s*[^)]+\s*\)$/i,
      /^drag\s*\(\s*[^)]+\s*\)$/i,
      /^press\s*\(\s*[^)]+\s*\)$/i,
      /^type\s*\(\s*[^)]+\s*\)$/i,
      /^scroll\s*\(\s*[^)]+\s*\)$/i,
      /^wait\s*\(\s*[^)]+\s*\)$/i,
      /^hold_[acdemsw]$/i,
      /^release_[acdemsw]$/i,
      /^left_click\s*\(\s*\)$/i,
      /^right_click\s*\(\s*\)$/i,
      /^double_click\s*\(\s*[^)]+\s*\)$/i,
      /^ctrl_[acv]\s*\(\s*\)$/i,
      /^(alt|ctrl|shift|meta)\s*\+/i,
      /^(alt_tab|alt tab|alt\+tab)$/i,
      /^(win|drop|use|inv|inventory|esc|tab|map|sprint|sneak|interact|center|done)\s*\(\s*\)$/i,
      /^(left|right)_click$/i,
      /^\w+\+\w+$/i,
    ];

    for (let line of lines) {
      line = line.trim().replace(/^[\-\*\.\d]+\s*/, "").replace(/^(Action|Act|Execute)\s*[:=>]\s*/i, "");
      if (!line || line.length > 200) continue;

      // Ported normalization from tars-test.py
      // Handle click(start_box='(896,1034)') -> click(896,1034)
      const startBoxMatch = line.match(/click\s*\(\s*start_box\s*=\s*['"]?\(?(\d+)\s*,\s*(\d+)\)?['"]?\s*\)/i);
      if (startBoxMatch) {
        line = `click(${startBoxMatch[1]},${startBoxMatch[2]})`;
      }

      // Handle click((896,1034)) -> click(896,1034)
      const nestedMatch = line.match(/click\s*\(\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)\s*\)/i);
      if (nestedMatch) {
        line = `click(${nestedMatch[1]},${nestedMatch[2]})`;
      }

      if (validPatterns.some(p => p.test(line))) {
        validated.push(line);
      }
    }
    return validated;
  }

  private actionObjectToString(value: any): string | null {
    if (!value || typeof value !== "object") return null;
    const action = typeof value.action === "string" ? value.action.toLowerCase() : "";
    if (!action) return null;

    const coordinate = Array.isArray(value.coordinate) ? value.coordinate : null;
    if (coordinate && coordinate.length >= 2) {
      const x = Number(coordinate[0]);
      const y = Number(coordinate[1]);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        if (action.includes("double")) return `double_click(${Math.round(x)},${Math.round(y)})`;
        if (action.includes("right")) return `right_click(${Math.round(x)},${Math.round(y)})`;
        if (action.includes("move")) return `move(${Math.round(x)},${Math.round(y)})`;
        if (action.includes("drag")) return `drag(${Math.round(x)},${Math.round(y)})`;
        return `click(${Math.round(x)},${Math.round(y)})`;
      }
    }

    if (action === "type" && typeof value.text === "string") return `type("${value.text.replace(/"/g, '\\"')}")`;
    if (action === "answer" && typeof value.text === "string") return `done()`;
    if (action === "wait") return `wait(${Number(value.time) || 1})`;
    if (action === "key" && Array.isArray(value.keys)) return value.keys.join("+");
    if (action === "terminate") return `done()`;
    return null;
  }

  formatActionSentence(action: string): string {
    if (!action) return "Executing action...";
    const trimmed = action.trim();

    // hotkey
    const hotkeyMatch =
      trimmed.match(/hotkey\s*\(\s*key\s*=\s*['"]([^'"]*)['"]\s*\)/i) ||
      trimmed.match(/key\s*[:=]\s*['"]?([a-zA-Z0-9+_ -]+)['"]?/i);
    if (hotkeyMatch) {
      const key = hotkeyMatch[1].toLowerCase().trim();
      if (key === "win" || key === "super" || key === "windows") {
        return "Pressing the Windows key to open Start menu";
      }
      if (key.includes("ctrl") && key.includes("c")) return "Copying selection with Ctrl+C";
      if (key.includes("ctrl") && key.includes("v")) return "Pasting clipboard with Ctrl+V";
      if (key.includes("ctrl") && key.includes("a")) return "Selecting all with Ctrl+A";
      if (key === "enter") return "Pressing Enter";
      if (key === "esc" || key === "escape") return "Pressing Escape";
      return `Pressing shortcut '${hotkeyMatch[1]}'`;
    }

    // click
    if (trimmed.includes("click") || trimmed.includes("left_single") || trimmed.includes("left_click")) {
      return "Clicking target element on screen";
    }

    // double click
    if (trimmed.includes("left_double") || trimmed.includes("double_click")) {
      return "Double-clicking target element";
    }

    // right click
    if (trimmed.includes("right_single") || trimmed.includes("right_click")) {
      return "Right-clicking target element";
    }

    // type
    const typeMatch =
      trimmed.match(/type\s*\(\s*content\s*=\s*['"]([^'"]*)['"]\s*\)/i) ||
      trimmed.match(/type_text_at.*text\s*[:=]\s*['"]([^'"]*)['"]/i);
    if (typeMatch) {
      return "Typing text into the active field";
    }

    // scroll
    const scrollMatch = trimmed.match(/scroll.*(up|down)/i) || trimmed.match(/direction\s*=\s*['"]([^'"]*)['"]/i);
    if (scrollMatch) {
      return `Scrolling ${scrollMatch[1] || "down"} on screen`;
    }

    // wait
    if (/wait\s*\(/i.test(trimmed)) {
      return "Waiting for application to respond";
    }

    // finished
    if (/finished\s*\(/i.test(trimmed)) {
      return "Completed automation workflow";
    }

    // screenshot
    if (/screenshot/i.test(trimmed)) {
      return "Analyzing screen to inspect application state";
    }

    return trimmed;
  }

  /**
   * AG-SAF-11: destructive-action gate for text-action dispatch paths that
   * don't pass through the toolCall safetyDecision gate (dispatchAll and the
   * Thought/Action loop). If any action text matches the destructive pattern,
   * prompt the user; deny by default when the dialog fails. Returns true when
   * the action may proceed.
   */
  private async confirmDestructive(actionTexts: Array<string | undefined | null>, onUpdate?: (msg: string) => void): Promise<boolean> {
    if (!looksDestructive(actionTexts)) return true;
    const agentName = "ComputerUse";
    console.log(`[${agentName}] Action requires confirmation (destructive heuristic). Prompting user...`);
    onUpdate?.("⚠️ Action requires security confirmation...");
    try {
      const { dialog, BrowserWindow } = require("electron");
      const win = BrowserWindow.getAllWindows()[0];
      const dialogResponse = await dialog.showMessageBox(win || undefined, {
        type: "warning",
        title: "EverFern Security Authorization",
        message: `${agentName} has requested an action that requires your confirmation.\n\nExplanation: The action text matches a destructive-action pattern (e.g. delete/format/uninstall).\n\nDo you want to authorize this action?`,
        buttons: ["Approve", "Deny"],
        defaultId: 0,
        cancelId: 1
      });
      const approved = dialogResponse.response === 0;
      console.log(`[${agentName}] User confirmation result: ${approved ? "Approved" : "Denied"}`);
      return approved;
    } catch (dialogErr) {
      console.error(`[${agentName}] Failed to show confirmation dialog:`, dialogErr);
      return false; // fail-closed
    }
  }

  /** Execute a queued batch of action strings. releaseAll() first: the
   * previous batch's hold state (game keys, mouse) must not bleed into the
   * next batch — every dispatch starts from a clean input state. */
  async dispatchAll(actions: string[], onUpdate?: any, onProgress?: any, step?: number) {
    await this.releaseAll();
    // AG-SAF-11: model-provided action text bypasses the toolCall gate — run
    // the destructive heuristic over the whole queued batch before dispatch.
    if (!(await this.confirmDestructive(actions, onUpdate))) {
      console.log("  [EXEC] destructive batch denied by user — skipping");
      return;
    }
    for (const action of actions) {
      // AG-CORR-08: honor abort between queued actions so a long
      // execute_actions run stops within one action of abort().
      if (this.aborted) {
        console.log("  [EXEC] aborted — stopping remaining actions");
        return;
      }
      const sentence = this.formatActionSentence(action);
      console.log(`  [EXEC] ${sentence}`);
      onUpdate?.(`${sentence}...`);

      const safeActionName = action.split('(')[0]?.trim() || 'action';
      onProgress?.({
        type: "action",
        toolCallId: this.toolCallId,
        timestamp: new Date().toISOString(),
        stepNumber: step,
        content: sentence,
        action: { type: safeActionName, params: {}, description: sentence },
      });

      const handled = await this.dispatchAction(action);
      // __done__ = model signalled finished(): stop the whole batch but report
      // success — unlike abort, this is the task's normal completion path.
      if (handled === "__done__") {
        this.terminated = "success";
        break;
      }
    }
  }

  private async dispatchAction(actionLine: string): Promise<any> {
    actionLine = actionLine.trim();
    if (!actionLine) return true;

    // Reject/warn on natural-language actions
    if (!isStructuredAction(actionLine)) {
      console.log(`  [WARN] Natural-language action ignored: ${actionLine}`);
      return "__bad_format__";
    }

    // finished()
    if (/^finished\s*\(\s*\)/i.test(actionLine)) {
      console.log("  [EXEC] finished()");
      return "__done__";
    }

    // call_user()
    if (/^call_user\s*\(\s*\)/i.test(actionLine)) {
      console.log("  [EXEC] call_user() — pausing/sleeping");
      await sleep(5);
      return true;
    }

    // wait()
    if (/^wait\s*\(\s*\)/i.test(actionLine)) {
      console.log("  [EXEC] wait() — sleeping 5s");
      await sleep(5);
      return true;
    }

    // click(start_box='...')
    let m = actionLine.match(/^click\s*\(\s*start_box\s*=\s*['"]([^'"]*)['"]/i);
    if (m) {
      const coords = parseBox(m[1]);
      if (coords) {
        await this.tool.call({ action: "left_click", coordinate: coords });
      }
      return true;
    }

    // left_double(start_box=...)
    m = actionLine.match(/^left_double\s*\(\s*start_box\s*=\s*['"]([^'"]*)['"]/i);
    if (m) {
      const coords = parseBox(m[1]);
      if (coords) {
        await this.tool.call({ action: "double_click", coordinate: coords });
      }
      return true;
    }

    // right_single(start_box=...)
    m = actionLine.match(/^right_single\s*\(\s*start_box\s*=\s*['"]([^'"]*)['"]/i);
    if (m) {
      const coords = parseBox(m[1]);
      if (coords) {
        await this.tool.call({ action: "right_click", coordinate: coords });
      }
      return true;
    }

    // drag(start_box=..., end_box=...)
    m = actionLine.match(/^drag\s*\(\s*start_box\s*=\s*['"]([^'"]*)['"]\s*,\s*end_box\s*=\s*['"]([^'"]*)['"]/i);
    if (m) {
      const start = parseBox(m[1]);
      const end = parseBox(m[2]);
      if (start && end) {
        await this.tool.call({ action: "drag", start_coordinate: start, coordinate: end });
        console.log(`  [EXEC] drag [${start}] -> [${end}]`);
      }
      return true;
    }

    // hotkey(key='ctrl c')
    m = actionLine.match(/^hotkey\s*\(\s*key\s*=\s*['"]([^'"]+)['"]/i);
    if (m) {
      const keys = m[1].trim().split(/\s+/);
      await this.tool.call({ action: "key", keys: keys });
      console.log(`  [EXEC] hotkey [${keys}]`);
      return true;
    }

    // type(content='...')
    m = actionLine.match(/^type\s*\(\s*content\s*=\s*'((?:[^'\\]|\\.)*)'\s*\)/i);
    if (!m) {
      m = actionLine.match(/^type\s*\(\s*content\s*=\s*"((?:[^"\\]|\\.)*)"\s*\)/i);
    }
    if (m) {
      let content = m[1];
      content = content.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\n/g, "\n");
      if (content.endsWith("\n")) {
        await this.tool.call({ action: "type", text: content.slice(0, -1) });
        await this.tool.call({ action: "key", keys: ["enter"] });
      } else {
        await this.tool.call({ action: "type", text: content });
      }
      console.log(`  [EXEC] type: ${JSON.stringify(content)}`);
      return true;
    }

    // scroll(start_box=..., direction='down')
    m = actionLine.match(/^scroll\s*\(\s*start_box\s*=\s*['"]([^'"]*)['"]\s*,\s*direction\s*=\s*['"](\w+)['"]/i);
    if (m) {
      const coords = parseBox(m[1]);
      const direction = m[2].toLowerCase();
      if (direction === "up" || direction === "down") {
        await this.tool.call({
          action: "scroll",
          coordinate: coords || undefined,
          pixels: direction === "up" ? 500 : -500
        });
      } else {
        await this.tool.call({
          action: "hscroll",
          coordinate: coords || undefined,
          pixels: direction === "right" ? 500 : -500
        });
      }
      console.log(`  [EXEC] scroll ${direction}`);
      return true;
    }

    // Fallback to legacy parsing if not matches any of the above
    console.log(`  [WARN] Falling back to legacy action execution for: ${actionLine}`);
    return this.dispatchActionLegacy(actionLine);
  }

  private async dispatchActionLegacy(text: string): Promise<any> {
    text = text.trim();
    if (!text || text.startsWith("#")) return true;

    // Normalize start_box format: click(start_box='(1215,1034)') -> click(1215,1034)
    const startBoxMatch = text.match(/click\s*\(\s*start_box\s*=\s*['"]?\(?(\d+)\s*,\s*(\d+)\)?['"]?\s*\)/i);
    if (startBoxMatch) {
      text = `click(${startBoxMatch[1]},${startBoxMatch[2]})`;
    }

    // Ported from tars-test.py dispatch()
    const parseXy = (s: string): [number, number] | null => {
      const parts = s.split(",");
      if (parts.length >= 2) {
        const m1 = parts[0].match(/-?\d+/);
        const m2 = parts[1].match(/-?\d+/);
        if (m1 && m2) return [parseInt(m1[0]), parseInt(m2[0])];
      }
      return null;
    };

    const has = (pat: string | RegExp, s: string) => new RegExp(pat, "i").test(s);

    const coords = has(/^(?:click|move|drag|double[_\s]?click|right[_\s]?click|left[_\s]?click)\s*\(/, text) ? parseXy(text) : null;

    // Shortcut detection
    const shortcutMatch = text.match(/^(alt|ctrl|shift|meta)\s+(tab|enter|esc|f\d+|space|right|left|up|down|\w)$/i) ||
                          text.match(/^(alt|ctrl|shift|meta)[_\s]+(\w+)$/i) ||
                          text.match(/^(alt\+tab|alt_tab|alt tab|ctrl\+c|ctrl\+v|ctrl\+a|ctrl\+z|ctrl\+s|alt\+f4|alt\+enter|shift\+tab|shift\+enter|ctrl\+w|ctrl\+shift\+tab|shift\+f\d+)$/i);

    if (shortcutMatch) {
      const raw = shortcutMatch[0].toLowerCase().replace(/\s+/g, "+").replace(/_/g, "+");
      const parts = raw.split("+");
      await this.tool.call({ action: "key", keys: parts });
      return true;
    }

    if (coords) {
      const [x, y] = coords;
      if (has(/double/i, text)) {
        await this.tool.call({ action: "double_click", coordinate: [x, y] });
      } else if (has(/drag/i, text)) {
        await this.tool.call({ action: "left_click_drag", coordinate: [x, y] });
      } else if (has(/click/i, text)) {
        const button = has(/right/i, text) ? "right_click" : (has(/left/i, text) ? "left_click" : "left_click");
        await this.tool.call({ action: button, coordinate: [x, y] });
      } else if (has(/move/i, text)) {
        await this.tool.call({ action: "mouse_move", coordinate: [x, y] });
      } else {
        await this.tool.call({ action: "left_click", coordinate: [x, y] });
      }
      return true;
    }

    if (has(/^press\s*\(\s*([^)]+)\s*\)\s*$/i, text)) {
      const key = text.match(/press\s*\(\s*([^)]+)\s*\)/i)![1].trim().toLowerCase();
      await this.tool.call({ action: "key", keys: key.includes("+") ? key.split("+") : [key] });
      return true;
    }

    if (has(/^(hold|release)_([a-zA-Z0-9]+)$/i, text)) {
      const m = text.match(/^(hold|release)_([a-zA-Z0-9]+)$/i)!;
      const act = m[1].toLowerCase();
      const key = m[2].toLowerCase();
      if (act === "hold") {
        this.heldKeys.add(key);
        await this.tool.call({ action: "hold", keys: [key] });
      } else {
        this.heldKeys.delete(key);
        await this.tool.call({ action: "release", keys: [key] });
      }
      return true;
    }

    if (has(/type\s*\(\s*(?:content\s*=\s*)?['"]?(.+?)['"]?\s*\)/i, text)) {
      const content = text.match(/type\s*\(\s*(?:content\s*=\s*)?['"]?(.+?)['"]?\s*\)/i)![1];
      await this.tool.call({ action: "type", text: content });
      return true;
    }

    if (has(/scroll\s*\(\s*(\w+)\s*\)/i, text)) {
      const dir = text.match(/scroll\s*\(\s*(\w+)\s*\)/i)![1].toLowerCase();
      await this.tool.call({ action: "scroll", pixels: dir.includes("up") ? -500 : 500 });
      return true;
    }

    if (has(/wait\s*\(\s*([^)]+)\s*\)/i, text)) {
      const rawSeconds = text.match(/wait\s*\(\s*([^)]+)\s*\)/i)![1];
      const seconds = Number(rawSeconds.replace(/[^\d.]/g, "")) || 1;
      await this.tool.call({ action: "wait", time: seconds });
      return true;
    }

    if (has(/^done\s*\(\s*\)$/i, text)) return "__done__";

    // Simple mappings for others
    const simpleMap: Record<string, any> = {
      "right_click()": { action: "right_click" },
      "left_click()": { action: "left_click" },
      "win()": { action: "key", keys: ["win"] },
      "esc()": { action: "key", keys: ["escape"] },
      "tab()": { action: "key", keys: ["tab"] },
      "center()": { action: "mouse_move", coordinate: [500, 500] }
    };

    const lower = text.toLowerCase();
    if (simpleMap[lower]) {
      await this.tool.call(simpleMap[lower]);
      return true;
    }

    return false;
  }

  // ── Message helpers ───────────────────────────────────────────────────────────

  /** AG-MEM-03: elide image payloads older than the recent window to bound memory.
   * Each embedded screenshot is ~100s of KB; 200 turns would otherwise pin
   * tens of MB in this.messages even after trimMessages slices messages out. */
  private elideStaleScreenshots(): void {
    const keep = 4; // keep the most recent exchanges intact for vision continuity
    // In-place rewrite (not slice) — messages older than the keep window stay
    // structurally present but lose their payload, so provider-side message
    // orderings (tool_call_id pairings) remain valid.
    for (let i = this.baseCount; i < this.messages.length - keep; i++) {
      const m: any = this.messages[i];
      if (!m || !Array.isArray(m.content)) continue;
      for (let j = 0; j < m.content.length; j++) {
        const c = m.content[j];
        if (c && c.type === 'image_url' && c.image_url && typeof c.image_url.url === 'string' && c.image_url.url.startsWith('data:image')) {
          m.content[j] = { type: 'text', text: '[screenshot elided]' };
        }
      }
    }
  }

  private async appendInitialObservation(): Promise<void> {
    const obs        = await this.tool.captureObservation();
    const screenshot = obs.screenshot as string | undefined;
    const content: any[] = [];
    if (screenshot) content.push({ type: "image_url", image_url: { url: screenshot } });
    content.push({ type: "text", text: this.task });
    this.messages.push({ role: "user", content });
    this.trimMessages(true);
  }

  /** Mirror Python: keep base + last (historyWindow * 2) dynamic messages. */
  private trimMessages(force = false): void {
    this.elideStaleScreenshots(); // AG-MEM-03: drop stale image payloads before slicing
    const base    = this.messages.slice(0, this.baseCount);
    const dynamic = this.messages.slice(this.baseCount);
    // historyWindow * 2 = one user + one assistant/tool message per windowed
    // turn; baseCount (system prompt) is never trimmed away.
    const maxItems = this.historyWindow * 2;
    if (!force && dynamic.length <= maxItems) return;
    this.messages = [...base, ...dynamic.slice(-maxItems)];
  }
}

// ── Exports ───────────────────────────────────────────────────────────────────

// Module-level slot for the currently running agent so abortComputerUse()
// can reach it from outside the tool closure (no tool handle available there).
let activeAgent: ComputerUseAgent | null = null;

/** Abort the in-flight agent (releases held keys via abort→releaseAll). */
function abortComputerUse(): void {
  activeAgent?.abort();
  activeAgent = null;
}

export function createComputerUseTool(
  originalClient: AIClient,
  _platform?: string,
  _visionModel?: string,
  _showuiUrl?: string,
  _ollamaBaseUrl?: string,
  _checkPermission?: () => boolean,
  _requestPermission?: () => Promise<boolean>,
  vlm?: { engine?: string; provider: string; model: string; baseUrl?: string; apiKey?: string },
): AgentTool & { abort(): void } {

  const home          = process.env.USERPROFILE ?? process.env.HOME ?? "";
  const screenshotDir = path.join(home, ".everfern", "screenshots");
  const tool          = new ComputerUseTool(screenshotDir);

  const client = vlm?.model
    ? new AIClient({
        provider: (vlm.engine === "cloud" && vlm.provider === "ollama" ? "ollama-cloud" : vlm.provider) as any,
        apiKey:   vlm.apiKey,
        baseUrl:  vlm.baseUrl,
        model:    vlm.model,
      })
    : originalClient;

  const model = vlm?.model ?? originalClient.model ?? "unknown";
  tool.client = client;
  // AG-CORR-16: UI-TARS-style models emit a 0–1000 grid; other providers emit
  // genuine pixels. Declaring the space kills the ≤1000 magnitude heuristic
  // that mis-scaled real pixel coordinates.
  tool.declaredCoordinateSpace = /ui-tars|tars/i.test(model) ? 'grid' : 'pixel';

  return createToolWithClient(client, tool, model);
}

function createToolWithClient(
  client: AIClient,
  tool: ComputerUseTool,
  model: string,
): AgentTool & { abort(): void } {
  return {
    name:        "computer_use",
    description: "Launch an autonomous sub-agent to perform GUI tasks natively.",
    parameters: {
      type: "object",
      properties: { task: { type: "string", description: "High-level goal for the sub-agent." } },
      required: ["task"],
    },

    async execute(
      args: Record<string, unknown>,
      onUpdate?: (msg: string) => void,
      emitEvent?: (event: any) => void,
      toolCallId?: string,
    ): Promise<AgentToolResult> {
      const perm = await checkToolPermission('computer_use', args, onUpdate, emitEvent);
      if (!perm.approved) {
        return { success: false, output: perm.error || 'Permission denied by user for computer_use.' };
      }

      // Handle execute_actions from vision grounding
      if (args.action === 'execute_actions' && Array.isArray(args.actions)) {
        const actions = args.actions as string[];
        const thought = (args.thought as string) || (args.reasoning as string) || "";
        try {
          if (thought) {
            emitEvent?.({
              type: "reasoning",
              toolCallId: toolCallId ?? "",
              timestamp: new Date().toISOString(),
              content: thought,
            });
          }
          // Create a temporary agent just to execute the actions
          // AG-CORR-08: register the temp agent in the active slot so
          // abortComputerUse()/tool.abort() can interrupt mid-dispatch.
          const tempAgent = new ComputerUseAgent(client, tool, model, thought || "Execute actions", 0, 200, 12, toolCallId ?? "");
          const prevActiveAgent = activeAgent;
          activeAgent = tempAgent;
          try {
            await tempAgent.dispatchAll(actions, onUpdate, (ev: any) => {
              emitEvent?.({
                type: "subagent-progress",
                toolCallId: toolCallId ?? "",
                timestamp: new Date().toISOString(),
                data: ev,
              });
            });
          } finally {
            // Restore the saved slot only if we still own it — a concurrent
            // abort/replace during dispatch would have overwritten the slot,
            // and clobbering that newer agent would break its abort path.
            if (activeAgent === tempAgent) activeAgent = prevActiveAgent ?? null;
            tempAgent.abort(); // releases any held keys/buttons via abort→releaseAll
          }
          const obs = await tool.captureObservation();
          const b64 = (obs.screenshot as string)?.split(",")?.[1] || "";
          return { success: true, output: "Actions executed", base64Image: b64, data: { actions, thought, screenshot: b64 } };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { success: false, output: `Failed to execute actions: ${message}` };
        }
      }

      // Handle regular task-based execution
      const task  = (args.task as string) || "Perform a visual audit of the current desktop.";
      
      // Ensure overlay is shown and status updated
      if (tool.overlay) {
        console.log("[ComputerUse] Showing overlay for task:", task);
        tool.overlay.show();
        tool.overlay.setStatus(`Task: ${task}`);
      }

      const agent = new ComputerUseAgent(client, tool, model, task, 0, 200, 12, toolCallId ?? "");
      activeAgent = agent;

      try {
        const { finalAnswer, lastScreenshot } = await agent.run(
          msg => onUpdate?.(msg),
          event => emitEvent?.({ type: "subagent-progress", toolCallId: toolCallId ?? "", timestamp: new Date().toISOString(), data: event }),
        );
        const b64 = lastScreenshot?.split(",")?.[1] || "";
        return { success: true, output: finalAnswer, base64Image: b64, data: { task, finalAnswer, screenshot: b64 } };
      } finally {
        console.log("[ComputerUse] Task finished, cleaning up activeAgent and overlay");
        // AG-SAF-07: unconditional turn-end release — covers both normal turn
        // end and any path abort() didn't reach (held keys + mouse buttons).
        try { await agent.releaseAll(); } catch (err) {
          console.warn('[ComputerUse] turn-end releaseAll failed:', err);
        }
        // Guard: only clear if still ours — a nested execute_actions temp
        // agent must not clobber a newer agent that replaced us mid-flight.
        if (activeAgent === agent) activeAgent = null;
        tool.overlay?.hide();
      }
    },

    abort() {
      activeAgent?.abort();
      activeAgent = null;
      tool.overlay?.hide();
    },
  };
}

// ── AG-MEM-01/04: shared lazy capture tool ────────────────────────────────────
// captureScreen() used to construct a fresh ComputerUseTool (and thus a
// fullscreen always-on-top overlay BrowserWindow) per call and never destroy
// it. Reuse one module-level instance instead, and destroy it after a minute
// of idleness so no overlay lingers for the app's lifetime.

let sharedCaptureTool: ComputerUseTool | null = null;
let overlayIdleTimer: NodeJS.Timeout | null = null;

/**
 * Lazily construct (or return the existing) module-wide capture tool.
 * AG-MEM-01: each ComputerUseTool owns a fullscreen always-on-top overlay
 * BrowserWindow; constructing one per capture leaked a window per call.
 * One shared instance, destroyed after idle (see below), prevents that leak.
 * Side effect: creates ~/.everfern/screenshots and prunes old PNGs on first use.
 */
export function getSharedCaptureTool(): ComputerUseTool {
  if (!sharedCaptureTool) {
    const home = process.env.USERPROFILE ?? process.env.HOME ?? "";
    const dir = path.join(home, ".everfern", "screenshots");
    sharedCaptureTool = new ComputerUseTool(dir);
    // AG-MEM-04: keep pruning even though the constructor now rarely runs.
    void pruneScreenshotDir(dir);
  }
  return sharedCaptureTool;
}

/** Destroy the shared capture tool after a minute without captures. */
function scheduleOverlayIdleCleanup(): void {
  // unref: the idle timer must never keep the Electron main process alive
  // on quit just to fire a cleanup it no longer needs.
  if (overlayIdleTimer) clearTimeout(overlayIdleTimer);
  overlayIdleTimer = setTimeout(() => {
    overlayIdleTimer = null;
    try { sharedCaptureTool?.cleanup(); } catch { /* already torn down */ }
    sharedCaptureTool = null;
  }, 60_000);
  overlayIdleTimer.unref?.();
}

/** Tear down the shared capture tool immediately (wired into app quit).
 * Nulling sharedCaptureTool lets a later getSharedCaptureTool() lazily rebuild
 * a fresh instance, so quit-time teardown never permanently breaks capture. */
export function shutdownComputerUseCapture(): void {
  if (overlayIdleTimer) {
    clearTimeout(overlayIdleTimer);
    overlayIdleTimer = null;
  }
  try { sharedCaptureTool?.cleanup(); } catch { /* already torn down */ }
  sharedCaptureTool = null;
}

/** AG-MEM-02: destroy every live tool overlay (wired into app quit).
 * Iterates a copy because cleanup() mutates the live set while we sweep. */
export function destroyAllComputerUseOverlays(): void {
  for (const t of [...ComputerUseTool.getLiveToolOverlays()]) {
    try { t.cleanup(); } catch { /* already torn down */ }
  }
}

/**
 * Capture the primary screen via the shared capture tool.
 * Always reschedules the 60s idle cleanup in `finally` — success or throw —
 * so no capture failure can leave the singleton overlay alive forever.
 */
export async function captureScreen(): Promise<{ b64: string; w: number; h: number; physW: number; physH: number }> {
  const home = process.env.USERPROFILE ?? process.env.HOME ?? "";
  // AG-MEM-04: fire-and-forget prune on every capture cadence.
  void pruneScreenshotDir(path.join(home, ".everfern", "screenshots"));
  const tool = getSharedCaptureTool();
  try {
    const obs  = await tool.captureObservation();
    const b64  = (obs.screenshot as string)?.split(",")?.[1] || "";
    const w    = (obs.display as any)?.width || 1920;
    const h    = (obs.display as any)?.height || 1080;
    return { b64, w, h, physW: w, physH: h };
  } finally {
    scheduleOverlayIdleCleanup();
  }
}
