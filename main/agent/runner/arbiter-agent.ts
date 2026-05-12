/**
 * EverFern Desktop — Arbiter Agent
 *
 * The pragmatic decision-maker. Reads both Vanguard and Phantom, ignores nitpicking,
 * takes real problems seriously, and produces the final plan.
 * Role: Senior engineer who signs off on the final design.
 */

import * as crypto from 'crypto';
import type { AIClient } from '../../lib/ai-client';
import type {
  ExecutionProposal,
  CriticalReview,
  FinalExecutionPlan,
  AuditedStep,
  Concern,
  DebateContext
} from './debate-types';
import { extractJsonFromLLM } from './json-repair';
import { loadPrompt } from '../../lib/prompt-sync';

export class ArbiterAgent {
  private client: AIClient;
  private agentId: string;

  constructor(client: AIClient) {
    this.client = client;
    this.agentId = `arbiter-${crypto.randomUUID()}`;
  }

  /**
   * Arbitrate between Vanguard's proposal and Phantom's critique.
   * Produce a final, audited execution plan.
   */
  async arbitrateAndFinalize(
    proposal: ExecutionProposal,
    review: CriticalReview,
    context: DebateContext
  ): Promise<FinalExecutionPlan> {
    const systemPrompt = this.buildSystemPrompt();
    const userPrompt = this.buildUserPrompt(proposal, review, context);

    try {
      const response = await this.client.chat({
        messages: [
          { role: 'system', content: systemPrompt },
          ...context.conversationHistory,
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.2, // Low temperature for principled decision-making
        maxTokens: 2500,
      });

      const responseText = typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);

      return this.parseFinalization(responseText, proposal, review);
    } catch (error) {
      console.error('[Arbiter] Error finalizing plan:', error);
      throw new Error(`Arbiter failed to finalize plan: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private buildSystemPrompt(): string {
    const prompt = loadPrompt('debate-arbiter.md');
    if (!prompt) {
      console.warn('[Arbiter] Could not load debate-arbiter.md prompt. Using fallback.');
      return `You are Arbiter, the Decision-Maker in a peer debate system for AI task planning.`;
    }
    return prompt;
  }

  private buildUserPrompt(
    proposal: ExecutionProposal,
    review: CriticalReview,
    context: DebateContext
  ): string {
    const concernsFormatted = review.concerns
      .sort((a, b) => {
        const severity = { critical: 0, high: 1, medium: 2, low: 3 };
        return (severity[a.severity as keyof typeof severity] || 4) -
               (severity[b.severity as keyof typeof severity] || 4);
      })
      .map(c => `[${c.severity.toUpperCase()}] ${c.title}: ${c.description}${c.suggestion ? ' → ' + c.suggestion : ''}`)
      .join('\n');

    const stepsFormatted = proposal.steps
      .map(s => `Step ${s.sequence}: ${s.description}`)
      .join('\n');

    return `You are now arbitrating the plan debate. Here's both sides:

VANGUARD'S PROPOSAL (Optimistic):
${proposal.approach}
Steps: ${proposal.steps.length}
Estimated Time: ${proposal.estimatedTotalTimeMs}ms

PHANTOM'S ASSESSMENT: ${review.overallAssessment.toUpperCase()}
Concerns found: ${review.concerns.length}
- Critical/High: ${review.concerns.filter(c => c.severity === 'critical' || c.severity === 'high').length}
- Medium: ${review.concerns.filter(c => c.severity === 'medium').length}
- Low: ${review.concerns.filter(c => c.severity === 'low').length}

TOP CONCERNS:
${concernsFormatted}

PHANTOM'S STRONG POINTS:
${review.strongPoints.map(p => `✓ ${p}`).join('\n')}

ORIGINAL TASK: "${context.userInput}"

YOUR JOB:
1. Determine if this plan is fundamentally sound or needs redesign
2. Create mitigations for all medium/high concerns
3. Add prechecks or validation steps where needed
4. Decide: go, proceed-with-caution, or no-go
5. Produce the audited, final plan

Think like a senior engineer:
- Don't reject the plan lightly; fix it instead
- Make brave decisions (Vanguard and Phantom's job to debate; your job to decide)
- Balance risk management with practicality
- Add defensive steps (prechecks, fallbacks) for real risks

Respond with ONLY the JSON block. No other text.`;
  }

  private parseFinalization(
    responseText: string,
    proposal: ExecutionProposal,
    review: CriticalReview
  ): FinalExecutionPlan {
    const parsed = extractJsonFromLLM(responseText);

    // If all parsing strategies failed, return a graceful fallback instead of crashing
    if (!parsed) {
      console.warn('[Arbiter] All JSON parsing strategies failed. Using fallback plan.');
      console.warn('[Arbiter] Raw response (first 800 chars):', responseText.substring(0, 800));
      return {
        arbiterId: this.agentId,
        planId: `final-plan-${crypto.randomUUID()}`,
        timestamp: new Date().toISOString(),
        originTaskSummary: proposal.taskSummary,
        vanguardProposalId: proposal.proposalId,
        phantomReviewId: review.reviewId,
        steps: proposal.steps.map(s => ({
          originalStepId: s.id,
          sequence: s.sequence,
          description: s.description,
          action: s.action,
          toolsNeeded: s.toolsNeeded,
          dependencies: s.dependencies,
          estimatedDurationMs: s.estimatedDurationMs,
          riskLevel: s.riskLevel,
          mitigation: 'Default mitigation (parsing failed)',
          reviewNotes: 'Fallback step due to parsing failure',
        })),
        approvedApproach: proposal.approach,
        addressedConcerns: [],
        remainingRisks: review.concerns,
        overallRiskAssessment: 'high',
        goNogo: 'proceed-with-caution',
        explanation: 'Arbiter could not parse the structured decision. Falling back to Vanguard\'s proposal with all risks flagged.',
        executionGuidance: ['Proceed with caution. The plan could not be formally audited due to a parsing failure.'],
      };
    }

    // Transform steps
    const steps: AuditedStep[] = (parsed.steps || []).map((s: any) => ({
      originalStepId: proposal.steps[s.sequence - 1]?.id || `step-${s.sequence - 1}`,
      sequence: s.sequence || 0,
      description: s.description || '',
      action: s.action || '',
      toolsNeeded: s.toolsNeeded || [],
      dependencies: s.dependencies || [],
      estimatedDurationMs: s.estimatedDurationMs || 5000,
      riskLevel: s.riskLevel || 'medium',
      mitigation: s.mitigation,
      reviewNotes: s.reviewNotes,
    }));

    // Categorize concerns
    const addressedConcerns: Concern[] = [];
    const remainingRisks: Concern[] = [];

    review.concerns.forEach(concern => {
      if (parsed.addressedConcerns?.some((ac: any) => ac.id === concern.id)) {
        addressedConcerns.push(concern);
      } else if (parsed.remainingRisks?.some((rr: any) => rr.id === concern.id)) {
        remainingRisks.push(concern);
      } else if (concern.severity === 'critical' || concern.severity === 'high') {
        // Default: critical/high are addressed unless marked as remaining
        addressedConcerns.push(concern);
      } else {
        remainingRisks.push(concern);
      }
    });

    return {
      arbiterId: this.agentId,
      planId: `final-plan-${crypto.randomUUID()}`,
      timestamp: new Date().toISOString(),
      originTaskSummary: proposal.taskSummary,
      vanguardProposalId: proposal.proposalId,
      phantomReviewId: review.reviewId,
      steps,
      approvedApproach: parsed.approvedApproach || proposal.approach,
      addressedConcerns,
      remainingRisks,
      overallRiskAssessment: parsed.overallRiskAssessment || 'medium',
      goNogo: parsed.goNogo || 'proceed-with-caution',
      explanation: parsed.explanation || 'Plan arbitrated',
      executionGuidance: Array.isArray(parsed.executionGuidance) ? parsed.executionGuidance : [],
    };
  }
}
