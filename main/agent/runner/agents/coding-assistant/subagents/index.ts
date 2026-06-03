/**
 * EverFern Coding Assistant - Multi-Agent System
 *
 * Implements a sophisticated multi-agent coding system where the main Coding Specialist
 * spawns specialized subagents for different development phases:
 *
 * 1. Exploration Agent: Read-only codebase scanner and analyzer
 * 2. Planning Agent: Strategy and architecture planner
 * 3. Worker/Implementation Agent: Code writing and bug fixing
 * 4. Code Reviewer: Security and quality checker
 * 5. Test Runner Agent: TDD red/green/refactor specialist
 */

export { createExplorationAgent } from './exploration-agent';
export { createPlanningAgent } from './planning-agent';
export { createWorkerAgent } from './worker-agent';
export { createCodeReviewerAgent } from './code-reviewer-agent';
export { createTestRunnerAgent } from './test-runner-agent';

export type { ExplorationContext, CodebaseMap } from './exploration-agent';
export type { PlanningContext, DevelopmentPlan } from './planning-agent';
export type { WorkerContext, ImplementationTask } from './worker-agent';
export type { ReviewContext, CodeReviewResult } from './code-reviewer-agent';
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
