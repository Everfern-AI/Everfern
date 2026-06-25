import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface ArtifactMeta {
  id: string;
  chatId: string;
  name: string;
  lastEdited: number;
  snippet: string;
  size: number;
  template?: string;
  editCount?: number;
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

/**
 * Lists all artifacts, optionally filtering by chatId and/or projectPath.
 * Scans ~/.everfern/artifacts/ and projectPath/.everfern/artifacts/ if provided.
 */
export async function listArtifacts(chatId?: string, projectPath?: string): Promise<ArtifactMeta[]> {
  const globalArtifactsDir = path.join(os.homedir(), '.everfern', 'artifacts');
  const results: ArtifactMeta[] = [];

  // 1. Scan global artifacts
  if (await exists(globalArtifactsDir)) {
    let dirsToScan: string[] = [];
    try {
      if (chatId) {
        dirsToScan = [chatId];
      } else {
        const entries = await fs.promises.readdir(globalArtifactsDir);
        for (const f of entries) {
          const stat = await fs.promises.stat(path.join(globalArtifactsDir, f));
          if (stat.isDirectory()) dirsToScan.push(f);
        }
      }
    } catch (e) {
      // Continue to project scan
    }

    for (const dir of dirsToScan) {
      const dirPath = path.join(globalArtifactsDir, dir);
      await scanDir(dirPath, dir, results);
    }
  }

  // 2. Scan project artifacts if projectPath is provided
  if (projectPath) {
    const projectArtifactsDir = path.join(projectPath, '.everfern', 'artifacts');
    if (await exists(projectArtifactsDir)) {
      await scanDir(projectArtifactsDir, 'project', results);
    }
  }

  // Sort by newest first
  return results.sort((a, b) => b.lastEdited - a.lastEdited);
}

async function scanDir(dirPath: string, chatId: string, results: ArtifactMeta[]) {
  if (!(await exists(dirPath))) return;

  let files: string[] = [];
  try {
    const entries = await fs.promises.readdir(dirPath);
    for (const f of entries) {
      const stat = await fs.promises.stat(path.join(dirPath, f));
      if (stat.isFile()) files.push(f);
    }
  } catch (e) {
    return;
  }

  for (const file of files) {
    if (file.startsWith('.')) continue;
    const ext = path.extname(file).toLowerCase();
    const ALLOWED_EXTS = ['.html', '.htm', '.txt', '.md', '.json', '.pdf', '.xlsx', '.xls', '.csv', '.png', '.jpg', '.jpeg', '.pptx', '.ppt'];
    if (!ALLOWED_EXTS.includes(ext)) continue;

    const filePath = path.join(dirPath, file);
    try {
      const stats = await fs.promises.stat(filePath);
      // Read snippet securely if text, otherwise show binary file info
      let snippet = '';
      const isText = ['.html', '.htm', '.txt', '.md', '.json', '.csv'].includes(ext);
      if (isText) {
        const content = await fs.promises.readFile(filePath, 'utf-8');
        snippet = content.slice(0, 500).trim();
      } else {
        snippet = `[Binary File] Size: ${(stats.size / 1024).toFixed(2)} KB`;
      }

      results.push({
        id: file,
        chatId: chatId,
        name: file,
        lastEdited: stats.mtimeMs,
        snippet,
        size: stats.size
      });
    } catch (e) {
      console.error(`Failed to read artifact ${filePath}:`, e);
    }
  }
}

/**
 * Reads the actual content of an artifact.
 */
export async function readArtifact(chatId: string, filename: string, projectPath?: string): Promise<string | null> {
  let filepath: string;
  
  if (projectPath && chatId === 'project') {
    filepath = path.join(projectPath, '.everfern', 'artifacts', filename);
  } else {
    filepath = path.join(os.homedir(), '.everfern', 'artifacts', chatId, filename);
  }

  if (await exists(filepath)) {
    try {
      const ext = path.extname(filepath).toLowerCase();
      if (ext === '.pdf') {
        const mimeType = 'application/pdf';
        const buf = await fs.promises.readFile(filepath);
        const base64 = buf.toString('base64');
        return `data:${mimeType};base64,${base64}`;
      }
      return await fs.promises.readFile(filepath, 'utf-8');
    } catch (e) {
      return null;
    }
  }
  return null;
}

/**
 * Writes (creates or overwrites) an artifact file.
 */
export async function writeArtifact(chatId: string, filename: string, content: string, projectPath?: string): Promise<{ success: boolean; error?: string }> {
  try {
    let dir: string;
    if (projectPath) {
      dir = path.join(projectPath, '.everfern', 'artifacts');
    } else {
      dir = path.join(os.homedir(), '.everfern', 'artifacts', chatId);
    }
    
    if (!(await exists(dir))) {
      await fs.promises.mkdir(dir, { recursive: true });
    }
    await fs.promises.writeFile(path.join(dir, filename), content, 'utf-8');
    return { success: true };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

/**
 * Deletes an artifact file.
 */
export async function deleteArtifact(chatId: string, filename: string, projectPath?: string): Promise<{ success: boolean }> {
  try {
    let p: string;
    if (projectPath && chatId === 'project') {
      p = path.join(projectPath, '.everfern', 'artifacts', filename);
    } else {
      p = path.join(os.homedir(), '.everfern', 'artifacts', chatId, filename);
    }
    
    if (await exists(p)) {
      await fs.promises.unlink(p);
    }
    return { success: true };
  } catch {
    return { success: false };
  }
}

/**
 * Writes an artifact file atomically using a temporary file.
 * This prevents corruption if the write operation is interrupted.
 */
export async function writeArtifactAtomic(chatId: string, filename: string, content: string, projectPath?: string): Promise<{ success: boolean; error?: string }> {
  try {
    let dir: string;
    if (projectPath) {
      dir = path.join(projectPath, '.everfern', 'artifacts');
    } else {
      dir = path.join(os.homedir(), '.everfern', 'artifacts', chatId);
    }
    
    if (!(await exists(dir))) {
      await fs.promises.mkdir(dir, { recursive: true });
    }

    const filePath = path.join(dir, filename);
    const tempPath = `${filePath}.tmp`;

    // Write to temporary file
    await fs.promises.writeFile(tempPath, content, 'utf-8');

    // Atomic rename
    await fs.promises.rename(tempPath, filePath);

    return { success: true };
  } catch (e) {
    // Clean up temporary file if it exists
    try {
      let dir: string;
      if (projectPath) {
        dir = path.join(projectPath, '.everfern', 'artifacts');
      } else {
        dir = path.join(os.homedir(), '.everfern', 'artifacts', chatId);
      }
      const filePath = path.join(dir, filename);
      const tempPath = `${filePath}.tmp`;
      if (await exists(tempPath)) {
        await fs.promises.unlink(tempPath);
      }
    } catch {
      // Ignore cleanup errors
    }
    return { success: false, error: String(e) };
  }
}

/**
 * Updates the last modified timestamp of an artifact file.
 */
export async function updateArtifactTimestamp(chatId: string, filename: string, projectPath?: string): Promise<{ success: boolean; error?: string }> {
  try {
    let filePath: string;
    if (projectPath && chatId === 'project') {
      filePath = path.join(projectPath, '.everfern', 'artifacts', filename);
    } else {
      filePath = path.join(os.homedir(), '.everfern', 'artifacts', chatId, filename);
    }
    
    if (!(await exists(filePath))) {
      return { success: false, error: 'Artifact file not found' };
    }

    const now = new Date();
    await fs.promises.utimes(filePath, now, now);

    return { success: true };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}
