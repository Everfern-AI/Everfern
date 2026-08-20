interface FirecrawlRequest {
  url: string;
  formats: ['markdown'];
}

interface FirecrawlResponse {
  success: boolean;
  data: {
    markdown: string;
  };
}

export async function firecrawlCrawl(
  url: string,
  apiKey: string
): Promise<string> {
  if (!apiKey || !apiKey.trim()) {
    throw new Error('Firecrawl API key is required');
  }

  const body: FirecrawlRequest = { url, formats: ['markdown'] };

  const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(
      `Firecrawl API error: ${response.status} ${response.statusText}`
    );
  }

  const data = (await response.json()) as FirecrawlResponse;
  return data.data.markdown;
}

export interface FirecrawlSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export async function firecrawlSearch(
  query: string,
  apiKey: string
): Promise<FirecrawlSearchResult[]> {
  if (!apiKey || !apiKey.trim()) {
    throw new Error('Firecrawl API key is required');
  }

  const response = await fetch('https://api.firecrawl.dev/v1/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query,
      limit: 8,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Firecrawl API error: ${response.status} ${response.statusText}`
    );
  }

  const json: any = await response.json();
  const results = json?.data || [];
  return results.map((r: any) => ({
    title: r.title || r.metadata?.title || query,
    url: r.url || r.metadata?.sourceURL || '',
    snippet: r.description || r.markdown || r.snippet || '',
  })).filter((r: any) => r.url);
}
