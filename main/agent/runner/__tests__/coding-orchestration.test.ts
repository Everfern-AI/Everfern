import { describe, expect, it } from 'vitest';
import { isProjectScaleCodingText, CODING_TOOL_NAMES, DATA_TOOL_NAMES } from '../graph';
import { truncateTools } from '../tool-truncator';

/**
 * Coding/project orchestration: small fixes go straight to the coding specialist,
 * multi-part builds go through the decomposer, and specialist tool lists name tools
 * that are actually registered.
 */
describe('project-scale coding detection', () => {
  it.each([
    'fix the typo in README.md',
    'why does this function throw on empty input?',
    'fix the null check in src/api/users.ts',
    'rename getUser to fetchUser',
    'add a --verbose flag to the cli parser',
  ])('sends a small change straight to the coding specialist: %s', (text) => {
    expect(isProjectScaleCodingText(text)).toBe(false);
  });

  it.each([
    'build a todo app with React and a SQLite backend',
    'create a landing page for my bakery',
    'scaffold a full-stack dashboard with auth',
    'Please do this:\n1. add login\n2. add signup\n3. add password reset',
  ])('decomposes a multi-part build: %s', (text) => {
    expect(isProjectScaleCodingText(text)).toBe(true);
  });

  it('treats a very long spec as project-scale', () => {
    expect(isProjectScaleCodingText('Change the parser so that '.repeat(40))).toBe(true);
  });
});

describe('specialist tool lists', () => {
  // Names registered by tools_manager.ts and pi-tools.ts.
  const registered = new Set([
    'read', 'write', 'edit', 'find', 'grep', 'ls', 'executePwsh', 'multi_file_edit', 'multi_replace_file_content',
    'task_complete', 'terminal_execute', 'terminal_status', 'spawn_agent', 'ask_user_question', 'todo_write',
    'present_files', 'show_user_url', 'preview_live_url', 'analyze_image', 'web_search', 'web_fetch', 'skill',
    'visualize', 'create_artifact', 'edit_artifact',
  ]);

  it('names only tools that exist', () => {
    for (const name of [...CODING_TOOL_NAMES, ...DATA_TOOL_NAMES]) {
      expect(registered.has(name), name).toBe(true);
    }
  });

  it('gives the data analyst file and chart tools', () => {
    for (const name of ['read', 'write', 'ls', 'terminal_execute', 'visualize', 'create_artifact']) {
      expect(DATA_TOOL_NAMES.has(name), name).toBe(true);
    }
  });

  it('keeps core file tools through truncation when the message has no file keyword', () => {
    const def = (name: string) => ({ name, description: name, parameters: { type: 'object', properties: {} } }) as any;
    const filler = Array.from({ length: 40 }, (_, i) => def(`misc_tool_${i}`));
    const kept = new Set(truncateTools([...['read', 'write', 'ls', 'edit'].map(def), ...filler], 'analyze sales.csv', '').tools.map(t => t.name));
    for (const name of ['read', 'write', 'ls', 'edit']) expect(kept.has(name), name).toBe(true);
  });
});
