# Backend Event Emission Guide - Multi-Agent System

## Overview

This guide explains how to emit subagent and tool call events from the backend to the frontend for real-time UI updates.

## Event Queue Integration

Events are emitted through the existing `eventQueue` system:

```typescript
eventQueue?.push({
  type: 'subagent_event',
  subagentEventType: 'phase_start',
  // ... other fields
});
```

## Subagent Events

### 1. Phase Start Event

Emit when a phase begins:

```typescript
eventQueue?.push({
  type: 'subagent_event',
  subagentEventType: 'phase_start',
  phase: 'exploration',
  agent: 'exploration_agent',
  data: {
    description: 'Analyzing codebase structure...',
    initialMetrics: {
      filesScanned: 0,
      dependenciesFound: 0
    }
  },
  timestamp: Date.now(),
});
```

**When to emit**: At the start of each subagent execution

**Required fields**:
- `phase`: Name of phase
- `agent`: Agent name (must match AGENTS_META keys)
- `data.description`: Human-readable description

---

### 2. Phase Update Event

Emit periodically during phase execution:

```typescript
eventQueue?.push({
  type: 'subagent_event',
  subagentEventType: 'phase_update',
  phase: 'exploration',
  agent: 'exploration_agent',
  data: {
    output: 'Scanned 42 files, found 15 dependencies...',
    metrics: {
      filesAnalyzed: 42,
      dependenciesFound: 15,
      patternsDetected: 3
    }
  },
  timestamp: Date.now(),
});
```

**When to emit**: During long-running phases, every 1-5 seconds

**Optional fields**:
- `data.output`: Current progress message
- `data.metrics`: Key metrics being tracked

---

### 3. Phase Complete Event

Emit when phase finishes successfully:

```typescript
eventQueue?.push({
  type: 'subagent_event',
  subagentEventType: 'phase_complete',
  phase: 'exploration',
  agent: 'exploration_agent',
  data: {
    output: 'Exploration complete: found 42 files, 15 dependencies, 3 patterns',
    metrics: {
      filesAnalyzed: 42,
      dependenciesFound: 15,
      patternsDetected: 3,
      durationMs: 2500
    }
  },
  timestamp: Date.now(),
});
```

**When to emit**: At successful phase completion

**Best practices**:
- Include final metrics
- Summarize findings
- Include duration

---

### 4. Phase Error Event

Emit when phase encounters an error:

```typescript
eventQueue?.push({
  type: 'subagent_event',
  subagentEventType: 'phase_error',
  phase: 'exploration',
  agent: 'exploration_agent',
  data: {
    error: 'Failed to analyze directory: Permission denied',
    output: 'Analyzed 15 of 42 files before error'
  },
  timestamp: Date.now(),
});
```

**When to emit**: On phase failure

**Required fields**:
- `data.error`: Error message
- `data.output`: Partial results

---

### 5. Coordination Update Event

Emit when coordination state changes:

```typescript
eventQueue?.push({
  type: 'subagent_event',
  subagentEventType: 'coordination_update',
  data: {
    phase: 'planning',
    currentAgent: 'planning_agent',
    completedPhases: ['exploration'],
    sharedContext: {
      codebaseMap: { /* ... */ }
    }
  },
  timestamp: Date.now(),
});
```

**When to emit**: When moving between phases

**Data structure matches**: `SubagentCoordination` interface

---

## Tool Call Events

### 1. Tool Call Start

Emit when tool execution begins:

```typescript
eventQueue?.push({
  type: 'tool_call',
  toolCall: {
    id: crypto.randomUUID(),
    toolName: 'scan_directory_structure',
    status: 'executing',
    startTime: Date.now(),
    args: {
      path: './src',
      maxDepth: 3
    },
    agent: 'exploration_agent'
  },
});
```

**When to emit**: Before tool execution

---

### 2. Tool Call Complete

Emit when tool execution finishes:

```typescript
eventQueue?.push({
  type: 'tool_call_complete',
  toolCall: {
    id: toolCallId,
    status: 'completed',
    endTime: Date.now(),
    result: {
      filesFound: 42,
      directoriesFound: 8,
      totalSize: 524288
    }
  },
});
```

**When to emit**: After tool execution completes

**Duration**: Automatically calculated from `endTime - startTime`

---

### 3. Tool Call Error

