/**
 * EverFern Desktop — Web Search Tool
 *
 * Multi-engine search using search-engine-nodejs (Google/Bing/Yahoo scraping)
 * with automatic fallback to DuckDuckGo Instant Answer API.
 *
 * Engine priority:
 *   1. search-engine-nodejs (Google scraping — richest results)
 *   2. DuckDuckGo Instant Answers API (fast, no API key needed)
 *   3. DuckDuckGo Lite HTML scrape (last resort)
 */

import type { AgentTool, ToolResult } from '../runner/types';
import { toolSettingsStore } from '../../store/tool-settings';
import { playwrightWebSearch } from './web-playwright';
import { exaSearch } from './exa-client';

// ── search-engine-nodejs wrapper ─────────────────────────────────────

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

function searchViaEngine(engine: 'Google' | 'Yahoo', query: string): Promise<SearchResult[]> {
  return new Promise((resolve) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const SearchEngine = require('search-engine-nodejs').default;
      const method = SearchEngine[engine];
      if (typeof method !== 'function') {
        resolve([]);
        return;
      }

      const timer = setTimeout(() => resolve([]), 8000); // 8s timeout

      method.call(SearchEngine, query, (err: Error | null, results: any[]) => {
        clearTimeout(timer);
        if (err || !Array.isArray(results)) {
          resolve([]);
          return;
        }
        resolve(
          results.slice(0, 8).map((r: any) => ({
            title: String(r.title || r.heading || '').trim(),
            url: String(r.link || r.url || r.href || '').trim(),
            snippet: String(r.description || r.snippet || r.text || '').trim(),
          })).filter(r => r.url && r.title),
        );
      });
    } catch {
      resolve([]);
    }
  });
}

// ── DuckDuckGo fallback ──────────────────────────────────────────────

async function searchDDG(query: string): Promise<SearchResult[]> {
  const encoded = encodeURIComponent(query);
  const url = `https://api.duckduckgo.com/?q=${encoded}&format=json&no_html=1&skip_disambig=1`;

  const res = await fetch(url, {
    headers: { 'User-Agent': 'EverFern Desktop/1.0' },
    signal: AbortSignal.timeout(6000),
  });

  if (!res.ok) return [];

  const data: any = await res.json();
  const results: SearchResult[] = [];

  if (data.Abstract && data.AbstractURL) {
    results.push({
      title: data.Heading || query,
      url: data.AbstractURL,
      snippet: data.Abstract,
    });
  }

  if (Array.isArray(data.RelatedTopics)) {
    for (const topic of data.RelatedTopics) {
      if (topic.Text && topic.FirstURL && results.length < 7) {
        results.push({
          title: topic.Text.split(' - ')[0] || topic.Text.slice(0, 80),
          url: topic.FirstURL,
          snippet: topic.Text,
        });
      }
    }
  }

  // DDG Lite HTML fallback
  if (results.length === 0) {
    try {
      const liteRes = await fetch(`https://lite.duckduckgo.com/lite/?q=${encoded}`, {
        headers: { 'User-Agent': 'EverFern Desktop/1.0' },
        signal: AbortSignal.timeout(6000),
      });
      const html = await liteRes.text();

      const linkMatches = [...html.matchAll(/href="(https?:\/\/[^"]+)"[^>]*>([^<]+)</g)];
      const snippetMatches = [...html.matchAll(/class="result-snippet"[^>]*>([\s\S]*?)<\/td>/g)];

      for (let i = 0; i < Math.min(linkMatches.length, 6); i++) {
        results.push({
          title: (linkMatches[i][2] || '').trim(),
          url: linkMatches[i][1],
          snippet: (snippetMatches[i]?.[1] || '').replace(/<[^>]+>/g, '').trim(),
        });
      }
    } catch {
      // Silent fail
    }
  }

  return results;
}

// ── Main search with fallback chain ─────────────────────────────────

async function search(query: string): Promise<SearchResult[]> {
  // Try Google scraper first (richest results)
  try {
    const googleResults = await searchViaEngine('Google', query);
    if (googleResults.length > 0) {
      console.log(`[WebSearch] Got ${googleResults.length} results from Google scraper`);
      return googleResults;
    }
  } catch {
    // Fall through
  }

  // Try Yahoo scraper as secondary
  try {
    const yahooResults = await searchViaEngine('Yahoo', query);
    if (yahooResults.length > 0) {
      console.log(`[WebSearch] Got ${yahooResults.length} results from Yahoo scraper`);
      return yahooResults;
    }
  } catch {
    // Fall through
  }

  // DuckDuckGo as final fallback (always works)
  console.log(`[WebSearch] Falling back to DuckDuckGo for: "${query}"`);
  return searchDDG(query);
}

