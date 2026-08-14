/**
 * EverFern Desktop — Default Context Engine
 *
 * Smart, token-budget-aware default context engine.
 * Supports active multi-pass compaction, tool result distillation,
 * DAG graph context integration, and turn summarization.
 */

import type { ChatMessage } from '../lib/ai-client';
import type {
  ContextEngine,
  ContextEngineInfo,
  AssembleResult,
  CompactResult,
  IngestResult,
  CompactionOptions,
  DAGNodeState,
} from './types';
import { CompactingContextEngine } from './compacting';

export class DefaultContextEngine implements ContextEngine {
  readonly info: ContextEngineInfo = {
    id: 'default',
    name: 'EverFern Default Smart Context Engine',
    version: '2.0.0',
    ownsCompaction: true,
  };

  private compactor = new CompactingContextEngine();

  async ingest(params: {
    sessionId: string;
    message: ChatMessage;
  }): Promise<IngestResult> {
    return this.compactor.ingest(params);
  }

  async assemble(params: {
    sessionId: string;
    messages: ChatMessage[];
    tokenBudget?: number;
    model?: string;
    prompt?: string;
    options?: CompactionOptions;
    dagNodes?: DAGNodeState[];
  }): Promise<AssembleResult> {
    return this.compactor.assemble(params);
  }

  async compact(params: {
    sessionId: string;
    messages?: ChatMessage[];
    tokenBudget?: number;
    force?: boolean;
    currentTokenCount?: number;
    options?: CompactionOptions;
    dagNodes?: DAGNodeState[];
  }): Promise<CompactResult> {
    return this.compactor.compact(params);
  }

  async dispose(): Promise<void> {
    await this.compactor.dispose();
  }
}
