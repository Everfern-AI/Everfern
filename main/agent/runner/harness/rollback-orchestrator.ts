import type { WorkflowPhase } from './workflow-engine';

export interface RollbackStep {
  stepNumber: number;
  phase: WorkflowPhase;
  commands: string[];
  files: string[];
  risk: 'low' | 'medium' | 'high';
}

export interface RollbackPlan {
  taskId: string;
  steps: RollbackStep[];
  totalCommands: number;
  totalFiles: number;
  overallRisk: 'low' | 'medium' | 'high';
  estimatedSafety: 'safe' | 'caution' | 'destructive';
}

export interface RollbackResult {
  success: boolean;
  stepsRolledBack: number;
  commandsReversed: number;
  filesRestored: number;
  errors: string[];
  partial: boolean;
}

export class RollbackOrchestrator {
  private stepHistory: Map<string, RollbackStep[]> = new Map();

  recordStep(taskId: string, stepNumber: number, phase: WorkflowPhase, commands: string[], files: string[]): void {
    if (!this.stepHistory.has(taskId)) {
      this.stepHistory.set(taskId, []);
    }
    const steps = this.stepHistory.get(taskId)!;
    const risk = this.assessStepRisk(commands, files);
    steps.push({ stepNumber, phase, commands, files, risk });
  }

  private assessStepRisk(commands: string[], files: string[]): 'low' | 'medium' | 'high' {
    const dangerousPatterns = [/rm\s+-rf/i, /drop\s+table/i, /format/i, /del\s+\/f/i, /remove-item\s+-force/i];
    const hasDangerous = commands.some(c => dangerousPatterns.some(p => p.test(c)));
    if (hasDangerous) return 'high';
    if (files.some(f => f.includes('node_modules') || f.includes('.git'))) return 'medium';
    if (commands.length > 5) return 'medium';
    return 'low';
  }

  async planRollback(taskId: string, fromStep: number, toStep?: number): Promise<RollbackPlan | null> {
    const steps = this.stepHistory.get(taskId);
    if (!steps || steps.length === 0) return null;

    const targetSteps = toStep !== undefined
      ? steps.filter(s => s.stepNumber >= fromStep && s.stepNumber <= toStep)
      : steps.filter(s => s.stepNumber >= fromStep);

    if (targetSteps.length === 0) return null;

    const reversed = [...targetSteps].reverse();
    const totalCommands = reversed.reduce((sum, s) => sum + s.commands.length, 0);
    const totalFiles = reversed.reduce((sum, s) => sum + s.files.length, 0);
    const hasHighRisk = reversed.some(s => s.risk === 'high');
    const overallRisk = hasHighRisk ? 'high' : reversed.some(s => s.risk === 'medium') ? 'medium' : 'low';

    return {
      taskId,
      steps: reversed,
      totalCommands,
      totalFiles,
      overallRisk,
      estimatedSafety: overallRisk === 'high' ? 'destructive' : overallRisk === 'medium' ? 'caution' : 'safe'
    };
  }

  async executeRollback(plan: RollbackPlan): Promise<RollbackResult> {
    const errors: string[] = [];
    let stepsRolledBack = 0;
    let commandsReversed = 0;
    let filesRestored = 0;

    for (const step of plan.steps) {
      try {
        const { getRollbackManager } = require('../../persistence/rollback-manager');
        const rollbackManager = getRollbackManager();

        const result = await rollbackManager.rollbackStep(plan.taskId, step.stepNumber);
        if (result) {
          stepsRolledBack++;
          commandsReversed += (result as any).commandsReversed || 0;
          filesRestored += (result as any).filesRestored || 0;
        }
      } catch (err: any) {
        errors.push(`Step ${step.stepNumber} (${step.phase}): ${err.message || err}`);
      }
    }

    return {
      success: errors.length === 0,
      stepsRolledBack,
      commandsReversed,
      filesRestored,
      errors,
      partial: errors.length > 0 && stepsRolledBack > 0
    };
  }

  async rollbackToPhase(
    taskId: string,
    targetPhase: WorkflowPhase,
    currentPhase: WorkflowPhase
  ): Promise<RollbackResult | null> {
    const allSteps = this.stepHistory.get(taskId);
    if (!allSteps) return null;

    const phaseOrder: Record<WorkflowPhase, number> = {
      exploration: 0,
      planning: 1,
      implementation: 2,
      review: 3,
      testing: 4,
      complete: 5
    };

    const targetIdx = phaseOrder[targetPhase];
    const currentIdx = phaseOrder[currentPhase];
    if (currentIdx <= targetIdx) {
      return { success: true, stepsRolledBack: 0, commandsReversed: 0, filesRestored: 0, errors: [], partial: false };
    }

    const stepsToRollback = allSteps.filter(s => {
      const phaseIdx = phaseOrder[s.phase] ?? 99;
      return phaseIdx > targetIdx;
    });

    if (stepsToRollback.length === 0) {
      return { success: true, stepsRolledBack: 0, commandsReversed: 0, filesRestored: 0, errors: [], partial: false };
    }

    const minStep = Math.min(...stepsToRollback.map(s => s.stepNumber));
    const maxStep = Math.max(...stepsToRollback.map(s => s.stepNumber));
    const plan = await this.planRollback(taskId, minStep, maxStep);
    if (!plan) return null;

    return this.executeRollback(plan);
  }

  clearHistory(taskId: string): void {
    this.stepHistory.delete(taskId);
  }
}

export const rollbackOrchestrator = new RollbackOrchestrator();
