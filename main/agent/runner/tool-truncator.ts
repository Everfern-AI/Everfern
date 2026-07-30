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
 * Tools that are always included regardless of task analysis.
 * These are fundamental to agent operation.
 */
const ALWAYS_INCLUDE = new Set<string>([
  'ask_user_question',
  'local_permission',
  'terminal_execute',
  'bash',
  'executePwsh',
  'terminal_status',
  'edit',
  'multi_file_edit',
  // Navigation / browser
  'navis',
  'computer_use',
  // Creative / utility tools
  'skill',
  'create_artifact',
  'edit_artifact',
  'visualize',
  'present_files',
  // Memory & planning
  'todo_write',
  'planner',
  'memory_save',
  'memory_search',
  // Web / search
  'web_search',
  // Vision
  'analyze_image',
  // Subagent
  'spawn_agent',
  'spawn_swarm',
  // Issue #19 Fix: task_complete, update_step, and execution_plan are structural
  // lifecycle tools the agent MUST always have. Without task_complete the agent
  // cannot signal completion and will run until maxIterations. Without update_step
  // it cannot update plan progress. These must never be truncated regardless of task.
  'task_complete',
  'update_step',
  'execution_plan',
]);


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

export interface TruncatorOptions {
  /** Minimum score for a category to be considered relevant. Default 1. */
  relevanceThreshold?: number;
  /** Always include these tool names regardless of analysis. */
  alwaysInclude?: string[];
  /** If true, logs truncation decisions. Default false. */
  debug?: boolean;
}

export interface TruncationDetails {
  /** Estimated token count of the full (pre-truncation) tool schema JSON. */
  totalSchemaTokens: number;
  /** Estimated token count of the truncated tool schema JSON. */
  keptSchemaTokens: number;
  /** Number of tools removed. */
  toolsRemoved: number;
}

export interface TruncationResult {
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
 */
export function estimateToolSchemaTokens(toolDefs: ToolDefinition[]): number {
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
 *  4. If the analysis produces fewer than 3 tools (too aggressive), fall back to full set.
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
  const scores: Record<string, number> = {};
  for (const [cat, signals] of Object.entries(CATEGORY_SIGNALS)) {
    const userScore = scoreTaskText(userInput, signals);
    const assistantScore = scoreTaskText(recentAssistantOutput, signals);
    const combined = userScore + assistantScore;
    if (combined > 0) scores[cat] = combined;
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

  for (const def of toolDefs) {
    // Always include these
    if (alwaysInclude.has(def.name)) {
      kept.push(def);
      continue;
    }

    // Find the tool's category
    let cat: ToolCategory | undefined;
    for (const entry of TOOL_CATEGORY_MAP) {
      if (entry.pattern.test(def.name)) {
        cat = entry.category;
        break;
      }
    }

    if (cat && relevantCategories.has(cat)) {
      kept.push(def);
    } else {
      removed.push(def.name);
    }
  }

  // Fallback: if truncation was too aggressive (≤ 8 kept or ≤ 20% of original), return everything
  const minKeep = Math.max(8, Math.ceil(toolDefs.length * 0.2));
  if (kept.length < minKeep) {
    if (debug) console.log(`[ToolTruncator] Truncation too aggressive (kept ${kept.length} < ${minKeep}), returning full set`);
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
    console.log(`[ToolTruncator] Kept ${kept.length} tools, removed ${removed.length}`);
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
