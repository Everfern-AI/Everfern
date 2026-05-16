/**
 * Tool Call Registry
 *
 * Tracks active tool calls and their execution state.
 * Used for cleanup and cancellation when execution is aborted.
 */

interface ToolCallEntry {
  id: string;
  toolName: string;
  status: 'pending' | 'executing' | 'completed' | 'aborted' | 'error';
  startTime: number;
  endTime?: number;
  error?: Error;
}

class ToolCallRegistry {
  private _entries: Map<string, ToolCallEntry> = new Map();

  /**
   * Registers a new tool call
   */
  register(id: string, toolName: string): void {
    this._entries.set(id, {
      id,
      toolName,
      status: 'pending',
      startTime: Date.now()
    });
    console.log(`[ToolCallRegistry] Registered tool call: ${id} (${toolName})`);
  }

  /**
   * Updates tool call status
   */
  updateStatus(id: string, status: ToolCallEntry['status'], error?: Error): void {
    const entry = this._entries.get(id);
    if (entry) {
      entry.status = status;
      entry.endTime = Date.now();
      if (error) {
        entry.error = error;
      }
      console.log(`[ToolCallRegistry] Updated tool call ${id}: ${status}`);
    }
  }

  /**
   * Marks all tool calls as aborted
   */
  markAllAborted(): void {
    const now = Date.now();
    for (const [id, entry] of this._entries.entries()) {
      if (entry.status !== 'completed' && entry.status !== 'aborted') {
        entry.status = 'aborted';
        entry.endTime = now;
        console.log(`[ToolCallRegistry] Marked tool call ${id} as aborted`);
      }
    }
  }

  /**
   * Gets all active tool calls
   */
  getActive(): ToolCallEntry[] {
    return Array.from(this._entries.values()).filter(
      e => e.status === 'pending' || e.status === 'executing'
    );
  }

  /**
   * Gets all tool calls
   */
  getAll(): ToolCallEntry[] {
    return Array.from(this._entries.values());
  }

  /**
   * Clears the registry
   */
  clear(): void {
    this._entries.clear();
    console.log('[ToolCallRegistry] Cleared all entries');
  }

  /**
   * Gets a specific tool call entry
   */
  get(id: string): ToolCallEntry | undefined {
    return this._entries.get(id);
  }

  /**
   * Removes a tool call entry
   */
  remove(id: string): void {
    this._entries.delete(id);
  }
}

// Global tool call registry instance
export const toolCallRegistry = new ToolCallRegistry();

export type { ToolCallEntry };
