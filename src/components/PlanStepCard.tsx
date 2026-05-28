'use client';
import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckIcon, ChevronDownIcon, PlayIcon, DocumentTextIcon } from '@heroicons/react/24/outline';
import { CheckCircleIcon } from '@heroicons/react/24/solid';

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

/**
 * Clean plan step card - shows task at top, divider, and steps below
 * Style matches the reference image with simple vertical step list
 */
export default function PlanViewer({ taskTitle, steps, isOpen, onApprove, onClose, onEdit }: PlanViewerProps) {
  const [expanded, setExpanded] = useState(true);

  if (!isOpen) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      style={{
        marginBottom: 16,
        backgroundColor: '#ffffff',
        border: '1px solid #e8e6d9',
        borderRadius: 20,
        overflow: 'hidden',
        boxShadow: '0 4px 12px rgba(0,0,0,0.04)',
      }}
    >
      {/* Header with task title and expand/collapse */}
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          padding: '16px 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
          borderBottom: expanded ? '1px solid #e8e6d9' : 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            backgroundColor: 'rgba(251, 191, 36, 0.12)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <DocumentTextIcon width={18} height={18} color="#fbbf24" />
          </div>
          <span style={{ fontSize: 15, fontWeight: 600, color: '#201e24' }}>
            {taskTitle}
          </span>
        </div>
        <ChevronDownIcon
          width={16}
          height={16}
          color="#8a8886"
          style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: '0.2s' }}
        />
      </div>

      {/* Steps section - collapsible */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            style={{ overflow: 'hidden' }}
          >
            {/* Divider line with task name */}
            <div style={{
              padding: '12px 20px 8px',
              borderBottom: '1px solid #f0ede6',
            }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 12,
                color: '#a1a1aa',
              }}>
                <span style={{ fontWeight: 500 }}>Plan</span>
                <span style={{ color: '#e8e6d9' }}>—</span>
                <span style={{ fontWeight: 400 }}>{steps.length} steps</span>
              </div>
            </div>

            {/* Steps list */}
            <div style={{ padding: '12px 20px 16px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {steps.map((step, index) => {
                  const isDone = step.status === 'done';
                  const isInProgress = step.status === 'in_progress';

                  return (
                    <div key={step.id} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      {isDone ? (
                        <div style={{
                          width: 22,
                          height: 22,
                          borderRadius: 11,
                          backgroundColor: '#f0fdf4',
                          border: '1.5px solid #bbf7d0',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                        }}>
                          <CheckIcon width={12} height={12} color="#16a34a" strokeWidth={3} />
                        </div>
                      ) : isInProgress ? (
                        <div style={{
                          width: 22,
                          height: 22,
                          borderRadius: 11,
                          border: '2px solid #fbbf24',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                        }}>
                          <span style={{ fontSize: 11, color: '#fbbf24', fontWeight: 700 }}>{index + 1}</span>
                        </div>
                      ) : (
                        <div style={{
                          width: 22,
                          height: 22,
                          borderRadius: 11,
                          backgroundColor: '#f4f4f4',
                          border: '1px solid #e8e6d9',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                        }}>
                          <span style={{ fontSize: 11, color: '#8a8886', fontWeight: 500 }}>{index + 1}</span>
                        </div>
                      )}
                      <span style={{
                        fontSize: 14,
                        fontWeight: isInProgress ? 500 : 400,
                        color: isDone ? '#8a8886' : isInProgress ? '#201e24' : '#6b7280',
                        textDecoration: isDone ? 'line-through' : 'none',
                      }}>
                        {step.description}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Action buttons */}
            <div style={{
              padding: '12px 20px 16px',
              display: 'flex',
              gap: 10,
              borderTop: '1px solid #f0ede6',
            }}>
              {onEdit && (
                <button
                  onClick={onEdit}
                  style={{
                    flex: 1,
                    padding: '10px 16px',
                    borderRadius: 12,
                    border: '1px solid #e8e6d9',
                    backgroundColor: 'transparent',
                    color: '#6b7280',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.backgroundColor = '#fafaf9';
                    e.currentTarget.style.color = '#201e24';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                    e.currentTarget.style.color = '#6b7280';
                  }}
                >
                  Edit Plan
                </button>
              )}
              <button
                onClick={onApprove}
                style={{
                  flex: 2,
                  padding: '10px 20px',
                  borderRadius: 12,
                  border: 'none',
                  backgroundColor: '#16a34a',
                  color: '#ffffff',
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  transition: 'all 0.2s',
                  boxShadow: '0 2px 8px rgba(22, 163, 74, 0.2)',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.transform = 'translateY(-1px)';
                  e.currentTarget.style.boxShadow = '0 4px 12px rgba(22, 163, 74, 0.3)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 2px 8px rgba(22, 163, 74, 0.2)';
                }}
              >
                <PlayIcon width={16} height={16} />
                Approve & Execute
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/**
 * Inline plan step indicator - for embedding in chat stream
 * Shows as a compact horizontal step progress
 */
export function InlinePlanSteps({ steps }: { steps: PlanStep[] }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '8px 12px',
      backgroundColor: '#fafaf9',
      borderRadius: 12,
      overflowX: 'auto',
    }}>
      {steps.map((step, index) => {
        const isDone = step.status === 'done';
        const isInProgress = step.status === 'in_progress';

        return (
          <React.Fragment key={step.id}>
            {index > 0 && (
              <div style={{
                width: 20,
                height: 1,
                backgroundColor: isDone ? '#bbf7d0' : '#e8e6d9',
                flexShrink: 0,
              }} />
            )}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              flexShrink: 0,
            }}>
              {isDone ? (
                <CheckCircleIcon width={14} height={14} color="#16a34a" />
              ) : isInProgress ? (
                <div style={{
                  width: 14,
                  height: 14,
                  borderRadius: 7,
                  border: '2px solid #fbbf24',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  <div style={{
                    width: 6,
                    height: 6,
                    borderRadius: 3,
                    backgroundColor: '#fbbf24',
                  }} />
                </div>
              ) : (
                <div style={{
                  width: 14,
                  height: 14,
                  borderRadius: 7,
                  backgroundColor: '#f4f4f4',
                  border: '1px solid #e8e6d9',
                }} />
              )}
              <span style={{
                fontSize: 12,
                fontWeight: isInProgress ? 600 : 400,
                color: isDone ? '#8a8886' : isInProgress ? '#201e24' : '#a1a1aa',
              }}>
                {step.description.length > 20 ? step.description.substring(0, 20) + '...' : step.description}
              </span>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}
