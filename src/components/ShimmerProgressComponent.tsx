"use client";

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Globe, Search, FileText, CheckCircle2, AlertCircle, TrendingUp } from "lucide-react";
import { Loader } from "@/components/ui/animated-loading-svg-text-shimmer";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type ResearchPhase = 'planning' | 'searching' | 'analyzing' | 'synthesizing';

export interface SourceInfo {
  url: string;
  title: string;
  qualityScore: number;
  factsExtracted: number;
  visitedAt: number;
}

export interface ResearchState {
  phase: ResearchPhase;
  currentSources: SourceInfo[];
  factsFound: number;
  confidence: number;
}

export type ProgressEventType = 'page_visited' | 'fact_extracted' | 'source_scored' | 'synthesis_started';

export interface ProgressEvent {
  type: ProgressEventType;
  data: any;
  timestamp: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component Props
// ─────────────────────────────────────────────────────────────────────────────

export interface ShimmerProgressComponentProps {
  state: ResearchState;
  error?: string;
  onRetry?: () => void;
  className?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────────────────

const getPhaseIcon = (phase: ResearchPhase) => {
  switch (phase) {
    case 'planning':
      return <Search size={16} className="text-blue-500" />;
    case 'searching':
      return <Globe size={16} className="text-purple-500" />;
    case 'analyzing':
      return <FileText size={16} className="text-emerald-500" />;
    case 'synthesizing':
      return <TrendingUp size={16} className="text-orange-500" />;
  }
};

const getPhaseLabel = (phase: ResearchPhase): string => {
  switch (phase) {
    case 'planning':
      return 'Planning research';
    case 'searching':
      return 'Searching sources';
    case 'analyzing':
      return 'Analyzing pages';
    case 'synthesizing':
      return 'Synthesizing findings';
  }
};

const getPhaseColor = (phase: ResearchPhase): string => {
  switch (phase) {
    case 'planning':
      return 'border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950';
    case 'searching':
      return 'border-purple-200 bg-purple-50 dark:border-purple-900 dark:bg-purple-950';
    case 'analyzing':
      return 'border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950';
    case 'synthesizing':
      return 'border-orange-200 bg-orange-50 dark:border-orange-900 dark:bg-orange-950';
  }
};

const getConfidenceColor = (confidence: number): string => {
  if (confidence >= 0.8) return 'bg-emerald-500';
  if (confidence >= 0.6) return 'bg-blue-500';
  if (confidence >= 0.4) return 'bg-yellow-500';
  return 'bg-orange-500';
};

const getConfidenceLabel = (confidence: number): string => {
  if (confidence >= 0.8) return 'High';
  if (confidence >= 0.6) return 'Good';
  if (confidence >= 0.4) return 'Medium';
  return 'Low';
};

// ─────────────────────────────────────────────────────────────────────────────
// Animated Counter Component
// ─────────────────────────────────────────────────────────────────────────────

interface AnimatedCounterProps {
  value: number;
  className?: string;
}

const AnimatedCounter: React.FC<AnimatedCounterProps> = ({ value, className }) => {
  const [displayValue, setDisplayValue] = useState(value);

  useEffect(() => {
    // Smooth number increment animation
    const duration = 300;
    const steps = 10;
    const stepValue = (value - displayValue) / steps;
    const stepDuration = duration / steps;

    if (stepValue === 0) return;

    let currentStep = 0;
    const interval = setInterval(() => {
      currentStep++;
      if (currentStep >= steps) {
        setDisplayValue(value);
        clearInterval(interval);
      } else {
        setDisplayValue(prev => Math.round(prev + stepValue));
      }
    }, stepDuration);

    return () => clearInterval(interval);
  }, [value]);

  return (
    <motion.span
      key={displayValue}
      initial={{ scale: 1.2, opacity: 0.5 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.2 }}
      className={className}
    >
      {displayValue}
    </motion.span>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export const ShimmerProgressComponent: React.FC<ShimmerProgressComponentProps> = ({
  state,
  error,
  onRetry,
  className
}) => {
  const [previousPhase, setPreviousPhase] = useState<ResearchPhase>(state.phase);

  useEffect(() => {
    if (state.phase !== previousPhase) {
      setPreviousPhase(state.phase);
    }
  }, [state.phase, previousPhase]);

  // Error state
  if (error) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        className={`rounded-xl border border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950 overflow-hidden ${className || ''}`}
      >
        <div className="px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-red-500 flex items-center justify-center shrink-0">
              <AlertCircle size={18} className="text-white" />
            </div>

            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-red-900 dark:text-red-100">
                Research failed
              </div>
              <div className="text-sm text-red-700 dark:text-red-300 mt-0.5">
                {error}
              </div>
            </div>

            {onRetry && (
              <button
                onClick={onRetry}
                className="px-3 py-1.5 text-sm font-medium text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900 rounded-md transition-colors"
              >
                Retry
              </button>
            )}
          </div>
        </div>
      </motion.div>
    );
  }

  // Normal progress state
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className={`rounded-xl border ${getPhaseColor(state.phase)} overflow-hidden ${className || ''}`}
    >
      <div className="px-4 py-3">
        {/* Header with phase indicator */}
        <div className="flex items-center gap-3 mb-3">
          <div className="flex items-center gap-2">
            <Loader size={18} strokeWidth={2.5} className="text-zinc-600 dark:text-zinc-200" />
            {getPhaseIcon(state.phase)}
          </div>

          <motion.div
            key={state.phase}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.3 }}
            className="flex-1"
          >
            <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
              {getPhaseLabel(state.phase)}
            </div>
          </motion.div>

