// @vitest-environment node

/**
 * LP-01 (pipeline nodes): isLocal() skip gates in the pre-brain pipeline.
 *
 * Mirrors the landed triage fast-path pattern (nodes/triage.ts:64,
 * triage-fastpath.test.ts): when `(runner.client as any)?.isLocal?.()` is
 * true, each pre-brain node must make ZERO client.chat() calls and emit its
 * existing default/no-op output shape; when false, every node behaves
 * exactly as before (regression guard).
 *
 * - planner: local → { taskPhase: 'executing' }, zero chat calls (skips the
 *   isReadOnlyIntent probe AND plan-text generation).
 * - debate-chamber: local → { debateResult: null } + debate_skipped event,
 *   zero chat calls, even for keyword-gated debate-worthy input.
 * - decomposer: local → single-step DecomposedTask passthrough, zero chat
 *   calls; cloud → decomposeTaskWithAI still drives the client.
 * - call_model slim-check: local → the pre-call shouldUseSlimmedPrompt LLM
 *   round trip is skipped (deterministic keyword semantics); the main model
 *   call is the only chat. Cloud → the slim probe still fires first.
 *
 * The nudge path (shouldNudgeModel, LP-04) is deliberately NOT exercised:
 * mock main responses carry toolCalls so the no-toolCalls/nudge branch never
 * runs — that call belongs to another delegate's scope.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// planner imports task-decomposer for generatePlanText — mock to keep the
// module graph light and to assert the local path never reaches it.
vi.mock('../task-decomposer', () => ({
  generatePlanText: vi.fn(() => 'PLAN TEXT'),
  decomposeTaskWithAI: vi.fn(async () => {
    throw new Error('cloud decomposeTaskWithAI must not run in local tests');
  }),
}));

// planner/decomposer import task-plan-helper dynamically — stub it so no
// filesystem writes happen under the repo.
vi.mock('../task-plan-helper', () => ({
  initializeTaskPlan: vi.fn(async () => {}),
}));

// debate-chamber broadcasts via electron BrowserWindow — same mock as
// debate-chamber.conversation-id.test.ts.
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
}));

vi.mock('../services/node-utils', () => ({
  nodeLifecycle: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { createPlannerNode } from '../planner';
import { createDebateChamberNode } from '../debate-chamber';
import { createDecomposerNode } from '../decomposer';
import { createCallModelNode } from '../call_model';
import { DebateEventEmitter } from '../../debate-event-emitter';

function makeRunner(opts: { isLocal: boolean; chatImpl?: (...args: any[]) => Promise<any> }) {
  const chatCalls: any[] = [];
  const client = {
    isLocal: () => opts.isLocal,
    model: 'test-model',
    provider: 'test',
    chat: async (...args: any[]) => {
      chatCalls.push(args);
      if (opts.chatImpl) return opts.chatImpl(...args);
      return { content: 'ok', toolCalls: [], finishReason: 'stop' };
    },
  };
  const runner: any = {
    client,
    workspaceDir: undefined,
    tools: [],
    telemetry: {
      transition: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
      metrics: () => {},
    },
    shouldCaptureScreenshot: () => false,
    _buildToolDefinitions: () => [],
    config: {},
  };
  return { runner, chatCalls };
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'debug').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('LP-01 planner local fast-path', () => {
  it('local: zero chat calls, returns the no-plan direct-execution shape', async () => {
    const { runner, chatCalls } = makeRunner({ isLocal: true });
    const node = createPlannerNode(runner);
    const state = {
      messages: [{ role: 'user', content: 'build me a react app' }],
      currentIntent: 'coding',
      decomposedTask: {
        id: 't1', title: 'T', steps: [{ id: 's1', title: 'S1', description: 'd', tool: 'write_to_file' }],
        totalSteps: 1, canParallelize: false, executionMode: 'sequential',
      },
      agiHints: '',
    } as any;

    const result = await node(state);
    expect(chatCalls).toHaveLength(0);
    expect(result).toEqual({ taskPhase: 'executing' });
  });

  it('local: skips even the ambiguous-intent isReadOnlyIntent AI probe', async () => {
    const { runner, chatCalls } = makeRunner({ isLocal: true });
    const node = createPlannerNode(runner);
    const state = {
      messages: [{ role: 'user', content: 'do the thing' }],
      currentIntent: 'unknown', // ambiguous → cloud path would probe via LLM
      decomposedTask: {
        id: 't1', title: 'T', steps: [], totalSteps: 0, canParallelize: false, executionMode: 'sequential',
      },
      agiHints: '',
    } as any;

    const result = await node(state);
    expect(chatCalls).toHaveLength(0);
    expect(result.taskPhase).toBe('executing');
  });

  it('cloud: ambiguous intent still probes isReadOnlyIntent via chat (regression guard)', async () => {
    const { runner, chatCalls } = makeRunner({
      isLocal: false,
      chatImpl: async () => ({ content: JSON.stringify({ isReadOnly: false, confidence: 0.9 }) }),
    });
    const node = createPlannerNode(runner);
    const state = {
      messages: [{ role: 'user', content: 'orchestrate the systems' }],
      currentIntent: 'unknown',
      decomposedTask: {
        id: 't1', title: 'T', steps: [{ id: 's1', title: 'S1', description: 'd', tool: 'write_to_file' }],
        totalSteps: 1, canParallelize: false, executionMode: 'sequential',
      },
      agiHints: '',
    } as any;

    const result = await node(state);
    // 1 = isReadOnlyIntent probe; planner itself does not chat beyond that.
    expect(chatCalls.length).toBeGreaterThanOrEqual(1);
    expect(result.taskPhase).toBe('executing');
    expect((result.messages as any[])[0].content).toContain('Follow this task decomposition plan');
  });
});

describe('LP-01 debate-chamber local fast-path', () => {
  let broadcastSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    broadcastSpy = vi.spyOn(DebateEventEmitter, 'broadcastDebateEvent');
  });

  it('local: skips debate even for debate-worthy input — zero chat calls, debate_skipped emitted', async () => {
    const { runner, chatCalls } = makeRunner({ isLocal: true });
    const node = createDebateChamberNode(runner);
    // 'fix' intent + critical-bug wording → shouldUseDebateChamber returns
    // true on the keyword gate; the isLocal gate must still skip.
    const state = {
      messages: [{ role: 'user', content: 'fix the critical production security vulnerability causing data loss' }],
      currentIntent: 'fix',
      missionId: 'conv-lp01',
    } as any;

    const result = await node(state);
    expect(chatCalls).toHaveLength(0);
    expect(result).toEqual({ debateResult: null });

    expect(broadcastSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
    const event = broadcastSpy.mock.calls[0][0] as any;
    expect(event.type).toBe('debate_skipped');
    expect(event.conversationId).toBe('conv-lp01');
    expect(event.data?.reason).toContain('LP-01');
  });

  it('cloud: debate-worthy input still constructs the engine and calls chat (regression guard)', async () => {
    const { runner, chatCalls } = makeRunner({ isLocal: false });
    const node = createDebateChamberNode(runner);
    const state = {
      messages: [{ role: 'user', content: 'fix the critical production security vulnerability causing data loss' }],
      currentIntent: 'fix',
      missionId: 'conv-lp01-cloud',
    } as any;

    const result = await node(state);
    // The engine was constructed and the vanguard phase used the client.
    expect(chatCalls.length).toBeGreaterThanOrEqual(1);
    const startEvent = broadcastSpy.mock.calls.find(c => (c[0] as any).type === 'debate_start');
    expect(startEvent).toBeTruthy();
    // The run terminates in a debate outcome shape (result object or null on
    // error) — never the fast-path skip.
    expect(result).toBeDefined();
    expect(Object.keys(result)).toContain('debateResult');
  });
});

describe('LP-01 decomposer local fast-path', () => {
  it('local: zero chat calls, single-step passthrough plan', async () => {
    const { runner, chatCalls } = makeRunner({ isLocal: true });
    const events: any[] = [];
    const node = createDecomposerNode(runner, events);
    const state = {
      messages: [{ role: 'user', content: 'organize my downloads folder by file type' }],
      decompositionAttempts: 0,
      completedSteps: [],
    } as any;

    const result = await node(state);
    expect(chatCalls).toHaveLength(0);
    expect(result.decomposedTask).toBeDefined();
    expect(result.decomposedTask.steps).toHaveLength(1);
    expect(result.decomposedTask.steps[0].description).toBe('organize my downloads folder by file type');
    expect(result.decomposedTask.steps[0].tool).toBe('internal');
    expect(result.taskPhase).toBe('planning');
    expect(result.decompositionAttempts).toBe(1);

    const planEvent = events.find(e => e.type === 'plan_created');
    expect(planEvent).toBeTruthy();
    expect(planEvent.plan.steps).toHaveLength(1);
  });

  it('local: plan-approval skip guard still short-circuits before the fast-path', async () => {
    const { runner, chatCalls } = makeRunner({ isLocal: true });
    const node = createDecomposerNode(runner);
    const state = {
      messages: [{ role: 'user', content: '[PLAN_APPROVED] go' }],
      decompositionAttempts: 0,
      completedSteps: [],
    } as any;

    const result = await node(state);
    expect(chatCalls).toHaveLength(0);
    expect(result.decomposedTask).toBeUndefined();
    expect(result.taskPhase).toBe('planning');
  });

  it('cloud: decomposeTaskWithAI still drives the client (regression guard)', async () => {
    const { runner, chatCalls } = makeRunner({
      isLocal: false,
      chatImpl: async () => ({
        content: JSON.stringify({
          analysis: { complexity: 'simple', taskType: 'task', canParallelize: false, suggestedApproach: 'sequential' },
          steps: [{ id: 'step_1', title: 'S', description: 'd', tool: 'internal', dependsOn: [], canParallelize: false, parallelGroup: 1, agentPrompt: 'x' }],
        }),
      }),
    });
    const node = createDecomposerNode(runner, []);
    const state = {
      messages: [{ role: 'user', content: 'organize my downloads folder' }],
      decompositionAttempts: 0,
      completedSteps: [],
    } as any;

    const result = await node(state);
    expect(chatCalls.length).toBeGreaterThanOrEqual(1);
    expect(result.decomposedTask.steps).toHaveLength(1);
    expect(result.decomposedTask.executionMode).toBe('sequential');
  });
});

describe('LP-01 call_model slim-check local fast-path', () => {
  // Mock main-call responses carry toolCalls so the nudge branch (LP-04,
  // another delegate's scope) never runs and call counts stay attributable
  // to exactly: [slim probe?] + main call.
  const WITH_TOOLS = { content: 'ok', toolCalls: [{ id: 'c1', name: 'noop', arguments: {} }], finishReason: 'tool_calls' };

  const mkState = (messages: any[]): any => ({
    messages,
    currentIntent: 'conversation',
    iterations: 0,
    pendingToolCalls: [],
    decompositionAttempts: 0,
    taskPhase: 'executing',
    toolCallRecords: [],
    toolCallHistory: [],
    missionId: 'test-mission',
  });

  it('local: slim pre-call skipped — exactly ONE chat call (the main call), slim prompt applied via keywords', async () => {
    const { runner, chatCalls } = makeRunner({ isLocal: true, chatImpl: async () => WITH_TOOLS });
    const node = createCallModelNode(runner, []);
    const state = mkState([
      { role: 'system', content: 'EverFern System Prompt — FULL VERSION' },
      { role: 'user', content: 'hello there' },
    ]);

    const result = await node(state);
    // One call total: the main model call. The slim-check probe is skipped.
    expect(chatCalls).toHaveLength(1);
    for (const call of chatCalls) {
      expect(JSON.stringify(call[0])).not.toContain('shouldSlim');
    }
    // Keyword semantics: 'conversation' intent → deterministic slim true.
    const sent = chatCalls[0][0].messages;
    expect(sent[0].content).toContain('helpful and concise AI assistant');
    expect(result.pendingToolCalls).toEqual([]); // toolDefs empty → stripped
  });

  it('local: non-read-only intent keeps the FULL system prompt (no probe)', async () => {
    const { runner, chatCalls } = makeRunner({ isLocal: true, chatImpl: async () => WITH_TOOLS });
    const node = createCallModelNode(runner, []);
    const state = mkState([
      { role: 'system', content: 'EverFern System Prompt — FULL VERSION' },
      { role: 'user', content: 'write the file please' },
    ]);
    state.currentIntent = 'coding';

    await node(state);
    expect(chatCalls).toHaveLength(1);
    const sent = chatCalls[0][0].messages;
    expect(sent[0].content).toBe('EverFern System Prompt — FULL VERSION');
  });

  it('cloud: slim probe still fires before the main call (regression guard)', async () => {
    const { runner, chatCalls } = makeRunner({
      isLocal: false,
      chatImpl: async (...args: any[]) => {
        // First call = slim probe (single-user-message JSON prompt);
        // later calls = main model call.
        const req = args[0];
        if (req.messages?.length === 1 && req.messages[0].role === 'user' && String(req.messages[0].content).includes('shouldSlim')) {
          return { content: JSON.stringify({ shouldSlim: true, confidence: 0.95 }) };
        }
        return WITH_TOOLS;
      },
    });
    const node = createCallModelNode(runner, []);
    const state = mkState([
      { role: 'system', content: 'EverFern System Prompt — FULL VERSION' },
      { role: 'user', content: 'hello there' },
    ]);

    await node(state);
    expect(chatCalls.length).toBe(2); // probe + main
    const probe = chatCalls[0][0];
    expect(String(probe.messages[0].content)).toContain('shouldSlim');
    const main = chatCalls[1][0];
    expect(main.messages[0].content).toContain('helpful and concise AI assistant');
  });
});
