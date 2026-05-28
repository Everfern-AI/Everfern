'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronUpIcon,
} from '@heroicons/react/24/outline';
import { Loader } from '@/components/ui/animated-loading-svg-text-shimmer';
import type { DebateDisplayData } from '../types/debate-types';

interface InlineDebateProgressProps {
  debate: DebateDisplayData | null;
  isDebating: boolean;
  onViewFullDebate?: () => void;
}

export function InlineDebateProgress({
  debate,
  isDebating,
  onViewFullDebate,
}: InlineDebateProgressProps) {
  const [phase, setPhase] = useState<'proposal' | 'review' | 'arbitration' | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (isDebating) {
      const phases: ('proposal' | 'review' | 'arbitration')[] = [
        'proposal',
        'review',
        'arbitration',
      ];
      let current = 0;

      const timer = setInterval(() => {
        setPhase(phases[current]);
        current = (current + 1) % phases.length;
      }, 2000);

      return () => clearInterval(timer);
    }
  }, [isDebating]);

  // Auto-expand when debate completes
  useEffect(() => {
    if (debate && !isDebating) {
      setExpanded(true);
    }
  }, [debate, isDebating]);

  if (!debate && !isDebating) return null;

  const phaseInfo = {
    proposal: {
      label: '🚀 Vanguard',
      description: 'Proposing execution plan',
      icon: '🚀',
    },
    review: {
      label: '👻 Phantom',
      description: 'Reviewing for risks',
      icon: '👻',
    },
    arbitration: {
      label: '⚖️ Arbiter',
      description: 'Making final decision',
      icon: '⚖️',
    },
  };

  // Status icon based on debate state
  const getStatusIcon = () => {
    if (isDebating) {
      return <Loader size={14} strokeWidth={2} className="text-purple-500" />;
    }

    if (debate?.finalPlan.goNogo === 'go') {
      return (
        <div className="w-4 h-4 rounded-full bg-[#10b981] flex items-center justify-center z-1">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6L9 17l-5-5" />
          </svg>
        </div>
      );
    }

    if (debate?.finalPlan.goNogo === 'no-go') {
      return (
        <div className="w-4 h-4 rounded-full bg-[#ef4444] flex items-center justify-center z-1">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="3">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </div>
      );
    }

    // proceed-with-caution
    return (
      <div className="w-4 h-4 rounded-full bg-[#f59e0b] flex items-center justify-center z-1">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      </div>
    );
  };

  // Get debate title
  const getDebateTitle = () => {
    if (isDebating && phase) {
      return phaseInfo[phase].label;
    }

    if (debate) {
      if (debate.finalPlan.goNogo === 'go') return 'Debate Approved';
      if (debate.finalPlan.goNogo === 'no-go') return 'Debate Rejected';
      return 'Debate Cautioned';
    }

    return 'Debate Chamber';
  };

  const hasOutput = debate && !isDebating;

  // Truncate explanation if too long
  const truncateText = (text: string, maxLength: number = 200) => {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  };

  return (
    <div className="flex flex-col relative">
      {/* Main row with status icon and content */}
      <div className="flex items-center gap-3 relative">
        {/* Status Icon - positioned to align with timeline branch at left-[7px] */}
        <div className="flex items-center justify-center w-4 h-4 shrink-0 relative z-1">
          {getStatusIcon()}
        </div>

        {/* Content Container */}
        <div
          onClick={() => hasOutput && setExpanded(!expanded)}
          className={`flex-1 flex items-center gap-2 overflow-hidden ${hasOutput ? 'cursor-pointer' : 'cursor-default'}`}
        >
          {/* Title and Phase Info */}
          {!isDebating && <span className="text-[13px]">⚖️</span>}
          <div className="flex-1 flex items-center justify-between overflow-hidden">
            <span
              className={`text-[15px] overflow-hidden text-ellipsis whitespace-nowrap font-normal tracking-[-0.01em] ${
                isDebating ? 'text-[#888888]' : 'text-[#111111]'
              }`}
              style={{ fontFamily: "'Matter', sans-serif" }}
            >
              {getDebateTitle()}
            </span>

            {/* Phase indicator when debating */}
            {isDebating && phase && (
              <span className="text-[13px] text-[#888888] font-normal ml-auto shrink-0 pr-1">
                {phaseInfo[phase].description}
              </span>
            )}
          </div>

          {/* Chevron for completed debates */}
          {hasOutput && (
            <motion.span
              animate={{ rotate: expanded ? 0 : 90 }}
              className="flex shrink-0 text-[#9ca3af]"
            >
              <ChevronUpIcon width={14} height={14} strokeWidth={2.5} />
            </motion.span>
          )}
        </div>
      </div>

      {/* Expanded Content */}
      <AnimatePresence>
        {expanded && debate && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="overflow-hidden mt-2"
          >
            <div className="bg-white border border-[#e5e7eb] rounded-md p-3 flex flex-col gap-2">
              {/* Explanation - truncated and better formatted */}
              <div className="px-2 py-1.5 rounded-md text-[12px] leading-[1.5] bg-[#f9fafb] text-[#4b5563] border border-[#f3f4f6]">
                <p className="whitespace-pre-wrap wrap-break-word">
                  {truncateText(debate.finalPlan.explanation, 250)}
                </p>
              </div>

              {/* Stats Grid - Compact */}
              <div className="grid grid-cols-3 gap-1.5">
                <div className="bg-[#f9fafb] border border-[#e5e7eb] rounded-md px-2 py-1.5">
                  <p className="text-[9px] font-semibold text-[#9ca3af] uppercase tracking-wider mb-0.5">
                    Steps
                  </p>
                  <p className="text-[13px] font-bold text-[#111827]">
                    {debate.proposal.stepCount}
                  </p>
                </div>
                <div className="bg-[#f9fafb] border border-[#e5e7eb] rounded-md px-2 py-1.5">
                  <p className="text-[9px] font-semibold text-[#9ca3af] uppercase tracking-wider mb-0.5">
                    Concerns
                  </p>
                  <p className="text-[13px] font-bold text-[#111827]">
                    {debate.review.concernCount}
                  </p>
                </div>
                <div className="bg-[#f9fafb] border border-[#e5e7eb] rounded-md px-2 py-1.5">
                  <p className="text-[9px] font-semibold text-[#9ca3af] uppercase tracking-wider mb-0.5">
                    Risk
                  </p>
                  <p
                    className={`text-[13px] font-bold capitalize ${
                      debate.finalPlan.riskAssessment === 'low'
                        ? 'text-green-600'
                        : debate.finalPlan.riskAssessment === 'medium'
                        ? 'text-yellow-600'
                        : 'text-red-600'
                    }`}
                  >
                    {debate.finalPlan.riskAssessment}
                  </p>
                </div>
              </div>

              {/* View Full Debate Button */}
              {onViewFullDebate && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onViewFullDebate();
                  }}
                  className="text-[11px] font-semibold text-[#6366f1] hover:text-[#4f46e5] transition-colors text-left mt-0.5"
                >
                  View Full Debate →
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
