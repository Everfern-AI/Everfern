/**
 * Discord Platform Integration
 *
 * This module implements the Discord bot integration for EverFern using
 * the Discord.js library for bot functionality.
 */

import {
  Client,
  GatewayIntentBits,
  Message,
  TextChannel,
  DMChannel,
  ChannelType,
  AttachmentBuilder,
  ActivityType,
  Partials
} from 'discord.js';
import { promises as fs } from 'fs';
import {
  MessagePlatform,
  IncomingMessage,
  PlatformFile,
  SendOptions,
  PlatformStatus,
  PlatformConfig,
  PlatformConnectionError,
  PlatformAuthError,
  PlatformRateLimitError
} from './platform-interface';

/**
 * Discord-specific configuration
 */
export interface DiscordConfig extends PlatformConfig {
  config: {
    /** Bot token from Discord Developer Portal */
    botToken: string;
    /** Application ID from Discord Developer Portal */
    applicationId: string;
    /** Bot client ID (same as application ID usually) */
    clientId?: string;
    /** Allowed guild IDs (empty = all allowed) */
    allowedGuilds?: string[];
    /** Allowed channel IDs (empty = all allowed) */
    allowedChannels?: string[];
    /** Allowed user IDs (empty = all allowed) */
    allowedUsers?: string[];
    /** Whether to respond to DMs */
    respondToDMs?: boolean;
    /** Whether to respond to guild messages */
    respondToGuilds?: boolean;
    /** Whether to respond only to mentions in guilds */
    guildMentionOnly?: boolean;
    /** Bot status message */
    statusMessage?: string;
  };
}

/**
 * Discord platform implementation
 */
export class DiscordPlatform extends MessagePlatform {
  private client: Client | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 5000; // 5 seconds
  private messageCreateEventCount = 0; // Track messageCreate events for debugging
  private processedMessageIds = new Set<string>(); // Track processed messages to avoid duplicates

  constructor(config: DiscordConfig) {
    super('discord', config);
  }

