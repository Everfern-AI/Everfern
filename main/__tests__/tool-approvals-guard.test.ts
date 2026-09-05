/**
 * Guard tests for main/store/tool-approvals — pins two fixes in place:
 *
 * MP-SEC-08 (quote-aware safe-prefix screen): isApproved() may only
 * auto-approve a cmdTool command under the built-in safe prefixes when the
 * WHOLE command is free of unquoted shell metacharacters (; & | ` $ ( ) < >
 * redirection writes, and newline/CR). Inside double quotes, ` and $ still
 * disqualify because bash performs substitution there; single quotes are
 * fully literal (quoted > < are plain characters). Prefix matching is also
 * exact-token at the head, so 'ls' cannot approve 'lsassdump'.
 *
 * MP-CORR-22 (session-scoped policies never persisted): addPolicy() keeps
 * conversationId-bearing policies memory-only, and updatePolicy()'s save()
 * filters them out of the on-disk JSON so a reload can never resurrect a
 * session approval as a global one.
 *
 * Every store instance is constructed with a unique temp filePath under
 * os.tmpdir() so ~/.everfern is never touched (importing the module itself is
 * harmless — the exported singleton only reads on construction).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { ToolApprovalStore } from '../store/tool-approvals';

let tmpDir = '';
let filePath = '';

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ta-guard-'));
  filePath = path.join(tmpDir, 'tool-approvals.json');
});

afterEach(() => {
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

describe('MP-SEC-08 quote-aware safe-prefix screen', () => {
  function approvedWithEmptyStore(command: string): boolean {
    const store = new ToolApprovalStore(filePath);
    return store.isApproved('terminal_execute', { command });
  }

  it("rejects 'ls; rm -rf ~' despite matching the 'ls' safe prefix", () => {
    expect(approvedWithEmptyStore('ls; rm -rf ~')).toBe(false);
  });

  it("approves plain 'ls'", () => {
    expect(approvedWithEmptyStore('ls')).toBe(true);
  });

  it("approves 'ls -la'", () => {
    expect(approvedWithEmptyStore('ls -la')).toBe(true);
  });

  it("approves 'echo \"a;b\"' — semicolon inside double quotes is not chaining", () => {
    expect(approvedWithEmptyStore('echo "a;b"')).toBe(true);
  });

  it("approves \"echo 'a;b'\" — single quotes are fully literal", () => {
    expect(approvedWithEmptyStore("echo 'a;b'")).toBe(true);
  });

  it("rejects 'dir & format c:'", () => {
    expect(approvedWithEmptyStore('dir & format c:')).toBe(false);
  });

  it("rejects 'ls | wc -l'", () => {
    expect(approvedWithEmptyStore('ls | wc -l')).toBe(false);
  });

  it("rejects 'ls $(whoami)' — unquoted $ substitution", () => {
    expect(approvedWithEmptyStore('ls $(whoami)')).toBe(false);
  });

  it("rejects 'ls `id`' — unquoted backtick substitution", () => {
    expect(approvedWithEmptyStore('ls `id`')).toBe(false);
  });

  it("rejects 'git status&&rm x'", () => {
    expect(approvedWithEmptyStore('git status&&rm x')).toBe(false);
  });

  it("rejects a real newline: 'ls\\nrm -rf ~'", () => {
    expect(approvedWithEmptyStore('ls\nrm -rf ~')).toBe(false);
  });

  it("rejects 'echo \"hi$(id)\"' — substitution inside double quotes fails closed", () => {
    expect(approvedWithEmptyStore('echo "hi$(id)"')).toBe(false);
  });

  it("rejects 'echo x > ~/evil' — unquoted > redirection write", () => {
    expect(approvedWithEmptyStore('echo x > ~/evil')).toBe(false);
  });

  it("rejects 'ls >> log' — unquoted >> append", () => {
    expect(approvedWithEmptyStore('ls >> log')).toBe(false);
  });

  it("rejects 'git status > p.ps1' — unquoted > redirection write", () => {
    expect(approvedWithEmptyStore('git status > p.ps1')).toBe(false);
  });

  it("rejects 'cat < /etc/passwd' — unquoted < redirection (cat is not even a safe prefix)", () => {
    expect(approvedWithEmptyStore('cat < /etc/passwd')).toBe(false);
  });

  it("rejects a real carriage return: 'ls\\rrm -rf ~'", () => {
    expect(approvedWithEmptyStore('ls\rrm -rf ~')).toBe(false);
  });

  it("rejects 'lsassdump' — prefix match is exact-token at the head", () => {
    expect(approvedWithEmptyStore('lsassdump')).toBe(false);
  });

  it("rejects 'lsof -i' — not a safe prefix despite sharing the 'ls' head", () => {
    expect(approvedWithEmptyStore('lsof -i')).toBe(false);
  });

  it("approves 'dir /b'", () => {
    expect(approvedWithEmptyStore('dir /b')).toBe(true);
  });

  it("approves 'node -v'", () => {
    expect(approvedWithEmptyStore('node -v')).toBe(true);
  });

  it("approves 'echo \"a>b\"' — quoted > is a literal character, not redirection", () => {
    expect(approvedWithEmptyStore('echo "a>b"')).toBe(true);
  });

  it("approves \"echo 'x>y'\" — single quotes are fully literal", () => {
    expect(approvedWithEmptyStore("echo 'x>y'")).toBe(true);
  });

  it("rejects 'echo hi > out.txt' — unquoted > outside the quoted span", () => {
    expect(approvedWithEmptyStore('echo hi > out.txt')).toBe(false);
  });
});

describe('MP-CORR-22 scoped-policy persistence', () => {
  it('updatePolicy/save persists only global policies; session-scoped ones stay memory-only', () => {
    const store1 = new ToolApprovalStore(filePath);
    const globalP = store1.addPolicy({ type: 'prefix', toolName: 'bash', pattern: 'git push' });
    const scopedP = store1.addPolicy({
      type: 'prefix',
      toolName: 'bash',
      pattern: 'npm test',
      conversationId: 'conv-A',
    });
    expect(globalP.conversationId).toBeUndefined();
    expect(scopedP.conversationId).toBe('conv-A');

    store1.updatePolicy(globalP.id, { pattern: 'git pull' });
    // Scoped update still triggers save() — the filter must drop it on write.
    store1.updatePolicy(scopedP.id, { pattern: 'npm run test:all' });

    const store2 = new ToolApprovalStore(filePath); // reload straight from disk
    const reloaded = store2.getPolicies();

    expect(reloaded.filter((p) => p.conversationId !== undefined)).toHaveLength(0);
    expect(reloaded).toHaveLength(1);
    expect(reloaded[0].pattern).toBe('git pull');

    expect(store2.getPolicies().some((p) => p.pattern === 'npm run test:all')).toBe(false);
  }, 5000);

  it('on-disk JSON contains exactly one entry and no conversationId key anywhere', () => {
    const store1 = new ToolApprovalStore(filePath);
    store1.addPolicy({ type: 'prefix', toolName: 'bash', pattern: 'git push' });
    const scopedP = store1.addPolicy({
      type: 'prefix',
      toolName: 'bash',
      pattern: 'npm test',
      conversationId: 'conv-A',
    });
    store1.updatePolicy(scopedP.id, { pattern: 'npm run test:all' });

    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed).toHaveLength(1);
    expect(raw.includes('conversationId')).toBe(false);
  }, 5000);
});

describe('MP-CORR-22 regression sanity', () => {
  it("approves 'git pull origin main' via the persisted policy, not the built-in prefix list", () => {
    const store1 = new ToolApprovalStore(filePath);
    const globalP = store1.addPolicy({ type: 'prefix', toolName: 'bash', pattern: 'git push' });
    const scopedP = store1.addPolicy({
      type: 'prefix',
      toolName: 'bash',
      pattern: 'npm test',
      conversationId: 'conv-A',
    });
    store1.updatePolicy(globalP.id, { pattern: 'git pull' });
    store1.updatePolicy(scopedP.id, { pattern: 'npm run test:all' });

    const store2 = new ToolApprovalStore(filePath);
    // 'git pull' is not in safePrefixes, so this approval can only come from
    // the persisted explicit policy.
    expect(store2.isApproved('bash', { command: 'git pull origin main' })).toBe(true);
  }, 5000);

  it('a fresh empty store does not auto-approve beyond the built-in safe list', () => {
    const bare = new ToolApprovalStore(path.join(tmpDir, 'bare-tool-approvals.json'));
    expect(bare.getPolicies()).toHaveLength(0);
    expect(bare.isApproved('bash', { command: 'npm run test:all' })).toBe(false);
    expect(bare.isApproved('bash', { command: 'git pull origin main' })).toBe(false);
  }, 5000);
});
