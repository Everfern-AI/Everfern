/**
 * EverFern Desktop — Phantom Agent
 *
 * The pessimistic red-teamer. Takes Vanguard's plan and tries to destroy it.
 * Role: Building inspector who marks everything that could fail.
 */

import * as crypto from 'crypto';
import type { AIClient } from '../../lib/ai-client';
import type { ExecutionProposal, CriticalReview, Concern, DebateContext } from './debate-types';
import { extractJsonFromLLM } from './json-repair';
import { loadPrompt } from '../../lib/prompt-sync';

export class PhantomAgent {
  private client: AIClient;
  private agentId: string;

  constructor(client: AIClient) {
    this.client = client;
    this.agentId = `phantom-${crypto.randomUUID()}`;
  }

  /**
   * Review and critique Vanguard's execution plan.
   * Phantom is pessimistic and looks for all possible failure modes.
   */
  async reviewExecutionPlan(
    proposal: ExecutionProposal,
    context: DebateContext
  ): Promise<CriticalReview> {
    const systemPrompt = this.buildSystemPrompt();
    const userPrompt = this.buildUserPrompt(proposal, context);

    try {
      const response = await this.client.chat({
        messages: [
          { role: 'system', content: systemPrompt },
          ...context.conversationHistory,
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.4, // Slightly more creative for finding creative failures
        maxTokens: 2500,
      });

      const responseText = typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);

      return this.parseReview(responseText, proposal);
    } catch (error) {
      console.error('[Phantom] Error reviewing execution plan:', error);
      throw new Error(`Phantom failed to review plan: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private buildSystemPrompt(): string {
    const prompt = loadPrompt('debate-phantom.md');
    if (!prompt) {
      console.warn('[Phantom] Could not load debate-phantom.md prompt. Using fallback.');
      return `You are Phantom, the Red-Teamer in a peer debate system for AI task planning.`;
    }
    return prompt;
  }

  private buildUserPrompt(proposal: ExecutionProposal, context: DebateContext): string {
    const stepsFormatted = proposal.steps
      .map(s => `Step ${s.sequence} [${s.id}]: ${s.description} (tools: ${s.toolsNeeded.join(', ')})`)
      .join('\n');

    return `You are now reviewing Vanguard's execution plan. Your job is to ATTACK THIS PLAN and find all the ways it could fail.

PROPOSED PLAN:
Title: ${proposal.taskSummary}
Approach: ${proposal.approach}
Estimated Time: ${proposal.estimatedTotalTimeMs}ms

STEPS:
${stepsFormatted}

ASSUMPTIONS:
${proposal.assumptionsAndConstraints.map(a => `- ${a}`).join('\n')}

ORIGINAL TASK: "${context.userInput}"

WORKSPACE CONTEXT:
${context.workspaceContext}

Now, assume WORST-CASE scenarios:
1. What if files are missing or have unexpected formats?
2. What if tools timeout or fail?
3. What if the assumptions are wrong?
4. What if dependencies break?
5. What if the workspace is different than expected?
6. What if network/system failures occur?
7. What if user doesn't have permissions?
8. What edge cases does this plan not handle?
9. What could cause data loss or corruption?
10. What could cause unrecoverable errors?

Identify:
- Critical blockers that must be addressed
- Medium-risk issues that need mitigation
- Low-risk edge cases worth documenting
- Things the plan does well (be fair!)
- Worst-case scenario chains

Respond with ONLY the JSON block. No other text.`;
  }

  private parseReview(responseText: string, proposal: ExecutionProposal): CriticalReview {
    const parsed = extractJsonFromLLM(responseText);

    // If all parsing strategies failed, return a graceful fallback instead of crashing
    if (!parsed) {
      console.warn('[Phantom] All JSON parsing strategies failed. Using fallback review.');
      console.warn('[Phantom] Raw response (first 800 chars):', responseText.substring(0, 800));
      return {
        reviewerId: this.agentId,
        reviewId: `review-${crypto.randomUUID()}`,
        timestamp: new Date().toISOString(),
        proposalId: proposal.proposalId,
        overallAssessment: 'concerning',
        concerns: [{
          id: 'concern-fallback',
          severity: 'medium' as const,
          stepId: undefined,
          title: 'Review parsing failed',
          description: 'Phantom\'s review could not be parsed. The plan should be executed with caution.',
          impact: 'Unable to assess risk formally.',
          suggestion: 'Proceed with standard error handling.',
          tags: ['edge-case'],
        }],
        strongPoints: [],
        worstCaseScenarios: [],
        alternativeSuggestions: [],
      };
    }

    // Transform concerns
    const concerns: Concern[] = (parsed.concerns || []).map((c: any, idx: number) => ({
      id: `concern-${idx}`,
      severity: c.severity || 'medium',
      stepId: c.stepId || undefined,
      title: c.title || '',
      description: c.description || '',
      impact: c.impact || '',
      suggestion: c.suggestion,
      tags: Array.isArray(c.tags) ? c.tags : [],
    }));

    return {
      reviewerId: this.agentId,
      reviewId: `review-${crypto.randomUUID()}`,
      timestamp: new Date().toISOString(),
      proposalId: proposal.proposalId,
      overallAssessment: parsed.overallAssessment || 'concerning',
      concerns,
      strongPoints: Array.isArray(parsed.strongPoints) ? parsed.strongPoints : [],
      worstCaseScenarios: Array.isArray(parsed.worstCaseScenarios) ? parsed.worstCaseScenarios : [],
      alternativeSuggestions: Array.isArray(parsed.alternativeSuggestions) ? parsed.alternativeSuggestions : [],
    };
  }
}

