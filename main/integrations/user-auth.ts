/**
 * User Authentication Service for Multi-Platform Integration
 *
 * This module manages user authentication, registration, and authorization
 * across multiple messaging platforms with JSON file storage.
 */

import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { EventEmitter } from 'events';

/**
 * User account information
 */
export interface UserAccount {
  /** Unique user ID across all platforms */
  id: string;
  /** User profile information */
  profile: {
    displayName: string;
    email?: string;
    avatar?: string;
    timezone?: string;
    language?: string;
  };
  /** Platform-specific identities */
  platformIdentities: Map<string, {
    platformId: string;
    username: string;
    displayName: string;
    avatar?: string;
    linkedAt: Date;
    verified: boolean;
  }>;
  /** User permissions and roles */
  permissions: {
    role: 'user' | 'moderator' | 'admin' | 'owner';
    capabilities: Set<string>;
    restrictions: Set<string>;
  };
  /** Account status */
  status: {
    active: boolean;
    verified: boolean;
    suspended: boolean;
    suspensionReason?: string;
    lastLogin?: Date;
    createdAt: Date;
    updatedAt: Date;
  };
  /** Security settings */
  security: {
    passwordHash?: string;
    salt?: string;
    apiKeys: Map<string, {
      key: string;
      name: string;
      permissions: string[];
      createdAt: Date;
      lastUsed?: Date;
      expiresAt?: Date;
    }>;
    sessions: Map<string, {
      platform: string;
      deviceInfo?: string;
      createdAt: Date;
      lastActivity: Date;
      expiresAt: Date;
    }>;
  };
}

/**
 * Authentication result
 */
export interface AuthenticationResult {
  /** Whether authentication succeeded */
  success: boolean;
  /** User account (if successful) */
  user?: UserAccount;
  /** Session token (if successful) */
  sessionToken?: string;
  /** Error message (if failed) */
  error?: string;
  /** Additional details */
  details?: Record<string, any>;
}

/**
 * User registration data
 */
export interface UserRegistrationData {
  /** Platform where user is registering */
  platform: string;
  /** Platform-specific user ID */
  platformId: string;
  /** User's display name */
  displayName: string;
  /** Username on the platform */
  username: string;
  /** Optional email */
  email?: string;
  /** Optional avatar URL */
  avatar?: string;
  /** Registration metadata */
  metadata?: Record<string, any>;
}

/**
 * Permission check result
 */
export interface PermissionCheckResult {
  /** Whether permission is granted */
  granted: boolean;
  /** Reason for denial (if not granted) */
  reason?: string;
  /** Required role for this permission */
  requiredRole?: string;
  /** User's current role */
  userRole?: string;
}

/**
 * Authentication service configuration
 */
export interface AuthConfig {
  /** Base directory for user data storage */
  baseDir: string;
  /** Session timeout in milliseconds */
  sessionTimeout: number;
  /** Maximum failed login attempts */
  maxFailedAttempts: number;
  /** Account lockout duration in milliseconds */
  lockoutDuration: number;
  /** Whether to require email verification */
  requireEmailVerification: boolean;
  /** Default user role for new registrations */
  defaultRole: 'user' | 'moderator' | 'admin';
  /** Available capabilities */
  availableCapabilities: string[];
  /** Auto-approval settings */
  autoApproval: {
    enabled: boolean;
    allowedDomains: string[];
    requireInvite: boolean;
  };
}

/**
 * Security event information
 */
export interface SecurityEvent {
  /** Event ID */
  id: string;
  /** Event type */
  type: 'login' | 'logout' | 'failed_login' | 'registration' | 'permission_denied' | 'account_locked' | 'suspicious_activity';
  /** User ID (if applicable) */
  userId?: string;
  /** Platform where event occurred */
  platform: string;
  /** Event timestamp */
  timestamp: Date;
  /** Event details */
  details: {
    ip?: string;
    userAgent?: string;
    location?: string;
    reason?: string;
    metadata?: Record<string, any>;
  };
  /** Severity level */
  severity: 'low' | 'medium' | 'high' | 'critical';
}

