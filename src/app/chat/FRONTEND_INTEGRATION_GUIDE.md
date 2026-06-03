# Frontend Integration Guide - Multi-Agent Coding System

## Overview

This guide explains how to integrate the new multi-agent UI components into the existing chat interface.

## New Components

### 1. SubagentPanel
**Location**: `components/SubagentPanel.tsx`

Displays multi-agent system progress with phase cards, metrics, and status tracking.

**Usage**:
```tsx
import { SubagentPanel } from '@/app/chat/components/SubagentPanel';

<SubagentPanel
  coordination={coordinationState}
  phases={phasesList}
/>
```

**Props**:
- `coordination: SubagentCoordination` - Current coordination state
- `phases: SubagentPhase[]` - List of phase executions

**Features**:
- Real-time phase progress
- Status badges (pending, in-progress, completed, failed)
- Expandable phase cards with output/metrics
- Summary stats (completed, in-progress, failed count)

---

### 2. ToolCallDetailPane
**Location**: `components/ToolCallDetailPane.tsx`

Shows detailed information about individual tool calls with input/output/timeline tabs.

**Usage**:
```tsx
import { ToolCallDetailPane } from '@/app/chat/components/ToolCallDetailPane';

<ToolCallDetailPane
  toolCall={selectedToolCall}
  onClose={() => setSelectedToolCall(null)}
/>
```

**Props**:
- `toolCall: ToolCallDetail` - Tool call to display
- `onClose: () => void` - Close handler

**Features**:
- Input arguments display
- Output/error display
- Timeline view
- Copy buttons for JSON
- Status badge with duration

---

### 3. useSubagentTracking Hook
**Location**: `hooks/useSubagentTracking.ts`

React hook for tracking multi-agent system events from stream.

**Usage**:
```tsx
import { useSubagentTracking } from '@/hooks/useSubagentTracking';

const subagent = useSubagentTracking(conversationId);

// In stream event handler:
subagent.handleStreamEvent(event);

// Access state:
console.log(subagent.coordination, subagent.phases);

// Reset when conversation ends:
subagent.reset();
```

**API**:
```typescript
{
  // State
  coordination: SubagentCoordination | null;
  phases: SubagentPhase[];
  isActive: boolean;

  // Handlers
  handleStreamEvent: (event: any) => void;
  reset: () => void;

  // Getters
  getCurrentPhase: () => SubagentPhase | null;
  getCompletedCount: () => number;
  getFailedCount: () => number;
  hasFailed: () => boolean;
  totalDuration: number;
}
```

---

## Integration Steps

### Step 1: Update Chat Component

In your main chat component (e.g., `ChatView.tsx` or `ChatPage.tsx`):

```tsx
import { SubagentPanel } from '@/app/chat/components/SubagentPanel';
import { ToolCallDetailPane } from '@/app/chat/components/ToolCallDetailPane';
import { useSubagentTracking } from '@/hooks/useSubagentTracking';

export function ChatView() {
  const subagent = useSubagentTracking(conversationId);
  const [selectedToolCall, setSelectedToolCall] = useState(null);
  const [showSubagentPanel, setShowSubagentPanel] = useState(false);

  // Handle stream events
  useEffect(() => {
    if (eventQueue && eventQueue.length > 0) {
      eventQueue.forEach(event => {
        // Route to subagent tracking
        if (event.type.includes('subagent')) {
          subagent.handleStreamEvent(event);
        }
        // Route to tool call detail
        if (event.type === 'tool_call') {
          // Convert to ToolCallDetail format
          const detail: ToolCallDetail = {
            id: event.toolCall.id,
            toolName: event.toolCall.toolName,
            status: event.toolCall.status,
            startTime: event.toolCall.startTime,
            endTime: event.toolCall.endTime,
            arguments: event.toolCall.args,
            result: event.toolCall.result,
            error: event.toolCall.error,
          };
          setSelectedToolCall(detail);
        }
      });
    }
  }, [eventQueue]);

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      {/* Main chat area */}
      <div style={{ flex: 1 }}>
        {/* Chat messages */}
      </div>

      {/* Sidebar with panels */}
      <div style={{ width: 380, borderLeft: '1px solid #e8e8e6', display: 'flex', flexDirection: 'column' }}>
        {/* Tab switcher */}
        <div style={{ display: 'flex', borderBottom: '1px solid #e8e8e6', padding: '8px 12px', gap: 8 }}>
          <button
            onClick={() => { setShowSubagentPanel(true); setSelectedToolCall(null); }}
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              border: 'none',
              background: showSubagentPanel && !selectedToolCall ? '#f0f0ee' : 'transparent',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            Agents
          </button>
          {selectedToolCall && (
            <button
              onClick={() => setShowSubagentPanel(false)}
              style={{
                padding: '6px 12px',
                borderRadius: 6,
                border: 'none',
                background: !showSubagentPanel ? '#f0f0ee' : 'transparent',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              Tool Call
            </button>
          )}
        </div>

        {/* Panel content */}
        {showSubagentPanel && subagent.isActive ? (
          <SubagentPanel
            coordination={subagent.coordination!}
            phases={subagent.phases}
          />
        ) : selectedToolCall ? (
          <ToolCallDetailPane
            toolCall={selectedToolCall}
            onClose={() => setSelectedToolCall(null)}
          />
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#a8a8a3', fontSize: 12 }}>
            Select a panel to view details
          </div>
        )}
      </div>
    </div>
  );
}
```

### Step 2: Stream Event Handling

Update your stream event handler to emit subagent events:

