/**
 * Hook for listening to debate stream events from the main process
 */

'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import type { DebateStreamEvent, DebateDisplayData } from '../types/debate-types';

interface DebateState {
  currentDebate: DebateDisplayData | null;
  isDebating: boolean;
  lastDebateId: string | null;
}

export function useDebateStream() {
  const [state, setState] = useState<DebateState>({
    currentDebate: null,
    isDebating: false,
    lastDebateId: null,
  });

  // Use a ref to track if listener is registered (prevents double-register)
  const listenerRef = useRef(false);

  const handleDebateEvent = useCallback((event: DebateStreamEvent) => {
    // Safety check: skip malformed events
    if (!event || !event.type) {
      return;
    }

    switch (event.type) {
      case 'debate_start':
        setState(prev => ({
          ...prev,
          isDebating: true,
          lastDebateId: event.debateId,
          // Clear previous debate data for fresh start
          currentDebate: null,
        }));
        break;

      case 'debate_skipped':
        setState(prev => ({
          ...prev,
          isDebating: false,
          lastDebateId: event.debateId || prev.lastDebateId,
          currentDebate: null,
        }));
        break;

      case 'vanguard_complete':
      case 'phantom_complete':
      case 'arbiter_complete':
        if (event.data) {
          setState(prev => ({
            ...prev,
            // Ensure isDebating stays true during phases
            isDebating: true,
            currentDebate: event.data as DebateDisplayData,
          }));
        }
        break;

      case 'debate_complete':
        if (event.data) {
          setState(prev => ({
            ...prev,
            currentDebate: event.data as DebateDisplayData,
            isDebating: false,
          }));
        } else {
          setState(prev => ({
            ...prev,
            isDebating: false,
          }));
        }
        break;

      case 'debate_error':
        console.error('[useDebateStream] ❌ Debate error:', event.error);
        setState(prev => ({
          ...prev,
          isDebating: false,
        }));
        break;

      default:
        // No log for unknown
    }
  }, []);

  const skipDebate = useCallback(async (debateId?: string | null) => {
    const id = debateId || state.lastDebateId;
    if (!id) return { success: false };

    const api = (window as any).electronAPI?.acp;
    if (!api?.skipDebate) return { success: false };

    setState(prev => ({ ...prev, isDebating: false, currentDebate: null }));
    return api.skipDebate(id);
  }, [state.lastDebateId]);

  useEffect(() => {
    // Prevent double-registration
    if (listenerRef.current) return;

    const hasAPI = typeof window !== 'undefined' && !!(window as any).electronAPI?.acp?.onDebateStream;

    if (hasAPI) {
      listenerRef.current = true;
      (window as any).electronAPI.acp.onDebateStream(handleDebateEvent);

      return () => {
        listenerRef.current = false;
        (window as any).electronAPI?.acp?.removeDebateStreamListener?.();
      };
    }
  }, [handleDebateEvent]);

  return {
    debate: state.currentDebate,
    isDebating: state.isDebating,
    lastDebateId: state.lastDebateId,
    skipDebate,
  };
}

