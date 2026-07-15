import { describe, it, expect } from 'vitest';
import { consolidateHistory } from '../services/message-utils';
import { ChatMessage } from '../../../lib/ai-client';

describe('Cognitive History Consolidation (CHC)', () => {
  describe('Tool Output Truncation', () => {
    it('should truncate successful terminal outputs longer than 2000 characters', () => {
      const longSuccessContent = 'build successful\n' + 'a'.repeat(2500) + '\nexit code: 0';
      const messages: ChatMessage[] = [
        {
          role: 'tool',
          name: 'run_command',
          content: longSuccessContent
        }
      ];

      const consolidated = consolidateHistory(messages);
      expect(consolidated).toHaveLength(1);
      
      const content = consolidated[0].content as string;
      expect(content).toContain('[Truncated');
      expect(content).toContain('build successful');
      expect(content).toContain('exit code: 0');
      expect(content.length).toBeLessThan(longSuccessContent.length);
    });

    it('should not truncate terminal outputs shorter than 2000 characters', () => {
      const shortContent = 'build successful\nexit code: 0';
      const messages: ChatMessage[] = [
        {
          role: 'tool',
          name: 'run_command',
          content: shortContent
        }
      ];

      const consolidated = consolidateHistory(messages);
      expect(consolidated[0].content).toBe(shortContent);
    });

    it('should preserve errors in logs unless they are extremely long (>8000)', () => {
      const errorContent = 'compiler error\n' + 'a'.repeat(3000) + '\nexit code: 1';
      const messages: ChatMessage[] = [
        {
          role: 'tool',
          name: 'run_command',
          content: errorContent
        }
      ];

      const consolidated = consolidateHistory(messages);
      expect(consolidated[0].content).toBe(errorContent); // Kept fully since it's <8000
    });

    it('should truncate extremely long compiler error logs (>8000) to keep context manageable', () => {
      const longErrorContent = 'compiler error\n' + 'a'.repeat(9000) + '\nexit code: 1';
      const messages: ChatMessage[] = [
        {
          role: 'tool',
          name: 'run_command',
          content: longErrorContent
        }
      ];

      const consolidated = consolidateHistory(messages);
      expect(consolidated[0].content).toContain('[Truncated');
      expect(consolidated[0].content).toContain('compiler error');
      expect(consolidated[0].content).toContain('exit code: 1');
    });
  });

  describe('Failed Tool Call Retry Pruning', () => {
    it('should collapse consecutive failed tool attempts when a later one succeeds', () => {
      const messages: ChatMessage[] = [
        // Attempt 1: Failed
        {
          role: 'assistant',
          content: 'Compiling...',
          tool_calls: [{ id: 'call_1', name: 'run_command', arguments: { CommandLine: 'npm run build' } }]
        },
        {
          role: 'tool',
          name: 'run_command',
          tool_call_id: 'call_1',
          content: 'npm ERR! build failed\nexit code: 1'
        },
        // Attempt 2: Failed
        {
          role: 'assistant',
          content: 'Trying another build...',
          tool_calls: [{ id: 'call_2', name: 'run_command', arguments: { CommandLine: 'npm run build' } }]
        },
        {
          role: 'tool',
          name: 'run_command',
          tool_call_id: 'call_2',
          content: 'npm ERR! missing dependency\nexit code: 1'
        },
        // Attempt 3: Succeeded!
        {
          role: 'assistant',
          content: 'Running successful build...',
          tool_calls: [{ id: 'call_3', name: 'run_command', arguments: { CommandLine: 'npm run build' } }]
        },
        {
          role: 'tool',
          name: 'run_command',
          tool_call_id: 'call_3',
          content: 'build successful\nexit code: 0'
        }
      ];

      const consolidated = consolidateHistory(messages);
      
      // Should collapse the first two runs (4 messages) into 1 system message,
      // and preserve the final successful run (2 messages).
      // Total output messages: 1 (system) + 2 (successful assistant/tool) = 3 messages.
      expect(consolidated).toHaveLength(3);
      
      expect(consolidated[0].role).toBe('system');
      expect(consolidated[0].content).toContain('[System Memory Consolidation: 2 intermediate attempts of tool "run_command" failed');
      
      expect(consolidated[1].role).toBe('assistant');
      expect(consolidated[1].tool_calls?.[0].id).toBe('call_3');
      
      expect(consolidated[2].role).toBe('tool');
      expect(consolidated[2].content).toBe('build successful\nexit code: 0');
    });

    it('should not collapse failures if there is no subsequent success for that tool', () => {
      const messages: ChatMessage[] = [
        {
          role: 'assistant',
          content: 'Compiling...',
          tool_calls: [{ id: 'call_1', name: 'run_command', arguments: { CommandLine: 'npm run build' } }]
        },
        {
          role: 'tool',
          name: 'run_command',
          tool_call_id: 'call_1',
          content: 'npm ERR! build failed\nexit code: 1'
        }
      ];

      const consolidated = consolidateHistory(messages);
      expect(consolidated).toHaveLength(2);
      expect(consolidated[0].role).toBe('assistant');
      expect(consolidated[1].role).toBe('tool');
    });
  });
});
