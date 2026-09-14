import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { createTriageNode } from '../agent/runner/nodes/triage';
import { classifyIntentLocal } from '../agent/runner/triage';
import type { GraphStateType, IntentType } from '../agent/runner/state';

function makeState(content: string, extra: Partial<GraphStateType> = {}): GraphStateType {
  return {
    messages: [{ role: 'user', content }],
    ...extra,
  } as unknown as GraphStateType;
}

function makeRunner(opts: {
  isLocal: boolean;
  chatImpl?: (...args: any[]) => Promise<any>;
  withClient?: boolean;
}) {
  const chatCalls: any[] = [];
  const client = opts.withClient === false
    ? undefined
    : {
        isLocal: () => opts.isLocal,
        chat: async (...args: any[]) => {
          chatCalls.push(args);
          if (opts.chatImpl) return opts.chatImpl(...args);
          return { content: JSON.stringify({ intent: 'research', confidence: 0.9, reasoning: 'ai said so' }) };
        },
      };
  const runner: any = {
    client,
    workspaceDir: undefined,
    telemetry: {
      transition: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    },
  };
  return { runner, chatCalls };
}

describe('LP-01-lite triage local fast-path', () => {
  let debugSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
  });
  afterEach(() => {
    debugSpy.mockRestore();
  });

  describe('local mode (isLocal() === true)', () => {
    it('makes zero chat() calls and classifies via keywords', async () => {
      const { runner, chatCalls } = makeRunner({ isLocal: true });
      const node = createTriageNode(runner);

      const result = await node(makeState('Fix the login bug that crashes on submit'));
      expect(chatCalls).toHaveLength(0);
      expect(result.currentIntent).toBe('fix');
      expect(result.taskPhase).toBe('routing');
    });

    it.each<[string, IntentType]>([
      ['write a python script to scrape files', 'coding'],
      ['fix the login bug that crashes on submit', 'fix'],
      ['scaffold a new react project for me', 'build'],
      ['analyze this csv and generate a report with charts', 'analyze'],
      ['research the history of the roman empire', 'research'],
      ['open https://example.com and summarize it', 'research'],
      ['click the start button in the desktop app', 'automate'],
      ['check the build status in the background every 5 minutes', 'background_task'],
      ['what is the capital of france', 'question'],
      ['hello there!', 'conversation'],
      ['organize my downloads folder', 'task'],
    ])('maps "%s" → %s', async (input, expected) => {
      const { runner } = makeRunner({ isLocal: true });
      const node = createTriageNode(runner);
      const result = await node(makeState(input));
      expect(result.currentIntent).toBe(expected);
    });

    it('routes "browser extension" work to coding, not research (neg-lookahead)', async () => {
      const { runner } = makeRunner({ isLocal: true });
      const node = createTriageNode(runner);
      const result = await node(makeState('fix the browser extension popup code'));
      expect(result.currentIntent).toBe('fix');
    });

    it('falls back to task when no keyword rule matches', async () => {
      const { runner } = makeRunner({ isLocal: true });
      const node = createTriageNode(runner);
      const result = await node(makeState('flurble wompity zorp'));
      expect(result.currentIntent).toBe('task');
    });

    it('logs "[Triage] local fast-path" once per runner via WeakSet', async () => {
      const { runner } = makeRunner({ isLocal: true });
      const node = createTriageNode(runner);
      await node(makeState('hello'));
      await node(makeState('write some code'));
      await node(makeState('analyze data'));
      const fastPathLogs = debugSpy.mock.calls.filter(c => String(c[0]).includes('[Triage] local fast-path'));
      expect(fastPathLogs).toHaveLength(1);
      const triageModeLogs = debugSpy.mock.calls.filter(c => String(c[0]).includes('triageMode=fast'));
      expect(triageModeLogs.length).toBe(3);
    });
  });

  describe('cloud mode (isLocal() === false)', () => {
    it('uses the AI classifier: AI intent wins, chat() called once, triageMode=ai', async () => {
      const { runner, chatCalls } = makeRunner({ isLocal: false });
      const node = createTriageNode(runner);
      const result = await node(makeState('fix the login bug'));
      expect(chatCalls).toHaveLength(1);
      expect(result.currentIntent).toBe('research'); // from the mock AI response
      const aiLogs = debugSpy.mock.calls.filter(c => String(c[0]).includes('triageMode=ai'));
      expect(aiLogs.length).toBe(1);
      const fastLogs = debugSpy.mock.calls.filter(c => String(c[0]).includes('[Triage] local fast-path'));
      expect(fastLogs).toHaveLength(0);
    });
  });

  describe('no client', () => {
    it('falls back to task without throwing', async () => {
      const { runner, chatCalls } = makeRunner({ isLocal: false, withClient: false });
      const node = createTriageNode(runner);
      const result = await node(makeState('flurble zorp'));
      expect(chatCalls).toHaveLength(0);
      expect(result.currentIntent).toBe('task');
    });
  });

  describe('classifyIntentLocal normalization table', () => {
    it('maps keywords to real IntentType enum values', () => {
      const table: Array<[string, IntentType | null]> = [
        ['please debug the failing unit test', 'fix'],
        ['write a new function in typescript', 'coding'],
        ['scaffold a new repo', 'build'],
        ['analyze the sales dataset', 'analyze'],
        ['search the web for flights to tokyo', 'research'],
        ['browse to https://news.ycombinator.com', 'research'],
        ['click the save button in the native app', 'automate'],
        ['run the linter in the background every 5 minutes', 'background_task'],
        ['why does the sun shine', 'question'],
        ['hey, how are you?', 'conversation'],
        ['qwerpy blorp fnord', 'task'],
      ];
      for (const [input, expected] of table) {
        expect(classifyIntentLocal(input).intent).toBe(expected);
      }
    });
  });
});
