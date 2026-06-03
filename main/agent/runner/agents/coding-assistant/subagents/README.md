# EverFern Coding Subagents

Specialized autonomous agents for different phases of software development.

## Quick Start

The multi-agent system is automatically invoked when you make a coding request:

```
User: "Build a REST API for user authentication with JWT tokens"

System automatically:
1. Scans existing codebase
2. Plans implementation strategy
3. Implements features
4. Reviews code for quality/security
5. Runs comprehensive tests
6. Returns completion summary
```

## Individual Subagents

### Exploration Agent
Scans and understands your codebase before making any changes.

```typescript
const explorationContext = {
  targetDirectory: './src',
  scanDepth: 3,
  includeTests: true,
  focusAreas: ['authentication', 'database']
};

const explorer = createExplorationAgent(runner, explorationContext);
const { codebaseMap, analysis } = await explorer(state);
```

**Output**: Comprehensive codebase map with architecture, patterns, and recommendations

---

### Planning Agent
Develops a detailed implementation strategy with risk assessment.

```typescript
const planningContext = {
  userRequest: "Add OAuth integration",
  codebaseMap: explorationResult.codebaseMap,
  constraints: { timeframe: 'urgent' },
  preferences: { testingApproach: 'tdd' }
};

const planner = createPlanningAgent(runner, planningContext);
const { plan, planDocument } = await planner(state);
```

**Output**: DevelopmentPlan with phases, tasks, risks, and testing strategy

---

### Worker Agent
Writes code following the development plan.

```typescript
const workerContext = {
  plan: planningResult.plan,
  currentPhase: 'core-implementation',
  currentTask: 'implement-oauth-routes',
  workingDirectory: './src',
  buildCommand: 'npm run build',
  testCommand: 'npm test'
};

const worker = createWorkerAgent(runner, workerContext);
const { result, summary } = await worker(state);
```

**Output**: ImplementationResult with created/modified files and build status

---

### Code Reviewer Agent
Validates code quality, security, and maintainability.

```typescript
const reviewContext = {
  implementationResult: workerResult.result,
  reviewCriteria: {
    security: true,
    performance: true,
    maintainability: true,
    testCoverage: true,
    documentation: true,
    codeStyle: true
  },
  strictnessLevel: 'standard'
};

const reviewer = createCodeReviewerAgent(runner, reviewContext);
const { review, reportDocument } = await reviewer(state);
```

**Output**: CodeReviewResult with ratings, issues, and recommendations

---

### Test Runner Agent
Executes TDD cycle and comprehensive testing.

```typescript
const testContext = {
  reviewResult: reviewerResult.review,
  testStrategy: 'tdd',
  testFramework: 'jest',
  coverageTarget: 80,
  testDirectory: './tests',
  srcDirectory: './src'
};

const testRunner = createTestRunnerAgent(runner, testContext);
const { testResult, testReport } = await testRunner(state);
```

**Output**: TestResult with coverage metrics, test results, and refactoring recommendations

---

## Orchestration

The Coding Specialist orchestrates all subagents in sequence:

```typescript
// In createCodingSpecialistNode:
1. Initialize coordination context
2. Phase 1: Run Exploration Agent
   - If success: move to Phase 2
   - If failure: return error

3. Phase 2: Run Planning Agent
   - If high complexity: request user approval
   - If approved: move to Phase 3
   - If rejected: adjust plan and retry

4. Phase 3: Run Worker Agent
   - If build succeeds: move to Phase 4
   - If build fails: fix and retry

5. Phase 4: Run Code Reviewer
   - If critical issues: return to Worker
   - If warnings: continue to Phase 5
   - If passed: move to Phase 5

6. Phase 5: Run Test Runner
   - If coverage target met: complete
   - If coverage low: add more tests
   - If tests fail: fix implementation

7. Generate completion summary with all results
```

## State Management

### Coordination State

```typescript
subagentCoordination = {
  phase: 'exploration' | 'planning' | 'implementation' | 'review' | 'testing' | 'complete',
  currentAgent: 'string',
  completedPhases: ['exploration', 'planning', ...],
  sharedContext: {
    codebaseMap: { ... },
    developmentPlan: { ... },
    implementationResults: { ... },
    reviewResults: { ... },
    testResults: { ... }
  }
}
```

### Context Persistence

Each phase builds on previous output:
- Exploration provides `codebaseMap`
- Planning uses `codebaseMap` to create `developmentPlan`
- Worker uses `developmentPlan` to create `implementationResults`
- Reviewer analyzes `implementationResults` to create `reviewResults`
- Test Runner validates with `reviewResults` to create `testResult`

## Error Handling

### Recovery Mechanisms

