/**
 * EverFern Desktop — Debate Engine Example Integration
 *
 * This file shows a concrete example of how to integrate the Peer Agent Debate Engine
 * into the AgentRunner class. This is NOT part of the core engine — it's a reference
 * implementation showing how to wire it up.
 *
 * To use this, copy the relevant methods into your AgentRunner class.
 */

import * as crypto from 'crypto';
import type { AIClient } from '../../lib/ai-client';
import {
  PeerAgentDebateEngine,
  type DebateContext,
  type FinalExecutionPlan,
  type DebateResult,
} from './debate-engine';

// ════════════════════════════════════════════════════════════════════════════
// 1. Add to AgentRunner constructor
// ════════════════════════════════════════════════════════════════════════════

export class AgentRunnerDebateIntegration {
  private debateEngine: PeerAgentDebateEngine | null = null;
  private lastDebateResult: DebateResult | null = null;
  private client!: AIClient;
  private tools: any[] = [];
  private workspaceDir?: string;
  private projectId?: string;

  /**
   * Initialize the Debate Engine in AgentRunner constructor.
   * Add this to your existing AgentRunner constructor:
   */
  private initializeDebateEngine(): void {
    if (!this.client) {
      console.warn('[AgentRunner] Cannot initialize debate engine without AI client');
      return;
    }

    this.debateEngine = new PeerAgentDebateEngine(this.client, {
      enableDebate: true,
      complexityThreshold: 'moderate', // Debate for moderate+ complexity tasks
      timeoutMs: 60000, // 60 second hard limit for entire debate
      vanguardTimeoutMs: 15000,
      phantomTimeoutMs: 20000,
      arbiterTimeoutMs: 15000,
      verbose: true, // Log the debate transcript
    });

    console.log('[AgentRunner] ✅ Debate Engine initialized and ready');
  }

  // ════════════════════════════════════════════════════════════════════════════
  // 2. Complexity Analysis
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Analyze task complexity to decide if debate is needed.
   * Call this after triage to determine complexity level.
   */
  async analyzeTaskComplexity(userInput: string): Promise<'simple' | 'moderate' | 'complex'> {
    if (!this.client) return 'moderate';

    const systemPrompt = `You are a task complexity analyzer. Classify the complexity of this task.

SIMPLE: Single operation, straightforward, no dependencies
- Example: "What's the weather?", "Write a hello world program"

MODERATE: Multiple steps, some coordination, manageable complexity
- Example: "Set up a Node.js project", "Add authentication to my app"

COMPLEX: Many interdependencies, careful planning required, high risk if wrong
- Example: "Refactor my entire codebase", "Set up a distributed system", "Implement a complex feature"

Respond with JSON: {"complexity":"simple"|"moderate"|"complex","confidence":0.0-1.0}`;

    try {
      const response = await this.client.chat({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userInput }
        ],
        temperature: 0,
        maxTokens: 100,
      });

