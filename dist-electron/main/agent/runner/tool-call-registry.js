"use strict";
/**
 * Tool Call Registry
 *
 * Tracks active tool calls and their execution state.
 * Used for cleanup and cancellation when execution is aborted.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.toolCallRegistry = void 0;
class ToolCallRegistry {
    _entries = new Map();
    /**
     * Registers a new tool call
     */
    register(id, toolName) {
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
    updateStatus(id, status, error) {
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
    markAllAborted() {
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
    getActive() {
        return Array.from(this._entries.values()).filter(e => e.status === 'pending' || e.status === 'executing');
    }
    /**
     * Gets all tool calls
     */
    getAll() {
        return Array.from(this._entries.values());
    }
    /**
     * Clears the registry
     */
    clear() {
        this._entries.clear();
        console.log('[ToolCallRegistry] Cleared all entries');
    }
    /**
     * Gets a specific tool call entry
     */
    get(id) {
        return this._entries.get(id);
    }
    /**
     * Removes a tool call entry
     */
    remove(id) {
        this._entries.delete(id);
    }
}
// Global tool call registry instance
exports.toolCallRegistry = new ToolCallRegistry();
