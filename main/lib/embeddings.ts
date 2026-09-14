import { OpenAIEmbeddings } from "@langchain/openai";
import { OllamaEmbeddings } from "@langchain/ollama";
import fs from "fs";
import path from "path";
import os from "os";
import { PROVIDER_REGISTRY } from "./providers";
import type { ProviderType } from "../acp/types";
import { warnOnceEnvKeyFallback } from "./env-key-fallback";

export interface EmbeddingConfig {
  provider: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

interface ResolvedEmbeddingModel {
  embeddings: OpenAIEmbeddings | OllamaEmbeddings;
  dimensions: number;
}

export function getSystemEmbeddingConfig(): EmbeddingConfig {
  const configDir = path.join(os.homedir(), '.everfern');
  const configPath = path.join(configDir, 'config.json');

  let provider = 'openai';
  let apiKey = process.env.OPENAI_API_KEY;
  if (apiKey !== undefined && apiKey.trim().length > 0) {
    warnOnceEnvKeyFallback('embeddings-openai');
  }
  let customBaseUrl = undefined;
  let model = undefined;

  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      
      // Read from config.embedding object if it exists
      if (config.embedding?.provider) {
        provider = config.embedding.provider;
      } else if (config.embeddingProvider) { // Fallback for old flat config format
        provider = config.embeddingProvider;
      } else if (config.provider) {
        provider = config.provider;
      }
      
      model = config.embedding?.model || config.embeddingModel || undefined;
      
      if (provider === 'everfern') {
        customBaseUrl = 'https://api.everfern.app/api';
      } else if (config.embedding?.baseUrl) {
        customBaseUrl = config.embedding.baseUrl;
      } else if (config.embeddingBaseUrl) {
        customBaseUrl = config.embeddingBaseUrl;
      } else if (config.baseUrl) {
        customBaseUrl = config.baseUrl;
      } else {
        const meta = PROVIDER_REGISTRY[provider as ProviderType];
        if (meta && meta.baseUrl) {
          customBaseUrl = meta.baseUrl;
        }
      }

      if (config.keys && (config.keys[provider] || (provider === 'gemini' && config.keys['google']) || (provider === 'google' && config.keys['gemini']))) {
        apiKey = config.keys[provider] || (provider === 'gemini' ? config.keys['google'] : config.keys['gemini']);
      } else {
        let keyPath = path.join(configDir, 'keys', `${provider}.key`);
        if (!fs.existsSync(keyPath) && provider === 'gemini') {
          keyPath = path.join(configDir, 'keys', 'google.key');
        }
        if (!fs.existsSync(keyPath) && provider === 'google') {
          keyPath = path.join(configDir, 'keys', 'gemini.key');
        }
        if (fs.existsSync(keyPath)) {
          const rawKey = fs.readFileSync(keyPath, 'utf-8').trim();
          const match = rawKey.match(/(?:nvapi-[A-Za-z0-9_-]+|sk-[A-Za-z0-9T\-]+)/);
          apiKey = match ? match[0] : rawKey;
        }
      }
      
      // Update function to return model properly if specified
      if (model) {
        // We will pass this to the return object
        (config as any)._resolvedModel = model;
      }
    } catch { }
  }

  // Sanitize: Trim and remove non-ASCII characters that break fetch/Headers
  const sanitize = (s?: string) => s?.trim().replace(/[^\x00-\x7F]/g, "") || undefined;

  return {
    provider: sanitize(provider) || "openai",
    apiKey: sanitize(apiKey),
    baseUrl: sanitize(customBaseUrl),
    model: sanitize(model)
  };
}

// LP-09: sanitize base URLs for direct getEmbeddingModel callers — mirrors the
// sanitize step in getSystemEmbeddingConfig (trim + strip non-ASCII).
function sanitizeBaseUrl(url?: string): string | undefined {
  return url?.trim().replace(/[^\x00-\x7F]/g, "") || undefined;
}

