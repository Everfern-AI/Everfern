// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { AIClient } from '../ai-client';

vi.mock('../debug', () => ({ DebugEmitter: { emit: vi.fn() } }));

// GPT-5 and Gemini on EverFern Cloud get the computer-use tools added to calls that bring none.
// A text-only call (the worker planner) must be able to opt out, or the model may answer
// "open the flight site" with a tool call and no plan text.
describe('computer-use tool injection', () => {
  const inject = (req: Record<string, unknown>) => {
    const client = new AIClient({ provider: 'everfern', model: 'openai/gpt-5.6-luna', apiKey: 'test' });
    const options: Record<string, unknown> = { model: 'openai/gpt-5.6-luna' };
    (client as any)._maybeInjectComputerUseTools(options, { messages: [], ...req });
    return options;
  };

  it('adds the tools to an agent call with none', () => {
    const o = inject({});
    expect(Array.isArray(o.tools) && (o.tools as unknown[]).length).toBeTruthy();
    expect(o.tool_choice).toBe('auto');
  });

  it('leaves a noTools call as plain text', () => {
    const o = inject({ noTools: true });
    expect(o.tools).toBeUndefined();
    expect(o.tool_choice).toBeUndefined();
  });
});
