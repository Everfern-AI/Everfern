/**
 * EverFern Desktop — Database Service
 *
 * Manages SQLite database connections with connection pooling, transaction support,
 * and retry logic with exponential backoff for resilient data persistence.
 *
 * @see requirements.md - Requirements 10.1, 10.4, 12.4
 * @see design.md - Database Service Interface
 */

import type {
  Conversation,
  ConversationSummary,
  ChatMessage,
  HealthCheckResult,
  DatabaseOperationResult,
} from './chat-memory-types';
import { dbOps, getDb } from '../lib/db';
import type sqlite3 from 'sqlite3';

/**
 * Configuration for retry logic
 */
interface RetryConfig {
  /** Maximum number of retry attempts */
  maxRetries: number;
  /** Base delay in milliseconds for exponential backoff */
  baseDelay: number;
}

/**
 * Queue entry for failed operations to be retried later
 */
interface QueuedOperation {
  id: string;
  operation: () => Promise<any>;
  attempts: number;
  nextRetryTime: number;
  error?: Error;
}

/**
 * DatabaseService manages SQLite database operations with connection pooling,
 * transaction support, and retry logic with exponential backoff.
 *
 * **Validates: Requirements 10.1, 10.4, 12.4**
 */
export class DatabaseService {
  private retryConfig: RetryConfig = {
    maxRetries: 3,
    baseDelay: 100, // milliseconds
  };

  private failedOperationQueue: Map<string, QueuedOperation> = new Map();
  private inTransaction = false;
  private transactionConnection: sqlite3.Database | null = null;

  constructor(config?: Partial<RetryConfig>) {
    if (config) {
      this.retryConfig = { ...this.retryConfig, ...config };
    }
  }

  /**
   * Sleep for a specified duration
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Calculate exponential backoff delay
   * @param attempt - The attempt number (0-indexed)
   * @returns Delay in milliseconds
   */
  private calculateBackoffDelay(attempt: number): number {
    return this.retryConfig.baseDelay * Math.pow(2, attempt);
  }

