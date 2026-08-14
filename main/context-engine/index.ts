/**
 * EverFern Desktop — Context Engine
 * Unified exports for the context-engine subsystem.
 */

export type {
  ContextEngine,
  ContextEngineInfo,
  AssembleResult,
  CompactResult,
  IngestResult,
  CompactionOptions,
  DistillationOptions,
  DAGNodeState,
} from './types';

export {
  registerContextEngine,
  resolveContextEngine,
  listContextEngineIds,
  setDefaultContextEngine,
} from './registry';

export type { ContextEngineFactory } from './registry';

export { DefaultContextEngine } from './default';
export {
  CompactingContextEngine,
  distillToolOutput,
  stripThinkingBlocks,
  summarizeTurnHistory,
  formatDAGNodeSummary,
  estimateMessageTokens,
} from './compacting';
export { VectorContextEngine, HybridContextEngine, getContextEngineStats } from './vector';
