import { describe, it, expect, beforeEach } from 'vitest';
import {
  resolveContextEngine,
  registerContextEngine,
  listContextEngineIds,
  DefaultContextEngine,
  CompactingContextEngine,
  distillToolOutput,
  stripThinkingBlocks,
  summarizeTurnHistory,
  formatDAGNodeSummary,
  estimateMessageTokens,
  type ChatMessage,
  type DAGNodeState,
} from '../index';

describe('Context Engine Subsystem', () => {
  describe('Helper Utilities', () => {
    it('should accurately estimate message tokens', () => {
      const messages: ChatMessage[] = [
        { role: 'system', content: 'You are EverFern.' },
        { role: 'user', content: 'Hello, world! Please write some code.' },
      ];
      const tokens = estimateMessageTokens(messages);
      expect(tokens).toBeGreaterThan(10);
    });

    it('should distill large tool outputs while preserving error tracebacks', () => {
      const giantOutput = 'A'.repeat(500) + '\nFatal Exception: File not found in /src/app.ts\n' + 'B'.repeat(500);
      const distilled = distillToolOutput(giantOutput, 400, true);

      expect(distilled.length).toBeLessThan(giantOutput.length);
      expect(distilled).toContain('Tool Output Distilled');
      expect(distilled).toContain('Fatal Exception: File not found');
    });

    it('should strip thinking blocks from assistant messages', () => {
      const thinkingContent = '<think>Let me reason about this problem...\n1. Check file\n2. Edit line 10</think>Here is the final answer.';
      const stripped = stripThinkingBlocks(thinkingContent);
      expect(stripped).toBe('Here is the final answer.');
    });

    it('should format DAG node lineage summaries cleanly', () => {
      const dagNodes: DAGNodeState[] = [
        { nodeId: '1', nodeName: 'Parse Workspace', status: 'completed', summary: 'Parsed 12 files' },
        { nodeId: '2', nodeName: 'Refactor Code', status: 'running' },
        { nodeId: '3', nodeName: 'Run Tests', status: 'pending' },
      ];

      const summary = formatDAGNodeSummary(dagNodes);
      expect(summary).toContain('DAG Execution Graph Lineage State');
      expect(summary).toContain('Node [1] (Parse Workspace)');
      expect(summary).toContain('COMPLETED');
      expect(summary).toContain('RUNNING');
    });

    it('should summarize older turn history into memory checkpoints', () => {
      const history: ChatMessage[] = [
        { role: 'user', content: 'Fix the bug in auth.ts' },
        {
          role: 'assistant',
          content: 'I will modify auth.ts',
          tool_calls: [
            {
              id: 'tc1',
              type: 'function',
              function: {
                name: 'replace_file_content',
                arguments: JSON.stringify({ TargetFile: '/src/auth.ts' }),
              },
            },
          ],
        },
        { role: 'tool', content: 'File replacement succeeded' },
      ];

      const summary = summarizeTurnHistory(history);
      expect(summary).toContain('User Objectives');
      expect(summary).toContain('Files Touched: Modified auth.ts');
    });
  });

  describe('Registry & Resolution', () => {
    it('should list all registered default context engine IDs', () => {
      const ids = listContextEngineIds();
      expect(ids).toContain('default');
      expect(ids).toContain('compacting');
      expect(ids).toContain('vector');
      expect(ids).toContain('hybrid');
    });

    it('should resolve default and compacting context engines', () => {
      const defaultEngine = resolveContextEngine('default');
      expect(defaultEngine.info.id).toBe('default');

      const compactingEngine = resolveContextEngine('compacting');
      expect(compactingEngine.info.id).toBe('compacting');
    });
  });

  describe('CompactingContextEngine', () => {
    let engine: CompactingContextEngine;

    beforeEach(() => {
      engine = new CompactingContextEngine();
    });

    it('should assemble context without compaction when well under budget', async () => {
      const messages: ChatMessage[] = [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'Small query' },
      ];

      const result = await engine.assemble({
        sessionId: 'test-1',
        messages,
        tokenBudget: 50_000,
      });

      expect(result.messages.length).toBe(2);
      expect(result.compactionInfo?.wasCompacted).toBe(false);
    });

    it('should trigger compaction when message tokens exceed target budget ratio', async () => {
      const messages: ChatMessage[] = [
        { role: 'system', content: 'System prompt' },
      ];

      for (let i = 0; i < 20; i++) {
        messages.push({ role: 'user', content: `Turn ${i}: ${'X'.repeat(400)}` });
        messages.push({
          role: 'assistant',
          content: `<think>Reasoning step ${i}</think>Response ${i}`,
          tool_calls: [
            {
              id: `tc_${i}`,
              type: 'function',
              function: {
                name: 'run_command',
                arguments: JSON.stringify({ CommandLine: `npm test --flag=${'Y'.repeat(300)}` }),
              },
            },
          ],
        });
        messages.push({ role: 'tool', content: `Output for step ${i}: ${'Z'.repeat(1200)}` });
      }

      const compactRes = await engine.compact({
        sessionId: 'test-compact',
        messages,
        tokenBudget: 2_000, // Small budget to force compaction
        options: { preserveRecentTurnCount: 4 },
      });

      expect(compactRes.ok).toBe(true);
      expect(compactRes.compacted).toBe(true);
      expect(compactRes.freedTokens).toBeGreaterThan(0);
      expect(compactRes.messages).toBeDefined();

      const assembledContent = JSON.stringify(compactRes.messages);
      expect(assembledContent).toContain('CONTEXT COMPACTION SUMMARY');
    });
  });

  describe('DefaultContextEngine Upgrade', () => {
    it('should perform active compaction in DefaultContextEngine', async () => {
      const defaultEngine = new DefaultContextEngine();

      const messages: ChatMessage[] = [
        { role: 'system', content: 'System message' },
      ];
      for (let i = 0; i < 15; i++) {
        messages.push({ role: 'user', content: `Question ${i}` });
        messages.push({ role: 'assistant', content: `Answer ${i}` });
        messages.push({ role: 'tool', content: `Tool result ${i}: ${'Large log content '.repeat(50)}` });
      }

      const result = await defaultEngine.compact({
        sessionId: 'default-compact-test',
        messages,
        tokenBudget: 1_500,
      });

      expect(result.ok).toBe(true);
      expect(result.compacted).toBe(true);
      expect(result.freedTokens).toBeGreaterThan(0);
    });
  });
});