  /**
   * Execute an operation with retry logic and exponential backoff
   *
   * **Validates: Requirement 10.1 - Database Write Retry**
   *
   * @param operation - The async operation to execute
   * @param operationName - Name of the operation for logging
   * @returns Promise that resolves when operation succeeds or all retries exhausted
   */
  async executeWithRetry<T>(
    operation: () => Promise<T>,
    operationName: string = 'database operation'
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.retryConfig.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt < this.retryConfig.maxRetries - 1) {
          const delay = this.calculateBackoffDelay(attempt);
          console.warn(
            `[DatabaseService] ${operationName} failed (attempt ${attempt + 1}/${this.retryConfig.maxRetries}), ` +
            `retrying in ${delay}ms:`,
            lastError.message
          );
          await this.sleep(delay);
        } else {
          console.error(
            `[DatabaseService] ${operationName} failed after ${this.retryConfig.maxRetries} attempts:`,
            lastError.message
          );
        }
      }
    }

    // Queue the operation for later retry if all attempts failed
    if (lastError) {
      const operationId = `${operationName}-${Date.now()}-${Math.random()}`;
      this.queueFailedOperation(operationId, operation, lastError);
      throw lastError;
    }

    throw new Error(`${operationName} failed unexpectedly`);
  }

  /**
   * Queue a failed operation for later retry
   *
   * **Validates: Requirement 10.2 - Failed Operation Queueing**
   *
   * @param id - Unique identifier for the queued operation
   * @param operation - The operation to retry
   * @param error - The error that caused the failure
   */
  private queueFailedOperation(
    id: string,
    operation: () => Promise<any>,
    error: Error
  ): void {
    const queuedOp: QueuedOperation = {
      id,
      operation,
      attempts: this.retryConfig.maxRetries,
      nextRetryTime: Date.now() + this.calculateBackoffDelay(this.retryConfig.maxRetries),
      error,
    };

    this.failedOperationQueue.set(id, queuedOp);
    console.log(
      `[DatabaseService] Queued operation ${id} for later retry at ${new Date(queuedOp.nextRetryTime).toISOString()}`
    );
  }

  /**
   * Retry queued operations that are ready
   *
   * @returns Number of operations successfully retried
   */
  async retryQueuedOperations(): Promise<number> {
    let successCount = 0;
    const now = Date.now();
    const idsToRemove: string[] = [];

    for (const [id, queuedOp] of this.failedOperationQueue.entries()) {
      if (queuedOp.nextRetryTime <= now) {
        try {
          await queuedOp.operation();
          console.log(`[DatabaseService] Successfully retried queued operation ${id}`);
          idsToRemove.push(id);
          successCount++;
        } catch (error) {
          console.warn(
            `[DatabaseService] Queued operation ${id} still failing:`,
            error instanceof Error ? error.message : String(error)
          );
          // Update next retry time for exponential backoff
          queuedOp.nextRetryTime = now + this.calculateBackoffDelay(queuedOp.attempts);
          queuedOp.attempts++;
        }
      }
    }

    // Remove successfully retried operations
    idsToRemove.forEach(id => this.failedOperationQueue.delete(id));

    return successCount;
  }

  /**
   * Get the number of operations in the retry queue
   */
  getQueuedOperationCount(): number {
    return this.failedOperationQueue.size;
  }

  /**
   * Begin a database transaction
   *
   * **Validates: Requirement 10.4 - Transaction Atomicity**
   *
   * @throws Error if a transaction is already in progress
   */
  async beginTransaction(): Promise<void> {
    if (this.inTransaction) {
      throw new Error('Transaction already in progress');
    }

    try {
      this.transactionConnection = await getDb();
      await this.executeWithRetry(
        () => dbOps.run('BEGIN TRANSACTION'),
        'BEGIN TRANSACTION'
      );
      this.inTransaction = true;
      console.log('[DatabaseService] Transaction started');
    } catch (error) {
      this.transactionConnection = null;
      throw error;
    }
  }

  /**
   * Commit the current transaction
   *
   * **Validates: Requirement 10.4 - Transaction Atomicity**
   *
   * @throws Error if no transaction is in progress
   */
  async commitTransaction(): Promise<void> {
    if (!this.inTransaction) {
      throw new Error('No transaction in progress');
    }

    try {
      await this.executeWithRetry(
        () => dbOps.run('COMMIT'),
        'COMMIT TRANSACTION'
      );
      this.inTransaction = false;
      this.transactionConnection = null;
      console.log('[DatabaseService] Transaction committed');
    } catch (error) {
      // Attempt rollback on commit failure
      try {
        await this.rollbackTransaction();
      } catch (rollbackError) {
        console.error('[DatabaseService] Rollback failed:', rollbackError);
      }
      throw error;
    }
  }

  /**
   * Rollback the current transaction
   *
   * **Validates: Requirement 10.4 - Transaction Atomicity**
   *
   * @throws Error if no transaction is in progress
   */
  async rollbackTransaction(): Promise<void> {
    if (!this.inTransaction) {
      throw new Error('No transaction in progress');
    }

    try {
      await this.executeWithRetry(
        () => dbOps.run('ROLLBACK'),
        'ROLLBACK TRANSACTION'
      );
      console.log('[DatabaseService] Transaction rolled back');
    } finally {
      this.inTransaction = false;
      this.transactionConnection = null;
    }
  }

  /**
   * Check if a transaction is currently active
   */
  isInTransaction(): boolean {
    return this.inTransaction;
  }

  /**
   * Save a conversation to the database
   *
   * **Validates: Requirements 7.1, 7.2**
   *
   * @param conversation - The conversation to save
   * @returns Operation result with success status
   */
  async saveConversation(
    conversation: Conversation
  ): Promise<DatabaseOperationResult> {
    try {
      await this.executeWithRetry(async () => {
        // Insert or update conversation
        await dbOps.run(
          `INSERT OR REPLACE INTO conversations (id, title, provider, model, project_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            conversation.id,
            conversation.title,
            conversation.provider,
            conversation.model || null,
            conversation.projectId || null,
            conversation.createdAt,
            conversation.updatedAt,
          ]
        );

        // Insert messages
        for (const message of conversation.messages) {
          await dbOps.run(
            `INSERT OR REPLACE INTO messages
             (id, conversation_id, role, content, thought, reasoning_content, tool_calls, mission_timeline,
              has_timeline, order_index, thinking_duration, stopped, attachments, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              message.id,
              conversation.id,
              message.role,
              typeof message.content === 'string' ? message.content : JSON.stringify(message.content),
              message.thought || null,
              message.reasoning_content || null,
              message.toolCalls ? JSON.stringify(message.toolCalls) : null,
              message.missionTimeline ? JSON.stringify(message.missionTimeline) : null,
              message.hasTimeline ? 1 : 0,
              message.orderIndex,
              message.thinkingDuration || null,
              message.stopped ? 1 : 0,
              message.attachments ? JSON.stringify(message.attachments) : null,
              message.createdAt,
            ]
          );
        }
      }, `saveConversation(${conversation.id})`);

      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[DatabaseService] Failed to save conversation ${conversation.id}:`, errorMessage);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Load a conversation from the database
   *
   * **Validates: Requirements 7.1, 7.2**
   *
   * @param id - The conversation ID to load
   * @returns The loaded conversation or null if not found
   */
  async loadConversation(id: string): Promise<Conversation | null> {
    try {
      const conversation = await this.executeWithRetry(async () => {
        const conv = await dbOps.get(
          'SELECT * FROM conversations WHERE id = ?',
          [id]
        );

        if (!conv) return null;

        const messages = await dbOps.all(
          'SELECT * FROM messages WHERE conversation_id = ? ORDER BY order_index ASC',
          [id]
        );

        return {
          id: conv.id,
          title: conv.title,
          provider: conv.provider,
          model: conv.model,
          projectId: conv.project_id,
          projectName: conv.project_name,
          messages: messages.map((msg: any) => {
            // Parse content if it's a JSON string (for multimodal content)
            let content = msg.content;
            try {
              if (typeof content === 'string' && content.startsWith('[')) {
                content = JSON.parse(content);
              }
            } catch {
              // Keep as string if parsing fails
            }

            return {
              id: msg.id,
              role: msg.role,
              content,
              thought: msg.thought || undefined,
              reasoning_content: msg.reasoning_content || undefined,
              toolCalls: msg.tool_calls ? JSON.parse(msg.tool_calls) : undefined,
              missionTimeline: msg.mission_timeline ? JSON.parse(msg.mission_timeline) : undefined,
              hasTimeline: msg.has_timeline === 1,
              orderIndex: msg.order_index,
              thinkingDuration: msg.thinking_duration || undefined,
              stopped: msg.stopped === 1,
              attachments: msg.attachments ? JSON.parse(msg.attachments) : undefined,
              createdAt: msg.created_at,
            };
          }),
          createdAt: conv.created_at,
          updatedAt: conv.updated_at,
        };
      }, `loadConversation(${id})`);

      return conversation;
    } catch (error) {
      console.error(`[DatabaseService] Failed to load conversation ${id}:`, error);
      return null;
    }
  }

  /**
   * List all conversations with metadata
   *
   * **Validates: Requirement 8.2**
   *
   * @returns Array of conversation summaries
   */
  async listConversations(): Promise<ConversationSummary[]> {
    try {
      const conversations = await this.executeWithRetry(async () => {
        const rows = await dbOps.all(`
          SELECT c.*, COUNT(m.id) as messageCount
          FROM conversations c
          LEFT JOIN messages m ON c.id = m.conversation_id
          GROUP BY c.id
          ORDER BY c.updated_at DESC
        `);

        return rows.map((row: any) => ({
          id: row.id,
          title: row.title,
          provider: row.provider,
          model: row.model,
          projectId: row.project_id,
          projectName: row.project_name,
          messageCount: row.messageCount || 0,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }));
      }, 'listConversations');

      return conversations;
    } catch (error) {
      console.error('[DatabaseService] Failed to list conversations:', error);
      return [];
    }
  }

  /**
   * Delete a conversation and all associated messages
   *
   * **Validates: Requirements 1.5, 8.4**
   *
   * @param id - The conversation ID to delete
   * @returns Operation result with success status
   */
  async deleteConversation(id: string): Promise<DatabaseOperationResult> {
    try {
      await this.executeWithRetry(async () => {
        // Delete messages first (cascade delete is handled by foreign key)
        await dbOps.run(
          'DELETE FROM messages WHERE conversation_id = ?',
          [id]
        );

        // Delete conversation
        await dbOps.run(
          'DELETE FROM conversations WHERE id = ?',
          [id]
        );
      }, `deleteConversation(${id})`);

      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[DatabaseService] Failed to delete conversation ${id}:`, errorMessage);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Perform a health check on the database
   *
   * **Validates: Requirements 5.1, 5.2, 5.3, 5.4**
   *
   * @returns Health check result with diagnostics
   */
  async healthCheck(): Promise<HealthCheckResult> {
    const diagnostics: Record<string, any> = {};

    try {
      // Test database connectivity
      const startTime = Date.now();
      await this.executeWithRetry(
        () => dbOps.get('SELECT 1'),
        'healthCheck: connectivity'
      );
      diagnostics.connectivityMs = Date.now() - startTime;

      // Verify required tables exist
      const tables = await this.executeWithRetry(async () => {
        const result = await dbOps.all(
          `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('conversations', 'messages')`
        );
        return result.map((r: any) => r.name);
      }, 'healthCheck: table check');

      diagnostics.requiredTablesExist = tables.includes('conversations') && tables.includes('messages');

      if (!diagnostics.requiredTablesExist) {
        return {
          healthy: false,
          message: 'Required database tables are missing',
          diagnostics,
        };
      }

      // Test write permissions with a test write
      const testId = `health-check-${Date.now()}`;
      try {
        await this.executeWithRetry(async () => {
          await dbOps.run(
            'INSERT INTO conversations (id, title, provider) VALUES (?, ?, ?)',
            [testId, 'Health Check', 'test']
          );
        }, 'healthCheck: write test');

        // Clean up test data
        await this.executeWithRetry(
          () => dbOps.run('DELETE FROM conversations WHERE id = ?', [testId]),
          'healthCheck: cleanup'
        );

        diagnostics.canWrite = true;
      } catch (writeError) {
        diagnostics.canWrite = false;
        diagnostics.writeError = writeError instanceof Error ? writeError.message : String(writeError);
        return {
          healthy: false,
          message: 'Database write test failed',
          diagnostics,
        };
      }

      return {
        healthy: true,
        message: 'Database is healthy',
        diagnostics,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        healthy: false,
        message: `Database health check failed: ${errorMessage}`,
        diagnostics: {
          ...diagnostics,
          error: errorMessage,
        },
      };
    }
  }

  /**
   * Get database statistics
   *
   * @returns Object with database statistics
   */
  async getStats(): Promise<{
    conversationCount: number;
    messageCount: number;
    databaseSize: number;
  }> {
    try {
      const stats = await this.executeWithRetry(async () => {
        const convCount = await dbOps.get('SELECT COUNT(*) as count FROM conversations');
        const msgCount = await dbOps.get('SELECT COUNT(*) as count FROM messages');

        return {
          conversationCount: convCount?.count || 0,
          messageCount: msgCount?.count || 0,
          databaseSize: 0, // Would need file system access to get actual size
        };
      }, 'getStats');

      return stats;
    } catch (error) {
      console.error('[DatabaseService] Failed to get stats:', error);
      return {
        conversationCount: 0,
        messageCount: 0,
        databaseSize: 0,
      };
    }
  }
}

// Export singleton instance
export const databaseService = new DatabaseService({
  maxRetries: 3,
  baseDelay: 100,
});
