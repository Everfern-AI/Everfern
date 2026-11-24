import { describe, expect, it } from 'vitest';
import { truncateTools } from '../tool-truncator';

const def = (name: string) =>
  ({ name, description: name, parameters: { type: 'object', properties: {} } }) as any;

/**
 * Tools from user-connected MCP servers must reach the model when the user names
 * the service ("my github issues"), not only when they say "mcp".
 */
describe('tool-truncator MCP server tools', () => {
  const always = [
    'ask_user_question', 'terminal_status', 'navis', 'computer_use', 'skill',
    'create_artifact', 'edit_artifact', 'visualize', 'present_files',
    'todo_write', 'memory_save', 'memory_search',
  ].map(def);
  const mcp = ['mcp__github__list_issues', 'mcp__github__create_issue', 'mcp__linear_app__search'].map(def);
  const filler = Array.from({ length: 40 }, (_, i) => def(`misc_tool_${i}`));
  const all = [...always, ...mcp, ...filler];

  it('keeps a server\'s tools when the message names the server', () => {
    const kept = new Set(truncateTools(all, 'list my open github issues', '').tools.map(t => t.name));
    expect(kept.has('mcp__github__list_issues')).toBe(true);
    expect(kept.has('mcp__github__create_issue')).toBe(true);
    expect(kept.has('mcp__linear_app__search')).toBe(false);
  });

  it('matches part of a multi-word server name', () => {
    const kept = new Set(truncateTools(all, 'what is in linear this week', '').tools.map(t => t.name));
    expect(kept.has('mcp__linear_app__search')).toBe(true);
  });
});
