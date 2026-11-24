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

import { BrowserWindow } from 'electron';
import { execFile } from 'child_process';
import type { AgentTool, ToolResult } from '../runner/types';
import { toolSettingsStore } from '../../store/tool-settings';
import { playwrightWebSearch } from './web-playwright';
import { exaSearch } from './exa-client';
import { firecrawlSearch } from './firecrawl-client';

// ── search-engine-nodejs wrapper ─────────────────────────────────────

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  description?: string;
}

interface NativeSearchResult {
  results: SearchResult[];
  totalCount: number;
}

function searchWithNative(query: string, config: Record<string, unknown>): Promise<NativeSearchResult | null> | undefined {
  const executable = process.env.EVERFERN_SHELL === 'tauri' && process.env.EF_NATIVE_EXE;
  if (!executable) return;
  return new Promise(resolve => {
    const child = execFile(executable, ['--ef-web-search'], {
      encoding: 'utf8', windowsHide: true, timeout: 40000, maxBuffer: 8 * 1024 * 1024,
    }, (error, output) => {
      if (error) return resolve(null);
      try {
        const response = JSON.parse(output);
        const results = response?.data?.results;
        if (!response?.success || !Array.isArray(results) || results.length === 0) return resolve(null);
        resolve({
          results: results.filter((item: any) => item && typeof item.url === 'string' && typeof item.title === 'string')
            .map((item: any) => ({ title: item.title, url: item.url, snippet: String(item.snippet || item.description || '') })),
          totalCount: Number(response.data.totalCount) || results.length,
        });
      } catch { resolve(null); }
    });
    child.stdin?.once('error', () => resolve(null));
    child.stdin?.end(JSON.stringify({ query, config }));
  });
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

async function fetchUrlMetadata(url: string): Promise<{ title?: string; description?: string }> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
      },
      signal: AbortSignal.timeout(3000)
    });

    if (!res.ok) return {};
    const html = await res.text();

    const getMeta = (prop: string) => {
      const regex = new RegExp(`<meta[^>]*?(?:name|property)=["']${prop}["'][^>]*?content=["'](.*?)["']`, 'i');
      const match = html.match(regex);
      if (match) return match[1];
      const altRegex = new RegExp(`<meta[^>]*?content=["'](.*?)["'][^>]*?(?:name|property)=["']${prop}["']`, 'i');
      const altMatch = html.match(altRegex);
      return altMatch ? altMatch[1] : null;
    };

    const cleanText = (text: string) => {
      if (!text) return '';
      return text
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
    };

    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = getMeta('og:title') || (titleMatch ? titleMatch[1] : '') || '';
    const description = getMeta('og:description') || getMeta('description') || '';

    return {
      title: cleanText(title) || undefined,
      description: cleanText(description) || undefined,
    };
  } catch {
    return {};
  }
}

async function enrichResults(results: SearchResult[]): Promise<SearchResult[]> {
  const promises = results.map(async (r) => {
    try {
      const meta = await fetchUrlMetadata(r.url);
      const title = meta.title || r.title;
      const desc = meta.description || r.snippet;
      return {
        ...r,
        title,
        snippet: desc,
        description: desc,
      };
    } catch {
      return {
        ...r,
        description: r.snippet,
      };
    }
  });
  return Promise.all(promises);
}

// ── Native Search app replay ─────────────────────────────────────────
// The worker desktop's Search app listens on 'worker:search': on 'start' its
// cursor clicks the search box and types the query, on 'result' the results
// page appears. Calls made from the app itself (_fromApp) skip the replay.

function broadcastSearch(payload: unknown, delayMs = 0): void {
  const send = () => {
    for (const win of BrowserWindow.getAllWindows()) {
      try { win.webContents.send('worker:search', payload); } catch { /* window closing */ }
    }
  };
  if (delayMs > 0) setTimeout(send, delayMs); else send();
}

let searchSeq = 0;
const nextSearchId = () => `s${Date.now().toString(36)}-${(searchSeq++).toString(36)}`;
/** How long the app takes to move, click and type the query. */
const typingMs = (query: string) => Math.min(5200, 1700 + Math.min(query.length, 120) * 30);
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Searches in flight, so the Search app's Stop button can end one at once. A stopped
 * search returns to its caller immediately; whatever the engine was still doing
 * is ignored (its requests time out on their own within seconds).
 */
