/**
 * User Permission Management System
 *
 * This module provides advanced permission management including allowlists,
 * blocklists, rate limiting, and security event logging.
 */

import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { EventEmitter } from 'events';
import { UserAuthenticationService, UserAccount, SecurityEvent } from './user-auth';

/**
 * Rate limiting configuration
 */
export interface RateLimitConfig {
  /** Time window in milliseconds */
  windowMs: number;
  /** Maximum requests per window */
  maxRequests: number;
  /** Burst allowance (requests that can exceed the limit temporarily) */
  burstAllowance: number;
  /** Penalty duration for exceeding limits (ms) */
  penaltyDuration: number;
}

/**
 * Rate limit entry
 */
export interface RateLimitEntry {
  /** Request timestamps within current window */
  requests: Date[];
  /** Whether user is currently penalized */
  penalized: boolean;
  /** Penalty expiration time */
  penaltyExpires?: Date;
  /** Total violations count */
  violationCount: number;
}

/**
 * Access control list entry
 */
export interface ACLEntry {
  /** Entry ID */
  id: string;
  /** Entry type */
  type: 'user' | 'platform' | 'domain' | 'ip' | 'pattern';
  /** Value to match against */
  value: string;
  /** Whether this is an allow or deny rule */
  action: 'allow' | 'deny';
  /** Rule priority (higher = more important) */
  priority: number;
  /** Platforms this rule applies to */
  platforms: string[];
  /** Capabilities this rule affects */
  capabilities: string[];
  /** Rule description */
  description: string;
  /** When rule was created */
  createdAt: Date;
  /** When rule expires (optional) */
  expiresAt?: Date;
  /** Rule metadata */
  metadata: Record<string, any>;
}

/**
 * Permission check context
 */
export interface PermissionContext {
  /** User ID */
  userId: string;
  /** Platform name */
  platform: string;
  /** Platform-specific user ID */
  platformUserId: string;
  /** Requested capability */
  capability: string;
  /** Request metadata */
  metadata: {
    ip?: string;
    userAgent?: string;
    timestamp: Date;
    requestId?: string;
  };
}

/**
 * Permission decision result
 */
export interface PermissionDecision {
  /** Whether access is granted */
  granted: boolean;
  /** Decision reason */
  reason: string;
  /** Applied ACL rule (if any) */
  appliedRule?: ACLEntry;
  /** Rate limit status */
  rateLimit: {
    remaining: number;
    resetTime: Date;
    penalized: boolean;
  };
  /** Additional context */
  context: Record<string, any>;
}

/**
 * Permission management configuration
 */
export interface PermissionManagerConfig {
  /** Base directory for permission data */
  baseDir: string;
  /** Default rate limits per platform */
  defaultRateLimits: Map<string, RateLimitConfig>;
  /** Global rate limits */
  globalRateLimit: RateLimitConfig;
  /** Whether to enable IP-based restrictions */
  enableIpRestrictions: boolean;
  /** Maximum ACL entries */
  maxAclEntries: number;
  /** ACL cache TTL in milliseconds */
  aclCacheTtl: number;
  /** Security event retention days */
  securityEventRetentionDays: number;
}

/**
 * Main permission manager class
 */
export class UserPermissionManager extends EventEmitter {
  private config: PermissionManagerConfig;
  private authService: UserAuthenticationService;
  private aclEntries = new Map<string, ACLEntry>();
  private rateLimits = new Map<string, RateLimitEntry>(); // userId:platform -> RateLimitEntry
  private globalRateLimits = new Map<string, RateLimitEntry>(); // ip -> RateLimitEntry
  private aclCache = new Map<string, { result: boolean; expires: Date }>();
  private isInitialized = false;

