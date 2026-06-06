/**
 * EverFern Desktop — Debate Event Emitter
 *
 * Sends debate progress and results to the frontend in real-time.
 * Events are sent via IPC to the renderer process.
 */

import { BrowserWindow } from 'electron';
import type { DebateResult, DebateMessage } from './debate-types';

export interface DebateStreamEvent {
  type: 'debate_start' | 'vanguard_complete' | 'phantom_complete' | 'arbiter_complete' | 'debate_complete' | 'debate_error';
  timestamp: string;
  debateId: string;
  phase?: 'vanguard' | 'phantom' | 'arbiter';
  data?: any;
  error?: string;
}

export class DebateEventEmitter {
  /**
   * Emit a debate event to the frontend.
   * Called by debate engine to stream progress.
   */
  static emitDebateEvent(event: { sender?: any }, debateEvent: DebateStreamEvent) {
    if (event.sender) {
      try {
        event.sender.send('debate:stream', debateEvent);
      } catch (err) {
        console.error('[DebateEventEmitter] Error sending debate event:', err);
      }
    }
  }

  /**
   * Broadcast a debate event to ALL renderer windows.
   * Used by the debate-chamber graph node which doesn't have access to a specific IPC event.
   */
  static broadcastDebateEvent(debateEvent: DebateStreamEvent) {
    console.log('[DebateEventEmitter] Broadcasting debate event:', debateEvent.type);
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      try {
        if (!win.isDestroyed()) {
          win.webContents.send('debate:stream', debateEvent);
        }
      } catch (err) {
        console.error('[DebateEventEmitter] Error broadcasting to window:', err);
      }
    }
  }

  /**
   * Format a debate result for sending to frontend.
   */
  static formatDebateResultForFrontend(debateResult: DebateResult) {
    return {
      debateId: debateResult.debateId,
      timestamp: debateResult.timestamp,

      // Proposal summary (Vanguard)
      proposal: debateResult.proposal ? {
        id: debateResult.proposal.proposalId || '',
        taskSummary: debateResult.proposal.taskSummary || '',
        approach: debateResult.proposal.approach || '',
        estimatedTimeMs: debateResult.proposal.estimatedTotalTimeMs || 0,
        phaseCount: debateResult.proposal.phases?.length || 0,
        assumptions: debateResult.proposal.assumptionsAndConstraints || [],
      } : {},

      // Review summary (Phantom)
      review: debateResult.review ? {
        id: debateResult.review.reviewId || '',
        assessment: debateResult.review.overallAssessment || '',
        concernCount: debateResult.review.concerns?.length || 0,
        criticalCount: debateResult.review.concerns?.filter((c: any) => c.severity === 'critical').length || 0,
        highCount: debateResult.review.concerns?.filter((c: any) => c.severity === 'high').length || 0,
        concerns: (debateResult.review.concerns || []).map((c: any) => ({
          severity: c.severity,
          title: c.title,
          description: c.description,
          suggestion: c.suggestion,
        })),
      } : {},

      // Final plan (Arbiter)
      finalPlan: debateResult.finalPlan ? {
        id: debateResult.finalPlan.planId || '',
        goNogo: debateResult.finalPlan.goNogo || '',
        riskAssessment: debateResult.finalPlan.overallRiskAssessment || '',
        phaseCount: debateResult.finalPlan.approvedPhases?.length || 0,
        addressedConcerns: debateResult.finalPlan.addressedConcerns?.length || 0,
        remainingRisks: debateResult.finalPlan.remainingRisks?.length || 0,
        guidance: debateResult.finalPlan.executionGuidance || '',
        explanation: debateResult.finalPlan.explanation || '',
      } : {},
    };
  }
}

export const debateEventEmitter = DebateEventEmitter;
