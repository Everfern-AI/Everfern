import type { ModelOption } from './types/index';

export type ReasoningEffort = 'low' | 'medium' | 'high';

export interface ModelCapabilities {
  reasoning: boolean;
  imageGeneration: boolean;
}

/**
 * Capabilities come from provider metadata. Do not infer them from model names:
 * naming conventions drift and vision input is not image generation.
 */
export function getModelCapabilities(model?: ModelOption | null): ModelCapabilities {
  if (!model) return { reasoning: false, imageGeneration: false };

  const declared = model.capabilities;
  return {
    reasoning: declared?.reasoning ?? false,
    imageGeneration: declared?.imageGeneration ?? false,
  };
}
