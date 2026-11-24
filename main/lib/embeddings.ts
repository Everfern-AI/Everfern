import type { OpenAIEmbeddings } from "@langchain/openai";
import { execFile, execFileSync } from "child_process";
import type { OllamaEmbeddings } from "@langchain/ollama";
// The embedding classes pull in @langchain/core and openai (~1,400 modules); load them on first use.
const loadOpenAIEmbeddings = (): typeof OpenAIEmbeddings => require("@langchain/openai").OpenAIEmbeddings;
const loadOllamaEmbeddings = (): typeof OllamaEmbeddings => require("@langchain/ollama").OllamaEmbeddings;
import fs from "fs";
import path from "path";
import os from "os";
import { PROVIDER_REGISTRY } from "./providers";
import { runNativeTool } from "./native-tool";
import type { ProviderType } from "../acp/types";

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
  const executable = process.env.EVERFERN_SHELL === 'tauri' && process.env.EF_NATIVE_EXE;
  if (executable) {
    try {
      return JSON.parse(execFileSync(executable, ['--ef-embed-query'], {
        input: JSON.stringify({ operation: 'resolve-config' }),
        encoding: 'utf8', windowsHide: true, timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'],
      }));
    } catch {
      // Retain configuration loading if the native helper is unavailable.
    }
  }
  const configDir = path.join(os.homedir(), '.everfern');
  const configPath = path.join(configDir, 'config.json');

  let provider = 'openai';
  let apiKey = process.env.OPENAI_API_KEY;
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

function getEmbeddingModelRaw(config: EmbeddingConfig): ResolvedEmbeddingModel {
  if (config.provider === 'ollama' || config.provider === 'lmstudio') {
    return {
      embeddings: new (loadOllamaEmbeddings())({
        model: config.model || 'nomic-embed-text',
        baseUrl: config.baseUrl || 'http://localhost:11434',
      }),
      dimensions: 768
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
          const url = `https://generativelanguage.googleapis.com/v1beta/${modelPath}:embedContent?key=${config.apiKey || ''}`;

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
            const url = `https://generativelanguage.googleapis.com/v1beta/${modelPath}:embedContent?key=${config.apiKey || ''}`;

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
    embeddings: new (loadOpenAIEmbeddings())({
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

/** Where Transformers.js caches the model, so Rust can reuse it instead of downloading. */
function transformersModelDir(): string | undefined {
  try {
    const root = path.dirname(path.dirname(require.resolve('@xenova/transformers')));
    return path.join(root, '.cache', 'Xenova', 'all-MiniLM-L6-v2');
  } catch {
    return undefined;
  }
}

/**
 * Local fallback for a batch of texts. Under Tauri the model runs in a short-lived
 * `--ef-embed-local` process, so its ~130 MB is freed after each call instead of
 * staying in Node. Transformers.js runs only when that is unavailable or fails.
 */
async function getLocalFallbackEmbeddings(texts: string[]): Promise<number[][]> {
  const native = await runNativeTool<{ vectors?: number[][]; error?: string }>(
    '--ef-embed-local',
    { texts, modelDir: transformersModelDir() },
    { timeoutMs: 300000 },
  );
  if (native?.vectors && native.vectors.length === texts.length) return native.vectors;
  if (native?.error) console.warn('[Embeddings] Native local embedding failed, using Transformers.js:', native.error);
  const vectors: number[][] = [];
  for (const text of texts) vectors.push(await getLocalFallbackEmbedding(text));
  return vectors;
}

async function getLocalFallbackEmbedding(text: string): Promise<number[]> {
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

function runNativeEmbedding<T>(executable: string, request: object): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const child = execFile(executable, ['--ef-embed-query'], {
      encoding: 'utf8', windowsHide: true, timeout: 120000, maxBuffer: 64 * 1024 * 1024,
    }, (error, stdout) => {
      if (error) return reject(error);
      try {
        resolve(JSON.parse(stdout));
      } catch (parseError) {
        reject(parseError);
      }
    });
    child.stdin?.on('error', reject);
    child.stdin?.end(JSON.stringify(request));
  });
}

export function getEmbeddingModel(config: EmbeddingConfig): ResolvedEmbeddingModel {
  const result = getEmbeddingModelRaw(config);

  // Wrap embeddings to guarantee 1536 dimensions
  const originalEmbedQuery = result.embeddings.embedQuery.bind(result.embeddings);
  const originalEmbedDocuments = result.embeddings.embedDocuments ? result.embeddings.embedDocuments.bind(result.embeddings) : undefined;

  result.embeddings.embedQuery = async (text: string) => {
    try {
      const executable = process.env.EVERFERN_SHELL === 'tauri' && process.env.EF_NATIVE_EXE;
      if (executable) {
        return await runNativeEmbedding<number[]>(executable, { config, text }).catch(async () => resizeAndNormalizeEmbedding(await originalEmbedQuery(text), 1536));
      }
      const vector = await originalEmbedQuery(text);
      return resizeAndNormalizeEmbedding(vector, 1536);
    } catch (err: any) {
      console.warn(`[Embeddings] Provider '${config.provider}' embedQuery failed. Falling back to local Transformers.js:`, err.message || err);
      const [fallbackVector] = await getLocalFallbackEmbeddings([text]);
      return resizeAndNormalizeEmbedding(fallbackVector, 1536);
    }
  };

  if (originalEmbedDocuments) {
    result.embeddings.embedDocuments = async (texts: string[]) => {
      try {
        const executable = process.env.EVERFERN_SHELL === 'tauri' && process.env.EF_NATIVE_EXE;
        if (executable) {
          return await runNativeEmbedding<number[][]>(executable, { config, texts })
            .catch(async () => (await originalEmbedDocuments(texts)).map(vector => resizeAndNormalizeEmbedding(vector, 1536)));
        }
        const vectors = await originalEmbedDocuments(texts);
        return vectors.map(v => resizeAndNormalizeEmbedding(v, 1536));
      } catch (err: any) {
        console.warn(`[Embeddings] Provider '${config.provider}' embedDocuments failed. Falling back to local Transformers.js:`, err.message || err);
        const fallbackVectors = await getLocalFallbackEmbeddings(texts);
        return fallbackVectors.map(vector => resizeAndNormalizeEmbedding(vector, 1536));
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
