"use strict";
/**
 * EverFern Desktop — Improved Complexity Detection
 *
 * Enhanced AI prompting for more accurate task complexity classification.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeTaskComplexity = analyzeTaskComplexity;
/**
 * Analyze task complexity with sophisticated AI prompting.
 * This determines whether the debate engine should activate.
 */
async function analyzeTaskComplexity(userInput, client, workspaceContext) {
    const systemPrompt = buildComplexitySystemPrompt();
    const userPrompt = buildComplexityUserPrompt(userInput, workspaceContext);
    try {
        const response = await client.chat({
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ],
            temperature: 0, // Deterministic
            maxTokens: 800,
        });
        const responseText = typeof response.content === 'string'
            ? response.content
            : JSON.stringify(response.content);
        return parseComplexityAnalysis(responseText);
    }
    catch (error) {
        console.warn('[ComplexityAnalysis] Failed:', error);
        // Default to moderate if analysis fails
        return {
            complexity: 'moderate',
            confidence: 0.4,
            reasoning: 'Analysis failed, defaulting to moderate',
            factors: [],
            estimatedDurationSeconds: 60,
            riskFactors: [],
        };
    }
}
function buildComplexitySystemPrompt() {
    return `You are a task complexity analyzer for an AI assistant. Your job is to determine if a task should undergo multi-agent debate before execution.

CLASSIFICATION LEVELS:

SIMPLE (Skip debate)
────────────────────
A straightforward, single-phase operation with:
- No interdependencies between steps
- Minimal assumptions
- Clear success criteria
- Low risk of failure
- Quick execution (<10 seconds)

Examples:
- "What's the weather?" (Q&A)
- "Write a hello world program" (Single artifact)
- "Explain this concept" (Information delivery)
- "Fix this small bug in this file" (One file modification)
- "Open Slack" (Single app launch)
- "Click the save button" (Single UI interaction)
- "Take a screenshot" (Single action)
- "Close this window" (Single action)
- "Minimize the app" (Single action)

IMPORTANT: Desktop automation tasks are NOT complex just because they involve GUI interaction.
Opening apps, clicking buttons, typing text, taking screenshots, and other single-step desktop
interactions are SIMPLE tasks. Only classify as complex if there are multiple interdependent
steps, decision points, or significant risk factors.

MODERATE (Consider debate)
──────────────────────────
A task with some complexity requiring coordination:
- 2-4 interdependent steps
- Some assumptions need verification
- Multiple files or components involved
- Medium risk if one step fails
- Moderate execution (30-60 seconds)
- May affect multiple systems

Examples:
- "Set up a Node.js project with TypeScript" (Multiple setup steps)
- "Add authentication to my app" (Touches multiple files)
- "Migrate this API endpoint to a new version" (Coordination needed)
- "Refactor this module" (Multiple files, dependencies)

COMPLEX (Must debate)
─────────────────────
A sophisticated task requiring careful planning:
- 5+ interdependent steps
- Many assumptions that could be wrong
- Large scope (entire codebase, systems)
- High risk if any step fails
- Long execution (>60 seconds)
- Breaking changes possible
- System-level impact

Examples:
- "Migrate my entire codebase to TypeScript" (Major refactoring)
- "Refactor my authentication system" (Security-critical, widespread impact)
- "Upgrade all dependencies and fix breaking changes" (Many unknowns)
- "Restructure the database schema" (High risk, many dependents)
- "Implement a new feature across the stack" (Complex coordination)

DECISION FACTORS:

Complexity Indicators (Higher = More Complex):
✓ Number of files/components affected
✓ Number of external dependencies
✓ Number of assumptions made
✓ Potential for breaking changes
✓ Need for rollback strategy
✓ Impact on other systems
✓ Number of decision points
✓ Need for validation between steps

Risk Factors (Higher = More Complex):
✓ Security implications
✓ Data integrity concerns
✓ Performance implications
✓ Production environment impact
✓ Reversibility of changes
✓ Unknown edge cases

OUTPUT: Respond with a JSON block ONLY. No other text.
{
  "complexity": "simple|moderate|complex",
  "confidence": 0.0-1.0,
  "reasoning": "One-paragraph explanation",
  "factors": ["factor1", "factor2", ...],
  "estimatedDurationSeconds": number,
  "riskFactors": ["risk1", "risk2", ...]
}

CONFIDENCE GUIDE:
- 0.9-1.0: Very confident in classification
- 0.7-0.8: Fairly confident
- 0.5-0.6: Borderline, multiple classifications possible
- <0.5: Uncertain, err on side of caution (higher complexity)`;
}
function buildComplexityUserPrompt(userInput, workspaceContext) {
    const contextInfo = workspaceContext
        ? `\nWORKSPACE CONTEXT:\n${workspaceContext}`
        : '';
    return `Analyze the complexity of this task. Think through each factor systematically:

TASK: "${userInput}"${contextInfo}

CRITICAL REMINDER: Desktop automation tasks (opening apps, clicking buttons, typing, taking screenshots)
are NOT complex just because they involve GUI interaction. These are SIMPLE tasks unless they involve
multiple interdependent steps or significant risk factors.

Step-by-step analysis:

1. SCOPE ANALYSIS:
   - How many different files/components are involved?
   - What is the breadth of changes needed?
   - Does it touch multiple systems?
   - Is this a single desktop action or multiple coordinated steps?

2. DEPENDENCY ANALYSIS:
   - Are steps sequential or parallel?
   - Do later steps depend on earlier ones succeeding?
   - What could break if one step fails?

3. ASSUMPTION ANALYSIS:
   - What assumptions are being made?
   - How likely are those assumptions to be correct?
   - What could happen if assumptions are wrong?

4. RISK ANALYSIS:
   - Could this break existing functionality?
   - Is data integrity at risk?
   - Are there security implications?
   - Is this reversible if it goes wrong?

5. EXECUTION ANALYSIS:
   - Approximately how long will this take?
   - How many decision points are involved?
   - How many validation steps are needed?

6. EDGE CASES:
   - What edge cases might exist?
   - How well-defined is "success"?

Based on this analysis, classify the complexity level.

Respond with ONLY the JSON block. No explanation text.`;
}
function parseComplexityAnalysis(responseText) {
    try {
        // Extract JSON
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error('No JSON found in response');
        }
        const parsed = JSON.parse(jsonMatch[0]);
        return {
            complexity: parsed.complexity || 'moderate',
            confidence: Math.min(1, Math.max(0, parsed.confidence || 0.5)),
            reasoning: parsed.reasoning || 'No reasoning provided',
            factors: Array.isArray(parsed.factors) ? parsed.factors : [],
            estimatedDurationSeconds: parsed.estimatedDurationSeconds || 60,
            riskFactors: Array.isArray(parsed.riskFactors) ? parsed.riskFactors : [],
        };
    }
    catch (error) {
        console.error('[ComplexityAnalysis] Parse error:', error);
        return {
            complexity: 'moderate',
            confidence: 0.3,
            reasoning: 'Failed to parse analysis',
            factors: [],
            estimatedDurationSeconds: 60,
            riskFactors: [],
        };
    }
}
