'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, Zap, CheckCircle, AlertCircle, Clock, ChevronDown, ChevronRight,
  FileText, Code, Bot, GitBranch, TestTube, Eye, Terminal, Globe, Brain,
  Copy, Check, Target, Sparkles, X, CheckCircle2, ExternalLink
} from 'lucide-react';
import type { SubAgentProgressEvent } from '../types';
import { DotmSquare4 } from '@/components/ui/dotm-square-4';

/* ============================================================
   TYPES & CONSTANTS
   ============================================================ */

export interface SubagentPhase {
  id: string;
  name: string;
  status: 'pending' | 'in-progress' | 'completed' | 'failed';
  agent: string;
  agentId?: string;
  description: string;
  startTime?: number;
  endTime?: number;
  output?: string;
  metrics?: Record<string, any>;
  depth?: number;
  toolCallId?: string;
  currentAction?: string;
}

export interface SubagentCoordination {
  phase: 'exploration' | 'planning' | 'implementation' | 'review' | 'testing' | 'complete';
  currentAgent: string;
  completedPhases: string[];
  sharedContext: {
    codebaseMap?: any;
    developmentPlan?: any;
    implementationResults?: any;
    reviewResults?: any;
    testResults?: any;
  };
}

const T = {
  bg: 'var(--color-bg-subtle)',
  surface: 'var(--color-bg-surface)',
  surfaceRaised: 'var(--color-bg-subtle)',
  border: 'var(--color-border)',
  text: 'var(--color-text-primary)',
  textSecondary: 'var(--color-text-secondary)',
  textMuted: 'var(--color-text-tertiary)',
  green: '#22c55e',
  greenFaint: 'rgba(34,197,94,0.08)',
  red: '#ef4444',
  redFaint: 'rgba(239,68,68,0.07)',
  yellow: '#eab308',
  yellowFaint: 'rgba(234,179,8,0.08)',
  blue: '#3b82f6',
  blueFaint: 'rgba(59,130,246,0.08)',
  r8: 8,
  r12: 12,
  sans: '"Geist", "DM Sans", ui-sans-serif, system-ui, sans-serif',
  mono: '"Geist Mono", ui-monospace, monospace',
};

/* ============================================================
   AGENTS METADATA
   ============================================================ */

const AGENTS_META: Record<string, { icon: React.ComponentType<{ size?: number; strokeWidth?: number }>, label: string, description: string, color: string }> = {
  'coding-specialist': {
    icon: Code,
    label: 'Coding Specialist',
    description: 'Analyzes & implements code',
    color: T.green,
  },
  'web-explorer': {
    icon: Search,
    label: 'Web Explorer',
    description: 'Browses and extracts web data',
    color: T.blue,
  },
  'data-analyst': {
    icon: FileText,
    label: 'Data Analyst',
    description: 'Processes data & metrics',
    color: '#8b5cf6',
  },
  generic: {
    icon: Bot,
    label: 'Sub-agent',
    description: 'Handles delegated work',
    color: '#64748b',
  },
  exploration_agent: {
    icon: Eye,
    label: 'Exploration Agent',
    description: 'Scans codebase architecture',
    color: T.blue,
  },
  planning_agent: {
    icon: FileText,
    label: 'Planning Agent',
    description: 'Develops strategy & breakdown',
    color: T.blue,
  },
  worker_agent: {
    icon: Code,
    label: 'Implementation Worker',
    description: 'Executes changes',
    color: T.green,
  },
  code_reviewer_agent: {
    icon: CheckCircle,
    label: 'Code Reviewer',
    description: 'Quality & safety checks',
    color: '#f59e0b',
  },
  test_runner_agent: {
    icon: TestTube,
    label: 'Testing Agent',
    description: 'Runs and verifies test suites',
    color: '#8b5cf6',
  },
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const min = Math.floor(sec / 60);
  const remSec = Math.floor(sec % 60);
  return `${min}m ${remSec}s`;
}

export function getPhaseEvents(phase: SubagentPhase, progressMap?: Map<string, SubAgentProgressEvent[]>): SubAgentProgressEvent[] {
  if (!progressMap || progressMap.size === 0) return [];
  if (phase.toolCallId && progressMap.has(phase.toolCallId)) {
    return progressMap.get(phase.toolCallId)!;
  }
  if (phase.agentId && progressMap.has(phase.agentId)) {
    return progressMap.get(phase.agentId)!;
  }
  if (phase.id && progressMap.has(phase.id)) {
    return progressMap.get(phase.id)!;
  }
  // Fallback: search values by metadata
  for (const evts of progressMap.values()) {
    if (evts.some(e => {
      const m = (e as any)?.metadata;
      return m?.agentId === phase.agentId || m?.agentId === phase.id;
    })) {
      return evts;
    }
  }
  return [];
}

