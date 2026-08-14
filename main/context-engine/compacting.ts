/**
 * EverFern Desktop — Compacting Context Engine
 *
 * Production-grade context management engine with:
 *   - Multi-pass context compaction & observation distillation
 *   - DAG execution graph & node lineage preservation
 *   - Dynamic Workspace State Projection (DWSP) protection
 *   - Tool result distillation & reasoning block stripping
 *   - Hierarchical semantic turn summarization
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

// ── Token Estimation Utilities ─────────────────────────────────────────

export function estimateMessageTokens(messages: ChatMessage[]): number {
  let total = 0;
  for (const msg of messages) {
    total += 4; // Per-message overhead (role, formatting tokens)
    
    if (typeof msg.content === 'string') {
      total += Math.ceil(msg.content.length / 4);
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block && typeof block === 'object') {
          if ('text' in block && typeof (block as any).text === 'string') {
            total += Math.ceil((block as any).text.length / 4);
          } else if ('image_url' in block) {
            // Rough estimation for images in multi-modal contexts
            total += 85;
          }
        }
      }
    }

    // Include tool calls token overhead
    if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls as any[]) {
        const nameStr = tc.name || tc.function?.name || '';
        const rawArgs = tc.arguments || tc.args || tc.function?.arguments || {};
        const argsStr = typeof rawArgs === 'string' ? rawArgs : JSON.stringify(rawArgs);
        total += Math.ceil((nameStr.length + argsStr.length) / 4) + 6;
      }
    }
  }
  return total;
}

// ── Observation & Distillation Helpers ───────────────────────────────

/**
 * Distills large tool execution outputs (file reads, shell outputs, git diffs)
 * into high-density structured summaries.
 */
export function distillToolOutput(
  content: string,
  maxChars = 800,
  preserveErrors = true,
): string {
  if (content.length <= maxChars) return content;

  const originalLen = content.length;
  
  // Check if output contains error tracebacks or failures
  const containsErrors = preserveErrors && (
    /error|fail|exception|fatal|traceback|cannot find/i.test(content)
  );

  const headChars = Math.floor(maxChars * 0.45);
  const tailChars = Math.floor(maxChars * 0.45);

  const head = content.substring(0, headChars);
  const tail = content.substring(originalLen - tailChars);

  let errorSnippet = '';
  if (containsErrors) {
    const errorMatch = content.match(/(?:error|fail|exception|fatal|traceback)[^\n]*/gi);
    if (errorMatch && errorMatch.length > 0) {
      errorSnippet = `\n  [Extracted Error Context: ${errorMatch.slice(0, 3).join('; ')}]`;
    }
  }

  return (
    `${head}\n\n` +
    `... [Tool Output Distilled: ${originalLen - headChars - tailChars} chars compressed to save tokens${errorSnippet}] ...\n\n` +
    `${tail}`
  );
}

/**
 * Strips historical reasoning tags (<think>...</think> or <thought>...</thought>)
 * from assistant messages to recover token capacity.
 */
export function stripThinkingBlocks(content: string): string {
  return content
    .replace(/<(think|thought)>[\s\S]*?<\/\1>/gi, '')
    .replace(/\[thought\][\s\S]*?\[\/thought\]/gi, '')
    .trim();
}

/**
 * Summarize older conversation history into a structured checkpoint block.
 */
