import type { ToolDefinition } from '../../lib/ai-client';

/**
 * Category labels assigned to each tool for relevance filtering.
 */
export type ToolCategory =
  | 'filesystem'
  | 'terminal'
  | 'web'
  | 'vision'
  | 'memory'
  | 'planning'
  | 'communication'
  | 'synthesis'
  | 'subagent'
  | 'browser'
  | 'artifact'
  | 'mcp'
  | 'scheduling'
  | 'preview'
  | 'skill'
  | 'config'
  | 'ai'
  | 'data';

/**
 * Keywords that hint a task is likely to use a given category.
 * The analyzer matches these against the user's input and recent assistant output.
 */
const CATEGORY_SIGNALS: Record<ToolCategory, string[]> = {
  filesystem:     ['file', 'read', 'write', 'save', 'create', 'edit', 'delete', 'rename', 'move', 'copy', 'folder', 'directory', 'path', 'ls', 'grep', 'search', 'find', 'glob', 'code', 'script', 'source'],
  terminal:       ['run', 'execute', 'command', 'shell', 'bash', 'zsh', 'pwsh', 'powershell', 'cmd', 'terminal', 'install', 'npm', 'pip', 'build', 'compile', 'test', 'deploy', 'docker', 'git'],
  web:            ['search', 'fetch', 'url', 'http', 'https', 'website', 'web', 'online', 'api', 'rest', 'scrape', 'crawl', 'link', 'page', 'documentation'],
  vision:         ['screenshot', 'screen', 'capture', 'image', 'photo', 'picture', 'see', 'look', 'view', 'visual', 'ocr', 'desktop', 'gui', 'ui', 'icon', 'button', 'window'],
  memory:         ['remember', 'forget', 'memory', 'recall', 'fact', 'profile', 'preference', 'store', 'learn', 'user'],
  planning:       ['plan', 'step', 'task', 'todo', 'decompose', 'execute', 'strategy', 'pipeline', 'workflow', 'stage', 'phase', 'milestone'],
  communication:  ['discord', 'telegram', 'slack', 'email', 'message', 'send', 'notify', 'share', 'post'],
  synthesis:      ['synthesize', 'combine', 'merge', 'unify', 'aggregate', 'consolidate', 'summary', 'report'],
  subagent:       ['delegate', 'spawn', 'subagent', 'swarm', 'parallel', 'background', 'child', 'worker', 'agent', 'specialist'],
  browser:        ['navis', 'browser', 'navigate', 'click', 'scroll', 'type', 'fill', 'form', 'login', 'extract', 'dom', 'page', 'url', 'webpage', 'cookies'],
  artifact:       ['artifact', 'dashboard', 'chart', 'report', 'visualize', 'presentation', 'pptx', 'slide', 'deck', 'html', 'svg'],
  mcp:            ['mcp', 'server', 'connect', 'tool', 'registry', 'modelcontextprotocol'],
  scheduling:     ['schedule', 'cron', 'timer', 'interval', 'recurring', 'remind', 'alert'],
  preview:        ['preview', 'live', 'url', 'show', 'display', 'open', 'launch', 'render'],
  skill:          ['skill', 'tutorial', 'guide', 'template', 'workflow', 'recipe'],
  config:         ['config', 'setting', 'preference', 'option', 'enable', 'disable', 'toggle'],
  ai:             ['model', 'prompt', 'llm', 'ai', 'generate', 'reply', 'respond', 'chat', 'conversation'],
  data:           ['csv', 'json', 'excel', 'spreadsheet', 'database', 'sql', 'query', 'table', 'record', 'dataset', 'analyze', 'analytics', 'statistics', 'chart', 'graph', 'plot'],
};

/**
 * Every known tool and its category.
 */
