import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../..');

describe('interactive automation permission gate', () => {
  it('uses in-place permission check for navis and computer_use before execution', () => {
    const navisSource = fs.readFileSync(path.join(root, '../tools/navis/tool.ts'), 'utf-8');
    const computerUseSource = fs.readFileSync(path.join(root, '../tools/computer-use.ts'), 'utf-8');

    expect(navisSource).toContain("checkToolPermission('navis'");
    expect(computerUseSource).toContain("checkToolPermission('computer_use'");
  });

  it('bypasses the prompt for scheduled/background runs only', () => {
    const graphSource = fs.readFileSync(path.join(root, 'graph.ts'), 'utf-8');
    const runnerSource = fs.readFileSync(path.join(root, 'runner.ts'), 'utf-8');
    const stateSource = fs.readFileSync(path.join(root, 'state.ts'), 'utf-8');

    expect(stateSource).toContain('isScheduledTaskRun: Annotation<boolean>()');
    expect(runnerSource).toContain('isScheduledTaskRun: !!isBackground');
    expect(graphSource).toContain("state.isScheduledTaskRun || state.currentIntent === 'background_task'");
  });

  it('documents that navis/computer_use require permission outside scheduled tasks', () => {
    const prompt = fs.readFileSync(path.join(root, '../prompts/SYSTEM_PROMPT.md'), 'utf-8');

    expect(prompt).toContain('Starting `navis` or `computer_use` from a normal chat');
    expect(prompt).toContain('Using `navis` or `computer_use` inside a scheduled task/background run');
  });
});
