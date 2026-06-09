/**
 * EverFern Coding Assistant - Internal Harness Lanes
 *
 * The live Coding Specialist now runs as a single PI-backed coding agent.
 * These modules are retained as internal lane helpers/reference types only; coding
 * requests should not be routed to separate external subagents.
 *
 * 1. Exploration Agent: Read-only codebase scanner and analyzer
 * 2. Planning Agent: Strategy and architecture planner
 * 3. Worker/Implementation Agent: Code writing and bug fixing
 * 4. Test Runner Agent: validation helper
 */

export { createExplorationAgent } from './exploration-agent';
export { createPlanningAgent } from './planning-agent';
export { createWorkerAgent } from './worker-agent';
export { createTestRunnerAgent } from './test-runner-agent';

export type { ExplorationContext, CodebaseMap } from './exploration-agent';
export type { PlanningContext, DevelopmentPlan } from './planning-agent';
export type { WorkerContext, ImplementationTask } from './worker-agent';
export type { TestContext, TestResult } from './test-runner-agent';

/**
 * Coordination types for multi-agent interaction
 */
export interface SubagentCoordination {
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
}

export interface SubagentMessage {
  from: string;
  to: string;
  type: 'handoff' | 'feedback' | 'error' | 'complete';
  data: any;
  timestamp: number;
}
