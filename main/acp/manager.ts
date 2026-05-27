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

      const raw    = fs.readFileSync(configPath, 'utf-8');
      const stored = JSON.parse(raw) as ACPStoredConfig;

      if (stored.provider) {
        let actualApiKey = stored.apiKey;
        const keyPath = path.join(os.homedir(), '.everfern', 'keys', `${stored.provider}.key`);
        if (fs.existsSync(keyPath)) {
          actualApiKey = fs.readFileSync(keyPath, 'utf-8').trim();
        }

        // Load VLM API key from isolated key file (vlm-<provider>.key)
        let vlmConfig = stored.vlm;
        if (vlmConfig?.provider) {
          const vlmKeyPath = path.join(os.homedir(), '.everfern', 'keys', `vlm-${vlmConfig.provider}.key`);
          const providerKeyPath = path.join(os.homedir(), '.everfern', 'keys', `${vlmConfig.provider}.key`);
          
          let vlmKey = '';
          if (fs.existsSync(vlmKeyPath)) {
            vlmKey = fs.readFileSync(vlmKeyPath, 'utf-8').trim();
          }

          // Always prioritize/fallback to the main everfern.key (raw JWT) if VLM is everfern
          if (vlmConfig.provider === 'everfern') {
            const everfernKeyPath = path.join(os.homedir(), '.everfern', 'keys', 'everfern.key');
            if (fs.existsSync(everfernKeyPath)) {
              const efKey = fs.readFileSync(everfernKeyPath, 'utf-8').trim();
              // If main key is a JWT, use it as priority or fallback
              if (efKey.startsWith('eyJ')) {
                if (!vlmKey.startsWith('eyJ') || vlmKey === '') {
                  vlmKey = efKey;
                }
              }
            }
          }

          if (vlmKey) {
            vlmConfig = { ...vlmConfig, apiKey: vlmKey };
          } else if (fs.existsSync(providerKeyPath)) {
            vlmConfig = { ...vlmConfig, apiKey: fs.readFileSync(providerKeyPath, 'utf-8').trim() };
          } else if (vlmConfig.provider === stored.provider) {
            vlmConfig = { ...vlmConfig, apiKey: actualApiKey };
          }
        }

        this.setProvider({
          provider: stored.provider as ProviderType,
          apiKey:   actualApiKey,
          model:    stored.model,
          vlm:      vlmConfig,
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
      if (vlmConfig && !vlmConfig.apiKey) {
        if (vlmConfig.provider === config.provider) {
          vlmConfig = { ...vlmConfig, apiKey: config.apiKey };
        } else {
          // Attempt to load from disk if different from main provider
          const providerKeyPath = path.join(os.homedir(), '.everfern', 'keys', `${vlmConfig.provider}.key`);
          const vlmKeyPath = path.join(os.homedir(), '.everfern', 'keys', `vlm-${vlmConfig.provider}.key`);
          
          if (fs.existsSync(vlmKeyPath)) {
            vlmConfig = { ...vlmConfig, apiKey: fs.readFileSync(vlmKeyPath, 'utf-8').trim() };
          } else if (fs.existsSync(providerKeyPath)) {
            vlmConfig = { ...vlmConfig, apiKey: fs.readFileSync(providerKeyPath, 'utf-8').trim() };
          }
        }
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
