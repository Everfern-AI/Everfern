/**
 * Conversation Context Management
 *
 * This module manages conversation state and context across multiple platforms,
 * enabling seamless conversation flow and history synchronization.
 */

import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { EventEmitter } from 'events';
import { IncomingMessage, MessagePlatform } from './platform-interface';

/**
 * Conversation participant information
 */
export interface ConversationParticipant {
  /** Unified user ID across platforms */
  userId: string;
  /** Platform-specific user information */
  platforms: Map<string, {
    id: string;
    name: string;
    avatar?: string;
  }>;
  /** User role in conversation */
  role: 'user' | 'assistant' | 'system';
  /** Last activity timestamp */
  lastActive: Date;
}

/**
 * Conversation message for context tracking
 */
export interface ConversationMessage {
  /** Unique message ID */
  id: string;
  /** Conversation ID this message belongs to */
  conversationId: string;
  /** Message sender */
  sender: ConversationParticipant;
  /** Message content */
  content: {
    text: string;
    files: Array<{
      id: string;
      name: string;
      mimeType: string;
      localPath?: string;
    }>;
    metadata: Record<string, any>;
  };
  /** Message timestamp */
  timestamp: Date;
  /** Platform where message originated */
  platform: string;
  /** Whether this is a system message */
  isSystem: boolean;
  /** Message thread/reply information */
  thread?: {
    parentId: string;
    depth: number;
  };
}

/**
 * Conversation state information
 */
export interface ConversationState {
  /** Unique conversation ID */
  id: string;
  /** Conversation title/name */
  title: string;
  /** Participants in the conversation */
  participants: Map<string, ConversationParticipant>;
  /** Platforms involved in this conversation */
  platforms: Set<string>;
  /** Current conversation status */
  status: 'active' | 'paused' | 'archived' | 'stopped';
  /** Conversation metadata */
  metadata: {
    createdAt: Date;
    lastActivity: Date;
    messageCount: number;
    totalTokens?: number;
    tags: string[];
    priority: 'low' | 'normal' | 'high';
  };
  /** Current context window */
  contextWindow: {
    maxMessages: number;
    maxTokens: number;
    currentMessages: ConversationMessage[];
    summary?: string;
  };
  /** Stop command handling */
  stopRequested: boolean;
  /** Cross-platform sync settings */
  syncSettings: {
    enabled: boolean;
    syncPlatforms: string[];
    syncDelay: number;
  };
}

/**
 * Context management configuration
 */
export interface ContextConfig {
  /** Base directory for conversation storage */
  baseDir: string;
  /** Maximum messages to keep in active context */
  maxContextMessages: number;
  /** Maximum tokens in context window */
  maxContextTokens: number;
  /** How often to save context to disk (ms) */
  saveInterval: number;
  /** How long to keep inactive conversations (days) */
  retentionDays: number;
  /** Whether to enable automatic summarization */
  enableSummarization: boolean;
  /** Cross-platform sync configuration */
  crossPlatformSync: {
    enabled: boolean;
    syncDelay: number;
    conflictResolution: 'timestamp' | 'platform_priority' | 'manual';
  };
}

/**
 * Stop command information
 */
export interface StopCommand {
  /** Command ID */
  id: string;
  /** Conversation ID */
  conversationId: string;
  /** User who issued the stop command */
  userId: string;
  /** Platform where command was issued */
  platform: string;
  /** Timestamp of stop command */
  timestamp: Date;
  /** Whether stop was propagated to other platforms */
  propagated: boolean;
}

/**
 * Main conversation context manager
 */
export class ConversationContextManager extends EventEmitter {
  private config: ContextConfig;
  private conversations = new Map<string, ConversationState>();
  private platforms = new Map<string, MessagePlatform>();
  private saveTimer: NodeJS.Timeout | null = null;
  private isInitialized = false;

  constructor(config: Partial<ContextConfig> = {}) {
    super();
    this.config = {
      baseDir: path.join(os.homedir(), '.everfern', 'conversations'),
      maxContextMessages: 50,
      maxContextTokens: 8000,
      saveInterval: 30000, // 30 seconds
      retentionDays: 90,
      enableSummarization: true,
      crossPlatformSync: {
        enabled: true,
        syncDelay: 1000, // 1 second
        conflictResolution: 'timestamp'
      },
      ...config
    };
  }

