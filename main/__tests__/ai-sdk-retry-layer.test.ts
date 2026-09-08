// @vitest-environment node

/**
 * AI-PERF-03 (single retry layer): the OpenAI SDK client embedded in AIClient
 * must be constructed with maxRetries 0 — all retries are owned by the
 * app-level retryWithBackoff/_fetchWithRetry wrapper (audit XI.C: SDK 3x
 * stacked on app 3x gave up to 12 attempts per request).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AIClient } from '../lib/ai-client';

describe('AIClient SDK retry layer (AI-PERF-03)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('embedded OpenAI SDK client is constructed with maxRetries 0 (app layer owns retries)', () => {
    const client = new AIClient({
      provider: 'openai',
      apiKey: 'sk-test',
      baseUrl: 'http://127.0.0.1:1',
      model: 'gpt-test',
    });

    const sdk = (client as any).openaiClient;
    expect(sdk).toBeDefined();
    expect(sdk.maxRetries).toBe(0);
  });
});
