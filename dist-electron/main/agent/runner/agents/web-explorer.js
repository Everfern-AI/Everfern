"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createWebExplorerNode = void 0;
const agent_runtime_1 = require("../services/agent-runtime");
const mission_integrator_1 = require("../mission-integrator");
const prompt_sync_1 = require("../../../lib/prompt-sync");
/**
 * Robustly find the web_search tool result in messages.
 * Handles multiple message formats and property names.
 */
function findWebSearchResult(messages) {
    if (!messages || messages.length === 0) {
        return { content: '', found: false, reason: 'No messages in state' };
    }
    // Walk backwards to find most recent tool result
    for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        const role = m.role || m.type || m._getType?.();
        // Check if this is a tool/function result message
        if (role === 'tool' || role === 'function') {
            // Try multiple property names for tool name
            const toolName = m.name || m.tool_name || m.toolName || '';
            if (toolName === 'web_search') {
                const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
                console.log('[WebExplorer] Found web_search result in messages');
                return { content, found: true, reason: 'Found web_search tool result' };
            }
        }
    }
    console.warn('[WebExplorer] No web_search tool result found in messages');
    return { content: '', found: false, reason: 'No web_search tool result found in messages' };
}
const createWebExplorerNode = (runner, eventQueue, missionTracker, toolDefs) => {
    const integrator = (0, mission_integrator_1.createMissionIntegrator)(missionTracker);
    return async (state) => {
        const allTools = toolDefs || runner._buildToolDefinitions();
        const messages = state.messages || [];
        // Determine if this is a fresh web_explorer session or a continuation
        // Fresh session: brain just routed to us (returningFromSpecialist is null or not 'web_explorer')
        // Continuation: we're already in web_explorer (returningFromSpecialist === 'web_explorer')
        const isFreshSession = state.returningFromSpecialist !== 'web_explorer';
        // If fresh session, reset flags to start from Phase 1
        let searchInvoked = isFreshSession ? false : (state.searchInvoked || false);
        let navisInvoked = isFreshSession ? false : (state.navisInvoked || false);
        if (isFreshSession) {
            console.log('[WebExplorer] Fresh session detected, starting from Phase 1');
        }
        const loopCount = (state.webExplorerSelfLoopCount || 0) + 1;
        // ─── DIRECT URL NAVIGATION ───────────────────────────────────────────
        // If the user provided a specific URL (skip research workflow entirely)
        const directUrl = !searchInvoked && !navisInvoked ? extractDirectUrl(messages) : null;
        if (directUrl) {
            eventQueue?.push({ type: 'thought', content: `\n🌐 WEB EXPLORER: Navigating directly to ${directUrl}...` });
            const result = await integrator.wrapNode('web_explorer', () => (0, agent_runtime_1.runAgentStep)(state, {
                runner,
                toolDefs: allTools,
                eventQueue,
                nodeName: 'web_explorer',
                systemPromptOverride: ((0, prompt_sync_1.loadPrompt)('web-explorer.md') || '') +
                    `\n\nDIRECT URL NAVIGATION. The user wants you to go to: ${directUrl}` +
                    '\nUse navis to navigate to this URL. Do NOT call web_search — the URL is already provided.' +
                    '\nLook for login buttons, forms, or dashboard links and interact with them.' +
                    '\nReport what you see and what actions are available on the page.'
            }), 'Web Explorer: Direct Navigation');
            return {
                ...result,
                webExplorerComplete: false,
                navisInvoked: true,
                webExplorerSelfLoopCount: loopCount,
                returningFromSpecialist: 'web_explorer'
            };
        }
        // ─── PHASE 1: SEARCH & DISCOVER ──────────────────────────────────────
        // Use web_search to find the top sources
        if (!searchInvoked && !navisInvoked) {
            console.log('[WebExplorer] Phase 1: Starting search...');
            eventQueue?.push({ type: 'thought', content: '\n🔍 WEB EXPLORER [Phase 1/3]: Searching for authoritative sources...' });
            const result = await integrator.wrapNode('web_explorer', () => (0, agent_runtime_1.runAgentStep)(state, {
                runner,
                toolDefs: allTools,
                eventQueue,
                nodeName: 'web_explorer',
                systemPromptOverride: ((0, prompt_sync_1.loadPrompt)('web-explorer.md') || '') +
                    '\n\nPHASE: SEARCH. Use web_search to find the top 3-5 most relevant and authoritative sources. ' +
                    'Prefer official sites, documentation, established review platforms, and recent content. ' +
                    'Return a structured list of URLs with brief descriptions.' +
                    '\n\nCRITICAL: Use web_search — NOT terminal_execute with curl. Curl cannot render JavaScript pages and will get blocked by captchas. web_search is the only allowed search tool.'
            }), 'Web Explorer: Initial Search');
            console.log('[WebExplorer] Phase 1: Search invoked, returning to web_explorer');
            return {
                ...result,
                searchInvoked: true,
                webExplorerSelfLoopCount: loopCount,
                returningFromSpecialist: 'web_explorer'
            };
        }
        // ─── PHASE 2: DEEP INVESTIGATION (SINGLE NAVIS CALL) ─────────────────
        // After search, call navis ONCE with ALL discovered URLs and detailed extraction goals
        if (searchInvoked && !navisInvoked) {
            console.log('[WebExplorer] Phase 2: Starting NAVIS investigation...');
            // Extract all discovered URLs from the search results
            const { content: searchContent, found, reason } = findWebSearchResult(messages);
            if (!found) {
                console.warn(`[WebExplorer] Phase 2 failed: ${reason}. Marking complete to avoid loop.`);
                return { webExplorerComplete: true, taskPhase: 'evaluating', returningFromSpecialist: null };
            }
            const userTask = messages.find((m) => m.role === 'user')?.content || '';
            const taskText = typeof userTask === 'string' ? userTask : JSON.stringify(userTask);
            const candidates = extractTopCandidates(searchContent, taskText, 5);
            if (candidates.length === 0) {
                console.warn('[WebExplorer] Phase 2: No candidates found from search results.');
                return { webExplorerComplete: true, taskPhase: 'evaluating', returningFromSpecialist: null };
            }
            // Build a detailed, consolidated navis task with ALL URLs
            const urlList = candidates.map((c, i) => `  ${i + 1}. ${c.url}`).join('\n');
            const navisTask = buildConsolidatedNavisTask(taskText, candidates);
            console.log(`[WebExplorer] Phase 2: Found ${candidates.length} candidates, calling navis...`);
            eventQueue?.push({
                type: 'thought',
                content: `\n🌐 WEB EXPLORER [Phase 2/3]: Investigating ${candidates.length} sources with navis (single consolidated call):\n${urlList}`
            });
            const result = await integrator.wrapNode('web_explorer', () => (0, agent_runtime_1.runAgentStep)(state, {
                runner,
                toolDefs: allTools,
                eventQueue,
                nodeName: 'web_explorer',
                systemPromptOverride: ((0, prompt_sync_1.loadPrompt)('web-explorer.md') || '') +
                    `\n\nPHASE: INVESTIGATE. You MUST call navis EXACTLY ONCE with the following consolidated task.` +
                    `\nDo NOT spawn subagents. Do NOT call navis multiple times. ONE navis call with ALL URLs.` +
                    `\nDo NOT use terminal_execute with curl. Only navis can properly load modern web pages.` +
                    `\n\nNAVIS TASK TO USE (pass this as the "task" parameter to navis):\n\`\`\`\n${navisTask}\n\`\`\`` +
                    `\n\nAfter navis returns its results, synthesize the findings into a comprehensive answer with inline citations.` +
                    `\nIf navis reports "NOT_FOUND" for any URL, note that in your synthesis and move on.`
            }), 'Web Explorer: Deep Investigation');
            console.log('[WebExplorer] Phase 2: NAVIS invoked, returning to web_explorer');
            return {
                ...result,
                navisInvoked: true,
                webExplorerComplete: false,
                webExplorerSelfLoopCount: loopCount,
                returningFromSpecialist: 'web_explorer'
            };
        }
        // ─── PHASE 3: SYNTHESIS ──────────────────────────────────────────────
        // After navis has visited pages, synthesize the results
        if (searchInvoked && navisInvoked) {
            console.log('[WebExplorer] Phase 3: Synthesizing research findings...');
            // Check if the assistant has already synthesized (has MISSION_COMPLETE)
            const lastAssistant = [...messages].reverse().find((m) => {
                const role = m.role || m._getType?.();
                return role === 'assistant' || role === 'ai';
            });
            const lastContent = lastAssistant ? (typeof lastAssistant.content === 'string' ? lastAssistant.content : '') : '';
            if (lastContent.includes('MISSION_COMPLETE')) {
                console.log('[WebExplorer] Phase 3: Research complete');
                console.log('[WebExplorer] Sub-task 3.5: Setting webExplorerComplete=true, pendingToolCalls=[], returningFromSpecialist=null');
                eventQueue?.push({ type: 'thought', content: '\n✅ WEB EXPLORER: Research complete.' });
                return {
                    webExplorerComplete: true,
                    taskPhase: 'evaluating',
                    webExplorerSelfLoopCount: loopCount,
                    returningFromSpecialist: null,
                    pendingToolCalls: [] // Sub-task 3.5: Clear pending tools on completion
                };
            }
            // Not yet synthesized — let the agent compile findings
            eventQueue?.push({ type: 'thought', content: '\n📝 WEB EXPLORER [Phase 3/3]: Synthesizing research findings...' });
            const result = await integrator.wrapNode('web_explorer', () => (0, agent_runtime_1.runAgentStep)(state, {
                runner,
                toolDefs: allTools,
                eventQueue,
                nodeName: 'web_explorer',
                systemPromptOverride: ((0, prompt_sync_1.loadPrompt)('web-explorer.md') || '') +
                    '\n\nPHASE: SYNTHESIZE. You have completed your web research.' +
                    '\nCompile all findings into a comprehensive, well-structured answer.' +
                    '\nInclude inline citations [Source Title](URL) for all claims.' +
                    '\nIf comparing options, include a comparison table.' +
                    '\nProvide actionable recommendations.' +
                    '\nEnd your response with MISSION_COMPLETE.'
            }), 'Web Explorer: Synthesis');
            console.log('[WebExplorer] Phase 3: Synthesis complete');
            console.log('[WebExplorer] Sub-task 3.5: Setting webExplorerComplete=true, pendingToolCalls=[], returningFromSpecialist=null');
            return {
                ...result,
                webExplorerComplete: true,
                taskPhase: 'evaluating',
                webExplorerSelfLoopCount: loopCount,
                returningFromSpecialist: null,
                pendingToolCalls: [] // Sub-task 3.5: Clear pending tools on completion
            };
        }
        return {
            webExplorerComplete: true,
            webExplorerSelfLoopCount: loopCount,
            returningFromSpecialist: null,
            pendingToolCalls: [] // Sub-task 3.5: Clear pending tools on completion
        };
    };
};
exports.createWebExplorerNode = createWebExplorerNode;
/**
 * Build a consolidated navis task that includes ALL URLs and specific extraction goals.
 * This replaces the old multi-subagent approach with a single focused navis call.
 */
