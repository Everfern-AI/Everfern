/**
 * Platform Interface for Multi-Platform Integration
 *
 * This module defines the core interfaces and base classes for integrating
 * external messaging platforms (Telegram, Discord) with EverFern.
 */

/**
 * Represents a file attachment from a platform
 */
export interface PlatformFile {
  /** Unique identifier for the file on the platform */
  id: string;
  /** Original filename */
  name: string;
  /** MIME type of the file */
  mimeType: string;
  /** File size in bytes */
  size: number;
  /** URL or path to download the file */
  url: string;
  /** Optional caption or description */
  caption?: string;
}

/**
 * Represents an incoming message from a platform
 */
export interface IncomingMessage {
  /** Unique message identifier on the platform */
  id: string;
  /** Platform identifier (telegram, discord) */
  platform: string;
  /** User who sent the message */
  user: {
    /** Platform-specific user ID */
    id: string;
    /** Display name or username */
    name: string;
    /** Optional avatar URL */
    avatar?: string;
  };
  /** Chat/channel where message was sent */
  chat: {
    /** Platform-specific chat ID */
    id: string;
    /** Chat name or title */
    name: string;
    /** Chat type (private, group, channel) */
    type: 'private' | 'group' | 'channel';
    /** Optional platform thread ID for threaded conversations */
    threadId?: string;
  };
  /** Message content */
  content: {
    /** Text content of the message */
    text: string;
    /** File attachments */
    files: PlatformFile[];
    /** Whether this message mentions the bot */
    isMention: boolean;
    /** Original message if this is a reply */
    replyTo?: {
      id: string;
      text: string;
      user: string;
    };
  };
  /** Message timestamp */
  timestamp: Date;
  /** Raw platform-specific message data */
  raw: any;
  /** Normalized routing metadata used by the bot harness */
  metadata?: {
    conversationKey?: string;
    replyTargetId?: string;
    sourceGuildId?: string;
    sourceChannelId?: string;
    sourceThreadId?: string;
  };
}

/**
 * Options for sending messages to a platform
 */
export interface SendOptions {
  /** Target chat/channel ID */
  chatId: string;
  /** Message to reply to (optional) */
  replyToMessageId?: string;
  /** Whether to parse markdown formatting */
  parseMode?: 'markdown' | 'html' | 'none';
  /** Whether to disable link previews */
  disableWebPagePreview?: boolean;
  /** Whether to send silently (no notification) */
  silent?: boolean;
  /** Files to attach to the message */
  attachments?: {
    /** File path or buffer */
    file: string | Buffer;
    /** Filename for the attachment */
    filename: string;
    /** Optional caption */
    caption?: string;
  }[];
}

/**
 * Platform connection status
 */
export interface PlatformStatus {
  /** Whether the platform is connected */
  connected: boolean;
  /** Connection error message if any */
  error?: string;
  /** Last successful connection timestamp */
  lastConnected?: Date;
  /** Platform-specific status information */
  details?: Record<string, any>;
}

/**
 * Platform configuration interface
 */
export interface PlatformConfig {
  /** Whether the platform is enabled */
  enabled: boolean;
  /** Platform-specific configuration */
  config: Record<string, any>;
}

/**
 * Abstract base class for messaging platform integrations
 */
export abstract class MessagePlatform {
  protected platformName: string;
  protected config: PlatformConfig;
  protected messageHandlers: Set<(message: IncomingMessage) => void> = new Set();
  protected statusHandlers: Set<(status: PlatformStatus) => void> = new Set();

  constructor(platformName: string, config: PlatformConfig) {
    this.platformName = platformName;
    this.config = config;
  }

  /**
   * Initialize the platform connection
   */
  abstract initialize(): Promise<void>;

  /**
   * Disconnect from the platform
   */
  abstract disconnect(): Promise<void>;

  /**
   * Send a message to the platform
   */
  abstract sendMessage(text: string, options: SendOptions): Promise<string>;

  /**
   * Send a typing indicator
   */
  abstract sendTyping(chatId: string): Promise<void>;

  /**
   * Get current platform status
   */
  abstract getStatus(): Promise<PlatformStatus>;

  /**
   * Test the platform connection
   */
  abstract testConnection(): Promise<boolean>;

  /**
   * Download a file from the platform
   */
  abstract downloadFile(file: PlatformFile, localPath: string): Promise<void>;

