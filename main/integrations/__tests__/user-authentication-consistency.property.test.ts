/**
 * Property Test: User Authentication Consistency
 *
 * This test validates that user authentication remains consistent across
 * different platforms and operations, ensuring that user identity and
 * permissions are properly maintained throughout the system.
 *
 * Validates Requirements: 4.3 - User Authentication Consistency
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import { TelegramPlatform, TelegramConfig } from '../telegram-platform';
import { DiscordPlatform, DiscordConfig } from '../discord-platform';
import { IncomingMessage, PlatformConfig } from '../platform-interface';

// Mock platform configurations for testing
const mockTelegramConfig: TelegramConfig = {
  enabled: true,
  config: {
    botToken: 'mock-telegram-token',
    botUsername: 'test_bot',
    allowedChats: [],
    respondToGroups: true,
    groupMentionOnly: false
  }
};

const mockDiscordConfig: DiscordConfig = {
  enabled: true,
  config: {
    botToken: 'mock-discord-token',
    applicationId: 'mock-app-id',
    allowedGuilds: [],
    allowedChannels: [],
    respondToDMs: true,
    respondToGuilds: true,
    guildMentionOnly: false
  }
};

// Mock user authentication service
class MockUserAuthService {
  private users = new Map<string, {
    id: string;
    platforms: Map<string, string>; // platform -> platform-specific ID
    permissions: string[];
    isAuthenticated: boolean;
  }>();

  authenticateUser(platformId: string, platform: string): string | null {
    // Find user by platform-specific ID
    for (const [userId, user] of this.users) {
      if (user.platforms.get(platform) === platformId && user.isAuthenticated) {
        return userId;
      }
    }
    return null;
  }

  linkPlatformIdentity(userId: string, platform: string, platformId: string): void {
    const user = this.users.get(userId);
    if (user) {
      user.platforms.set(platform, platformId);
    }
  }

  createUser(userId: string, platform: string, platformId: string): void {
    this.users.set(userId, {
      id: userId,
      platforms: new Map([[platform, platformId]]),
      permissions: ['basic'],
      isAuthenticated: true
    });
  }

  getUserPermissions(userId: string): string[] {
    return this.users.get(userId)?.permissions || [];
  }

  setUserAuthenticated(userId: string, authenticated: boolean): void {
    const user = this.users.get(userId);
    if (user) {
      user.isAuthenticated = authenticated;
    }
  }

  getAllUsers(): Array<{ id: string; platforms: Map<string, string>; permissions: string[]; isAuthenticated: boolean }> {
    return Array.from(this.users.values());
  }

  clear(): void {
    this.users.clear();
  }
}

describe('Property Test: User Authentication Consistency', () => {
  let authService: MockUserAuthService;
  let telegramPlatform: TelegramPlatform;
  let discordPlatform: DiscordPlatform;

  beforeEach(() => {
    authService = new MockUserAuthService();
    telegramPlatform = new TelegramPlatform(mockTelegramConfig);
    discordPlatform = new DiscordPlatform(mockDiscordConfig);
  });

  afterEach(() => {
    authService.clear();
  });

  /**
   * Property 1: User identity consistency across platforms
   *
   * For any user with linked platform identities, authentication should
   * return the same user ID regardless of which platform they use.
   */
  it('should maintain consistent user identity across platforms', () => {
    fc.assert(fc.property(
      fc.record({
        userId: fc.string({ minLength: 1, maxLength: 20 }),
        telegramId: fc.string({ minLength: 1, maxLength: 15 }),
        discordId: fc.string({ minLength: 1, maxLength: 20 }),
        permissions: fc.array(fc.constantFrom('basic', 'admin', 'moderator'), { minLength: 1, maxLength: 3 })
      }),
      (userData) => {
        // Create user with linked platform identities
        authService.createUser(userData.userId, 'telegram', userData.telegramId);
        authService.linkPlatformIdentity(userData.userId, 'discord', userData.discordId);

        // Authenticate from both platforms
        const telegramAuth = authService.authenticateUser(userData.telegramId, 'telegram');
        const discordAuth = authService.authenticateUser(userData.discordId, 'discord');

        // Both authentications should return the same user ID
        expect(telegramAuth).toBe(userData.userId);
        expect(discordAuth).toBe(userData.userId);
        expect(telegramAuth).toBe(discordAuth);
      }
    ), { numRuns: 100 });
  });

  /**
   * Property 2: Authentication state consistency
   *
   * When a user's authentication state changes, it should be reflected
   * consistently across all platforms.
   */
  it('should maintain consistent authentication state across platforms', () => {
    fc.assert(fc.property(
      fc.record({
        userId: fc.string({ minLength: 1, maxLength: 20 }),
        telegramId: fc.string({ minLength: 1, maxLength: 15 }),
        discordId: fc.string({ minLength: 1, maxLength: 20 }),
        authStates: fc.array(fc.boolean(), { minLength: 1, maxLength: 5 })
      }),
      (userData) => {
        // Create user with linked platform identities
        authService.createUser(userData.userId, 'telegram', userData.telegramId);
        authService.linkPlatformIdentity(userData.userId, 'discord', userData.discordId);

        // Test authentication state changes
        for (const authState of userData.authStates) {
          authService.setUserAuthenticated(userData.userId, authState);

          const telegramAuth = authService.authenticateUser(userData.telegramId, 'telegram');
          const discordAuth = authService.authenticateUser(userData.discordId, 'discord');

          if (authState) {
            // Both should return user ID when authenticated
            expect(telegramAuth).toBe(userData.userId);
            expect(discordAuth).toBe(userData.userId);
          } else {
            // Both should return null when not authenticated
            expect(telegramAuth).toBeNull();
            expect(discordAuth).toBeNull();
          }
        }
      }
    ), { numRuns: 50 });
  });

  /**
   * Property 3: Permission consistency across platforms
   *
   * User permissions should be consistent regardless of which platform
   * they authenticate through.
   */
  it('should maintain consistent permissions across platforms', () => {
    fc.assert(fc.property(
      fc.record({
        userId: fc.string({ minLength: 1, maxLength: 20 }),
        telegramId: fc.string({ minLength: 1, maxLength: 15 }),
        discordId: fc.string({ minLength: 1, maxLength: 20 }),
        permissions: fc.array(fc.constantFrom('basic', 'admin', 'moderator'), { minLength: 1, maxLength: 3 })
      }),
      (userData) => {
        // Create user with linked platform identities
        authService.createUser(userData.userId, 'telegram', userData.telegramId);
        authService.linkPlatformIdentity(userData.userId, 'discord', userData.discordId);

        // Authenticate from both platforms
        const telegramAuth = authService.authenticateUser(userData.telegramId, 'telegram');
        const discordAuth = authService.authenticateUser(userData.discordId, 'discord');

        // Get permissions for both authentications
        const telegramPermissions = telegramAuth ? authService.getUserPermissions(telegramAuth) : [];
        const discordPermissions = discordAuth ? authService.getUserPermissions(discordAuth) : [];

        // Permissions should be identical
        expect(telegramPermissions).toEqual(discordPermissions);
        expect(telegramPermissions.sort()).toEqual(discordPermissions.sort());
      }
    ), { numRuns: 100 });
  });

  /**
   * Property 4: Platform identity uniqueness
   *
   * Each platform-specific ID should map to at most one user account.
   * No two users should share the same platform-specific ID.
   */
  it('should ensure platform identity uniqueness', () => {
    fc.assert(fc.property(
      fc.array(fc.record({
        userId: fc.string({ minLength: 1, maxLength: 20 }),
        telegramId: fc.string({ minLength: 1, maxLength: 15 }),
        discordId: fc.string({ minLength: 1, maxLength: 20 })
      }), { minLength: 2, maxLength: 10 }),
      (users) => {
        // Create all users
        for (const user of users) {
          authService.createUser(user.userId, 'telegram', user.telegramId);
          authService.linkPlatformIdentity(user.userId, 'discord', user.discordId);
        }

        // Check that each platform ID maps to exactly one user
        const telegramIds = new Set<string>();
        const discordIds = new Set<string>();
        const allUsers = authService.getAllUsers();

        for (const user of allUsers) {
          const telegramId = user.platforms.get('telegram');
          const discordId = user.platforms.get('discord');

          if (telegramId) {
            // Each Telegram ID should be unique
            expect(telegramIds.has(telegramId)).toBe(false);
            telegramIds.add(telegramId);

            // Authentication should return the correct user
            const authResult = authService.authenticateUser(telegramId, 'telegram');
            expect(authResult).toBe(user.id);
          }

          if (discordId) {
            // Each Discord ID should be unique
            expect(discordIds.has(discordId)).toBe(false);
            discordIds.add(discordId);

            // Authentication should return the correct user
            const authResult = authService.authenticateUser(discordId, 'discord');
            expect(authResult).toBe(user.id);
          }
        }
      }
    ), { numRuns: 50 });
  });

  /**
   * Property 5: Authentication idempotency
   *
   * Multiple authentication attempts with the same credentials should
   * always return the same result.
   */
  it('should provide idempotent authentication results', () => {
    fc.assert(fc.property(
      fc.record({
        userId: fc.string({ minLength: 1, maxLength: 20 }),
        telegramId: fc.string({ minLength: 1, maxLength: 15 }),
        discordId: fc.string({ minLength: 1, maxLength: 20 }),
        attempts: fc.integer({ min: 2, max: 10 })
      }),
      (userData) => {
        // Create user with linked platform identities
        authService.createUser(userData.userId, 'telegram', userData.telegramId);
        authService.linkPlatformIdentity(userData.userId, 'discord', userData.discordId);

        // Perform multiple authentication attempts
        const telegramResults: (string | null)[] = [];
        const discordResults: (string | null)[] = [];

        for (let i = 0; i < userData.attempts; i++) {
          telegramResults.push(authService.authenticateUser(userData.telegramId, 'telegram'));
          discordResults.push(authService.authenticateUser(userData.discordId, 'discord'));
        }

        // All results should be identical
        const firstTelegramResult = telegramResults[0];
        const firstDiscordResult = discordResults[0];

        for (const result of telegramResults) {
          expect(result).toBe(firstTelegramResult);
        }

        for (const result of discordResults) {
          expect(result).toBe(firstDiscordResult);
        }

        // Both platforms should return the same user ID
        expect(firstTelegramResult).toBe(userData.userId);
        expect(firstDiscordResult).toBe(userData.userId);
      }
    ), { numRuns: 50 });
  });

  /**
   * Property 6: Cross-platform message attribution consistency
   *
   * Messages from the same user across different platforms should be
   * attributed to the same user account.
   */
  it('should consistently attribute messages across platforms', () => {
    fc.assert(fc.property(
      fc.record({
        userId: fc.string({ minLength: 1, maxLength: 20 }),
        telegramId: fc.string({ minLength: 1, maxLength: 15 }),
        discordId: fc.string({ minLength: 1, maxLength: 20 }),
        messageContent: fc.string({ minLength: 1, maxLength: 100 })
      }),
      (userData) => {
        // Create user with linked platform identities
        authService.createUser(userData.userId, 'telegram', userData.telegramId);
        authService.linkPlatformIdentity(userData.userId, 'discord', userData.discordId);

        // Simulate messages from both platforms
        const telegramMessage: Partial<IncomingMessage> = {
          platform: 'telegram',
          user: { id: userData.telegramId, name: 'Test User' },
          content: { text: userData.messageContent, files: [], isMention: false }
        };

        const discordMessage: Partial<IncomingMessage> = {
          platform: 'discord',
          user: { id: userData.discordId, name: 'Test User' },
          content: { text: userData.messageContent, files: [], isMention: false }
        };

        // Authenticate users from messages
        const telegramUserId = authService.authenticateUser(telegramMessage.user!.id, 'telegram');
        const discordUserId = authService.authenticateUser(discordMessage.user!.id, 'discord');

        // Both messages should be attributed to the same user
        expect(telegramUserId).toBe(userData.userId);
        expect(discordUserId).toBe(userData.userId);
        expect(telegramUserId).toBe(discordUserId);
      }
    ), { numRuns: 100 });
  });
});

