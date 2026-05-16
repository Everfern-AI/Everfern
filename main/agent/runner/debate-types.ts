/**
 * EverFern Desktop — Peer Agent Debate Engine Types
 *
 * Defines types for the three-agent debate system that evaluates complex task planning.
 */

import type { ToolCallRecord } from './types';

// ── Debate Participants ──────────────────────────────────────────────────

export type DebateRole = 'vanguard' | 'phantom' | 'arbiter';

// ── ExecutionProposal (Vanguard Output) ──────────────────────────────────

export interface ExecutionStep {
  id: string;
  sequence: number;
  description: string;
  action: string;
  toolsNeeded: string[];
  dependencies: string[]; // Step IDs this depends on
  estimatedDurationMs?: number;
  riskLevel: 'low' | 'medium' | 'high';
}

export interface ExecutionProposal {
  proposerId: string;
  proposalId: string;
  timestamp: string;
  taskSummary: string;
  approach: string;
  steps: ExecutionStep[];
  parallelizable: boolean;
  estimatedTotalTimeMs: number;
  requiredTools: string[];
  assumptionsAndConstraints: string[];
  rationale: string; // Why this approach was chosen
}

// ── CriticalReview (Phantom Output) ──────────────────────────────────────

export interface Concern {
  id: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  stepId?: string; // Which step this concerns (or undefined for overall)
  title: string;
  description: string;
  impact: string; // What happens if this concern materializes
  suggestion?: string; // How to address it
  tags: string[]; // e.g., 'edge-case', 'performance', 'security', 'dependency'
}

export interface CriticalReview {
  reviewerId: string;
  reviewId: string;
  timestamp: string;
  proposalId: string;
  overallAssessment: 'viable' | 'concerning' | 'problematic';
  concerns: Concern[];
  strongPoints: string[]; // Things Phantom approves of
  worstCaseScenarios: string[];
  alternativeSuggestions?: string[];
}

// ── FinalExecutionPlan (Arbiter Output) ──────────────────────────────────

export interface AuditedStep {
  originalStepId: string;
  sequence: number;
  description: string;
  action: string;
  toolsNeeded: string[];
  dependencies: string[];
  estimatedDurationMs?: number;
  riskLevel: 'low' | 'medium' | 'high';
  mitigation?: string; // Mitigations added based on Phantom's concerns
  reviewNotes?: string; // Notes from Arbiter's review
}

export interface FinalExecutionPlan {
  arbiterId: string;
  planId: string;
  timestamp: string;
  originTaskSummary: string;
  vanguardProposalId: string;
  phantomReviewId: string;

  // Core plan
  steps: AuditedStep[];
  approvedApproach: string;

  // Risk management
  addressedConcerns: Concern[]; // Concerns that were mitigated
  remainingRisks: Concern[]; // Risks that couldn't be mitigated
  overallRiskAssessment: 'low' | 'medium' | 'high' | 'critical';

  // Execution guidance
  goNogo: 'go' | 'no-go' | 'proceed-with-caution';
  explanation: string; // Why this go/no-go decision
  executionGuidance: string[];
}

// ── DebateContext ────────────────────────────────────────────────────────

export interface DebateContext {
  taskId: string;
  userInput: string;
  conversationHistory: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string }>;
  availableTools: string[];
  workspaceContext: string; // Current workspace info
  constraints?: string[]; // e.g., "Cannot delete files", "Must work offline"
}

// ── DebateResult ─────────────────────────────────────────────────────────

export interface DebateResult {
  debateId: string;
  timestamp: string;
  context: DebateContext;
  proposal: ExecutionProposal;
  review: CriticalReview;
  finalPlan: FinalExecutionPlan;
  debateTranscript: DebateMessage[];
}

export interface DebateMessage {
  role: DebateRole;
  timestamp: string;
  type: 'proposal' | 'review' | 'arbitration' | 'synthesis';
  content: string;
  data?: ExecutionProposal | CriticalReview | FinalExecutionPlan;
}

// ── Debate Engine Configuration ──────────────────────────────────────────

export type DebatePhase = 'vanguard' | 'phantom' | 'arbiter';

export interface DebateEventEmitterCallback {
  (phase: DebatePhase, proposal?: ExecutionProposal, review?: CriticalReview, finalPlan?: FinalExecutionPlan): void | Promise<void>;
}

export interface DebateEngineConfig {
  enableDebate: boolean;
  complexityThreshold: 'moderate' | 'complex'; // Minimum complexity to trigger debate
  timeoutMs?: number; // Max time for entire debate (default: 60000)
  vanguardTimeoutMs?: number; // Max time for Vanguard (default: 15000)
  phantomTimeoutMs?: number; // Max time for Phantom (default: 20000)
  arbiterTimeoutMs?: number; // Max time for Arbiter (default: 15000)
  maxRetries?: number; // If debate fails, retry (default: 1)
  verbose?: boolean; // Log debate transcript
  onPhaseComplete?: DebateEventEmitterCallback; // Called after each phase completes
  shouldAbort?: () => boolean; // Callback to check if debate should be aborted
}
