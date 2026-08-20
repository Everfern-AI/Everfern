'use client';

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Check, Loader2 } from 'lucide-react';
import type { MissionTimeline, MissionStep } from '@/components/MissionTimeline';

interface MissionProgressCardProps {
  timeline: MissionTimeline | null;
  isRunning: boolean;
  isExpanded: boolean;
  onToggleExpand: () => void;
}

const MissionProgressCard: React.FC<MissionProgressCardProps> = ({
  timeline,
  isRunning,
  isExpanded,
  onToggleExpand,
}) => {
  if (!timeline || !timeline.steps || timeline.steps.length === 0) {
    return null;
  }

  const completedCount = timeline.completedSteps || 0;
  const totalCount = timeline.totalSteps || 0;
  const progressPercent = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  return (
    <div
      style={{
        backgroundColor: 'rgba(255, 255, 255, 0.02)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: 10,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        backdropFilter: 'blur(8px)',
        margin: '6px 0',
      }}
    >
      {/* Header */}
      <button
        type="button"
        onClick={onToggleExpand}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 14px',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13.5, fontWeight: 500, color: 'rgba(255, 255, 255, 0.9)' }}>
            Execution Progress
          </span>
          {isRunning && (
            <span style={{ fontSize: 11, color: 'rgba(255, 255, 255, 0.45)' }}>
              ({completedCount}/{totalCount})
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <motion.div
            animate={{ rotate: isExpanded ? 180 : 0 }}
            transition={{ duration: 0.15 }}
            style={{ display: 'flex', color: 'rgba(255, 255, 255, 0.4)' }}
          >
            <ChevronDown size={14} strokeWidth={1.75} />
          </motion.div>
        </div>
      </button>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{ padding: '0 14px 12px' }}>
              {/* Progress bar */}
              <div
                style={{
                  width: '100%',
                  height: 2,
                  backgroundColor: 'rgba(255, 255, 255, 0.08)',
                  borderRadius: 1,
                  marginBottom: 10,
                  overflow: 'hidden',
                }}
              >
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${progressPercent}%` }}
                  style={{
                    height: '100%',
                    backgroundColor: 'rgba(255, 255, 255, 0.7)',
                    borderRadius: 1,
                  }}
                />
              </div>

              {/* Steps List */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 1,
                  maxHeight: 280,
                  overflowY: 'auto',
                }}
              >
                {timeline.steps.map((step, idx) => (
                  <StepItem
                    key={step.id}
                    step={step}
                    index={idx + 1}
                    isLast={idx === timeline.steps.length - 1}
                  />
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const StepItem: React.FC<{ step: MissionStep; index: number; isLast: boolean }> = ({ step, index, isLast }) => {
  const isCompleted = step.status === 'completed';
  const isInProgress = step.status === 'in-progress';
  const isPending = step.status === 'pending' || step.status === 'skipped';

  const formatIndex = (n: number) => n.toString().padStart(2, '0');

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '5px 0',
        opacity: isPending ? 0.45 : 1,
      }}
    >
      <div
        style={{
          width: 16,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {isCompleted ? (
          <Check size={13} strokeWidth={2} style={{ color: '#10b981' }} />
        ) : isInProgress ? (
          <Loader2 size={13} strokeWidth={1.75} className="animate-spin" style={{ color: 'rgba(255, 255, 255, 0.8)' }} />
        ) : (
          <span
            style={{
              fontSize: 10.5,
              fontWeight: 500,
              color: 'rgba(255, 255, 255, 0.3)',
              fontFamily: 'monospace',
            }}
          >
            {formatIndex(index)}
          </span>
        )}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: isInProgress ? 500 : 400,
            color: isCompleted ? 'rgba(255, 255, 255, 0.55)' : isInProgress ? 'rgba(255, 255, 255, 0.92)' : 'rgba(255, 255, 255, 0.45)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {step.name}
        </div>
      </div>
    </div>
  );
};

export default MissionProgressCard;