const activeSearches = new Map<string, () => void>();
/** Stops one search (by id), or every search in flight when no id is given. Returns how many stopped. */
export function cancelWebSearch(id?: string): number {
  const ids = id ? [id] : [...activeSearches.keys()];
  let n = 0;
  for (const key of ids) { const stop = activeSearches.get(key); if (stop) { stop(); n++; } }
  return n;
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
      _narrative: {
        type: 'string',
        description: 'A single, high-polish active-voice sentence describing the search intent (e.g. "Gathering comprehensive information about global warming to build the PDF content.")',
      },
      taskName: {
        type: 'string',
        description: 'A clean human-friendly Title Case task group name (e.g. "Gathering Global Warming Research")',
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

    // Only agent runs (which stream events) are replayed; internal callers such
    // as deep research and the app's own searches are not.
    const replay = !args['_fromApp'] && typeof emitEvent === 'function';
    const askedId = typeof args['_searchId'] === 'string' && /^[\w-]{1,64}$/.test(args['_searchId'] as string) ? args['_searchId'] as string : '';
    const id = askedId || nextSearchId();
    const started = Date.now();
    let cancelled = false;
    const stopped = new Promise<ToolResult>((resolve) => {
      activeSearches.set(id, () => {
        cancelled = true;
        activeSearches.delete(id);
        if (replay) broadcastSearch({ id, type: 'cancelled', query });
        resolve({ success: false, output: `Search for "${query}" was stopped by the user. Do not retry it unless asked.`, error: 'cancelled' });
      });
    });
    if (replay) {
      emitEvent?.({
        type: 'subagent-progress',
        data: { type: 'action', workerApp: 'websearch', action: { type: 'ui', params: { app: 'websearch' }, description: `Searching ${query.slice(0, 60)}` } },
      });
      // A short delay gives the Search window time to open before the cursor starts.
      broadcastSearch({ id, type: 'start', query }, 250);
    }
    const finish = async (results: SearchResult[], error?: string) => {
      if (!replay || cancelled) return;
      const wait = typingMs(query) - (Date.now() - started);
      if (wait > 0) await pause(wait);
      if (cancelled) return;
      broadcastSearch({
        id,
        type: 'result',
        query,
        error,
        results: results.map((r) => ({ title: r.title, url: r.url, snippet: r.snippet })),
      });
    };

    const work = (async (): Promise<ToolResult> => { try {
      const config = toolSettingsStore.get().webSearch;
      let results: SearchResult[];
      let nativeEnriched = false;
      let totalCount: number | undefined;

      if (config.mode === 'local') {
        try {
          const pwResults = await playwrightWebSearch(query, config.headless);
          results = pwResults.map(r => ({ title: r.title, url: r.url, snippet: r.snippet }));
          if (results.length === 0) {
            const native = await searchWithNative(query, { mode: 'scrape' });
            if (native) {
              results = native.results;
              totalCount = native.totalCount;
              nativeEnriched = true;
            } else {
              results = await search(query);
            }
          }
        } catch (err) {
          console.log(`[WebSearch] Playwright failed, falling back to scraper: ${err instanceof Error ? err.message : String(err)}`);
          const native = await searchWithNative(query, { mode: 'scrape' });
          if (native) {
            results = native.results;
            totalCount = native.totalCount;
            nativeEnriched = true;
          } else {
            results = await search(query);
          }
        }
      } else if (config.mode === 'api') {
        const native = await searchWithNative(query, config as unknown as Record<string, unknown>);
        if (native) {
          results = native.results;
          totalCount = native.totalCount;
          nativeEnriched = true;
        } else {
          const provider = config.provider || 'exa';
          if (provider === 'firecrawl') {
          try {
            const key = config.firecrawlApiKey || config.apiKey;
            const fcResults = await firecrawlSearch(query, key);
            results = fcResults.map(r => ({ title: r.title, url: r.url, snippet: r.snippet }));
          } catch (err) {
            console.log(`[WebSearch] Firecrawl API search failed, falling back to scraper: ${err instanceof Error ? err.message : String(err)}`);
            results = await search(query);
          }
          } else {
            try {
              const key = config.exaApiKey || config.apiKey;
              const exaResults = await exaSearch(query, key);
              results = exaResults.map(r => ({ title: r.title, url: r.url, snippet: r.snippet }));
            } catch (err) {
              console.log(`[WebSearch] Exa API failed, falling back to scraper: ${err instanceof Error ? err.message : String(err)}`);
              results = await search(query);
            }
          }
        }
      } else {
        const native = await searchWithNative(query, { mode: 'scrape' });
        if (native) {
          results = native.results;
          totalCount = native.totalCount;
          nativeEnriched = true;
        } else {
          results = await search(query);
        }
      }

      if (results.length === 0) {
        await finish([]);
        return {
          success: true,
          output: `No results found for "${query}". Try rephrasing with different keywords or use navis to open relevant browser pages directly.`,
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

      // Enrich results with actual page titles and OG descriptions
      const enrichedResults = nativeEnriched ? truncatedResults : await enrichResults(truncatedResults);
      await finish(enrichedResults);

      const formatted = enrichedResults
        .map((r, i) => `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.snippet}`)
        .join('\n\n');

      return {
        success: true,
        output: `Found ${totalCount ?? results.length} result(s) for "${query}" (showing top ${enrichedResults.length}):\n\n${formatted}`,
        data: { query, results: enrichedResults, totalCount: totalCount ?? results.length },
      };
    } catch (err) {
      await finish([], err instanceof Error ? err.message : String(err));
      return {
        success: false,
        output: `Search failed: ${err instanceof Error ? err.message : String(err)}`,
        error: String(err),
      };
    } })();

    try { return await Promise.race([work, stopped]); }
    finally { activeSearches.delete(id); }
  },
};
