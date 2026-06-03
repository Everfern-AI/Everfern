'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Eye, FileText, Code, CheckCircle, TestTube, X, Clock, Zap, AlertCircle
} from 'lucide-react';
import { SubagentPhase } from '../app/chat/components/SubagentPanel';

// Theme tokens mirroring SubagentPanel
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
  purple: '#8b5cf6',
  purpleFaint: 'rgba(139,92,246,0.08)',
  r8: 8,
  r12: 12,
  sans: '"Geist", "DM Sans", ui-sans-serif, system-ui, sans-serif',
  mono: '"Geist Mono", ui-monospace, monospace',
};

const STANDARD_SUBAGENTS = [
  { agent: 'exploration_agent', label: 'Exploration', icon: Eye, color: T.blue, bgFaint: T.blueFaint, desc: 'Scans the codebase for architecture, files, and templates.' },
  { agent: 'planning_agent', label: 'Planning', icon: FileText, color: T.purple, bgFaint: T.purpleFaint, desc: 'Constructs the technical implementation plan.' },
  { agent: 'worker_agent', label: 'Worker', icon: Code, color: T.green, bgFaint: T.greenFaint, desc: 'Writes the code, applies patches, and creates files.' },
  { agent: 'code_reviewer_agent', label: 'Reviewer', icon: CheckCircle, color: T.yellow, bgFaint: T.yellowFaint, desc: 'Validates code quality, security standards, and performance.' },
  { agent: 'test_runner_agent', label: 'Tester', icon: TestTube, color: '#ec4899', bgFaint: 'rgba(236,72,153,0.08)', desc: 'Executes test suites and measures coverage.' },
];

interface SubagentPillsProps {
  phases: SubagentPhase[];
  isActive: boolean;
}

