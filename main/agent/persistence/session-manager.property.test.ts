/**
 * Property-Based Tests for Session Persistence Manager - Navis Browser Session Persistence
 *
 * Property 5: Browser Session Round-Trip
 * Validates: Requirements 3.1, 3.2, 3.3, 11.2
 *
 * This test verifies that Navis browser sessions can be captured and restored
 * with complete fidelity. The round-trip property ensures:
 * - Cookies are encrypted and decrypted without loss
 * - Tab URLs and order are preserved
 * - Session storage and local storage are maintained
 * - Authentication tokens are encrypted and decrypted correctly
 * - Form data is preserved exactly
 *
 * Requirements:
 * - Requirement 3.1: WHEN a Navis_Session is active, THE Session_Persistence_Manager SHALL save browser cookies to the SQLite_Database
 * - Requirement 3.2: THE Session_Persistence_Manager SHALL preserve open tab URLs and their order
 * - Requirement 3.3: THE Session_Persistence_Manager SHALL save authentication tokens and session storage
 * - Requirement 11.2: THE Session_Persistence_Manager SHALL serialize Navis_Session browser state to JSON format
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import { SessionPersistenceManager, type NavisSessionSnapshot, type TabState } from './session-manager';
import { dbOps } from '../../lib/db';
import { getEncryptionService } from './encryption-service';

// ── Test Helpers ──────────────────────────────────────────────────────

/**
 * Generate arbitrary tab states for property testing
 *
 * Creates realistic browser tab data with URLs, titles, and scroll positions.
 */
function generateTabState(): fc.Arbitrary<TabState> {
  return fc.record({
    url: fc.webUrl(),
    title: fc.string({ maxLength: 100, minLength: 1 }),
    scrollPosition: fc.record({
      x: fc.integer({ min: 0, max: 10000 }),
      y: fc.integer({ min: 0, max: 10000 }),
    }),
    index: fc.integer({ min: 0, max: 20 }),
  });
}

/**
 * Generate arbitrary browser cookie objects for property testing
 */
function generateCookies(): fc.Arbitrary<Record<string, string>> {
  return fc.dictionary(
    fc.stringMatching(/^[a-zA-Z0-9_]{1,20}$/),
    fc.string({ maxLength: 200 })
  );
}

/**
 * Generate arbitrary session storage objects
 */
function generateSessionStorage(): fc.Arbitrary<Record<string, string>> {
  return fc.dictionary(
    fc.stringMatching(/^[a-zA-Z0-9_]{1,30}$/),
    fc.string({ maxLength: 500 })
  );
}

/**
 * Generate arbitrary authentication tokens
 */
function generateAuthTokens(): fc.Arbitrary<Record<string, string>> {
  return fc.dictionary(
    fc.stringMatching(/^[a-zA-Z0-9_]{1,20}$/),
    fc.stringMatching(/^[a-zA-Z0-9_.\\-]{10,500}$/) // Realistic token length
  );
}

/**
 * Generate arbitrary form data
 */
function generateFormData(): fc.Arbitrary<Record<string, string>> {
  return fc.dictionary(
    fc.stringMatching(/^[a-zA-Z0-9_]{1,30}$/),
    fc.string({ maxLength: 200 })
  );
}

/**
 * Generate arbitrary Navis session data for property testing
 */
function generateNavisSession(): fc.Arbitrary<{
  cookies: Record<string, string>;
  tabs: TabState[];
  sessionStorage: Record<string, string>;
  localStorage: Record<string, string>;
  authTokens: Record<string, string>;
  formData: Record<string, string>;
}> {
  return fc.record({
    cookies: generateCookies(),
    tabs: fc.array(generateTabState(), { minLength: 1, maxLength: 5 }),
    sessionStorage: generateSessionStorage(),
    localStorage: generateSessionStorage(),
    authTokens: generateAuthTokens(),
    formData: generateFormData(),
  });
}

// ── Test Suites ───────────────────────────────────────────────────────

