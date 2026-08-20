/**
 * Integration Example: ShimmerProgressComponent with Enhanced Browser Research System
 *
 * This file demonstrates how to integrate the ShimmerProgressComponent
 * with the Enhanced Browser Research System's orchestrator and events.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  ShimmerProgressComponent,
  ResearchState,
  ProgressEvent,
  SourceInfo,
  ResearchPhase
} from './ShimmerProgressComponent';

// ─────────────────────────────────────────────────────────────────────────────
// Example: Integration with Research Orchestrator
// ─────────────────────────────────────────────────────────────────────────────

interface ResearchOrchestratorProps {
  query: string;
  onComplete?: (answer: string) => void;
  onError?: (error: string) => void;
}

export const ResearchOrchestratorWithProgress: React.FC<ResearchOrchestratorProps> = ({
  query,
  onComplete,
  onError
}) => {
  const [researchState, setResearchState] = useState<ResearchState>({
    phase: 'planning',
    currentSources: [],
    factsFound: 0,
    confidence: 0.3
  });
  const [error, setError] = useState<string | undefined>();

  // Handle progress events from the research system
  const handleProgressEvent = useCallback((event: ProgressEvent) => {
    setResearchState(prevState => {
      const newState = { ...prevState };

      switch (event.type) {
        case 'page_visited': {
          // Add new source to current sources
          const source: SourceInfo = {
            url: event.data.url,
            title: event.data.title || new URL(event.data.url).hostname,
            qualityScore: event.data.qualityScore || 0,
            factsExtracted: 0,
            visitedAt: event.timestamp
          };
          newState.currentSources = [...prevState.currentSources, source];
          break;
        }

        case 'fact_extracted': {
          // Increment fact counter
          newState.factsFound = prevState.factsFound + 1;

          // Update source fact count
          const sourceIndex = newState.currentSources.findIndex(
            s => s.url === event.data.sourceUrl
          );
          if (sourceIndex !== -1) {
            newState.currentSources[sourceIndex].factsExtracted += 1;
          }

          // Increase confidence as more facts are found
          newState.confidence = Math.min(0.95, prevState.confidence + 0.05);
          break;
        }

        case 'source_scored': {
          // Update source quality score
          const sourceIndex = newState.currentSources.findIndex(
            s => s.url === event.data.url
          );
          if (sourceIndex !== -1) {
            newState.currentSources[sourceIndex].qualityScore = event.data.score;
          }
          break;
        }

        case 'synthesis_started': {
          // Change phase to synthesizing
          newState.phase = 'synthesizing';
          newState.confidence = Math.min(1.0, prevState.confidence + 0.1);
          break;
        }
      }

      return newState;
    });
  }, []);

  // Transition between phases
  const transitionToPhase = useCallback((newPhase: ResearchPhase) => {
    setResearchState(prevState => ({
      ...prevState,
      phase: newPhase
    }));
  }, []);

  // Simulate research execution (replace with actual research orchestrator)
  useEffect(() => {
    const executeResearch = async () => {
      try {
        // Phase 1: Planning
        transitionToPhase('planning');
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Phase 2: Searching
        transitionToPhase('searching');
        handleProgressEvent({
          type: 'page_visited',
          data: {
            url: 'https://example.com/article-1',
            title: 'Research Article 1',
            qualityScore: 85
          },
          timestamp: Date.now()
        });
        await new Promise(resolve => setTimeout(resolve, 500));

        handleProgressEvent({
          type: 'page_visited',
          data: {
            url: 'https://docs.example.com/guide',
            title: 'Documentation Guide',
            qualityScore: 92
          },
          timestamp: Date.now()
        });
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Phase 3: Analyzing
        transitionToPhase('analyzing');
        for (let i = 0; i < 5; i++) {
          handleProgressEvent({
            type: 'fact_extracted',
            data: {
              sourceUrl: 'https://example.com/article-1',
              fact: `Fact ${i + 1}`
            },
            timestamp: Date.now()
          });
          await new Promise(resolve => setTimeout(resolve, 300));
        }

        // Phase 4: Synthesizing
        handleProgressEvent({
          type: 'synthesis_started',
          data: {},
          timestamp: Date.now()
        });
        await new Promise(resolve => setTimeout(resolve, 1500));

        // Complete
        onComplete?.('Research completed successfully!');
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        setError(errorMessage);
        onError?.(errorMessage);
      }
    };

    executeResearch();
  }, [query, handleProgressEvent, transitionToPhase, onComplete, onError]);

  const handleRetry = () => {
    setError(undefined);
    setResearchState({
      phase: 'planning',
      currentSources: [],
      factsFound: 0,
      confidence: 0.3
    });
  };

  return (
    <div className="space-y-4">
      <div className="text-sm text-zinc-600 dark:text-zinc-400">
        Researching: <span className="font-medium">{query}</span>
      </div>

      <ShimmerProgressComponent
        state={researchState}
        error={error}
        onRetry={handleRetry}
      />
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Example: Integration with Browser-Use Tool
// ─────────────────────────────────────────────────────────────────────────────

interface BrowserResearchToolProps {
  taskDescription: string;
  onProgress?: (event: ProgressEvent) => void;
}

export const BrowserResearchTool: React.FC<BrowserResearchToolProps> = ({
  taskDescription,
  onProgress
}) => {
  const [researchState, setResearchState] = useState<ResearchState>({
    phase: 'planning',
    currentSources: [],
    factsFound: 0,
    confidence: 0.3
  });

  // Emit progress event
  const emitProgress = useCallback((event: ProgressEvent) => {
    onProgress?.(event);

    // Update local state
    setResearchState(prevState => {
      const newState = { ...prevState };

      switch (event.type) {
        case 'page_visited':
          newState.currentSources.push({
            url: event.data.url,
            title: event.data.title,
            qualityScore: event.data.qualityScore,
            factsExtracted: 0,
            visitedAt: event.timestamp
          });
          break;
        case 'fact_extracted':
          newState.factsFound += 1;
          newState.confidence = Math.min(0.95, prevState.confidence + 0.05);
          break;
      }

      return newState;
    });
  }, [onProgress]);

  // Example: Page analysis callback
  const onPageAnalyzed = useCallback((url: string, analysis: any) => {
    emitProgress({
      type: 'page_visited',
      data: {
        url,
        title: analysis.title,
        qualityScore: analysis.qualityScore
      },
      timestamp: Date.now()
    });

    // If facts found, emit fact extraction events
    if (analysis.keyFacts && analysis.keyFacts.length > 0) {
      analysis.keyFacts.forEach((fact: string) => {
        emitProgress({
          type: 'fact_extracted',
          data: {
            sourceUrl: url,
            fact
          },
          timestamp: Date.now()
        });
      });
    }
  }, [emitProgress]);

  return (
    <div className="space-y-4">
      <ShimmerProgressComponent state={researchState} />

      {/* Your browser-use tool UI here */}
      <div className="text-xs text-zinc-500">
        Task: {taskDescription}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Example: Integration with Deep Research Agent