/**
 * Main user authentication service
 */
export class UserAuthenticationService extends EventEmitter {
  private config: AuthConfig;
  private users = new Map<string, UserAccount>();
  private platformUserMap = new Map<string, string>(); // platform:platformId -> userId
  private failedAttempts = new Map<string, { count: number; lastAttempt: Date }>();
  private securityEvents: SecurityEvent[] = [];
  private isInitialized = false;

  constructor(config: Partial<AuthConfig> = {}) {
    super();
    this.config = {
      baseDir: path.join(os.homedir(), '.everfern', 'users'),
      sessionTimeout: 24 * 60 * 60 * 1000, // 24 hours
      maxFailedAttempts: 5,
      lockoutDuration: 30 * 60 * 1000, // 30 minutes
      requireEmailVerification: false,
      defaultRole: 'user',
      availableCapabilities: [
        'send_messages',
        'receive_messages',
        'upload_files',
        'download_files',
        'create_conversations',
        'manage_settings',
        'view_logs',
        'moderate_users',
        'admin_access'
      ],
      autoApproval: {
        enabled: true,
        allowedDomains: [],
        requireInvite: false
      },
      ...config
    };
  }

  /**
   * Initialize the authentication service
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      // Create base directory
      await fs.mkdir(this.config.baseDir, { recursive: true });

      // Load existing users
      await this.loadUsers();

      // Load security events
      await this.loadSecurityEvents();

      // Start cleanup timer for expired sessions
      this.startCleanupTimer();

      this.isInitialized = true;
      this.emit('initialized');

      console.log('UserAuthenticationService initialized successfully');
    } catch (error) {
      console.error('Failed to initialize UserAuthenticationService:', error);
      throw error;
    }
  }

  /**
   * Shutdown the authentication service
   */
  async shutdown(): Promise<void> {
    if (!this.isInitialized) {
      return;
    }

    try {
      // Save all user data
      await this.saveAllUsers();

      // Save security events
      await this.saveSecurityEvents();

      // Clear memory
      this.users.clear();
      this.platformUserMap.clear();
      this.failedAttempts.clear();

      this.isInitialized = false;
      this.emit('shutdown');

      console.log('UserAuthenticationService shutdown successfully');
    } catch (error) {
      console.error('Error during UserAuthenticationService shutdown:', error);
      throw error;
    }
  }

  /**
   * Register a new user
   */
  async registerUser(registrationData: UserRegistrationData): Promise<AuthenticationResult> {
    try {
      // Check if user already exists on this platform
      const existingUserId = this.platformUserMap.get(`${registrationData.platform}:${registrationData.platformId}`);
      if (existingUserId) {
        return {
          success: false,
          error: 'User already registered on this platform'
        };
      }

      // Check auto-approval settings
      if (!this.config.autoApproval.enabled) {
        return {
          success: false,
          error: 'Registration requires manual approval'
        };
      }

      // Generate unique user ID
      const userId = this.generateUserId();

      // Create user account
      const user: UserAccount = {
        id: userId,
        profile: {
          displayName: registrationData.displayName,
          email: registrationData.email,
          avatar: registrationData.avatar
        },
        platformIdentities: new Map([[registrationData.platform, {
          platformId: registrationData.platformId,
          username: registrationData.username,
          displayName: registrationData.displayName,
          avatar: registrationData.avatar,
          linkedAt: new Date(),
          verified: true
        }]]),
        permissions: {
          role: this.config.defaultRole,
          capabilities: new Set(['send_messages', 'receive_messages', 'upload_files', 'download_files']),
          restrictions: new Set()
        },
        status: {
          active: true,
          verified: !this.config.requireEmailVerification,
          suspended: false,
          createdAt: new Date(),
          updatedAt: new Date()
        },
        security: {
          apiKeys: new Map(),
          sessions: new Map()
        }
      };

      // Store user
      this.users.set(userId, user);
      this.platformUserMap.set(`${registrationData.platform}:${registrationData.platformId}`, userId);

      // Save to disk
      await this.saveUser(user);

      // Log security event
      await this.logSecurityEvent({
        type: 'registration',
        userId,
        platform: registrationData.platform,
        details: {
          metadata: {
            username: registrationData.username,
            ...registrationData.metadata
          }
        },
        severity: 'low'
      });

      // Create session
      const sessionToken = await this.createSession(userId, registrationData.platform);

      this.emit('userRegistered', user);

      return {
        success: true,
        user,
        sessionToken
      };

    } catch (error) {
      return {
        success: false,
        error: `Registration failed: ${error}`
      };
    }
  }

