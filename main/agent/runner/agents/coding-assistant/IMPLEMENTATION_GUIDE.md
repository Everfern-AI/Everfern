# Multi-Agent Coding System - Implementation Guide

## Overview

This guide details how to integrate and extend the multi-agent coding system in EverFern Desktop.

## Integration with Brain Router

### Routing Flow

```
User: "Build a user authentication system"
  ↓
Brain analyzes intent
  ↓
Brain routing decision: "route_coding"
  ↓
Graph routes to: coding_specialist node
  ↓
Coding Specialist:
  - Activates multi-agent system
  - Orchestrates 5 specialized subagents
  - Manages state coordination
  - Returns to brain when complete
```

### Code Integration

The multi-agent system is automatically invoked in `createCodingSpecialistNode`:

```typescript
// In coding-specialist.ts
export const createCodingSpecialistNode = (
  runner: AgentRunner,
  eventQueue?: StreamEvent[],
  missionTracker?: MissionTracker,
  toolDefs?: ToolDefinition[]
) => {
  return async (state: GraphStateType): Promise<Partial<GraphStateType>> => {
    // Initialize coordination
    const coordination: SubagentCoordination = state.subagentCoordination || {
      phase: 'exploration',
      currentAgent: 'coding_specialist',
      completedPhases: [],
      sharedContext: {}
    };

    // Phase 1: Exploration
    // Phase 2: Planning
    // Phase 3: Implementation
    // Phase 4: Review
    // Phase 5: Testing
    // Complete
  };
};
```

## State Management

### Adding Subagent Coordination to Graph State

The state already includes:

```typescript
// In state.ts - GraphState
subagentCoordination: Annotation<{
  phase: 'exploration' | 'planning' | 'implementation' | 'review' | 'testing' | 'complete';
  currentAgent: string;
  completedPhases: string[];
  sharedContext: {
    codebaseMap?: any;
    developmentPlan?: any;
    implementationResults?: any;
    reviewResults?: any;
    testResults?: any;
  };
}>(),

pendingApproval: Annotation<{
  type: 'development_plan' | 'security_review' | 'deployment';
  content: string;
  nextPhase: string;
}>(),

completionSummary: Annotation<string>(),
```

### Context Flow

```
Phase 1: Exploration
  ├─ Read: User request
  ├─ Analyze: Codebase structure
  └─ Output: codebaseMap

Phase 2: Planning
  ├─ Read: User request + codebaseMap
  ├─ Develop: Strategy and roadmap
  └─ Output: developmentPlan

Phase 3: Implementation
  ├─ Read: developmentPlan
  ├─ Write: Code files
  └─ Output: implementationResults

Phase 4: Review
  ├─ Read: implementationResults
  ├─ Check: Security, performance, quality
  └─ Output: reviewResults

Phase 5: Testing
  ├─ Read: reviewResults
  ├─ Execute: TDD cycle
  └─ Output: testResults
```

## Extending the System

### Adding a New Subagent

To create a new specialized subagent:

#### 1. Create Agent File

```typescript
// subagents/my-agent.ts

import { GraphStateType, StreamEvent } from '../../state';
import { AgentRunner } from '../../runner';
import { ToolDefinition } from '../../../lib/ai-client';
import { runAgentStep } from '../../services/agent-runtime';

export interface MyAgentContext {
  // Your context properties
}

export interface MyAgentOutput {
  // Your output properties
}

export const createMyAgent = (
  runner: AgentRunner,
  context: MyAgentContext,
  eventQueue?: StreamEvent[]
) => {
  return async (state: GraphStateType): Promise<MyAgentOutput> => {
    console.log('[MyAgent] Starting...');

    const myTools: ToolDefinition[] = [
      {
        name: 'my_tool',
        description: 'Description of my tool',
        parameters: {
          type: 'object',
          properties: {
            param1: { type: 'string' }
          },
          required: ['param1']
        }
      }
    ];

    const systemPrompt = `You are the MyAgent...`;

    const result = await runAgentStep(state, {
      runner,
      toolDefs: myTools,
      eventQueue,
      nodeName: 'my_agent',
      systemPromptOverride: systemPrompt
    });

    return {
      output: result
    };
  };
};
```

