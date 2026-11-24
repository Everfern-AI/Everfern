/**
 * EverFern Desktop — Subagent Result Aggregator
 *
 * Aggregates results from multiple spawned subagents with comprehensive
 * error handling, timeout management, and research summary generation.
 */

import { getSubagentRegistry, type SubagentEntry } from './subagent-registry';
import { emitTool } from '../infra/agent-events';
import { spawnSync } from 'child_process';

function nativeAggregationCall<T>(request: Record<string, unknown>): T | null {
  const executable = process.env.EVERFERN_SHELL === 'tauri' && process.env.EF_NATIVE_EXE;
  if (!executable) return null;
  try {
    const response = spawnSync(executable, ['--ef-subagent-aggregation'], {
      input: JSON.stringify(request),
      encoding: 'utf-8',
      windowsHide: true,
      timeout: 5000,
      maxBuffer: 16 * 1024 * 1024,
    });
    if (response.error || response.status !== 0 || !response.stdout) return null;
    return JSON.parse(response.stdout) as T;
  } catch {
    return null;
  }
}

export interface AggregationResult {
  success: boolean;
  totalSubagents: number;
  completedSubagents: number;
  failedSubagents: number;
  timedOutSubagents: number;
  summary: string;
  results: SubagentResultEntry[];
  errors: AggregationError[];
  metadata: {
    startTime: string;
    endTime: string;
    totalDuration: number;
    aggregationMethod: 'parallel' | 'sequential';
  };
}

export interface SubagentResultEntry {
  subagentId: string;
  status: 'completed' | 'failed' | 'timeout';
  result?: string;
  error?: string;
  duration: number;
  resultLength?: number;
}

export interface AggregationError {
  type: 'timeout' | 'execution_failure' | 'partial_failure' | 'aggregation_failure';
  subagentId?: string;
  message: string;
  timestamp: string;
  recoverable: boolean;
}

export interface AggregationOptions {
  timeoutMs?: number;
  maxRetries?: number;
  includeErrors?: boolean;
  deduplicateResults?: boolean;
  sortByRelevance?: boolean;
}

class SubagentResultAggregator {
  private registry = getSubagentRegistry();
  private defaultTimeout = 60000; // 60 seconds
  private maxRetries = 2;

  /**
   * Aggregate results from multiple subagents with comprehensive error handling
   */
  async aggregateResults(
    parentSessionId: string,
    subagentIds: string[],
    options: AggregationOptions = {}
  ): Promise<AggregationResult> {
    const startTime = new Date().toISOString();
    const timeoutMs = options.timeoutMs ?? this.defaultTimeout;
    const errors: AggregationError[] = [];
    const results: SubagentResultEntry[] = [];

    let completedCount = 0;
    let failedCount = 0;
    let timedOutCount = 0;

    try {
      // Wait for all subagents to complete with timeout
      const completedChildren = await this.waitForSubagentsWithTimeout(
        parentSessionId,
        subagentIds,
        timeoutMs,
        errors
      );

      // Process each completed subagent
      for (const child of completedChildren) {
        const resultEntry: SubagentResultEntry = {
          subagentId: child.agentId,
          status: child.status as 'completed' | 'failed' | 'timeout',
          duration: (child.completedAt || Date.now()) - child.createdAt,
        };

        if (child.status === 'completed' && child.result) {
          resultEntry.result = child.result;
          resultEntry.resultLength = child.result.length;
          completedCount++;
        } else if (child.status === 'failed' && child.error) {
          resultEntry.error = child.error;
          resultEntry.status = 'failed';
          failedCount++;

          if (options.includeErrors) {
            errors.push({
              type: 'execution_failure',
              subagentId: child.agentId,
              message: child.error,
              timestamp: new Date().toISOString(),
              recoverable: false,
            });
          }
        } else if (child.status === 'aborted') {
          resultEntry.status = 'timeout';
          timedOutCount++;

          errors.push({
            type: 'timeout',
            subagentId: child.agentId,
            message: `Subagent ${child.agentId} timed out after ${timeoutMs}ms`,
            timestamp: new Date().toISOString(),
            recoverable: true,
          });
        }

        results.push(resultEntry);
      }

      // Generate comprehensive summary
      const summary = this.generateComprehensiveSummary(
        results,
        options.deduplicateResults ?? true,
        options.sortByRelevance ?? false
      );

      const endTime = new Date().toISOString();
      const totalDuration = new Date(endTime).getTime() - new Date(startTime).getTime();

      const aggregationResult: AggregationResult = {
        success: failedCount === 0 && timedOutCount === 0,
        totalSubagents: subagentIds.length,
        completedSubagents: completedCount,
        failedSubagents: failedCount,
        timedOutSubagents: timedOutCount,
        summary,
        results,
        errors,
        metadata: {
          startTime,
          endTime,
          totalDuration,
          aggregationMethod: 'parallel',
        },
      };

      // Emit aggregation complete event
      emitTool(parentSessionId, 'subagent_aggregation_complete', {
        totalSubagents: subagentIds.length,
        completedSubagents: completedCount,
        failedSubagents: failedCount,
        timedOutSubagents: timedOutCount,
        duration: totalDuration,
      });

      return aggregationResult;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      errors.push({
        type: 'aggregation_failure',
        message: `Failed to aggregate subagent results: ${errorMsg}`,
        timestamp: new Date().toISOString(),
        recoverable: false,
      });

      emitTool(parentSessionId, 'subagent_aggregation_failed', {
        error: errorMsg,
        completedSubagents: completedCount,
        failedSubagents: failedCount,
      });

      const endTime = new Date().toISOString();
      const totalDuration = new Date(endTime).getTime() - new Date(startTime).getTime();

      return {
        success: false,
        totalSubagents: subagentIds.length,
        completedSubagents: completedCount,
        failedSubagents: failedCount,
        timedOutSubagents: timedOutCount,
        summary: `Aggregation failed: ${errorMsg}`,
        results,
        errors,
        metadata: {
          startTime,
          endTime,
          totalDuration,
          aggregationMethod: 'parallel',
        },
      };
    }
  }

