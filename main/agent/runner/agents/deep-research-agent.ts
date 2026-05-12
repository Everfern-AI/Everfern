/**
 * EverFern Desktop — Deep Research Agent
 *
 * A spawnable subagent that performs deep research on a topic:
 *   1. web_search  — find relevant URLs
 *   2. navis — deep-crawl each URL in parallel
 *   3. Synthesize  — compile findings into a structured report
 *
 * Can be spawned directly by the web-explorer node or by the brain
 * when it detects a research task that needs more than surface-level fetching.
 */

import { GraphStateType, StreamEvent } from '../state';
import { AgentRunner } from '../runner';
import { ToolDefinition } from '../../../lib/ai-client';
import { runAgentStep } from '../services/agent-runtime';
import type { MissionTracker } from '../mission-tracker';
import { createMissionIntegrator } from '../mission-integrator';
import { fernCrawlScrape, isFernCrawlAvailable } from '../../tools/fern-crawl';
import { webSearchTool } from '../../tools/web-search';
import { HumanMessage } from '@langchain/core/messages';

// ── Types ─────────────────────────────────────────────────────────────────

export interface DeepResearchOptions {
  query: string;
  maxUrls?: number;       // how many URLs to deep-crawl (default: 5)
  maxPagesPerUrl?: number; // Crawl4AI deep-crawl depth per URL (default: 3)
  maxLengthPerPage?: number; // chars per page (default: 6000)
}

export interface DeepResearchResult {
  query: string;
  sources: Array<{
    url: string;
    title?: string;
    content: string;
    engine: 'fern-crawl' | 'fallback';
  }>;
  synthesis?: string;
  success: boolean;
  error?: string;
}

// ── Core deep-research function (usable standalone) ──────────────────────

/**
 * Perform deep research on a query:
 * 1. Search for URLs
 * 2. Crawl each URL with Crawl4AI (or fallback)
 * 3. Return structured results ready for synthesis
 */