/* ============================================================
   STATUS BADGES
   ============================================================ */

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { bg: string; color: string; text: string; icon: React.ComponentType<{ size?: number; className?: string }> }> = {
    pending: { bg: T.surfaceRaised, color: T.textMuted, text: 'Pending', icon: Clock },
    'in-progress': { bg: T.blueFaint, color: T.blue, text: 'Running', icon: Zap },
    completed: { bg: T.greenFaint, color: T.green, text: 'Completed', icon: CheckCircle },
    failed: { bg: T.redFaint, color: T.red, text: 'Failed', icon: AlertCircle },
  };

  const c = config[status] || config.pending;
  const Icon = c.icon;

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '3px 8px',
        borderRadius: 999,
        background: c.bg,
        color: c.color,
        fontSize: 11,
        fontWeight: 650,
        fontFamily: T.sans,
        flexShrink: 0,
      }}
    >
      {status === 'in-progress' ? (
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: c.color,
            boxShadow: `0 0 8px ${c.color}`,
            animation: 'subagentPulse 1.5s infinite'
          }}
        />
      ) : (
        <Icon size={12} />
      )}
      <span>{c.text}</span>
    </div>
  );
}

/* ============================================================
   TOOL / ACTION HELPERS
   ============================================================ */

function getActionIcon(toolName: string) {
  const t = (toolName || '').toLowerCase();
  if (t.includes('read') || t.includes('view')) return <FileText size={13} color={T.blue} />;
  if (t.includes('write') || t.includes('edit') || t.includes('replace')) return <Code size={13} color={T.green} />;
  if (t.includes('grep') || t.includes('search') || t.includes('find') || t.includes('list')) return <Search size={13} color="#f59e0b" />;
  if (t.includes('terminal') || t.includes('pwsh') || t.includes('bash') || t.includes('command')) return <Terminal size={13} color="#8b5cf6" />;
  if (t.includes('web') || t.includes('fetch') || t.includes('browser') || t.includes('navis')) return <Globe size={13} color={T.blue} />;
  if (t.includes('python')) return <Code size={13} color="#3b82f6" />;
  return <Zap size={13} color={T.textSecondary} />;
}

/* ============================================================
   PHASE CARD
   ============================================================ */

