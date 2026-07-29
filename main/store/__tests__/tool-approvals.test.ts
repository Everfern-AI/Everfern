import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ToolApprovalStore } from '../tool-approvals';

describe('ToolApprovalStore', () => {
  let testStore: ToolApprovalStore;
  let testFilePath: string;

  beforeEach(() => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'everfern-test-'));
    testFilePath = path.join(tempDir, 'tool-approvals.json');
    testStore = new ToolApprovalStore(testFilePath);
  });

  it('should initialize with empty policies if file does not exist', () => {
    expect(testStore.getPolicies()).toEqual([]);
  });

  it('should add a policy and persist to disk', () => {
    const policy = testStore.addPolicy({
      toolName: 'navis',
      type: 'exact',
      pattern: 'navis',
    });

    expect(policy.id).toBeDefined();
    expect(policy.toolName).toBe('navis');
    expect(policy.type).toBe('exact');
    expect(policy.pattern).toBe('navis');
    expect(testStore.getPolicies()).toHaveLength(1);

    // Verify disk file
    const fileContent = JSON.parse(fs.readFileSync(testFilePath, 'utf8'));
    expect(fileContent).toHaveLength(1);
    expect(fileContent[0].id).toBe(policy.id);
  });

  it('should approve exact matching tools', () => {
    testStore.addPolicy({
      toolName: 'browser_subagent',
      type: 'exact',
      pattern: 'browser_subagent',
    });

    expect(testStore.isApproved('browser_subagent', {})).toBe(true);
    expect(testStore.isApproved('run_command', {})).toBe(false);
  });

  it('should approve prefix matching commands', () => {
    testStore.addPolicy({
      toolName: 'run_command',
      type: 'prefix',
      pattern: 'npm test',
    });

    expect(testStore.isApproved('run_command', { command: 'npm test -- --run' })).toBe(true);
    expect(testStore.isApproved('run_command', { command: 'npm run build' })).toBe(false);
  });

  it('should update an existing policy', () => {
    const policy = testStore.addPolicy({
      toolName: 'run_command',
      type: 'prefix',
      pattern: 'npm',
    });

    const updated = testStore.updatePolicy(policy.id, {
      pattern: 'npm test',
      type: 'exact',
    });

    expect(updated).not.toBeNull();
    expect(updated?.pattern).toBe('npm test');
    expect(updated?.type).toBe('exact');

    const policies = testStore.getPolicies();
    expect(policies[0].pattern).toBe('npm test');
    expect(policies[0].type).toBe('exact');
  });

  it('should delete a policy by ID', () => {
    const policy = testStore.addPolicy({
      toolName: 'navis',
      type: 'exact',
      pattern: 'navis',
    });

    expect(testStore.getPolicies()).toHaveLength(1);
    testStore.deletePolicy(policy.id);
    expect(testStore.getPolicies()).toHaveLength(0);
  });

  it('should clear all policies', () => {
    testStore.addPolicy({ toolName: 'navis', type: 'exact', pattern: 'navis' });
    testStore.addPolicy({ toolName: 'browser_subagent', type: 'exact', pattern: 'browser_subagent' });

    expect(testStore.getPolicies()).toHaveLength(2);
    testStore.clearAllPolicies();
    expect(testStore.getPolicies()).toHaveLength(0);
  });
});
