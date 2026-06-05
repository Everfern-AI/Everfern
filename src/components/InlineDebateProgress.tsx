'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronDownIcon,
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
  const [showFullPlan, setShowFullPlan] = useState(false);

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
        <div className="w-5 h-5 rounded-full bg-[#10b981] flex items-center justify-center z-1">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6L9 17l-5-5" />
          </svg>
        </div>
      );
    }

    if (debate?.finalPlan.goNogo === 'no-go') {
      return (
        <div className="w-5 h-5 rounded-full bg-[#ef4444] flex items-center justify-center z-1">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="3">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </div>
      );
    }

    // proceed-with-caution
    return (
      <div className="w-5 h-5 rounded-full bg-[#f59e0b] flex items-center justify-center z-1">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
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

  const canExpand = !!(debate || isDebating);

  const getActivePhase = (): 'vanguard' | 'phantom' | 'arbiter' | 'done' => {
    if (!isDebating) return 'done';
    if (!debate || !debate.proposal || !debate.proposal.id) return 'vanguard';
    if (!debate.review || !debate.review.id) return 'phantom';
    if (!debate.finalPlan || !debate.finalPlan.id) return 'arbiter';
    return 'done';
  };

  // Truncate explanation if too long
  const truncateText = (text: string, maxLength: number = 200) => {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  };

  return (
    <div className="flex flex-col relative w-full">
      {/* Main row with status icon and content */}
      <div className="flex items-center gap-[10px] py-[6px] relative w-full">
        {/* Status Icon - positioned to align with timeline branch at left-[6px] */}
        <div className="flex items-center justify-center w-5 h-5 shrink-0 relative z-1">
          {getStatusIcon()}
        </div>

        {/* Content Container */}
        <div
          onClick={() => canExpand && setExpanded(!expanded)}
          className={`flex-1 flex items-center gap-2 overflow-hidden ${canExpand ? 'cursor-pointer' : 'cursor-default'}`}
        >
          {/* Title and Phase Info */}
          {!isDebating && <span className="text-[13px]">⚖️</span>}
          <div className="flex-1 flex items-center justify-between overflow-hidden">
            <span
              className={`text-[13px] overflow-hidden text-ellipsis whitespace-nowrap font-semibold tracking-[-0.01em] ${
                isDebating ? 'text-[#111827] dark:text-zinc-100' : 'text-zinc-500 dark:text-zinc-400'
              }`}
              style={{ fontFamily: "'Matter', sans-serif" }}
            >
              {getDebateTitle()}
            </span>

            {/* Phase indicator when debating */}
            {isDebating && phase && (
              <span className="text-[12px] text-zinc-400 dark:text-zinc-500 font-normal ml-auto shrink-0 pr-1">
                {phaseInfo[phase].description}
              </span>
            )}
          </div>

          {/* Chevron for debates */}
          {canExpand && (
            <motion.span
              animate={{ rotate: expanded ? 180 : 0 }}
              className="flex shrink-0 text-[#9ca3af] dark:text-zinc-500"
            >
              <ChevronDownIcon width={14} height={14} strokeWidth={2} />
            </motion.span>
          )}
        </div>
      </div>

      {/* Expanded Content */}
      <AnimatePresence>
        {expanded && (debate || isDebating) && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="overflow-hidden w-full"
          >
            <div className="pl-6 pb-2.5 ml-[9px] border-l border-zinc-200/80 dark:border-zinc-800" style={{ paddingRight: '24px' }}>
              {isDebating ? (
                <div className="bg-[#fcfcfd] border border-zinc-200/80 rounded-lg flex flex-col gap-4 shadow-sm text-zinc-800 dark:bg-zinc-900/30 dark:border-zinc-800 dark:text-zinc-200 w-full max-w-full" style={{ padding: '20px', marginLeft: '8px', marginRight: '8px' }}>
                  <div className="flex items-center justify-between border-b border-zinc-100 pb-2 dark:border-zinc-800">
                    <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">
                      Live Debate Chamber Feed
                    </span>
                    <span className="flex items-center text-[13px] text-zinc-600 font-semibold bg-zinc-100 rounded-full dark:bg-zinc-800 dark:text-zinc-300" style={{ gap: '8px', paddingLeft: '12px', paddingRight: '14px', paddingTop: '6px', paddingBottom: '6px' }}>
                      <span className="w-2 h-2 rounded-full bg-zinc-500 animate-ping" />
                      Active Debate
                    </span>
                  </div>

                  {/* Vanguard Stage */}
                  <div className="flex gap-3 text-[13px] w-full" style={{ paddingLeft: '4px', paddingRight: '4px' }}>
                    <div className="flex flex-col items-center shrink-0">
                      {debate?.proposal?.id ? (
                        <div className="w-5 h-5 rounded-full bg-emerald-500 text-white flex items-center justify-center font-bold text-[10px]">✓</div>
                      ) : getActivePhase() === 'vanguard' ? (
                        <div className="w-5 h-5 rounded-full border-2 border-zinc-400 border-t-transparent animate-spin" />
                      ) : (
                        <div className="w-5 h-5 rounded-full bg-zinc-150 text-zinc-400 flex items-center justify-center font-bold text-[10px] dark:bg-zinc-800">1</div>
                      )}
                      <div className="w-0.5 flex-1 bg-zinc-200/80 my-1 min-h-[16px] dark:bg-zinc-800" />
                    </div>
                    <div className="flex-1 min-w-0" style={{ paddingRight: '8px' }}>
                      <div className="flex items-center gap-2 font-semibold text-zinc-900 dark:text-zinc-100">
                        <span>Vanguard Agent</span>
                        <span className="text-[10px] text-zinc-400 font-normal bg-zinc-100 rounded dark:bg-zinc-850" style={{ paddingLeft: '8px', paddingRight: '8px', paddingTop: '3px', paddingBottom: '3px' }}>Planner</span>
                      </div>
                      {debate?.proposal?.id ? (
                        <div className="mt-1 bg-zinc-50 border border-zinc-150 rounded text-[12px] text-zinc-600 dark:bg-zinc-800/40 dark:border-zinc-800/60 dark:text-zinc-300 w-full" style={{ padding: '12px', marginRight: '8px' }}>
                          <p className="font-semibold text-zinc-800 dark:text-zinc-200 mb-0.5">Proposed Plan:</p>
                          <p className="italic mb-1 text-zinc-700 dark:text-zinc-300 break-words">"{debate.proposal.approach}"</p>
                          <div className="text-[11px] text-zinc-400 font-medium mt-1">
                            Steps: {debate.proposal.stepCount} | Estimated: {Math.round(debate.proposal.estimatedTimeMs / 1000)}s
                          </div>
                        </div>
                      ) : getActivePhase() === 'vanguard' ? (
                        <p className="text-[12px] text-zinc-500 mt-0.5 animate-pulse">Formulating execution steps and approach...</p>
                      ) : (
                        <p className="text-[12px] text-zinc-400 mt-0.5">Waiting for task details...</p>
                      )}
                    </div>
                  </div>

                  {/* Phantom Stage */}
                  <div className="flex gap-3 text-[13px] w-full" style={{ paddingLeft: '4px', paddingRight: '4px' }}>
                    <div className="flex flex-col items-center shrink-0">
                      {debate?.review?.id ? (
                        <div className={`w-5 h-5 rounded-full text-white flex items-center justify-center font-bold text-[10px] ${debate.review.assessment === 'viable' ? 'bg-emerald-500' : 'bg-amber-500'}`}>✓</div>
                      ) : getActivePhase() === 'phantom' ? (
                        <div className="w-5 h-5 rounded-full border-2 border-zinc-400 border-t-transparent animate-spin" />
                      ) : (
                        <div className="w-5 h-5 rounded-full bg-zinc-150 text-zinc-400 flex items-center justify-center font-bold text-[10px] dark:bg-zinc-800">2</div>
                      )}
                      <div className="w-0.5 flex-1 bg-zinc-200/80 my-1 min-h-[16px] dark:bg-zinc-800" />
                    </div>
                    <div className="flex-1 min-w-0" style={{ paddingRight: '8px' }}>
                      <div className="flex items-center gap-2 font-semibold text-zinc-900 dark:text-zinc-100">
                        <span>Phantom Agent</span>
                        <span className="text-[10px] text-zinc-400 font-normal bg-zinc-100 rounded dark:bg-zinc-850" style={{ paddingLeft: '8px', paddingRight: '8px', paddingTop: '3px', paddingBottom: '3px' }}>Critic</span>
                      </div>
                      {debate?.review?.id ? (
                        <div className="mt-1 bg-zinc-50 border border-zinc-150 rounded text-[12px] text-zinc-600 dark:bg-zinc-800/40 dark:border-zinc-800/60 dark:text-zinc-300 w-full" style={{ padding: '12px', marginRight: '8px' }}>
                          <p className="font-semibold text-zinc-800 dark:text-zinc-200 mb-0.5">Critique Completed:</p>
                          <p className="mb-1 break-words">
                            Assessment: <span className={`font-semibold capitalize ${debate.review.assessment === 'viable' ? 'text-green-600' : debate.review.assessment === 'concerning' ? 'text-yellow-600' : 'text-red-600'}`}>{debate.review.assessment}</span>
                          </p>
                          <div className="text-[11px] text-zinc-400 font-medium">
                            Concerns flagged: {debate.review.concernCount} ({debate.review.criticalCount} critical)
                          </div>
                          {debate.review.concerns && debate.review.concerns.length > 0 && (
                            <ul className="mt-1.5 pl-4 list-disc text-zinc-500 text-[11px] max-h-24 overflow-y-auto space-y-1 break-words">
                              {debate.review.concerns.map((c, i) => (
                                <li key={i} className="break-words">
                                  <span className="font-semibold text-zinc-700 dark:text-zinc-300">[{c.severity}] {c.title}</span>: {c.description}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      ) : getActivePhase() === 'phantom' ? (
                        <p className="text-[12px] text-zinc-500 mt-0.5 animate-pulse">Analyzing proposed plan for edge cases and security risks...</p>
                      ) : (
                        <p className="text-[12px] text-zinc-400 mt-0.5">Waiting for proposal...</p>
                      )}
                    </div>
                  </div>

                  {/* Arbiter Stage */}
                  <div className="flex gap-3 text-[13px] w-full" style={{ paddingLeft: '4px', paddingRight: '4px' }}>
                    <div className="flex flex-col items-center shrink-0">
                      {debate?.finalPlan?.id ? (
                        <div className={`w-5 h-5 rounded-full text-white flex items-center justify-center font-bold text-[10px] ${debate.finalPlan.goNogo === 'go' ? 'bg-emerald-500' : debate.finalPlan.goNogo === 'no-go' ? 'bg-red-500' : 'bg-amber-500'}`}>✓</div>
                      ) : getActivePhase() === 'arbiter' ? (
                        <div className="w-5 h-5 rounded-full border-2 border-zinc-400 border-t-transparent animate-spin" />
                      ) : (
                        <div className="w-5 h-5 rounded-full bg-zinc-150 text-zinc-400 flex items-center justify-center font-bold text-[10px] dark:bg-zinc-800">3</div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0" style={{ paddingRight: '8px' }}>
                      <div className="flex items-center gap-2 font-semibold text-zinc-900 dark:text-zinc-100">
                        <span>Arbiter Agent</span>
                        <span className="text-[10px] text-zinc-400 font-normal bg-zinc-100 rounded dark:bg-zinc-850" style={{ paddingLeft: '8px', paddingRight: '8px', paddingTop: '3px', paddingBottom: '3px' }}>Judge</span>
                      </div>
                      {debate?.finalPlan?.id ? (
                        <div className="mt-1 bg-zinc-50 border border-zinc-150 rounded text-[12px] text-zinc-600 dark:bg-zinc-800/40 dark:border-zinc-800/60 dark:text-zinc-300 w-full" style={{ padding: '12px', marginRight: '8px' }}>
                          <p className="font-semibold text-zinc-800 dark:text-zinc-200 mb-0.5">Final Decision:</p>
                          <p className="font-bold text-zinc-900 dark:text-zinc-100 mb-0.5 uppercase tracking-wide">
                            {debate.finalPlan.goNogo === 'go' ? '🟢 APPROVED' : debate.finalPlan.goNogo === 'no-go' ? '🔴 REJECTED' : '🟡 PROCEED WITH CAUTION'}
                          </p>
                          <p className="text-[11px] italic mt-1 text-zinc-500 dark:text-zinc-400 break-words">"{debate.finalPlan.explanation}"</p>

                          <div className="mt-2 pt-2 border-t border-zinc-200/60 dark:border-zinc-700/60 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-zinc-500 dark:text-zinc-400 break-words">
                            <span>Steps: <strong className="text-zinc-700 dark:text-zinc-350">{debate.finalPlan.stepCount}</strong></span>
                            <span>Resolved: <strong className="text-zinc-700 dark:text-zinc-350">{debate.finalPlan.addressedConcerns} concerns</strong></span>
                            {debate.finalPlan.remainingRisks > 0 && (
                              <span>Remaining Risks: <strong className="text-zinc-700 dark:text-zinc-350">{debate.finalPlan.remainingRisks}</strong></span>
                            )}
                            <span className="capitalize">Risk: <strong className={
                              debate.finalPlan.riskAssessment === 'low' ? 'text-green-600' :
                              debate.finalPlan.riskAssessment === 'medium' ? 'text-yellow-600' :
                              'text-red-600'
                            }>{debate.finalPlan.riskAssessment}</strong></span>
                          </div>
                        </div>
                      ) : getActivePhase() === 'arbiter' ? (
                        <p className="text-[12px] text-zinc-500 mt-0.5 animate-pulse">Mediating feedback & deciding final execution plan...</p>
                      ) : (
                        <p className="text-[12px] text-zinc-400 mt-0.5">Waiting for critique...</p>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                debate && (
                  <div
                    className="bg-white border border-[#e5e7eb] rounded-md p-3 flex flex-col gap-2 dark:bg-zinc-900 dark:border-zinc-800"
                    style={{ padding: '16px', gap: '12px' }}
                  >
                    {/* Explanation - truncated and better formatted */}
                    <div
                      className="px-2 py-1.5 rounded-md text-[12px] leading-[1.5] bg-[#f9fafb] text-[#4b5563] border border-[#f3f4f6] dark:bg-zinc-950 dark:border-zinc-850 dark:text-zinc-300"
                      style={{ padding: '8px' }}
                    >
                      <p className="whitespace-pre-wrap wrap-break-word">
                        {showFullPlan ? debate.finalPlan.explanation : truncateText(debate.finalPlan.explanation, 250)}
                        {debate.finalPlan.explanation.length > 250 && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setShowFullPlan(!showFullPlan);
                            }}
                            className="text-[#6366f1] hover:text-[#4f46e5] font-semibold ml-1.5 inline-block cursor-pointer outline-none"
                            style={{ background: 'none', border: 'none', padding: 0 }}
                          >
                            {showFullPlan ? 'Read Less' : 'Read More'}
                          </button>
                        )}
                      </p>
                    </div>

                    {/* Stats Grid - Compact */}
                    <div
                      className="grid grid-cols-3 gap-1.5"
                      style={{ gap: '12px', padding: '0 4px' }}
                    >
                      <div
                        className="bg-[#f9fafb] border border-[#e5e7eb] rounded-md px-2 py-1.5 dark:bg-zinc-950 dark:border-zinc-850"
                        style={{ padding: '10px' }}
                      >
                        <p className="text-[9px] font-semibold text-[#9ca3af] uppercase tracking-wider mb-0.5">
                          Steps
                        </p>
                        <p className="text-[13px] font-bold text-[#111827] dark:text-zinc-200">
                          {debate.finalPlan.stepCount || debate.proposal.stepCount}
                        </p>
                      </div>
                      <div
                        className="bg-[#f9fafb] border border-[#e5e7eb] rounded-md px-2 py-1.5 dark:bg-zinc-950 dark:border-zinc-850"
                        style={{ padding: '10px' }}
                      >
                        <p className="text-[9px] font-semibold text-[#9ca3af] uppercase tracking-wider mb-0.5">
                          Concerns
                        </p>
                        <p className="text-[13px] font-bold text-[#111827] dark:text-zinc-200">
                          {debate.review.concernCount}
                        </p>
                      </div>
                      <div
                        className="bg-[#f9fafb] border border-[#e5e7eb] rounded-md px-2 py-1.5 dark:bg-zinc-950 dark:border-zinc-850"
                        style={{ padding: '10px' }}
                      >
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
                )
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
