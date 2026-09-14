/**
 * Input Validator for Multi-Platform Integration
 *
 * This module provides comprehensive input validation and sanitization
 * for all user inputs from external messaging platforms, preventing
 * injection attacks and ensuring content safety.
 */

import crypto from 'crypto';
import { IncomingMessage, PlatformFile } from './platform-interface';
import { SecurityMonitor, getSecurityMonitor } from './security-monitor';

/**
 * Validation result interface
 */
export interface ValidationResult {
  /** Whether the input is valid */
  valid: boolean;
  /** Sanitized input (if valid) */
  sanitized?: any;
  /** Validation errors */
  errors: string[];
  /** Security warnings */
  warnings: string[];
  /** Risk level (low, medium, high, critical) */
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}

/**
 * Content filtering configuration
 */
export interface ContentFilterConfig {
  /** Enable profanity filtering */
  enableProfanityFilter: boolean;
  /** Enable spam detection */
  enableSpamDetection: boolean;
  /** Maximum message length */
  maxMessageLength: number;
  /** Maximum file size in bytes */
  maxFileSize: number;
  /** Allowed file types (MIME types) */
  allowedFileTypes: string[];
  /** Blocked domains for URLs */
  blockedDomains: string[];
  /** Rate limiting configuration */
  rateLimiting: {
    /** Messages per minute per user */
    messagesPerMinute: number;
    /** Files per hour per user */
    filesPerHour: number;
    /** Burst allowance */
    burstAllowance: number;
  };
}

/**
 * Webhook validation configuration
 */
export interface WebhookConfig {
  /** Secret key for signature validation */
  secretKey: string;
  /** Signature header name */
  signatureHeader: string;
  /** Hash algorithm (sha256, sha1) */
  hashAlgorithm: string;
  /** Maximum request age in seconds */
  maxRequestAge: number;
}

/**
 * Rate limiting tracker
 */
interface RateLimitTracker {
  /** Message timestamps */
  messages: number[];
  /** File upload timestamps */
  files: number[];
  /** Last reset time */
  lastReset: number;
}

/**
 * Comprehensive input validator class
 */
export class InputValidator {
  private contentFilterConfig: ContentFilterConfig;
  private webhookConfig: WebhookConfig;
  private rateLimitTrackers = new Map<string, RateLimitTracker>();
  private securityMonitor: SecurityMonitor;

