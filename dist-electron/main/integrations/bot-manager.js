"use strict";
/**
 * Bot Integration Manager
 *
 * This module manages the integration of multiple messaging platforms with EverFern,
 * handling message routing, response streaming, and platform coordination.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultBotIntegrationConfig = exports.BotIntegrationManager = void 0;
exports.createBotIntegrationManager = createBotIntegrationManager;
const events_1 = require("events");
const telegram_platform_1 = require("./telegram-platform");
const discord_platform_1 = require("./discord-platform");
const input_validator_1 = require("./input-validator");
/**
 * Main bot integration manager class
 */
class BotIntegrationManager extends events_1.EventEmitter {
    platforms = new Map();
    activeStreams = new Map();
    messageContexts = new Map();
    config;
    inputValidator;
    isInitialized = false;
    constructor(config) {
        super();
        this.config = config;
        // Initialize input validator
        this.inputValidator = (0, input_validator_1.createInputValidator)(config.validation.contentFilter, config.validation.webhook);
    }
    /**
     * Initialize the bot integration manager
     */
    async initialize() {
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
        }
        catch (error) {
            console.error('Failed to initialize BotIntegrationManager:', error);
            throw error;
        }
    }
    /**
     * Shutdown the bot integration manager
     */
    async shutdown() {
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
        }
        catch (error) {
            console.error('Error during BotIntegrationManager shutdown:', error);
            throw error;
        }
    }
    /**
     * Register a platform
     */
    registerPlatform(name, platform) {
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
    async unregisterPlatform(name) {
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
    getPlatform(name) {
        return this.platforms.get(name);
    }
    /**
     * Get all registered platforms
     */
    getPlatforms() {
        return new Map(this.platforms);
    }
    /**
     * Send a message to specific platforms
     */
    async sendMessage(text, platforms, options = {}) {
        const results = new Map();
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
                const messageId = await this.sendWithTimeout(platform, formattedText, options, this.config.settings.responseTimeout);
                results.set(platformName, messageId);
            }
            catch (error) {
                results.set(platformName, error);
            }
        }
        return results;
    }
    /**
     * Start streaming a response to platforms
     */
    async startResponseStream(platforms, chatId, initialText = '') {
        const streamIds = new Map();
        for (const platformName of platforms) {
            const platform = this.platforms.get(platformName);
            if (!platform) {
                continue;
            }
            try {
                const streamId = `stream_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                // Send initial message or typing indicator
                let messageId;
                if (initialText) {
                    messageId = await platform.sendMessage(initialText, { chatId });
                }
                else {
                    await platform.sendTyping(chatId);
                    messageId = ''; // Will be set when first chunk is sent
                }
                // Create stream record
                const stream = {
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
            }
            catch (error) {
                console.error(`Failed to start stream for ${platformName}:`, error);
            }
        }
        return streamIds;
    }
    /**
     * Update a response stream with new content
     */
    async updateResponseStream(streamId, newText) {
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
        }
        catch (error) {
            console.error(`Failed to update stream ${streamId}:`, error);
            this.emit('streamError', streamId, error);
        }
    }
    /**
     * Complete a response stream
     */
    async completeResponseStream(streamId, finalText) {
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
        }
        catch (error) {
            console.error(`Failed to complete stream ${streamId}:`, error);
            this.emit('streamError', streamId, error);
        }
        finally {
            // Clean up stream after a delay
            setTimeout(() => {
                this.activeStreams.delete(streamId);
            }, 60000); // Keep for 1 minute for debugging
        }
    }
    /**
     * Format tool output for specific platforms
     */
    formatToolOutput(toolName, output, format) {
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
        }
        else {
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
    async getPlatformStatuses() {
        const statuses = new Map();
        for (const [name, platform] of this.platforms) {
            try {
                const status = await platform.getStatus();
                statuses.set(name, status);
            }
            catch (error) {
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
    getActiveStreams() {
        return new Map(this.activeStreams);
    }
    /**
     * Update configuration
     */
    updateConfig(newConfig) {
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
    async validateWebhookRequest(payload, signature, timestamp) {
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
    getUserRateLimitStatus(userId) {
        return this.inputValidator.getRateLimitStatus(userId);
    }
    /**
     * Format validation error message for user
     */
    formatValidationError(validationResult) {
        const errors = validationResult.errors;
        if (errors.includes('Rate limit exceeded')) {
            return '⚠️ You are sending messages too quickly. Please wait a moment before trying again.';
        }
        if (errors.some((e) => e.includes('injection attack'))) {
            return '🚫 Your message contains potentially harmful content and cannot be processed.';
        }
        if (errors.some((e) => e.includes('too long'))) {
            return '📝 Your message is too long. Please shorten it and try again.';
        }
        if (errors.some((e) => e.includes('File too large'))) {
            return '📁 The file you sent is too large. Please send a smaller file.';
        }
        if (errors.some((e) => e.includes('File type not allowed'))) {
            return '🚫 This file type is not allowed. Please send a different file format.';
        }
        // Generic error message
        return '❌ Your message could not be processed due to security restrictions.';
    }
    /**
     * Initialize platforms based on configuration
     */
    async initializePlatforms() {
        const { platforms } = this.config;
        // Initialize Telegram if configured
        if (platforms.telegram?.enabled) {
            const telegramPlatform = new telegram_platform_1.TelegramPlatform(platforms.telegram);
            this.registerPlatform('telegram', telegramPlatform);
            await telegramPlatform.initialize();
        }
        // Initialize Discord if configured
        if (platforms.discord?.enabled) {
            const discordPlatform = new discord_platform_1.DiscordPlatform(platforms.discord);
            this.registerPlatform('discord', discordPlatform);
            await discordPlatform.initialize();
        }
    }
    /**
     * Set up event handlers
     */
    setupEventHandlers() {
        // Handle process shutdown
        process.on('SIGINT', () => this.shutdown());
        process.on('SIGTERM', () => this.shutdown());
    }
    /**
     * Handle incoming messages from platforms
     */
    async handleIncomingMessage(message) {
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
            }
            else {
                console.log(`[BotManager] Validation disabled, skipping validation`);
            }
            // Create message context
            const context = {
                message,
                targetPlatforms: [message.platform],
                conversationId: `${message.platform}_${message.chat.id}`,
                metadata: {
                    receivedAt: new Date(),
                    platform: message.platform,
                    validated: this.config.validation.enabled
                }
            };
            console.log(`[BotManager] Created message context with conversationId: ${context.conversationId}`);
            this.messageContexts.set(message.id, context);
            // Emit message for processing by AgentRunner
            console.log(`[BotManager] 📤 Emitting 'messageReceived' event...`);
            this.emit('messageReceived', context);
            console.log(`[BotManager] ✅ 'messageReceived' event emitted successfully`);
        }
        catch (error) {
            console.error('[BotManager] ❌ Error handling incoming message:', error);
            this.emit('messageError', message, error);
        }
    }
    /**
     * Handle platform status changes
     */
    handlePlatformStatusChange(platformName, status) {
        this.emit('platformStatusChanged', platformName, status);
        if (!status.connected) {
            console.warn(`Platform ${platformName} disconnected:`, status.error);
        }
        else {
            console.log(`Platform ${platformName} connected`);
        }
    }
    /**
     * Format text for specific platform
     */
    formatTextForPlatform(text, platformName) {
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
    async sendWithTimeout(platform, text, options, timeoutMs) {
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
exports.BotIntegrationManager = BotIntegrationManager;
/**
 * Default bot integration configuration
 */
exports.defaultBotIntegrationConfig = {
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
function createBotIntegrationManager(config = {}) {
    const fullConfig = { ...exports.defaultBotIntegrationConfig, ...config };
    return new BotIntegrationManager(fullConfig);
}