function getEmbeddingModelRaw(config: EmbeddingConfig): ResolvedEmbeddingModel {
  if (config.provider === 'ollama') {
    return {
      embeddings: new OllamaEmbeddings({
        model: config.model || 'nomic-embed-text',
        baseUrl: config.baseUrl || 'http://localhost:11434',
      }),
      dimensions: 768
    };
  }

  // LP-09: LM Studio runs its own OpenAI-compatible daemon on port 1234 — it must
  // not be routed through OllamaEmbeddings (port 11434, wrong daemon). Mirror the
  // nvidia branch's /embeddings POST against the LM Studio server instead.
  if (config.provider === 'lmstudio') {
    const baseUrl = sanitizeBaseUrl(config.baseUrl) || 'http://127.0.0.1:1234/v1'; // ai-client.ts:366 convention

    const embedRequest = async (input: string | string[]): Promise<number[][]> => {
      if (!config.model) {
        throw new Error(
          `[Embeddings] LM Studio embeddings require a model — set Settings → Embeddings → Model to a text-embedding model loaded in LM Studio.`
        );
      }
      const url = baseUrl.endsWith('/embeddings') ? baseUrl : `${baseUrl}/embeddings`;
      let res: Response;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: config.model, input })
        });
      } catch (err: any) {
        throw new Error(`LM Studio embeddings not reachable at ${url} — start LM Studio → Developer → Local Server, or fix Settings → Embeddings Base URL (${err.message || err})`);
      }
      const resText = await res.text();
      let data: any;
      try {
        data = JSON.parse(resText);
      } catch (e) {
        throw new Error(`Invalid JSON from LM Studio: ${resText.slice(0, 100)}...`);
      }
      if (!res.ok) throw new Error(`LM Studio embeddings not reachable at ${url} (${res.status} ${res.statusText}) — start LM Studio → Developer → Local Server, or fix Settings → Embeddings Base URL`);
      // Order-preserving map with index + length checks (data[i] ↔ input[i]).
      const rows: any[] = Array.isArray(data?.data) ? data.data : [];
      const expected = Array.isArray(input) ? input.length : 1;
      if (rows.length !== expected) {
        throw new Error(`LM Studio embeddings returned ${rows.length} vectors for ${expected} input(s) at ${url}`);
      }
      return rows.map((row: any, i: number) => {
        if (!Array.isArray(row?.embedding)) {
          throw new Error(`LM Studio embeddings: missing embedding vector at index ${i}`);
        }
        return row.embedding;
      });
    };

    return {
      embeddings: {
        embedQuery: async (text: string) => (await embedRequest(text))[0],
        embedDocuments: async (texts: string[]) => embedRequest(texts),
      } as any, // OpenAI-compatible shape; wrapper resizes to 1536 via resizeAndNormalizeEmbedding
      dimensions: 768 // informational only — wrapper forces 1536
    };
  }

  if (config.provider === 'nvidia') {
    return {
      embeddings: {
        embedQuery: async (text: string) => {
          const res = await fetch(config.baseUrl ? `${config.baseUrl}/embeddings` : 'https://integrate.api.nvidia.com/v1/embeddings', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${config.apiKey || 'dummy'}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              input: [text],
              model: config.model || "nvidia/nv-embedqa-e5-v5",
              input_type: "query",
              encoding_format: "float"
            })
          });
          const resText = await res.text();
          let data: any;
          try {
            data = JSON.parse(resText);
          } catch (e) {
            throw new Error(`Invalid JSON from Nvidia: ${resText.slice(0, 100)}...`);
          }
          if (!res.ok) throw new Error(data.error?.message || data.error || res.statusText);
          return data.data[0].embedding;
        }
      } as any, // Cast to any because we only use embedQuery in the app
      dimensions: 1024
    };
  }

  if (config.provider === 'gemini') {
    return {
      embeddings: {
        embedQuery: async (text: string) => {
          const modelName = config.model || "gemini-embedding-001";
          const modelPath = modelName.startsWith('models/') ? modelName : `models/${modelName}`;
          const url = `https://generativelanguage.googleapis.com/v1beta/${modelPath}:embedContent`;

          const res = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-goog-api-key': config.apiKey || ''
            },
            body: JSON.stringify({
              model: modelPath,
              content: { parts: [{ text }] }
            })
          });
          const resText = await res.text();
          let data: any;
          try {
            data = JSON.parse(resText);
          } catch (e) {
            throw new Error(`Invalid JSON from Gemini: ${resText.slice(0, 100)}...`);
          }
          if (!res.ok) throw new Error(data.error?.message || res.statusText);
          return data.embedding.values;
        },
        embedDocuments: async (documents: string[]) => {
          return Promise.all(documents.map(doc => {
            const modelName = config.model || "gemini-embedding-001";
            const modelPath = modelName.startsWith('models/') ? modelName : `models/${modelName}`;
            const url = `https://generativelanguage.googleapis.com/v1beta/${modelPath}:embedContent`;

            return fetch(url, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': config.apiKey || ''
              },
              body: JSON.stringify({
                model: modelPath,
                content: { parts: [{ text: doc }] }
              })
            }).then(async res => {
              const text = await res.text();
              let data: any;
              try {
                data = JSON.parse(text);
              } catch (e) {
                throw new Error(`Invalid JSON from Gemini: ${text.slice(0, 100)}...`);
              }
              if (!res.ok) throw new Error(data.error?.message || res.statusText);
              return data.embedding.values;
            });
          }));
        }
      } as any,
      dimensions: 768
    }
  }

  if (config.provider === 'everfern') {
    const embedTexts = async (texts: string[]) => {
      const baseUrl = config.baseUrl || 'https://api.everfern.app/api';
      const url = baseUrl.endsWith('/embedding/vectors') ? baseUrl : `${baseUrl}/embedding/vectors`;
      
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.apiKey || 'dummy'}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          input: texts[0], // Currently only supports 1 string in backend
          model: config.model || "openai/text-embedding-3-small"
        })
      });
      const text = await res.text();
      let data: any;
      try {
        data = JSON.parse(text);
      } catch (e) {
        throw new Error(text || res.statusText);
      }
      if (!res.ok) throw new Error(data.error?.message || data.error || res.statusText);
      const embedding = data.data?.[0]?.embedding || data.embedding;
      return texts.map(() => embedding); // Return same embedding for now if multiple, though usually 1
    };

    return {
      embeddings: {
        embedQuery: async (text: string) => (await embedTexts([text]))[0],
        embedDocuments: async (texts: string[]) => embedTexts(texts),
      } as any,
      dimensions: 1536
    };
  }

  if (config.provider === 'minimax') {
    const embedTexts = async (texts: string[]) => {
      const baseUrl = config.baseUrl || 'https://api.minimax.io/v1';
      const url = baseUrl.endsWith('/embeddings') ? baseUrl : `${baseUrl}/embeddings`;
      
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.apiKey || 'dummy'}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          texts: texts,
          model: config.model || "embo-01",
          type: "db" // or "query" based on use case, db is good for indexing
        })
      });
      const text = await res.text();
      let data: any;
      try {
        data = JSON.parse(text);
      } catch (e) {
        throw new Error(text || res.statusText);
      }
      if (data.base_resp?.status_code !== 0 && data.base_resp?.status_code !== undefined) {
         throw new Error(data.base_resp?.status_msg || "Minimax API error");
      }
      return data.vectors; // Array of arrays
    };

    return {
      embeddings: {
        embedQuery: async (text: string) => {
          const vecs = await embedTexts([text]);
          return vecs[0];
        },
        embedDocuments: async (texts: string[]) => embedTexts(texts),
      } as any,
      dimensions: 1536 // Minimax embo-01 is 1536
    };
  }

  return {
    embeddings: new OpenAIEmbeddings({
      openAIApiKey: config.apiKey || 'dummy',
      modelName: config.model || "text-embedding-3-small",
      configuration: { 
        baseURL: config.provider === 'openrouter' 
          ? (config.baseUrl || 'https://openrouter.ai/api/v1') 
          : (config.baseUrl || 'https://api.openai.com/v1') 
      }
    }),
    dimensions: 1536
  };
}

