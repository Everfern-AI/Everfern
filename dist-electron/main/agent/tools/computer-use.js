"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.abortComputerUse = abortComputerUse;
exports.createComputerUseTool = createComputerUseTool;
exports.captureScreen = captureScreen;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const crypto = __importStar(require("crypto"));
const child_process_1 = require("child_process");
const electron_1 = require("electron");
const ai_client_1 = require("../../lib/ai-client");
const abort_manager_1 = require("../runner/abort-manager");
// sharp is an optional native module — load lazily so a missing binary doesn't crash startup
let sharp = null;
try {
    sharp = require('sharp');
}
catch {
    console.warn('[ComputerUse] sharp unavailable — image processing disabled');
}
// ── Native Automation ────────────────────────────────────────────────────────
let robot = null;
try {
    robot = require('@jitsi/robotjs');
}
catch {
    console.warn('[ComputerUse] robotjs unavailable — falls back to shell');
}
// ── Progress Event Emitter ──────────────────────────────────────────────────
/**
 * Manages buffering and flushing of sub-agent progress events with timeline branch support.
 *
 * Implements efficient event transmission with:
 * - Time-based flushing (16ms intervals for ~60fps)
 * - Size-based flushing (immediate flush at 10 events)
 * - Timeline branch event prioritization (branch events flush immediately)
 * - Graceful error handling (serialization failures don't crash agent)
 * - Enhanced metadata for timeline visualization
 *
 * Requirements: 1.1, 1.2, 6.1, 6.2, 7.1, 7.2, 7.3, 7.4, 7.5
 */
