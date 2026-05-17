# Pill-Based Narrative Timeline System

## Overview

The Pill-Based Narrative Timeline System represents agent execution as a sequence of **tasks**, where each task contains **tool pills** representing the tools executed for that task.

**Structure:**
```
Task 1: Search for Discord bots
├── 🔍 web_search [done]
├── 🌐 browser_use [done]
└── 📄 read_file [done]

Task 2: Analyze results
├── 💭 python_execute [in-progress]
└── 📝 write_file [pending]
```

**Interaction:**
- Click on a tool pill → Opens the **Tool Detail Side Panel** showing tool parameters, results, and errors
- Task title shows the business-level goal
- Pills show which tools were used and their status

## Architecture

### Core Components

#### `types.ts`
Defines the data structures:
- **ToolPill** - Individual tool execution (web_search, browser_use, read_file, etc.)
- **Task** - Collection of tool pills with a title and description
- **NarrativeTimeline** - Complete execution timeline with tasks
- **ValidationError** - Validation result details

#### `validators.ts`
Provides validation and consistency checking:
- `isValidStatusTransition()` - Validates state machine transitions
- `validatePill()` - Validates individual pills
- `validateTask()` - Validates tasks and their pills
- `validateTimeline()` - Validates complete timelines
- `calculateTaskStatus()` - Computes task status from pills
- `calculateTimelineStatus()` - Computes timeline status from tasks
- `getParallelizablePills()` - Identifies pills that can execute in parallel
- `canExecutePill()` - Checks if a pill's dependencies are satisfied

#### `manager.ts`
Provides the main API:
- `PillNarrativeTimelineManager` - Manages timeline lifecycle
- `create()` - Create a new timeline
- `getTimeline()` - Retrieve a timeline
- `updatePillStatus()` - Update a pill's status (with automatic propagation)
- `addPill()` - Add a pill to a task
- `addTask()` - Add a task to a timeline
- `onUpdate()` - Subscribe to timeline changes
- `onPillStatusChange()` - Subscribe to pill status changes
- `onTaskStatusChange()` - Subscribe to task status changes

## Data Model

### ToolPill Structure
```typescript
{
  id: "pill-web-search-1",
  toolName: "web_search",
  status: "completed",
  icon: "🔍",
  label: "Search",
  parameters: {
    query: "best Discord bots 2024"
  },
  result: "Found 5 relevant sources",
  startTime: 1234567890,
  endTime: 1234567900,
  dependsOn: []
}
```

### Task Structure
```typescript
{
  id: "task-1",
  title: "Search for Discord bots",
  description: "Find the best news Discord bots available",
  pills: [...],
  status: "completed",
  startTime: 1234567890,
  endTime: 1234567900
}
```

### Timeline Structure
```typescript
{
  missionId: "mission-1",
  tasks: [...],
  status: "in-progress",
  startTime: 1234567890,
  metadata: {
    userRequest: "Find the best news Discord bot",
    agent: "web-explorer",
    model: "claude-3-5-sonnet"
  }
}
```

## Status Propagation

Status automatically propagates up the hierarchy:

1. **Pill Status Changes** → Updates task status
2. **Task Status Changes** → Updates timeline status

### Status Calculation Rules

For a parent to be:
- **completed**: All children must be completed
- **failed**: Any child must be failed
- **in-progress**: Any child must be in-progress (and none failed)
- **skipped**: All children must be skipped
- **pending**: Default state

### Valid State Transitions

```
pending → in-progress → completed
pending → in-progress → failed
pending → skipped
```

No other transitions are allowed.

## Dependency Management

Pills can depend on other pills:

```typescript
{
  id: "pill-analyze-1",
  toolName: "python_execute",
  dependsOn: ["pill-web-search-1"]  // Must wait for search to complete
}
```

### Parallelization

Pills with no dependencies can execute in parallel:

```typescript
const parallelPills = getParallelizablePills(task.pills);
// Execute these concurrently
```

## Validation

The system validates:

1. **Structure Integrity**
   - All required fields present
   - Valid status values
   - Valid parent-child relationships

2. **Consistency**
   - No circular dependencies
   - Status matches children status
   - Valid state transitions

3. **Completeness**
   - All pills have tool names
   - All tasks have titles
   - All timelines have mission IDs

## Usage Example

```typescript
import {
  createPillNarrativeTimelineManager,
  NarrativeTimeline,
  ToolPill,
  Task,
} from './pill-narrative';

// Create manager
const manager = createPillNarrativeTimelineManager();

// Create timeline
const timeline: NarrativeTimeline = {
  missionId: 'mission-1',
  tasks: [],
  status: 'pending',
  startTime: Date.now(),
};

manager.create('mission-1', timeline);

// Add a task
const task: Task = {
  id: 'task-1',
  title: 'Search for Discord bots',
  description: 'Find the best news Discord bots',
  pills: [],
  status: 'pending',
};

manager.addTask('mission-1', task);

// Add a pill (tool execution)
const pill: ToolPill = {
  id: 'pill-1',
  toolName: 'web_search',
  status: 'pending',
  icon: '🔍',
  label: 'Search',
  parameters: { query: 'best Discord bots' },
};

manager.addPill('mission-1', 'task-1', pill);

// Subscribe to updates
manager.onUpdate('mission-1', (timeline) => {
  console.log('Timeline updated:', timeline);
});

// Update pill status
manager.updatePillStatus('mission-1', 'task-1', 'pill-1', 'in-progress');
manager.updatePillStatus('mission-1', 'task-1', 'pill-1', 'completed', 'Found 5 sources');
```

## Integration with UI

### Task Display
- Show task title as the main heading
- Display pills below the task title
- Show task status indicator

### Pill Display
- Show tool icon and label
- Show status badge (done, in-progress, pending, failed)
- Make clickable to open Tool Detail Side Panel

### Tool Detail Side Panel
- Show when a pill is clicked
- Display tool name, parameters, result, and error
- Allow user to inspect tool execution details

## Correctness Properties

### Property 1: Task Invariant
Every pill must have exactly one parent task, and every task must have exactly one parent timeline.

### Property 2: Status Propagation
Status must propagate correctly through the hierarchy without regression.

### Property 3: Dependency Resolution
Pills with dependencies must execute after their dependencies complete.

### Property 4: Tool Abstraction
Tool pills are the primary display unit; tool details are shown on demand in the side panel.

## Performance Considerations

- Status propagation is O(n) where n is the number of pills in a task
- Dependency checking is O(n²) in worst case but typically O(n)
- Validation is O(n) for structure checks and O(n²) for circular dependency detection
- Memory usage is proportional to the number of pills and tasks

## Future Enhancements

1. **Branching Narratives** - Support conditional execution paths
2. **Nested Tasks** - Allow tasks within tasks for deeper hierarchies
3. **Narrative Generation** - Auto-generate task titles from tool execution
4. **Timeline Compression** - Collapse similar consecutive pills
5. **Export/Import** - Serialize and deserialize timelines to/from JSON
