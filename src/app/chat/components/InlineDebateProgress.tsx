'use client';

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Scale, Check, AlertCircle, AlertTriangle, Loader2 } from 'lucide-react';
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
      label: 'Vanguard Agent',
      role: 'Planner',
      description: 'Formulating execution plan',
    },
    review: {
      label: 'Phantom Agent',
      role: 'Critic',
      description: 'Reviewing for risks & edge cases',
    },
    arbitration: {
      label: 'Arbiter Agent',
      role: 'Judge',
      description: 'Synthesizing final consensus',
    },
  };

  const getDebateTitle = () => {
    if (isDebating && phase) {
      return `${phaseInfo[phase].label}: ${phaseInfo[phase].description}`;
    }
    if (debate) {
      if (debate.finalPlan.goNogo === 'go') return 'Consensus Reached: Plan Approved';
      if (debate.finalPlan.goNogo === 'no-go') return 'Consensus Reached: Plan Rejected';
      return 'Consensus Reached: Proceed with Caution';
    }
    return 'Debate Chamber Active';
  };

  const canExpand = !!(debate || isDebating);

  const truncateText = (text: string, maxLength: number = 220) => {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  };

  return (
    <div
      style={{
        width: '100%',
        margin: '6px 0 10px 0',
        padding: '10px 14px',
        borderRadius: 10,
        background: 'rgba(255, 255, 255, 0.03)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        backdropFilter: 'blur(8px)',
      }}
    >
      {/* Main trigger row */}
      <div
        onClick={() => canExpand && setExpanded(!expanded)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: canExpand ? 'pointer' : 'default',
          userSelect: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
          {isDebating ? (
            <Loader2
              size={15}
              strokeWidth={1.75}
              className="animate-spin"
              style={{ color: 'rgba(255, 255, 255, 0.65)', flexShrink: 0 }}
            />
          ) : debate?.finalPlan.goNogo === 'go' ? (
            <Check
              size={15}
              strokeWidth={2}
              style={{ color: '#10b981', flexShrink: 0 }}
            />
          ) : debate?.finalPlan.goNogo === 'no-go' ? (
            <AlertCircle
              size={15}
              strokeWidth={1.75}
              style={{ color: '#ef4444', flexShrink: 0 }}
            />
          ) : (
            <Scale
              size={15}
              strokeWidth={1.75}
              style={{ color: 'rgba(255, 255, 255, 0.55)', flexShrink: 0 }}
            />
          )}

          <span
            style={{
              fontSize: 14,
              fontWeight: 450,
              color: isDebating ? 'rgba(255, 255, 255, 0.9)' : 'rgba(255, 255, 255, 0.7)',
              lineHeight: 1.4,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {getDebateTitle()}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, marginLeft: 12 }}>
          {canExpand && (
            <motion.span
              animate={{ rotate: expanded ? 180 : 0 }}
              transition={{ duration: 0.15 }}
              style={{ display: 'flex', color: 'rgba(255, 255, 255, 0.4)' }}
            >
              <ChevronDown size={14} strokeWidth={1.75} />
            </motion.span>
          )}
        </div>
      </div>

      {/* Expanded multi-agent deliberation details */}
      <AnimatePresence>
        {expanded && (debate || isDebating) && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            style={{ overflow: 'hidden' }}
          >
            <div
              style={{
                marginTop: 10,
                paddingTop: 10,
                borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              {/* Vanguard Stage */}
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <div
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: debate?.proposal?.id ? '#10b981' : isDebating && phase === 'proposal' ? '#3b82f6' : 'rgba(255, 255, 255, 0.2)',
                    marginTop: 6,
                    flexShrink: 0,
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                    <span style={{ fontSize: 13, fontWeight: 500, color: 'rgba(255, 255, 255, 0.85)' }}>Vanguard</span>
                    <span style={{ fontSize: 11, color: 'rgba(255, 255, 255, 0.35)' }}>Planner</span>
                  </div>
                  {debate?.proposal?.id ? (
                    <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.45, color: 'rgba(255, 255, 255, 0.6)' }}>
                      "{debate.proposal.approach}"
                      <span style={{ display: 'block', fontSize: 11, color: 'rgba(255, 255, 255, 0.35)', marginTop: 2 }}>
                        {debate.proposal.phaseCount} phases · Est. {Math.round(debate.proposal.estimatedTimeMs / 1000)}s
                      </span>
                    </p>
                  ) : isDebating && phase === 'proposal' ? (
                    <p style={{ margin: 0, fontSize: 12.5, color: 'rgba(255, 255, 255, 0.45)', fontStyle: 'italic' }}>
                      Formulating execution steps...
                    </p>
                  ) : (
                    <p style={{ margin: 0, fontSize: 12.5, color: 'rgba(255, 255, 255, 0.3)' }}>Waiting...</p>
                  )}
                </div>
              </div>

              {/* Phantom Stage */}
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <div
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: debate?.review?.id ? (debate.review.assessment === 'viable' ? '#10b981' : '#f59e0b') : isDebating && phase === 'review' ? '#3b82f6' : 'rgba(255, 255, 255, 0.2)',
                    marginTop: 6,
                    flexShrink: 0,
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                    <span style={{ fontSize: 13, fontWeight: 500, color: 'rgba(255, 255, 255, 0.85)' }}>Phantom</span>
                    <span style={{ fontSize: 11, color: 'rgba(255, 255, 255, 0.35)' }}>Critic</span>
                  </div>
                  {debate?.review?.id ? (
                    <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.45, color: 'rgba(255, 255, 255, 0.6)' }}>
                      Assessment: <span style={{ textTransform: 'capitalize', color: debate.review.assessment === 'viable' ? '#10b981' : '#f59e0b' }}>{debate.review.assessment}</span> ({debate.review.concernCount} concerns flagged)
                    </p>
                  ) : isDebating && phase === 'review' ? (
                    <p style={{ margin: 0, fontSize: 12.5, color: 'rgba(255, 255, 255, 0.45)', fontStyle: 'italic' }}>
                      Analyzing edge cases and risks...
                    </p>
                  ) : (
                    <p style={{ margin: 0, fontSize: 12.5, color: 'rgba(255, 255, 255, 0.3)' }}>Waiting for proposal...</p>
                  )}
                </div>
              </div>

              {/* Arbiter Stage */}
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <div
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: debate?.finalPlan?.id ? (debate.finalPlan.goNogo === 'go' ? '#10b981' : debate.finalPlan.goNogo === 'no-go' ? '#ef4444' : '#f59e0b') : isDebating && phase === 'arbitration' ? '#3b82f6' : 'rgba(255, 255, 255, 0.2)',
                    marginTop: 6,
                    flexShrink: 0,
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                    <span style={{ fontSize: 13, fontWeight: 500, color: 'rgba(255, 255, 255, 0.85)' }}>Arbiter</span>
                    <span style={{ fontSize: 11, color: 'rgba(255, 255, 255, 0.35)' }}>Judge</span>
                  </div>
                  {debate?.finalPlan?.id ? (
                    <div style={{ fontSize: 12.5, lineHeight: 1.45, color: 'rgba(255, 255, 255, 0.6)' }}>
                      <p style={{ margin: '0 0 4px 0' }}>
                        {showFullPlan ? debate.finalPlan.explanation : truncateText(debate.finalPlan.explanation, 200)}
                        {debate.finalPlan.explanation.length > 200 && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setShowFullPlan(!showFullPlan);
                            }}
                            style={{
                              marginLeft: 6,
                              background: 'none',
                              border: 'none',
                              padding: 0,
                              color: 'rgba(255, 255, 255, 0.8)',
                              cursor: 'pointer',
                              textDecoration: 'underline',
                              fontSize: 11.5,
                            }}
                          >
                            {showFullPlan ? 'Less' : 'More'}
                          </button>
                        )}
                      </p>
                      <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'rgba(255, 255, 255, 0.35)' }}>
                        <span>Phases: {debate.finalPlan.phaseCount}</span>
                        <span>Resolved: {debate.finalPlan.addressedConcerns}</span>
                        <span>Risk: {debate.finalPlan.riskAssessment}</span>
                      </div>
                    </div>
                  ) : isDebating && phase === 'arbitration' ? (
                    <p style={{ margin: 0, fontSize: 12.5, color: 'rgba(255, 255, 255, 0.45)', fontStyle: 'italic' }}>
                      Arbitrating consensus...
                    </p>
                  ) : (
                    <p style={{ margin: 0, fontSize: 12.5, color: 'rgba(255, 255, 255, 0.3)' }}>Waiting for critique...</p>
                  )}
                </div>
              </div>

              {/* View Full Debate Link */}
              {onViewFullDebate && (
                <div style={{ marginTop: 4, textAlign: 'right' }}>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onViewFullDebate();
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      color: 'rgba(255, 255, 255, 0.5)',
                      fontSize: 11.5,
                      cursor: 'pointer',
                      textDecoration: 'underline',
                    }}
                  >
                    View full debate transcript →
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