  /**
   * Authenticate a user by platform identity
   */
  async authenticateUser(platform: string, platformId: string, metadata?: Record<string, any>): Promise<AuthenticationResult> {
    try {
      // Check for account lockout
      const lockoutKey = `${platform}:${platformId}`;
      if (this.isAccountLocked(lockoutKey)) {
        await this.logSecurityEvent({
          type: 'failed_login',
          platform,
          details: {
            reason: 'Account locked',
            metadata: {
              platformId,
              ...metadata
            }
          },
          severity: 'medium'
        });

        return {
          success: false,
          error: 'Account is temporarily locked due to too many failed attempts'
        };
      }

      // Find user by platform identity
      const userId = this.platformUserMap.get(`${platform}:${platformId}`);
      if (!userId) {
        await this.recordFailedAttempt(lockoutKey);
        await this.logSecurityEvent({
          type: 'failed_login',
          platform,
          details: {
            reason: 'User not found',
            metadata: {
              platformId,
              ...metadata
            }
          },
          severity: 'low'
        });

        return {
          success: false,
          error: 'User not found'
        };
      }

      const user = this.users.get(userId);
      if (!user) {
        return {
          success: false,
          error: 'User account not found'
        };
      }

      // Check account status
      if (!user.status.active) {
        await this.logSecurityEvent({
          type: 'failed_login',
          userId,
          platform,
          details: {
            reason: 'Account inactive',
            metadata
          },
          severity: 'medium'
        });

        return {
          success: false,
          error: 'Account is inactive'
        };
      }

      if (user.status.suspended) {
        await this.logSecurityEvent({
          type: 'failed_login',
          userId,
          platform,
          details: {
            reason: 'Account suspended',
            metadata: {
              suspensionReason: user.status.suspensionReason,
              ...metadata
            }
          },
          severity: 'medium'
        });

        return {
          success: false,
          error: `Account is suspended: ${user.status.suspensionReason || 'No reason provided'}`
        };
      }

      // Clear failed attempts on successful authentication
      this.failedAttempts.delete(lockoutKey);

      // Update last login
      user.status.lastLogin = new Date();
      user.status.updatedAt = new Date();

      // Create session
      const sessionToken = await this.createSession(userId, platform, metadata);

      // Log successful login
      await this.logSecurityEvent({
        type: 'login',
        userId,
        platform,
        details: { metadata },
        severity: 'low'
      });

      this.emit('userAuthenticated', user, platform);

      return {
        success: true,
        user,
        sessionToken
      };

    } catch (error) {
      return {
        success: false,
        error: `Authentication failed: ${error}`
      };
    }
  }

  /**
   * Link a platform identity to an existing user
   */
  async linkPlatformIdentity(
    userId: string,
    platform: string,
    platformId: string,
    username: string,
    displayName: string,
    avatar?: string
  ): Promise<boolean> {
    try {
      const user = this.users.get(userId);
      if (!user) {
        return false;
      }

      // Check if platform identity is already linked to another user
      const existingUserId = this.platformUserMap.get(`${platform}:${platformId}`);
      if (existingUserId && existingUserId !== userId) {
        return false;
      }

      // Add platform identity
      user.platformIdentities.set(platform, {
        platformId,
        username,
        displayName,
        avatar,
        linkedAt: new Date(),
        verified: true
      });

      // Update platform user map
      this.platformUserMap.set(`${platform}:${platformId}`, userId);

      // Update user
      user.status.updatedAt = new Date();
      await this.saveUser(user);

      this.emit('platformIdentityLinked', userId, platform, platformId);
      return true;

    } catch (error) {
      console.error('Error linking platform identity:', error);
      return false;
    }
  }

