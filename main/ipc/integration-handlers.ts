import { ipcMain } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { execFile, execFileSync } from 'child_process';
import { integrationService } from '../integrations/integration-service';
import type { DiscordPlatform } from '../integrations/discord-platform';
import type { TelegramPlatform } from '../integrations/telegram-platform';
import type { MessageHandler } from '../integrations/message-handler';
import { acpManager } from '../acp/manager';
import { PROVIDER_REGISTRY, getModelsForProvider, formatModelName, FlatModelEntry } from '../lib/providers';
import type { ProviderType } from '../acp/types';
import { loadConfigSync } from './config-handlers';
import { loadPersonalityConfigs, saveGlobalSoul, saveGlobalAgents } from '../agent/personality-manager';

export interface IntegrationConfig {
  telegram: {
    enabled: boolean;
    botToken: string;
    connected: boolean;
    model?: string;
    provider?: string;
    requireApproval?: boolean;
    approvalCode?: string;
    approvedUsers?: string[];
    botUsername?: string;
  };
  discord: {
    enabled: boolean;
    botToken: string;
    applicationId: string;
    connected: boolean;
    model?: string;
    provider?: string;
    allowedGuilds?: string[];
    allowedUsers?: string[];
  };
}

let integrationConfig: IntegrationConfig = {
  telegram: {
    enabled: false,
    botToken: '',
    connected: false,
    requireApproval: true,
    approvalCode: '',
    approvedUsers: [],
  },
  discord: {
    enabled: false,
    botToken: '',
    applicationId: '',
    connected: false,
  },
};

let messageHandlerInstance: MessageHandler | null = null;

// Load the agent-heavy MessageHandler only when a bot is actually configured.
function createMessageHandler(options: any): MessageHandler {
  const { MessageHandler } = require('../integrations/message-handler') as typeof import('../integrations/message-handler');
  return new MessageHandler(options);
}

// Integration services are deferred at startup when no bot is configured;
// initialize them on demand the first time the user touches an integration.
async function ensureIntegrationInitialized(): Promise<void> {
  await integrationService.initialize();
}

type IntegrationConfigUpdate = { [Platform in keyof IntegrationConfig]?: Partial<IntegrationConfig[Platform]> };

type IntegrationTestResult = {
  platform: 'telegram' | 'discord';
  token: string;
  applicationId?: string;
  success: boolean;
  username?: string;
};

function nativeIntegrationStore(channel: 'integration:load-resolved' | 'integration:save' | 'integration:merge-and-save' | 'integration:commit-test-result', config?: IntegrationConfig | { update: IntegrationConfigUpdate } | IntegrationTestResult): IntegrationConfig | null | undefined {
  const executable = process.env.EF_NATIVE_EXE;
  if (process.env.EVERFERN_SHELL !== 'tauri' || !executable) return undefined;
  return JSON.parse(execFileSync(executable, ['--ef-integration-store'], {
    encoding: 'utf8',
    input: JSON.stringify({ channel, config }),
    windowsHide: true,
  }));
}

export const loadIntegrationConfig = (): IntegrationConfig => {
  try {
    const configPath = path.join(os.homedir(), '.everfern', 'integration-config.json');
    const native = nativeIntegrationStore('integration:load-resolved');
    if (native) return native;
    const loaded = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : null;
    if (loaded) {

      return {
        telegram: {
          ...integrationConfig.telegram,
          ...loaded.telegram,
        },
        discord: {
          ...integrationConfig.discord,
          ...loaded.discord,
        },
      };
    }
  } catch (error) {
    console.warn('[Integration] Failed to load config:', error);
  }
  return integrationConfig;
};

export const saveIntegrationConfig = (config: IntegrationConfig): void => {
  try {
    if (nativeIntegrationStore('integration:save', config) !== undefined) return;
    const configDir = path.join(os.homedir(), '.everfern');
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    const configPath = path.join(configDir, 'integration-config.json');
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  } catch (error) {
    console.error('[Integration] Failed to save config:', error);
    throw error;
  }
};

function saveConnectionResult(result: IntegrationTestResult): boolean {
  const { platform, token, applicationId, success, username } = result;
  if (integrationConfig[platform].botToken !== token ||
      (platform === 'discord' && integrationConfig.discord.applicationId !== applicationId)) {
    return false;
  }
  const native = nativeIntegrationStore('integration:commit-test-result', result);
  if (native === null) return false;
  if (native) {
    integrationConfig = native;
  } else {
    integrationConfig[platform].connected = success;
    if (platform === 'telegram' && username) integrationConfig.telegram.botUsername = username;
    saveIntegrationConfig(integrationConfig);
  }
  return true;
}

