/**
 * computer-use.ts
 * Clean TypeScript port of qwen-computer.py.
 * Keeps AgentTool / AIClient / progress-event integration points;
 * strips worker threads, PowerShell probing, overlay calls, and batching bloat.
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

import type { AgentTool, ToolResult as AgentToolResult } from "../runner/types";
import { AIClient, ChatMessage } from "../../lib/ai-client";
import { globalAbortManager } from "../runner/abort-manager";
import DesktopOverlay from "./desktop-overlay";
import { checkToolPermission } from "./permission-checker";

// ── Pruning & Caching Constants & Types ─────────────────────────────────────

export const PRUNED_SCREENSHOT_PLACEHOLDER = "[Screenshot pruned to conserve context]";

export interface TaskRunMetrics {
  totalInputTokens: number;
  cachedTokensRead: number;
  totalOutputTokens: number;
  totalReasoningTokens: number;
  cacheHitRatePct: number;
  stepCount: number;
  success: boolean;
  estimatedCostUsd: number;
}

export function pruneHistoricalScreenshots(
  messages: ChatMessage[],
  keepLastN: number = 2
): { prunedCount: number; oldestActiveIndex: number } {
  const imageIndices: { msgIndex: number; partIndex: number }[] = [];
  for (let mIdx = 0; mIdx < messages.length; mIdx++) {
    const msg = messages[mIdx];
    if (Array.isArray(msg.content)) {
      for (let pIdx = 0; pIdx < msg.content.length; pIdx++) {
        const part = msg.content[pIdx];
        if (part && part.type === "image_url") {
          imageIndices.push({ msgIndex: mIdx, partIndex: pIdx });
        }
      }
    }
  }

  const totalImages = imageIndices.length;
  const prunedCount = Math.max(0, totalImages - keepLastN);
  let oldestActiveIndex = -1;

  if (prunedCount > 0) {
    for (let i = 0; i < prunedCount; i++) {
      const { msgIndex, partIndex } = imageIndices[i];
      const msg = messages[msgIndex];
      if (Array.isArray(msg.content)) {
        msg.content[partIndex] = {
          type: "text",
          text: PRUNED_SCREENSHOT_PLACEHOLDER
        };
      }
    }
  }

  if (totalImages > 0 && prunedCount < totalImages) {
    oldestActiveIndex = imageIndices[prunedCount].msgIndex;
  }

  return { prunedCount, oldestActiveIndex };
}

export function computeScreenHash(base64: string): string {
  if (!base64) return "";
  return crypto.createHash("sha256").update(base64.slice(0, 50000)).digest("hex");
}

const IRREVERSIBLE_REGEX = /\b(submit|send|delete|pay|purchase|remove|drop|format|terminate|order)\b/i;
export function isIrreversibleAction(actionName: string, args: Record<string, any>): boolean {
  const textToCheck = `${actionName} ${JSON.stringify(args || {})}`;
  return IRREVERSIBLE_REGEX.test(textToCheck);
}

// ── Optional native deps ─────────────────────────────────────────────────────

let robot: any = null;
try { robot = require("@jitsi/robotjs"); }
catch { console.warn("[ComputerUse] robotjs unavailable"); }

let sharp: typeof import("sharp") | null = null;
try { sharp = require("sharp"); }
catch { console.warn("[ComputerUse] sharp unavailable — cursor circle disabled"); }

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
            "zoom",
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
          description: "Target coordinate [x, y] for mouse actions or center coordinate for action=zoom.",
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
        size: {
          type: "number",
          description: "Region box size in logical pixels for action=zoom (default 300).",
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

// ── Simple Computer Use Prompts (styled after qwen.py) ─────────────────────────

export const DEFAULT_COMPUTER_USE_SYSTEM_PROMPT = `You are a computer-use agent controlling a Windows desktop through screenshots.
Each turn you receive the current screenshot. Use the computer_use tool to perform the next action.

Coordinates are NORMALIZED 0-1000 on both axes relative to the screenshot:
(0,0) is top-left, (1000,1000) is bottom-right. Always aim for the CENTER of the target element.

Actions:
- left_click [x, y]
- double_click [x, y]
- right_click [x, y]
- type "text" (types into focused field)
- key ["ctrl", "l"] (or ["win"], ["enter"], etc.)
- scroll (pixels: positive=up, negative=down)
- wait (time: seconds)
- zoom [x, y] (inspect small UI details at 1:1 physical resolution)
- terminate (status: "success"|"failure")

Rules:
- One action per turn. If the previous action seems to have had no effect, try a different approach instead of repeating it.
- Never claim done without visible proof on screen.
- To open an app not visible on screen, press the Windows key (key "win"), type the app name, and press Enter.`;

export const GEMINI_SYSTEM_PROMPT = DEFAULT_COMPUTER_USE_SYSTEM_PROMPT;
export const GPT5_SYSTEM_PROMPT = DEFAULT_COMPUTER_USE_SYSTEM_PROMPT;
export const CLAUDE_COMPUTER_USE_PROMPT = DEFAULT_COMPUTER_USE_SYSTEM_PROMPT;

export const SYSTEM_PROMPT = `You are a computer-use agent controlling a Windows desktop through screenshots.
Each turn you receive the current screenshot. Reply with EXACTLY ONE JSON object and nothing else
(no markdown fences, no commentary).

Coordinates are NORMALIZED 0-1000 on both axes relative to the screenshot:
(0,0) is the top-left corner, (1000,1000) is the bottom-right corner.
Always aim for the CENTER of the target element.

Schema: {"thought": "<one short sentence>", "action": "<action>", ...params}

Actions:
- {"action":"click","x":int,"y":int}
- {"action":"double_click","x":int,"y":int}
- {"action":"right_click","x":int,"y":int}
- {"action":"type","text":"..."}            types into the currently focused field
- {"action":"key","keys":["ctrl","l"]}      one key like ["enter"] or a combo
- {"action":"scroll","x":int,"y":int,"amount":int}   positive = up, negative = down
- {"action":"wait","seconds":number}
- {"action":"zoom","x":int,"y":int,"size":number}
- {"action":"done","summary":"..."}         ONLY when the screen shows proof the task is complete
- {"action":"fail","reason":"..."}          only if the task is impossible

Rules: one action per turn. If the previous action seems to have had no effect, try a different
approach instead of repeating it. Never claim done without visible proof on screen.`;

export const FORMAT_CORRECTION = `Your reply was not a valid JSON action object.
Reply with EXACTLY ONE JSON object and nothing else, e.g.:
{"thought": "Clicking the search button", "action": "click", "x": 500, "y": 500}`;

export function stripThinking(text: string): string {
  let clean = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  clean = clean.replace(/<\/?think>/gi, "");
  return clean.trim();
}

export function parseJsonAction(raw: string): { action: any | null; error: string | null } {
  raw = stripThinking(raw);
  const cleaned = raw.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return { action: null, error: "Your reply was not a JSON object. Reply with exactly one JSON action." };
  }
  let obj: any;
  try {
    obj = JSON.parse(cleaned.slice(start, end + 1));
  } catch (e: any) {
    return { action: null, error: `Invalid JSON (${e.message || e}). Reply with exactly one valid JSON action.` };
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    return { action: null, error: "Reply with exactly one valid JSON object action." };
  }
  const kind = String(obj.action || "").toLowerCase().trim();
  const validActions = new Set([
    "click", "double_click", "right_click", "type", "key",
    "scroll", "wait", "zoom", "done", "fail"
  ]);
  if (!validActions.has(kind)) {
    return { action: null, error: `Unknown action ${JSON.stringify(kind)}. Valid actions: ${Array.from(validActions).sort().join(", ")}.` };
  }
  if (["click", "double_click", "right_click", "zoom"].includes(kind)) {
    const x = Number(obj.x);
    const y = Number(obj.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return { action: null, error: "This action needs numeric x and y." };
    }
    if (x < 0 || x > 1000 || y < 0 || y > 1000) {
      return { action: null, error: "x and y must be normalized 0-1000, not pixels." };
    }
    obj.x = Math.round(x);
    obj.y = Math.round(y);
  }
  if (kind === "type") {
    if (typeof obj.text !== "string") {
      if (typeof obj.content === "string") {
        obj.text = obj.content;
      } else {
        return { action: null, error: "type needs a string 'text'." };
      }
    }
  }
  if (kind === "key") {
    const rawKeys = obj.keys ?? obj.key;
    const keys = Array.isArray(rawKeys) ? rawKeys : (rawKeys ? String(rawKeys).split("+") : null);
    if (!Array.isArray(keys) || keys.length === 0 || !keys.every((k: any) => typeof k === "string")) {
      return { action: null, error: "key needs a non-empty list of key names, e.g. [\"ctrl\",\"l\"]." };
    }
    // Normalize key aliases (matches qwen.py KEY_ALIASES)
    const KEY_ALIASES: Record<string, string> = {
      windows: "win", super: "win", meta: "win", cmd: "command",
      return: "enter", escape: "esc", control: "ctrl", del: "delete",
    };
    obj.keys = keys.map((k: string) => {
      const lower = k.trim().toLowerCase();
      return KEY_ALIASES[lower] ?? lower;
    });
  }
  obj.action = kind;
  return { action: obj, error: null };
}

export function buildQwenMessages(
  history: { obs_text: string; image: string | null; reply: string }[],
  obsText: string,
  currentImage: string,
  keepLastScreenshots: number = 2
): ChatMessage[] {
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT }
  ];
  const keepFrom = history.length - (keepLastScreenshots - 1);
  for (let i = 0; i < history.length; i++) {
    const h = history[i];
    if (i >= keepFrom && h.image) {
      messages.push({
        role: "user",
        content: [
          { type: "text", text: h.obs_text },
          { type: "image_url", image_url: { url: h.image } }
        ]
      });
    } else {
      messages.push({
        role: "user",
        content: [
          { type: "text", text: h.obs_text + "\n" + PRUNED_SCREENSHOT_PLACEHOLDER }
        ]
      });
    }
    messages.push({
      role: "assistant",
      content: h.reply
    });
  }
  messages.push({
    role: "user",
    content: [
      { type: "text", text: obsText },
      { type: "image_url", image_url: { url: currentImage } }
    ]
  });
  return messages;
}

export function parseOutput(raw: string): { thought: string; actions: string[] } {
  let thought = "";
  const actions: string[] = [];

  raw = stripThinking(raw);

  // 1. Try clean JSON parse (qwen.py style)
  const cleaned = raw.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    try {
      const obj = JSON.parse(cleaned.slice(start, end + 1));
      if (obj && typeof obj === "object" && obj.action) {
        thought = typeof obj.thought === "string" ? obj.thought : "";
        const kind = String(obj.action).toLowerCase();
        let actionStr: string | null = null;
        if (kind === "click" || kind === "left_click") {
          const x = Math.round(Number(obj.x ?? 500));
          const y = Math.round(Number(obj.y ?? 500));
          actionStr = `click(${x},${y})`;
        } else if (kind === "double_click" || kind === "left_double") {
          const x = Math.round(Number(obj.x ?? 500));
          const y = Math.round(Number(obj.y ?? 500));
          actionStr = `double_click(${x},${y})`;
        } else if (kind === "right_click" || kind === "right_single") {
          const x = Math.round(Number(obj.x ?? 500));
          const y = Math.round(Number(obj.y ?? 500));
          actionStr = `right_click(${x},${y})`;
        } else if (kind === "type") {
          const txt = String(obj.text ?? obj.content ?? "");
          actionStr = `type("${txt.replace(/"/g, '\\"')}")`;
        } else if (kind === "key") {
          const keys = Array.isArray(obj.keys) ? obj.keys : (obj.key ? String(obj.key).split("+") : ["enter"]);
          actionStr = `press(${keys.join("+")})`;
        } else if (kind === "scroll") {
          const amt = Number(obj.amount ?? obj.pixels ?? -3);
          actionStr = amt > 0 || obj.direction === "up" ? "scroll(up)" : "scroll(down)";
        } else if (kind === "wait") {
          const sec = Number(obj.seconds ?? obj.time ?? 1);
          actionStr = `wait(${sec})`;
        } else if (kind === "zoom") {
          const x = Math.round(Number(obj.x ?? 500));
          const y = Math.round(Number(obj.y ?? 500));
          actionStr = `zoom(${x},${y})`;
        } else if (kind === "done" || kind === "finished" || kind === "fail" || kind === "terminate") {
          actionStr = "finished()";
        }

        if (actionStr) {
          return { thought, actions: [actionStr] };
        }
      }
    } catch {}
  }

  // 2. Fallback to legacy Thought: / Action: syntax
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

  // Fallback: direct structured action line
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
  "click(", "left_double(", "right_single(", "double_click(", "drag(",
  "hotkey(", "press(", "type(", "scroll(", "wait(", "zoom(", "finished(", "call_user(", "done("
];

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

function ensureXy(coordinate?: [number, number] | null): [number, number] {
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
    if (screenshot)   content.push({ type: "image_url", image_url: { url: screenshot, detail: "high" } });
    if (!content.length) content.push({ type: "text", text: "tool call completed." });
    return content;
  }
}

// ── ComputerUseTool ───────────────────────────────────────────────────────────

class ComputerUseTool {
  public lastViewport: Record<string, any> = {};
  public overlay: DesktopOverlay | null = null;
  public client: AIClient | null = null;

  constructor(
    private screenshotDir: string,
    private monitorIndex   = 1,
    private mouseMoveDuration = 0.0,   // unused in robotjs; kept for parity
    private dragDuration   = 0.15,     // unused in robotjs; kept for parity
    private imageQuality   = 95,
  ) {
    fs.mkdirSync(this.screenshotDir, { recursive: true });

    // Initialize overlay
    try {
      this.overlay = new DesktopOverlay();
      console.log("[ComputerUse] Desktop overlay initialized");
    } catch (err) {
      console.warn("[ComputerUse] Failed to initialize overlay:", err);
    }

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

    // Handle execute_actions specially - dispatch multiple actions
    if (action === 'execute_actions' && Array.isArray(params.actions)) {
      console.log(`[ComputerUse] Executing ${params.actions.length} actions`);
      for (const actionStr of params.actions) {
        console.log(`[ComputerUse] Dispatching: ${actionStr}`);
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
      zoom:            p => this.zoomAction(p),
      answer:          p => this.answer(p),
      terminate:       p => this.terminate(p),
    };

    const handler = handlers[action];
    if (!handler) throw new Error(`Unsupported action: ${action}`);

    const result = await handler(params);
    result._action = action;

    // answer / terminate / zoom don't get full screenshot attachment (zoom has its own crop)
    if (action === "answer" || action === "terminate" || action === "zoom") {
      return new ToolResult(result);
    }
    return new ToolResult(await this.attachScreenshot(result));
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

  cleanup(): void {
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

  private async holdAction(p: any) {
    if (!robot) throw new Error("robotjs unavailable");
    const keys: string[] = p.keys || [];
    const holdTime = p.hold_time;

    const KEY_MAP: Record<string, string> = {
      control: "control", ctrl: "control", alt: "alt", shift: "shift",
      win: "command", command: "command"
    };

    if (p.coordinate) {
      const [x, y] = this.absoluteXy(p.coordinate);
      robot.moveMouse(x, y);
      robot.mouseToggle("down", "left");
      console.log(`[Hold] Holding left mouse button at (${x}, ${y})`);
      if (holdTime) {
        await new Promise(r => setTimeout(r, holdTime));
        robot.mouseToggle("up", "left");
        return { status: "ok", detail: `Held left mouse button for ${holdTime}ms at (${x}, ${y})` };
      }
      return { status: "ok", detail: `Holding left mouse button at (${x}, ${y})` };
    }

    if (!keys.length) throw new Error("keys or coordinate required for hold");

    for (const k of keys) {
      const key = KEY_MAP[k.toLowerCase()] ?? k.toLowerCase();
      robot.keyToggle(key, "down");
    }

    if (holdTime) {
      await new Promise(r => setTimeout(r, holdTime));
      for (const k of keys) {
        const key = KEY_MAP[k.toLowerCase()] ?? k.toLowerCase();
        robot.keyToggle(key, "up");
      }
      return { status: "ok", detail: `Held keys ${keys} for ${holdTime}ms` };
    }

    return { status: "ok", detail: `Held keys ${keys}` };
  }

  private async releaseAction(p: any) {
    if (!robot) throw new Error("robotjs unavailable");
    const keys: string[] = p.keys || [];

    if (p.coordinate || (!keys.length && !p.keys)) {
      robot.mouseToggle("up", "left");
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

  public moveMouse(x: number, y: number): void {
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

  public click(x?: number, y?: number, button: "left" | "right" | "middle" = "left"): void {
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

  public doubleClickAt(x: number, y: number): void {
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

  public pressKeys(keys: string[]): void {
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
  // Mirrors Python's _attach_screenshot: capture → draw cursor circle → resize → JPEG

  // ── Screenshot (inline, no worker thread) ────────────────────────────────────
  // Mirrors Python's _attach_screenshot: capture → draw cursor circle → resize → JPEG/WebP

  private async attachScreenshot(payload: Record<string, any>): Promise<Record<string, any>> {
    const imgPath = path.join(this.screenshotDir, `${nowTs()}.png`);

    // 1. Capture via Electron native API
    let rawBuffer: Buffer;
    let monLeft = 0, monTop = 0;
    let scaleFactor = 1;
    let logicalW = 1920, logicalH = 1080;

    try {
      const { screen, desktopCapturer } = require("electron");
      const displays = screen.getAllDisplays();
      const d = displays[this.monitorIndex - 1] ?? screen.getPrimaryDisplay();
      monLeft = d.bounds.x;
      monTop  = d.bounds.y;
      logicalW = d.bounds.width;
      logicalH = d.bounds.height;
      
      scaleFactor = d.scaleFactor || 1;
      const physicalWidth = Math.floor(logicalW * scaleFactor);
      const physicalHeight = Math.floor(logicalH * scaleFactor);

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

    // 2. Get physical dimensions from PNG header
    const { width: rawW, height: rawH } = this.pngDimensions(rawBuffer);

    // 3. Downscale to IMAGE_MAX_WIDTH (1280) matching qwen.py for optimal vision recognition
    const IMAGE_MAX_WIDTH = 1280;
    const downscaleRatio = rawW > IMAGE_MAX_WIDTH ? IMAGE_MAX_WIDTH / rawW : 1.0;
    const newW = Math.round(rawW * downscaleRatio);
    const newH = Math.round(rawH * downscaleRatio);

    // 4. Cursor position (in logical DIPs from robotjs)
    const cursor = robot ? robot.getMousePos() : { x: 0, y: 0 };

    let encoded: string;
    if (sharp) {
      try {
        let sharpPipeline = sharp(rawBuffer);
        if (downscaleRatio < 1.0) {
          sharpPipeline = sharpPipeline.resize(newW, newH, { fit: 'inside' });
        }
        // Use PNG for lossless text clarity (identical to qwen.py encode_image)
        const pngBuf = await sharpPipeline
          .png({ compressionLevel: 6 })
          .toBuffer();
        encoded = pngBuf.toString("base64");
      } catch (e) {
        console.warn("[ComputerUse] sharp resize failed, using raw buffer:", e);
        encoded = rawBuffer.toString("base64");
      }
    } else {
      encoded = rawBuffer.toString("base64");
    }

    console.log(`[Screenshot] ${imgPath} phys=(${rawW}x${rawH}) img=(${newW}x${newH}) scaleFactor=${scaleFactor} cursorDIP=(${cursor.x}, ${cursor.y})`);

    this.lastViewport = {
      monitor_left:    monLeft,           // DIP
      monitor_top:     monTop,            // DIP
      logical_width:   logicalW,          // DIP
      logical_height:  logicalH,          // DIP
      scale_factor:    scaleFactor,
      physical_width:  rawW,              // Physical
      physical_height: rawH,              // Physical
      display_width:   logicalW,          // Logical DIP width for robotjs
      display_height:  logicalH,          // Logical DIP height for robotjs
      image_width:     newW,              // Downscaled image width sent to model
      image_height:    newH,              // Downscaled image height sent to model
      raw_width:       rawW,
      raw_height:      rawH,
      downscale_ratio: downscaleRatio,
    };

    return {
      ...payload,
      screenshot:      `data:image/png;base64,${encoded}`,
      screenshot_path: imgPath,
      cursor,
      display:         { width: logicalW, height: logicalH },
      downscaled_size: { width: newW, height: newH },
    };
  }

  // ── Coordinate transform (DIP-aware with downscale mapping) ───────────────────

  /**
   * Normalized 0-1000 coordinates -> real click coordinates (logical DIPs for robotjs).
   * Exact TypeScript port of norm_to_screen from qwen.py.
   */
  public normToScreen(xn: number, yn: number): [number, number] {
    const vp   = this.lastViewport;
    const left = vp?.monitor_left ?? 0;
    const top  = vp?.monitor_top  ?? 0;
    const lw   = vp?.logical_width  ?? (robot ? robot.getScreenSize().width : 1920);
    const lh   = vp?.logical_height ?? (robot ? robot.getScreenSize().height : 1080);

    const x = left + Math.round((xn / 1000) * (lw - 1));
    const y = top  + Math.round((yn / 1000) * (lh - 1));
    return [x, y];
  }

  private absoluteXy(coordinate?: [number, number] | null): [number, number] {
    const [x, y] = ensureXy(coordinate);
    const vp     = this.lastViewport;
    const left   = vp.monitor_left   ?? 0;
    const top    = vp.monitor_top    ?? 0;
    const lw     = vp.logical_width  ?? vp.display_width ?? 1920;
    const lh     = vp.logical_height ?? vp.display_height ?? 1080;
    const iw     = vp.image_width    || lw;
    const ih     = vp.image_height   || lh;

    const isNormalized = this.client && ["everfern", "openrouter", "ollama-cloud", "gemini"].includes(this.client.provider);

    if (isNormalized && x <= 1000 && y <= 1000) {
      // Normalized 0–1000 coordinates -> map to logical DIP
      const absX = left + Math.round((x / 1000) * lw);
      const absY = top  + Math.round((y / 1000) * lh);
      console.log(`[Coord] norm=(${x},${y}) logical=(${lw}x${lh}) offset=(${left},${top}) → abs DIP=(${absX},${absY})`);
      return [absX, absY];
    }

    if (iw && ih) {
      // Pixel coordinates in downscaled image space (iw x ih) -> map to logical DIP
      const absX = left + Math.round((x / iw) * lw);
      const absY = top  + Math.round((y / ih) * lh);
      console.log(`[Coord] px=(${x},${y}) in (${iw}x${ih}) scale=(${(lw/iw).toFixed(2)},${(lh/ih).toFixed(2)}) → abs DIP=(${absX},${absY})`);
      return [absX, absY];
    }

    console.log(`[Coord] No viewport/scale, using offset only: (${left + x}, ${top + y})`);
    return [left + x, top + y];
  }

  // ── Zoom / Crop Action ───────────────────────────────────────────────────────

  private async zoomAction(params: any): Promise<Record<string, any>> {
    const coord = params.coordinate || [500, 500];
    const sizeDIP = typeof params.size === 'number' ? params.size : 300;
    const vp = this.lastViewport;
    const [targetDIPX, targetDIPY] = this.absoluteXy(coord);
    const scaleFactor = vp.scale_factor || 1;
    const monLeft = vp.monitor_left || 0;
    const monTop = vp.monitor_top || 0;

    const centerPhysX = Math.round((targetDIPX - monLeft) * scaleFactor);
    const centerPhysY = Math.round((targetDIPY - monTop) * scaleFactor);
    const cropSizePhys = Math.round(sizeDIP * scaleFactor);

    const physW = vp.physical_width || 1920;
    const physH = vp.physical_height || 1080;

    const left = Math.max(0, Math.min(physW - cropSizePhys, Math.round(centerPhysX - cropSizePhys / 2)));
    const top = Math.max(0, Math.min(physH - cropSizePhys, Math.round(centerPhysY - cropSizePhys / 2)));
    const width = Math.min(cropSizePhys, physW - left);
    const height = Math.min(cropSizePhys, physH - top);

    let rawBuffer: Buffer;
    try {
      const { screen, desktopCapturer } = require("electron");
      const displays = screen.getAllDisplays();
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: physW, height: physH }
      });
      const source = sources[this.monitorIndex - 1] || sources[0];
      rawBuffer = source.thumbnail.toPNG();
    } catch (e: any) {
      return { status: "error", detail: `Zoom capture failed: ${e.message || e}` };
    }

    let croppedBase64 = "";
    if (sharp) {
      const croppedBuffer = await sharp(rawBuffer)
        .extract({ left, top, width, height })
        .webp({ quality: 90 })
        .toBuffer();
      croppedBase64 = croppedBuffer.toString("base64");
    } else {
      croppedBase64 = rawBuffer.toString("base64");
    }

    return {
      status: "ok",
      detail: `Zoomed 1:1 view around logical (${targetDIPX}, ${targetDIPY}), box [${left}, ${top}, ${width}, ${height}] physical.`,
      screenshot: `data:image/webp;base64,${croppedBase64}`,
      zoom_box: { left, top, width, height }
    };
  }

  // ── PNG header reader ─────────────────────────────────────────────────────────

  private pngDimensions(buf: Buffer): { width: number; height: number } {
    if (buf.length >= 24 && buf.toString("ascii", 1, 4) === "PNG") {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    return { width: 1920, height: 1080 };
  }
}