export function SubagentPills({ phases = [], isActive }: SubagentPillsProps) {
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);

  // Auto-select the currently running subagent phase when it starts
  useEffect(() => {
    const runningPhase = phases.find(p => p.status === 'in-progress');
    if (runningPhase) {
      setSelectedAgent(runningPhase.agent);
    }
  }, [phases]);

  // If there are no phases yet and not active, don't render anything
  if (phases.length === 0 && !isActive) return null;

  const handlePillClick = (agent: string) => {
    if (selectedAgent === agent) {
      setSelectedAgent(null); // Toggle close
    } else {
      setSelectedAgent(agent);
    }
  };

  // Find the selected phase details if available
  const selectedPhase = [...phases].reverse().find(p => p.agent === selectedAgent);
  const selectedMeta = STANDARD_SUBAGENTS.find(sa => sa.agent === selectedAgent);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', padding: '8px 16px 4px', gap: 8, fontFamily: T.sans }}>
      {/* Details Container */}
      <AnimatePresence>
        {selectedAgent && selectedMeta && (
          <motion.div
            initial={{ opacity: 0, height: 0, y: 10 }}
            animate={{ opacity: 1, height: 'auto', y: 0 }}
            exit={{ opacity: 0, height: 0, y: 10 }}
            transition={{ type: 'spring', stiffness: 300, damping: 26 }}
            style={{
              overflow: 'hidden',
              backgroundColor: '#ffffff',
              border: `1px solid ${T.border}`,
              borderRadius: T.r12,
              boxShadow: '0 4px 20px rgba(0,0,0,0.05)',
              position: 'relative',
              display: 'flex',
              flexDirection: 'column',
              zIndex: 10
            }}
          >
            {/* Detail Header */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 16px',
              borderBottom: `1px solid ${T.border}`,
              background: '#fafafa'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{
                  width: 26,
                  height: 26,
                  borderRadius: 6,
                  backgroundColor: selectedMeta.bgFaint,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: selectedMeta.color
                }}>
                  <selectedMeta.icon size={15} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontSize: 13, fontWeight: 650, color: T.text }}>{selectedMeta.label} Agent</span>
                  <span style={{ fontSize: 11, color: T.textSecondary }}>{selectedMeta.desc}</span>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {/* Status Badge */}
                {(() => {
                  const status = selectedPhase?.status || 'pending';
                  const badgeConfig = {
                    pending: { bg: T.surfaceRaised, color: T.textMuted, label: 'Pending', icon: Clock },
                    'in-progress': { bg: T.blueFaint, color: T.blue, label: 'Running', icon: Zap },
                    completed: { bg: T.greenFaint, color: T.green, label: 'Completed', icon: CheckCircle },
                    failed: { bg: T.redFaint, color: T.red, label: 'Failed', icon: AlertCircle },
                  }[status];
                  
                  const Icon = badgeConfig.icon;
                  return (
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: '3px 8px',
                      borderRadius: 6,
                      background: badgeConfig.bg,
                      color: badgeConfig.color,
                      fontSize: 10.5,
                      fontWeight: 600,
                    }}>
                      <Icon size={12} className={status === 'in-progress' ? 'animate-pulse' : ''} />
                      {badgeConfig.label}
                    </div>
                  );
                })()}

                {/* Close Button */}
                <button
                  onClick={() => setSelectedAgent(null)}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: T.textMuted,
                    padding: 4,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: 4,
                    transition: 'background-color 0.2s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.backgroundColor = T.surfaceRaised}
                  onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                >
                  <X size={14} />
                </button>
              </div>
            </div>

            {/* Detail Body */}
            <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 180, overflowY: 'auto' }}>
              {selectedPhase ? (
                <>
                  {selectedPhase.description && (
                    <div style={{ fontSize: 12, fontWeight: 500, color: T.textSecondary }}>
                      {selectedPhase.description}
                    </div>
                  )}

                  {selectedPhase.output ? (
                    <div style={{
                      fontFamily: T.mono,
                      fontSize: 11.5,
                      color: '#475569',
                      backgroundColor: T.surfaceRaised,
                      border: '1px solid rgba(0,0,0,0.03)',
                      borderRadius: 6,
                      padding: '10px 12px',
                      lineHeight: 1.5,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-all',
                    }}>
                      {selectedPhase.output}
                    </div>
                  ) : (
                    <div style={{ fontSize: 11.5, fontStyle: 'italic', color: T.textMuted, padding: '4px 0' }}>
                      {selectedPhase.status === 'in-progress' ? 'Agent starting up... logs will stream here.' : 'No output available.'}
                    </div>
                  )}

                  {selectedPhase.metrics && Object.keys(selectedPhase.metrics).length > 0 && (
                    <div style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: 12,
                      marginTop: 4,
                      paddingTop: 8,
                      borderTop: `1px solid ${T.border}`
                    }}>
                      {Object.entries(selectedPhase.metrics).map(([key, val]) => (
                        <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                          <span style={{ fontSize: 9.5, textTransform: 'uppercase', color: T.textMuted, fontWeight: 600 }}>{key.replace(/_/g, ' ')}</span>
                          <span style={{ fontSize: 11, fontWeight: 500, color: T.textSecondary }}>{String(val)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <div style={{ fontSize: 12, fontStyle: 'italic', color: T.textMuted, padding: '10px 0', textAlign: 'center' }}>
                  This subagent is currently waiting in the execution queue.
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Pills Container */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        overflowX: 'auto',
        padding: '2px 0 6px',
        scrollbarWidth: 'none', // Hide scrollbar for standard browsers
      }}>
        {STANDARD_SUBAGENTS.map((item) => {
          const matchedPhase = [...phases].reverse().find(p => p.agent === item.agent);
          const status = matchedPhase?.status || 'pending';
          const isSelected = selectedAgent === item.agent;

          // Determine Pill Colors & Shadows
          const isRunning = status === 'in-progress';
          const isDone = status === 'completed';
          const isFailed = status === 'failed';

          let borderStyle = `1px solid ${T.border}`;
          let bgStyle = T.surface;
          let textColor = T.textSecondary;
          let iconColor = T.textMuted;

          if (isRunning) {
            borderStyle = `1px solid ${item.color}`;
            bgStyle = item.bgFaint;
            textColor = T.text;
            iconColor = item.color;
          } else if (isDone) {
            borderStyle = `1px solid ${T.border}`;
            bgStyle = '#fcfcfa';
            textColor = T.textMuted;
            iconColor = T.green;
          } else if (isFailed) {
            borderStyle = `1px solid ${T.red}`;
            bgStyle = T.redFaint;
            textColor = T.red;
            iconColor = T.red;
          } else if (isSelected) {
            borderStyle = `1px solid ${T.text}`;
            bgStyle = T.surfaceRaised;
            textColor = T.text;
            iconColor = T.text;
          }

          return (
            <motion.button
              key={item.agent}
              onClick={() => handlePillClick(item.agent)}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 12px 6px 8px',
                borderRadius: 12,
                border: borderStyle,
                background: bgStyle,
                color: textColor,
                fontSize: 11.5,
                fontWeight: isRunning || isSelected ? 600 : 500,
                cursor: 'pointer',
                flexShrink: 0,
                boxShadow: isRunning ? `inset 0 1px 0 rgba(255,255,255,0.8), 0 2px 8px ${item.bgFaint}` : '0 1px 2px rgba(0,0,0,0.02)',
                transition: 'all 0.2s ease',
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              {/* Icon Container */}
              <div style={{ display: 'flex', alignItems: 'center', color: iconColor }}>
                <item.icon size={13} />
              </div>

              <span>{item.label}</span>

              {/* Status Indicator inside Pill */}
              {isRunning && (
                <motion.span
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: '50%',
                    background: item.color,
                    flexShrink: 0,
                  }}
                  animate={{ opacity: [1, 0.3, 1] }}
                  transition={{ repeat: Infinity, duration: 1.2 }}
                />
              )}

              {isDone && (
                <CheckCircle size={10.5} style={{ color: T.green, flexShrink: 0 }} />
              )}

              {isFailed && (
                <AlertCircle size={10.5} style={{ color: T.red, flexShrink: 0 }} />
              )}

              {/* Live shimmer overlay on running pill */}
              {isRunning && (
                <motion.div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.4) 50%, transparent 100%)',
                    pointerEvents: 'none',
                  }}
                  animate={{ x: ['-100%', '100%'] }}
                  transition={{ repeat: Infinity, duration: 1.8, ease: 'linear' }}
                />
              )}
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