  /**
   * Wait for subagents to complete with timeout management
   */
  private async waitForSubagentsWithTimeout(
    parentSessionId: string,
    subagentIds: string[],
    timeoutMs: number,
    errors: AggregationError[]
  ): Promise<SubagentEntry[]> {
    const startTime = Date.now();
    const pollInterval = 100; // Poll every 100ms
    const completedSubagents = new Map<string, SubagentEntry>();

    while (Date.now() - startTime < timeoutMs) {
      // Get all children of the parent
      const children = this.registry.getChildren(parentSessionId);

      // Check which subagents have completed
      for (const child of children) {
        if (subagentIds.includes(child.agentId) && !completedSubagents.has(child.agentId)) {
          if (child.status === 'completed' || child.status === 'failed' || child.status === 'aborted') {
            completedSubagents.set(child.agentId, child);
          }
        }
      }

      // If all subagents have completed, return early
      if (completedSubagents.size === subagentIds.length) {
        return Array.from(completedSubagents.values());
      }

      // Wait before polling again
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    // Timeout reached - collect whatever we have and mark remaining as timed out
    const timedOutSubagents = subagentIds.filter(id => !completedSubagents.has(id));

    for (const timedOutId of timedOutSubagents) {
      const entry = this.registry.get(timedOutId);
      if (entry) {
        // Mark as aborted due to timeout
        this.registry.abort(timedOutId);
        completedSubagents.set(timedOutId, {
          ...entry,
          status: 'aborted',
          completedAt: Date.now(),
        });

        errors.push({
          type: 'timeout',
          subagentId: timedOutId,
          message: `Subagent ${timedOutId} timed out after ${timeoutMs}ms`,
          timestamp: new Date().toISOString(),
          recoverable: true,
        });
      }
    }

    return Array.from(completedSubagents.values());
  }

  /**
   * Generate comprehensive research summary from aggregated results
   */
  private generateComprehensiveSummary(
    results: SubagentResultEntry[],
    deduplicate: boolean = true,
    sortByRelevance: boolean = false
  ): string {
    const native = nativeAggregationCall<string>({
      operation: 'summary',
      results,
      deduplicate,
      sortByRelevance,
    });
    if (native !== null) return native;

    const completedResults = results.filter(r => r.status === 'completed' && r.result);
    const failedResults = results.filter(r => r.status === 'failed');
    const timedOutResults = results.filter(r => r.status === 'timeout');

    if (completedResults.length === 0) {
      let summary = '## Research Summary\n\n';
      summary += 'No successful research results were obtained from subagents.\n\n';

      if (failedResults.length > 0) {
        summary += `### Failed Subagents (${failedResults.length})\n`;
        for (const result of failedResults) {
          summary += `- **${result.subagentId}**: ${result.error || 'Unknown error'}\n`;
        }
        summary += '\n';
      }

      if (timedOutResults.length > 0) {
        summary += `### Timed Out Subagents (${timedOutResults.length})\n`;
        for (const result of timedOutResults) {
          summary += `- **${result.subagentId}**: Execution exceeded timeout limit\n`;
        }
        summary += '\n';
      }

      return summary;
    }

    // Deduplicate results if requested
    let uniqueResults = completedResults;
    if (deduplicate) {
      uniqueResults = this.deduplicateResults(completedResults);
    }

    // Build comprehensive summary
    let summary = '## Comprehensive Research Summary\n\n';
    summary += `Based on parallel research conducted by ${completedResults.length} subagent(s):\n\n`;

    // Add completed results
    for (let i = 0; i < uniqueResults.length; i++) {
      const result = uniqueResults[i];
      summary += `### Research Result ${i + 1}\n`;
      summary += `**Source**: ${result.subagentId}\n`;
      summary += `**Duration**: ${(result.duration / 1000).toFixed(2)}s\n`;
      summary += `**Content Length**: ${result.resultLength || 0} characters\n\n`;
      summary += `${result.result}\n\n`;
    }

    // Add error summary if there were failures
    if (failedResults.length > 0 || timedOutResults.length > 0) {
      summary += '---\n\n';
      summary += '### Execution Summary\n';
      summary += `- **Successful**: ${completedResults.length}/${results.length}\n`;

      if (failedResults.length > 0) {
        summary += `- **Failed**: ${failedResults.length}\n`;
        for (const result of failedResults) {
          summary += `  - ${result.subagentId}: ${result.error || 'Unknown error'}\n`;
        }
      }

      if (timedOutResults.length > 0) {
        summary += `- **Timed Out**: ${timedOutResults.length}\n`;
        for (const result of timedOutResults) {
          summary += `  - ${result.subagentId}: Exceeded timeout limit\n`;
        }
      }
    }

    return summary;
  }

  /**
   * Deduplicate results by removing similar content
   */
  private deduplicateResults(results: SubagentResultEntry[]): SubagentResultEntry[] {
    if (results.length <= 1) {
      return results;
    }

    const deduplicated: SubagentResultEntry[] = [];
    const seenContent = new Set<string>();

    for (const result of results) {
      if (!result.result) continue;

      // Create a simple hash of the first 200 characters
      const contentHash = result.result.substring(0, 200).toLowerCase();

      // Check if we've seen similar content
      let isDuplicate = false;
      for (const seen of seenContent) {
        if (this.calculateSimilarity(contentHash, seen) > 0.8) {
          isDuplicate = true;
          break;
        }
      }

      if (!isDuplicate) {
        seenContent.add(contentHash);
        deduplicated.push(result);
      }
    }

    return deduplicated;
  }

  /**
   * Calculate similarity between two strings (simple Levenshtein-based approach)
   */
  private calculateSimilarity(str1: string, str2: string): number {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;

    if (longer.length === 0) {
      return 1.0;
    }

    const editDistance = this.levenshteinDistance(longer, shorter);
    return (longer.length - editDistance) / longer.length;
  }

  /**
   * Calculate Levenshtein distance between two strings
   */
  private levenshteinDistance(str1: string, str2: string): number {
    const matrix: number[][] = [];

    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }

    return matrix[str2.length][str1.length];
  }

