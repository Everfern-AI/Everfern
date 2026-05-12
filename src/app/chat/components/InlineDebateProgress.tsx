/**
 * EverFern Desktop — Inline Debate Progress
 *
 * Shows debate progress inline within the chat message stream.
 * Provides quick access to full debate chamber.
 */

'use client';

import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  SparklesIcon,
  ChevronRightIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
} from '@heroicons/react/24/outline';
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

  if (!debate && !isDebating) return null;

  const phaseInfo = {
    proposal: {
      label: '🚀 Vanguard: Proposing',
      description: 'Generating execution plan',
      icon: '🚀',
    },
    review: {
      label: '👻 Phantom: Reviewing',
      description: 'Analyzing for risks',
      icon: '👻',
    },
    arbitration: {
      label: '⚖️ Arbiter: Deciding',
      description: 'Making final call',
      icon: '⚖️',
    },
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-4 rounded-xl border border-[#e8e6d9] bg-[#faf9f7] shadow-sm overflow-hidden"
    >
      {isDebating && phase ? (
        <div className="flex items-center justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-2.5 mb-2.5">
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
                className="flex items-center justify-center w-6 h-6 rounded-full bg-indigo-50 border border-indigo-100"
              >
                <SparklesIcon className="w-3.5 h-3.5 text-indigo-600" />
              </motion.div>
              <p className="font-semibold text-[#201e24] text-[13.5px] tracking-tight">
                {phaseInfo[phase].label}
              </p>
            </div>
            <p className="text-[12.5px] text-[#8a8886] leading-relaxed ml-8.5">
              {phaseInfo[phase].description}
            </p>

            {/* Progress dots */}
            <div className="flex gap-1.5 mt-3.5 ml-8.5">
              {['proposal', 'review', 'arbitration'].map((p) => (
                <motion.div
                  key={p}
                  className={`h-1.5 rounded-full transition-all duration-300 ${
                    p === phase
                      ? 'w-6 bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.3)]'
                      : 'w-1.5 bg-[#e8e6d9]'
                  }`}
                  animate={p === phase ? {
                    opacity: [0.7, 1, 0.7],
                  } : {}}
                  transition={{ duration: 1.5, repeat: Infinity }}
                />
              ))}
            </div>
          </div>

          {/* View button */}
          {onViewFullDebate && (
            <button
              onClick={onViewFullDebate}
              className="px-3.5 py-1.5 bg-white border border-[#e8e6d9] hover:bg-[#f3f2ee] text-[#4a4846] rounded-lg font-semibold text-[12px] transition-all shadow-sm flex items-center gap-1.5"
            >
              <span>Arena</span>
              <ChevronRightIcon className="w-3 h-3 text-[#8a8886]" />
            </button>
          )}
        </div>
      ) : debate ? (
        <div className="space-y-3.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              {debate.finalPlan.goNogo === 'go' && (
                <div className="w-6 h-6 rounded-full bg-green-50 border border-green-100 flex items-center justify-center">
                  <CheckCircleIcon className="w-4 h-4 text-green-600" />
                </div>
              )}
              {debate.finalPlan.goNogo === 'proceed-with-caution' && (
                <div className="w-6 h-6 rounded-full bg-yellow-50 border border-yellow-100 flex items-center justify-center">
                  <ExclamationCircleIcon className="w-4 h-4 text-yellow-600" />
                </div>
              )}
              {debate.finalPlan.goNogo === 'no-go' && (
                <div className="w-6 h-6 rounded-full bg-red-50 border border-red-100 flex items-center justify-center">
                  <ExclamationCircleIcon className="w-4 h-4 text-red-600" />
                </div>
              )}
              <p className="font-bold text-[#201e24] text-[13.5px] tracking-tight">
                Debate {debate.finalPlan.goNogo === 'go' ? 'Approved' : debate.finalPlan.goNogo === 'no-go' ? 'Rejected' : 'Cautioned'}
              </p>
            </div>
            
            {onViewFullDebate && (
              <button
                onClick={onViewFullDebate}
                className="text-[11px] font-bold text-indigo-600 hover:text-indigo-700 uppercase tracking-wider"
              >
                Full Record
              </button>
            )}
          </div>

          <p className="text-[12.5px] text-[#4a4846] leading-relaxed bg-white/50 p-2.5 rounded-lg border border-[#e8e6d9]/50">
            {debate.finalPlan.explanation}
          </p>

          {/* Summary stats */}
          <div className="grid grid-cols-3 gap-2 mt-1">
            <div className="bg-white border border-[#e8e6d9] rounded-lg p-2.5 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
              <p className="text-[10px] font-bold text-[#8a8886] uppercase tracking-widest mb-0.5">Steps</p>
              <p className="text-[14px] font-bold text-[#201e24]">
                {debate.proposal.stepCount}
              </p>
            </div>
            <div className="bg-white border border-[#e8e6d9] rounded-lg p-2.5 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
              <p className="text-[10px] font-bold text-[#8a8886] uppercase tracking-widest mb-0.5">Concerns</p>
              <p className="text-[14px] font-bold text-[#201e24]">
                {debate.review.concernCount}
              </p>
            </div>
            <div className="bg-white border border-[#e8e6d9] rounded-lg p-2.5 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
              <p className="text-[10px] font-bold text-[#8a8886] uppercase tracking-widest mb-0.5">Risk</p>
              <p className={`text-[14px] font-bold ${
                debate.finalPlan.riskAssessment === 'low' ? 'text-green-600' : 
                debate.finalPlan.riskAssessment === 'medium' ? 'text-yellow-600' : 'text-red-600'
              } capitalize`}>
                {debate.finalPlan.riskAssessment}
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </motion.div>
  );
}