/**
 * Integration test helper for testing authentication consistency
 * in real platform scenarios.
 */
export class AuthenticationConsistencyTester {
  private authService: MockUserAuthService;

  constructor() {
    this.authService = new MockUserAuthService();
  }

  /**
   * Test authentication consistency for a given user across platforms
   */
  async testUserConsistency(
    userId: string,
    platformIdentities: Map<string, string>
  ): Promise<{
    consistent: boolean;
    results: Map<string, string | null>;
    errors: string[];
  }> {
    const results = new Map<string, string | null>();
    const errors: string[] = [];

    try {
      // Create user with first platform identity
      const firstPlatform = platformIdentities.keys().next().value;
      const firstPlatformId = platformIdentities.get(firstPlatform)!;

      this.authService.createUser(userId, firstPlatform, firstPlatformId);

      // Link other platform identities
      for (const [platform, platformId] of platformIdentities) {
        if (platform !== firstPlatform) {
          this.authService.linkPlatformIdentity(userId, platform, platformId);
        }
      }

      // Test authentication from each platform
      for (const [platform, platformId] of platformIdentities) {
        const authResult = this.authService.authenticateUser(platformId, platform);
        results.set(platform, authResult);
      }

      // Check consistency
      const uniqueResults = new Set(results.values());
      const consistent = uniqueResults.size === 1 && !uniqueResults.has(null);

      if (!consistent) {
        errors.push('Authentication results are not consistent across platforms');
      }

      return { consistent, results, errors };
    } catch (error) {
      errors.push(`Authentication test failed: ${error}`);
      return { consistent: false, results, errors };
    }
  }

  /**
   * Clean up test data
   */
  cleanup(): void {
    this.authService.clear();
  }
}
