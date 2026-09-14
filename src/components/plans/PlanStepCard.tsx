'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Play, FileText, Check, Pencil } from 'lucide-react';

interface PlanStep {
  id: string;
  description: string;
  tool: string;
  status?: 'done' | 'in_progress' | 'pending';
}

interface PlanViewerProps {
  taskTitle: string;
  steps: PlanStep[];
  isOpen: boolean;
  onApprove: () => void;
  onClose?: () => void;
  onEdit?: () => void;
}

export default function PlanViewer({ taskTitle, steps, isOpen, onApprove, onClose, onEdit }: PlanViewerProps) {
  const [expanded, setExpanded] = useState(true);

  if (!isOpen) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 6 }}
      transition={{ duration: 0.2 }}
      style={{
        marginBottom: 12,
        backgroundColor: 'rgba(255, 255, 255, 0.02)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: 10,
        overflow: 'hidden',
        backdropFilter: 'blur(8px)',
      }}
    >
      {/* Header with task title and expand/collapse */}
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          padding: '12px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
          borderBottom: expanded ? '1px solid rgba(255, 255, 255, 0.08)' : 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <FileText size={16} strokeWidth={1.75} style={{ color: 'rgba(255, 255, 255, 0.6)' }} />
          <span style={{ fontSize: 14, fontWeight: 500, color: 'rgba(255, 255, 255, 0.9)' }}>
            {taskTitle}
          </span>
          <span style={{ fontSize: 11.5, color: 'rgba(255, 255, 255, 0.4)' }}>
            ({steps.length} steps)
          </span>
        </div>
        <motion.div
          animate={{ rotate: expanded ? 180 : 0 }}
          transition={{ duration: 0.15 }}
          style={{ display: 'flex', color: 'rgba(255, 255, 255, 0.4)' }}
        >
          <ChevronDown size={14} strokeWidth={1.75} />
        </motion.div>
      </div>

      {/* Steps section */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{ overflow: 'hidden' }}
          >
            {/* Steps list */}
            <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 2 }}>
              {steps.map((step, index) => {
                const isDone = step.status === 'done';
                const isInProgress = step.status === 'in_progress';
                const isLast = index === steps.length - 1;

                return (
                  <React.Fragment key={step.id}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0' }}>
                      <div
                        style={{
                          width: 16,
                          height: 16,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                        }}
                      >
                        {isDone ? (
                          <Check size={13} strokeWidth={2} style={{ color: '#10b981' }} />
                        ) : isInProgress ? (
                          <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#3b82f6' }} />
                        ) : (
                          <span style={{ fontSize: 11, color: 'rgba(255, 255, 255, 0.3)', fontFamily: 'monospace' }}>
                            {index + 1}
                          </span>
                        )}
                      </div>

                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: isInProgress ? 500 : 400,
                          color: isDone ? 'rgba(255, 255, 255, 0.45)' : isInProgress ? 'rgba(255, 255, 255, 0.9)' : 'rgba(255, 255, 255, 0.65)',
                          textDecoration: isDone ? 'line-through' : 'none',
                        }}
                      >
                        {step.description}
                      </span>
                    </div>

                    {!isLast && (
                      <div
                        style={{
                          width: 1,
                          height: 6,
                          marginLeft: 7.5,
                          background: 'rgba(255, 255, 255, 0.1)',
                        }}
                      />
                    )}
                  </React.Fragment>
                );
              })}
            </div>

            {/* Action buttons */}
            <div
              style={{
                padding: '10px 16px',
                display: 'flex',
                gap: 8,
                borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                justifyContent: 'flex-end',
              }}
            >
              {onEdit && (
                <button
                  type="button"
                  onClick={onEdit}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 6,
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    backgroundColor: 'rgba(255, 255, 255, 0.03)',
                    color: 'rgba(255, 255, 255, 0.7)',
                    fontSize: 12,
                    fontWeight: 500,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <Pencil size={12} />
                  Edit Plan
                </button>
              )}
              <button
                type="button"
                onClick={onApprove}
                style={{
                  padding: '6px 14px',
                  borderRadius: 6,
                  border: 'none',
                  backgroundColor: 'rgba(255, 255, 255, 0.9)',
                  color: '#111',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <Play size={12} fill="#111" />
                Approve & Execute
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export function InlinePlanSteps({ steps }: { steps: PlanStep[] }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 10px',
        backgroundColor: 'rgba(255, 255, 255, 0.02)',
        borderRadius: 8,
        border: '1px solid rgba(255, 255, 255, 0.08)',
        overflowX: 'auto',
      }}
    >
      {steps.map((step, index) => {
        const isDone = step.status === 'done';
        const isInProgress = step.status === 'in_progress';

        return (
          <React.Fragment key={step.id}>
            {index > 0 && (
              <div
                style={{
                  width: 14,
                  height: 1,
                  backgroundColor: isDone ? 'rgba(16, 185, 129, 0.4)' : 'rgba(255, 255, 255, 0.1)',
                  flexShrink: 0,
                }}
              />
            )}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                flexShrink: 0,
              }}
            >
              {isDone ? (
                <Check size={12} strokeWidth={2} style={{ color: '#10b981' }} />
              ) : isInProgress ? (
                <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#3b82f6' }} />
              ) : (
                <div style={{ width: 4, height: 4, borderRadius: '50%', background: 'rgba(255, 255, 255, 0.2)' }} />
              )}
              <span
                style={{
                  fontSize: 12,
                  fontWeight: isInProgress ? 500 : 400,
                  color: isDone ? 'rgba(255, 255, 255, 0.45)' : isInProgress ? 'rgba(255, 255, 255, 0.9)' : 'rgba(255, 255, 255, 0.55)',
                }}
              >
                {step.description.length > 24 ? step.description.substring(0, 24) + '...' : step.description}
              </span>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}
