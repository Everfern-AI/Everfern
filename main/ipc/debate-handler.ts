/**
 * EverFern Desktop — Backend IPC Integration for Debate Events
 *
 * This file integrates the Peer Agent Debate Engine with the IPC system
 * to stream debate progress and results to the frontend in real-time.
 */

import { IpcMainEvent } from 'electron';
import * as crypto from 'crypto';
import type { DebateResult, DebateEventEmitterCallback } from '../agent/runner/debate-types';
import type { DebateStreamEvent, DebateDisplayData } from '../../src/app/chat/types/debate-types';

/**
 * Create a real-time event emitter for debate phases
 * This callback is passed to PeerAgentDebateEngine to emit events as each phase completes
 */
export function createDebateEventEmitter(event: IpcMainEvent | null, debateId: string): DebateEventEmitterCallback {
  return async (phase, proposal, review, finalPlan) => {
    if (!event?.sender) return;

    try {
      const displayData = formatDebateDataForFrontend(debateId, proposal, review, finalPlan);

      // Emit phase-specific event
      const eventType = phase === 'vanguard' ? 'vanguard_complete' :
                        phase === 'phantom' ? 'phantom_complete' :
                        'arbiter_complete';

      const debateEvent: DebateStreamEvent = {
        type: eventType as any,
        timestamp: new Date().toISOString(),
        debateId,
        phase,
        data: displayData,
      };

      event.sender.send('debate:stream', debateEvent);
    } catch (err) {
      // Silently fail to keep logs clean
    }
  };
}

/**
 * Format debate data for frontend display
 */
export function formatDebateDataForFrontend(
  debateId: string,
  proposal: any,
  review?: any,
  finalPlan?: any
): DebateDisplayData {
  return {
    debateId,
    timestamp: new Date().toISOString(),

    proposal: proposal ? {
      id: proposal.proposalId || proposal.id || 'v1',
      taskSummary: proposal.taskSummary || '',
      approach: proposal.approach || proposal.rationale || '',
      estimatedTimeMs: proposal.estimatedTotalTimeMs || 0,
      phaseCount: proposal.phases?.length || 0,
      assumptions: proposal.assumptionsAndConstraints || [],
    } : {
      id: '',
      taskSummary: '',
      approach: '',
      estimatedTimeMs: 0,
      phaseCount: 0,
      assumptions: [],
    },

    review: review ? {
      id: review.reviewId || review.id || 'p1',
      assessment: review.overallAssessment as 'viable' | 'concerning' | 'problematic',
      concernCount: review.concerns?.length || 0,
      criticalCount: review.concerns?.filter((c: any) => c.severity === 'critical').length || 0,
      highCount: review.concerns?.filter((c: any) => c.severity === 'high').length || 0,
      concerns: (review.concerns || []).map((c: any) => ({
        severity: c.severity as 'low' | 'medium' | 'high' | 'critical',
        title: c.title || '',
        description: c.description || '',
        suggestion: c.suggestion,
      })),
    } : {
      id: '',
      assessment: 'viable' as const,
      concernCount: 0,
      criticalCount: 0,
      highCount: 0,
      concerns: [],
    },

    finalPlan: finalPlan ? {
      id: finalPlan.planId || finalPlan.id || 'a1',
      goNogo: finalPlan.goNogo as 'go' | 'proceed-with-caution' | 'no-go',
      riskAssessment: finalPlan.overallRiskAssessment as 'low' | 'medium' | 'high' | 'critical',
      phaseCount: finalPlan.approvedPhases?.length || 0,
      addressedConcerns: finalPlan.addressedConcerns?.length || 0,
      remainingRisks: finalPlan.remainingRisks?.length || 0,
      guidance: finalPlan.executionGuidance || [],
      explanation: finalPlan.explanation || '',
    } : {
      id: '',
      goNogo: 'no-go' as const,
      riskAssessment: 'high' as const,
      phaseCount: 0,
      addressedConcerns: 0,
      remainingRisks: 0,
      guidance: [],
      explanation: '',
    },
  };
}

/**
 * Emit debate start event to frontend
 */
export function emitDebateStart(event: IpcMainEvent | null, debateId: string): void {
  if (!event?.sender) return;

  try {
    const debateEvent: DebateStreamEvent = {
      type: 'debate_start',
      timestamp: new Date().toISOString(),
      debateId,
    };

    event.sender.send('debate:stream', debateEvent);
  } catch (err) {
    // Silently fail
  }
}

/**
 * Emit debate completion event to frontend
 */
