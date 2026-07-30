import * as fs from 'fs/promises';
import * as path from 'path';
import type { AgentTool, ToolResult } from '../runner/types';

type SystemFilesAction = 'list' | 'mkdirp' | 'move' | 'rename' | 'delete';

function isInsideRoot(rootAbs: string, candidateAbs: string): boolean {
  const rel = path.relative(rootAbs, candidateAbs);
  if (!rel || rel === '') return true;
  const posixRel = rel.replace(/\\/g, '/');
  // Prevent path traversal across Windows and POSIX systems
  return !posixRel.startsWith('../') && posixRel !== '..' && !path.isAbsolute(posixRel);
}

function resolveUnderRoot(rootAbs: string, p: string): string {
  const abs = path.resolve(rootAbs, p);
  if (!isInsideRoot(rootAbs, abs)) {
    throw new Error(`Path is outside the shared root folder: ${p}`);
  }
  return abs;
}

async function listDirRecursive(rootAbs: string, maxEntries: number): Promise<Array<{ path: string; type: 'file' | 'dir'; size?: number }>> {
  const results: Array<{ path: string; type: 'file' | 'dir'; size?: number }> = [];

  // Breadth-first scan: process all files at current level before recursing into subdirs
  // This ensures top-level user files (fonts, docs, images) are captured first
  const walk = async (dirAbs: string) => {
    if (results.length >= maxEntries) return;
    let entries;
    try {
      entries = await fs.readdir(dirAbs, { withFileTypes: true });
    } catch {
      return; // Skip directories we can't read
    }

    // Separate files and dirs — process files FIRST (breadth-first)
    const files = entries.filter(e => !e.isDirectory());
    const dirs = entries.filter(e => e.isDirectory());

    // Add files at this level first
    for (const ent of files) {
      if (results.length >= maxEntries) return;
      const abs = path.join(dirAbs, ent.name);
      const rel = path.relative(rootAbs, abs);
      try {
        const st = await fs.stat(abs);
        results.push({ path: rel, type: 'file', size: st.size });
      } catch {
        results.push({ path: rel, type: 'file' });
      }
    }

    // Then add dirs and recurse (skip hidden/dot folders like .cache, .local, etc.)
    const visibleDirs = dirs.filter(d => !d.name.startsWith('.'));
    for (const ent of visibleDirs) {
      if (results.length >= maxEntries) return;
      const abs = path.join(dirAbs, ent.name);
      const rel = path.relative(rootAbs, abs);
      results.push({ path: rel, type: 'dir' });
      await walk(abs);
    }
  };

  await walk(rootAbs);
  return results;
}

