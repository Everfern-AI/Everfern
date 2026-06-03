/**
 * Planning Agent - Development Strategy and Architecture Planner
 *
 * Evaluates codebase context and user requirements to outline a comprehensive
 * development strategy before any files are altered.
 */

import { GraphStateType, StreamEvent } from '../../../state';
import { AgentRunner } from '../../../runner';
import { runAgentStep } from '../../../services/agent-runtime';

/**
 * Tool definition interface for agent tools
 */
interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}
import { CodebaseMap } from './exploration-agent';

export interface PlanningContext {
  userRequest: string;
  codebaseMap: CodebaseMap;
  constraints: {
    timeframe?: string;
    budget?: string;
    compatibility?: string[];
    performance?: string[];
  };
  preferences: {
    codingStyle?: string;
    testingApproach?: 'unit' | 'integration' | 'e2e' | 'tdd';
    documentationLevel?: 'minimal' | 'standard' | 'comprehensive';
  };
}

export interface DevelopmentPlan {
  overview: {
    title: string;
    description: string;
    estimatedComplexity: 'low' | 'medium' | 'high';
    estimatedTimeframe: string;
  };
  phases: Array<{
    id: string;
    name: string;
    description: string;
    deliverables: string[];
    dependencies: string[];
    estimatedDuration: string;
    riskLevel: 'low' | 'medium' | 'high';
  }>;
  tasks: Array<{
    id: string;
    phase: string;
    title: string;
    description: string;
    type: 'create' | 'modify' | 'delete' | 'refactor' | 'test';
    files: string[];
    priority: 'low' | 'medium' | 'high' | 'critical';
    estimatedEffort: string;
    dependencies: string[];
    acceptance: string[];
  }>;
  architecture: {
    changes: Array<{
      type: 'add' | 'modify' | 'remove';
      component: string;
      rationale: string;
      impact: string;
    }>;
    patterns: string[];
    technologies: string[];
  };
  risks: Array<{
    description: string;
    probability: 'low' | 'medium' | 'high';
    impact: 'low' | 'medium' | 'high';
    mitigation: string;
  }>;
  testing: {
    strategy: string;
    frameworks: string[];
    coverage: string[];
    types: Array<{
      type: 'unit' | 'integration' | 'e2e';
      scope: string;
      priority: 'low' | 'medium' | 'high';
    }>;
  };
}

/**
 * Create a Planning Agent that develops comprehensive implementation strategies
 */