  /**
   * Handle partial failures gracefully
   */
  async handlePartialFailure(
    parentSessionId: string,
    aggregationResult: AggregationResult,
    fallbackTask?: string
  ): Promise<string> {
    const native = nativeAggregationCall<string>({
      operation: 'partial_failure',
      aggregationResult,
      fallbackTask,
    });
    if (native !== null) return native;

    const successRate = aggregationResult.completedSubagents / aggregationResult.totalSubagents;

    if (successRate >= 0.5) {
      // More than 50% success - use aggregated results
      return aggregationResult.summary;
    } else if (fallbackTask) {
      // Less than 50% success - suggest fallback
      return `
## Research Partial Failure

The parallel research encountered issues:
- Completed: ${aggregationResult.completedSubagents}/${aggregationResult.totalSubagents}
- Failed: ${aggregationResult.failedSubagents}
- Timed Out: ${aggregationResult.timedOutSubagents}

### Available Results
${aggregationResult.summary}

### Recommendation
Consider using single-agent research mode or adjusting the research parameters.
`;
    } else {
      return aggregationResult.summary;
    }
  }
}

// Singleton
let aggregatorInstance: SubagentResultAggregator | null = null;

export function getSubagentResultAggregator(): SubagentResultAggregator {
  if (!aggregatorInstance) {
    aggregatorInstance = new SubagentResultAggregator();
  }
  return aggregatorInstance;
}