export function summarizeTurnHistory(messages: ChatMessage[]): string {
  const fileActions: string[] = [];
  const commandActions: string[] = [];
  const userQueries: string[] = [];
  const assistantSummary: string[] = [];

  for (const m of messages) {
    if (m.role === 'user' && typeof m.content === 'string') {
      if (m.content.length > 0 && !m.content.startsWith('[')) {
        userQueries.push(m.content.substring(0, 150));
      }
    } else if (m.role === 'assistant') {
      if (m.tool_calls && Array.isArray(m.tool_calls)) {
        for (const tc of m.tool_calls as any[]) {
          const fnName = tc.name || tc.function?.name || 'tool';
          const rawArgs = tc.arguments || tc.args || tc.function?.arguments;
          let argsObj: any = {};
          if (typeof rawArgs === 'string') {
            try { argsObj = JSON.parse(rawArgs); } catch { argsObj = { raw: rawArgs }; }
          } else if (rawArgs && typeof rawArgs === 'object') {
            argsObj = rawArgs;
          }

          if (['write_to_file', 'replace_file_content', 'multi_replace_file_content'].includes(fnName)) {
            const targetFile = argsObj.TargetFile || argsObj.targetFile || argsObj.path || 'file';
            fileActions.push(`Modified ${targetFile.split(/[/\\]/).pop()}`);
          } else if (['run_command', 'execute_command'].includes(fnName)) {
            const cmd = argsObj.CommandLine || argsObj.command || argsObj.cmd || '';
            if (cmd) commandActions.push(`Executed: ${cmd.substring(0, 60)}`);
          }
        }
      } else if (typeof m.content === 'string' && m.content.trim()) {
        const clean = stripThinkingBlocks(m.content);
        if (clean) assistantSummary.push(clean.substring(0, 180));
      }
    }
  }

  const sections: string[] = [];
  if (userQueries.length > 0) {
    sections.push(`- User Objectives: ${userQueries.slice(-3).join(' | ')}`);
  }
  if (fileActions.length > 0) {
    const uniqueFiles = Array.from(new Set(fileActions));
    sections.push(`- Files Touched: ${uniqueFiles.slice(-5).join(', ')}`);
  }
  if (commandActions.length > 0) {
    sections.push(`- Commands Run: ${commandActions.slice(-4).join('; ')}`);
  }
  if (assistantSummary.length > 0) {
    sections.push(`- Assistant Progress: ${assistantSummary.slice(-2).join(' ')}`);
  }

  return sections.join('\n');
}

/**
 * Format active DAG node states into a clean markdown summary block.
 */
export function formatDAGNodeSummary(nodes?: DAGNodeState[]): string {
  if (!nodes || nodes.length === 0) return '';

  const lines = ['### DAG Execution Graph Lineage State'];
  for (const n of nodes) {
    const statusIcon =
      n.status === 'completed' ? '✅' :
      n.status === 'running' ? '⏳' :
      n.status === 'failed' ? '❌' :
      n.status === 'skipped' ? '⏭️' : '⏹️';
    
    const summarySuffix = n.summary ? `: ${n.summary}` : '';
    lines.push(`- ${statusIcon} **Node [${n.nodeId}] (${n.nodeName})** - ${n.status.toUpperCase()}${summarySuffix}`);
  }
  return lines.join('\n');
}

// ── CompactingContextEngine Implementation ───────────────────────────

export class CompactingContextEngine implements ContextEngine {
  readonly info: ContextEngineInfo = {
    id: 'compacting',
    name: 'EverFern Smart Compacting Context Engine',
    version: '2.0.0',
    ownsCompaction: true,
  };

  private sessionTurnStores = new Map<string, ChatMessage[]>();

  async ingest(params: {
    sessionId: string;
    message: ChatMessage;
  }): Promise<IngestResult> {
    const { sessionId, message } = params;
    const history = this.sessionTurnStores.get(sessionId) || [];
    history.push(message);
    this.sessionTurnStores.set(sessionId, history);

    const tokens = estimateMessageTokens([message]);
    const totalTokens = estimateMessageTokens(history);

    return {
      ingested: true,
      tokensIngested: tokens,
      totalTokens,
    };
  }

  /**
   * Multi-stage context assembly & compaction.
   */
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
    const inputMsgs = params.messages;
    const options = params.options || {};
    const preserveRecentTurns = options.preserveRecentTurnCount ?? 6;
    const targetRatio = options.targetBudgetRatio ?? 0.75;
    const effectiveBudget = Math.floor(budget * targetRatio);

