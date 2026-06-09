/**
 * Bot Integration Manager
 *
 * This module manages the integration of multiple messaging platforms with EverFern,
 * handling message routing, response streaming, and platform coordination.
 */

import { EventEmitter } from 'events';
import { MessagePlatform, IncomingMessage, SendOptions, PlatformStatus } from './platform-interface';
import { TelegramPlatform, TelegramConfig } from './telegram-platform';
import { DiscordPlatform, DiscordConfig } from './discord-platform';
import { InputValidator, createInputValidator, ContentFilterConfig, WebhookConfig } from './input-validator';

/**
 * Bot integration configuration
 */
export interface BotIntegrationConfig {
  /** Whether bot integration is enabled globally */
  enabled: boolean;
  /** Platform-specific configurations */
  platforms: {
    telegram?: TelegramConfig;
    discord?: DiscordConfig;
  };
  /** Global settings */
  settings: {
    /** Maximum message length before truncation */
    maxMessageLength: number;
    /** Whether to format tool outputs for platforms */
    formatToolOutputs: boolean;
    /** Response streaming chunk size */
    streamingChunkSize: number;
    /** Timeout for platform responses (ms) */
    responseTimeout: number;
    /** Whether to enable cross-platform message sync */
    enableCrossSync: boolean;
  };
  /** Input validation configuration */
  validation: {
    /** Content filtering configuration */
    contentFilter: Partial<ContentFilterConfig>;
    /** Webhook validation configuration */
    webhook: Partial<WebhookConfig>;
    /** Whether to enable input validation */
    enabled: boolean;
  };
}

/**
 * Message routing context
 */
export interface MessageContext {
  /** Original incoming message */
  message: IncomingMessage;
  /** Target platforms for response */
  targetPlatforms: string[];
  /** Conversation ID for context tracking */
  conversationId: string;
  /** User ID (unified across platforms) */
  userId?: string;
  /** Additional metadata */
  metadata: Record<string, any>;
}

/**
 * Response streaming interface
 */
export interface ResponseStream {
  /** Stream ID */
  id: string;
  /** Target platform */
  platform: string;
  /** Target chat ID */
  chatId: string;
  /** Current response text */
  text: string;
  /** Whether streaming is complete */
  complete: boolean;
  /** Stream start time */
  startTime: Date;
  /** Last update time */
  lastUpdate: Date;
}

/**
 * Tool output formatting options
 */
export interface ToolOutputFormat {
  /** Platform name */
  platform: string;
  /** Whether to use markdown formatting */
  useMarkdown: boolean;
  /** Maximum output length */
  maxLength: number;
  /** Whether to include tool metadata */
  includeMetadata: boolean;
}

/**
 * Main bot integration manager class
 */
export class BotIntegrationManager extends EventEmitter {
  private platforms = new Map<string, MessagePlatform>();
  private activeStreams = new Map<string, ResponseStream>();
  private messageContexts = new Map<string, MessageContext>();
  private config: BotIntegrationConfig;
  private inputValidator: InputValidator;
  private isInitialized = false;

  constructor(config: BotIntegrationConfig) {
    super();
    this.config = config;

    // Initialize input validator
    this.inputValidator = createInputValidator(
      config.validation.contentFilter,
      config.validation.webhook
    );
  }

  /**
   * Initialize the bot integration manager
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      // Initialize enabled platforms
      await this.initializePlatforms();

      // Set up event handlers
      this.setupEventHandlers();

      this.isInitialized = true;
      this.emit('initialized');

      console.log('BotIntegrationManager initialized successfully');
    } catch (error) {
      console.error('Failed to initialize BotIntegrationManager:', error);
      throw error;
    }
  }

  /**
   * Shutdown the bot integration manager
   */
  async shutdown(): Promise<void> {
    if (!this.isInitialized) {
      return;
    }

    try {
      // Disconnect all platforms
      for (const [name, platform] of this.platforms) {
        console.log(`Disconnecting platform: ${name}`);
        await platform.disconnect();
      }

      // Clear active streams
      this.activeStreams.clear();
      this.messageContexts.clear();
      this.platforms.clear();

      this.isInitialized = false;
      this.emit('shutdown');

      console.log('BotIntegrationManager shutdown successfully');
    } catch (error) {
      console.error('Error during BotIntegrationManager shutdown:', error);
      throw error;
    }
  }

