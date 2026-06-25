/**
 * Simple State Manager for HITL Support
 * 
 * BUG-07 FIX: Added SQLite persistence so HITL state survives app restarts.
 * Previously this was in-memory-only, causing all interrupted HITL states to
 * be permanently lost on restart.
 * 
 * BUG-14 FIX: Reduced history limit from 50 to 10, cleanup threshold from
 * 1 hour to 15 minutes, to prevent multi-GB memory usage from large state snapshots.
 */

import { dbOps } from '../../lib/db';

interface SessionState {
  conversationId: string;
  currentState: any;
  history: any[];
  lastUpdate: number;
  isInterrupted: boolean;
  interruptData?: any;
}

// BUG-14 FIX: Reduced from 50 to 10 — each snapshot can be 1-10MB
const MAX_HISTORY_SIZE = 10;
// BUG-14 FIX: Reduced from 1 hour to 15 minutes
const CLEANUP_THRESHOLD_MS = 15 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

class StateManager {
  private sessions: Map<string, SessionState> = new Map();
  private persistenceReady = false;

  constructor() {
    // Initialize persistence table
    this.initPersistence().catch(err => {
      console.warn('[StateManager] Failed to init persistence:', err);
    });
  }

  /**
   * BUG-07 FIX: Create SQLite table for persisting interrupted states
   */
  private async initPersistence(): Promise<void> {
    try {
      await dbOps.run(`
        CREATE TABLE IF NOT EXISTS hitl_state (
          conversation_id TEXT PRIMARY KEY,
          state_json TEXT NOT NULL,
          interrupt_data_json TEXT,
          is_interrupted INTEGER DEFAULT 0,
          updated_at TEXT DEFAULT (datetime('now'))
        )
      `);
      this.persistenceReady = true;
      console.log('[StateManager] 💾 Persistence table initialized');

      // Load any previously persisted interrupted states
      await this.loadPersistedStates();
    } catch (err) {
      console.warn('[StateManager] Persistence init failed (will use in-memory only):', err);
    }
  }

  /**
   * BUG-07 FIX: Load persisted interrupted states on startup
   */
  private async loadPersistedStates(): Promise<void> {
    try {
      const rows = await dbOps.all(
        'SELECT * FROM hitl_state WHERE is_interrupted = 1'
      );
      for (const row of rows) {
        const state: SessionState = {
          conversationId: row.conversation_id,
          currentState: JSON.parse(row.state_json),
          history: [],
          lastUpdate: Date.now(),
          isInterrupted: true,
          interruptData: row.interrupt_data_json ? JSON.parse(row.interrupt_data_json) : undefined,
        };
        this.sessions.set(row.conversation_id, state);
      }
      if (rows.length > 0) {
        console.log(`[StateManager] 📖 Restored ${rows.length} interrupted state(s) from disk`);
      }
    } catch (err) {
      console.warn('[StateManager] Failed to load persisted states:', err);
    }
  }

  /**
   * BUG-07 FIX: Persist interrupted state to disk
   */
  private async persistInterruptedState(session: SessionState): Promise<void> {
    if (!this.persistenceReady) return;
    try {
      await dbOps.run(
        `INSERT OR REPLACE INTO hitl_state (conversation_id, state_json, interrupt_data_json, is_interrupted, updated_at)
         VALUES (?, ?, ?, ?, datetime('now'))`,
        [
          session.conversationId,
          JSON.stringify(session.currentState),
          session.interruptData ? JSON.stringify(session.interruptData) : null,
          session.isInterrupted ? 1 : 0,
        ]
      );
    } catch (err) {
      console.warn('[StateManager] Failed to persist state:', err);
    }
  }

  /**
   * BUG-07 FIX: Remove persisted state from disk
   */
  private async removePersistedState(conversationId: string): Promise<void> {
    if (!this.persistenceReady) return;
    try {
      await dbOps.run('DELETE FROM hitl_state WHERE conversation_id = ?', [conversationId]);
    } catch (err) {
      console.warn('[StateManager] Failed to remove persisted state:', err);
    }
  }