export const systemFilesTool: AgentTool = {
  name: 'system_files',
  description:
    '[SURGICAL-DISCIPLINE] Manage, organize, move, rename, list, and delete files and folders on the local filesystem. ' +
    'Use this tool for file structure operations. For content changes, ALWAYS prefer the "edit" tool for surgical precision. ' +
    'Workflow: 1) list files, 2) mkdirp target folders, 3) move files into them. ' +
    'Never delete files without explicit confirmation.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: 'The filesystem action to perform.',
        enum: ['list', 'mkdirp', 'move', 'rename', 'delete'],
      },
      root: {
        type: 'string',
        description: 'Absolute path of the shared root folder. All operations are constrained to this folder.',
      },
      path: {
        type: 'string',
        description: 'Relative path (inside root) for list/mkdirp/delete.',
      },
      from: {
        type: 'string',
        description: 'Relative source path (inside root) for move/rename.',
      },
      to: {
        type: 'string',
        description: 'Relative destination path (inside root) for move/rename.',
      },
      recursive: {
        type: 'boolean',
        description: 'For delete: delete directories recursively.',
      },
      maxEntries: {
        type: 'number',
        description: 'For list: maximum entries to return (default 500).',
      },
    },
    required: ['action', 'root'],
  },

  async execute(args: Record<string, unknown>, onUpdate?: (msg: string) => void, emitEvent?: (event: any) => void, toolCallId?: string): Promise<ToolResult> {
    try {
      const action = args.action as SystemFilesAction;
      const root = String(args.root ?? '').trim();
      if (!root) throw new Error('root is required');
      const rootAbs = path.resolve(root);

      // Ensure root exists and is a directory
      const rootStat = await fs.stat(rootAbs);
      if (!rootStat.isDirectory()) throw new Error('root must be a directory');

      if (action === 'list') {
        const rel = typeof args.path === 'string' && args.path.trim() ? args.path.trim() : '.';
        const dirAbs = resolveUnderRoot(rootAbs, rel);
        const maxEntries = typeof args.maxEntries === 'number' && Number.isFinite(args.maxEntries) ? Math.max(1, Math.floor(args.maxEntries)) : 500;

        const st = await fs.stat(dirAbs);
        if (!st.isDirectory()) throw new Error('path must be a directory for list');

        const entries = await listDirRecursive(dirAbs, maxEntries);

        // Build a smart summary for the model: group by extension, list relevant files
        const dirs = entries.filter(e => e.type === 'dir');
        const files = entries.filter(e => e.type === 'file');
        const extGroups: Record<string, string[]> = {};
        for (const f of files) {
          const ext = f.path.split('.').pop()?.toLowerCase() || 'no-ext';
          if (!extGroups[ext]) extGroups[ext] = [];
          extGroups[ext].push(f.path);
        }

        // Sort groups by count descending
        const sortedExts = Object.entries(extGroups).sort((a, b) => b[1].length - a[1].length);
        let summary = `📂 ${entries.length} entries (${dirs.length} folders, ${files.length} files) under ${rel === '.' ? 'root' : rel}.\n\n`;
        summary += `**Files by type:**\n`;
        for (const [ext, paths] of sortedExts) {
          if (paths.length <= 8) {
            summary += `- .${ext} (${paths.length}): ${paths.join(', ')}\n`;
          } else {
            summary += `- .${ext} (${paths.length}): ${paths.slice(0, 5).join(', ')} ... and ${paths.length - 5} more\n`;
          }
        }
        if (dirs.length > 0 && dirs.length <= 20) {
          summary += `\n**Folders:** ${dirs.map(d => d.path).join(', ')}\n`;
        } else if (dirs.length > 20) {
          summary += `\n**Folders (${dirs.length}):** ${dirs.slice(0, 10).map(d => d.path).join(', ')} ... and ${dirs.length - 10} more\n`;
        }

        // Highlight known actionable categories
        const categories: Array<{ name: string; icon: string; exts: string[]; folderHint: string }> = [
          { name: 'Font', icon: '🔤', exts: ['ttf', 'otf', 'woff', 'woff2', 'fon'], folderHint: 'Fonts' },
          { name: 'Image', icon: '🖼️', exts: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp', 'tiff'], folderHint: 'Images' },
          { name: 'Video', icon: '🎬', exts: ['mp4', 'mkv', 'avi', 'mov', 'webm', 'flv', 'wmv'], folderHint: 'Videos' },
          { name: 'Audio', icon: '🎵', exts: ['mp3', 'wav', 'flac', 'aac', 'ogg', 'wma', 'm4a'], folderHint: 'Audio' },
          { name: 'Archive', icon: '📦', exts: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2'], folderHint: 'Archives' },
          { name: 'Document', icon: '📝', exts: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'], folderHint: 'Documents' },
        ];
        for (const cat of categories) {
          const matches = files.filter(f => cat.exts.includes(f.path.split('.').pop()?.toLowerCase() || ''));
          if (matches.length > 0) {
            summary += `\n${cat.icon} **${cat.name} files (${matches.length}):** ${matches.length <= 15 ? matches.map(f => f.path).join(', ') : matches.slice(0, 10).map(f => f.path).join(', ') + ` ... and ${matches.length - 10} more`}\n`;
            summary += `→ Organize into "${cat.folderHint}" folder with mkdirp + move.\n`;
          }
        }

        return {
          success: true,
          output: summary.trim(),
          data: { root: rootAbs, path: rel, entries },
        };
      }

      if (action === 'mkdirp') {
        const rel = String(args.path ?? '').trim();
        if (!rel) throw new Error('path is required for mkdirp');
        const targetAbs = resolveUnderRoot(rootAbs, rel);
        await fs.mkdir(targetAbs, { recursive: true });
        return { success: true, output: `Created directory: ${rel}`, data: { root: rootAbs, path: rel } };
      }

      if (action === 'move' || action === 'rename') {
        const fromRel = String(args.from ?? args.path ?? '').trim();
        const toRel = String(args.to ?? '').trim();
        if (!fromRel) throw new Error(`from (or path) is required for ${action}`);
        if (!toRel) throw new Error(`to is required for ${action}`);

        const fromAbs = resolveUnderRoot(rootAbs, fromRel);
        const toAbs = resolveUnderRoot(rootAbs, toRel);
        await fs.mkdir(path.dirname(toAbs), { recursive: true });
        await fs.rename(fromAbs, toAbs);
        return { success: true, output: `Moved ${fromRel} → ${toRel}`, data: { root: rootAbs, from: fromRel, to: toRel } };
      }

      if (action === 'delete') {
        const rel = String(args.path ?? '').trim();
        if (!rel) throw new Error('path is required for delete');
        const targetAbs = resolveUnderRoot(rootAbs, rel);
        const recursive = args.recursive === true;
        await fs.rm(targetAbs, { recursive, force: false });
        return { success: true, output: `Deleted ${rel}`, data: { root: rootAbs, path: rel, recursive } };
      }

      return { success: false, output: `Unsupported action: ${String(action)}`, error: 'unsupported_action' };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, output: `system_files error: ${message}`, error: message };
    }
  },
};