const TOOL_CATEGORY_MAP: Array<{ pattern: RegExp; category: ToolCategory }> = [
  // File system
  { pattern: /^(read_file|write_to_file|replace_file_content|grep_search|list_dir|system_files|create_file|delete_file|move_file|copy_file|rename_file|search_files|create_directory|delete_directory|list_directory|batch_write)$/i,          category: 'filesystem' },
  { pattern: /^(read|write|edit|multi_file_edit|delete|rename|move|copy|mkdir|touch|append_file|prepend_file|create_project|open_file|save_file|file|ls|grep|find)$/i,                                                                                          category: 'filesystem' },
  // Terminal
  { pattern: /^(terminal|terminal_status|terminal_execute|run_command|exec|execute_command|run_script|run_code|bash|executePwsh|powershell|cmd)$/i,                                                                                                                            category: 'terminal' },
  // Web
  { pattern: /^(web_search|web_search_bing|web_fetch|web_scrape|fetch_url)$/i,                                                                                                                                                  category: 'web' },
  // Vision
  { pattern: /^(analyze_image|visual_classification_sheet|computer_use|screenshot|screen_capture|ocr)$/i,                                                                                                                       category: 'vision' },
  // Memory
  { pattern: /^(memory_save|memory_search|remember_fact|recall_fact|update_profile|profile)$/i,                                                                                                                                  category: 'memory' },
  // Planning
  { pattern: /^(planner|update_step|execution_plan|todo_write|todo_list|create_plan|update_plan_step)$/i,                                                                                                                        category: 'planning' },
  // Communication
  { pattern: /^(send_discord_message|send_telegram_message|send_email|send_slack_message)$/i,                                                                                                                                    category: 'communication' },
  // Synthesis
  { pattern: /^(synthesize_tool|synthesize_skill|merge|combine|aggregate)$/i,                                                                                                                                                    category: 'synthesis' },
  // Sub-agent
  { pattern: /^(spawn_agent|spawn_swarm|broadcast_swarm_fact|read_swarm_memory)$/i,                                                                                                                                              category: 'subagent' },
  // Browser
  { pattern: /^(navis|browser|browser_use|page_navigate|page_click|page_type|page_scroll|page_extract|dom_extract)$/i,                                                                                                            category: 'browser' },
  // Artifact
  { pattern: /^(create_artifact|edit_artifact|visualize|present_files|create_chart|create_report|create_dashboard)$/i,                                                                                             category: 'artifact' },
  // MCP
  { pattern: /^(search_mcp_registry|connect_mcp_server|list_mcp_tools|mcp_)/i,                                                                                                                                                   category: 'mcp' },
  // Scheduling
  { pattern: /^(create_scheduled_task|list_scheduled_tasks|delete_scheduled_task|scheduled_task)/i,                                                                                                                              category: 'scheduling' },
  // Preview
  { pattern: /^(preview_live_url|show_user_url|open_url|launch_url)$/i,                                                                                                                                                          category: 'preview' },
  // Skill
  { pattern: /^skill$/i,                                                                                                                                                                                                         category: 'skill' },
  // Config
  { pattern: /^(ask_user_question|local_permission|allow_file_delete|approve_actions|confirm)$/i,                                                                                                                                 category: 'config' },
  // Data
  { pattern: /^(analyze_data|query_data|sql_query|dataframe|plot|chart|statistics)$/i,                                                                                                                                           category: 'data' },
];

/**
 * Resolves a tool name to its category. Namespaced names containing a '/'
 * (e.g. "server/tool") are connected-session MCP tools and are classified as
 * 'mcp' before any regex pattern is consulted, so no other pattern can claim
 * them. All other names fall through the existing TOOL_CATEGORY_MAP unchanged.
 */
function classifyToolName(name: string): ToolCategory | undefined {
  if (name.includes('/')) return 'mcp';

  for (const entry of TOOL_CATEGORY_MAP) {
    if (entry.pattern.test(name)) {
      return entry.category;
    }
  }

  return undefined;
}

/**
 * Harvests MCP server names from connected-session tool definitions.
 * For each tool name containing '/', the prefix before the first '/' is
 * collected (lowercased, non-empty). Used to boost the 'mcp' category when a
 * connected server is mentioned in the task context.
 */
function harvestMcpServerNames(toolDefs: ToolDefinition[]): Set<string> {
  const serverNames = new Set<string>();
  for (const def of toolDefs) {
    if (!def.name.includes('/')) continue;
    const prefix = def.name.slice(0, def.name.indexOf('/')).toLowerCase();
    if (prefix) serverNames.add(prefix);
  }
  return serverNames;
}

/**
 * Source roster for tools that are always included regardless of task analysis.
 * These are fundamental to agent operation.
 *
 * Grouped logically; a load-time dedupe guard below guarantees every entry is
 * unique before it reaches TOOL_ALWAYS_INCLUDE.
 */
