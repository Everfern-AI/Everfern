/**
 * AbortSignalManager - Enhanced Stop Button Mechanism with Cleanup Coordination
 *
 * Provides robust abort signal propagation through the execution graph
 * to ensure the stop button can immediately halt AI execution, and coordinates
 * cleanup of all agentic tasks (tool calls, browser sessions, sub-agents, streaming).
 *
 * Requirements:
 * - 1.1: Stop button shall immediately set the Stream_Abort_Flag to true
 * - 1.2: Agent_Runner shall check the flag before each node execution
 * - 1.3: Agent_Runner shall throw an abortion error within 100ms when flag is true
 * - Cleanup coordination: Sub-agents (200ms) → Tool calls (100ms) → Browser (500ms) → Streaming (immediate)
 */

interface CleanupPhaseStatus {
  phase: 'sub-agents' | 'tool-calls' | 'browser-sessions' | 'streaming';
  completed: boolean;
  startTime: number;
  endTime: number | null;
  durationMs: number | null;
  error: Error | null;
}

interface CleanupStatus {
  success: boolean;
  errors: Array<{ phase: string; message: string; stack?: string }>;
  completedPhases: number;
  totalPhases: number;
  elapsedMs: number;
  phases: CleanupPhaseStatus[];
}

export class AbortSignalManager {
  private _streamAborted: boolean = false;
  private _abortController: AbortController = new AbortController();
  private _abortStartTime: number | null = null;
  private _cleanupStartTime: number | null = null;
  private _listeners: Array<() => void> = [];
  private _cleanupPhases: Map<string, CleanupPhaseStatus> = new Map();
  private _cleanupErrors: Array<{ phase: string; error: Error }> = [];

  /**
   * Gets the current abort status
   */
  get streamAborted(): boolean {
    return this._streamAborted;
  }

  /**
   * Gets the AbortController for tool execution cancellation
   */
  get abortController(): AbortController {
    return this._abortController;
  }

  /**
   * Adds a listener for abort events
   */
  onAbort(callback: () => void): () => void {
    this._listeners.push(callback);
    return () => {
      this._listeners = this._listeners.filter(l => l !== callback);
    };
  }

  /**
   * Registers a listener for abort events (alias for onAbort)
   */
  registerListener(callback: () => void): void {
    this._listeners.push(callback);
  }

  /**
   * Notifies all registered listeners
   */
  private notifyListeners(): void {
    this._listeners.forEach(callback => {
      try {
        callback();
      } catch (err) {
        console.error('[AbortSignalManager] Listener error:', err);
      }
    });
  }

  /**
   * Sets the abort flag to true and starts abort propagation
   * Requirement 1.1: Stop button shall immediately set the Stream_Abort_Flag to true
   */
  setAborted(): void {
    if (!this._streamAborted) {
      this._streamAborted = true;
      this._abortStartTime = Date.now();
      this._abortController.abort();
      console.log('[AbortSignalManager] 🛑 Abort signal set - execution will be terminated');

      // Notify listeners synchronously
      this.notifyListeners();
    }
  }

  /**
   * Checks if execution should be aborted and throws error if needed
   * Requirement 1.2: Agent_Runner shall check the flag before each node execution
   * Requirement 1.3: Agent_Runner shall throw an abortion error within 100ms when flag is true
   */
  checkAbort(): boolean {
    if (this._streamAborted) {
      const abortTime = this._abortStartTime ? Date.now() - this._abortStartTime : 0;
      console.log(`[AbortSignalManager] 🛑 Abort detected after ${abortTime}ms - throwing abortion error`);
      throw new Error('Execution aborted by user (stop button clicked)');
    }
    return false;
  }

  /**
   * Propagates abort signal to running tools and operations
   * Requirement 1.7: For ALL running tool executions, abortion SHALL propagate to terminate long-running operations
   */
  propagateToTools(): void {
    if (this._streamAborted && !this._abortController.signal.aborted) {
      this._abortController.abort();
      console.log('[AbortSignalManager] 🛑 Abort signal propagated to running tools');
    }
  }