  /**
   * Check user permissions
   */
  checkPermission(userId: string, capability: string): PermissionCheckResult {
    const user = this.users.get(userId);
    if (!user) {
      return {
        granted: false,
        reason: 'User not found'
      };
    }

    if (!user.status.active || user.status.suspended) {
      return {
        granted: false,
        reason: 'Account is inactive or suspended',
        userRole: user.permissions.role
      };
    }

    // Check if user has the specific capability
    if (user.permissions.capabilities.has(capability)) {
      return { granted: true };
    }

    // Check if user has restrictions
    if (user.permissions.restrictions.has(capability)) {
      return {
        granted: false,
        reason: 'Capability is explicitly restricted',
        userRole: user.permissions.role
      };
    }

    // Check role-based permissions
    const roleCapabilities = this.getRoleCapabilities(user.permissions.role);
    if (roleCapabilities.has(capability)) {
      return { granted: true };
    }

    return {
      granted: false,
      reason: 'Insufficient permissions',
      requiredRole: this.getRequiredRoleForCapability(capability),
      userRole: user.permissions.role
    };
  }

  /**
   * Update user permissions
   */
  async updateUserPermissions(
    userId: string,
    updates: {
      role?: UserAccount['permissions']['role'];
      addCapabilities?: string[];
      removeCapabilities?: string[];
      addRestrictions?: string[];
      removeRestrictions?: string[];
    }
  ): Promise<boolean> {
    try {
      const user = this.users.get(userId);
      if (!user) {
        return false;
      }

      // Update role
      if (updates.role) {
        user.permissions.role = updates.role;
      }

      // Update capabilities
      if (updates.addCapabilities) {
        updates.addCapabilities.forEach(cap => user.permissions.capabilities.add(cap));
      }
      if (updates.removeCapabilities) {
        updates.removeCapabilities.forEach(cap => user.permissions.capabilities.delete(cap));
      }

      // Update restrictions
      if (updates.addRestrictions) {
        updates.addRestrictions.forEach(res => user.permissions.restrictions.add(res));
      }
      if (updates.removeRestrictions) {
        updates.removeRestrictions.forEach(res => user.permissions.restrictions.delete(res));
      }

      // Update timestamp
      user.status.updatedAt = new Date();
      await this.saveUser(user);

      this.emit('userPermissionsUpdated', userId, updates);
      return true;

    } catch (error) {
      console.error('Error updating user permissions:', error);
      return false;
    }
  }

  /**
   * Suspend or unsuspend a user account
   */
  async suspendUser(userId: string, suspended: boolean, reason?: string): Promise<boolean> {
    try {
      const user = this.users.get(userId);
      if (!user) {
        return false;
      }

      user.status.suspended = suspended;
      user.status.suspensionReason = suspended ? reason : undefined;
      user.status.updatedAt = new Date();

      // Invalidate all sessions if suspending
      if (suspended) {
        user.security.sessions.clear();
      }

      await this.saveUser(user);

      // Log security event
      await this.logSecurityEvent({
        type: suspended ? 'account_locked' : 'login',
        userId,
        platform: 'system',
        details: {
          metadata: {
            action: suspended ? 'suspended' : 'unsuspended',
            reason
          }
        },
        severity: suspended ? 'high' : 'medium'
      });

      this.emit('userSuspensionChanged', userId, suspended, reason);
      return true;

    } catch (error) {
      console.error('Error updating user suspension status:', error);
      return false;
    }
  }

  /**
   * Get user by ID
   */
  getUser(userId: string): UserAccount | undefined {
    return this.users.get(userId);
  }

