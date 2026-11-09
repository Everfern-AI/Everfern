import { describe, expect, it } from 'vitest';
import { truncateTools } from '../tool-truncator';

const def = (name: string) =>
  ({ name, description: name, parameters: { type: 'object', properties: {} } }) as any;

/**
 * Regression: the schema truncator used to drop every worker/Sheets tool because
 * they had no category mapping. A worker then ran without sheets_write and could
 * never populate the spreadsheet. These primitives must never be truncated.
 */
describe('tool-truncator worker/sheets primitives', () => {
  it('keeps worker and native Sheets tools for an unrelated task', () => {
    const always = [
      'ask_user_question', 'terminal_status', 'navis', 'computer_use', 'skill',
      'create_artifact', 'edit_artifact', 'visualize', 'present_files',
      'todo_write', 'memory_save', 'memory_search',
    ].map(def);
    const workers = [
      'open_app', 'switch_app', 'list_apps', 'close_app',
      'worker_list_files', 'worker_read_file', 'worker_write_file', 'worker_bash',
      'sheets_read', 'sheets_write', 'sheets_append', 'sheets_clear',
      'sheets_import', 'sheets_export', 'worker_click', 'worker_type', 'worker_describe',
    ].map(def);
    const filler = Array.from({ length: 40 }, (_, i) => def(`misc_tool_${i}`));

    const result = truncateTools([...always, ...workers, ...filler], 'tell me a joke', '');
    const kept = new Set(result.tools.map((t) => t.name));

    for (const name of workers.map((d) => d.name)) {
      expect(kept.has(name), `${name} should be kept`).toBe(true);
    }
    expect(result.removed).not.toContain('sheets_write');
    expect(result.removed).not.toContain('worker_click');
  });
});
