"use strict";
/**
 * EverFern Desktop — Phantom Agent
 *
 * The pessimistic red-teamer. Takes Vanguard's plan and tries to destroy it.
 * Role: Building inspector who marks everything that could fail.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.PhantomAgent = void 0;
const crypto = __importStar(require("crypto"));
const json_repair_1 = require("./json-repair");
const prompt_sync_1 = require("../../lib/prompt-sync");
class PhantomAgent {
    client;
    agentId;
    constructor(client) {
        this.client = client;
        this.agentId = `phantom-${crypto.randomUUID()}`;
    }
    /**
     * Review and critique Vanguard's execution plan.
     * Phantom is pessimistic and looks for all possible failure modes.
     */
    async reviewExecutionPlan(proposal, context) {
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
        }
        catch (error) {
            console.error('[Phantom] Error reviewing execution plan:', error);
            throw new Error(`Phantom failed to review plan: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    buildSystemPrompt() {
        const prompt = (0, prompt_sync_1.loadPrompt)('debate-phantom.md');
        if (!prompt) {
            console.warn('[Phantom] Could not load debate-phantom.md prompt. Using fallback.');
            return `You are Phantom, the Red-Teamer in a peer debate system for AI task planning.`;
        }
        return prompt;
    }
    buildUserPrompt(proposal, context) {
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
    parseReview(responseText, proposal) {
        const parsed = (0, json_repair_1.extractJsonFromLLM)(responseText);
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
                        severity: 'medium',
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
        const concerns = (parsed.concerns || []).map((c, idx) => ({
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
exports.PhantomAgent = PhantomAgent;
