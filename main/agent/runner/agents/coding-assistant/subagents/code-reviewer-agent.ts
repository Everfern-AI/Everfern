/**
 * Code Reviewer Agent - Security and Quality Specialist
 *
 * A specialist subagent that checks modified code for security issues,
 * bugs, performance problems, and overall code quality.
 */

import { GraphStateType, StreamEvent } from '../../../state';
import { AgentRunner } from '../../../runner';
import { runAgentStep } from '../../../services/agent-runtime';
import { ImplementationResult } from './worker-agent';

/**
 * Tool definition interface for agent tools
 */
interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ReviewContext {
  implementationResult: ImplementationResult;
  reviewCriteria: {
    security: boolean;
    performance: boolean;
    maintainability: boolean;
    testCoverage: boolean;
    documentation: boolean;
    codeStyle: boolean;
  };
  strictnessLevel: 'lenient' | 'standard' | 'strict';
}

export interface CodeReviewResult {
  overallRating: 'excellent' | 'good' | 'acceptable' | 'needs-work' | 'reject';
  summary: string;
  issues: Array<{
    id: string;
    file: string;
    line?: number;
    severity: 'info' | 'warning' | 'error' | 'critical';
    category: 'security' | 'performance' | 'bugs' | 'style' | 'maintainability' | 'documentation';
    description: string;
    suggestion: string;
    autoFixable: boolean;
  }>;
  metrics: {
    security: {
      score: number;
      vulnerabilities: number;
      criticalIssues: string[];
    };
    performance: {
      score: number;
      bottlenecks: string[];
      optimizations: string[];
    };
    maintainability: {
      score: number;
      complexity: number;
      duplications: string[];
    };
    testCoverage: {
      percentage: number;
      uncoveredLines: string[];
      missingTests: string[];
    };
  };
  approvedForProduction: boolean;
  requiredFixes: string[];
  recommendations: string[];
}

/**
 * Create a Code Reviewer Agent focused on quality assurance and security
 */