    if (inputMsgs.length === 0) {
      return { messages: [], estimatedTokens: 0 };
    }

    // Separate system messages from conversation messages
    const systemMsgs = inputMsgs.filter((m) => m.role === 'system');
    const conversationMsgs = inputMsgs.filter((m) => m.role !== 'system');

    // Build DAG summary injection if DAG nodes are present
    const dagSummary = formatDAGNodeSummary(params.dagNodes);
    let systemPromptAddition: string | undefined = undefined;

    if (dagSummary) {
      systemPromptAddition = `\n\n${dagSummary}\n`;
    }

    const currentTotalTokens = estimateMessageTokens(inputMsgs);

    // If well within budget, apply light observation distillation only
    if (currentTotalTokens <= effectiveBudget) {
      const lightlyDistilled = this.applyObservationDistillation(
        conversationMsgs,
        preserveRecentTurns,
        options,
      );

      const assembled = [...systemMsgs, ...lightlyDistilled];
      const estTokens = estimateMessageTokens(assembled);

      return {
        messages: assembled,
        estimatedTokens: estTokens,
        systemPromptAddition,
        dagContextSummary: dagSummary || undefined,
        compactionInfo: { wasCompacted: false },
      };
    }

    // Budget exceeded — run multi-pass compaction
    const compactRes = await this.compact({
      sessionId: params.sessionId,
      messages: inputMsgs,
      tokenBudget: budget,
      options,
      dagNodes: params.dagNodes,
    });

    const finalMsgs = compactRes.result?.summary
      ? this.injectSummaryIntoMessages(systemMsgs, conversationMsgs, compactRes.result.summary, preserveRecentTurns)
      : compactRes.messages || inputMsgs;

    const estTokens = estimateMessageTokens(finalMsgs);