function resizeAndNormalizeEmbedding(embedding: number[], targetDim = 1536): number[] {
  if (!Array.isArray(embedding)) {
    console.warn('[Embeddings] Expected embedding array, got:', typeof embedding);
    return new Array(targetDim).fill(0);
  }
  if (embedding.length === targetDim) return embedding;

  let result = new Array(targetDim);
  if (embedding.length > targetDim) {
    // Truncate
    result = embedding.slice(0, targetDim);
  } else {
    // Pad with zeros
    for (let i = 0; i < targetDim; i++) {
      result[i] = i < embedding.length ? embedding[i] : 0;
    }
  }

  // Normalize vector (L2 norm)
  let sumSq = 0;
  for (let i = 0; i < targetDim; i++) {
    sumSq += result[i] * result[i];
  }
  
  const norm = Math.sqrt(sumSq);
  if (norm > 0) {
    for (let i = 0; i < targetDim; i++) {
      result[i] /= norm;
    }
  }

  return result;
}

let localPipeline: any = null;

// LP-08: exported for testability (cloud fallback path regression tests).
export async function getLocalFallbackEmbedding(text: string): Promise<number[]> {
  try {
    if (!localPipeline) {
      console.log('[Embeddings] Initializing local Transformers.js fallback with Xenova/all-MiniLM-L6-v2...');
      const transformers = await import('@xenova/transformers');
      transformers.env.allowLocalModels = false;
      localPipeline = await transformers.pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    }
    const output = await localPipeline(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data);
  } catch (err: any) {
    console.error('[Embeddings] Critical failure in Transformers.js local fallback:', err);
    throw err;
  }
}

