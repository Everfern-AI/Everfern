import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFile } from 'child_process';
import { assertSafeSegment, resolveWithin } from '../lib/path-guard';

const PLAN_BASE = path.join(os.homedir(), '.everfern', 'chat', 'plan');

function nativePlan<T>(operation: 'list' | 'read' | 'write' | 'delete', chatId: string, filename?: string, content?: string): Promise<T> | undefined {
  const executable = process.env.EF_NATIVE_EXE;
  if (process.env.EVERFERN_SHELL !== 'tauri' || !executable) return undefined;
  return new Promise((resolve, reject) => {
    const child = execFile(executable, ['--ef-plan-store'], {
      windowsHide: true, maxBuffer: 16 * 1024 * 1024,
    }, (error, stdout) => {
      if (error) return reject(error);
      try { resolve(JSON.parse(stdout)); } catch (parseError) { reject(parseError); }
    });
    child.stdin?.once('error', reject);
    child.stdin?.end(JSON.stringify({ operation, chatId, filename, content }));
  });
}

function planDir(chatId: string): string {
  return path.join(PLAN_BASE, assertSafeSegment(chatId, 'chat id'));
}

/**
 * Helper to check if file/dir exists asynchronously
 */
async function exists(p: string): Promise<boolean> {
  try {
    await fs.promises.access(p);
    return true;
  } catch {
    return false;
  }
}

async function ensurePlanDir(chatId: string): Promise<void> {
  const dir = planDir(chatId);
  if (!(await exists(dir))) await fs.promises.mkdir(dir, { recursive: true });
}

/** Write a plan file for a given chat. */
export async function writePlan(chatId: string, filename: string, content: string): Promise<{ success: boolean; error?: string }> {
  try {
    const native = nativePlan<{ success: boolean; error?: string }>('write', chatId, filename, content);
    if (native) return await native;
    await ensurePlanDir(chatId);
    await fs.promises.writeFile(resolveWithin(planDir(chatId), filename), content, 'utf-8');
    return { success: true };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

/** Read a plan file. Returns null if not found. */
export async function readPlan(chatId: string, filename: string): Promise<string | null> {
  const native = nativePlan<string | null>('read', chatId, filename);
  if (native) return native;
  const p = resolveWithin(planDir(chatId), filename);
  if (!(await exists(p))) return null;
  try {
    return await fs.promises.readFile(p, 'utf-8');
  } catch {
    return null;
  }
}

/** Check whether any plan files exist for a chat. Returns the list of filenames. */
export async function listPlans(chatId: string): Promise<string[]> {
  const native = nativePlan<string[]>('list', chatId);
  if (native) return native;
  const dir = planDir(chatId);
  if (!(await exists(dir))) return [];
  try {
    const entries = await fs.promises.readdir(dir);
    const results: string[] = [];
    for (const f of entries) {
      if (f.startsWith('.')) continue;
      const stat = await fs.promises.stat(path.join(dir, f));
      if (stat.isFile()) results.push(f);
    }
    return results;
  } catch {
    return [];
  }
}

/** Delete a single plan file. */
export async function deletePlan(chatId: string, filename: string): Promise<{ success: boolean }> {
  try {
    const native = nativePlan<{ success: boolean }>('delete', chatId, filename);
    if (native) return await native;
    const p = resolveWithin(planDir(chatId), filename);
    if (await exists(p)) await fs.promises.unlink(p);
    return { success: true };
  } catch {
    return { success: false };
  }
}