class ProgressEventEmitter {
    toolCallId;
    sender;
    timelineBranchMetadata;
    buffer = [];
    flushTimer = null;
    FLUSH_INTERVAL_MS = 16; // ~60fps
    MAX_BUFFER_SIZE = 10;
    PRIORITY_EVENT_TYPES = new Set([
        'branch_start', 'branch_complete', 'branch_abort', 'complete', 'abort'
    ]);
    constructor(toolCallId, sender, timelineBranchMetadata) {
        this.toolCallId = toolCallId;
        this.sender = sender;
        this.timelineBranchMetadata = timelineBranchMetadata;
    }
    /**
     * Emit a progress event with timeline branch support.
     *
     * Adds the event to the buffer and schedules a flush if not already scheduled.
     * Timeline branch events (branch_start, branch_complete, branch_abort) are flushed immediately.
     * If the buffer size reaches MAX_BUFFER_SIZE, flushes immediately.
     * Automatically injects timeline branch metadata if configured.
     *
     * Requirements: 1.1, 1.2, 6.1, 6.2, 7.2, 7.4
     */
    emit(event) {
        // Inject timeline branch metadata if configured and not already present
        if (this.timelineBranchMetadata && !event.timelineBranch) {
            event.timelineBranch = {
                parentId: this.timelineBranchMetadata.parentId,
                agentType: this.timelineBranchMetadata.agentType,
                branchLevel: this.timelineBranchMetadata.branchLevel,
                sessionId: this.timelineBranchMetadata.sessionId,
                taskDescription: this.timelineBranchMetadata.taskDescription,
                branchStatus: this.mapEventTypeToBranchStatus(event.type),
            };
        }
        // Add event to buffer
        this.buffer.push(event);
        // Flush immediately for priority events (timeline branch events)
        if (this.PRIORITY_EVENT_TYPES.has(event.type)) {
            this.flush();
        }
        else if (this.buffer.length >= this.MAX_BUFFER_SIZE) {
            // Flush immediately if buffer size >= MAX_BUFFER_SIZE
            this.flush();
        }
        else {
            // Schedule flush if not already scheduled
            this.scheduleFlush();
        }
    }
    /**
     * Map event type to branch status for timeline visualization.
     */
    mapEventTypeToBranchStatus(eventType) {
        switch (eventType) {
            case 'branch_start':
            case 'step':
            case 'reasoning':
            case 'action':
            case 'screenshot':
            case 'branch_update':
                return 'running';
            case 'branch_complete':
            case 'complete':
                return 'completed';
            case 'branch_abort':
            case 'abort':
                return 'aborted';
            default:
                return 'running';
        }
    }
    /**
     * Emit a timeline branch start event.
     *
     * Requirements: 1.1, 1.2
     */
    emitBranchStart(taskDescription) {
        this.emit({
            type: 'branch_start',
            toolCallId: this.toolCallId,
            timestamp: new Date().toISOString(),
            content: taskDescription || 'Subagent branch started',
            timelineBranch: {
                ...this.timelineBranchMetadata,
                branchStatus: 'running',
                taskDescription: taskDescription || this.timelineBranchMetadata?.taskDescription,
            },
        });
    }
    /**
     * Emit a timeline branch update event.
     *
     * Requirements: 6.1, 6.2
     */
    emitBranchUpdate(content, stepNumber, totalSteps) {
        this.emit({
            type: 'branch_update',
            toolCallId: this.toolCallId,
            timestamp: new Date().toISOString(),
            content,
            stepNumber,
            totalSteps,
            timelineBranch: {
                ...this.timelineBranchMetadata,
                branchStatus: 'running',
            },
        });
    }
    /**
     * Emit a timeline branch complete event.
     *
     * Requirements: 1.1, 1.2
     */
    emitBranchComplete(result) {
        this.emit({
            type: 'branch_complete',
            toolCallId: this.toolCallId,
            timestamp: new Date().toISOString(),
            content: result || 'Subagent branch completed successfully',
            timelineBranch: {
                ...this.timelineBranchMetadata,
                branchStatus: 'completed',
            },
        });
    }
    /**
     * Emit a timeline branch abort event.
     *
     * Requirements: 1.1, 1.2
     */
    emitBranchAbort(reason) {
        this.emit({
            type: 'branch_abort',
            toolCallId: this.toolCallId,
            timestamp: new Date().toISOString(),
            content: reason || 'Subagent branch aborted',
            timelineBranch: {
                ...this.timelineBranchMetadata,
                branchStatus: 'aborted',
            },
        });
    }
    /**
     * Flush all buffered events to the frontend via IPC with timeline branch support.
     *
     * Serializes buffered events to JSON and sends them via the 'acp:sub-agent-progress' channel.
     * Clears the buffer after successful send. Handles serialization errors gracefully by logging
     * and continuing execution (errors don't crash agent). Timeline branch events are prioritized
     * and include enhanced metadata for visualization.
     *
     * Requirements: 1.1, 1.2, 4.2, 4.3, 4.4, 6.1, 6.2, 10.1, 10.2
     */
    flush() {
        // Nothing to flush if buffer is empty
        if (this.buffer.length === 0) {
            return;
        }
        // Check if sender is available
        if (!this.sender || this.sender.isDestroyed()) {
            console.warn('[SubAgentProgress] IPC sender unavailable, skipping flush');
            this.buffer = []; // Clear buffer to prevent memory buildup
            return;
        }
        // Cancel any pending flush timer
        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
            this.flushTimer = null;
        }
        // Attempt to serialize and send events
        try {
            // Sort events by priority (timeline branch events first) and timestamp
            const sortedEvents = [...this.buffer].sort((a, b) => {
                // Priority events first
                const aPriority = this.PRIORITY_EVENT_TYPES.has(a.type) ? 0 : 1;
                const bPriority = this.PRIORITY_EVENT_TYPES.has(b.type) ? 0 : 1;
                if (aPriority !== bPriority) {
                    return aPriority - bPriority;
                }
                // Then by timestamp
                return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
            });
            // Create batch with timeline metadata
            const batch = {
                toolCallId: this.toolCallId,
                events: sortedEvents,
                timestamp: new Date().toISOString(),
            };
            // Serialize batch to JSON
            const serialized = JSON.stringify(batch);
            // Send via IPC channel
            this.sender.send('acp:sub-agent-progress', serialized);
            // Log timeline branch events for debugging
            const branchEvents = sortedEvents.filter(e => this.PRIORITY_EVENT_TYPES.has(e.type));
            if (branchEvents.length > 0) {
                console.debug(`[SubAgentProgress] Flushed ${branchEvents.length} timeline branch events for ${this.toolCallId}`);
            }
            // Clear buffer after successful send
            this.buffer = [];
        }
        catch (error) {
            // Handle serialization errors gracefully - log and continue
            console.error('[SubAgentProgress] Serialization failed:', error);
            console.error('[SubAgentProgress] Failed events:', this.buffer);
            // Clear buffer to prevent repeated failures and memory buildup
            this.buffer = [];
        }
    }
    /**
     * Schedule a flush to occur after FLUSH_INTERVAL_MS.
     *
     * Only schedules a flush if one is not already scheduled (flushTimer is null).
     * This implements time-based flushing at ~60fps (16ms intervals).
     *
     * Requirements: 7.3
     */
    scheduleFlush() {
        // Only schedule if no flush is already scheduled
        if (this.flushTimer !== null) {
            return;
        }
        // Set timer for FLUSH_INTERVAL_MS
        this.flushTimer = setTimeout(() => {
            // Call flush when timer expires
            this.flush();
            // Timer reference is cleared in flush()
        }, this.FLUSH_INTERVAL_MS);
    }
    /**
     * Destroy the emitter and clean up resources.
     *
     * Flushes any remaining buffered events, cancels the flush timer,
     * and clears the buffer. This method should be called when the
     * sub-agent execution completes or is aborted.
     *
     * Requirements: 9.2
     */
    destroy() {
        // Flush remaining events before cleanup
        this.flush();
        // Cancel flush timer if scheduled
        if (this.flushTimer !== null) {
            clearTimeout(this.flushTimer);
            this.flushTimer = null;
        }
        // Clear buffer to free memory
        this.buffer = [];
    }
}
// ── Constants & Configuration ───────────────────────────────────────────────
const DEFAULT_MODEL = "qwen3-vl:235b-instruct-cloud";
const DEFAULT_BASE_URL = "https://ollama.com/v1";
const COMPUTER_USE_TOOL_SPEC = {
    type: "function",
    function: {
        name: "computer_use",
        description: [
            "Use a mouse and keyboard to interact with a computer, and take screenshots.",
            "* This is an interface to a desktop GUI. You do not have access to a terminal or applications menu. You must click on desktop icons to start applications.",
            "* Some applications may take time to start or process actions, so you may need to wait and take successive screenshots to see the results of your actions. E.g. if you click on Firefox and a window doesn't open, try wait and taking another screenshot.",
            "* The screen's resolution is dynamically detected from the host system.",
            "* Whenever you intend to move the cursor to click on an element like an icon, you should consult a screenshot to determine the coordinates of the element before moving the cursor.",
            "* Make sure to click any buttons, links, icons, etc with the cursor tip in the center of the element.",
            "* IMPORTANT: After every action, you will receive a new screenshot. You MUST verify that the action had the intended effect (e.g., if you typed into a search bar, verify the text appears there).",
        ].join("\n"),
        parameters: {
            type: "object",
            required: ["action"],
            properties: {
                action: {
                    type: "string",
                    enum: [
                        "key",
                        "press",
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
                        "wait",
                        "terminate",
                        "answer",
                        "zoom",
                    ],
                    description: "The action to perform.",
                },
                keys: {
                    type: "array",
                    items: { type: "string" },
                    description: "Keys used with action=key or action=press.",
                },
                text: {
                    type: "string",
                    description: "Text for action=type or action=answer.",
                },
                clear_first: {
                    type: "boolean",
                    description: "🧼 CRITICAL: Set true to clear input field BEFORE typing. Use this when: (1) field has existing text, (2) URL bar has text, (3) search field has placeholder or previous query. Removes all text with Ctrl+A + Backspace, then types new text.",
                },
                coordinate: {
                    type: "array",
                    items: { type: "number" },
                    description: "Target coordinate [x, y] for mouse actions.",
                },
                pixels: {
                    type: "number",
                    description: "Scroll amount for action=scroll or action=hscroll.",
                },
                time: {
                    type: "number",
                    description: "Seconds to wait for action=wait.",
                },
                zoom_factor: {
                    type: "number",
                    description: "Optional zoom level (e.g. 2, 4) for action=zoom.",
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
const SYSTEM_PROMPT = `You are Fern, an autonomous automation agent with full GUI control.
- Be precise. Inspect screenshots carefully before acting.
- **ADAPTABILITY & OBSTACLES**: If you encounter an ad, popup, overlay, or notification that blocks your path, you MUST close it or wait for it to disappear before proceeding. Do not ignore visual obstructions.
- **VERIFICATION**: After every action, inspect the resulting screenshot to verify success.
  - If a click didn't land or a field didn't focus, REPEAT the action.
  - If typing failed because of an overlay, clear the obstacle and type again.
  - **MEDIA VERIFICATION**: For music or video (e.g., Spotify, YouTube):
    - A **Play icon** (triangle) usually means the media is **PAUSED** (click it to play).
    - A **Pause icon** (two bars) usually means the media is **PLAYING**.
    - DO NOT claim success just by seeing an icon. You MUST verify the **progress bar is moving** or the **time counter is increasing** by taking a second screenshot after a short wait (action=wait).
  - NEVER claim a task is "searched" or "complete" if the visual state does not confirm it.
- **LEVERAGE GENERAL KNOWLEDGE**: Use your extensive knowledge of how modern GUIs and popular applications (Spotify, Discord, Chrome, VS Code, etc.) are structured.
  - If a button isn't immediately visible, it's likely hidden in a "Settings" gear icon, a "..." meatball menu, a "hamburger" menu, or a profile dropdown.
  - Search bars are almost always at the top-center, top-right, or top-left of an app.
  - Navigation is typically in a left-side rail or a top header.
  - If an app is unresponsive, try clicking the title bar to focus it or use Alt+Tab.
- **ADVANCED GUI REASONING (Multi-App)**:
  - **Context Clues**: Look for visual breadcrumbs. A small arrow next to a label indicates a dropdown. A blue outline indicates focus. A "ghost" icon indicates a hidden action.
  - **Exploration**: If you are unsure how an app works, DO NOT guess. Use action=mouse_move to "probe" different areas and see how the UI reacts (e.g., does a tooltip appear? does a button highlight?).
  - **Universal Patterns**: Apply "Human Logic" to any app. Close buttons are usually top-right (Windows) or top-left (macOS). "Confirm" buttons are usually on the right; "Cancel" on the left.
  - **Error Handling**: If an app shows an error message, READ IT. Do not just try the same action again. Adjust your strategy based on the error text.
- **KEYBOARD & SHORTCUTS**: Use your full knowledge of Windows and application-specific shortcuts to be as fast and "human-like" as possible.
  - **OS Shortcuts**:
    - action=press(keys=["win"]) -> Open Start Menu (use this to search for and launch any app)
    - action=press(keys=["win", "r"]) -> Open Run dialog (ONLY for built-in tools: cmd, powershell, notepad, calc, explorer, taskmgr, regedit, control, msconfig — NOT for third-party apps)
    - action=press(keys=["alt", "tab"]) -> Switch between open windows
    - action=press(keys=["win", "d"]) -> Show/Hide desktop
    - action=press(keys=["win", "e"]) -> Open File Explorer
    - action=press(keys=["control", "shift", "escape"]) -> Open Task Manager
  - **App-Specific**:
    - Browsers: action=press(keys=["control", "t"]) (New Tab), action=press(keys=["control", "l"]) (Focus Address Bar), action=press(keys=["control", "f"]) (Search Page).
    - Chat/Social: action=press(keys=["control", "k"]) (Quick Switcher/Search in Discord/Slack), action=press(keys=["control", "enter"]) (Send message).
    - General: Use any other shortcuts you know (Ctrl+C, Ctrl+V, Ctrl+S, Ctrl+Z, etc.) whenever they are more efficient than mouse clicks.
- **HUMAN-LIKE PRECISION**:
  - **Click Targets**: Always click the **CENTER** of an icon, button, or text label. Avoid clicking edges where it might miss.
  - **Loading States**: If you see a spinner, progress bar, or "Loading..." text, use action=wait(time=2) and check again. Do not click on empty areas that haven't loaded yet.
  - **HOVER-TO-REVEAL (Critical)**: Many modern apps (Spotify, YouTube, Netflix) hide controls until you hover.
    - E.g., for Spotify albums, the Play button often only appears when the mouse is over the album art.
    - If you need to click something that isn't visible, use action=mouse_move(coordinate=[x, y]) to hover over the parent container first.
    - After hovering, inspect the next screenshot to see if the target (Play button, Close icon, etc.) appeared.
  - **COMPLEX MANEUVERS**: Do not be afraid to perform multi-step physical actions:
    1. action=mouse_move to reveal a hidden button.
    2. action=left_click once revealed.
    3. action=left_click_drag for sliders or reordering.
  - **Hover Effects**: If a menu only appears when hovering (like tooltips or fly-outs), use action=mouse_move(coordinate=[x, y]) first, then inspect the next screenshot.
- **AVAILABLE APPS**: Review the "CURRENT SYSTEM STATE:" section to see which applications are CURRENTLY OPEN.
- **FINDING & OPENING APPS**: Follow this priority order strictly:
  1. **Check the taskbar first**: Look at the bottom of the screen. If the app icon is already in the taskbar (pinned or running), click it to open/focus it. This is the fastest path.
  2. **Check if already open**: If the app appears in the "CURRENTLY OPEN APPLICATIONS" list, use Alt+Tab or click its taskbar button to bring it to focus.
  3. **Start Menu / Windows Search (for regular apps like Discord, Spotify, Chrome, etc.)**:
     - Press the Windows key or click the Windows icon in the taskbar to open the Start Menu.
     - Type the app name immediately — the search results will appear.
     - Click the app in the results or press Enter to launch it.
  4. **Win+R Run dialog (ONLY for built-in Windows tools and commands)**: Use action=press(keys=["win", "r"]) ONLY for things like: 'cmd', 'powershell', 'notepad', 'calc', 'mspaint', 'explorer', 'taskmgr', 'regedit', 'control', 'msconfig'. Do NOT use Win+R for third-party apps like Discord, Spotify, Chrome — they won't be found this way.
- **DO NOT ASSUME**: Don't assume an app is open or visible. Always check the taskbar and open apps list first, then use Start Menu search if needed.
- **LAYOUT AWARENESS**: Identify logical sections (Sidebar, Search Bar, Header, Main Context).
- **SEARCH FIRST**: If an application has a search function (e.g. Discord's "Find Conversations" or a search icon), USE IT mostly. It is faster and more reliable than scrolling. Use action=type(text="Search Query") and action=press(keys=["enter"]).
- **ZOOM / INSPECTION**: If an icon, sidebar logo, or text (e.g. in a dense sidebar) is too small to recognize, YOU MUST use action=zoom(coordinate=[x, y]) to get a high-resolution close-up of that area. This is critical for differentiating between small icons.
- **SCROLLING**: To scroll a specific list (like the Discord sidebar), YOU MUST specify the coordinate of that list so the mouse hovers over it first. Example: action=scroll(coordinate=[50, 500], pixels=-600).
- **SCROLL DIRECTION**: Use negative pixels (e.g., pixels=-600) to scroll DOWN (towards the bottom). Use positive pixels (e.g., pixels=600) to scroll UP (towards the top).
- **SERVERS vs DMS**: In chat apps, find the Direct Messages icon (usually at the top or a specific icon) to find individual contacts.
- **PREVENT DUPLICATION**: If typing into a field that already has text, set clear_first: true.
- **INPUT FIELD STRATEGY**:
  1. ALWAYS check if an input field has existing text BEFORE typing
  2. If field not focused: First action=left_click(coordinate=[x, y]) to focus the field
  3. If field has existing text: THEN use EITHER:
     a. action=type(text="newtext", clear_first=true) — Recommended for most cases
     b. action=triple_click(coordinate=[x, y]) to select all text, then action=type(text="newtext")
     c. action=key(keys=["control", "a"]) to select all, then action=key(keys=["delete"]), then action=type(text="newtext")
  4. If field is empty: Use action=type(text="newtext") without clear_first
  5. NEVER assume an input field is empty — always inspect the screenshot first
  6. Common fields with existing text: Search bars, URL fields, username/password fields, form inputs
- **KEYS**: Use action=press(keys=["enter"]) to submit forms or send messages.
- **COMPLETION**: When the task is done, you MUST:
  1. Use action=answer(text="Detailed summary of what you did and the final result") to report back to the manager agent. This summary is what the user will see in the chat.
  2. Then use action=terminate(status="success") to end the session.
- NEVER just use terminate without providing an answer first. The manager agent depends on your answer to conclude the task for the user.
- Always finish with action=answer and action=terminate(status="success").

**COORDINATE GUIDELINES**:
- Taskbar: Y > 900.
- Search Bars: Often top-center or top-left.
- Contacts/Servers: Left sidebar (X < 250).

**WORKFLOW**:
Observation (Screenshot) -> Check Task Requirements -> Find/Open Needed Apps -> Reasoning -> Action -> Verification (New Screenshot).`;
// ── Utilities ──────────────────────────────────────────────────────────────────
function nowTs() {
    const d = new Date();
    return (d.getFullYear().toString() +
        String(d.getMonth() + 1).padStart(2, "0") +
        String(d.getDate()).padStart(2, "0") +
        "-" +
        String(d.getHours()).padStart(2, "0") +
        String(d.getMinutes()).padStart(2, "0") +
        String(d.getSeconds()).padStart(2, "0"));
}
function sleep(seconds) {
    return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}
function ensureXy(coordinate) {
    if (!coordinate || coordinate.length !== 2) {
        throw new Error("coordinate=[x, y] is required for this action.");
    }
    return [Math.floor(coordinate[0]), Math.floor(coordinate[1])];
}
function maybeInt(value, defaultVal = 0) {
    return value !== undefined && value !== null ? Math.floor(value) : defaultVal;
}
/**
 * Get list of currently open windows and processes (Windows only).
 * Returns a formatted string describing open applications.
 */
function getOpenWindowsInfo() {
    try {
        if (process.platform !== 'win32') {
            return "Running on non-Windows platform. Cannot enumerate windows.";
        }
        // Use PowerShell to get the list of currently open windows
        const output = (0, child_process_1.execSync)(`powershell -NoProfile -Command "Get-Process | Where-Object { $_.MainWindowTitle -ne '' } | Select-Object -ExpandProperty Name | Get-Unique"`, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
        const processes = output
            .split('\n')
            .map(p => p.trim())
            .filter(p => p.length > 0)
            .sort();
        if (processes.length === 0) {
            return "No open windows detected.";
        }
        return `Open applications: ${processes.join(', ')}`;
    }
    catch (error) {
        // Fallback if PowerShell fails
        try {
            const output = (0, child_process_1.execSync)('tasklist', { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
            const lines = output.split('\n').slice(3); // Skip header
            const apps = lines
                .map(line => line.split(/\s+/)[0])
                .filter((app, idx, arr) => app && arr.indexOf(app) === idx) // Unique
                .slice(0, 20); // Limit to 20 to avoid clutter
            if (apps.length === 0)
                return "Could not enumerate open applications.";
            return `Open applications: ${apps.join(', ')}`;
        }
        catch {
            return "Could not enumerate open applications.";
        }
    }
}
/**
 * Get common Windows taskbar items (common pinned apps).
 * This helps the agent know which apps are readily available.
 */
function getCommonTaskbarApps() {
    try {
        if (process.platform !== 'win32') {
            return "";
        }
        // Check for commonly pinned Start Menu apps
        const commonApps = [
            'chrome', 'firefox', 'edge',
            'discord', 'slack', 'telegram',
            'vscode', 'notepad', 'explorer',
            'teams', 'outlook', 'word',
            'excel', 'powershell', 'cmd'
        ];
        // Get the taskbar pinned apps from registry (Windows only)
        try {
            const taskbarPath = 'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Taskband';
            (0, child_process_1.execSync)(`reg query "${taskbarPath}"`, { encoding: 'utf-8', stdio: 'ignore' });
            // If we get here, taskbar was found - common apps are likely available
            return "Common taskbar applications:\n- File Explorer\n- Search / Windows Search\n- Start Menu";
        }
        catch {
            return "";
        }
    }
    catch {
        return "";
    }
}
// ── ToolResult ─────────────────────────────────────────────────────────────────
class ToolResult {
    payload;
    constructor(payload) {
        this.payload = payload;
    }
    asContent() {
        const payload = { ...this.payload };
        const screenshot = payload.screenshot;
        delete payload.screenshot;
        const action = payload._action;
        delete payload._action;
        const detail = payload.detail;
        delete payload.detail;
        const textValue = payload.text;
        delete payload.text;
        const meta = {};
        for (const key of [
            "cursor",
            "display",
            "downscaled_size",
            "screenshot_path",
            "result",
        ]) {
            if (key in payload) {
                meta[key] = payload[key];
                delete payload[key];
            }
        }
        const lines = [];
        if (action)
            lines.push(`action=${action}`);
        const status = payload.status;
        delete payload.status;
        if (status)
            lines.push(`status=${status}`);
        if (detail)
            lines.push(detail);
        if (textValue)
            lines.push(`text: ${textValue}`);
        if (Object.keys(meta).length > 0)
            lines.push(JSON.stringify(meta));
        if (Object.keys(payload).length > 0)
            lines.push(JSON.stringify(payload));
        const content = [];
        if (lines.length > 0) {
            content.push({ type: "text", text: lines.join("\n") });
        }
        if (screenshot) {
            content.push({
                type: "image_url",
                image_url: { url: screenshot, detail: "low" },
            });
        }
        if (content.length === 0) {
            content.push({ type: "text", text: "tool call completed." });
        }
        return content;
    }
    /** Stringified output for standard ToolResult.output */
    toString() {
        const payload = { ...this.payload };
        delete payload.screenshot;
        return JSON.stringify(payload, null, 2);
    }
}
// ── ComputerUseTool ────────────────────────────────────────────────────────────
/**
 * NOTE: This class uses native OS automation via shell commands.
 * On macOS: uses `screencapture`, `cliclick` (install via `brew install cliclick`).
 * On Linux: uses `scrot`, `xdotool` (install via `apt install xdotool scrot`).
 * Windows support is not implemented.
 *
 * For production use, consider integrating `robotjs` or `nut.js` npm packages.
 */
class ComputerUseTool {
    screenshotDir;
    monitorIndex;
    mouseMoveDuration;
    dragDuration;
    imageMinPixels;
    imageMaxPixels;
    imageScaleFactor;
    imageQuality;
    lastViewport = {};
    progressEmitter = null;
    toolCallId = '';
    constructor(screenshotDir, monitorIndex = 1, mouseMoveDuration = 0.0, dragDuration = 0.15, imageMinPixels = 4096, imageMaxPixels = 2_000_000, imageScaleFactor = 32, imageQuality = 60) {
        this.screenshotDir = screenshotDir;
        this.monitorIndex = monitorIndex;
        this.mouseMoveDuration = mouseMoveDuration;
        this.dragDuration = dragDuration;
        this.imageMinPixels = imageMinPixels;
        this.imageMaxPixels = imageMaxPixels;
        this.imageScaleFactor = imageScaleFactor;
        this.imageQuality = imageQuality;
        this.imageMinPixels = Math.max(1024, imageMinPixels);
        this.imageMaxPixels = Math.max(this.imageMinPixels, imageMaxPixels);
        this.imageScaleFactor = Math.max(1, imageScaleFactor);
        this.imageQuality = Math.max(1, Math.min(95, imageQuality));
        fs.mkdirSync(this.screenshotDir, { recursive: true });
        if (robot) {
            robot.setMouseDelay(20);
        }
    }
    /**
     * Set the progress emitter for emitting cursor position and status events.
     * Requirements: 5.1, 5.2
     */
    setProgressEmitter(emitter, toolCallId) {
        this.progressEmitter = emitter;
        this.toolCallId = toolCallId;
    }
    /**
     * Emit a cursor position event for real-time visual feedback.
     * Requirements: 5.1, 2.1, 2.3, 2.4, 2.5
     */
    emitCursorPositionEvent(actionType, coordinate, description) {
        if (!this.progressEmitter)
            return;
        this.progressEmitter.emit({
            type: 'action',
            toolCallId: this.toolCallId,
            timestamp: new Date().toISOString(),
            action: {
                type: actionType,
                params: { coordinate },
                description,
            },
        });
    }
    /**
     * Emit a status event for task lifecycle tracking.
     * Requirements: 5.2, 2.1, 2.2, 2.6, 2.7, 2.8
     */
    emitStatusEvent(status, description, details) {
        if (!this.progressEmitter)
            return;
        this.progressEmitter.emit({
            type: 'action',
            toolCallId: this.toolCallId,
            timestamp: new Date().toISOString(),
            action: {
                type: status,
                params: details || {},
                description,
            },
        });
    }
    async call(params) {
        const { action } = params;
        const handlers = {
            mouse_move: async (p) => this.mouseMove(p),
            left_click: async (p) => this.leftClick(p),
            right_click: async (p) => this.rightClick(p),
            middle_click: async (p) => this.middleClick(p),
            double_click: async (p) => this.doubleClick(p),
            triple_click: async (p) => this.tripleClick(p),
            left_click_drag: async (p) => this.leftClickDrag(p),
            scroll: async (p) => this.scroll(p),
            hscroll: async (p) => this.hscroll(p),
            type: async (p) => this.type(p),
            key: async (p) => this.key(p),
            press: async (p) => this.key(p), // Map 'press' to 'key' for model convenience
            wait: async (p) => this.waitAction(p),
            answer: async (p) => this.answer(p),
            terminate: async (p) => this.terminate(p),
            zoom: async (p) => this.zoom(p),
        };
        const handler = handlers[action];
        if (!handler)
            throw new Error(`Unsupported action: ${action}`);
        const result = await handler(params);
        result._action = action;
        return new ToolResult(result);
    }
    async captureObservation() {
        return await this.attachScreenshot({ status: "observe" });
    }
    // ── Action Handlers ──────────────────────────────────────────────────────────
    async mouseMove(params) {
        const [absX, absY] = this.absoluteXy(params.coordinate);
        console.log(`[Move] Target=(${absX}, ${absY})`);
        // 5.1: Emit cursor position event before action execution
        this.emitCursorPositionEvent('move', [absX, absY], `Moved to (${absX}, ${absY})`);
        this.moveMouse(absX, absY);
        return await this.attachScreenshot({ status: "ok", detail: `Moved to (${absX}, ${absY}).` });
    }
    async leftClick(params) {
        if (params.coordinate) {
            const [absX, absY] = this.absoluteXy(params.coordinate);
            console.log(`[Left Click] Target=(${absX}, ${absY})`);
            // 5.1: Emit cursor position event before action execution
            this.emitCursorPositionEvent('click', [absX, absY], `Left click at (${absX}, ${absY})`);
            this.moveMouse(absX, absY);
            this.click(absX, absY, "left");
            return await this.attachScreenshot({ status: "ok", detail: `Left click at (${absX}, ${absY}).` });
        }
        this.click(undefined, undefined, "left");
        return await this.attachScreenshot({ status: "ok", detail: "Left click at current cursor." });
    }
    async rightClick(params) {
        if (params.coordinate) {
            const [absX, absY] = this.absoluteXy(params.coordinate);
            // 5.1: Emit cursor position event before action execution
            this.emitCursorPositionEvent('click', [absX, absY], `Right click at (${absX}, ${absY})`);
            this.click(absX, absY, "right");
            return await this.attachScreenshot({ status: "ok", detail: `Right click at (${absX}, ${absY}).` });
        }
        this.click(undefined, undefined, "right");
        return await this.attachScreenshot({ status: "ok", detail: "Right click at current cursor." });
    }
    async middleClick(params) {
        if (params.coordinate) {
            const [absX, absY] = this.absoluteXy(params.coordinate);
            // 5.1: Emit cursor position event before action execution
            this.emitCursorPositionEvent('click', [absX, absY], `Middle click at (${absX}, ${absY})`);
            this.click(absX, absY, "middle");
            return await this.attachScreenshot({ status: "ok", detail: `Middle click at (${absX}, ${absY}).` });
        }
        this.click(undefined, undefined, "middle");
        return await this.attachScreenshot({ status: "ok", detail: "Middle click at current cursor." });
    }
    async doubleClick(params) {
        const [absX, absY] = this.absoluteXy(params.coordinate);
        // 5.1: Emit cursor position event before action execution
        this.emitCursorPositionEvent('click', [absX, absY], `Double click at (${absX}, ${absY})`);
        this.doubleClickAt(absX, absY);
        return await this.attachScreenshot({ status: "ok", detail: `Double click at (${absX}, ${absY}).` });
    }
    async tripleClick(params) {
        const [absX, absY] = this.absoluteXy(params.coordinate);
        // 5.1: Emit cursor position event before action execution
        this.emitCursorPositionEvent('click', [absX, absY], `Triple click at (${absX}, ${absY})`);
        this.tripleClickAt(absX, absY);
        return await this.attachScreenshot({ status: "ok", detail: `Triple click at (${absX}, ${absY}).` });
    }
    async leftClickDrag(params) {
        const [absX, absY] = this.absoluteXy(params.coordinate);
        // 5.1: Emit cursor position event before action execution
        this.emitCursorPositionEvent('drag', [absX, absY], `Drag to (${absX}, ${absY})`);
        this.drag(absX, absY);
        return await this.attachScreenshot({ status: "ok", detail: `Drag to (${absX}, ${absY}).` });
    }
    async scroll(params) {
        if (params.coordinate) {
            const [absX, absY] = this.absoluteXy(params.coordinate);
            // 5.1: Emit cursor position event before action execution
            this.emitCursorPositionEvent('scroll', [absX, absY], `Scroll at (${absX}, ${absY})`);
            this.moveMouse(absX, absY);
            console.log(`[Sub-Agent] 🛰️ Moving mouse to (${absX}, ${absY}) before scroll.`);
        }
        const pixels = maybeInt(params.pixels);
        this.scrollVertical(pixels);
        return await this.attachScreenshot({ status: "ok", detail: `Scroll ${pixels} vertically at ${params.coordinate ? JSON.stringify(params.coordinate) : 'current position'}.` });
    }
    async hscroll(params) {
        if (params.coordinate) {
            const [absX, absY] = this.absoluteXy(params.coordinate);
            // 5.1: Emit cursor position event before action execution
            this.emitCursorPositionEvent('scroll', [absX, absY], `Horizontal scroll at (${absX}, ${absY})`);
            this.moveMouse(absX, absY);
            console.log(`[Sub-Agent] 🛰️ Moving mouse to (${absX}, ${absY}) before hscroll.`);
        }
        const pixels = maybeInt(params.pixels);
        this.scrollHorizontal(pixels);
        return await this.attachScreenshot({ status: "ok", detail: `Scroll ${pixels} horizontally at ${params.coordinate ? JSON.stringify(params.coordinate) : 'current position'}.` });
    }
    async type(params) {
        if (params.text === undefined || params.text === null) {
            throw new Error("text is required for action=type.");
        }
        if (params.clear_first) {
            console.log(`[Sub-Agent] 🧼 Clearing field before typing...`);
            this.pressKeys(['control', 'a']);
            this.pressKeys(['backspace']);
        }
        this.typeText(params.text);
        return await this.attachScreenshot({
            status: "ok",
            detail: `Typed "${params.text.substring(0, 50)}".`,
        });
    }
    async key(params) {
        const keys = params.keys || [];
        if (keys.length === 0)
            throw new Error("keys is required for action=key.");
        this.pressKeys(keys);
        return await this.attachScreenshot({ status: "ok", detail: `Pressed keys ${JSON.stringify(keys)}.` });
    }
    async waitAction(params) {
        if (params.time === undefined || params.time === null) {
            throw new Error("time is required for action=wait.");
        }
        await sleep(params.time);
        return { status: "ok", detail: `Waited ${params.time} seconds.` };
    }
    async answer(params) {
        return { status: "answer", text: params.text || "" };
    }
    async terminate(params) {
        if (params.status !== "success" && params.status !== "failure") {
            throw new Error("status must be success or failure for action=terminate.");
        }
        return { status: "terminate", result: params.status };
    }
    async zoom(params) {
        if (!params.coordinate) {
            throw new Error("coordinate is required for action=zoom.");
        }
        const [absX, absY] = this.absoluteXy(params.coordinate);
        console.log(`[Sub-Agent] 🔍 Zooming in at (${absX}, ${absY})...`);
        const ts = nowTs();
        const imgPath = path.join(this.screenshotDir, `${ts}-zoom.png`);
        await this.captureScreen(imgPath);
        // Read raw dimensions
        const rawBuffer = fs.readFileSync(imgPath);
        const { width: rawW, height: rawH } = this.getPngDimensions(rawBuffer);
        // Define a 400x400 physical crop box centered at the target
        const boxSize = 250; // 500x500 box for detailed view
        const left = Math.max(0, absX - boxSize);
        const top = Math.max(0, absY - boxSize);
        const width = Math.min(boxSize * 2, rawW - left);
        const height = Math.min(boxSize * 2, rawH - top);
        // Crop and convert to base64
        let encoded = "";
        try {
            const croppedBuffer = await sharp(rawBuffer)
                .extract({ left: Math.round(left), top: Math.round(top), width: Math.round(width), height: Math.round(height) })
                .jpeg({ quality: 85 }) // High quality for zoom
                .toBuffer();
            encoded = croppedBuffer.toString("base64");
        }
        catch (err) {
            console.warn('[ComputerUse] zoom crop failed', err);
            encoded = rawBuffer.toString("base64");
        }
        return {
            status: "ok",
            detail: `Zoomed in at (${absX}, ${absY}) with 500x500 crop.`,
            screenshot: `data:image/jpeg;base64,${encoded}`,
            screenshot_path: imgPath,
            cursor: { x: absX, y: absY },
            display: { width: rawW, height: rawH },
            downscaled_size: { width: Math.round(width), height: Math.round(height) },
        };
    }
    // ── OS Automation (shell-based) ──────────────────────────────────────────────
    moveMouse(x, y) {
        if (robot) {
            robot.moveMouse(x, y);
        }
        else if (process.platform === "darwin") {
            (0, child_process_1.execSync)(`cliclick m:${x},${y}`);
        }
        else {
            (0, child_process_1.execSync)(`xdotool mousemove ${x} ${y}`);
        }
    }
    click(x, y, button = "left") {
        if (robot) {
            if (x !== undefined && y !== undefined) {
                robot.moveMouse(x, y);
            }
            // Use mouseDown/Up for better reliability on Windows, matching qwen-computer.py
            robot.mouseToggle("down", button);
            // Small blocking delay (50ms) to ensure the OS registers the click
            const start = Date.now();
            while (Date.now() - start < 50) { /* sync wait */ }
            robot.mouseToggle("up", button);
        }
        else {
            const buttonMap = { left: 1, middle: 2, right: 3 };
            const btn = buttonMap[button];
            if (process.platform === "darwin") {
                const coord = x !== undefined ? `${x},${y}` : "";
                const flag = button === "right" ? "rc" : button === "middle" ? "mc" : "c";
                (0, child_process_1.execSync)(`cliclick ${flag}:${coord}`);
            }
            else {
                if (x !== undefined)
                    (0, child_process_1.execSync)(`xdotool mousemove ${x} ${y}`);
                (0, child_process_1.execSync)(`xdotool click ${btn}`);
            }
        }
    }
    doubleClickAt(x, y) {
        if (robot) {
            robot.moveMouse(x, y);
            robot.mouseClick("left", true);
        }
        else {
            if (process.platform === "darwin") {
                (0, child_process_1.execSync)(`cliclick dc:${x},${y}`);
            }
            else {
                (0, child_process_1.execSync)(`xdotool mousemove ${x} ${y} click --repeat 2 1`);
            }
        }
    }
    tripleClickAt(x, y) {
        if (robot) {
            robot.moveMouse(x, y);
            robot.mouseClick("left");
            robot.mouseClick("left");
            robot.mouseClick("left");
        }
        else {
            if (process.platform === "darwin") {
                (0, child_process_1.execSync)(`cliclick tc:${x},${y}`);
            }
            else {
                (0, child_process_1.execSync)(`xdotool mousemove ${x} ${y} click --repeat 3 1`);
            }
        }
    }
    drag(toX, toY) {
        if (robot) {
            robot.dragMouse(toX, toY);
        }
        else if (process.platform === "darwin") {
            (0, child_process_1.execSync)(`cliclick dd:. du:${toX},${toY}`);
        }
        else {
            (0, child_process_1.execSync)(`xdotool mousedown 1 mousemove --sync ${toX} ${toY} mouseup 1`);
        }
    }
    scrollVertical(pixels) {
        if (robot) {
            // pixels > 0 is scroll up, but robotjs might take different units
            const amount = Math.round(pixels / 100) || (pixels > 0 ? 1 : -1);
            robot.scrollMouse(0, amount);
        }
        else {
            const direction = pixels > 0 ? "up" : "down";
            if (process.platform === "darwin") {
                (0, child_process_1.execSync)(`cliclick ${direction === "up" ? "ku" : "kd"}:. ${Math.abs(pixels)}`);
            }
            else {
                (0, child_process_1.execSync)(`xdotool click ${direction === "up" ? 4 : 5}`);
            }
        }
    }
    scrollHorizontal(pixels) {
        if (robot) {
            const amount = Math.round(pixels / 100) || (pixels > 0 ? 1 : -1);
            robot.scrollMouse(amount, 0);
        }
        else if (process.platform === "darwin") {
            const dir = pixels > 0 ? "right" : "left";
            (0, child_process_1.execSync)(`osascript -e 'tell application "System Events" to key code ${dir === "right" ? 124 : 123}'`);
        }
        else {
            (0, child_process_1.execSync)(`xdotool click ${pixels > 0 ? 6 : 7}`);
        }
    }
    typeText(text) {
        if (robot) {
            robot.typeString(text);
        }
        else if (process.platform === "darwin") {
            // Escape single quotes for shell safety
            const escaped = text.replace(/'/g, "'\\''");
            (0, child_process_1.execSync)(`osascript -e 'tell application "System Events" to keystroke "${escaped}"'`);
        }
        else {
            (0, child_process_1.execSync)(`xdotool type --clearmodifiers -- ${JSON.stringify(text)}`);
        }
    }
    pressKeys(keys) {
        if (robot) {
            // Convert standard key names to robotjs format
            const KEY_MAP = {
                Control_L: 'control', Control_R: 'control', control: 'control',
                Alt_L: 'alt', Alt_R: 'alt', alt: 'alt',
                Shift_L: 'shift', Shift_R: 'shift', shift: 'shift',
                Super_L: 'command', Super_R: 'command', command: 'command', win: 'command',
                Return: 'enter', enter: 'enter',
                Escape: 'escape', esc: 'escape',
                Tab: 'tab',
                Delete: 'delete', delete: 'delete', del: 'delete',
                BackSpace: 'backspace', backspace: 'backspace',
                space: 'space',
                Up: 'up', up: 'up',
                Down: 'down', down: 'down',
                Left: 'left', left: 'left',
                Right: 'right', right: 'right',
                Home: 'home', End: 'end',
                PageUp: 'pageup', PageDown: 'pagedown'
            };
            const parts = keys.map(k => {
                const mapped = KEY_MAP[k] || KEY_MAP[k.toLowerCase()] || k.toLowerCase();
                return mapped;
            });
            if (parts.length === 1) {
                robot.keyTap(parts[0]);
            }
            else {
                const key = parts[parts.length - 1];
                const mods = parts.slice(0, -1);
                robot.keyTap(key, mods);
            }
        }
        else if (process.platform === "darwin") {
            const combo = keys.join("+");
            (0, child_process_1.execSync)(`cliclick kp:${combo}`);
        }
        else {
            const combo = keys.join("+");
            (0, child_process_1.execSync)(`xdotool key ${combo}`);
        }
    }
    // ── Screenshot & Image ───────────────────────────────────────────────────────
    async attachScreenshot(payload) {
        const ts = nowTs();
        const imgPath = path.join(this.screenshotDir, `${ts}.png`);
        // Offload capture and processing to a worker thread to keep main thread responsive
        const workerResult = await this.captureScreenAsync(imgPath);
        const { encoded, width: rawW, height: rawH, newW, newH } = workerResult;
        const cursorPos = this.getCursorPosition();
        const displays = electron_1.screen.getAllDisplays();
        const display = displays[this.monitorIndex - 1] || electron_1.screen.getPrimaryDisplay();
        const scaleFactor = display.scaleFactor || 1.0;
        const logicalSize = { width: display.bounds.width, height: display.bounds.height };
        const physicalSize = {
            width: Math.round(logicalSize.width * scaleFactor),
            height: Math.round(logicalSize.height * scaleFactor)
        };
        // Sometimes robot/OS can disagree on logical vs physical. We explicitly prefer the raw captured image's dimensions.
        const effectiveDisplaySize = {
            width: rawW || physicalSize.width || 1920,
            height: rawH || physicalSize.height || 1080
        };
        console.log(`[Screenshot] ${imgPath} cursor=(${cursorPos.x}, ${cursorPos.y}) monitor=${this.monitorIndex} offset=(${display.bounds.x}, ${display.bounds.y})`);
        console.log(`[Resolution] Logical=${logicalSize.width}x${logicalSize.height}, Physical=${effectiveDisplaySize.width}x${effectiveDisplaySize.height}, ScaleFactor=${scaleFactor}`);
        let appName = "None";
        let appLogo = "";
        // Determine active app (using Spotify as a placeholder default if running)
        try {
            const openWindows = (0, child_process_1.execSync)(`powershell -NoProfile -Command "Get-Process | Where-Object { $_.MainWindowTitle -ne '' } | Select-Object -ExpandProperty ProcessName"`, { encoding: 'utf-8' });
            if (openWindows.toLowerCase().includes('spotify')) {
                appName = "Spotify";
                // Leaving appLogo empty so the frontend uses the universal SVG app icon
                appLogo = "";
            }
        }
        catch (e) { }
        const updated = {
            ...payload,
            screenshot: `data:image/jpeg;base64,${encoded}`,
            screenshot_path: imgPath,
            cursor: cursorPos,
            display: effectiveDisplaySize,
            downscaled_size: { width: newW, height: newH },
            appName,
            appLogo,
        };
        this.lastViewport = {
            monitor_left: display.bounds.x,
            monitor_top: display.bounds.y,
            display_width: effectiveDisplaySize.width,
            display_height: effectiveDisplaySize.height,
            image_width: newW,
            image_height: newH,
            raw_width: rawW,
            raw_height: rawH,
        };
        return updated;
    }
    async captureScreenAsync(outPath) {
        return new Promise((resolve, reject) => {
            const { Worker } = require('worker_threads');
            const worker = new Worker(path.join(__dirname, 'screenshot-worker.js'), {
                workerData: {
                    outPath,
                    monitorIndex: this.monitorIndex,
                    imageQuality: this.imageQuality,
                    imageMaxPixels: this.imageMaxPixels,
                    imageMinPixels: this.imageMinPixels,
                    imageScaleFactor: this.imageScaleFactor
                }
            });
            worker.on('message', (msg) => {
                if (msg.success)
                    resolve(msg.data);
                else
                    reject(new Error(msg.error));
            });
            worker.on('error', reject);
            worker.on('exit', (code) => {
                if (code !== 0)
                    reject(new Error(`Worker stopped with exit code ${code}`));
            });
        });
    }
    async captureScreen(outPath) {
        const screenshot = require('screenshot-desktop');
        try {
            const displays = await screenshot.listDisplays();
            const display = displays[this.monitorIndex - 1] || displays[0];
            await screenshot({ filename: outPath, screen: display.id });
        }
        catch (err) {
            console.error('[ComputerUse] Native screenshot failed, trying fallback', err);
            if (process.platform === 'darwin') {
                (0, child_process_1.execSync)(`screencapture -x "${outPath}"`);
            }
            else if (process.platform === 'win32') {
                throw new Error('Native Windows screenshot failed and no fallback available.');
            }
            else {
                (0, child_process_1.execSync)(`scrot "${outPath}"`);
            }
        }
    }
    getCursorPosition() {
        if (robot)
            return robot.getMousePos();
        return { x: 0, y: 0 };
    }
    getDisplaySize() {
        try {
            const display = electron_1.screen.getPrimaryDisplay();
            return { width: display.bounds.width, height: display.bounds.height };
        }
        catch {
            return { width: 1920, height: 1080 };
        }
    }
    /** Read PNG width/height from file header (bytes 16-23). */
    getPngDimensions(buf) {
        if (buf.length < 24 || buf.toString("ascii", 1, 4) !== "PNG") {
            return { width: 1920, height: 1080 };
        }
        return {
            width: buf.readUInt32BE(16),
            height: buf.readUInt32BE(20),
        };
    }
    computeResizeDims(width, height) {
        const area = width * height;
        if (area === 0)
            return { newW: width, newH: height };
        const clampedArea = Math.min(Math.max(area, this.imageMinPixels), this.imageMaxPixels);
        const scale = Math.sqrt(clampedArea / area);
        const roundSize = (v) => Math.max(this.imageScaleFactor, Math.floor(Math.max(1, v) / this.imageScaleFactor) *
            this.imageScaleFactor);
        let newW = roundSize(width * scale);
        let newH = roundSize(height * scale);
        const newArea = Math.max(1, newW * newH);
        if (newArea > this.imageMaxPixels) {
            const shrink = Math.sqrt(this.imageMaxPixels / newArea);
            newW = roundSize(newW * shrink);
            newH = roundSize(newH * shrink);
        }
        return { newW, newH };
    }
    // ── Coordinate Transform ─────────────────────────────────────────────────────
    absoluteXy(coordinate) {
        const [x, y] = ensureXy(coordinate);
        const vp = this.lastViewport;
        const left = vp.monitor_left ?? 0;
        const top = vp.monitor_top ?? 0;
        const displayW = vp.display_width ?? 0;
        const displayH = vp.display_height ?? 0;
        const imageW = vp.image_width;
        const imageH = vp.image_height;
        if (displayW && displayH) {
            // Normalized coordinates (0-1000 range) — map to physical display
            if (x <= 1000 && y <= 1000) {
                const normX = Math.max(0, Math.min(1, x / 1000));
                const normY = Math.max(0, Math.min(1, y / 1000));
                let absX = left + Math.floor(normX * displayW);
                let absY = top + Math.floor(normY * displayH);
                console.log(`[Coordinate Transform] normalized input=(${x}, ${y}) → abs=(${absX}, ${absY})`);
                return [absX, absY];
            }
            // Pixel coordinates — since we send full-resolution screenshots,
            // imageW === displayW and imageH === displayH, so scale is 1:1
            if (imageW && imageH) {
                const scaleX = displayW / imageW;
                const scaleY = displayH / imageH;
                const absX = left + Math.round(x * scaleX);
                const absY = top + Math.round(y * scaleY);
                console.log(`[Coordinate Transform] pixel input=(${x}, ${y}) scale=(${scaleX.toFixed(2)}, ${scaleY.toFixed(2)}) → abs=(${absX}, ${absY})`);
                return [absX, absY];
            }
            // Fallback: assume 1:1 mapping
            console.log(`[Coordinate Transform] pixel input=(${x}, ${y}) → abs=(${left + x}, ${top + y})`);
            return [left + x, top + y];
        }
        console.log(`[Coordinate Transform] No viewport/scale, using offset only: (${left + x}, ${top + y})`);
        return [left + x, top + y];
    }
}
// ── Connection / Auth Error Detection ────────────────────────────────────────
/**
 * Returns true if the error indicates the VLM provider is unreachable
 * (network-level failure: refused, timeout, DNS failure, etc.) or experiencing
 * server errors (5xx) that should trigger retry-with-limit behavior.
 */
function isConnectionError(err) {
    if (!(err instanceof Error))
        return false;
    const msg = err.message.toLowerCase();
    return (msg.includes('econnrefused') ||
        msg.includes('fetch failed') ||
        msg.includes('etimedout') ||
        msg.includes('enotfound') ||
        /http 5\d\d:/.test(msg) // Match HTTP 500-599 server errors
    );
}
/**
 * Returns true if the error is an authentication failure (HTTP 401/403).
 * These should trigger immediate exit — retrying won't help.
 * We match on the status code in the error message, not on words like
 * "unauthorized" which can appear in 500 error bodies from some providers.
 */
function isAuthError(err) {
    if (!(err instanceof Error))
        return false;
    const msg = err.message;
    // Match "[provider] HTTP 401:" or "[provider] HTTP 403:" patterns
    return /HTTP 40[13]:/.test(msg);
}
// ── ComputerUseAgent (Sub-Agent Loop) ─────────────────────────────────────────
class ComputerUseAgent {
    client;
    tool;
    model;
    task;
    temperature;
    maxTurns;
    historyWindow;
    messages = [];
    baseCount;
    finalAnswer = null;
    terminated = null;
    lastScreenshot;
    aborted = false;
    constructor(client, tool, model, task, temperature = 0, maxTurns = 40, historyWindow = 12) {
        this.client = client;
        this.tool = tool;
        this.model = model;
        this.task = task;
        this.temperature = temperature;
        this.maxTurns = maxTurns;
        this.historyWindow = historyWindow;
        this.historyWindow = Math.max(1, historyWindow);
        this.messages = [{ role: "system", content: SYSTEM_PROMPT }];
        this.baseCount = this.messages.length;
    }
    abort() {
        this.aborted = true;
        this.terminated = "aborted";
        console.log(`[Sub-Agent] 🛑 Received external abort signal.`);
    }
    async run(onUpdate, onProgress) {
        if (this.messages.length === 1) {
            await this.appendInitialObservation();
            this.baseCount = this.messages.length;
        }
        console.log(`\n[Sub-Agent] 🚀 VLM PROOF: Using Model="${this.model}" via Provider="${this.client.provider}"`);
        console.log(`[Sub-Agent] 📡 Base URL: ${JSON.stringify(this.client.config?.baseUrl || "builtin")}`);
        let errorCount = 0;
        const MAX_ERRORS = 3;
        for (let step = 1; step <= this.maxTurns; step++) {
            try {
                if (this.aborted || abort_manager_1.globalAbortManager.streamAborted) {
                    console.log(`[Sub-Agent] 🛑 Run loop aborted at step ${step}.`);
                    this.terminated = "aborted";
                    break;
                }
                console.log(`\n[Sub-Agent] 👁️  Step ${step}/${this.maxTurns}`);
                onUpdate?.(`Sub-Agent Turn ${step}/${this.maxTurns}...`);
                // Emit step progress event
                onProgress?.({
                    type: 'step',
                    toolCallId: '',
                    timestamp: new Date().toISOString(),
                    stepNumber: step,
                    totalSteps: this.maxTurns,
                });
                // Ollama Cloud vision models don't support tool calling — omit tools to avoid 500 errors
                const shouldSendTools = this.client.provider !== 'ollama-cloud';
                const response = await this.client.chat({
                    messages: this.messages,
                    model: this.model,
                    temperature: this.temperature,
                    tools: shouldSendTools ? [COMPUTER_USE_TOOL_SPEC] : undefined,
                });
                // Reset error count on successful communication
                errorCount = 0;
                if (this.aborted)
                    break;
                const content = typeof response.content === "string" ? response.content : "";
                if (content) {
                    console.log(`[Sub-Agent] 🧠 Reasoning: ${content}`);
                    onProgress?.({
                        type: 'reasoning',
                        toolCallId: '',
                        timestamp: new Date().toISOString(),
                        stepNumber: step,
                        content: content,
                    });
                }
                this.messages.push({
                    role: "assistant",
                    content: response.content || "",
                    tool_calls: response.toolCalls,
                });
                let toolCalls = response.toolCalls || [];
                // FALLBACK: If no formal tool calls, try parsing the text content
                if (toolCalls.length === 0 && content) {
                    const parsed = this.parseTextActions(content);
                    if (parsed.length > 0) {
                        console.log(`[Sub-Agent] 🧩 Parsed ${parsed.length} text-based actions from reasoning.`);
                        toolCalls = parsed;
                    }
                }
                if (toolCalls.length === 0) {
                    if (step < this.maxTurns) {
                        console.warn(`[Sub-Agent] ⚠️ No actions detected at step ${step}. Adding system reminder...`);
                        this.messages.push({
                            role: "system",
                            content: "You provided reasoning but no tool call. You MUST use the action=... format to perform an action (e.g. action=left_click(coordinate=[x, y])). Just thinking about it won't work."
                        });
                        continue;
                    }
                    else {
                        console.error(`[Sub-Agent] ❌ Reached max turns (${this.maxTurns}) without completion.`);
                        break;
                    }
                }
                for (const toolCall of toolCalls) {
                    let args;
                    try {
                        args = typeof toolCall.arguments === "string" ? JSON.parse(toolCall.arguments) : toolCall.arguments;
                    }
                    catch (e) {
                        console.warn("[Sub-Agent] Failed to parse tool arguments", toolCall.arguments);
                        this.messages.push({
                            role: "tool",
                            tool_call_id: toolCall.id,
                            content: "Error: Failed to parse tool arguments. Ensure you use valid JSON."
                        });
                        continue;
                    }
                    onUpdate?.(`Executing ${args.action}...`);
                    console.log(`[Sub-Agent] ▶ Executing: ${args.action}`);
                    try {
                        const result = await this.tool.call(args);
                        const payload = result.payload;
                        onProgress?.({
                            type: 'action',
                            toolCallId: '',
                            timestamp: new Date().toISOString(),
                            stepNumber: step,
                            action: {
                                type: args.action,
                                params: args,
                                description: this.formatActionDescription(args),
                            },
                        });
                        if (payload.status === "answer") {
                            this.finalAnswer = payload.text || "Task finished.";
                            console.log(`[Sub-Agent] ✅ Final Answer received: ${this.finalAnswer}`);
                        }
                        if (payload.status === "terminate") {
                            this.terminated = payload.result || "success";
                            console.log(`[Sub-Agent] 🏁 Termination received: ${this.terminated}`);
                        }
                        if (payload.screenshot) {
                            this.lastScreenshot = payload.screenshot;
                            onProgress?.({
                                type: 'screenshot',
                                toolCallId: '',
                                timestamp: new Date().toISOString(),
                                stepNumber: step,
                                screenshot: {
                                    base64: payload.screenshot,
                                    width: payload.downscaled_size?.width || payload.display?.width || 1920,
                                    height: payload.downscaled_size?.height || payload.display?.height || 1080,
                                },
                            });
                        }
                        this.messages.push({
                            role: "tool",
                            tool_call_id: toolCall.id,
                            content: result.asContent(),
                        });
                    }
                    catch (toolErr) {
                        console.error(`[Sub-Agent] ❌ Tool execution error:`, toolErr);
                        this.messages.push({
                            role: "tool",
                            tool_call_id: toolCall.id,
                            content: `Error executing tool: ${toolErr instanceof Error ? toolErr.message : String(toolErr)}`
                        });
                    }
                }
                this.trimMessages();
                if (this.terminated || this.finalAnswer) {
                    console.log(`[Sub-Agent] 🏁 Exiting loop: terminated=${!!this.terminated}, finalAnswer=${!!this.finalAnswer}`);
                    break;
                }
            }
            catch (chatErr) {
                console.error(`[Sub-Agent] ❌ Chat error at step ${step}:`, chatErr);
                if (isAuthError(chatErr)) {
                    // Auth errors (401/403) won't resolve with retries — exit immediately
                    const clientConfig = this.client.config;
                    const baseUrl = clientConfig?.baseUrl || 'unknown';
                    const provider = clientConfig?.provider || 'unknown';
                    const errorMsg = chatErr instanceof Error ? chatErr.message : String(chatErr);
                    const isOllamaCloud = provider === 'ollama-cloud' ||
                        (typeof baseUrl === 'string' && baseUrl.includes('ollama.com'));
                    const verifySteps = isOllamaCloud
                        ? `1. Your Ollama Cloud API key is correct and has not expired\n2. The key has access to model "${this.model}"\n3. Check your Vision Provider settings and re-enter the API key`
                        : `1. Your API key for "${provider}" is correct\n2. The key has not expired or been revoked\n3. Check your Vision Provider settings`;
                    this.finalAnswer = `VLM provider rejected the request (authentication failed). Please verify:\n${verifySteps}\n\nError: ${errorMsg}`;
                    console.error('[Sub-Agent] 🛑 Authentication error — terminating immediately.');
                    break;
                }
                if (isConnectionError(chatErr)) {
                    errorCount++;
                    console.warn(`[Sub-Agent] ⚠️ Connection error (${errorCount}/${MAX_ERRORS})`);
                    if (errorCount >= MAX_ERRORS) {
                        const clientConfig = this.client.config;
                        const baseUrl = clientConfig?.baseUrl || 'unknown';
                        const provider = clientConfig?.provider || 'unknown';
                        const errorMsg = chatErr instanceof Error ? chatErr.message : String(chatErr);
                        const isOllamaCloud = provider === 'ollama-cloud' ||
                            (typeof baseUrl === 'string' && baseUrl.includes('ollama.com'));
                        const is5xx = /HTTP 5\d\d:/.test(errorMsg);
                        let verifySteps;
                        if (isOllamaCloud && is5xx) {
                            verifySteps = `1. The model "${this.model}" is available on Ollama Cloud (cloud models typically require a "-cloud" suffix, e.g. "qwen3-vl:235b-instruct-cloud", "kimi-k2.6:cloud", or "glm-5.1:cloud")\n2. Your Ollama Cloud API key is valid\n3. Check https://ollama.com for available cloud models`;
                        }
                        else if (isOllamaCloud) {
                            verifySteps = `1. Your Ollama Cloud API key is valid and not expired\n2. The baseUrl is correct: ${baseUrl}\n3. The model "${this.model}" is available on Ollama Cloud`;
                        }
                        else {
                            verifySteps = `1. Ollama (or your configured VLM provider) is running\n2. The baseUrl is correct: ${baseUrl}\n3. The model "${this.model}" is available`;
                        }
                        this.finalAnswer = `Unable to reach VLM provider after ${MAX_ERRORS} consecutive attempts. Please verify:\n${verifySteps}\n\nConnection error: ${errorMsg}`;
                        console.error('[Sub-Agent] 🛑 Max connection errors reached. Terminating early.');
                        break;
                    }
                }
                if (step === this.maxTurns)
                    break;
                this.messages.push({
                    role: "system",
                    content: `Error from AI provider: ${chatErr instanceof Error ? chatErr.message : String(chatErr)}. Please try again.`
                });
            }
        }
        return {
            finalAnswer: this.finalAnswer || (this.terminated === 'success' ? `Task completed successfully: ${this.task}` : `Task ended: ${this.terminated || 'unknown'}`),
            lastScreenshot: this.lastScreenshot,
        };
    }
    /**
     * Parses text-based actions like action=left_click(coordinate=[398, 965])
     * which some Vision models prefer over formal JSON function calling.
     */
    parseTextActions(text) {
        const actions = [];
        // Looking for patterns like action=left_click(coordinate=[398, 965]) or action=click(x=1, y=2)
        const actionRegex = /action=([a-z_]+)\((.*?)\)/g;
        let match;
        while ((match = actionRegex.exec(text)) !== null) {
            const actionType = match[1];
            const argsText = match[2];
            const args = { action: actionType };
            // Map 'click' to 'left_click' for compatibility
            if (actionType === 'click')
                args.action = 'left_click';
            // Parse coordinates: x=N, y=N or coordinate=[N, N]
            const coordMatch = argsText.match(/coordinate\s*=\s*\[(\d+),\s*(\d+)\]/);
            if (coordMatch) {
                args.coordinate = [parseInt(coordMatch[1]), parseInt(coordMatch[2])];
            }
            else {
                const xMatch = argsText.match(/x\s*=\s*(\d+)/);
                const yMatch = argsText.match(/y\s*=\s*(\d+)/);
                if (xMatch && yMatch) {
                    args.coordinate = [parseInt(xMatch[1]), parseInt(yMatch[2])];
                }
            }
            // Parse text: text="XYZ"
            const textMatch = argsText.match(/text\s*=\s*"([^"]*)"/);
            if (textMatch)
                args.text = textMatch[1];
            // Parse keys: keys=["enter"] or key="enter"
            const keysMatch = argsText.match(/keys\s*=\s*\[([^\]]*)\]/);
            const keyMatch = argsText.match(/key\s*=\s*"([^"]*)"/);
            if (keysMatch) {
                args.keys = keysMatch[1].split(',').map(k => k.trim().replace(/"/g, ''));
            }
            else if (keyMatch) {
                args.keys = [keyMatch[1]];
            }
            // Parse time: time=N
            const timeMatch = argsText.match(/time\s*=\s*(\d+)/);
            if (timeMatch)
                args.time = parseInt(timeMatch[1]);
            // Parse pixels: pixels=N or pixels=-N
            const pixelsMatch = argsText.match(/pixels\s*=\s*(-?\d+)/);
            if (pixelsMatch)
                args.pixels = parseInt(pixelsMatch[1]);
            // Parse zoom: zoom_factor=N
            const zoomMatch = argsText.match(/zoom_factor\s*=\s*(\d+)/);
            if (zoomMatch)
                args.zoom_factor = parseInt(zoomMatch[1]);
            // Parse status: status="success" or status="failure"
            const statusMatch = argsText.match(/status\s*=\s*"(success|failure)"/);
            if (statusMatch)
                args.status = statusMatch[1];
            actions.push({
                id: `parsed-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
                name: "computer_use",
                arguments: args
            });
        }
        return actions;
    }
    async appendInitialObservation() {
        const observation = await this.tool.captureObservation();
        const screenshot = observation.screenshot;
        const content = [];
        if (screenshot) {
            content.push({
                type: "image_url",
                image_url: { url: screenshot, detail: "low" },
            });
        }
        // Build context with task, open windows, and available apps
        const openAppsInfo = getOpenWindowsInfo();
        const taskbarInfo = getCommonTaskbarApps();
        const contextText = [
            `TASK: ${this.task}`,
            "",
            "CURRENTLY OPEN APPLICATIONS:",
            openAppsInfo,
            taskbarInfo || "(Standard Windows taskbar apps available)",
            "",
            "NOTE: If the app you need is not listed above, you can search for it in the Windows Start Menu:",
            "1. Click the Windows Start button (bottom-left corner)",
            "2. Type the app name (e.g., 'Discord', 'Firefox', 'Slack')",
            "3. Press Enter to launch it"
        ].filter(line => line || line === "").join("\n");
        content.push({ type: "text", text: contextText });
        this.messages.push({ role: "user", content });
    }
    /**
     * Formats action parameters into a human-readable description
     * Requirements: 3.3, 3.4
     */
    formatActionDescription(args) {
        const action = args.action;
        switch (action) {
            case 'left_click':
                if (args.coordinate) {
                    return `Left click at (${args.coordinate[0]}, ${args.coordinate[1]})`;
                }
                return 'Left click';
            case 'right_click':
                if (args.coordinate) {
                    return `Right click at (${args.coordinate[0]}, ${args.coordinate[1]})`;
                }
                return 'Right click';
            case 'middle_click':
                if (args.coordinate) {
                    return `Middle click at (${args.coordinate[0]}, ${args.coordinate[1]})`;
                }
                return 'Middle click';
            case 'double_click':
                if (args.coordinate) {
                    return `Double click at (${args.coordinate[0]}, ${args.coordinate[1]})`;
                }
                return 'Double click';
            case 'triple_click':
                if (args.coordinate) {
                    return `Triple click at (${args.coordinate[0]}, ${args.coordinate[1]})`;
                }
                return 'Triple click';
            case 'mouse_move':
                if (args.coordinate) {
                    return `Move mouse to (${args.coordinate[0]}, ${args.coordinate[1]})`;
                }
                return 'Move mouse';
            case 'left_click_drag':
                if (args.coordinate) {
                    return `Drag to (${args.coordinate[0]}, ${args.coordinate[1]})`;
                }
                return 'Drag';
            case 'scroll':
                const pixels = args.pixels || 0;
                const direction = pixels > 0 ? 'down' : 'up';
                return `Scroll ${direction} ${Math.abs(pixels)} pixels`;
            case 'hscroll':
                const hpixels = args.pixels || 0;
                const hdirection = hpixels > 0 ? 'right' : 'left';
                return `Scroll ${hdirection} ${Math.abs(hpixels)} pixels`;
            case 'type':
                const text = args.text || '';
                const truncated = text.length > 50 ? text.substring(0, 50) + '...' : text;
                return `Type "${truncated}"`;
            case 'key':
            case 'press':
                const keys = args.keys || [];
                return `Press ${keys.join(' + ')}`;
            case 'wait':
                const time = args.time || 1;
                return `Wait ${time} second${time !== 1 ? 's' : ''}`;
            case 'zoom':
                const factor = args.zoom_factor || 1;
                return `Zoom ${factor}x`;
            case 'answer':
                return 'Provide answer';
            case 'terminate':
                const status = args.status || 'success';
                return `Terminate (${status})`;
            default:
                return `Execute ${action}`;
        }
    }
    trimMessages() {
        const base = this.messages.slice(0, this.baseCount);
        const dynamic = this.messages.slice(this.baseCount);
        const maxItems = this.historyWindow * 2;
        if (dynamic.length <= maxItems)
            return;
        this.messages = [...base, ...dynamic.slice(-maxItems)];
    }
}
// ── EverFern Integration Factory (Sub-Agent Mode) ───────────────────────────
let activeAgentInstance = null;
/**
 * Global abort function called from Electron main process.
 */
function abortComputerUse() {
    if (activeAgentInstance) {
        activeAgentInstance.abort();
        activeAgentInstance = null;
    }
}
function createComputerUseTool(originalClient, _platform = process.platform, _visionModel, _showuiUrl, _ollamaBaseUrl, _checkPermission, _requestPermission, vlm) {
    const home = process.env.USERPROFILE || process.env.HOME || "";
    const screenshotDir = path.join(home, ".everfern", "screenshots");
    const tool = new ComputerUseTool(screenshotDir);
    // Use either the provided VLM config or fall back to original client
    const subAgentClient = vlm ? new ai_client_1.AIClient({
        // When the UI saves engine="cloud" with provider="ollama", map to "ollama-cloud"
        // so AIClient uses https://ollama.com as the default baseUrl instead of localhost:11434
        provider: (vlm.engine === 'cloud' && vlm.provider === 'ollama' ? 'ollama-cloud' : vlm.provider) || 'openai',
        apiKey: vlm.apiKey,
        baseUrl: vlm.baseUrl,
        model: vlm.model
    }) : originalClient;
    const subAgentModel = vlm?.model || "qwen3-vl:235b-instruct-cloud";
    return {
        name: "computer_use",
        description: "Launch an autonomous sub-agent to perform GUI tasks natively. Powered by Ollama Cloud (Qwen, Kimi, or GLM).",
        parameters: {
            type: "object",
            properties: {
                task: {
                    type: "string",
                    description: "High-level goal for the sub-agent (e.g. 'Open Spotify and play Blinding Lights')"
                }
            },
            required: ["task"]
        },
        async execute(args, onUpdate, emitEvent, toolCallId) {
            const task = args.task || "Perform a visual audit of the current desktop.";
            onUpdate?.(`Initializing sub-agent for task: "${task}"...`);
            const agent = new ComputerUseAgent(subAgentClient, tool, subAgentModel, task);
            activeAgentInstance = agent;
            // Create ProgressEventEmitter for sub-agent progress streaming with timeline branch support
            // Requirements: 1.1, 1.2, 5.1, 5.2, 5.3, 5.4, 6.1, 6.2
            const mainWindow = global.mainWindow;
            const sender = mainWindow?.webContents || null;
            const effectiveToolCallId = toolCallId || crypto.randomUUID();
            // Extract timeline branch metadata from context or parameters
            const timelineBranchMetadata = {
                parentId: toolCallId, // The parent tool call that spawned this subagent
                agentType: 'computer-use', // This is a computer-use subagent
                branchLevel: 1, // First level subagent (could be enhanced to track actual depth)
                sessionId: effectiveToolCallId,
                taskDescription: task || 'Computer use automation task',
            };
            const progressEmitter = new ProgressEventEmitter(effectiveToolCallId, sender, timelineBranchMetadata);
            // Emit branch start event for timeline visualization
            progressEmitter.emitBranchStart(task);
            // 5.2: Set progress emitter on the tool for cursor position and status event emission
            tool.setProgressEmitter(progressEmitter, effectiveToolCallId);
            try {
                const { finalAnswer, lastScreenshot } = await agent.run((update) => onUpdate?.(update), (event) => {
                    // Set toolCallId for each event before emitting
                    event.toolCallId = effectiveToolCallId;
                    progressEmitter.emit(event);
                });
                const b64 = lastScreenshot?.split(',')[1];
                const finalOutput = finalAnswer || `Successfully completed GUI task: ${task}`;
                // Emit timeline branch completion event
                progressEmitter.emitBranchComplete(finalOutput);
                // Also emit traditional completion event for backward compatibility
                progressEmitter.emit({
                    type: 'complete',
                    toolCallId: effectiveToolCallId,
                    timestamp: new Date().toISOString(),
                });
                return {
                    success: true,
                    output: finalOutput,
                    base64Image: b64,
                    data: { task, finalAnswer: finalOutput, screenshot: b64 }
                };
            }
            catch (error) {
                // Emit timeline branch abort event on error
                const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
                progressEmitter.emitBranchAbort(`Task failed: ${errorMessage}`);
                // Also emit traditional abort event for backward compatibility
                progressEmitter.emit({
                    type: 'abort',
                    toolCallId: effectiveToolCallId,
                    timestamp: new Date().toISOString(),
                    content: errorMessage,
                });
                // Re-throw the error to maintain existing error handling behavior
                throw error;
            }
            finally {
                // Destroy emitter to flush remaining events and clean up
                progressEmitter.destroy();
                if (activeAgentInstance === agent) {
                    activeAgentInstance = null;
                }
            }
        },
        abort() {
            // Emit timeline branch abort event if there's an active agent
            if (activeAgentInstance) {
                // Try to get the progress emitter from the active agent context
                // Note: This is a simplified approach - in a full implementation,
                // we'd need to track the progress emitter instance
                console.debug('[ComputerUse] Aborting active agent instance');
            }
            activeAgentInstance?.abort();
            activeAgentInstance = null;
        }
    };
}
/**
 * Capture the current screen for the runner's initial observation.
 */
async function captureScreen() {
    const home = process.env.USERPROFILE || process.env.HOME || "";
    const tool = new ComputerUseTool(path.join(home, ".everfern", "screenshots"));
    const obs = await tool.captureObservation();
    const b64 = obs.screenshot.split(',')[1];
    const w = obs.display.width;
    const h = obs.display.height;
    return { b64, w, h, physW: w, physH: h };
}