```typescript
// In backend event stream handler
function handleStreamEvent(event: StreamEvent) {
  // Forward to frontend
  if (event.type === 'subagent_phase_start') {
    eventQueue.push({
      type: 'subagent_event',
      subagentEventType: 'phase_start',
      phase: event.phase,
      agent: event.agent,
      data: { description: event.description },
      timestamp: Date.now(),
    });
  }

  if (event.type === 'subagent_phase_complete') {
    eventQueue.push({
      type: 'subagent_event',
      subagentEventType: 'phase_complete',
      phase: event.phase,
      agent: event.agent,
      data: { output: event.output, metrics: event.metrics },
      timestamp: Date.now(),
    });
  }

  if (event.type === 'coordination_update') {
    eventQueue.push({
      type: 'subagent_event',
      subagentEventType: 'coordination_update',
      data: event.coordination,
      timestamp: Date.now(),
    });
  }
}
```

### Step 3: Tool Call Integration

When a tool call executes, create a ToolCallDetail event:

```typescript
// In tool execution handler
const toolCallDetail = {
  id: crypto.randomUUID(),
  toolName: 'my_tool',
  status: 'executing' as const,
  startTime: Date.now(),
  arguments: toolArgs,
  agent: currentAgent,
};

eventQueue.push({
  type: 'tool_call',
  toolCall: {
    id: toolCallDetail.id,
    toolName: toolCallDetail.toolName,
    status: toolCallDetail.status,
    startTime: toolCallDetail.startTime,
    args: toolCallDetail.arguments,
  },
});

// After execution:
eventQueue.push({
  type: 'tool_call_complete',
  toolCall: {
    id: toolCallDetail.id,
    status: 'completed',
    result: toolResult,
    endTime: Date.now(),
  },
});
```

### Step 4: Styling Consistency

The components use a theme system. Ensure your app provides the same design tokens:

```tsx
const theme = {
  colors: {
    bg: '#fafafa',
    surface: '#fff',
    border: '#e8e8e6',
    text: '#141412',
    textMuted: '#a8a8a3',
    green: '#22c55e',
    blue: '#3b82f6',
    red: '#ef4444',
  },
  radius: {
    r8: 8,
    r12: 12,
  },
  fonts: {
    sans: '"Geist", "DM Sans", ui-sans-serif, system-ui, sans-serif',
    mono: '"Geist Mono", ui-monospace, monospace',
  },
};
```

## Event Flow Diagram

```
Backend Stream Events
        ↓
Chat Event Handler
        ├→ subagent_phase_start → useSubagentTracking.handleStreamEvent()
        ├→ subagent_phase_update → useSubagentTracking.handleStreamEvent()
        ├→ subagent_phase_complete → useSubagentTracking.handleStreamEvent()
        ├→ coordination_update → useSubagentTracking.handleStreamEvent()
        ├→ tool_call → setSelectedToolCall()
        └→ tool_call_complete → update ToolCallDetail
        ↓
Frontend State Update
        ↓
Component Re-render
        ├→ SubagentPanel (if subagent.isActive)
        └→ ToolCallDetailPane (if selectedToolCall)
```

## Stream Event Types

### SubagentEvent

```typescript
{
  type: 'subagent_event',
  subagentEventType: 'phase_start' | 'phase_update' | 'phase_complete' | 'phase_error' | 'coordination_update',
  phase?: string,
  agent?: string,
  data?: {
    description?: string,
    output?: string,
    metrics?: Record<string, any>,
    error?: string,
  },
  timestamp: number,
}
```

### ToolCallEvent

```typescript
{
  type: 'tool_call' | 'tool_call_complete',
  toolCall: {
    id: string,
    toolName: string,
    status: 'executing' | 'completed' | 'failed',
    startTime: number,
    endTime?: number,
    args?: Record<string, any>,
    result?: any,
    error?: string,
    agent?: string,
  },
}
```

## Testing Components Locally

```tsx
// Mock data for testing
const mockCoordination: SubagentCoordination = {
  phase: 'implementation',
  currentAgent: 'worker_agent',
  completedPhases: ['exploration', 'planning'],
  sharedContext: {},
};

const mockPhases: SubagentPhase[] = [
  {
    id: '1',
    name: 'exploration',
    status: 'completed',
    agent: 'exploration_agent',
    description: 'Analyze codebase',
    startTime: Date.now() - 30000,
    endTime: Date.now() - 20000,
    output: 'Found 42 files...',
    metrics: { filesAnalyzed: 42, patterns: 5 },
  },
  // ... more phases
];

// Test component
<SubagentPanel coordination={mockCoordination} phases={mockPhases} />
```

## Performance Considerations

1. **Memoization**: SubagentPanel and ToolCallDetailPane are memoized to prevent unnecessary re-renders
2. **Virtual Scrolling**: For large phase lists, consider using react-window
3. **Event Batching**: Batch phase updates to reduce re-renders
4. **State Management**: Use localStorage to persist subagent state across page reloads

## Accessibility

- All buttons have proper ARIA labels
- Color not the only indicator of status (also uses icons and text)
- Keyboard navigation support for panels
- Proper heading hierarchy and semantic HTML

## Browser Support

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+

Components use modern CSS (flexbox, grid, CSS variables) without fallbacks.

## Troubleshooting

### Panel not showing
- Check if `subagent.isActive` is true
- Verify stream events are being emitted correctly
- Check browser console for errors

### Tool call details not updating
- Ensure event IDs match between start and complete events
- Check event timestamp format
- Verify tool call data structure matches ToolCallDetail interface

### Performance issues
- Monitor React DevTools Profiler
- Check for unnecessary re-renders
- Consider memoizing parent components
- Batch event updates

## Future Enhancements

- [ ] Export phase data as JSON/CSV
- [ ] Real-time metrics dashboard
- [ ] Tool call replay feature
- [ ] Phase dependency visualization
- [ ] Integration with dev tools
- [ ] Historical comparison view