Emit when tool execution fails:

```typescript
eventQueue?.push({
  type: 'tool_call_complete',
  toolCall: {
    id: toolCallId,
    status: 'failed',
    endTime: Date.now(),
    error: 'Cannot read directory: EACCES permission denied'
  },
});
```

**When to emit**: On tool execution failure

---

## Implementation Example

### In coding-specialist.ts

```typescript
export const createCodingSpecialistNode = (
  runner: AgentRunner,
  eventQueue?: StreamEvent[],
  missionTracker?: MissionTracker,
  toolDefs?: ToolDefinition[]
) => {
  return async (state: GraphStateType): Promise<Partial<GraphStateType>> => {
    const coordination = state.subagentCoordination || { /* ... */ };

    // PHASE 1: Exploration
    if (coordination.phase === 'exploration' && !coordination.completedPhases.includes('exploration')) {
      // Emit phase start
      eventQueue?.push({
        type: 'subagent_event',
        subagentEventType: 'phase_start',
        phase: 'exploration',
        agent: 'exploration_agent',
        data: {
          description: 'Analyzing codebase structure...'
        },
        timestamp: Date.now(),
      });

      try {
        const explorationAgent = createExplorationAgent(runner, explorationContext, eventQueue);
        const explorationResult = await explorationAgent(state);

        // Emit phase complete
        eventQueue?.push({
          type: 'subagent_event',
          subagentEventType: 'phase_complete',
          phase: 'exploration',
          agent: 'exploration_agent',
          data: {
            output: 'Codebase exploration complete',
            metrics: {
              filesAnalyzed: explorationResult.codebaseMap.complexity.totalFiles,
              patternsDetected: explorationResult.codebaseMap.architecture.patterns.length
            }
          },
          timestamp: Date.now(),
        });

        coordination.sharedContext.codebaseMap = explorationResult.codebaseMap;
        coordination.completedPhases.push('exploration');
        coordination.phase = 'planning';

        // Emit coordination update
        eventQueue?.push({
          type: 'subagent_event',
          subagentEventType: 'coordination_update',
          data: coordination,
          timestamp: Date.now(),
        });

      } catch (error) {
        eventQueue?.push({
          type: 'subagent_event',
          subagentEventType: 'phase_error',
          phase: 'exploration',
          agent: 'exploration_agent',
          data: {
            error: `Exploration failed: ${error instanceof Error ? error.message : String(error)}`
          },
          timestamp: Date.now(),
        });
      }
    }

    // Continue with other phases...
  };
};
```

### In tool execution (e.g., agent-runtime.ts)

```typescript
async function executeTool(toolCall: any, eventQueue?: StreamEvent[]) {
  const toolCallId = crypto.randomUUID();
  const startTime = Date.now();

  // Emit tool call start
  eventQueue?.push({
    type: 'tool_call',
    toolCall: {
      id: toolCallId,
      toolName: toolCall.name,
      status: 'executing',
      startTime,
      args: toolCall.arguments,
      agent: currentAgent,
    },
  });

  try {
    const result = await toolCall.execute(toolCall.arguments);

    // Emit tool call complete
    eventQueue?.push({
      type: 'tool_call_complete',
      toolCall: {
        id: toolCallId,
        status: 'completed',
        endTime: Date.now(),
        result,
      },
    });

    return result;

  } catch (error) {
    eventQueue?.push({
      type: 'tool_call_complete',
      toolCall: {
        id: toolCallId,
        status: 'failed',
        endTime: Date.now(),
        error: error instanceof Error ? error.message : String(error),
      },
    });

    throw error;
  }
}
```

---

## Event Sequencing

Proper event order for a phase:

```
1. PHASE_START
   ↓
2. PHASE_UPDATE (optional, can repeat)
   ↓
3. PHASE_UPDATE (optional)
   ↓
4. COORDINATION_UPDATE (on transition)
   ↓
5. Next PHASE_START
```

Example timeline:

```typescript
00:00 → Phase Start (exploration)
00:05 → Phase Update (metrics: 5 files analyzed)
00:10 → Phase Update (metrics: 15 files analyzed)
00:15 → Phase Update (metrics: 42 files analyzed)
00:20 → Phase Complete (metrics final, patterns found)
00:21 → Coordination Update (phase→planning)
00:21 → Phase Start (planning)
...
```

