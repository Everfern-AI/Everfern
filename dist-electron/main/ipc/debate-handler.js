"use strict";
/**
 * EverFern Desktop — Backend IPC Integration for Debate Events
 *
 * This file integrates the Peer Agent Debate Engine with the IPC system
 * to stream debate progress and results to the frontend in real-time.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDebateEventEmitter = createDebateEventEmitter;
exports.formatDebateDataForFrontend = formatDebateDataForFrontend;
exports.emitDebateStart = emitDebateStart;
exports.emitDebateComplete = emitDebateComplete;
exports.emitDebateError = emitDebateError;
/**
 * Create a real-time event emitter for debate phases
 * This callback is passed to PeerAgentDebateEngine to emit events as each phase completes
 */
function createDebateEventEmitter(event, debateId) {
    return async (phase, proposal, review, finalPlan) => {
        if (!event?.sender)
            return;
        try {
            const displayData = formatDebateDataForFrontend(debateId, proposal, review, finalPlan);
            // Emit phase-specific event
            const eventType = phase === 'vanguard' ? 'vanguard_complete' :
                phase === 'phantom' ? 'phantom_complete' :
                    'arbiter_complete';
            const debateEvent = {
                type: eventType,
                timestamp: new Date().toISOString(),
                debateId,
                phase,
                data: displayData,
            };
            event.sender.send('debate:stream', debateEvent);
        }
        catch (err) {
            // Silently fail to keep logs clean
        }
    };
}
/**
 * Format debate data for frontend display
 */
function formatDebateDataForFrontend(debateId, proposal, review, finalPlan) {
    return {
        debateId,
        timestamp: new Date().toISOString(),
        proposal: proposal ? {
            id: proposal.proposalId || proposal.id || 'v1',
            taskSummary: proposal.taskSummary || '',
            approach: proposal.approach || proposal.rationale || '',
            estimatedTimeMs: proposal.estimatedTotalTimeMs || 0,
            stepCount: proposal.steps?.length || 0,
            assumptions: proposal.assumptionsAndConstraints || [],
        } : {
            id: '',
            taskSummary: '',
            approach: '',
            estimatedTimeMs: 0,
            stepCount: 0,
            assumptions: [],
        },
        review: review ? {
            id: review.reviewId || review.id || 'p1',
            assessment: review.overallAssessment,
            concernCount: review.concerns?.length || 0,
            criticalCount: review.concerns?.filter((c) => c.severity === 'critical').length || 0,
            highCount: review.concerns?.filter((c) => c.severity === 'high').length || 0,
            concerns: (review.concerns || []).map((c) => ({
                severity: c.severity,
                title: c.title || '',
                description: c.description || '',
                suggestion: c.suggestion,
            })),
        } : {
            id: '',
            assessment: 'viable',
            concernCount: 0,
            criticalCount: 0,
            highCount: 0,
            concerns: [],
        },
        finalPlan: finalPlan ? {
            id: finalPlan.planId || finalPlan.id || 'a1',
            goNogo: finalPlan.goNogo,
            riskAssessment: finalPlan.overallRiskAssessment,
            stepCount: finalPlan.steps?.length || 0,
            addressedConcerns: finalPlan.addressedConcerns?.length || 0,
            remainingRisks: finalPlan.remainingRisks?.length || 0,
            guidance: finalPlan.executionGuidance || [],
            explanation: finalPlan.explanation || '',
        } : {
            id: '',
            goNogo: 'no-go',
            riskAssessment: 'high',
            stepCount: 0,
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
function emitDebateStart(event, debateId) {
    if (!event?.sender)
        return;
    try {
        const debateEvent = {
            type: 'debate_start',
            timestamp: new Date().toISOString(),
            debateId,
        };
        event.sender.send('debate:stream', debateEvent);
    }
    catch (err) {
        // Silently fail
    }
}
/**
 * Emit debate completion event to frontend
 */
function emitDebateComplete(event, debateId, result) {
    if (!event?.sender)
        return;
    try {
        const displayData = formatDebateDataForFrontend(debateId, result.proposal, result.review, result.finalPlan);
        const debateEvent = {
            type: 'debate_complete',
            timestamp: new Date().toISOString(),
            debateId,
            data: displayData,
        };
        event.sender.send('debate:stream', debateEvent);
    }
    catch (err) {
        // Silently fail
    }
}
/**
 * Emit debate error event to frontend
 */
function emitDebateError(event, debateId, error) {
    if (!event?.sender)
        return;
    try {
        const debateEvent = {
            type: 'debate_error',
            timestamp: new Date().toISOString(),
            debateId,
            error: error.message,
        };
        event.sender.send('debate:stream', debateEvent);
    }
    catch (err) {
        // Silently fail
    }
}
