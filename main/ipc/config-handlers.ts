import { ipcMain } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { acpManager } from '../acp/manager';
import { hydrateConfigWithIsolatedKeys } from '../lib/vlm-config';
import { redactConfigSecrets, SecretView } from '../lib/secret-redaction';
import {
  getVaultSecret,
  hydrateVaultGenericSlots,
  overlayVaultKeys,
  setVaultSecret,
} from '../lib/key-vault';

function normalizeVlmConfig(config: any) {
  if (!config?.vlm) return config;

  const vlm = { ...config.vlm };
  const defaultModelForProvider = (provider: string) => {
    if (provider === 'openrouter') return 'qwen/qwen3-vl-235b-a22b-instruct';
    if (provider === 'minimax') return 'MiniMax-M3';
    if (provider === 'ollama' || provider === 'ollama-cloud') return 'qwen3-vl:235b-cloud';
    if (provider === 'openai') return 'gpt-5.5';
    if (provider === 'anthropic') return 'claude-sonnet-4-6';
    if (provider === 'gemini') return 'gemini-3.5-flash';
    if (provider === 'everfern') return 'fern-1';
    return 'qwen3-vl:235b-cloud';
  };

  if (vlm.model === 'qwen3-vl:235b-instruct-cloud') {
    vlm.model = 'qwen3-vl:235b-cloud';
  }

  if (vlm.engine === 'cloud' && !vlm.provider) {
    vlm.provider = 'ollama';
  }

  if (vlm.engine === 'cloud' && vlm.provider === 'ollama') {
    vlm.model = vlm.model || defaultModelForProvider(vlm.provider);
    vlm.baseUrl = vlm.baseUrl || 'https://ollama.com';
  }

  if (vlm.engine === 'cloud' && !vlm.model) {
    vlm.model = defaultModelForProvider(vlm.provider);
  }

  if (
    vlm.engine === 'cloud' &&
    vlm.provider === 'minimax' &&
    (!vlm.baseUrl || String(vlm.baseUrl).includes('ollama.com'))
  ) {
    vlm.baseUrl = 'https://api.minimax.io/v1';
  }

  return { ...config, vlm };
}

function normalizeConfig(config: any) {
  if (!config) return config;

  config = normalizeVlmConfig(config);

  if (config.provider && !['ollama', 'lmstudio'].includes(config.provider)) {
    if (config.baseUrl && (config.baseUrl.includes('localhost') || config.baseUrl.includes('127.0.0.1'))) {
      delete config.baseUrl;
    }
  }

  if (config.vlm?.provider && !['ollama', 'lmstudio'].includes(config.vlm.provider)) {
    if (config.vlm.baseUrl && (config.vlm.baseUrl.includes('localhost') || config.vlm.baseUrl.includes('127.0.0.1'))) {
      delete config.vlm.baseUrl;
    }
  }

  return config;
}

export function loadConfigSync() {
  try {
    const configDir = path.join(os.homedir(), '.everfern');
    const configPath = path.join(configDir, 'config.json');
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf8');
      const config = JSON.parse(data);
      const normalizedConfig = normalizeConfig(config);
      Object.assign(config, normalizedConfig);

      if (config.vlm?.model?.includes('hf.co/Qwen/Qwen3-VL-2B-Thinking-GGUF')) {
        config.vlm.model = 'qwen3-vl:2b';
      }

      if (config.vlm && (config.vlm.provider === 'everfern' || config.vlm.provider === 'openrouter')) {
        delete config.vlm.baseUrl;
      }

      hydrateConfigWithIsolatedKeys(config, configDir);
      // MP-SEC-11: overlay vault-stored provider keys (vault wins over any
      // remaining legacy key files) + generic dotted-path slots.
      config.keys = overlayVaultKeys(config.keys || {});
      if (config.provider && config.keys[config.provider]) {
        config.apiKey = config.keys[config.provider];
      }
      hydrateVaultGenericSlots(config);
      return config;
    }
    return null;
  } catch (err) {
    console.error('[Config] Error loading config:', err);
    return null;
  }
}

// ── MP-SEC-11: merge semantics for secret-bearing fields ──────────
//
// The renderer only ever receives SecretView objects. When it saves a
// config back, any secret field may be:
//  - a plain string  → the user typed a new value; SET it ('' = clear)
//  - a SecretView with configured:true  → echo of what we sent; KEEP stored
//  - a SecretView with configured:false → explicit clear
//  - absent/undefined → field untouched; KEEP stored

function isSecretView(v: unknown): v is SecretView {
  return !!v && typeof v === 'object' && 'configured' in (v as Record<string, unknown>);
}

/** Resolve the merge outcome for one secret field. */
function mergeSecretField(
  incoming: unknown,
  stored: string | undefined
): { set: boolean; value?: string } {
  if (isSecretView(incoming)) {
    return incoming.configured ? { set: false } : { set: true, value: '' };
  }
  if (typeof incoming === 'string') {
    return { set: true, value: incoming.trim() };
  }
  return { set: false };
}

