// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { classifyProviderError } from '../ai-client';

describe('classifyProviderError (XI.C overflow classification)', () => {
  it('classifies 400 context-length errors as OVERFLOW', () => {
    const out = classifyProviderError(400, "This model's maximum context length is 4096 tokens. However, your messages resulted in 5000 tokens.");
    expect(out).toMatch(/^\[OVERFLOW\]/);
    expect(out).toContain('compact or start a new session');
  });

  it('matches common provider phrasings', () => {
    expect(classifyProviderError(400, 'prompt is too long: 210000 tokens > 200000 maximum')).toMatch(/^\[OVERFLOW\]/);
    expect(classifyProviderError(400, 'input length and `max_tokens` exceed context limit: ... Input tokens: 8800')).toMatch(/^\[OVERFLOW\]/);
    expect(classifyProviderError(400, 'Request too large: maximum context window is 200000')).toMatch(/^\[OVERFLOW\]/);
  });

  it('does NOT classify non-overflow 400s', () => {
    expect(classifyProviderError(400, 'invalid model identifier')).toBeNull();
    expect(classifyProviderError(400, 'invalid_request_error: malformed body')).toBeNull();
  });

  it('does NOT classify overflow-looking text on non-400 statuses', () => {
    expect(classifyProviderError(500, 'context length exceeded')).toBeNull();
    expect(classifyProviderError(429, 'too many requests')).toBeNull();
  });

  it('no retry-behavior coupling: message is a plain error string', () => {
    const out = classifyProviderError(400, 'error: context window exceeded for this model');
    expect(out).toBeTypeOf('string');
    expect(out).not.toMatch(/retry/i);
  });
});
