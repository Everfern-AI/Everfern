/**
 * Exploration Agent - Read-Only Codebase Scanner
 *
 * A specialized subagent designed to scan and understand large codebases without making changes.
 * Focuses on mapping architecture, dependencies, patterns, and providing context for other agents.
 */

import { GraphStateType, StreamEvent } from '../../../state';
import { AgentRunner } from '../../../runner';
import { runAgentStep } from '../../../services/agent-runtime';
import { ToolDefinition } from '../../../../../lib/ai-client';
import { HumanMessage } from '@langchain/core/messages';

export interface ExplorationContext {
  targetDirectory: string;
  scanDepth: number;
  includeTests: boolean;
  includeDocs: boolean;
  excludePatterns: string[];
  focusAreas?: string[]; // Specific areas to focus on (e.g., 'auth', 'database', 'api')
}

export interface CodebaseMap {
  structure: {
    directories: Array<{
      path: string;
      type: 'source' | 'test' | 'config' | 'docs' | 'build';
      fileCount: number;
    }>;
    files: Array<{
      path: string;
      type: 'source' | 'test' | 'config' | 'docs';
      language: string;
      size: number;
      lastModified: number;
    }>;
  };
  architecture: {
    entryPoints: string[];
    coreModules: string[];
    dependencies: Array<{
      name: string;
      version?: string;
      type: 'production' | 'development';
    }>;
    frameworks: string[];
    patterns: string[]; // Detected patterns like MVC, microservices, etc.
  };
  relationships: Array<{
    from: string;
    to: string;
    type: 'imports' | 'calls' | 'extends' | 'implements';
  }>;
  complexity: {
    totalFiles: number;
    totalLines: number;
    averageComplexity: number;
    hotspots: Array<{
      file: string;
      reason: string;
      severity: 'low' | 'medium' | 'high';
    }>;
  };
  recommendations: Array<{
    type: 'refactor' | 'optimize' | 'security' | 'maintainability';
    description: string;
    files: string[];
    priority: 'low' | 'medium' | 'high';
  }>;
}

/**
 * Create an Exploration Agent that scans and maps codebases
 */
export const createExplorationAgent = (
  runner: AgentRunner,
  context: ExplorationContext,
  eventQueue?: StreamEvent[]
) => {
  return async (state: GraphStateType): Promise<{ codebaseMap: CodebaseMap; analysis: string }> => {
    console.log('[ExplorationAgent] Starting codebase exploration...');

    eventQueue?.push({
      type: 'thought',
      content: '🔍 Exploration Agent: Scanning codebase architecture...'
    });

    // Define exploration-specific tools (read-only operations)
    const explorationTools: ToolDefinition[] = [
      {
        name: 'scan_directory_structure',
        description: 'Recursively scan directory structure to understand project layout',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Directory path to scan' },
            maxDepth: { type: 'number', description: 'Maximum recursion depth' },
            excludePatterns: {
              type: 'array',
              items: { type: 'string' },
              description: 'Patterns to exclude (node_modules, .git, etc.)'
            }
          },
          required: ['path']
        }
      },
      {
        name: 'analyze_file_dependencies',
        description: 'Analyze import/require statements and dependencies in source files',
        parameters: {
          type: 'object',
          properties: {
            filePath: { type: 'string', description: 'Path to file to analyze' },
            language: { type: 'string', description: 'Programming language (auto-detect if not provided)' }
          },
          required: ['filePath']
        }
      },
      {
        name: 'detect_architecture_patterns',
        description: 'Detect architectural patterns and frameworks in use',
        parameters: {
          type: 'object',
          properties: {
            rootPath: { type: 'string', description: 'Root directory to analyze' },
            fileTypes: {
              type: 'array',
              items: { type: 'string' },
              description: 'File extensions to analyze'
            }
          },
          required: ['rootPath']
        }
      },
      {
        name: 'measure_code_complexity',
        description: 'Calculate complexity metrics for source files',
        parameters: {
          type: 'object',
          properties: {
            files: {
              type: 'array',
              items: { type: 'string' },
              description: 'List of files to analyze'
            }
          },
          required: ['files']
        }
      },
      {
        name: 'identify_entry_points',
        description: 'Find main entry points and public APIs',
        parameters: {
          type: 'object',
          properties: {
            projectRoot: { type: 'string', description: 'Project root directory' }
          },
          required: ['projectRoot']
        }
      }
    ];

    const systemPrompt = `You are the EverFern Exploration Agent - a read-only codebase scanner and analyzer.

MISSION: Thoroughly analyze the codebase at "${context.targetDirectory}" and create a comprehensive map.

FOCUS AREAS: ${context.focusAreas?.join(', ') || 'General codebase analysis'}

EXPLORATION STRATEGY:
1. Scan directory structure to understand project layout
2. Identify entry points, main modules, and configuration files
3. Map dependencies and imports between files
4. Detect architectural patterns and frameworks
5. Measure complexity and identify potential issues
6. Provide actionable recommendations

CONSTRAINTS:
- READONLY ONLY: Do not modify, create, or delete any files
- Focus on understanding and mapping, not implementation
- Provide detailed analysis for handoff to other agents
- Identify potential issues but do not fix them

TOOLS AVAILABLE: scan_directory_structure, analyze_file_dependencies, detect_architecture_patterns, measure_code_complexity, identify_entry_points

Output your analysis as a structured report with:
- Project structure overview
- Architecture and patterns detected
- Dependency relationships
- Complexity assessment
- Recommendations for improvement

Begin exploration now.`;

    const explorationState = {
      ...state,
      messages: [
        new HumanMessage(`Scan the target directory "${context.targetDirectory}" and analyze its codebase structure. Focus areas: ${context.focusAreas?.join(', ') || 'general codebase structure'}.`)
      ]
    };

    try {
      const result = await runAgentStep(explorationState, {
        runner,
        toolDefs: explorationTools,
        eventQueue,
        nodeName: 'exploration_agent',
        systemPromptOverride: systemPrompt
      });

      // Extract codebase map from agent's analysis
      // In a real implementation, this would parse the agent's response
      // For now, we'll create a sample structure
      const codebaseMap: CodebaseMap = {
        structure: {
          directories: [],
          files: []
        },
        architecture: {
          entryPoints: [],
          coreModules: [],
          dependencies: [],
          frameworks: [],
          patterns: []
        },
        relationships: [],
        complexity: {
          totalFiles: 0,
          totalLines: 0,
          averageComplexity: 0,
          hotspots: []
        },
        recommendations: []
      };

      const analysis = result.messages?.[result.messages.length - 1]?.content || 'Codebase exploration completed';

      console.log('[ExplorationAgent] Codebase exploration completed');

      eventQueue?.push({
        type: 'thought',
        content: '✅ Exploration Agent: Codebase mapping complete - handoff to Planning Agent'
      });

      return {
        codebaseMap,
        analysis: typeof analysis === 'string' ? analysis : JSON.stringify(analysis)
      };

    } catch (error) {
      console.error('[ExplorationAgent] Error during exploration:', error);
      throw new Error(`Exploration failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
};
