import type { FlatModelEntry } from './providers';

export interface OpenRouterCatalog {
  reasoningModelIds: Set<string>;
  imageModelIds: Set<string>;
}

interface OpenRouterCatalogCache extends OpenRouterCatalog {
  expiresAt: number;
}

let catalogCache: OpenRouterCatalogCache | null = null;
const CATALOG_TTL_MS = 15 * 60 * 1000;
const EVERFERN_CAPABILITIES_URL = `${(process.env.EVERFERN_API_URL || 'https://api.everfern.app').replace(/\/$/, '')}/public/openrouter/model-capabilities`;

async function fetchModelIds(url: string): Promise<Set<string>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`OpenRouter catalog returned HTTP ${response.status}`);
    const payload = await response.json() as { data?: Array<{ id?: string }> };
    return new Set((payload.data || []).map(model => model.id?.toLowerCase()).filter((id): id is string => Boolean(id)));
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchEverFernCatalog(): Promise<OpenRouterCatalog> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(EVERFERN_CAPABILITIES_URL, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`EverFern capability catalog returned HTTP ${response.status}`);
    const payload = await response.json() as {
      reasoning_model_ids?: string[];
      image_model_ids?: string[];
    };
    return {
      reasoningModelIds: new Set((payload.reasoning_model_ids || []).map(id => id.toLowerCase())),
      imageModelIds: new Set((payload.image_model_ids || []).map(id => id.toLowerCase())),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function getOpenRouterCatalog(): Promise<OpenRouterCatalog | null> {
  if (catalogCache && catalogCache.expiresAt > Date.now()) return catalogCache;

  try {
    const catalog = await fetchEverFernCatalog();
    catalogCache = { ...catalog, expiresAt: Date.now() + CATALOG_TTL_MS };
    return catalogCache;
  } catch (error) {
    console.warn('[OpenRouterCapabilities] EverFern catalog unavailable; using OpenRouter public metadata:', error);
    try {
      const [reasoningModelIds, imageModelIds] = await Promise.all([
        fetchModelIds('https://openrouter.ai/api/v1/models?supported_parameters=reasoning'),
        fetchModelIds('https://openrouter.ai/api/v1/images/models'),
      ]);
      catalogCache = { reasoningModelIds, imageModelIds, expiresAt: Date.now() + CATALOG_TTL_MS };
      return catalogCache;
    } catch (fallbackError) {
      console.warn('[OpenRouterCapabilities] Public catalog fallback unavailable:', fallbackError);
      return catalogCache;
    }
  }
}

function catalogIdsFor(model: FlatModelEntry): string[] {
  const id = model.id.replace(/^(?:ollama|lmstudio|llamacpp):/, '').toLowerCase();
  const ids = new Set([id]);
  if (!id.includes('/')) {
    const namespaceByProvider: Partial<Record<FlatModelEntry['providerType'], string>> = {
      openai: 'openai',
      anthropic: 'anthropic',
      deepseek: 'deepseek',
      gemini: 'google',
      minimax: 'minimax',
    };
    const namespace = namespaceByProvider[model.providerType];
    if (namespace) ids.add(`${namespace}/${id}`);
  }
  return [...ids];
}

export function applyOpenRouterCapabilities(
  models: FlatModelEntry[],
  catalog: OpenRouterCatalog | null,
): FlatModelEntry[] {
  if (!catalog) return models;
  return models.map(model => {
    const ids = catalogIdsFor(model);
    return {
      ...model,
      capabilities: {
        reasoning: ids.some(id => catalog.reasoningModelIds.has(id)),
        imageGeneration: ids.some(id => catalog.imageModelIds.has(id)),
      },
    };
  });
}
