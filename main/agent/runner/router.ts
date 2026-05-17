/**
 * EverFern Desktop — Intent Router
 * 
 * Routes execution based on classified intent. Implements OpenClaw-style
 * conditional routing for the 6-node LangGraph architecture.
 */

export type IntentType = 'unknown' | 'coding' | 'research' | 'task' | 'question' | 'conversation';
export type TaskPhase = 'receiving' | 'classifying' | 'planning' | 'executing' | 'evaluating' | 'finalizing';

interface ExecutionPlan {
  id: string;
  title: string;
  steps: PlanStep[];
  createdAt: number;
}

interface PlanStep {
  id: string;
  description: string;
  tool?: string;
  status: 'pending' | 'in_progress' | 'done' | 'skipped' | 'failed';
  dependsOn?: string[];
}

interface ToolCallRecord {
  toolName: string;
  args: Record<string, unknown>;
  result?: {
    success: boolean;
    output: string;
    error?: string;
  };
}

// Router state extends graph state
export interface RouterState {
  currentIntent: IntentType;
  intentConfidence: number;
  taskPhase: TaskPhase;
  executionPlan?: ExecutionPlan | null;
  pendingToolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  pauseGeneration?: boolean;
  needsHumanApproval?: boolean;
  iterations?: number;
  toolCallRecords?: ToolCallRecord[];
}

// Route types for conditional edges
export type RouteType =
  | 'plan'
  | 'execute'
  | 'evaluate'
  | 'memory'
  | 'finalize'
  | 'end';

export interface RouteConditions {
  hasPendingTools: boolean;
  pauseRequested: boolean;
  humanApprovalNeeded: boolean;
  planComplete: boolean;
  maxIterationsReached: boolean;
  toolFailed: boolean;
}

/**
 * Intent-based route selection
 */
export function selectRoute(state: RouterState): RouteType {
  const { currentIntent, taskPhase, pendingToolCalls, pauseGeneration, needsHumanApproval, executionPlan } = state;
  
  console.log(`[router] Selecting route:`, {
    intent: currentIntent,
    phase: taskPhase,
    hasPendingTools: (pendingToolCalls?.length || 0) > 0,
    paused: pauseGeneration,
    approvalNeeded: needsHumanApproval
  });
  
  // 1. Human approval required - pause and wait
  if (needsHumanApproval) {
    console.log('[router] → evaluate (human approval needed)');
    return 'evaluate';
  }
  
  // 2. Pause requested (e.g., execution plan review)
  if (pauseGeneration) {
    console.log('[router] → evaluate (pause requested)');
    return 'evaluate';
  }
  
  // 3. Pending tool calls to execute
  if (pendingToolCalls && pendingToolCalls.length > 0) {
    console.log('[router] → execute (pending tools)');
    return 'execute';
  }
  
  // 4. Planning phase - check if plan is needed
  if (taskPhase === 'planning') {
    if (requiresPlanning(currentIntent)) {
      console.log('[router] → plan (requires planning)');
      return 'plan';
    } else {
      console.log('[router] → execute (skip planning)');
      return 'execute';
    }
  }
  
  // 5. Check if execution plan is complete
  if (executionPlan && !isPlanComplete(executionPlan)) {
    const nextStep = getNextPendingStep(executionPlan);
    if (nextStep) {
      console.log('[router] → execute (next plan step)');
      return 'execute';
    }
  }
  
  // 6. Evaluate after execution
  if (taskPhase === 'executing') {
    console.log('[router] → evaluate');
    return 'evaluate';
  }
  
  // 7. Check for task completion
  if (taskPhase === 'evaluating') {
    if (shouldFinalize(state)) {
      console.log('[router] → finalize');
      return 'finalize';
    } else {
      console.log('[router] → memory (updating context)');
      return 'memory';
    }
  }
  
  // 8. Finalize
  if (taskPhase === 'finalizing') {
    console.log('[router] → finalize');
    return 'finalize';
  }
  
  // Default: end
  console.log('[router] → end (default)');
  return 'end';
}

/**
 * Check if intent requires planning
 */
function requiresPlanning(intent: IntentType): boolean {
  return ['task', 'coding', 'research', 'fix', 'build', 'analyze', 'automate'].includes(intent);
}

/**
 * Check if plan is complete
 */
function isPlanComplete(plan: ExecutionPlan): boolean {
  return plan.steps.every((step: PlanStep) =>
    step.status === 'done' || step.status === 'skipped'
  );
}

/**
 * Get next pending step from plan
 */
function getNextPendingStep(plan: ExecutionPlan): PlanStep | null {
  for (const step of plan.steps) {
    if (step.status === 'pending') {
      const depsMet = !step.dependsOn || step.dependsOn.every((depId: string) => {
        const dep = plan.steps.find((s: PlanStep) => s.id === depId);
        return dep && (dep.status === 'done' || dep.status === 'skipped');
      });
      if (depsMet) {
        return step;
      }
    }
  }
  return null;
}

/**
 * Determine if task should finalize
 */
function shouldFinalize(state: RouterState): boolean {
  const { executionPlan, pendingToolCalls, currentIntent } = state;
  
  // No pending tools and no active plan
  if ((!pendingToolCalls || pendingToolCalls.length === 0) && !executionPlan) {
    return true;
  }
  
  // Plan is complete
  if (executionPlan && isPlanComplete(executionPlan)) {
    return true;
  }
  
  // Read-only tasks (question, research, conversation) can finalize early
  if (['question', 'research', 'conversation'].includes(currentIntent)) {
    return true;
  }
  
  return false;
}

/**
 * Generate route conditions for debugging
 */
export function getRouteConditions(state: RouterState): RouteConditions {
  return {
    hasPendingTools: (state.pendingToolCalls?.length || 0) > 0,
    pauseRequested: state.pauseGeneration || false,
    humanApprovalNeeded: state.needsHumanApproval || false,
    planComplete: state.executionPlan ? isPlanComplete(state.executionPlan) : true,
    maxIterationsReached: state.iterations ? state.iterations >= 100 : false,
    toolFailed: state.toolCallRecords?.some((r: ToolCallRecord) => !r.result?.success) || false
  };
}

/**
 * Format route decision for logging
 */
export function formatRouteDecision(
  currentRoute: RouteType,
  conditions: RouteConditions,
  nextPhase?: TaskPhase
): string {
  return [
    `[Router] Decision: ${currentRoute}`,
    `  Phase: ${nextPhase || 'unknown'}`,
    `  Conditions:`,
    `    - Pending tools: ${conditions.hasPendingTools}`,
    `    - Paused: ${conditions.pauseRequested}`,
    `    - Approval needed: ${conditions.humanApprovalNeeded}`,
    `    - Plan complete: ${conditions.planComplete}`,
    `    - Max iterations: ${conditions.maxIterationsReached}`,
    `    - Tool failed: ${conditions.toolFailed}`
  ].join('\n');
}