  /**
   * Initialize the Discord bot connection
   */
  async initialize(): Promise<void> {
    const discordConfig = this.config as DiscordConfig;

    if (!discordConfig.config.botToken) {
      throw new PlatformAuthError('discord', 'Bot token is required');
    }

    try {
      // Create Discord client with necessary intents and partials for DM support
      this.client = new Client({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMessages,
          GatewayIntentBits.MessageContent,
          GatewayIntentBits.DirectMessages,
          GatewayIntentBits.DirectMessageReactions,
          GatewayIntentBits.DirectMessageTyping,
          GatewayIntentBits.GuildMembers
        ],
        partials: [Partials.Channel, Partials.Message, Partials.User] // Required for DM channels, messages, and users
      });

      // Set up event handlers
      this.setupEventHandlers();

      // Login to Discord
      await this.client.login(discordConfig.config.botToken);

      // Wait for ready event
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Discord client ready timeout'));
        }, 30000);

        this.client!.once('ready', () => {
          clearTimeout(timeout);
          resolve();
        });

        this.client!.once('error', (error: Error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });

      // Set bot status
      if (discordConfig.config.statusMessage && this.client.user) {
        this.client.user.setActivity(discordConfig.config.statusMessage, {
          type: ActivityType.Playing
        });
      }

      // Verify DM configuration
      console.log(`[Discord] ✅ Bot initialized successfully`);
      console.log(`[Discord] DM responses enabled: ${discordConfig.config.respondToDMs !== false}`);
      console.log(`[Discord] Guild responses enabled: ${discordConfig.config.respondToGuilds !== false}`);
      console.log(`[Discord] Guild mention only: ${discordConfig.config.guildMentionOnly === true}`);

      console.log(`[Discord] ⚠️  IMPORTANT: Ensure the following are enabled in Discord Developer Portal:`);
      console.log(`[Discord]     1. MESSAGE CONTENT INTENT must be enabled`);
      console.log(`[Discord]     2. Bot must have 'Send Messages' permission`);
      console.log(`[Discord]     3. Users must share a server with the bot to send DMs`);

      // Test if the bot can receive DMs by logging the user's DM channel capability
      if (this.client.user) {
        console.log(`[Discord] Bot user ID: ${this.client.user.id}`);
        console.log(`[Discord] Bot username: ${this.client.user.username}`);
        console.log(`[Discord] Bot discriminator: ${this.client.user.discriminator}`);
        console.log(`[Discord] Bot can receive DMs: enabled by default`);

        // Log the actual intents to verify they're correct
        console.log(`[Discord] Active intents: ${this.client.options.intents}`);
        console.log(`[Discord] Active partials: ${JSON.stringify(this.client.options.partials)}`);

        // Check if DirectMessages intent is included
        const hasDirectMessages = (this.client.options.intents as any) & GatewayIntentBits.DirectMessages;
        const hasMessageContent = (this.client.options.intents as any) & GatewayIntentBits.MessageContent;
        console.log(`[Discord] DirectMessages intent active: ${!!hasDirectMessages}`);
        console.log(`[Discord] MessageContent intent active: ${!!hasMessageContent}`);
      }

      this.reconnectAttempts = 0;
      this.emitStatusChange({
        connected: true,
        lastConnected: new Date(),
        details: {
          botId: this.client.user?.id,
          botUsername: this.client.user?.username,
          guildCount: this.client.guilds.cache.size
        }
      });

    } catch (error) {
      const errorMessage = (error as Error).message || 'Unknown error';

      if ((error as any).code === 'TOKEN_INVALID') {
        throw new PlatformAuthError('discord', 'Invalid bot token');
      } else if ((error as any).code === 'DISALLOWED_INTENTS') {
        throw new PlatformAuthError('discord', 'Bot missing required intents');
      } else {
        throw new PlatformConnectionError('discord', errorMessage, error);
      }
    }
  }

  /**
   * Disconnect from Discord
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      try {
        await this.client.destroy();
        this.client = null;

        this.emitStatusChange({
          connected: false,
          details: { disconnectedAt: new Date() }
        });
      } catch (error) {
        console.error('Error disconnecting from Discord:', error);
      }
    }
  }

  /**
   * Send a message to Discord
   */
  async sendMessage(text: string, options: SendOptions): Promise<string> {
    if (!this.client || !this.client.user) {
      throw new PlatformConnectionError('discord', 'Bot not initialized');
    }

    this.validateMessage(text, options);

    try {
      const channel = await this.client.channels.fetch(options.chatId);

      if (!channel || (!channel.isTextBased())) {
        throw new Error(`Invalid channel: ${options.chatId}`);
      }

      // Format text for Discord
      const formattedText = this.formatText(text, options.parseMode);

      // Prepare message options
      const messageOptions: any = {
        content: formattedText.length > 0 ? formattedText : undefined,
        allowedMentions: { parse: ['users', 'roles'] }
      };

      // Add reply reference if specified
      if (options.replyToMessageId) {
        messageOptions.reply = {
          messageReference: options.replyToMessageId,
          failIfNotExists: false
        };
      }

      // Add attachments if any
      if (options.attachments && options.attachments.length > 0) {
        messageOptions.files = options.attachments.map(attachment => {
          return new AttachmentBuilder(attachment.file, {
            name: attachment.filename,
            description: attachment.caption
          });
        });
      }

      // Send message
      const message = await (channel as TextChannel | DMChannel).send(messageOptions);
      return message.id;

    } catch (error: any) {
      this.handleDiscordError(error);
      throw error;
    }
  }

  /**
   * Send typing indicator
   */
  async sendTyping(chatId: string): Promise<void> {
    if (!this.client) {
      throw new PlatformConnectionError('discord', 'Bot not initialized');
    }

    try {
      const channel = await this.client.channels.fetch(chatId);

      if (channel && channel.isTextBased()) {
        await (channel as TextChannel | DMChannel).sendTyping();
      }
    } catch (error: any) {
      this.handleDiscordError(error);
      throw error;
    }
  }

  /**
   * Edit an existing message
   */
  async editMessage(chatId: string, messageId: string, newText: string): Promise<void> {
    if (!this.client) {
      throw new PlatformConnectionError('discord', 'Bot not initialized');
    }

    try {
      const channel = await this.client.channels.fetch(chatId);

      if (!channel || !channel.isTextBased()) {
        throw new Error(`Invalid channel: ${chatId}`);
      }

      const message = await (channel as TextChannel | DMChannel).messages.fetch(messageId);
      await message.edit(newText);
    } catch (error: any) {
      this.handleDiscordError(error);
      throw error;
    }
  }

  /**
   * Get platform status
   */
  async getStatus(): Promise<PlatformStatus> {
    if (!this.client || !this.client.user) {
      return {
        connected: false,
        error: 'Bot not initialized'
      };
    }

    try {
      // Check if client is ready and connected
      const isReady = this.client.readyAt !== null;

      return {
        connected: isReady,
        lastConnected: this.client.readyAt || undefined,
        details: {
          botId: this.client.user.id,
          botUsername: this.client.user.username,
          guildCount: this.client.guilds.cache.size,
          ping: this.client.ws.ping
        }
      };
    } catch (error: any) {
      return {
        connected: false,
        error: error.message || 'Status check failed'
      };
    }
  }

  /**
   * Test the connection
   */
  async testConnection(): Promise<boolean> {
    try {
      const status = await this.getStatus();
      return status.connected;
    } catch {
      return false;
    }
  }

  /**
   * Download a file from Discord
   */
  async downloadFile(file: PlatformFile, localPath: string): Promise<void> {
    try {
      const response = await fetch(file.url);
      if (!response.ok) {
        throw new Error(`Failed to download file: ${response.statusText}`);
      }

      const buffer = await response.arrayBuffer();
      await fs.writeFile(localPath, Buffer.from(buffer));
    } catch (error: any) {
      throw new PlatformConnectionError('discord', `File download failed: ${error.message}`);
    }
  }

  /**
   * Test DM functionality by attempting to send a message to a user
   * This is for debugging purposes only
   */
  async testDMFunctionality(userId: string): Promise<boolean> {
    if (!this.client || !this.client.user) {
      console.log('[Discord] Cannot test DM - client not initialized');
      return false;
    }

    try {
      console.log(`[Discord] Testing DM functionality with user ${userId}`);

      // Try to fetch the user
      const user = await this.client.users.fetch(userId);
      console.log(`[Discord] User fetched: ${user.username} (${user.id})`);

      // Try to create a DM channel
      const dmChannel = await user.createDM();
      console.log(`[Discord] DM channel created: ${dmChannel.id}`);

      // Try to send a test message
      const message = await dmChannel.send('🤖 Test message from bot - DM functionality is working!');
      console.log(`[Discord] Test message sent: ${message.id}`);

      return true;
    } catch (error) {
      console.error('[Discord] DM test failed:', error);
      return false;
    }
  }

  /**
   * Get user information
   */
  async getUserInfo(userId: string): Promise<{
    id: string;
    name: string;
    avatar?: string;
    isBot?: boolean;
  }> {
    if (!this.client) {
      throw new PlatformConnectionError('discord', 'Bot not initialized');
    }

    try {
      const user = await this.client.users.fetch(userId);

      return {
        id: user.id,
        name: user.displayName || user.username,
        avatar: user.displayAvatarURL({ size: 256 }),
        isBot: user.bot
      };
    } catch (error: any) {
      this.handleDiscordError(error);
      throw error;
    }
  }

  /**
   * Format text for Discord markdown
   */
  protected formatText(text: string, parseMode?: string): string {
    if (parseMode === 'markdown') {
      // Discord supports basic markdown
      return text;
    } else if (parseMode === 'html') {
      // Convert basic HTML to Discord markdown
      return text
        .replace(/<b>(.*?)<\/b>/g, '**$1**')
        .replace(/<i>(.*?)<\/i>/g, '*$1*')
        .replace(/<u>(.*?)<\/u>/g, '__$1__')
        .replace(/<code>(.*?)<\/code>/g, '`$1`')
        .replace(/<pre>(.*?)<\/pre>/g, '```\n$1\n```')
        .replace(/<a href="([^"]*)"[^>]*>(.*?)<\/a>/g, '[$2]($1)');
    }

    return text;
  }

  /**
   * Check if bot is mentioned in message
   */
  protected isBotMentioned(message: Message): boolean {
    if (!this.client?.user) return false;

    // Check if bot is mentioned directly
    if (message.mentions.users.has(this.client.user.id)) {
      return true;
    }

    // Check if bot is mentioned by role
    if (message.mentions.roles.size > 0) {
      const botMember = message.guild?.members.cache.get(this.client.user.id);
      if (botMember) {
        for (const role of message.mentions.roles.values()) {
          if (botMember.roles.cache.has(role.id)) {
            return true;
          }
        }
      }
    }

    // Check for @everyone or @here mentions
    if (message.mentions.everyone) {
      return true;
    }

    return false;
  }

  /**
   * Set up Discord event handlers
   */
  private setupEventHandlers(): void {
    if (!this.client) return;

    this.client.on('ready', () => {
      console.log(`[Discord] ✅ Bot logged in as ${this.client!.user?.tag}`);
      console.log(`[Discord] Bot ID: ${this.client!.user?.id}`);
      console.log(`[Discord] Guilds: ${this.client!.guilds.cache.size}`);
      console.log(`[Discord] Intents configured: DirectMessages, MessageContent, Guilds, GuildMessages, GuildMembers`);
      console.log(`[Discord] Partials configured: Channel, Message, User`);

      // Log the actual intents to verify they're set correctly
      console.log(`[Discord] Client intents value: ${this.client!.options.intents}`);
      console.log(`[Discord] Client partials: ${JSON.stringify(this.client!.options.partials)}`);

      // Verify specific intents are active
      const intents = this.client!.options.intents as any;
      console.log(`[Discord] DirectMessages intent: ${!!(intents & GatewayIntentBits.DirectMessages)}`);
      console.log(`[Discord] MessageContent intent: ${!!(intents & GatewayIntentBits.MessageContent)}`);
      console.log(`[Discord] Guilds intent: ${!!(intents & GatewayIntentBits.Guilds)}`);
      console.log(`[Discord] GuildMessages intent: ${!!(intents & GatewayIntentBits.GuildMessages)}`);

      // Check if bot can receive DMs
      console.log(`[Discord] Bot ready to receive DMs and guild messages`);

      // Log some additional debugging info
      console.log(`[Discord] Bot application ID: ${this.client!.application?.id}`);
      console.log(`[Discord] Bot verified: ${this.client!.user?.verified}`);
      console.log(`[Discord] Bot MFA enabled: ${this.client!.user?.mfaEnabled}`);
    });

    this.client.on('messageCreate', async (message: Message) => {
      this.messageCreateEventCount++;
      console.log(`[Discord] 🔔 messageCreate event fired (#${this.messageCreateEventCount})`);
      console.log(`[Discord] Message ID: ${message.id}`);
      console.log(`[Discord] Author: ${message.author.username} (${message.author.id})`);
      console.log(`[Discord] Author is bot: ${message.author.bot}`);
      console.log(`[Discord] Channel type: ${message.channel.type} (${ChannelType[message.channel.type]})`);
      console.log(`[Discord] Channel ID: ${message.channel.id}`);
      console.log(`[Discord] Content: "${message.content}"`);
      console.log(`[Discord] Message partial: ${message.partial}`);
      console.log(`[Discord] Channel partial: ${message.channel.partial}`);

      await this.handleIncomingMessage(message);
    });

    // Add raw event listener for debugging only
    this.client.on('raw', (packet: any) => {
      if (packet.t === 'MESSAGE_CREATE') {
        console.log(`[Discord] 📦 Raw MESSAGE_CREATE packet received:`);
        console.log(`[Discord] Channel ID: ${packet.d.channel_id}`);
        console.log(`[Discord] Channel Type: ${packet.d.channel_type}`);
        console.log(`[Discord] Author: ${packet.d.author.username} (${packet.d.author.id})`);
        console.log(`[Discord] Content: "${packet.d.content}"`);
        console.log(`[Discord] Guild ID: ${packet.d.guild_id || 'null (DM)'}`);
        console.log(`[Discord] Bot author: ${packet.d.author.bot}`);

        // Log if this is a DM from a human
        if (packet.d.channel_type === 1 && !packet.d.author.bot) {
          console.log(`[Discord] 🔍 DM from human detected in raw event`);
          console.log(`[Discord] Waiting for messageCreate event to handle it...`);

          // Set a timeout to check if messageCreate fires
          const currentCount = this.messageCreateEventCount;
          const messageId = packet.d.id;
          setTimeout(() => {
            const newCount = this.messageCreateEventCount;
            if (newCount > currentCount) {
              console.log(`[Discord] ✅ messageCreate event fired for DM (count: ${currentCount} -> ${newCount})`);
            } else {
              console.log(`[Discord] ❌ messageCreate event did NOT fire for DM after 3 seconds (count still: ${currentCount})`);
              console.log(`[Discord] 🔧 Activating fallback: manually processing DM from raw event`);

              // Manually process the DM as a fallback
              this.processRawDMFallback(packet.d);
            }
          }, 3000);
        }
      }
    });

    this.client.on('error', (error: Error) => {
      console.error('[Discord] ❌ Client error:', error);
      this.handleConnectionError(error);
    });

    this.client.on('disconnect', () => {
      console.log('[Discord] ⚠️ Client disconnected');
      this.emitStatusChange({
        connected: false,
        error: 'Client disconnected'
      });
    });

    this.client.on('reconnecting', () => {
      console.log('[Discord] 🔄 Client reconnecting...');
    });

    this.client.on('resume', () => {
      console.log('[Discord] ✅ Client resumed');
      this.emitStatusChange({
        connected: true,
        lastConnected: new Date()
      });
    });

    this.client.on('debug', (info: string) => {
      if (info.includes('Heartbeat') || info.includes('heartbeat')) {
        // Skip heartbeat logs to reduce noise
        return;
      }
      if (info.includes('Failed to find guild') || info.includes('unknown type for channel')) {
        // Skip DM channel warnings - these are expected for DM channels which don't have guilds
        return;
      }
      console.log(`[Discord Debug] ${info}`);
    });

    // Add warn event listener to catch any warnings
    this.client.on('warn', (warning: string) => {
      console.warn(`[Discord Warning] ${warning}`);
    });

    // Add channelCreate event to debug DM channel creation
    this.client.on('channelCreate', (channel: any) => {
      if (channel.type === ChannelType.DM) {
        console.log(`[Discord] 📩 DM channel created: ${channel.id}`);
        console.log(`[Discord] DM recipient: ${channel.recipient?.username}`);
      }
    });
  }


  /**
   * Process raw DM as fallback when messageCreate doesn't fire
   * This is a backup mechanism for Discord.js DM handling issues
   */
  private processRawDMFallback(rawData: any): void {
    console.log(`[Discord] 📨 processRawDMFallback called`);

    // Check if we've already processed this message
    if (this.processedMessageIds.has(rawData.id)) {
      console.log(`[Discord] ⚠️ Message ${rawData.id} already processed via messageCreate, skipping fallback`);
      return;
    }

    // Mark message as processed
    this.processedMessageIds.add(rawData.id);

    console.log(`[Discord] Processing DM from: ${rawData.author.username} (${rawData.author.id})`);
    console.log(`[Discord] Content: "${rawData.content}"`);

    const discordConfig = this.config as DiscordConfig;

    // Check if DM responses are enabled
    if (discordConfig.config.respondToDMs === false) {
      console.log(`[Discord] ❌ DM responses disabled in config, ignoring fallback message`);
      return;
    }

    console.log(`[Discord] ✅ DM responses enabled, processing fallback message`);

    // Convert raw data to platform-agnostic format
    const incomingMessage: IncomingMessage = {
      id: rawData.id,
      platform: 'discord',
      user: {
        id: rawData.author.id,
        name: rawData.author.global_name || rawData.author.username,
        avatar: rawData.author.avatar
          ? `https://cdn.discordapp.com/avatars/${rawData.author.id}/${rawData.author.avatar}.png`
          : `https://cdn.discordapp.com/embed/avatars/${parseInt(rawData.author.discriminator) % 5}.png`
      },
      chat: {
        id: rawData.channel_id,
        name: `DM with ${rawData.author.username}`,
        type: 'private'
      },
      content: {
        text: this.sanitizeInput(rawData.content),
        files: [], // Raw events don't include processed attachments easily
        isMention: false, // DMs don't have mentions
        replyTo: rawData.message_reference ? {
          id: rawData.message_reference.message_id || '',
          text: '',
          user: ''
        } : undefined
      },
      timestamp: new Date(rawData.timestamp),
      raw: { rawDiscordData: rawData, fallbackProcessed: true }
    };

    console.log(`[Discord] ✅ Raw DM fallback message converted successfully`);
    console.log(`[Discord] Emitting fallback DM message to bot manager...`);
    this.emitMessage(incomingMessage);
    console.log(`[Discord] ✅ Fallback DM message emitted to bot manager`);
  }

  /**
   * Handle incoming Discord message
   */
  private async handleIncomingMessage(message: Message): Promise<void> {
    console.log(`[Discord] 📨 handleIncomingMessage called`);

    // Check if we've already processed this message (to avoid duplicates from fallback)
    if (this.processedMessageIds.has(message.id)) {
      console.log(`[Discord] ⚠️ Message ${message.id} already processed, skipping duplicate`);
      return;
    }

    // Mark message as processed
    this.processedMessageIds.add(message.id);

    // Clean up old message IDs (keep only last 1000)
    if (this.processedMessageIds.size > 1000) {
      const idsArray = Array.from(this.processedMessageIds);
      this.processedMessageIds.clear();
      idsArray.slice(-500).forEach(id => this.processedMessageIds.add(id));
    }

    // Handle partial messages by fetching complete data
    if (message.partial) {
      console.log(`[Discord] ⚠️ Message is partial, fetching complete data...`);
      try {
        message = await message.fetch();
        console.log(`[Discord] ✅ Partial message fetched successfully`);
      } catch (error) {
        console.error(`[Discord] ❌ Failed to fetch partial message:`, error);
        return;
      }
    }

    // Handle partial channels by fetching complete data
    if (message.channel.partial) {
      console.log(`[Discord] ⚠️ Channel is partial, fetching complete data...`);
      try {
        await message.channel.fetch();
        console.log(`[Discord] ✅ Partial channel fetched successfully`);
      } catch (error) {
        console.error(`[Discord] ❌ Failed to fetch partial channel:`, error);
        return;
      }
    }

    // Ignore bot messages
    if (message.author.bot) {
      console.log(`[Discord] ❌ Ignoring bot message from ${message.author.username}`);
      return;
    }

    console.log(`[Discord] ✅ Message is from human user`);
    console.log(`[Discord] User: ${message.author.username} (${message.author.id})`);
    console.log(`[Discord] Channel: ${this.getChannelDisplayName(message)}`);
    console.log(`[Discord] Content: ${message.content.substring(0, 100)}${message.content.length > 100 ? '...' : ''}`);

    const discordConfig = this.config as DiscordConfig;
    console.log(`[Discord] Config - respondToDMs: ${discordConfig.config.respondToDMs}`);
    console.log(`[Discord] Config - respondToGuilds: ${discordConfig.config.respondToGuilds}`);
    console.log(`[Discord] Config - guildMentionOnly: ${discordConfig.config.guildMentionOnly}`);

    // Check DM/Guild settings first
    const isDM = message.channel.type === ChannelType.DM;
    console.log(`[Discord] Is DM: ${isDM}`);

    if (isDM) {
      console.log(`[Discord] 🔍 Processing DM message...`);
      if (discordConfig.config.respondToDMs === false) {
        console.log(`[Discord] ❌ DM responses disabled in config, ignoring message`);
        return;
      }
      console.log(`[Discord] ✅ DM responses enabled, will process message`);
    } else {
      console.log(`[Discord] 🔍 Processing guild message...`);
      if (discordConfig.config.respondToGuilds === false) {
        console.log(`[Discord] ❌ Guild responses disabled in config, ignoring message`);
        return;
      }

      const isMentioned = this.isBotMentioned(message);
      console.log(`[Discord] Bot mentioned: ${isMentioned}`);

      if (discordConfig.config.guildMentionOnly && !isMentioned) {
        console.log(`[Discord] ❌ Guild mention-only mode enabled, bot not mentioned, ignoring`);
        return;
      }

      if (isMentioned) {
        console.log(`[Discord] 🔔 Bot was mentioned/pinged in message`);
      }
      console.log(`[Discord] ✅ Guild message will be processed`);
    }

    // Check if user is allowed (only for guild messages, not DMs)
    if (!isDM && discordConfig.config.allowedUsers &&
        discordConfig.config.allowedUsers.length > 0) {
      console.log(`[Discord] Checking allowed users list (${discordConfig.config.allowedUsers.length} users)`);
      if (!discordConfig.config.allowedUsers.includes(message.author.id)) {
        console.log(`[Discord] ❌ User ${message.author.username} (${message.author.id}) not in allowed list`);
        return;
      }
      console.log(`[Discord] ✅ User is in allowed list`);
    }

    // Check if guild is allowed (only for guild messages)
    if (!isDM && message.guild &&
        discordConfig.config.allowedGuilds &&
        discordConfig.config.allowedGuilds.length > 0) {
      console.log(`[Discord] Checking allowed guilds list (${discordConfig.config.allowedGuilds.length} guilds)`);
      if (!discordConfig.config.allowedGuilds.includes(message.guild.id)) {
        console.log(`[Discord] ❌ Guild ${message.guild.name} (${message.guild.id}) not in allowed list`);
        return;
      }
      console.log(`[Discord] ✅ Guild is in allowed list`);
    }

    console.log(`[Discord] 🔄 Converting message to platform-agnostic format...`);

    // Convert to platform-agnostic format
    const sourceThreadId = 'isThread' in message.channel && typeof message.channel.isThread === 'function' && message.channel.isThread()
      ? message.channel.id
      : undefined;
    const sourceChannelId = sourceThreadId && 'parentId' in message.channel
      ? message.channel.parentId || message.channel.id
      : message.channel.id;
    const conversationKey = sourceThreadId
      ? `discord:${sourceChannelId}:thread:${sourceThreadId}`
      : `discord:${message.channel.id}`;

    const incomingMessage: IncomingMessage = {
      id: message.id,
      platform: 'discord',
      user: {
        id: message.author.id,
        name: message.member?.displayName || message.author.displayName || message.author.username,
        avatar: message.author.displayAvatarURL({ size: 256 })
      },
      chat: {
        id: message.channel.id,
        name: this.getChannelDisplayName(message),
        type: this.mapChannelType(message.channel.type),
        threadId: sourceThreadId
      },
      content: {
        text: this.sanitizeInput(message.content),
        files: this.extractFiles(message),
        isMention: this.isBotMentioned(message),
        replyTo: message.reference ? {
          id: message.reference.messageId || '',
          text: '', // Would need to fetch the referenced message
          user: '' // Would need to fetch the referenced message
        } : undefined
      },
      timestamp: message.createdAt,
      raw: message,
      metadata: {
        conversationKey,
        replyTargetId: message.id,
        sourceGuildId: message.guild?.id,
        sourceChannelId,
        sourceThreadId
      }
    };

    console.log(`[Discord] ✅ Message converted successfully`);
    console.log(`[Discord] Emitting message to bot manager...`);
    this.emitMessage(incomingMessage);
    console.log(`[Discord] ✅ Message emitted to bot manager`);
  }

  /**
   * Extract files from Discord message
   */
  private extractFiles(message: Message): PlatformFile[] {
    const files: PlatformFile[] = [];

    for (const attachment of message.attachments.values()) {
      files.push({
        id: attachment.id,
        name: attachment.name || 'unknown',
        mimeType: attachment.contentType || 'application/octet-stream',
        size: attachment.size,
        url: attachment.url,
        caption: attachment.description || undefined
      });
    }

    return files;
  }

  /**
   * Get channel display name
   */
  private getChannelDisplayName(message: Message): string {
    if (message.channel.type === ChannelType.DM) {
      return `DM with ${message.author.username}`;
    }

    if ('name' in message.channel && message.channel.name) {
      const guildName = message.guild?.name || 'Unknown Guild';
      return `#${message.channel.name} (${guildName})`;
    }

    return `Channel ${message.channel.id}`;
  }

  /**
   * Map Discord channel type to platform-agnostic type
   */
  private mapChannelType(channelType: ChannelType): 'private' | 'group' | 'channel' {
    switch (channelType) {
      case ChannelType.DM:
        return 'private';
      case ChannelType.GroupDM:
        return 'group';
      case ChannelType.GuildText:
      case ChannelType.GuildVoice:
      case ChannelType.GuildAnnouncement: // Replaces deprecated GuildNews
      case ChannelType.GuildForum:
        return 'channel';
      default:
        return 'channel';
    }
  }

  /**
   * Handle Discord API errors
   */
  private handleDiscordError(error: any): void {
    if (error.code === 50013) {
      throw new PlatformAuthError('discord', 'Missing permissions');
    } else if (error.code === 50001) {
      throw new PlatformAuthError('discord', 'Missing access');
    } else if (error.code === 50007) {
      throw new PlatformAuthError('discord', 'Cannot send messages to this user');
    } else if (error.code === 429) {
      const retryAfter = error.retry_after || 60;
      throw new PlatformRateLimitError('discord', retryAfter, error);
    }
  }

  /**
   * Handle connection errors and attempt reconnection
   */
  private async handleConnectionError(error: Error): Promise<void> {
    this.emitStatusChange({
      connected: false,
      error: error.message || 'Connection error'
    });

    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      console.log(`Attempting to reconnect to Discord (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);

      setTimeout(async () => {
        try {
          await this.initialize();
        } catch (reconnectError) {
          console.error('Reconnection failed:', reconnectError);
        }
      }, this.reconnectDelay * this.reconnectAttempts);
    } else {
      console.error('Max reconnection attempts reached for Discord');
    }
  }
}
