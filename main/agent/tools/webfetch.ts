/**
 * EverFern Desktop — Web Fetch Tool
 *
 * Fetches a URL and returns its content as readable text.
 * Uses cheerio for HTML parsing and converts to clean markdown-like text.
 */

import type { AgentTool, ToolResult } from '../runner/types';

// ── HTML to Text Conversion ──────────────────────────────────────────

function htmlToText(html: string): string {
  let text = html;

  // Remove script and style tags
  text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<noscript[\s\S]*?<\/noscript>/gi, '');

  // Remove comments
  text = text.replace(/<!--[\s\S]*?-->/g, '');

  // Convert block elements to newlines
  text = text.replace(/<(br|hr)\s*\/?>/gi, '\n');
  text = text.replace(/<\/(p|div|h[1-6]|li|tr|blockquote|pre|section|article|header|footer|nav|aside)>/gi, '\n');
  text = text.replace(/<(p|div|h[1-6]|li|tr|blockquote|pre|section|article|header|footer|nav|aside)[^>]*>/gi, '\n');

  // Convert links to readable format
  text = text.replace(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, '$2 ($1)');

  // Convert images to alt text
  text = text.replace(/<img[^>]*alt=["']([^"']*)["'][^>]*>/gi, '[$1]');
  text = text.replace(/<img[^>]*>/gi, '[image]');

  // Convert lists
  text = text.replace(/<li[^>]*>/gi, '- ');

  // Remove all remaining HTML tags
  text = text.replace(/<[^>]+>/g, '');

  // Decode HTML entities
  text = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

  // Clean up whitespace
  text = text
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n/g, '\n\n')
    .split('\n')
    .map(line => line.trim())
    .join('\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '');

  return text;
}

