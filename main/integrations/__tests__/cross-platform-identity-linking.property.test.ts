/**
 * Property Test: Cross-Platform Identity Linking
 *
 * This test validates that cross-platform identity linking maintains consistency,
 * prevents conflicts, and ensures proper verification across all platforms.
 *
 * Validates Requirements: 7.1 - Cross-Platform Identity Linking
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import { UserAuthenticationService, createUserAuthenticationService } from '../user-auth';
import { IdentityLinkingService, createIdentityLinkingService } from '../identity-linking';
import { UserPermissionManager, createUserPermissionManager } from '../user-permissions';

// Test data generators
const platformArbitrary = fc.constantFrom('telegram', 'discord', 'slack', 'teams');
const userIdArbitrary = fc.string({ minLength: 5, maxLength: 20 });
const platformUserIdArbitrary = fc.string({ minLength: 3, maxLength: 15 });
const usernameArbitrary = fc.string({ minLength: 3, maxLength: 20 });
const displayNameArbitrary = fc.string({ minLength: 1, maxLength: 50 });

describe('Property Test: Cross-Platform Identity Linking', () => {
  let authService: UserAuthenticationService;
  let identityService: IdentityLinkingService;
  let permissionManager: UserPermissionManager;

  beforeEach(async () => {
    authService = createUserAuthenticationService({
      baseDir: '/tmp/test-auth',
      requireEmailVerification: false
    });

    identityService = createIdentityLinkingService(authService, {
      baseDir: '/tmp/test-identity',
      requireVerification: false // Disable for testing
    });

    permissionManager = createUserPermissionManager(authService, {
      baseDir: '/tmp/test-permissions'
    });

    await authService.initialize();
    await identityService.initialize();
    await permissionManager.initialize();
  });

  afterEach(async () => {
    await authService.shutdown();
    await identityService.shutdown();
    await permissionManager.shutdown();
  });

  /**
   * Property 1: Identity uniqueness across platforms
   *
   * Each platform-specific identity should be linked to at most one user account.
   * No two users should share the same platform identity.
   */
  it('should maintain identity uniqueness across platforms', () => {
    fc.assert(fc.property(
      fc.array(fc.record({
        platform: platformArbitrary,
        platformUserId: platformUserIdArbitrary,
        username: usernameArbitrary,
        displayName: displayNameArbitrary
      }), { minLength: 2, maxLength: 10 }),
      async (identities) => {
        const users: string[] = [];

        // Create users and attempt to link identities
        for (let i = 0; i < identities.length; i++) {
          const identity = identities[i];

          // Register a new user
          const registrationResult = await authService.registerUser({
            platform: identity.platform,
            platformId: identity.platformUserId,
            displayName: identity.displayName,
            username: identity.username
          });

          if (registrationResult.success && registrationResult.user) {
            users.push(registrationResult.user.id);
          }
        }

        // Verify that each platform identity is unique
        const platformIdentityMap = new Map<string, string>(); // platform:platformId -> userId

        for (const userId of users) {
          const userIdentities = identityService.getUserIdentities(userId);

          for (const identity of userIdentities) {
            const key = `${identity.platform}:${identity.platformUserId}`;

            if (platformIdentityMap.has(key)) {
              // Identity should not be linked to multiple users
              expect(platformIdentityMap.get(key)).toBe(userId);
            } else {
              platformIdentityMap.set(key, userId);
            }
          }
        }

        // Verify that each identity maps to exactly one user
        const uniqueUsers = new Set(platformIdentityMap.values());
        expect(uniqueUsers.size).toBeLessThanOrEqual(users.length);
      }
    ), { numRuns: 50 });
  });

  /**
   * Property 2: Cross-platform consistency
   *
   * When a user links multiple platform identities, all should belong to the same
   * user account and maintain consistent user information.
   */
  it('should maintain cross-platform consistency for linked identities', () => {
    fc.assert(fc.property(
      fc.record({
        userId: userIdArbitrary,
        displayName: displayNameArbitrary,
        identities: fc.array(fc.record({
          platform: platformArbitrary,
          platformUserId: platformUserIdArbitrary,
          username: usernameArbitrary
        }), { minLength: 2, maxLength: 5 })
      }),
      async (userData) => {
        // Register initial user
        const firstIdentity = userData.identities[0];
        const registrationResult = await authService.registerUser({
          platform: firstIdentity.platform,
          platformId: firstIdentity.platformUserId,
          displayName: userData.displayName,
          username: firstIdentity.username
        });

        if (!registrationResult.success || !registrationResult.user) {
          return; // Skip if registration failed
        }

        const userId = registrationResult.user.id;

        // Link additional identities
        for (let i = 1; i < userData.identities.length; i++) {
          const identity = userData.identities[i];

          await identityService.requestIdentityLinking(
            userId,
            identity.platform,
            identity.platformUserId,
            identity.username,
            userData.displayName
          );
        }

        // Verify all identities belong to the same user
        const userIdentities = identityService.getUserIdentities(userId);

        for (const identity of userIdentities) {
          // Verify user can be found by each platform identity
          const foundUser = authService.getUserByPlatformId(identity.platform, identity.platformUserId);
          expect(foundUser?.id).toBe(userId);

          // Verify consistent display name
          expect(foundUser?.profile.displayName).toBe(userData.displayName);
        }

        // Verify user has all expected identities
        const linkedPlatforms = new Set(userIdentities.map(id => id.platform));
        const expectedPlatforms = new Set(userData.identities.map(id => id.platform));

        // All unique platforms should be linked (allowing for duplicates in input)
        for (const platform of expectedPlatforms) {
          expect(linkedPlatforms.has(platform)).toBe(true);
        }
      }
    ), { numRuns: 30 });
  });

  /**
   * Property 3: Identity conflict detection and resolution
   *
   * When attempting to link an identity that's already linked to another user,
   * the system should detect the conflict and handle it appropriately.
   */
  it('should detect and handle identity conflicts correctly', () => {
    fc.assert(fc.property(
      fc.record({
        platform: platformArbitrary,
        platformUserId: platformUserIdArbitrary,
        user1: fc.record({
          displayName: displayNameArbitrary,
          username: usernameArbitrary
        }),
        user2: fc.record({
          displayName: displayNameArbitrary,
          username: usernameArbitrary
        })
      }),
      async (conflictData) => {
        // Register first user with the identity
        const user1Registration = await authService.registerUser({
          platform: conflictData.platform,
          platformId: conflictData.platformUserId,
          displayName: conflictData.user1.displayName,
          username: conflictData.user1.username
        });

        if (!user1Registration.success || !user1Registration.user) {
          return; // Skip if registration failed
        }

        // Register second user with different platform identity
        const user2Registration = await authService.registerUser({
          platform: 'different_platform',
          platformId: 'different_id',
          displayName: conflictData.user2.displayName,
          username: conflictData.user2.username
        });

        if (!user2Registration.success || !user2Registration.user) {
          return; // Skip if registration failed
        }

        // Attempt to link the same identity to the second user
        const linkingResult = await identityService.requestIdentityLinking(
          user2Registration.user.id,
          conflictData.platform,
          conflictData.platformUserId,
          conflictData.user2.username,
          conflictData.user2.displayName
        );

        // Should detect conflict
        expect(linkingResult.success).toBe(false);
        expect(linkingResult.conflict).toBeDefined();

        if (linkingResult.conflict) {
          expect(linkingResult.conflict.platform).toBe(conflictData.platform);
          expect(linkingResult.conflict.platformUserId).toBe(conflictData.platformUserId);
          expect(linkingResult.conflict.existingUserId).toBe(user1Registration.user.id);
          expect(linkingResult.conflict.requestingUserId).toBe(user2Registration.user.id);
        }

        // Verify original identity is still linked to first user
        const user1AfterConflict = authService.getUserByPlatformId(
          conflictData.platform,
          conflictData.platformUserId
        );
        expect(user1AfterConflict?.id).toBe(user1Registration.user.id);
      }
    ), { numRuns: 50 });
  });

  /**
   * Property 4: Identity verification consistency
   *
   * When verification is required, the verification process should be consistent
   * and secure across all platforms.
   */
  it('should maintain consistent verification process across platforms', () => {
    fc.assert(fc.property(
      fc.record({
        userId: userIdArbitrary,
        identities: fc.array(fc.record({
          platform: platformArbitrary,
          platformUserId: platformUserIdArbitrary,
          username: usernameArbitrary,
          displayName: displayNameArbitrary
        }), { minLength: 1, maxLength: 3 })
      }),
      async (userData) => {
        // Create identity service with verification enabled
        const verifyingIdentityService = createIdentityLinkingService(authService, {
          baseDir: '/tmp/test-identity-verify',
          requireVerification: true,
          verificationCodeLength: 6,
          maxVerificationAttempts: 3
        });

        await verifyingIdentityService.initialize();

        try {
          // Register initial user
          const firstIdentity = userData.identities[0];
          const registrationResult = await authService.registerUser({
            platform: firstIdentity.platform,
            platformId: firstIdentity.platformUserId,
            displayName: firstIdentity.displayName,
            username: firstIdentity.username
          });

          if (!registrationResult.success || !registrationResult.user) {
            return; // Skip if registration failed
          }

          const userId = registrationResult.user.id;

          // Request verification for additional identities
          const verificationRequests: string[] = [];

          for (let i = 1; i < userData.identities.length; i++) {
            const identity = userData.identities[i];

            const linkingResult = await verifyingIdentityService.requestIdentityLinking(
              userId,
              identity.platform,
              identity.platformUserId,
              identity.username,
              identity.displayName
            );

            // Should require verification
            expect(linkingResult.success).toBe(false);
            expect(linkingResult.verificationRequest).toBeDefined();

            if (linkingResult.verificationRequest) {
              verificationRequests.push(linkingResult.verificationRequest.id);

              // Verify request properties
              expect(linkingResult.verificationRequest.userId).toBe(userId);
              expect(linkingResult.verificationRequest.platform).toBe(identity.platform);
              expect(linkingResult.verificationRequest.status).toBe('pending');
              expect(linkingResult.verificationRequest.attempts).toBe(0);
              expect(linkingResult.verificationRequest.verificationData).toMatch(/^\d{6}$/);
            }
          }

          // Verify all requests are tracked
          const pendingRequests = verifyingIdentityService.getPendingVerificationRequests(userId);
          expect(pendingRequests.length).toBe(verificationRequests.length);

          // Test verification with correct codes
          for (const request of pendingRequests) {
            const verificationResult = await verifyingIdentityService.verifyIdentityLinking(
              request.id,
              request.verificationData
            );

            expect(verificationResult.success).toBe(true);
            expect(verificationResult.request.status).toBe('verified');
          }

          // Verify all identities are now linked
          const finalIdentities = verifyingIdentityService.getUserIdentities(userId);
          expect(finalIdentities.length).toBe(userData.identities.length);

        } finally {
          await verifyingIdentityService.shutdown();
        }
      }
    ), { numRuns: 20 });
  });

  /**
   * Property 5: Identity unlinking consistency
   *
   * When unlinking platform identities, the system should maintain consistency
   * and not affect other linked identities.
   */
  it('should maintain consistency when unlinking identities', () => {
    fc.assert(fc.property(
      fc.record({
        userId: userIdArbitrary,
        identities: fc.array(fc.record({
          platform: platformArbitrary,
          platformUserId: platformUserIdArbitrary,
          username: usernameArbitrary,
          displayName: displayNameArbitrary
        }), { minLength: 3, maxLength: 5 }),
        unlinkIndex: fc.integer({ min: 1, max: 4 }) // Don't unlink the first identity (primary)
      }),
      async (userData) => {
        if (userData.unlinkIndex >= userData.identities.length) {
          return; // Skip if index is out of bounds
        }

        // Register user with first identity
        const firstIdentity = userData.identities[0];
        const registrationResult = await authService.registerUser({
          platform: firstIdentity.platform,
          platformId: firstIdentity.platformUserId,
          displayName: firstIdentity.displayName,
          username: firstIdentity.username
        });

        if (!registrationResult.success || !registrationResult.user) {
          return; // Skip if registration failed
        }

        const userId = registrationResult.user.id;

        // Link additional identities
        for (let i = 1; i < userData.identities.length; i++) {
          const identity = userData.identities[i];

          await identityService.requestIdentityLinking(
            userId,
            identity.platform,
            identity.platformUserId,
            identity.username,
            identity.displayName
          );
        }

        // Get initial state
        const initialIdentities = identityService.getUserIdentities(userId);
        const identityToUnlink = userData.identities[userData.unlinkIndex];

        // Unlink one identity
        const unlinkResult = await identityService.unlinkPlatformIdentity(
          userId,
          identityToUnlink.platform
        );

        expect(unlinkResult).toBe(true);

        // Verify the specific identity was unlinked
        const userAfterUnlink = authService.getUserByPlatformId(
          identityToUnlink.platform,
          identityToUnlink.platformUserId
        );
        expect(userAfterUnlink).toBeUndefined();

        // Verify other identities remain linked
        const remainingIdentities = identityService.getUserIdentities(userId);
        expect(remainingIdentities.length).toBe(initialIdentities.length - 1);

        // Verify each remaining identity still works
        for (const identity of remainingIdentities) {
          const foundUser = authService.getUserByPlatformId(identity.platform, identity.platformUserId);
          expect(foundUser?.id).toBe(userId);
        }

        // Verify user account still exists and is functional
        const user = authService.getUser(userId);
        expect(user).toBeDefined();
        expect(user?.status.active).toBe(true);
      }
    ), { numRuns: 30 });
  });

  /**
   * Property 6: Permission consistency across linked identities
   *
   * User permissions should be consistent regardless of which platform
   * identity is used for authentication.
   */
  it('should maintain consistent permissions across linked identities', () => {
    fc.assert(fc.property(
      fc.record({
        userId: userIdArbitrary,
        identities: fc.array(fc.record({
          platform: platformArbitrary,
          platformUserId: platformUserIdArbitrary,
          username: usernameArbitrary,
          displayName: displayNameArbitrary
        }), { minLength: 2, maxLength: 4 }),
        capabilities: fc.array(fc.constantFrom(
          'send_messages', 'receive_messages', 'upload_files', 'download_files', 'manage_settings'
        ), { minLength: 1, maxLength: 3 })
      }),
      async (userData) => {
        // Register user with first identity
        const firstIdentity = userData.identities[0];
        const registrationResult = await authService.registerUser({
          platform: firstIdentity.platform,
          platformId: firstIdentity.platformUserId,
          displayName: firstIdentity.displayName,
          username: firstIdentity.username
        });

        if (!registrationResult.success || !registrationResult.user) {
          return; // Skip if registration failed
        }

        const userId = registrationResult.user.id;

        // Link additional identities
        for (let i = 1; i < userData.identities.length; i++) {
          const identity = userData.identities[i];

          await identityService.requestIdentityLinking(
            userId,
            identity.platform,
            identity.platformUserId,
            identity.username,
            identity.displayName
          );
        }

        // Update user permissions
        await authService.updateUserPermissions(userId, {
          addCapabilities: userData.capabilities
        });

        // Test permissions through each linked identity
        const linkedIdentities = identityService.getUserIdentities(userId);

        for (const identity of linkedIdentities) {
          // Authenticate through this identity
          const authResult = await authService.authenticateUser(
            identity.platform,
            identity.platformUserId
          );

          expect(authResult.success).toBe(true);
          expect(authResult.user?.id).toBe(userId);

          // Check permissions for each capability
          for (const capability of userData.capabilities) {
            const permissionResult = authService.checkPermission(userId, capability);
            expect(permissionResult.granted).toBe(true);
          }
        }

        // Verify permission consistency across all identities
        const permissionResults = new Map<string, boolean>();

        for (const capability of userData.capabilities) {
          const result = authService.checkPermission(userId, capability);
          permissionResults.set(capability, result.granted);
        }

        // All capabilities should have consistent results regardless of identity used
        for (const identity of linkedIdentities) {
          for (const capability of userData.capabilities) {
            const result = authService.checkPermission(userId, capability);
            expect(result.granted).toBe(permissionResults.get(capability));
          }
        }
      }
    ), { numRuns: 25 });
  });

  /**
   * Property 7: Concurrent identity linking safety
   *
   * Concurrent attempts to link identities should be handled safely without
   * creating inconsistent state or duplicate links.
   */
  it('should handle concurrent identity linking safely', () => {
    fc.assert(fc.property(
      fc.record({
        platform: platformArbitrary,
        platformUserId: platformUserIdArbitrary,
        users: fc.array(fc.record({
          displayName: displayNameArbitrary,
          username: usernameArbitrary
        }), { minLength: 2, maxLength: 5 })
      }),
      async (concurrencyData) => {
        // Register multiple users
        const userIds: string[] = [];

        for (let i = 0; i < concurrencyData.users.length; i++) {
          const user = concurrencyData.users[i];
          const registrationResult = await authService.registerUser({
            platform: 'initial_platform',
            platformId: `initial_${i}`,
            displayName: user.displayName,
            username: user.username
          });

          if (registrationResult.success && registrationResult.user) {
            userIds.push(registrationResult.user.id);
          }
        }

        if (userIds.length < 2) {
          return; // Need at least 2 users for concurrency test
        }

        // Attempt concurrent linking of the same identity to different users
        const linkingPromises = userIds.map(userId =>
          identityService.requestIdentityLinking(
            userId,
            concurrencyData.platform,
            concurrencyData.platformUserId,
            concurrencyData.users[0].username,
            concurrencyData.users[0].displayName
          )
        );

        const results = await Promise.allSettled(linkingPromises);

        // Count successful links
        let successfulLinks = 0;
        let conflictDetections = 0;

        for (const result of results) {
          if (result.status === 'fulfilled') {
            if (result.value.success) {
              successfulLinks++;
            } else if (result.value.conflict) {
              conflictDetections++;
            }
          }
        }

        // Only one user should successfully link the identity
        expect(successfulLinks).toBeLessThanOrEqual(1);

        // Verify final state consistency
        const finalOwner = authService.getUserByPlatformId(
          concurrencyData.platform,
          concurrencyData.platformUserId
        );

        if (finalOwner) {
          // Verify the identity is linked to exactly one user
          expect(userIds.includes(finalOwner.id)).toBe(true);

          // Verify no other user has this identity
          for (const userId of userIds) {
            if (userId !== finalOwner.id) {
              const userIdentities = identityService.getUserIdentities(userId);
              const hasConflictingIdentity = userIdentities.some(
                id => id.platform === concurrencyData.platform &&
                      id.platformUserId === concurrencyData.platformUserId
              );
              expect(hasConflictingIdentity).toBe(false);
            }
          }
        }
      }
    ), { numRuns: 20 });
  });
});

