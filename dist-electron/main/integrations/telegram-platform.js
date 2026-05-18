"use strict";
/**
 * Telegram Platform Integration
 *
 * This module implements the Telegram bot integration for EverFern using
 * the Telegram Bot API via node-telegram-bot-api.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TelegramPlatform = void 0;
const node_telegram_bot_api_1 = __importDefault(require("node-telegram-bot-api"));
const platform_interface_1 = require("./platform-interface");
/**
 * Telegram platform implementation
 */
class TelegramPlatform extends platform_interface_1.MessagePlatform {
    bot = null;
    botInfo = null;
    isPolling = false;
    reconnectAttempts = 0;
    maxReconnectAttempts = 5;
    reconnectDelay = 5000; // 5 seconds
    constructor(config) {
        super('telegram', config);
    }
    /**
     * Initialize the Telegram bot connection
     */
    async initialize() {
        const telegramConfig = this.config;
        if (!telegramConfig.config.botToken) {
            throw new platform_interface_1.PlatformAuthError('telegram', 'Bot token is required');
        }
        try {
            // Create bot instance with polling disabled initially
            // We'll explicitly delete webhook and start polling later
            this.bot = new node_telegram_bot_api_1.default(telegramConfig.config.botToken, {
                polling: false
            });
            // Get bot information
            this.botInfo = await this.bot.getMe();
            // Update bot username in config if not set
            if (!telegramConfig.config.botUsername) {
                telegramConfig.config.botUsername = this.botInfo.username;
            }
            // Set up message handlers
            this.setupMessageHandlers();
            // Ensure no webhook is active before starting polling
            // This fixes the "connection failed" issue when a webhook was previously set
            await this.bot.deleteWebHook();
            // Start polling
            await this.bot.startPolling();
            this.isPolling = true;
            this.reconnectAttempts = 0;
            this.emitStatusChange({
                connected: true,
                lastConnected: new Date(),
                details: {
                    botId: this.botInfo.id,
                    botUsername: this.botInfo.username,
                    mode: 'polling'
                }
            });
        }
        catch (error) {
            const errorMessage = error.message || 'Unknown error';
            if (error.code === 401) {
                throw new platform_interface_1.PlatformAuthError('telegram', 'Invalid bot token');
            }
            else if (error.code === 'ETELEGRAM') {
                throw new platform_interface_1.PlatformConnectionError('telegram', errorMessage, error);
            }
            else {
                throw new platform_interface_1.PlatformConnectionError('telegram', errorMessage, error);
            }
        }
    }
    /**
     * Disconnect from Telegram
     */
    async disconnect() {
        if (this.bot) {
            try {
                if (this.isPolling) {
                    await this.bot.stopPolling();
                    this.isPolling = false;
                }
                this.bot = null;
                this.botInfo = null;
                this.emitStatusChange({
                    connected: false,
                    details: { disconnectedAt: new Date() }
                });
            }
            catch (error) {
                console.error('Error disconnecting from Telegram:', error);
            }
        }
    }
    /**
     * Send a message to Telegram
     */
    async sendMessage(text, options) {
        if (!this.bot) {
            throw new platform_interface_1.PlatformConnectionError('telegram', 'Bot not initialized');
        }
        this.validateMessage(text, options);
        try {
            const telegramOptions = {
                parse_mode: this.mapParseMode(options.parseMode),
                disable_web_page_preview: options.disableWebPagePreview,
                disable_notification: options.silent,
                reply_to_message_id: options.replyToMessageId ? parseInt(options.replyToMessageId) : undefined
            };
            // Format text for Telegram
            const formattedText = this.formatText(text, options.parseMode);
            // Send text message
            const message = await this.bot.sendMessage(options.chatId, formattedText, telegramOptions);
            // Send attachments if any
            if (options.attachments && options.attachments.length > 0) {
                for (const attachment of options.attachments) {
                    await this.sendAttachment(options.chatId, attachment, {
                        reply_to_message_id: message.message_id
                    });
                }
            }
            return message.message_id.toString();
        }
        catch (error) {
            this.handleTelegramError(error);
            throw error;
        }
    }
    /**
     * Edit an existing message in Telegram
     */
    async editMessage(chatId, messageId, text, parseMode) {
        if (!this.bot) {
            throw new platform_interface_1.PlatformConnectionError('telegram', 'Bot not initialized');
        }
        try {
            const formattedText = this.formatText(text, parseMode);
            await this.bot.editMessageText(formattedText, {
                chat_id: chatId,
                message_id: parseInt(messageId),
                parse_mode: this.mapParseMode(parseMode)
            });
        }
        catch (error) {
            // If editing fails (e.g., message too old or identical content),
            // delete the old message and send a new one
            if (error.code === 400 || error.message?.includes('message is not modified')) {
                try {
                    await this.bot.deleteMessage(chatId, parseInt(messageId));
                    await this.bot.sendMessage(chatId, this.formatText(text, parseMode), {
                        parse_mode: this.mapParseMode(parseMode)
                    });
                }
                catch (deleteError) {
                    console.error('Failed to delete and resend message:', deleteError);
                }
            }
            else {
                this.handleTelegramError(error);
                throw error;
            }
        }
    }
    /**
     * Send typing indicator
     */
    async sendTyping(chatId) {
        if (!this.bot) {
            throw new platform_interface_1.PlatformConnectionError('telegram', 'Bot not initialized');
        }
        try {
            await this.bot.sendChatAction(chatId, 'typing');
        }
        catch (error) {
            this.handleTelegramError(error);
            throw error;
        }
    }
    /**
     * Get platform status
     */
    async getStatus() {
        if (!this.bot || !this.botInfo) {
            return {
                connected: false,
                error: 'Bot not initialized'
            };
        }
        try {
            // Test connection by getting bot info
            const botInfo = await this.bot.getMe();
            return {
                connected: true,
                lastConnected: new Date(),
                details: {
                    botId: botInfo.id,
                    botUsername: botInfo.username,
                    mode: 'polling'
                }
            };
        }
        catch (error) {
            return {
                connected: false,
                error: error.message || 'Connection test failed'
            };
        }
    }
    /**
     * Test the connection
     */
    async testConnection() {
        try {
            const status = await this.getStatus();
            return status.connected;
        }
        catch {
            return false;
        }
    }
    /**
     * Download a file from Telegram
     */
    async downloadFile(file, localPath) {
        if (!this.bot) {
            throw new platform_interface_1.PlatformConnectionError('telegram', 'Bot not initialized');
        }
        try {
            const fileStream = this.bot.getFileStream(file.id);
            const writeStream = require('fs').createWriteStream(localPath);
            return new Promise((resolve, reject) => {
                fileStream.pipe(writeStream);
                writeStream.on('finish', resolve);
                writeStream.on('error', reject);
                fileStream.on('error', reject);
            });
        }
        catch (error) {
            this.handleTelegramError(error);
            throw error;
        }
    }
    /**
     * Get user information
     */
    async getUserInfo(userId) {
        if (!this.bot) {
            throw new platform_interface_1.PlatformConnectionError('telegram', 'Bot not initialized');
        }
        try {
            // Telegram doesn't have a direct getUserInfo API
            // We'll need to get this from chat members or message context
            // For now, return basic info
            return {
                id: userId,
                name: `User ${userId}`,
                isBot: false
            };
        }
        catch (error) {
            this.handleTelegramError(error);
            throw error;
        }
    }
    /**
     * Format text for Telegram markdown
     */
    formatText(text, parseMode) {
        if (parseMode === 'markdown') {
            // Convert standard markdown to Telegram MarkdownV2 format
            // In Telegram MarkdownV2: * = bold, _ = italic, ` = code
            // Standard markdown: ** = bold, * = italic, ` = code
            let formatted = text;
            // Step 1: Temporarily replace markdown patterns with placeholders
            const boldPattern = /\*\*(.+?)\*\*/g;
            const italicPattern = /\*(.+?)\*/g;
            const codePattern = /`(.+?)`/g;
            const boldMatches = [];
            const italicMatches = [];
            const codeMatches = [];
            // Extract bold text (**text**)
            let boldIndex = 0;
            formatted = formatted.replace(boldPattern, (match, content) => {
                const placeholder = `@@BOLD${boldIndex}@@`;
                boldMatches.push({ placeholder, content });
                boldIndex++;
                return placeholder;
            });
            // Extract italic text (*text*)
            let italicIndex = 0;
            formatted = formatted.replace(italicPattern, (match, content) => {
                const placeholder = `@@ITALIC${italicIndex}@@`;
                italicMatches.push({ placeholder, content });
                italicIndex++;
                return placeholder;
            });
            // Extract code text (`text`)
            let codeIndex = 0;
            formatted = formatted.replace(codePattern, (match, content) => {
                const placeholder = `@@CODE${codeIndex}@@`;
                codeMatches.push({ placeholder, content });
                codeIndex++;
                return placeholder;
            });
            // Step 2: Escape special characters in the remaining text
            formatted = formatted.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
            // Step 3: Restore markdown with proper Telegram formatting
            // Restore code blocks (no escaping needed inside code)
            codeMatches.forEach(({ placeholder, content }) => {
                formatted = formatted.replace(placeholder, `\`${content}\``);
            });
            // Restore bold (**text** -> *text* in Telegram)
            boldMatches.forEach(({ placeholder, content }) => {
                // Escape special chars in content except those already escaped
                const escaped = content.replace(/([_\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
                formatted = formatted.replace(placeholder, `*${escaped}*`);
            });
            // Restore italic (*text* -> _text_ in Telegram)
            italicMatches.forEach(({ placeholder, content }) => {
                const escaped = content.replace(/([*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
                formatted = formatted.replace(placeholder, `_${escaped}_`);
            });
            return formatted;
        }
        else if (parseMode === 'html') {
            // HTML mode - ensure proper HTML encoding
            return text
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
        }
        return text;
    }
    /**
     * Check if bot is mentioned in message
     */
    isBotMentioned(message) {
        if (!this.botInfo)
            return false;
        const text = message.text || message.caption || '';
        const botUsername = this.botInfo.username;
        // Check for @username mention
        if (botUsername && text.includes(`@${botUsername}`)) {
            return true;
        }
        // Check for entities (mentions)
        if (message.entities) {
            for (const entity of message.entities) {
                if (entity.type === 'mention' || entity.type === 'text_mention') {
                    const mentionText = text.substring(entity.offset, entity.offset + entity.length);
                    if (mentionText === `@${botUsername}` ||
                        (entity.user && entity.user.id === this.botInfo.id)) {
                        return true;
                    }
                }
            }
        }
        return false;
    }
    /**
     * Set up message handlers
     */
    setupMessageHandlers() {
        if (!this.bot)
            return;
        this.bot.on('message', (message) => {
            this.handleIncomingMessage(message);
        });
        this.bot.on('polling_error', (error) => {
            console.error('Telegram polling error:', error);
            this.handleConnectionError(error);
        });
    }
    /**
     * Handle incoming Telegram message
     */
    handleIncomingMessage(message) {
        const telegramConfig = this.config;
        // Check if chat is allowed
        if (telegramConfig.config.allowedChats &&
            telegramConfig.config.allowedChats.length > 0 &&
            !telegramConfig.config.allowedChats.includes(message.chat.id.toString())) {
            return;
        }
        // Check group message settings
        if (message.chat.type !== 'private') {
            if (!telegramConfig.config.respondToGroups) {
                return;
            }
            if (telegramConfig.config.groupMentionOnly && !this.isBotMentioned(message)) {
                return;
            }
        }
        // Handle /start command
        if (message.text === '/start') {
            this.handleStartCommand(message);
            return;
        }
        // Convert to platform-agnostic format
        const incomingMessage = {
            id: message.message_id.toString(),
            platform: 'telegram',
            user: {
                id: message.from?.id.toString() || 'unknown',
                name: this.getUserDisplayName(message.from),
                avatar: undefined // Telegram doesn't provide avatar URLs directly
            },
            chat: {
                id: message.chat.id.toString(),
                name: this.getChatDisplayName(message.chat),
                type: this.mapChatType(message.chat.type)
            },
            content: {
                text: this.sanitizeInput(message.text || message.caption || ''),
                files: this.extractFiles(message),
                isMention: this.isBotMentioned(message),
                replyTo: message.reply_to_message ? {
                    id: message.reply_to_message.message_id.toString(),
                    text: message.reply_to_message.text || message.reply_to_message.caption || '',
                    user: this.getUserDisplayName(message.reply_to_message.from)
                } : undefined
            },
            timestamp: new Date(message.date * 1000),
            raw: message
        };
        this.emitMessage(incomingMessage);
    }
    /**
     * Handle /start command
     */
    async handleStartCommand(message) {
        if (!this.bot)
            return;
        try {
            const welcomeMessage = `🤖 *Welcome to Everfern Bot!*

I'm your AI assistant powered by Everfern. I can help you with:

• Answering questions
• Writing and analyzing code
• Research and information gathering
• Creative tasks and brainstorming
• And much more!

Just send me a message and I'll be happy to help! 😊`;
            await this.bot.sendMessage(message.chat.id, welcomeMessage, {
                parse_mode: 'Markdown'
            });
        }
        catch (error) {
            console.error('Error handling /start command:', error);
        }
    }
    /**
     * Extract files from Telegram message
     */
    extractFiles(message) {
        const files = [];
        // Handle different file types
        const fileTypes = ['photo', 'document', 'video', 'audio', 'voice', 'sticker'];
        for (const fileType of fileTypes) {
            const fileData = message[fileType];
            if (fileData) {
                if (Array.isArray(fileData)) {
                    // Photos come as array of different sizes
                    const largestPhoto = fileData[fileData.length - 1];
                    files.push(this.createPlatformFile(largestPhoto, fileType, message.caption));
                }
                else {
                    files.push(this.createPlatformFile(fileData, fileType, message.caption));
                }
            }
        }
        return files;
    }
    /**
     * Create PlatformFile from Telegram file data
     */
    createPlatformFile(fileData, fileType, caption) {
        return {
            id: fileData.file_id,
            name: fileData.file_name || `${fileType}_${fileData.file_id}`,
            mimeType: fileData.mime_type || this.getMimeTypeForFileType(fileType),
            size: fileData.file_size || 0,
            url: fileData.file_id, // Telegram uses file_id for downloads
            caption: caption
        };
    }
    /**
     * Get MIME type for Telegram file type
     */
    getMimeTypeForFileType(fileType) {
        const mimeTypes = {
            photo: 'image/jpeg',
            document: 'application/octet-stream',
            video: 'video/mp4',
            audio: 'audio/mpeg',
            voice: 'audio/ogg',
            sticker: 'image/webp'
        };
        return mimeTypes[fileType] || 'application/octet-stream';
    }
    /**
     * Get user display name
     */
    getUserDisplayName(user) {
        if (!user)
            return 'Unknown User';
        if (user.username)
            return `@${user.username}`;
        if (user.first_name && user.last_name)
            return `${user.first_name} ${user.last_name}`;
        if (user.first_name)
            return user.first_name;
        return `User ${user.id}`;
    }
    /**
     * Get chat display name
     */
    getChatDisplayName(chat) {
        if (chat.title)
            return chat.title;
        if (chat.username)
            return `@${chat.username}`;
        if (chat.first_name && chat.last_name)
            return `${chat.first_name} ${chat.last_name}`;
        if (chat.first_name)
            return chat.first_name;
        return `Chat ${chat.id}`;
    }
    /**
     * Map Telegram chat type to platform-agnostic type
     */
    mapChatType(telegramType) {
        switch (telegramType) {
            case 'private':
                return 'private';
            case 'group':
            case 'supergroup':
                return 'group';
            case 'channel':
                return 'channel';
            default:
                return 'private';
        }
    }
    /**
     * Map parse mode to Telegram format
     */
    mapParseMode(parseMode) {
        switch (parseMode) {
            case 'markdown':
                return 'MarkdownV2';
            case 'html':
                return 'HTML';
            default:
                return undefined;
        }
    }
    /**
     * Send attachment to Telegram
     */
    async sendAttachment(chatId, attachment, options = {}) {
        if (!this.bot)
            return;
        try {
            if (attachment.caption) {
                options.caption = attachment.caption;
            }
            await this.bot.sendDocument(chatId, attachment.file, options, {
                filename: attachment.filename
            });
        }
        catch (error) {
            this.handleTelegramError(error);
            throw error;
        }
    }
    /**
     * Handle Telegram API errors
     */
    handleTelegramError(error) {
        if (error.code === 429) {
            const retryAfter = error.parameters?.retry_after || 60;
            throw new platform_interface_1.PlatformRateLimitError('telegram', retryAfter, error);
        }
        else if (error.code === 401) {
            throw new platform_interface_1.PlatformAuthError('telegram', 'Invalid bot token or unauthorized');
        }
        else if (error.code === 403) {
            throw new platform_interface_1.PlatformAuthError('telegram', 'Bot was blocked or chat not found');
        }
    }
    /**
     * Handle connection errors and attempt reconnection
     */
    async handleConnectionError(error) {
        this.emitStatusChange({
            connected: false,
            error: error.message || 'Connection error'
        });
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            console.log(`Attempting to reconnect to Telegram (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
            setTimeout(async () => {
                try {
                    await this.initialize();
                }
                catch (reconnectError) {
                    console.error('Reconnection failed:', reconnectError);
                }
            }, this.reconnectDelay * this.reconnectAttempts);
        }
        else {
            console.error('Max reconnection attempts reached for Telegram');
        }
    }
}
exports.TelegramPlatform = TelegramPlatform;