export const getIntegrationConfig = () => integrationConfig;

function authorizeDiscordMessage(token: string) {
  const executable = process.env.EF_NATIVE_EXE;
  if (process.env.EVERFERN_SHELL !== 'tauri' || !executable) return undefined;
  return (id: string, direct: boolean, mentioned: boolean, guildId?: string) => new Promise<boolean>(resolve => {
    const child = execFile(executable, ['--ef-integration-store'], {
      encoding: 'utf8', windowsHide: true, timeout: 5000,
    }, (error, output) => resolve(!error && output.trim() === 'true'));
    child.stdin?.once('error', () => resolve(false));
    child.stdin?.end(JSON.stringify({
      channel: 'integration:authorize-discord-message', config: { token, id, direct, mentioned, guildId },
    }));
  });
}

export const buildTelegramPlatformConfig = (telegramConfig: IntegrationConfig['telegram']) => ({
  enabled: true,
  config: {
    botToken: telegramConfig.botToken,
    botUsername: telegramConfig.botUsername,
    respondToGroups: true,
    groupMentionOnly: false,
    requireApproval: telegramConfig.requireApproval !== false,
    approvalCode: telegramConfig.approvalCode || '',
    approvedUsers: telegramConfig.approvedUsers || [],
    authorizeMessage: process.env.EVERFERN_SHELL === 'tauri' && process.env.EF_NATIVE_EXE
      ? (id: string, message: string) => new Promise<'allowed' | 'paired' | 'denied'>(resolve => {
        const child = execFile(process.env.EF_NATIVE_EXE!, ['--ef-integration-store'], {
          encoding: 'utf8', windowsHide: true, timeout: 5000,
        }, (error, output) => {
          const result = output.trim();
          resolve(error ? 'denied' : result === '"allowed"' ? 'allowed' : result === '"paired"' ? 'paired' : 'denied');
        });
        child.stdin?.once('error', () => resolve('denied'));
        child.stdin?.end(JSON.stringify({
          channel: 'integration:authorize-telegram-message', config: { id, token: telegramConfig.botToken, message },
        }));
      })
      : undefined,
    onApproveUser: (user: { id: string; name: string; approvedAt: string }) => {
      const approvedUsers = integrationConfig.telegram.approvedUsers || [];
      if (!approvedUsers.includes(user.id)) {
        integrationConfig.telegram.approvedUsers = [...approvedUsers, user.id];
      }
      saveIntegrationConfig(integrationConfig);
      console.log('[Integration] Telegram user approved:', user);
      return true;
    }
  }
});

export async function autoStartEnabledBots(): Promise<void> {
  try {
    console.log('[Integration] Checking for bots to auto-start...');
    const botManager = integrationService.getService<any>('bot-integration-manager');
    if (!botManager) {
      console.warn('[Integration] Bot integration manager not available');
      return;
    }

    if (integrationConfig.discord.enabled && integrationConfig.discord.botToken) {
      const { botToken: token, applicationId } = integrationConfig.discord;
      if (!integrationConfig.discord.model || !integrationConfig.discord.provider) {
        console.warn('[Integration] Discord bot is enabled but missing model/provider configuration.');
      }
      try {
        const discordPlatform = botManager.getPlatform?.('discord');
        if (!discordPlatform) {
          const { DiscordPlatform } = require('../integrations/discord-platform') as typeof import('../integrations/discord-platform');
          const platform = new DiscordPlatform({
            enabled: true,
            config: {
              botToken: integrationConfig.discord.botToken,
              applicationId: integrationConfig.discord.applicationId,
              respondToDMs: true,
              respondToGuilds: true,
              guildMentionOnly: true,
              allowedGuilds: integrationConfig.discord.allowedGuilds || [],
              allowedUsers: integrationConfig.discord.allowedUsers || [],
              authorizeMessage: authorizeDiscordMessage(integrationConfig.discord.botToken)
            }
          });
          await platform.initialize();
          botManager.registerPlatform('discord', platform);
          saveConnectionResult({ platform: 'discord', token, applicationId, success: true });
          console.log('[Integration] Discord bot auto-started successfully');
        }
      } catch (error) {
        console.error('[Integration] Failed to auto-start Discord bot:', error);
        saveConnectionResult({ platform: 'discord', token, applicationId, success: false });
      }
    }

    if (integrationConfig.telegram.enabled && integrationConfig.telegram.botToken) {
      const token = integrationConfig.telegram.botToken;
      if (!integrationConfig.telegram.model || !integrationConfig.telegram.provider) {
        console.warn('[Integration] Telegram bot is enabled but missing model/provider configuration.');
      }
      try {
        const telegramPlatform = botManager.getPlatform?.('telegram');
        if (!telegramPlatform) {
          const { TelegramPlatform } = require('../integrations/telegram-platform') as typeof import('../integrations/telegram-platform');
          const platform = new TelegramPlatform(buildTelegramPlatformConfig(integrationConfig.telegram));
          await platform.initialize();
          botManager.registerPlatform('telegram', platform);
          saveConnectionResult({ platform: 'telegram', token, success: true });
          console.log('[Integration] Telegram bot auto-started successfully');
        }
      } catch (error) {
        console.error('[Integration] Failed to auto-start Telegram bot:', error);
        saveConnectionResult({ platform: 'telegram', token, success: false });
      }
    }
  } catch (error) {
    console.error('[Integration] Error during auto-start:', error);
  }
}

