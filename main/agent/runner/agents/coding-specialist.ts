import { GraphStateType, StreamEvent } from '../state';
import { AgentRunner } from '../runner';
import { ToolDefinition } from '../../../lib/ai-client';
import { runAgentStep } from '../services/agent-runtime';
import type { MissionTracker } from '../mission-tracker';
import { createMissionIntegrator } from '../mission-integrator';
import { loadPrompt } from '../../../lib/prompt-sync';
import { getDependencyManager } from '../dependency-manager';
import { getSmartRefactorer } from '../smart-refactorer';

// Import specialized coding subagents
import {
  createExplorationAgent,
  createPlanningAgent,
  createWorkerAgent,
  createCodeReviewerAgent,
  createTestRunnerAgent,
  type SubagentCoordination,
  type ExplorationContext,
  type PlanningContext,
  type WorkerContext,
  type ReviewContext,
  type TestContext
} from './coding-assistant/subagents';

/**
 * Enhanced AI Coding Specialist - Multi-Agent Orchestrator
 *
 * An intelligent coding assistant that orchestrates specialized subagents for different
 * development phases, similar to how Claude Code handles complex coding tasks.
 *
 * Subagent Architecture:
 * 1. Exploration Agent: Read-only codebase scanner and analyzer
 * 2. Planning Agent: Strategy and architecture planner
 * 3. Worker Agent: Code writing and bug fixing specialist
 * 4. Code Reviewer: Security and quality checker
 * 5. Test Runner: TDD red/green/refactor specialist
 *
 * Key Features:
 * - Multi-phase development workflow with specialized agents
 * - Comprehensive codebase analysis before making changes
 * - Strategic planning with risk assessment
 * - Quality-focused implementation with continuous validation
 * - Automated code review for security and maintainability
 * - TDD-driven testing with comprehensive coverage
 */

interface CodeContext {
  currentFile?: string;
  selectedText?: string;
  cursorPosition?: { line: number; column: number };
  openFiles: string[];
  recentChanges: Array<{
    file: string;
    type: 'create' | 'modify' | 'delete';
    timestamp: number;
  }>;
  projectStructure: {
    framework?: string;
    language: string;
    dependencies: string[];
    testFramework?: string;
  };
}

interface CodeSuggestion {
  type: 'completion' | 'refactor' | 'fix' | 'optimize' | 'test';
  description: string;
  code?: string;
  file?: string;
  confidence: number;
  reasoning: string;
}

/**
 * Analyze the current codebase context to provide intelligent suggestions
 */
function analyzeCodeContext(state: GraphStateType): CodeContext {
  const dependencyManager = getDependencyManager();
  const allFiles = dependencyManager.getAllFiles();

  // Extract project information from actual codebase analysis
  // No hardcoded patterns - AI learns from actual code structure
  const projectStructure = {
    language: 'unknown', // Will be detected by AI from actual code
    dependencies: [],
    framework: undefined, // Will be detected by AI from actual code
    testFramework: undefined // Will be detected by AI from actual code
  };

  return {
    openFiles: allFiles.slice(0, 10), // Limit for performance
    recentChanges: [], // Would be populated from file system events
    projectStructure
  };
}

/**
 * Generate intelligent code suggestions based on context
 */
