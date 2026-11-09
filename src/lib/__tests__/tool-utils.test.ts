import { describe, it, expect } from 'vitest';
import { normalizeToolName } from '../tool-utils';

describe('normalizeToolName', () => {
  it('handles empty or null inputs', () => {
    expect(normalizeToolName(null)).toBe('');
    expect(normalizeToolName(undefined)).toBe('');
    expect(normalizeToolName('')).toBe('');
    expect(normalizeToolName('   ')).toBe('');
  });

  it('normalizes common tools with underscores into title case', () => {
    expect(normalizeToolName('todo_write')).toBe('Todo Write');
    expect(normalizeToolName('write_to_file')).toBe('Write to File');
    expect(normalizeToolName('read_file')).toBe('Read File');
    expect(normalizeToolName('view_file')).toBe('View File');
    expect(normalizeToolName('edit_file')).toBe('Edit File');
    expect(normalizeToolName('run_command')).toBe('Run Command');
    expect(normalizeToolName('list_dir')).toBe('List Directory');
    expect(normalizeToolName('grep_search')).toBe('Grep Search');
    expect(normalizeToolName('web_search')).toBe('Web Search');
    expect(normalizeToolName('computer_use')).toBe('Computer Use');
    expect(normalizeToolName('take_screenshot')).toBe('Take Screenshot');
    expect(normalizeToolName('system_files')).toBe('File System');
  });

  it('strips namespaces and prefixes', () => {
    expect(normalizeToolName('mcp__github__create_issue')).toBe('Create Issue');
    expect(normalizeToolName('default_api:run_command')).toBe('Run Command');
    expect(normalizeToolName('tools.fetch_weather')).toBe('Fetch Weather');
  });

  it('preserves uppercase for known acronyms', () => {
    expect(normalizeToolName('fetch_url')).toBe('Fetch URL');
    expect(normalizeToolName('generate_pdf')).toBe('Generate PDF');
    expect(normalizeToolName('call_api')).toBe('Call API');
    expect(normalizeToolName('query_sql')).toBe('Query SQL');
    expect(normalizeToolName('parse_json')).toBe('Parse JSON');
  });

  it('handles kebab-case and camelCase tools', () => {
    expect(normalizeToolName('batch-write')).toBe('Batch Write');
    expect(normalizeToolName('createArtifact')).toBe('Create Artifact');
  });
});
