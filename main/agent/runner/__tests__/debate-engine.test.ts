/**
 * EverFern Desktop — Debate Engine Test Suite
 *
 * Comprehensive tests for the Peer Agent Debate Engine.
 * Includes unit tests, integration tests, and scenario tests.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PeerAgentDebateEngine, VanguardAgent, PhantomAgent, ArbiterAgent } from './debate-engine';
import type { DebateContext, DebateResult, ExecutionProposal, CriticalReview } from './debate-types';
import type { AIClient } from '../../lib/ai-client';

// ════════════════════════════════════════════════════════════════════════════
// Mock AI Client
// ════════════════════════════════════════════════════════════════════════════

class MockAIClient implements Partial<AIClient> {
  async chat(options: any): Promise<any> {
    // Return mock responses based on system prompt
    const systemPrompt = options.messages?.[0]?.content || '';

    if (systemPrompt.includes('Vanguard')) {
      return this.mockVanguardResponse();
    } else if (systemPrompt.includes('Phantom')) {
      return this.mockPhantomResponse();
    } else if (systemPrompt.includes('Arbiter')) {
      return this.mockArbiterResponse();
    }

    return { content: '{}' };
  }

  private mockVanguardResponse() {
    return {
      content: JSON.stringify({
        taskSummary: 'Refactor codebase to TypeScript',
        approach: 'Migrate files systematically to TypeScript',
        rationale: 'This approach minimizes risk by handling one file at a time',
        steps: [
          {
            sequence: 1,
            description: 'Analyze project structure',
            action: 'Scan project for files and dependencies',
            toolsNeeded: ['readFile', 'fileSystem'],
            dependencies: [],
            estimatedDurationMs: 5000,
            riskLevel: 'low',
          },
          {
            sequence: 2,
            description: 'Create tsconfig.json',
            action: 'Generate TypeScript configuration',
            toolsNeeded: ['writeFile'],
            dependencies: [1],
            estimatedDurationMs: 2000,
            riskLevel: 'low',
          },
          {
            sequence: 3,
            description: 'Convert first file to TypeScript',
            action: 'Rename and update .js to .ts',
            toolsNeeded: ['readFile', 'writeFile'],
            dependencies: [2],
            estimatedDurationMs: 15000,
            riskLevel: 'medium',
          },
        ],
        parallelizable: false,
        estimatedTotalTimeMs: 30000,
        requiredTools: ['readFile', 'writeFile', 'fileSystem'],
        assumptionsAndConstraints: [
          'All files are valid JavaScript',
          'No circular dependencies',
          'Build process will adapt to TypeScript',
        ],
      }),
    };
  }

  private mockPhantomResponse() {
    return {
      content: JSON.stringify({
        overallAssessment: 'concerning',
        concerns: [
          {
            severity: 'high',
            stepId: 'step-1',
            title: 'Missing edge case: circular dependencies',
            description: 'If there are circular dependencies, TypeScript conversion could fail',
            impact: 'Build fails, files partially converted',
            suggestion: 'Add circular dependency check before conversion',
            tags: ['dependency', 'edge-case'],
          },
          {
            severity: 'medium',
            stepId: 'step-3',
            title: 'Type errors likely during conversion',
            description: 'JavaScript with implicit types will have many TypeScript errors',
            impact: 'Conversion takes longer, requires manual fixes',
            suggestion: 'Use lenient tsconfig initially, then tighten',
            tags: ['edge-case', 'performance'],
          },
          {
            severity: 'low',
            stepId: null,
            title: 'Third-party packages might lack types',
            description: 'Some npm packages may not have TypeScript definitions',
            impact: 'May need @types packages or type stubs',
            suggestion: 'Check @types availability before conversion',
            tags: ['dependency'],
          },
        ],
        strongPoints: [
          'Step-by-step approach minimizes risk',
          'Analysis phase is thorough',
          'Reasonable time estimates',
        ],
        worstCaseScenarios: [
          'If circular dependencies exist AND types are incompatible, conversion could fail completely',
          'If build system is tightly coupled to JS, TypeScript integration could break things',
        ],
        alternativeSuggestions: [
          'Use babel to transpile JS to TS gradually',
          'Keep separate TS zone and migrate incrementally',
        ],
      }),
    };
  }

  private mockArbiterResponse() {
    return {
      content: JSON.stringify({
        goNogo: 'proceed-with-caution',
        explanation: 'Plan is sound but requires careful handling of edge cases',
        steps: [
          {
            sequence: 1,
            description: 'Check for circular dependencies',
            action: 'Run dependency checker tool',
            toolsNeeded: ['readFile', 'fileSystem'],
            dependencies: [],
            estimatedDurationMs: 8000,
            riskLevel: 'low',
            mitigation: 'Detect circular deps early; fail fast if found',
            reviewNotes: '[NEW] Added by Arbiter per Phantom concern',
          },
          {
            sequence: 2,
            description: 'Analyze project structure',
            action: 'Scan project for files and dependencies',
            toolsNeeded: ['readFile', 'fileSystem'],
            dependencies: [1],
            estimatedDurationMs: 5000,
            riskLevel: 'low',
            reviewNotes: 'Depends on new Step 1',
          },
          {
            sequence: 3,
            description: 'Create lenient tsconfig.json',
            action: 'Generate TypeScript config with loose type checking',
            toolsNeeded: ['writeFile'],
            dependencies: [2],
            estimatedDurationMs: 2000,
            riskLevel: 'low',
            mitigation: 'Start with lenient config, tighten after',
            reviewNotes: 'Handles Phantom concern about type errors',
          },
        ],
        approvedApproach: 'Systematic TypeScript migration with early validation',
        addressedConcerns: [
          {
            id: 'concern-0',
            severity: 'high',
            title: 'Missing edge case: circular dependencies',
            description: 'Circular dependencies detected early',
            mitigation: 'Added circular dependency check as Step 1',
          },
          {
            id: 'concern-1',
            severity: 'medium',
            title: 'Type errors likely during conversion',
            description: 'Handled by lenient tsconfig',
            mitigation: 'Using loose type checking initially',
          },
        ],
        remainingRisks: [
          {
            id: 'concern-2',
            severity: 'low',
            title: 'Third-party packages might lack types',
            description: 'Some packages may not have @types',
            mitigation: 'If encountered, can install @types or use any',
          },
        ],
        overallRiskAssessment: 'medium',
        executionGuidance: [
          'Check circular dependencies first',
          'If any found, stop and fix them before proceeding',
          'Use lenient tsconfig during conversion',
          'Test build after each file conversion',
          'Have rollback strategy if issues occur',
        ],
      }),
    };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Unit Tests
// ════════════════════════════════════════════════════════════════════════════

describe('VanguardAgent', () => {
  let agent: VanguardAgent;
  let mockClient: MockAIClient;

  beforeEach(() => {
    mockClient = new MockAIClient();
    agent = new VanguardAgent(mockClient as any);
  });

  it('should generate execution proposal', async () => {
    const context: DebateContext = {
      taskId: 'test-1',
      userInput: 'Migrate project to TypeScript',
      conversationHistory: [],
      availableTools: ['readFile', 'writeFile', 'fileSystem'],
      workspaceContext: 'Next.js project',
    };

    const proposal = await agent.proposeExecutionPlan(context);

    expect(proposal).toBeDefined();
    expect(proposal.taskSummary).toBeDefined();
    expect(proposal.steps.length).toBeGreaterThan(0);
    expect(proposal.proposalId).toMatch(/^proposal-/);
    expect(proposal.timestamp).toBeDefined();
  });

  it('should include all step fields', async () => {
    const context: DebateContext = {
      taskId: 'test-2',
      userInput: 'Simple task',
      conversationHistory: [],
      availableTools: ['tool1'],
      workspaceContext: 'Test',
    };

    const proposal = await agent.proposeExecutionPlan(context);

    proposal.steps.forEach(step => {
      expect(step.id).toBeDefined();
      expect(step.sequence).toBeGreaterThan(0);
      expect(step.description).toBeDefined();
      expect(step.action).toBeDefined();
      expect(step.toolsNeeded).toBeInstanceOf(Array);
      expect(step.dependencies).toBeInstanceOf(Array);
      expect(['low', 'medium', 'high']).toContain(step.riskLevel);
    });
  });
});

describe('PhantomAgent', () => {
  let agent: PhantomAgent;
  let mockClient: MockAIClient;

  beforeEach(() => {
    mockClient = new MockAIClient();
    agent = new PhantomAgent(mockClient as any);
  });

  it('should review proposal and identify concerns', async () => {
    const proposal: ExecutionProposal = {
      proposerId: 'vanguard-1',
      proposalId: 'proposal-1',
      timestamp: new Date().toISOString(),
      taskSummary: 'Migrate to TypeScript',
      approach: 'Systematic conversion',
      steps: [],
      parallelizable: false,
      estimatedTotalTimeMs: 30000,
      requiredTools: ['readFile', 'writeFile'],
      assumptionsAndConstraints: ['All files are valid JS'],
      rationale: 'Best approach',
    };

    const context: DebateContext = {
      taskId: 'test-3',
      userInput: 'Migrate to TypeScript',
      conversationHistory: [],
      availableTools: ['readFile', 'writeFile'],
      workspaceContext: 'Project context',
    };

    const review = await agent.reviewExecutionPlan(proposal, context);

    expect(review).toBeDefined();
    expect(review.reviewId).toMatch(/^review-/);
    expect(['viable', 'concerning', 'problematic']).toContain(review.overallAssessment);
    expect(review.concerns).toBeInstanceOf(Array);
  });

  it('should categorize concerns by severity', async () => {
    const proposal: ExecutionProposal = {
      proposerId: 'vanguard-1',
      proposalId: 'proposal-1',
      timestamp: new Date().toISOString(),
      taskSummary: 'Task',
      approach: 'Approach',
      steps: [],
      parallelizable: false,
      estimatedTotalTimeMs: 30000,
      requiredTools: [],
      assumptionsAndConstraints: [],
      rationale: 'Rationale',
    };

    const context: DebateContext = {
      taskId: 'test-4',
      userInput: 'Task',
      conversationHistory: [],
      availableTools: [],
      workspaceContext: 'Context',
    };

    const review = await agent.reviewExecutionPlan(proposal, context);

    review.concerns.forEach(concern => {
      expect(['critical', 'high', 'medium', 'low']).toContain(concern.severity);
      expect(concern.title).toBeDefined();
      expect(concern.description).toBeDefined();
    });
  });
});

describe('ArbiterAgent', () => {
  let agent: ArbiterAgent;
  let mockClient: MockAIClient;

  beforeEach(() => {
    mockClient = new MockAIClient();
    agent = new ArbiterAgent(mockClient as any);
  });

  it('should arbitrate and produce final plan', async () => {
    const proposal: ExecutionProposal = {
      proposerId: 'vanguard-1',
      proposalId: 'proposal-1',
      timestamp: new Date().toISOString(),
      taskSummary: 'Task',
      approach: 'Approach',
      steps: [{ id: 'step-0', sequence: 1, description: 'Step', action: 'Action', toolsNeeded: [], dependencies: [], riskLevel: 'low' }],
      parallelizable: false,
      estimatedTotalTimeMs: 30000,
      requiredTools: [],
      assumptionsAndConstraints: [],
      rationale: 'Rationale',
    };

    const review: CriticalReview = {
      reviewerId: 'phantom-1',
      reviewId: 'review-1',
      timestamp: new Date().toISOString(),
      proposalId: 'proposal-1',
      overallAssessment: 'concerning',
      concerns: [],
      strongPoints: [],
      worstCaseScenarios: [],
    };

    const context: DebateContext = {
      taskId: 'test-5',
      userInput: 'Task',
      conversationHistory: [],
      availableTools: [],
      workspaceContext: 'Context',
    };

    const finalPlan = await agent.arbitrateAndFinalize(proposal, review, context);

    expect(finalPlan).toBeDefined();
    expect(finalPlan.planId).toMatch(/^final-plan-/);
    expect(['go', 'proceed-with-caution', 'no-go']).toContain(finalPlan.goNogo);
    expect(['low', 'medium', 'high', 'critical']).toContain(finalPlan.overallRiskAssessment);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Integration Tests
// ════════════════════════════════════════════════════════════════════════════

describe('PeerAgentDebateEngine', () => {
  let engine: PeerAgentDebateEngine;
  let mockClient: MockAIClient;

  beforeEach(() => {
    mockClient = new MockAIClient();
    engine = new PeerAgentDebateEngine(mockClient as any, {
      enableDebate: true,
      complexityThreshold: 'moderate',
      verbose: false,
    });
  });

  it('should run complete debate flow', async () => {
    const context: DebateContext = {
      taskId: 'test-6',
      userInput: 'Refactor codebase to TypeScript',
      conversationHistory: [],
      availableTools: ['readFile', 'writeFile', 'fileSystem'],
      workspaceContext: 'Next.js project',
      constraints: ['Cannot break tests'],
    };

    const result = await engine.debate(context);

    expect(result).toBeDefined();
    expect(result.debateId).toMatch(/^debate-/);
    expect(result.proposal).toBeDefined();
    expect(result.review).toBeDefined();
    expect(result.finalPlan).toBeDefined();
    expect(result.debateTranscript.length).toBeGreaterThan(0);
  });

  it('should produce valid debate results structure', async () => {
    const context: DebateContext = {
      taskId: 'test-7',
      userInput: 'Complex task',
      conversationHistory: [],
      availableTools: [],
      workspaceContext: 'Context',
    };

    const result = await engine.debate(context);

    // Validate proposal
    expect(result.proposal.steps).toBeInstanceOf(Array);
    expect(result.proposal.proposalId).toBeDefined();

    // Validate review
    expect(result.review.concerns).toBeInstanceOf(Array);
    expect(result.review.reviewId).toBeDefined();

    // Validate final plan
    expect(result.finalPlan.steps).toBeInstanceOf(Array);
    expect(result.finalPlan.goNogo).toBeDefined();
    expect(result.finalPlan.addressedConcerns).toBeInstanceOf(Array);
    expect(result.finalPlan.remainingRisks).toBeInstanceOf(Array);
  });

  it('should export results to JSON', async () => {
    const context: DebateContext = {
      taskId: 'test-8',
      userInput: 'Task',
      conversationHistory: [],
      availableTools: [],
      workspaceContext: 'Context',
    };

    const result = await engine.debate(context);
    const exported = engine.exportResult(result);

    expect(typeof exported).toBe('string');
    const parsed = JSON.parse(exported);
    expect(parsed.debateId).toBeDefined();
  });

  it('should summarize debate', async () => {
    const context: DebateContext = {
      taskId: 'test-9',
      userInput: 'Task',
      conversationHistory: [],
      availableTools: [],
      workspaceContext: 'Context',
    };

    const result = await engine.debate(context);
    const summary = engine.summarizeDebate(result);

    expect(typeof summary).toBe('string');
    expect(summary).toContain('DEBATE SUMMARY');
    expect(summary).toContain('VANGUARD');
    expect(summary).toContain('PHANTOM');
    expect(summary).toContain('ARBITER');
  });

  it('shouldDebate static method works correctly', () => {
    expect(PeerAgentDebateEngine.shouldDebate('simple', 'moderate')).toBe(false);
    expect(PeerAgentDebateEngine.shouldDebate('moderate', 'moderate')).toBe(true);
    expect(PeerAgentDebateEngine.shouldDebate('complex', 'moderate')).toBe(true);
    expect(PeerAgentDebateEngine.shouldDebate('complex', 'complex')).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Scenario Tests
// ════════════════════════════════════════════════════════════════════════════

describe('Debate Scenarios', () => {
  let engine: PeerAgentDebateEngine;
  let mockClient: MockAIClient;

  beforeEach(() => {
    mockClient = new MockAIClient();
    engine = new PeerAgentDebateEngine(mockClient as any, { verbose: false });
  });

  it('should handle TypeScript migration scenario', async () => {
    const context: DebateContext = {
      taskId: 'scenario-1',
      userInput: 'Migrate entire codebase to TypeScript',
      conversationHistory: [],
      availableTools: ['readFile', 'writeFile', 'fileSystem', 'runCommand'],
      workspaceContext: 'Large Node.js project with 50+ files',
      constraints: ['Cannot break existing tests', 'Must maintain backwards compatibility'],
    };

    const result = await engine.debate(context);

    expect(result.proposal.steps.length).toBeGreaterThan(0);
    expect(result.review.concerns.length).toBeGreaterThan(0);
    expect(result.finalPlan.goNogo).toBeDefined();

    // Should address complexity
    const highConcerns = result.review.concerns.filter(c => c.severity === 'high' || c.severity === 'critical');
    const mitigated = result.finalPlan.addressedConcerns.filter(c =>
      c.severity === 'high' || c.severity === 'critical'
    );

    expect(mitigated.length).toBeGreaterThanOrEqual(Math.max(0, highConcerns.length - 1));
  });

  it('should require caution for complex refactoring', async () => {
    const context: DebateContext = {
      taskId: 'scenario-2',
      userInput: 'Refactor authentication system',
      conversationHistory: [],
      availableTools: ['readFile', 'writeFile', 'database'],
      workspaceContext: 'Production system',
      constraints: ['Zero downtime required', 'Cannot lose user data'],
    };

    const result = await engine.debate(context);

    // Complex auth changes should at least be "proceed-with-caution"
    expect(['proceed-with-caution', 'no-go']).toContain(result.finalPlan.goNogo);
  });
});

export const debateEngineTests = true;