export function getEmbeddingModel(config: EmbeddingConfig): ResolvedEmbeddingModel {
  const result = getEmbeddingModelRaw(config);

  // LP-08: local daemons must not silently fall back to Transformers.js — the
  // fallback downloads a CPU model that competes with the local daemon. Rethrow
  // with actionable guidance instead; cloud providers keep the fallback.
  const isLocalProvider = config.provider === 'ollama' || config.provider === 'lmstudio';

  // Wrap embeddings to guarantee 1536 dimensions
  const originalEmbedQuery = result.embeddings.embedQuery.bind(result.embeddings);
  const originalEmbedDocuments = result.embeddings.embedDocuments ? result.embeddings.embedDocuments.bind(result.embeddings) : undefined;

  result.embeddings.embedQuery = async (text: string) => {
    try {
      const vector = await originalEmbedQuery(text);
      return resizeAndNormalizeEmbedding(vector, 1536);
    } catch (err: any) {
      if (isLocalProvider) {
        throw new Error(`[Embeddings] Local provider '${config.provider}' failed (${err.message || err}) — not falling back to Transformers.js (would download a CPU model and compete with the local daemon); fix the server/config.`);
      }
      console.warn(`[Embeddings] Provider '${config.provider}' embedQuery failed. Falling back to local Transformers.js:`, err.message || err);
      const fallbackVector = await getLocalFallbackEmbedding(text);
      return resizeAndNormalizeEmbedding(fallbackVector, 1536);
    }
  };

  if (originalEmbedDocuments) {
    result.embeddings.embedDocuments = async (texts: string[]) => {
      try {
        const vectors = await originalEmbedDocuments(texts);
        return vectors.map(v => resizeAndNormalizeEmbedding(v, 1536));
      } catch (err: any) {
        if (isLocalProvider) {
          throw new Error(`[Embeddings] Local provider '${config.provider}' failed (${err.message || err}) — not falling back to Transformers.js (would download a CPU model and compete with the local daemon); fix the server/config.`);
        }
        console.warn(`[Embeddings] Provider '${config.provider}' embedDocuments failed. Falling back to local Transformers.js:`, err.message || err);
        return Promise.all(texts.map(async text => {
          const fallbackVector = await getLocalFallbackEmbedding(text);
          return resizeAndNormalizeEmbedding(fallbackVector, 1536);
        }));
      }
    };
  } else {
    result.embeddings.embedDocuments = async (texts: string[]) => {
      return Promise.all(texts.map(text => result.embeddings.embedQuery(text)));
    };
  }

  // Force dimensions to 1536 since we resize them
  result.dimensions = 1536;

  return result;
}
