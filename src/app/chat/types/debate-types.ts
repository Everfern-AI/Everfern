/**
 * Frontend Types for Debate Display
 */

export interface DebateDisplayData {
  debateId: string;
  timestamp: string;

  proposal: {
    id: string;
    taskSummary: string;
    approach: string;
    estimatedTimeMs: number;
    stepCount: number;
    assumptions: string[];
  };

  review: {
    id: string;
    assessment: 'viable' | 'concerning' | 'problematic';
    concernCount: number;
    criticalCount: number;
    highCount: number;
    concerns: Array<{
      severity: 'low' | 'medium' | 'high' | 'critical';
      title: string;
      description: string;
      suggestion?: string;
    }>;
  };

  finalPlan: {
    id: string;
    goNogo: 'go' | 'proceed-with-caution' | 'no-go';
    riskAssessment: 'low' | 'medium' | 'high' | 'critical';
    stepCount: number;
    addressedConcerns: number;
    remainingRisks: number;
    guidance: string[];
    explanation: string;
  };
}

export interface DebateStreamEvent {
  type: 'debate_start' | 'vanguard_complete' | 'phantom_complete' | 'arbiter_complete' | 'debate_complete' | 'debate_error' | 'debate_skipped';
  timestamp: string;
  debateId: string;
  phase?: 'vanguard' | 'phantom' | 'arbiter';
  data?: DebateDisplayData;
  error?: string;
}
