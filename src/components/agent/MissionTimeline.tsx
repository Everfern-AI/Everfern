/**
 * Mission Timeline Component
 * Claude Cowork / Claude Code Linear Aesthetic
 */

'use client';

import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Clock,
  AlertCircle,
  Sparkles,
  ChevronDown,
  Check,
  Loader2,
  Terminal,
} from 'lucide-react';
import { useAutoCollapse } from '@/hooks/use-auto-collapse';
import { formatDuration } from '@/lib/formatDuration';

export interface MissionStep {
  id: string;
  name: string;
  description: string;
  phase: 'triage' | 'planning' | 'execution' | 'validation' | 'completion';
  status: 'pending' | 'in-progress' | 'completed' | 'failed' | 'skipped';
  startTime?: number;
  endTime?: number;
  duration?: number;
  toolCalls?: string[];
  result?: string;
  error?: string;
  metadata?: Record<string, any>;
}

export interface MissionTimeline {
  missionId: string;
  startTime: number;
  currentPhase: string;
  steps: MissionStep[];
  completedSteps: number;
  totalSteps: number;
  isComplete: boolean;
  finalResult?: string;
  error?: string;
}

interface MissionTimelineProps {
  timeline: MissionTimeline | null;
  isRunning: boolean;
  autoCollapse?: boolean;
  onCollapseChange?: (collapsed: boolean) => void;
  variant?: 'main' | 'sidebar';
}

const shouldHideStepResult = (str: string | undefined | null): boolean => {
  if (!str) return true;
  const trimmed = str.trim();
  if (!trimmed) return true;

  if (trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.startsWith('"') || trimmed.startsWith('\\"')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === 'object' && parsed !== null) return true;
    } catch {}
  }

  const lower = trimmed.toLowerCase();
  if (lower.includes('"messages"') || lower.includes('"tool_calls"') || lower.includes('"role"')) {
    return true;
  }
  if (/^completed\s*\d*\s*tool\s*calls?$/i.test(trimmed)) {
    return true;
  }
  return false;
};