  /**
   * Register a platform
   */
  registerPlatform(name: string, platform: MessagePlatform): void {
    // If a platform with this name already exists, disconnect it first to prevent polling leaks!
    const existing = this.platforms.get(name);
    if (existing) {
      console.log(`[BotManager] Disconnecting existing platform ${name} before registering new one...`);
      existing.disconnect().catch(err => console.error(`Failed to disconnect existing platform ${name}:`, err));
    }

    this.platforms.set(name, platform);

    // Set up platform event handlers
    platform.onMessage((message) => this.handleIncomingMessage(message));
    platform.onStatusChange((status) => this.handlePlatformStatusChange(name, status));

    this.emit('platformRegistered', name, platform);
  }

  /**
   * Unregister a platform
   */
  async unregisterPlatform(name: string): Promise<void> {
    const platform = this.platforms.get(name);
    if (platform) {
      await platform.disconnect();
      this.platforms.delete(name);
      this.emit('platformUnregistered', name);
    }
  }

  /**
   * Get platform by name
   */
  getPlatform(name: string): MessagePlatform | undefined {
    return this.platforms.get(name);
  }

  /**
   * Get all registered platforms
   */
  getPlatforms(): Map<string, MessagePlatform> {
    return new Map(this.platforms);
  }

  /**
   * Send a message to specific platforms
   */
  async sendMessage(
    text: string,
    platforms: string[],
    options: Partial<SendOptions> = {}
  ): Promise<Map<string, string | Error>> {
    const results = new Map<string, string | Error>();

    for (const platformName of platforms) {
      const platform = this.platforms.get(platformName);
      if (!platform) {
        results.set(platformName, new Error(`Platform ${platformName} not found`));
        continue;
      }

      try {
        // Format text for the specific platform
        const formattedText = this.formatTextForPlatform(text, platformName);

        // Send message with timeout
        const messageId = await this.sendWithTimeout(
          platform,
          formattedText,
          options as SendOptions,
          this.config.settings.responseTimeout
        );

        results.set(platformName, messageId);
      } catch (error) {
        results.set(platformName, error as Error);
      }
    }

    return results;
  }