/**
 * Merge secret-shaped fields (apiKey, vlm.apiKey, voice.*, embedding.apiKey)
 * from an incoming (possibly redacted) config into the raw stored config.
 * Returns the merged RAW config — for main-process use only.
 */
function mergeConfigSecrets(incoming: any, stored: any): any {
  const merged: Record<string, any> = { ...incoming };

  // Top-level provider key.
  const topKey = mergeSecretField(incoming?.apiKey, stored?.apiKey);
  merged.apiKey = topKey.set ? topKey.value : stored?.apiKey;

  // VLM key.
  if (incoming?.vlm || stored?.vlm) {
    const vlmIn = incoming?.vlm ?? {};
    const vlmSt = stored?.vlm ?? {};
    const vlmKey = mergeSecretField(vlmIn.apiKey, vlmSt.apiKey);
    merged.vlm = { ...vlmSt, ...vlmIn };
    if (vlmKey.set) {
      merged.vlm.apiKey = vlmKey.value;
    } else {
      merged.vlm.apiKey = vlmSt.apiKey;
    }
  }

  // Voice keys.
  if (incoming?.voice || stored?.voice) {
    const voiceIn = incoming?.voice ?? {};
    const voiceSt = stored?.voice ?? {};
    merged.voice = { ...voiceSt, ...voiceIn };
    for (const field of ['deepgramKey', 'elevenlabsKey', 'apiKey'] as const) {
      const res = mergeSecretField(voiceIn[field], voiceSt[field]);
      if (res.set) merged.voice[field] = res.value;
      else if (voiceSt[field] !== undefined) merged.voice[field] = voiceSt[field];
    }
  }

  // Embedding key.
  if (incoming?.embedding || stored?.embedding) {
    const embIn = incoming?.embedding ?? {};
    const embSt = stored?.embedding ?? {};
    merged.embedding = { ...embSt, ...embIn };
    const res = mergeSecretField(embIn.apiKey, embSt.apiKey);
    if (res.set) merged.embedding.apiKey = res.value;
    else if (embSt.apiKey !== undefined) merged.embedding.apiKey = embSt.apiKey;
  }

  // The keys map never round-trips raw values; drop it entirely — raw
  // provider keys are re-derived from vault/legacy key files on load.
  delete merged.keys;

  return merged;
}

/** Fields on the config that hold secrets and must never hit config.json. */
const SECRET_CONFIG_FIELDS = ['apiKey', 'keys', 'token', 'secret', 'password'];

function isSecretBearingField(key: string): boolean {
  return SECRET_CONFIG_FIELDS.some((f) => key.toLowerCase() === f || key.toLowerCase().endsWith(`.${f}`));
}

/** Write config.json scrubbed of every secret-shaped field. */
function writeScrubbedConfig(config: any, configPath: string): void {
  const scrubbed: Record<string, any> = { ...config };
  for (const field of SECRET_CONFIG_FIELDS) delete scrubbed[field];
  if (scrubbed.vlm) {
    const vlm = { ...scrubbed.vlm };
    delete vlm.apiKey;
    scrubbed.vlm = vlm;
  }
  if (scrubbed.voice) {
    const voice = { ...scrubbed.voice };
    for (const field of SECRET_CONFIG_FIELDS) delete voice[field];
    delete voice.deepgramKey;
    delete voice.elevenlabsKey;
    scrubbed.voice = voice;
  }
  if (scrubbed.embedding) {
    const embedding = { ...scrubbed.embedding };
    delete embedding.apiKey;
    scrubbed.embedding = embedding;
  }
  fs.writeFileSync(configPath, JSON.stringify(scrubbed, null, 2));
}

