import { GraphStateType, StreamEvent } from '../state';
import { AgentRunner } from '../runner';
import { ToolDefinition } from '../../../lib/ai-client';
import { runAgentStep } from '../services/agent-runtime';
import type { MissionTracker } from '../mission-tracker';
import { createMissionIntegrator } from '../mission-integrator';
import { loadPrompt } from '../../../lib/prompt-sync';

export const createWebExplorerNode = (
  runner: AgentRunner,
  eventQueue?: StreamEvent[],
  missionTracker?: MissionTracker,
  toolDefs?: ToolDefinition[]
) => {
  const integrator = createMissionIntegrator(missionTracker);

  return async (state: GraphStateType): Promise<Partial<GraphStateType>> => {
    const allTools = toolDefs || (runner as any)._buildToolDefinitions();
    const messages = state.messages || [];

    const searchInvoked = state.searchInvoked || false;
    const navisInvoked = state.navisInvoked || false;

    // ─── DIRECT URL NAVIGATION ───────────────────────────────────────────
    // If the user provided a specific URL (skip research workflow entirely)
    const directUrl = !searchInvoked && !navisInvoked ? extractDirectUrl(messages) : null;

    if (directUrl) {
      eventQueue?.push({ type: 'thought', content: `\n🌐 WEB EXPLORER: Navigating directly to ${directUrl}...` });
      const result = await integrator.wrapNode('web_explorer', () => runAgentStep(state, {
        runner,
        toolDefs: allTools,
        eventQueue,
        nodeName: 'web_explorer',
        systemPromptOverride: (loadPrompt('web-explorer.md') || '') +
          `\n\nDIRECT URL NAVIGATION. The user wants you to go to: ${directUrl}` +
          '\nUse navis to navigate to this URL. Do NOT call web_search — the URL is already provided.' +
          '\nLook for login buttons, forms, or dashboard links and interact with them.' +
          '\nReport what you see and what actions are available on the page.'
      }), 'Web Explorer: Direct Navigation');
      return {
        ...result,
        webExplorerComplete: false,
        navisInvoked: true,
        returningFromSpecialist: 'web_explorer'
      };
    }

    // ─── PHASE 1: SEARCH & DISCOVER ──────────────────────────────────────
    // Use web_search to find the top sources
    if (!searchInvoked && !navisInvoked) {
      eventQueue?.push({ type: 'thought', content: '\n🔍 WEB EXPLORER [Phase 1/3]: Searching for authoritative sources...' });
      const result = await integrator.wrapNode('web_explorer', () => runAgentStep(state, {
        runner,
        toolDefs: allTools,
        eventQueue,
        nodeName: 'web_explorer',
        systemPromptOverride: (loadPrompt('web-explorer.md') || '') +
          '\n\nPHASE: SEARCH. Use web_search to find the top 3-5 most relevant and authoritative sources. ' +
          'Prefer official sites, documentation, established review platforms, and recent content. ' +
          'Return a structured list of URLs with brief descriptions.' +
          '\n\nCRITICAL: Use web_search — NOT terminal_execute with curl. Curl cannot render JavaScript pages and will get blocked by captchas. web_search is the only allowed search tool.'
      }), 'Web Explorer: Initial Search');
      return {
        ...result,
        searchInvoked: true,
        returningFromSpecialist: 'web_explorer'
      };
    }

    // ─── PHASE 2: DEEP INVESTIGATION (SINGLE NAVIS CALL) ─────────────────
    // After search, call navis ONCE with ALL discovered URLs and detailed extraction goals
    if (searchInvoked && !navisInvoked) {
      // Extract all discovered URLs from the search results
      const searchResult = messages.find((m: any) => (m.role === 'tool' || m.type === 'tool') && m.name === 'web_search');
      if (!searchResult) {
        console.warn('[WebExplorer] Search complete but result not found in messages. Marking complete to avoid loop.');
        return { webExplorerComplete: true, taskPhase: 'evaluating' as const, returningFromSpecialist: 'web_explorer' };
      }

      const searchContent = typeof searchResult.content === 'string' ? searchResult.content : JSON.stringify(searchResult.content);
      const userTask = messages.find((m: any) => m.role === 'user')?.content || '';
      const taskText = typeof userTask === 'string' ? userTask : JSON.stringify(userTask);

      const candidates = extractTopCandidates(searchContent, taskText, 5);
      if (candidates.length === 0) {
        console.warn('[WebExplorer] No candidates found from search results.');
        return { webExplorerComplete: true, taskPhase: 'evaluating' as const, returningFromSpecialist: 'web_explorer' };
      }

      // Build a detailed, consolidated navis task with ALL URLs
      const urlList = candidates.map((c, i) => `  ${i + 1}. ${c.url}`).join('\n');
      const navisTask = buildConsolidatedNavisTask(taskText, candidates);

      eventQueue?.push({
        type: 'thought',
        content: `\n🌐 WEB EXPLORER [Phase 2/3]: Investigating ${candidates.length} sources with navis (single consolidated call):\n${urlList}`
      });

      const result = await integrator.wrapNode('web_explorer', () => runAgentStep(state, {
        runner,
        toolDefs: allTools,
        eventQueue,
        nodeName: 'web_explorer',
        systemPromptOverride: (loadPrompt('web-explorer.md') || '') +
          `\n\nPHASE: INVESTIGATE. You MUST call navis EXACTLY ONCE with the following consolidated task.` +
          `\nDo NOT spawn subagents. Do NOT call navis multiple times. ONE navis call with ALL URLs.` +
          `\nDo NOT use terminal_execute with curl. Only navis can properly load modern web pages.` +
          `\n\nNAVIS TASK TO USE (pass this as the "task" parameter to navis):\n\`\`\`\n${navisTask}\n\`\`\`` +
          `\n\nAfter navis returns its results, synthesize the findings into a comprehensive answer with inline citations.` +
          `\nIf navis reports "NOT_FOUND" for any URL, note that in your synthesis and move on.`
      }), 'Web Explorer: Deep Investigation');

      return {
        ...result,
        navisInvoked: true,
        webExplorerComplete: false,
        returningFromSpecialist: 'web_explorer'
      };
    }

    // ─── PHASE 3: SYNTHESIS ──────────────────────────────────────────────
    // After navis has visited pages, synthesize the results
    if (searchInvoked && navisInvoked) {
      // Check if the assistant has already synthesized (has MISSION_COMPLETE)
      const lastAssistant = [...messages].reverse().find((m: any) => {
        const role = m.role || m._getType?.();
        return role === 'assistant' || role === 'ai';
      });
      const lastContent = lastAssistant ? (typeof lastAssistant.content === 'string' ? lastAssistant.content : '') : '';

      if (lastContent.includes('MISSION_COMPLETE')) {
        eventQueue?.push({ type: 'thought', content: '\n✅ WEB EXPLORER: Research complete.' });
        return {
          webExplorerComplete: true,
          taskPhase: 'evaluating' as const,
          returningFromSpecialist: 'web_explorer'
        };
      }

      // Not yet synthesized — let the agent compile findings
      eventQueue?.push({ type: 'thought', content: '\n📝 WEB EXPLORER [Phase 3/3]: Synthesizing research findings...' });
      const result = await integrator.wrapNode('web_explorer', () => runAgentStep(state, {
        runner,
        toolDefs: allTools,
        eventQueue,
        nodeName: 'web_explorer',
        systemPromptOverride: (loadPrompt('web-explorer.md') || '') +
          '\n\nPHASE: SYNTHESIZE. You have completed your web research.' +
          '\nCompile all findings into a comprehensive, well-structured answer.' +
          '\nInclude inline citations [Source Title](URL) for all claims.' +
          '\nIf comparing options, include a comparison table.' +
          '\nProvide actionable recommendations.' +
          '\nEnd your response with MISSION_COMPLETE.'
      }), 'Web Explorer: Synthesis');

      return {
        ...result,
        webExplorerComplete: true,
        taskPhase: 'evaluating' as const,
        returningFromSpecialist: 'web_explorer'
      };
    }

    return { webExplorerComplete: true, returningFromSpecialist: 'web_explorer' };
  };
};