  /**
   * Start streaming a response to platforms
   */
  async startResponseStream(
    platforms: string[],
    chatId: string,
    initialText = ''
  ): Promise<Map<string, string>> {
    const streamIds = new Map<string, string>();

    for (const platformName of platforms) {
      const platform = this.platforms.get(platformName);
      if (!platform) {
        continue;
      }

      try {
        const streamId = `stream_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Send initial message or typing indicator
        let messageId: string;
        if (initialText) {
          messageId = await platform.sendMessage(initialText, { chatId });
        } else {
          await platform.sendTyping(chatId);
          messageId = ''; // Will be set when first chunk is sent
        }

        // Create stream record
        const stream: ResponseStream = {
          id: streamId,
          platform: platformName,
          chatId,
          text: initialText,
          complete: false,
          startTime: new Date(),
          lastUpdate: new Date()
        };

        this.activeStreams.set(streamId, stream);
        streamIds.set(platformName, streamId);

        this.emit('streamStarted', streamId, platformName, chatId);
      } catch (error) {
        console.error(`Failed to start stream for ${platformName}:`, error);
      }
    }

    return streamIds;
  }

  /**
   * Update a response stream with new content
   */
  async updateResponseStream(streamId: string, newText: string): Promise<void> {
    const stream = this.activeStreams.get(streamId);
    if (!stream || stream.complete) {
      return;
    }

    const platform = this.platforms.get(stream.platform);
    if (!platform) {
      return;
    }

    try {
      // Check if we need to send a new message or update existing
      const shouldSendNew = newText.length - stream.text.length > this.config.settings.streamingChunkSize;

      if (shouldSendNew) {
        // Send new chunk
        const chunk = newText.substring(stream.text.length);
        const formattedChunk = this.formatTextForPlatform(chunk, stream.platform);

        await platform.sendMessage(formattedChunk, { chatId: stream.chatId });
      }

      // Update stream record
      stream.text = newText;
      stream.lastUpdate = new Date();

      this.emit('streamUpdated', streamId, newText);
    } catch (error) {
      console.error(`Failed to update stream ${streamId}:`, error);
      this.emit('streamError', streamId, error);
    }
  }

  /**
   * Complete a response stream
   */
  async completeResponseStream(streamId: string, finalText?: string): Promise<void> {
    const stream = this.activeStreams.get(streamId);
    if (!stream) {
      return;
    }

    try {
      if (finalText && finalText !== stream.text) {
        await this.updateResponseStream(streamId, finalText);
      }

      stream.complete = true;
      stream.lastUpdate = new Date();

      this.emit('streamCompleted', streamId, stream.text);
    } catch (error) {
      console.error(`Failed to complete stream ${streamId}:`, error);
      this.emit('streamError', streamId, error);
    } finally {
      // Clean up stream after a delay
      setTimeout(() => {
        this.activeStreams.delete(streamId);
      }, 60000); // Keep for 1 minute for debugging
    }
  }

  /**
   * Format tool output for specific platforms
   */
  formatToolOutput(
    toolName: string,
    output: any,
    format: ToolOutputFormat
  ): string {
    if (!this.config.settings.formatToolOutputs) {
      return String(output);
    }

    let formattedOutput = '';

    if (format.includeMetadata) {
      const header = format.useMarkdown
        ? `**🔧 ${toolName}**\n`
        : `🔧 ${toolName}\n`;
      formattedOutput += header;
    }

    // Format the actual output
    let outputText = '';
    if (typeof output === 'object') {
      outputText = JSON.stringify(output, null, 2);
      if (format.useMarkdown) {
        outputText = `\`\`\`json\n${outputText}\n\`\`\``;
      }
    } else {
      outputText = String(output);
      if (format.useMarkdown && outputText.includes('\n')) {
        outputText = `\`\`\`\n${outputText}\n\`\`\``;
      }
    }

    formattedOutput += outputText;

    // Truncate if too long
    if (formattedOutput.length > format.maxLength) {
      const truncated = formattedOutput.substring(0, format.maxLength - 3) + '...';
      formattedOutput = truncated;
    }

    return formattedOutput;
  }

  /**
   * Get platform status for all registered platforms
   */
  async getPlatformStatuses(): Promise<Map<string, PlatformStatus>> {
    const statuses = new Map<string, PlatformStatus>();

    for (const [name, platform] of this.platforms) {
      try {
        const status = await platform.getStatus();
        statuses.set(name, status);
      } catch (error) {
        statuses.set(name, {
          connected: false,
          error: `Failed to get status: ${error}`
        });
      }
    }

    return statuses;
  }

  /**
   * Get active response streams
   */
  getActiveStreams(): Map<string, ResponseStream> {
    return new Map(this.activeStreams);
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<BotIntegrationConfig>): void {
    this.config = { ...this.config, ...newConfig };

    // Update input validator configuration if validation config changed
    if (newConfig.validation) {
      if (newConfig.validation.contentFilter) {
        this.inputValidator.updateContentFilterConfig(newConfig.validation.contentFilter);
      }
      if (newConfig.validation.webhook) {
        this.inputValidator.updateWebhookConfig(newConfig.validation.webhook);
      }
    }

    this.emit('configUpdated', this.config);
  }

