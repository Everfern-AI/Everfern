'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, Zap, CheckCircle, AlertCircle, Clock, ChevronDown, ChevronRight,
  FileText, Code, Bot, GitBranch, TestTube, Eye
} from 'lucide-react';

/* ============================================================
   TYPES & CONSTANTS
   ============================================================ */

export interface SubagentPhase {
  id: string;
  name: string;
  status: 'pending' | 'in-progress' | 'completed' | 'failed';
  agent: string;
  description: string;
  startTime?: number;
  endTime?: number;
  output?: string;
  metrics?: Record<string, any>;
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
  bg: '#fafafa',
  surface: '#fff',
  surfaceRaised: '#f5f5f4',
  border: '#e8e8e6',
  text: '#141412',
  textSecondary: '#6b6b67',
  textMuted: '#a8a8a3',
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

const AGENTS_META: Record<string, { icon: React.ComponentType, label: string, description: string, color: string }> = {
  exploration_agent: {
    icon: Eye,
    label: 'Exploration',
    description: 'Analyze codebase',
    color: T.blue,
  },
  planning_agent: {
    icon: FileText,
    label: 'Planning',
    description: 'Develop strategy',
    color: T.blue,
  },
  worker_agent: {
    icon: Code,
    label: 'Implementation',
    description: 'Write code',
    color: T.green,
  },
  code_reviewer_agent: {
    icon: CheckCircle,
    label: 'Review',
    description: 'Quality check',
    color: '#f59e0b',
  },
  test_runner_agent: {
    icon: TestTube,
    label: 'Testing',
    description: 'TDD validation',
    color: '#8b5cf6',
  },
};

/* ============================================================
   STATUS BADGES
   ============================================================ */

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { bg: string; color: string; text: string; icon: React.ComponentType }> = {
    pending: { bg: T.surfaceRaised, color: T.textMuted, text: 'Pending', icon: Clock },
    'in-progress': { bg: T.blueFaint, color: T.blue, text: 'In Progress', icon: Zap },
    completed: { bg: T.greenFaint, color: T.green, text: 'Completed', icon: CheckCircle },
    failed: { bg: T.redFaint, color: T.red, text: 'Failed', icon: AlertCircle },
  };

  const c = config[status] || config.pending;
  const Icon = c.icon;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        borderRadius: T.r8,
        background: c.bg,
        color: c.color,
        fontSize: 11,
        fontWeight: 600,
        fontFamily: T.sans,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center' }}><Icon /></div>
      {c.text}
    </div>
  );
}

/* ============================================================
   PHASE CARD
   ============================================================ */

