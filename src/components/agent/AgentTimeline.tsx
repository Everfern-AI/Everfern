"use client";

import React, { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { SubAgentProgressEvent } from "../common/types";
import type { MissionTimeline as MissionTimelineType } from "./MissionTimeline";
import { InlineDebateProgress } from "./InlineDebateProgress";
import { ReasoningBlock } from "./ReasoningComponents";

// ── Types ──────────────────────────────────────────────────────────────────────
export interface ToolCallDisplay {
  id: string;
  toolName?: string;
  icon?: React.ReactNode;
  label?: string;
  color?: string;
  status: "running" | "done" | "error";
  output?: string;
  durationMs?: number;
  data?: any;
  base64Image?: string;
  args?: Record<string, unknown>;
  displayName?: string;
  description?: string;
  phase?: "triage" | "planning" | "execution" | "validation" | "completion";
  thought?: string;
  orderIndex?: number;
  subAgentProgress?: any[];
}

export interface AgentTimelineProps {
  toolCalls: ToolCallDisplay[];
  thought?: string;
  reasoningContent?: string;
  isLive?: boolean;
  showOutput?: boolean;
  currentPhase?: "triage" | "planning" | "execution" | "validation" | "completion";
  currentNode?: string;
  planSteps?: Array<{
    id: string;
    title?: string;
    description: string;
    tool?: string;
    status?: "pending" | "in_progress" | "in-progress" | "completed" | "failed" | "skipped" | "blocked";
    dependencies?: string[];
  }> | null;
  planTitle?: string | null;
  generatedTitle?: string;
  subAgentProgress?: Map<string, SubAgentProgressEvent[]>;
  timelineBranches?: Map<string, any>;
  debateData?: any;
  isDebating?: boolean;
  debateId?: string | null;
  onSkipDebate?: (debateId: string) => void;
  missionTimeline?: MissionTimelineType | null;
  onPillClick?: (tc: ToolCallDisplay) => void;
}

export interface TimelineStepItem {
  id: string;
  kind: "terminal" | "code" | "skill" | "globe" | "search" | "doc" | "verify" | "generic" | "computer";
  verb: string;
  text: string;
  subtext?: string;
  sourceCount?: number;
  toolCall?: ToolCallDisplay;
}

// ── Describing a tool call ────────────────────────────────────────────────────
// Each call becomes one line in the style of Claude Code: a bold verb, the real
// argument (path, command, query) in mono, and a one-line result underneath.

const MONO = 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace)';

function str(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  try { return JSON.stringify(v); } catch { return String(v); }
}

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "");
}

function firstArg(args: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = args[k];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return "";
}

function shortPath(p: string): string {
  if (!p) return "";
  const parts = p.split(/[/\\]/).filter(Boolean);
  return parts.length > 3 ? `…/${parts.slice(-3).join("/")}` : parts.join("/") || p;
}

