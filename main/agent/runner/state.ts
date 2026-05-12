import { Annotation, MessagesAnnotation } from '@langchain/langgraph';
import type { MissionTimeline, MissionStep } from './mission-tracker';
import type { ThinkingDuration } from './duration-tracker';

// Type definitions to fix imports
export type IntentType = 'unknown' | 'coding' | 'research' | 'task' | 'question' | 'conversation' | 'build' | 'fix' | 'analyze' | 'automate';
export type TaskPhase = 'triage' | 'planning' | 'routing' | 'specialized_agent' | 'validation' | 'hitl' | 'orchestrating' | 'executing' | 'evaluating' | 'brain';

export interface TaskStep {
  id: string;
  description: string;
  tool: string;
  canParallelize: boolean;
  priority?: 'low' | 'normal' | 'critical' | string;
  estimatedComplexity?: 'simple' | 'moderate' | 'complex' | 'low' | 'medium' | 'high' | string;
  dependsOn?: string[];
  parallelGroup?: number;
  agentPrompt?: string;
}

export interface DecomposedTask {
  id: string;
  title: string;
  steps: TaskStep[];
  totalSteps: number;
  canParallelize: boolean;
  executionMode: string;
  estimatedParallelGroups?: number;
  estimatedDurationMs?: number;
}

export interface IntentClassification {
  intent: IntentType;
  confidence: number;
  reasoning: string;
}

// Base stream event type
export interface BaseStreamEvent {
  type: string;
  [key: string]: any;
}

// Specific stream event types
export type StreamEvent =
  | { type: 'thought'; content: string }
  | { type: 'chunk'; content: string }
  | { type: 'tool_call'; toolCall: any }
  | { type: 'mission_complete'; timeline: MissionTimeline | null; steps: MissionStep[]; thinkingDuration?: ThinkingDuration }
  | { type: 'mission_step_update'; step: MissionStep; timeline: MissionTimeline | null }
  | { type: 'mission_phase_change'; phase: string; timeline: MissionTimeline | null }
  | { type: 'parallel_group_start'; groupIndex: number; stepCount: number }
  | { type: 'parallel_group_end'; groupIndex: number; durationMs: number }
  | { type: 'usage'; promptTokens: number; completionTokens: number; totalTokens: number }
  | { type: 'done' }
  | { type: 'tool_call_start'; index: number; toolName: string }
  | { type: 'tool_call_chunk'; index: number; argumentsDelta: string }
  | { type: 'tool_call_complete'; index: number; toolName: string; arguments: Record<string, unknown> }
  | BaseStreamEvent; // Fallback for other event types

// Type guard for mission_complete events
export function isMissionCompleteEvent(event: StreamEvent): event is { type: 'mission_complete'; timeline: MissionTimeline | null; steps: MissionStep[]; thinkingDuration?: ThinkingDuration } {
  return event.type === 'mission_complete';
}

// Type guard for events with thinking duration
export function hasThinkingDuration(event: StreamEvent): event is { type: 'mission_complete'; timeline: MissionTimeline | null; steps: MissionStep[]; thinkingDuration: ThinkingDuration } {
  return isMissionCompleteEvent(event) && event.thinkingDuration !== undefined;
}

// Validate thinking duration data
export function isValidThinkingDuration(duration: ThinkingDuration | undefined): duration is ThinkingDuration {
  if (!duration) return false;

  const { startTime, endTime, duration: durationMs } = duration;

  // Validate required fields
  if (typeof startTime !== 'number' || startTime < 0) return false;

  // If endTime is present, validate it
  if (endTime !== undefined) {
    if (typeof endTime !== 'number' || endTime < startTime) return false;
  }

  // If duration is present, validate it
  if (durationMs !== undefined) {
    if (typeof durationMs !== 'number' || durationMs < 0) return false;

    // If both endTime and startTime are present, duration should match
    if (endTime !== undefined && Math.abs(durationMs - (endTime - startTime)) > 1) {
      return false;
    }
  }

  return true;
}

export const GraphState = Annotation.Root({
  ...MessagesAnnotation.spec,
  currentIntent: Annotation<IntentType>(),
  intentConfidence: Annotation<number>(),
  decomposedTask: Annotation<DecomposedTask>(),
  agiHints: Annotation<string>(),
  taskPhase: Annotation<TaskPhase>(),
  pendingToolCalls: Annotation<any[]>(),
  toolCallRecords: Annotation<any[]>(),
  toolCallHistory: Annotation<any[]>(), // Compatibility
  userConfirmation: Annotation<any>(), // Compatibility
  finalResponse: Annotation<string>(), // Compatibility
  pauseGeneration: Annotation<boolean>(),
  iterations: Annotation<number>(),
  // Multi-Agent State
  activeAgent: Annotation<string>(),
  validationResult: Annotation<{
    isHighRisk: boolean;
    reasoning: string;
  }>(),
  shouldContinueIteration: Annotation<boolean>(),
  // Completion signal — brain sets this before routing to judge
  // to explain why it believes the mission should end
  completionSignal: Annotation<{
    reason: 'task_complete' | 'waiting_for_user_input' | 'needs_hitl' | 'cannot_proceed';
    explanation: string;
  } | null>(),
  // Routing decision — brain sets this to route to specialized agents
  routingDecision: Annotation<{
    decision: 'continue_brain' | 'route_coding' | 'route_data_analyst' | 'route_computer_use' | 'route_web_explorer' | 'complete_task';
    explanation: string;
  } | null>(),
  // HITL Approval State
  hitlApprovalResult: Annotation<{
    approved: boolean;
    response: string;
    reasoning: string;
  }>(),
  // Mission Tracking (OpenClaw style)
  missionId: Annotation<string>(),
  missionTimeline: Annotation<MissionTimeline | null>(),
  missionSteps: Annotation<MissionStep[]>(),
  currentStepId: Annotation<string>(),
  // Specialized Agent State
  webExplorerComplete: Annotation<boolean>(),
  webExplorerSelfLoopCount: Annotation<number>(),
  navisInvoked: Annotation<boolean>(),
  searchInvoked: Annotation<boolean>(),
  codingComplete: Annotation<boolean>(),
  dataAnalysisComplete: Annotation<boolean>(),
  computerUseComplete: Annotation<boolean>(),
  deepResearchComplete: Annotation<boolean>(),
  // Subagent State
  subagentSpawned: Annotation<any>(),
  completedSteps: Annotation<string[]>(),
  decompositionAttempts: Annotation<number>(),

  // Bugfixes: Routing state persistence
  brainToolsInFlight: Annotation<boolean>(),
  returningFromSpecialist: Annotation<string | null>(),

  // Debate system: stores the result of the three-agent debate chamber
  debateResult: Annotation<any>(),
});

export type GraphStateType = typeof GraphState.State;