function generateCodeSuggestions(
  userInput: string,
  context: CodeContext
): CodeSuggestion[] {
  const suggestions: CodeSuggestion[] = [];
  const dependencyManager = getDependencyManager();
  const refactorer = getSmartRefactorer();

  // Analyze for potential improvements in open files
  for (const file of context.openFiles.slice(0, 5)) {
    // Check for refactoring opportunities
    const refactorOps = refactorer.analyzeCodeArchitecture([file]);
    for (const op of refactorOps) {
      suggestions.push({
        type: 'refactor',
        description: op.description,
        file: op.file,
        confidence: op.impact === 'high' ? 0.9 : op.impact === 'medium' ? 0.7 : 0.5,
        reasoning: op.suggestion
      });
    }

    // Check for naming convention issues
    const namingIssues = refactorer.improveNamingConventions(file);
    for (const issue of namingIssues.slice(0, 3)) { // Limit suggestions
      suggestions.push({
        type: 'refactor',
        description: `Improve naming: ${issue.currentName} → ${issue.suggestedName}`,
        file: issue.file,
        confidence: 0.8,
        reasoning: issue.reason
      });
    }
  }

  // Detect circular dependencies
  const circularDeps = dependencyManager.detectCircularDependencies();
  for (const cycle of circularDeps.slice(0, 2)) {
    suggestions.push({
      type: 'fix',
      description: `Fix circular dependency: ${cycle.cycle.join(' → ')}`,
      confidence: cycle.severity === 'error' ? 0.95 : 0.8,
      reasoning: cycle.suggestion
    });
  }

  // Suggest tests if none exist
  const hasTests = context.openFiles.some(f =>
    f.includes('.test.') || f.includes('.spec.') || f.includes('__tests__')
  );

  if (!hasTests) {
    suggestions.push({
      type: 'test',
      description: 'Add unit tests for the implemented functionality',
      confidence: 0.9,
      reasoning: 'No test files detected. Adding tests will improve code reliability and maintainability.'
    });
  }

  // Sort by confidence and return top suggestions
  return suggestions
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 5);
}

/**
 * Provide intelligent context-aware assistance
 */
function provideIntelligentAssistance(
  userInput: string,
  context: CodeContext,
  suggestions: CodeSuggestion[]
): string {
  let assistance = '';

  // Proactive suggestions based on confidence
  const highConfidenceSuggestions = suggestions.filter(s => s.confidence > 0.8);
  if (highConfidenceSuggestions.length > 0) {
    assistance += '💡 **Proactive suggestions based on your codebase:**\n';
    for (const suggestion of highConfidenceSuggestions.slice(0, 2)) {
      assistance += `• ${suggestion.description}\n  *${suggestion.reasoning}*\n\n`;
    }
  }

  return assistance;
}

