/**
 * Mission Step Tracker - OpenClaw Style Orchestration
 *
 * Tracks the lifecycle of mission steps with proper state management
 * and event emission for IPC communication.
 */

export type StepStatus = 'pending' | 'in-progress' | 'completed' | 'failed' | 'skipped';
export type MissionPhase = 'triage' | 'planning' | 'execution' | 'validation' | 'completion';

export interface MissionStep {
  id: string;
  name: string;
  description: string;
  phase: MissionPhase;
  status: StepStatus;
  startTime?: number;
  endTime?: number;
  duration?: number;
  toolCalls?: string[];
  result?: string;
  error?: string;
  metadata?: Record<string, any>;
}

export interface MissionTimeline {
  missionId: string;
  startTime: number;
  currentPhase: MissionPhase;
  steps: MissionStep[];
  completedSteps: number;
  totalSteps: number;
  isComplete: boolean;
  finalResult?: string;
  error?: string;
}

export class MissionTracker {
  private timeline: MissionTimeline;
  private stepMap: Map<string, MissionStep> = new Map();
  private stepCallbacks: ((step: MissionStep, timeline: MissionTimeline) => void)[] = [];
  private phaseCallbacks: ((phase: MissionPhase, timeline: MissionTimeline) => void)[] = [];

  constructor(missionId: string) {
    this.timeline = {
      missionId,
      startTime: Date.now(),
      currentPhase: 'triage',
      steps: [],
      completedSteps: 0,
      totalSteps: 0,
      isComplete: false,
    };
  }

  /**
   * Add a step to the mission timeline
   */
  addStep(step: Omit<MissionStep, 'status' | 'startTime' | 'endTime'>): MissionStep {
    const newStep: MissionStep = {
      ...step,
      status: 'pending',
    };
    this.stepMap.set(step.id, newStep);
    this.timeline.steps.push(newStep);
    this.timeline.totalSteps++;
    return newStep;
  }

  /**
   * Update step status and emit events
   */
  updateStep(stepId: string, updates: Partial<MissionStep>): MissionStep | null {
    const step = this.stepMap.get(stepId);
    if (!step) return null;

    const oldStatus = step.status;
    Object.assign(step, updates);

    // Track timing and completion counts.
    if (oldStatus === 'completed' && step.status !== 'completed') {
      this.timeline.completedSteps = Math.max(0, this.timeline.completedSteps - 1);
      step.endTime = undefined;
      step.duration = undefined;
      step.result = undefined;
    }

    if (oldStatus === 'pending' && step.status === 'in-progress') {
      step.startTime = Date.now();
    } else if (oldStatus !== 'completed' && step.status === 'completed') {
      step.endTime = Date.now();
      step.duration = step.endTime - (step.startTime || Date.now());
      this.timeline.completedSteps++;
    }

    // Emit callbacks
    this.stepCallbacks.forEach(cb => cb(step, this.timeline));
    return step;
  }

  /**
   * Mark a step as started
   */
  startStep(stepId: string): MissionStep | null {
    return this.updateStep(stepId, {
      status: 'in-progress',
      startTime: Date.now(),
    });
  }

  /**
   * Mark a step as completed
   */
  completeStep(stepId: string, result?: string): MissionStep | null {
    return this.updateStep(stepId, {
      status: 'completed',
      result,
      endTime: Date.now(),
    });
  }

  /**
   * Mark a step as failed
   */
  failStep(stepId: string, error: string): MissionStep | null {
    return this.updateStep(stepId, {
      status: 'failed',
      error,
      endTime: Date.now(),
    });
  }

  /**
   * Change mission phase
   */
  setPhase(phase: MissionPhase): MissionTimeline {
    this.timeline.currentPhase = phase;
    this.phaseCallbacks.forEach(cb => cb(phase, this.timeline));
    return this.timeline;
  }

  /**
   * Complete the mission
   */
  complete(finalResult?: string): MissionTimeline {
    this.timeline.isComplete = true;
    this.timeline.finalResult = finalResult;
    this.timeline.currentPhase = 'completion';
    return this.timeline;
  }

  /**
   * Fail the mission
   */
  fail(error: string): MissionTimeline {
    this.timeline.isComplete = true;
    this.timeline.error = error;
    return this.timeline;
  }

  /**
   * Subscribe to step updates
   */
  onStepUpdate(callback: (step: MissionStep, timeline: MissionTimeline) => void): () => void {
    this.stepCallbacks.push(callback);
    return () => {
      const idx = this.stepCallbacks.indexOf(callback);
      if (idx >= 0) this.stepCallbacks.splice(idx, 1);
    };
  }

  /**
   * Subscribe to phase changes
   */
  onPhaseChange(callback: (phase: MissionPhase, timeline: MissionTimeline) => void): () => void {
    this.phaseCallbacks.push(callback);
    return () => {
      const idx = this.phaseCallbacks.indexOf(callback);
      if (idx >= 0) this.phaseCallbacks.splice(idx, 1);
    };
  }

  /**
   * Get current timeline state
   */
  getTimeline(): MissionTimeline {
    return { ...this.timeline };
  }

  /**
   * Get specific step
   */
  getStep(stepId: string): MissionStep | null {
    return this.stepMap.get(stepId) || null;
  }

  /**
   * Get all steps
   */
  getSteps(): MissionStep[] {
    return Array.from(this.stepMap.values());
  }

  /**
   * Get completion percentage
   */
  getProgress(): number {
    return this.timeline.totalSteps > 0
      ? Math.round((this.timeline.completedSteps / this.timeline.totalSteps) * 100)
      : 0;
  }

  /**
   * Serialize for IPC
   */
  serialize() {
    return {
      timeline: this.timeline,
      steps: Array.from(this.stepMap.values()),
      progress: this.getProgress(),
    };
  }
}

// Global mission tracker registry (one per conversation)
const missionTrackers = new Map<string, MissionTracker>();

export function getMissionTracker(missionId: string): MissionTracker {
  if (!missionTrackers.has(missionId)) {
    missionTrackers.set(missionId, new MissionTracker(missionId));
  }
  return missionTrackers.get(missionId)!;
}

export function createMissionTracker(missionId: string): MissionTracker {
  const tracker = new MissionTracker(missionId);
  missionTrackers.set(missionId, tracker);
  return tracker;
}

export function clearMissionTracker(missionId: string): void {
  missionTrackers.delete(missionId);
}