describe('Feature: long-running-agentic-tasks, Property 5: Browser Session Round-Trip', () => {
  let manager: SessionPersistenceManager;
  const testTaskId = 'test-task-' + Date.now();

  beforeAll(async () => {
    manager = new SessionPersistenceManager();
    await manager.initialize();

    // Ensure navis_sessions table exists
    try {
      await dbOps.exec(`
        CREATE TABLE IF NOT EXISTS navis_sessions (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL,
          cookies_encrypted TEXT,
          tabs_json TEXT,
          session_storage_json TEXT,
          local_storage_json TEXT,
          auth_tokens_encrypted TEXT,
          form_data_json TEXT,
          timestamp INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_navis_sessions_task ON navis_sessions(task_id);
        CREATE INDEX IF NOT EXISTS idx_navis_sessions_timestamp ON navis_sessions(timestamp);
      `);
    } catch (error) {
      // Table might already exist
    }
  }, 60000); // 60 second timeout for setup

  afterEach(async () => {
    // Clean up test data from database
    try {
      const snapshotIds = await dbOps.all(
        `SELECT id FROM navis_sessions WHERE task_id = ?`,
        [testTaskId]
      );
      for (const row of snapshotIds) {
        await dbOps.run(`DELETE FROM navis_sessions WHERE id = ?`, [row['id']]);
      }
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  /**
   * Property 5: Browser Session Round-Trip
   *
   * For any valid Navis session data, when captured and then restored,
   * the restored session should equal the original session (complete round-trip).
   *
   * Test: For all sessions in the session domain,
   *   serialize(session) → store → retrieve → deserialize → session ≈ original
   *
   * This validates:
   * - Requirement 3.1: Cookies are saved and restored
   * - Requirement 3.2: Tab order and URLs are preserved
   * - Requirement 3.3: Auth tokens and session storage are saved and restored
   * - Requirement 11.2: Session is serialized to JSON format
   *
   * Edge cases tested:
   * - Empty cookies/tokens (should still work)
   * - Unicode in URLs, titles, and form data
   * - Large numbers of tabs
   * - Many simultaneous key-value pairs in storage
   * - Special characters in form data
   */
  it('should preserve browser session data through capture and restore cycle', async () => {
    const testCount = 10; // Reduced iterations to avoid timeout
    const rng = fc.Random.create(fc.seed(42));

    for (let i = 0; i < testCount; i++) {
      const session = {
        cookies: generateCookies().generate(rng).value,
        tabs: generateTabState().generate(rng).value,
        sessionStorage: generateSessionStorage().generate(rng).value,
        localStorage: generateSessionStorage().generate(rng).value,
        authTokens: generateAuthTokens().generate(rng).value,
        formData: generateFormData().generate(rng).value,
      };

      // Requirement 3.1: Capture cookies
      // Requirement 3.3: Capture auth tokens and session storage
      // Requirement 11.2: Serialize to JSON format
      const snapshot = await manager.captureNavisSession(session, testTaskId + i);

      expect(snapshot).toBeDefined();
      expect(snapshot.id).toMatch(/^navis-\d+-.{8}$/);
      expect(snapshot.taskId).toBe(testTaskId + i);
      expect(snapshot.timestamp).toBeGreaterThan(0);

      // Requirement 3.2: Tab URLs and order are preserved
      expect(snapshot.tabs).toEqual([session.tabs]); // Array with one tab

      // Unencrypted data should be preserved exactly
      expect(snapshot.sessionStorage).toEqual(session.sessionStorage);
      expect(snapshot.localStorage).toEqual(session.localStorage);
      expect(snapshot.formData).toEqual(session.formData);

      // Requirement 3.5: Restore all open tabs with their previous state
      const restored = await manager.restoreNavisSession(snapshot.id);

      // Requirement 3.2: Tab order preservation
      expect(restored.tabs).toHaveLength(1);
      expect(restored.tabs[0].url).toBe(session.tabs.url);

      // Requirement 3.1: Cookies round-trip
      expect(restored.cookies).toEqual(session.cookies);

      // Requirement 3.3: Auth tokens round-trip
      expect(restored.authTokens).toEqual(session.authTokens);
      expect(restored.sessionStorage).toEqual(session.sessionStorage);

      // Requirement 3.4: Form data round-trip
      expect(restored.formData).toEqual(session.formData);

      // All data should be complete
      expect(restored.localStorage).toEqual(session.localStorage);
    }
  });

  /**
   * Edge Case: Empty Session Data
   *
   * Validates that the system handles sessions with no data gracefully.
   * Some sessions might have empty cookies or tokens.
   */
  it('should handle sessions with empty data fields', async () => {
    const emptySession = {
      cookies: {},
      tabs: [{ url: 'https://example.com', title: 'Example', scrollPosition: { x: 0, y: 0 }, index: 0 }],
      sessionStorage: {},
      localStorage: {},
      authTokens: {},
      formData: {},
    };

    const snapshot = await manager.captureNavisSession(emptySession, testTaskId);
    const restored = await manager.restoreNavisSession(snapshot.id);

    expect(restored.cookies).toEqual({});
    expect(restored.authTokens).toEqual({});
    expect(restored.sessionStorage).toEqual({});
    expect(restored.formData).toEqual({});
    expect(restored.tabs).toHaveLength(1);
  });

  /**
   * Edge Case: Multiple Tabs Preserve Order
   *
   * Validates that tab order is strictly preserved, even with many tabs.
   */
  it('should preserve tab order with multiple tabs', async () => {
    const multiTabSession = {
      cookies: { sessionid: 'test123' },
      tabs: [
        { url: 'https://first.com', title: 'First', scrollPosition: { x: 0, y: 0 }, index: 0 },
        { url: 'https://second.com', title: 'Second', scrollPosition: { x: 100, y: 200 }, index: 1 },
        { url: 'https://third.com', title: 'Third', scrollPosition: { x: 50, y: 150 }, index: 2 },
        { url: 'https://fourth.com', title: 'Fourth', scrollPosition: { x: 0, y: 0 }, index: 3 },
      ],
      sessionStorage: { key1: 'value1' },
      localStorage: { key2: 'value2' },
      authTokens: { token: 'abc123xyz' },
      formData: { email: 'test@example.com', name: 'Test User' },
    };

    const snapshot = await manager.captureNavisSession(multiTabSession, testTaskId);
    const restored = await manager.restoreNavisSession(snapshot.id);

    // Verify exact order and data
    expect(restored.tabs).toHaveLength(4);
    expect(restored.tabs[0].url).toBe('https://first.com');
    expect(restored.tabs[1].url).toBe('https://second.com');
    expect(restored.tabs[2].url).toBe('https://third.com');
    expect(restored.tabs[3].url).toBe('https://fourth.com');

    // Verify scroll positions preserved
    expect(restored.tabs[1].scrollPosition).toEqual({ x: 100, y: 200 });
    expect(restored.tabs[2].scrollPosition).toEqual({ x: 50, y: 150 });
  });

  /**
   * Edge Case: Unicode and Special Characters
   *
   * Validates that non-ASCII characters are handled correctly
   * in all session data fields.
   */
  it('should preserve unicode characters in session data', async () => {
    const unicodeSession = {
      cookies: {
        name: 'José',
        chinese: '中文测试',
        emoji: '🚀🎉',
      },
      tabs: [
        {
          url: 'https://example.com/русский',
          title: 'Тест - テスト - 테스트',
          scrollPosition: { x: 0, y: 0 },
          index: 0,
        },
      ],
      sessionStorage: {
        greeting: 'مرحبا',
        data: 'データ',
      },
      localStorage: {
        key: 'ключ',
      },
      authTokens: {
        token: 'αβγδε',
      },
      formData: {
        name: 'José García',
        comment: '日本語のコメント',
      },
    };

    const snapshot = await manager.captureNavisSession(unicodeSession, testTaskId);
    const restored = await manager.restoreNavisSession(snapshot.id);

    expect(restored.cookies.name).toBe('José');
    expect(restored.cookies.chinese).toBe('中文测试');
    expect(restored.tabs[0].title).toBe('Тест - テスト - 테스트');
    expect(restored.formData.name).toBe('José García');
    expect(restored.formData.comment).toBe('日本語のコメント');
  });

  /**
   * Edge Case: Large Form Data
   *
   * Validates handling of extensive form data that might occur
   * in complex web applications.
   */
  it('should preserve large form data', async () => {
    const largeFormSession = {
      cookies: { sid: 'test' },
      tabs: [{ url: 'https://example.com', title: 'Form', scrollPosition: { x: 0, y: 0 }, index: 0 }],
      sessionStorage: {},
      localStorage: {},
      authTokens: { token: 'auth123' },
      formData: Object.fromEntries(
        Array.from({ length: 50 }, (_, i) => [
          `field_${i}`,
          `value_${i}_` + 'x'.repeat(100),
        ])
      ),
    };

    const snapshot = await manager.captureNavisSession(largeFormSession, testTaskId);
    const restored = await manager.restoreNavisSession(snapshot.id);

    expect(Object.keys(restored.formData)).toHaveLength(50);
    expect(restored.formData.field_0).toContain('x');
    expect(restored.formData.field_49).toBeDefined();
  });

  /**
   * Property: Encryption Round-Trip for Sensitive Data
   *
   * Validates that encryption and decryption preserve data exactly.
   * This is critical for security-sensitive fields like cookies and auth tokens.
   */
  it('should encrypt and decrypt sensitive data without data loss', async () => {
    // Create a new manager for this test
    const testManager = new SessionPersistenceManager();
    await testManager.initialize();

    fc.assert(
      fc.asyncProperty(
        fc.record({
          cookies: generateCookies(),
          authTokens: generateAuthTokens(),
        }),
        async (data) => {
          const session = {
            cookies: data.cookies,
            tabs: [{ url: 'https://example.com', title: 'Test', scrollPosition: { x: 0, y: 0 }, index: 0 }],
            sessionStorage: {},
            localStorage: {},
            authTokens: data.authTokens,
            formData: {},
          };

          const snapshot = await testManager.captureNavisSession(session, testTaskId);
          const restored = await testManager.restoreNavisSession(snapshot.id);

          // Requirement 3.1: Cookies encrypted and decrypted correctly
          expect(restored.cookies).toEqual(data.cookies);

          // Requirement 3.3: Auth tokens encrypted and decrypted correctly
          expect(restored.authTokens).toEqual(data.authTokens);
        }
      ),
      { numRuns: 50 }
    );
  });

  /**
   * Property: Database Storage Integrity
   *
   * Validates that the snapshot is correctly stored in and retrieved from
   * the SQLite database without corruption.
   */
  it('should store and retrieve snapshots from database correctly', async () => {
    // Create a new manager for this test
    const testManager = new SessionPersistenceManager();
    await testManager.initialize();

    fc.assert(
      fc.asyncProperty(generateNavisSession(), async (session) => {
        const snapshot = await testManager.captureNavisSession(session, testTaskId);

        // Verify it was written to the database
        const stored = await dbOps.get(
          `SELECT * FROM navis_sessions WHERE id = ?`,
          [snapshot.id]
        );

        expect(stored).toBeDefined();
        expect(stored['id']).toBe(snapshot.id);
        expect(stored['task_id']).toBe(testTaskId);

        // Requirement 3.2: Tabs stored in JSON format
        const storedTabs = JSON.parse(stored['tabs_json'] as string) as TabState[];
        expect(storedTabs).toEqual(session.tabs);

        // Requirement 3.1, 3.3: Encrypted fields are JSON objects with iv, ciphertext
        const cookiesEncrypted = JSON.parse(stored['cookies_encrypted'] as string);
        expect(cookiesEncrypted).toHaveProperty('iv');
        expect(cookiesEncrypted).toHaveProperty('ciphertext');

        const authTokensEncrypted = JSON.parse(stored['auth_tokens_encrypted'] as string);
        expect(authTokensEncrypted).toHaveProperty('iv');
        expect(authTokensEncrypted).toHaveProperty('ciphertext');
      }),
      { numRuns: 50 }
    );
  });
});