  /**
   * Initialize the conversation context manager
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      // Create base directory
      await fs.mkdir(this.config.baseDir, { recursive: true });

      // Load existing conversations
      await this.loadConversations();

      // Start periodic save timer
      this.startSaveTimer();

      this.isInitialized = true;
      this.emit('initialized');

      console.log('ConversationContextManager initialized successfully');
    } catch (error) {
      console.error('Failed to initialize ConversationContextManager:', error);
      throw error;
    }
  }

  /**
   * Shutdown the context manager
   */
  async shutdown(): Promise<void> {
    if (!this.isInitialized) {
      return;
    }

    try {
      // Stop save timer
      if (this.saveTimer) {
        clearInterval(this.saveTimer);
        this.saveTimer = null;
      }

      // Save all conversations
      await this.saveAllConversations();

      // Clear memory
      this.conversations.clear();
      this.platforms.clear();

      this.isInitialized = false;
      this.emit('shutdown');

      console.log('ConversationContextManager shutdown successfully');
    } catch (error) {
      console.error('Error during ConversationContextManager shutdown:', error);
      throw error;
    }
  }

  /**
   * Register a platform for context management
   */
  registerPlatform(name: string, platform: MessagePlatform): void {
    this.platforms.set(name, platform);
    this.emit('platformRegistered', name);
  }

  /**
   * Process an incoming message and update conversation context
   */
  async processMessage(message: IncomingMessage): Promise<ConversationState> {
    const conversationId = this.generateConversationId(message);

    // Get or create conversation
    let conversation = this.conversations.get(conversationId);
    if (!conversation) {
      conversation = await this.createConversation(conversationId, message);
    }

    // Add participant if not exists
    await this.ensureParticipant(conversation, message);

    // Create conversation message
    const conversationMessage: ConversationMessage = {
      id: message.id,
      conversationId,
      sender: await this.getParticipant(conversation, message.user.id),
      content: {
        text: message.content.text,
        files: message.content.files.map(f => ({
          id: f.id,
          name: f.name,
          mimeType: f.mimeType
        })),
        metadata: {
          isMention: message.content.isMention,
          replyTo: message.content.replyTo,
          platform: message.platform
        }
      },
      timestamp: message.timestamp,
      platform: message.platform,
      isSystem: false
    };

    // Add message to context
    await this.addMessageToContext(conversation, conversationMessage);

    // Update conversation metadata
    conversation.metadata.lastActivity = new Date();
    conversation.metadata.messageCount++;
    conversation.platforms.add(message.platform);

    // Handle cross-platform sync
    if (this.config.crossPlatformSync.enabled && conversation.syncSettings.enabled) {
      await this.syncConversationAcrossPlatforms(conversation, conversationMessage);
    }

    this.emit('messageProcessed', conversationId, conversationMessage);
    return conversation;
  }

  /**
   * Add a system message to conversation context
   */
  async addSystemMessage(
    conversationId: string,
    content: string,
    metadata: Record<string, any> = {}
  ): Promise<void> {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) {
      return;
    }

    const systemMessage: ConversationMessage = {
      id: `system_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      conversationId,
      sender: {
        userId: 'system',
        platforms: new Map(),
        role: 'system',
        lastActive: new Date()
      },
      content: {
        text: content,
        files: [],
        metadata
      },
      timestamp: new Date(),
      platform: 'system',
      isSystem: true
    };

    await this.addMessageToContext(conversation, systemMessage);
    this.emit('systemMessageAdded', conversationId, systemMessage);
  }

  /**
   * Add a narrative message to conversation (for UI display only, not included in chat context)
   *
   * Narrative messages are explanatory text meant for the user to read but should not
   * be sent to the AI model as part of the conversation context.
   */
  async addNarrativeMessage(
    conversationId: string,
    content: string,
    metadata: Record<string, any> = {}
  ): Promise<ConversationMessage> {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) {
      throw new Error(`Conversation ${conversationId} not found`);
    }

    const narrativeMessage: ConversationMessage = {
      id: `narrative_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      conversationId,
      sender: {
        userId: 'system',
        platforms: new Map(),
        role: 'system',
        lastActive: new Date()
      },
      content: {
        text: content,
        files: [],
        metadata: {
          ...metadata,
          isNarrative: true  // Mark as narrative so it won't be added to chat context
        }
      },
      timestamp: new Date(),
      platform: 'system',
      isSystem: true
    };

    // Emit event for UI display - narrative messages are not stored in conversation context
    // They are handled by the UI layer and filtered out before sending to AI
    this.emit('narrativeMessageAdded', conversationId, narrativeMessage);