  /**
   * Executes the cleanup sequence in order:
   * 1. Sub-agents (200ms max)
   * 2. Tool calls (100ms max)
   * 3. Browser sessions (500ms max)
   * 4. Streaming (immediate)
   */
  async executeCleanupSequence(): Promise<CleanupStatus> {
    this._cleanupStartTime = Date.now();
    this._cleanupPhases.clear();
    this._cleanupErrors = [];

    const phases: CleanupPhaseStatus[] = [];

    // Phase 1: Sub-agents (200ms max)
    const subAgentPhase = await this.executeCleanupPhase(
      'sub-agents',
      200,
      async () => {
        console.log('[Cleanup] Starting sub-agent termination...');
        try {
          const { getSubagentSpawner } = await import('./subagent-spawn');
          const spawner = getSubagentSpawner();
          if (spawner && typeof spawner.abortAll === 'function') {
            await spawner.abortAll();
          }
        } catch (err) {
          console.error('[Cleanup] Sub-agent abort error:', err);
          throw err;
        }
      }
    );
    phases.push(subAgentPhase);

    // Phase 2: Tool calls (100ms max)
    const toolCallPhase = await this.executeCleanupPhase(
      'tool-calls',
      100,
      async () => {
        console.log('[Cleanup] Starting tool call cancellation...');
        try {
          // Mark all tool calls as aborted in registry
          const { toolCallRegistry } = await import('./tool-call-registry');
          if (toolCallRegistry && typeof toolCallRegistry.markAllAborted === 'function') {
            toolCallRegistry.markAllAborted();
          }
        } catch (err) {
          console.error('[Cleanup] Tool call cancellation error:', err);
          throw err;
        }
      }
    );
    phases.push(toolCallPhase);

    // Phase 3: Browser sessions (500ms max)
    const browserPhase = await this.executeCleanupPhase(
      'browser-sessions',
      500,
      async () => {
        console.log('[Cleanup] Starting browser session closure...');
        try {
          const { BrowserSession } = await import('../tools/navis/session');
          await BrowserSession.closeAll(true);
        } catch (err) {
          console.error('[Cleanup] Browser session close error:', err);
          throw err;
        }
      }
    );
    phases.push(browserPhase);

    // Phase 4: Streaming (immediate)
    const streamingPhase = await this.executeCleanupPhase(
      'streaming',
      0, // No timeout for streaming
      async () => {
        console.log('[Cleanup] Streaming cancellation (immediate)');
        // Streaming is cancelled by the abort signal already
      }
    );
    phases.push(streamingPhase);

    const totalElapsedMs = Date.now() - this._cleanupStartTime;
    const completedPhases = phases.filter(p => p.completed).length;

    const status: CleanupStatus = {
      success: this._cleanupErrors.length === 0,
      errors: this._cleanupErrors.map(e => ({
        phase: e.phase,
        message: e.error.message,
        stack: e.error.stack
      })),
      completedPhases,
      totalPhases: phases.length,
      elapsedMs: totalElapsedMs,
      phases
    };

    console.log('[Cleanup] Sequence complete:', {
      success: status.success,
      completedPhases: status.completedPhases,
      totalPhases: status.totalPhases,
      elapsedMs: status.elapsedMs,
      errors: status.errors.length
    });

    return status;
  }

  /**
   * Executes a single cleanup phase with timeout enforcement
   */
  private async executeCleanupPhase(
    phaseName: string,
    timeoutMs: number,
    phaseFunction: () => Promise<void>
  ): Promise<CleanupPhaseStatus> {
    const startTime = Date.now();
    const phaseStatus: CleanupPhaseStatus = {
      phase: phaseName as any,
      completed: false,
      startTime,
      endTime: null,
      durationMs: null,
      error: null
    };

    try {
      // Execute phase with timeout if specified
      if (timeoutMs > 0) {
        await Promise.race([
          phaseFunction(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Phase timeout: ${timeoutMs}ms exceeded`)), timeoutMs)
          )
        ]);
      } else {
        await phaseFunction();
      }

      phaseStatus.completed = true;
      phaseStatus.endTime = Date.now();
      phaseStatus.durationMs = phaseStatus.endTime - startTime;
      console.log(`[Cleanup] Phase '${phaseName}' completed in ${phaseStatus.durationMs}ms`);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      phaseStatus.error = error;
      phaseStatus.endTime = Date.now();
      phaseStatus.durationMs = phaseStatus.endTime - startTime;
      this._cleanupErrors.push({ phase: phaseName, error });
      console.error(`[Cleanup] Phase '${phaseName}' error after ${phaseStatus.durationMs}ms:`, error.message);
    }

    this._cleanupPhases.set(phaseName, phaseStatus);
    return phaseStatus;
  }

  /**
   * Gets the current cleanup status
   */
  getCleanupStatus(): CleanupStatus | null {
    if (this._cleanupStartTime === null) {
      return null;
    }

    const phases = Array.from(this._cleanupPhases.values());
    const totalElapsedMs = Date.now() - this._cleanupStartTime;
    const completedPhases = phases.filter(p => p.completed).length;

    return {
      success: this._cleanupErrors.length === 0,
      errors: this._cleanupErrors.map(e => ({
        phase: e.phase,
        message: e.error.message,
        stack: e.error.stack
      })),
      completedPhases,
      totalPhases: phases.length,
      elapsedMs: totalElapsedMs,
      phases
    };
  }

  /**
   * Resets the abort state for a new execution
   */
  reset(): void {
    this._streamAborted = false;
    this._abortStartTime = null;
    this._cleanupStartTime = null;
    this._cleanupPhases.clear();
    this._cleanupErrors = [];
    // Create new AbortController for fresh execution
    this._abortController = new AbortController();
    // Clear listeners
    this._listeners = [];
    console.log('[AbortSignalManager] ✅ Abort state reset for new execution');
  }

  /**
   * Creates a shouldAbort callback function for compatibility with existing code
   */
  createShouldAbortCallback(): () => boolean {
    return () => this._streamAborted;
  }

  /**
   * Gets abort timing information for debugging
   */
  getAbortTiming(): { aborted: boolean; elapsedMs: number | null } {
    return {
      aborted: this._streamAborted,
      elapsedMs: this._abortStartTime ? Date.now() - this._abortStartTime : null
    };
  }
}

/**
 * Global abort signal manager instance
 * This provides a centralized abort state that can be accessed across the system
 */
export const globalAbortManager = new AbortSignalManager();

/**
 * AbortError class for consistent error handling
 */
export class AbortError extends Error {
  constructor(message: string = 'Execution aborted by user') {
    super(message);
    this.name = 'AbortError';
  }
}
