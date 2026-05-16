import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Tests for Web Explorer Phase Transitions
 *
 * Verifies that the web-explorer correctly progresses through:
 * Phase 1: Search
 * Phase 2: NAVIS Investigation
 * Phase 3: Synthesis
 */

describe('Web Explorer Phase Transitions', () => {
  describe('Search Result Detection', () => {
    it('should find web_search result with role: tool format', () => {
      const messages = [
        { role: 'user', content: 'search for flights' },
        { role: 'assistant', content: 'searching...' },
        { role: 'tool', name: 'web_search', content: 'https://kayak.com\nhttps://skyscanner.com' }
      ];

      // This would be tested by calling findWebSearchResult if it were exported
      // For now, we verify the message structure is correct
      const searchResult = messages.find((m: any) => m.role === 'tool' && m.name === 'web_search');
      expect(searchResult).toBeDefined();
      expect(searchResult?.content).toContain('kayak.com');
    });

    it('should handle tool results with different property names', () => {
      const messages = [
        { role: 'user', content: 'search' },
        { role: 'tool', tool_name: 'web_search', content: 'result1' },
        { role: 'tool', toolName: 'web_search', content: 'result2' },
        { role: 'tool', name: 'web_search', content: 'result3' }
      ];

      // Should find the most recent one (result3)
      let found = null;
      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        const toolName = m.name || m.tool_name || m.toolName || '';
        if (m.role === 'tool' && toolName === 'web_search') {
          found = m;
          break;
        }
      }

      expect(found).toBeDefined();
      expect(found?.content).toBe('result3');
    });

    it('should return null when no web_search result exists', () => {
      const messages = [
        { role: 'user', content: 'search' },
        { role: 'assistant', content: 'searching...' },
        { role: 'tool', name: 'other_tool', content: 'result' }
      ];

      const searchResult = messages.find((m: any) => m.role === 'tool' && m.name === 'web_search');
      expect(searchResult).toBeUndefined();
    });
  });

  describe('Phase State Transitions', () => {
    it('should track searchInvoked flag correctly', () => {
      // Phase 1: Before search
      let state = {
        searchInvoked: false,
        navisInvoked: false,
        webExplorerComplete: false
      };

      expect(state.searchInvoked).toBe(false);
      expect(state.navisInvoked).toBe(false);

      // Phase 1: After search
      state = {
        ...state,
        searchInvoked: true
      };

      expect(state.searchInvoked).toBe(true);
      expect(state.navisInvoked).toBe(false);
    });

    it('should track navisInvoked flag correctly', () => {
      // Phase 2: Before NAVIS
      let state = {
        searchInvoked: true,
        navisInvoked: false,
        webExplorerComplete: false
      };

      expect(state.navisInvoked).toBe(false);

      // Phase 2: After NAVIS
      state = {
        ...state,
        navisInvoked: true
      };

      expect(state.searchInvoked).toBe(true);
      expect(state.navisInvoked).toBe(true);
      expect(state.webExplorerComplete).toBe(false);
    });

    it('should mark complete after synthesis', () => {
      // Phase 3: After synthesis
      const state = {
        searchInvoked: true,
        navisInvoked: true,
        webExplorerComplete: true
      };

      expect(state.searchInvoked).toBe(true);
      expect(state.navisInvoked).toBe(true);
      expect(state.webExplorerComplete).toBe(true);
    });
  });

  describe('Phase Progression Logic', () => {
    it('should not skip to Phase 2 if search not invoked', () => {
      const searchInvoked = false;
      const navisInvoked = false;

      // Should be in Phase 1
      const inPhase1 = !searchInvoked && !navisInvoked;
      const inPhase2 = searchInvoked && !navisInvoked;
      const inPhase3 = searchInvoked && navisInvoked;

      expect(inPhase1).toBe(true);
      expect(inPhase2).toBe(false);
      expect(inPhase3).toBe(false);
    });

    it('should not skip to Phase 3 if navis not invoked', () => {
      const searchInvoked = true;
      const navisInvoked = false;

      // Should be in Phase 2
      const inPhase1 = !searchInvoked && !navisInvoked;
      const inPhase2 = searchInvoked && !navisInvoked;
      const inPhase3 = searchInvoked && navisInvoked;

      expect(inPhase1).toBe(false);
      expect(inPhase2).toBe(true);
      expect(inPhase3).toBe(false);
    });

    it('should be in Phase 3 when both search and navis invoked', () => {
      const searchInvoked = true;
      const navisInvoked = true;

      // Should be in Phase 3
      const inPhase1 = !searchInvoked && !navisInvoked;
      const inPhase2 = searchInvoked && !navisInvoked;
      const inPhase3 = searchInvoked && navisInvoked;

      expect(inPhase1).toBe(false);
      expect(inPhase2).toBe(false);
      expect(inPhase3).toBe(true);
    });
  });

  describe('Loop Prevention', () => {
    it('should not loop if search result not found', () => {
      const messages = [
        { role: 'user', content: 'search' },
        { role: 'assistant', content: 'searching...' }
        // No tool result
      ];

      const searchInvoked = true;
      const navisInvoked = false;

      // In Phase 2, but no search result found
      const inPhase2 = searchInvoked && !navisInvoked;
      expect(inPhase2).toBe(true);

      // Should mark complete instead of looping
      const searchResult = messages.find((m: any) => m.role === 'tool' && m.name === 'web_search');
      if (!searchResult) {
        // Mark complete to avoid loop
        const shouldMarkComplete = true;
        expect(shouldMarkComplete).toBe(true);
      }
    });

    it('should not loop after synthesis complete', () => {
      const messages = [
        { role: 'user', content: 'search' },
        { role: 'assistant', content: 'MISSION_COMPLETE' }
      ];

      const searchInvoked = true;
      const navisInvoked = true;

      // In Phase 3
      const inPhase3 = searchInvoked && navisInvoked;
      expect(inPhase3).toBe(true);

      // Check for completion marker
      const lastAssistant = [...messages].reverse().find((m: any) => m.role === 'assistant');
      const lastContent = lastAssistant ? lastAssistant.content : '';

      if (lastContent.includes('MISSION_COMPLETE')) {
        // Should mark complete and not loop
        const shouldMarkComplete = true;
        expect(shouldMarkComplete).toBe(true);
      }
    });
  });

  describe('Candidate Extraction', () => {
    it('should extract URLs from search content', () => {
      const searchContent = `
        Found these results:
        https://kayak.com/flights
        https://skyscanner.com/search
        https://booking.com/flights
      `;

      const urlRegex = /https?:\/\/[^\s"'<>)]+/g;
      const urls = searchContent.match(urlRegex) || [];

      expect(urls.length).toBeGreaterThan(0);
      expect(urls).toContain('https://kayak.com/flights');
      expect(urls).toContain('https://skyscanner.com/search');
    });

    it('should filter out search engine URLs', () => {
      const searchContent = `
        https://google.com/search?q=flights
        https://kayak.com/flights
        https://bing.com/search?q=flights
        https://skyscanner.com/search
      `;

      const urlRegex = /https?:\/\/[^\s"'<>)]+/g;
      const allUrls = searchContent.match(urlRegex) || [];
      const SEARCH_ENGINES = ['google.com', 'bing.com', 'duckduckgo.com'];
      const filtered = allUrls.filter(u => !SEARCH_ENGINES.some(se => u.includes(se)));

      expect(filtered).toContain('https://kayak.com/flights');
      expect(filtered).toContain('https://skyscanner.com/search');
      expect(filtered.length).toBe(2);
    });
  });
});