      const responseText = typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);

      const match = responseText.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        return parsed.complexity || 'moderate';
      }
    } catch (error) {
      console.warn('[AgentRunner] Complexity analysis failed:', error);
    }

    return 'moderate';
  }

  // ════════════════════════════════════════════════════════════════════════════
  // 3. Debate Activation
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Main method: Run debate if task is complex enough.
   * Call this before normal execution flow.
   *
   * Example usage:
   * ```
   * const debatePlan = await agentRunner.maybeActivateDebate(
   *   userInput,
   *   conversationHistory,
   *   complexity
   * );
   *
   * if (debatePlan) {
   *   // Use debate-approved plan
   *   await executeDebatePlan(debatePlan);
   * } else {
   *   // Use normal execution
   *   await normalExecution();
   * }
   * ```
   */
  async maybeActivateDebate(
    userInput: string,
    conversationHistory: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string }>,
    complexity: 'simple' | 'moderate' | 'complex'
  ): Promise<FinalExecutionPlan | null> {
    if (!this.debateEngine) {
      console.log('[AgentRunner] Debate engine not initialized');
      return null;
    }

    // Check if debate should run
    const shouldDebate = PeerAgentDebateEngine.shouldDebate(
      complexity,
      'moderate' // threshold from config
    );

    if (!shouldDebate) {
      console.log(`[AgentRunner] Skipping debate for "${complexity}" task`);
      return null;
    }

    console.log(`[AgentRunner] 🎭 Task complexity is "${complexity}" — activating debate engine`);

    try {
      // Prepare debate context
      const context: DebateContext = {
        taskId: crypto.randomUUID(),
        userInput,
        conversationHistory,
        availableTools: this.tools.map(t => t.name),
        workspaceContext: this.buildWorkspaceContext(),
        constraints: this.buildTaskConstraints(),
      };

      // Run the debate
      const debateResult = await this.debateEngine.debate(context);

      // Store for audit trail
      this.lastDebateResult = debateResult;

      // Check if plan is executable
      if (debateResult.finalPlan.goNogo === 'no-go') {
        console.error(
          '[AgentRunner] ❌ Debate concluded plan is not executable:',
          debateResult.finalPlan.explanation
        );
        throw new Error(
          `Debate Engine: Plan deemed not executable. ${debateResult.finalPlan.explanation}`
        );
      }

      console.log(`[AgentRunner] ✅ Debate approved plan: ${debateResult.finalPlan.goNogo.toUpperCase()}`);
      return debateResult.finalPlan;
    } catch (error) {
      console.error('[AgentRunner] Debate engine error:', error);
      // Fall back to normal execution
      console.log('[AgentRunner] Falling back to normal execution (debate failed)');
      return null;
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // 4. Context Builders
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Build workspace context for debate.
   * Provides the agents with current environment information.
   */
  private buildWorkspaceContext(): string {
    return `
Project Environment:
- Workspace: ${this.workspaceDir || 'N/A'}
- Project ID: ${this.projectId || 'N/A'}
- Current Time: ${new Date().toISOString()}
- Tools Available: ${this.tools.length}
- Node Version: ${process.version}
- Platform: ${process.platform}
    `.trim();
  }

  /**
   * Build task constraints for debate.
   * Helps agents understand what NOT to do.
   */
  private buildTaskConstraints(): string[] {
    return [
      'Cannot delete files without explicit user confirmation',
      'Cannot modify files outside workspace directory',
      'Must preserve existing functionality and tests',
      'Should not modify unrelated code',
      'Must work within 60-second timeout',
      'Cannot access user credentials or tokens',
    ];
  }

  // ════════════════════════════════════════════════════════════════════════════
  // 5. Debate Plan Execution
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Convert debate plan to executable steps and run them.
   */
  async executeDebatePlan(finalPlan: FinalExecutionPlan): Promise<string> {
    console.log(`\n[AgentRunner] 🚀 Executing Debate-Approved Plan`);
    console.log(`   Phases: ${finalPlan.approvedPhases.length}`);
    console.log(`   Risk: ${finalPlan.overallRiskAssessment}`);
    console.log(`   Status: ${finalPlan.goNogo}`);

    if (finalPlan.goNogo === 'proceed-with-caution') {
      console.log('\n⚠️  Key Things to Watch:');
      finalPlan.executionGuidance.forEach(guidance => {
        console.log(`   → ${guidance}`);
      });
    }

    const results: string[] = [];

    for (let i = 0; i < finalPlan.approvedPhases.length; i++) {
      const phase = finalPlan.approvedPhases[i];
      console.log(`\n[Phase ${i + 1}] ${phase}`);

      try {
        // Execute the phase
        // This would call the actual tool execution logic
        // For now, we just log it
        const result = await this.executeStep({ sequence: i + 1, action: phase, toolsNeeded: [] });
        results.push(result);
        console.log(`   ✅ Complete`);
      } catch (error) {
        console.error(`   ❌ Failed: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
      }
    }

    return results.join('\n');
  }

  /**
   * Execute a single step from the debate plan.
   */
  private async executeStep(step: any): Promise<string> {
    // This is a placeholder. In real implementation, this would:
    // 1. Parse the step.action
    // 2. Call appropriate tools
    // 3. Return result

    console.log(`   Action: ${step.action}`);
    console.log(`   Tools: ${step.toolsNeeded.join(', ')}`);

    return `Step ${step.sequence} executed`;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // 6. Audit Trail & Logging
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Get the last debate result for auditing.
   */
  getLastDebateResult(): DebateResult | null {
    return this.lastDebateResult;
  }

  /**
   * Export debate result as JSON for logging.
   */
  exportLastDebate(): string {
    if (!this.lastDebateResult) {
      return '{}';
    }

    return JSON.stringify(this.lastDebateResult, null, 2);
  }

  /**
   * Get human-readable debate summary.
   */
  getDebatetSummary(): string {
    if (!this.lastDebateResult || !this.debateEngine) {
      return 'No debate run yet';
    }

    return this.debateEngine.summarizeDebate(this.lastDebateResult);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // 7. Integration Example
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Example: Complete integration into main execution flow.
   * This shows how all pieces fit together.
   */
  async exampleCompleteFlow(userInput: string, history: any[]): Promise<string> {
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('AGENT EXECUTION WITH DEBATE ENGINE');
    console.log('═══════════════════════════════════════════════════════════\n');

    try {
      // Step 1: Analyze complexity
      console.log('📊 Step 1: Analyzing task complexity...');
      const complexity = await this.analyzeTaskComplexity(userInput);
      console.log(`   Complexity: ${complexity}`);

      // Step 2: Maybe run debate
      console.log('\n🎭 Step 2: Checking if debate is needed...');
      const debatePlan = await this.maybeActivateDebate(userInput, history, complexity);

      if (debatePlan) {
        // Step 3a: Execute debate plan
        console.log('\n✅ Step 3: Using debate-approved execution plan');
        const result = await this.executeDebatePlan(debatePlan);

        console.log('\n📝 Debate Summary:');
        console.log(this.getDebatetSummary());

        return result;
      } else {
        // Step 3b: Use normal execution
        console.log('\n✅ Step 3: Using standard execution path');
        console.log('(Normal agent execution would happen here)');
        return 'Execution completed via standard path';
      }
    } catch (error) {
      console.error('\n❌ Execution failed:', error);
      throw error;
    }
  }
}
