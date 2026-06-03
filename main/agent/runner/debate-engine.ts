/**
 * EverFern Desktop — Peer Agent Debate Engine
 *
 * Orchestrates the three-agent debate system for complex task planning.
 * Before executing complex tasks, three specialized agents debate the best approach.
 */

import * as crypto from 'crypto';
import type { AIClient } from '../../lib/ai-client';
import { VanguardAgent } from './vanguard-agent';
import { PhantomAgent } from './phantom-agent';
import { ArbiterAgent } from './arbiter-agent';
import type {
  DebateContext,
  DebateResult,
  DebateEngineConfig,
  DebateMessage,
  ExecutionProposal,
  CriticalReview,
  FinalExecutionPlan,
  DebatePhase,
  DebateEventEmitterCallback
} from './debate-types';

const DEFAULT_CONFIG: DebateEngineConfig = {
  enableDebate: true,
  complexityThreshold: 'moderate',
  timeoutMs: 240000, // Increased from 180000 to account for streaming delays
  vanguardTimeoutMs: 90000, // Increased from 60000 for streaming support
  phantomTimeoutMs: 90000, // Increased from 60000 for streaming support
  arbiterTimeoutMs: 75000, // Increased from 45000 for streaming support
  maxRetries: 1,
  verbose: false,
};

export class PeerAgentDebateEngine {
  private config: DebateEngineConfig;
  private vanguard: VanguardAgent;
  private phantom: PhantomAgent;
  private arbiter: ArbiterAgent;
  private debateTranscript: DebateMessage[] = [];
  private shouldAbort?: () => boolean;

  constructor(client: AIClient, config?: Partial<DebateEngineConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.vanguard = new VanguardAgent(client);
    this.phantom = new PhantomAgent(client);
    this.arbiter = new ArbiterAgent(client);
    this.shouldAbort = (config as any)?.shouldAbort;
  }

