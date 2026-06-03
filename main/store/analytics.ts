/**
 * EverFern Analytics Store
 *
 * Tracks token usage, costs, and model statistics.
 * Fetches live pricing from OpenRouter API.
 */

import { dbOps } from '../lib/db';
import * as https from 'https';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

const PRICING_CACHE_PATH = path.join(os.homedir(), '.everfern', 'pricing-cache.json');
const PRICING_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const DEFAULT_CONTEXT_WINDOW = 150000;

// In-memory pricing cache for fast lookups
let pricingCache: Record<string, { inputCostPer1M: number; outputCostPer1M: number; contextWindow: number; displayName: string; provider: string }> = {};
let lastPricingFetch = 0;

/**
 * Fetch model pricing from OpenRouter API
 */
async function fetchOpenRouterPricing(): Promise<void> {
  return new Promise((resolve) => {
    const req = https.get('https://openrouter.ai/api/v1/models', {
      headers: { 'User-Agent': 'EverFern/1.0' },
      timeout: 10000
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', async () => {
        try {
          const parsed = JSON.parse(data);
          const models: any[] = parsed.data || [];

          const newCache: typeof pricingCache = {};
          for (const m of models) {
            if (!m.id) continue;
            const pricing = m.pricing || {};
            // OpenRouter returns cost per token, multiply by 1M for per-1M-token rate
            const inputCostPer1M = parseFloat(pricing.prompt || '0') * 1_000_000;
            const outputCostPer1M = parseFloat(pricing.completion || '0') * 1_000_000;
            newCache[m.id] = {
              inputCostPer1M,
              outputCostPer1M,
              contextWindow: m.context_length || DEFAULT_CONTEXT_WINDOW,
              displayName: m.name || m.id,
              provider: (m.id.split('/')[0]) || 'unknown'
            };

            // Persist to SQLite cache
            try {
              await dbOps.run(
                `INSERT OR REPLACE INTO model_pricing_cache
                 (model_id, provider, display_name, input_cost_per_1m, output_cost_per_1m, context_window, last_fetched_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [m.id, newCache[m.id].provider, newCache[m.id].displayName,
                 inputCostPer1M, outputCostPer1M, newCache[m.id].contextWindow,
                 new Date().toISOString()]
              );
            } catch { /* DB might not be ready */ }
          }

          pricingCache = newCache;
          lastPricingFetch = Date.now();

          // Persist to file cache as fallback
          try {
            fs.writeFileSync(PRICING_CACHE_PATH, JSON.stringify({ ts: lastPricingFetch, cache: pricingCache }));
          } catch { }

          console.log(`[Analytics] Fetched pricing for ${models.length} models from OpenRouter`);
        } catch (err) {
          console.warn('[Analytics] Failed to parse OpenRouter pricing:', err);
        }
        resolve();
      });
    });

    req.on('error', (err) => {
      console.warn('[Analytics] Failed to fetch OpenRouter pricing:', err.message);
      resolve();
    });

    req.on('timeout', () => {
      req.destroy();
      resolve();
    });
  });
}

/**
 * Load pricing cache from file or SQLite
 */
async function loadPricingCache(): Promise<void> {
  // Try file cache first (fast)
  try {
    if (fs.existsSync(PRICING_CACHE_PATH)) {
      const raw = JSON.parse(fs.readFileSync(PRICING_CACHE_PATH, 'utf-8'));
      if (raw.cache && raw.ts) {
        pricingCache = raw.cache;
        lastPricingFetch = raw.ts;
        return;
      }
    }
  } catch { }

  // Fall back to SQLite
  try {
    const rows = await dbOps.all('SELECT * FROM model_pricing_cache');
    for (const row of rows) {
      pricingCache[row.model_id] = {
        inputCostPer1M: row.input_cost_per_1m,
        outputCostPer1M: row.output_cost_per_1m,
        contextWindow: row.context_window || DEFAULT_CONTEXT_WINDOW,
        displayName: row.display_name || row.model_id,
        provider: row.provider
      };
    }
  } catch { }
}

/**
 * Ensure pricing cache is up to date
 */
export async function ensurePricingFresh(): Promise<void> {
  if (Object.keys(pricingCache).length === 0) {
    await loadPricingCache();
  }
  if (Date.now() - lastPricingFetch > PRICING_REFRESH_INTERVAL_MS || Object.keys(pricingCache).length === 0) {
    // If cache is completely empty, await — otherwise refresh in background
    if (Object.keys(pricingCache).length === 0) {
      await fetchOpenRouterPricing();
    } else {
      fetchOpenRouterPricing().catch(() => { });
    }
  }
}

/**
 * Get pricing for a model
 */
export function getModelPricing(modelId: string): { inputCostPer1M: number; outputCostPer1M: number; contextWindow: number } {
  // Exact match
  if (pricingCache[modelId]) return pricingCache[modelId];

  // Fuzzy match — try to find a model that contains the model ID
  const lowerModelId = modelId.toLowerCase();
  for (const [key, val] of Object.entries(pricingCache)) {
    if (key.toLowerCase().includes(lowerModelId) || lowerModelId.includes(key.toLowerCase().split('/').pop() || '')) {
      return val;
    }
  }

  return { inputCostPer1M: 0, outputCostPer1M: 0, contextWindow: DEFAULT_CONTEXT_WINDOW };
}

/**
 * Record a usage event (token usage + cost)
 */
export async function recordUsage(params: {
  conversationId?: string;
  model: string;
  provider: string;
  promptTokens: number;
  completionTokens: number;
}): Promise<void> {
  await ensurePricingFresh();

  const { conversationId, model, provider, promptTokens, completionTokens } = params;
  const totalTokens = promptTokens + completionTokens;

  const pricing = getModelPricing(model);
  const inputCost = (promptTokens / 1_000_000) * pricing.inputCostPer1M;
  const outputCost = (completionTokens / 1_000_000) * pricing.outputCostPer1M;
  const totalCost = inputCost + outputCost;

  const id = `usage-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

  try {
    await dbOps.run(
      `INSERT OR IGNORE INTO usage_events
       (id, conversation_id, model, provider, prompt_tokens, completion_tokens, total_tokens,
        input_cost_usd, output_cost_usd, total_cost_usd, context_window, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, conversationId || null, model, provider, promptTokens, completionTokens, totalTokens,
       inputCost, outputCost, totalCost, pricing.contextWindow, new Date().toISOString()]
    );
  } catch (err) {
    console.error('[Analytics] Failed to record usage:', err);
  }
}

/**
 * Get analytics summary data
 */
export async function getAnalyticsSummary(): Promise<{
  totalCost: number;
  totalTokens: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalRequests: number;
  avgCostPerRequest: number;
  topModels: Array<{ model: string; provider: string; requests: number; tokens: number; cost: number }>;
  topProviders: Array<{ provider: string; requests: number; tokens: number; cost: number }>;
  dailyUsage: Array<{ date: string; tokens: number; cost: number; requests: number }>;
  monthlyUsage: Array<{ month: string; tokens: number; cost: number; requests: number }>;
  hourlyUsage: Array<{ hour: number; tokens: number; requests: number }>;
}> {
  try {
    // Overall totals
    const totals = await dbOps.get(`
      SELECT
        COALESCE(SUM(total_cost_usd), 0) as totalCost,
        COALESCE(SUM(total_tokens), 0) as totalTokens,
        COALESCE(SUM(prompt_tokens), 0) as totalPromptTokens,
        COALESCE(SUM(completion_tokens), 0) as totalCompletionTokens,
        COUNT(*) as totalRequests
      FROM usage_events
    `);

    // Top models
    const topModels = await dbOps.all(`
      SELECT model, provider,
             COUNT(*) as requests,
             SUM(total_tokens) as tokens,
             SUM(total_cost_usd) as cost
      FROM usage_events
      GROUP BY model
      ORDER BY cost DESC
      LIMIT 10
    `);

    // Top providers
    const topProviders = await dbOps.all(`
      SELECT provider,
             COUNT(*) as requests,
             SUM(total_tokens) as tokens,
             SUM(total_cost_usd) as cost
      FROM usage_events
      GROUP BY provider
      ORDER BY cost DESC
    `);

    // Daily usage (last 30 days)
    const dailyUsage = await dbOps.all(`
      SELECT
        DATE(created_at) as date,
        SUM(total_tokens) as tokens,
        SUM(total_cost_usd) as cost,
        COUNT(*) as requests
      FROM usage_events
      WHERE created_at >= DATE('now', '-30 days')
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `);

    // Monthly usage (last 12 months)
    const monthlyUsage = await dbOps.all(`
      SELECT
        strftime('%Y-%m', created_at) as month,
        SUM(total_tokens) as tokens,
        SUM(total_cost_usd) as cost,
        COUNT(*) as requests
      FROM usage_events
      WHERE created_at >= DATE('now', '-365 days')
      GROUP BY strftime('%Y-%m', created_at)
      ORDER BY month ASC
    `);

    // Hourly usage pattern
    const hourlyUsage = await dbOps.all(`
      SELECT
        CAST(strftime('%H', created_at) AS INTEGER) as hour,
        SUM(total_tokens) as tokens,
        COUNT(*) as requests
      FROM usage_events
      GROUP BY strftime('%H', created_at)
      ORDER BY hour ASC
    `);

    const totalCost = totals?.totalCost || 0;
    const totalRequests = totals?.totalRequests || 0;

    return {
      totalCost,
      totalTokens: totals?.totalTokens || 0,
      totalPromptTokens: totals?.totalPromptTokens || 0,
      totalCompletionTokens: totals?.totalCompletionTokens || 0,
      totalRequests,
      avgCostPerRequest: totalRequests > 0 ? totalCost / totalRequests : 0,
      topModels: topModels.map(r => ({ model: r.model, provider: r.provider, requests: r.requests, tokens: r.tokens, cost: r.cost })),
      topProviders: topProviders.map(r => ({ provider: r.provider, requests: r.requests, tokens: r.tokens, cost: r.cost })),
      dailyUsage: dailyUsage.map(r => ({ date: r.date, tokens: r.tokens, cost: r.cost, requests: r.requests })),
      monthlyUsage: monthlyUsage.map(r => ({ month: r.month, tokens: r.tokens, cost: r.cost, requests: r.requests })),
      hourlyUsage: hourlyUsage.map(r => ({ hour: r.hour, tokens: r.tokens, requests: r.requests }))
    };
  } catch (err) {
    console.error('[Analytics] Failed to get summary:', err);
    return {
      totalCost: 0,
      totalTokens: 0,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalRequests: 0,
      avgCostPerRequest: 0,
      topModels: [],
      topProviders: [],
      dailyUsage: [],
      monthlyUsage: [],
      hourlyUsage: []
    };
  }
}

/**
 * Get all available model pricing data
 */
export async function getModelPricingList(): Promise<Array<{
  modelId: string;
  provider: string;
  displayName: string;
  inputCostPer1M: number;
  outputCostPer1M: number;
  contextWindow: number;
}>> {
  await ensurePricingFresh();
  return Object.entries(pricingCache).map(([modelId, data]) => ({
    modelId,
    provider: data.provider,
    displayName: data.displayName,
    inputCostPer1M: data.inputCostPer1M,
    outputCostPer1M: data.outputCostPer1M,
    contextWindow: data.contextWindow
  }));
}

// Initialize pricing cache on module load
ensurePricingFresh().catch(() => { });
