import * as fs from 'fs/promises';
import * as path from 'path';
import type { AgentTool, ToolResult } from '../runner/types';
import { getRollbackManager } from '../persistence/rollback-manager';
import { getAgentContext } from './pi-tools';

interface FileEntry {
  path: string;
  content: string;
}

export const batchWriteTool: AgentTool = {
  name: 'batch_write',
  description: 'Write MULTIPLE files in a single tool call. ALWAYS use this when creating or scaffolding a project with multiple files (e.g. Next.js app with pages, components, configs). Provide an array of {path, content} objects — all files are written in parallel. Much faster than calling write() repeatedly.',
  parameters: {
    type: 'object',
    properties: {
      files: {
        type: 'array',
        description: 'Array of files to create. Each entry has a `path` (relative or absolute file path) and `content` (file contents as string).',
        items: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path (absolute, or relative to workspace)' },
            content: { type: 'string', description: 'File content' },
          },
          required: ['path', 'content'],
        },
      },
      root: {
        type: 'string',
        description: 'Optional root directory. If provided, all paths are resolved relative to this directory.',
      },
    },
    required: ['files'],
  },

  async execute(args: Record<string, unknown>, onUpdate?: (msg: string) => void): Promise<ToolResult> {
    const files = args.files as FileEntry[];
    const root = args.root ? String(args.root) : undefined;

    if (!files || !Array.isArray(files) || files.length === 0) {
      return { success: false, output: 'batch_write: files array is required and must not be empty', error: 'invalid_args' };
    }

    // Pre-execution: capture file states for rollback tracking
    // Requirements 4.1, 4.2, 4.3: Track file creation/modification before writing
    const rollbackManager = getRollbackManager();
    const { taskId, stepNumber } = getAgentContext();
    const hasContext = taskId !== undefined && stepNumber !== undefined;

    // Initialize rollback manager if we have context
    if (hasContext) {
      try {
        await rollbackManager.initialize();
      } catch (initError) {
        // Non-fatal: log and continue without rollback tracking
        console.warn('[batch_write] Failed to initialize rollback manager:', initError);
      }
    }

    // Capture pre-existing file states before any writes happen
    // This ensures accurate before-state even in parallel writes
    const preWriteSnapshots = new Map<string, { contentBefore: string; fileExists: boolean }>();

    if (hasContext) {
      await Promise.all(files.map(async (file) => {
        try {
          let filePath = file.path;
          if (root) {
            filePath = path.resolve(root, filePath);
          } else {
            filePath = path.resolve(filePath);
          }

          // Skip excluded files
          if (rollbackManager.isFileExcluded(filePath)) {
            return;
          }

          try {
            const contentBefore = await fs.readFile(filePath, 'utf8');
            preWriteSnapshots.set(filePath, { contentBefore, fileExists: true });
          } catch {
            // File doesn't exist yet — it will be created
            preWriteSnapshots.set(filePath, { contentBefore: '', fileExists: false });
          }
        } catch (err) {
          console.warn('[batch_write] Could not capture pre-write state:', err);
        }
      }));
    }

    const results: string[] = [];
    let errors: string[] = [];

    await Promise.all(files.map(async (file, i) => {
      try {
        let filePath = file.path;
        if (root) {
          filePath = path.resolve(root, filePath);
        } else {
          filePath = path.resolve(filePath);
        }
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, file.content, 'utf8');
        results.push(`[${i + 1}/${files.length}] ✓ ${file.path}`);
        onUpdate?.(`Wrote ${file.path}`);

        // Post-write: track the file operation for rollback
        // Requirements 4.1, 4.2, 4.3: Store snapshots after successful writes
        if (hasContext) {
          try {
            const snapshot = preWriteSnapshots.get(filePath);
            if (snapshot !== undefined) {
              if (snapshot.fileExists) {
                // Modification: track with before and after content
                await rollbackManager.trackFileModification(
                  filePath,
                  snapshot.contentBefore,
                  file.content,
                  taskId!,
                  stepNumber!
                );
              } else {
                // Creation: track as new file
                await rollbackManager.trackFileCreation(filePath, taskId!, stepNumber!);
              }
            }
          } catch (trackError) {
            // Non-fatal: tracking errors must not break the write operation
            console.warn(`[batch_write] Failed to track rollback for ${filePath}:`, trackError);
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`[${i + 1}/${files.length}] ✗ ${file.path}: ${msg}`);
      }
    }));

    const output = results.join('\n') + (errors.length > 0 ? '\n\nErrors:\n' + errors.join('\n') : '');
    const success = errors.length === 0;

    return {
      success,
      output,
      data: { written: results.length, errors: errors.length, total: files.length },
    };
  },
};
