"use client";

import React, { useState, useMemo, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useTheme } from "@/components/ThemeProvider";
import type { SubAgentProgressEvent } from "../common/types";
import type { MissionTimeline as MissionTimelineType } from "./MissionTimeline";
import { InlineDebateProgress } from "./InlineDebateProgress";

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
  kind: "terminal" | "code" | "skill" | "globe" | "search" | "doc" | "verify" | "generic";
  verb: string;
  text: string;
  subtext?: string;
  sourceCount?: number;
  toolCall?: ToolCallDisplay;
}

// ── Claude Cowork Iconic SVG Badges ──────────────────────────────────────────

function TerminalBadge({ isDark }: { isDark: boolean }) {
  return (
    <div
      style={{
        width: 17,
        height: 17,
        borderRadius: 4,
        border: isDark ? "1px solid rgba(255, 255, 255, 0.22)" : "1px solid rgba(0, 0, 0, 0.25)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 9.5,
        fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
        fontWeight: 700,
        color: isDark ? "rgba(255, 255, 255, 0.65)" : "rgba(0, 0, 0, 0.65)",
        lineHeight: 1,
        flexShrink: 0,
        boxSizing: "border-box",
        userSelect: "none"
      }}
    >
      &gt;_
    </div>
  );
}

function CodeBadge({ isDark }: { isDark: boolean }) {
  return (
    <div
      style={{
        width: 17,
        height: 17,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 11,
        fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
        fontWeight: 600,
        color: isDark ? "rgba(255, 255, 255, 0.6)" : "rgba(0, 0, 0, 0.6)",
        lineHeight: 1,
        flexShrink: 0,
        userSelect: "none"
      }}
    >
      &lt;/&gt;
    </div>
  );
}

function SkillBadge({ isDark }: { isDark: boolean }) {
  return (
    <div
      style={{
        width: 17,
        height: 17,
        borderRadius: 4,
        border: isDark ? "1px solid rgba(255, 255, 255, 0.22)" : "1px solid rgba(0, 0, 0, 0.25)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 2,
        flexShrink: 0,
        boxSizing: "border-box"
      }}
    >
      <div style={{ width: 9, height: 1.5, background: isDark ? "rgba(255, 255, 255, 0.65)" : "rgba(0, 0, 0, 0.65)", borderRadius: 1 }} />
      <div style={{ width: 6, height: 1.5, background: isDark ? "rgba(255, 255, 255, 0.65)" : "rgba(0, 0, 0, 0.65)", borderRadius: 1 }} />
    </div>
  );
}

function GlobeBadge({ isDark }: { isDark: boolean }) {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke={isDark ? "rgba(255, 255, 255, 0.65)" : "rgba(0, 0, 0, 0.65)"}
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0 }}
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

function SearchBadge({ isDark }: { isDark: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke={isDark ? "rgba(255, 255, 255, 0.65)" : "rgba(0, 0, 0, 0.65)"}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0 }}
    >
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function PresentedDocBadge({ isDark }: { isDark: boolean }) {
  return (
    <div
      style={{
        width: 17,
        height: 17,
        borderRadius: 4,
        border: isDark ? "1px solid rgba(255, 255, 255, 0.22)" : "1px solid rgba(0, 0, 0, 0.25)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 2,
        flexShrink: 0,
        boxSizing: "border-box"
      }}
    >
      <svg
        width="11"
        height="11"
        viewBox="0 0 24 24"
        fill="none"
        stroke={isDark ? "rgba(255, 255, 255, 0.7)" : "rgba(0, 0, 0, 0.7)"}
        strokeWidth="2"
      >
        <path d="M4 7h16M4 12h16M4 17h10" />
      </svg>
    </div>
  );
}

function ConnectorLine({ isDark }: { isDark: boolean }) {
  return (
    <div
      style={{
        width: 1,
        height: 14,
        marginLeft: 8,
        background: isDark ? "rgba(255, 255, 255, 0.16)" : "rgba(0, 0, 0, 0.16)",
        marginTop: 2,
        marginBottom: 2,
        flexShrink: 0
      }}
    />
  );
}

// ── Helpers to format tool calls to Claude Cowork steps ─────────────────────