1. **Phase Failure**: Log error, emit event, fall back to single-agent mode
2. **Build Failure**: Return to Worker Agent, provide error details
3. **Review Issues**: Return to Worker Agent with specific recommendations
4. **Test Failures**: Return to Worker Agent to fix implementation
5. **User Rejection**: Pause and request clarification

### Fallback Mode

If any phase encounters an unrecoverable error:
- Fall back to traditional Coding Specialist behavior
- Execute with best-effort approach
- Log detailed error information

## Configuration

### Exploration Settings

```typescript
{
  scanDepth: 3,              // Directory recursion depth
  includeTests: true,         // Scan test directories
  includeDocs: true,          // Analyze documentation
  excludePatterns: [          // Patterns to skip
    'node_modules', '.git', 'dist', 'build'
  ],
  focusAreas: [               // Areas to prioritize
    'authentication', 'api', 'database'
  ]
}
```

### Planning Settings

```typescript
{
  constraints: {
    timeframe: 'standard',
    compatibility: ['cross-browser'],
    performance: ['fast-load']
  },
  preferences: {
    testingApproach: 'tdd',
    documentationLevel: 'standard',
    codingStyle: 'standard'
  }
}
```

### Testing Settings

```typescript
{
  testStrategy: 'tdd',
  testFramework: 'jest',      // or 'mocha', 'pytest', etc.
  coverageTarget: 80,          // Minimum coverage percentage
  testDirectory: './tests',
  srcDirectory: './src'
}
```

## Logging & Debugging

All phases emit detailed logs:

```typescript
// Enable phase logging
console.log('[ExplorationAgent] Starting codebase exploration...');
console.log('[PlanningAgent] Developing implementation strategy...');
console.log('[WorkerAgent] Beginning code implementation...');
console.log('[CodeReviewerAgent] Analyzing code quality and security...');
console.log('[TestRunnerAgent] Executing TDD cycle...');
```

Stream events track progress:

```typescript
eventQueue.push({
  type: 'thought',
  content: '🔍 Exploration Agent: Scanning codebase architecture...'
});

eventQueue.push({
  type: 'thought',
  content: '✅ Planning Agent: Development strategy ready - awaiting approval'
});
```

## Comparing with Claude Code

### Similarities

| Feature | Claude Code | EverFern Multi-Agent |
|---------|-----------|-------------------|
| Deep codebase understanding | ✅ | ✅ |
| Strategic planning | ✅ | ✅ |
| Quality-focused code | ✅ | ✅ |
| Comprehensive testing | ✅ | ✅ |
| Error detection & fixing | ✅ | ✅ |

### Unique Features

| Feature | EverFern Multi-Agent |
|---------|-------------------|
| Explicit exploration phase | ✅ |
| Risk-aware planning | ✅ |
| Code review feedback loop | ✅ |
| TDD-driven testing | ✅ |
| Phase-based transparency | ✅ |
| User approval gates | ✅ |

## Advanced Usage

### Custom Phase Configuration

```typescript
// Override default phase behavior
coordination.phase = 'implementation';  // Skip to specific phase
coordination.completedPhases = ['exploration', 'planning'];  // Mark phases done
```

### Parallel Subagents (Future)

```typescript
// Run multiple subagents in parallel where safe
Promise.all([
  explorationAgent(state),
  planningAgent(state)
]).then(([explorationResult, planningResult]) => {
  // Merge results and continue
});
```

### Domain-Specific Subagents (Future)

```typescript
// Add specialized subagents for specific domains
const mobileDevAgent = createMobileDevAgent(runner, context);
const devOpsAgent = createDevOpsAgent(runner, context);
const mlOpsAgent = createMLOpsAgent(runner, context);
```

## Troubleshooting

### Phase Hangs

If a phase hangs:
1. Check `console.log` output for stuck operations
2. Review agent prompts for infinite loops
3. Reduce `scanDepth` for faster exploration
4. Disable specific review criteria if not needed

### Memory Issues

If memory usage is high:
1. Reduce `scanDepth` in exploration
2. Limit codebase size in analysis
3. Break large implementations into phases
4. Clear `sharedContext` between phases

### Integration Issues

If subagents don't coordinate:
1. Verify `subagentCoordination` state exists
2. Check phase transitions in logs
3. Ensure `sharedContext` is passed correctly
4. Validate tool definitions are available

## Contributing

To extend the multi-agent system:

1. Create new subagent file: `your-agent.ts`
2. Implement subagent creator function
3. Export types and creator from `index.ts`
4. Add to orchestration in `coding-specialist.ts`
5. Update `MULTI_AGENT_ARCHITECTURE.md`

## License

Part of EverFern Desktop - Multi-Agent Development Platform