/**
 * Integration test helper for cross-platform identity linking scenarios
 */
export class CrossPlatformIdentityTester {
  private authService: UserAuthenticationService;
  private identityService: IdentityLinkingService;

  constructor() {
    this.authService = createUserAuthenticationService({
      baseDir: '/tmp/test-integration-auth',
      requireEmailVerification: false
    });

    this.identityService = createIdentityLinkingService(this.authService, {
      baseDir: '/tmp/test-integration-identity',
      requireVerification: false
    });
  }

  async initialize(): Promise<void> {
    await this.authService.initialize();
    await this.identityService.initialize();
  }

  async shutdown(): Promise<void> {
    await this.authService.shutdown();
    await this.identityService.shutdown();
  }

  /**
   * Test complete identity linking workflow
   */
  async testIdentityLinkingWorkflow(
    platforms: string[],
    userInfo: { displayName: string; username: string }
  ): Promise<{
    success: boolean;
    userId?: string;
    linkedPlatforms: string[];
    errors: string[];
  }> {
    const errors: string[] = [];
    let userId: string | undefined;
    const linkedPlatforms: string[] = [];

    try {
      // Register user with first platform
      const registrationResult = await this.authService.registerUser({
        platform: platforms[0],
        platformId: `${platforms[0]}_user_id`,
        displayName: userInfo.displayName,
        username: userInfo.username
      });

      if (!registrationResult.success || !registrationResult.user) {
        errors.push('Initial user registration failed');
        return { success: false, linkedPlatforms, errors };
      }

      userId = registrationResult.user.id;
      linkedPlatforms.push(platforms[0]);

      // Link additional platforms
      for (let i = 1; i < platforms.length; i++) {
        const platform = platforms[i];

        const linkingResult = await this.identityService.requestIdentityLinking(
          userId,
          platform,
          `${platform}_user_id`,
          userInfo.username,
          userInfo.displayName
        );

        if (linkingResult.success) {
          linkedPlatforms.push(platform);
        } else {
          errors.push(`Failed to link ${platform}: ${linkingResult.error}`);
        }
      }

      return {
        success: errors.length === 0,
        userId,
        linkedPlatforms,
        errors
      };

    } catch (error) {
      errors.push(`Workflow error: ${error}`);
      return { success: false, linkedPlatforms, errors };
    }
  }

