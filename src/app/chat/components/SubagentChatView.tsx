'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft, Bot, Brain, ChevronDown, ChevronRight, Copy, Check,
  Terminal, Code, FileText, Search, Globe, Zap, AlertCircle, CheckCircle2,
  Clock, Target, Maximize2, Minimize2, ExternalLink
} from 'lucide-react';
import type { SubagentPhase } from './SubagentPanel';
import type { SubAgentProgressEvent } from '../types';
import { DotmSquare4 } from '@/components/ui/dotm-square-4';
import { MarkdownRenderer } from './MarkdownComponents';

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const sec = Math.floor(ms / 1000);
  const min = Math.floor(sec / 60);
  const remSec = sec % 60;
  if (min === 0) return `${sec}s`;
  return `${min}m ${remSec < 10 ? '0' : ''}${remSec}s`;
}

function getActionIcon(toolName: string) {
  const t = (toolName || '').toLowerCase();
  if (t.includes('read') || t.includes('view')) return <FileText size={14} color="#3b82f6" />;
  if (t.includes('write') || t.includes('edit') || t.includes('replace')) return <Code size={14} color="#10b981" />;
  if (t.includes('grep') || t.includes('search') || t.includes('find') || t.includes('list')) return <Search size={14} color="#f59e0b" />;
  if (t.includes('terminal') || t.includes('pwsh') || t.includes('bash') || t.includes('command')) return <Terminal size={14} color="#8b5cf6" />;
  if (t.includes('web') || t.includes('fetch') || t.includes('browser') || t.includes('navis')) return <Globe size={14} color="#3b82f6" />;
  if (t.includes('python')) return <Code size={14} color="#60a5fa" />;
  return <Zap size={14} color="#94a3b8" />;
}

interface SubagentChatViewProps {
  phase: SubagentPhase;
  events?: SubAgentProgressEvent[];
  onBack: () => void;
}