/**
 * Build a consolidated navis task that includes ALL URLs and specific extraction goals.
 * This replaces the old multi-subagent approach with a single focused navis call.
 */
function buildConsolidatedNavisTask(userGoal: string, candidates: Array<{ url: string; score: number }>): string {
  const urlInstructions = candidates.map((c, i) =>
    `URL ${i + 1}: ${c.url}\n` +
    `  → Navigate to this page\n` +
    `  → Extract: key features, pricing (if any), pros/cons, technical details, user reviews/ratings\n` +
    `  → If the page is a list/category page, click into the top 1-2 individual items and extract from those\n` +
    `  → If the information is not available, report "NOT_FOUND: [reason]" for this URL`
  ).join('\n\n');

  return `RESEARCH GOAL: ${userGoal.slice(0, 500)}

INSTRUCTIONS:
You must visit ALL of the following URLs in order. For each URL:
1. Navigate to the page using go_to_url
2. Wait for it to load, then use extract_content to get the information specified below
3. If a page blocks you (captcha, paywall, login wall), report NOT_FOUND and move to the next URL
4. Do NOT follow random links — only visit the URLs listed below
5. Do NOT do additional web searches — only visit these specific pages

URLS TO VISIT:

${urlInstructions}

COMPLETION:
After visiting ALL URLs, call done() with a structured report containing:
- For each URL: the extracted information OR "NOT_FOUND: [reason]"
- A brief comparison if multiple sources were found
- Key facts and specific details (not vague summaries)

IMPORTANT RULES:
- Visit ONLY the URLs listed above — do not wander to other pages
- If a page doesn't have what you need, say NOT_FOUND and move on
- Be efficient — extract what's needed and move to the next URL
- Do NOT spend more than 5 steps per URL`;
}

