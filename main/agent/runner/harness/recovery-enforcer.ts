import type { WorkflowPhase } from './workflow-engine';

export type RecoveryActionType = 'retry_different_tool' | 'rollback_step' | 'rollback_phase' | 'escalate_user' | 'abort_task';

export interface RecoveryAction {
  type: RecoveryActionType;
  message: string;
  suggestedTools?: string[];
  rollbackTarget?: WorkflowPhase;
  reason: string;
}

interface AttemptRecord {
  toolName: string;
  toolCategory: string;
  args: Record<string, unknown>;
  result: any;
  timestamp: number;
  error?: string;
}

interface StepRetryState {
  stepId: string;
  attempts: AttemptRecord[];
}

const MAX_ATTEMPTS_PER_STEP = 3;
const MAX_ATTEMPTS_SAME_TOOL = 2;

function categorizeTool(toolName: string): string {
  const terminalTools = ['terminal_execute', 'executePwsh', 'run_command', 'bash', 'terminal_status'];
  const fileReadTools = ['read', 'read_file', 'view_file', 'cat', 'ls', 'list_dir', 'grep', 'grep_search', 'find', 'glob'];
  const fileWriteTools = ['write', 'write_to_file', 'edit', 'replace_file_content', 'multi_replace_file_content', 'str_replace', 'create'];
  const webTools = ['web_search', 'search_web', 'navis', 'fetch', 'read_url_content', 'browser', 'browser_subagent'];
  const memoryTools = ['memory_save', 'memory_search', 'recall_fact', 'remember_fact'];

  if (terminalTools.includes(toolName)) return 'terminal';
  if (fileReadTools.includes(toolName)) return 'file_read';
  if (fileWriteTools.includes(toolName)) return 'file_write';
  if (webTools.includes(toolName)) return 'web';
  if (memoryTools.includes(toolName)) return 'memory';
  return 'other';
}

function getAlternativeTools(category: string, failedTool: string): string[] {
  switch (category) {
    case 'terminal':
      return failedTool === 'terminal_execute' || failedTool === 'run_command' ? ['executePwsh'] : ['terminal_execute'];
    case 'file_read':
      return ['read_file', 'view_file', 'grep_search', 'list_dir'];
    case 'file_write':
      return ['replace_file_content', 'write_to_file', 'multi_replace_file_content'];
    case 'web':
      return ['search_web', 'read_url_content', 'navis'];
    default:
      return [];
  }
}

export class RecoveryEnforcer {
  private state: Map<string, StepRetryState> = new Map();

  recordAttempt(
    stepId: string,
    toolName: string,
    args: Record<string, unknown>,
    result: any,
    error?: string
  ): void {
    if (!this.state.has(stepId)) {
      this.state.set(stepId, { stepId, attempts: [] });
    }
    const s = this.state.get(stepId)!;
    s.attempts.push({
      toolName,
      toolCategory: categorizeTool(toolName),
      args,
      result,
      timestamp: Date.now(),
      error
    });
  }

  getAttemptCount(stepId: string): number {
    return this.state.get(stepId)?.attempts.length || 0;
  }

  getSameToolCount(stepId: string, toolName: string): number {
    const s = this.state.get(stepId);
    if (!s) return 0;
    return s.attempts.filter(a => a.toolName === toolName).length;
  }

  getLastError(stepId: string): string | undefined {
    const s = this.state.get(stepId);
    if (!s || s.attempts.length === 0) return undefined;
    return s.attempts[s.attempts.length - 1].error;
  }

  checkToolCall(stepId: string, toolName: string, args: Record<string, unknown>): RecoveryAction | null {
    const totalAttempts = this.getAttemptCount(stepId);
    const sameToolAttempts = this.getSameToolCount(stepId, toolName);

    if (totalAttempts >= MAX_ATTEMPTS_PER_STEP) {
      return {
        type: 'escalate_user',
        message: `Step has failed ${totalAttempts} times. Escalating to user for guidance.`,
        reason: `Exceeded maximum attempts (${MAX_ATTEMPTS_PER_STEP}) for step ${stepId}`
      };
    }

    if (sameToolAttempts >= MAX_ATTEMPTS_SAME_TOOL) {
      const category = categorizeTool(toolName);
      const alternatives = getAlternativeTools(category, toolName);
      return {
        type: 'retry_different_tool',
        message: `Tool "${toolName}" has failed ${sameToolAttempts} times. Switch to a different approach.`,
        suggestedTools: alternatives,
        reason: `Same tool (${toolName}) failed ${sameToolAttempts} times — must pivot`
      };
    }

    return null;
  }

  checkResult(stepId: string, toolName: string, result: any): RecoveryAction | null {
    const output = typeof result?.output === 'string' ? result.output :
                   typeof result === 'string' ? result : '';

    if (output.includes('[Timeout:') || /timeout/i.test(output)) {
      const category = categorizeTool(toolName);
      const alternatives = getAlternativeTools(category, toolName);
      return {
        type: 'retry_different_tool',
        message: `Command timed out. Try a different approach or tool.`,
        suggestedTools: alternatives,
        reason: `Timeout detected for ${toolName}`
      };
    }

    // Diagnostics for common build & typecheck failures
    if (/TS2304|Cannot find name/i.test(output)) {
      return {
        type: 'retry_different_tool',
        message: `TypeScript error: Missing import or undeclared variable. Add the necessary import or type definition.`,
        suggestedTools: ['read_file', 'replace_file_content'],
        reason: `Missing import or type declaration detected in build output`
      };
    }

    if (/TS2307|Cannot find module/i.test(output)) {
      return {
        type: 'retry_different_tool',
        message: `Module missing. Run package installation (npm install <package>) before building.`,
        suggestedTools: ['run_command', 'terminal_execute'],
        reason: `Missing npm module detected`
      };
    }

    return null;
  }

  getRecoveryActionsForPhase(phase: string, failedTools: string[]): RecoveryAction[] {
    const actions: RecoveryAction[] = [];

    const phaseToolMappings: Record<string, Record<string, string[]>> = {
      exploration: {
        default: ['read', 'ls', 'grep', 'glob', 'terminal_execute'],
      },
      implementation: {
        terminal_execute: ['executePwsh'],
        write: ['edit'],
        edit: ['write'],
      },
      testing: {
        default: ['terminal_execute', 'terminal_status', 'read', 'grep'],
      }
    };

    const mappings = phaseToolMappings[phase];
    if (!mappings) return actions;

    for (const tool of failedTools) {
      const alternatives = mappings[tool] || mappings['default'];
      if (alternatives) {
        actions.push({
          type: 'retry_different_tool',
          message: `Try using ${alternatives.join(' or ')} instead of ${tool}`,
          suggestedTools: alternatives,
          reason: `${tool} failed in ${phase} phase`
        });
      }
    }

    return actions;
  }

  clearStep(stepId: string): void {
    this.state.delete(stepId);
  }

  clearAll(): void {
    this.state.clear();
  }
}

export const recoveryEnforcer = new RecoveryEnforcer();
