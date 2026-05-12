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
      console.warn('[useDebateStream] Received malformed debate event:', event);
      return;
    }

    console.log('[useDebateStream] ✅ Received debate event:', event.type, 'debateId:', event.debateId);

    switch (event.type) {
      case 'debate_start':
        console.log('[useDebateStream] 🎭 DEBATE STARTING — setting isDebating=true');
        setState(prev => ({
          ...prev,
          isDebating: true,
          lastDebateId: event.debateId,
          // Clear previous debate data for fresh start
          currentDebate: null,
        }));
        break;

      case 'debate_skipped':
        console.log('[useDebateStream] ⏭️ Debate skipped');
        setState(prev => ({
          ...prev,
          isDebating: false,
        }));
        break;

      case 'vanguard_complete':
      case 'phantom_complete':
      case 'arbiter_complete':
        console.log('[useDebateStream] 📊 Phase complete:', event.type);
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
        console.log('[useDebateStream] ✅ Debate complete — setting isDebating=false');
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
        console.log('[useDebateStream] Unknown debate event type:', event.type);
    }
  }, []);

  useEffect(() => {
    // Prevent double-registration
    if (listenerRef.current) return;

    const hasAPI = typeof window !== 'undefined' && !!(window as any).electronAPI?.acp?.onDebateStream;
    console.log('[useDebateStream] Hook mounted, electronAPI.acp.onDebateStream available:', hasAPI);

    if (hasAPI) {
      listenerRef.current = true;
      (window as any).electronAPI.acp.onDebateStream(handleDebateEvent);

      return () => {
        console.log('[useDebateStream] Cleaning up listener');
        listenerRef.current = false;
        (window as any).electronAPI?.acp?.removeDebateStreamListener?.();
      };
    }
  }, [handleDebateEvent]);

  return {
    debate: state.currentDebate,
    isDebating: state.isDebating,
  };
}