  /**
   * Get user by platform identity
   */
  getUserByPlatformId(platform: string, platformId: string): UserAccount | undefined {
    const userId = this.platformUserMap.get(`${platform}:${platformId}`);
    return userId ? this.users.get(userId) : undefined;
  }

  /**
   * Get all users (admin function)
   */
  getAllUsers(): UserAccount[] {
    return Array.from(this.users.values());
  }

  /**
   * Get security events
   */
  getSecurityEvents(limit = 100): SecurityEvent[] {
    return this.securityEvents.slice(-limit);
  }

  /**
   * Generate unique user ID
   */
  private generateUserId(): string {
    return `user_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
  }

  /**
   * Create a session for a user
   */
  private async createSession(userId: string, platform: string, metadata?: Record<string, any>): Promise<string> {
    const user = this.users.get(userId);
    if (!user) {
      throw new Error('User not found');
    }

    const sessionToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + this.config.sessionTimeout);

    user.security.sessions.set(sessionToken, {
      platform,
      deviceInfo: metadata?.userAgent,
      createdAt: new Date(),
      lastActivity: new Date(),
      expiresAt
    });

    await this.saveUser(user);
    return sessionToken;
  }

  /**
   * Check if account is locked due to failed attempts
   */
  private isAccountLocked(lockoutKey: string): boolean {
    const attempts = this.failedAttempts.get(lockoutKey);
    if (!attempts) {
      return false;
    }

    if (attempts.count >= this.config.maxFailedAttempts) {
      const lockoutExpiry = new Date(attempts.lastAttempt.getTime() + this.config.lockoutDuration);
      return new Date() < lockoutExpiry;
    }

    return false;
  }

  /**
   * Record a failed authentication attempt
   */
  private async recordFailedAttempt(lockoutKey: string): Promise<void> {
    const existing = this.failedAttempts.get(lockoutKey);
    if (existing) {
      existing.count++;
      existing.lastAttempt = new Date();
    } else {
      this.failedAttempts.set(lockoutKey, {
        count: 1,
        lastAttempt: new Date()
      });
    }
  }

  /**
   * Get capabilities for a role
   */
  private getRoleCapabilities(role: UserAccount['permissions']['role']): Set<string> {
    const capabilities = new Set<string>();

    switch (role) {
      case 'owner':
        capabilities.add('admin_access');
        // Fall through
      case 'admin':
        capabilities.add('moderate_users');
        capabilities.add('view_logs');
        // Fall through
      case 'moderator':
        capabilities.add('manage_settings');
        // Fall through
      case 'user':
        capabilities.add('send_messages');
        capabilities.add('receive_messages');
        capabilities.add('upload_files');
        capabilities.add('download_files');
        capabilities.add('create_conversations');
        break;
    }

    return capabilities;
  }

  /**
   * Get required role for a capability
   */
  private getRequiredRoleForCapability(capability: string): string {
    const roleMap: Record<string, string> = {
      'admin_access': 'admin',
      'moderate_users': 'admin',
      'view_logs': 'admin',
      'manage_settings': 'moderator',
      'send_messages': 'user',
      'receive_messages': 'user',
      'upload_files': 'user',
      'download_files': 'user',
      'create_conversations': 'user'
    };

    return roleMap[capability] || 'admin';
  }

  /**
   * Log a security event
   */
  private async logSecurityEvent(event: Omit<SecurityEvent, 'id' | 'timestamp'>): Promise<void> {
    const securityEvent: SecurityEvent = {
      id: `event_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      timestamp: new Date(),
      ...event
    };

    this.securityEvents.push(securityEvent);

    // Keep only recent events in memory
    if (this.securityEvents.length > 1000) {
      this.securityEvents = this.securityEvents.slice(-500);
    }