function extractDirectUrl(messages: any[]): string | null {
  const userMsg = messages.find((m: any) => m.role === 'user' || m.type === 'human' || m._getType?.() === 'human');
  if (!userMsg) return null;
  const content = typeof userMsg.content === 'string' ? userMsg.content : '';
  if (!content) return null;

  const urlPattern = /(?:https?:\/\/)?(?:[a-zA-Z0-9-]+\.)+(?:com|org|net|io|xyz|dev|app|ai|co|me|tv|edu|gov|info)\b(?:[^\s"'<>)]*)?/gi;
  const matches = content.match(urlPattern);
  if (!matches || matches.length === 0) return null;

  const url = matches[0].toLowerCase();
  return url.startsWith('http://') || url.startsWith('https://') ? url : `https://${url}`;
}

function extractTopCandidates(searchContent: string, task: string, maxCount: number): Array<{ url: string; score: number }> {
  const candidates: Array<{ url: string; score: number }> = [];
  const urlRegex = /https?:\/\/[^\s"'<>)]+/g;
  const matches = searchContent.match(urlRegex) || [];

  const SEARCH_ENGINES = ['google.com', 'bing.com', 'duckduckgo.com', 'brave.com', 'yahoo.com'];
  const LOW_QUALITY = ['pinterest.com', 'facebook.com', 'twitter.com', 'instagram.com', 'tiktok.com'];

  const cleanUrls = [...new Set(matches)].filter(u =>
    !SEARCH_ENGINES.some(se => u.includes(se)) &&
    !LOW_QUALITY.some(lq => u.includes(lq))
  );

  const taskLower = (task || '').toLowerCase();
  const taskWords = taskLower.split(/\s+/).filter(w => w.length > 3);

  for (const url of cleanUrls) {
    const urlLower = url.toLowerCase();
    let score = 50;

    if (url.includes('.edu')) score += 20;
    if (url.includes('.org')) score += 15;
    if (url.includes('.gov')) score += 25;
    if (url.includes('github.com')) score += 15;
    if (url.includes('docs.') || url.includes('/docs/')) score += 15;
    if (url.includes('wiki')) score += 10;

    const urlKeywordMatches = taskWords.filter(w => urlLower.includes(w)).length;
    score += urlKeywordMatches * 12;

    if (url.includes('?') && url.split('?')[1].length > 50) score -= 10;
    if (url.length > 150) score -= 5;

    candidates.push({ url, score });
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, maxCount);
}