  /**
   * Get platform-specific user information
   */
  abstract getUserInfo(userId: string): Promise<{
    id: string;
    name: string;
    avatar?: string;
    isBot?: boolean;
  }>;

  /**
   * Register a message handler
   */
  onMessage(handler: (message: IncomingMessage) => void): void {
    this.messageHandlers.add(handler);
  }

  /**
   * Remove a message handler
   */
  offMessage(handler: (message: IncomingMessage) => void): void {
    this.messageHandlers.delete(handler);
  }

  /**
   * Register a status change handler
   */
  onStatusChange(handler: (status: PlatformStatus) => void): void {
    this.statusHandlers.add(handler);
  }

  /**
   * Remove a status change handler
   */
  offStatusChange(handler: (status: PlatformStatus) => void): void {
    this.statusHandlers.delete(handler);
  }

  /**
   * Emit a message to all registered handlers
   */
  protected emitMessage(message: IncomingMessage): void {
    this.messageHandlers.forEach(handler => {
      try {
        handler(message);
      } catch (error) {
        console.error(`Error in message handler for ${this.platformName}:`, error);
      }
    });
  }

  /**
   * Emit a status change to all registered handlers
   */
  protected emitStatusChange(status: PlatformStatus): void {
    this.statusHandlers.forEach(handler => {
      try {
        handler(status);
      } catch (error) {
        console.error(`Error in status handler for ${this.platformName}:`, error);
      }
    });
  }

  /**
   * Get platform name
   */
  getPlatformName(): string {
    return this.platformName;
  }

  /**
   * Get platform configuration
   */
  getConfig(): PlatformConfig {
    return { ...this.config };
  }

  /**
   * Update platform configuration
   */
  updateConfig(newConfig: Partial<PlatformConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * Validate message content for platform-specific constraints
   */
  protected validateMessage(text: string, options: SendOptions): void {
    if (!text && (!options.attachments || options.attachments.length === 0)) {
      throw new Error('Message must contain text or attachments');
    }
  }

  /**
   * Format text for platform-specific markdown/formatting
   */
  protected abstract formatText(text: string, parseMode?: string): string;

  /**
   * Extract mentions from message text
   */
  protected extractMentions(text: string): string[] {
    const mentionRegex = /@(\w+)/g;
    const mentions: string[] = [];
    let match;

    while ((match = mentionRegex.exec(text)) !== null) {
      mentions.push(match[1]);
    }

    return mentions;
  }

  /**
   * Check if message is a bot mention
   */
  protected abstract isBotMentioned(message: any): boolean;

  /**
   * Sanitize user input to prevent injection attacks
   */
  protected sanitizeInput(input: string): string {
    // Remove potentially dangerous characters and sequences
    return input
      .replace(/[<>]/g, '') // Remove HTML-like tags
      .replace(/javascript:/gi, '') // Remove javascript: protocol
      .replace(/data:/gi, '') // Remove data: protocol
      .trim();
  }
}

/**
 * Base platform error class
 */
export class PlatformError extends Error {
  constructor(
    message: string,
    public platform: string,
    public code?: string,
    public details?: any
  ) {
    super(message);
    this.name = 'PlatformError';
  }
}

/**
 * Platform connection error
 */
export class PlatformConnectionError extends PlatformError {
  constructor(platform: string, message: string, details?: any) {
    super(`Connection error for ${platform}: ${message}`, platform, 'CONNECTION_ERROR', details);
    this.name = 'PlatformConnectionError';
  }
}

/**
 * Platform authentication error
 */
export class PlatformAuthError extends PlatformError {
  constructor(platform: string, message: string, details?: any) {
    super(`Authentication error for ${platform}: ${message}`, platform, 'AUTH_ERROR', details);
    this.name = 'PlatformAuthError';
  }
}

/**
 * Platform rate limit error
 */
export class PlatformRateLimitError extends PlatformError {
  constructor(platform: string, retryAfter?: number, details?: any) {
    const message = retryAfter
      ? `Rate limit exceeded for ${platform}. Retry after ${retryAfter}s`
      : `Rate limit exceeded for ${platform}`;
    super(message, platform, 'RATE_LIMIT', { retryAfter, ...details });
    this.name = 'PlatformRateLimitError';
  }
}
