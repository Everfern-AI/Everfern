"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDeepResearchNode = void 0;
exports.deepResearch = deepResearch;
const agent_runtime_1 = require("../services/agent-runtime");
const mission_integrator_1 = require("../mission-integrator");
const fern_crawl_1 = require("../../tools/fern-crawl");
const web_search_1 = require("../../tools/web-search");
const messages_1 = require("@langchain/core/messages");
// ── Core deep-research function (usable standalone) ──────────────────────
/**
 * Perform deep research on a query:
 * 1. Search for URLs
 * 2. Crawl each URL with Crawl4AI (or fallback)
 * 3. Return structured results ready for synthesis
 */
async function deepResearch(options, onProgress) {
    const { query, maxUrls = 5, maxPagesPerUrl = 1, maxLengthPerPage = 6000, } = options;
    onProgress?.(`🔍 Searching: "${query}"`);
    // Step 1: Web search
    let searchUrls = [];
    try {
        const searchResult = await web_search_1.webSearchTool.execute({ query }, onProgress);
        if (searchResult.success && searchResult.output) {
            // Extract URLs from search output
            const urlMatches = searchResult.output.match(/https?:\/\/[^\s"'<>)]+/g) ?? [];
            searchUrls = [...new Set(urlMatches)].slice(0, maxUrls);
        }
    }
    catch (err) {
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
    const fernCrawlUp = await (0, fern_crawl_1.isFernCrawlAvailable)();
    // Step 2: Parallel crawl of all URLs
    const crawlPromises = searchUrls.map(async (url) => {
        if (fernCrawlUp) {
            const result = await (0, fern_crawl_1.fernCrawlScrape)(url, { researchQuery: query });
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
            if (!res.ok)
                throw new Error(`HTTP ${res.status}`);
            const html = await res.text();
            let text = html
                .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gmi, '')
                .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gmi, '')
                .replace(/<[^>]+>/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            if (text.length > maxLengthPerPage)
                text = text.slice(0, maxLengthPerPage) + '\n\n...(truncated)';
            onProgress?.(`  ✅ Fetched (fallback): ${url}`);
            return { url, content: text, engine: 'fallback' };
        }
        catch (err) {
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
const createDeepResearchNode = (runner, eventQueue, missionTracker, toolDefs) => {
    const integrator = (0, mission_integrator_1.createMissionIntegrator)(missionTracker);
    return async (state) => {
        const tools = toolDefs || runner._buildToolDefinitions();
        const loopCount = (state.deepResearchSelfLoopCount || 0) + 1;
        // Loop protection
        if (loopCount > 3) {
            eventQueue?.push({ type: 'thought', content: '⚠️ Deep Research: Maximum research iterations reached, returning to brain.' });
            return { deepResearchComplete: true, deepResearchSelfLoopCount: loopCount, returningFromSpecialist: 'deep_research' };
        }
        // Extract the research query from the last user message
        const lastUserMsg = state.messages?.filter((m) => {
            const role = m.role || m._getType?.();
            return role === 'user' || role === 'human';
        }).pop();
        const query = lastUserMsg
            ? (typeof lastUserMsg.content === 'string'
                ? lastUserMsg.content
                : JSON.stringify(lastUserMsg.content))
            : '';
        eventQueue?.push({ type: 'thought', content: `\n🔬 Deep Research Agent [Iteration ${loopCount}/3]: Starting deep research on "${query.slice(0, 80)}..."` });
        return integrator.wrapNode('deep_research', async () => {
            const result = await deepResearch({ query, maxUrls: 5, maxPagesPerUrl: 1, maxLengthPerPage: 6000 }, (msg) => {
                eventQueue?.push({ type: 'thought', content: msg });
                runner.telemetry.info(msg);
            });
            if (!result.success || result.sources.length === 0) {
                eventQueue?.push({ type: 'thought', content: '⚠️ Deep Research: No content retrieved, falling back to standard web explorer.' });
                // Fall back to standard web explorer behaviour
                const systemPrompt = `You are the EverFern Web Explorer performing deep research.
The automated deep-crawl returned no results. Use web_search and navis tools directly to research: "${query}"
Synthesize findings into a comprehensive answer with source citations.`;
                return (0, agent_runtime_1.runAgentStep)(state, { runner, toolDefs: tools, eventQueue, nodeName: 'deep_research', systemPromptOverride: systemPrompt })
                    .then(res => ({ ...res, returningFromSpecialist: 'deep_research', deepResearchSelfLoopCount: loopCount }));
            }
            // Build a rich context message from crawled sources
            const sourceSections = result.sources.map((s, i) => `### Source ${i + 1}: ${s.title ?? s.url}\n**URL:** ${s.url}\n**Engine:** ${s.engine}\n\n${s.content}`).join('\n\n---\n\n');
            const researchContext = `## Deep Research Results for: "${query}"\n\n${sourceSections}`;
            eventQueue?.push({ type: 'thought', content: `✅ Deep Research: Crawled ${result.sources.length} source(s). Synthesizing...` });
            // Inject the crawled content as a HumanMessage so the model can synthesize it.
            // We use HumanMessage (not ToolMessage) to avoid the tool_call_id requirement.
            const enrichedMessages = [
                ...(state.messages ?? []),
                new messages_1.HumanMessage(`[DEEP RESEARCH RESULTS]\n\n${researchContext}\n\n[END DEEP RESEARCH RESULTS]\n\nPlease synthesize the above research findings into a comprehensive answer.`),
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
            return (0, agent_runtime_1.runAgentStep)({ ...state, messages: enrichedMessages }, {
                runner,
                toolDefs: tools,
                eventQueue,
                nodeName: 'deep_research',
                systemPromptOverride: synthesisPrompt,
            }).then(res => ({ ...res, returningFromSpecialist: null, deepResearchComplete: true, deepResearchSelfLoopCount: loopCount }));
        }, `Deep research: ${query.slice(0, 60)}`).then(res => ({ ...res, returningFromSpecialist: null, deepResearchSelfLoopCount: loopCount }));
    };
};
exports.createDeepResearchNode = createDeepResearchNode;
