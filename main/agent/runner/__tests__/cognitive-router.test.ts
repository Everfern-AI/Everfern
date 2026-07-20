import { describe, expect, it, vi } from 'vitest';
import { CognitiveRouter } from '../cognitive-router';

// Helper to create a mocked AgentRunner
function createMockRunner(chatOutputs: string[]) {
  let callCount = 0;
  
  const mockChat = vi.fn().mockImplementation(async (config: any) => {
    const messages = config?.messages || [];
    const lastMsg = messages[messages.length - 1];
    const userMessageContent = typeof lastMsg?.content === 'string' ? lastMsg.content : JSON.stringify(lastMsg?.content || '');

    if (userMessageContent.includes('Evaluate the confidence score') || userMessageContent.includes('Analyze if the user request should be handled')) {
      return {
        content: JSON.stringify({ confidence: 0.95, reasoning: 'Mocked confidence evaluation' }),
        usage: {
          promptTokens: 5,
          completionTokens: 10,
          totalTokens: 15
        }
      };
    }

    const output = chatOutputs[callCount] || '';
    callCount++;
    return {
      content: output,
      usage: {
        promptTokens: 10,
        completionTokens: 20,
        totalTokens: 30
      }
    };
  });

  const mockClient = {
    chat: mockChat,
    isLocal: () => false,
    model: 'gpt-4o',
    provider: 'openai'
  };

  const mockTelemetry = {
    info: vi.fn(),
    warn: vi.fn(),
    transition: vi.fn()
  };

  const mockRunner = {
    client: mockClient,
    telemetry: mockTelemetry,
    workspaceDir: '/test/workspace',
    currentAgentSessionKey: undefined
  };

  return { mockRunner, mockChat };
}

describe('CognitiveRouter', () => {
  it('successfully routes to route_coding via ReAct loop', async () => {
    const chatOutputs = [
      JSON.stringify({
        thought: 'This is a coding request. Let me inspect the context first.',
        action: { name: 'inspect_context', arguments: {} }
      }),
      JSON.stringify({
        thought: 'Context checked. Let me evaluate confidence for coding_specialist.',
        action: { name: 'evaluate_confidence', arguments: { subsystem: 'coding_specialist' } }
      }),
      JSON.stringify({
        thought: 'Confidence is high. I will route to coding_specialist.',
        action: {
          name: 'route_to',
          arguments: {
            subsystem: 'route_coding',
            confidence: 0.95,
            explanation: 'TypeScript implementation request'
          }
        }
      })
    ];

    const { mockRunner, mockChat } = createMockRunner(chatOutputs);
    const eventQueue: any[] = [];
    const router = new CognitiveRouter(mockRunner as any, eventQueue);

    const state: any = {
      messages: [{ role: 'user', content: 'Create a TS React component for a dashboard table' }],
      currentIntent: 'coding'
    };

    const result = await router.route(state);

    expect(result.decision).toBe('route_coding');
    expect(result.confidence).toBe(0.95);
    expect(result.explanation).toBe('TypeScript implementation request');
    expect(mockChat).toHaveBeenCalledTimes(4);

    expect(eventQueue.some(e => e.type === 'thought' && e.content.includes('Inspecting conversation context'))).toBe(true);
    expect(eventQueue.some(e => e.type === 'thought' && e.content.includes('coding_specialist'))).toBe(true);
  });

  it('routes to web_explorer immediately for flight booking', async () => {
    const chatOutputs = [
      JSON.stringify({
        thought: 'The user wants to book a flight to Paris, which is transactional.',
        action: {
          name: 'route_to',
          arguments: {
            subsystem: 'route_web_explorer',
            confidence: 0.98,
            explanation: 'Transactional flight booking request'
          }
        }
      })
    ];

    const { mockRunner, mockChat } = createMockRunner(chatOutputs);
    const eventQueue: any[] = [];
    const router = new CognitiveRouter(mockRunner as any, eventQueue);

    const state: any = {
      messages: [{ role: 'user', content: 'Book a one-way flight from AMS to CDG for tomorrow' }],
      currentIntent: 'research'
    };

    const result = await router.route(state);

    expect(result.decision).toBe('route_web_explorer');
    expect(result.confidence).toBe(0.98);
    expect(result.explanation).toBe('Transactional flight booking request');
    expect(mockChat).toHaveBeenCalledTimes(1);
  });

  it('falls back to intent classification if the ReAct loop does not call route_to', async () => {
    const chatOutputs = [
      JSON.stringify({
        thought: 'Let me check context.',
        action: { name: 'inspect_context', arguments: {} }
      }),
      JSON.stringify({
        thought: 'Still checking.',
        action: { name: 'inspect_context', arguments: {} }
      }),
      JSON.stringify({
        thought: 'Checking again.',
        action: { name: 'inspect_context', arguments: {} }
      }),
      JSON.stringify({
        thought: 'Endless loop.',
        action: { name: 'inspect_context', arguments: {} }
      })
    ];

    const { mockRunner, mockChat } = createMockRunner(chatOutputs);
    const eventQueue: any[] = [];
    const router = new CognitiveRouter(mockRunner as any, eventQueue);

    const state: any = {
      messages: [{ role: 'user', content: 'Some ambiguous request' }],
      currentIntent: 'research'
    };

    const result = await router.route(state);

    // Should fall back to intent-based routing
    expect(result.decision).toBe('route_web_explorer'); // research fallback maps to route_web_explorer
    expect(result.confidence).toBe(0.7);
    expect(result.explanation).toContain('Fallback intent-based routing decision');
  });

  it('immediately returns continue_brain for sub-agents to prevent delegation loops', async () => {
    const { mockRunner, mockChat } = createMockRunner([]);
    mockRunner.currentAgentSessionKey = 'agent:sub-agent-key';

    const router = new CognitiveRouter(mockRunner as any, []);
    const state: any = {
      messages: [{ role: 'user', content: 'Do something' }],
      currentIntent: 'coding'
    };

    const result = await router.route(state);

    expect(result.decision).toBe('continue_brain');
    expect(result.confidence).toBe(1.0);
    expect(mockChat).not.toHaveBeenCalled();
  });
});
