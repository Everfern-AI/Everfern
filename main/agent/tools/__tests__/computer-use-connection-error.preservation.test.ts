/**
 * Preservation Property Tests — Computer Use Connection Error Handling
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4**
 *
 * Property 2: Preservation — Transient Recovery, Tool Error Independence, Abort Path
 *
 * All tests PASS on both unfixed and fixed code — they verify baseline behavior
 * that must not regress.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';

vi.mock('electron', () => ({
  screen: {
    getAllDisplays: vi.fn(() => [{ bounds: { x: 0, y: 0, width: 1920, height: 1080 } }]),
    getPrimaryDisplay: vi.fn(() => ({ bounds: { x: 0, y: 0, width: 1920, height: 1080 } })),
  },
}));

vi.mock('@jitsi/robotjs', () => ({
  moveMouse: vi.fn(),
  mouseClick: vi.fn(),
  typeString: vi.fn(),
  keyTap: vi.fn(),
  setMouseDelay: vi.fn(),
  getMousePos: vi.fn(() => ({ x: 0, y: 0 })),
}));

vi.mock('screenshot-desktop', () => {
  const fn: any = vi.fn().mockResolvedValue(Buffer.from('fake-screenshot'));
  fn.listDisplays = vi.fn().mockResolvedValue([{ id: 0, name: 'Display 1' }]);
  return { default: fn };
});

vi.mock('sharp', () => {
  const sharpMock: any = vi.fn().mockReturnValue({
    resize: vi.fn().mockReturnThis(),
    jpeg: vi.fn().mockReturnThis(),
    extract: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from('fake-image')),
  });
  return { default: sharpMock };
});

vi.mock('worker_threads', () => {
  const WorkerMock = vi.fn().mockImplementation((_scriptPath: string, _options: any) => {
    const workerInstance = {
      on: vi.fn((event: string, handler: Function) => {
        if (event === 'message') {
          setImmediate(() => handler({
            success: true,
            data: { encoded: 'ZmFrZS1zY3JlZW5zaG90', width: 1920, height: 1080, newW: 1280, newH: 720 },
          }));
        }
        return workerInstance;
      }),
      terminate: vi.fn(),
    };
    return workerInstance;
  });
  return { Worker: WorkerMock, workerData: {}, parentPort: { postMessage: vi.fn() }, isMainThread: true };
});

import { createComputerUseTool } from '../computer-use';
import type { AIClient } from '../../../lib/ai-client';

// ── Helpers ───────────────────────────────────────────────────────────────────

const TERMINATE_RESPONSE = {
  content: '',
  toolCalls: [{ id: 'tc-terminate', name: 'computer_use', arguments: JSON.stringify({ action: 'terminate', status: 'success' }) }],
};

const TOOL_ERROR_RESPONSE = {
  content: '',
  toolCalls: [{ id: 'tc-tool-err', name: 'computer_use', arguments: JSON.stringify({ action: 'unsupported_action_xyz' }) }],
};

/** Build a client that follows a step-indexed call plan: 'connErr' | 'success'. */
function buildMockClient(callPlan: Array<'success' | 'connErr'>): AIClient {
  let i = 0;
  return {
    provider: 'ollama',
    chat: vi.fn(async () => {
      const plan = callPlan[i++] ?? 'success';
      if (plan === 'connErr') throw new Error('connect ECONNREFUSED 127.0.0.1:11434');
      return TERMINATE_RESPONSE;
    }),
  } as unknown as AIClient;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Preservation — Computer Use Connection Error Handling', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  // ── 1. Transient Error Recovery ───────────────────────────────────────────

  describe('Transient error recovery (< 3 consecutive connection errors)', () => {
    it('1 connection error then success → agent continues, no VLM-unreachable message', async () => {
      const tool = createComputerUseTool(buildMockClient(['connErr', 'success']));
      const result = await tool.execute({ task: 'Test task' });
      expect(result.output).not.toContain('Unable to reach VLM provider');
    }, 15000);

    it('2 consecutive connection errors then success → agent continues, no VLM-unreachable message', async () => {
      const tool = createComputerUseTool(buildMockClient(['connErr', 'connErr', 'success']));
      const result = await tool.execute({ task: 'Test task' });
      expect(result.output).not.toContain('Unable to reach VLM provider');
    }, 15000);

    /** Property: 0–2 leading connection errors followed by success → no early VLM exit. Validates: 3.1, 3.2 */
    it('property: < 3 consecutive connection errors then success → no VLM-unreachable message', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 0, max: 2 }),
          async (numErrors) => {
            const plan: Array<'success' | 'connErr'> = [...Array(numErrors).fill('connErr'), 'success'];
            const tool = createComputerUseTool(buildMockClient(plan));
            const result = await tool.execute({ task: 'Preservation test' });
            expect(result.output).not.toContain('Unable to reach VLM provider');
          }
        ),
        { numRuns: 5 }
      );
    }, 30000);
  });

  // ── 2. Tool Error Independence ────────────────────────────────────────────

  describe('Tool error independence (tool errors do not affect errorCount)', () => {
    it('chat succeeds but tool throws → agent continues, no VLM-unreachable message', async () => {
      let call = 0;
      const mockClient = {
        provider: 'ollama',
        chat: vi.fn(async () => (++call === 1 ? TOOL_ERROR_RESPONSE : TERMINATE_RESPONSE)),
      } as unknown as AIClient;

      const tool = createComputerUseTool(mockClient);
      const result = await tool.execute({ task: 'Tool error test' });
      expect(result.output).not.toContain('Unable to reach VLM provider');
    }, 15000);

    /** Property: N tool errors then terminate → no VLM-unreachable message. Validates: 3.3 */
    it('property: only tool errors (no chat errors) → no VLM-unreachable message', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 3 }),
          async (numToolErrors) => {
            let call = 0;
            const mockClient = {
              provider: 'ollama',
              chat: vi.fn(async () => (++call <= numToolErrors ? TOOL_ERROR_RESPONSE : TERMINATE_RESPONSE)),
            } as unknown as AIClient;

            const tool = createComputerUseTool(mockClient);
            const result = await tool.execute({ task: 'Tool error property test' });
            expect(result.output).not.toContain('Unable to reach VLM provider');
          }
        ),
        { numRuns: 5 }
      );
    }, 30000);
  });

  // ── 3. Abort Path Unchanged ───────────────────────────────────────────────

  describe('Abort path unchanged (abort signal is independent of errorCount)', () => {
    it('abort() called externally → agent terminates via abort path, no VLM-unreachable message', async () => {
      let chatCallCount = 0;
      const mockClient = {
        provider: 'ollama',
        chat: vi.fn(async () => {
          chatCallCount++;
          await new Promise(r => setTimeout(r, 10));
          return { content: 'Thinking...', toolCalls: [] };
        }),
      } as unknown as AIClient;

      const tool = createComputerUseTool(mockClient);
      const abortTimer = setTimeout(() => tool.abort(), 50);
      const result = await tool.execute({ task: 'Abort test' });
      clearTimeout(abortTimer);

      expect(result.output).not.toContain('Unable to reach VLM provider');
      expect(chatCallCount).toBeLessThan(40);
    }, 15000);

    /** Property: abort fires after 0–2 steps → no VLM-unreachable message. Validates: 3.4 */
    it('property: abort signal terminates agent regardless of errorCount state', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 20, max: 80 }),
          async (abortDelayMs) => {
            let chatCallCount = 0;
            const mockClient = {
              provider: 'ollama',
              chat: vi.fn(async () => {
                chatCallCount++;
                await new Promise(r => setTimeout(r, 5));
                return { content: 'Thinking...', toolCalls: [] };
              }),
            } as unknown as AIClient;

            const tool = createComputerUseTool(mockClient);
            const abortTimer = setTimeout(() => tool.abort(), abortDelayMs);
            const result = await tool.execute({ task: 'Abort property test' });
            clearTimeout(abortTimer);

            expect(result.output).not.toContain('Unable to reach VLM provider');
            expect(chatCallCount).toBeLessThan(40);
          }
        ),
        { numRuns: 5 }
      );
    }, 30000);
  });
});
