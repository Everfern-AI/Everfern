'use client';

import { useState, useCallback, useRef } from 'react';
import { SubagentPhase, SubagentCoordination } from '../app/chat/components/SubagentPanel';

export interface SubagentEvent {
  type: 'phase_start' | 'phase_update' | 'phase_complete' | 'phase_error' | 'coordination_update';
  phase?: string;
  agent?: string;
  data?: any;
  timestamp: number;
}

interface SubagentState {
  coordination: SubagentCoordination | null;
  phases: SubagentPhase[];
  isActive: boolean;
}

/**
 * Hook to track multi-agent system execution in the frontend
 * Subscribes to stream events and maintains state
 */
export function useSubagentTracking(conversationId: string | null) {
  const [state, setState] = useState<SubagentState>({
    coordination: null,
    phases: [],
    isActive: false,
  });

  const phaseMapRef = useRef<Map<string, SubagentPhase>>(new Map());

  /**
   * Handle incoming stream events from backend
   */
  const handleStreamEvent = useCallback((event: any) => {
    if (!event || event.type !== 'subagent_event') {
      return;
    }

    const subagentEvent: SubagentEvent = {
      type: event.subagentEventType,
      phase: event.phase,
      agent: event.agent,
      data: event.data,
      timestamp: Date.now(),
    };

    switch (subagentEvent.type) {
      case 'phase_start': {
        const phaseId = `${subagentEvent.agent}-${subagentEvent.timestamp}`;
        const newPhase: SubagentPhase = {
          id: phaseId,
          name: subagentEvent.phase || '',
          status: 'in-progress',
          agent: subagentEvent.agent || '',
          description: subagentEvent.data?.description || '',
          startTime: subagentEvent.timestamp,
          metrics: subagentEvent.data?.initialMetrics,
        };

        phaseMapRef.current.set(phaseId, newPhase);

        setState(prev => ({
          ...prev,
          isActive: true,
          phases: [...prev.phases, newPhase],
        }));
        break;
      }

      case 'phase_update': {
        // Find phase by agent and recent start time
        const phaseToUpdate = Array.from(phaseMapRef.current.values()).find(
          p => p.agent === subagentEvent.agent && p.status === 'in-progress'
        );

        if (phaseToUpdate) {
          phaseToUpdate.output = subagentEvent.data?.output;
          phaseToUpdate.metrics = subagentEvent.data?.metrics;

          setState(prev => ({
            ...prev,
            phases: prev.phases.map(p => (p.id === phaseToUpdate.id ? phaseToUpdate : p)),
          }));
        }
        break;
      }

      case 'phase_complete': {
        const phaseToComplete = Array.from(phaseMapRef.current.values()).find(
          p => p.agent === subagentEvent.agent && p.status === 'in-progress'
        );

        if (phaseToComplete) {
          phaseToComplete.status = 'completed';
          phaseToComplete.endTime = subagentEvent.timestamp;
          phaseToComplete.output = subagentEvent.data?.output;
          phaseToComplete.metrics = subagentEvent.data?.metrics;

          setState(prev => ({
            ...prev,
            phases: prev.phases.map(p => (p.id === phaseToComplete.id ? phaseToComplete : p)),
          }));
        }
        break;
      }

      case 'phase_error': {
        const phaseToFail = Array.from(phaseMapRef.current.values()).find(
          p => p.agent === subagentEvent.agent && p.status === 'in-progress'
        );

        if (phaseToFail) {
          phaseToFail.status = 'failed';
          phaseToFail.endTime = subagentEvent.timestamp;
          phaseToFail.output = subagentEvent.data?.error;

          setState(prev => ({
            ...prev,
            phases: prev.phases.map(p => (p.id === phaseToFail.id ? phaseToFail : p)),
          }));
        }
        break;
      }

      case 'coordination_update': {
        setState(prev => ({
          ...prev,
          coordination: subagentEvent.data as SubagentCoordination,
          isActive: subagentEvent.data?.phase !== 'complete',
        }));
        break;
      }
    }
  }, []);

  /**
   * Reset tracking state
   */
  const reset = useCallback(() => {
    phaseMapRef.current.clear();
    setState({
      coordination: null,
      phases: [],
      isActive: false,
    });
  }, []);

  /**
   * Get current phase
   */
  const getCurrentPhase = useCallback(() => {
    return state.phases.find(p => p.status === 'in-progress') || null;
  }, [state.phases]);

  /**
   * Get completed phases count
   */
  const getCompletedCount = useCallback(() => {
    return state.phases.filter(p => p.status === 'completed').length;
  }, [state.phases]);

  /**
   * Get failed phases count
   */
  const getFailedCount = useCallback(() => {
    return state.phases.filter(p => p.status === 'failed').length;
  }, [state.phases]);

  /**
   * Check if any phase failed
   */
  const hasFailed = useCallback(() => {
    return state.phases.some(p => p.status === 'failed');
  }, [state.phases]);

  return {
    // State
    ...state,

    // Handlers
    handleStreamEvent,
    reset,

    // Getters
    getCurrentPhase,
    getCompletedCount,
    getFailedCount,
    hasFailed,

    // Computed
    totalDuration:
      state.phases.length > 0 &&
      state.phases[state.phases.length - 1].endTime &&
      state.phases[0].startTime
        ? state.phases[state.phases.length - 1].endTime! - state.phases[0].startTime!
        : 0,
  };
}