export async function initializeBotMessageHandler(): Promise<MessageHandler | null> {
  try {
    const botManager = integrationService.getService<any>('bot-integration-manager');
    if (!botManager) return null;

    const hasConfiguredBot =
      (integrationConfig.discord.enabled && !!integrationConfig.discord.botToken) ||
      (integrationConfig.telegram.enabled && !!integrationConfig.telegram.botToken);

    if (hasConfiguredBot) {
      if (messageHandlerInstance) {
        await messageHandlerInstance.shutdown();
      }
      messageHandlerInstance = createMessageHandler({
        integrationConfig,
        acpManager,
        botManager
      });
      return messageHandlerInstance;
    }
  } catch (err) {
    console.error('[Integration] Failed to initialize MessageHandler:', err);
  }
  return null;
}

export async function shutdownBotMessageHandler(): Promise<void> {
  if (messageHandlerInstance) {
    try {
      console.log('[Integration] Shutting down MessageHandler...');
      await messageHandlerInstance.shutdown();
      messageHandlerInstance = null;
      console.log('[Integration] MessageHandler shutdown complete');
    } catch (err) {
      console.error('[Integration] Error shutting down MessageHandler:', err);
    }
  }
}



function testNativeConnection<T extends { success: boolean }>(platform: string, token: string, applicationId?: string): Promise<T | { success: false }> | undefined {
  const executable = process.env.EF_NATIVE_EXE;
  if (process.env.EVERFERN_SHELL !== 'tauri' || !executable) return undefined;
  return new Promise(resolve => {
    const child = execFile(executable, ['--ef-integration-test'], { windowsHide: true, timeout: 20000 }, (error, stdout) => {
      if (error) return resolve({ success: false });
      try { resolve(JSON.parse(stdout)); } catch { resolve({ success: false }); }
    });
    child.stdin?.once('error', () => resolve({ success: false }));
    child.stdin?.end(JSON.stringify({ platform, token, applicationId }));
  });
}

const testTelegramConnection = async (botToken: string): Promise<{ success: boolean; username?: string }> => {
  const native = testNativeConnection<{ success: boolean; username?: string }>('telegram', botToken);
  if (native) return native;
  try {
    if (!botToken || !botToken.trim()) return { success: false };

    const response = await fetch(`https://api.telegram.org/bot${botToken}/getMe`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) return { success: false };

    const data = await response.json();
    if (data.ok && data.result) {
      return { success: true, username: data.result.username };
    }
    return { success: false };
  } catch (error) {
    console.error('[Integration] Telegram connection test failed:', error);
    return { success: false };
  }
};

