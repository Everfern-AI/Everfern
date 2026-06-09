/**
 * Tests for provider-related preload bridge functionality
 */

import { describe, it, expect } from 'vitest';
import type { ProviderMeta, FlatModelEntry } from '../preload';

describe('Preload Provider Types', () => {
  it('should have correct ProviderMeta interface structure', () => {
    const mockProvider: ProviderMeta = {
      type: 'anthropic',
      name: 'Anthropic',
      description: 'Claude models',
      image: '/images/ai-providers/claude.svg',
      requiresApiKey: true,
      isLocal: false,
      defaultModel: 'claude-sonnet-4-20250514',
      engine: 'online',
      baseUrl: 'https://api.anthropic.com'
    };

    expect(mockProvider.type).toBe('anthropic');
    expect(mockProvider.name).toBe('Anthropic');
    expect(mockProvider.requiresApiKey).toBe(true);
    expect(mockProvider.isLocal).toBe(false);
    expect(mockProvider.engine).toBe('online');
  });

  it('should have correct FlatModelEntry interface structure', () => {
    const mockModel: FlatModelEntry = {
      id: 'claude-sonnet-4-20250514',
      name: 'Claude Sonnet 4',
      provider: 'Anthropic',
      providerType: 'anthropic'
    };

    expect(mockModel.id).toBe('claude-sonnet-4-20250514');
    expect(mockModel.name).toBe('Claude Sonnet 4');
    expect(mockModel.provider).toBe('Anthropic');
    expect(mockModel.providerType).toBe('anthropic');
  });

  it('should support all provider types', () => {
    const providerTypes: Array<ProviderMeta['type']> = [
      'openai',
      'anthropic',
      'deepseek',
      'ollama',
      'ollama-cloud',
      'lmstudio',
      'everfern',
      'gemini',
      'nvidia',
      'openrouter'
    ];

    providerTypes.forEach(type => {
      const provider: ProviderMeta = {
        type,
        name: 'Test Provider',
        description: 'Test',
        image: '/images/ai-providers/test.svg',
        requiresApiKey: false,
        isLocal: false,
        defaultModel: 'test-model',
        engine: 'online'
      };

      expect(provider.type).toBe(type);
    });
  });
});
