/**
 * Mission Timeline Component
 * 
 * Displays a high-level timeline of mission steps and phases.
 * For detailed tool execution information (commands, arguments, output), 
 * see the Tool Timeline component which appears above this component.
 * 
 * This component focuses on mission orchestration and step tracking,
 * while the Tool Timeline shows individual tool call details.
 */

'use client';

import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ClockIcon,
  ExclamationCircleIcon,
  SparklesIcon,
  ChevronRightIcon,
  CpuChipIcon,
} from '@heroicons/react/24/outline';
import { CheckCircleIcon as CheckCircleSolidIcon } from '@heroicons/react/24/solid';
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

const phaseColors: Record<string, { gradient: string; glow: string; text: string }> = {
  triage: { gradient: 'from-violet-500/20 via-purple-500/20 to-blue-500/20', glow: 'rgba(139, 92, 246, 0.3)', text: 'text-violet-500' },
  planning: { gradient: 'from-blue-500/20 via-cyan-500/20 to-sky-500/20', glow: 'rgba(59, 130, 246, 0.3)', text: 'text-blue-500' },
  execution: { gradient: 'from-cyan-500/20 via-teal-500/20 to-emerald-500/20', glow: 'rgba(20, 184, 166, 0.3)', text: 'text-cyan-500' },
  validation: { gradient: 'from-teal-500/20 via-green-500/20 to-lime-500/20', glow: 'rgba(34, 197, 94, 0.3)', text: 'text-teal-500' },
  completion: { gradient: 'from-green-500/20 via-emerald-500/20 to-lime-500/20', glow: 'rgba(34, 197, 94, 0.3)', text: 'text-green-500' },
};

const statusConfig: Record<string, { icon: React.ReactNode; color: string; bgColor: string; borderColor: string }> = {
  completed: {
    icon: <CheckCircleSolidIcon className="w-5 h-5" />,
    color: 'text-emerald-500',
    bgColor: 'bg-emerald-500/10',
    borderColor: 'border-emerald-500/30'
  },
  'in-progress': {
    icon: (
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
        className="w-5 h-5"
      >
        <CpuChipIcon className="w-5 h-5" />
      </motion.div>
    ),
    color: 'text-blue-500',
    bgColor: 'bg-blue-500/10',
    borderColor: 'border-blue-500/30'
  },
  pending: {
    icon: <ClockIcon className="w-5 h-5" />,
    color: 'text-gray-400',
    bgColor: 'bg-gray-500/5',
    borderColor: 'border-gray-500/20'
  },
  failed: {
    icon: <ExclamationCircleIcon className="w-5 h-5" />,
    color: 'text-red-500',
    bgColor: 'bg-red-500/10',
    borderColor: 'border-red-500/30'
  },
  skipped: {
    icon: <div className="w-5 h-5 flex items-center justify-center text-gray-400">⊘</div>,
    color: 'text-gray-400',
    bgColor: 'bg-gray-500/5',
    borderColor: 'border-gray-500/20'
  },
};

const shouldHideStepResult = (str: string | undefined | null): boolean => {
  if (!str) return true;
  const trimmed = str.trim();
  if (!trimmed) return true;

  // Check for JSON structures
  if (trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.startsWith('"') || trimmed.startsWith('\\"')) {
    // Direct JSON check
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === 'object' && parsed !== null) {
        return true;
      }
    } catch {}

    // Double-serialized JSON check
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
      try {
        const parsed = JSON.parse(JSON.parse(trimmed));
        if (typeof parsed === 'object' && parsed !== null) {
          return true;
        }
      } catch {}
    }
  }

  const lower = trimmed.toLowerCase();
  // Check for assistant messages or tool calls indicators
  if (lower.includes('"messages"') || lower.includes('"tool_calls"') || lower.includes('"role"') || lower.includes('"content"')) {
    return true;
  }
  if (lower.includes('\\"messages\\"') || lower.includes('\\"tool_calls\\"') || lower.includes('\\"role\\"') || lower.includes('\\"content\\"')) {
    return true;
  }

  // Check for "Completed X tool calls" or similar technical progress noise
  if (/^completed\s*\d*\s*tool\s*calls?$/i.test(trimmed) || 
      /^completed\s*\d*\s*calls?$/i.test(trimmed) ||
      trimmed.startsWith('Completed tool call') ||
      trimmed.startsWith('Completed tool calls')) {
    return true;
  }

  return false;
};