export const createPlanningAgent = (
  runner: AgentRunner,
  context: PlanningContext,
  eventQueue?: StreamEvent[]
) => {
  return async (state: GraphStateType): Promise<{ plan: DevelopmentPlan; planDocument: string }> => {
    console.log('[PlanningAgent] Starting development planning...');

    eventQueue?.push({
      type: 'thought',
      content: '📋 Planning Agent: Developing implementation strategy...'
    });

    // Define planning-specific tools
    const planningTools: ToolDefinition[] = [
      {
        name: 'analyze_requirements',
        description: 'Break down user requirements into actionable development tasks',
        parameters: {
          type: 'object',
          properties: {
            requirements: { type: 'string', description: 'User requirements to analyze' },
            existingCode: { type: 'object', description: 'Current codebase structure' }
          },
          required: ['requirements']
        }
      },
      {
        name: 'estimate_complexity',
        description: 'Estimate development complexity and effort for tasks',
        parameters: {
          type: 'object',
          properties: {
            tasks: {
              type: 'array',
              items: { type: 'object' },
              description: 'List of tasks to estimate'
            },
            codebaseSize: { type: 'string', description: 'Size/complexity of existing codebase' }
          },
          required: ['tasks']
        }
      },
      {
        name: 'plan_architecture_changes',
        description: 'Plan architectural modifications needed for the requirements',
        parameters: {
          type: 'object',
          properties: {
            currentArchitecture: { type: 'object', description: 'Current system architecture' },
            newRequirements: { type: 'string', description: 'New requirements to accommodate' }
          },
          required: ['currentArchitecture', 'newRequirements']
        }
      },
      {
        name: 'identify_risks_and_dependencies',
        description: 'Identify potential risks and task dependencies',
        parameters: {
          type: 'object',
          properties: {
            tasks: { type: 'array', description: 'Planned tasks' },
            constraints: { type: 'object', description: 'Project constraints' }
          },
          required: ['tasks']
        }
      },
      {
        name: 'design_testing_strategy',
        description: 'Design comprehensive testing approach for the development plan',
        parameters: {
          type: 'object',
          properties: {
            features: { type: 'array', items: { type: 'string' }, description: 'Features to be tested' },
            testingPreference: { type: 'string', description: 'Preferred testing approach (TDD, BDD, etc.)' }
          },
          required: ['features']
        }
      },
      {
        name: 'create_plan_document',
        description: 'Generate formal development plan document',
        parameters: {
          type: 'object',
          properties: {
            planData: { type: 'object', description: 'Structured plan data' },
            format: { type: 'string', enum: ['markdown', 'json'], description: 'Output format' }
          },
          required: ['planData']
        }
      }
    ];

    const systemPrompt = `You are the EverFern Planning Agent - a strategic development planner.

MISSION: Create a comprehensive, actionable development plan for the following request:

USER REQUEST: "${context.userRequest}"

CODEBASE CONTEXT:
- Total Files: ${context.codebaseMap.complexity.totalFiles}
- Architecture: ${context.codebaseMap.architecture.patterns.join(', ') || 'Not specified'}
- Frameworks: ${context.codebaseMap.architecture.frameworks.join(', ') || 'Not specified'}
- Entry Points: ${context.codebaseMap.architecture.entryPoints.join(', ') || 'Not specified'}

CONSTRAINTS:
- Timeframe: ${context.constraints.timeframe || 'Not specified'}
- Compatibility: ${context.constraints.compatibility?.join(', ') || 'Not specified'}
- Testing Approach: ${context.preferences.testingApproach || 'standard'}

PLANNING METHODOLOGY:
1. Analyze and decompose the user requirements
2. Estimate complexity and effort for each component
3. Plan necessary architectural changes
4. Identify risks, dependencies, and mitigation strategies
5. Design comprehensive testing strategy
6. Create detailed implementation roadmap
7. Generate formal plan document for approval

DELIVERABLES:
- Structured development plan with phases and tasks
- Risk assessment and mitigation strategies
- Testing strategy and coverage plan
- Implementation timeline and dependencies
- Formal plan document for stakeholder review

Focus on creating a clear, executable plan that the Worker Agent can follow systematically.

Begin planning now.`;

    try {
      const result = await runAgentStep(state, {
        runner,
        toolDefs: planningTools,
        eventQueue,
        nodeName: 'planning_agent',
        systemPromptOverride: systemPrompt
      });

      // Extract development plan from agent's analysis
      // In a real implementation, this would parse the structured output
      const plan: DevelopmentPlan = {
        overview: {
          title: 'Development Plan',
          description: context.userRequest,
          estimatedComplexity: 'medium',
          estimatedTimeframe: '1-2 weeks'
        },
        phases: [
          {
            id: 'phase-1',
            name: 'Analysis & Setup',
            description: 'Initial analysis and environment setup',
            deliverables: ['Requirements analysis', 'Environment setup'],
            dependencies: [],
            estimatedDuration: '1-2 days',
            riskLevel: 'low'
          },
          {
            id: 'phase-2',
            name: 'Core Implementation',
            description: 'Main feature development',
            deliverables: ['Core functionality', 'Unit tests'],
            dependencies: ['phase-1'],
            estimatedDuration: '3-5 days',
            riskLevel: 'medium'
          },
          {
            id: 'phase-3',
            name: 'Integration & Testing',
            description: 'Integration testing and quality assurance',
            deliverables: ['Integration tests', 'Documentation'],
            dependencies: ['phase-2'],
            estimatedDuration: '2-3 days',
            riskLevel: 'low'
          }
        ],
        tasks: [],
        architecture: {
          changes: [],
          patterns: [],
          technologies: []
        },
        risks: [],
        testing: {
          strategy: context.preferences.testingApproach || 'standard',
          frameworks: [],
          coverage: [],
          types: []
        }
      };

      const planDocument = result.messages?.[result.messages.length - 1]?.content || 'Development plan created';

      console.log('[PlanningAgent] Development planning completed');

      eventQueue?.push({
        type: 'thought',
        content: '✅ Planning Agent: Development strategy ready - awaiting approval before handoff to Worker Agent'
      });

      return {
        plan,
        planDocument: typeof planDocument === 'string' ? planDocument : JSON.stringify(planDocument)
      };

    } catch (error) {
      console.error('[PlanningAgent] Error during planning:', error);
      throw new Error(`Planning failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
};