export function registerConfigHandlers() {
  ipcMain.handle('save-config', async (_event, config) => {
    try {
      config = normalizeConfig(config);
      const configDir = path.join(os.homedir(), '.everfern');
      const configPath = path.join(configDir, 'config.json');

      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }

      // Merge secret fields against the stored raw config (MP-SEC-11).
      const stored = loadConfigSync();
      const merged = mergeConfigSecrets(config, stored);

      // Vault all secret fields (writes encrypted; '' clears the slot).
      if (merged.provider && typeof merged.apiKey === 'string') {
        setVaultSecret(merged.provider, merged.apiKey);
      }
      if (merged.vlm?.provider && typeof merged.vlm.apiKey === 'string') {
        setVaultSecret(`vlm-${merged.vlm.provider}`, merged.vlm.apiKey);
      }
      if (merged.voice) {
        if (typeof merged.voice.deepgramKey === 'string') {
          setVaultSecret('voice.deepgramKey', merged.voice.deepgramKey);
        }
        if (typeof merged.voice.elevenlabsKey === 'string') {
          setVaultSecret('voice.elevenlabsKey', merged.voice.elevenlabsKey);
        }
        if (typeof merged.voice.apiKey === 'string') {
          setVaultSecret('voice.apiKey', merged.voice.apiKey);
        }
      }
      if (merged.embedding && typeof merged.embedding.apiKey === 'string') {
        setVaultSecret('embedding.apiKey', merged.embedding.apiKey);
      }

      // config.json stays scrubbed of all secrets.
      writeScrubbedConfig(merged, configPath);

      if (merged.provider) {
        acpManager.setProvider({
          provider: merged.provider,
          apiKey: merged.apiKey,
          model: merged.model,
          customModel: merged.customModel,
          baseUrl: merged.baseUrl,
          vlm: merged.vlm,
        });
      }

      return { success: true };
    } catch (error) {
      console.error('[Config] Failed to save:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // MP-SEC-11: renderer receives only redacted SecretView fields.
  ipcMain.handle('load-config', async () => {
    try {
      const config = loadConfigSync();
      if (!config) return { success: true, config: null };
      return { success: true, config: redactConfigSecrets(config) };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // MP-SEC-11: narrow channel to write ONE secret without round-tripping
  // the full (raw) config through the renderer.
  ipcMain.handle('config:set-key', async (_event, slot: string, secret: string) => {
    try {
      if (!/^[A-Za-z0-9._-]{1,64}$/.test(slot)) {
        return { success: false, error: 'Invalid slot' };
      }
      if (typeof secret !== 'string') {
        return { success: false, error: 'Invalid secret' };
      }
      setVaultSecret(slot, secret);

      // If this slot is the active provider's key, refresh acpManager
      // (and persist the normalized provider selection).
      const config = loadConfigSync();
      if (config?.provider && slot === config.provider) {
        const fresh = loadConfigSync();
        if (fresh?.provider) {
          acpManager.setProvider({
            provider: fresh.provider,
            apiKey: fresh.apiKey,
            model: fresh.model,
            customModel: fresh.customModel,
            baseUrl: fresh.baseUrl,
            vlm: fresh.vlm,
          });
        }
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // MP-SEC-11: main-side provider test. The key is read from the vault
  // (or legacy key file); it is NEVER returned or logged.
  ipcMain.handle('config:test-provider', async (_event, provider: string, model?: string) => {
    try {
      const key =
        getVaultSecret(provider) ??
        getVaultSecret(`vlm-${provider}`) ??
        null;

      if (!key) {
        return { success: false, error: 'No key configured for this provider' };
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      try {
        let url: string;
        let headers: Record<string, string> = { 'Content-Type': 'application/json' };
        let body: string;

        if (provider === 'gemini') {
          // MP-SEC-19 pattern: header auth, never key-in-URL.
          url = 'https://generativelanguage.googleapis.com/v1beta/models';
          headers['x-goog-api-key'] = key;
          body = '';
        } else if (provider === 'everfern') {
          url = 'https://api.everfern.app/v1/models';
          headers.Authorization = `Bearer ${key}`;
          body = '';
        } else if (provider === 'anthropic') {
          url = 'https://api.anthropic.com/v1/models';
          headers['x-api-key'] = key;
          headers['anthropic-version'] = '2023-06-01';
          body = '';
        } else if (provider === 'minimax') {
          url = 'https://api.minimax.io/v1/models';
          headers.Authorization = `Bearer ${key}`;
          body = '';
        } else if (provider === 'ollama-cloud') {
          url = 'https://ollama.com/api/tags';
          headers.Authorization = `Bearer ${key}`;
          body = '';
        } else {
          // OpenAI-compatible: openai, deepseek, openrouter, nvidia, lmstudio…
          const base =
            provider === 'deepseek' ? 'https://api.deepseek.com' :
            provider === 'openrouter' ? 'https://openrouter.ai' :
            provider === 'nvidia' ? 'https://integrate.api.nvidia.com' :
            'https://api.openai.com';
          url = `${base}/v1/models`;
          headers.Authorization = `Bearer ${key}`;
          body = '';
        }

        const res = await fetch(url, {
          method: provider === 'anthropic' ? 'POST' : 'GET',
          headers,
          body: provider === 'anthropic' ? body : undefined,
          signal: controller.signal,
        });
        if (!res.ok) {
          // Never include response bodies (they can echo the key).
          return { success: false, error: `Provider returned ${res.status}` };
        }
        let models: string[] | undefined;
        try {
          const data = await res.json();
          const list = data?.data ?? data?.models ?? [];
          if (Array.isArray(list)) {
            models = list
              .map((m: any) => m?.id ?? m?.name ?? m?.model)
              .filter((m: unknown): m is string => typeof m === 'string');
          }
        } catch {
          /* non-JSON is fine — the request succeeded */
        }
        return { success: true, models };
      } finally {
        clearTimeout(timer);
      }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}
