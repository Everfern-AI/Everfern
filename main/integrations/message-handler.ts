/**
 * Message Handler for Bot Integrations
 *
 * This module handles incoming messages from bot platforms (Discord, Telegram),
 * processes them through the agent runner, and sends responses back to users.
 *
 * Features:
 * - Streaming responses with message editing
 * - Thinking indicators with emojis during tool calls
 * - File handling (receiving and sending)
 * - Rate limit management
 *
 * Requirements: 4.1-4.7, 5.1-5.4, 6.1-6.6
 */

import { EventEmitter } from 'events';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { BotIntegrationManager, MessageContext } from './bot-manager';
import { MessagePlatform } from './platform-interface';
import { AgentRunner } from '../agent/runner/runner';
import { ACPManager } from '../acp/manager';
import { AIClient } from '../lib/ai-client';

/**
 * Integration configuration interface
 */
export interface IntegrationConfig {
  telegram: {
    enabled: boolean;
    botToken: string;
    connected: boolean;
    model?: string;
    provider?: string;
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

/**
 * Message handler configuration
 */
export interface MessageHandlerConfig {
  integrationConfig: IntegrationConfig;
  acpManager: ACPManager;
  botManager: BotIntegrationManager;
}

/**
 * Rate limiter for Discord API
 */
class RateLimiter {
  private messageTimestamps: number[] = [];
  private editTimestamps: number[] = [];
  private readonly messageLimit = 5; // 5 messages per 5 seconds
  private readonly editLimit = 5; // 5 edits per 5 seconds
  private readonly window = 5000; // 5 seconds

  async waitForMessageSlot(): Promise<void> {
    await this.waitForSlot(this.messageTimestamps, this.messageLimit);
  }

  async waitForEditSlot(): Promise<void> {
    await this.waitForSlot(this.editTimestamps, this.editLimit);
  }

  private async waitForSlot(timestamps: number[], limit: number): Promise<void> {
    const now = Date.now();

    // Remove timestamps outside the window
    while (timestamps.length > 0 && timestamps[0] < now - this.window) {
      timestamps.shift();
    }

    // If we're at the limit, wait until the oldest timestamp expires
    if (timestamps.length >= limit) {
      const oldestTimestamp = timestamps[0];
      const waitTime = (oldestTimestamp + this.window) - now;
      if (waitTime > 0) {
        console.log(`[RateLimiter] Waiting ${waitTime}ms to respect rate limit`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        // Recursively check again
        return this.waitForSlot(timestamps, limit);
      }
    }

    // Add current timestamp
    timestamps.push(now);
  }
}

/**
 * Message handler class
 * Bridges bot manager events with agent runner processing
 */
export class MessageHandler extends EventEmitter {
  private config: MessageHandlerConfig;
  private activeRunners = new Map<string, AgentRunner>();
  private rateLimiter = new RateLimiter();
  private activeMessages = new Map<string, { messageId: string; chatId: string; platform: string; replyToMessageId?: string }>();
  private pendingHitlRequests = new Map<string, {
    resolve: (response: string) => void;
    reject: (error: Error) => void;
    sessionId: string;
    mode: 'approval' | 'question';
  }>();
  private processedMessages = new Set<string>(); // Track processed message IDs to prevent duplicates
  private readonly previewUpdateIntervalMs = 300;
  private readonly previewMinDeltaChars = 24;
  private readonly messageReceivedHandler: (context: MessageContext) => void;

  constructor(config: MessageHandlerConfig) {
    super();
    this.config = config;
    this.messageReceivedHandler = (context: MessageContext) => {
      this.handleMessage(context).catch(error => {
        console.error('[MessageHandler] Unhandled error in handleMessage:', error);
      });
    };
    this.setupEventHandlers();
  }

  /**
   * Set up event handlers for bot manager
   * Requirement 4.1: Listen to messageReceived event
   */
  private setupEventHandlers(): void {
    // Listen to bot manager message events
    this.config.botManager.on('messageReceived', this.messageReceivedHandler);

    console.log('[MessageHandler] Event handlers initialized');
  }

  /**
   * Handle incoming message from bot platform
   * Requirements: 4.2, 4.3, 4.4, 4.5, 4.6, 4.7
   */
  private async handleMessage(context: MessageContext): Promise<void> {
    const { message } = context;
    const platform = message.platform;

    // Create unique message identifier to prevent duplicate processing
    const messageKey = `${platform}_${message.chat.id}_${message.id}`;

    // Check if we've already processed this message
    if (this.processedMessages.has(messageKey)) {
      console.log(`[MessageHandler] ⏭️ Skipping duplicate message: ${messageKey}`);
      return;
    }

    // Mark message as processed
    this.processedMessages.add(messageKey);

    // Clean up old processed messages (keep last 1000)
    if (this.processedMessages.size > 1000) {
      const messagesToDelete = Array.from(this.processedMessages).slice(0, 100);
      messagesToDelete.forEach(key => this.processedMessages.delete(key));
    }

    console.log(`[MessageHandler] 📥 Received message from ${platform}`);
    console.log(`[MessageHandler] User: ${message.user.name} (${message.user.id})`);
    console.log(`[MessageHandler] Chat: ${message.chat.name} (${message.chat.id})`);
    console.log(`[MessageHandler] Content: ${message.content.text.substring(0, 100)}${message.content.text.length > 100 ? '...' : ''}`);

    // Log files if any
    if (message.content.files && message.content.files.length > 0) {
      console.log(`[MessageHandler] 📎 Files attached: ${message.content.files.length}`);
      message.content.files.forEach(file => {
        console.log(`[MessageHandler]   - ${file.name} (${file.mimeType}, ${(file.size / 1024).toFixed(2)} KB)`);
      });
    }

    const sessionId = context.conversationId || message.metadata?.conversationKey || `${platform}:${message.chat.id}`;
    const replyToMessageId = context.metadata?.replyTargetId || message.metadata?.replyTargetId || message.id;

    // Check if this is a HITL response
    const pendingRequest = this.pendingHitlRequests.get(sessionId);
    if (pendingRequest) {
      console.log(`[MessageHandler] 🔔 Detected HITL response for session ${sessionId}`);
      await this.processHitlResponse(sessionId, message.content.text, message.chat.id, platform, pendingRequest.mode);
      return; // Don't process as a new message
    }

    try {
      // Requirement 4.3: Retrieve model and provider config for this platform
      const platformConfig = this.config.integrationConfig[platform as keyof IntegrationConfig];

      if (!platformConfig) {
        console.error(`[MessageHandler] ❌ Unknown platform: ${platform}`);
        return;
      }

      console.log(`[MessageHandler] Platform config: provider=${platformConfig.provider}, model=${platformConfig.model}`);

      // Requirement 6.1: Check if model is configured
      if (!platformConfig.model) {
        console.warn(`[MessageHandler] ⚠️ No model configured for ${platform}`);
        await this.sendErrorMessage(
          message.chat.id,
          platform,
          '⚠️ Bot not configured with an AI model. Please configure in settings.'
        );
        return;
      }

      // Requirement 6.2: Check if provider is configured
      if (!platformConfig.provider) {
        console.warn(`[MessageHandler] ⚠️ No provider configured for ${platform}`);
        await this.sendErrorMessage(
          message.chat.id,
          platform,
          '⚠️ Bot not configured with an AI provider. Please configure in settings.'
        );
        return;
      }

      // Requirement 5.1: Send typing indicator
      console.log(`[MessageHandler] ⌨️ Sending typing indicator...`);
      const botPlatform = this.config.botManager.getPlatform(platform);
      if (botPlatform) {
        await botPlatform.sendTyping(message.chat.id);
      }

      // Requirement 4.4: Create or reuse agent runner session
      let runner = this.activeRunners.get(sessionId);

      if (!runner) {
        console.log(`[MessageHandler] 🆕 Creating new agent runner session: ${sessionId}`);

        // Get API key for the provider
        const apiKey = await this.getApiKeyForProvider(platformConfig.provider);

        // Configure ACP manager with platform-specific model/provider
        console.log(`[MessageHandler] 🔧 Configuring ACP manager with provider=${platformConfig.provider}, model=${platformConfig.model}`);
        const existingConfig = this.config.acpManager.getClient()?.getFullConfig?.();
        this.config.acpManager.setProvider({
          provider: platformConfig.provider as any,
          model: platformConfig.model,
          apiKey: apiKey || undefined,
          vlm: existingConfig?.vlm,
        });

        // Create AI client from ACP manager
        const client = this.config.acpManager.getClient();

        // Requirement 6.3: Check if client is available
        if (!client) {
          console.error(`[MessageHandler] ❌ Failed to create AI client`);
          await this.sendErrorMessage(
            message.chat.id,
            platform,
            '❌ Failed to initialize AI client. Please check your provider configuration.'
          );
          return;
        }

        // Create new agent runner
        runner = new AgentRunner(client, {
          maxIterations: 100,
          enableTerminal: false, // Disable terminal for bot integrations
        });

        this.activeRunners.set(sessionId, runner);
        console.log(`[MessageHandler] ✅ Agent runner session created: ${sessionId}`);
      } else {
        console.log(`[MessageHandler] ♻️ Reusing existing agent runner session: ${sessionId}`);
      }

      // Prepare message text with file information and a channel-friendly instruction.
      let messageText = message.content.text;
      if (message.content.files && message.content.files.length > 0) {
        messageText += '\n\n📎 **Attached files:**\n';
        message.content.files.forEach(file => {
          messageText += `- ${file.name} (${file.mimeType})\n`;
        });
        messageText += '\n*Note: File content analysis is not yet implemented.*';
      }
      messageText = this.buildConversationalPrompt(messageText, platform);

      // Requirement 4.5: Process message through agent runner with streaming
      console.log(`[MessageHandler] 🤖 Processing message through agent runner...`);
      console.log(`[MessageHandler] Message text: ${messageText.substring(0, 100)}${messageText.length > 100 ? '...' : ''}`);

      // Use runStream to get access to HITL events
      const stream = runner.runStream(messageText, [], platformConfig.model, sessionId);
      let response = '';
      let lastToolName = '';
      let liveThought = platform === 'discord' ? 'Reading your message...' : '';
      let lastPreviewText = '';
      let lastPreviewAt = 0;

      const maybeUpdatePreview = async (force = false) => {
        const now = Date.now();
        const enoughTime = now - lastPreviewAt >= this.previewUpdateIntervalMs;
        const previewText = this.formatLivePreview(response, liveThought);
        const minDelta = platform === 'discord' ? 8 : this.previewMinDeltaChars;
        const enoughText = Math.abs(previewText.length - lastPreviewText.length) >= minDelta;
        if (!previewText.trim() || (!force && !enoughTime && !enoughText)) return;

        lastPreviewText = previewText;
        lastPreviewAt = now;
        if (!this.activeMessages.has(sessionId)) {
          this.activeMessages.set(sessionId, {
            messageId: '',
            chatId: message.chat.id,
            platform,
            replyToMessageId
          });
        }
        await this.updateMessage(sessionId, previewText, { preview: true, parseMode: 'markdown' });
      };

      if (platform === 'discord') {
        await maybeUpdatePreview(true);
      }

      for await (const event of stream) {
        if (event.type === 'chunk') {
          response += event.content;
          if (!liveThought && platform === 'discord') {
            liveThought = 'Writing...';
          }
          await maybeUpdatePreview(false);
        } else if (event.type === 'thought') {
          liveThought = this.cleanLiveThought(event.content);
          await maybeUpdatePreview(true);
        } else if (event.type === 'tool_call') {
          // Update message with tool being used
          const toolName = event.toolCall.toolName;
          if (toolName === 'ask_user_question') {
            console.log(`[MessageHandler] ❓ ask_user_question received`);
            await this.sendQuestionRequest(event.toolCall, sessionId, message.chat.id, platform, replyToMessageId);
            return;
          }
          if (toolName !== lastToolName) {
            lastToolName = toolName;
            liveThought = this.formatToolActivity(toolName);
            await maybeUpdatePreview(true);
          }
        } else if (event.type === 'hitl_request') {
          // Handle HITL request - send to user and wait for their next message
          console.log(`[MessageHandler] 🔔 HITL request received`);
          await this.sendHitlRequest(event.request, sessionId, message.chat.id, platform);
          // The agent has paused and is waiting for user response
          // The next message from the user will be processed as a HITL response
          return; // Exit this message handler, wait for HITL response
        } else if (event.type === 'debate_event') {
          liveThought = this.formatDebateActivity((event as any).debateEvent);
          await maybeUpdatePreview(true);
        } else if (event.type === 'done') {
          break;
        }
      }

      console.log(`[MessageHandler] ✅ Agent runner completed`);
      console.log(`[MessageHandler] Response length: ${response.length} characters`);

      // Send final response by editing the thinking message
      await maybeUpdatePreview(true);
      await this.updateMessage(sessionId, response, { preview: false });

      // Clean up
      this.activeMessages.delete(sessionId);

      console.log(`[MessageHandler] ✅ Successfully processed message for ${sessionId}`);
    } catch (error) {
      // Requirement 6.3, 6.4, 6.5, 6.6: Error handling
      console.error('[MessageHandler] ❌ Error processing message:', error);

      const errorMsg = error instanceof Error ? error.message : String(error);
      const activeErrorMessage = this.activeMessages.has(sessionId);

      // Handle specific error types
      if (errorMsg.includes('429') || errorMsg.toLowerCase().includes('rate limit')) {
        // Requirement 6.5: Rate limit error
        console.warn(`[MessageHandler] ⚠️ Rate limit error`);
        const rateLimitMessage = 'Rate limit exceeded. Please wait before sending more messages.';
        if (activeErrorMessage) {
          await this.updateMessage(sessionId, rateLimitMessage, { preview: false, parseMode: 'none' });
        } else {
          await this.sendErrorMessage(message.chat.id, platform, rateLimitMessage);
        }
      } else if (errorMsg.toLowerCase().includes('api key') || errorMsg.toLowerCase().includes('authentication')) {
        // API key error
        console.error(`[MessageHandler] ❌ Authentication error`);
        const authMessage = 'Bot authentication failed. Please check your API key configuration.';
        if (activeErrorMessage) {
          await this.updateMessage(sessionId, authMessage, { preview: false, parseMode: 'none' });
        } else {
          await this.sendErrorMessage(message.chat.id, platform, authMessage);
        }
      } else {
        // Requirement 6.4: Generic agent runner failure
        console.error(`[MessageHandler] ❌ Generic error: ${errorMsg}`);
        const failureMessage = errorMsg.toLowerCase().includes('fetch failed') || errorMsg.toLowerCase().includes('network')
          ? 'I could not reach the configured AI provider. Please check the provider endpoint/API key, then try again.'
          : 'Failed to process your message. Please try again.';
        if (activeErrorMessage) {
          await this.updateMessage(sessionId, failureMessage, { preview: false, parseMode: 'none' });
        } else {
          await this.sendErrorMessage(message.chat.id, platform, failureMessage);
        }
      }

      this.activeMessages.delete(sessionId);
    }
  }

  /**
   * Send HITL (Human-in-the-Loop) approval request to user
   */
  private async sendHitlRequest(
    request: any,
    sessionId: string,
    chatId: string,
    platform: string
  ): Promise<void> {
    console.log(`[MessageHandler] 📋 Sending HITL request for session ${sessionId}`);

    const botPlatform = this.config.botManager.getPlatform(platform);
    if (!botPlatform) {
      throw new Error('Bot platform not available');
    }

    const hitlMessage = this.formatQuestionMessage(request, 'approval');

    // Send HITL request message
    await this.rateLimiter.waitForMessageSlot();
    await botPlatform.sendMessage(hitlMessage, {
      chatId,
      parseMode: 'none'
    });

    // Mark this session as waiting for HITL response
    this.pendingHitlRequests.set(sessionId, {
      resolve: () => {}, // Not used in this implementation
      reject: () => {},
      sessionId,
      mode: 'approval'
    });

    console.log(`[MessageHandler] ✅ HITL request sent, waiting for user response`);
  }

  /**
   * Process HITL response from user
   */
  private async processHitlResponse(
    sessionId: string,
    response: string,
    chatId: string,
    platform: string,
    mode: 'approval' | 'question' = 'approval'
  ): Promise<void> {
    console.log(`[MessageHandler] 📥 Processing HITL response for session ${sessionId}: ${response}`);

    // Remove pending HITL request
    this.pendingHitlRequests.delete(sessionId);

    const formattedResponse = mode === 'approval'
      ? this.formatApprovalResponse(response)
      : response.trim();
    console.log(`[MessageHandler] 🔔 Pending response interpreted as mode=${mode}`);

    // Get the runner for this session
    const runner = this.activeRunners.get(sessionId);
    if (!runner) {
      console.error(`[MessageHandler] ❌ No active runner found for session ${sessionId}`);
      return;
    }

    // Get platform config
    const platformConfig = this.config.integrationConfig[platform as keyof IntegrationConfig];
    if (!platformConfig) {
      console.error(`[MessageHandler] ❌ Unknown platform: ${platform}`);
      return;
    }

    const botPlatform = this.config.botManager.getPlatform(platform);
    if (!botPlatform) {
      console.error(`[MessageHandler] ❌ Bot platform not available`);
      return;
    }

    try {
      // Send typing indicator
      await botPlatform.sendTyping(chatId);

      // Continue the agent with the HITL response
      const stream = runner.runStream(formattedResponse, [], platformConfig.model, sessionId);
      let finalResponse = '';
      let lastToolName = '';
      let liveThought = platform === 'discord' ? 'Continuing...' : '';
      let lastPreviewText = '';
      let lastPreviewAt = 0;

      const maybeUpdatePreview = async (force = false) => {
        const now = Date.now();
        const enoughTime = now - lastPreviewAt >= this.previewUpdateIntervalMs;
        const previewText = this.formatLivePreview(finalResponse, liveThought);
        const minDelta = platform === 'discord' ? 8 : this.previewMinDeltaChars;
        const enoughText = Math.abs(previewText.length - lastPreviewText.length) >= minDelta;
        if (!previewText.trim() || (!force && !enoughTime && !enoughText)) return;

        lastPreviewText = previewText;
        lastPreviewAt = now;
        if (!this.activeMessages.has(sessionId)) {
          this.activeMessages.set(sessionId, {
            messageId: '',
            chatId,
            platform,
            replyToMessageId: undefined
          });
        }
        await this.updateMessage(sessionId, previewText, { preview: true, parseMode: 'markdown' });
      };

      if (platform === 'discord') {
        await maybeUpdatePreview(true);
      }

      for await (const event of stream) {
        if (event.type === 'chunk') {
          finalResponse += event.content;
          if (!liveThought && platform === 'discord') {
            liveThought = 'Writing...';
          }
          await maybeUpdatePreview(false);
        } else if (event.type === 'thought') {
          liveThought = this.cleanLiveThought(event.content);
          await maybeUpdatePreview(true);
        } else if (event.type === 'tool_call') {
          const toolName = event.toolCall.toolName;
          if (toolName === 'ask_user_question') {
            console.log(`[MessageHandler] ❓ ask_user_question received during HITL continuation`);
            await this.sendQuestionRequest(event.toolCall, sessionId, chatId, platform);
            return;
          }
          if (toolName !== lastToolName && toolName !== 'ask_user_question') {
            lastToolName = toolName;
            liveThought = this.formatToolActivity(toolName);
            await maybeUpdatePreview(true);
          }
        } else if (event.type === 'hitl_request') {
          // Another HITL request - handle it
          console.log(`[MessageHandler] 🔔 Another HITL request received`);
          await this.sendHitlRequest(event.request, sessionId, chatId, platform);
          return; // Exit and wait for next response
        } else if (event.type === 'debate_event') {
          liveThought = this.formatDebateActivity((event as any).debateEvent);
          await maybeUpdatePreview(true);
        } else if (event.type === 'done') {
          break;
        }
      }

      console.log(`[MessageHandler] ✅ Agent runner completed after HITL response`);

      // Send final response
      if (finalResponse.trim()) {
        await maybeUpdatePreview(true);
        await this.updateMessage(sessionId, finalResponse, { preview: false });
      }

      // Clean up
      this.activeMessages.delete(sessionId);
    } catch (error) {
      console.error('[MessageHandler] ❌ Error processing HITL response:', error);
      await this.sendErrorMessage(
        chatId,
        platform,
        '❌ Failed to process your response. Please try again.'
      );
    }
  }

  /**
   * Update message with new content (edit existing message)
   */
  private async updateMessage(
    sessionId: string,
    content: string,
    options: { preview?: boolean; parseMode?: 'markdown' | 'none' } = {}
  ): Promise<void> {
    const messageInfo = this.activeMessages.get(sessionId);
    if (!messageInfo) return;

    const botPlatform = this.config.botManager.getPlatform(messageInfo.platform);
    if (!botPlatform) return;

    try {
      await this.rateLimiter.waitForEditSlot();
      const maxLength = this.getPlatformMessageLimit(messageInfo.platform);
      const editLimit = options.preview ? Math.min(maxLength, 1400) : maxLength;
      const chunks = this.splitMessage(content.trim() || '(No response)', editLimit);
      const firstChunk = chunks.shift() || '';

      // Check if platform supports message editing
      if (messageInfo.messageId && typeof (botPlatform as any).editMessage === 'function') {
        await (botPlatform as any).editMessage(
          messageInfo.chatId,
          messageInfo.messageId,
          firstChunk,
          options.parseMode || 'markdown'
        );
      } else {
        await this.rateLimiter.waitForMessageSlot();
        const sentMessageId = await botPlatform.sendMessage(firstChunk, {
          chatId: messageInfo.chatId,
          parseMode: options.parseMode || 'markdown',
          replyToMessageId: messageInfo.replyToMessageId
        });
        this.activeMessages.set(sessionId, {
          ...messageInfo,
          messageId: sentMessageId
        });
      }

      if (!options.preview) {
        for (const chunk of chunks) {
          await this.rateLimiter.waitForMessageSlot();
          await botPlatform.sendMessage(chunk, {
            chatId: messageInfo.chatId,
            parseMode: 'markdown'
          });
        }
      }
    } catch (error) {
      console.error('[MessageHandler] Failed to edit message:', error);
      if (!options.preview) {
        const editedPlain = await this.tryPlainEdit(botPlatform, messageInfo.chatId, messageInfo.messageId, content);
        if (!editedPlain) {
          await this.sendResponse(botPlatform, messageInfo.chatId, content, messageInfo.replyToMessageId, messageInfo.platform);
        }
      }
    }
  }

  private async tryPlainEdit(
    botPlatform: MessagePlatform,
    chatId: string,
    messageId: string,
    content: string
  ): Promise<boolean> {
    if (typeof (botPlatform as any).editMessage !== 'function') return false;
    try {
      const maxLength = this.getPlatformMessageLimit(botPlatform.getPlatformName());
      const firstChunk = this.splitMessage(content.trim() || '(No response)', maxLength)[0] || '';
      await (botPlatform as any).editMessage(chatId, messageId, firstChunk, 'none');
      return true;
    } catch (error) {
      console.error('[MessageHandler] Plain edit fallback failed:', error);
      return false;
    }
  }

  private async sendQuestionRequest(
    toolCall: any,
    sessionId: string,
    chatId: string,
    platform: string,
    replyToMessageId?: string
  ): Promise<void> {
    const botPlatform = this.config.botManager.getPlatform(platform);
    if (!botPlatform) {
      throw new Error('Bot platform not available');
    }

    const resultData = toolCall?.result?.data || toolCall?.result?.data?.data || {};
    const request = {
      questions: resultData.questions || toolCall?.args?.questions || [],
      previewMarkdown: resultData.preview || toolCall?.args?.previewMarkdown || ''
    };

    const questionMessage = this.formatQuestionMessage(request, 'question');
    if (this.activeMessages.has(sessionId)) {
      await this.updateMessage(sessionId, questionMessage, { preview: false, parseMode: 'none' });
    } else {
      await this.rateLimiter.waitForMessageSlot();
      await botPlatform.sendMessage(questionMessage, { chatId, parseMode: 'none', replyToMessageId });
    }
    this.activeMessages.delete(sessionId);

    this.pendingHitlRequests.set(sessionId, {
      resolve: () => {},
      reject: () => {},
      sessionId,
      mode: 'question'
    });

    console.log(`[MessageHandler] ✅ Clarifying question sent to ${platform}/${chatId}`);
  }

  private buildConversationalPrompt(userText: string, platform: string): string {
    return [
      `You are replying through ${platform}. Behave like a conversational chat assistant for ${platform}, not like a desktop UI.`,
      'Use tools when useful, but summarize tool work naturally instead of dumping raw logs.',
      'If you need clarification, use ask_user_question with 1-3 short questions. For Telegram/Discord, questions should be clear enough for the user to answer in a normal reply.',
      'If you need approval, ask for approval explicitly and wait. Keep final answers useful, direct, and readable in chat.',
      '',
      userText
    ].join('\n');
  }

  private formatQuestionMessage(request: any, mode: 'approval' | 'question'): string {
    const questions = Array.isArray(request?.questions) ? request.questions : [];
    const preview = request?.previewMarkdown || request?.preview || '';
    const title = mode === 'approval'
      ? 'Approval needed'
      : 'Quick question';
    let message = `${title}\n\n`;

    if (preview) {
      message += `${String(preview).trim()}\n\n`;
    }

    if (questions.length === 0 && request?.message) {
      message += `${String(request.message).trim()}\n\n`;
    }

    questions.forEach((q: any, index: number) => {
      const questionText = String(q.question || q.text || '').trim();
      if (questionText) {
        message += questions.length > 1 ? `${index + 1}. ${questionText}\n` : `${questionText}\n`;
      }

      const options = Array.isArray(q.options) ? q.options : [];
      options.forEach((opt: any, optIndex: number) => {
        const label = typeof opt === 'string' ? opt : (opt.label || opt.value || String(opt));
        const marker = mode === 'approval'
          ? (optIndex === options.length - 1 ? '❌' : '✅')
          : `${optIndex + 1}.`;
        message += `${marker} ${label}\n`;
      });

      if (q.multiSelect) {
        message += 'You can reply with more than one option.\n';
      }

      if (index < questions.length - 1) message += '\n';
    });

    message += mode === 'approval'
      ? '\nReply with approve, reject, or the option you want.'
      : '\nReply here with your answer.';

    return message.trim();
  }

  private formatApprovalResponse(response: string): string {
    const lowerResponse = response.toLowerCase();
    const rejected = lowerResponse.includes('reject') ||
                     lowerResponse.includes('no') ||
                     lowerResponse.includes('cancel') ||
                     lowerResponse.includes('stop') ||
                     lowerResponse.includes('❌');
    if (rejected) return '[HITL_REJECTED]';

    const approvedAlways = lowerResponse.includes('allow always') ||
                           lowerResponse.includes('always allow') ||
                           lowerResponse.includes('approve always');
    if (approvedAlways) return '[HITL_APPROVED_ALWAYS]';

    const approvedPrefix = lowerResponse.includes('allow prefix') ||
                           lowerResponse.includes('approve prefix');
    if (approvedPrefix) return '[HITL_APPROVED_PREFIX]';

    return '[HITL_APPROVED]';
  }

  private formatLivePreview(text: string, thought?: string): string {
    const body = text.trim();
    const cleanThought = thought?.trim();
    const thoughtLine = cleanThought ? `*Thinking: ${cleanThought}*` : '';
    if (!body) return thoughtLine;
    return thoughtLine ? `${thoughtLine}\n\n${body}` : body;
  }

  private cleanLiveThought(thought: string): string {
    return thought
      .replace(/[\r\n]+/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^[-•\s]+/, '')
      .trim()
      .slice(0, 180);
  }

  private formatToolActivity(toolName: string): string {
    const emoji = this.getToolEmoji(toolName);
    const label = toolName.replace(/_/g, ' ');
    return `${emoji} Working with ${label}...`;
  }

  private formatDebateActivity(debateEvent: any): string {
    const type = String(debateEvent?.type || '');
    const data = debateEvent?.data || {};
    const finalPlan = data.finalPlan || {};
    const review = data.review || {};
    const proposal = data.proposal || {};

    switch (type) {
      case 'debate_start':
        return 'Debate Chamber opened: Vanguard, Phantom, and Arbiter are reviewing the plan...';
      case 'vanguard_complete':
        return `Debate Chamber: Vanguard proposed ${proposal.phaseCount || finalPlan.phaseCount || 'a'} phase plan.`;
      case 'phantom_complete':
        return `Debate Chamber: Phantom reviewed risks (${review.concernCount ?? 0} concerns).`;
      case 'arbiter_complete':
        return `Debate Chamber: Arbiter decided ${String(finalPlan.goNogo || 'review complete').toUpperCase()}.`;
      case 'debate_complete':
        return `Debate Chamber complete: ${String(finalPlan.goNogo || 'done').toUpperCase()}${finalPlan.riskAssessment ? `, risk ${finalPlan.riskAssessment}` : ''}.`;
      case 'debate_skipped':
        return `Debate Chamber skipped: ${data.reason || 'not needed for this task'}.`;
      case 'debate_error':
        return `Debate Chamber error: ${debateEvent?.error || 'continuing without debate'}.`;
      default:
        return 'Debate Chamber updated...';
    }
  }

  /**
   * Get emoji for tool name
   */
  private getToolEmoji(toolName: string): string {
    const emojiMap: Record<string, string> = {
      'web_search': '🔍',
      'read_file': '📄',
      'write_file': '✍️',
      'list_directory': '📁',
      'execute_command': '⚙️',
      'ask_user': '❓',
      'create_artifact': '🎨',
      'visualize': '📊',
      'memory_search': '🧠',
      'memory_save': '💾',
    };

    return emojiMap[toolName] || '🔧';
  }

  /**
   * Truncate text for platform limits
   */
  private getPlatformMessageLimit(platform: string): number {
    if (platform === 'telegram') return 3900;
    if (platform === 'discord') return 1900;
    return 2000;
  }

  /**
   * Send response to platform with message splitting
   * Requirements: 5.3, 5.4
   */
  private async sendResponse(
    platform: MessagePlatform,
    chatId: string,
    response: string,
    replyToMessageId?: string,
    platformName = platform.getPlatformName()
  ): Promise<void> {
    // Requirement 5.4: Check if response exceeds platform limits
    const maxLength = this.getPlatformMessageLimit(platformName);

    if (response.length <= maxLength) {
      // Send directly if within limit
      await this.rateLimiter.waitForMessageSlot();
      await platform.sendMessage(response, { chatId, parseMode: 'markdown', replyToMessageId });
    } else {
      // Requirement 5.4: Split into chunks
      const chunks = this.splitMessage(response, maxLength);
      console.log(`[MessageHandler] Splitting response into ${chunks.length} chunks`);

      for (const chunk of chunks) {
        await this.rateLimiter.waitForMessageSlot();
        await platform.sendMessage(chunk, { chatId, parseMode: 'markdown', replyToMessageId });
        replyToMessageId = undefined;
      }
    }
  }

  /**
   * Split message into chunks at natural boundaries
   * Requirement 5.4: Message splitting logic
   */
  private splitMessage(text: string, maxLength: number): string[] {
    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
      if (remaining.length <= maxLength) {
        chunks.push(remaining);
        break;
      }

      // Try to split at a natural boundary (newline, period, space)
      let splitIndex = maxLength;
      const lastNewline = remaining.lastIndexOf('\n', maxLength);
      const lastPeriod = remaining.lastIndexOf('. ', maxLength);
      const lastSpace = remaining.lastIndexOf(' ', maxLength);

      // Prefer boundaries in the last 30% of the chunk
      const threshold = maxLength * 0.7;

      if (lastNewline > threshold) {
        splitIndex = lastNewline + 1;
      } else if (lastPeriod > threshold) {
        splitIndex = lastPeriod + 2;
      } else if (lastSpace > threshold) {
        splitIndex = lastSpace + 1;
      }

      chunks.push(remaining.substring(0, splitIndex));
      remaining = remaining.substring(splitIndex);
    }

    return chunks;
  }

  /**
   * Send error message to user
   * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6
   */
  private async sendErrorMessage(
    chatId: string,
    platform: string,
    errorMessage: string
  ): Promise<void> {
    const botPlatform = this.config.botManager.getPlatform(platform);
    if (botPlatform) {
      try {
        await this.rateLimiter.waitForMessageSlot();
        await botPlatform.sendMessage(errorMessage, { chatId });
        console.log(`[MessageHandler] Sent error message to ${platform}/${chatId}: ${errorMessage}`);
      } catch (error) {
        console.error(`[MessageHandler] Failed to send error message to ${platform}/${chatId}:`, error);
      }
    }
  }

  /**
   * Get API key for provider from file system
   * Requirement 4.4: API key retrieval
   */
  private async getApiKeyForProvider(provider: string): Promise<string> {
    try {
      const configDir = path.join(os.homedir(), '.everfern');
      const keysDir = path.join(configDir, 'keys');
      const keyPath = path.join(keysDir, `${provider}.key`);

      if (fs.existsSync(keyPath)) {
        const apiKey = fs.readFileSync(keyPath, 'utf-8').trim();
        console.log(`[MessageHandler] Loaded API key for provider: ${provider}`);
        return apiKey;
      }

      console.warn(`[MessageHandler] No API key found for provider: ${provider}`);
      return '';
    } catch (error) {
      console.error(`[MessageHandler] Error loading API key for provider ${provider}:`, error);
      return '';
    }
  }

  /**
   * Shutdown message handler and clean up resources
   * Requirement 4.1: Cleanup on shutdown
   */
  public async shutdown(): Promise<void> {
    console.log('[MessageHandler] Shutting down...');

    this.config.botManager.off('messageReceived', this.messageReceivedHandler);

    // Clean up active runners
    for (const [sessionId, runner] of this.activeRunners.entries()) {
      try {
        // Abort any ongoing operations
        if (runner.isAborted && !runner.isAborted()) {
          runner.abort();
        }
        console.log(`[MessageHandler] Cleaned up session: ${sessionId}`);
      } catch (error) {
        console.error(`[MessageHandler] Error cleaning up session ${sessionId}:`, error);
      }
    }

    this.activeRunners.clear();
    this.activeMessages.clear();
    this.processedMessages.clear();
    console.log('[MessageHandler] Shutdown complete');
  }
}
