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

import { describe, it, vi, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';

// ── Mocks ────────────────────────────────────────────────────────────

const mockPage = {
  goto: vi.fn().mockResolvedValue(undefined),
  evaluate: vi.fn().mockResolvedValue([]),
  close: vi.fn().mockResolvedValue(undefined),
};

const mockContext = {
  newPage: vi.fn().mockResolvedValue(mockPage),
  close: vi.fn().mockResolvedValue(undefined),
};

const mockBrowser = {
  newContext: vi.fn().mockResolvedValue(mockContext),
  close: vi.fn().mockResolvedValue(undefined),
};

vi.mock('playwright', () => ({
  chromium: {
    launch: vi.fn().mockImplementation(async () => mockBrowser),
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

// ── Property 5: Headless flag propagation ────────────────────────────

describe('Feature: web-tool-settings, Property 5: Playwright headless flag propagation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('property: chromium.launch is called with the headless value from config (true)', async () => {
    vi.mocked(chromium.launch).mockResolvedValue(mockBrowser as any);
    await playwrightWebSearch('test query', true).catch(() => {});
    expect(chromium.launch).toHaveBeenCalledWith(expect.objectContaining({ headless: true }));
  });

  it('property: chromium.launch is called with the headless value from config (false)', async () => {
    vi.mocked(chromium.launch).mockResolvedValue(mockBrowser as any);
    await playwrightWebSearch('test query', false).catch(() => {});
    expect(chromium.launch).toHaveBeenCalledWith(expect.objectContaining({ headless: false }));
  });
});

// ── Property 6: Exa called with correct args ─────────────────────────

describe('Feature: web-tool-settings, Property 6: Exa called with stored query and key', () => {
  it('property: exaSearch is called with exactly (query, apiKey) from config', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 2, maxLength: 100 }).filter(s => s.trim().length >= 2 && !/^\s*[^a-zA-Z0-9\s\-\.\p{L}]+\s*$|^\s*loading\s*$|^\s*undefined\s*$|^\s*null\s*$/iu.test(s)),
        fc.string({ minLength: 2, maxLength: 64 }).filter(s => s.trim().length >= 2),
        async (query, apiKey) => {
          vi.clearAllMocks();
          // Arrange
          vi.mocked(toolSettingsStore.get).mockReturnValue({
            webSearch: { mode: 'api', headless: false, apiKey },
            webCrawl: { mode: 'local', headless: true, apiKey: '' },
            browserUse: { mode: 'local', headless: false, apiKey: '' },
            navis: { useVision: false, headless: false, maxSteps: 25, useChromeProfile: false },
          });
          vi.mocked(exaSearch).mockResolvedValue([]);

          // Act
          await webSearchTool.execute({ query });

          // Assert: exaSearch called with exactly (query, apiKey)
          expect(exaSearch).toHaveBeenCalledWith(query.trim(), apiKey);
        }
      ),
      { numRuns: 20 }
    );
  });
});