    return narrativeMessage;
  }

  /**
   * Handle stop command from any platform
   */
  async handleStopCommand(
    conversationId: string,
    userId: string,
    platform: string
  ): Promise<StopCommand> {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) {
      throw new Error(`Conversation ${conversationId} not found`);
    }

    const stopCommand: StopCommand = {
      id: `stop_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      conversationId,
      userId,
      platform,
      timestamp: new Date(),
      propagated: false
    };

    // Mark conversation as stopped
    conversation.stopRequested = true;
    conversation.status = 'stopped';

    // Add system message about stop
    await this.addSystemMessage(
      conversationId,
      `Stop command issued by user ${userId} from ${platform}`,
      { stopCommand: stopCommand.id }
    );

    // Propagate stop to other platforms if cross-sync is enabled
    if (conversation.syncSettings.enabled) {
      await this.propagateStopCommand(conversation, stopCommand);
    }

    this.emit('stopCommandReceived', stopCommand);
    return stopCommand;
  }

  /**
   * Get conversation by ID
   */
  getConversation(conversationId: string): ConversationState | undefined {
    return this.conversations.get(conversationId);
  }

  /**
   * Get conversation context for agent processing
   */
  getConversationContext(conversationId: string): ConversationMessage[] {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) {
      return [];
    }

    return [...conversation.contextWindow.currentMessages];
  }

  /**
   * Update conversation sync settings
   */
  updateSyncSettings(
    conversationId: string,
    settings: Partial<ConversationState['syncSettings']>
  ): void {
    const conversation = this.conversations.get(conversationId);
    if (conversation) {
      conversation.syncSettings = { ...conversation.syncSettings, ...settings };
      this.emit('syncSettingsUpdated', conversationId, conversation.syncSettings);
    }
  }

  /**
   * Archive old conversations
   */
  async archiveOldConversations(): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.config.retentionDays);

    let archivedCount = 0;

    for (const [id, conversation] of this.conversations) {
      if (conversation.metadata.lastActivity < cutoffDate && conversation.status !== 'active') {
        conversation.status = 'archived';
        await this.saveConversation(conversation);
        this.conversations.delete(id);
        archivedCount++;
      }
    }

    return archivedCount;
  }

  /**
   * Generate conversation ID from message
   */
  private generateConversationId(message: IncomingMessage): string {
    // Use platform and chat ID to create unique conversation ID
    return `${message.platform}_${message.chat.id}`;
  }

  /**
   * Create a new conversation
   */
  private async createConversation(
    conversationId: string,
    initialMessage: IncomingMessage
  ): Promise<ConversationState> {
    const conversation: ConversationState = {
      id: conversationId,
      title: initialMessage.chat.name || `Conversation ${conversationId}`,
      participants: new Map(),
      platforms: new Set([initialMessage.platform]),
      status: 'active',
      metadata: {
        createdAt: new Date(),
        lastActivity: new Date(),
        messageCount: 0,
        tags: [],
        priority: 'normal'
      },
      contextWindow: {
        maxMessages: this.config.maxContextMessages,
        maxTokens: this.config.maxContextTokens,
        currentMessages: []
      },
      stopRequested: false,
      syncSettings: {
        enabled: this.config.crossPlatformSync.enabled,
        syncPlatforms: [],
        syncDelay: this.config.crossPlatformSync.syncDelay
      }
    };

    this.conversations.set(conversationId, conversation);
    this.emit('conversationCreated', conversation);

    return conversation;
  }

  /**
   * Ensure participant exists in conversation
   */
  private async ensureParticipant(
    conversation: ConversationState,
    message: IncomingMessage
  ): Promise<void> {
    const userId = message.user.id; // This would be unified user ID in real implementation

    if (!conversation.participants.has(userId)) {
      const participant: ConversationParticipant = {
        userId,
        platforms: new Map([[message.platform, {
          id: message.user.id,
          name: message.user.name,
          avatar: message.user.avatar
        }]]),
        role: 'user',
        lastActive: new Date()
      };

      conversation.participants.set(userId, participant);
    } else {
      // Update platform info
      const participant = conversation.participants.get(userId)!;
      participant.platforms.set(message.platform, {
        id: message.user.id,
        name: message.user.name,
        avatar: message.user.avatar
      });
      participant.lastActive = new Date();
    }
  }

  /**
   * Get participant by user ID
   */
  private async getParticipant(
    conversation: ConversationState,
    userId: string
  ): Promise<ConversationParticipant> {
    const participant = conversation.participants.get(userId);
    if (!participant) {
      throw new Error(`Participant ${userId} not found in conversation`);
    }
    return participant;
  }

  /**
   * Add message to conversation context
   */
  private async addMessageToContext(
    conversation: ConversationState,
    message: ConversationMessage
  ): Promise<void> {
    const context = conversation.contextWindow;

    // Filter out narrative content - don't add to chat context if marked as narrative
    if (message.content.metadata?.isNarrative === true) {
      console.debug(`[ConversationContext] Skipping narrative message ${message.id} from chat context`);
      return;
    }

    // Add message to context
    context.currentMessages.push(message);

    // Trim context if it exceeds limits
    while (context.currentMessages.length > context.maxMessages) {
      const removed = context.currentMessages.shift();
      if (removed && this.config.enableSummarization) {
        // In a real implementation, this would create a summary
        context.summary = `Previous messages summarized (${context.currentMessages.length} messages removed)`;
      }
    }

    // Estimate tokens and trim if necessary
    const estimatedTokens = this.estimateTokens(context.currentMessages);
    while (estimatedTokens > context.maxTokens && context.currentMessages.length > 1) {
      context.currentMessages.shift();
    }
  }

  /**
   * Sync conversation across platforms
   */
  private async syncConversationAcrossPlatforms(
    conversation: ConversationState,
    message: ConversationMessage
  ): Promise<void> {
    if (!conversation.syncSettings.enabled) {
      return;
    }

    // Delay sync to batch multiple messages
    setTimeout(async () => {
      try {
        for (const platformName of conversation.syncSettings.syncPlatforms) {
          if (platformName !== message.platform) {
            const platform = this.platforms.get(platformName);
            if (platform) {
              // Send message to other platforms
              // Implementation would depend on specific sync requirements
              this.emit('messageSynced', conversation.id, message.id, platformName);
            }
          }
        }
      } catch (error) {
        console.error('Error syncing message across platforms:', error);
      }
    }, conversation.syncSettings.syncDelay);
  }

  /**
   * Propagate stop command to other platforms
   */
  private async propagateStopCommand(
    conversation: ConversationState,
    stopCommand: StopCommand
  ): Promise<void> {
    for (const platformName of conversation.platforms) {
      if (platformName !== stopCommand.platform) {
        const platform = this.platforms.get(platformName);
        if (platform) {
          try {
            // Send stop notification to other platforms
            // Implementation would depend on platform capabilities
            this.emit('stopCommandPropagated', stopCommand.id, platformName);
          } catch (error) {
            console.error(`Error propagating stop command to ${platformName}:`, error);
          }
        }
      }
    }

    stopCommand.propagated = true;
  }

  /**
   * Estimate token count for messages
   */
  private estimateTokens(messages: ConversationMessage[]): number {
    // Simple estimation: ~4 characters per token
    let totalChars = 0;
    for (const message of messages) {
      totalChars += message.content.text.length;
    }
    return Math.ceil(totalChars / 4);
  }

  /**
   * Start periodic save timer
   */
  private startSaveTimer(): void {
    this.saveTimer = setInterval(async () => {
      try {
        await this.saveAllConversations();
      } catch (error) {
        console.error('Error during periodic save:', error);
      }
    }, this.config.saveInterval);
  }

  /**
   * Save all conversations to disk
   */
  private async saveAllConversations(): Promise<void> {
    const savePromises = Array.from(this.conversations.values()).map(
      conversation => this.saveConversation(conversation)
    );

    await Promise.allSettled(savePromises);
  }

  /**
   * Save individual conversation to disk
   */
  private async saveConversation(conversation: ConversationState): Promise<void> {
    const filePath = path.join(this.config.baseDir, `${conversation.id}.json`);

    // Convert Map objects to plain objects for JSON serialization
    const serializable = {
      ...conversation,
      participants: Object.fromEntries(
        Array.from(conversation.participants.entries()).map(([id, participant]) => [
          id,
          {
            ...participant,
            platforms: Object.fromEntries(participant.platforms)
          }
        ])
      ),
      platforms: Array.from(conversation.platforms)
    };

    await fs.writeFile(filePath, JSON.stringify(serializable, null, 2), 'utf-8');
  }

  /**
   * Load conversations from disk
   */
  private async loadConversations(): Promise<void> {
    try {
      const files = await fs.readdir(this.config.baseDir);

      for (const filename of files) {
        if (filename.endsWith('.json')) {
          try {
            const filePath = path.join(this.config.baseDir, filename);
            const data = await fs.readFile(filePath, 'utf-8');
            const serialized = JSON.parse(data);

            // Convert back to Map objects
            const conversation: ConversationState = {
              ...serialized,
              participants: new Map(
                Object.entries(serialized.participants).map(([id, participant]: [string, any]) => [
                  id,
                  {
                    ...participant,
                    platforms: new Map(Object.entries(participant.platforms))
                  }
                ])
              ),
              platforms: new Set(serialized.platforms)
            };

            this.conversations.set(conversation.id, conversation);
          } catch (error) {
            console.error(`Error loading conversation from ${filename}:`, error);
          }
        }
      }
    } catch (error) {
      // Directory might not exist yet, which is fine
    }
  }
}

/**
 * Create a conversation context manager with default configuration
 */
export function createConversationContextManager(
  config: Partial<ContextConfig> = {}
): ConversationContextManager {
  return new ConversationContextManager(config);
}
