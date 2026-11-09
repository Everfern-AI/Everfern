import { describe, expect, it } from 'vitest';
import { getModelCapabilities } from '../model-capabilities';
import type { ModelOption } from '../types/index';

function model(id: string, providerType = 'openai', capabilities?: ModelOption['capabilities']): ModelOption {
  return { id, name: id, provider: providerType, providerType, logo: null, capabilities };
}

describe('getModelCapabilities', () => {
  it('does not infer reasoning controls from model names', () => {
    expect(getModelCapabilities(model('gpt-5.6-sol')).reasoning).toBe(false);
    expect(getModelCapabilities(model('claude-sonnet-5', 'anthropic')).reasoning).toBe(false);
    expect(getModelCapabilities(model('deepseek-v4-pro', 'deepseek')).reasoning).toBe(false);
    expect(getModelCapabilities(model('gpt-4o')).reasoning).toBe(false);
    expect(getModelCapabilities(model('meta/llama-3.2-90b-vision-instruct', 'nvidia')).reasoning).toBe(false);
  });

  it('does not confuse image input or an image-like model name with implemented image generation', () => {
    expect(getModelCapabilities(model('qwen3-vl:235b-cloud', 'ollama-cloud')).imageGeneration).toBe(false);
    expect(getModelCapabilities(model('gpt-image-1')).imageGeneration).toBe(false);
  });

  it('honors provider-declared capabilities', () => {
    expect(getModelCapabilities(model('custom-model', 'custom', { reasoning: true, imageGeneration: true }))).toEqual({
      reasoning: true,
      imageGeneration: true,
    });
  });
});
