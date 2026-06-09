import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

type MutableConfig = {
  provider?: string;
  apiKey?: string;
  keys?: Record<string, string>;
  vlm?: {
    provider?: string;
    apiKey?: string;
    [key: string]: any;
  } | null;
  [key: string]: any;
};

function everfernConfigDir(): string {
  return path.join(os.homedir(), '.everfern');
}

export function readIsolatedKeys(configDir = everfernConfigDir()): Record<string, string> {
  const keys: Record<string, string> = {};
  const keysDir = path.join(configDir, 'keys');
  if (!fs.existsSync(keysDir)) return keys;

  for (const file of fs.readdirSync(keysDir)) {
    if (!file.endsWith('.key')) continue;
    const baseName = file.replace(/\.key$/, '');
    const key = fs.readFileSync(path.join(keysDir, file), 'utf-8').trim();
    if (key) keys[baseName] = key;
  }

  return keys;
}

function vlmProviderAliases(provider: string): string[] {
  const aliases = new Set<string>([provider]);
  if (provider === 'ollama') aliases.add('ollama-cloud');
  if (provider === 'ollama-cloud') aliases.add('ollama');
  return Array.from(aliases);
}

export function hydrateVlmApiKey(config: MutableConfig, configDir = everfernConfigDir()): MutableConfig {
  if (!config?.vlm?.provider || config.vlm.apiKey?.trim()) return config;

  const keys = {
    ...readIsolatedKeys(configDir),
    ...(config.keys || {}),
  };
  const provider = String(config.vlm.provider);
  const aliases = vlmProviderAliases(provider);
  const candidates: string[] = [];

  if (provider === 'everfern') {
    const everfernKey = keys.everfern || (config.provider === 'everfern' ? config.apiKey : undefined);
    const vlmEverfernKey = keys['vlm-everfern'];
    if (everfernKey?.startsWith('eyJ') && (!vlmEverfernKey || !vlmEverfernKey.startsWith('eyJ'))) {
      config.vlm = { ...config.vlm, apiKey: everfernKey.trim() };
      return config;
    }
  }

  for (const alias of aliases) {
    candidates.push(`vlm-${alias}`, alias);
  }

  if (provider === config.provider && config.apiKey) {
    candidates.unshift('__active_provider__');
  }

  for (const candidate of candidates) {
    const key = candidate === '__active_provider__' ? config.apiKey : keys[candidate];
    if (key?.trim()) {
      config.vlm = { ...config.vlm, apiKey: key.trim() };
      break;
    }
  }

  return config;
}

export function hydrateConfigWithIsolatedKeys(config: MutableConfig, configDir = everfernConfigDir()): MutableConfig {
  const keys = readIsolatedKeys(configDir);
  config.keys = { ...keys };

  if (config.provider && keys[config.provider]) {
    config.apiKey = keys[config.provider];
  }

  hydrateVlmApiKey(config, configDir);
  return config;
}
