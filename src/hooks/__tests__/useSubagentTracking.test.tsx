import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useSubagentTracking } from '../useSubagentTracking';

const phaseStart = (agentId: string, description: string) => ({
  type: 'subagent_event',
  subagentEventType: 'phase_start',
  phase: 'coding-specialist',
  agent: 'coding-specialist',
  data: {
    agentId,
    description,
    initialMetrics: { mode: 'parallel' },
  },
});

const phaseComplete = (agentId: string, output: string) => ({
  type: 'subagent_event',
  subagentEventType: 'phase_complete',
  phase: 'coding-specialist',
  agent: 'coding-specialist',
  data: {
    agentId,
    output,
  },
});

describe('useSubagentTracking', () => {
  it('tracks concurrent sub-agents with the same type by agentId', () => {
    const { result } = renderHook(() => useSubagentTracking('chat-1'));

    act(() => {
      result.current.handleStreamEvent(phaseStart('agent-a', 'Implement feature A'));
      result.current.handleStreamEvent(phaseStart('agent-b', 'Implement feature B'));
    });

    expect(result.current.isActive).toBe(true);
    expect(result.current.phases).toHaveLength(2);
    expect(result.current.phases.map(p => p.id)).toEqual(['agent-a', 'agent-b']);
    expect(result.current.phases.map(p => p.description)).toEqual(['Implement feature A', 'Implement feature B']);

    act(() => {
      result.current.handleStreamEvent(phaseComplete('agent-a', 'Feature A done'));
    });

    expect(result.current.isActive).toBe(true);
    expect(result.current.phases.find(p => p.id === 'agent-a')?.status).toBe('completed');
    expect(result.current.phases.find(p => p.id === 'agent-b')?.status).toBe('in-progress');

    act(() => {
      result.current.handleStreamEvent(phaseComplete('agent-b', 'Feature B done'));
    });

    expect(result.current.isActive).toBe(false);
    expect(result.current.phases.every(p => p.status === 'completed')).toBe(true);
  });
});