// ── Tool Definition ──────────────────────────────────────────────────

export const webSearchTool: AgentTool = {
  name: 'web_search',
  description:
    'Search the internet for real-time information using multiple search engines (Google, Yahoo, DuckDuckGo). ' +
    'Returns top results with titles, URLs, and snippets. ' +
    'Use for: current events, documentation lookups, factual questions, ' +
    "finding websites, research, and anything the AI doesn't know from training.",
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query (e.g. "best discord bots 2024", "React useEffect docs")',
      },
    },
    required: ['query'],
  },

  async execute(args: Record<string, unknown>, onUpdate?: (msg: string) => void, emitEvent?: (event: any) => void, toolCallId?: string): Promise<ToolResult> {
    const query = String(args['query'] ?? '').trim();

    // Strict query validation
    if (!query) {
      return {
        success: false,
        output: '❌ INVALID QUERY: Search requires a non-empty query string. Provide specific search terms (e.g., "best discord bots", "React hooks guide").',
        error: 'empty_query',
      };
    }

    // Query length validation
    if (query.length < 2) {
      return {
        success: false,
        output: '❌ INVALID QUERY: Search query too short. Use at least 2 characters.',
        error: 'query_too_short',
      };
    }

    if (query.length > 500) {
      return {
        success: false,
        output: '❌ INVALID QUERY: Search query too long (max 500 chars). Break into simpler searches.',
        error: 'query_too_long',
      };
    }

    // Detect likely non-query patterns (prevent abuse)
    if (/^\s*[^a-zA-Z0-9\s\-\.\p{L}]+\s*$|^\s*loading\s*$|^\s*undefined\s*$|^\s*null\s*$/iu.test(query)) {
      return {
        success: false,
        output: `❌ INVALID QUERY: "${query}" looks like a placeholder or invalid input. Provide actual search terms.`,
        error: 'invalid_query_format',
      };
    }

    try {
      const config = toolSettingsStore.get().webSearch;
      let results: SearchResult[];

      if (config.mode === 'local') {
        try {
          const pwResults = await playwrightWebSearch(query, config.headless);
          results = pwResults.map(r => ({ title: r.title, url: r.url, snippet: r.snippet }));
        } catch (err) {
          console.log(`[WebSearch] Playwright failed, falling back to scraper: ${err instanceof Error ? err.message : String(err)}`);
          results = await search(query);
        }
      } else if (config.mode === 'api') {
        try {
          const exaResults = await exaSearch(query, config.apiKey);
          results = exaResults.map(r => ({ title: r.title, url: r.url, snippet: r.snippet }));
        } catch (err) {
          console.log(`[WebSearch] Exa API failed, falling back to scraper: ${err instanceof Error ? err.message : String(err)}`);
          results = await search(query);
        }
      } else {
        results = await search(query);
      }

      if (results.length === 0) {
        return {
          success: true,
          output: `🔍 No results found for "${query}". Try rephrasing with different keywords or use computer_use to open a browser manually.`,
          data: { query, results: [] },
        };
      }

      // Truncate excessive results to prevent overwhelming output
      const maxResults = 8;
      const maxSnippetChars = 300;
      const truncatedResults = results.slice(0, maxResults).map(r => ({
        ...r,
        snippet: r.snippet.length > maxSnippetChars 
          ? r.snippet.slice(0, maxSnippetChars).trim() + '...' 
          : r.snippet,
      }));

      const formatted = truncatedResults
        .map((r, i) => `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.snippet}`)
        .join('\n\n');

      return {
        success: true,
        output: `🔍 Found ${results.length} result(s) for "${query}" (showing top ${truncatedResults.length}):\n\n${formatted}`,
        data: { query, results: truncatedResults, totalCount: results.length },
      };
    } catch (err) {
      return {
        success: false,
        output: `Search failed: ${err instanceof Error ? err.message : String(err)}`,
        error: String(err),
      };
    }
  },
};