---

## Best Practices

### 1. Always Pair Events
```typescript
// ✅ Good
eventQueue?.push({ type: 'tool_call', /* start */ });
// ... execute tool
eventQueue?.push({ type: 'tool_call_complete', /* end */ });

// ❌ Bad
eventQueue?.push({ type: 'tool_call', /* start */ });
// No completion event
```

### 2. Include Meaningful Data
```typescript
// ✅ Good
data: {
  description: 'Analyzing imports and dependencies...',
  metrics: { filesScanned: 42, dependenciesFound: 15 }
}

// ❌ Bad
data: {} // Empty data
```

### 3. Use Proper Timestamps
```typescript
// ✅ Good
timestamp: Date.now() // Current time

// ❌ Bad
timestamp: undefined // Missing timestamp
```

### 4. Match Agent Names
```typescript
// ✅ Good - matches AGENTS_META key
agent: 'exploration_agent'

// ❌ Bad - doesn't match AGENTS_META
agent: 'explorer'
```

### 5. Include Duration Info
```typescript
// ✅ Good
metrics: { durationMs: 2500 }

// ❌ Bad
metrics: {} // Missing duration
```

---

## Debugging Events

### Monitor Events in Frontend
```typescript
const subagent = useSubagentTracking(conversationId);

useEffect(() => {
  console.log('Phases:', subagent.phases);
  console.log('Coordination:', subagent.coordination);
}, [subagent.phases, subagent.coordination]);
```

### Log Events in Backend
```typescript
eventQueue?.push({
  type: 'debug',
  message: `Phase transitioning: ${oldPhase} → ${newPhase}`,
  timestamp: Date.now(),
});
```

### Validate Event Structure
```typescript
function validateSubagentEvent(event: any): boolean {
  return (
    event.type === 'subagent_event' &&
    ['phase_start', 'phase_update', 'phase_complete', 'phase_error', 'coordination_update'].includes(event.subagentEventType) &&
    event.timestamp &&
    typeof event.timestamp === 'number'
  );
}
```

---

## Performance Considerations

### Event Batching
```typescript
// Instead of:
for (const item of items) {
  eventQueue?.push({ /* event */ });
}

// Do:
const events = items.map(item => ({ /* event */ }));
eventQueue?.push(...events);
```

### Throttle Updates
```typescript
// Emit detailed updates every 2-5 seconds, not continuously
const updateInterval = setInterval(() => {
  eventQueue?.push({
    type: 'subagent_event',
    subagentEventType: 'phase_update',
    data: getCurrentMetrics(),
    timestamp: Date.now(),
  });
}, 3000);
```

### Limit Metrics Size
```typescript
// ✅ Good - compact metrics
metrics: { filesAnalyzed: 42, duration: 2500 }

// ❌ Bad - huge metrics object
metrics: {
  allFiles: [ /* 1000+ items */ ],
  detailedLog: 'very long string...'
}
```

---

## Testing Event Emission

```typescript
// Test helper
function createMockEventQueue() {
  const events: any[] = [];
  return {
    push: (event: any) => events.push(event),
    events,
    clear: () => events.length = 0,
  };
}

// Usage
const eventQueue = createMockEventQueue();
const result = await createCodingSpecialistNode(runner, eventQueue, tracker, tools)(state);

// Verify events
expect(eventQueue.events).toContainEqual(
  expect.objectContaining({
    type: 'subagent_event',
    subagentEventType: 'phase_start',
  })
);
```

---

## Troubleshooting

### Events not appearing in UI
1. Verify `eventQueue` is passed to all functions
2. Check event structure matches spec
3. Verify `type` and `subagentEventType` are correct
4. Ensure `timestamp` is a number

### Wrong phase displayed
1. Check `agent` name matches AGENTS_META keys
2. Verify coordination update is sent on phase transition
3. Check phase name is correct

### Metrics not updating
1. Include `metrics` object in event data
2. Use consistent metric keys across phases
3. Verify numeric values, not strings

---

## Event Reference

See `SubagentPanel.tsx` and `ToolCallDetailPane.tsx` for frontend event handling.

See `useSubagentTracking.ts` for event processing logic.

---

**Status**: Ready for Implementation
**Version**: 1.0.0
**Last Updated**: June 2, 2026