    this.emit('securityEvent', securityEvent);
  }

  /**
   * Start cleanup timer for expired sessions
   */
  private startCleanupTimer(): void {
    setInterval(async () => {
      try {
        await this.cleanupExpiredSessions();
      } catch (error) {
        console.error('Error during session cleanup:', error);
      }
    }, 60 * 60 * 1000); // Run every hour
  }

  /**
   * Clean up expired sessions
   */
  private async cleanupExpiredSessions(): Promise<void> {
    const now = new Date();
    let cleanedCount = 0;

    for (const user of this.users.values()) {
      const expiredSessions: string[] = [];

      for (const [token, session] of user.security.sessions) {
        if (session.expiresAt < now) {
          expiredSessions.push(token);
        }
      }

      if (expiredSessions.length > 0) {
        expiredSessions.forEach(token => user.security.sessions.delete(token));
        await this.saveUser(user);
        cleanedCount += expiredSessions.length;
      }
    }

    if (cleanedCount > 0) {
      console.log(`Cleaned up ${cleanedCount} expired sessions`);
    }
  }

  /**
   * Save user to disk
   */
  private async saveUser(user: UserAccount): Promise<void> {
    const filePath = path.join(this.config.baseDir, `${user.id}.json`);

    // Convert Map objects to plain objects for JSON serialization
    const serializable = {
      ...user,
      platformIdentities: Object.fromEntries(user.platformIdentities),
      permissions: {
        ...user.permissions,
        capabilities: Array.from(user.permissions.capabilities),
        restrictions: Array.from(user.permissions.restrictions)
      },
      security: {
        ...user.security,
        apiKeys: Object.fromEntries(user.security.apiKeys),
        sessions: Object.fromEntries(user.security.sessions)
      }
    };

    await fs.writeFile(filePath, JSON.stringify(serializable, null, 2), 'utf-8');
  }

  /**
   * Save all users to disk
   */
  private async saveAllUsers(): Promise<void> {
    const savePromises = Array.from(this.users.values()).map(user => this.saveUser(user));
    await Promise.allSettled(savePromises);
  }

  /**
   * Load users from disk
   */
  private async loadUsers(): Promise<void> {
    try {
      const files = await fs.readdir(this.config.baseDir);

      for (const filename of files) {
        if (filename.endsWith('.json') && filename !== 'security-events.json') {
          try {
            const filePath = path.join(this.config.baseDir, filename);
            const data = await fs.readFile(filePath, 'utf-8');
            const serialized = JSON.parse(data);

            // Convert back to Map objects
            const user: UserAccount = {
              ...serialized,
              platformIdentities: new Map(Object.entries(serialized.platformIdentities)),
              permissions: {
                ...serialized.permissions,
                capabilities: new Set(serialized.permissions.capabilities),
                restrictions: new Set(serialized.permissions.restrictions)
              },
              security: {
                ...serialized.security,
                apiKeys: new Map(Object.entries(serialized.security.apiKeys || {})),
                sessions: new Map(Object.entries(serialized.security.sessions || {}))
              }
            };

            this.users.set(user.id, user);

            // Build platform user map
            for (const [platform, identity] of user.platformIdentities) {
              this.platformUserMap.set(`${platform}:${identity.platformId}`, user.id);
            }
          } catch (error) {
            console.error(`Error loading user from ${filename}:`, error);
          }
        }
      }
    } catch (error) {
      // Directory might not exist yet, which is fine
    }
  }

  /**
   * Save security events to disk
   */
  private async saveSecurityEvents(): Promise<void> {
    const filePath = path.join(this.config.baseDir, 'security-events.json');
    await fs.writeFile(filePath, JSON.stringify(this.securityEvents, null, 2), 'utf-8');
  }

  /**
   * Load security events from disk
   */
  private async loadSecurityEvents(): Promise<void> {
    try {
      const filePath = path.join(this.config.baseDir, 'security-events.json');
      const data = await fs.readFile(filePath, 'utf-8');
      this.securityEvents = JSON.parse(data);
    } catch (error) {
      // File might not exist yet, which is fine
      this.securityEvents = [];
    }
  }
}

/**
 * Create a user authentication service with default configuration
 */
export function createUserAuthenticationService(config: Partial<AuthConfig> = {}): UserAuthenticationService {
  return new UserAuthenticationService(config);
}
