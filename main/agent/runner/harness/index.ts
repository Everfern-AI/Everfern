import { validateToolOutput, registerDefaultSchemas } from './output-validator';
import { workflowEngine, type WorkflowPhase } from './workflow-engine';
import { rollbackOrchestrator } from './rollback-orchestrator';
import { recoveryEnforcer, type RecoveryAction } from './recovery-enforcer';

registerDefaultSchemas();

export interface HarnessConfig {
  enabled: boolean;
  workflowName: string;
  sessionId: string;
}

export function createHarnessConfig(sessionId: string, workflowName: string = 'coding_harness'): HarnessConfig {
  return {
    enabled: true,
    workflowName,
    sessionId
  };
}

export interface PreExecutionCheck {
  shouldProceed: boolean;
  blockReason?: string;
  recoveryAction?: RecoveryAction;
}

export function preExecutionCheck(
  stepId: string,
  toolName: string,
  args: Record<string, unknown>
): PreExecutionCheck {
  const recoveryAction = recoveryEnforcer.checkToolCall(stepId, toolName, args);
  if (recoveryAction) {
    return {
      shouldProceed: false,
      blockReason: recoveryAction.message,
      recoveryAction
    };
  }
  return { shouldProceed: true };
}

export interface PostExecutionResult {
  valid: boolean;
  validationErrors: string[];
  recoveryAction?: RecoveryAction;
}

export function postExecutionCheck(
  stepId: string,
  toolName: string,
  result: any
): PostExecutionResult {
  const validation = validateToolOutput(toolName, result);
  const recoveryAction = recoveryEnforcer.checkResult(stepId, toolName, result);

  return {
    valid: validation.valid && !recoveryAction,
    validationErrors: validation.errors,
    recoveryAction: recoveryAction || undefined
  };
}

export function recordExecution(
  stepId: string,
  toolName: string,
  args: Record<string, unknown>,
  result: any,
  error?: string
): void {
  recoveryEnforcer.recordAttempt(stepId, toolName, args, result, error);

  const hashArgs = JSON.stringify(args);
  workflowEngine.recordToolCall(stepId, toolName, args, result);

  const filesChanged = toolName === 'write' || toolName === 'edit' ? [String(args.filePath || args.path || '')].filter(Boolean) : [];
  const commandsRun = toolName === 'terminal_execute' || toolName === 'executePwsh' ? [String(args.command || '')].filter(Boolean) : [];

  if (filesChanged.length > 0 || commandsRun.length > 0) {
    const ctx = workflowEngine.getContext(stepId);
    rollbackOrchestrator.recordStep(
      stepId,
      ctx.toolCallHistory.length,
      ctx.currentPhase,
      commandsRun,
      filesChanged
    );
  }
}

export function getPhasePrompt(config: HarnessConfig): string {
  return workflowEngine.getPhasePrompt(config.sessionId, config.workflowName);
}

export function getAllowedTools(config: HarnessConfig): string[] {
  return workflowEngine.getAllowedTools(config.sessionId, config.workflowName);
}

export async function tryTransitionTo(
  config: HarnessConfig,
  toPhase: WorkflowPhase
): Promise<{ success: boolean; reason?: string }> {
  return workflowEngine.transitionTo(config.sessionId, config.workflowName, toPhase);
}

export async function handleFailedStep(
  config: HarnessConfig,
  stepId: string,
  toolName: string,
  error: string
): Promise<RecoveryAction> {
  const totalAttempts = recoveryEnforcer.getAttemptCount(stepId);
  const check = recoveryEnforcer.checkToolCall(stepId, toolName, {});

  if (check) return check;

  if (totalAttempts >= 3) {
    const ctx = workflowEngine.getContext(config.sessionId);
    const plan = await rollbackOrchestrator.planRollback(config.sessionId, ctx.toolCallHistory.length - 3);

    if (plan && plan.overallRisk !== 'high') {
      return {
        type: 'rollback_step',
        message: `Rolling back last steps due to repeated failures`,
        reason: `${totalAttempts} failed attempts for step ${stepId}`,
        rollbackTarget: ctx.completedPhases[ctx.completedPhases.length - 1] as WorkflowPhase || 'exploration'
      };
    }

    return {
      type: 'escalate_user',
      message: `Task failed after ${totalAttempts} attempts with ${toolName}. Need user guidance.`,
      reason: `Exceeded max retries`
    };
  }

  return {
    type: 'retry_different_tool',
    message: `Failed with ${toolName}. Try a different approach.`,
    suggestedTools: [toolName === 'terminal_execute' ? 'executePwsh' : 'terminal_execute'],
    reason: error
  };
}

export function clearHarnessState(config: HarnessConfig): void {
  workflowEngine.clearContext(config.sessionId);
  rollbackOrchestrator.clearHistory(config.sessionId);
  recoveryEnforcer.clearStep(config.sessionId);
  recoveryEnforcer.clearAll();
}

export {
  workflowEngine,
  rollbackOrchestrator,
  recoveryEnforcer,
  validateToolOutput
};
