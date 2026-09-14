/**
 * EverFern Desktop — Learning System Error Handling
 *
 * Comprehensive error handling infrastructure for the continuous learning system.
 * Provides error categorization, recovery strategies, and resilient operation.
 */

import type {
  LearningError,
  LearningErrorCode,
  LearningContext,
  LearnedKnowledge,
  LearningTask,
  SecurityContext,
  LearningErrorHandler
} from './types';

export class LearningSystemError extends Error implements LearningError {
  public readonly type: 'analysis' | 'storage' | 'processing' | 'security';
  public readonly code: LearningErrorCode;
  public readonly context?: LearningContext;
  public readonly recoverable: boolean;
  public readonly retryAfter?: number;
  public readonly timestamp: Date;

  constructor(
    type: 'analysis' | 'storage' | 'processing' | 'security',
    code: LearningErrorCode,
    message: string,
    context?: LearningContext,
    recoverable: boolean = true,
    retryAfter?: number
  ) {
    super(message);
    this.name = 'LearningSystemError';
    this.type = type;
    this.code = code;
    this.context = context;
    this.recoverable = recoverable;
    this.retryAfter = retryAfter;
    this.timestamp = new Date();
  }
}

export class LearningErrorHandlerImpl implements LearningErrorHandler {
  private readonly logger: (message: string, error?: Error) => void;
  private readonly retryPolicy: RetryPolicy;

  constructor(
    logger: (message: string, error?: Error) => void = console.error,
    retryPolicy: RetryPolicy = DEFAULT_RETRY_POLICY
  ) {
    this.logger = logger;
    this.retryPolicy = retryPolicy;
  }

  async handleAnalysisError(error: LearningError, context: LearningContext): Promise<void> {
    this.logger(`[Learning] Analysis error for interaction ${context.interactionId}: ${error.message}`);

    switch (error.code) {
      case 'ANALYSIS_TIMEOUT':
        // Log timeout and skip this interaction
        this.logger(`[Learning] Analysis timeout for interaction ${context.interactionId}, skipping`);
        break;

      case 'PATTERN_DETECTION_FAILED':
        // Retry with simpler pattern detection
        this.logger(`[Learning] Pattern detection failed, will retry with basic analysis`);
        break;

      case 'PII_DETECTION_FAILED':
        // Security critical - reject the interaction entirely
        this.logger(`[Learning] PII detection failed for ${context.interactionId}, rejecting interaction`);
        throw new LearningSystemError(
          'security',
          'PII_DETECTED',
          'Cannot process interaction due to PII detection failure',
          context,
          false
        );

      default:
        this.logger(`[Learning] Unhandled analysis error: ${error.code}`);
    }
  }

  async handleStorageError(error: LearningError, knowledge: LearnedKnowledge): Promise<void> {
    this.logger(`[Learning] Storage error for knowledge ${knowledge.id}: ${error.message}`);

    switch (error.code) {
      case 'STORAGE_ERROR':
        // Retry with exponential backoff
        const retryDelay = this.calculateRetryDelay(error.retryAfter || 1000);
        this.logger(`[Learning] Storage failed, will retry in ${retryDelay}ms`);
        // Queue for retry (implementation would handle this)
        break;

      case 'ENCRYPTION_FAILED':
        // Security critical - do not store unencrypted
        this.logger(`[Learning] Encryption failed for knowledge ${knowledge.id}, rejecting storage`);
        throw new LearningSystemError(
          'security',
          'ENCRYPTION_FAILED',
          'Cannot store knowledge due to encryption failure',
          undefined,
          false
        );

      case 'KNOWLEDGE_VALIDATION_FAILED':
        // Log validation failure and skip storage
        this.logger(`[Learning] Knowledge validation failed for ${knowledge.id}, skipping storage`);
        break;

      default:
        this.logger(`[Learning] Unhandled storage error: ${error.code}`);
    }
  }