#### 2. Export from Index

```typescript
// subagents/index.ts

export { createMyAgent } from './my-agent';
export type { MyAgentContext, MyAgentOutput } from './my-agent';
```

#### 3. Integrate into Orchestrator

```typescript
// coding-specialist.ts

if (coordination.phase === 'my_phase' && !coordination.completedPhases.includes('my_phase')) {
  const myAgent = createMyAgent(runner, context, eventQueue);
  const myResult = await myAgent(state);

  coordination.sharedContext.myResults = myResult;
  coordination.completedPhases.push('my_phase');
  coordination.phase = 'next_phase';
}
```

### Modifying Agent Behavior

#### Change Phase Order

```typescript
// In coding-specialist.ts, modify the orchestration loop
coordination.phase = 'testing';  // Skip directly to testing
```

#### Adjust Strictness Levels

```typescript
// In review phase
const reviewContext: ReviewContext = {
  // ...
  strictnessLevel: 'strict'  // or 'lenient' for faster iterations
};
```

#### Configure Tool Availability

```typescript
// Filter tools for specific phases
const phasedTools = allTools.filter(t => {
  const readOnlyPhases = ['exploration', 'review'];
  if (readOnlyPhases.includes(coordination.phase)) {
    return !['write_code', 'delete_file', 'modify_config'].includes(t.name);
  }
  return true;
});
```

## Testing the Multi-Agent System

### Unit Testing Subagents

```typescript
// subagents/__tests__/exploration-agent.test.ts

describe('ExplorationAgent', () => {
  test('should analyze codebase structure', async () => {
    const context: ExplorationContext = {
      targetDirectory: './test-project',
      scanDepth: 2,
      includeTests: true,
      includeDocs: true,
      excludePatterns: ['node_modules']
    };

    const agent = createExplorationAgent(mockRunner, context);
    const result = await agent(mockState);

    expect(result.codebaseMap).toBeDefined();
    expect(result.codebaseMap.structure).toBeDefined();
    expect(result.codebaseMap.architecture).toBeDefined();
  });
});
```

### Integration Testing

```typescript
// __tests__/multi-agent-integration.test.ts

describe('Multi-Agent Coding System', () => {
  test('should orchestrate all phases successfully', async () => {
    const node = createCodingSpecialistNode(mockRunner, mockEventQueue);
    let state = mockState;

    // Run phases
    state = await node(state);
    expect(state.subagentCoordination.phase).toBe('planning');

    state = await node(state);
    expect(state.subagentCoordination.phase).toBe('implementation');

    state = await node(state);
    expect(state.subagentCoordination.phase).toBe('review');

    state = await node(state);
    expect(state.subagentCoordination.phase).toBe('testing');

    state = await node(state);
    expect(state.subagentCoordination.phase).toBe('complete');
    expect(state.codingComplete).toBe(true);
  });
});
```

## Performance Optimization

### Caching Strategy

```typescript
// Cache codebase map to avoid re-scanning
const codebaseCacheKey = `${projectRoot}:${Date.now() % 3600000}`;
const cachedMap = codebaseCache.get(codebaseCacheKey);

if (cachedMap && !needsFreshAnalysis) {
  coordination.sharedContext.codebaseMap = cachedMap;
  coordination.completedPhases.push('exploration');
  coordination.phase = 'planning';
}
```

### Parallel Execution

```typescript
// Run independent phases in parallel where possible
const [explorationResult, initialPlanResult] = await Promise.all([
  explorationAgent(state),
  preliminaryPlanningAgent(state)  // Lightweight planning based on heuristics
]);
```

### Memory Management

```typescript
// Clean up large objects after each phase
coordination.sharedContext = {
  ...coordination.sharedContext,
  largeAnalysis: null,  // Clear if no longer needed
  cacheResults: {
    codebaseMap: compact(coordination.sharedContext.codebaseMap),
    developmentPlan: compact(coordination.sharedContext.developmentPlan)
  }
};
```