    return {
      messages: finalMsgs,
      estimatedTokens: estTokens,
      systemPromptAddition,
      dagContextSummary: dagSummary || undefined,
      compactionInfo: {
        wasCompacted: true,
        freedTokens: compactRes.freedTokens || 0,
      },
    };
  }

  /**
   * Execute multi-pass compaction to compress history while preserving context integrity.
   */
  async compact(params: {
    sessionId: string;
    messages?: ChatMessage[];
    tokenBudget?: number;
    force?: boolean;
    currentTokenCount?: number;
    options?: CompactionOptions;
    dagNodes?: DAGNodeState[];
  }): Promise<CompactResult & { messages?: ChatMessage[] }> {
    const msgs = params.messages || this.sessionTurnStores.get(params.sessionId) || [];
    if (msgs.length === 0) {
      return { ok: true, compacted: false, reason: 'No messages to compact' };
    }

    const initialTokens = estimateMessageTokens(msgs);
    const budget = params.tokenBudget ?? 100_000;
    const preserveRecent = params.options?.preserveRecentTurnCount ?? 6;

    const systemMsgs = msgs.filter((m) => m.role === 'system');
    const convMsgs = msgs.filter((m) => m.role !== 'system');

    // ── Stage 1: Thinking block stripping & observation distillation ──
    const stage1Conv = convMsgs.map((msg, idx) => {
      const isRecent = idx >= convMsgs.length - preserveRecent;
      let newMsg = { ...msg };

      // Strip historical thoughts
      if (!isRecent && newMsg.role === 'assistant' && typeof newMsg.content === 'string') {
        newMsg.content = stripThinkingBlocks(newMsg.content);
      }

      // Distill older tool outputs
      if (!isRecent && newMsg.role === 'tool' && typeof newMsg.content === 'string') {
        newMsg.content = distillToolOutput(
          newMsg.content,
          params.options?.distillation?.maxToolOutputChars ?? 600,
          params.options?.distillation?.preserveErrors ?? true,
        );
      }

      // Truncate tool arguments in older assistant messages
      if (!isRecent && newMsg.role === 'assistant' && Array.isArray(newMsg.tool_calls)) {
        newMsg.tool_calls = (newMsg.tool_calls as any[]).map((tc: any) => {
          if (!tc || typeof tc !== 'object') return tc;
          const cloned = JSON.parse(JSON.stringify(tc));
          if (cloned.arguments) {
            const strArgs = typeof cloned.arguments === 'string' ? cloned.arguments : JSON.stringify(cloned.arguments);
            if (strArgs.length > 500) {
              cloned.arguments = `${strArgs.substring(0, 250)}... [Arguments Truncated]`;
            }
          } else if (cloned.function?.arguments) {
            const strArgs = typeof cloned.function.arguments === 'string' ? cloned.function.arguments : JSON.stringify(cloned.function.arguments);
            if (strArgs.length > 500) {
              cloned.function.arguments = `${strArgs.substring(0, 250)}... [Arguments Truncated]`;
            }
          }
          return cloned;
        });
      }

      return newMsg;
    });

    let currentAssembled = [...systemMsgs, ...stage1Conv];
    let currentTokens = estimateMessageTokens(currentAssembled);

    // ── Stage 2: Turn Summarization if still over budget ──
    let summaryText = '';
    if (currentTokens > budget * (params.options?.targetBudgetRatio ?? 0.75) && convMsgs.length > preserveRecent + 2) {
      const droppedPart = convMsgs.slice(0, convMsgs.length - preserveRecent);
      summaryText = summarizeTurnHistory(droppedPart);

      currentAssembled = this.injectSummaryIntoMessages(
        systemMsgs,
        convMsgs,
        summaryText,
        preserveRecent,
      );
      currentTokens = estimateMessageTokens(currentAssembled);
    }

    const freedTokens = Math.max(0, initialTokens - currentTokens);

    console.log(
      `[CompactingContextEngine] Compacted session ${params.sessionId}: ${initialTokens} → ${currentTokens} tokens ` +
      `(Freed ~${freedTokens} tokens)`,
    );

    return {
      ok: true,
      compacted: freedTokens > 0,
      freedTokens,
      reason: summaryText ? 'Multi-pass compaction & turn summarization completed' : 'Distillation completed',
      result: {
        summary: summaryText || undefined,
        tokensBefore: initialTokens,
        tokensAfter: currentTokens,
      },
      messages: currentAssembled,
    };
  }

  private applyObservationDistillation(
    convMsgs: ChatMessage[],
    preserveRecent: number,
    options?: CompactionOptions,
  ): ChatMessage[] {
    return convMsgs.map((msg, idx) => {
      const isRecent = idx >= convMsgs.length - preserveRecent;
      if (isRecent) return msg;

      let newMsg = { ...msg };
      if (newMsg.role === 'tool' && typeof newMsg.content === 'string') {
        newMsg.content = distillToolOutput(
          newMsg.content,
          options?.distillation?.maxToolOutputChars ?? 800,
          options?.distillation?.preserveErrors ?? true,
        );
      }
      if (newMsg.role === 'assistant' && typeof newMsg.content === 'string') {
        newMsg.content = stripThinkingBlocks(newMsg.content);
      }
      return newMsg;
    });
  }

  private injectSummaryIntoMessages(
    systemMsgs: ChatMessage[],
    convMsgs: ChatMessage[],
    summaryText: string,
    preserveRecent: number,
  ): ChatMessage[] {
    const recentMsgs = convMsgs.slice(-preserveRecent);
    const summaryMsg: ChatMessage = {
      role: 'system',
      content:
        `## CONTEXT COMPACTION SUMMARY (Compressed Historical Turns)\n` +
        `The following is a structured summary of execution turns prior to recent messages:\n\n` +
        `${summaryText}\n`,
    };

    return [...systemMsgs, summaryMsg, ...recentMsgs];
  }

  async dispose(): Promise<void> {
    this.sessionTurnStores.clear();
  }
}
