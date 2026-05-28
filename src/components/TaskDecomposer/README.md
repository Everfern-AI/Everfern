# Task Decomposer Narrative UI

This module implements a hierarchical narrative UI that integrates task decomposition with tool call execution. It transforms a flat timeline of tool calls into a hierarchical view where tasks (from the task decomposer) appear as collapsible sections containing their associated tool calls as nested children.

## Directory Structure

```
TaskDecomposer/
├── types.ts                          # Type definitions and interfaces
├── TaskToolMapper.interface.ts        # ITaskToolMapper interface definition
├── TaskToolMapper.ts                 # TaskToolMapper implementation
├── TaskHeader.tsx                    # Task header component
├── TaskSection.tsx                   # Task section component (collapsible)
├── ToolCallGroup.tsx                 # Tool call group component
├── TimelineRenderer.tsx               # Main timeline renderer component
├── __tests__/
│   ├── test-utils.ts                 # Test utilities and factories
│   ├── TaskToolMapper.test.ts         # TaskToolMapper unit tests
│   ├── TaskToolMapper.property.test.ts # TaskToolMapper property tests
│   ├── TaskHeader.test.tsx            # TaskHeader component tests
│   ├── TaskSection.test.tsx           # TaskSection component tests
│   ├── ToolCallGroup.test.tsx         # ToolCallGroup component tests
│   ├── TimelineRenderer.test.tsx      # TimelineRenderer component tests
│   └── integration.test.tsx           # Integration tests
└── README.md                         # This file
```

## Key Components

### TaskToolMapper
Maps tool calls to their corresponding task steps during streaming execution. Handles:
- Initialization with decomposed tasks
- Tool call mapping to task steps
- Task step progression
- Out-of-order tool call handling
- State serialization/deserialization

### TaskHeader
Renders the header for a task section with:
- Task title (prominent, larger font)
- Status indicator (color-coded)
- Tool count badge
- Metadata badges (complexity, priority, execution mode)
- Expand/collapse chevron

### TaskSection
Renders a collapsible task section with:
- TaskHeader with expand/collapse toggle
- Nested tool calls when expanded
- Summary display when collapsed
- Status updates

### ToolCallGroup
Groups and renders tool calls for a single task with:
- Proper indentation (20px+)
- Parallel execution indicator
- Maintains existing tool call functionality

### TimelineRenderer
Orchestrates rendering of hierarchical or flat timeline:
- Detects decomposed task availability
- Initializes TaskToolMapper if needed
- Renders hierarchical or flat timeline accordingly
- Handles streaming updates

## Usage

### Basic Usage with Decomposed Task

```tsx
import { TimelineRenderer } from './TimelineRenderer';
import type { DecomposedTask } from '@/main/agent/runner/state';

const MyComponent = () => {
  const decomposedTask: DecomposedTask = {
    id: 'task-1',
    title: 'Research and Analysis',
    steps: [
      {
        id: 'step-1',
        title: 'Search for information',
        description: 'Search the web for relevant information',
        tool: 'web-search',
        canParallelize: false,
      },
      // ... more steps
    ],
    totalSteps: 2,
    canParallelize: false,
    executionMode: 'sequential',
  };

  const toolCalls = [
    {
      id: 'call-1',
      toolName: 'web-search',
      status: 'done',
      output: 'Search results...',
    },
    // ... more tool calls
  ];

  return (
    <TimelineRenderer
      toolCalls={toolCalls}
      decomposedTask={decomposedTask}
      isLive={true}
    />
  );
};
```

### Backward Compatible Usage (No Decomposed Task)

```tsx
// When decomposedTask is null, TimelineRenderer falls back to flat timeline
<TimelineRenderer
  toolCalls={toolCalls}
  decomposedTask={null}
  isLive={true}
/>
```

## Features

### Hierarchical Display
- Tasks appear as collapsible sections
- Tool calls are nested under their corresponding tasks
- Clear visual hierarchy with indentation and styling

### Streaming Updates
- Tool calls appear in real-time under their tasks
- Status updates without full re-renders
- Smooth animations for expand/collapse

### Backward Compatibility
- Works with or without decomposed tasks
- Graceful fallback to flat timeline
- No breaking changes to existing functionality

### State Management
- Maintains task-to-tool mappings during execution
- Handles out-of-order tool call arrivals
- Preserves expand/collapse state during session

### Serialization
- Serialize task-tool mappings to JSON
- Deserialize for state persistence
- Round-trip property: serialize → deserialize produces equivalent state

## Testing

### Unit Tests
- TaskToolMapper: mapping, status updates, serialization
- TaskHeader: rendering, metadata display
- TaskSection: expand/collapse, nested rendering
- ToolCallGroup: indentation, parallel display

### Property-Based Tests
- Task-Tool Mapping Consistency
- Hierarchical Rendering Accuracy
- Task Status Propagation
- Collapse/Expand State Preservation
- Tool Call Order Preservation
- Backward Compatibility Invariant
- Mixed Mode Graceful Degradation
- Serialization Round-Trip
- Metadata Display Completeness
- Parallel Tool Call Display
- Unmapped Tool Call Handling
- Task Metadata Graceful Degradation

### Integration Tests
- Full execution flow with decomposed task
- Tool calls arriving out of order
- Task failure handling
- Parallel tool call execution
- Mixed decomposed and non-decomposed execution
- Backward compatibility with existing flows

## Performance Considerations

- React.memo for TaskSection to prevent unnecessary re-renders
- Keys on tool call lists for efficient updates
- Lazy rendering of tool call details
- Debounced rapid status updates
- Map-based lookups for O(1) performance

## Future Enhancements

- Task filtering by status or type
- Task search functionality
- Execution timeline with duration visualization
- Parallel execution visualization
- Task replay capability
- Export as report or log