function oneLine(s: string, max = 110): string {
  // Tool output often opens with an emoji marker; the row already has its own status dot.
  const line = s.replace(/\s+/g, " ").trim().replace(/^[\p{Extended_Pictographic}️‍\s]+/u, "");
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

function toolOutput(tc: ToolCallDisplay): string {
  return stripAnsi(str(tc.output ?? tc.data?.output ?? tc.data?.result ?? "")).trim();
}

const PATH_KEYS = ["TargetFile", "AbsolutePath", "file_path", "filePath", "path", "file", "target", "DirectoryPath", "SearchPath", "dir"];
const CMD_KEYS = ["CommandLine", "command", "cmd", "Command", "script"];

function describeTool(tc: ToolCallDisplay): TimelineStepItem {
  const args = (tc.args || {}) as Record<string, unknown>;
  const name = (tc.toolName || tc.displayName || "").toLowerCase();
  const path = firstArg(args, PATH_KEYS);
  const base = { id: tc.id, toolCall: tc };

  if (name.includes("skill") || (/read|view/.test(name) && /skill/i.test(path))) {
    const skill = firstArg(args, ["name", "skill"]) || path.split(/[/\\]/).filter((p) => p && !p.endsWith(".md")).pop() || "skill";
    return { ...base, kind: "skill", verb: "Skill", text: skill };
  }
  if (name.includes("present")) {
    const files = Array.isArray(args.files) ? (args.files as unknown[]).map(String) : [path].filter(Boolean);
    return { ...base, kind: "doc", verb: "Present", text: files.map(shortPath).join(", ") || "file" };
  }
  if (name.includes("computer") || name.includes("desktop")) {
    return { ...base, kind: "computer", verb: "Computer", text: oneLine(firstArg(args, ["task", "instruction", "goal", "action"]) || tc.label || "task", 90) };
  }
  if (name.includes("navis") || name.includes("browser") || name.includes("browse")) {
    return { ...base, kind: "globe", verb: "Browse", text: oneLine(firstArg(args, ["goal", "task", "url"]) || tc.label || "web", 90) };
  }
  if (name.includes("web_search") || name === "search_web" || (name.includes("search") && name.includes("web"))) {
    return { ...base, kind: "search", verb: "Web search", text: oneLine(firstArg(args, ["query", "Query", "q"]), 90) };
  }
  if (name.includes("fetch") || name.includes("url") || name.includes("read_url")) {
    return { ...base, kind: "globe", verb: "Fetch", text: oneLine(firstArg(args, ["url", "Url", "URL"]), 90) };
  }
  if (name.includes("grep") || name.includes("search") || name.includes("find")) {
    const pattern = firstArg(args, ["pattern", "Pattern", "query", "Query", "regex"]);
    const where = path ? ` in ${shortPath(path)}` : "";
    return { ...base, kind: "search", verb: "Search", text: `${oneLine(pattern, 70)}${where}` };
  }
  if (name.includes("list") || name.includes("glob") || name.includes("ls")) {
    return { ...base, kind: "search", verb: "List", text: shortPath(path || firstArg(args, ["pattern"])) || "." };
  }
  if (/replace|edit|modify|patch/.test(name)) {
    return { ...base, kind: "code", verb: "Update", text: shortPath(path) || "file" };
  }
  if (/write|create/.test(name)) {
    return { ...base, kind: "code", verb: "Write", text: shortPath(path) || "file" };
  }
  if (/read|view|open/.test(name)) {
    return { ...base, kind: "doc", verb: "Read", text: shortPath(path) || "file" };
  }
  if (/command|bash|terminal|shell|exec|run|powershell/.test(name)) {
    return { ...base, kind: "terminal", verb: "Bash", text: oneLine(firstArg(args, CMD_KEYS), 120) || "command" };
  }
  if (/todo|plan/.test(name)) {
    return { ...base, kind: "generic", verb: "Update plan", text: "" };
  }

  const pretty = (tc.displayName || tc.toolName || "Tool").replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
  const anyArg = Object.values(args).find((v) => typeof v === "string" && v.trim()) as string | undefined;
  return { ...base, kind: "generic", verb: pretty, text: oneLine(tc.label || anyArg || "", 90) };
}

/** The one-line result shown under a finished call. */
function resultLine(step: TimelineStepItem): { text: string; tone: "muted" | "error" } {
  const tc = step.toolCall;
  if (!tc) return { text: "", tone: "muted" };
  const out = toolOutput(tc);
  if (tc.status === "error") {
    return { text: oneLine(out.split("\n").find((l) => l.trim()) || "Failed", 120), tone: "error" };
  }
  if (tc.status === "running") return { text: "", tone: "muted" };

  const args = (tc.args || {}) as Record<string, unknown>;
  const lines = out ? out.split("\n").length : 0;
  switch (step.verb) {
    case "Read":
      return { text: lines ? `Read ${lines} ${lines === 1 ? "line" : "lines"}` : "Read", tone: "muted" };
    case "Write": {
      const body = firstArg(args, ["FileContent", "content", "Content"]);
      const n = body ? body.split("\n").length : 0;
      return { text: n ? `Wrote ${n} ${n === 1 ? "line" : "lines"}` : "Written", tone: "muted" };
    }
    case "Update":
      return { text: "Updated", tone: "muted" };
    case "Bash": {
      const first = out.split("\n").map((l) => l.trim()).filter(Boolean);
      if (!first.length) return { text: "No output", tone: "muted" };
      const more = first.length > 1 ? `  +${first.length - 1} ${first.length - 1 === 1 ? "line" : "lines"}` : "";
      return { text: `${oneLine(first[0], 100)}${more}`, tone: "muted" };
    }
    case "Search":
    case "List":
      return { text: lines ? `${lines} ${lines === 1 ? "result" : "results"}` : "No matches", tone: "muted" };
    default:
      return { text: out ? oneLine(out.split("\n").find((l) => l.trim()) || "", 110) : "", tone: "muted" };
  }
}

function summaryLine(steps: TimelineStepItem[]): string {
  const count: Record<string, number> = {};
  for (const s of steps) count[s.verb] = (count[s.verb] || 0) + 1;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const parts: string[] = [];
  const take = (verb: string, fmt: (n: number) => string) => {
    if (count[verb]) { parts.push(fmt(count[verb])); delete count[verb]; }
  };
  take("Bash", (n) => `ran ${plural(n, "command", "commands")}`);
  take("Read", (n) => `read ${plural(n, "file", "files")}`);
  take("Write", (n) => `wrote ${plural(n, "file", "files")}`);
  take("Update", (n) => `edited ${plural(n, "file", "files")}`);
  take("Search", (n) => `searched the code ${n === 1 ? "once" : `${n} times`}`);
  take("Web search", (n) => `searched the web ${n === 1 ? "once" : `${n} times`}`);
  take("Fetch", (n) => `fetched ${plural(n, "page", "pages")}`);
  take("Browse", (n) => `browsed ${plural(n, "site", "sites")}`);
  take("Computer", (n) => `used the computer ${n === 1 ? "once" : `${n} times`}`);
  const rest = Object.values(count).reduce((a, b) => a + b, 0);
  if (rest) parts.push(`used ${plural(rest, "other tool", "other tools")}`);
  const line = parts.join(", ");
  return line ? line[0].toUpperCase() + line.slice(1) : "";
}

function formatDuration(ms?: number): string {
  if (!ms || ms < 0) return "";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

// ── Pieces ────────────────────────────────────────────────────────────────────

function StatusDot({ status }: { status: ToolCallDisplay["status"] }) {
  const color =
    status === "error" ? "var(--color-error, #ef4444)"
    : status === "running" ? "var(--color-text-secondary)"
    : "var(--color-success, #10b981)";
  return (
    <span aria-hidden className={status === "running" ? "ef-tl-pulse" : undefined}
      style={{ width: 7, height: 7, borderRadius: "50%", background: color, flexShrink: 0, marginTop: 7 }} />
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden
      style={{ flexShrink: 0, transform: open ? "rotate(90deg)" : "none", transition: "transform 160ms ease" }}>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function DetailBlock({ label, body, tone = "normal" }: { label: string; body: string; tone?: "normal" | "error" }) {
  if (!body) return null;
  const lines = body.split("\n");
  const clipped = lines.length > 200 ? `${lines.slice(0, 200).join("\n")}\n… ${lines.length - 200} more lines` : body;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.02em", color: "var(--color-text-tertiary)" }}>{label}</span>
      <pre style={{
        margin: 0, padding: "8px 10px", borderRadius: 8, maxHeight: 260, overflow: "auto",
        background: "var(--color-bg-subtle)", border: "1px solid var(--color-border)",
        fontFamily: MONO, fontSize: 12, lineHeight: 1.55, whiteSpace: "pre-wrap", wordBreak: "break-word",
        color: tone === "error" ? "var(--color-error, #ef4444)" : "var(--color-text-secondary)",
      }}>{clipped}</pre>
    </div>
  );
}

function stepInput(step: TimelineStepItem): { label: string; body: string } {
  const tc = step.toolCall;
  const args = (tc?.args || {}) as Record<string, unknown>;
  if (step.verb === "Bash") return { label: "Command", body: firstArg(args, CMD_KEYS) };
  if (step.verb === "Write") return { label: "Content", body: firstArg(args, ["FileContent", "content", "Content"]) };
  if (step.verb === "Update") {
    const oldS = firstArg(args, ["oldString", "old_string", "TargetContent", "find"]);
    const newS = firstArg(args, ["newString", "new_string", "ReplacementContent", "replace"]);
    if (oldS || newS) {
      const diff = [
        ...oldS.split("\n").map((l) => `- ${l}`),
        ...newS.split("\n").map((l) => `+ ${l}`),
      ].join("\n");
      return { label: "Change", body: diff };
    }
  }
  const keys = Object.keys(args);
  if (!keys.length) return { label: "Input", body: "" };
  let body = "";
  try { body = JSON.stringify(args, null, 2); } catch { body = str(args); }
  return { label: "Input", body: body.length > 4000 ? `${body.slice(0, 4000)}…` : body };
}

function ToolRow({ step, onOpen, threadBelow }: {
  step: TimelineStepItem;
  onOpen?: (tc: ToolCallDisplay) => void;
  threadBelow: boolean;
}) {
  const [open, setOpen] = useState(false);
  const tc = step.toolCall!;
  const result = resultLine(step);
  const duration = formatDuration(tc.durationMs);
  const input = stepInput(step);
  const output = toolOutput(tc);
  const canOpenPane = !!onOpen && (step.kind === "code" || step.kind === "doc" || step.kind === "computer" || step.kind === "globe");
  const expandable = !!(input.body || output || tc.base64Image);

  return (
    <div style={{ position: "relative", display: "flex", gap: 10, paddingBottom: 6 }}>
      {/* Thread connecting this call to the next */}
      {threadBelow && (
        <span aria-hidden style={{ position: "absolute", left: 3, top: 17, bottom: -1, width: 1, background: "var(--color-border)" }} />
      )}
      <StatusDot status={tc.status} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <button
          type="button"
          aria-expanded={expandable ? open : undefined}
          disabled={!expandable}
          onClick={() => setOpen((v) => !v)}
          className="ef-tl-row"
          style={{
            all: "unset", boxSizing: "border-box", width: "100%", display: "flex", alignItems: "baseline", gap: 8,
            cursor: expandable ? "pointer" : "default", padding: "2px 6px", margin: "0 -6px", borderRadius: 6,
          }}
        >
          <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--color-text-primary)", flexShrink: 0 }}>{step.verb}</span>
          {step.text && (
            <span title={step.text} style={{
              fontFamily: MONO, fontSize: 12.5, color: "var(--color-text-secondary)",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, flex: 1,
            }}>{step.text}</span>
          )}
          {!step.text && <span style={{ flex: 1 }} />}
          {duration && tc.status !== "running" && (
            <span style={{ fontSize: 11.5, color: "var(--color-text-tertiary)", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{duration}</span>
          )}
          {expandable && <span style={{ color: "var(--color-text-tertiary)", display: "flex" }}><Chevron open={open} /></span>}
        </button>

        {/* One-line result, indented under the call */}
        {(tc.status === "running" || result.text) && (
          <div style={{ display: "flex", gap: 6, alignItems: "baseline", paddingLeft: 2, marginTop: 1 }}>
            <span aria-hidden style={{
              width: 8, height: 8, flexShrink: 0, borderLeft: "1px solid var(--color-border-strong, var(--color-border))",
              borderBottom: "1px solid var(--color-border-strong, var(--color-border))", borderBottomLeftRadius: 3,
              transform: "translateY(-2px)",
            }} />
            <span style={{
              fontSize: 12.5, lineHeight: 1.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0,
              fontFamily: step.verb === "Bash" && tc.status !== "running" ? MONO : undefined,
              color: result.tone === "error" ? "var(--color-error, #ef4444)" : "var(--color-text-tertiary)",
            }}>
              {tc.status === "running" ? <span className="ef-tl-shimmer">Running…</span> : result.text}
            </span>
          </div>
        )}

        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              key="detail"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ type: "spring", bounce: 0, duration: 0.3 }}
              style={{ overflow: "hidden" }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "8px 0 4px" }}>
                <DetailBlock label={input.label} body={input.body} />
                <DetailBlock label={tc.status === "error" ? "Error" : "Output"} body={output} tone={tc.status === "error" ? "error" : "normal"} />
                {tc.base64Image && (
                  <img alt="Screenshot from this step" src={tc.base64Image.startsWith("data:") ? tc.base64Image : `data:image/png;base64,${tc.base64Image}`}
                    style={{ maxWidth: "100%", borderRadius: 8, border: "1px solid var(--color-border)" }} />
                )}
                {canOpenPane && (
                  <button type="button" onClick={() => onOpen!(tc)} className="ef-tl-link"
                    style={{ all: "unset", cursor: "pointer", fontSize: 12, fontWeight: 500, color: "var(--color-text-secondary)", alignSelf: "flex-start" }}>
                    Open in side panel
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ── Main AgentTimeline Component ──────────────────────────────────────────────

/** How many finished calls stay visible above the live ones before older calls fold away. */
const LIVE_TAIL = 6;

export const AgentTimeline = React.memo(({
  toolCalls = [],
  thought,
  reasoningContent,
  isLive,
  debateData,
  isDebating,
  debateId,
  onSkipDebate,
  onPillClick,
}: AgentTimelineProps) => {
  const steps = useMemo(() => toolCalls.map(describeTool), [toolCalls]);
  const [expanded, setExpanded] = useState(false);

  const reasoning = (reasoningContent || thought || "").trim();
  if (steps.length === 0 && !isDebating && !debateData && !reasoning) return null;

  const running = steps.some((s) => s.toolCall?.status === "running");
  const errors = steps.filter((s) => s.toolCall?.status === "error").length;
  const summary = summaryLine(steps);

  // Finished runs fold into one summary line; a live run shows its latest calls.
  const folded = !isLive && steps.length > 3 && !expanded;
  const hiddenLive = isLive && !expanded ? Math.max(0, steps.length - LIVE_TAIL) : 0;
  const visible = folded ? [] : steps.slice(hiddenLive);

  return (
    <div className="ef-timeline" style={{ width: "100%", display: "flex", flexDirection: "column", padding: "2px 0 10px", fontFamily: "var(--font-sans)" }}>
      {(isDebating || debateData) && (
        <div style={{ margin: "0 0 12px" }}>
          <InlineDebateProgress debate={debateData} isDebating={!!isDebating} debateId={debateId} onSkipDebate={onSkipDebate} />
        </div>
      )}

      {reasoning && (
        <div style={{ marginBottom: steps.length ? 6 : 0 }}>
          <ReasoningBlock content={reasoning} streaming={!!isLive && !running} />
        </div>
      )}

      {steps.length > 0 && (folded || hiddenLive > 0 || (!isLive && steps.length > 3)) && (
        <button
          type="button"
          aria-expanded={!folded && hiddenLive === 0}
          onClick={() => setExpanded((v) => !v)}
          className="ef-tl-row"
          style={{
            all: "unset", boxSizing: "border-box", display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
            padding: "3px 6px", margin: "0 -6px 6px", borderRadius: 6, alignSelf: "flex-start", maxWidth: "100%",
            fontSize: 13, color: "var(--color-text-secondary)",
          }}
        >
          <span style={{ color: "var(--color-text-tertiary)", display: "flex" }}><Chevron open={!folded && hiddenLive === 0} /></span>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {hiddenLive > 0 ? `${hiddenLive} earlier ${hiddenLive === 1 ? "step" : "steps"}` : summary || `${steps.length} steps`}
          </span>
          {errors > 0 && !hiddenLive && (
            <span style={{ fontSize: 12, color: "var(--color-error, #ef4444)", flexShrink: 0 }}>
              {errors} failed
            </span>
          )}
        </button>
      )}

      {visible.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {visible.map((step, i) => (
            <ToolRow
              key={`${step.id}-${i + hiddenLive}`}
              step={step}
              onOpen={onPillClick}
              threadBelow={i < visible.length - 1}
            />
          ))}
        </div>
      )}
    </div>
  );
});

AgentTimeline.displayName = "AgentTimeline";

export default AgentTimeline;
