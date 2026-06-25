import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface SiteMeta {
  id: string; // filename or foldername
  chatId: string;
  name: string;
  lastEdited: number;
  size: number;
  path: string;
}

const SITES_DIR = path.join(os.homedir(), '.everfern', 'sites');

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

/**
 * Lists all generated sites/reports.
 */
export async function listSites(chatId?: string): Promise<SiteMeta[]> {
  if (!(await exists(SITES_DIR))) return [];

  const results: SiteMeta[] = [];
  try {
    let dirs: string[] = [];
    if (chatId) {
      dirs = [chatId];
    } else {
      const entries = await fs.promises.readdir(SITES_DIR);
      for (const f of entries) {
        const stat = await fs.promises.stat(path.join(SITES_DIR, f));
        if (stat.isDirectory()) dirs.push(f);
      }
    }
    
    for (const dir of dirs) {
      const dirPath = path.join(SITES_DIR, dir);
      if (!(await exists(dirPath))) continue;
      
      const entries = await fs.promises.readdir(dirPath);
      const files = entries.filter(f => f.endsWith('.html'));
      
      for (const file of files) {
        const filePath = path.join(dirPath, file);
        if (!(await exists(filePath))) continue;
        const stats = await fs.promises.stat(filePath);
        results.push({
          id: file,
          chatId: dir,
          name: file,
          lastEdited: stats.mtimeMs,
          size: stats.size,
          path: filePath
        });
      }
    }
  } catch (e) {
    console.error('[SitesStore] List failed:', e);
  }
  return results.sort((a, b) => b.lastEdited - a.lastEdited);
}

/**
 * Reads a site file (usually index.html).
 */
export async function readSiteFile(chatId: string, filename: string): Promise<string | null> {
  const p = path.join(SITES_DIR, chatId, filename);
  if (!(await exists(p))) return null;
  try {
    return await fs.promises.readFile(p, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Writes a file to a site project.
 */
export async function writeSiteFile(chatId: string, filename: string, content: string): Promise<{ success: boolean; error?: string }> {
  try {
    const dir = path.join(SITES_DIR, chatId);
    if (!(await exists(dir))) await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(path.join(dir, filename), content, 'utf-8');
    return { success: true };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

/**
 * Deletes a site project or file.
 */
export async function deleteSite(chatId: string, filename?: string): Promise<{ success: boolean }> {
  try {
    const p = filename ? path.join(SITES_DIR, chatId, filename) : path.join(SITES_DIR, chatId);
    if (await exists(p)) {
      const stats = await fs.promises.stat(p);
      if (stats.isDirectory()) {
        await fs.promises.rm(p, { recursive: true, force: true });
      } else {
        await fs.promises.unlink(p);
      }
    }
    return { success: true };
  } catch {
    return { success: false };
  }
}
