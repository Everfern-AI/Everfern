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
* IMPORTANT: Complete the given task EXACTLY as stated. DO NOT make any assumptions that completing a similar task is correct.  If you can't find what you're looking for, SCROLL to find it.
* If you want to edit some text, ONLY USE THE \`type_text_at\` tool.
* The given task may already be completed. If so, there is no need to do anything.`;

// Compact prompt for GPT-5.4 — saves ~200 tokens per turn vs the full Gemini prompt
const GPT5_SYSTEM_PROMPT = `You are a Windows desktop automation agent. Use the provided tools to complete the task.
Rules:
- Use scroll_document/scroll_at if content may be below the fold before concluding something is missing.
- Open apps using the Start menu (key: win) if not visible on screen.
- Save changes unless explicitly told not to.
- Do nothing if the task is already complete.
- To answer the user, output ONLY the answer text (no tools, no formatting).`;

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

function stripThinking(text: string): string {
  let clean = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  clean = clean.replace(/<\/?think>/gi, "");
  return clean.trim();
}

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
    if (screenshot)   content.push({ type: "image_url", image_url: { url: screenshot, detail: "low" } });
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
  }

  private async executeActionString(text: string): Promise<void> {
    text = text.trim();
    if (!text || text.startsWith("#")) return;

    // Normalize start_box format
    const startBoxMatch = text.match(/click\s*\(\s*start_box\s*=\s*['"]?\(?(\d+)\s*,\s*(\d+)\)?['"]?\s*\)/i);
    if (startBoxMatch) {
      text = `click(${startBoxMatch[1]},${startBoxMatch[2]})`;
    }

    // Parse coordinates
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
    const coords = parseXy(text);

    if (coords && has(/click/i, text)) {
      // Apply scaling logic
      if (!robot) {
        throw new Error(`robotjs unavailable - cannot execute click`);
      }

      const [rx, ry] = this.absoluteXy(coords);

      console.log(`[ComputerUse] Click: input=(${coords[0]},${coords[1]}) final=(${rx},${ry})`);

      robot.moveMouse(rx, ry);
      robot.mouseClick("left");
      return;
    }

    if (has(/^type\s*\(\s*(?:content\s*=\s*)?['\"]?(.+?)['\"]?\s*\)/i, text)) {
      const typeMatch = text.match(/type\s*\(\s*(?:content\s*=\s*)?['\"]?(.+?)['\"]?\s*\)/i);
      if (typeMatch) {
        await this.call({ action: "type", text: typeMatch[1] });
        return;
      }
    }

    if (has(/^press\s*\(\s*([^)]+)\s*\)\s*$/i, text)) {
      const key = text.match(/press\s*\(\s*([^)]+)\s*\)/i)![1].trim().toLowerCase();
      await this.call({ action: "key", keys: key.includes("+") ? key.split("+") : [key] });
      return;
    }

    // ── scroll(direction: down|up|left|right [, coordinate: [x, y]] [, amount: N]) ──
    if (has(/^scroll\s*\(/i, text)) {
      const dirMatch  = text.match(/direction\s*[:=]\s*["']?(up|down|left|right)["']?/i);
      const coordMatch = text.match(/coordinate\s*[:=]\s*\[?\s*(-?\d+)\s*,\s*(-?\d+)\s*\]?/i);
      const amtMatch  = text.match(/(?:amount|pixels)\s*[:=]\s*(-?\d+)/i);

      const direction = dirMatch ? dirMatch[1].toLowerCase() : "down";
      const pixels    = amtMatch ? parseInt(amtMatch[1]) : 300; // default 300px = ~3 ticks
      const isHoriz   = direction === "left" || direction === "right";
      const sign      = (direction === "down" || direction === "right") ? pixels : -pixels;

      const scrollParams: any = { action: isHoriz ? "hscroll" : "scroll", pixels: sign };
      if (coordMatch) scrollParams.coordinate = [parseInt(coordMatch[1]), parseInt(coordMatch[2])];

      await this.call(scrollParams);
      return;
    }

    // ── drag(startCoordinate: [x1,y1], endCoordinate: [x2,y2]) ──────────────────
    if (has(/^drag\s*\(/i, text)) {
      const coords = [...text.matchAll(/\[?\s*(-?\d+)\s*,\s*(-?\d+)\s*\]?/g)];
      if (coords.length >= 2 && robot) {
        const [sx, sy] = [parseInt(coords[0][1]), parseInt(coords[0][2])];
        const [ex, ey] = [parseInt(coords[1][1]), parseInt(coords[1][2])];
        robot.moveMouse(sx, sy);
        robot.mouseToggle("down", "left");
        robot.moveMouse(ex, ey);
        robot.mouseToggle("up", "left");
        console.log(`[ComputerUse] Drag from (${sx},${sy}) to (${ex},${ey})`);
      } else {
        console.warn(`[ComputerUse] drag: could not parse coordinates from: ${text}`);
      }
      return;
    }

    // ── hover(coordinate: [x, y]) ────────────────────────────────────────────────
    if (has(/^(?:hover|move_to|mouse_move)\s*\(/i, text)) {
      const coordMatch = text.match(/\[?\s*(-?\d+)\s*,\s*(-?\d+)\s*\]?/);
      if (coordMatch && robot) {
        robot.moveMouse(parseInt(coordMatch[1]), parseInt(coordMatch[2]));
        console.log(`[ComputerUse] Hover to (${coordMatch[1]},${coordMatch[2]})`);
      }
      return;
    }

    // ── wait(time: N) ────────────────────────────────────────────────────────────
    if (has(/^wait\s*\(/i, text)) {
      const numMatch = text.match(/(\d+(?:\.\d+)?)/);
      const secs = numMatch ? parseFloat(numMatch[1]) : 1;
      await sleep(secs);
      console.log(`[ComputerUse] Waited ${secs}s`);
      return;
    }

    // ── screenshot() / observe() ─────────────────────────────────────────────────
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
        win: "command", command: "command",
        enter: "enter", return: "enter",
        escape: "escape", esc: "escape",
        tab: "tab", delete: "delete", del: "delete",
        backspace: "backspace", space: "space",
        up: "up", down: "down", left: "left", right: "right",
        home: "home", end: "end", pageup: "pageup", pagedown: "pagedown",
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

  private async attachScreenshot(payload: Record<string, any>): Promise<Record<string, any>> {
    const imgPath = path.join(this.screenshotDir, `${nowTs()}.png`);

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

    let encoded: string;
    if (sharp) {
      try {
        const svgCircle = `
          <svg width="${rawW}" height="${rawH}" xmlns="http://www.w3.org/2000/svg">
            <circle cx="${relX}" cy="${relY}" r="${radius}"
                    fill="none" stroke="red" stroke-width="4"/>
            <circle cx="${relX}" cy="${relY}" r="4" fill="yellow"/>
          </svg>`;
        const webp = await sharp(rawBuffer)
          .composite([{ input: Buffer.from(svgCircle), top: 0, left: 0 }])
          .webp({ quality: 75 })
          .toBuffer();
        encoded = webp.toString("base64");
      } catch (e) {
        console.warn("[ComputerUse] sharp composite failed, skipping cursor circle:", e);
        encoded = rawBuffer.toString("base64");
      }
    } else {
      encoded = rawBuffer.toString("base64");
    }

    // 5. Compute display-scale dims for viewport
    const newW = rawW;
    const newH = rawH;

    console.log(`[Screenshot] ${imgPath} cursor=(${cursor.x}, ${cursor.y})`);

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
      screenshot:      `data:image/webp;base64,${encoded}`,
      screenshot_path: imgPath,
      cursor,
      display:         { width: rawW, height: rawH },
      downscaled_size: { width: newW, height: newH },
    };
  }

  // ── Coordinate transform (identical logic to Python) ─────────────────────────

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

    if (!dw || !dh) {
      console.warn("[Coord] Viewport not initialized - using offset-only fallback");
    }

    if (dw && dh) {
      if (isNormalized && x <= 1000 && y <= 1000) {
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

  private REASONER_MODEL = "qwen/qwen3-vl-235b-a22b-instruct";
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
  ): Promise<{ finalAnswer: string; lastScreenshot?: string }> {

    const isGemini = this.client.provider === "gemini" || this.model.toLowerCase().includes("gemini");
    const isGpt5 = this.model.toLowerCase().includes("gpt-5") || this.model.toLowerCase().includes("openai/gpt-5");
    const useToolCallRunner = isGemini || isGpt5;

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

      const agentName = isGpt5 ? "GPT-5" : "Gemini";
      const systemPrompt = isGpt5 ? GPT5_SYSTEM_PROMPT : GEMINI_SYSTEM_PROMPT;
      // Token budget: GPT-5.4 is expensive — cap to 512 per turn; Gemini uses default
      const maxTokensPerTurn = isGpt5 ? 512 : undefined;

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
          await sleep(3);
          continue;
        }

        const content = typeof chatResponse.content === "string" ? chatResponse.content : "";
        const toolCalls = chatResponse.toolCalls || [];

        console.log(`[Gemini Agent] Content: ${content}`);
        console.log(`[Gemini Agent] Tool Calls:`, JSON.stringify(toolCalls));

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
          console.log("[Gemini Agent] No tool calls, task finished.");
          this.finalAnswer = content || "Task finished.";
          break;
        }

        // Check safety decision / user confirmation requirement
        const safetyDecision = chatResponse.safetyDecision as any;
        const requiresConfirmation = safetyDecision && (
          safetyDecision === 'require_confirmation' ||
          safetyDecision === 'OFF-NOMINAL' ||
          (typeof safetyDecision === 'object' && (
            safetyDecision.decision === 'require_confirmation' ||
            safetyDecision.decision === 'OFF-NOMINAL'
          ))
        );

        let userConfirmed = true;
        if (requiresConfirmation) {
          console.log("[Gemini Agent] Action requires confirmation. Prompting user...");
          onUpdate?.("⚠️ Action requires security confirmation...");
          try {
            const { dialog, BrowserWindow } = require("electron");
            const win = BrowserWindow.getAllWindows()[0];
            const explanation = typeof safetyDecision === 'object' && (safetyDecision as any).explanation
              ? `\n\nExplanation: ${(safetyDecision as any).explanation}`
              : "";
            const dialogResponse = await dialog.showMessageBox(win || undefined, {
              type: "warning",
              title: "EverFern Security Authorization",
              message: `Gemini has requested an action that requires your confirmation.${explanation}\n\nDo you want to authorize this action?`,
              buttons: ["Approve", "Deny"],
              defaultId: 0,
              cancelId: 1
            });
            userConfirmed = dialogResponse.response === 0;
            console.log(`[Gemini Agent] User confirmation result: ${userConfirmed ? "Approved" : "Denied"}`);
          } catch (dialogErr) {
            console.error("[Gemini Agent] Failed to show confirmation dialog:", dialogErr);
            userConfirmed = false;
          }
        }

        const results = [];
        for (const tc of toolCalls) {
          if (this.aborted || globalAbortManager.streamAborted) break;
          
          console.log(`  Executing Gemini Action: ${tc.name}`);
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

            if (fname === "open_web_browser") {
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
            } else if (fname === "click_at") {
              if (args.x != null && args.y != null) {
                await this.tool.call({ action: "left_click", coordinate: [args.x, args.y] });
              } else {
                throw new Error("x and y are required for click_at");
              }
            } else if (fname === "hover_at") {
              if (args.x != null && args.y != null) {
                await this.tool.call({ action: "mouse_move", coordinate: [args.x, args.y] });
              } else {
                throw new Error("x and y are required for hover_at");
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
            } else if (fname === "key_combination") {
              if (args.keys) {
                const keysList = args.keys.toLowerCase().split("+");
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
            } else if (fname === "scroll_at") {
              if (args.x != null && args.y != null) {
                await this.tool.call({ action: "mouse_move", coordinate: [args.x, args.y] });
                await sleep(0.2);
                const dir = typeof args.direction === "string" ? args.direction.toLowerCase() : "down";
                const mag = args.magnitude != null ? Number(args.magnitude) : 800;
                if (dir === "up" || dir === "down") {
                  await this.tool.call({ action: "scroll", pixels: dir === "up" ? mag : -mag });
                } else {
                  await this.tool.call({ action: "hscroll", pixels: dir === "left" ? mag : -mag });
                }
              } else {
                throw new Error("x and y are required for scroll_at");
              }
            } else if (fname === "drag_and_drop") {
              if (args.x != null && args.y != null && args.destination_x != null && args.destination_y != null) {
                await this.tool.call({
                  action: "drag",
                  start_coordinate: [args.x, args.y],
                  coordinate: [args.destination_x, args.destination_y]
                });
              } else {
                throw new Error("x, y, destination_x, and destination_y are required for drag_and_drop");
              }
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
        await sleep(1);
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

        await sleep(1);
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

        const modelName = this.client.provider === "everfern"
          ? (this.model && this.model !== "fern-1" ? this.model : "everfern-tars-v1")
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
          await sleep(3);
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
            await sleep(1);
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
          await sleep(1);
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
          await sleep(0.3);
        }

        history.push({ thought, actions: dispatched, screenshot: img });

        if (done) {
          console.log("\n[TASK COMPLETE — finished() called]");
          this.finalAnswer = "Task finished successfully via finished()";
          break;
        }

        const sig = actions.join("|");
        if (sig === lastActionSig) {
          stuckCount++;
        } else {
          stuckCount = 0;
        }
        lastActionSig = sig;

        if (stuckCount >= MAX_STUCK) {
          console.log(`\n[STUCK] Same actions repeated ${MAX_STUCK}x — pressing Escape to recover...`);
          if (robot) {
            robot.keyTap("escape");
          }
          stuckCount = 0;
        }

        await sleep(1);
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

  async dispatchAll(actions: string[], onUpdate?: any, onProgress?: any, step?: number) {
    this.releaseAll();
    for (const action of actions) {
      console.log(`  [EXEC] ${action}`);
      onUpdate?.(`Executing ${action}...`);

      onProgress?.({
        type: "action",
        toolCallId: this.toolCallId,
        timestamp: new Date().toISOString(),
        stepNumber: step,
        action: { type: action, params: {}, description: action },
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
        try {
          // Create a temporary agent just to execute the actions
          const tempAgent = new ComputerUseAgent(client, tool, model, "Execute actions", 0, 200, 12, toolCallId ?? "");
          await tempAgent.dispatchAll(actions, onUpdate, emitEvent);
          const obs = await tool.captureObservation();
          const b64 = (obs.screenshot as string)?.split(",")?.[1] || "";
          return { success: true, output: "Actions executed", base64Image: b64, data: { actions, screenshot: b64 } };
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
