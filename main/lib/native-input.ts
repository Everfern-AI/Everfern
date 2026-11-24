/**
 * Mouse, keyboard and screenshots for the computer-use tool, done by the Tauri shell
 * (src-tauri/src/input.rs and capture.rs) instead of the @jitsi/robotjs and sharp addons.
 *
 * Each call runs the shell exe in a short-lived CLI mode, the way the sidecar's
 * `screen` and `desktopCapturer` already do. Only used under the Tauri shell on
 * Windows; everywhere else callers keep loading robotjs and sharp.
 */
import { execFile, spawnSync } from "child_process";

export function hasNativeInput(): boolean {
  return process.env.EVERFERN_SHELL === "tauri" && !!process.env.EF_NATIVE_EXE && process.platform === "win32";
}

type InputOp = Record<string, unknown>;

function runInput(ops: InputOp[]): any {
  const result = spawnSync(process.env.EF_NATIVE_EXE!, ["--ef-input"], {
    input: JSON.stringify(ops),
    windowsHide: true,
    // Typing long text sends one key at a time; give it room.
    timeout: 60_000,
    maxBuffer: 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const reason = result.stderr?.toString().trim() || `exit code ${result.status}`;
    throw new Error(`Native input failed: ${reason}`);
  }
  const out = result.stdout.toString().trim();
  return out ? JSON.parse(out) : null;
}

function modifierList(modifiers?: string | string[]): string[] {
  if (!modifiers) return [];
  return Array.isArray(modifiers) ? modifiers : [modifiers];
}

/** The part of the @jitsi/robotjs API that computer-use calls. Coordinates are DIPs. */
export interface RobotLike {
  setMouseDelay(ms: number): void;
  moveMouse(x: number, y: number): void;
  dragMouse(x: number, y: number): void;
  mouseToggle(direction?: "down" | "up", button?: string): void;
  mouseClick(button?: string, double?: boolean): void;
  scrollMouse(x: number, y: number): void;
  typeString(text: string): void;
  keyTap(key: string, modifiers?: string | string[]): void;
  keyToggle(key: string, direction: "down" | "up", modifiers?: string | string[]): void;
  getMousePos(): { x: number; y: number };
  getScreenSize(): { width: number; height: number };
}

export function createNativeRobot(): RobotLike {
  // robotjs waits this long after every mouse action; keep doing that.
  let mouseDelay = 10;
  const mouse = (op: InputOp) => runInput(mouseDelay > 0 ? [op, { op: "sleep", ms: mouseDelay }] : [op]);
  return {
    setMouseDelay(ms) { mouseDelay = Math.max(0, Math.round(Number(ms) || 0)); },
    moveMouse(x, y) { mouse({ op: "move", x, y }); },
    // With a button held, moving is dragging.
    dragMouse(x, y) { mouse({ op: "move", x, y }); },
    mouseToggle(direction = "down", button = "left") { mouse({ op: "button", button, down: direction === "down" }); },
    mouseClick(button = "left", double = false) { mouse({ op: "click", button, double: !!double }); },
    scrollMouse(x, y) { runInput([{ op: "scroll", x, y }]); },
    typeString(text) { runInput([{ op: "type", text: String(text ?? "") }]); },
    keyTap(key, modifiers) { runInput([{ op: "key", key, modifiers: modifierList(modifiers) }]); },
    keyToggle(key, direction, modifiers) {
      runInput([{ op: "keyToggle", key, down: direction === "down", modifiers: modifierList(modifiers) }]);
    },
    getMousePos() { return runInput([{ op: "pos" }]); },
    getScreenSize() { return runInput([{ op: "size" }]); },
  };
}

export interface NativeScreenshot {
  /** Monitor size in physical pixels. */
  physicalWidth: number;
  physicalHeight: number;
  /** Size of `png` after cropping and shrinking. */
  width: number;
  height: number;
  /** Base64 PNG. */
  png: string;
}

/**
 * Captures monitor `index` (0-based, primary first, same order as `screen.getAllDisplays()`).
 * `crop` is [left, top, width, height] in physical pixels relative to the monitor; the result
 * is then shrunk to at most `maxWidth` wide.
 */
export function nativeScreenshot(
  index: number,
  opts: { maxWidth?: number; crop?: [number, number, number, number] } = {},
): Promise<NativeScreenshot> {
  const args = ["--ef-screenshot", String(Math.max(0, Math.floor(index) || 0))];
  if (opts.maxWidth) args.push("--max-width", String(Math.round(opts.maxWidth)));
  if (opts.crop) args.push("--crop", opts.crop.map((n) => Math.round(n)).join(","));
  return new Promise((resolve, reject) => {
    execFile(
      process.env.EF_NATIVE_EXE!,
      args,
      { windowsHide: true, timeout: 20_000, maxBuffer: 128 * 1024 * 1024, encoding: "utf8" },
      (error, stdout, stderr) => {
        if (error) return reject(new Error(`Native screenshot failed: ${String(stderr || error.message).trim()}`));
        try {
          resolve(JSON.parse(stdout));
        } catch (e) {
          reject(e);
        }
      },
    );
  });
}
