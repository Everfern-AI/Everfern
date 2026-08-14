/**
 * EverFern Desktop — Vector Context Engine
 * 
 * Context engine that uses sqlite-vec embeddings for semantic retrieval
 * combined with CompactingContextEngine for smart turn summarization & distillation.
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
import {
  embedAndStoreMessage,
  searchChatVectors,
  getVectorStats,
} from '../store/chat-vectors';
import { CompactingContextEngine, estimateMessageTokens } from './compacting';

export class VectorContextEngine implements ContextEngine {
  readonly info: ContextEngineInfo = {
    id: 'vector',
    name: 'EverFern Vector Context Engine',
    version: '2.0.0',
    ownsCompaction: true,
  };

  private sessionTokens: Map<string, number> = new Map();
  private lastAssemble: Map<string, AssembleResult> = new Map();
  private compactor = new CompactingContextEngine();

  async ingest(params: {
    sessionId: string;
    message: ChatMessage;
  }): Promise<IngestResult> {
    const { sessionId, message } = params;
    
    const content = typeof message.content === 'string'
      ? message.content
      : JSON.stringify(message.content);
    
    const msgId = `msg-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    
    try {
      await embedAndStoreMessage(
        msgId,
        sessionId,
        message.role,
        content,
        Date.now()
      );
      
      const tokens = estimateMessageTokens([message]);
      const current = this.sessionTokens.get(sessionId) || 0;
      this.sessionTokens.set(sessionId, current + tokens);
      
      return {
        ingested: true,
        tokensIngested: tokens,
        totalTokens: this.sessionTokens.get(sessionId) || 0,
      };
    } catch (err) {
      console.warn('[VectorContext] Failed to ingest message', err);
      return { ingested: false };
    }
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
    const budget = params.tokenBudget ?? 100_000;
    const prompt = params.prompt || '';

    // First, perform compacting assembly
    const baseAssemble = await this.compactor.assemble(params);
    let remaining = budget - baseAssemble.estimatedTokens;

    let vectorContext: ChatMessage[] = [];
    if (prompt && prompt.length > 10 && remaining > 1000) {
      try {
        const results = await searchChatVectors(prompt, 4, params.sessionId);
        
        for (const result of results) {
          if (result.similarity < 0.85) continue;
          
          const ctxMsg: ChatMessage = {
            role: result.role as any,
            content: `[Relevant Historical Memory (Similarity: ${Math.round(result.similarity * 100)}%)]\n${result.content}`,
          };
          const ctxTokens = estimateMessageTokens([ctxMsg]);
          
          if (remaining - ctxTokens > 0) {
            vectorContext.push(ctxMsg);
            remaining -= ctxTokens;
          }
        }
        
        if (vectorContext.length > 0) {
          console.log(`[VectorContext] Retrieved ${vectorContext.length} relevant past messages`);
        }
      } catch (err) {
        console.warn('[VectorContext] Vector search failed', err);
      }
    }

    if (vectorContext.length === 0) {
      this.lastAssemble.set(params.sessionId, baseAssemble);
      return baseAssemble;
    }

    // Merge vector context after system message(s)
    const msgs = baseAssemble.messages;
    const systemMsgs = msgs.filter((m) => m.role === 'system');
    const nonSystemMsgs = msgs.filter((m) => m.role !== 'system');

    const merged = [...systemMsgs, ...vectorContext, ...nonSystemMsgs];
    const totalEst = estimateMessageTokens(merged);

    const result: AssembleResult = {
      ...baseAssemble,
      messages: merged,
      estimatedTokens: totalEst,
    };
    
    this.lastAssemble.set(params.sessionId, result);
    return result;
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
    const compactRes = await this.compactor.compact(params);
    const stats = await getVectorStats();

    return {
      ...compactRes,
      reason: `${compactRes.reason || 'Compaction finished'}. Vector store holds ${stats.messageCount} items (${Math.round(stats.storageSize / 1024)}KB)`,
    };
  }

  async dispose(): Promise<void> {
    this.sessionTokens.clear();
    this.lastAssemble.clear();
    await this.compactor.dispose();
  }
}

export class HybridContextEngine implements ContextEngine {
  readonly info: ContextEngineInfo = {
    id: 'hybrid',
    name: 'EverFern Hybrid Context Engine',
    version: '2.0.0',
    ownsCompaction: true,
  };

  private vectorEngine = new VectorContextEngine();
  private compactThreshold = 0.80;

  async ingest(params: { sessionId: string; message: ChatMessage }): Promise<IngestResult> {
    return this.vectorEngine.ingest(params);
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
    const budget = params.tokenBudget ?? 100_000;
    const result = await this.vectorEngine.assemble(params);
    
    const usagePercent = result.estimatedTokens / budget;
    
    if (usagePercent >= this.compactThreshold) {
      console.log(`[HybridContext] Context usage at ${Math.round(usagePercent * 100)}% — executing proactive compaction pass.`);
      return this.vectorEngine.assemble({
        ...params,
        options: {
          ...params.options,
          targetBudgetRatio: 0.70,
        },
      });
    }
    
    return result;
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
    return this.vectorEngine.compact(params);
  }

  async dispose(): Promise<void> {
    await this.vectorEngine.dispose();
  }
}

export async function getContextEngineStats(): Promise<{
  messageCount: number;
  storageBytes: number;
  dimensions: number | null;
  engineType: string;
}> {
  const stats = await getVectorStats();
  return {
    messageCount: stats.messageCount,
    storageBytes: stats.storageSize,
    dimensions: stats.dimensionCount,
    engineType: 'vector',
  };
}