export function emitDebateComplete(event: IpcMainEvent | null, debateId: string, result: DebateResult): void {
  if (!event?.sender) return;

  try {
    const displayData = formatDebateDataForFrontend(debateId, result.proposal, result.review, result.finalPlan);

    const debateEvent: DebateStreamEvent = {
      type: 'debate_complete',
      timestamp: new Date().toISOString(),
      debateId,
      data: displayData,
    };

    event.sender.send('debate:stream', debateEvent);
  } catch (err) {
    // Silently fail
  }
}

/**
 * Emit debate error event to frontend
 */
export function emitDebateError(event: IpcMainEvent | null, debateId: string, error: Error): void {
  if (!event?.sender) return;

  try {
    const debateEvent: DebateStreamEvent = {
      type: 'debate_error',
      timestamp: new Date().toISOString(),
      debateId,
      error: error.message,
    };

    event.sender.send('debate:stream', debateEvent);
  } catch (err) {
    // Silently fail
  }
}

/**
 * Integration Example for AgentRunner
 *
 * Add this code to your executeTask() method to use the debate engine with streaming:
 *
 * ────────────────────────────────────────────────────────────────────────────
 *
 * import { PeerAgentDebateEngine } from './debate-engine';
 * import { analyzeTaskComplexity } from './complexity-analyzer';
 * import {
 *   createDebateEventEmitter,
 *   emitDebateStart,
 *   emitDebateComplete,
 *   emitDebateError
 * } from '../ipc/debate-handler';
 *
 * // In executeTask():
 * async executeTask(userInput: string, event: IpcMainEvent) {
 *   // Step 1: Analyze task complexity
 *   const complexity = await analyzeTaskComplexity(userInput, this.client);
 *
 *   // Step 2: Activate debate if needed
 *   if (complexity.complexity === 'moderate' || complexity.complexity === 'complex') {
 *     const debateId = `debate-${crypto.randomUUID()}`;
 *
 *     try {
 *       emitDebateStart(event, debateId);
 *
 *       // Step 3: Initialize debate engine if not done
 *       if (!this.debateEngine) {
 *         this.debateEngine = new PeerAgentDebateEngine(this.client, {
 *           enableDebate: true,
 *           complexityThreshold: 'moderate',
 *           timeoutMs: 60000,
 *           verbose: true,
 *         });
 *       }
 *
 *       // Step 4: Run debate with real-time event streaming
 *       const debateResult = await this.debateEngine.debate({
 *         taskId: crypto.randomUUID(),
 *         userInput,
 *         conversationHistory: this.conversationHistory,
 *         availableTools: this.tools.map(t => t.name),
 *         workspaceContext: this.workspaceDir || '',
 *       }, {
 *         // Pass event emitter callback to debate engine
 *         onPhaseComplete: createDebateEventEmitter(event, debateId)
 *       });
 *
 *       emitDebateComplete(event, debateId, debateResult);
 *
 *       // Step 5: Execute the approved plan
 *       if (debateResult.finalPlan.goNogo === 'go') {
 *         // Execute with the approved plan
 *         return await this.executeApprovedPlan(debateResult.finalPlan, event);
 *       } else if (debateResult.finalPlan.goNogo === 'proceed-with-caution') {
 *         // Execute with extra validation
 *         return await this.executePlanWithValidation(debateResult.finalPlan, event);
 *       } else {
 *         // Plan rejected - need to ask user
 *         throw new Error('Debate rejected plan. Please revise your request.');
 *       }
 *     } catch (err) {
 *       const debateId = crypto.randomUUID();
 *       emitDebateError(event, debateId, err instanceof Error ? err : new Error(String(err)));
 *       throw err;
 *     }
 *   }
 *
 *   // Continue with normal execution if not complex
 *   return await this.normalExecute(userInput, event);
 * }
 *
 * ────────────────────────────────────────────────────────────────────────────
 */

/**
 * FIX: Update PeerAgentDebateEngine.debate() to accept onPhaseComplete callback
 *
 * The debate() method signature should be:
 *
 * async debate(
 *   context: DebateContext,
 *   config?: Partial<DebateEngineConfig>
 * ): Promise<DebateResult>
 *
 * OR modify the constructor to accept the callback in config:
 *
 * new PeerAgentDebateEngine(client, {
 *   enableDebate: true,
 *   onPhaseComplete: createDebateEventEmitter(event, debateId)
 * })
 *
 * The second approach (via constructor) is used in the code above.
 */

export {};
