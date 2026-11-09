/**
 * Per-run research findings.
 *
 * Historically every run read the same ~/.everfern/findings.md, so a different
 * task in the same worker inherited the previous task's findings and Navis kept
 * acting on it. Findings are now scoped to a single agent run.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export function findingsFileFor(runner: any): string {
  const runId = String(runner?.currentRunId || runner?.currentConversationId || 'default')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .slice(0, 120);
  return path.join(os.homedir(), '.everfern', 'run-findings', `${runId}.md`);
}

/** Newest first, capped so a huge extraction cannot flood the prompt. */
export function readRunFindings(runner: any, maxChars = 4000): string {
  try {
    const file = findingsFileFor(runner);
    if (!fs.existsSync(file)) return '';
    const text = fs.readFileSync(file, 'utf8').trim();
    if (!text) return '';
    return text.length > maxChars ? text.slice(0, maxChars) : text;
  } catch {
    return '';
  }
}

export function appendRunFinding(runner: any, entry: string): void {
  try {
    const file = findingsFileFor(runner);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    let existing = '';
    try { existing = fs.readFileSync(file, 'utf8'); } catch { /* new file */ }
    fs.writeFileSync(file, `${String(entry).trim()}\n\n${existing}`.trim() + '\n', 'utf8');
  } catch { /* findings are best-effort */ }
}

export function clearRunFindings(runner: any): void {
  try { fs.rmSync(findingsFileFor(runner), { force: true }); } catch { /* ignore */ }
}
