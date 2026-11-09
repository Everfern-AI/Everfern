import { describe, expect, it } from 'vitest';
import { applyOpenRouterCapabilities } from '../openrouter-model-capabilities';
import type { FlatModelEntry } from '../providers';

const catalog = {
  reasoningModelIds: new Set(['openai/gpt-5.6-sol', 'google/gemini-3-pro']),
  imageModelIds: new Set(['openai/gpt-image-1']),
};

function model(id: string, providerType: FlatModelEntry['providerType']): FlatModelEntry {
  return { id, name: id, provider: providerType, providerType };
}

describe('applyOpenRouterCapabilities', () => {
  it('maps direct-provider IDs to their OpenRouter catalog namespace', () => {
    const [result] = applyOpenRouterCapabilities([model('gpt-5.6-sol', 'openai')], catalog);
    expect(result.capabilities).toEqual({ reasoning: true, imageGeneration: false });
  });

  it('uses exact catalog IDs for OpenRouter and image-generation models', () => {
    const results = applyOpenRouterCapabilities([
      model('google/gemini-3-pro', 'openrouter'),
      model('openai/gpt-image-1', 'openrouter'),
    ], catalog);
    expect(results[0].capabilities).toEqual({ reasoning: true, imageGeneration: false });
    expect(results[1].capabilities).toEqual({ reasoning: false, imageGeneration: true });
  });

  it('does not infer capabilities for unknown model names', () => {
    const [result] = applyOpenRouterCapabilities([model('gpt-5-made-up', 'openai')], catalog);
    expect(result.capabilities).toEqual({ reasoning: false, imageGeneration: false });
  });
});