// ─────────────────────────────────────────────────────────────────────────────

interface DeepResearchAgentProps {
  query: string;
  maxSources?: number;
  onComplete?: (result: any) => void;
}

export const DeepResearchAgent: React.FC<DeepResearchAgentProps> = ({
  query,
  maxSources = 5,
  onComplete
}) => {
  const [researchState, setResearchState] = useState<ResearchState>({
    phase: 'planning',
    currentSources: [],
    factsFound: 0,
    confidence: 0.3
  });

  // Update research state
  const updateState = useCallback((updates: Partial<ResearchState>) => {
    setResearchState(prevState => ({
      ...prevState,
      ...updates
    }));
  }, []);

  // Phase transition handler
  const transitionPhase = useCallback((phase: ResearchPhase) => {
    updateState({ phase });
  }, [updateState]);

  // Add source handler
  const addSource = useCallback((source: SourceInfo) => {
    setResearchState(prevState => ({
      ...prevState,
      currentSources: [...prevState.currentSources, source]
    }));
  }, []);

  // Add fact handler
  const addFact = useCallback(() => {
    setResearchState(prevState => ({
      ...prevState,
      factsFound: prevState.factsFound + 1,
      confidence: Math.min(0.95, prevState.confidence + 0.05)
    }));
  }, []);

  return (
    <div className="space-y-4">
      <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
        Deep Research: {query}
      </div>

      <ShimmerProgressComponent state={researchState} />

      <div className="text-xs text-zinc-500">
        Max sources: {maxSources} | Current: {researchState.currentSources.length}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Example: Standalone Usage in Chat Interface
// ─────────────────────────────────────────────────────────────────────────────

export const ChatResearchProgress: React.FC = () => {
  const [researchState, setResearchState] = useState<ResearchState>({
    phase: 'searching',
    currentSources: [
      {
        url: 'https://example.com/article',
        title: 'Understanding AI Research',
        qualityScore: 88,
        factsExtracted: 3,
        visitedAt: Date.now()
      },
      {
        url: 'https://docs.example.com/guide',
        title: 'Research Methodology Guide',
        qualityScore: 92,
        factsExtracted: 5,
        visitedAt: Date.now()
      }
    ],
    factsFound: 8,
    confidence: 0.75
  });

  return (
    <div className="max-w-2xl mx-auto p-4">
      <ShimmerProgressComponent state={researchState} />
    </div>
  );
};

export default ResearchOrchestratorWithProgress;
