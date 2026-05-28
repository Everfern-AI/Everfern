"use client";

import React, { useState, useEffect } from "react";
import { ShimmerProgressComponent, ResearchState, ResearchPhase, SourceInfo } from "./ShimmerProgressComponent";

/**
 * Demo component showing ShimmerProgressComponent in action
 * This demonstrates all features: phase transitions, fact counter updates,
 * source display, confidence updates, and error states.
 */
export const ShimmerProgressDemo: React.FC = () => {
  const [state, setState] = useState<ResearchState>({
    phase: 'planning',
    currentSources: [],
    factsFound: 0,
    confidence: 0.3
  });
  const [error, setError] = useState<string | undefined>();
  const [isRunning, setIsRunning] = useState(false);

  // Simulate research progress
  useEffect(() => {
    if (!isRunning) return;

    const phases: ResearchPhase[] = ['planning', 'searching', 'analyzing', 'synthesizing'];
    let currentPhaseIndex = 0;
    let factCount = 0;
    let confidence = 0.3;
    const sources: SourceInfo[] = [];

    const interval = setInterval(() => {
      currentPhaseIndex++;

      if (currentPhaseIndex >= phases.length) {
        setIsRunning(false);
        clearInterval(interval);
        return;
      }

      const phase = phases[currentPhaseIndex];

      // Add sources during searching phase
      if (phase === 'searching') {
        sources.push({
          url: 'https://example.com/article-1',
          title: 'Understanding Web Research',
          qualityScore: 85,
          factsExtracted: 0,
          visitedAt: Date.now()
        });
        sources.push({
          url: 'https://docs.example.com/guide',
          title: 'Research Best Practices',
          qualityScore: 92,
          factsExtracted: 0,
          visitedAt: Date.now()
        });
      }

      // Add facts during analyzing phase
      if (phase === 'analyzing') {
        factCount = 5;
        confidence = 0.65;
        sources.push({
          url: 'https://research.example.com/paper',
          title: 'Advanced Research Techniques',
          qualityScore: 78,
          factsExtracted: 3,
          visitedAt: Date.now()
        });
      }

      // Increase confidence during synthesizing
      if (phase === 'synthesizing') {
        factCount = 12;
        confidence = 0.85;
      }

      setState({
        phase,
        currentSources: sources,
        factsFound: factCount,
        confidence
      });
    }, 3000);

    return () => clearInterval(interval);
  }, [isRunning]);

  const startDemo = () => {
    setError(undefined);
    setState({
      phase: 'planning',
      currentSources: [],
      factsFound: 0,
      confidence: 0.3
    });
    setIsRunning(true);
  };

  const showError = () => {
    setIsRunning(false);
    setError('Failed to connect to research sources. Please check your network connection.');
  };

  const handleRetry = () => {
    setError(undefined);
    startDemo();
  };

  return (
    <div className="space-y-4 p-4">
      <div className="flex gap-2">
        <button
          onClick={startDemo}
          disabled={isRunning}
          className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Start Demo
        </button>
        <button
          onClick={showError}
          className="px-4 py-2 bg-red-500 text-white rounded-md hover:bg-red-600"
        >
          Show Error
        </button>
      </div>

      <ShimmerProgressComponent
        state={state}
        error={error}
        onRetry={handleRetry}
      />

      <div className="text-sm text-zinc-600 dark:text-zinc-400 space-y-1">
        <p><strong>Current Phase:</strong> {state.phase}</p>
        <p><strong>Facts Found:</strong> {state.factsFound}</p>
        <p><strong>Confidence:</strong> {Math.round(state.confidence * 100)}%</p>
        <p><strong>Sources:</strong> {state.currentSources.length}</p>
      </div>
    </div>
  );
};

export default ShimmerProgressDemo;