const MissionTimelineComponent: React.FC<MissionTimelineProps> = ({ 
  timeline, 
  isRunning,
  autoCollapse = true,
  onCollapseChange,
  variant = 'main'
}) => {
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useAutoCollapse(isRunning, autoCollapse);
  
  const isSidebar = variant === 'sidebar';
  
  // Calculate total timeline duration
  const totalDuration = useMemo(() => {
    if (!timeline?.steps) return 0;
    return timeline.steps.reduce((sum, step) => sum + (step.duration || 0), 0);
  }, [timeline?.steps]);
  
  // Notify parent of collapse state changes
  React.useEffect(() => {
    onCollapseChange?.(collapsed);
  }, [collapsed, onCollapseChange]);
  
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
    <div className={`${isSidebar ? 'bg-transparent' : 'bg-gradient-to-b from-slate-900 to-slate-800 p-6 border border-slate-700'} rounded-lg space-y-4`}>
      {/* Header with collapse toggle */}
      {!isSidebar && (
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="w-full flex items-center justify-between hover:bg-slate-700/30 rounded-lg p-2 -m-2 transition-colors"
        >
          <div className="flex items-center gap-3">
            <SparklesIcon className="w-6 h-6 text-blue-400" />
            <h3 className="text-lg font-semibold text-white">Mission Timeline</h3>
            {!isRunning && (
              <span className="text-sm text-gray-400">
                {formatDuration(totalDuration)}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div className="text-sm text-gray-400">
              {timeline.completedSteps}/{timeline.totalSteps} completed
            </div>
            <motion.div
              animate={{ rotate: collapsed ? 0 : 90 }}
              transition={{ duration: 0.2 }}
            >
              <ChevronRightIcon className="w-5 h-5 text-gray-400" />
            </motion.div>
          </div>
        </button>
      )}

      {/* Collapsible content */}
      <AnimatePresence initial={false}>
        {(!collapsed || isSidebar) && (
          <motion.div
            initial={isSidebar ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
            className="overflow-hidden space-y-4"
          >
            {/* Progress Bar */}
            <div className={`w-full ${isSidebar ? 'bg-gray-200' : 'bg-slate-700'} rounded-full h-1.5 overflow-hidden`}>
              <motion.div
                className="h-full bg-gradient-to-r from-blue-500 to-emerald-500"
                initial={{ width: 0 }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.3, ease: 'easeOut' }}
              />
            </div>

            {/* Phase Indicator */}
            <div className="flex items-center gap-2 text-xs">
              <span className={isSidebar ? 'text-gray-500 font-medium' : 'text-gray-400'}>Phase:</span>
              <span className={`px-2 py-0.5 rounded-full font-bold capitalize bg-gradient-to-r ${phaseColors[timeline.currentPhase] || phaseColors.planning} ${isSidebar ? 'text-gray-700' : 'text-white'}`}>
                {timeline.currentPhase}
              </span>
              {isRunning && <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />}
            </div>

            {/* Steps List */}
            <div className={`space-y-3 ${isSidebar ? '' : 'max-h-96 overflow-y-auto pr-2'}`}>
              <AnimatePresence>
                {timeline.steps.map((step, index) => {
                  const isExpanded = expandedSteps.has(step.id);
                  const statusInfo = statusConfig[step.status] || statusConfig.pending;

                  return (
                    <motion.div
                      key={step.id}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 10 }}
                      transition={{ delay: index * 0.05 }}
                      className={`${isSidebar ? 'bg-white border-gray-100' : 'bg-slate-800 border-slate-700'} rounded-xl border shadow-sm overflow-hidden hover:border-blue-400/50 transition-colors`}
                    >
                      {/* Step Header */}
                      <button
                        onClick={() => toggleExpand(step.id)}
                        className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50/50 transition-colors"
                      >
                        <div className="flex items-center gap-3 flex-1 text-left">
                          <div className={`flex-shrink-0 ${statusInfo.color}`}>{statusInfo.icon}</div>
                          <div className="flex-1 min-w-0">
                            <div className={`text-sm font-semibold ${isSidebar ? 'text-gray-800' : 'text-white'} truncate`}>{step.name}</div>
                            <div className={`text-[11px] ${isSidebar ? 'text-gray-500' : 'text-gray-400'} truncate`}>{step.description}</div>
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {step.duration && (
                            <span className="text-[10px] text-gray-400 font-medium">
                              {(step.duration / 1000).toFixed(1)}s
                            </span>
                          )}
                          <ChevronRightIcon
                            className={`w-3.5 h-3.5 text-gray-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                          />
                        </div>
                      </button>

                      {/* Step Details (Expandable) */}
                      {isExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          className={`border-t ${isSidebar ? 'border-gray-50 bg-gray-50/30' : 'border-slate-700 bg-slate-900/50'} px-4 py-3 text-[12px] space-y-2.5`}
                        >
                          {/* Phase Badge */}
                          <div className="flex items-center gap-2">
                            <span className="text-gray-400 font-medium">Phase:</span>
                            <span className="capitalize px-1.5 py-0.5 rounded text-gray-600 bg-gray-100 font-bold text-[10px]">
                              {step.phase}
                            </span>
                          </div>

                          {/* Tool Calls */}
                          {step.toolCalls && step.toolCalls.length > 0 && (
                            <div>
                              <div className="text-gray-400 font-medium mb-1.5">Tools Used:</div>
                              <div className="space-y-1.5">
                                {step.toolCalls.map((tool, i) => (
                                  <div key={i} className={`${isSidebar ? 'bg-white' : 'bg-slate-700'} border border-gray-100 rounded-lg p-2`}>
                                    <div className="text-[11px] text-blue-600 font-mono font-bold mb-0.5">
                                      {tool}
                                    </div>
                                    <div className="text-[10px] text-gray-400 italic">
                                      Detailed in chat timeline
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Result Preview */}
                          {step.result && !shouldHideStepResult(step.result) && (
                            <div>
                              <div className="text-gray-400 font-medium mb-1">Result:</div>
                              <div className={`text-[11px] ${isSidebar ? 'bg-white border-gray-100' : 'bg-slate-700'} border p-2 rounded-lg text-gray-600 max-h-24 overflow-y-auto font-mono break-words leading-relaxed`}>
                                {typeof step.result === 'string'
                                  ? step.result.slice(0, 200) + (step.result.length > 200 ? '...' : '')
                                  : JSON.stringify(step.result).slice(0, 200) + '...'}
                              </div>
                            </div>
                          )}

                          {/* Error Display */}
                          {step.error && (
                            <div className="bg-red-50 border border-red-100 rounded-lg p-2.5">
                              <div className="text-[11px] text-red-600 font-mono font-medium">{step.error}</div>
                            </div>
                          )}

                          {/* Timing Info */}
                          {step.startTime && (
                            <div className="text-[10px] text-gray-400 flex items-center gap-1.5">
                              <ClockIcon className="w-3 h-3" />
                              Started: {new Date(step.startTime).toLocaleTimeString()}
                              {step.endTime && (
                                <> · Duration: {((step.endTime - step.startTime) / 1000).toFixed(2)}s</>
                              )}
                            </div>
                          )}
                        </motion.div>
                      )}
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>

            {/* Completion Status */}
            {timeline.isComplete && (
              <div className={`p-3.5 rounded-xl border text-xs font-bold ${
                timeline.error
                  ? 'bg-red-50 border-red-100 text-red-600'
                  : 'bg-emerald-50 border-emerald-100 text-emerald-600'
              }`}>
                {timeline.error ? `❌ Mission Failed: ${timeline.error}` : '✅ Mission Complete!'}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default MissionTimelineComponent;
