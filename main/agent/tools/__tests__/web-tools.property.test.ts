/**
 * Property-Based Tests: Web Tool Settings Integration
 *
 * **Validates: Requirements 4.1, 4.5, 4.6, 5.1, 6.1, 7.1**
 *
 * Property 5: Playwright headless flag propagation
 * Property 6: Exa API called with stored query and key
 * Property 7: Firecrawl API called with stored URL and key
 *
 * Feature: web-tool-settings, Properties 5, 6, 7
 */

import { describe, it, vi, beforeEach } from 'vitest';
import fc from 'fast-check';

// ── Mocks ────────────────────────────────────────────────────────────

vi.mock('playwright', () => ({
  chromium: {
    launch: vi.fn(),
  },
}));

vi.mock('../exa-client', () => ({
  exaSearch: vi.fn(),
}));

vi.mock('../firecrawl-client', () => ({
  firecrawlCrawl: vi.fn(),
}));

vi.mock('../../../store/tool-settings', () => ({
  toolSettingsStore: { get: vi.fn() },
}));

// ── Imports (after mocks) ─────────────────────────────────────────────

import { chromium } from 'playwright';
import { exaSearch } from '../exa-client';
import { firecrawlCrawl } from '../firecrawl-client';
import { toolSettingsStore } from '../../../store/tool-settings';
import { playwrightWebSearch } from '../web-playwright';
import { webSearchTool } from '../web-search';
import { webFetchTool } from '../web-fetch';

// ── Property 5: Headless flag propagation ────────────────────────────

describe('Feature: web-tool-settings, Property 5: Playwright headless flag propagation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('property: chromium.launch is called with the headless value from config', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.boolean(),
        fc.string({ minLength: 1, maxLength: 50 }),
        async (headless, query) => {
          // Arrange: mock a minimal browser that returns empty results
          const mockPage = {
            goto: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValue([]),
          };
          const mockBrowser = {
            newPage: vi.fn().mockResolvedValue(mockPage),
            close: vi.fn().mockResolvedValue(undefined),
          };
          vi.mocked(chromium.launch).mockResolvedValue(mockBrowser as any);

          // Act
          await playwrightWebSearch(query, headless).catch(() => {});

          // Assert: chromium.launch was called with the exact headless value
          expect(chromium.launch).toHaveBeenCalledWith({ headless });
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ── Property 6: Exa called with correct args ─────────────────────────

describe('Feature: web-tool-settings, Property 6: Exa called with stored query and key', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('property: exaSearch is called with exactly (query, apiKey) from config', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 100 }),
        fc.string({ minLength: 1, maxLength: 64 }),
        async (query, apiKey) => {
          // Arrange
          vi.mocked(toolSettingsStore.get).mockReturnValue({
            webSearch: { mode: 'api', headless: false, apiKey },
            webCrawl: { mode: 'local', headless: true, apiKey: '' },
            browserUse: { mode: 'local', headless: false, apiKey: '' },
            navis: { useVision: false, headless: false, maxSteps: 25, autoLaunchChrome: true },
          });
          vi.mocked(exaSearch).mockResolvedValue([]);

          // Act
          await webSearchTool.execute({ query });

          // Assert: exaSearch called with exactly (query, apiKey)
          expect(exaSearch).toHaveBeenCalledWith(query, apiKey);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ── Property 7: Firecrawl called with correct args ───────────────────

describe('Feature: web-tool-settings, Property 7: Firecrawl called with stored URL and key', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('property: firecrawlCrawl is called with exactly (url, apiKey) from config', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.webUrl(),
        fc.string({ minLength: 1, maxLength: 64 }),
        async (url, apiKey) => {
          // Arrange
          vi.mocked(toolSettingsStore.get).mockReturnValue({
            webSearch: { mode: 'local', headless: true, apiKey: '' },
            webCrawl: { mode: 'api', headless: false, apiKey },
            browserUse: { mode: 'local', headless: false, apiKey: '' },
            navis: { useVision: false, headless: false, maxSteps: 25, autoLaunchChrome: true },
          });
          vi.mocked(firecrawlCrawl).mockResolvedValue('');

          // Act
          await webFetchTool.execute({ url });

          // Assert: firecrawlCrawl called with exactly (url, apiKey)
          expect(firecrawlCrawl).toHaveBeenCalledWith(url, apiKey);
        }
      ),
      { numRuns: 100 }
    );
  });
});