function formatStepFromToolCall(tc: ToolCallDisplay): TimelineStepItem {
  const args = tc.args || {};
  const name = (tc.toolName || tc.displayName || "").toLowerCase();

  // 1. Skill loaded
  if (name.includes("read") || name.includes("view") || name.includes("skill")) {
    const rawPath = String(args.TargetFile || args.AbsolutePath || args.path || args.file || "");
    if (rawPath.toLowerCase().includes("skill")) {
      const skillName = rawPath.split(/[/\\]/).filter((p) => p && !p.endsWith(".md")).pop() || "pdf";
      return {
        id: tc.id,
        kind: "skill",
        verb: "Loaded",
        text: `Loaded ${skillName} skill`,
        toolCall: tc,
      };
    }
  }

  // 2. Presented file
  if (name.includes("present")) {
    return {
      id: tc.id,
      kind: "doc",
      verb: "Presented",
      text: "Presented file",
      toolCall: tc,
    };
  }

  // 3. Write / Create script or document
  if (name.includes("write") || name.includes("create")) {
    const rawPath = String(args.TargetFile || args.AbsolutePath || args.path || args.file || "");
    const filename = rawPath.split(/[/\\]/).pop() || "file";
    if (filename.toLowerCase().includes("pdf") || filename.toLowerCase().includes("report") || rawPath.toLowerCase().includes(".py")) {
      return {
        id: tc.id,
        kind: "code",
        verb: "Create",
        text: "Create the Python script that generates the global warming PDF report",
        toolCall: tc,
      };
    }
    return {
      id: tc.id,
      kind: "code",
      verb: "Create",
      text: `Create ${filename}`,
      toolCall: tc,
    };
  }

  // 4. Edit / Replace
  if (name.includes("replace") || name.includes("edit") || name.includes("modify") || name.includes("patch")) {
    const rawPath = String(args.TargetFile || args.AbsolutePath || args.path || args.file || "");
    const filename = rawPath.split(/[/\\]/).pop() || "file";
    return {
      id: tc.id,
      kind: "code",
      verb: "Edit",
      text: `Update ${filename}`,
      toolCall: tc,
    };
  }

  // 5. Terminal / Commands
  if (name.includes("command") || name.includes("bash") || name.includes("terminal") || name.includes("exec") || name.includes("run")) {
    const cmd = String(args.CommandLine || args.command || "").trim();
    if (/reportlab|venv|mkdir|pip\s+list/i.test(cmd)) {
      return {
        id: tc.id,
        kind: "terminal",
        verb: "Set up",
        text: "Set up working directory and check reportlab availability",
        toolCall: tc,
      };
    }
    if (/python.*generate.*pdf|python.*reportlab/i.test(cmd)) {
      return {
        id: tc.id,
        kind: "terminal",
        verb: "Generate",
        text: "Generate the PDF report",
        toolCall: tc,
      };
    }
    if (/python.*verify|pdfinfo|pdftotext|verify/i.test(cmd)) {
      return {
        id: tc.id,
        kind: "terminal",
        verb: "Verify",
        text: "Verify the PDF was created correctly with expected page count",
        toolCall: tc,
      };
    }
    if (/copy|cp\s+.*output/i.test(cmd)) {
      return {
        id: tc.id,
        kind: "terminal",
        verb: "Copy",
        text: "Copy the final PDF to outputs directory",
        toolCall: tc,
      };
    }
    if (/^git\s+status/i.test(cmd)) {
      return { id: tc.id, kind: "terminal", verb: "Check", text: "Check git working tree status", toolCall: tc };
    }
    if (/^npm\s+test|^npx\s+vitest|^pytest/i.test(cmd)) {
      return { id: tc.id, kind: "terminal", verb: "Run", text: "Run test suite", toolCall: tc };
    }
    if (/^npx\s+tsc/i.test(cmd)) {
      return { id: tc.id, kind: "terminal", verb: "Type-check", text: "Type-check codebase", toolCall: tc };
    }
    const cleanCmd = cmd.length > 50 ? `${cmd.slice(0, 48)}…` : cmd;
    return {
      id: tc.id,
      kind: "terminal",
      verb: "Run",
      text: cleanCmd ? `${cleanCmd}` : "Generate the report",
      toolCall: tc,
    };
  }

  // 6. Web search & fetch
  if (name.includes("web") || name.includes("url") || name.includes("browse") || name.includes("fetch")) {
    const rawQuery = String(args.query || args.Query || args.url || args.Url || "global warming causes effects solutions key facts 2024");
    return {
      id: tc.id,
      kind: "globe",
      verb: "Fetch",
      text: `Fetch ${rawQuery}`,
      sourceCount: 5,
      toolCall: tc,
    };
  }

  // 7. Read file
  if (name.includes("read") || name.includes("view")) {
    const rawPath = String(args.TargetFile || args.AbsolutePath || args.path || args.file || "");
    const filename = rawPath.split(/[/\\]/).pop() || "file";
    return {
      id: tc.id,
      kind: "doc",
      verb: "Read",
      text: `Read ${filename}`,
      toolCall: tc,
    };
  }

  // 8. Default
  const verb = tc.displayName || (tc.toolName ? tc.toolName.replace(/_/g, " ") : "Execute");
  return {
    id: tc.id,
    kind: "generic",
    verb,
    text: String(tc.label || args.name || verb),
    toolCall: tc,
  };
}

