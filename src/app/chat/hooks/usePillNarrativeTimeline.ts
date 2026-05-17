/**
 * Hook for managing pill-based narrative timeline state
 *
 * Provides integration between the chat page and the pill-based timeline system.
 * Handles timeline initialization, updates, and event subscriptions.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { NarrativeTimeline } from '../../../main/agent/runner/pill-narrative/types';
import { getPillTimelineIntegration } from '../../../main/agent/runner/pill-narrative/integration';

/**
 * Hook for managing pill-based timeline
 */
export function usePillNarrativeTimeline(missionId: string | null) {
  const [timeline, setTimeline] = useState<NarrativeTimeline | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  // Subscribe to timeline updates
  useEffect(() => {
    if (!missionId) {
      setTimeline(null);
      return;
    }

    try {
      const integration = getPillTimelineIntegration();
      const currentTimeline = integration.getTimeline(missionId);

      if (currentTimeline) {
        setTimeline(currentTimeline);
        setIsRunning(currentTimeline.status === 'in-progress');

        // Subscribe to updates
        unsubscribeRef.current = integration.onTimelineUpdate(missionId, (updatedTimeline) => {
          setTimeline(updatedTimeline);
          setIsRunning(updatedTimeline.status === 'in-progress');
        });
      }
    } catch (err) {
      console.warn('[usePillNarrativeTimeline] Failed to get integration:', err);
    }

    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
    };
  }, [missionId]);

  return {
    timeline,
    isRunning,
  };
}

/**
 * Hook for managing pill-based timeline initialization
 */
export function usePillTimelineInitialization(missionId: string | null, userRequest: string | null) {
  const initializationRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!missionId || !userRequest || initializationRef.current.has(missionId)) {
      return;
    }

    initializationRef.current.add(missionId);

    (async () => {
      try {
        const { initializePillTimelineIntegration } = await import(
          '../../../main/agent/runner/pill-narrative/integration'
        );
        const { getPooledAIClient } = await import('../../../lib/ai-client');

        // Get or create AI client
        const client = getPooledAIClient({
          provider: 'anthropic' as any,
          model: 'claude-3-5-sonnet-20241022',
        });

        // Initialize integration
        const integration = initializePillTimelineIntegration(client);

        // Initialize timeline
        await integration.initializeTimeline(missionId, userRequest);
      } catch (err) {
        console.warn('[usePillTimelineInitialization] Failed to initialize timeline:', err);
      }
    })();
  }, [missionId, userRequest]);
}

/**
 * Hook for tracking tool calls in the pill-based timeline
 */
export function usePillTimelineToolTracking(missionId: string | null) {
  const trackToolCall = useCallback(
    (taskId: string, pillId: string, toolCallId: string, toolName: string, parameters: Record<string, any>) => {
      if (!missionId) return;

      try {
        const integration = getPillTimelineIntegration();
        integration.trackToolCall(missionId, taskId, pillId, toolCallId, toolName, parameters);
      } catch (err) {
        console.warn('[usePillTimelineToolTracking] Failed to track tool call:', err);
      }
    },
    [missionId]
  );

  const completeToolCall = useCallback(
    (toolCallId: string, result: string, error?: string) => {
      try {
        const integration = getPillTimelineIntegration();
        integration.completeToolCall(toolCallId, result, error);
      } catch (err) {
        console.warn('[usePillTimelineToolTracking] Failed to complete tool call:', err);
      }
    },
    []
  );

  return {
    trackToolCall,
    completeToolCall,
  };
}