          {/* Confidence indicator */}
          <div className="flex items-center gap-2">
            <div className="text-xs text-zinc-600 dark:text-zinc-400">
              {getConfidenceLabel(state.confidence)}
            </div>
            <div className="w-16 h-1.5 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden">
              <motion.div
                className={`h-full rounded-full ${getConfidenceColor(state.confidence)}`}
                initial={{ width: 0 }}
                animate={{ width: `${state.confidence * 100}%` }}
                transition={{ duration: 0.5, ease: "easeOut" }}
              />
            </div>
          </div>
        </div>

        {/* Stats row */}
        <div className="flex items-center gap-4 text-sm">
          {/* Facts counter */}
          <div className="flex items-center gap-1.5">
            <CheckCircle2 size={14} className="text-emerald-500" />
            <span className="text-zinc-600 dark:text-zinc-400">
              <AnimatedCounter value={state.factsFound} className="font-medium text-zinc-900 dark:text-zinc-100" />
              {' '}facts
            </span>
          </div>

          {/* Sources counter */}
          <div className="flex items-center gap-1.5">
            <Globe size={14} className="text-blue-500" />
            <span className="text-zinc-600 dark:text-zinc-400">
              <AnimatedCounter value={state.currentSources.length} className="font-medium text-zinc-900 dark:text-zinc-100" />
              {' '}sources
            </span>
          </div>
        </div>

        {/* Current sources list */}
        {state.currentSources.length > 0 && (
          <div className="mt-3 space-y-1.5">
            <AnimatePresence mode="popLayout">
              {state.currentSources.slice(0, 3).map((source, index) => (
                <motion.div
                  key={source.url}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ delay: index * 0.1 }}
                  className="flex items-start gap-2 p-2 rounded-lg bg-white/50 dark:bg-zinc-900/50 border border-zinc-200/50 dark:border-zinc-800/50"
                >
                  <div className="mt-0.5">
                    <Globe size={12} className="text-zinc-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300 truncate">
                      {source.title || new URL(source.url).hostname}
                    </div>
                    <div className="text-[10px] text-zinc-500 dark:text-zinc-500 truncate mt-0.5">
                      {new URL(source.url).hostname}
                    </div>
                  </div>
                  {source.qualityScore > 0 && (
                    <div className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                      {Math.round(source.qualityScore)}
                    </div>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>

            {state.currentSources.length > 3 && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-[10px] text-zinc-400 dark:text-zinc-600 text-center pt-1"
              >
                +{state.currentSources.length - 3} more
              </motion.div>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
};

export default ShimmerProgressComponent;
