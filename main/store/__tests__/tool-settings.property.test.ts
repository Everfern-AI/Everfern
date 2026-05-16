/**
 * Property-Based Test: Config Persistence Round-Trip
 *
 * **Validates: Requirements 1.4, 1.5, 2.6, 3.6, 9.5**
 *
 * Property 1: Config persistence round-trip
 *
 * For any valid ToolSettingsConfig object, writing it to the ToolSettingsStore
 * and then reading it back SHALL return an equivalent object.
 *
 * Feature: web-tool-settings, Property 1: Config persistence round-trip
 */

import { describe, it, vi, beforeEach } from 'vitest';
import fc from 'fast-check';

// Mock fs before importing the store
vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn().mockImplementation(() => { throw new Error('no file'); }),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

import * as fs from 'fs';
import { ToolSettingsStore } from '../tool-settings';

describe('Feature: web-tool-settings, Property 1: Config persistence round-trip', () => {
  beforeEach(() => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined);
  });

  it('property: set then get returns the same config', () => {
    fc.assert(
      fc.property(
        fc.record({
          webSearch: fc.record({
            mode: fc.constantFrom('local' as const, 'api' as const),
            headless: fc.boolean(),
            apiKey: fc.string(),
          }),
          webCrawl: fc.record({
            mode: fc.constantFrom('local' as const, 'api' as const),
            headless: fc.boolean(),
            apiKey: fc.string(),
          }),
          browserUse: fc.record({
            mode: fc.constantFrom('local' as const, 'api' as const),
            headless: fc.boolean(),
            apiKey: fc.string(),
          }),
          navis: fc.record({
            useVision: fc.boolean(),
            headless: fc.boolean(),
            maxSteps: fc.integer({ min: 10, max: 50 }),
          }),
        }),
        (config) => {
          // Create a fresh store instance for each run (no file on disk)
          const store = new ToolSettingsStore();
          store.set(config);
          expect(store.get()).toEqual(config);
        }
      ),
      { numRuns: 100 }
    );
  });
});
