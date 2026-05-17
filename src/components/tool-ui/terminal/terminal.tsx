"use client";

import { useState, useCallback } from "react";
import Ansi from "ansi-to-react";
import {
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  Terminal as TerminalIcon,
} from "lucide-react";
import type { TerminalProps } from "./schema";
import { useCopyToClipboard } from "../shared/use-copy-to-clipboard";

import { Button, Collapsible, CollapsibleTrigger } from "./_adapter";
import { cn } from "./_adapter";

const COPY_ID = "terminal-output";

type TerminalControlledProps = {
  expanded?: boolean;
  defaultExpanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
};

type TerminalRootProps = TerminalProps & TerminalControlledProps;

type TerminalHeaderProps = Pick<
  TerminalProps,
  "command" | "cwd" | "exitCode"
> & {
  formattedDuration: string | null;
  timestamp: string | null;
  relativeTime: string;
  hasOutput: boolean;
  copiedId: string | null;
  onCopy: () => void;
};

type TerminalOutputProps = Pick<
  TerminalProps,
  "stdout" | "stderr" | "truncated"
> & {
  isCollapsed: boolean;
  shouldCollapse: boolean;
  lineCount: number;
  command?: string;
  onToggleCollapse: () => void;
};

function formatDuration(durationMs?: number): string | null {
  if (durationMs == null) return null;
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function formatTimestamp(date?: Date): string | null {
  if (date == null) return null;
  return date.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatRelativeTime(date?: Date): string {
  if (date == null) return "";
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function getExitCodeLabel(exitCode: number): { label: string; className: string } {
  if (exitCode === 0) return { label: "Success", className: "text-green-600 dark:text-green-400" };
  if (exitCode > 0) return { label: `Error ${exitCode}`, className: "text-red-600 dark:text-red-400" };
  // Negative = signal
  const signalNum = Math.abs(exitCode);
  const signals: Record<number, string> = { 1: "SIGHUP", 2: "SIGINT", 9: "SIGKILL", 15: "SIGTERM" };
  const name = signals[signalNum] || `Signal ${signalNum}`;
  return { label: name, className: "text-orange-600 dark:text-orange-400" };
}

function countOutputLines(output: string): number {
  const trimmedTrailingNewlines = output.replace(/\n+$/, "");
  if (!trimmedTrailingNewlines) return 0;
  return trimmedTrailingNewlines.split("\n").length;
}

function TerminalHeader({
  command,
  cwd,
  exitCode,
  formattedDuration,
  timestamp,
  relativeTime,
  hasOutput,
  copiedId,
  onCopy,
}: TerminalHeaderProps) {
  const exitCodeInfo = getExitCodeLabel(exitCode);

  return (
    <div className="bg-card flex items-center justify-between border-b px-4 py-2">
      <div className="flex items-center gap-3 overflow-hidden">
        <TerminalIcon className="text-muted-foreground h-4 w-4 shrink-0" />
        {timestamp && (
          <span className="text-muted-foreground font-mono text-xs tabular-nums" title={relativeTime}>
            {timestamp}
          </span>
        )}
        <code className="text-foreground truncate font-mono text-xs">
          {cwd && <span className="text-muted-foreground">{cwd}$ </span>}
          {command}
        </code>
      </div>
      <div className="flex items-center gap-3">
        {formattedDuration && (
          <span className="text-muted-foreground font-mono text-sm tabular-nums" title={`Duration: ${formattedDuration}`}>
            {formattedDuration}
          </span>
        )}
        <span
          className={cn(
            "font-mono text-xs px-1.5 py-0.5 rounded",
            exitCode === 0
              ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
              : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
          )}
          title={exitCodeInfo.label}
        >
          {exitCode === 0 ? "✓" : "✗"} {exitCode}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={onCopy}
          disabled={!hasOutput}
          className="h-7 w-7 p-0"
          aria-label={
            !hasOutput
              ? "No output to copy"
              : copiedId === COPY_ID
                ? "Copied"
                : "Copy output"
          }
        >
          {hasOutput && copiedId === COPY_ID ? (
            <Check className="h-4 w-4 text-green-700 dark:text-green-400" />
          ) : (
            <Copy className="text-muted-foreground h-4 w-4" />
          )}
        </Button>
      </div>
    </div>
  );
}

function TerminalOutput({
  stdout,
  stderr,
  truncated,
  isCollapsed,
  shouldCollapse,
  lineCount,
  command,
  onToggleCollapse,
}: TerminalOutputProps) {
  const stdoutLines = stdout ? stdout.split("\n") : [];
  const stderrLines = stderr ? stderr.split("\n") : [];
  const hasStderr = stderr && stderr.trim().length > 0;

  return (
    <Collapsible open={!isCollapsed}>
      <div
        className={cn(
          "relative font-mono text-sm",
          isCollapsed && "max-h-[200px] overflow-hidden",
        )}
      >
        <div className="overflow-x-auto p-4">
          {/* Command echo line */}
          {command && (
            <div className="mb-3 pb-2 border-b border-[#2d2d3a] text-[#6366f1] text-xs">
              <span className="text-[#64748b] mr-2">$</span>
              <span className="text-[#e2e8f0]">{command}</span>
            </div>
          )}

          {/* Stdout with line numbers */}
          {stdout && (
            <div className="flex gap-4">
              <div className="text-[#4a4a5a] text-xs select-none text-right leading-[1.7]">
                {stdoutLines.map((_, i) => (
                  <div key={i}>{i + 1}</div>
                ))}
              </div>
              <div className="text-foreground whitespace-pre flex-1">
                <Ansi>{stdout}</Ansi>
              </div>
            </div>
          )}

          {/* Stderr with prominent indicator */}
          {hasStderr && (
            <div className="mt-3">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                <span className="text-red-500 text-xs font-semibold uppercase tracking-wider">Stderr</span>
              </div>
              <div className="flex gap-4">
                <div className="text-[#4a4a5a] text-xs select-none text-right leading-[1.7]">
                  {stderrLines.map((_, i) => (
                    <div key={i}>{i + 1}</div>
                  ))}
                </div>
                <div className="text-red-400 whitespace-pre flex-1 border-l-2 border-red-500 pl-3">
                  <Ansi>{stderr}</Ansi>
                </div>
              </div>
            </div>
          )}

          {/* Truncation notice with char count */}
          {truncated && (
            <div className="text-muted-foreground mt-3 text-xs italic flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
              Output truncated... ({[stdout, stderr].filter(Boolean).reduce((a, s) => a + (s?.length || 0), 0)} chars hidden)
            </div>
          )}
        </div>

        {isCollapsed && (
          <div className="from-card absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t to-transparent" />
        )}
      </div>

      {shouldCollapse && (
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            onClick={onToggleCollapse}
            className="text-muted-foreground w-full rounded-none border-t font-normal"
          >
            {isCollapsed ? (
              <>
                <ChevronDown className="mr-1 size-4" />
                Show all {lineCount} lines
              </>
            ) : (
              <>
                <ChevronUp className="mr-1 size-4" />
                Collapse
              </>
            )}
          </Button>
        </CollapsibleTrigger>
      )}
    </Collapsible>
  );
}

function TerminalEmpty() {
  return (
    <div className="text-muted-foreground px-4 py-3 font-mono text-sm italic">
      No output
    </div>
  );
}

function TerminalRoot({
  id,
  command,
  stdout,
  stderr,
  exitCode,
  durationMs,
  cwd,
  truncated,
  maxCollapsedLines,
  className,
  expanded,
  defaultExpanded = false,
  onExpandedChange,
}: TerminalRootProps) {
  const [uncontrolledExpanded, setUncontrolledExpanded] =
    useState(defaultExpanded);
  const { copiedId, copy } = useCopyToClipboard();

  const isExpanded = expanded ?? uncontrolledExpanded;
  const hasOutput = Boolean(stdout || stderr);
  const fullOutput = [stdout, stderr].filter(Boolean).join("\n");
  const formattedDuration = formatDuration(durationMs);
  const lineCount = countOutputLines(fullOutput);
  const shouldCollapse =
    maxCollapsedLines !== undefined && lineCount > maxCollapsedLines;
  const isCollapsed = shouldCollapse && !isExpanded;
  const timestamp = formatTimestamp(new Date());
  const relativeTime = formatRelativeTime(new Date());

  const setExpanded = useCallback(
    (nextExpanded: boolean) => {
      if (expanded === undefined) {
        setUncontrolledExpanded(nextExpanded);
      }
      onExpandedChange?.(nextExpanded);
    },
    [expanded, onExpandedChange],
  );

  const handleCopy = useCallback(() => {
    if (!hasOutput) return;
    copy(fullOutput, COPY_ID);
  }, [hasOutput, fullOutput, copy]);

  return (
    <div
      className={cn(
        "@container flex w-full min-w-80 flex-col gap-3",
        className,
      )}
      data-tool-ui-id={id}
      data-slot="terminal"
    >
      <div className="border-border bg-card overflow-hidden rounded-lg border shadow-xs">
        <TerminalHeader
          command={command}
          cwd={cwd}
          exitCode={exitCode}
          formattedDuration={formattedDuration}
          timestamp={timestamp}
          relativeTime={relativeTime}
          hasOutput={hasOutput}
          copiedId={copiedId}
          onCopy={handleCopy}
        />

        {hasOutput && (
          <TerminalOutput
            stdout={stdout}
            stderr={stderr}
            truncated={truncated}
            isCollapsed={isCollapsed}
            shouldCollapse={shouldCollapse}
            lineCount={lineCount}
            command={command}
            onToggleCollapse={() => setExpanded(!isExpanded)}
          />
        )}

        {!hasOutput && <TerminalEmpty />}
      </div>
    </div>
  );
}

type TerminalComponent = typeof TerminalRoot & {
  Header: typeof TerminalHeader;
  Output: typeof TerminalOutput;
  Empty: typeof TerminalEmpty;
};

export const Terminal = Object.assign(TerminalRoot, {
  Header: TerminalHeader,
  Output: TerminalOutput,
  Empty: TerminalEmpty,
}) as TerminalComponent;