function PhaseCard({
  phase,
  isActive,
  isCompleted,
  events = [],
  onOpenChat,
}: {
  phase: SubagentPhase;
  isActive: boolean;
  isCompleted: boolean;
  events?: SubAgentProgressEvent[];
  onOpenChat?: () => void;
}) {
  const [expanded, setExpanded] = useState<boolean>(true);
  const [showReasoning, setShowReasoning] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [liveElapsed, setLiveElapsed] = useState<number>(0);

  const meta = AGENTS_META[phase.agent] || AGENTS_META.generic;
  const Icon = meta.icon;
  const depth = phase.depth || 1;
  const indent = (depth - 1) * 12;

  // Live timer for running sub-agents
  useEffect(() => {
    if (phase.status === 'in-progress' && phase.startTime) {
      setLiveElapsed(Date.now() - phase.startTime);
      const interval = setInterval(() => {
        setLiveElapsed(Date.now() - phase.startTime!);
      }, 500);
      return () => clearInterval(interval);
    } else if (phase.endTime && phase.startTime) {
      setLiveElapsed(phase.endTime - phase.startTime);
    }
  }, [phase.status, phase.startTime, phase.endTime]);

  const durationStr = liveElapsed > 0 ? formatDuration(liveElapsed) : null;

  // Extract structured action steps from progress stream
  const actionEvents = events.filter(e =>
    e.type === 'action' ||
    e.type === 'step' ||
    Boolean(e.action) ||
    e.type === 'screenshot'
  );

  // Extract reasoning events
  const reasoningEvents = events.filter(e => e.type === 'reasoning' || (e as any).type === 'thought');
  const accumulatedReasoning = reasoningEvents.map(e => e.content || '').join('').trim();

  // Determine current active operation
  let currentActionDesc: string = '';
  if (phase.status === 'in-progress') {
    const runningEvent = [...actionEvents].reverse().find(e => (e as any).action?.status === 'running');
    if (runningEvent) {
      currentActionDesc = (runningEvent as any).action?.description || runningEvent.content || '';
    } else if (actionEvents.length > 0) {
      const last = actionEvents[actionEvents.length - 1];
      currentActionDesc = (last as any).action?.description || last.content || '';
    } else if (phase.currentAction) {
      currentActionDesc = phase.currentAction;
    } else if (accumulatedReasoning) {
      currentActionDesc = 'Reasoning & analyzing task requirements...';
    } else {
      currentActionDesc = 'Setting up sub-agent context and inspecting workspace...';
    }
  }

  // Extract unique files touched or read
  const filesTouched = Array.from(
    new Set(
      actionEvents
        .map(e => {
          const params = (e as any).action?.params || {};
          return params.path || params.filePath || params.targetFile || params.file || '';
        })
        .filter(p => typeof p === 'string' && p.length > 0 && !p.startsWith('http'))
        .map(p => p.split(/[\\/]/).pop() || p)
    )
  );

  const handleCopyOutput = () => {
    if (!phase.output) return;
    navigator.clipboard.writeText(phase.output);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{ display: 'flex', width: '100%', gap: 8, paddingLeft: indent, position: 'relative' }}>
      {depth > 1 && (
        <div
          style={{
            position: 'absolute',
            left: indent - 8,
            top: -10,
            bottom: '50%',
            width: 8,
            borderLeft: `1.5px solid ${T.border}`,
            borderBottom: `1.5px solid ${T.border}`,
            borderBottomLeftRadius: 6,
          }}
        />
      )}

      <motion.div
        style={{
          flex: 1,
          borderRadius: T.r12,
          border: `1px solid ${phase.status === 'in-progress' ? T.blue : T.border}`,
          background: T.surface,
          overflow: 'hidden',
          boxShadow: phase.status === 'in-progress' ? '0 4px 16px rgba(59,130,246,0.12)' : 'none',
          transition: 'border-color 0.2s, box-shadow 0.2s',
        }}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
      >
        {/* Header Bar */}
        <div
          role="button"
          tabIndex={0}
          aria-expanded={expanded}
          aria-label={(expanded ? 'Collapse ' : 'Expand ') + meta.label + ' details'}
          style={{
            padding: '12px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            cursor: 'pointer',
            borderBottom: expanded ? `1px solid ${T.border}` : 'none',
            background: phase.status === 'in-progress' ? 'rgba(59,130,246,0.02)' : 'transparent',
          }}
          onClick={() => setExpanded(!expanded)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setExpanded(!expanded);
            }
          }}
          onDoubleClick={(e) => {
            e.stopPropagation();
            onOpenChat?.();
          }}
          title="Click to expand · Double-click to open full sub-agent chat view"
        >
          {/* Agent Type Icon or DotMatrix Loader */}
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: T.r8,
              background: phase.status === 'in-progress' ? 'transparent' : `${meta.color}15`,
              border: phase.status === 'in-progress' ? 'none' : `1px solid ${meta.color}30`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: meta.color,
              flexShrink: 0,
              overflow: 'hidden',
            }}
          >
            {phase.status === 'in-progress' ? (
              <DotmSquare4 size={24} dotSize={3.2} speed={1.4} />
            ) : (
              <Icon size={16} strokeWidth={2.2} />
            )}
          </div>

          {/* Title & Agent Role */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: T.text, fontFamily: T.sans }}>
                {meta.label}
              </span>
              {phase.agentId && (
                <span style={{ fontSize: 10, color: T.textMuted, fontFamily: T.mono }}>
                  #{phase.agentId.slice(-6)}
                </span>
              )}
            </div>
            <div style={{ fontSize: 11, color: T.textMuted, fontFamily: T.sans, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {meta.description}
            </div>
          </div>

          {/* Duration Badge */}
          {durationStr && (
            <div style={{ fontSize: 10.5, color: T.textSecondary, fontWeight: 600, fontFamily: T.mono, padding: '2px 6px', borderRadius: 4, background: T.bg }}>
              {durationStr}
            </div>
          )}

          {/* Open Chat View Button */}
          {onOpenChat && (
            <button
              type="button"
              aria-label={"Open " + meta.label + " chat"}
              onKeyDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onOpenChat();
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '3px 7px',
                borderRadius: 5,
                background: 'var(--color-bg-subtle)',
                border: `1px solid ${T.border}`,
                color: T.textSecondary,
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
              }}
              title="Open full sub-agent chat view"
            >
              <ExternalLink size={12} />
              <span>Chat</span>
            </button>
          )}

          {/* Status Badge */}
          <StatusBadge status={phase.status} />

          {/* Expand / Collapse icon */}
          <ChevronDown
            size={16}
            style={{
              color: T.textMuted,
              transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 0.2s ease',
              flexShrink: 0,
            }}
          />
        </div>

        {/* Top Progress Accent Bar */}
        <div style={{ height: 2.5, background: T.surfaceRaised, overflow: 'hidden' }}>
          <motion.div
            style={{
              height: '100%',
              background: phase.status === 'failed' ? T.red : phase.status === 'completed' ? T.green : meta.color,
              borderRadius: '0 2px 0 0',
            }}
            initial={{ scaleX: 0 }}
            animate={{
              scaleX: phase.status === 'completed' || phase.status === 'failed' ? 1 : 0.45,
            }}
            transition={{ duration: 0.5 }}
          />
        </div>

        {/* Expanded Body Content */}
        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              style={{
                padding: '14px 16px',
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
                background: T.bg,
              }}
            >
              {/* Task Description / Objective */}
              {phase.description && (
                <div
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    background: T.surface,
                    border: `1px solid ${T.border}`,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: T.textMuted, fontFamily: T.sans }}>
                    <Target size={11} color={meta.color} />
                    <span>Sub-agent Objective</span>
                  </div>
                  <div style={{ fontSize: 12, color: T.text, lineHeight: 1.45, fontFamily: T.sans }}>
                    {phase.description}
                  </div>
                </div>
              )}

              {/* LIVE: Current Action Banner (Active Execution) */}
              {phase.status === 'in-progress' && (
                <div
                  style={{
                    padding: '11px 13px',
                    borderRadius: 8,
                    background: 'rgba(59,130,246,0.06)',
                    border: '1px solid rgba(59,130,246,0.22)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, fontWeight: 700, color: T.blue, fontFamily: T.sans, letterSpacing: '0.03em', textTransform: 'uppercase' }}>
                      <span
                        style={{
                          width: 6.5,
                          height: 6.5,
                          borderRadius: '50%',
                          background: T.blue,
                          boxShadow: '0 0 8px rgba(59,130,246,0.8)',
                          animation: 'subagentPulse 1.2s infinite'
                        }}
                      />
                      <span>Active Task Execution</span>
                    </div>
                    <span style={{ fontSize: 10, color: T.textMuted, fontFamily: T.mono }}>Live</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <div style={{ marginTop: 1, flexShrink: 0 }}>
                      <DotmSquare4 size={18} dotSize={2.4} speed={1.4} />
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: T.text, lineHeight: 1.4, fontFamily: T.sans }}>
                      {currentActionDesc}
                    </div>
                  </div>
                </div>
              )}

              {/* LIVE REASONING / THOUGHT PROCESS */}
              {accumulatedReasoning && (
                <div
                  style={{
                    borderRadius: 8,
                    border: `1px solid ${T.border}`,
                    background: T.surface,
                    overflow: 'hidden',
                  }}
                >
                  <button
                    type="button"
                    aria-expanded={showReasoning}
                    onClick={() => setShowReasoning(!showReasoning)}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: 11.5,
                      fontWeight: 650,
                      color: T.textSecondary,
                      textAlign: 'left',
                    }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Brain size={13} color="#8b5cf6" />
                      Sub-agent Reasoning
                      <span style={{ fontSize: 9.5, padding: '1px 5px', borderRadius: 4, background: 'rgba(139,92,246,0.1)', color: '#8b5cf6', fontFamily: T.mono }}>
                        {reasoningEvents.length} updates
                      </span>
                    </span>
                    <ChevronDown
                      size={14}
                      style={{
                        transform: showReasoning ? 'rotate(180deg)' : 'rotate(0deg)',
                        transition: 'transform 0.2s',
                        color: T.textMuted,
                      }}
                    />
                  </button>

                  <AnimatePresence>
                    {showReasoning && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        style={{
                          padding: '10px 12px',
                          borderTop: `1px solid ${T.border}`,
                          background: T.bg,
                          fontSize: 11,
                          fontFamily: T.mono,
                          color: T.textSecondary,
                          lineHeight: 1.5,
                          maxHeight: 180,
                          overflowY: 'auto',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                        }}
                      >
                        {accumulatedReasoning}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}

              {/* FILES TOUCHED / INSPECTED SUMMARY */}
              {filesTouched.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', fontFamily: T.sans }}>
                    Files Inspected ({filesTouched.length})
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {filesTouched.map((f, i) => (
                      <span
                        key={i}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          fontSize: 10.5,
                          fontFamily: T.mono,
                          padding: '3px 7px',
                          borderRadius: 6,
                          background: T.surface,
                          border: `1px solid ${T.border}`,
                          color: T.text,
                        }}
                      >
                        <FileText size={10} color={T.blue} />
                        {f}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* CHRONOLOGICAL ACTION LOG / TOOL ACTIVITY */}
              {actionEvents.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', fontFamily: T.sans }}>
                      Action Timeline ({actionEvents.length})
                    </div>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                      maxHeight: 220,
                      overflowY: 'auto',
                      paddingRight: 2,
                    }}
                  >
                    {actionEvents.slice(-20).map((ev, idx) => {
                      const action = (ev as any).action;
                      const toolName = action?.type || (ev as any).toolName || 'action';
                      const desc = action?.description || ev.content || 'Executed action';
                      const isComplete = action?.status === 'completed';
                      const isRunning = action?.status === 'running';
                      const isError = action?.status === 'failed' || ev.type === 'error';

                      return (
                        <div
                          key={idx}
                          style={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: 8,
                            padding: '6px 8px',
                            borderRadius: 6,
                            background: isRunning ? 'rgba(59,130,246,0.05)' : T.surface,
                            border: `1px solid ${isRunning ? 'rgba(59,130,246,0.2)' : T.border}`,
                            fontSize: 11,
                            lineHeight: 1.35,
                          }}
                        >
                          <div style={{ marginTop: 2, flexShrink: 0 }}>
                            {getActionIcon(toolName)}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ color: T.text, fontFamily: T.sans, wordBreak: 'break-word' }}>
                              {desc}
                            </div>
                          </div>
                          <div style={{ flexShrink: 0, marginTop: 2 }}>
                            {isRunning ? (
                              <span
                                style={{
                                  width: 6,
                                  height: 6,
                                  borderRadius: '50%',
                                  background: T.blue,
                                  display: 'inline-block',
                                  animation: 'subagentPulse 1.2s infinite'
                                }}
                              />
                            ) : isError ? (
                              <AlertCircle size={12} color={T.red} />
                            ) : (
                              <CheckCircle2 size={12} color={T.green} />
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* COMPLETED OUTPUT & FINDINGS */}
              {phase.output && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', fontFamily: T.sans }}>
                      Findings & Response
                    </div>
                    <button
                      type="button"
                      onClick={handleCopyOutput}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        padding: '2px 7px',
                        borderRadius: 4,
                        background: 'transparent',
                        border: `1px solid ${T.border}`,
                        fontSize: 10.5,
                        color: T.textSecondary,
                        cursor: 'pointer',
                      }}
                    >
                      {copied ? <Check size={11} color={T.green} /> : <Copy size={11} />}
                      <span>{copied ? 'Copied' : 'Copy'}</span>
                    </button>
                  </div>
                  <div
                    style={{
                      fontSize: 11.5,
                      color: T.text,
                      background: T.surface,
                      border: `1px solid ${T.border}`,
                      padding: '10px 12px',
                      borderRadius: T.r8,
                      fontFamily: T.sans,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      maxHeight: 240,
                      overflowY: 'auto',
                      lineHeight: 1.5,
                    }}
                  >
                    {phase.output}
                  </div>
                </div>
              )}

              {/* METRICS */}
              {phase.metrics && Object.keys(phase.metrics).length > 0 && (
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em', fontFamily: T.sans }}>
                    Execution Metrics
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                    {Object.entries(phase.metrics).map(([key, value]) => (
                      <div
                        key={key}
                        style={{
                          background: T.surface,
                          border: `1px solid ${T.border}`,
                          padding: '6px 8px',
                          borderRadius: T.r8,
                        }}
                      >
                        <div style={{ fontSize: 9.5, color: T.textMuted, fontWeight: 500, marginBottom: 1, fontFamily: T.sans }}>
                          {key}
                        </div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: T.text, fontFamily: T.mono }}>
                          {typeof value === 'number' ? value.toFixed(1) : String(value)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

/* ============================================================
   SUBAGENT PANEL (MAIN COMPONENT)
   ============================================================ */

export function SubagentPanel({
  coordination,
  phases = [],
  subAgentProgress,
  subAgentProgressVersion,
  onClose,
  onOpenChat,
}: {
  coordination?: SubagentCoordination | null;
  phases: SubagentPhase[];
  subAgentProgress?: Map<string, SubAgentProgressEvent[]>;
  subAgentProgressVersion?: number;
  onClose?: () => void;
  onOpenChat?: (phase: SubagentPhase) => void;
}) {
  const completedCount = phases.filter(p => p.status === 'completed').length;
  const failedCount = phases.filter(p => p.status === 'failed').length;
  const inProgressCount = phases.filter(p => p.status === 'in-progress').length;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: T.bg,
        borderRadius: T.r12,
        overflow: 'hidden',
      }}
    >
      {/* Header with Title and Close Button */}
      <div
        style={{
          padding: '14px 18px 12px',
          borderBottom: `1px solid ${T.border}`,
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.text, fontFamily: T.sans, display: 'flex', alignItems: 'center', gap: 7 }}>
            <Bot size={16} color={T.blue} />
            <span>Sub-agent Operations</span>
            {phases.length > 0 && (
              <span style={{ fontSize: 10.5, padding: '1px 6px', borderRadius: 999, background: T.surfaceRaised, border: `1px solid ${T.border}`, color: T.textSecondary, fontFamily: T.mono }}>
                {phases.length}
              </span>
            )}
          </div>
          {onClose && (
            <button
              type="button"
              aria-label="Close sub-agent operations"
              onClick={onClose}
              style={{
                background: 'transparent',
                border: 'none',
                padding: '4px',
                borderRadius: 6,
                cursor: 'pointer',
                color: T.textMuted,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              title="Close sub-agent panel"
            >
              <X size={15} />
            </button>
          )}
        </div>

        {/* 3-Pill Status Grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 6,
          }}
        >
          {[
            { label: 'Running', value: inProgressCount, color: T.blue },
            { label: 'Completed', value: completedCount, color: T.green },
            { label: 'Failed', value: failedCount, color: T.red },
          ].map(item => (
            <div
              key={item.label}
              style={{
                background: T.surface,
                border: `1px solid ${T.border}`,
                padding: '6px 8px',
                borderRadius: T.r8,
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: 9.5, color: T.textMuted, fontWeight: 500, fontFamily: T.sans, marginBottom: 1 }}>
                {item.label}
              </div>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: item.color, fontFamily: T.mono }}>
                {item.value}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Phases List */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '14px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        {phases.length === 0 ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              flex: 1,
              color: T.textMuted,
              textAlign: 'center',
              gap: 8,
              padding: '30px 16px',
            }}
          >
            <Bot size={32} strokeWidth={1.5} opacity={0.4} />
            <div style={{ fontSize: 13, fontWeight: 600, color: T.textSecondary, fontFamily: T.sans }}>
              No Active Sub-agents
            </div>
            <div style={{ fontSize: 11, fontFamily: T.sans, opacity: 0.7, maxWidth: 220 }}>
              Specialist sub-agents will appear here in real time as they are spawned to inspect code, run searches, or process tasks.
            </div>
          </div>
        ) : (
          phases.map((phase) => {
            const phaseEvents = getPhaseEvents(phase, subAgentProgress);
            const isActive = coordination?.currentAgent === phase.agent || phase.status === 'in-progress';
            const isCompleted = coordination?.completedPhases?.includes(phase.id) || phase.status === 'completed';

            return (
              <PhaseCard
                key={phase.id}
                phase={phase}
                isActive={isActive}
                isCompleted={isCompleted}
                events={phaseEvents}
                onOpenChat={() => onOpenChat?.(phase)}
              />
            );
          })
        )}
      </div>

      {/* Footer Info */}
      {phases.length > 0 && (
        <div
          style={{
            padding: '10px 16px',
            borderTop: `1px solid ${T.border}`,
            background: T.surface,
            fontSize: 11,
            color: T.textMuted,
            fontFamily: T.sans,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: inProgressCount > 0 ? T.blue : T.green,
                animation: inProgressCount > 0 ? 'subagentPulse 1.5s infinite' : 'none',
              }}
            />
            <span>
              {inProgressCount > 0
                ? `${inProgressCount} sub-agent${inProgressCount > 1 ? 's' : ''} working...`
                : 'All sub-agent tasks finished'}
            </span>
          </div>
          {coordination?.phase && (
            <span style={{ fontSize: 10, color: T.textMuted, fontFamily: T.mono }}>
              phase: {coordination.phase}
            </span>
          )}
        </div>
      )}

      <style>{`
        @keyframes subagentPulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(0.92); }
        }
      `}</style>
    </div>
  );
}
