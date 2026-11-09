/**
 * EverFern Desktop — Tool Name Normalizer & Utilities
 *
 * Normalizes raw tool identifiers (e.g. 'todo_write', 'write_to_file', 'mcp__github__create_issue')
 * into human-friendly, polished display titles so users are never overwhelmed by raw developer snake_case.
 */

const TOOL_NAME_OVERRIDES: Record<string, string> = {
  todo_write: 'Todo Write',
  write_to_file: 'Write to File',
  read_file: 'Read File',
  view_file: 'View File',
  edit_file: 'Edit File',
  replace_file_content: 'Edit File',
  multi_replace_file_content: 'Edit File',
  run_command: 'Run Command',
  list_dir: 'List Directory',
  grep_search: 'Grep Search',
  file_search: 'File Search',
  web_search: 'Web Search',
  remote_web_search: 'Web Search',
  web_fetch: 'Web Fetch',
  fetch_url: 'Fetch URL',
  show_user_url: 'Browser View',
  preview_live_url: 'Live Preview',
  take_screenshot: 'Take Screenshot',
  computer_use: 'Computer Use',
  consult_skill: 'Consult Skill',
  recall_fact: 'Recall Fact',
  remember_fact: 'Remember Fact',
  update_profile: 'Update Profile',
  search_mcp_registry: 'MCP Registry',
  visual_classification_sheet: 'Visual Sheet',
  analyze_image: 'Analyze Image',
  system_files: 'File System',
  ask_user_question: 'Ask Question',
  approve_actions: 'Approve Actions',
  batch_write: 'Batch Write',
  create_artifact: 'Create Artifact',
  edit_artifact: 'Edit Artifact',
  task_complete: 'Task Complete',
  execution_plan: 'Execution Plan',
  create_plan: 'Create Plan',
  navis: 'Navis Browser',
  fern: 'Fern Memory',
  python_executor: 'Python Executor',
  bash: 'Terminal Command',
  terminal: 'Terminal',
};

const ACRONYMS: Record<string, string> = {
  url: 'URL',
  pdf: 'PDF',
  api: 'API',
  mcp: 'MCP',
  cli: 'CLI',
  ai: 'AI',
  id: 'ID',
  os: 'OS',
  sql: 'SQL',
  csv: 'CSV',
  json: 'JSON',
  html: 'HTML',
  css: 'CSS',
  ui: 'UI',
  vm: 'VM',
  fs: 'FS',
  git: 'Git',
  llm: 'LLM',
  ocr: 'OCR',
};

const MINOR_WORDS = new Set(['to', 'a', 'an', 'the', 'in', 'on', 'at', 'by', 'for', 'of', 'and', 'with', 'from']);

/**
 * Normalizes a raw tool name into a human-friendly string without underscores or awkward casing.
 * Example: 'todo_write' -> 'Todo Write'
 * Example: 'mcp__github__create_issue' -> 'Create Issue'
 * Example: 'fetch_url' -> 'Fetch URL'
 */
export function normalizeToolName(toolName?: string | null): string {
  if (!toolName) return '';

  const trimmed = toolName.trim();
  const lower = trimmed.toLowerCase();

  // 1. Direct override lookup
  if (TOOL_NAME_OVERRIDES[lower]) {
    return TOOL_NAME_OVERRIDES[lower];
  }

  // 2. Strip namespace prefixes: "mcp__github__create_issue" -> "create_issue", "default_api:run_command" -> "run_command"
  let clean = trimmed;
  if (clean.includes(':')) {
    const parts = clean.split(':');
    clean = parts[parts.length - 1];
  } else if (clean.includes('__')) {
    const parts = clean.split('__');
    clean = parts[parts.length - 1];
  } else if (clean.includes('.') && !clean.includes(' ') && !clean.includes('/')) {
    const parts = clean.split('.');
    clean = parts[parts.length - 1];
  }

  const cleanLower = clean.toLowerCase();
  if (TOOL_NAME_OVERRIDES[cleanLower]) {
    return TOOL_NAME_OVERRIDES[cleanLower];
  }

  // 3. Convert camelCase and replace underscores/hyphens with spaces
  const spaced = clean
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-]+/g, ' ')
    .trim();

  if (!spaced) return '';

  // 4. Word-by-word formatting with acronym recognition and title casing
  const words = spaced.split(/\s+/);
  const formatted = words.map((w, idx) => {
    const wLower = w.toLowerCase();
    if (ACRONYMS[wLower]) {
      return ACRONYMS[wLower];
    }
    if (idx > 0 && MINOR_WORDS.has(wLower)) {
      return wLower;
    }
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  });

  return formatted.join(' ');
}
