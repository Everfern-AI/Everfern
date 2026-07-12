/**
 * Navis — State Manager
 *
 * Extracted from orchestrator.ts. Tracks DOM state, goal progress,
 * history, and detection of stuck loops.
 */

export interface GoalState {
  lastGoal: string;
  goalRepeatCount: number;
  forceNextVision: boolean;
}

export interface HistoryEntry {
  step: number;
  action: string;
  args: Record<string, unknown>;
  result: string;
  url: string;
}

/**
 * Manages the state that persists across orchestrator steps.
 */
export class StateManager {
  private previousSnapshotRaw: string | null = null;
  private goalState: GoalState = {
    lastGoal: '',
    goalRepeatCount: 0,
    forceNextVision: false,
  };
  private history: HistoryEntry[] = [];
  private extractionReports: Array<{
    reportPath: string;
    summary?: string;
    title?: string;
    sourceUrl?: string;
  }> = [];

  get previousSnapshot(): string | null {
    return this.previousSnapshotRaw;
  }

  set previousSnapshot(raw: string | null) {
    this.previousSnapshotRaw = raw;
  }

  getGoalState(): GoalState {
    return { ...this.goalState };
  }

  /**
   * Update goal tracking after an AI decision.
   */
  updateGoal(goal: string): void {
    if (goal === this.goalState.lastGoal) {
      this.goalState.goalRepeatCount++;
    } else {
      this.goalState.lastGoal = goal;
      this.goalState.goalRepeatCount = 0;
    }
  }

  /**
   * Check if we're stuck in a loop (same goal repeated 2+ times).
   */
  isStuckLoop(): boolean {
    return this.goalState.goalRepeatCount >= 2;
  }

  /**
   * Get a stuck-loop warning message to inject into the prompt.
   */
  getStuckLoopWarning(): string {
    return `\n\n⚠️ STUCK LOOP DETECTED: You have attempted the same goal "${this.goalState.lastGoal}" ${this.goalState.goalRepeatCount + 1} times without success. Try a completely different approach or use a different element/action.`;
  }

  /**
   * Add an entry to the action history.
   */
  addHistory(entry: HistoryEntry): void {
    this.history.push(entry);
  }

  /**
   * Get compressed history for the LLM prompt.
   */
  getCompressedHistory(maxEntries = 20): string {
    const recent = this.history.slice(-maxEntries);
    return recent.map((h) =>
      `[Step ${h.step}] ${h.action}(${JSON.stringify(h.args).slice(0, 120)}) -> ${h.result.slice(0, 200)}`
    ).join('\n');
  }

  /**
   * Get raw history for synthesis.
   */
  getRawHistory(): string[] {
    return this.history.map((h) =>
      `[Step ${h.step}] ${h.action}: ${h.result.slice(0, 500)}`
    );
  }

  /**
   * Add an extraction report.
   */
  addExtractionReport(report: {
    reportPath: string;
    summary?: string;
    title?: string;
    sourceUrl?: string;
  }): void {
    this.extractionReports.push(report);
  }

  /**
   * Format extraction reports for output.
   */
  formatExtractionReports(): string {
    if (!this.extractionReports.length) return '';
    const unique = new Map(this.extractionReports.map((r) => [r.reportPath, r]));
    const lines = Array.from(unique.values()).map((report, index) => {
      const label = report.title || report.sourceUrl || `Report ${index + 1}`;
      const summary = report.summary ? ` — ${report.summary.slice(0, 240)}` : '';
      return `- ${label}: ${report.reportPath}${summary}`;
    });
    return `\n\nNavis temporary extraction report(s):\n${lines.join('\n')}`;
  }

  /**
   * Reset state for a new run.
   */
  reset(): void {
    this.previousSnapshotRaw = null;
    this.goalState = { lastGoal: '', goalRepeatCount: 0, forceNextVision: false };
    this.history = [];
    this.extractionReports = [];
  }
}
