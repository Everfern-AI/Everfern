/**
 * EverFern Desktop — Unified Provider Registry
 *
 * Single source of truth for all provider metadata and model lists.
 * Zero runtime dependencies — importable from both main process and renderer.
 *
 * Usage:
 *   import { PROVIDER_REGISTRY, getModelsForProvider, getAllModelsFlat } from '../lib/providers';
 */

import type { ProviderType } from '../acp/types';

// ── Model Lists ──────────────────────────────────────────────────────

export const PROVIDER_MODELS: Record<ProviderType, string[]> = {
  openai: [
    'gpt-4o',
    'gpt-4o-mini',
    'gpt-4-turbo',
    'o1-preview',
    'o1-mini',
    'o3-mini',
  ],
  anthropic: [
    'claude-sonnet-4-20250514',
    'claude-opus-4-5',
    'claude-haiku-4-5-20251001',
    'claude-3-5-sonnet-20241022',
    'claude-3-5-haiku-20241022',
  ],
  deepseek: [
    'deepseek-v4-flash',
    'deepseek-v4-pro',
  ],
  minimax: [
    'MiniMax-M3',
    'minimax-m2.7',
    'minimax-m2.5',
  ],
  gemini: [
    'gemini-3.1-pro-preview',
    'gemini-3.1-flash-preview',
    'gemini-3.1-flash-lite-preview',
    'gemini-3.1-flash-image-preview',
    'gemini-3-pro-preview',
    'gemini-3-flash-preview',
    'gemini-2.5-pro',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
  ],
  nvidia: [
    'google/gemma-4-31b-it',
    'meta/llama-3.2-90b-vision-instruct',
    'qwen/qwen3.5-122b-a10b',
    'meta/llama-3.3-70b-instruct',
    'nvidia/llama-3.1-nemotron-70b-instruct',
    'mistralai/mistral-small-4-119b-2603',
    'nvidia/nemotron-3-super-120b-a12b',
  ],
  ollama: [], // populated dynamically at runtime
  'ollama-cloud': [
    'qwen3-vl:235b-instruct-cloud',
    'kimi-k2.6:cloud',
    'glm-5.1:cloud',
    'gemma4:31b-cloud',
    'kimi-k2.5:cloud',
    'minimax-m2.7:cloud',
    'glm-5:cloud',
    'deepseek-v3.2:cloud',
    'deepseek-v4-flash:cloud',
    'deepseek-v4-pro:cloud',
  ],
  lmstudio: [], // populated dynamically at runtime
  everfern: [
    'fern-1',
    'everfern-fast',
  ],
  openrouter: [
    'openrouter/free',
    'nvidia/nemotron-3-nano-30b-a3b',
    'z-ai/glm-4-5-air',
    'arcee-ai/trinity-large-preview',
    'minimax/minimax-m2.5',
    'openai/gpt-oss-120b',
    'google/gemma-4-31b',
    'meta-llama/llama-3.3-70b-instruct',
    'qwen/qwen3-coder-480b-a35b',
  ],
};

// ── Provider Metadata ────────────────────────────────────────────────

export interface ProviderMeta {
  type: ProviderType;
  name: string;
  description: string;
  requiresApiKey: boolean;
  isLocal: boolean;
  defaultModel: string;
  engine: 'local' | 'online' | 'everfern';
  baseUrl?: string;
  enabled?: boolean;  // Whether the provider is configured and available
}