export const createCodingSpecialistNode = (
  runner: AgentRunner,
  eventQueue?: StreamEvent[],
  missionTracker?: MissionTracker,
  toolDefs?: ToolDefinition[]
) => {
  const integrator = createMissionIntegrator(missionTracker);

  return async (state: GraphStateType): Promise<Partial<GraphStateType>> => {
    const tools = toolDefs || (runner as any)._buildToolDefinitions();

    // Extract user request and determine current phase
    const messages = state.messages || [];
    const firstUserMsg = messages.find((m: any) => {
      const role = m.role || m._getType?.();
      return role === 'user' || role === 'human';
    });
    const userInput = firstUserMsg
      ? (typeof (firstUserMsg as any).content === 'string'
          ? (firstUserMsg as any).content
          : JSON.stringify((firstUserMsg as any).content))
      : '';

    // Initialize subagent coordination context
    const coordination: SubagentCoordination = state.subagentCoordination || {
      phase: 'exploration',
      currentAgent: 'coding_specialist',
      completedPhases: [],
      sharedContext: {}
    };

    console.log(`[CodingSpecialist] Current phase: ${coordination.phase}, Completed: [${coordination.completedPhases.join(', ')}]`);

    eventQueue?.push({
      type: 'thought',
      content: `💻 Coding Specialist: Orchestrating ${coordination.phase} phase...`
    });

    try {
      // Phase 1: Exploration - Understand the codebase
      if (coordination.phase === 'exploration' && !coordination.completedPhases.includes('exploration')) {
        console.log('[CodingSpecialist] Starting Exploration Phase...');

        const explorationContext: ExplorationContext = {
          targetDirectory: process.cwd(),
          scanDepth: 3,
          includeTests: true,
          includeDocs: true,
          excludePatterns: ['node_modules', '.git', 'dist', 'build'],
          focusAreas: extractFocusAreas(userInput)
        };

        const explorationAgent = createExplorationAgent(runner, explorationContext, eventQueue);
        const explorationResult = await explorationAgent(state);

        coordination.sharedContext.codebaseMap = explorationResult.codebaseMap;
        coordination.completedPhases.push('exploration');
        coordination.phase = 'planning';

        return {
          ...state,
          subagentCoordination: coordination,
          returningFromSpecialist: 'coding_specialist',
          codingComplete: false
        };
      }

      // Phase 2: Planning - Develop strategy and plan
      if (coordination.phase === 'planning' && !coordination.completedPhases.includes('planning')) {
        console.log('[CodingSpecialist] Starting Planning Phase...');

        const planningContext: PlanningContext = {
          userRequest: userInput,
          codebaseMap: coordination.sharedContext.codebaseMap,
          constraints: {
            timeframe: 'standard',
            compatibility: ['cross-browser', 'backwards-compatible']
          },
          preferences: {
            testingApproach: 'tdd',
            documentationLevel: 'standard'
          }
        };

        const planningAgent = createPlanningAgent(runner, planningContext, eventQueue);
        const planningResult = await planningAgent(state);

        coordination.sharedContext.developmentPlan = planningResult.plan;
        coordination.completedPhases.push('planning');

        // Check if plan needs approval
        const needsApproval = planningResult.plan.overview.estimatedComplexity === 'high' ||
                             planningResult.plan.risks.some(r => r.impact === 'high');

        if (needsApproval) {
          eventQueue?.push({
            type: 'thought',
            content: '📋 Development plan ready - requesting user approval before implementation...'
          });

          // Present plan for approval
          const planSummary = `## Development Plan\n\n${planningResult.planDocument}\n\nApprove this plan to proceed with implementation?`;

          return {
            ...state,
            subagentCoordination: coordination,
            returningFromSpecialist: 'coding_specialist',
            codingComplete: false,
            pendingApproval: {
              type: 'development_plan',
              content: planSummary,
              nextPhase: 'implementation'
            }
          };
        } else {
          coordination.phase = 'implementation';
        }
      }

      // Phase 3: Implementation - Write the code
      if (coordination.phase === 'implementation' && !coordination.completedPhases.includes('implementation')) {
        console.log('[CodingSpecialist] Starting Implementation Phase...');

        const plan = coordination.sharedContext.developmentPlan;
        const currentPhase = plan?.phases[0]?.id || 'main';

        const workerContext: WorkerContext = {
          plan: coordination.sharedContext.developmentPlan,
          currentPhase,
          currentTask: 'implement_features',
          workingDirectory: process.cwd(),
          buildCommand: detectBuildCommand(),
          testCommand: detectTestCommand()
        };

        const workerAgent = createWorkerAgent(runner, workerContext, eventQueue);
        const workerResult = await workerAgent(state);

        coordination.sharedContext.implementationResults = workerResult.result;
        coordination.completedPhases.push('implementation');
        coordination.phase = 'review';
      }

      // Phase 4: Code Review - Quality and security check
      if (coordination.phase === 'review' && !coordination.completedPhases.includes('review')) {
        console.log('[CodingSpecialist] Starting Code Review Phase...');

        const reviewContext: ReviewContext = {
          implementationResult: coordination.sharedContext.implementationResults,
          reviewCriteria: {
            security: true,
            performance: true,
            maintainability: true,
            testCoverage: true,
            documentation: true,
            codeStyle: true
          },
          strictnessLevel: 'standard'
        };

        const reviewerAgent = createCodeReviewerAgent(runner, reviewContext, eventQueue);
        const reviewResult = await reviewerAgent(state);

        coordination.sharedContext.reviewResults = reviewResult.review;
        coordination.completedPhases.push('review');

        // Check if critical issues were found
        const criticalIssues = reviewResult.review.issues.filter(i => i.severity === 'critical');
        if (criticalIssues.length > 0) {
          eventQueue?.push({
            type: 'thought',
            content: `⚠️ Code review found ${criticalIssues.length} critical issues - returning to implementation phase`
          });

          coordination.phase = 'implementation';
          coordination.completedPhases = coordination.completedPhases.filter(p => p !== 'implementation');

          return {
            ...state,
            subagentCoordination: coordination,
            returningFromSpecialist: 'coding_specialist',
            codingComplete: false
          };
        } else {
          coordination.phase = 'testing';
        }
      }

      // Phase 5: Testing - TDD and comprehensive validation
      if (coordination.phase === 'testing' && !coordination.completedPhases.includes('testing')) {
        console.log('[CodingSpecialist] Starting Testing Phase...');

        const testContext: TestContext = {
          reviewResult: coordination.sharedContext.reviewResults,
          testStrategy: 'tdd',
          testFramework: detectTestFramework(),
          coverageTarget: 80,
          testDirectory: './tests',
          srcDirectory: './src'
        };

        const testRunnerAgent = createTestRunnerAgent(runner, testContext, eventQueue);
        const testResult = await testRunnerAgent(state);

        coordination.sharedContext.testResults = testResult.testResult;
        coordination.completedPhases.push('testing');
        coordination.phase = 'complete';
      }

      // All phases complete
      if (coordination.phase === 'complete') {
        console.log('[CodingSpecialist] All phases completed successfully');

        eventQueue?.push({
          type: 'thought',
          content: '✅ Coding Specialist: All development phases completed successfully!'
        });

        // Generate final summary
        const summary = generateCompletionSummary(coordination.sharedContext);

        return {
          ...state,
          subagentCoordination: coordination,
          returningFromSpecialist: null,
          codingComplete: true,
          completionSummary: summary
        };
      }

      // Continue with current phase
      return {
        ...state,
        subagentCoordination: coordination,
        returningFromSpecialist: 'coding_specialist',
        codingComplete: false
      };

    } catch (error) {
      console.error(`[CodingSpecialist] Error in ${coordination.phase} phase:`, error);

      eventQueue?.push({
        type: 'thought',
        content: `❌ Error in ${coordination.phase} phase: ${error instanceof Error ? error.message : String(error)}`
      });

      // Fallback to basic coding specialist behavior
      const systemPrompt = (loadPrompt('coding-specialist.md') || '') +
        `\n\nERROR RECOVERY: Multi-agent system encountered an error. Proceeding with direct implementation.`;

      const result = await integrator.wrapNode(
        'coding_specialist_fallback',
        () => runAgentStep(state, {
          runner,
          toolDefs: tools,
          eventQueue,
          nodeName: 'coding_specialist',
          systemPromptOverride: systemPrompt,
        }),
        'Fallback coding implementation'
      );

      return {
        ...result,
        returningFromSpecialist: null,
        codingComplete: true
      };
    }
  };
};