  /**
   * Validate webhook request
   */
  async validateWebhookRequest(payload: string, signature: string, timestamp?: string): Promise<boolean> {
    if (!this.config.validation.enabled) {
      return true; // Skip validation if disabled
    }

    const result = await this.inputValidator.validateWebhookSignature(payload, signature, timestamp);

    if (!result.valid) {
      console.warn('Webhook validation failed:', result.errors);
      this.emit('webhookValidationError', { payload, signature, timestamp, errors: result.errors });
    }

    return result.valid;
  }

  /**
   * Get rate limit status for a user
   */
  getUserRateLimitStatus(userId: string): { messages: number; files: number; resetTime: number } {
    return this.inputValidator.getRateLimitStatus(userId);
  }

  /**
   * Format validation error message for user
   */
  private formatValidationError(validationResult: any): string {
    const errors = validationResult.errors;

    if (errors.includes('Rate limit exceeded')) {
      return '⚠️ You are sending messages too quickly. Please wait a moment before trying again.';
    }

    if (errors.some((e: string) => e.includes('injection attack'))) {
      return '🚫 Your message contains potentially harmful content and cannot be processed.';
    }

    if (errors.some((e: string) => e.includes('too long'))) {
      return '📝 Your message is too long. Please shorten it and try again.';
    }

    if (errors.some((e: string) => e.includes('File too large'))) {
      return '📁 The file you sent is too large. Please send a smaller file.';
    }

    if (errors.some((e: string) => e.includes('File type not allowed'))) {
      return '🚫 This file type is not allowed. Please send a different file format.';
    }

    // Generic error message
    return '❌ Your message could not be processed due to security restrictions.';
  }

  /**
   * Initialize platforms based on configuration
   */
  private async initializePlatforms(): Promise<void> {
    const { platforms } = this.config;

    // Initialize Telegram if configured
    if (platforms.telegram?.enabled) {
      const telegramPlatform = new TelegramPlatform(platforms.telegram);
      this.registerPlatform('telegram', telegramPlatform);
      await telegramPlatform.initialize();
    }

    // Initialize Discord if configured
    if (platforms.discord?.enabled) {
      const discordPlatform = new DiscordPlatform(platforms.discord);
      this.registerPlatform('discord', discordPlatform);
      await discordPlatform.initialize();
    }
  }

  /**
   * Set up event handlers
   */
  private setupEventHandlers(): void {
    // Handle process shutdown
    process.on('SIGINT', () => this.shutdown());
    process.on('SIGTERM', () => this.shutdown());
  }

  /**
   * Handle incoming messages from platforms
   */
  private async handleIncomingMessage(message: IncomingMessage): Promise<void> {
    console.log(`[BotManager] 📨 handleIncomingMessage called`);
    console.log(`[BotManager] Platform: ${message.platform}`);
    console.log(`[BotManager] User: ${message.user.name} (${message.user.id})`);
    console.log(`[BotManager] Chat: ${message.chat.name} (${message.chat.id})`);
    console.log(`[BotManager] Content: ${message.content.text.substring(0, 100)}`);

    try {
      // Validate input if validation is enabled
      if (this.config.validation.enabled) {
        console.log(`[BotManager] Validation enabled, validating message...`);
        const validationResult = await this.inputValidator.validateMessage(message);

        if (!validationResult.valid) {
          console.warn(`[BotManager] ❌ Message validation failed for ${message.user.id}:`, validationResult.errors);

          // Send error response to user
          const platform = this.platforms.get(message.platform);
          if (platform) {
            const errorMessage = this.formatValidationError(validationResult);
            await platform.sendMessage(errorMessage, {
              chatId: message.chat.id,
              replyToMessageId: message.id
            });
          }

          // Emit validation error event
          this.emit('validationError', message, validationResult);
          return;
        }

        // Log warnings if any
        if (validationResult.warnings.length > 0) {
          console.warn(`[BotManager] ⚠️ Message validation warnings for ${message.user.id}:`, validationResult.warnings);
          this.emit('validationWarning', message, validationResult);
        }

        // Use sanitized message for further processing
        if (validationResult.sanitized) {
          console.log(`[BotManager] Using sanitized message`);
          message = validationResult.sanitized;
        }

        console.log(`[BotManager] ✅ Message validation passed`);
      } else {
        console.log(`[BotManager] Validation disabled, skipping validation`);
      }

      const conversationId = message.metadata?.conversationKey || `${message.platform}:${message.chat.id}`;

      // Create message context
      const context: MessageContext = {
        message,
        targetPlatforms: [message.platform],
        conversationId,
        metadata: {
          receivedAt: new Date(),
          platform: message.platform,
          validated: this.config.validation.enabled,
          replyTargetId: message.metadata?.replyTargetId || message.id,
          sourceGuildId: message.metadata?.sourceGuildId,
          sourceChannelId: message.metadata?.sourceChannelId || message.chat.id,
          sourceThreadId: message.metadata?.sourceThreadId || message.chat.threadId
        }
      };

      console.log(`[BotManager] Created message context with conversationId: ${context.conversationId}`);
      this.messageContexts.set(message.id, context);

      // Emit message for processing by AgentRunner
      console.log(`[BotManager] 📤 Emitting 'messageReceived' event...`);
      this.emit('messageReceived', context);
      console.log(`[BotManager] ✅ 'messageReceived' event emitted successfully`);
    } catch (error) {
      console.error('[BotManager] ❌ Error handling incoming message:', error);
      this.emit('messageError', message, error);
    }
  }