const testDiscordConnection = async (botToken: string, applicationId: string): Promise<{ success: boolean; name?: string }> => {
  const native = testNativeConnection<{ success: boolean; name?: string }>('discord', botToken, applicationId);
  if (native) return native;
  try {
    if (!botToken || !botToken.trim() || !applicationId || !applicationId.trim()) {
      return { success: false };
    }

    const response = await fetch(`https://discord.com/api/v10/applications/${applicationId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bot ${botToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) return { success: false };

    const data = await response.json();
    if (data.id && data.name) {
      return { success: true, name: data.name };
    }
    return { success: false };
  } catch (error) {
    console.error('[Integration] Discord connection test failed:', error);
    return { success: false };
  }
};

export function registerIntegrationHandlers() {
  integrationConfig = loadIntegrationConfig();

  ipcMain.handle('integration:get-config', (): Promise<IntegrationConfig> => {
    return Promise.resolve(integrationConfig);
  });

  ipcMain.handle('integration:save-config', async (_event, config: IntegrationConfig): Promise<void> => {
    try {
      const native = nativeIntegrationStore('integration:merge-and-save', { update: config });
      integrationConfig = native ?? {
        telegram: {
          ...integrationConfig.telegram,
          ...config.telegram,
          requireApproval: config.telegram?.requireApproval ?? integrationConfig.telegram.requireApproval ?? true,
          approvalCode: config.telegram?.approvalCode ?? integrationConfig.telegram.approvalCode ?? '',
          approvedUsers: config.telegram?.approvedUsers ?? integrationConfig.telegram.approvedUsers ?? [],
        },
        discord: {
          ...integrationConfig.discord,
          ...config.discord,
        },
      };
      if (!native) saveIntegrationConfig(integrationConfig);
      await applyIntegrationConfig();
    } catch (error) {
      console.error('[Integration] Failed to save configuration:', error);
      throw error;
    }
  });

  ipcMain.handle('integration:apply-saved-config', async () => {
    const saved = nativeIntegrationStore('integration:load-resolved');
    if (!saved) throw new Error('Failed to reload saved integration configuration');
    integrationConfig = saved;
    await applyIntegrationConfig();
  });

  async function applyIntegrationConfig() {
      await ensureIntegrationInitialized();
      const botManager = integrationService.getService<any>('bot-integration-manager');
      if (botManager) {
        const hasConfiguredBot =
          (integrationConfig.discord.enabled && !!integrationConfig.discord.botToken) ||
          (integrationConfig.telegram.enabled && !!integrationConfig.telegram.botToken);

        if (hasConfiguredBot) {
          if (messageHandlerInstance) {
            await messageHandlerInstance.shutdown();
            messageHandlerInstance = null;
          }
          messageHandlerInstance = createMessageHandler({
            integrationConfig,
            acpManager,
            botManager
          });
        } else if (messageHandlerInstance) {
          await messageHandlerInstance.shutdown();
          messageHandlerInstance = null;
        }

        const discordPlatform = botManager.getPlatform?.('discord');
        if (discordPlatform && integrationConfig.discord.enabled) {
          await discordPlatform.disconnect();
          const { DiscordPlatform } = require('../integrations/discord-platform') as typeof import('../integrations/discord-platform');
          const newPlatform = new DiscordPlatform({
            enabled: true,
            config: {
              botToken: integrationConfig.discord.botToken,
              applicationId: integrationConfig.discord.applicationId,
              respondToDMs: true,
              respondToGuilds: true,
              guildMentionOnly: true,
              allowedGuilds: integrationConfig.discord.allowedGuilds || [],
              allowedUsers: integrationConfig.discord.allowedUsers || [],
              authorizeMessage: authorizeDiscordMessage(integrationConfig.discord.botToken)
            }
          });
          await newPlatform.initialize();
          botManager.registerPlatform('discord', newPlatform);
        }

        const telegramPlatform = botManager.getPlatform?.('telegram');
        if (telegramPlatform && integrationConfig.telegram.enabled) {
          await telegramPlatform.disconnect();
          const { TelegramPlatform } = require('../integrations/telegram-platform') as typeof import('../integrations/telegram-platform');
          const newPlatform = new TelegramPlatform(buildTelegramPlatformConfig(integrationConfig.telegram));
          await newPlatform.initialize();
          botManager.registerPlatform('telegram', newPlatform);
        }
      }
  }

  ipcMain.handle('integration:test-connection', async (_event, platform: string): Promise<boolean> => {
    if (platform !== 'telegram' && platform !== 'discord') return false;
    const token = integrationConfig[platform].botToken;
    const applicationId = platform === 'discord' ? integrationConfig.discord.applicationId : undefined;
    try {
      let result = false;
      let username: string | undefined;

      if (platform === 'telegram') {
        const testRes = await testTelegramConnection(token);
        result = testRes.success;
        username = testRes.username;
      } else {
        result = (await testDiscordConnection(token, applicationId ?? '')).success;
      }

      if (!saveConnectionResult({ platform, token, applicationId, success: result, username })) return false;

      if (result) {
        await ensureIntegrationInitialized();
        const botManager = integrationService.getService<any>('bot-integration-manager');
        if (botManager) {
          try {
            if (platform === 'discord' && integrationConfig.discord.enabled) {
              const existingPlatform = botManager.getPlatform?.('discord');
              if (!existingPlatform) {
                const { DiscordPlatform } = require('../integrations/discord-platform') as typeof import('../integrations/discord-platform');
                const discordPlatform = new DiscordPlatform({
                  enabled: true,
                  config: {
                    botToken: integrationConfig.discord.botToken,
                    applicationId: integrationConfig.discord.applicationId,
                    respondToDMs: true,
                    respondToGuilds: true,
                    guildMentionOnly: true,
                    allowedGuilds: integrationConfig.discord.allowedGuilds || [],
                    allowedUsers: integrationConfig.discord.allowedUsers || [],
                    authorizeMessage: authorizeDiscordMessage(integrationConfig.discord.botToken)
                  }
                });
                await discordPlatform.initialize();
                botManager.registerPlatform('discord', discordPlatform);
              }
            } else if (platform === 'telegram' && integrationConfig.telegram.enabled) {
              const existingPlatform = botManager.getPlatform?.('telegram');
              if (!existingPlatform) {
                const { TelegramPlatform } = require('../integrations/telegram-platform') as typeof import('../integrations/telegram-platform');
                const telegramPlatform = new TelegramPlatform(buildTelegramPlatformConfig(integrationConfig.telegram));
                await telegramPlatform.initialize();
                botManager.registerPlatform('telegram', telegramPlatform);
              }
            }
          } catch (startError) {
            console.error(`[Integration] Failed to start ${platform} bot:`, startError);
          }
        }
      }

      return result;
    } catch (error) {
      console.error(`[Integration] Connection test failed for ${platform}:`, error);
      saveConnectionResult({ platform, token, applicationId, success: false });
      return false;
    }
  });

  ipcMain.handle('integration:get-service-status', (_event, serviceName?: string) => {
    try {
      return integrationService.getServiceStatus(serviceName);
    } catch (error) {
      return { name: serviceName || 'unknown', status: 'error', error: String(error) };
    }
  });

  ipcMain.handle('integration:get-system-status', () => {
    try {
      return integrationService.getSystemStatus();
    } catch (error) {
      return {
        initialized: false,
        started: false,
        servicesRunning: 0,
        servicesTotal: 0,
        errors: [String(error)]
      };
    }
  });

  ipcMain.handle('integration:start-service', async (_event, serviceName: string) => {
    try {
      await ensureIntegrationInitialized();
      const service = integrationService.getService(serviceName);
      if (service && typeof service.start === 'function') {
        await service.start();
        return { success: true };
      }
      return { success: false, error: 'Service not found or not startable' };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('integration:stop-service', async (_event, serviceName: string) => {
    try {
      await ensureIntegrationInitialized();
      const service = integrationService.getService(serviceName);
      if (service && typeof service.stop === 'function') {
        await service.stop();
        return { success: true };
      }
      return { success: false, error: 'Service not found or not stoppable' };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('integration:restart-service', async (_event, serviceName: string) => {
    try {
      await ensureIntegrationInitialized();
      const service = integrationService.getService(serviceName);
      if (service) {
        if (typeof service.stop === 'function') await service.stop();
        if (typeof service.start === 'function') await service.start();
        return { success: true };
      }
      return { success: false, error: 'Service not found' };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('providers:get-all', () => {
    const providers = Object.values(PROVIDER_REGISTRY);
    const providersWithStatus = providers.map((provider) => {
      let enabled = true;
      if (provider.requiresApiKey) {
        try {
          const config = loadConfigSync();
          if (config && config.keys) {
            const apiKey = config.keys[provider.type];
            enabled = !!apiKey && apiKey.trim().length > 0;
          } else {
            enabled = false;
          }
        } catch {
          enabled = false;
        }
      }
      return { ...provider, enabled };
    });
    return providersWithStatus;
  });

  ipcMain.handle('providers:get-models', (_event, providerType: string): FlatModelEntry[] => {
    const type = providerType as ProviderType;
    const models = getModelsForProvider(type);
    const providerMeta = PROVIDER_REGISTRY[type];

    return models.map(modelId => ({
      id: modelId,
      name: formatModelName(modelId),
      provider: providerMeta?.name || providerType,
      providerType: type
    }));
  });

  ipcMain.handle('openclaw:get-configs', (_event, workspaceRoot?: string) => {
    return loadPersonalityConfigs(workspaceRoot);
  });

  ipcMain.handle('openclaw:save-configs', (_event, configs: { soul?: string; agents?: string; workspaceRoot?: string }) => {
    try {
      if (configs.workspaceRoot) {
        const fs = require('fs');
        const path = require('path');
        if (configs.soul !== undefined) {
          fs.writeFileSync(path.join(configs.workspaceRoot, 'SOUL.md'), configs.soul, 'utf-8');
        }
        if (configs.agents !== undefined) {
          fs.writeFileSync(path.join(configs.workspaceRoot, 'agents.md'), configs.agents, 'utf-8');
        }
      } else {
        if (configs.soul !== undefined) saveGlobalSoul(configs.soul);
        if (configs.agents !== undefined) saveGlobalAgents(configs.agents);
      }
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });
}