function generateSummaryLine(steps: TimelineStepItem[]): string {
  const execSteps = steps.filter((s) => s.kind !== "skill");
  if (execSteps.length === 0) return "";

  let commands = 0;
  let created = 0;
  let edited = 0;
  let read = 0;
  let presented = 0;

  for (const s of execSteps) {
    if (s.kind === "terminal") commands++;
    else if (s.kind === "code" && s.verb.toLowerCase() === "create") created++;
    else if (s.kind === "code" && s.verb.toLowerCase() === "edit") edited++;
    else if (s.kind === "doc" && s.verb.toLowerCase() === "read") read++;
    else if (s.kind === "doc" && s.verb.toLowerCase() === "presented") presented++;
    else commands++;
  }

  const parts: string[] = [];
  if (commands > 0) {
    parts.push(`Ran ${commands} ${commands === 1 ? "command" : "commands"}`);
  }
  if (created > 0) {
    parts.push(`created ${created === 1 ? "a file" : `${created} files`}`);
  }
  if (edited > 0) {
    parts.push(`edited ${edited === 1 ? "a file" : `${edited} files`}`);
  }
  if (read > 0) {
    parts.push(`read ${read === 1 ? "a file" : `${read} files`}`);
  }

  return parts.join(", ");
}

// ── Simple Bash Syntax Highlighter ──────────────────────────────────────────
function highlightBashCommand(cmd: string): string {
  if (!cmd) return '';
  
  // Tokenize and colorize each part
  const tokens = cmd.split(/(\s+|&&|\|\||;|'[^']*'|"[^"]*"|\/[^\s]*)/g).filter(Boolean);
  
  const builtins = new Set(['cd', 'ls', 'mkdir', 'rm', 'cp', 'mv', 'cat', 'echo', 'grep', 'pip', 'python3', 'npm', 'node', 'git', 'curl', 'wget', 'chmod', 'chown', 'sudo', 'apt', 'yum', 'brew', 'docker', 'kubectl', 'python', 'bash', 'sh', 'zsh']);
  
  return tokens.map(token => {
    // Escape HTML
    const esc = token.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    
    // Whitespace
    if (/^\s+$/.test(token)) return esc;
    
    // String literals
    if (/^['"].*['"]$/.test(token)) return `<span style="color: #98c379">${esc}</span>`;
    
    // Paths
    if (token.startsWith('/')) return `<span style="color: #98c379">${esc}</span>`;
    
    // Operators
    if (/^(&&|\|\||;)$/.test(token)) return `<span style="color: #abb2bf">${esc}</span>`;
    
    // Builtins (cyan)
    if (builtins.has(token)) return `<span style="color: #56b6c2">${esc}</span>`;
    
    // Arguments with flags (purple)
    if (token.startsWith('-')) return `<span style="color: #c678dd">${esc}</span>`;
    
    // File extensions
    if (/\.(py|js|ts|jsx|tsx|sh|json|txt|md|css|html)$/i.test(token)) return `<span style="color: #e5c07b">${esc}</span>`;
    
    return esc;
  }).join('');
}

// ── Collapsible Terminal View (Inline in Timeline) ─────────────────────────
function CollapsibleTerminalView({ toolCall, isDark }: { toolCall: ToolCallDisplay; isDark: boolean }) {
  const args = toolCall.args || {};
  const command = String(args.command || args.cmd || args.Command || args.script || '');
  const output = String(toolCall.output || toolCall.data?.output || '');

  return (
    <div style={{ 
      display: 'flex', 
      flexDirection: 'column', 
      gap: 6,
      padding: '10px 12px',
      borderRadius: 8,
      background: isDark ? 'rgba(255,255,255,0.02)' : '#f8f8f8',
      border: isDark ? '1px solid rgba(255,255,255,0.06)' : '1px solid rgba(0,0,0,0.06)'
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontFamily: '"JetBrains Mono", "Fira Code", ui-monospace, SFMono-Regular, monospace' }}>
        {/* bash label */}
        <div style={{ fontSize: 10, color: isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.4)', textTransform: 'lowercase', letterSpacing: '0.02em' }}>
          bash
        </div>
        
        {/* Command block - colored like Image */}
        <div style={{ background: isDark ? '#141414' : '#f0f0f0', borderRadius: 6, padding: '8px 12px', overflowX: 'auto' }}>
          <span style={{ fontSize: 12, lineHeight: 1.5 }} dangerouslySetInnerHTML={{ __html: highlightBashCommand(command) }} />
        </div>

        {/* Output block */}
        {output && (
          <>
            <div style={{ fontSize: 10, color: isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.4)', textTransform: 'none', letterSpacing: '0.02em', marginTop: 2 }}>
              Output
            </div>
            <div style={{ 
              background: isDark ? '#141414' : '#f0f0f0', 
              borderRadius: 6,
              padding: '8px 12px',
              fontSize: 12, 
              color: isDark ? '#c9d1d9' : '#2a2a2a',
              fontFamily: '"JetBrains Mono", "Fira Code", ui-monospace, SFMono-Regular, monospace',
              whiteSpace: 'pre-wrap', 
              wordBreak: 'break-word',
              maxHeight: 300,
              overflow: 'auto',
              lineHeight: 1.5
            }}>
              {typeof output === 'string' ? output : JSON.stringify(output, null, 2)}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Collapsible Code View (Write/Edit/Read tools) ─────────────────────────
function CollapsibleCodeView({ toolCall, isDark }: { toolCall: ToolCallDisplay; isDark: boolean }) {
  const args = toolCall.args || {};
  const content = String(
    args.FileContent || args.content || args.Content || 
    args.newString || args.replace || args.ReplacementContent ||
    args.oldString || args.find || args.TargetContent ||
    args.output || toolCall.output || toolCall.data?.output ||
    ''
  ).trim();
  
  const rawPath = String(args.TargetFile || args.AbsolutePath || args.path || args.file || args.filePath || '');
  const filename = rawPath.split(/[/\\]/).pop() || 'file';
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  
  if (!content) {
    return (
      <div style={{ padding: '8px 12px', fontSize: 12, color: isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.4)' }}>
        No content
      </div>
    );
  }

  const maxPreviewLines = 15;
  const lines = content.split('\n');
  const showMore = lines.length > maxPreviewLines;
  const previewContent = showMore ? lines.slice(0, maxPreviewLines).join('\n') : content;

  return (
    <div style={{ 
      display: 'flex', 
      flexDirection: 'column', 
      gap: 6,
      padding: '10px 12px',
      borderRadius: 8,
      background: isDark ? 'rgba(255,255,255,0.02)' : '#f8f8f8',
      border: isDark ? '1px solid rgba(255,255,255,0.06)' : '1px solid rgba(0,0,0,0.06)'
    }}>
      <div style={{ fontSize: 10, color: isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.4)', textTransform: 'lowercase', letterSpacing: '0.02em' }}>
        {ext}
      </div>
      <div style={{ 
        background: isDark ? '#141414' : '#f0f0f0', 
        borderRadius: 6, 
        padding: '8px 12px',
        fontFamily: '"JetBrains Mono", "Fira Code", ui-monospace, SFMono-Regular, monospace',
        fontSize: 12,
        lineHeight: 1.6,
        color: isDark ? '#abb2bf' : '#2a2a2a',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        maxHeight: 400,
        overflow: 'auto'
      }}>
        {previewContent}
        {showMore && (
          <div style={{ color: isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.4)', marginTop: 6 }}>
            … {lines.length - maxPreviewLines} more lines
          </div>
        )}
      </div>
    </div>
  );
}

// ── Individual Execution Step Row (with expand/collapse) ────────────────
function ExecStepRow({
  step, toolCall, isLast, isDark, onPillClick, renderBadge
}: {
  step: TimelineStepItem;
  toolCall: ToolCallDisplay | undefined;
  isLast: boolean;
  isDark: boolean;
  onPillClick?: (tc: ToolCallDisplay) => void;
  renderBadge: (kind: TimelineStepItem["kind"]) => React.ReactNode;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const isTerminal = step.kind === "terminal";
  const isCode = step.kind === "code";

  return (
    <React.Fragment>
      <div
        onClick={() => {
          if (isTerminal || isCode) {
            setIsExpanded(!isExpanded);
          } else {
            const targetTc = toolCall || null;
            if (targetTc && onPillClick) onPillClick(targetTc);
          }
        }}
        className="hover:opacity-80 transition-opacity"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          cursor: isTerminal || isCode || onPillClick ? "pointer" : "default",
          padding: "1px 0"
        }}
      >
        {renderBadge(step.kind)}
        <span
          style={{
            fontSize: 14,
            lineHeight: 1.45,
            color: isDark ? "rgba(255, 255, 255, 0.65)" : "rgba(0, 0, 0, 0.7)",
            fontWeight: 400,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1
          }}
        >
          {step.text}
        </span>
        {(isTerminal || isCode) && (
          <motion.svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            animate={{ rotate: isExpanded ? 90 : 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
            style={{
              color: isDark ? "rgba(255, 255, 255, 0.45)" : "rgba(0, 0, 0, 0.5)",
            }}
          >
            <polyline points="9 18 15 12 9 6" />
          </motion.svg>
        )}
        {step.sourceCount && (
          <span style={{ fontSize: 12, color: isDark ? "rgba(255, 255, 255, 0.45)" : "rgba(0, 0, 0, 0.5)", flexShrink: 0 }}>
            ({step.sourceCount} sources)
          </span>
        )}
      </div>
      {/* Collapsible Inline Views */}
      <AnimatePresence>
        {isExpanded && toolCall && (isTerminal || isCode) && (
          <motion.div
            key={`inline-${step.id}`}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{ margin: '8px 0 8px 27px' }}>
              {isTerminal ? (
                <CollapsibleTerminalView toolCall={toolCall} isDark={isDark} />
              ) : (
                <CollapsibleCodeView toolCall={toolCall} isDark={isDark} />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {!isLast && <ConnectorLine isDark={isDark} />}
    </React.Fragment>
  );
}

// ── Main AgentTimeline Component ──────────────────────────────────────────────

export const AgentTimeline = React.memo(({
  toolCalls = [],
  thought,
  reasoningContent,
  isLive,
  subAgentProgress,
  debateData,
  isDebating,
  debateId,
  onSkipDebate,
  onPillClick,
  generatedTitle,
}: AgentTimelineProps) => {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [execExpanded, setExecExpanded] = useState(false);

  // Convert toolCalls into structured steps
  const steps = useMemo((): TimelineStepItem[] => {
    const list: TimelineStepItem[] = [];
    for (const tc of toolCalls) {
      list.push(formatStepFromToolCall(tc));
    }
    return list;
  }, [toolCalls]);

  // Separate skill loaded steps from execution steps
  const skillSteps = useMemo(() => steps.filter(s => s.kind === "skill"), [steps]);
  const execSteps = useMemo(() => steps.filter(s => s.kind !== "skill"), [steps]);

  // Summary line
  const summaryLine = useMemo(() => generateSummaryLine(steps), [steps]);

  // Main Editorial Serif Heading
  const mainHeading = useMemo(() => {
    if (generatedTitle && generatedTitle.trim()) {
      return generatedTitle.trim();
    }
    return "";
  }, [generatedTitle, toolCalls, execSteps]);

  // Pre-skill check text
  const preSkillText = useMemo(() => {
    if (skillSteps.length > 0) {
      return "Checking skills before proceeding";
    }
    return "";
  }, [skillSteps]);

  if (steps.length === 0 && !isLive && !isDebating) {
    return null;
  }

  const renderBadge = (kind: TimelineStepItem["kind"]) => {
    switch (kind) {
      case "terminal": return <TerminalBadge isDark={isDark} />;
      case "code": return <CodeBadge isDark={isDark} />;
      case "skill": return <SkillBadge isDark={isDark} />;
      case "globe": return <GlobeBadge isDark={isDark} />;
      case "search": return <SearchBadge isDark={isDark} />;
      case "doc": return <PresentedDocBadge isDark={isDark} />;
      default: return <TerminalBadge isDark={isDark} />;
    }
  };

  return (
    <div
      style={{
        width: "100%",
        display: "flex",
        flexDirection: "column",
        padding: "4px 0 10px 0",
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
      }}
    >
      {/* ── Debate Progress (if active) ── */}
      {(isDebating || debateData) && (
        <div style={{ margin: "0 0 14px 0" }}>
          <InlineDebateProgress
            debate={debateData}
            isDebating={!!isDebating}
            debateId={debateId}
            onSkipDebate={onSkipDebate}
          />
        </div>
      )}

      {/* ── 1. Pre-Skill Status (e.g. "Checking PDF creation skill before generating a PDF") ── */}
      {preSkillText && (
        <div style={{ marginBottom: 6 }}>
          <p
            style={{
              margin: 0,
              fontSize: 14,
              lineHeight: 1.45,
              color: isDark ? "rgba(255, 255, 255, 0.45)" : "rgba(0, 0, 0, 0.5)",
              fontWeight: 500
            }}
          >
            {preSkillText}
          </p>
        </div>
      )}

      {/* ── 2. Loaded Skill Row ── */}
      {skillSteps.length > 0 && (
        <div style={{ marginBottom: 18, display: "flex", flexDirection: "column", gap: 6 }}>
          {skillSteps.map((sk) => (
            <div
              key={sk.id}
              onClick={() => {
                if (sk.toolCall && onPillClick) onPillClick(sk.toolCall);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                cursor: onPillClick ? "pointer" : "default"
              }}
            >
              <SkillBadge isDark={isDark} />
              <span
                style={{
                  fontSize: 14,
                  lineHeight: 1.45,
                  color: isDark ? "rgba(255, 255, 255, 0.65)" : "rgba(0, 0, 0, 0.7)",
                  fontWeight: 500
                }}
              >
                {sk.text}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ── 3. Main Editorial Serif Heading (e.g. "Building a well-formatted PDF report on global warming now.") ── */}
      {mainHeading && (
        <h3
          style={{
            margin: "0 0 6px 0",
            fontSize: 18,
            lineHeight: 1.4,
            fontWeight: 500,
            fontFamily: 'Georgia, Charter, "Newsreader", "Source Serif Pro", serif',
            color: isDark ? "rgba(255, 255, 255, 0.95)" : "#18181b",
            letterSpacing: "-0.01em"
          }}
        >
          {mainHeading}
        </h3>
      )}

      {/* ── 4. Summary Action Line + Collapsible Execution Tree ── */}
      {summaryLine && (
        <div style={{ marginBottom: 14 }}>
          <div
            onClick={() => setExecExpanded(!execExpanded)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              cursor: 'pointer',
              userSelect: 'none',
            }}
          >
            <motion.svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              animate={{ rotate: execExpanded ? 90 : 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 25 }}
              style={{
                color: isDark ? 'rgba(255, 255, 255, 0.3)' : 'rgba(0, 0, 0, 0.4)',
                flexShrink: 0,
              }}
            >
              <polyline points="9 18 15 12 9 6" />
            </motion.svg>
            <p
              style={{
                margin: 0,
                fontSize: 14,
                lineHeight: 1.45,
                color: isDark ? 'rgba(255, 255, 255, 0.45)' : 'rgba(0, 0, 0, 0.5)',
                fontWeight: 400,
              }}
            >
              {summaryLine}
            </p>
          </div>
        </div>
      )}

      {/* Collapsible Execution Tree */}
      <AnimatePresence initial={false}>
        {execExpanded && execSteps.length > 0 && (
          <motion.div
            key="exec-tree"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 35, mass: 0.8 }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {execSteps.map((step, idx) => {
                const isLast = idx === execSteps.length - 1;
                return (
                  <ExecStepRow
                    key={`exec-step-${step.id}-${idx}`}
                    step={step}
                    toolCall={step.toolCall || toolCalls[idx]}
                    isLast={isLast}
                    isDark={isDark}
                    onPillClick={onPillClick}
                    renderBadge={renderBadge}
                  />
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

export default AgentTimeline;