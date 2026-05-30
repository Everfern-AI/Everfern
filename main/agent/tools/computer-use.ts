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

// ── Optional native deps ─────────────────────────────────────────────────────

let robot: any = null;
try { robot = require("@jitsi/robotjs"); }
catch { console.warn("[ComputerUse] robotjs unavailable"); }

let sharp: typeof import("sharp") | null = null;
try { sharp = require("sharp"); }
catch { console.warn("[ComputerUse] sharp unavailable — cursor circle disabled"); }

let screenshotDesktop: any = null;
try { screenshotDesktop = require("screenshot-desktop"); }
catch { console.warn("[ComputerUse] screenshot-desktop unavailable"); }

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
      "Use a mouse and keyboard to interact with a computer, and take screenshots.",
      "* This is an interface to a desktop GUI. You do not have access to a terminal or applications menu. You must click on desktop icons to start applications.",
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

// ── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an automation agent with direct access to a GUI computer.
- Be precise and avoid unnecessary movements.
- Always inspect the most recent screenshot before clicking.
- If an application needs time to load, wait before taking more actions.
- You must finish by calling action=answer with the final response and action=terminate with success/failure.`;

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
      console.warn("[ComputerUse] robotjs unavailable - OS automation will fail");
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
      let [x, y] = coords;

      // Apply tars-test.py scaling logic
      if (!robot) {
        throw new Error(`robotjs unavailable - cannot execute click`);
      }

      const screenSize = robot.getScreenSize();
      const SCREEN_WIDTH = screenSize.width;
      const SCREEN_HEIGHT = screenSize.height;

      // Scale coordinates if they're > screen dimensions (normalized 0-1000)
      const rx = Math.abs(x) > SCREEN_WIDTH ? Math.floor((Math.abs(x) / 1000.0) * SCREEN_WIDTH) : x;
      const ry = Math.abs(y) > SCREEN_HEIGHT ? Math.floor((Math.abs(y) / 1000.0) * SCREEN_HEIGHT) : y;

      console.log(`[ComputerUse] Click: input=(${x},${y}) screen=(${SCREEN_WIDTH}x${SCREEN_HEIGHT}) final=(${rx},${ry})`);

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
      const parts = keys.map(k => KEY_MAP[k.toLowerCase()] ?? k.toLowerCase());
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

    // 1. Capture
    let rawBuffer: Buffer;

    try {
      if (screenshotDesktop) {
        // Try to get displays, but fall back to default if listDisplays fails
        let display: any = null;
        try {
          const displays = await screenshotDesktop.listDisplays?.();
          if (displays && displays.length > 0) {
            display = displays[this.monitorIndex - 1] ?? displays[0];
          }
        } catch (displayErr) {
          console.warn("[ComputerUse] listDisplays failed, using default display:", displayErr);
          // Fall through to use default display
        }

        rawBuffer = await screenshotDesktop({ filename: imgPath, screen: display?.id });
        if (!rawBuffer) rawBuffer = fs.readFileSync(imgPath);
      } else {
        throw new Error("screenshot-desktop unavailable");
      }
    } catch (err) {
      console.error("[ComputerUse] Screenshot failed:", err);
      return { ...payload, status: "error", detail: "Screenshot failed." };
    }

    // 2. Get dimensions from PNG header
    const { width: rawW, height: rawH } = this.pngDimensions(rawBuffer);

    // 3. Cursor position
    const cursor = robot ? robot.getMousePos() : { x: 0, y: 0 };

    // Monitor offset (best-effort via Electron screen, fallback to 0)
    let monLeft = 0, monTop = 0;
    try {
      const { screen } = require("electron");
      const displays = screen.getAllDisplays();
      const d = displays[this.monitorIndex - 1] ?? screen.getPrimaryDisplay();
      monLeft = d.bounds.x;
      monTop  = d.bounds.y;
    } catch { /* non-Electron env */ }

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
        const jpeg = await sharp(rawBuffer)
          .composite([{ input: Buffer.from(svgCircle), top: 0, left: 0 }])
          .jpeg({ quality: this.imageQuality })
          .toBuffer();
        encoded = jpeg.toString("base64");
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
      screenshot:      `data:image/jpeg;base64,${encoded}`,
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

    if (!dw || !dh) {
      console.warn("[Coord] Viewport not initialized - using offset-only fallback");
    }

    if (dw && dh) {
      if (x <= 1000 && y <= 1000) {
        // Normalised 0–1000 coords
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

    let step = 0;
    const history: any[] = [];

    // Allow one extra step for a "force finish" synthesis if limit reached
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

      // ── FORCE FINISH PROMPT ──
      const isFinalTurn = step > this.maxTurns;
      let finalTurnPrompt = "";
      if (isFinalTurn) {
        console.log(`[ComputerUse] 🚨 Max turns (${this.maxTurns}) reached. FORCING FINAL ANSWER STEP.`);
        finalTurnPrompt = `\n\n[URGENT: FINAL TURN]: You have reached the maximum turn limit. DO NOT take any more actions (no click, type, etc.). Instead, provide the FINAL ANSWER to the user now. Use the 'answer' action or simply state your final summary.`;
      }

      let response: any;
      try {
        // [Independent TARS] No tools, no models, no system prompt.
        // Just task + screenshot + history.
        response = await this.client.chat({
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: `Task: ${this.task}\nStep: ${step}${finalTurnPrompt}` },
                { type: "image_url", image_url: { url: img } }
              ]
            }
          ],
          // Special model identifier to trigger Direct TARS mode in API
          model: "everfern-tars-v1",
          temperature: 0.1
        });
      } catch (err: any) {
        console.error("[Dumb-Agent] API error:", err);
        if (step === this.maxTurns) break;
        continue;
      }

      // The API now returns a list of actions directly in content or tool_calls
      // but the user wants "just pixels back". We'll handle the synthesized response.
      const content: string = typeof response.content === "string" ? response.content : "";
      if (content) {
        console.log(`[Dumb-Agent] Brain: ${content}`);
        onProgress?.({ type: "reasoning", toolCallId: this.toolCallId, timestamp: new Date().toISOString(), stepNumber: step, content });
      }

      const toolCalls: any[] = response.toolCalls || [];
      if (!toolCalls.length) {
        if (content.toLowerCase().includes("done") || content.toLowerCase().includes("complete")) {
           this.finalAnswer = content;
           break;
        }
        // If no actions and not done, something is wrong
        console.warn("[Dumb-Agent] No actions received from API");
        break;
      }

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

          // We don't send tool results back in a chat-like way,
          // we just loop and send a fresh screenshot.
        } catch (toolErr) {
          console.error("[Dumb-Agent] Tool error:", toolErr);
        }
      }

      if (this.terminated || this.finalAnswer) break;
      await sleep(1); // Wait for screen state to stabilize
    }

    return {
      finalAnswer:    this.finalAnswer ?? `Task ended: ${this.terminated ?? "unknown"}`,
      lastScreenshot: this.lastScreenshot,
    };
  }

  private parseModelOutput(raw: string): string[] {
    if (!raw || !raw.trim()) return [];
    raw = raw.trim();

    // Try JSON parse
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map(x => String(x).trim());
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
      /^move\s*\(\s*[^)]+\s*\)$/i,
      /^smooth\s*\(\s*[^)]+\s*\)$/i,
      /^look\s*\(\s*[^)]+\s*\)$/i,
      /^drag\s*\(\s*[^)]+\s*\)$/i,
      /^press\s*\(\s*[^)]+\s*\)$/i,
      /^type\s*\(\s*[^)]+\s*\)$/i,
      /^scroll\s*\(\s*[^)]+\s*\)$/i,
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
      // Handle click(start_box='(896,1034)') -> click(1034,896)
      const startBoxMatch = line.match(/click\s*\(\s*start_box\s*=\s*['"]?\(?(\d+)\s*,\s*(\d+)\)?['"]?\s*\)/i);
      if (startBoxMatch) {
        line = `click(${startBoxMatch[2]},${startBoxMatch[1]})`;
      }

      // Handle click((896,1034)) -> click(1034,896)
      const nestedMatch = line.match(/click\s*\(\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)\s*\)/i);
      if (nestedMatch) {
        line = `click(${nestedMatch[2]},${nestedMatch[1]})`;
      }

      if (validPatterns.some(p => p.test(line))) {
        validated.push(line);
      }
    }
    return validated;
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

  private async dispatchAction(text: string): Promise<any> {
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

    const coords = (has(/\((?:click|move|drag|double[_\s]?click)\s*\(/, text)) ? parseXy(text) : null;

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
