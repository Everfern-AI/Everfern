import { describe, expect, it } from 'vitest';
import { AIClient } from '../ai-client';

describe('Stale Base URL Fix', () => {
  it('discards local base URL for cloud providers in AIClient constructor', () => {
    const client = new AIClient({
      provider: 'minimax',
      model: 'MiniMax-M3',
      baseUrl: 'http://localhost:11434',
      apiKey: 'sk-cp-test',
    });

    const fullConfig = client.getFullConfig();
    expect(fullConfig.baseUrl).not.toBe('http://localhost:11434');
    expect(fullConfig.baseUrl).toBe('https://api.minimax.io/v1');
  });

  it('preserves custom base URL for local providers like ollama', () => {
    const client = new AIClient({
      provider: 'ollama',
      model: 'llama3',
      baseUrl: 'http://127.0.0.1:11435',
      apiKey: '',
    });

    const fullConfig = client.getFullConfig();
    expect(fullConfig.baseUrl).toBe('http://127.0.0.1:11435');
  });
});
