'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Copy, Check, ChevronDown, Code2, Zap, AlertCircle,
  Clock, CheckCircle, AlertTriangle, ArrowRight
} from 'lucide-react';

/* ============================================================
   TYPES & CONSTANTS
   ============================================================ */

export interface ToolCallDetail {
  id: string;
  toolName: string;
  status: 'pending' | 'executing' | 'completed' | 'failed';
  startTime: number;
  endTime?: number;
  arguments: Record<string, any>;
  result?: any;
  error?: string;
  agent?: string;
  duration?: number;
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
  blue: '#3b82f6',
  blueFaint: 'rgba(59,130,246,0.08)',
  r8: 8,
  r12: 12,
  mono: '"Geist Mono", ui-monospace, monospace',
  sans: '"Geist", "DM Sans", ui-sans-serif, system-ui, sans-serif',
};

/* ============================================================
   COPY BUTTON
   ============================================================ */

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Silently fail
    }
  };

  return (
    <button
      onClick={handleCopy}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '4px 8px',
        borderRadius: T.r8,
        border: `1px solid ${T.border}`,
        background: T.surface,
        fontSize: 10,
        fontWeight: 600,
        color: copied ? T.green : T.textMuted,
        cursor: 'pointer',
        transition: 'all 0.2s',
        fontFamily: T.sans,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = T.surfaceRaised;
        e.currentTarget.style.borderColor = T.text;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = T.surface;
        e.currentTarget.style.borderColor = T.border;
      }}
    >
      {copied ? <Check size={10} /> : <Copy size={10} />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

/* ============================================================
   JSON VIEWER
   ============================================================ */

function JsonViewer({ data, maxHeight = 300 }: { data: any; maxHeight?: number }) {
  const [expanded, setExpanded] = useState(false);
  const jsonStr = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  const isLarge = jsonStr.length > 500;

  return (
    <div
      style={{
        background: '#f5f5f4',
        border: `1px solid ${T.border}`,
        borderRadius: T.r8,
        fontFamily: T.mono,
        fontSize: 11,
        color: '#2d2d2a',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      {isLarge && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 12px',
            borderBottom: `1px solid ${T.border}`,
            background: T.surface,
            cursor: 'pointer',
          }}
          onClick={() => setExpanded(!expanded)}
        >
          <span style={{ fontSize: 10, fontWeight: 600, color: T.textMuted }}>
            JSON ({jsonStr.length} bytes)
          </span>
          <ChevronDown
            size={14}
            style={{
              transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 0.2s',
            }}
          />
        </div>
      )}

      {/* Content */}
      <div
        style={{
          padding: '10px 12px',
          maxHeight: expanded || !isLarge ? 'none' : maxHeight,
          overflow: 'auto',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {jsonStr}
      </div>

      {/* Footer */}
      {isLarge && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            padding: '8px 12px',
            borderTop: `1px solid ${T.border}`,
            background: T.surface,
          }}
        >
          <CopyButton text={jsonStr} />
        </div>
      )}
    </div>
  );
}

/* ============================================================
   STATUS BADGE
   ============================================================ */

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { bg: string; color: string; icon: React.ComponentType; text: string }> = {
    pending: { bg: T.surfaceRaised, color: T.textMuted, icon: Clock, text: 'Pending' },
    executing: { bg: T.blueFaint, color: T.blue, icon: Zap, text: 'Executing' },
    completed: { bg: T.greenFaint, color: T.green, icon: CheckCircle, text: 'Completed' },
    failed: { bg: T.redFaint, color: T.red, icon: AlertTriangle, text: 'Failed' },
  };

  const c = config[status] || config.pending;
  const Icon = c.icon;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 12px',
        borderRadius: T.r8,
        background: c.bg,
        color: c.color,
        fontSize: 12,
        fontWeight: 600,
        fontFamily: T.sans,
      }}
    >
      <Icon size={14} />
      {c.text}
    </div>
  );
}

/* ============================================================
   TOOL CALL DETAIL PANE
   ============================================================ */

