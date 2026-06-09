/**
 * EverFern Desktop — ACP Manager (v2)
 *
 * Manages the active AI provider using the unified AIClient.
 * Loads config from ~/.everfern/config.json on startup.
 * Exposes getClient() for use by the AgentRunner.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { AIClient } from '../lib/ai-client';
import type { AIClientConfig, ProviderType } from '../lib/ai-client';
import { hydrateConfigWithIsolatedKeys, hydrateVlmApiKey } from '../lib/vlm-config';
import type { ACPStoredConfig, ProviderInfo } from './types';
import { PROVIDER_REGISTRY } from '../lib/providers';

export class ACPManager {
  private client: AIClient | null = null;
  private activeConfig: AIClientConfig | null = null;

  constructor() {
    this.loadFromStore();
  }

  // ── Store I/O ────────────────────────────────────────────────────

  private loadFromStore(): void {
    try {
      const configPath = path.join(os.homedir(), '.everfern', 'config.json');
      if (!fs.existsSync(configPath)) return;

      const raw = fs.readFileSync(configPath, 'utf-8');
      const stored = hydrateConfigWithIsolatedKeys(JSON.parse(raw) as any) as ACPStoredConfig;

      if (stored.provider) {
        this.setProvider({
          provider: stored.provider as ProviderType,
          apiKey:   stored.apiKey,
          model:    stored.model,
          vlm:      stored.vlm,
          baseUrl:  stored.baseUrl,
        });
      }
    } catch (err) {
      console.error('[ACPManager] Failed to load stored config:', err);
    }
  }

  // ── Provider Management ──────────────────────────────────────────

  /**
   * Initialize and activate a provider. Called from IPC and on startup.
   */
  setProvider(config: AIClientConfig): { ok: boolean; error?: string } {
    try {
      if ((config.provider as string) === 'local') {
        config.provider = 'ollama';
      }
      if ((config.provider as string) === 'google') {
        config.provider = 'gemini';
      }

      let vlmConfig = config.vlm;
      const defaultVlmModelForProvider = (provider: string) => {
        if (provider === 'openrouter') return 'qwen/qwen3-vl-235b-a22b-instruct';
        if (provider === 'minimax') return 'MiniMax-M3';
        if (provider === 'ollama' || provider === 'ollama-cloud') return 'qwen3-vl:235b-cloud';
        if (provider === 'openai') return 'gpt-5.5';
        if (provider === 'anthropic') return 'claude-opus-4.6';
        if (provider === 'everfern') return 'fern-1';
        return 'qwen3-vl:235b-cloud';
      };
      if (vlmConfig?.model === 'qwen3-vl:235b-instruct-cloud') {
        vlmConfig = { ...vlmConfig, model: 'qwen3-vl:235b-cloud' };
      }
      if (vlmConfig?.engine === 'cloud' && vlmConfig.provider === 'ollama' && !vlmConfig.model) {
        vlmConfig = { ...vlmConfig, model: 'qwen3-vl:235b-cloud' };
      }
      if (vlmConfig?.engine === 'cloud' && !vlmConfig.model) {
        vlmConfig = { ...vlmConfig, model: defaultVlmModelForProvider(vlmConfig.provider) };
      }
      if (
        vlmConfig?.engine === 'cloud' &&
        vlmConfig.provider === 'minimax' &&
        (!vlmConfig.baseUrl || String(vlmConfig.baseUrl).includes('ollama.com'))
      ) {
        vlmConfig = { ...vlmConfig, baseUrl: 'https://api.minimax.io/v1' };
      }
      if (vlmConfig && !vlmConfig.apiKey) {
        const hydrated = hydrateVlmApiKey({ ...config, vlm: vlmConfig } as any);
        vlmConfig = hydrated.vlm as typeof vlmConfig;
      }

      // Clean up stale baseUrl for cloud-only providers
      // These should use their hardcoded defaults from AIClient, not user-set baseUrl values
      if (vlmConfig && (vlmConfig.provider === 'everfern' || vlmConfig.provider === 'openrouter')) {
        vlmConfig = { ...vlmConfig };
        delete vlmConfig.baseUrl;
      }

      const configToSet = {
        ...config,
        vlm: vlmConfig
      };

      this.client       = new AIClient(configToSet);
      this.activeConfig = configToSet;
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[ACPManager] Failed to set provider:', msg);
      return { ok: false, error: msg };
    }
  }

  /**
   * Get the active AIClient.
   */
  getClient(): AIClient | null {
    return this.client;
  }

  /**
   * Get the active config (for IPC health-check responses).
   */
  getActiveConfig(): AIClientConfig | null {
    return this.activeConfig;
  }

  /**
   * List all known providers with their metadata.
   */
  listProviders(): ProviderInfo[] {
    return Object.values(PROVIDER_REGISTRY).map(meta => ({
      type:          meta.type,
      name:          meta.name,
      description:   meta.description,
      requiresApiKey: meta.requiresApiKey,
      defaultModel:  meta.defaultModel,
      isLocal:       meta.isLocal,
    }));
  }

  /**
   * Health-check the active provider.
   */
  async healthCheck(): Promise<{ ok: boolean; error?: string; provider?: string; latencyMs?: number }> {
    if (!this.client) {
      return { ok: false, error: 'No provider configured' };
    }
    const result = await this.client.healthCheck();
    return {
      ...result,
      provider: this.activeConfig?.provider,
    };
  }

  /**
   * List available models for the active provider.
   * Returns empty array if no provider is configured.
   */
  async listModels(): Promise<string[]> {
    if (!this.client) return [];
    return this.client.listModels();
  }

  // ── Legacy compatibility ─────────────────────────────────────────

  /**
   * @deprecated Use getClient() instead. Kept for backward compatibility.
   */
  getActiveProvider(): { chat: AIClient['chat'] } | null {
    return this.client;
  }
}

export const acpManager = new ACPManager();