export function SubagentChatView({
  phase,
  events = [],
  onBack,
}: SubagentChatViewProps) {
  const [copied, setCopied] = useState(false);
  const [showReasoning, setShowReasoning] = useState(true);
  const [expandedActionIds, setExpandedActionIds] = useState<Set<string>>(new Set());
  const [liveElapsed, setLiveElapsed] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Keyboard shortcut: Escape to go back
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onBack();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onBack]);

  // Live timer
  useEffect(() => {
    if (phase.status === 'in-progress' && phase.startTime) {
      setLiveElapsed(Date.now() - phase.startTime);
      const timer = setInterval(() => {
        setLiveElapsed(Date.now() - phase.startTime!);
      }, 500);
      return () => clearInterval(timer);
    } else if (phase.endTime && phase.startTime) {
      setLiveElapsed(phase.endTime - phase.startTime);
    }
  }, [phase.status, phase.startTime, phase.endTime]);

  // Extract reasoning
  const reasoningEvents = useMemo(() => {
    return events.filter(e => e.type === 'reasoning' || (e as any).type === 'thought');
  }, [events]);

  const accumulatedReasoning = useMemo(() => {
    return reasoningEvents.map(e => e.content || '').join('').trim();
  }, [reasoningEvents]);

  // Extract action events (tools called)
  const actionEvents = useMemo(() => {
    return events.filter(e =>
      e.type === 'action' ||
      e.type === 'step' ||
      Boolean(e.action) ||
      e.type === 'screenshot'
    );
  }, [events]);

  // Extract live streamed text chunks
  const streamedChunks = useMemo(() => {
    return events
      .filter(e => (e as any).type === 'chunk')
      .map(e => e.content || '')
      .join('');
  }, [events]);

  const effectiveOutput = phase.output || streamedChunks;

  // Auto-scroll when new actions arrive
  useEffect(() => {
    if (phase.status === 'in-progress') {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [events.length, phase.status]);

  const toggleActionExpanded = (id: string) => {
    setExpandedActionIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCopy = () => {
    const textToCopy = effectiveOutput || accumulatedReasoning || phase.description || '';
    if (!textToCopy) return;
    navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const agentTitle = phase.agent
    ? phase.agent.replace(/[-_]/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
    : 'Sub-agent Specialist';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        background: 'var(--color-bg-base, var(--color-bg-surface))',
        color: 'var(--color-text-primary)',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {/* ── Top Header Bar ────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 20px',
          borderBottom: '1px solid var(--color-border)',
          background: 'var(--color-bg-surface)',
          zIndex: 10,
          flexShrink: 0,
        }}
      >
        {/* Left: Back Button & Sub-agent Title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            type="button"
            aria-label="Back to sub-agent operations"
            onClick={onBack}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              borderRadius: 8,
              border: '1px solid var(--color-border)',
              background: 'var(--color-bg-subtle)',
              color: 'var(--color-text-primary)',
              fontSize: 12.5,
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
            title="Back to parent conversation (Escape)"
          >
            <ArrowLeft size={14} />
            <span>Main Chat</span>
            <span
              style={{
                fontSize: 10,
                color: 'var(--color-text-tertiary)',
                background: 'var(--color-bg-surface)',
                padding: '1px 5px',
                borderRadius: 4,
                border: '1px solid var(--color-border)',
                fontFamily: 'monospace',
                marginLeft: 2,
              }}
            >
              Esc
            </span>
          </button>

          <div style={{ width: 1, height: 20, background: 'var(--color-border)' }} />

          {/* Sub-agent Identity */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div
              style={{
                width: 28,
                height: 28,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              {phase.status === 'in-progress' ? (
                <DotmSquare4 size={24} dotSize={3.2} speed={1.4} />
              ) : phase.status === 'completed' ? (
                <CheckCircle2 size={18} color="var(--color-success, #22c55e)" />
              ) : (
                <AlertCircle size={18} color="var(--color-danger, #ef4444)" />
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--color-text-primary)' }}>
                  {agentTitle}
                </span>
                {phase.agentId && (
                  <span
                    style={{
                      fontSize: 10,
                      fontFamily: 'monospace',
                      color: 'var(--color-text-tertiary)',
                      background: 'var(--color-bg-subtle)',
                      padding: '1px 5px',
                      borderRadius: 4,
                      border: '1px solid var(--color-border)',
                    }}
                  >
                    #{phase.agentId.slice(-6)}
                  </span>
                )}
              </div>
              <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
                Delegated Sub-agent Execution Session
              </span>
            </div>
          </div>
        </div>

        {/* Right: Status Pill & Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {liveElapsed > 0 && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                fontSize: 11,
                fontFamily: 'monospace',
                color: 'var(--color-text-secondary)',
                background: 'var(--color-bg-subtle)',
                padding: '4px 8px',
                borderRadius: 6,
                border: '1px solid var(--color-border)',
              }}
            >
              <Clock size={12} />
              {formatDuration(liveElapsed)}
            </span>
          )}

          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 10px',
              borderRadius: 999,
              fontSize: 11,
              fontWeight: 650,
              background: phase.status === 'in-progress'
                ? 'var(--color-navis-active-bg, rgba(59,130,246,0.1))'
                : phase.status === 'completed'
                ? 'rgba(34,197,94,0.1)'
                : 'rgba(239,68,68,0.1)',
              color: phase.status === 'in-progress'
                ? 'var(--color-navis-active-text, #3b82f6)'
                : phase.status === 'completed'
                ? '#22c55e'
                : '#ef4444',
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: 'currentColor',
                boxShadow: '0 0 8px currentColor',
              }}
            />
            {phase.status === 'in-progress' ? 'Running' : phase.status === 'completed' ? 'Finished' : 'Failed'}
          </span>

          {effectiveOutput && (
            <button
              type="button"
              aria-label={copied ? 'Output copied' : 'Copy sub-agent output'}
              onClick={handleCopy}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '5px 9px',
                borderRadius: 6,
                border: '1px solid var(--color-border)',
                background: 'var(--color-bg-subtle)',
                fontSize: 11.5,
                color: 'var(--color-text-secondary)',
                cursor: 'pointer',
              }}
              title="Copy sub-agent output"
            >
              {copied ? <Check size={12} color="#22c55e" /> : <Copy size={12} />}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>
          )}
        </div>
      </div>

      {/* ── Scrollable Chat Timeline Area ─────────────────────────── */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '24px 28px',
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
          maxWidth: 960,
          width: '100%',
          margin: '0 auto',
        }}
      >
        {/* 1. Delegated Mission Prompt (User Bubble Style) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            <Target size={12} color="#3b82f6" />
            <span>Delegated Mission Objective</span>
          </div>

          <div
            style={{
              padding: '14px 18px',
              borderRadius: 12,
              background: 'var(--color-bg-subtle)',
              border: '1px solid var(--color-border)',
              fontSize: 13.5,
              lineHeight: 1.55,
              color: 'var(--color-text-primary)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {phase.description || 'Executing delegated task for parent session.'}
          </div>
        </div>

        {/* 2. Chain-of-Thought Reasoning (Collapsible) */}
        {accumulatedReasoning && (
          <div
            style={{
              borderRadius: 12,
              border: '1px solid var(--color-border)',
              background: 'var(--color-bg-surface)',
              overflow: 'hidden',
            }}
          >
            <button
              type="button"
              aria-expanded={showReasoning}
              onClick={() => setShowReasoning(!showReasoning)}
              style={{
                width: '100%',
                padding: '10px 16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: 'var(--color-bg-subtle)',
                border: 'none',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 650,
                color: 'var(--color-text-secondary)',
                textAlign: 'left',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Brain size={15} color="#8b5cf6" />
                <span>Internal Reasoning Process</span>
                {reasoningEvents.length > 0 && (
                  <span
                    style={{
                      fontSize: 10,
                      padding: '1px 6px',
                      borderRadius: 999,
                      background: 'rgba(139,92,246,0.1)',
                      color: '#8b5cf6',
                      fontFamily: 'monospace',
                    }}
                  >
                    {reasoningEvents.length} steps
                  </span>
                )}
              </span>
              <ChevronDown
                size={14}
                style={{
                  transform: showReasoning ? 'rotate(180deg)' : 'rotate(0deg)',
                  transition: 'transform 0.2s',
                  color: 'var(--color-text-tertiary)',
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
                    padding: '14px 16px',
                    borderTop: '1px solid var(--color-border)',
                    background: 'var(--color-bg-surface)',
                    fontSize: 12,
                    fontFamily: 'monospace',
                    color: 'var(--color-text-secondary)',
                    lineHeight: 1.6,
                    maxHeight: 280,
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

        {/* 3. Real-Time Tools & Actions Stream */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              <Terminal size={12} color="#10b981" />
              <span>Executed Actions & Tools ({actionEvents.length})</span>
            </div>
            {actionEvents.length > 0 && (
              <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                Chronological timeline
              </span>
            )}
          </div>

          {actionEvents.length === 0 ? (
            <div
              style={{
                padding: '24px 18px',
                borderRadius: 12,
                border: '1px dashed var(--color-border)',
                background: 'var(--color-bg-subtle)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                color: 'var(--color-text-secondary)',
                fontSize: 12.5,
                textAlign: 'center',
              }}
            >
              {phase.status === 'in-progress' ? (
                <>
                  <DotmSquare4 size={30} dotSize={3.5} speed={1.3} />
                  <span>Sub-agent is inspecting the environment and selecting tools...</span>
                </>
              ) : (
                <span>No tool calls were recorded for this sub-agent execution.</span>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {actionEvents.map((evt, idx) => {
                const actionId = `${evt.toolCallId || 'action'}-${idx}`;
                const isExpanded = expandedActionIds.has(actionId);
                const toolName = evt.action?.type || (evt as any).metadata?.toolName || 'tool';
                const actionStatus = evt.action?.status || (evt as any).metadata?.status || (phase.status === 'in-progress' && idx === actionEvents.length - 1 ? 'running' : 'completed');
                const description = evt.action?.description || evt.content || '';
                const params = evt.action?.params;
                const result = evt.action?.result;
                const hasDetails = Boolean(
                  (params && Object.keys(params).length > 0) || result !== undefined
                );
                const resultOutput = typeof result === 'string'
                  ? result
                  : typeof result?.output === 'string'
                    ? result.output
                    : result?.output !== undefined
                      ? JSON.stringify(result.output, null, 2)
                      : result !== undefined
                        ? JSON.stringify(result, null, 2)
                        : '';

                return (
                  <div
                    key={actionId}
                    style={{
                      borderRadius: 10,
                      border: '1px solid var(--color-border)',
                      background: 'var(--color-bg-surface)',
                      overflow: 'hidden',
                      transition: 'border-color 0.15s ease',
                    }}
                  >
                    {/* Action Header */}
                    <button
                      type="button"
                      disabled={!hasDetails}
                      aria-expanded={hasDetails ? isExpanded : undefined}
                      aria-label={hasDetails ? (isExpanded ? 'Collapse ' : 'Expand ') + toolName + ' details' : toolName + ' action'}
                      style={{
                        width: '100%',
                        border: 0,
                        color: 'inherit',
                        font: 'inherit',
                        textAlign: 'left',
                        padding: '10px 14px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        cursor: hasDetails ? 'pointer' : 'default',
                        background: isExpanded ? 'var(--color-bg-subtle)' : 'transparent',
                        gap: 10,
                      }}
                      onClick={() => hasDetails && toggleActionExpanded(actionId)}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
                        <div
                          style={{
                            width: 24,
                            height: 24,
                            borderRadius: 6,
                            background: 'var(--color-bg-subtle)',
                            border: '1px solid var(--color-border)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                          }}
                        >
                          {getActionIcon(toolName)}
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: 12, fontWeight: 700, fontFamily: 'monospace', color: 'var(--color-text-primary)' }}>
                              {toolName}
                            </span>
                          </div>
                          <span
                            style={{
                              fontSize: 11.5,
                              color: 'var(--color-text-secondary)',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            {description}
                          </span>
                        </div>
                      </div>

                      {/* Status & Toggle */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                        {actionStatus === 'running' ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, color: '#3b82f6', fontWeight: 600 }}>
                            <DotmSquare4 size={14} dotSize={2} speed={1.4} />
                            <span>Executing</span>
                          </span>
                        ) : actionStatus === 'failed' ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10.5, color: '#ef4444', fontWeight: 600 }}>
                            <AlertCircle size={12} />
                            <span>Failed</span>
                          </span>
                        ) : (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10.5, color: '#22c55e', fontWeight: 600 }}>
                            <CheckCircle2 size={12} />
                            <span>Done</span>
                          </span>
                        )}

                        {hasDetails && (
                          <ChevronDown
                            size={14}
                            style={{
                              transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                              transition: 'transform 0.15s',
                              color: 'var(--color-text-tertiary)',
                            }}
                          />
                        )}
                      </div>
                    </button>

                    {/* Action Expanded Drawer (Args and Result) */}
                    {isExpanded && hasDetails && (
                      <div
                        style={{
                          padding: '12px 14px',
                          borderTop: '1px solid var(--color-border)',
                          background: 'var(--color-bg-subtle)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 8,
                          fontSize: 11,
                          fontFamily: 'monospace',
                        }}
                      >
                        {params && Object.keys(params).length > 0 && (
                          <div>
                            <div style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', marginBottom: 4 }}>
                              Input Arguments
                            </div>
                            <pre
                              style={{
                                margin: 0,
                                padding: '8px 10px',
                                borderRadius: 6,
                                background: 'var(--color-bg-surface)',
                                border: '1px solid var(--color-border)',
                                color: 'var(--color-text-secondary)',
                                overflowX: 'auto',
                                whiteSpace: 'pre-wrap',
                                wordBreak: 'break-all',
                                maxHeight: 160,
                              }}
                            >
                              {JSON.stringify(params, null, 2)}
                            </pre>
                          </div>
                        )}

                        {result !== undefined && (
                          <div>
                            <div style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', marginBottom: 4 }}>
                              Result / Output
                            </div>
                            <pre
                              style={{
                                margin: 0,
                                padding: '8px 10px',
                                borderRadius: 6,
                                background: 'var(--color-bg-surface)',
                                border: '1px solid var(--color-border)',
                                color: typeof result !== 'string' && result.success === false ? 'var(--color-error)' : 'var(--color-text-secondary)',
                                overflowX: 'auto',
                                whiteSpace: 'pre-wrap',
                                wordBreak: 'break-all',
                                maxHeight: 220,
                              }}
                            >
                              {resultOutput}
                            </pre>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 4. Subagent Final Findings / Streamed Output */}
        {effectiveOutput && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              <Bot size={13} color="#3b82f6" />
              <span>Sub-agent Output & Findings</span>
            </div>

            <div
              style={{
                padding: '16px 20px',
                borderRadius: 12,
                background: 'var(--color-bg-surface)',
                border: '1px solid var(--color-border)',
                fontSize: 13,
                lineHeight: 1.6,
                color: 'var(--color-text-primary)',
              }}
            >
              <MarkdownRenderer content={effectiveOutput} />
            </div>
          </div>
        )}

        {/* 5. Live Working Indicator */}
        {phase.status === 'in-progress' && (
          <div
            style={{
              padding: '14px 18px',
              borderRadius: 12,
              border: '1px solid rgba(59,130,246,0.25)',
              background: 'rgba(59,130,246,0.04)',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <DotmSquare4 size={24} dotSize={3.2} speed={1.4} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 12.5, fontWeight: 650, color: 'var(--color-text-primary)' }}>
                Sub-agent is working...
              </span>
              <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
                Actions and results stream directly to this activity timeline in real time.
              </span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}