  /**
   * Test identity conflict resolution
   */
  async testConflictResolution(
    platform: string,
    platformUserId: string,
    user1Info: { displayName: string; username: string },
    user2Info: { displayName: string; username: string }
  ): Promise<{
    conflictDetected: boolean;
    conflictResolved: boolean;
    finalOwner?: string;
    errors: string[];
  }> {
    const errors: string[] = [];

    try {
      // Register first user with the identity
      const user1Registration = await this.authService.registerUser({
        platform,
        platformId: platformUserId,
        displayName: user1Info.displayName,
        username: user1Info.username
      });

      if (!user1Registration.success || !user1Registration.user) {
        errors.push('User 1 registration failed');
        return { conflictDetected: false, conflictResolved: false, errors };
      }

      // Register second user
      const user2Registration = await this.authService.registerUser({
        platform: 'other_platform',
        platformId: 'other_id',
        displayName: user2Info.displayName,
        username: user2Info.username
      });

      if (!user2Registration.success || !user2Registration.user) {
        errors.push('User 2 registration failed');
        return { conflictDetected: false, conflictResolved: false, errors };
      }

      // Attempt to link same identity to second user
      const linkingResult = await this.identityService.requestIdentityLinking(
        user2Registration.user.id,
        platform,
        platformUserId,
        user2Info.username,
        user2Info.displayName
      );

      const conflictDetected = !linkingResult.success && !!linkingResult.conflict;

      if (!conflictDetected) {
        errors.push('Expected conflict was not detected');
        return { conflictDetected: false, conflictResolved: false, errors };
      }

      // Resolve conflict in favor of first user
      const conflictResolved = await this.identityService.resolveIdentityConflict(
        linkingResult.conflict!.id,
        'keep_existing',
        'test_admin',
        'Test resolution'
      );

      // Verify final state
      const finalOwner = this.authService.getUserByPlatformId(platform, platformUserId);

      return {
        conflictDetected: true,
        conflictResolved,
        finalOwner: finalOwner?.id,
        errors
      };

    } catch (error) {
      errors.push(`Conflict resolution error: ${error}`);
      return { conflictDetected: false, conflictResolved: false, errors };
    }
  }
}
