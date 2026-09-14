import { ipcMain } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { acpManager } from '../acp/manager';
import { hydrateConfigWithIsolatedKeys } from '../lib/vlm-config';

export function normalizeVlmConfig(config: any) {
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

export function normalizeConfig(config: any) {
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
      return config;
    }
    return null;
  } catch (err) {
    console.error('[Config] Error loading config:', err);
    return null;
  }
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

      if (config.apiKey && config.provider) {
        const keysDir = path.join(configDir, 'keys');
        if (!fs.existsSync(keysDir)) fs.mkdirSync(keysDir, { recursive: true });
        const keyPath = path.join(keysDir, `${config.provider}.key`);
        fs.writeFileSync(keyPath, config.apiKey.trim());
      }

      if (config.vlm?.apiKey && config.vlm?.provider) {
        const keysDir = path.join(configDir, 'keys');
        if (!fs.existsSync(keysDir)) fs.mkdirSync(keysDir, { recursive: true });
        const vlmKeyPath = path.join(keysDir, `vlm-${config.vlm.provider}.key`);
        fs.writeFileSync(vlmKeyPath, config.vlm.apiKey.trim());
      }

      const scrubbedConfig = { ...config };
      delete scrubbedConfig.apiKey;
      if (scrubbedConfig.vlm) {
        const scrubbedVlm = { ...scrubbedConfig.vlm };
        delete scrubbedVlm.apiKey;
        scrubbedConfig.vlm = scrubbedVlm;
      }
      fs.writeFileSync(configPath, JSON.stringify(scrubbedConfig, null, 2));

      if (config.provider) {
        acpManager.setProvider({
          provider: config.provider,
          apiKey: config.apiKey,
          model: scrubbedConfig.model,
          customModel: scrubbedConfig.customModel,
          baseUrl: scrubbedConfig.baseUrl,
          vlm: config.vlm,
        });
      }

      return { success: true };
    } catch (error) {
      console.error('[Config] Failed to save:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('load-config', async () => {
    try {
      const config = loadConfigSync();
      if (!config) return { success: true, config: null };
      return { success: true, config };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}