  constructor(authService: UserAuthenticationService, config: Partial<PermissionManagerConfig> = {}) {
    super();
    this.authService = authService;
    this.config = {
      baseDir: path.join(os.homedir(), '.everfern', 'permissions'),
      defaultRateLimits: new Map([
        ['telegram', { windowMs: 60000, maxRequests: 30, burstAllowance: 5, penaltyDuration: 300000 }],
        ['discord', { windowMs: 60000, maxRequests: 30, burstAllowance: 5, penaltyDuration: 300000 }]
      ]),
      globalRateLimit: { windowMs: 60000, maxRequests: 100, burstAllowance: 10, penaltyDuration: 600000 },
      enableIpRestrictions: true,
      maxAclEntries: 10000,
      aclCacheTtl: 300000, // 5 minutes
      securityEventRetentionDays: 90,
      ...config
    };
  }

  /**
   * Initialize the permission manager
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      // Create base directory
      await fs.mkdir(this.config.baseDir, { recursive: true });

      // Load ACL entries
      await this.loadAclEntries();

      // Start cleanup timers
      this.startCleanupTimers();

      this.isInitialized = true;
      this.emit('initialized');

      console.log('UserPermissionManager initialized successfully');
    } catch (error) {
      console.error('Failed to initialize UserPermissionManager:', error);
      throw error;
    }
  }

  /**
   * Shutdown the permission manager
   */
  async shutdown(): Promise<void> {
    if (!this.isInitialized) {
      return;
    }

    try {
      // Save ACL entries
      await this.saveAclEntries();

      // Clear memory
      this.aclEntries.clear();
      this.rateLimits.clear();
      this.globalRateLimits.clear();
      this.aclCache.clear();

      this.isInitialized = false;
      this.emit('shutdown');

      console.log('UserPermissionManager shutdown successfully');
    } catch (error) {
      console.error('Error during UserPermissionManager shutdown:', error);
      throw error;
    }
  }

  /**
   * Check permissions with comprehensive access control
   */
  async checkPermission(context: PermissionContext): Promise<PermissionDecision> {
    try {
      // Check basic user authentication and permissions
      const basicPermission = this.authService.checkPermission(context.userId, context.capability);
      if (!basicPermission.granted) {
        await this.logSecurityEvent({
          type: 'permission_denied',
          userId: context.userId,
          platform: context.platform,
          details: {
            reason: basicPermission.reason,
            ip: context.metadata.ip,
            metadata: {
              capability: context.capability
            }
          },
          severity: 'low'
        });

        return {
          granted: false,
          reason: basicPermission.reason || 'Permission denied',
          rateLimit: await this.getRateLimitStatus(context.userId, context.platform),
          context: { basicPermissionCheck: false }
        };
      }

      // Check ACL rules
      const aclDecision = await this.checkAclRules(context);
      if (!aclDecision.granted) {
        await this.logSecurityEvent({
          type: 'permission_denied',
          userId: context.userId,
          platform: context.platform,
          details: {
            reason: 'ACL rule violation',
            ip: context.metadata.ip,
            metadata: {
              capability: context.capability,
              rule: aclDecision.appliedRule?.id
            }
          },
          severity: 'medium'
        });

        return aclDecision;
      }

      // Check rate limits
      const rateLimitCheck = await this.checkRateLimit(context);
      if (!rateLimitCheck.granted) {
        await this.logSecurityEvent({
          type: 'permission_denied',
          userId: context.userId,
          platform: context.platform,
          details: {
            reason: 'Rate limit exceeded',
            ip: context.metadata.ip,
            metadata: {
              capability: context.capability
            }
          },
          severity: 'medium'
        });

        return rateLimitCheck;
      }

      // All checks passed
      return {
        granted: true,
        reason: 'Permission granted',
        rateLimit: await this.getRateLimitStatus(context.userId, context.platform),
        context: {
          basicPermissionCheck: true,
          aclCheck: true,
          rateLimitCheck: true
        }
      };

    } catch (error) {
      await this.logSecurityEvent({
        type: 'permission_denied',
        userId: context.userId,
        platform: context.platform,
        details: {
          reason: 'Permission check error',
          ip: context.metadata.ip,
          metadata: {
            capability: context.capability,
            error: String(error)
          }
        },
        severity: 'high'
      });

      return {
        granted: false,
        reason: 'Permission check failed',
        rateLimit: await this.getRateLimitStatus(context.userId, context.platform),
        context: { error: String(error) }
      };
    }
  }