export function ToolCallDetailPane({
  toolCall,
  onClose,
}: {
  toolCall: ToolCallDetail;
  onClose: () => void;
}) {
  const [activeTab, setActiveTab] = useState<'input' | 'output' | 'timeline'>('input');
  const duration = toolCall.endTime ? toolCall.endTime - toolCall.startTime : undefined;

  return (
    <motion.div
      initial={{ opacity: 0, x: 400 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 400 }}
      transition={{ type: 'spring', damping: 28, stiffness: 260 }}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: T.bg,
        borderRadius: T.r12,
        overflow: 'hidden',
        border: `1px solid ${T.border}`,
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '16px 20px',
          borderBottom: `1px solid ${T.border}`,
          background: T.surface,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: T.r8,
              background: T.blueFaint,
              border: `1px solid ${T.blue}30`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: T.blue,
            }}
          >
            <Code2 size={18} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: T.text, fontFamily: T.sans, marginBottom: 2 }}>
              {toolCall.toolName}
            </div>
            {toolCall.agent && (
              <div style={{ fontSize: 11, color: T.textMuted, fontFamily: T.sans }}>
                Agent: {toolCall.agent}
              </div>
            )}
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            width: 32,
            height: 32,
            borderRadius: T.r8,
            border: `1px solid ${T.border}`,
            background: T.surface,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            color: T.textMuted,
            transition: 'all 0.2s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = T.surfaceRaised;
            e.currentTarget.style.color = T.text;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = T.surface;
            e.currentTarget.style.color = T.textMuted;
          }}
        >
          <X size={16} />
        </button>
      </div>

      {/* Meta Info */}
      <div
        style={{
          padding: '12px 20px',
          borderBottom: `1px solid ${T.border}`,
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 8,
        }}
      >
        {[
          { label: 'Status', value: <StatusBadge status={toolCall.status} /> },
          {
            label: 'Duration',
            value: (
              <div style={{ fontSize: 12, fontWeight: 600, color: T.text, fontFamily: T.mono }}>
                {duration ? `${(duration / 1000).toFixed(2)}s` : '—'}
              </div>
            ),
          },
          {
            label: 'Time',
            value: (
              <div style={{ fontSize: 11, color: T.textMuted, fontFamily: T.mono }}>
                {new Date(toolCall.startTime).toLocaleTimeString()}
              </div>
            ),
          },
        ].map((item) => (
          <div key={item.label}>
            <div style={{ fontSize: 10, color: T.textMuted, fontWeight: 600, marginBottom: 4, fontFamily: T.sans }}>
              {item.label}
            </div>
            {item.value}
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div
        style={{
          display: 'flex',
          borderBottom: `1px solid ${T.border}`,
          background: T.surface,
          padding: '0 20px',
          gap: 0,
        }}
      >
        {['input', 'output', 'timeline'].map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab as any)}
            style={{
              padding: '12px 16px',
              fontSize: 12,
              fontWeight: 600,
              color: activeTab === tab ? T.text : T.textMuted,
              background: activeTab === tab ? T.bg : 'transparent',
              border: 'none',
              cursor: 'pointer',
              borderBottom: activeTab === tab ? `2px solid ${T.blue}` : 'none',
              fontFamily: T.sans,
              transition: 'all 0.2s',
              textTransform: 'capitalize',
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
        <AnimatePresence mode="wait">
          {activeTab === 'input' && (
            <motion.div key="input" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em', fontFamily: T.sans }}>
                  Arguments
                </div>
                <JsonViewer data={toolCall.arguments} />
              </div>
            </motion.div>
          )}

          {activeTab === 'output' && (
            <motion.div key="output" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              {toolCall.status === 'completed' && toolCall.result ? (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em', fontFamily: T.sans }}>
                    Result
                  </div>
                  <JsonViewer data={toolCall.result} />
                </div>
              ) : toolCall.status === 'failed' && toolCall.error ? (
                <div
                  style={{
                    background: T.redFaint,
                    border: `1px solid ${T.red}30`,
                    borderRadius: T.r8,
                    padding: '12px 14px',
                    display: 'flex',
                    gap: 10,
                  }}
                >
                  <AlertCircle size={16} color={T.red} style={{ flexShrink: 0, marginTop: 1 }} />
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: T.red, marginBottom: 4, fontFamily: T.sans }}>
                      Error
                    </div>
                    <code style={{ fontSize: 11, color: T.red, fontFamily: T.mono, whiteSpace: 'pre-wrap' }}>
                      {toolCall.error}
                    </code>
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '40px 20px',
                    color: T.textMuted,
                    textAlign: 'center',
                  }}
                >
                  <Zap size={28} opacity={0.3} style={{ marginBottom: 8 }} />
                  <div style={{ fontSize: 12, fontFamily: T.sans }}>No output yet</div>
                  <div style={{ fontSize: 11, fontFamily: T.sans, opacity: 0.7 }}>
                    Tool is still executing or has no output
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {activeTab === 'timeline' && (
            <motion.div key="timeline" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {[
                  { label: 'Tool Called', time: toolCall.startTime, status: 'completed' },
                  {
                    label: 'Executing',
                    time: toolCall.startTime + (duration || 0) / 2,
                    status: toolCall.status === 'executing' ? 'in-progress' : 'completed',
                  },
                  {
                    label: toolCall.status === 'failed' ? 'Failed' : 'Completed',
                    time: toolCall.endTime || toolCall.startTime,
                    status: toolCall.status,
                  },
                ].map((event, idx) => (
                  <div key={idx} style={{ display: 'flex', gap: 12 }}>
                    {/* Timeline dot */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                      <div
                        style={{
                          width: 12,
                          height: 12,
                          borderRadius: '50%',
                          background:
                            event.status === 'completed'
                              ? T.green
                              : event.status === 'in-progress'
                                ? T.blue
                                : T.red,
                          border: `2px solid ${T.surface}`,
                          boxShadow: `0 0 0 2px ${event.status === 'completed' ? T.green : event.status === 'in-progress' ? T.blue : T.red}`,
                        }}
                      />
                      {idx < 2 && (
                        <div
                          style={{
                            width: 2,
                            height: 24,
                            background: T.border,
                          }}
                        />
                      )}
                    </div>

                    {/* Event */}
                    <div style={{ flex: 1, paddingTop: 2 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: T.text, marginBottom: 2, fontFamily: T.sans }}>
                        {event.label}
                      </div>
                      <div style={{ fontSize: 11, color: T.textMuted, fontFamily: T.mono }}>
                        {new Date(event.time).toLocaleTimeString()}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