function PhaseCard({
  phase,
  isActive,
  isCompleted,
}: {
  phase: SubagentPhase;
  isActive: boolean;
  isCompleted: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const meta = AGENTS_META[phase.agent] || AGENTS_META.exploration_agent;
  const Icon = meta.icon;
  const duration = phase.endTime && phase.startTime ? phase.endTime - phase.startTime : null;

  return (
    <motion.div
      style={{
        borderRadius: T.r12,
        border: `1px solid ${T.border}`,
        background: T.surface,
        overflow: 'hidden',
        boxShadow: isActive ? '0 4px 12px rgba(59,130,246,0.15)' : 'none',
        borderColor: isActive ? T.blue : T.border,
      }}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      {/* Header */}
      <div
        style={{
          padding: '14px 18px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          cursor: expanded ? 'pointer' : 'default',
          borderBottom: expanded ? `1px solid ${T.border}` : 'none',
        }}
        onClick={() => setExpanded(!expanded)}
      >
        {/* Status Indicator */}
        <div
          style={{
            width: 10,
            height: 10,
            borderRadius: '50%',
            background:
              phase.status === 'completed'
                ? T.green
                : phase.status === 'in-progress'
                  ? T.blue
                  : phase.status === 'failed'
                    ? T.red
                    : T.textMuted,
            animation: phase.status === 'in-progress' ? 'pulse 2s infinite' : 'none',
          }}
        />

        {/* Icon */}
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: T.r8,
            background: `${meta.color}15`,
            border: `1px solid ${meta.color}30`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: meta.color,
          }}
        >
          <Icon size={16} strokeWidth={2} />
        </div>

        {/* Title & Description */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: T.text, marginBottom: 2, fontFamily: T.sans }}>
            {meta.label}
          </div>
          <div style={{ fontSize: 11, color: T.textMuted, fontFamily: T.sans }}>
            {meta.description}
          </div>
        </div>

        {/* Duration */}
        {duration && (
          <div style={{ fontSize: 10, color: T.textMuted, fontWeight: 500, fontFamily: T.mono }}>
            {(duration / 1000).toFixed(1)}s
          </div>
        )}

        {/* Expand icon */}
        {phase.output || phase.metrics ? (
          <ChevronDown
            size={16}
            style={{
              color: T.textMuted,
              transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 0.2s',
            }}
          />
        ) : null}
      </div>

      {/* Status Bar */}
      <div style={{ height: 3, background: T.surfaceRaised }}>
        <motion.div
          style={{
            height: '100%',
            background: meta.color,
            borderRadius: '0 2px 0 0',
          }}
          initial={{ scaleX: 0 }}
          animate={{ scaleX: phase.status === 'completed' || phase.status === 'failed' ? 1 : 0.3 }}
          transition={{ duration: 0.5 }}
        />
      </div>

      {/* Expanded Content */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{
              overflow: 'hidden',
              padding: '14px 18px',
              borderTop: `1px solid ${T.border}`,
              background: T.bg,
            }}
          >
            {/* Output */}
            {phase.output && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: T.textMuted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em', fontFamily: T.sans }}>
                  Output
                </div>
                <code
                  style={{
                    fontSize: 11,
                    color: T.text,
                    background: T.surface,
                    border: `1px solid ${T.border}`,
                    padding: '10px 12px',
                    borderRadius: T.r8,
                    display: 'block',
                    fontFamily: T.mono,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    maxHeight: 200,
                    overflow: 'auto',
                  }}
                >
                  {phase.output.substring(0, 500)}
                  {phase.output.length > 500 ? '...' : ''}
                </code>
              </div>
            )}

            {/* Metrics */}
            {phase.metrics && Object.keys(phase.metrics).length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: T.textMuted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em', fontFamily: T.sans }}>
                  Metrics
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {Object.entries(phase.metrics).map(([key, value]) => (
                    <div
                      key={key}
                      style={{
                        background: T.surface,
                        border: `1px solid ${T.border}`,
                        padding: '8px 10px',
                        borderRadius: T.r8,
                      }}
                    >
                      <div style={{ fontSize: 10, color: T.textMuted, fontWeight: 500, marginBottom: 2, fontFamily: T.sans }}>
                        {key}
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: T.text, fontFamily: T.mono }}>
                        {typeof value === 'number' ? value.toFixed(2) : String(value)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </motion.div>
  );
}

/* ============================================================
   SUBAGENT PANEL
   ============================================================ */

export function SubagentPanel({
  coordination,
  phases,
}: {
  coordination: SubagentCoordination;
  phases: SubagentPhase[];
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
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '16px 20px',
          borderBottom: `1px solid ${T.border}`,
          flexShrink: 0,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 700, color: T.text, marginBottom: 10, fontFamily: T.sans, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Bot size={16} />
          Multi-Agent Development
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 8,
          }}
        >
          {[
            { label: 'Completed', value: completedCount, color: T.green },
            { label: 'In Progress', value: inProgressCount, color: T.blue },
            { label: 'Failed', value: failedCount, color: T.red },
          ].map(item => (
            <div
              key={item.label}
              style={{
                background: T.surface,
                border: `1px solid ${T.border}`,
                padding: '8px 10px',
                borderRadius: T.r8,
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: 10, color: T.textMuted, fontWeight: 500, fontFamily: T.sans, marginBottom: 2 }}>
                {item.label}
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: item.color, fontFamily: T.mono }}>
                {item.value}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Phases List */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {phases.length === 0 ? (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            flex: 1,
            color: T.textMuted,
            textAlign: 'center',
            gap: 8,
          }}>
            <Bot size={32} strokeWidth={1.5} opacity={0.5} />
            <div style={{ fontSize: 12, fontFamily: T.sans }}>No phases yet</div>
            <div style={{ fontSize: 11, fontFamily: T.sans, opacity: 0.7 }}>
              Multi-agent system will activate when you request coding assistance
            </div>
          </div>
        ) : (
          phases.map((phase, idx) => (
            <PhaseCard
              key={phase.id}
              phase={phase}
              isActive={coordination.currentAgent === phase.agent}
              isCompleted={coordination.completedPhases.includes(phase.id)}
            />
          ))
        )}
      </div>

      {/* Footer */}
      {phases.length > 0 && (
        <div
          style={{
            padding: '12px 20px',
            borderTop: `1px solid ${T.border}`,
            background: T.surface,
            borderRadius: '0 0 12px 12px',
            fontSize: 11,
            color: T.textMuted,
            fontFamily: T.sans,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <div
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: coordination.phase === 'complete' ? T.green : T.blue,
              animation: coordination.phase !== 'complete' ? 'pulse 2s infinite' : 'none',
            }}
          />
          {coordination.phase === 'complete' ? (
            <span>✓ Development completed</span>
          ) : (
            <span>Current phase: {coordination.phase}</span>
          )}
        </div>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
}