function extractTitle(html: string): string | undefined {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? match[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim() : undefined;
}

function extractMetadata(html: string): Record<string, string> {
  const meta: Record<string, string> = {};

  const getMeta = (prop: string) => {
    const regex = new RegExp(`<meta[^>]*?(?:name|property)=["']${prop}["'][^>]*?content=["'](.*?)["']`, 'i');
    const match = html.match(regex);
    if (match) return match[1];
    const altRegex = new RegExp(`<meta[^>]*?content=["'](.*?)["'][^>]*?(?:name|property)=["']${prop}["']`, 'i');
    const altMatch = html.match(altRegex);
    return altMatch ? altMatch[1] : null;
  };

  const description = getMeta('description') || getMeta('og:description');
  if (description) meta.description = description.replace(/&amp;/g, '&').trim();

  const author = getMeta('author');
  if (author) meta.author = author.replace(/&amp;/g, '&').trim();

  const keywords = getMeta('keywords');
  if (keywords) meta.keywords = keywords.replace(/&amp;/g, '&').trim();

  return meta;
}

async function fetchWithCurl(targetUrl: string): Promise<{ text: string; contentType: string } | null> {
  try {
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const execFileAsync = promisify(execFile);
    const { stdout } = await execFileAsync('curl.exe', [
      '-sSL',
      '-A', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      '--max-time', '20',
      targetUrl,
    ], { maxBuffer: 10 * 1024 * 1024 });

    if (!stdout || stdout.trim().length === 0) return null;
    return { text: stdout, contentType: 'text/html' };
  } catch {
    return null;
  }
}

// ── Tool Definition ──────────────────────────────────────────────────

export const webFetchTool: AgentTool = {
  name: 'web_fetch',
  description:
    'Fetches a URL and returns its content as readable text. ' +
    'Use this to read the content of a specific web page, article, documentation, or any URL. ' +
    'Returns the page title, metadata, and full text content. ' +
    'For search queries, use web_search instead.',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The URL to fetch (e.g., "https://example.com/article", "https://docs.example.com/api")',
      },
    },
    required: ['url'],
  },

  async execute(
    args: Record<string, unknown>,
    onUpdate?: (msg: string) => void,
    emitEvent?: (event: any) => void,
    toolCallId?: string,
  ): Promise<ToolResult> {
    const anyArgs = args as any;
    let rawUrl = '';
    if (typeof anyArgs === 'string') {
      rawUrl = anyArgs.trim();
    } else if (anyArgs && typeof anyArgs === 'object') {
      rawUrl = String(
        anyArgs['url'] ??
        anyArgs['Url'] ??
        anyArgs['URL'] ??
        anyArgs['targetUrl'] ??
        anyArgs['target_url'] ??
        anyArgs['link'] ??
        anyArgs['uri'] ??
        anyArgs['href'] ??
        anyArgs['endpoint'] ??
        ''
      ).trim();
    }

    // Strip wrapping quotes, markdown brackets, angle brackets or backticks
    rawUrl = rawUrl.replace(/^["'`<\[]+|["'`>\]]+$/g, '').trim();

    if (!rawUrl) {
      return {
        success: false,
        output: 'Error: URL parameter is missing. Provide a valid URL like https://example.com',
        error: 'missing_url',
      };
    }

    // Normalize URL
    let url = rawUrl;
    if (!/^https?:\/\//i.test(url)) {
      url = `https://${url}`;
    }

    // Validate URL
    try {
      new URL(url);
    } catch {
      return {
        success: false,
        output: `Error: Invalid URL "${rawUrl}". Provide a valid URL like https://example.com`,
        error: 'invalid_url',
      };
    }

    onUpdate?.(`Fetching ${url}...`);

    let html = '';
    let contentType = '';

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);

      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Sec-Ch-Ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
          'Sec-Ch-Ua-Mobile': '?0',
          'Sec-Ch-Ua-Platform': '"Windows"',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1',
          'Upgrade-Insecure-Requests': '1',
        },
        signal: controller.signal,
        redirect: 'follow',
      });

      clearTimeout(timeout);

      if (!response.ok) {
        // Fallback to curl if HTTP error (like 403 Forbidden from bot mitigation)
        const curlRes = await fetchWithCurl(url);
        if (curlRes && curlRes.text) {
          html = curlRes.text;
          contentType = curlRes.contentType;
        } else {
          return {
            success: false,
            output: `Error: HTTP ${response.status} ${response.statusText} when fetching ${url}`,
            error: `http_${response.status}`,
          };
        }
      } else {
        contentType = response.headers.get('content-type') || '';
        html = await response.text();
      }
    } catch (fetchErr) {
      // Fallback to curl on network error or abort
      const curlRes = await fetchWithCurl(url);
      if (curlRes && curlRes.text) {
        html = curlRes.text;
        contentType = curlRes.contentType;
      } else {
        const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
        if (msg.includes('abort') || msg.includes('timeout')) {
          return {
            success: false,
            output: `Error: Request to ${url} timed out after 20 seconds.`,
            error: 'timeout',
          };
        }
        return {
          success: false,
          output: `Error fetching ${url}: ${msg}`,
          error: msg,
        };
      }
    }

      // Extract metadata
      const title = extractTitle(html);
      const metadata = extractMetadata(html);

      // Convert to text (or format JSON)
      let text = '';
      const isJson = Boolean(contentType && contentType.includes('application/json')) ||
        (html.trim().startsWith('{') && html.trim().endsWith('}')) ||
        (html.trim().startsWith('[') && html.trim().endsWith(']'));
      if (isJson) {
        try {
          const parsed = JSON.parse(html);
          text = JSON.stringify(parsed, null, 2);
        } catch {
          text = html;
        }
      } else {
        text = htmlToText(html);
      }

      // Truncate if too long (max ~100k chars for AI context)
      const maxChars = 100000;
      let truncated = false;
      if (text.length > maxChars) {
        text = text.slice(0, maxChars);
        truncated = true;
      }

      // Build output
      const outputParts: string[] = [];

      if (title) {
        outputParts.push(`# ${title}`);
      }

      const metaEntries = Object.entries(metadata);
      if (metaEntries.length > 0) {
        outputParts.push(metaEntries.map(([k, v]) => `**${k}**: ${v}`).join('\n'));
      }

      outputParts.push(`**URL**: ${url}`);
      outputParts.push(`**Content-Type**: ${contentType}`);
      outputParts.push('');
      outputParts.push(text);

      if (truncated) {
        outputParts.push('\n\n[Content truncated — page exceeded 100k characters]');
      }

      const output = outputParts.join('\n');

      // Emit event for frontend rendering
      emitEvent?.({
        type: 'web_fetch',
        url,
        title,
        metadata,
        contentLength: text.length,
        truncated,
      });

      return {
        success: true,
        output,
        data: {
          url,
          title,
          metadata,
          contentLength: text.length,
          truncated,
          contentType,
        },
      };
  },
};