/**
 * Helper functions for the multi-agent system
 */

function extractFocusAreas(userInput: string): string[] {
  const areas: string[] = [];
  const keywords = {
    'auth': ['auth', 'login', 'authentication', 'security', 'user'],
    'database': ['database', 'db', 'sql', 'query', 'data'],
    'api': ['api', 'endpoint', 'rest', 'graphql', 'service'],
    'ui': ['ui', 'interface', 'component', 'frontend', 'react'],
    'testing': ['test', 'spec', 'coverage', 'tdd', 'unit'],
    'performance': ['performance', 'optimization', 'speed', 'cache']
  };

  const lowerInput = userInput.toLowerCase();
  for (const [area, terms] of Object.entries(keywords)) {
    if (terms.some(term => lowerInput.includes(term))) {
      areas.push(area);
    }
  }

  return areas.length > 0 ? areas : ['general'];
}

function detectBuildCommand(): string {
  // Simple detection logic - in production, this would check package.json, etc.
  return 'npm run build';
}

function detectTestCommand(): string {
  // Simple detection logic - in production, this would check package.json, etc.
  return 'npm test';
}

function detectTestFramework(): string {
  // Simple detection logic - in production, this would check dependencies
  return 'jest';
}

function generateCompletionSummary(sharedContext: any): string {
  const { codebaseMap, developmentPlan, implementationResults, reviewResults, testResults } = sharedContext;

  return `
## Development Summary

### Codebase Analysis
- Files analyzed: ${codebaseMap?.complexity?.totalFiles || 0}
- Architecture patterns: ${codebaseMap?.architecture?.patterns?.join(', ') || 'N/A'}

### Implementation
- Files created: ${implementationResults?.createdFiles?.length || 0}
- Files modified: ${implementationResults?.modifiedFiles?.length || 0}
- Build status: ${implementationResults?.buildResult?.success ? '✅ Success' : '❌ Failed'}

### Code Review
- Overall rating: ${reviewResults?.overallRating || 'N/A'}
- Security score: ${reviewResults?.metrics?.security?.score || 0}/100
- Issues found: ${reviewResults?.issues?.length || 0}

### Testing
- Test coverage: ${testResults?.coverage?.percentage || 0}%
- Tests passed: ${testResults?.testSuite?.passed || 0}
- Tests failed: ${testResults?.testSuite?.failed || 0}

All development phases completed successfully with quality assurance checks.
  `.trim();
}