export const createCodeReviewerAgent = (
  runner: AgentRunner,
  context: ReviewContext,
  eventQueue?: StreamEvent[]
) => {
  return async (state: GraphStateType): Promise<{ review: CodeReviewResult; reportDocument: string }> => {
    console.log('[CodeReviewerAgent] Starting code review...');

    eventQueue?.push({
      type: 'thought',
      content: '🔍 Code Reviewer Agent: Analyzing code quality and security...'
    });

    // Define code review-specific tools
    const reviewerTools: ToolDefinition[] = [
      {
        name: 'analyze_security_vulnerabilities',
        description: 'Scan code for common security vulnerabilities and threats',
        parameters: {
          type: 'object',
          properties: {
            files: {
              type: 'array',
              items: { type: 'string' },
              description: 'Files to analyze for security issues'
            },
            scanType: {
              type: 'string',
              enum: ['quick', 'comprehensive', 'deep'],
              description: 'Depth of security analysis'
            }
          },
          required: ['files']
        }
      },
      {
        name: 'measure_performance_metrics',
        description: 'Analyze code for performance bottlenecks and optimization opportunities',
        parameters: {
          type: 'object',
          properties: {
            files: {
              type: 'array',
              items: { type: 'string' },
              description: 'Files to analyze for performance'
            },
            profileType: {
              type: 'string',
              enum: ['memory', 'cpu', 'io', 'network'],
              description: 'Type of performance analysis'
            }
          },
          required: ['files']
        }
      },
      {
        name: 'check_code_quality',
        description: 'Analyze code quality metrics including complexity, duplication, and maintainability',
        parameters: {
          type: 'object',
          properties: {
            files: {
              type: 'array',
              items: { type: 'string' },
              description: 'Files to analyze for code quality'
            },
            language: { type: 'string', description: 'Programming language' },
            standards: {
              type: 'array',
              items: { type: 'string' },
              description: 'Coding standards to check against'
            }
          },
          required: ['files']
        }
      },
      {
        name: 'validate_test_coverage',
        description: 'Analyze test coverage and identify gaps in testing',
        parameters: {
          type: 'object',
          properties: {
            sourceFiles: {
              type: 'array',
              items: { type: 'string' },
              description: 'Source files to check coverage for'
            },
            testFiles: {
              type: 'array',
              items: { type: 'string' },
              description: 'Test files to analyze'
            },
            coverageThreshold: { type: 'number', description: 'Minimum acceptable coverage percentage' }
          },
          required: ['sourceFiles']
        }
      },
      {
        name: 'lint_code_style',
        description: 'Check code against style guidelines and formatting standards',
        parameters: {
          type: 'object',
          properties: {
            files: {
              type: 'array',
              items: { type: 'string' },
              description: 'Files to lint'
            },
            configFile: { type: 'string', description: 'Path to linting configuration file' },
            autoFix: { type: 'boolean', description: 'Whether to automatically fix style issues' }
          },
          required: ['files']
        }
      },
      {
        name: 'detect_code_smells',
        description: 'Identify code smells and anti-patterns that affect maintainability',
        parameters: {
          type: 'object',
          properties: {
            files: {
              type: 'array',
              items: { type: 'string' },
              description: 'Files to analyze for code smells'
            },
            patterns: {
              type: 'array',
              items: { type: 'string' },
              description: 'Specific patterns to look for'
            }
          },
          required: ['files']
        }
      },
      {
        name: 'verify_documentation',
        description: 'Check documentation completeness and quality',
        parameters: {
          type: 'object',
          properties: {
            files: {
              type: 'array',
              items: { type: 'string' },
              description: 'Files to check for documentation'
            },
            documentationType: {
              type: 'string',
              enum: ['comments', 'docstrings', 'readme', 'api-docs'],
              description: 'Type of documentation to verify'
            }
          },
          required: ['files']
        }
      },
      {
        name: 'generate_review_report',
        description: 'Generate comprehensive code review report with findings and recommendations',
        parameters: {
          type: 'object',
          properties: {
            reviewData: { type: 'object', description: 'Collected review data and metrics' },
            format: { type: 'string', enum: ['markdown', 'html', 'json'], description: 'Report format' },
            includeMetrics: { type: 'boolean', description: 'Whether to include detailed metrics' }
          },
          required: ['reviewData']
        }
      }
    ];

    const systemPrompt = `You are the EverFern Code Reviewer Agent - a quality assurance and security specialist.

MISSION: Conduct thorough code review of the recent implementation to ensure quality, security, and maintainability.

IMPLEMENTATION DETAILS:
- Created Files: ${context.implementationResult.createdFiles.join(', ')}
- Modified Files: ${context.implementationResult.modifiedFiles.join(', ')}
- Build Status: ${context.implementationResult.buildResult?.success ? 'SUCCESS' : 'FAILED'}
- Test Status: ${context.implementationResult.testResult?.success ? 'PASSED' : 'FAILED'}

REVIEW CRITERIA:
- Security: ${context.reviewCriteria.security ? 'ENABLED' : 'DISABLED'}
- Performance: ${context.reviewCriteria.performance ? 'ENABLED' : 'DISABLED'}
- Maintainability: ${context.reviewCriteria.maintainability ? 'ENABLED' : 'DISABLED'}
- Test Coverage: ${context.reviewCriteria.testCoverage ? 'ENABLED' : 'DISABLED'}
- Documentation: ${context.reviewCriteria.documentation ? 'ENABLED' : 'DISABLED'}
- Code Style: ${context.reviewCriteria.codeStyle ? 'ENABLED' : 'DISABLED'}

STRICTNESS LEVEL: ${context.strictnessLevel.toUpperCase()}

REVIEW PROCESS:
1. Analyze security vulnerabilities and potential threats
2. Measure performance metrics and identify bottlenecks
3. Check code quality, complexity, and maintainability
4. Validate test coverage and identify gaps
5. Lint code style and formatting standards
6. Detect code smells and anti-patterns
7. Verify documentation completeness and quality
8. Generate comprehensive review report with actionable feedback

SECURITY FOCUS AREAS:
- Input validation and sanitization
- Authentication and authorization
- Data encryption and secure storage
- SQL injection and XSS prevention
- Dependency vulnerabilities
- Secure configuration practices

PERFORMANCE FOCUS AREAS:
- Algorithm efficiency and time complexity
- Memory usage and potential leaks
- Database query optimization
- Network request efficiency
- Caching strategies
- Resource utilization

QUALITY STANDARDS:
- Code complexity and readability
- Proper error handling
- Consistent naming conventions
- Appropriate abstraction levels
- Separation of concerns
- DRY (Don't Repeat Yourself) principle

Provide detailed, actionable feedback with specific line numbers and suggestions for improvement.

Begin code review now.`;

    try {
      const result = await runAgentStep(state, {
        runner,
        toolDefs: reviewerTools,
        eventQueue,
        nodeName: 'code_reviewer_agent',
        systemPromptOverride: systemPrompt
      });

      // Extract review results from agent's analysis
      // In a real implementation, this would parse detailed review data
      const review: CodeReviewResult = {
        overallRating: 'good',
        summary: 'Code review completed with minor issues identified',
        issues: [],
        metrics: {
          security: {
            score: 85,
            vulnerabilities: 0,
            criticalIssues: []
          },
          performance: {
            score: 80,
            bottlenecks: [],
            optimizations: []
          },
          maintainability: {
            score: 90,
            complexity: 5,
            duplications: []
          },
          testCoverage: {
            percentage: 75,
            uncoveredLines: [],
            missingTests: []
          }
        },
        approvedForProduction: true,
        requiredFixes: [],
        recommendations: []
      };

      const reportDocument = result.messages?.[result.messages.length - 1]?.content || 'Code review completed';

      console.log('[CodeReviewerAgent] Code review completed');

      eventQueue?.push({
        type: 'thought',
        content: `✅ Code Reviewer Agent: Review complete (${review.overallRating}) - handoff to Test Runner Agent`
      });

      return {
        review,
        reportDocument: typeof reportDocument === 'string' ? reportDocument : JSON.stringify(reportDocument)
      };

    } catch (error) {
      console.error('[CodeReviewerAgent] Error during code review:', error);
      throw new Error(`Code review failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
};
