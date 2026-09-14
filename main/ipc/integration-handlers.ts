import { ipcMain } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { integrationService } from '../integrations/integration-service';
import { DiscordPlatform } from '../integrations/discord-platform';
import { TelegramPlatform } from '../integrations/telegram-platform';
import { MessageHandler } from '../integrations/message-handler';
import { acpManager } from '../acp/manager';
import { PROVIDER_REGISTRY, getModelsForProvider, formatModelName, FlatModelEntry } from '../lib/providers';
import type { ProviderType } from '../acp/types';
import { loadConfigSync } from './config-handlers';
import { loadSoul, loadAgents, saveGlobalSoul, saveGlobalAgents } from '../agent/personality-manager';

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

export const loadIntegrationConfig = (): IntegrationConfig => {
  try {
    const configPath = path.join(os.homedir(), '.everfern', 'integration-config.json');
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf8');
      const loaded = JSON.parse(data);

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

export const getIntegrationConfig = () => integrationConfig;

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
    onApproveUser: (user: { id: string; name: string; approvedAt: string }) => {
      const approvedUsers = integrationConfig.telegram.approvedUsers || [];
      if (!approvedUsers.includes(user.id)) {
        integrationConfig.telegram.approvedUsers = [...approvedUsers, user.id];
      }
      saveIntegrationConfig(integrationConfig);
      console.log('[Integration] Telegram user approved:', user);
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
      if (!integrationConfig.discord.model || !integrationConfig.discord.provider) {
        console.warn('[Integration] Discord bot is enabled but missing model/provider configuration.');
      }
      try {
        const discordPlatform = botManager.getPlatform?.('discord');
        if (!discordPlatform) {
          const platform = new DiscordPlatform({
            enabled: true,
            config: {
              botToken: integrationConfig.discord.botToken,
              applicationId: integrationConfig.discord.applicationId,
              respondToDMs: true,
              respondToGuilds: true,
              guildMentionOnly: true,
              allowedGuilds: integrationConfig.discord.allowedGuilds || [],
              allowedUsers: integrationConfig.discord.allowedUsers || []
            }
          });
          await platform.initialize();
          botManager.registerPlatform('discord', platform);
          integrationConfig.discord.connected = true;
          saveIntegrationConfig(integrationConfig);
          console.log('[Integration] Discord bot auto-started successfully');
        }
      } catch (error) {
        console.error('[Integration] Failed to auto-start Discord bot:', error);
        integrationConfig.discord.connected = false;
        saveIntegrationConfig(integrationConfig);
      }
    }

    if (integrationConfig.telegram.enabled && integrationConfig.telegram.botToken) {
      if (!integrationConfig.telegram.model || !integrationConfig.telegram.provider) {
        console.warn('[Integration] Telegram bot is enabled but missing model/provider configuration.');
      }
      try {
        const telegramPlatform = botManager.getPlatform?.('telegram');
        if (!telegramPlatform) {
          const platform = new TelegramPlatform(buildTelegramPlatformConfig(integrationConfig.telegram));
          await platform.initialize();
          botManager.registerPlatform('telegram', platform);
          integrationConfig.telegram.connected = true;
          saveIntegrationConfig(integrationConfig);
          console.log('[Integration] Telegram bot auto-started successfully');
        }
      } catch (error) {
        console.error('[Integration] Failed to auto-start Telegram bot:', error);
        integrationConfig.telegram.connected = false;
        saveIntegrationConfig(integrationConfig);
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
      messageHandlerInstance = new MessageHandler({
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



const testTelegramConnection = async (botToken: string): Promise<{ success: boolean; username?: string }> => {
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
      integrationConfig = {
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
      saveIntegrationConfig(integrationConfig);

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
          messageHandlerInstance = new MessageHandler({
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
          const newPlatform = new DiscordPlatform({
            enabled: true,
            config: {
              botToken: integrationConfig.discord.botToken,
              applicationId: integrationConfig.discord.applicationId,
              respondToDMs: true,
              respondToGuilds: true,
              guildMentionOnly: true,
              allowedGuilds: integrationConfig.discord.allowedGuilds || [],
              allowedUsers: integrationConfig.discord.allowedUsers || []
            }
          });
          await newPlatform.initialize();
          botManager.registerPlatform('discord', newPlatform);
        }

        const telegramPlatform = botManager.getPlatform?.('telegram');
        if (telegramPlatform && integrationConfig.telegram.enabled) {
          await telegramPlatform.disconnect();
          const newPlatform = new TelegramPlatform(buildTelegramPlatformConfig(integrationConfig.telegram));
          await newPlatform.initialize();
          botManager.registerPlatform('telegram', newPlatform);
        }
      }
    } catch (error) {
      console.error('[Integration] Failed to save configuration:', error);
      throw error;
    }
  });

  ipcMain.handle('integration:test-connection', async (_event, platform: string): Promise<boolean> => {
    try {
      let result = false;

      if (platform === 'telegram') {
        const testRes = await testTelegramConnection(integrationConfig.telegram.botToken);
        result = testRes.success;
        if (testRes.username) {
          integrationConfig.telegram.botUsername = testRes.username;
        }
      } else if (platform === 'discord') {
        const testRes = await testDiscordConnection(
          integrationConfig.discord.botToken,
          integrationConfig.discord.applicationId
        );
        result = testRes.success;
      } else {
        return false;
      }

      if (platform === 'telegram') {
        integrationConfig.telegram.connected = result;
      } else if (platform === 'discord') {
        integrationConfig.discord.connected = result;
      }

      saveIntegrationConfig(integrationConfig);

      if (result) {
        const botManager = integrationService.getService<any>('bot-integration-manager');
        if (botManager) {
          try {
            if (platform === 'discord' && integrationConfig.discord.enabled) {
              const existingPlatform = botManager.getPlatform?.('discord');
              if (!existingPlatform) {
                const discordPlatform = new DiscordPlatform({
                  enabled: true,
                  config: {
                    botToken: integrationConfig.discord.botToken,
                    applicationId: integrationConfig.discord.applicationId,
                    respondToDMs: true,
                    respondToGuilds: true,
                    guildMentionOnly: true,
                    allowedGuilds: integrationConfig.discord.allowedGuilds || [],
                    allowedUsers: integrationConfig.discord.allowedUsers || []
                  }
                });
                await discordPlatform.initialize();
                botManager.registerPlatform('discord', discordPlatform);
              }
            } else if (platform === 'telegram' && integrationConfig.telegram.enabled) {
              const existingPlatform = botManager.getPlatform?.('telegram');
              if (!existingPlatform) {
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
      if (platform === 'telegram') {
        integrationConfig.telegram.connected = false;
      } else if (platform === 'discord') {
        integrationConfig.discord.connected = false;
      }
      saveIntegrationConfig(integrationConfig);
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
    return {
      soul: loadSoul(workspaceRoot),
      agents: loadAgents(workspaceRoot)
    };
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
