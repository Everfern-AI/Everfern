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
 * Lists all artifacts, optionally filtering by chatId and/or projectPath.
 * Scans ~/.everfern/artifacts/ and projectPath/.everfern/artifacts/ if provided.
 */
export function listArtifacts(chatId?: string, projectPath?: string): ArtifactMeta[] {
  const globalArtifactsDir = path.join(os.homedir(), '.everfern', 'artifacts');
  const results: ArtifactMeta[] = [];

  // 1. Scan global artifacts
  if (fs.existsSync(globalArtifactsDir)) {
    let dirsToScan: string[] = [];
    try {
        dirsToScan = chatId ? [chatId] : fs.readdirSync(globalArtifactsDir).filter(f => fs.statSync(path.join(globalArtifactsDir, f)).isDirectory());
    } catch (e) {
        // Continue to project scan
    }

    for (const dir of dirsToScan) {
      const dirPath = path.join(globalArtifactsDir, dir);
      scanDir(dirPath, dir, results);
    }
  }

  // 2. Scan project artifacts if projectPath is provided
  if (projectPath) {
    const projectArtifactsDir = path.join(projectPath, '.everfern', 'artifacts');
    if (fs.existsSync(projectArtifactsDir)) {
      scanDir(projectArtifactsDir, 'project', results);
    }
  }

  // Sort by newest first
  return results.sort((a, b) => b.lastEdited - a.lastEdited);
}

function scanDir(dirPath: string, chatId: string, results: ArtifactMeta[]) {
  if (!fs.existsSync(dirPath)) return;

  let files: string[] = [];
  try {
      files = fs.readdirSync(dirPath).filter(f => fs.statSync(path.join(dirPath, f)).isFile());
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
        const stats = fs.statSync(filePath);
        // Read snippet securely if text, otherwise show binary file info
        let snippet = '';
        const isText = ['.html', '.htm', '.txt', '.md', '.json', '.csv'].includes(ext);
        if (isText) {
          const content = fs.readFileSync(filePath, 'utf-8');
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
export function readArtifact(chatId: string, filename: string, projectPath?: string): string | null {
  let filepath: string;
  
  if (projectPath && chatId === 'project') {
    filepath = path.join(projectPath, '.everfern', 'artifacts', filename);
  } else {
    filepath = path.join(os.homedir(), '.everfern', 'artifacts', chatId, filename);
  }

  if (fs.existsSync(filepath)) {
    try {
        return fs.readFileSync(filepath, 'utf-8');
    } catch (e) {
        return null;
    }
  }
  return null;
}

/**
 * Writes (creates or overwrites) an artifact file.
 */
export function writeArtifact(chatId: string, filename: string, content: string, projectPath?: string): { success: boolean; error?: string } {
  try {
    let dir: string;
    if (projectPath) {
      dir = path.join(projectPath, '.everfern', 'artifacts');
    } else {
      dir = path.join(os.homedir(), '.everfern', 'artifacts', chatId);
    }
    
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, filename), content, 'utf-8');
    return { success: true };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

/**
 * Deletes an artifact file.
 */
export function deleteArtifact(chatId: string, filename: string, projectPath?: string): { success: boolean } {
  try {
    let p: string;
    if (projectPath && chatId === 'project') {
      p = path.join(projectPath, '.everfern', 'artifacts', filename);
    } else {
      p = path.join(os.homedir(), '.everfern', 'artifacts', chatId, filename);
    }
    
    if (fs.existsSync(p)) fs.unlinkSync(p);
    return { success: true };
  } catch {
    return { success: false };
  }
}

/**
 * Writes an artifact file atomically using a temporary file.
 * This prevents corruption if the write operation is interrupted.
 */
export function writeArtifactAtomic(chatId: string, filename: string, content: string, projectPath?: string): { success: boolean; error?: string } {
  try {
    let dir: string;
    if (projectPath) {
      dir = path.join(projectPath, '.everfern', 'artifacts');
    } else {
      dir = path.join(os.homedir(), '.everfern', 'artifacts', chatId);
    }
    
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const filePath = path.join(dir, filename);
    const tempPath = `${filePath}.tmp`;

    // Write to temporary file
    fs.writeFileSync(tempPath, content, 'utf-8');

    // Atomic rename
    fs.renameSync(tempPath, filePath);

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
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
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
export function updateArtifactTimestamp(chatId: string, filename: string, projectPath?: string): { success: boolean; error?: string } {
  try {
    let filePath: string;
    if (projectPath && chatId === 'project') {
      filePath = path.join(projectPath, '.everfern', 'artifacts', filename);
    } else {
      filePath = path.join(os.homedir(), '.everfern', 'artifacts', chatId, filename);
    }
    
    if (!fs.existsSync(filePath)) {
      return { success: false, error: 'Artifact file not found' };
    }

    const now = new Date();
    fs.utimesSync(filePath, now, now);

    return { success: true };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}