## Debugging

### Enable Verbose Logging

```typescript
const DEBUG = true;

if (DEBUG) {
  console.log(`[CodingSpecialist] Phase: ${coordination.phase}`);
  console.log(`[CodingSpecialist] Completed: ${coordination.completedPhases.join(', ')}`);
  console.log(`[CodingSpecialist] Context keys: ${Object.keys(coordination.sharedContext).join(', ')}`);
}
```

### Trace Execution Flow

```typescript
// Add execution markers
eventQueue?.push({
  type: 'debug',
  phase: coordination.phase,
  agent: coordination.currentAgent,
  contextSize: JSON.stringify(coordination.sharedContext).length,
  timestamp: Date.now()
});
```

### Inspect State at Each Phase

```typescript
// Save state snapshot for analysis
const stateSnapshots = [];

stateSnapshots.push({
  phase: coordination.phase,
  state: JSON.parse(JSON.stringify(state)),
  timestamp: Date.now()
});

// For debugging: inspect stateSnapshots at the end
console.log('State evolution:', stateSnapshots);
```

## Troubleshooting Guide

### Issue: "Exploration phase hangs"

**Cause**: Large directory tree or permission issues
**Solution**:
```typescript
const explorationContext: ExplorationContext = {
  scanDepth: 2,  // Reduce from 3
  excludePatterns: ['node_modules', '.git', 'dist', 'build', '.next']
};
```

### Issue: "Planning agent produces generic plan"

**Cause**: Codebase map is incomplete
**Solution**:
```typescript
// Verify codebase map quality
console.assert(
  coordination.sharedContext.codebaseMap?.structure?.files?.length > 0,
  'Codebase map missing files'
);
```

### Issue: "Worker agent fails to build"

**Cause**: Build command incorrect or dependencies missing
**Solution**:
```typescript
const workerContext: WorkerContext = {
  buildCommand: detectBuildCommand(),  // Verify this matches package.json
  testCommand: detectTestCommand(),
  // ... other context
};
```

### Issue: "Code review too strict"

**Cause**: Strictness level too high for iterative development
**Solution**:
```typescript
const reviewContext: ReviewContext = {
  strictnessLevel: 'lenient',  // Change from 'standard'
  reviewCriteria: {
    security: true,
    performance: false,  // Skip performance for MVP
    maintainability: true,
    testCoverage: true,
    documentation: false,  // Skip for quick iteration
    codeStyle: false
  }
};
```

## Deployment Checklist

- [ ] All subagent files created and exported
- [ ] State.ts updated with coordination types
- [ ] Coding-specialist.ts integrated multi-agent orchestration
- [ ] Error handling and fallback mode implemented
- [ ] Event streaming for UI updates enabled
- [ ] Logging added for debugging
- [ ] Integration tests passing
- [ ] Performance optimizations applied
- [ ] Documentation updated
- [ ] Team trained on new system

## Monitoring

### Metrics to Track

```typescript
interface MultiAgentMetrics {
  phaseDurations: Record<string, number>;
  phaseSuccessRate: Record<string, number>;
  averagePlanComplexity: number;
  averageCodeReviewIssues: number;
  averageTestCoverage: number;
  fallbackActivationRate: number;
}
```

### Dashboard Integration

```typescript
// Send metrics to monitoring system
if (globalMonitoring) {
  globalMonitoring.recordMetrics({
    system: 'multi-agent-coding',
    phase: coordination.phase,
    duration: Date.now() - phaseStartTime,
    success: !hadErrors,
    agentCount: 5
  });
}
```

## Future Roadmap

- [ ] Parallel subagent execution
- [ ] Domain-specific subagents (mobile, DevOps, ML)
- [ ] Learning from past implementations
- [ ] Automatic optimization suggestions
- [ ] Multi-language support
- [ ] Distributed execution
- [ ] Custom subagent marketplace