  /**
   * Handle platform status changes
   */
  private handlePlatformStatusChange(platformName: string, status: PlatformStatus): void {
    this.emit('platformStatusChanged', platformName, status);

    if (!status.connected) {
      console.warn(`Platform ${platformName} disconnected:`, status.error);
    } else {
      console.log(`Platform ${platformName} connected`);
    }
  }

  /**
   * Format text for specific platform
   */
  private formatTextForPlatform(text: string, platformName: string): string {
    const platform = this.platforms.get(platformName);
    if (!platform) {
      return text;
    }

    // Apply platform-specific formatting
    let formattedText = text;

    // Truncate if too long
    if (formattedText.length > this.config.settings.maxMessageLength) {
      formattedText = formattedText.substring(0, this.config.settings.maxMessageLength - 3) + '...';
    }

    return formattedText;
  }

  /**
   * Send message with timeout
   */
  private async sendWithTimeout(
    platform: MessagePlatform,
    text: string,
    options: SendOptions,
    timeoutMs: number
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Send timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      platform.sendMessage(text, options)
        .then((messageId) => {
          clearTimeout(timeout);
          resolve(messageId);
        })
        .catch((error) => {
          clearTimeout(timeout);
          reject(error);
        });
    });
  }
}

/**
 * Default bot integration configuration
 */
export const defaultBotIntegrationConfig: BotIntegrationConfig = {
  enabled: false,
  platforms: {},
  settings: {
    maxMessageLength: 4000,
    formatToolOutputs: true,
    streamingChunkSize: 500,
    responseTimeout: 30000,
    enableCrossSync: false
  },
  validation: {
    enabled: true,
    contentFilter: {
      enableProfanityFilter: true,
      enableSpamDetection: true,
      maxMessageLength: 4000,
      maxFileSize: 25 * 1024 * 1024, // 25MB
      rateLimiting: {
        messagesPerMinute: 30,
        filesPerHour: 10,
        burstAllowance: 5
      }
    },
    webhook: {
      secretKey: '', // Must be configured
      signatureHeader: 'X-Hub-Signature-256',
      hashAlgorithm: 'sha256',
      maxRequestAge: 300
    }
  }
};

/**
 * Create a bot integration manager with default configuration
 */
export function createBotIntegrationManager(
  config: Partial<BotIntegrationConfig> = {}
): BotIntegrationManager {
  const fullConfig = { ...defaultBotIntegrationConfig, ...config };
  return new BotIntegrationManager(fullConfig);
}