export async function deepResearch(
  options: DeepResearchOptions,
  onProgress?: (msg: string) => void
): Promise<DeepResearchResult> {
  const {
    query,
    maxUrls = 5,
    maxPagesPerUrl = 1,
    maxLengthPerPage = 6000,
  } = options;

  onProgress?.(`🔍 Searching: "${query}"`);

  // Step 1: Web search
  let searchUrls: string[] = [];
  try {
    const searchResult = await webSearchTool.execute({ query }, onProgress);
    if (searchResult.success && searchResult.output) {
      // Extract URLs from search output
      const urlMatches = searchResult.output.match(/https?:\/\/[^\s"'<>)]+/g) ?? [];
      searchUrls = [...new Set(urlMatches)].slice(0, maxUrls);
    }
  } catch (err) {
    return {
      query,
      sources: [],
      success: false,
      error: `Search failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (searchUrls.length === 0) {
    return { query, sources: [], success: false, error: 'No URLs found in search results' };
  }

  onProgress?.(`🕷️ Deep-crawling ${searchUrls.length} URL(s) in parallel...`);

  const fernCrawlUp = await isFernCrawlAvailable();

  // Step 2: Parallel crawl of all URLs
  const crawlPromises = searchUrls.map(async (url): Promise<DeepResearchResult['sources'][0]> => {
    if (fernCrawlUp) {
      const result = await fernCrawlScrape(url, { researchQuery: query });
      if (result.success && result.markdown.trim().length > 50) {
        const content = result.markdown.length > maxLengthPerPage
          ? result.markdown.slice(0, maxLengthPerPage) + '\n\n...(truncated)'
          : result.markdown;
        onProgress?.(`  ✅ FernCrawl: ${url}`);
        return { url, title: result.title, content, engine: 'fern-crawl' };
      }
    }

    // Fallback: plain HTTP fetch + basic HTML strip
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'EverFern Desktop/1.0' },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      let text = html
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gmi, '')
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gmi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (text.length > maxLengthPerPage) text = text.slice(0, maxLengthPerPage) + '\n\n...(truncated)';
      onProgress?.(`  ✅ Fetched (fallback): ${url}`);
      return { url, content: text, engine: 'fallback' };
    } catch (err) {
      onProgress?.(`  ⚠️ Failed: ${url}`);
      return { url, content: '', engine: 'fallback' };
    }
  });

  const sources = (await Promise.all(crawlPromises)).filter(s => s.content.trim().length > 0);

  return { query, sources, success: sources.length > 0 };
}

// ── Agent node factory ────────────────────────────────────────────────────

/**
 * Creates a LangGraph-compatible deep research node.
 * The node runs a full deep-research cycle and appends the findings
 * as a tool message so the brain can synthesize them.
 */
export const createDeepResearchNode = (
  runner: AgentRunner,
  eventQueue?: StreamEvent[],
  missionTracker?: MissionTracker,
  toolDefs?: ToolDefinition[]
) => {
  const integrator = createMissionIntegrator(missionTracker);

  return async (state: GraphStateType): Promise<Partial<GraphStateType>> => {
    const tools = toolDefs || (runner as any)._buildToolDefinitions();

    // Extract the research query from the last user message
    const lastUserMsg = state.messages?.filter((m: any) => {
      const role = m.role || m._getType?.();
      return role === 'user' || role === 'human';
    }).pop();
    const query = lastUserMsg
      ? (typeof (lastUserMsg as any).content === 'string'
          ? (lastUserMsg as any).content
          : JSON.stringify((lastUserMsg as any).content))
      : '';

    eventQueue?.push({ type: 'thought', content: `\n🔬 Deep Research Agent: Starting deep research on "${query.slice(0, 80)}..."` });

    return integrator.wrapNode(
      'deep_research',
      async () => {
        const result = await deepResearch(
          { query, maxUrls: 5, maxPagesPerUrl: 1, maxLengthPerPage: 6000 },
          (msg) => {
            eventQueue?.push({ type: 'thought', content: msg });
            runner.telemetry.info(msg);
          }
        );

        if (!result.success || result.sources.length === 0) {
          eventQueue?.push({ type: 'thought', content: '⚠️ Deep Research: No content retrieved, falling back to standard web explorer.' });
          // Fall back to standard web explorer behaviour
          const systemPrompt = `You are the EverFern Web Explorer performing deep research.
The automated deep-crawl returned no results. Use web_search and navis tools directly to research: "${query}"
Synthesize findings into a comprehensive answer with source citations.`;
          return runAgentStep(state, { runner, toolDefs: tools, eventQueue, nodeName: 'deep_research', systemPromptOverride: systemPrompt })
            .then(res => ({ ...res, returningFromSpecialist: 'deep_research' }));
        }

        // Build a rich context message from crawled sources
        const sourceSections = result.sources.map((s, i) =>
          `### Source ${i + 1}: ${s.title ?? s.url}\n**URL:** ${s.url}\n**Engine:** ${s.engine}\n\n${s.content}`
        ).join('\n\n---\n\n');

        const researchContext = `## Deep Research Results for: "${query}"\n\n${sourceSections}`;

        eventQueue?.push({ type: 'thought', content: `✅ Deep Research: Crawled ${result.sources.length} source(s). Synthesizing...` });

        // Inject the crawled content as a HumanMessage so the model can synthesize it.
        // We use HumanMessage (not ToolMessage) to avoid the tool_call_id requirement.
        const enrichedMessages = [
          ...(state.messages ?? []),
          new HumanMessage(`[DEEP RESEARCH RESULTS]\n\n${researchContext}\n\n[END DEEP RESEARCH RESULTS]\n\nPlease synthesize the above research findings into a comprehensive answer.`),
        ];

        const synthesisPrompt = `You are the EverFern Research Synthesizer.

You have been given deep-crawled content from ${result.sources.length} web source(s) above (in the tool message).

Your task:
1. Read all the source content carefully
2. Synthesize the key findings into a comprehensive, well-structured answer
3. Include inline citations: [Source Title](URL)
4. Highlight the most relevant and actionable information
5. Note any conflicting information across sources

DO NOT call any more tools. Synthesize the provided content directly into your response.`;

        return runAgentStep(
          { ...state, messages: enrichedMessages },
          {
            runner,
            toolDefs: tools,
            eventQueue,
            nodeName: 'deep_research',
            systemPromptOverride: synthesisPrompt,
          }
        ).then(res => ({ ...res, returningFromSpecialist: 'deep_research' }));
      },
      `Deep research: ${query.slice(0, 60)}`
    ).then(res => ({ ...res, returningFromSpecialist: 'deep_research' }));

  };
};