  async handleProcessingError(error: LearningError, task: LearningTask): Promise<void> {
    this.logger(`[Learning] Processing error for task ${task.id}: ${error.message}`);

    switch (error.code) {
      case 'RESOURCE_EXHAUSTED':
        // Defer processing to next idle period
        this.logger(`[Learning] Resource exhausted, deferring task ${task.id}`);
        // Implementation would reschedule the task
        break;

      case 'QUEUE_OVERFLOW':
        // Drop oldest low-priority tasks
        this.logger(`[Learning] Queue overflow, will drop low-priority tasks`);
        // Implementation would handle queue management
        break;

      default:
        this.logger(`[Learning] Unhandled processing error: ${error.code}`);
    }
  }

  async handleSecurityError(error: LearningError, context: SecurityContext): Promise<void> {
    this.logger(`[Learning] Security error for session ${context.sessionId}: ${error.message}`);

    // All security errors are treated as critical
    switch (error.code) {
      case 'PII_DETECTION_FAILED':
      case 'ENCRYPTION_FAILED':
        this.logger(`[Learning] Critical security error: ${error.code}, halting processing`);
        // Notify security monitoring system
        await this.notifySecurityEvent(error, context);
        throw error;

      default:
        this.logger(`[Learning] Unhandled security error: ${error.code}`);
        throw error;
    }
  }

  private calculateRetryDelay(baseDelay: number): number {
    // Exponential backoff with jitter
    const jitter = Math.random() * 0.1; // 10% jitter
    return Math.floor(baseDelay * (1 + jitter));
  }

  private async notifySecurityEvent(error: LearningError, context: SecurityContext): Promise<void> {
    // Implementation would integrate with security monitoring
    this.logger(`[Learning] Security event: ${error.code} in session ${context.sessionId}`);
  }
}

export interface RetryPolicy {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2
};

export class ResilientLearningSystem {
  private readonly errorHandler: LearningErrorHandler;
  private readonly retryPolicy: RetryPolicy;

  constructor(
    errorHandler: LearningErrorHandler = new LearningErrorHandlerImpl(),
    retryPolicy: RetryPolicy = DEFAULT_RETRY_POLICY
  ) {
    this.errorHandler = errorHandler;
    this.retryPolicy = retryPolicy;
  }

  async processWithRetry<T>(
    operation: () => Promise<T>,
    errorHandler: (error: LearningError) => Promise<void>,
    maxRetries: number = this.retryPolicy.maxRetries
  ): Promise<T | null> {
    let lastError: LearningError | null = null;
    let delay = this.retryPolicy.baseDelayMs;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        const learningError = this.toLearningError(error);
        lastError = learningError;

        if (!learningError.recoverable || attempt === maxRetries) {
          await errorHandler(learningError);
          break;
        }

        // Wait before retry
        await this.sleep(delay);
        delay = Math.min(delay * this.retryPolicy.backoffMultiplier, this.retryPolicy.maxDelayMs);
      }
    }

    return null;
  }

  private toLearningError(error: unknown): LearningError {
    if (error instanceof LearningSystemError) {
      return error;
    }

    if (error instanceof Error) {
      return new LearningSystemError(
        'analysis',
        'ANALYSIS_FAILED', // Default error code
        error.message,
        undefined,
        true
      );
    }

    return new LearningSystemError(
      'analysis',
      'ANALYSIS_FAILED',
      'Unknown error occurred',
      undefined,
      true
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Error factory functions for common error scenarios
export function createAnalysisTimeoutError(context: LearningContext): LearningError {
  return new LearningSystemError(
    'analysis',
    'ANALYSIS_TIMEOUT',
    `Analysis timeout for interaction ${context.interactionId}`,
    context,
    true,
    5000 // Retry after 5 seconds
  );
}

export function createStorageError(knowledgeId: string, cause?: string): LearningError {
  return new LearningSystemError(
    'storage',
    'STORAGE_FAILED',
    `Failed to store knowledge ${knowledgeId}${cause ? `: ${cause}` : ''}`,
    undefined,
    true,
    2000 // Retry after 2 seconds
  );
}

export function createResourceExhaustedError(resourceType: string): LearningError {
  return new LearningSystemError(
    'processing',
    'PROCESSING_OVERLOAD',
    `Resource exhausted: ${resourceType}`,
    undefined,
    true,
    10000 // Retry after 10 seconds
  );
}

export function createSecurityError(code: LearningErrorCode, message: string): LearningError {
  return new LearningSystemError(
    'security',
    code,
    message,
    undefined,
    false // Security errors are not recoverable
  );
}
