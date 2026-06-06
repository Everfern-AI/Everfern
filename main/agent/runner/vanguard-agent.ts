/**
 * EverFern Desktop — Vanguard Agent
 *
 * The optimistic proposer. Analyzes the task and generates a detailed execution plan.
 * Role: Architect who draws the blueprints.
 */

import * as crypto from 'crypto';
import type { AIClient } from '../../lib/ai-client';
import type { ExecutionProposal, DebateContext } from './debate-types';
import { extractJsonFromLLM } from './json-repair';
import { loadPrompt } from '../../lib/prompt-sync';

export class VanguardAgent {
  private client: AIClient;
  private agentId: string;

  constructor(client: AIClient) {
    this.client = client;
    this.agentId = `vanguard-${crypto.randomUUID()}`;
  }

  /**
   * Propose a detailed execution plan for the given task.
   * Vanguard is optimistic and assumes best-case scenarios.
   */
  async proposeExecutionPlan(context: DebateContext): Promise<ExecutionProposal> {
    const systemPrompt = this.buildSystemPrompt(context);
    const userPrompt = this.buildUserPrompt(context);

    try {
      const response = await this.client.chat({
        messages: [
          { role: 'system', content: systemPrompt },
          ...context.conversationHistory,
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.3, // Slightly creative but deterministic
        maxTokens: 2000,
      });

      const responseText = typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);

      return this.parseProposal(responseText, context);
    } catch (error) {
      console.error('[Vanguard] Error proposing execution plan:', error);
      throw new Error(`Vanguard failed to propose plan: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private buildSystemPrompt(context: DebateContext): string {
    const toolsList = context.availableTools.join('\n- ');
    let prompt = loadPrompt('debate-vanguard.md');
    if (!prompt) {
      console.warn('[Vanguard] Could not load debate-vanguard.md prompt. Using fallback.');
      return `You are Vanguard, the Proposer in a peer debate system for AI task planning.`;
    }
    // Replace the placeholder with actual available tools
    prompt = prompt.replace('{availableTools}', toolsList);
    prompt = prompt.replace('{endnote}', `Current tools available: ${toolsList}`);
    return prompt;
  }

  private buildUserPrompt(context: DebateContext): string {
    const toolsList = context.availableTools.join(', ');
    const constraintsText = context.constraints?.length
      ? `Constraints: ${context.constraints.join('; ')}`
      : '';

    return `You are designing an execution plan for this task:

TASK: "${context.userInput}"

AVAILABLE TOOLS: ${toolsList}

WORKSPACE CONTEXT:
${context.workspaceContext}

${constraintsText}

CONVERSATION HISTORY (last few messages):
${context.conversationHistory.slice(-3).map(m => `${m.role}: ${m.content}`).join('\n')}

Generate a detailed execution plan. Think step-by-step:
1. What is the core objective?
2. What are the main phases of work?
3. What tools do we need?
4. What order should steps happen in?
5. Which steps can run in parallel?

Respond with ONLY the JSON block. No other text.`;
  }

  private parseProposal(responseText: string, context: DebateContext): ExecutionProposal {
    const parsed = extractJsonFromLLM(responseText);

    // If all parsing strategies failed, return a graceful fallback instead of crashing
    if (!parsed) {
      console.warn('[Vanguard] All JSON parsing strategies failed. Using fallback proposal.');
      console.warn('[Vanguard] Raw response (first 800 chars):', responseText.substring(0, 800));
      return {
        proposerId: this.agentId,
        proposalId: `proposal-${crypto.randomUUID()}`,
        timestamp: new Date().toISOString(),
        taskSummary: 'Fallback plan due to parsing error',
        approach: 'Execute task steps sequentially with available tools.',
        phases: ['Phase 1: Attempt to fulfill the user request directly'],
        parallelizable: false,
        estimatedTotalTimeMs: 10000,
        requiredTools: context.availableTools,
        assumptionsAndConstraints: ['Parsing failed, assuming default flow'],
        rationale: 'Generated fallback plan because the model output could not be parsed as JSON.',
      };
    }

    // Extract phases from parsed response
    const phases: string[] = Array.isArray(parsed.phases)
      ? parsed.phases.map((p: any) => typeof p === 'string' ? p : (p.description || p.title || JSON.stringify(p)))
      : (parsed.steps || []).map((s: any, idx: number) => `Phase ${idx + 1}: ${s.description || s.action || 'Unknown'}`);

    return {
      proposerId: this.agentId,
      proposalId: `proposal-${crypto.randomUUID()}`,
      timestamp: new Date().toISOString(),
      taskSummary: parsed.taskSummary || 'Unnamed task',
      approach: parsed.approach || '',
      phases,
      parallelizable: parsed.parallelizable || false,
      estimatedTotalTimeMs: parsed.estimatedTotalTimeMs || 30000,
      requiredTools: parsed.requiredTools || [],
      assumptionsAndConstraints: parsed.assumptionsAndConstraints || [],
      rationale: parsed.rationale || '',
    };
  }
}