export const PROVIDER_REGISTRY: Record<ProviderType, ProviderMeta> = {
  openai: {
    type: 'openai',
    name: 'OpenAI',
    description: 'GPT-4o, o1, o3 and more via OpenAI API',
    requiresApiKey: true,
    isLocal: false,
    defaultModel: 'gpt-4o',
    engine: 'online',
    baseUrl: 'https://api.openai.com/v1',
  },
  anthropic: {
    type: 'anthropic',
    name: 'Anthropic',
    description: 'Claude 4 Sonnet, Opus, Haiku via Anthropic API',
    requiresApiKey: true,
    isLocal: false,
    defaultModel: 'claude-sonnet-4-20250514',
    engine: 'online',
    baseUrl: 'https://api.anthropic.com',
  },
  deepseek: {
    type: 'deepseek',
    name: 'DeepSeek',
    description: 'DeepSeek-V4-Flash and DeepSeek-V4-Pro',
    requiresApiKey: true,
    isLocal: false,
    defaultModel: 'deepseek-v4-pro',
    engine: 'online',
    baseUrl: 'https://api.deepseek.com',
  },
  minimax: {
    type: 'minimax',
    name: 'MiniMax',
    description: 'MiniMax M2.5 and M2.7 via API',
    requiresApiKey: true,
    isLocal: false,
    defaultModel: 'minimax-m2.7',
    engine: 'online',
    baseUrl: 'https://api.minimax.io/v1',
  },
  gemini: {
    type: 'gemini',
    name: 'Google Gemini',
    description: 'Gemini 3.1 and 2.5 via Google API',
    requiresApiKey: true,
    isLocal: false,
    defaultModel: 'gemini-3.1-pro-preview',
    engine: 'online',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
  },
  ollama: {
    type: 'ollama',
    name: 'Ollama',
    description: 'Run open-source models locally via Ollama',
    requiresApiKey: false,
    isLocal: true,
    defaultModel: 'llama3',
    engine: 'local',
    baseUrl: 'http://localhost:11434',
  },
  'ollama-cloud': {
    type: 'ollama-cloud',
    name: 'Ollama Cloud',
    description: 'Cloud-hosted open-source models via Ollama Cloud',
    requiresApiKey: true,
    isLocal: false,
    defaultModel: 'llama3.3',
    engine: 'online',
    baseUrl: 'https://ollama.com/api',
  },
  lmstudio: {
    type: 'lmstudio',
    name: 'LM Studio',
    description: 'Local models via LM Studio OpenAI-compatible server',
    requiresApiKey: false,
    isLocal: true,
    defaultModel: 'local-model',
    engine: 'local',
    baseUrl: 'http://localhost:1234/v1',
  },
  everfern: {
    type: 'everfern',
    name: 'EverFern Cloud',
    description: 'Managed frontier models optimized for EverFern',
    requiresApiKey: false,
    isLocal: false,
    defaultModel: 'fern-1',
    engine: 'everfern',
    baseUrl: 'https://api.everfern.app/api',
  },
  openrouter: {
    type: 'openrouter',
    name: 'OpenRouter',
    description: 'A unified API to access dozens of top open and closed source models',
    requiresApiKey: true,
    isLocal: false,
    defaultModel: 'openai/gpt-oss-120b',
    engine: 'online',
    baseUrl: 'https://openrouter.ai/api/v1',
  },
  nvidia: {
    type: 'nvidia',
    name: 'Nvidia NIM',
    description: 'High-performance inference microservices via Nvidia API',
    requiresApiKey: true,
    isLocal: false,
    defaultModel: 'google/gemma-4-31b-it',
    engine: 'online',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
  },
};

// ── Flat Model Entry ─────────────────────────────────────────────────

export interface FlatModelEntry {
  id: string;       // model ID passed to API calls
  name: string;     // human-readable display name
  provider: string; // display name of provider
  providerType: ProviderType;
}

/**
 * Returns static model list for a given provider type.
 * For local providers (ollama/lmstudio) returns [] — fetch dynamically at runtime.
 */
export function getModelsForProvider(type: ProviderType): string[] {
  return PROVIDER_MODELS[type] ?? [];
}

/**
 * Returns a flat list of all models across all non-local providers,
 * suitable for populating the model selector dropdown.
 */
export function getAllModelsFlat(): FlatModelEntry[] {
  const result: FlatModelEntry[] = [];
  for (let [type, models] of Object.entries(PROVIDER_MODELS) as [ProviderType, string[]][]) {
    // Legacy alias normalization
    if ((type as string) === 'google') type = 'gemini';

    const meta = PROVIDER_REGISTRY[type];
    if (!meta) continue;

    for (const modelId of models) {
      result.push({
        id: modelId,
        name: formatModelName(modelId),
        provider: meta.name,
        providerType: type,
      });
    }
  }
  return result;
}

/**
 * Get models for the active engine/provider config.
 * Handles the engine → providerType mapping.
 */