const ALWAYS_INCLUDE_SOURCE: readonly string[] = [
  // User interaction / permissions
  'ask_user_question',
  'local_permission',
  // Filesystem (pi-tools host coding tools: read/write/edit/grep/find/ls)
  'read',
  'write',
  'edit',
  'multi_file_edit',
  'grep',
  'find',
  'ls',
  // Terminal
  'terminal_execute',
  'terminal_status',
  'executePwsh',
  // Memory
  'memory_save',
  'memory_search',
  // Planning & lifecycle (planner.ts exports create_plan/update_plan_step)
  // Issue #19 Fix: task_complete, update_plan_step, and execution_plan are structural
  // lifecycle tools the agent MUST always have. Without task_complete the agent
  // cannot signal completion and will run until maxIterations. Without update_plan_step
  // it cannot update plan progress. These must never be truncated regardless of task.
  'create_plan',
  'update_plan_step',
  'execution_plan',
  'task_complete',
  'todo_write',
  // Web / search (webfetch.ts registers 'web_fetch')
  'web_search',
  'web_fetch',
  // Navigation / browser
  'navis',
  'computer_use',
  // Creative / utility tools
  'skill',
  'create_artifact',
  'edit_artifact',
  'visualize',
  'present_files',
  // Vision
  'analyze_image',
  // Subagent
  'spawn_agent',
  'spawn_swarm',
];

/**
 * Load-time dedupe guard for ALWAYS_INCLUDE_SOURCE: throws on any duplicate
 * entry so a stale copy/paste can never silently widen the roster.
 */
function dedupeAlwaysInclude(source: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const name of source) {
    if (seen.has(name)) {
      throw new Error(`[ToolTruncator] duplicate ALWAYS_INCLUDE entry: ${name}`);
    }
    seen.add(name);
    unique.push(name);
  }
  return unique;
}

/**
 * Tools that are always included regardless of task analysis.
 * These are fundamental to agent operation. Dedupe-checked at module load.
 */
export const TOOL_ALWAYS_INCLUDE: readonly string[] = dedupeAlwaysInclude(ALWAYS_INCLUDE_SOURCE);

/**
 * Set-form mirror of TOOL_ALWAYS_INCLUDE for O(1) membership checks in hot
 * loops (truncateTools consults it once per tool). Derived, never mutated.
 */
const ALWAYS_INCLUDE = new Set<string>(TOOL_ALWAYS_INCLUDE);

/**
 * Graded-relaxation constants (replace the old binary 20%-of-roster cliff).
 * When truncation drops the kept roster below RESCUE_FLOOR, the most relevant
 * removed tools are rescued back until the floor is met; only tools with a
 * relevance tier >= RESCUE_MIN_RELEVANCE are eligible for rescue. A full-set
 * fallback happens only as a last resort (see truncateTools).
 */
const RESCUE_FLOOR = 12;
const RESCUE_MIN_RELEVANCE = 0.5;

/**
 * Graded relevance tier for a tool, used by the rescue pass in truncateTools.
 * Tiers (deterministic, no randomness):
 *  - 1.0: the tool is always-include, belongs to a relevant category
 *         (category score >= threshold), or is a connected MCP tool
 *         (namespaced MCP tool names contain '/').
 *  - 0.5: its category received a score > 0 but below the relevance
 *         threshold (borderline relevance).
 *  - 0:   no relevance signal at all.
 *
 * `cat` must be the category already resolved by the caller from
 * TOOL_CATEGORY_MAP (or undefined if unmatched) so categories are never
 * rescanned here.
 */
function toolRelevanceTier(
  defName: string,
  cat: ToolCategory | undefined,
  alwaysInclude: Set<string>,
  relevantCategories: Set<ToolCategory>,
  scores: Record<string, number>,
): number {
  if (
    alwaysInclude.has(defName) ||
    defName.includes('/') ||
    (cat !== undefined && relevantCategories.has(cat))
  ) {
    return 1.0;
  }
  if (cat !== undefined && (scores[cat] ?? 0) > 0) {
    return 0.5;
  }
  return 0;
}

/**
 * Scores one piece of task text (user input or recent assistant output)
 * against a single category's keyword signals. Every keyword occurrence
 * adds 1 point, capped at 3 occurrences per keyword so a single repeated
 * keyword cannot unboundedly inflate one category's score.
 *
 * @param text Raw text to scan; empty text scores 0.
 * @param signals Lowercase keywords belonging to one category.
 * @returns Non-negative additive score; not normalized across categories.
 */
function scoreTaskText(text: string, signals: string[]): number {
  if (!text) return 0;
  const lower = text.toLowerCase();
  let score = 0;
  for (const keyword of signals) {
    // Count each occurrence up to a cap of 3 per keyword
    let idx = -1;
    let count = 0;
    while ((idx = lower.indexOf(keyword, idx + 1)) !== -1 && count < 3) {
      score += 1;
      count++;
    }
  }
  return score;
}

interface TruncatorOptions {
  /** Minimum score for a category to be considered relevant. Default 1. */
  relevanceThreshold?: number;
  /** Always include these tool names regardless of analysis. */
  alwaysInclude?: string[];
  /** If true, logs truncation decisions. Default false. */
  debug?: boolean;
}