  /**
   * Main entry point: Run the entire debate process.
   * Returns a final execution plan that's been vetted by all three agents.
   */
  async debate(context: DebateContext): Promise<DebateResult> {
    if (!this.config.enableDebate) {
      throw new Error('Debate engine is disabled');
    }

    const debateId = `debate-${crypto.randomUUID()}`;
    const debateStartTime = Date.now();
    this.debateTranscript = [];

    try {
      this.log(`🎭 Starting Peer Agent Debate [${debateId}]`);
      this.log(`Task: "${context.userInput.substring(0, 80)}..."`);

      // Phase 1: Vanguard proposes
      if (this.shouldAbort?.()) {
        throw new Error('Execution aborted by user (stop button clicked)');
      }
      this.log('\n📋 Phase 1: Vanguard proposes execution plan...');
      const proposal = await this.runWithTimeout(
        () => this.vanguard.proposeExecutionPlan(context),
        this.config.vanguardTimeoutMs || 30000,
        'Vanguard proposal timed out'
      );
      this.addTranscriptEntry('vanguard', 'proposal', proposal);
      this.log(`✅ Vanguard proposed ${proposal.steps.length} steps`);

      // Emit vanguard_complete event in real-time
      if (this.config.onPhaseComplete) {
        try {
          await this.config.onPhaseComplete('vanguard', proposal);
        } catch (err) {
          this.log(`⚠️  Error emitting vanguard event: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // Phase 2: Phantom critiques
      if (this.shouldAbort?.()) {
        throw new Error('Execution aborted by user (stop button clicked)');
      }
      this.log('\n🔍 Phase 2: Phantom reviews plan critically...');
      const review = await this.runWithTimeout(
        () => this.phantom.reviewExecutionPlan(proposal, context),
        this.config.phantomTimeoutMs || 45000,
        'Phantom review timed out'
      );
      this.addTranscriptEntry('phantom', 'review', review);
      this.log(`✅ Phantom found ${review.concerns.length} concerns (${
        review.concerns.filter(c => c.severity === 'critical').length
      } critical)`);
      this.log(`   Assessment: ${review.overallAssessment}`);

      // Emit phantom_complete event in real-time
      if (this.config.onPhaseComplete) {
        try {
          await this.config.onPhaseComplete('phantom', proposal, review);
        } catch (err) {
          this.log(`⚠️  Error emitting phantom event: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // Phase 3: Arbiter arbitrates
      if (this.shouldAbort?.()) {
        throw new Error('Execution aborted by user (stop button clicked)');
      }
      this.log('\n⚖️  Phase 3: Arbiter arbitrates and finalizes...');
      const finalPlan = await this.runWithTimeout(
        () => this.arbiter.arbitrateAndFinalize(proposal, review, context),
        this.config.arbiterTimeoutMs || 30000,
        'Arbiter arbitration timed out'
      );
      this.addTranscriptEntry('arbiter', 'arbitration', finalPlan);
      this.log(`✅ Arbiter finalized plan: ${finalPlan.goNogo.toUpperCase()}`);
      this.log(`   Risk Level: ${finalPlan.overallRiskAssessment}`);
      this.log(`   Addressed Concerns: ${finalPlan.addressedConcerns.length}`);
      this.log(`   Remaining Risks: ${finalPlan.remainingRisks.length}`);

      // Emit arbiter_complete event in real-time
      if (this.config.onPhaseComplete) {
        try {
          await this.config.onPhaseComplete('arbiter', proposal, review, finalPlan);
        } catch (err) {
          this.log(`⚠️  Error emitting arbiter event: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // Check execution feasibility
      if (finalPlan.goNogo === 'no-go') {
        this.log('\n❌ DEBATE RESULT: Plan deemed not executable.');
        this.log('   Recommendation: Require manual refinement or task redesign.');
      } else if (finalPlan.goNogo === 'proceed-with-caution') {
        this.log('\n⚠️  DEBATE RESULT: Plan is executable with caution.');
        this.log('   Key Risks:');
        finalPlan.executionGuidance.forEach(guidance => {
          this.log(`   - ${guidance}`);
        });
      } else {
        this.log('\n✅ DEBATE RESULT: Plan approved for execution.');
      }

      const debateElapsedTime = Date.now() - debateStartTime;
      this.log(`\n⏱️  Debate completed in ${debateElapsedTime}ms`);

      return {
        debateId,
        timestamp: new Date().toISOString(),
        context,
        proposal,
        review,
        finalPlan,
        debateTranscript: this.debateTranscript,
      };
    } catch (error) {
      this.log(`\n❌ Debate failed: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Run a function with a timeout.
   * If it takes too long, reject with a timeout error.
   *
   * For streaming operations, this automatically adds a 45-second buffer
   * to allow the LLM to complete its response streaming.
   */
  private async runWithTimeout<T>(
    fn: () => Promise<T>,
    timeoutMs: number,
    timeoutMessage: string
  ): Promise<T> {
    // Add buffer time for streaming responses
    // Most streaming operations complete within this window
    const streamingBufferMs = 45000;
    const totalTimeoutMs = timeoutMs + streamingBufferMs;

    return Promise.race([
      fn(),
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(timeoutMessage)), totalTimeoutMs)
      ),
    ]);
  }

  /**
   * Add an entry to the debate transcript for auditing.
   */
  private addTranscriptEntry(
    role: 'vanguard' | 'phantom' | 'arbiter',
    type: 'proposal' | 'review' | 'arbitration' | 'synthesis',
    data: ExecutionProposal | CriticalReview | FinalExecutionPlan
  ): void {
    this.debateTranscript.push({
      role,
      timestamp: new Date().toISOString(),
      type,
      content: JSON.stringify(data, null, 2),
      data,
    });
  }

  /**
   * Log a message if verbose mode is enabled.
   */
  private log(message: string): void {
    if (this.config.verbose) {
      console.log(`[DebateEngine] ${message}`);
    }
  }

  /**
   * Static helper: Should we debate this task?
   * Returns true for complex tasks, false for simple tasks.
   */
  static shouldDebate(complexity: 'simple' | 'moderate' | 'complex', threshold: string): boolean {
    if (threshold === 'complex') {
      return complexity === 'complex';
    } else if (threshold === 'moderate') {
      return complexity === 'moderate' || complexity === 'complex';
    }
    return false;
  }

  /**
   * Export the debate result for storage/logging.
   */
  exportResult(result: DebateResult): string {
    return JSON.stringify(result, null, 2);
  }

  /**
   * Get a human-readable summary of the debate.
   */
  summarizeDebate(result: DebateResult): string {
    const { proposal, review, finalPlan } = result;

    return `
DEBATE SUMMARY
==============

Task: ${proposal.taskSummary}
Approach: ${proposal.approach}

VANGUARD'S PROPOSAL
- Steps: ${proposal.steps.length}
- Estimated Time: ${proposal.estimatedTotalTimeMs}ms
- Assumptions: ${proposal.assumptionsAndConstraints.length}

PHANTOM'S CRITIQUE
- Overall Assessment: ${review.overallAssessment}
- Critical/High Concerns: ${review.concerns.filter(c => c.severity === 'critical' || c.severity === 'high').length}
- Medium Concerns: ${review.concerns.filter(c => c.severity === 'medium').length}
- Low Concerns: ${review.concerns.filter(c => c.severity === 'low').length}

ARBITER'S DECISION
- Go/No-Go: ${finalPlan.goNogo.toUpperCase()}
- Risk Level: ${finalPlan.overallRiskAssessment}
- Addressed: ${finalPlan.addressedConcerns.length} concerns
- Remaining Risks: ${finalPlan.remainingRisks.length}
- Final Steps: ${finalPlan.steps.length}

EXECUTION GUIDANCE
${finalPlan.executionGuidance.map(g => `- ${g}`).join('\n')}
`;
  }
}

export { VanguardAgent, PhantomAgent, ArbiterAgent };
export type {
  DebateContext,
  DebateResult,
  DebateEngineConfig,
  ExecutionProposal,
  CriticalReview,
  FinalExecutionPlan,
} from './debate-types';
