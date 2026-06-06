export interface GoalDefinition {
  description: string;
  successCriteria?: string[];
  constraints?: string[];
  maxDuration?: number; // milliseconds
}

export type OperatorTaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'blocked' | 'skipped';

export interface TaskState {
  status: OperatorTaskStatus;
  startTime?: number;
  endTime?: number;
  attempts: number;
  lastError?: string;
}

export interface TaskResult {
  success: boolean;
  output: any;
  error?: Error;
  duration: number;
}

export interface OperatorTask {
  taskId: string;
  description: string;
  successCriteria: string[];
  status: OperatorTaskStatus;
  executorType: 'web_explorer' | 'coding_specialist' | 'data_analyst' | 'desktop';
  metadata?: Record<string, any>;
}

export interface ExecutionPlan {
  planId: string;
  goal: GoalDefinition;
  tasks: OperatorTask[];
  planningTimestamp: number;
}

export interface OperatorSession {
  sessionId: string;
  goal: GoalDefinition;
  status: 'planning' | 'executing' | 'paused' | 'replanning' | 'completed' | 'failed';
  currentPlan?: ExecutionPlan;
  graphState?: any; // Serialized TaskGraphManager
  evaluationHistory?: any[]; // Store EvaluationResult objects
  currentTaskIndex?: number;
  startTime: number;
  endTime?: number;
}