interface TruncationDetails {
  /** Estimated token count of the full (pre-truncation) tool schema JSON. */
  totalSchemaTokens: number;
  /** Estimated token count of the truncated tool schema JSON. */
  keptSchemaTokens: number;
  /** Number of tools removed. */
  toolsRemoved: number;
}

interface TruncationResult {
  /** The filtered tool definitions. */
  tools: ToolDefinition[];
  /** Names of tools that were removed. */
  removed: string[];
  /** Category scores for debugging. */
  scores: Record<ToolCategory, number>;
  /** Token-size estimates for the tool schema before and after truncation. */
  details: TruncationDetails;
}

/**
 * Estimate the token count of a JSON-serialised array of ToolDefinitions.
 * Uses a rough ratio of ~4 characters per token.
 *
 * @param toolDefs Tool definitions to size; an empty array yields 0.
 * @returns Estimated token count (never negative; ceil-rounded).
 */
function estimateToolSchemaTokens(toolDefs: ToolDefinition[]): number {
  const json = JSON.stringify(toolDefs);
  return Math.ceil(json.length / 4);
}

/**
 * Analyzes the current task context and returns only the subset of tool
 * definitions relevant to the task at hand.
 *
 * Scoring strategy:
 *  1. Score each category by keyword overlap with user input + recent assistant text.
 *  2. Categories with score >= threshold are "relevant".
 *  3. Tools belonging to relevant categories are included, plus ALWAYS_INCLUDE tools.
 *  4. Graded relaxation: if the kept roster falls below RESCUE_FLOOR tools, the
 *     most relevant removed tools (relevance tier >= RESCUE_MIN_RELEVANCE) are
 *     rescued back until the floor is met, preserving original roster order;
 *     only if rescue is still insufficient (kept < RESCUE_FLOOR AND something
 *     was actually removed) does it fall back to the full set.
 *
 * @param toolDefs Full roster of tool definitions to filter (not mutated).
 * @param userInput Current user message text used for category scoring.
 * @param recentAssistantOutput Recent assistant text; contributes equally
 *        to scoring so mid-task pivots (not just the prompt) steer relevance.
 * @param options Optional overrides: relevance threshold, extra
 *        always-include names, and debug logging.
 * @returns Kept/removed tools, per-category scores, and before/after
 *         schema-token estimates. Pure: no side effects besides debug logs.
 */
