'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Eye, FileText, Code, CheckCircle, TestTube, X, Clock, Zap, AlertCircle
} from 'lucide-react';
import { SubagentPhase } from '@/app/chat/components/SubagentPanel';

const STANDARD_SUBAGENTS = [
  { agent: 'coding-specialist', label: 'Coding', icon: Code, desc: 'Implements delegated code changes.' },
  { agent: 'web-explorer', label: 'Web', icon: Eye, desc: 'Browses pages and extracts live data.' },
  { agent: 'data-analyst', label: 'Data', icon: FileText, desc: 'Analyzes structured datasets.' },
  { agent: 'generic', label: 'Subagent', icon: Zap, desc: 'Handles parallel background work.' },
  { agent: 'exploration_agent', label: 'Exploration', icon: Eye, desc: 'Scans codebase architecture.' },
  { agent: 'planning_agent', label: 'Planning', icon: FileText, desc: 'Constructs implementation plan.' },
  { agent: 'worker_agent', label: 'Worker', icon: Code, desc: 'Applies patches and creates files.' },
  { agent: 'code_reviewer_agent', label: 'Reviewer', icon: CheckCircle, desc: 'Validates code quality.' },
  { agent: 'test_runner_agent', label: 'Tester', icon: TestTube, desc: 'Executes test suites.' },
];

interface SubagentPillsProps {
  phases: SubagentPhase[];
  isActive: boolean;
}

export function SubagentPills({ phases = [], isActive }: SubagentPillsProps) {
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);

  useEffect(() => {
    const runningPhase = phases.find(p => p.status === 'in-progress');
    if (runningPhase) {
      setSelectedAgent(runningPhase.agent);
    }
  }, [phases]);

  if (phases.length === 0 && !isActive) return null;

  const handlePillClick = (agent: string) => {
    if (selectedAgent === agent) {
      setSelectedAgent(null);
    } else {
      setSelectedAgent(agent);
    }
  };

  const selectedPhase = [...phases].reverse().find(p => p.agent === selectedAgent);
  const selectedMeta = STANDARD_SUBAGENTS.find(sa => sa.agent === selectedAgent);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', padding: '4px 0', gap: 6 }}>
      {/* Expanded Details Pane */}
      <AnimatePresence>
        {selectedAgent && selectedMeta && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            style={{
              overflow: 'hidden',
              backgroundColor: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: 10,
              backdropFilter: 'blur(8px)',
              position: 'relative',
              display: 'flex',
              flexDirection: 'column',
              marginBottom: 4,
            }}
          >
            {/* Header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 14px',
                borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <selectedMeta.icon size={14} style={{ color: 'rgba(255, 255, 255, 0.6)' }} />
                <span style={{ fontSize: 13, fontWeight: 500, color: 'rgba(255, 255, 255, 0.9)' }}>
                  {selectedMeta.label} Agent
                </span>
                <span style={{ fontSize: 11, color: 'rgba(255, 255, 255, 0.4)' }}>
                  {selectedMeta.desc}
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  onClick={() => setSelectedAgent(null)}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'rgba(255, 255, 255, 0.4)',
                    padding: 2,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <X size={14} />
                </button>
              </div>
            </div>

            {/* Body */}
            <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 180, overflowY: 'auto' }}>
              {selectedPhase ? (
                <>
                  {selectedPhase.description && (
                    <div style={{ fontSize: 12, color: 'rgba(255, 255, 255, 0.65)' }}>
                      {selectedPhase.description}
                    </div>
                  )}

                  {selectedPhase.output ? (
                    <div
                      style={{
                        fontFamily: 'monospace',
                        fontSize: 11,
                        color: 'rgba(255, 255, 255, 0.75)',
                        backgroundColor: 'rgba(0, 0, 0, 0.3)',
                        borderRadius: 6,
                        padding: '8px 10px',
                        lineHeight: 1.5,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-all',
                      }}
                    >
                      {selectedPhase.output}
                    </div>
                  ) : (
                    <div style={{ fontSize: 11.5, fontStyle: 'italic', color: 'rgba(255, 255, 255, 0.35)' }}>
                      {selectedPhase.status === 'in-progress' ? 'Running task...' : 'Completed.'}
                    </div>
                  )}
                </>
              ) : (
                <div style={{ fontSize: 12, fontStyle: 'italic', color: 'rgba(255, 255, 255, 0.35)' }}>
                  Subagent waiting in execution queue.
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Horizontal Pills Row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          overflowX: 'auto',
          padding: '2px 0',
          scrollbarWidth: 'none',
        }}
      >
        {STANDARD_SUBAGENTS.map((item) => {
          const matchedPhase = [...phases].reverse().find(p => p.agent === item.agent);
          const status = matchedPhase?.status || 'pending';
          const isSelected = selectedAgent === item.agent;
          const isRunning = status === 'in-progress';
          const isDone = status === 'completed';

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
                padding: '4px 10px',
                borderRadius: 6,
                border: isSelected
                  ? '1px solid rgba(255, 255, 255, 0.3)'
                  : isRunning
                  ? '1px solid rgba(255, 255, 255, 0.2)'
                  : '1px solid rgba(255, 255, 255, 0.08)',
                background: isSelected
                  ? 'rgba(255, 255, 255, 0.08)'
                  : isRunning
                  ? 'rgba(255, 255, 255, 0.05)'
                  : 'rgba(255, 255, 255, 0.02)',
                color: isSelected
                  ? 'rgba(255, 255, 255, 0.95)'
                  : isRunning
                  ? 'rgba(255, 255, 255, 0.9)'
                  : 'rgba(255, 255, 255, 0.55)',
                fontSize: 12,
                fontWeight: isRunning || isSelected ? 500 : 400,
                cursor: 'pointer',
                flexShrink: 0,
                transition: 'all 0.15s ease',
              }}
            >
              <item.icon size={13} style={{ color: isRunning ? '#3b82f6' : isDone ? '#10b981' : 'rgba(255, 255, 255, 0.4)' }} />
              <span>{item.label}</span>
              {isRunning && (
                <div style={{ width: 4, height: 4, borderRadius: '50%', background: '#3b82f6' }} />
              )}
              {isDone && (
                <CheckCircle size={11} style={{ color: '#10b981' }} />
              )}
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}

export default SubagentPills;