export function getModelsForConfig(engine: string, provider?: string): FlatModelEntry[] {
  let providerType: ProviderType;

  if (engine === 'online' && provider) {
    providerType = provider as ProviderType;
  } else if (engine === 'local') {
    // Return both ollama and lmstudio entries (will be merged with dynamic list)
    return [];
  } else {
    providerType = (engine as ProviderType) || 'everfern';
  }

  const meta = PROVIDER_REGISTRY[providerType];
  // Normalization for legacy IDs
  if (!meta && (providerType as string) === 'google') {
    const geminiMeta = PROVIDER_REGISTRY['gemini'];
    if (geminiMeta) return getModelsForConfig(engine, 'gemini');
  }
  if (!meta) return [];

  return getModelsForProvider(providerType).map(modelId => ({
    id: modelId,
    name: formatModelName(modelId),
    provider: meta.name,
    providerType,
  }));
}

// ── Helpers ──────────────────────────────────────────────────────────

export function formatModelName(id: string): string {
  const knownNames: Record<string, string> = {
    'gpt-4o': 'GPT-4o',
    'gpt-4o-mini': 'GPT-4o mini',
    'gpt-4-turbo': 'GPT-4 Turbo',
    'o1-preview': 'o1 Preview',
    'o1-mini': 'o1 mini',
    'o3-mini': 'o3 mini',
    'claude-sonnet-4-20250514': 'Claude Sonnet 4',
    'claude-opus-4-5': 'Claude Opus 4.5',
    'claude-haiku-4-5-20251001': 'Claude Haiku 4.5',
    'claude-3-5-sonnet-20241022': 'Claude 3.5 Sonnet',
    'claude-3-5-haiku-20241022': 'Claude 3.5 Haiku',
    'deepseek-v4-flash': 'DeepSeek V4 Flash',
    'deepseek-v4-pro': 'DeepSeek V4 Pro',
    'minimax-m2.7': 'MiniMax M2.7',
    'minimax-m2.5': 'MiniMax M2.5',
    'MiniMax-M3': 'MiniMax 3',
    'gemini-3.1-pro-preview': 'Gemini 3.1 Pro',
    'gemini-3.1-flash-preview': 'Gemini 3.1 Flash',
    'gemini-3.1-flash-lite-preview': 'Gemini 3.1 Flash Lite',
    'gemini-3.1-flash-image-preview': 'Gemini 3.1 Flash Image',
    'gemini-3-pro-preview': 'Gemini 3 Pro',
    'gemini-3-flash-preview': 'Gemini 3 Flash',
    'gemini-2.5-pro': 'Gemini 2.5 Pro',
    'gemini-2.5-flash': 'Gemini 2.5 Flash',
    'gemini-2.5-flash-lite': 'Gemini 2.5 Flash Lite',
    'fern-1': 'Fern-1',
    'everfern-fast': 'Fern Fast',
    'qwen/qwen3.5-122b-a10b': 'Qwen 3.5 122B (NIM)', // thinking model
    'mistralai/mistral-small-4-119b-2603': 'Mistral Small (NIM)',
    'z-ai/glm5': 'GLM 5 (NIM)',
    'meta/llama-3.1-405b-instruct': 'Llama 3.1 405B (NIM)',
    'meta/llama-3.1-70b-instruct': 'Llama 3.1 70B (NIM)',
    'nvidia/llama-3.1-nemotron-70b-instruct': 'Nemotron 70B (NIM)',
    'meta/llama-3.3-70b-instruct': 'Llama 3.3 70B (NIM)',
    'meta/llama-3.2-90b-vision-instruct': 'Llama 3.2 90B Vision (NIM)',
    'google/gemma-4-31b-it': 'Gemma 4 31B (NIM)',
    'qwen3-vl:235b-instruct-cloud': 'Qwen3 VL 235B (Cloud)',
    'kimi-k2.6:cloud': 'Kimi K2.6 (Cloud)',
    'glm-5.1:cloud': 'GLM 5.1 (Cloud)',
    'gemma4:31b-cloud': 'Gemma 4 31B (Cloud)',
  };
  return knownNames[id] ?? id;
}