export function truncateTools(
  toolDefs: ToolDefinition[],
  userInput: string,
  recentAssistantOutput: string,
  options: TruncatorOptions = {},
): TruncationResult {
  const threshold = options.relevanceThreshold ?? 1;
  const alwaysInclude = new Set([
    ...ALWAYS_INCLUDE,
    ...(options.alwaysInclude ?? []),
  ]);

  const debug = options.debug ?? false;

  // Score every category
  // Sparse map: only categories with combined > 0 get an entry, so
  // `Object.keys(scores)` below is exactly the set of categories with any
  // signal (irrelevant ones are never compared against threshold).
  const scores: Record<string, number> = {};
  for (const [cat, signals] of Object.entries(CATEGORY_SIGNALS)) {
    const userScore = scoreTaskText(userInput, signals);
    const assistantScore = scoreTaskText(recentAssistantOutput, signals);
    const combined = userScore + assistantScore;
    if (combined > 0) scores[cat] = combined;
  }

  // MCP server-name boost: if a connected MCP server's name appears in the
  // combined task text, boost the 'mcp' category so its tools survive
  // relevance filtering. Deterministic: +2 per matching server name.
  const mcpServerNames = harvestMcpServerNames(toolDefs);
  const combinedTaskText = `${userInput} ${recentAssistantOutput}`.toLowerCase();
  for (const serverName of mcpServerNames) {
    if (combinedTaskText.includes(serverName)) {
      scores.mcp = (scores.mcp ?? 0) + 2;
    }
  }
  if (debug && mcpServerNames.size > 0) {
    console.log('[ToolTruncator] MCP server names:', [...mcpServerNames].join(', '));
  }

  // Determine relevant categories
  const relevantCategories = new Set(
    (Object.keys(scores) as ToolCategory[]).filter((cat) => scores[cat] >= threshold),
  );

  if (debug) {
    console.log('[ToolTruncator] Category scores:', JSON.stringify(scores, null, 2));
    console.log('[ToolTruncator] Relevant categories:', [...relevantCategories].join(', '));
  }

  const removed: string[] = [];
  const kept: ToolDefinition[] = [];
  // Parallel to `removed` (which stays in original toolDefs order):
  // original index of each removed tool in toolDefs, and its relevance tier
  // computed once during this loop (categories are never rescanned later).
  const removedToolIdx: number[] = [];
  const removedRelevance: number[] = [];

  let mcpKept = 0;

  for (let i = 0; i < toolDefs.length; i++) {
    const def = toolDefs[i];

    // Connected-session MCP tools (namespaced "server/tool") are always kept,
    // regardless of relevance scores or budget aggressiveness.
    if (def.name.includes('/')) {
      kept.push(def);
      mcpKept++;
      continue;
    }

    // Always include these
    if (alwaysInclude.has(def.name)) {
      kept.push(def);
      continue;
    }

    // Find the tool's category
    const cat = classifyToolName(def.name);

    if (cat && relevantCategories.has(cat)) {
      kept.push(def);
    } else {
      removed.push(def.name);
      removedToolIdx.push(i);
      removedRelevance.push(
        toolRelevanceTier(def.name, cat, alwaysInclude, relevantCategories, scores),
      );
    }
  }

  if (debug && mcpKept > 0) {
    console.log(`[ToolTruncator] Kept ${mcpKept} connected-session MCP tool(s) unconditionally`);
  }

  // Graded relaxation (replaces the old binary cliff): if truncation dropped
  // the roster below RESCUE_FLOOR, rescue the most relevant removed tools
  // (relevance >= RESCUE_MIN_RELEVANCE) instead of returning everything.
  let rescuedCount = 0;
  if (kept.length < RESCUE_FLOOR && removed.length > 0) {
    const need = RESCUE_FLOOR - kept.length;
    const rescuePool = removed
      .map((name, removedIdx) => ({
        name,
        removedIdx,
        toolIdx: removedToolIdx[removedIdx],
        relevance: removedRelevance[removedIdx],
      }))
      .filter((c) => c.relevance >= RESCUE_MIN_RELEVANCE)
      // (relevance desc, original index in toolDefs asc) — deterministic & stable.
      .sort((a, b) => (b.relevance - a.relevance) || (a.toolIdx - b.toolIdx));

    const rescueCount = Math.min(need, rescuePool.length);
    if (rescueCount > 0) {
      rescuedCount = rescueCount;
      const rescued = rescuePool.slice(0, rescueCount);

      // Pull the exact definitions back, preserving original roster order.
      const rescuedToolIdx = new Set(rescued.map((c) => c.toolIdx));
      const rescuedDefs: ToolDefinition[] = [];
      toolDefs.forEach((def, idx) => {
        if (rescuedToolIdx.has(idx)) rescuedDefs.push(def);
      });
      kept.push(...rescuedDefs);

      // Drop the rescued entries from the removed list (parallel arrays kept
      // in sync; splice in descending index order so indices stay valid).
      for (const idx of rescued.map((c) => c.removedIdx).sort((a, b) => b - a)) {
        removed.splice(idx, 1);
        removedToolIdx.splice(idx, 1);
        removedRelevance.splice(idx, 1);
      }
      if (debug) console.log(`[ToolTruncator] Rescued ${rescuedCount} tool(s) back from the removed list`);
    }
  }

  // Last resort: even after rescue the roster is still below RESCUE_FLOOR and
  // there are tools we removed — return the full set. If nothing was removed
  // in the first place there is nothing to rescue and the normal result below
  // already IS the full set.
  if (kept.length < RESCUE_FLOOR && removed.length > 0) {
    if (debug) console.log(`[ToolTruncator] Rescue insufficient (kept ${kept.length} < RESCUE_FLOOR ${RESCUE_FLOOR}, ${removed.length} still removed), returning full set`);
    return {
      tools: [...toolDefs],
      removed: [],
      scores: scores as Record<ToolCategory, number>,
      details: {
        totalSchemaTokens: estimateToolSchemaTokens(toolDefs),
        keptSchemaTokens: estimateToolSchemaTokens(toolDefs),
        toolsRemoved: 0,
      },
    };
  }

  if (debug) {
    console.log(`[ToolTruncator] Kept ${kept.length} tools, removed ${removed.length} (rescued ${rescuedCount} back from the removed list)`);
    console.log('[ToolTruncator] Removed:', removed.join(', '));
  }

  return {
    tools: kept,
    removed,
    scores: scores as Record<ToolCategory, number>,
    details: {
      totalSchemaTokens: estimateToolSchemaTokens(toolDefs),
      keptSchemaTokens: estimateToolSchemaTokens(kept),
      toolsRemoved: removed.length,
    },
  };
}