function buildConsolidatedNavisTask(userGoal, candidates) {
    const urlInstructions = candidates.map((c, i) => `URL ${i + 1}: ${c.url}\n` +
        `  → Navigate to this page\n` +
        `  → Extract: key features, pricing (if any), pros/cons, technical details, user reviews/ratings\n` +
        `  → If the page is a list/category page, click into the top 1-2 individual items and extract from those\n` +
        `  → If the information is not available, report "NOT_FOUND: [reason]" for this URL`).join('\n\n');
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
function extractDirectUrl(messages) {
    const userMsg = messages.find((m) => m.role === 'user' || m.type === 'human' || m._getType?.() === 'human');
    if (!userMsg)
        return null;
    const content = typeof userMsg.content === 'string' ? userMsg.content : '';
    if (!content)
        return null;
    const urlPattern = /(?:https?:\/\/)?(?:[a-zA-Z0-9-]+\.)+(?:com|org|net|io|xyz|dev|app|ai|co|me|tv|edu|gov|info)\b(?:[^\s"'<>)]*)?/gi;
    const matches = content.match(urlPattern);
    if (!matches || matches.length === 0)
        return null;
    const url = matches[0].toLowerCase();
    return url.startsWith('http://') || url.startsWith('https://') ? url : `https://${url}`;
}
function extractTopCandidates(searchContent, task, maxCount) {
    const candidates = [];
    const urlRegex = /https?:\/\/[^\s"'<>)]+/g;
    const matches = searchContent.match(urlRegex) || [];
    const SEARCH_ENGINES = ['google.com', 'bing.com', 'duckduckgo.com', 'brave.com', 'yahoo.com'];
    const LOW_QUALITY = ['pinterest.com', 'facebook.com', 'twitter.com', 'instagram.com', 'tiktok.com'];
    const cleanUrls = [...new Set(matches)].filter(u => !SEARCH_ENGINES.some(se => u.includes(se)) &&
        !LOW_QUALITY.some(lq => u.includes(lq)));
    const taskLower = (task || '').toLowerCase();
    const taskWords = taskLower.split(/\s+/).filter(w => w.length > 3);
    for (const url of cleanUrls) {
        const urlLower = url.toLowerCase();
        let score = 50;
        if (url.includes('.edu'))
            score += 20;
        if (url.includes('.org'))
            score += 15;
        if (url.includes('.gov'))
            score += 25;
        if (url.includes('github.com'))
            score += 15;
        if (url.includes('docs.') || url.includes('/docs/'))
            score += 15;
        if (url.includes('wiki'))
            score += 10;
        const urlKeywordMatches = taskWords.filter(w => urlLower.includes(w)).length;
        score += urlKeywordMatches * 12;
        if (url.includes('?') && url.split('?')[1].length > 50)
            score -= 10;
        if (url.length > 150)
            score -= 5;
        candidates.push({ url, score });
    }
    candidates.sort((a, b) => b.score - a.score);
    return candidates.slice(0, maxCount);
}
