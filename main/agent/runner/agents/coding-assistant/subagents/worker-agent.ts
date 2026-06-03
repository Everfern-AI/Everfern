/**
 * Worker/Implementation Agent - Code Writing and Bug Fixing Specialist
 *
 * An execution-focused subagent dedicated to actually writing code, fixing bugs,
 * and implementing features according to the development plan.
 */

import { GraphStateType, StreamEvent } from '../../../state';
import { AgentRunner } from '../../../runner';
import { runAgentStep } from '../../../services/agent-runtime';
import { DevelopmentPlan } from './planning-agent';

/**
 * Tool definition interface for agent tools
 */
interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface WorkerContext {
  plan: DevelopmentPlan;
  currentPhase: string;
  currentTask: string;
  workingDirectory: string;
  buildCommand?: string;
  testCommand?: string;
}

export interface ImplementationTask {
  id: string;
  type: 'create' | 'modify' | 'delete' | 'refactor';
  file: string;
  description: string;
  code?: string;
  dependencies: string[];
  status: 'pending' | 'in-progress' | 'completed' | 'failed';
  effort: string;
}

export interface ImplementationResult {
  completedTasks: ImplementationTask[];
  createdFiles: string[];
  modifiedFiles: string[];
  deletedFiles: string[];
  buildResult?: {
    success: boolean;
    output: string;
    errors: string[];
  };
  testResult?: {
    success: boolean;
    output: string;
    passed: number;
    failed: number;
    coverage?: string;
  };
}

/**
 * Create a Worker Agent focused on implementation and code writing
 */