  /**
   * Save state for a conversation
   */
  saveState(conversationId: string, state: any): void {
    const existing = this.sessions.get(conversationId);
    
    this.sessions.set(conversationId, {
      conversationId,
      currentState: state,
      history: existing?.history || [],
      lastUpdate: Date.now(),
      isInterrupted: existing?.isInterrupted || false,
      interruptData: existing?.interruptData,
    });

    // Add to history
    const session = this.sessions.get(conversationId)!;
    session.history.push({
      state,
      timestamp: Date.now(),
    });

    // BUG-14 FIX: Limit history to 10 states (down from 50)
    if (session.history.length > MAX_HISTORY_SIZE) {
      session.history = session.history.slice(-MAX_HISTORY_SIZE);
    }

    console.log(`[StateManager] 💾 Saved state for conversation: ${conversationId}`);
  }

  /**
   * Get state for a conversation
   */
  getState(conversationId: string): any | undefined {
    const session = this.sessions.get(conversationId);
    return session?.currentState;
  }

  /**
   * Mark conversation as interrupted (for HITL)
   */
  setInterrupted(conversationId: string, interruptData: any): void {
    const session = this.sessions.get(conversationId);
    if (session) {
      session.isInterrupted = true;
      session.interruptData = interruptData;
      console.log(`[StateManager] ⏸️  Conversation interrupted: ${conversationId}`);

      // BUG-07 FIX: Persist interrupted state to disk
      this.persistInterruptedState(session).catch(err => {
        console.warn('[StateManager] Failed to persist interrupted state:', err);
      });
    }
  }

  /**
   * Resume from interrupt
   */
  resumeFromInterrupt(conversationId: string, resumeData: any): { state: any; interruptData: any } | undefined {
    const session = this.sessions.get(conversationId);
    if (!session || !session.isInterrupted) {
      return undefined;
    }

    session.isInterrupted = false;
    const interruptData = session.interruptData;
    session.interruptData = undefined;

    console.log(`[StateManager] ▶️  Resuming conversation: ${conversationId}`);

    // BUG-07 FIX: Remove persisted state from disk since it's been resumed
    this.removePersistedState(conversationId).catch(err => {
      console.warn('[StateManager] Failed to remove persisted state on resume:', err);
    });

    return {
      state: session.currentState,
      interruptData,
    };
  }

  /**
   * Check if conversation is interrupted
   */
  isInterrupted(conversationId: string): boolean {
    const session = this.sessions.get(conversationId);
    return session?.isInterrupted || false;
  }

  /**
   * Get interrupt data for a conversation
   */
  getInterruptData(conversationId: string): any | undefined {
    const session = this.sessions.get(conversationId);
    return session?.interruptData;
  }

  /**
   * Clear conversation state
   */
  clearState(conversationId: string): void {
    this.sessions.delete(conversationId);
    this.removePersistedState(conversationId).catch(() => {});
    console.log(`[StateManager] 🗑️  Cleared state for conversation: ${conversationId}`);
  }

  /**
   * Get all active conversations
   */
  getActiveConversations(): string[] {
    return Array.from(this.sessions.keys());
  }

  /**
   * Get statistics
   */
  getStats(): { sessions: number; totalStates: number } {
    let totalStates = 0;
    for (const session of this.sessions.values()) {
      totalStates += session.history.length;
    }

    return {
      sessions: this.sessions.size,
      totalStates,
    };
  }

  /**
   * Cleanup old sessions
   * BUG-14 FIX: Reduced threshold from 1 hour to 15 minutes
   */
  cleanup(): void {
    const threshold = Date.now() - CLEANUP_THRESHOLD_MS;
    let cleaned = 0;

    for (const [conversationId, session] of this.sessions.entries()) {
      // Don't clean up interrupted sessions — they need to survive
      if (session.isInterrupted) continue;

      if (session.lastUpdate < threshold) {
        this.sessions.delete(conversationId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`[StateManager] 🧹 Cleaned up ${cleaned} old sessions`);
    }
  }
}

// Create singleton instance
export const stateManager = new StateManager();

// BUG-14 FIX: Run cleanup every 5 minutes (down from 10)
setInterval(() => {
  stateManager.cleanup();
}, CLEANUP_INTERVAL_MS);
