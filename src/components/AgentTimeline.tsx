"use client";

import React, { useState, useMemo, useEffect, useRef } from "react";
import {
  FileSearch,
  FileCode,
  FilePlus,
  Terminal,
  Search,
  Globe,
  Eye,
  Bot,
  Wrench,
  CheckCircle,
  HelpCircle,
  type LucideIcon,
} from "lucide-react";
import { ToolTimeline, type TimelineStep, type TimelineStat } from "@/components/elements/tool-timeline";
import { WebSearch, type WebSearchResult } from "@/components/elements/web-search";
import { FileTree, type FileTreeNode } from "@/components/elements/file-tree";
import { ReasoningPanel, type ReasoningStep } from "@/components/elements/reasoning-panel";
import type { SubAgentProgressEvent } from "./types";
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

// ── Helpers to derive step verbs, chips, and icons ────────────────────────────

function formatHumanAction(raw: string, prevAction?: string): { verb: string; chip: string } {
  if (!raw) return { verb: "Execute", chip: "task" };
  let text = raw.trim();

  // Strip prefixes like "[Navis]", "[Browser]", "Step N:", "Action:"
  text = text.replace(/^\[(?:Navis|Browser|Fern|Agent|System|Step \d+)\]\s*/i, "");
  text = text.replace(/^Step\s*\d+[:.-]?\s*/i, "");
  text = text.replace(/^Action\s*[:.-]?\s*/i, "");

  // If text starts with Click / Clicked / Clicking
  const clickMatch = text.match(/^(?:Click(?:ed|ing)?|Press(?:ed|ing)?\s+on)\s+(.*)/i);
  if (clickMatch) {
    const target = clickMatch[1].replace(/["']/g, "").trim();
    return { verb: "Click", chip: target ? `"${target}" on screen` : "target UI element" };
  }

  // If text starts with Navigate / Navigating / Go to / Opening / Open
  const navMatch = text.match(/^(?:Navigat(?:e|ed|ing)\s+(?:to\s+)?|Go(?:ing)?\s+to\s+|Open(?:ed|ing)?\s+)(.*)/i);
  if (navMatch) {
    const dest = navMatch[1].trim();
    return { verb: "Navigate", chip: dest.startsWith("to ") || dest.startsWith("http") ? dest : `to ${dest}` };
  }

  // If text starts with Type / Typing / Typed / Enter / Entering
  const typeActionMatch = text.match(/^(?:Typ(?:e|ed|ing)|Enter(?:ed|ing)?)\s+(?:into\s+)?(.*)/i);
  if (typeActionMatch) {
    const clean = typeActionMatch[1].replace(/\\n/g, "").trim();
    return { verb: "Type", chip: clean.startsWith('"') ? clean : `"${clean}"` };
  }

  // If text starts with Connect / Connecting / Connected
  const connectMatch = text.match(/^(?:Connect(?:ed|ing)?\s+)(.*)/i);
  if (connectMatch) {
    return { verb: "Connect", chip: connectMatch[1] };
  }

  // If text starts with Search / Searching / Searched
  const searchMatch = text.match(/^(?:Search(?:ed|ing)?\s+(?:for\s+)?)(.*)/i);
  if (searchMatch) {
    return { verb: "Search", chip: `for "${searchMatch[1]}"` };
  }

  // If text starts with Select / Selecting / Selected
  const selectMatch = text.match(/^(?:Select(?:ed|ing)?\s+)(.*)/i);
  if (selectMatch) {
    return { verb: "Select", chip: selectMatch[1] };
  }

  // If text starts with Scroll / Scrolling / Scrolled
  const scrollActionMatch = text.match(/^(?:Scroll(?:ed|ing)?\s+(?:down|up)?\s*)(.*)/i);
  if (scrollActionMatch) {
    return { verb: "Scroll", chip: scrollActionMatch[1] || "view to reveal content" };
  }

  // hotkey(key='win') or key: win
  const hotkeyMatch =
    text.match(/hotkey\s*\(\s*key\s*=\s*['"]([^'"]*)['"]\s*\)/i) ||
    text.match(/key\s*[:=]\s*['"]?([a-zA-Z0-9+_ -]+)['"]?/i);
  if (hotkeyMatch) {
    const key = hotkeyMatch[1].toLowerCase().trim();
    if (key === "win" || key === "super" || key === "windows") {
      return { verb: "Open", chip: "Windows Start menu" };
    }
    if (key.includes("ctrl") && key.includes("c")) return { verb: "Copy", chip: "selected text (Ctrl+C)" };
    if (key.includes("ctrl") && key.includes("v")) return { verb: "Paste", chip: "clipboard content (Ctrl+V)" };
    if (key.includes("ctrl") && key.includes("a")) return { verb: "Select", chip: "all content (Ctrl+A)" };
    if (key === "enter") return { verb: "Submit", chip: "input with Enter key" };
    if (key === "esc" || key === "escape") return { verb: "Dismiss", chip: "active dialog (Escape)" };
    if (key === "tab") return { verb: "Focus", chip: "next input field (Tab)" };
    return { verb: "Trigger", chip: `${key.toUpperCase()} keyboard shortcut` };
  }

  // click(start_box=...) or left_click
  if (text.includes("click") || text.includes("left_single") || text.includes("left_click")) {
    return { verb: "Click", chip: "target element on screen" };
  }

  // double click
  if (text.includes("left_double") || text.includes("double_click")) {
    return { verb: "Double-click", chip: "target element to open" };
  }

  // right click
  if (text.includes("right_single") || text.includes("right_click")) {
    return { verb: "Right-click", chip: "to open context menu" };
  }

  // type(content='...') or type_text_at
  const typeMatch =
    text.match(/type\s*\(\s*content\s*=\s*['"]([^'"]*)['"]\s*\)/i) ||
    text.match(/type_text_at.*text\s*[:=]\s*['"]([^'"]*)['"]/i);
  if (typeMatch) {
    const clean = typeMatch[1].replace(/\\n/g, "").trim();
    return { verb: "Type", chip: clean ? `"${clean}"` : "text into input" };
  }

  // scroll
  const scrollMatch =
    text.match(/direction\s*=\s*['"]([^'"]*)['"]/i) ||
    text.match(/scroll.*(up|down)/i);
  if (scrollMatch) {
    return { verb: "Scroll", chip: `${scrollMatch[1] || "down"} to reveal content` };
  }

  // screenshot / vision
  if (
    text.toLowerCase().includes("screenshot") ||
    text.toLowerCase().includes("screen") ||
    text.toLowerCase().includes("vision")
  ) {
    if (prevAction) {
      return { verb: "Verify", chip: `screen updates after ${prevAction}` };
    }
    return { verb: "Inspect", chip: "desktop layout & active windows" };
  }

  // wait
  if (text.toLowerCase().includes("wait")) {
    return { verb: "Wait", chip: "for UI animations to complete" };
  }

  // finished / complete
  if (text.toLowerCase().includes("finish") || text.toLowerCase().includes("complete")) {
    return { verb: "Complete", chip: "desktop workflow" };
  }

  // Natural sentence split: handle "Press" / "Pressing" prefixes gracefully
  const parts = text.split(/\s+/);
  if (parts.length > 1) {
    let firstWord = parts[0].replace(/[^a-zA-Z]/g, "");
    if (firstWord.toLowerCase() === "press" || firstWord.toLowerCase() === "pressing") {
      if (parts.some((p) => /win|start|super/i.test(p))) {
        return { verb: "Open", chip: "Windows Start menu" };
      }
      const rest = parts.slice(1).join(" ");
      return { verb: "Trigger", chip: rest };
    }
    const verb = firstWord.charAt(0).toUpperCase() + firstWord.slice(1).toLowerCase();
    const chip = parts.slice(1).join(" ");
    return { verb: verb || "Execute", chip };
  }

  return { verb: "Execute", chip: text };
}

function extractVerbAndChip(tc: ToolCallDisplay): { verb: string; chip: string; icon: LucideIcon } {
  const args = tc.args || {};
  const explicitNarrative = String(args._narrative || (tc as any).narrative || args.narrative || "").trim();

  // If explicit narrative is provided by AI, format it directly as a full natural sentence
  if (explicitNarrative) {
    const parts = explicitNarrative.split(" ");
    const firstWord = parts[0];
    const verb = firstWord.charAt(0).toUpperCase() + firstWord.slice(1);
    const chip = parts.slice(1).join(" ");
    const name = (tc.toolName || tc.displayName || "").toLowerCase();
    let icon: LucideIcon = Wrench;
    if (name.includes("read") || name.includes("view")) icon = FileSearch;
    else if (name.includes("write") || name.includes("create")) icon = FilePlus;
    else if (name.includes("replace") || name.includes("edit") || name.includes("patch")) icon = FileCode;
    else if (name.includes("command") || name.includes("bash") || name.includes("terminal") || name.includes("exec")) icon = Terminal;
    else if (name.includes("grep") || name.includes("find") || name.includes("list_dir")) icon = Search;
    else if (name.includes("web") || name.includes("url") || name.includes("browse") || name.includes("fetch")) icon = Globe;
    else if (name.includes("screenshot") || name.includes("image") || name.includes("vision")) icon = Eye;
    else if (name.includes("ask") || name.includes("question")) icon = HelpCircle;
    else if (name.includes("fern") || name.includes("navis") || name.includes("computer")) icon = Bot;

    return { verb, chip, icon };
  }

  const name = (tc.toolName || tc.displayName || "").toLowerCase();

  // Read / View
  if (name.includes("read") || name.includes("view")) {
    const rawPath = String(args.TargetFile || args.AbsolutePath || args.path || args.file || "");
    const chip = rawPath.split(/[/\\]/).pop() || rawPath || "file";
    return { verb: "Read", chip, icon: FileSearch };
  }

  // Create / Write
  if (name.includes("write") || name.includes("create")) {
    const rawPath = String(args.TargetFile || args.AbsolutePath || args.path || args.file || "");
    const chip = rawPath.split(/[/\\]/).pop() || rawPath || "file";
    return { verb: "Create", chip, icon: FilePlus };
  }

  // Edit / Replace / Patch
  if (name.includes("replace") || name.includes("edit") || name.includes("patch") || name.includes("modify")) {
    const rawPath = String(args.TargetFile || args.AbsolutePath || args.path || args.file || "");
    const chip = rawPath.split(/[/\\]/).pop() || rawPath || "file";
    return { verb: "Edit", chip, icon: FileCode };
  }

  // Command / Terminal
  if (name.includes("command") || name.includes("bash") || name.includes("terminal") || name.includes("exec") || name.includes("shell")) {
    const cmd = String(args.CommandLine || args.command || "").trim();
    if (cmd) {
      if (/^git\s+status/i.test(cmd)) return { verb: "Check", chip: "git working tree status", icon: Terminal };
      if (/^git\s+diff/i.test(cmd)) return { verb: "Review", chip: "uncommitted git changes", icon: Terminal };
      if (/^git\s+commit/i.test(cmd)) return { verb: "Commit", chip: "staged changes to repository", icon: Terminal };
      if (/^git\s+add/i.test(cmd)) return { verb: "Stage", chip: "modified files for commit", icon: Terminal };
      if (/^git\s+push/i.test(cmd)) return { verb: "Push", chip: "branch to remote repository", icon: Terminal };
      if (/^npm\s+test|^npx\s+vitest|^pytest/i.test(cmd)) return { verb: "Run", chip: "test suite to verify functionality", icon: Terminal };
      if (/^npx\s+tsc/i.test(cmd)) return { verb: "Type-check", chip: "TypeScript codebase", icon: Terminal };
      if (/^npm\s+run\s+build/i.test(cmd)) return { verb: "Build", chip: "project bundle", icon: Terminal };
      if (/^npm\s+i(?:nstall)?/i.test(cmd)) return { verb: "Install", chip: "project dependencies", icon: Terminal };
      const chip = cmd.length > 38 ? `${cmd.slice(0, 36)}…` : cmd;
      return { verb: "Run", chip: `\`${chip}\``, icon: Terminal };
    }
    return { verb: "Run", chip: "terminal command", icon: Terminal };
  }

  // Search / Grep
  if (name.includes("grep") || name.includes("find") || name.includes("list_dir") || name.includes("system_files")) {
    const query = String(args.Query || args.query || args.pattern || args.DirectoryPath || "");
    const chip = query ? (query.length > 28 ? `"${query.slice(0, 26)}…"` : `"${query}"`) : "files";
    return { verb: "Search", chip, icon: Search };
  }

  // Web Search / URL fetch
  if (name.includes("web") || name.includes("url") || name.includes("browse") || name.includes("fetch")) {
    const rawUrl = String(args.url || args.query || args.Url || "");
    let chip = rawUrl;
    try {
      if (rawUrl.startsWith("http")) chip = new URL(rawUrl).hostname;
    } catch {}
    return { verb: "Fetch", chip: chip || "web", icon: Globe };
  }

  // Image / Vision
  if (name.includes("screenshot") || name.includes("image") || name.includes("vision")) {
    const chip = String(args.ImageName || args.imagePath || "screenshot").split(/[/\\]/).pop() || "screenshot";
    return { verb: "Inspect", chip: "screen capture", icon: Eye };
  }

  // Ask / Question
  if (name.includes("ask") || name.includes("question") || name.includes("confirm")) {
    const questionText = String(args.question || tc.label || args.title || "Clarification Needed");
    return { verb: "Ask", chip: questionText, icon: HelpCircle };
  }

  // Subagent / Autonomous actions / Computer use
  if (name.includes("fern") || name.includes("navis") || name.includes("computer")) {
    const rawAction = String(args.task || args.action || args.taskName || tc.label || args.instruction || "");
    if (name.includes("computer") && args.task) {
      return { verb: "Desktop", chip: String(args.task), icon: Bot };
    }
    const { verb, chip } = formatHumanAction(rawAction);
    return { verb, chip: chip || (name.includes("computer") ? "automation" : "task"), icon: Bot };
  }

  // Generic fallback
  const rawVerb = tc.displayName || (tc.toolName ? tc.toolName.replace(/_/g, " ") : "Execute");
  const verb = rawVerb.charAt(0).toUpperCase() + rawVerb.slice(1);
  const chip = String(tc.label || args.name || tc.displayName || "task");
  return { verb, chip, icon: Wrench };
}

function extractFileStats(toolCalls: ToolCallDisplay[]): TimelineStat[] {
  const statsMap = new Map<string, { added: number; removed: number }>();

  for (const tc of toolCalls) {
    const args = tc.args || {};
    const rawPath = String(args.TargetFile || args.AbsolutePath || args.path || "");
    const fileName = rawPath.split(/[/\\]/).pop();

    if (!fileName) continue;

    let added = 0;
    let removed = 0;

    if (Array.isArray(args.ReplacementChunks)) {
      for (const chunk of args.ReplacementChunks) {
        if (chunk?.ReplacementContent) {
          added += String(chunk.ReplacementContent).split("\n").length;
        }
        if (chunk?.TargetContent) {
          removed += String(chunk.TargetContent).split("\n").length;
        }
      }
    } else if (args.ReplacementContent || args.TargetContent) {
      if (args.ReplacementContent) {
        added += String(args.ReplacementContent).split("\n").length;
      }
      if (args.TargetContent) {
        removed += String(args.TargetContent).split("\n").length;
      }
    } else if (args.CodeContent) {
      added += String(args.CodeContent).split("\n").length;
    }

    if (added > 0 || removed > 0) {
      const existing = statsMap.get(fileName) || { added: 0, removed: 0 };
      existing.added += added;
      existing.removed += removed;
      statsMap.set(fileName, existing);
    }
  }

  return Array.from(statsMap.entries()).map(([file, { added, removed }]) => ({
    file,
    added: added > 0 ? added : undefined,
    removed: removed > 0 ? removed : undefined,
  }));
}

// Build FileTree hierarchy when 2 or more files are changed
function buildFileTreeNodes(toolCalls: ToolCallDisplay[]): {
  nodes: FileTreeNode[];
  totalAdditions: number;
  totalDeletions: number;
  fileCount: number;
} {
  const fileMap = new Map<string, { additions: number; deletions: number }>();

  for (const tc of toolCalls) {
    const name = (tc.toolName || "").toLowerCase();
    const args = tc.args || {};
    const rawPath = String(args.TargetFile || args.AbsolutePath || args.path || args.file || "");
    if (!rawPath) continue;

    // Only count file creation/modification tools
    const isFileMod =
      name.includes("write") ||
      name.includes("create") ||
      name.includes("replace") ||
      name.includes("edit") ||
      name.includes("patch") ||
      name.includes("modify");
    if (!isFileMod) continue;

    const normalizedPath = rawPath.replace(/\\/g, "/");
    let adds = 0;
    let dels = 0;

    if (Array.isArray(args.ReplacementChunks)) {
      for (const chunk of args.ReplacementChunks) {
        if (chunk?.ReplacementContent) adds += String(chunk.ReplacementContent).split("\n").length;
        if (chunk?.TargetContent) dels += String(chunk.TargetContent).split("\n").length;
      }
    } else if (args.ReplacementContent || args.TargetContent) {
      if (args.ReplacementContent) adds += String(args.ReplacementContent).split("\n").length;
      if (args.TargetContent) dels += String(args.TargetContent).split("\n").length;
    } else if (args.CodeContent) {
      adds += String(args.CodeContent).split("\n").length;
    }

    const existing = fileMap.get(normalizedPath) || { additions: 0, deletions: 0 };
    existing.additions += adds;
    existing.deletions += dels;
    fileMap.set(normalizedPath, existing);
  }

  const fileCount = fileMap.size;
  if (fileCount < 2) {
    return { nodes: [], totalAdditions: 0, totalDeletions: 0, fileCount };
  }

  let totalAdditions = 0;
  let totalDeletions = 0;

  const relativeFiles: Array<{ parts: string[]; fullPath: string; additions: number; deletions: number }> = [];
  for (const [fullPath, { additions, deletions }] of fileMap.entries()) {
    totalAdditions += additions;
    totalDeletions += deletions;
    const parts = fullPath.split("/").filter(Boolean);
    const displayParts = parts.length > 3 ? parts.slice(-3) : parts;
    relativeFiles.push({ parts: displayParts, fullPath, additions, deletions });
  }

  const nodes: FileTreeNode[] = [];
  const seenFolders = new Set<string>();

  relativeFiles.sort((a, b) => a.parts.join("/").localeCompare(b.parts.join("/")));

  for (const item of relativeFiles) {
    let currentPath = "";
    for (let d = 0; d < item.parts.length - 1; d++) {
      const folderName = item.parts[d];
      currentPath = currentPath ? `${currentPath}/${folderName}` : folderName;
      if (!seenFolders.has(currentPath)) {
        seenFolders.add(currentPath);
        nodes.push({
          path: currentPath,
          name: folderName,
          depth: d,
          kind: "folder",
        });
      }
    }

    const fileName = item.parts[item.parts.length - 1];
    nodes.push({
      path: item.fullPath,
      name: fileName,
      depth: item.parts.length - 1,
      kind: "file",
      additions: item.additions || undefined,
      deletions: item.deletions || undefined,
    });
  }

  return { nodes, totalAdditions, totalDeletions, fileCount };
}

// Extract web searches
function extractWebSearches(toolCalls: ToolCallDisplay[]): Array<{
  query: string;
  results: WebSearchResult[];
  searching: boolean;
}> {
  const list: Array<{ query: string; results: WebSearchResult[]; searching: boolean }> = [];

  for (const tc of toolCalls) {
    const name = (tc.toolName || "").toLowerCase();
    if (name.includes("web_search") || name.includes("search_web") || name.includes("remote_web_search")) {
      const args = tc.args || {};
      const query = String(args.query || args.Query || tc.label || "Web search");
      const searching = tc.status === "running";
      const results: WebSearchResult[] = [];

      const data = tc.data || tc.args || {};
      const rawResults = data.results || (typeof tc.output === "string" ? tryParseJson(tc.output) : null);
      if (Array.isArray(rawResults)) {
        for (const item of rawResults) {
          if (item?.title || item?.url || item?.domain) {
            let domain = item.domain || "";
            if (!domain && item.url) {
              try {
                domain = new URL(item.url).hostname;
              } catch {}
            }
            results.push({
              title: item.title || domain || "Search Result",
              domain: domain || "web",
              url: item.url,
              snippet: item.snippet,
            });
          }
        }
      }

      if (results.length === 0 && !searching) {
        results.push({
          title: query,
          domain: "web search",
        });
      }

      list.push({ query, results, searching });
    }
  }

  return list;
}

function parseReasoningSteps(thoughtText: string): ReasoningStep[] {
  if (!thoughtText || !thoughtText.trim()) return [];

  const clean = cleanThought(thoughtText);
  if (!clean) return [];

  // Split by numbered steps, bullet points, headers, or double newlines
  const sections = clean
    .split(/(?=(?:^|\n)(?:#+|\d+\.|\*|-|[A-Z][a-zA-Z\s]+:))\n?/g)
    .filter((s) => s.trim().length > 0);

  if (sections.length > 1) {
    return sections.map((sec) => {
      const lines = sec.trim().split("\n");
      const firstLine = lines[0].replace(/^[#*\-\d.:\s]+/, "").trim();
      const title = firstLine.length > 40 ? `${firstLine.slice(0, 38)}…` : firstLine || "Scope";
      const body = lines.slice(1).join("\n").trim() || firstLine;
      return { title, body };
    });
  }

  // Fallback to splitting by paragraphs
  const paras = clean.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
  if (paras.length > 1) {
    return paras.map((p, idx) => {
      const lines = p.trim().split("\n");
      const title = lines[0].slice(0, 35).trim() || `Step ${idx + 1}`;
      return { title, body: p.trim() };
    });
  }

  return [{ title: "Scope", body: clean }];
}

function tryParseJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function cleanThought(text: string): string {
  return text
    .replace(/<\/?think>/gi, "")
    .replace(/^\s*(?:🌐|🔍|📝|✅|🔬|⚠️|🖥️|💻|📊|📋)\s*(?:WEB EXPLORER|Deep Research|OS Interaction|Coding Specialist|Data Analyst|Data Analysis)[^\n]*/gim, "")
    .replace(/^\[(?:BRAIN|TRIAGE|PLANNER|DECOMPOSER|Cognitive Router|CognitiveRouter|Graph|IPC|Network|System|Web Explorer)\][^\n]*/gim, "")
    .replace(/^(?:WEB EXPLORER|DEEP RESEARCH|DATA ANALYST|CODING SPECIALIST)\s*(?:\[Phase[^\]]*\])?:?[^\n]*/gim, "")
    .trim();
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
}: AgentTimelineProps) => {
  const [open, setOpen] = useState(true);
  const [reasoningOpen, setReasoningOpen] = useState(true);
  const [elapsedSeconds, setElapsedSeconds] = useState(1);
  const startTimeRef = useRef<number>(Date.now());

  // Timer for live streaming indicator
  useEffect(() => {
    if (!isLive) return;
    startTimeRef.current = Date.now();
    const interval = setInterval(() => {
      const sec = Math.max(1, Math.round((Date.now() - startTimeRef.current) / 1000));
      setElapsedSeconds(sec);
    }, 1000);
    return () => clearInterval(interval);
  }, [isLive]);

  // Build steps list (preserving all sequential tool actions and subagent progress)
  const steps = useMemo((): TimelineStep[] => {
    const list: TimelineStep[] = [];

    for (const tc of toolCalls) {
      const events = tc.subAgentProgress || subAgentProgress?.get(tc.id) || [];
      const parentStep = extractVerbAndChip(tc);

      // Distinguish subagents/desktop automation
      const name = (tc.toolName || tc.displayName || "").toLowerCase();
      const isSubagent = name.includes("computer") || name.includes("navis") || name.includes("fern") || name.includes("spawn");

      // Always include the parent tool/subagent execution step in the timeline
      const lastMainStep = list[list.length - 1];
      if (!lastMainStep || lastMainStep.verb !== parentStep.verb || lastMainStep.chip !== parentStep.chip) {
        list.push({
          verb: parentStep.verb,
          chip: parentStep.chip || "task",
          icon: parentStep.icon,
        });
      }

      if (events.length > 0) {
        let lastActionText = "";
        for (let i = 0; i < events.length; i++) {
          const ev = events[i];
          if (ev.type === "reasoning" && !ev.content) continue;

          let rawContent = ev.content || (ev.action ? (ev.action.description || ev.action.type || "action") : "");
          let icon: LucideIcon = Bot;
          let { verb, chip } = formatHumanAction(rawContent, lastActionText);

          if (ev.type === "screenshot") {
            icon = Eye;
            if (rawContent && rawContent !== "screenshot" && !rawContent.includes("data:image") && rawContent !== "workspace") {
              verb = "Inspect";
              chip = rawContent;
            } else if (lastActionText) {
              verb = "Verify";
              chip = `screen updates after ${lastActionText}`;
            } else {
              verb = "Inspect";
              chip = "desktop layout & active windows";
            }
          } else if (ev.type === "complete") {
            verb = "Complete";
            chip = rawContent && rawContent !== "complete" ? rawContent : "workflow finished";
            icon = CheckCircle;
          } else if (ev.type === "step") {
            if (!chip || chip === "step" || chip === "workspace") {
              verb = `Step ${ev.stepNumber || i + 1}`;
              chip = rawContent || "action";
            }
            icon = Wrench;
          }

          if (ev.type === "action" || ev.action) {
            lastActionText = `${verb.toLowerCase()} ${chip}`;
          }

          // Collapse only identical consecutive duplicates to preserve full multi-step history
          const lastStep = list[list.length - 1];
          if (!lastStep || lastStep.verb !== verb || lastStep.chip !== chip) {
            list.push({
              verb,
              chip: chip || "action",
              icon,
            });
          }
        }
      }
    }

    return list;
  }, [toolCalls, subAgentProgress]);

  // Extract file diff stats
  const stats = useMemo(() => extractFileStats(toolCalls), [toolCalls]);

  // Extract file tree for 2 or more files changed
  const fileTreeData = useMemo(() => buildFileTreeNodes(toolCalls), [toolCalls]);

  // Extract web searches
  const webSearches = useMemo(() => extractWebSearches(toolCalls), [toolCalls]);

  // Extract reasoning steps
  const rawThought = thought || reasoningContent || "";
  const reasoningSteps = useMemo(() => parseReasoningSteps(rawThought), [rawThought]);

  // Duration / labels calculation
  const totalDurationSeconds = useMemo(() => {
    let totalMs = 0;
    for (const tc of toolCalls) {
      if (tc.durationMs) totalMs += tc.durationMs;
    }
    return Math.max(1, Math.round(totalMs / 1000));
  }, [toolCalls]);

  const activeLabel = useMemo(() => {
    return `Working for ${elapsedSeconds}s`;
  }, [elapsedSeconds]);

  const restingLabel = useMemo(() => {
    if (totalDurationSeconds > 1) {
      return `Worked for ${totalDurationSeconds}s`;
    }
    if (steps.length > 0) {
      return `Worked on ${steps.length} ${steps.length === 1 ? "step" : "steps"}`;
    }
    return "Worked";
  }, [totalDurationSeconds, steps.length]);

  // Group tool calls into discrete batches only if explicit distinct taskNames exist
  const batches = useMemo(() => {
    if (!toolCalls || toolCalls.length === 0) return [];

    const taskGroups = new Map<string, ToolCallDisplay[]>();
    for (const tc of toolCalls) {
      const taskName = tc.args?.taskName || (tc as any).taskName || "";
      if (taskName && taskName !== "Default") {
        const existing = taskGroups.get(taskName) || [];
        existing.push(tc);
        taskGroups.set(taskName, existing);
      }
    }

    // If there are no distinct explicit task names (or only 1), keep as single unified timeline
    if (taskGroups.size <= 1) {
      return [{
        id: "main-batch",
        taskName: undefined as string | undefined,
        narrative: undefined as string | undefined,
        steps,
        stats,
        durationSeconds: totalDurationSeconds,
        isLive: Boolean(isLive),
      }];
    }

    // Multiple distinct named tasks: create one batch per unique taskName
    const result: {
      id: string;
      taskName?: string;
      narrative?: string;
      steps: TimelineStep[];
      stats: TimelineStat[];
      durationSeconds: number;
      isLive: boolean;
    }[] = [];

    for (const [taskName, groupCalls] of taskGroups.entries()) {
      const groupSteps: TimelineStep[] = [];
      let taskNarrative = "";

      for (const tc of groupCalls) {
        if (!taskNarrative && (tc.args?._narrative || (tc as any).narrative || tc.args?.narrative)) {
          taskNarrative = String(tc.args?._narrative || (tc as any).narrative || tc.args?.narrative);
        }

        const events = tc.subAgentProgress || subAgentProgress?.get(tc.id) || [];
        if (events.length > 0) {
          let lastActionText = "";
          for (let i = 0; i < events.length; i++) {
            const ev = events[i];
            if (ev.type === "reasoning" && !ev.content) continue;
            let rawContent = ev.content || (ev.action ? (ev.action.description || ev.action.type || "workspace action") : "");
            let icon: LucideIcon = Bot;
            let { verb, chip } = formatHumanAction(rawContent, lastActionText);
            if (ev.type === "screenshot") {
              icon = Eye;
              if (rawContent && rawContent !== "screenshot" && !rawContent.includes("data:image")) {
                verb = "Inspect";
                chip = rawContent;
              } else if (lastActionText) {
                verb = "Verify";
                chip = `screen updates after ${lastActionText}`;
              } else {
                verb = "Inspect";
                chip = "desktop layout & active windows";
              }
            } else if (ev.type === "complete") {
              verb = "Complete";
              chip = rawContent && rawContent !== "complete" ? rawContent : "workflow finished";
              icon = CheckCircle;
            } else if (ev.type === "step") {
              if (!chip || chip === "step" || chip === "workspace") {
                verb = `Step ${ev.stepNumber || i + 1}`;
                chip = rawContent || "step";
              }
              icon = Wrench;
            }
            if (ev.type === "action" || ev.action) {
              lastActionText = `${verb.toLowerCase()} ${chip}`;
            }
            const lastStep = groupSteps[groupSteps.length - 1];
            if (!lastStep || lastStep.verb !== verb || lastStep.chip !== chip) {
              groupSteps.push({ verb, chip: chip || "step", icon });
            }
          }
        } else {
          const { verb, chip, icon } = extractVerbAndChip(tc);
          const lastStep = groupSteps[groupSteps.length - 1];
          if (!lastStep || lastStep.verb !== verb || lastStep.chip !== chip) {
            groupSteps.push({ verb, chip: chip || "task", icon });
          }
        }
      }

      if (groupSteps.length > 0) {
        let groupDuration = 0;
        for (const tc of groupCalls) {
          if (tc.durationMs) groupDuration += tc.durationMs;
        }
        result.push({
          id: `task-${taskName}`,
          taskName: taskName !== "Default" ? taskName : undefined,
          narrative: taskNarrative || undefined,
          steps: groupSteps,
          stats: extractFileStats(groupCalls),
          durationSeconds: Math.max(1, Math.round(groupDuration / 1000)),
          isLive: Boolean(isLive && groupCalls.some((tc) => tc.status === "running")),
        });
      }
    }

    return result.length > 0 ? result : [{
      id: "main-batch",
      taskName: undefined,
      narrative: undefined,
      steps,
      stats,
      durationSeconds: totalDurationSeconds,
      isLive: Boolean(isLive),
    }];
  }, [toolCalls, steps, stats, totalDurationSeconds, isLive, subAgentProgress]);

  const [openBatches, setOpenBatches] = useState<Record<string, boolean>>({});

  const hasContent = steps.length > 0 || reasoningSteps.length > 0 || isLive || isDebating || debateData;

  if (!hasContent) return null;

  return (
    <div className="w-full flex flex-col" style={{ marginLeft: 0, paddingLeft: 0 }}>
      {/* ── Debate Progress (if active) ── */}
      {(isDebating || debateData) && (
        <div style={{ margin: "0 0 12px 0" }}>
          <InlineDebateProgress
            debate={debateData}
            isDebating={!!isDebating}
            debateId={debateId}
            onSkipDebate={onSkipDebate}
          />
        </div>
      )}

      {/* ── ReasoningPanel Component (when thinking or reasoning present) ── */}
      {reasoningSteps.length > 0 && (
        <div style={{ marginBottom: (batches.length > 0 || steps.length > 0) ? (reasoningOpen ? 22 : 12) : 0 }}>
          <ReasoningPanel
            steps={reasoningSteps}
            visibleSteps={reasoningSteps.length}
            streaming={Boolean(isLive && (toolCalls.length === 0 || toolCalls.every((tc) => tc.status === "done")))}
            open={reasoningOpen}
            onOpenChange={setReasoningOpen}
            restingLabel={`Reasoned for ${Math.max(1, totalDurationSeconds > 1 ? totalDurationSeconds : elapsedSeconds)}s`}
            elapsed={`${elapsedSeconds}s`}
          />
        </div>
      )}

      {/* ── ToolTimeline Batches (multiple timelines for sequential actions) ── */}
      {batches.length > 0 ? (
        batches.map((batch) => {
          const isOpen = openBatches[batch.id] ?? open;
          const bRestingLabel =
            batch.durationSeconds > 1
              ? `Worked for ${batch.durationSeconds}s`
              : `Worked on ${batch.steps.length} ${batch.steps.length === 1 ? "step" : "steps"}`;
          const bActiveLabel = `Working for ${elapsedSeconds}s`;

          return (
            <div key={batch.id} className="w-full" style={{ marginLeft: 0, paddingLeft: 0, marginTop: 6, marginBottom: isOpen ? 12 : 6 }}>
              {(batch.taskName || batch.narrative) && (
                <div className="flex items-center gap-2 mb-1.5 px-0.5 text-[12.5px] font-medium text-foreground/80 tracking-tight">
                  <span className="size-1.5 rounded-full bg-foreground/40 shrink-0" />
                  <span className="truncate">{batch.taskName || batch.narrative}</span>
                </div>
              )}
              <ToolTimeline
                steps={batch.steps}
                visibleSteps={batch.steps.length}
                streaming={batch.isLive}
                open={isOpen}
                onOpenChange={(nextOpen) => {
                  setOpenBatches((prev) => ({ ...prev, [batch.id]: nextOpen }));
                  setOpen(nextOpen);
                }}
                restingLabel={bRestingLabel}
                activeLabel={bActiveLabel}
                stats={batch.stats}
              />
            </div>
          );
        })
      ) : steps.length > 0 ? (
        <div className="w-full" style={{ marginLeft: 0, paddingLeft: 0, marginTop: 6, marginBottom: open ? 12 : 6 }}>
          <ToolTimeline
            steps={steps}
            visibleSteps={steps.length}
            streaming={Boolean(isLive)}
            open={open}
            onOpenChange={setOpen}
            restingLabel={
              totalDurationSeconds > 1
                ? `Worked for ${totalDurationSeconds}s`
                : `Worked on ${steps.length} ${steps.length === 1 ? "step" : "steps"}`
            }
            activeLabel={`Working for ${elapsedSeconds}s`}
            stats={stats}
          />
        </div>
      ) : null}

      {/* ── WebSearch Element (when web search tool was executed) ── */}
      {webSearches.map((ws, idx) => (
        <WebSearch
          key={`ws-${ws.query}-${idx}`}
          query={ws.query}
          results={ws.results}
          visibleResults={ws.results.length}
          searching={ws.searching}
          cycle={idx}
        />
      ))}

      {/* ── FileTree Element (when 2 or more files changed) ── */}
      {fileTreeData.fileCount >= 2 && fileTreeData.nodes.length > 0 && (
        <FileTree
          nodes={fileTreeData.nodes}
          visibleCount={fileTreeData.nodes.length}
          totalAdditions={fileTreeData.totalAdditions}
          totalDeletions={fileTreeData.totalDeletions}
          onFileClick={(node) => {
            if (node.path && onPillClick) {
              const matchedTc = toolCalls.find((tc) => {
                const p = String(tc.args?.TargetFile || tc.args?.AbsolutePath || tc.args?.path || "");
                return p.replace(/\\/g, "/") === node.path;
              });
              if (matchedTc) onPillClick(matchedTc);
            }
          }}
        />
      )}
    </div>
  );
});

export default AgentTimeline;