  /**
   * Add an ACL entry
   */
  async addAclEntry(entry: Omit<ACLEntry, 'id' | 'createdAt'>): Promise<string> {
    if (this.aclEntries.size >= this.config.maxAclEntries) {
      throw new Error('Maximum ACL entries limit reached');
    }

    const id = `acl_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const aclEntry: ACLEntry = {
      id,
      createdAt: new Date(),
      ...entry
    };

    this.aclEntries.set(id, aclEntry);
    await this.saveAclEntries();

    // Clear ACL cache
    this.aclCache.clear();

    this.emit('aclEntryAdded', aclEntry);
    return id;
  }

  /**
   * Remove an ACL entry
   */
  async removeAclEntry(id: string): Promise<boolean> {
    const removed = this.aclEntries.delete(id);
    if (removed) {
      await this.saveAclEntries();
      this.aclCache.clear();
      this.emit('aclEntryRemoved', id);
    }
    return removed;
  }

  /**
   * Get all ACL entries
   */
  getAclEntries(): ACLEntry[] {
    return Array.from(this.aclEntries.values());
  }

  /**
   * Update rate limit configuration for a platform
   */
  updateRateLimitConfig(platform: string, config: RateLimitConfig): void {
    this.config.defaultRateLimits.set(platform, config);
    this.emit('rateLimitConfigUpdated', platform, config);
  }

  /**
   * Get rate limit status for a user
   */
  async getRateLimitStatus(userId: string, platform: string): Promise<PermissionDecision['rateLimit']> {
    const key = `${userId}:${platform}`;
    const entry = this.rateLimits.get(key);
    const config = this.config.defaultRateLimits.get(platform) || this.config.globalRateLimit;

    if (!entry) {
      return {
        remaining: config.maxRequests,
        resetTime: new Date(Date.now() + config.windowMs),
        penalized: false
      };
    }

    // Clean old requests
    const now = new Date();
    const windowStart = new Date(now.getTime() - config.windowMs);
    entry.requests = entry.requests.filter(req => req > windowStart);

    // Check penalty status
    const penalized = entry.penalized && entry.penaltyExpires && entry.penaltyExpires > now;

    return {
      remaining: Math.max(0, config.maxRequests - entry.requests.length),
      resetTime: new Date(Math.min(...entry.requests.map(r => r.getTime())) + config.windowMs),
      penalized: penalized || false
    };
  }

  /**
   * Get security statistics
   */
  getSecurityStats(): {
    totalAclEntries: number;
    activeRateLimits: number;
    penalizedUsers: number;
    recentSecurityEvents: number;
  } {
    const now = new Date();
    const penalizedUsers = Array.from(this.rateLimits.values()).filter(
      entry => entry.penalized && entry.penaltyExpires && entry.penaltyExpires > now
    ).length;

    const recentEvents = this.authService.getSecurityEvents(100).filter(
      event => event.timestamp > new Date(now.getTime() - 24 * 60 * 60 * 1000)
    ).length;

    return {
      totalAclEntries: this.aclEntries.size,
      activeRateLimits: this.rateLimits.size,
      penalizedUsers,
      recentSecurityEvents: recentEvents
    };
  }

  /**
   * Check ACL rules against context
   */
  private async checkAclRules(context: PermissionContext): Promise<PermissionDecision> {
    const cacheKey = `${context.userId}:${context.platform}:${context.capability}`;
    const cached = this.aclCache.get(cacheKey);

    if (cached && cached.expires > new Date()) {
      return {
        granted: cached.result,
        reason: cached.result ? 'ACL allow (cached)' : 'ACL deny (cached)',
        rateLimit: await this.getRateLimitStatus(context.userId, context.platform),
        context: { cached: true }
      };
    }

    // Get applicable rules
    const applicableRules = Array.from(this.aclEntries.values())
      .filter(rule => this.isRuleApplicable(rule, context))
      .sort((a, b) => b.priority - a.priority); // Higher priority first

    // Check for expired rules
    const now = new Date();
    const activeRules = applicableRules.filter(rule => !rule.expiresAt || rule.expiresAt > now);

    // Apply rules in priority order
    for (const rule of activeRules) {
      if (rule.action === 'deny') {
        // Cache deny result
        this.aclCache.set(cacheKey, {
          result: false,
          expires: new Date(Date.now() + this.config.aclCacheTtl)
        });

        return {
          granted: false,
          reason: `Access denied by ACL rule: ${rule.description}`,
          appliedRule: rule,
          rateLimit: await this.getRateLimitStatus(context.userId, context.platform),
          context: { aclRuleId: rule.id }
        };
      }
    }

    // Check for explicit allow rules
    const allowRule = activeRules.find(rule => rule.action === 'allow');
    const granted = allowRule !== undefined;

    // Cache result
    this.aclCache.set(cacheKey, {
      result: granted,
      expires: new Date(Date.now() + this.config.aclCacheTtl)
    });

    return {
      granted,
      reason: granted ? `Access allowed by ACL rule: ${allowRule!.description}` : 'No explicit allow rule found',
      appliedRule: allowRule,
      rateLimit: await this.getRateLimitStatus(context.userId, context.platform),
      context: { aclRuleId: allowRule?.id }
    };
  }

  /**
   * Check if ACL rule applies to context
   */
  private isRuleApplicable(rule: ACLEntry, context: PermissionContext): boolean {
    // Check platform
    if (rule.platforms.length > 0 && !rule.platforms.includes(context.platform)) {
      return false;
    }

    // Check capability
    if (rule.capabilities.length > 0 && !rule.capabilities.includes(context.capability)) {
      return false;
    }

    // Check rule type and value
    switch (rule.type) {
      case 'user':
        return rule.value === context.userId;

      case 'platform':
        return rule.value === context.platformUserId;

      case 'ip':
        return rule.value === context.metadata.ip;

      case 'domain':
        // Extract domain from user agent or other metadata
        const userAgent = context.metadata.userAgent || '';
        return userAgent.toLowerCase().includes(rule.value.toLowerCase());

      case 'pattern':
        // Use regex pattern matching
        try {
          const regex = new RegExp(rule.value);
          return regex.test(context.platformUserId) ||
                 regex.test(context.userId) ||
                 regex.test(context.metadata.userAgent || '');
        } catch {
          return false;
        }

      default:
        return false;
    }
  }

  /**
   * Check rate limits
   */
  private async checkRateLimit(context: PermissionContext): Promise<PermissionDecision> {
    const key = `${context.userId}:${context.platform}`;
    const config = this.config.defaultRateLimits.get(context.platform) || this.config.globalRateLimit;

    let entry = this.rateLimits.get(key);
    if (!entry) {
      entry = {
        requests: [],
        penalized: false,
        violationCount: 0
      };
      this.rateLimits.set(key, entry);
    }

    const now = new Date();

    // Check if user is currently penalized
    if (entry.penalized && entry.penaltyExpires && entry.penaltyExpires > now) {
      return {
        granted: false,
        reason: 'User is temporarily penalized for rate limit violations',
        rateLimit: {
          remaining: 0,
          resetTime: entry.penaltyExpires,
          penalized: true
        },
        context: { penaltyExpires: entry.penaltyExpires }
      };
    }

    // Clean old requests
    const windowStart = new Date(now.getTime() - config.windowMs);
    entry.requests = entry.requests.filter(req => req > windowStart);

    // Check if within limits
    const currentRequests = entry.requests.length;
    const allowedRequests = config.maxRequests + config.burstAllowance;

    if (currentRequests >= allowedRequests) {
      // Rate limit exceeded
      entry.violationCount++;
      entry.penalized = true;
      entry.penaltyExpires = new Date(now.getTime() + config.penaltyDuration);

      return {
        granted: false,
        reason: 'Rate limit exceeded',
        rateLimit: {
          remaining: 0,
          resetTime: entry.penaltyExpires,
          penalized: true
        },
        context: {
          currentRequests,
          allowedRequests,
          violationCount: entry.violationCount
        }
      };
    }

    // Add current request
    entry.requests.push(now);

    // Clear penalty if it was set
    if (entry.penalized && (!entry.penaltyExpires || entry.penaltyExpires <= now)) {
      entry.penalized = false;
      entry.penaltyExpires = undefined;
    }

    return {
      granted: true,
      reason: 'Within rate limits',
      rateLimit: {
        remaining: Math.max(0, config.maxRequests - entry.requests.length),
        resetTime: new Date(Math.min(...entry.requests.map(r => r.getTime())) + config.windowMs),
        penalized: false
      },
      context: {
        currentRequests: entry.requests.length,
        allowedRequests: config.maxRequests
      }
    };
  }

  /**
   * Log security event
   */
  private async logSecurityEvent(event: Omit<SecurityEvent, 'id' | 'timestamp'>): Promise<void> {
    // Delegate to auth service for consistent logging
    this.emit('securityEvent', event);
  }

  /**
   * Start cleanup timers
   */
  private startCleanupTimers(): void {
    // Clean up rate limit entries every 10 minutes
    setInterval(() => {
      this.cleanupRateLimits();
    }, 10 * 60 * 1000);

    // Clean up ACL cache every 5 minutes
    setInterval(() => {
      this.cleanupAclCache();
    }, 5 * 60 * 1000);
  }

  /**
   * Clean up old rate limit entries
   */
  private cleanupRateLimits(): void {
    const now = new Date();
    const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 24 hours ago

    for (const [key, entry] of this.rateLimits) {
      // Remove entries with no recent requests and no active penalties
      const hasRecentRequests = entry.requests.some(req => req > cutoff);
      const hasPenalty = entry.penalized && entry.penaltyExpires && entry.penaltyExpires > now;

      if (!hasRecentRequests && !hasPenalty) {
        this.rateLimits.delete(key);
      }
    }
  }

  /**
   * Clean up expired ACL cache entries
   */
  private cleanupAclCache(): void {
    const now = new Date();

    for (const [key, cached] of this.aclCache) {
      if (cached.expires <= now) {
        this.aclCache.delete(key);
      }
    }
  }

  /**
   * Save ACL entries to disk
   */
  private async saveAclEntries(): Promise<void> {
    const filePath = path.join(this.config.baseDir, 'acl-entries.json');
    const entries = Array.from(this.aclEntries.values());
    await fs.writeFile(filePath, JSON.stringify(entries, null, 2), 'utf-8');
  }

  /**
   * Load ACL entries from disk
   */
  private async loadAclEntries(): Promise<void> {
    try {
      const filePath = path.join(this.config.baseDir, 'acl-entries.json');
      const data = await fs.readFile(filePath, 'utf-8');
      const entries: ACLEntry[] = JSON.parse(data);

      this.aclEntries.clear();
      for (const entry of entries) {
        this.aclEntries.set(entry.id, entry);
      }
    } catch (error) {
      // File might not exist yet, which is fine
    }
  }
}

/**
 * Create a user permission manager with default configuration
 */
export function createUserPermissionManager(
  authService: UserAuthenticationService,
  config: Partial<PermissionManagerConfig> = {}
): UserPermissionManager {
  return new UserPermissionManager(authService, config);
}