export const createWorkerAgent = (
  runner: AgentRunner,
  context: WorkerContext,
  eventQueue?: StreamEvent[]
) => {
  return async (state: GraphStateType): Promise<{ result: ImplementationResult; summary: string }> => {
    console.log('[WorkerAgent] Starting implementation phase...');

    eventQueue?.push({
      type: 'thought',
      content: '⚡ Worker Agent: Beginning code implementation...'
    });

    // Define implementation-specific tools
    const workerTools: ToolDefinition[] = [
      {
        name: 'read_existing_code',
        description: 'Read and understand existing code before making changes',
        parameters: {
          type: 'object',
          properties: {
            filePath: { type: 'string', description: 'Path to file to read' },
            focusArea: { type: 'string', description: 'Specific area/function to focus on' }
          },
          required: ['filePath']
        }
      },
      {
        name: 'write_code_file',
        description: 'Create or modify a code file with proper formatting and structure',
        parameters: {
          type: 'object',
          properties: {
            filePath: { type: 'string', description: 'Path where to write the file' },
            content: { type: 'string', description: 'Complete file content' },
            language: { type: 'string', description: 'Programming language for syntax validation' },
            overwrite: { type: 'boolean', description: 'Whether to overwrite existing file' }
          },
          required: ['filePath', 'content']
        }
      },
      {
        name: 'apply_code_patch',
        description: 'Apply incremental changes to existing code files',
        parameters: {
          type: 'object',
          properties: {
            filePath: { type: 'string', description: 'File to patch' },
            changes: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  lineNumber: { type: 'number' },
                  oldCode: { type: 'string' },
                  newCode: { type: 'string' },
                  operation: { type: 'string', enum: ['replace', 'insert', 'delete'] }
                }
              }
            }
          },
          required: ['filePath', 'changes']
        }
      },
      {
        name: 'run_build_command',
        description: 'Execute build command to compile and check for errors',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'Build command to execute' },
            workingDirectory: { type: 'string', description: 'Directory to run command in' }
          },
          required: ['command']
        }
      },
      {
        name: 'run_tests',
        description: 'Execute test suite to validate implementation',
        parameters: {
          type: 'object',
          properties: {
            testCommand: { type: 'string', description: 'Test command to execute' },
            testPattern: { type: 'string', description: 'Pattern to match specific tests' },
            coverage: { type: 'boolean', description: 'Whether to generate coverage report' }
          },
          required: ['testCommand']
        }
      },
      {
        name: 'validate_syntax',
        description: 'Check syntax and basic validation of code files',
        parameters: {
          type: 'object',
          properties: {
            files: {
              type: 'array',
              items: { type: 'string' },
              description: 'Files to validate'
            },
            language: { type: 'string', description: 'Programming language' }
          },
          required: ['files']
        }
      },
      {
        name: 'refactor_code',
        description: 'Perform safe refactoring operations on existing code',
        parameters: {
          type: 'object',
          properties: {
            filePath: { type: 'string', description: 'File to refactor' },
            refactorType: {
              type: 'string',
              enum: ['extract-function', 'rename-variable', 'simplify', 'optimize'],
              description: 'Type of refactoring to perform'
            },
            targetArea: { type: 'string', description: 'Specific code area to refactor' }
          },
          required: ['filePath', 'refactorType']
        }
      },
      {
        name: 'create_directory_structure',
        description: 'Create necessary directory structure for the project',
        parameters: {
          type: 'object',
          properties: {
            basePath: { type: 'string', description: 'Base path for directory creation' },
            structure: {
              type: 'array',
              items: { type: 'string' },
              description: 'List of directories to create'
            }
          },
          required: ['basePath', 'structure']
        }
      }
    ];

    const systemPrompt = `You are the EverFern Worker Agent - a focused implementation specialist.

MISSION: Execute the development plan by writing high-quality code, fixing bugs, and implementing features.

CURRENT TASK: ${context.currentTask}
CURRENT PHASE: ${context.currentPhase}
WORKING DIRECTORY: ${context.workingDirectory}

DEVELOPMENT PLAN OVERVIEW:
${JSON.stringify(context.plan.overview, null, 2)}

CURRENT PHASE TASKS:
${context.plan.tasks
  .filter(task => task.phase === context.currentPhase)
  .map(task => `- ${task.id}: ${task.title} (${task.type})`)
  .join('\n')}

IMPLEMENTATION STRATEGY:
1. Read and understand existing code before making changes
2. Follow the development plan systematically
3. Write clean, well-documented code following best practices
4. Validate syntax and run builds after each significant change
5. Execute tests to ensure functionality works correctly
6. Handle errors gracefully and provide detailed feedback
7. Perform incremental commits with clear messages

QUALITY STANDARDS:
- Follow existing code style and conventions
- Add appropriate comments and documentation
- Ensure proper error handling and validation
- Write maintainable and readable code
- Consider performance implications
- Follow security best practices

TOOLS AVAILABLE: read_existing_code, write_code_file, apply_code_patch, run_build_command, run_tests, validate_syntax, refactor_code, create_directory_structure

BUILD COMMAND: ${context.buildCommand || 'Not specified'}
TEST COMMAND: ${context.testCommand || 'Not specified'}

Focus on executing the current task efficiently while maintaining code quality.

Begin implementation now.`;

    try {
      const result = await runAgentStep(state, {
        runner,
        toolDefs: workerTools,
        eventQueue,
        nodeName: 'worker_agent',
        systemPromptOverride: systemPrompt
      });

      // Extract implementation results from agent's work
      // In a real implementation, this would track all file operations and results
      const implementationResult: ImplementationResult = {
        completedTasks: [],
        createdFiles: [],
        modifiedFiles: [],
        deletedFiles: [],
        buildResult: {
          success: true,
          output: '',
          errors: []
        },
        testResult: {
          success: true,
          output: '',
          passed: 0,
          failed: 0
        }
      };

      const summary = result.messages?.[result.messages.length - 1]?.content || 'Implementation completed';

      console.log('[WorkerAgent] Implementation phase completed');

      eventQueue?.push({
        type: 'thought',
        content: '✅ Worker Agent: Implementation complete - handoff to Code Reviewer Agent'
      });

      return {
        result: implementationResult,
        summary: typeof summary === 'string' ? summary : JSON.stringify(summary)
      };

    } catch (error) {
      console.error('[WorkerAgent] Error during implementation:', error);
      throw new Error(`Implementation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
};
