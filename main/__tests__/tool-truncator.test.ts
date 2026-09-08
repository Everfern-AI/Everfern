import { describe, it, expect } from 'vitest';

import { truncateTools, TOOL_ALWAYS_INCLUDE } from '../agent/runner/tool-truncator';

function toolDef(name: string, description?: string) {
  return { name, description: description ?? `Fixture tool: ${name}`, parameters: {} };
}

const REQUIRED_ALWAYS_INCLUDE = [
  'create_plan',
  'update_plan_step',
  'read',
  'write',
  'grep',
  'find',
  'ls',
  'web_fetch',
  'task_complete',
  'execution_plan',
  'terminal_execute',
  'terminal_status',
  'executePwsh',
  'edit',
  'multi_file_edit',
  'ask_user_question',
  'local_permission',
  'navis',
  'computer_use',
  'skill',
  'create_artifact',
  'edit_artifact',
  'visualize',
  'present_files',
  'todo_write',
  'memory_save',
  'memory_search',
  'web_search',
  'analyze_image',
  'spawn_agent',
  'spawn_swarm',
];

const FORBIDDEN_ALWAYS_INCLUDE = ['bash', 'planner', 'update_step'];

describe('ALWAYS_INCLUDE roster', () => {
  it('contains no duplicate entries', () => {
    expect([...new Set(TOOL_ALWAYS_INCLUDE)]).toHaveLength(TOOL_ALWAYS_INCLUDE.length);
  });

  it('includes every required structural, filesystem, web, and agent tool', () => {
    for (const name of REQUIRED_ALWAYS_INCLUDE) {
      expect(TOOL_ALWAYS_INCLUDE).toContain(name);
    }
  });

  it('does not force-include bash, planner, or update_step', () => {
    for (const name of FORBIDDEN_ALWAYS_INCLUDE) {
      expect(TOOL_ALWAYS_INCLUDE).not.toContain(name);
    }
  });
});

describe('github/create_issue survives aggressive budget', () => {
  const mcpAndAlwaysRoster = [
    'github/create_issue',
    'github/list_pull_requests',
    'slack/send_message',
    'notion/search',
    'read',
    'write',
    'grep',
    'web_search',
    'web_fetch',
    'task_complete',
    'edit',
    'ls',
    'find',
    'create_plan',
    'update_plan_step',
    'execution_plan',
    'terminal_execute',
    'memory_save',
    'spawn_agent',
    'ask_user_question',
    'analyze_data',
    'send_discord_message',
    'read_file',
    'run_sql_query',
    'query_database',
    'schedule_reminder',
    'compose_email',
    'transcribe_audio',
    'zip_archive',
    'merge_branch',
  ].map((name) => toolDef(name));

  it('keeps connected mcp tools while dropping unscored fillers', () => {
    const result = truncateTools(
      mcpAndAlwaysRoster,
      'scrape the documentation page and fetch the api url',
      '',
    );

    const names = result.tools.map((tool) => tool.name);
    expect(names).toContain('github/create_issue');
    expect(names).toContain('github/list_pull_requests');
    expect(names).toContain('slack/send_message');

    expect(result.removed).not.toContain('github/create_issue');
    expect(result.removed).not.toContain('slack/send_message');

    expect(result.removed).toContain('analyze_data');
    expect(result.removed).toContain('send_discord_message');

    expect(result.tools.length).toBeGreaterThanOrEqual(12);
    expect(result.removed.length).toBeGreaterThan(0);
  });
});

describe('server-name trigger fires mcp score', () => {
  it('boosts mcp when a connected server name appears in the task text', () => {
    const roster = [
      'github/create_issue',
      'github/list_pull_requests',
      'slack/send_message',
      'read',
      'task_complete',
      'analyze_data',
    ].map((name) => toolDef(name));

    const result = truncateTools(roster, 'audit the github pipeline before the release', '');

    expect(result.scores.mcp).toBeDefined();
    expect(result.scores.mcp).toBeGreaterThanOrEqual(2);
    expect(result.tools.map((tool) => tool.name)).toContain('github/create_issue');
  });
});

// NOTE: 'planner' and 'update_step' are legacy tool names that are no longer
// always-include but still map to the 'planning' category in TOOL_CATEGORY_MAP,
// which makes them deterministic mid-relevance (0.5) rescue candidates.
const gradedRoster = [
  'planner',
  'read',
  'todo_list',
  'run_sql_query',
  'write',
  'update_step',
  'grep',
  'todo_backlog',
  'read_file',
  'plan_outline',
  'write_to_file',
  'stage_helper',
  'send_email_batch',
  'grep_search',
  'milestone_tracker',
  'task_complete',
  'list_dir',
  'workflow_draft',
  'analyze_csv_data',
  'web_search',
  'schedule_cron_reminder',
  'translate_document',
].map((name) => toolDef(name));

const gradedUserInput = 'read the file then write the file and grep the folder path. follow one plan.';
const gradedOptions = { relevanceThreshold: 4 };

describe('graded rescue lands exactly 12', () => {
  it('rescues mid-relevance planning tools until kept reaches the rescue floor', () => {
    const result = truncateTools(gradedRoster, gradedUserInput, '', gradedOptions);

    expect(result.scores.filesystem).toBeGreaterThanOrEqual(4);
    expect(result.scores.planning).toBeGreaterThanOrEqual(1);
    expect(result.scores.planning).toBeLessThanOrEqual(2);

    expect(result.tools.length).toBe(12);
    expect(result.removed.length).toBe(gradedRoster.length - 12);

    const names = result.tools.map((tool) => tool.name);
    expect(names).toContain('planner');
    expect(names).toContain('todo_list');
    expect(names).toContain('update_step');
    expect(result.removed).not.toContain('planner');
    expect(result.removed).not.toContain('todo_list');
    expect(result.removed).not.toContain('update_step');

    for (const name of ['todo_backlog', 'plan_outline', 'stage_helper', 'milestone_tracker', 'workflow_draft']) {
      expect(result.removed).toContain(name);
    }

    for (const name of ['read_file', 'write_to_file', 'grep_search', 'list_dir']) {
      expect(names).toContain(name);
    }

    for (const name of ['run_sql_query', 'send_email_batch', 'analyze_csv_data', 'schedule_cron_reminder', 'translate_document']) {
      expect(result.removed).toContain(name);
    }
  });
});

describe('full-set last resort', () => {
  it('returns the entire roster when no mid-tier tools exist to rescue', () => {
    const result = truncateTools(
      gradedRoster,
      'read the file then write the file and grep the folder path',
      '',
      { relevanceThreshold: 4 },
    );

    expect(result.tools.map((tool) => tool.name)).toEqual(gradedRoster.map((tool) => tool.name));
    expect(result.removed).toEqual([]);
  });
});

describe('deterministic repeats', () => {
  it('produces identical output for identical input', () => {
    const gradedOptions = { relevanceThreshold: 4 };

    const first = truncateTools(gradedRoster, gradedUserInput, '', gradedOptions);
    const second = truncateTools(gradedRoster, gradedUserInput, '', gradedOptions);

    expect(first.tools.map((tool) => tool.name)).toEqual(second.tools.map((tool) => tool.name));
    expect(first.removed).toEqual(second.removed);
    expect(first.scores).toEqual(second.scores);
  });
});