  // Security patterns for injection detection
  private readonly SQL_INJECTION_PATTERNS = [
    /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|UNION)\b)/gi,
    /(\b(OR|AND)\s+\d+\s*=\s*\d+)/gi,
    /(--|\/\*|\*\/|;)/g,
    /(\b(SCRIPT|JAVASCRIPT|VBSCRIPT)\b)/gi,
    /(\bEXEC\s*\()/gi
  ];

  private readonly XSS_PATTERNS = [
    /<script[^>]*>.*?<\/script>/gi,
    /<iframe[^>]*>.*?<\/iframe>/gi,
    /<object[^>]*>.*?<\/object>/gi,
    /<embed[^>]*>/gi,
    /<link[^>]*>/gi,
    /javascript:/gi,
    /vbscript:/gi,
    /data:text\/html/gi,
    /on\w+\s*=/gi
  ];

  private readonly COMMAND_INJECTION_PATTERNS = [
    /(\||&|;|`|\$\(|\${)/g,
    /(rm\s|del\s|format\s|shutdown\s|reboot\s)/gi,
    /(wget\s|curl\s|nc\s|netcat\s)/gi,
    /(\/bin\/|\/usr\/bin\/|cmd\.exe|powershell)/gi
  ];

  private readonly PROFANITY_PATTERNS = [
    // Basic profanity detection - in production, use a comprehensive library
    /fuck/gi,
    /shit/gi,
    /damn/gi,
    /bitch/gi,
    /asshole/gi,
    /bastard/gi
  ];

  private readonly SPAM_INDICATORS = [
    /(.)\1{10,}/g, // Repeated characters
    /https?:\/\/[^\s]+/g, // Multiple URLs
    /\b(buy now|click here|limited time|act now|free money)\b/gi,
    /[A-Z]{5,}/g // Excessive caps
  ];

  constructor(
    contentFilterConfig: ContentFilterConfig,
    webhookConfig: WebhookConfig
  ) {
    this.contentFilterConfig = contentFilterConfig;
    this.webhookConfig = webhookConfig;
    this.securityMonitor = getSecurityMonitor();

    // Clean up rate limit trackers periodically
    setInterval(() => this.cleanupRateLimitTrackers(), 60000); // Every minute
  }

  /**
   * Validate and sanitize an incoming message
   */
  async validateMessage(message: IncomingMessage, metadata: Record<string, any> = {}): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    let riskLevel: ValidationResult['riskLevel'] = 'low';

    try {
      // 1. Rate limiting check
      const rateLimitResult = this.checkRateLimit(message.user.id, 'message');
      if (!rateLimitResult.allowed) {
        // Log security event
        await this.securityMonitor.logSecurityEvent(
          'rate_limit_exceeded',
          'high',
          message.platform,
          'Rate Limit Exceeded',
          `User ${message.user.id} exceeded message rate limit`,
          {
            sourceIp: metadata.sourceIp,
            userAgent: metadata.userAgent,
            context: {
              rateLimitType: 'message',
              remaining: rateLimitResult.remaining
            }
          },
          message.user.id
        );

        return {
          valid: false,
          errors: ['Rate limit exceeded'],
          warnings: [],
          riskLevel: 'high'
        };
      }

      // 2. Message length validation
      if (message.content.text.length > this.contentFilterConfig.maxMessageLength) {
        errors.push(`Message too long (${message.content.text.length}/${this.contentFilterConfig.maxMessageLength})`);
        riskLevel = 'medium';
      }

      // 3. Injection attack detection
      const injectionResult = this.detectInjectionAttacks(message.content.text);
      if (injectionResult.detected) {
        // Log critical security event
        await this.securityMonitor.logSecurityEvent(
          'injection_attack_detected',
          'critical',
          message.platform,
          'Injection Attack Detected',
          `Potential injection attack from user ${message.user.id}: ${injectionResult.patterns.join(', ')}`,
          {
            sourceIp: metadata.sourceIp,
            userAgent: metadata.userAgent,
            context: {
              attackPatterns: injectionResult.patterns,
              messageContent: message.content.text.substring(0, 200) // First 200 chars for context
            }
          },
          message.user.id
        );

        errors.push('Potential injection attack detected');
        warnings.push(...injectionResult.patterns);
        riskLevel = 'critical';
      }

      // 4. Content filtering
      const contentResult = this.filterContent(message.content.text);
      if (!contentResult.clean) {
        warnings.push(...contentResult.issues);
        if (contentResult.severity === 'high') {
          riskLevel = 'high';
        } else if (contentResult.severity === 'medium' && riskLevel === 'low') {
          riskLevel = 'medium';
        }
      }

      // 5. File validation
      const fileResults = await this.validateFiles(message.content.files, message.user.id, message.platform);
      if (fileResults.some(r => !r.valid)) {
        errors.push(...fileResults.flatMap(r => r.errors));
        riskLevel = 'high';
      }

      // Add file warnings
      const fileWarnings = fileResults.flatMap(r => r.warnings);
      if (fileWarnings.length > 0) {
        warnings.push(...fileWarnings);
        if (riskLevel === 'low') {
          riskLevel = 'medium';
        }
      }

      // 6. URL validation
      const urlResult = this.validateUrls(message.content.text);
      if (!urlResult.safe) {
        // Log malicious URL detection
        if (urlResult.severity === 'high') {
          await this.securityMonitor.logSecurityEvent(
            'malicious_url_detected',
            'high',
            message.platform,
            'Malicious URL Detected',
            `Malicious URL detected from user ${message.user.id}: ${urlResult.issues.join(', ')}`,
            {
              sourceIp: metadata.sourceIp,
              userAgent: metadata.userAgent,
              context: {
                urlIssues: urlResult.issues,
                messageContent: message.content.text.substring(0, 200)
              }
            },
            message.user.id
          );
        }

        warnings.push(...urlResult.issues);
        if (urlResult.severity === 'high') {
          riskLevel = 'high';
        }
      }

      // Create sanitized message
      const sanitized = errors.length === 0 ? {
        ...message,
        content: {
          ...message.content,
          text: this.sanitizeText(message.content.text),
          files: fileResults.map((result, index) =>
            result.valid && result.sanitized ? result.sanitized : message.content.files[index]
          ).filter((_, index) => fileResults[index]?.valid)
        }
      } : undefined;

      return {
        valid: errors.length === 0,
        sanitized,
        errors,
        warnings,
        riskLevel
      };

    } catch (error) {
      console.error('Error during message validation:', error);
      return {
        valid: false,
        errors: ['Validation error occurred'],
        warnings: [],
        riskLevel: 'critical'
      };
    }
  }

  /**
   * Validate webhook request signature
   */
  async validateWebhookSignature(
    payload: string,
    signature: string,
    timestamp?: string
  ): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      // Check request age if timestamp provided
      if (timestamp) {
        const requestTime = parseInt(timestamp, 10) * 1000; // Convert to milliseconds
        const currentTime = Date.now();
        const age = (currentTime - requestTime) / 1000; // Age in seconds

        if (age > this.webhookConfig.maxRequestAge) {
          // Log security event for old request
          await this.securityMonitor.logSecurityEvent(
            'webhook_signature_invalid',
            'high',
            'webhook',
            'Webhook Request Too Old',
            `Webhook request rejected due to age: ${age}s > ${this.webhookConfig.maxRequestAge}s`,
            {
              context: {
                requestAge: age,
                maxAge: this.webhookConfig.maxRequestAge
              }
            }
          );

          errors.push(`Request too old: ${age}s > ${this.webhookConfig.maxRequestAge}s`);
          return {
            valid: false,
            errors,
            warnings,
            riskLevel: 'critical'
          };
        }
      }

      // Validate signature
      const expectedSignature = this.generateWebhookSignature(payload, timestamp);
      const isValidSignature = this.compareSignatures(signature, expectedSignature);

      if (!isValidSignature) {
        // Log critical security event
        await this.securityMonitor.logSecurityEvent(
          'webhook_signature_invalid',
          'critical',
          'webhook',
          'Invalid Webhook Signature',
          'Webhook request with invalid signature rejected',
          {
            context: {
              providedSignature: signature,
              payloadLength: payload.length,
              timestamp: timestamp
            }
          }
        );

        errors.push('Invalid webhook signature');
        return {
          valid: false,
          errors,
          warnings,
          riskLevel: 'critical'
        };
      }

      return {
        valid: true,
        sanitized: payload,
        errors,
        warnings,
        riskLevel: 'low'
      };

    } catch (error) {
      console.error('Error validating webhook signature:', error);
      return {
        valid: false,
        errors: ['Signature validation error'],
        warnings: [],
        riskLevel: 'critical'
      };
    }
  }

  /**
   * Sanitize text input
   */
  sanitizeText(text: string): string {
    return text
      // Remove null bytes
      .replace(/\0/g, '')
      // Remove control characters except newlines and tabs
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
      // Normalize whitespace
      .replace(/\s+/g, ' ')
      // Trim
      .trim()
      // Limit length
      .substring(0, this.contentFilterConfig.maxMessageLength);
  }

  /**
   * Check rate limiting for a user
   */
  private checkRateLimit(userId: string, type: 'message' | 'file'): { allowed: boolean; remaining: number } {
    const now = Date.now();
    let tracker = this.rateLimitTrackers.get(userId);

    if (!tracker) {
      tracker = {
        messages: [],
        files: [],
        lastReset: now
      };
      this.rateLimitTrackers.set(userId, tracker);
    }

    // Clean old entries
    const oneMinuteAgo = now - 60000;
    const oneHourAgo = now - 3600000;

    tracker.messages = tracker.messages.filter(t => t > oneMinuteAgo);
    tracker.files = tracker.files.filter(t => t > oneHourAgo);

    // Check limits
    if (type === 'message') {
      const limit = this.contentFilterConfig.rateLimiting.messagesPerMinute;
      if (tracker.messages.length >= limit) {
        return { allowed: false, remaining: 0 };
      }
      tracker.messages.push(now);
      return { allowed: true, remaining: limit - tracker.messages.length };
    } else {
      const limit = this.contentFilterConfig.rateLimiting.filesPerHour;
      if (tracker.files.length >= limit) {
        return { allowed: false, remaining: 0 };
      }
      tracker.files.push(now);
      return { allowed: true, remaining: limit - tracker.files.length };
    }
  }

  /**
   * Detect injection attacks in text
   */
  private detectInjectionAttacks(text: string): { detected: boolean; patterns: string[] } {
    const patterns: string[] = [];

    // SQL Injection
    for (const pattern of this.SQL_INJECTION_PATTERNS) {
      if (pattern.test(text)) {
        patterns.push('SQL injection pattern detected');
        break;
      }
    }

    // XSS
    for (const pattern of this.XSS_PATTERNS) {
      if (pattern.test(text)) {
        patterns.push('XSS pattern detected');
        break;
      }
    }

    // Command Injection
    for (const pattern of this.COMMAND_INJECTION_PATTERNS) {
      if (pattern.test(text)) {
        patterns.push('Command injection pattern detected');
        break;
      }
    }

    return {
      detected: patterns.length > 0,
      patterns
    };
  }

  /**
   * Filter content for profanity and spam
   */
  private filterContent(text: string): { clean: boolean; issues: string[]; severity: 'low' | 'medium' | 'high' } {
    const issues: string[] = [];
    let severity: 'low' | 'medium' | 'high' = 'low';

    // Profanity detection
    if (this.contentFilterConfig.enableProfanityFilter) {
      for (const pattern of this.PROFANITY_PATTERNS) {
        if (pattern.test(text)) {
          issues.push('Profanity detected');
          severity = 'medium';
          break;
        }
      }
    }

    // Spam detection
    if (this.contentFilterConfig.enableSpamDetection) {
      let spamScore = 0;

      for (const pattern of this.SPAM_INDICATORS) {
        const matches = text.match(pattern);
        if (matches) {
          spamScore += matches.length;
        }
      }

      if (spamScore > 3) {
        issues.push('Potential spam detected');
        severity = 'high';
      }
    }

    return {
      clean: issues.length === 0,
      issues,
      severity
    };
  }

  /**
   * Validate file attachments
   */
  private async validateFiles(files: PlatformFile[], userId: string, platform: string): Promise<ValidationResult[]> {
    const results: ValidationResult[] = [];

    for (const file of files) {
      const errors: string[] = [];
      const warnings: string[] = [];
      let riskLevel: ValidationResult['riskLevel'] = 'low';

      // Check rate limit for files
      const rateLimitResult = this.checkRateLimit(userId, 'file');
      if (!rateLimitResult.allowed) {
        // Log security event
        await this.securityMonitor.logSecurityEvent(
          'rate_limit_exceeded',
          'high',
          platform,
          'File Upload Rate Limit Exceeded',
          `User ${userId} exceeded file upload rate limit`,
          {
            context: {
              rateLimitType: 'file',
              remaining: rateLimitResult.remaining,
              fileName: file.name
            }
          },
          userId
        );

        errors.push('File upload rate limit exceeded');
        riskLevel = 'high';
      }

      // File size validation
      if (file.size > this.contentFilterConfig.maxFileSize) {
        errors.push(`File too large: ${file.size}/${this.contentFilterConfig.maxFileSize} bytes`);
        riskLevel = 'medium';
      }

      // File type validation
      if (!this.contentFilterConfig.allowedFileTypes.includes(file.mimeType)) {
        // Log blocked file upload
        await this.securityMonitor.logSecurityEvent(
          'file_upload_blocked',
          'medium',
          platform,
          'File Type Blocked',
          `Blocked file upload from user ${userId}: ${file.mimeType} not allowed`,
          {
            context: {
              fileName: file.name,
              mimeType: file.mimeType,
              fileSize: file.size,
              allowedTypes: this.contentFilterConfig.allowedFileTypes
            }
          },
          userId
        );

        errors.push(`File type not allowed: ${file.mimeType}`);
        riskLevel = 'high';
      }

      // Filename validation
      if (this.containsSuspiciousFilename(file.name)) {
        // Log suspicious file
        await this.securityMonitor.logSuspiciousActivity(
          platform,
          userId,
          `Suspicious filename detected: ${file.name}`,
          {
            fileName: file.name,
            mimeType: file.mimeType,
            fileSize: file.size
          }
        );

        warnings.push('Suspicious filename detected');
        riskLevel = 'medium';
      }

      results.push({
        valid: errors.length === 0,
        sanitized: errors.length === 0 ? {
          ...file,
          name: this.sanitizeFilename(file.name)
        } : undefined,
        errors,
        warnings,
        riskLevel
      });
    }

    return results;
  }

  /**
   * Validate URLs in text
   */
  private validateUrls(text: string): { safe: boolean; issues: string[]; severity: 'low' | 'medium' | 'high' } {
    const issues: string[] = [];
    let severity: 'low' | 'medium' | 'high' = 'low';

    // Extract URLs
    const urlRegex = /https?:\/\/[^\s]+/g;
    const urls = text.match(urlRegex) || [];

    for (const url of urls) {
      try {
        const parsedUrl = new URL(url);

        // Check blocked domains
        if (this.contentFilterConfig.blockedDomains.includes(parsedUrl.hostname)) {
          issues.push(`Blocked domain detected: ${parsedUrl.hostname}`);
          severity = 'high';
        }

        // Check for suspicious URL patterns
        if (this.isSuspiciousUrl(url)) {
          issues.push('Suspicious URL pattern detected');
          severity = 'medium';
        }

      } catch (error) {
        issues.push('Invalid URL format detected');
        severity = 'low';
      }
    }

    return {
      safe: issues.length === 0,
      issues,
      severity
    };
  }

  /**
   * Generate webhook signature
   */
  private generateWebhookSignature(payload: string, timestamp?: string): string {
    const data = timestamp ? `${timestamp}.${payload}` : payload;
    const hmac = crypto.createHmac(this.webhookConfig.hashAlgorithm, this.webhookConfig.secretKey);
    hmac.update(data, 'utf8');
    return `${this.webhookConfig.hashAlgorithm}=${hmac.digest('hex')}`;
  }

  /**
   * Compare signatures securely (timing-safe)
   */
  private compareSignatures(signature1: string, signature2: string): boolean {
    if (signature1.length !== signature2.length) {
      return false;
    }

    // Remove any prefix (e.g., "sha256=")
    const sig1 = signature1.replace(/^[^=]+=/, '');
    const sig2 = signature2.replace(/^[^=]+=/, '');

    if (sig1.length !== sig2.length) {
      return false;
    }

    try {
      return crypto.timingSafeEqual(
        Buffer.from(sig1, 'hex'),
        Buffer.from(sig2, 'hex')
      );
    } catch (error) {
      // If hex conversion fails, do string comparison
      return sig1 === sig2;
    }
  }

  /**
   * Check if filename is suspicious
   */
  private containsSuspiciousFilename(filename: string): boolean {
    const suspiciousPatterns = [
      /\.(exe|bat|cmd|scr|pif|com|vbs|js|jar|app|dmg)$/i,
      /\.\w+\.(exe|bat|cmd)$/i, // Double extensions
      /[<>:"|?*]/g, // Invalid filename characters
      /^\./,  // Hidden files
      /\s+$/, // Trailing spaces
    ];

    return suspiciousPatterns.some(pattern => pattern.test(filename));
  }

  /**
   * Sanitize filename
   */
  private sanitizeFilename(filename: string): string {
    return filename
      // Remove path separators
      .replace(/[/\\]/g, '')
      // Remove invalid characters
      .replace(/[<>:"|?*]/g, '')
      // Remove control characters
      .replace(/[\x00-\x1F\x7F]/g, '')
      // Limit length
      .substring(0, 255)
      // Trim
      .trim();
  }

  /**
   * Check if URL is suspicious
   */
  private isSuspiciousUrl(url: string): boolean {
    const suspiciousPatterns = [
      /bit\.ly|tinyurl|t\.co/i, // URL shorteners
      /[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}/, // IP addresses
      /[a-z0-9]{20,}\.com/i, // Random domain names
      /\.(tk|ml|ga|cf)$/i, // Suspicious TLDs
    ];

    return suspiciousPatterns.some(pattern => pattern.test(url));
  }

  /**
   * Clean up old rate limit trackers
   */
  private cleanupRateLimitTrackers(): void {
    const now = Date.now();
    const oneHourAgo = now - 3600000;

    for (const [userId, tracker] of this.rateLimitTrackers.entries()) {
      // Remove trackers that haven't been used in over an hour
      if (tracker.lastReset < oneHourAgo &&
          tracker.messages.length === 0 &&
          tracker.files.length === 0) {
        this.rateLimitTrackers.delete(userId);
      }
    }
  }

  /**
   * Update configuration
   */
  updateContentFilterConfig(newConfig: Partial<ContentFilterConfig>): void {
    this.contentFilterConfig = { ...this.contentFilterConfig, ...newConfig };
  }

  /**
   * Update webhook configuration
   */
  updateWebhookConfig(newConfig: Partial<WebhookConfig>): void {
    this.webhookConfig = { ...this.webhookConfig, ...newConfig };
  }

  /**
   * Get current rate limit status for a user
   */
  getRateLimitStatus(userId: string): { messages: number; files: number; resetTime: number } {
    const tracker = this.rateLimitTrackers.get(userId);
    if (!tracker) {
      return { messages: 0, files: 0, resetTime: Date.now() + 60000 };
    }

    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    const oneHourAgo = now - 3600000;

    const recentMessages = tracker.messages.filter(t => t > oneMinuteAgo).length;
    const recentFiles = tracker.files.filter(t => t > oneHourAgo).length;

    return {
      messages: recentMessages,
      files: recentFiles,
      resetTime: Math.max(
        tracker.messages.length > 0 ? Math.max(...tracker.messages) + 60000 : now,
        tracker.files.length > 0 ? Math.max(...tracker.files) + 3600000 : now
      )
    };
  }
}

/**
 * Default content filter configuration
 */
export const defaultContentFilterConfig: ContentFilterConfig = {
  enableProfanityFilter: true,
  enableSpamDetection: true,
  maxMessageLength: 4000,
  maxFileSize: 25 * 1024 * 1024, // 25MB
  allowedFileTypes: [
    'text/plain',
    'text/markdown',
    'text/csv',
    'application/json',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'audio/mpeg',
    'audio/wav',
    'audio/ogg',
    'video/mp4',
    'video/webm',
    'application/zip'
  ],
  blockedDomains: [
    'malware.com',
    'phishing.net',
    'spam.org'
    // Add more blocked domains as needed
  ],
  rateLimiting: {
    messagesPerMinute: 30,
    filesPerHour: 10,
    burstAllowance: 5
  }
};

/**
 * Default webhook configuration
 */
export const defaultWebhookConfig: WebhookConfig = {
  secretKey: '', // Must be set by application
  signatureHeader: 'X-Hub-Signature-256',
  hashAlgorithm: 'sha256',
  maxRequestAge: 300 // 5 minutes
};

/**
 * Create input validator with default configuration
 */
export function createInputValidator(
  contentConfig: Partial<ContentFilterConfig> = {},
  webhookConfig: Partial<WebhookConfig> = {}
): InputValidator {
  const fullContentConfig = { ...defaultContentFilterConfig, ...contentConfig };
  const fullWebhookConfig = { ...defaultWebhookConfig, ...webhookConfig };

  return new InputValidator(fullContentConfig, fullWebhookConfig);
}
