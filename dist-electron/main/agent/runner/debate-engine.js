"use strict";
/**
 * EverFern Desktop — Peer Agent Debate Engine
 *
 * Orchestrates the three-agent debate system for complex task planning.
 * Before executing complex tasks, three specialized agents debate the best approach.
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
exports.ArbiterAgent = exports.PhantomAgent = exports.VanguardAgent = exports.PeerAgentDebateEngine = void 0;
const crypto = __importStar(require("crypto"));
const vanguard_agent_1 = require("./vanguard-agent");
Object.defineProperty(exports, "VanguardAgent", { enumerable: true, get: function () { return vanguard_agent_1.VanguardAgent; } });
const phantom_agent_1 = require("./phantom-agent");
Object.defineProperty(exports, "PhantomAgent", { enumerable: true, get: function () { return phantom_agent_1.PhantomAgent; } });
const arbiter_agent_1 = require("./arbiter-agent");
Object.defineProperty(exports, "ArbiterAgent", { enumerable: true, get: function () { return arbiter_agent_1.ArbiterAgent; } });
const DEFAULT_CONFIG = {
    enableDebate: true,
    complexityThreshold: 'moderate',
    timeoutMs: 120000,
    vanguardTimeoutMs: 45000,
    phantomTimeoutMs: 45000,
    arbiterTimeoutMs: 30000,
    maxRetries: 1,
    verbose: false,
};
class PeerAgentDebateEngine {
    config;
    vanguard;
    phantom;
    arbiter;
    debateTranscript = [];
    constructor(client, config) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.vanguard = new vanguard_agent_1.VanguardAgent(client);
        this.phantom = new phantom_agent_1.PhantomAgent(client);
        this.arbiter = new arbiter_agent_1.ArbiterAgent(client);
    }
    /**
     * Main entry point: Run the entire debate process.
     * Returns a final execution plan that's been vetted by all three agents.
     */
    async debate(context) {
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
            this.log('\n📋 Phase 1: Vanguard proposes execution plan...');
            const proposal = await this.runWithTimeout(() => this.vanguard.proposeExecutionPlan(context), this.config.vanguardTimeoutMs || 15000, 'Vanguard proposal timed out');
            this.addTranscriptEntry('vanguard', 'proposal', proposal);
            this.log(`✅ Vanguard proposed ${proposal.steps.length} steps`);
            // Emit vanguard_complete event in real-time
            if (this.config.onPhaseComplete) {
                try {
                    await this.config.onPhaseComplete('vanguard', proposal);
                }
                catch (err) {
                    this.log(`⚠️  Error emitting vanguard event: ${err instanceof Error ? err.message : String(err)}`);
                }
            }
            // Phase 2: Phantom critiques
            this.log('\n🔍 Phase 2: Phantom reviews plan critically...');
            const review = await this.runWithTimeout(() => this.phantom.reviewExecutionPlan(proposal, context), this.config.phantomTimeoutMs || 20000, 'Phantom review timed out');
            this.addTranscriptEntry('phantom', 'review', review);
            this.log(`✅ Phantom found ${review.concerns.length} concerns (${review.concerns.filter(c => c.severity === 'critical').length} critical)`);
            this.log(`   Assessment: ${review.overallAssessment}`);
            // Emit phantom_complete event in real-time
            if (this.config.onPhaseComplete) {
                try {
                    await this.config.onPhaseComplete('phantom', proposal, review);
                }
                catch (err) {
                    this.log(`⚠️  Error emitting phantom event: ${err instanceof Error ? err.message : String(err)}`);
                }
            }
            // Phase 3: Arbiter arbitrates
            this.log('\n⚖️  Phase 3: Arbiter arbitrates and finalizes...');
            const finalPlan = await this.runWithTimeout(() => this.arbiter.arbitrateAndFinalize(proposal, review, context), this.config.arbiterTimeoutMs || 15000, 'Arbiter arbitration timed out');
            this.addTranscriptEntry('arbiter', 'arbitration', finalPlan);
            this.log(`✅ Arbiter finalized plan: ${finalPlan.goNogo.toUpperCase()}`);
            this.log(`   Risk Level: ${finalPlan.overallRiskAssessment}`);
            this.log(`   Addressed Concerns: ${finalPlan.addressedConcerns.length}`);
            this.log(`   Remaining Risks: ${finalPlan.remainingRisks.length}`);
            // Emit arbiter_complete event in real-time
            if (this.config.onPhaseComplete) {
                try {
                    await this.config.onPhaseComplete('arbiter', proposal, review, finalPlan);
                }
                catch (err) {
                    this.log(`⚠️  Error emitting arbiter event: ${err instanceof Error ? err.message : String(err)}`);
                }
            }
            // Check execution feasibility
            if (finalPlan.goNogo === 'no-go') {
                this.log('\n❌ DEBATE RESULT: Plan deemed not executable.');
                this.log('   Recommendation: Require manual refinement or task redesign.');
            }
            else if (finalPlan.goNogo === 'proceed-with-caution') {
                this.log('\n⚠️  DEBATE RESULT: Plan is executable with caution.');
                this.log('   Key Risks:');
                finalPlan.executionGuidance.forEach(guidance => {
                    this.log(`   - ${guidance}`);
                });
            }
            else {
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
        }
        catch (error) {
            this.log(`\n❌ Debate failed: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }
    /**
     * Run a function with a timeout.
     * If it takes too long, reject with a timeout error.
     */
    async runWithTimeout(fn, timeoutMs, timeoutMessage) {
        return Promise.race([
            fn(),
            new Promise((_, reject) => setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs)),
        ]);
    }
    /**
     * Add an entry to the debate transcript for auditing.
     */
    addTranscriptEntry(role, type, data) {
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
    log(message) {
        if (this.config.verbose) {
            console.log(`[DebateEngine] ${message}`);
        }
    }
    /**
     * Static helper: Should we debate this task?
     * Returns true for complex tasks, false for simple tasks.
     */
    static shouldDebate(complexity, threshold) {
        if (threshold === 'complex') {
            return complexity === 'complex';
        }
        else if (threshold === 'moderate') {
            return complexity === 'moderate' || complexity === 'complex';
        }
        return false;
    }
    /**
     * Export the debate result for storage/logging.
     */
    exportResult(result) {
        return JSON.stringify(result, null, 2);
    }
    /**
     * Get a human-readable summary of the debate.
     */
    summarizeDebate(result) {
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
exports.PeerAgentDebateEngine = PeerAgentDebateEngine;