// ── ComputerUseAgent ──────────────────────────────────────────────────────────
// Mirrors Python's ComputerUseAgent.run() very closely.

class ComputerUseAgent {
  private messages: ChatMessage[] = [];
  private baseCount: number;
  public finalAnswer: string | null = null;
  public terminated: string | null = null;
  private lastScreenshot?: string;
  private aborted = false;

  // Game state for tars-test parity
  private heldKeys = new Set<string>();
  private lastX: number | null = null;
  private lastY: number | null = null;
  private history: string[] = [];

  private REASONER_MODEL = "openai/gpt-5.6-luna-pro";
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
    private fallbackClient?: AIClient,
  ) {
    this.historyWindow = Math.max(1, historyWindow);
    this.messages  = [{ role: "system", content: SYSTEM_PROMPT }];
    this.baseCount = this.messages.length;
  }

  public abort(): void {
    this.aborted = true;
    this.terminated = "aborted";
    this.tool.overlay?.hide();
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

  private releaseAll() {
    for (const key of Array.from(this.heldKeys)) {
      try {
        // Map keys if needed (ComputerUseTool.pressKeys has a map)
        this.tool.call({ action: "key", keys: [key], _type: "release" }); // We might need a direct tool call for release
      } catch {}
    }
    this.heldKeys.clear();
    this.lastX = null;
    this.lastY = null;
  }

  async run(
    onUpdate?:   (msg: string) => void,
    onProgress?: (event: SubAgentProgressEvent) => void,
  ): Promise<{ finalAnswer: string; lastScreenshot?: string; metrics?: TaskRunMetrics }> {

    const isEverfernOrOpenRouter = ["everfern", "openrouter", "ollama-cloud"].includes(this.client.provider);
    const isGemini = !isEverfernOrOpenRouter && (this.client.provider === "gemini" || this.model.toLowerCase().includes("gemini"));
    const isOpenAI = !isEverfernOrOpenRouter && (this.client.provider === "openai" || this.model.toLowerCase().includes("gpt") || this.model.toLowerCase().includes("openai") || this.model.toLowerCase().includes("o1") || this.model.toLowerCase().includes("o3") || this.model.toLowerCase().includes("computer-use"));
    const isAnthropic = !isEverfernOrOpenRouter && (this.client.provider === "anthropic" || this.model.toLowerCase().includes("claude") || this.model.toLowerCase().includes("anthropic"));
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
          { type: "image_url" as const, image_url: { url: firstImg, detail: "high" } }
        ]
      });

      let consecutiveErrors = 0;
      let unchangedStreak = 0;
      let prevShotHash: string | null = computeScreenHash(firstImg);
      let lastActionFailed = false;
      let lastActionName: string | null = null;
      let currentEffort: "low" | "medium" | "high" = "high"; // Step 1 starts at high for initial planning

      const taskMetrics: TaskRunMetrics = {
        totalInputTokens: 0,
        cachedTokensRead: 0,
        totalOutputTokens: 0,
        totalReasoningTokens: 0,
        cacheHitRatePct: 0,
        stepCount: 0,
        success: false,
        estimatedCostUsd: 0,
      };

      while (step <= this.maxTurns) {
        if (this.aborted || globalAbortManager.streamAborted || this.terminated || this.finalAnswer) break;
        step++;

        console.log(`\n[${agentName} Agent] Step ${step}/${this.maxTurns}`);
        onUpdate?.(`Turn ${step}/${this.maxTurns}...`);

        // 1. Prune historical screenshots: retain only last 2 active screenshots
        const { prunedCount, oldestActiveIndex } = pruneHistoricalScreenshots(this.messages, 2);
        if (prunedCount > 0) {
          console.log(`[${agentName} Agent] Pruned ${prunedCount} older screenshot(s) to constant placeholder`);
        }

        // 2. Coordinate prefix caching: advance Anthropic cache breakpoint to right before active window
        if (isAnthropic && oldestActiveIndex > 0) {
          for (const m of this.messages) {
            if ((m as any).cache_control) {
              delete (m as any).cache_control;
            }
          }
          (this.messages[oldestActiveIndex - 1] as any).cache_control = { type: "ephemeral" };
        }

        // 3. Reasoning effort hysteresis: High on step 1 or recovery, Low for routine steps
        const isHardStep = step === 1 || consecutiveErrors > 0 || unchangedStreak >= 2 || lastActionFailed;
        if (isHardStep) {
          currentEffort = "high";
        } else if (currentEffort === "high" && unchangedStreak === 0 && consecutiveErrors === 0 && !lastActionFailed) {
          currentEffort = "low";
        }

        let chatResponse;
        try {
          chatResponse = await this.client.chat({
            messages: this.messages,
            model: this.model,
            temperature: currentEffort === "high" && isAnthropic ? 1.0 : 0.1,
            reasoningEffort: currentEffort,
            ...(maxTokensPerTurn ? { maxTokens: maxTokensPerTurn } : {}),
          });
          consecutiveErrors = 0;
          if (chatResponse.usage) {
            taskMetrics.totalInputTokens += chatResponse.usage.promptTokens || 0;
            taskMetrics.totalOutputTokens += chatResponse.usage.completionTokens || 0;
            taskMetrics.cachedTokensRead += chatResponse.usage.cachedPromptTokens || 0;
            taskMetrics.totalReasoningTokens += chatResponse.usage.reasoningTokens || 0;
          }
        } catch (err: any) {
          console.error(`[${agentName} Agent] API error:`, err);
          if (this.fallbackClient && this.fallbackClient !== this.client) {
            console.log(`[${agentName} Agent] Primary VLM client failed with connection error, falling back to runner client...`);
            this.client = this.fallbackClient;
            this.model = this.fallbackClient.model || this.model;
            this.fallbackClient = undefined;
            consecutiveErrors = 0;
            continue;
          }
          consecutiveErrors++;
          if (consecutiveErrors >= 3) {
            this.finalAnswer = `Unable to reach VLM provider. Please verify that the API endpoint is running and reachable. Error: ${err.message || err}`;
            break;
          }
          if (step === this.maxTurns) break;
          await sleep(3);
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

        // Detect completion in model text even when tool calls are present.
        // If the model says "task is done/complete" but still issued a redundant
        // verification click, execute the tool calls but exit after (don't loop).
        const DONE_TEXT = /\b(?:task\s+(?:is\s+)?(?:now\s+)?(?:complete|done|finished|accomplished)|(?:successfully|already)\s+(?:completed|changed|set|verified))\b/i;
        if (content && DONE_TEXT.test(content)) {
          console.log(`[${agentName} Agent] Model text indicates completion — will exit after executing remaining tool calls.`);
          this.finalAnswer = content;
          // Don't break yet — execute the tool calls below, then the while-loop
          // guard at the top of the next iteration will see finalAnswer and exit.
        }

        // Check safety decision / user confirmation requirement
        const safetyDecision = chatResponse.safetyDecision as any;
        let requiresConfirmation = safetyDecision && (
          safetyDecision === 'require_confirmation' ||
          safetyDecision === 'OFF-NOMINAL' ||
          (typeof safetyDecision === 'object' && (
            safetyDecision.decision === 'require_confirmation' ||
            safetyDecision.decision === 'OFF-NOMINAL'
          ))
        );

        // Check for irreversible actions among requested tool calls
        let hasIrreversibleAction = false;
        for (const tc of toolCalls) {
          const fname = tc.name;
          const args = (tc.arguments || {}) as Record<string, any>;
          if (isIrreversibleAction(fname, args)) {
            hasIrreversibleAction = true;
            currentEffort = "high"; // escalate reasoning effort
            console.warn(`[${agentName} Agent] Detected irreversible action: ${fname}. Escalating reasoning effort & requiring confirmation.`);
            break;
          }
        }
        if (hasIrreversibleAction) {
          requiresConfirmation = true;
        }

        let userConfirmed = true;
        if (requiresConfirmation) {
          console.log(`[${agentName} Agent] Action requires confirmation. Prompting user...`);
          onUpdate?.("⚠️ Action requires security confirmation...");
          try {
            const { dialog, BrowserWindow } = require("electron");
            const win = BrowserWindow.getAllWindows()[0];
            const explanation = typeof safetyDecision === 'object' && (safetyDecision as any).explanation
              ? `\n\nExplanation: ${(safetyDecision as any).explanation}`
              : hasIrreversibleAction ? "\n\nExplanation: An irreversible action (submit/delete/pay/modify) was requested." : "";
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
              lastActionName = fname;

            if (fname === "computer_use" || fname === "computer" || fname === "computer_20241022") {
              await this.tool.call(args);
            } else if (fname === "zoom") {
              actionResult = await this.tool.call({ action: "zoom", ...args });
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
              await shell.openExternal("https://www.google.com");
              await sleep(2);
            } else if (fname === "navigate") {
              const { shell } = require("electron");
              if (args.url) {
                await shell.openExternal(args.url);
                await sleep(2);
              } else {
                throw new Error("url is required for navigate");
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
              this.finalAnswer = args.summary || args.text || content || "Task completed.";
              break;
            } else {
              console.warn(`Warning: Unimplemented or custom function ${fname}`);
              actionResult = { status: "error", error: `Unimplemented function ${fname}` };
            }
          } catch (e: any) {
            console.error(`Error executing ${tc.name}:`, e);
            actionResult = { status: "error", error: e.message || String(e) };
          }
        }

        lastActionFailed = actionResult.status === "error";

        if (requiresConfirmation && userConfirmed) {
          actionResult.safety_acknowledgement = true;
        }

        results.push({ name: tc.name, result: actionResult });
        await sleep(1);
        if (this.terminated) break;
      }

      if (this.terminated) break;

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

        // Screen state hashing for silent failure detection
        const currShotHash = computeScreenHash(newImg);
        const screenUnchanged = prevShotHash !== null && prevShotHash === currShotHash;
        prevShotHash = currShotHash;

        const isPotentiallyStateChanging = lastActionName && !["zoom", "wait", "mouse_move", "hover_at"].includes(lastActionName);
        if (screenUnchanged && isPotentiallyStateChanging) {
          unchangedStreak++;
          console.warn(`[${agentName} Agent] Screen state unchanged after ${lastActionName} (streak: ${unchangedStreak})`);
        } else {
          unchangedStreak = 0;
        }

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
            (lastPart.content as any[]).push({
              type: "image_url",
              image_url: { url: newImg, detail: "high" }
            });
          }
        }

        for (const tp of toolParts) {
          this.messages.push(tp);
        }

        await sleep(1);
      }

      taskMetrics.stepCount = step;
      taskMetrics.success = this.terminated === "success" || !this.terminated;
      if (taskMetrics.totalInputTokens > 0) {
        taskMetrics.cacheHitRatePct = parseFloat(
          ((taskMetrics.cachedTokensRead / taskMetrics.totalInputTokens) * 100).toFixed(1)
        );
      }
      const nonCachedInput = Math.max(0, taskMetrics.totalInputTokens - taskMetrics.cachedTokensRead);
      const estCost = (nonCachedInput * 3.0 + taskMetrics.cachedTokensRead * 0.30 + taskMetrics.totalOutputTokens * 15.0) / 1_000_000;
      taskMetrics.estimatedCostUsd = parseFloat(estCost.toFixed(6));

      console.log(`\n[${agentName} Agent] === Task Run Metrics ===`);
      console.log(`  Steps executed: ${taskMetrics.stepCount}`);
      console.log(`  Total input tokens: ${taskMetrics.totalInputTokens}`);
      console.log(`  Cached tokens read: ${taskMetrics.cachedTokensRead} (${taskMetrics.cacheHitRatePct}% hit rate)`);
      console.log(`  Total output tokens: ${taskMetrics.totalOutputTokens}`);
      console.log(`  Total reasoning tokens: ${taskMetrics.totalReasoningTokens}`);
      console.log(`  Estimated task cost: $${taskMetrics.estimatedCostUsd}`);
      console.log(`===============================\n`);

      return {
        finalAnswer: this.finalAnswer || `Task ended: ${this.terminated || "unknown"}`,
        lastScreenshot: this.lastScreenshot,
        metrics: taskMetrics,
      };
    }

    const isJsonRunner = ["everfern", "openrouter", "ollama-cloud"].includes(this.client.provider) || !useToolCallRunner;

    if (isJsonRunner) {
      const agentName = this.client.provider === "everfern" ? "Everfern" : this.client.provider === "openrouter" ? "OpenRouter" : "ComputerUse";
      let step = 0;
      const history: { obs_text: string; image: string | null; reply: string }[] = [];
      let feedback = "";
      const KEEP_LAST_SCREENSHOTS = 2;
      const ACTION_DELAY = 1.5;
      let prevShotHash: string | null = null;
      let unchangedStreak = 0;
      let lastActionKind: string | null = null;

      const taskMetrics: TaskRunMetrics = {
        totalInputTokens: 0,
        cachedTokensRead: 0,
        totalOutputTokens: 0,
        totalReasoningTokens: 0,
        cacheHitRatePct: 0,
        stepCount: 0,
        success: false,
        estimatedCostUsd: 0,
      };

      while (step < this.maxTurns) {
        if (this.aborted || globalAbortManager.streamAborted || this.terminated || this.finalAnswer) break;
        step++;

        console.log(`\n[${agentName} Agent] Step ${step}/${this.maxTurns}`);
        onUpdate?.(`Turn ${step}/${this.maxTurns}...`);

        const img = await this.getScreenshotBase64();
        onProgress?.({
          type: "screenshot",
          toolCallId: this.toolCallId,
          timestamp: new Date().toISOString(),
          stepNumber: step,
          screenshot: {
            base64: img?.split(",")?.[1] || "",
            width: this.tool.lastViewport?.image_width || 1280,
            height: this.tool.lastViewport?.image_height || 720
          }
        } as any);

        let obsText = (step === 1 ? `Task: ${this.task}\n` : "");
        if (feedback) {
          obsText += `Result of your previous action: ${feedback}\n`;
        }
        obsText += `Step ${step}. Current screenshot:`;

        const messages = buildQwenMessages(history, obsText, img, KEEP_LAST_SCREENSHOTS);

        const CHAT_ONLY_ALIASES = new Set(["fern-1", "everfern-1", "fern"]);
        const modelName = this.client.provider === "everfern"
          ? (this.model && !CHAT_ONLY_ALIASES.has(this.model) ? this.model : "everfern-tars-v1")
          : (this.model || "openai/gpt-5.6-luna-pro");

        // Determine reasoning effort: escalate on unchanged screen or recovery
        const isHardStep = step === 1 || unchangedStreak >= 2;
        const currentEffort: "low" | "medium" | "high" = isHardStep ? "high" : "medium";

        console.log(`[ComputerUse] Querying ${agentName} model (${modelName}) effort=${currentEffort}...`);
        let rawResponse = "";
        let chatResponse: any = null;

        // Retry with exponential backoff (matches qwen.py call_model)
        let lastErr: string | null = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            chatResponse = await this.client.chat({
              messages,
              model: modelName,
              temperature: 0,
              maxTokens: 2048,
              reasoningEffort: currentEffort,
            });
            rawResponse = (chatResponse.content as string) || "";
            if (chatResponse.usage) {
              const promptTokens = chatResponse.usage.prompt_tokens || chatResponse.usage.promptTokens || 0;
              const completionTokens = chatResponse.usage.completion_tokens || chatResponse.usage.completionTokens || 0;
              taskMetrics.totalInputTokens += promptTokens;
              taskMetrics.totalOutputTokens += completionTokens;
            }
            lastErr = null;
            break;
          } catch (err: any) {
            lastErr = err.message || String(err);
            console.error(`[ComputerUse] API error (attempt ${attempt + 1}/3):`, lastErr);
            if (attempt < 2) {
              const backoff = 2 * (attempt + 1);
              console.log(`[ComputerUse] Retrying in ${backoff}s...`);
              await sleep(backoff);
            }
          }
        }

        if (lastErr) {
          console.error("[ComputerUse] All 3 API attempts failed:", lastErr);
          if (this.fallbackClient && this.fallbackClient !== this.client) {
            console.log("[ComputerUse] Primary client failed, falling back to runner client...");
            this.client = this.fallbackClient;
            this.model = this.fallbackClient.model || this.model;
            this.fallbackClient = undefined;
            continue;
          }
          feedback = `API error: ${lastErr}`;
          await sleep(2);
          continue;
        }

        console.log(`\n[RAW OUTPUT]\n${rawResponse}\n`);

        const cleanResponse = stripThinking(rawResponse);
        const { action, error: parseError } = parseJsonAction(cleanResponse);

        if (parseError) {
          console.warn(`[ComputerUse] Parse error: ${parseError}`);
          feedback = parseError;
          history.push({ obs_text: obsText, image: img, reply: rawResponse });
          const keepFrom = Math.max(0, history.length - (KEEP_LAST_SCREENSHOTS - 1));
          for (let i = 0; i < keepFrom; i++) {
            history[i].image = null;
          }
          continue;
        }

        if (action.thought) {
          console.log(`[THOUGHT] ${action.thought}`);
          onProgress?.({
            type: "reasoning",
            toolCallId: this.toolCallId,
            timestamp: new Date().toISOString(),
            stepNumber: step,
            content: action.thought
          });
        }
        console.log(`[ACTION] ${JSON.stringify(action)}`);

        if (action.action === "done") {
          console.log(`\n[TASK COMPLETE — done received: ${action.summary || ""}]`);
          this.finalAnswer = action.summary || "Task finished successfully";
          taskMetrics.success = true;
          break;
        }

        if (action.action === "fail") {
          console.log(`\n[TASK FAILED — fail received: ${action.reason || ""}]`);
          this.finalAnswer = action.reason || "Task failed";
          this.terminated = "failure";
          break;
        }

        onUpdate?.(`Executing ${action.action}...`);
        onProgress?.({
          type: "action",
          toolCallId: this.toolCallId,
          timestamp: new Date().toISOString(),
          stepNumber: step,
          action: { type: action.action, params: action, description: `${action.action}` }
        });

        lastActionKind = action.action;
        feedback = await this.executeSingleAction(action);
        console.log(`  [RESULT] ${feedback}`);

        await sleep(ACTION_DELAY);

        // Screen hash detection for silent failure (ported from tool-call runner)
        const postImg = await this.getScreenshotBase64();
        const currShotHash = computeScreenHash(postImg);
        const isPotentiallyStateChanging = lastActionKind && !["wait", "zoom"].includes(lastActionKind);
        if (prevShotHash !== null && prevShotHash === currShotHash && isPotentiallyStateChanging) {
          unchangedStreak++;
          console.warn(`[${agentName} Agent] Screen unchanged after ${lastActionKind} (streak: ${unchangedStreak})`);
          if (unchangedStreak >= 3) {
            feedback += " WARNING: Screen has not changed after your last 3 actions. Try a completely different approach.";
          }
        } else {
          unchangedStreak = 0;
        }
        prevShotHash = currShotHash;

        history.push({ obs_text: obsText, image: img, reply: rawResponse });
        const keepFrom = Math.max(0, history.length - (KEEP_LAST_SCREENSHOTS - 1));
        for (let i = 0; i < keepFrom; i++) {
          history[i].image = null;
        }
      }

      taskMetrics.stepCount = step;
      if (this.finalAnswer && !this.terminated) {
        taskMetrics.success = true;
      }

      return {
        finalAnswer: this.finalAnswer || `Task ended: ${this.terminated || "max turns reached"}`,
        lastScreenshot: this.lastScreenshot,
        metrics: taskMetrics,
      };
    } else {
      // Original execution loop
      let step = 0;
      const history: any[] = [];
      let noActionRetries = 0;
      let consecutiveErrors = 0;

      while (step <= this.maxTurns) {
        if (this.aborted || globalAbortManager.streamAborted || this.terminated || this.finalAnswer) break;
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
              if (this.history.length > this.historyWindow) this.history = this.history.slice(-this.historyWindow);
              consecutiveErrors = 0;
              if (this.terminated || this.finalAnswer) break;
              await sleep(1);
              continue;
            }

            noActionRetries++;
            if (noActionRetries <= 2 && !isFinalTurn) {
              console.warn(`[Dumb-Agent] Brain/HAND produced no executable action; retrying (${noActionRetries}/2)`);
              await sleep(1);
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
          if (this.fallbackClient && this.fallbackClient !== this.client) {
            console.log("[Dumb-Agent] Primary VLM client failed with connection error, falling back to runner client...");
            this.client = this.fallbackClient;
            this.model = this.fallbackClient.model || this.model;
            this.fallbackClient = undefined;
            consecutiveErrors = 0;
            continue;
          }
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
            await sleep(1);
            continue;
          }

          if (content.toLowerCase().includes("done") || content.toLowerCase().includes("complete")) {
             this.finalAnswer = content;
             break;
          }
          noActionRetries++;
          if (noActionRetries <= 2 && !isFinalTurn) {
            console.warn(`[Dumb-Agent] No executable action received from API; retrying with stricter instruction (${noActionRetries}/2)`);
            await sleep(1);
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
        await sleep(1);
      }

      return {
        finalAnswer:    this.finalAnswer ?? `Task ended: ${this.terminated ?? "unknown"}`,
        lastScreenshot: this.lastScreenshot,
      };
    }
  }

  private async executeSingleAction(action: any): Promise<string> {
    const kind = action.action;
    try {
      if (kind === "click" || kind === "double_click" || kind === "right_click") {
        const [x, y] = this.tool.normToScreen(action.x, action.y);
        console.log(`[Action] ${kind} at norm=(${action.x},${action.y}) -> screen=(${x},${y})`);
        this.tool.moveMouse(x, y);
        if (kind === "double_click") {
          this.tool.doubleClickAt(x, y);
        } else if (kind === "right_click") {
          this.tool.click(x, y, "right");
        } else {
          this.tool.click(x, y, "left");
        }
        return `${kind} executed at screen pixel (${x},${y}).`;
      }
      if (kind === "type") {
        if (robot) {
          robot.typeString(action.text);
        }
        if (this.tool.overlay) {
          this.tool.overlay.setStatus(`Typed: "${String(action.text).substring(0, 30)}"`);
        }
        return `Typed ${action.text.length} characters.`;
      }
      if (kind === "key") {
        const keys = Array.isArray(action.keys) ? action.keys : [String(action.keys)];
        this.tool.pressKeys(keys);
        return `Pressed ${keys.join("+")}.`;
      }
      if (kind === "scroll") {
        if (action.x != null && action.y != null) {
          const [x, y] = this.tool.normToScreen(action.x, action.y);
          this.tool.moveMouse(x, y);
        }
        // qwen.py convention: positive = up, negative = down
        // robotjs convention: positive = down, negative = up
        // Invert sign to match qwen.py/pyautogui convention
        const amt = Number(action.amount ?? -3);
        if (robot) {
          robot.scrollMouse(0, -amt * 100);
        }
        return "Scrolled.";
      }
      if (kind === "wait") {
        const sec = Math.min(Number(action.seconds ?? 1), 10);
        await sleep(sec);
        return "Waited.";
      }
      if (kind === "zoom") {
        await this.tool.call({ action: "zoom", coordinate: [action.x, action.y] });
        return `Zoomed in at (${action.x}, ${action.y}).`;
      }
    } catch (e: any) {
      return `ERROR executing ${kind}: ${e.message || e}`;
    }
    return "No-op.";
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

    // 1. Try clean JSON extraction (qwen.py style, stripping markdown ```json fences if present)
    const cleaned = raw.replace(/```(?:json)?/gi, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      try {
        const parsed = JSON.parse(cleaned.slice(start, end + 1));
        const action = this.actionObjectToString(parsed);
        if (action) {
          return [action];
        }
      } catch {}
    }

    // Direct JSON parse for arrays or objects
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
      /^zoom\s*\(\s*[^)]+\s*\)$/i,
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
    const x = Number(value.x ?? (coordinate ? coordinate[0] : NaN));
    const y = Number(value.y ?? (coordinate ? coordinate[1] : NaN));

    if (Number.isFinite(x) && Number.isFinite(y)) {
      const rx = Math.round(x);
      const ry = Math.round(y);
      if (action.includes("double")) return `double_click(${rx},${ry})`;
      if (action.includes("right")) return `right_click(${rx},${ry})`;
      if (action.includes("move")) return `move(${rx},${ry})`;
      if (action.includes("drag")) return `drag(${rx},${ry})`;
      if (action === "zoom") return `zoom(${rx},${ry})`;
      return `click(${rx},${ry})`;
    }

    if (action === "type") return `type("${String(value.text ?? value.content ?? "").replace(/"/g, '\\"')}")`;
    if (action === "answer") return `done()`;
    if (action === "wait") return `wait(${Number(value.seconds ?? value.time) || 1})`;
    if (action === "key") {
      const keys = Array.isArray(value.keys) ? value.keys : (value.key ? String(value.key).split("+") : ["enter"]);
      return `press(${keys.join("+")})`;
    }
    if (action === "scroll") {
      const amt = Number(value.amount ?? value.pixels ?? -3);
      return amt > 0 || value.direction === "up" ? "scroll(up)" : "scroll(down)";
    }
    if (action === "done" || action === "terminate" || action === "fail" || action === "finished") return `done()`;
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

  async dispatchAll(actions: string[], onUpdate?: any, onProgress?: any, step?: number) {
    this.releaseAll();
    for (const action of actions) {
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

    const coords = has(/^(?:click|move|drag|double[_\s]?click|right[_\s]?click|left[_\s]?click|zoom)\s*\(/, text) ? parseXy(text) : null;

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
      if (has(/zoom/i, text)) {
        await this.tool.call({ action: "zoom", coordinate: [x, y] });
      } else if (has(/double/i, text)) {
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
    const base    = this.messages.slice(0, this.baseCount);
    const dynamic = this.messages.slice(this.baseCount);
    const maxItems = this.historyWindow * 2;
    if (!force && dynamic.length <= maxItems) return;
    this.messages = [...base, ...dynamic.slice(-maxItems)];
  }
}

// ── Exports ───────────────────────────────────────────────────────────────────

let activeAgent: ComputerUseAgent | null = null;

export function abortComputerUse(): void {
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

  const mappedProvider = vlm?.model
    ? ((vlm.engine === "cloud" && vlm.provider === "ollama" ? "ollama-cloud" :
        vlm.engine === "cloud" && vlm.provider === "everfern" ? "everfern" :
        vlm.provider) as any)
    : undefined;

  let apiKey = vlm?.apiKey;
  if (!apiKey && mappedProvider && originalClient?.getFullConfig) {
    const origConfig = originalClient.getFullConfig() as any;
    apiKey = origConfig?.keys?.[`vlm-${mappedProvider}`] ||
             origConfig?.keys?.[mappedProvider] ||
             (origConfig?.provider === mappedProvider ? origConfig?.apiKey : undefined);
  }

  const client = vlm?.model
    ? new AIClient({
        provider: mappedProvider,
        apiKey:   apiKey,
        baseUrl:  (mappedProvider === 'everfern' || mappedProvider === 'openrouter') ? undefined : vlm.baseUrl,
        model:    vlm.model,
      })
    : originalClient;

  const model = vlm?.model ?? originalClient.model ?? "unknown";
  tool.client = client;

  return createToolWithClient(client, tool, model, originalClient !== client ? originalClient : undefined);
}

function createToolWithClient(
  client: AIClient,
  tool: ComputerUseTool,
  model: string,
  fallbackClient?: AIClient,
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
          const tempAgent = new ComputerUseAgent(client, tool, model, thought || "Execute actions", 0, 200, 12, toolCallId ?? "");
          await tempAgent.dispatchAll(actions, onUpdate, (ev: any) => {
            emitEvent?.({
              type: "subagent-progress",
              toolCallId: toolCallId ?? "",
              timestamp: new Date().toISOString(),
              data: ev,
            });
          });
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

      const agent = new ComputerUseAgent(client, tool, model, task, 0, 200, 12, toolCallId ?? "", fallbackClient);
      activeAgent = agent;

      try {
        const { finalAnswer, lastScreenshot, metrics } = await agent.run(
          msg => onUpdate?.(msg),
          event => emitEvent?.({ type: "subagent-progress", toolCallId: toolCallId ?? "", timestamp: new Date().toISOString(), data: event }),
        );
        const b64 = lastScreenshot?.split(",")?.[1] || "";
        const isError = !finalAnswer ||
          finalAnswer.startsWith("Unable to reach VLM provider") ||
          finalAnswer.toLowerCase().includes("econnrefused") ||
          agent.terminated === "error" ||
          agent.terminated === "aborted";

        return {
          success: !isError,
          output: finalAnswer,
          error: isError ? finalAnswer : undefined,
          base64Image: b64,
          data: { task, finalAnswer, screenshot: b64, metrics }
        };
      } finally {
        console.log("[ComputerUse] Task finished, cleaning up activeAgent and overlay");
        if (activeAgent === agent) activeAgent = null;
        if (tool.overlay) {
          tool.overlay.hide();
        }
      }
    },

    abort() {
      activeAgent?.abort();
      activeAgent = null;
      if (tool.overlay) {
        tool.overlay.hide();
      }
    },
  };
}

export async function captureScreen(): Promise<{ b64: string; w: number; h: number; physW: number; physH: number }> {
  const home = process.env.USERPROFILE ?? process.env.HOME ?? "";
  const tool = new ComputerUseTool(path.join(home, ".everfern", "screenshots"));
  const obs  = await tool.captureObservation();
  const b64  = (obs.screenshot as string)?.split(",")?.[1] || "";
  const w    = (obs.display as any)?.width || 1920;
  const h    = (obs.display as any)?.height || 1080;
  return { b64, w, h, physW: w, physH: h };
}