export const MissionTimelineComponent: React.FC<MissionTimelineProps> = ({
  timeline,
  isRunning,
  autoCollapse = true,
  onCollapseChange,
  variant = 'main',
}) => {
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());
  const [isExpanded, setIsExpanded] = useAutoCollapse(isRunning, autoCollapse);

  const isSidebar = variant === 'sidebar';

  const totalDuration = useMemo(() => {
    if (!timeline?.steps) return 0;
    return timeline.steps.reduce((sum, step) => sum + (step.duration || 0), 0);
  }, [timeline?.steps]);

  React.useEffect(() => {
    onCollapseChange?.(!isExpanded);
  }, [isExpanded, onCollapseChange]);

  const toggleExpand = (stepId: string) => {
    const newExpanded = new Set(expandedSteps);
    if (newExpanded.has(stepId)) {
      newExpanded.delete(stepId);
    } else {
      newExpanded.add(stepId);
    }
    setExpandedSteps(newExpanded);
  };

  if (!timeline || timeline.totalSteps === 0) {
    return null;
  }

  const progress = (timeline.completedSteps / timeline.totalSteps) * 100;

  return (
    <div
      style={{
        width: '100%',
        margin: '8px 0',
        padding: isSidebar ? '0' : '12px 16px',
        borderRadius: 10,
        background: isSidebar ? 'transparent' : 'rgba(255, 255, 255, 0.02)',
        border: isSidebar ? 'none' : '1px solid rgba(255, 255, 255, 0.08)',
        backdropFilter: isSidebar ? 'none' : 'blur(8px)',
      }}
    >
      {/* Header */}
      {!isSidebar && (
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Sparkles size={15} strokeWidth={1.75} style={{ color: 'rgba(255, 255, 255, 0.6)' }} />
            <span style={{ fontSize: 13.5, fontWeight: 500, color: 'rgba(255, 255, 255, 0.9)' }}>
              Mission Orchestration
            </span>
            {!isRunning && totalDuration > 0 && (
              <span style={{ fontSize: 12, color: 'rgba(255, 255, 255, 0.35)' }}>
                ({formatDuration(totalDuration)})
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: 'rgba(255, 255, 255, 0.45)' }}>
              {timeline.completedSteps}/{timeline.totalSteps} steps
            </span>
            <motion.div
              animate={{ rotate: isExpanded ? 180 : 0 }}
              transition={{ duration: 0.15 }}
              style={{ display: 'flex', color: 'rgba(255, 255, 255, 0.4)' }}
            >
              <ChevronDown size={14} strokeWidth={1.75} />
            </motion.div>
          </div>
        </button>
      )}

      {/* Content */}
      <AnimatePresence initial={false}>
        {(isExpanded || isSidebar) && (
          <motion.div
            initial={isSidebar ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{ overflow: 'hidden', marginTop: isSidebar ? 0 : 12 }}
          >
            {/* Progress bar hairline */}
            <div
              style={{
                width: '100%',
                height: 2,
                background: 'rgba(255, 255, 255, 0.08)',
                borderRadius: 1,
                overflow: 'hidden',
                marginBottom: 12,
              }}
            >
              <motion.div
                style={{
                  height: '100%',
                  background: 'rgba(255, 255, 255, 0.7)',
                  borderRadius: 1,
                }}
                initial={{ width: 0 }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.3 }}
              />
            </div>

            {/* Steps list */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {timeline.steps.map((step, index) => {
                const isExpanded = expandedSteps.has(step.id);
                const isDone = step.status === 'completed';
                const isRunningStep = step.status === 'in-progress';
                const isFailed = step.status === 'failed';
                const isLast = index === timeline.steps.length - 1;

                return (
                  <div key={step.id} style={{ display: 'flex', flexDirection: 'column' }}>
                    {/* Step Row */}
                    <div
                      onClick={() => toggleExpand(step.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '6px 0',
                        cursor: 'pointer',
                        userSelect: 'none',
                      }}
                    >
                      {/* Status Glyph */}
                      <div style={{ width: 15, display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
                        {isDone ? (
                          <Check size={14} strokeWidth={2} style={{ color: '#10b981' }} />
                        ) : isRunningStep ? (
                          <Loader2 size={14} strokeWidth={1.75} className="animate-spin" style={{ color: 'rgba(255, 255, 255, 0.8)' }} />
                        ) : isFailed ? (
                          <AlertCircle size={14} strokeWidth={1.75} style={{ color: '#ef4444' }} />
                        ) : (
                          <div style={{ width: 5, height: 5, borderRadius: '50%', background: 'rgba(255, 255, 255, 0.25)' }} />
                        )}
                      </div>

                      {/* Title & Description */}
                      <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span
                          style={{
                            fontSize: 13.5,
                            fontWeight: isRunningStep ? 500 : 400,
                            color: isDone ? 'rgba(255, 255, 255, 0.55)' : isRunningStep ? 'rgba(255, 255, 255, 0.92)' : 'rgba(255, 255, 255, 0.45)',
                            textDecoration: isDone ? 'none' : 'none',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {step.name}
                        </span>
                        {step.duration && (
                          <span style={{ fontSize: 11, color: 'rgba(255, 255, 255, 0.3)', flexShrink: 0 }}>
                            {(step.duration / 1000).toFixed(1)}s
                          </span>
                        )}
                      </div>

                      <motion.span
                        animate={{ rotate: isExpanded ? 180 : 0 }}
                        transition={{ duration: 0.15 }}
                        style={{ color: 'rgba(255, 255, 255, 0.3)', display: 'flex', flexShrink: 0 }}
                      >
                        <ChevronDown size={12} strokeWidth={1.75} />
                      </motion.span>
                    </div>

                    {/* Step Hairline Connector */}
                    {!isLast && !isExpanded && (
                      <div
                        style={{
                          width: 1,
                          height: 8,
                          marginLeft: 7,
                          background: 'rgba(255, 255, 255, 0.1)',
                        }}
                      />
                    )}

                    {/* Expanded details */}
                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.15 }}
                          style={{
                            overflow: 'hidden',
                            paddingLeft: 25,
                            paddingBottom: 8,
                            fontSize: 12,
                            color: 'rgba(255, 255, 255, 0.5)',
                            lineHeight: 1.5,
                          }}
                        >
                          {step.description && <p style={{ margin: '2px 0 6px 0' }}>{step.description}</p>}
                          {step.toolCalls && step.toolCalls.length > 0 && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                              {step.toolCalls.map((tc, idx) => (
                                <span
                                  key={idx}
                                  style={{
                                    fontFamily: 'monospace',
                                    fontSize: 11,
                                    padding: '1px 6px',
                                    borderRadius: 4,
                                    background: 'rgba(255, 255, 255, 0.06)',
                                    color: 'rgba(255, 255, 255, 0.7)',
                                  }}
                                >
                                  {tc}
                                </span>
                              ))}
                            </div>
                          )}
                          {step.error && (
                            <div style={{ marginTop: 4, color: '#ef4444', fontSize: 11.5 }}>
                              {step.error}
                            </div>
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default MissionTimelineComponent;
