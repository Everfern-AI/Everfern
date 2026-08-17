/**
 * EverFern Desktop - Unified Provider Registry
 *
 * Single source of truth for all provider metadata and model lists.
 * Zero runtime dependencies - importable from both main process and renderer.
 *
 * Usage:
 *   import { PROVIDER_REGISTRY, getModelsForProvider, getAllModelsFlat } from '../lib/providers';
 */

import type { ProviderType } from '../acp/types';

// -- Model Lists ------------------------------------------------------

export const PROVIDER_MODELS: Record<ProviderType, string[]> = {
  openai: [
    'gpt-5.6-sol',
    'gpt-5.6-terra',
    'gpt-5.6-luna',

    'gpt-5.5',
    'gpt-5.5-pro',
    'gpt-5.4',
    'gpt-5.4-pro',
    'gpt-5.4-mini',
    'gpt-5.4-nano',

    'gpt-4.5-preview',
    'gpt-4o',
    'gpt-4o-mini',

    'o1',
    'o3-mini',

    'computer-use-preview',
  ],

  anthropic: [
    // Current flagship models
    'claude-fable-5',
    'claude-opus-5',
    'claude-sonnet-5',

    // Current previous-generation models
    'claude-opus-4-8',
    'claude-opus-4-7',
    'claude-opus-4-6',
    'claude-sonnet-4-6',
    'claude-haiku-4-5-20251001',
    'claude-haiku-4-5',
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
    'gemini-3.5-flash',
    'gemini-3.1-pro-preview',
    'gemini-3.1-flash-lite',
    'gemini-3-pro-preview',
    'gemini-3-flash-preview',
    'gemini-2.5-pro',
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
    'qwen3-vl:235b-cloud',
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

export const CLOUD_MODEL_MAP: Record<string, string> = {
  // Anthropic
  'claude-fable-5': 'anthropic/claude-fable-5',
  'claude_fable_5': 'anthropic/claude-fable-5',
  'claude-opus-5': 'anthropic/claude-opus-5',
  'claude_opus_5': 'anthropic/claude-opus-5',
  'claude-sonnet-5': 'anthropic/claude-sonnet-5',
  'claude_sonnet_5': 'anthropic/claude-sonnet-5',
  'claude-opus-4-8': 'anthropic/claude-opus-4.8',
  'claude_opus_4_8': 'anthropic/claude-opus-4.8',
  'claude-opus-4-7': 'anthropic/claude-opus-4.7',
  'claude_opus_4_7': 'anthropic/claude-opus-4.7',
  'claude-opus-4-6': 'anthropic/claude-opus-4.6',
  'claude_opus_4_6': 'anthropic/claude-opus-4.6',
  'claude-sonnet-4-6': 'anthropic/claude-sonnet-4.6',
  'claude_sonnet_4_6': 'anthropic/claude-sonnet-4.6',
  'claude-haiku-4-5-20251001': 'anthropic/claude-haiku-4.5',
  'claude-haiku-4-5': 'anthropic/claude-haiku-4.5',
  'claude_haiku_4_5': 'anthropic/claude-haiku-4.5',
  
  // OpenAI
  'gpt-5.6-sol': 'openai/gpt-5.6-sol',
  'gpt_5_6_sol': 'openai/gpt-5.6-sol',
  'gpt-5.6-terra': 'openai/gpt-5.6-terra',
  'gpt_5_6_terra': 'openai/gpt-5.6-terra',
  'gpt-5.6-luna': 'openai/gpt-5.6-luna',
  'gpt_5_6_luna': 'openai/gpt-5.6-luna',
  'gpt-5.5': 'openai/gpt-5.5',
  'gpt_5_5': 'openai/gpt-5.5',
  'gpt-5.5-pro': 'openai/gpt-5.5-pro',
  'gpt_5_5_pro': 'openai/gpt-5.5-pro',
  'gpt-5.4': 'openai/gpt-5.4',
  'gpt_5_4': 'openai/gpt-5.4',
  'gpt-5.4-pro': 'openai/gpt-5.4-pro',
  'gpt_5_4_pro': 'openai/gpt-5.4-pro',
  'gpt-5.4-mini': 'openai/gpt-5.4-mini',
  'gpt_5_4_mini': 'openai/gpt-5.4-mini',
  'gpt-5.4-nano': 'openai/gpt-5.4-nano',
  'gpt_5_4_nano': 'openai/gpt-5.4-nano',
  'gpt-4.5-preview': 'openai/gpt-4.5-preview',
  'gpt_4_5_preview': 'openai/gpt-4.5-preview',
  'gpt-4o': 'openai/gpt-4o',
  'gpt_4o': 'openai/gpt-4o',
  'gpt-4o-mini': 'openai/gpt-4o-mini',
  'gpt_4o_mini': 'openai/gpt-4o-mini',
  'o1': 'openai/o1',
  'o3-mini': 'openai/o3-mini',
  'computer-use-preview': 'openai/computer-use',

  // Google Gemini
  'gemini-3.5-flash': 'google/gemini-3.5-flash',
  'gemini_3_5_flash': 'google/gemini-3.5-flash',
  'gemini-3.1-pro-preview': 'google/gemini-3.1-pro-preview',
  'gemini_3_1_pro_preview': 'google/gemini-3.1-pro-preview',
  'gemini-3.1-flash-lite': 'google/gemini-3.1-flash-lite',
  'gemini_3_1_flash_lite': 'google/gemini-3.1-flash-lite',
  'gemini-3-pro-preview': 'google/gemini-3-pro-preview',
  'gemini_3_pro_preview': 'google/gemini-3-pro-preview',
  'gemini-3-flash-preview': 'google/gemini-3-flash-preview',
  'gemini_3_flash_preview': 'google/gemini-3-flash-preview',
  'gemini-2.5-pro': 'google/gemini-2.5-pro',
  'gemini_2_5_pro': 'google/gemini-2.5-pro',

  // EverFern Computer Use (OpenAI GPT-5.6 Luna)
  'everfern-tars': 'openai/gpt-5.6-luna',
  'everfern-tars-v1': 'openai/gpt-5.6-luna',
  'everfern-computer': 'openai/gpt-5.6-luna',
  'qwen3-vl-235b-a22b-instruct': 'qwen/qwen3-vl-235b-a22b-instruct',
  'qwen3_vl_235b_a22b_instruct': 'qwen/qwen3-vl-235b-a22b-instruct',
  'qwen/qwen3-vl-235b-a22b-instruct': 'qwen/qwen3-vl-235b-a22b-instruct',
};

// -- Provider Metadata ------------------------------------------------

export interface ProviderMeta {
  type: ProviderType;
  name: string;
  description: string;
  image: string;
  requiresApiKey: boolean;
  isLocal: boolean;
  defaultModel: string;
  engine: 'local' | 'online' | 'everfern';
  baseUrl?: string;
  enabled?: boolean;
}

export const PROVIDER_REGISTRY: Record<ProviderType, ProviderMeta> = {
  openai: {
    type: 'openai',
    name: 'OpenAI',
    description: 'OpenAI GPT models',
    image: '/images/ai-providers/openai.svg',
    requiresApiKey: true,
    isLocal: false,
    defaultModel: 'gpt-5.5',
    engine: 'online',
    baseUrl: 'https://api.openai.com/v1',
  },
  anthropic: {
    type: 'anthropic',
    name: 'Anthropic',
    description: 'Anthropic Claude models',
    image: '/images/ai-providers/claude.svg',
    requiresApiKey: true,
    isLocal: false,
    defaultModel: 'claude-sonnet-5',
    engine: 'online',
    baseUrl: 'https://api.anthropic.com',
  },
  deepseek: {
    type: 'deepseek',
    name: 'DeepSeek',
    description: 'DeepSeek-V4-Flash and DeepSeek-V4-Pro',
    image: '/images/ai-providers/deepseek.svg',
    requiresApiKey: true,
    isLocal: false,
    defaultModel: 'deepseek-v4-pro',
    engine: 'online',
    baseUrl: 'https://api.deepseek.com',
  },
  minimax: {
    type: 'minimax',
    name: 'MiniMax',
    description: 'MiniMax 3, M2.7 and M2.5 via API',
    image: '/images/ai-providers/minimax.svg',
    requiresApiKey: true,
    isLocal: false,
    defaultModel: 'MiniMax-M3',
    engine: 'online',
    baseUrl: 'https://api.minimax.io/v1',
  },
  gemini: {
    type: 'gemini',
    name: 'Google Gemini',
    description: 'Google Gemini models',
    image: '/images/ai-providers/gemini.svg',
    requiresApiKey: true,
    isLocal: false,
    defaultModel: 'gemini-3.5-flash',
    engine: 'online',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
  },
  ollama: {
    type: 'ollama',
    name: 'Ollama',
    description: 'Run open-source models locally via Ollama',
    image: '/images/ai-providers/ollama.svg',
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
    image: '/images/ai-providers/ollama.svg',
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
    image: '/images/ai-providers/lm-studio.png',
    requiresApiKey: false,
    isLocal: true,
    defaultModel: 'local-model',
    engine: 'local',
    baseUrl: 'http://localhost:1234/v1',
  },
  everfern: {
    type: 'everfern',
    name: 'EverFern Cloud',
    description: 'Managed models & AI agents powered by EverFern',
    image: '/images/logos/black-logo-withoutbg.png',
    requiresApiKey: false,
    isLocal: false,
    defaultModel: 'fern-1',
    engine: 'everfern',
    baseUrl: 'https://api.everfern.app',
  },
  nvidia: {
    type: 'nvidia',
    name: 'NVIDIA NIM',
    description: 'Enterprise models accelerated by NVIDIA NIM',
    image: '/images/ai-providers/nvidia.svg',
    requiresApiKey: true,
    isLocal: false,
    defaultModel: 'google/gemma-4-31b-it',
    engine: 'online',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
  },
  openrouter: {
    type: 'openrouter',
    name: 'OpenRouter',
    description: 'Unified API for 100+ models from top providers',
    image: '/images/ai-providers/openrouter.svg',
    requiresApiKey: true,
    isLocal: false,
    defaultModel: 'openrouter/free',
    engine: 'online',
    baseUrl: 'https://openrouter.ai/api/v1',
  },
};

export function getModelsForProvider(type: ProviderType): string[] {
  return PROVIDER_MODELS[type] ?? [];
}

export interface FlatModelEntry {
  id: string;
  name: string;
  provider: string;
  providerType: ProviderType;
  description?: string;
}

export function getAllModelsFlat(): FlatModelEntry[] {
  const result: FlatModelEntry[] = [];
  for (let [type, models] of Object.entries(PROVIDER_MODELS) as [ProviderType, string[]][]) {
    const meta = PROVIDER_REGISTRY[type];
    for (let model of models) {
      result.push({
        id: model,
        name: formatModelDisplayName(model, type),
        provider: meta?.name ?? type,
        providerType: type,
      });
    }
  }
  return result;
}

export function requiresApiKey(type: ProviderType): boolean {
  return PROVIDER_REGISTRY[type]?.requiresApiKey ?? false;
}

export function isLocalProvider(type: ProviderType): boolean {
  return PROVIDER_REGISTRY[type]?.isLocal ?? false;
}

export function getDefaultModel(type: ProviderType): string {
  return PROVIDER_REGISTRY[type]?.defaultModel ?? '';
}

export function getAllProviders(): ProviderMeta[] {
  return Object.values(PROVIDER_REGISTRY);
}

export function getProviderMeta(type: ProviderType): ProviderMeta | undefined {
  return PROVIDER_REGISTRY[type];
}

export function getProvidersByEngine(engine: 'local' | 'online' | 'everfern'): ProviderMeta[] {
  return Object.values(PROVIDER_REGISTRY).filter(p => p.engine === engine);
}

export function isEverFernCloudModel(modelId: string): boolean {
  return modelId === 'fern-1' || modelId === 'everfern-tars-v1' || modelId === 'everfern-computer';
}

export function formatModelDisplayName(modelId: string, provider: ProviderType): string {
  if (provider === 'everfern') {
    if (modelId === 'fern-1') return 'EverFern-1 (Default)';
  }
  return modelId;
}

export function formatModelName(modelId: string, provider?: ProviderType): string {
  if (!modelId) return '';
  if (provider) {
    return formatModelDisplayName(modelId, provider);
  }
  return modelId;
}

