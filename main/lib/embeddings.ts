import { OpenAIEmbeddings } from "@langchain/openai";
import { OllamaEmbeddings } from "@langchain/ollama";
import fs from "fs";
import path from "path";
import os from "os";
import { PROVIDER_REGISTRY } from "./providers";
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

      if (config.keys && config.keys[provider]) {
        apiKey = config.keys[provider];
      } else {
        const keyPath = path.join(configDir, 'keys', `${provider}.key`);
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

export function getEmbeddingModel(config: EmbeddingConfig): ResolvedEmbeddingModel {
  if (config.provider === 'ollama' || config.provider === 'lmstudio') {
    return {
      embeddings: new OllamaEmbeddings({
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
          model: config.model || "qwen/qwen3-embedding-8b"
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
