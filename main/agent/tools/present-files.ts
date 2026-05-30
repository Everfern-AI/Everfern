import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import type { AgentTool, ToolResult } from '../runner/types';
import { translateLinuxPathToHost, translateWindowsPathToLinux, runInLinuxVM } from './linux-vm-executor';

interface PresentFile {
  path: string;
  description?: string;
  type?: 'document' | 'spreadsheet' | 'presentation' | 'code' | 'image' | 'other';
  title?: string;
}

export const createPresentFilesTool = (runner?: any): AgentTool => ({
  name: 'present_files',
  description:
    'Present final output files (artifacts, reports, spreadsheets) to the user. ' +
    'Surfaces them as interactive cards. Mandatory final step after work.',
  parameters: {
    type: 'object',
    properties: {
      files: {
        type: 'array',
        description: 'List of files to present to the user.',
        items: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Absolute path to the file.' },
            description: { type: 'string', description: 'Short summary of what this file contains.' },
            type: { 
              type: 'string', 
              enum: ['document', 'spreadsheet', 'presentation', 'code', 'image', 'other'],
              description: 'General category for UI rendering.'
            },
            title: { type: 'string', description: 'Title for the file.' }
          },
          required: ['path']
        }
      },
      paths: {
        type: 'array',
        description: 'Alternative format: list of file paths to present.',
        items: { type: 'string' }
      },
      title: {
        type: 'string',
        description: 'Optional title for the presentation.'
      }
    },
    required: ['files']
  },

  async execute(args: Record<string, unknown>, onUpdate?: (msg: string) => void, emitEvent?: (event: any) => void, toolCallId?: string): Promise<ToolResult> {
    // Handle different input formats
    let files: PresentFile[] = [];
    
    if (Array.isArray(args.files)) {
      files = args.files;
    } else if (Array.isArray(args.paths)) {
      // Alternative format: just paths
      files = args.paths.map((p: string) => ({ path: p }));
    } else if (args.files && typeof args.files === 'object') {
      // Single file object
      files = [args.files as PresentFile];
    } else {
      return {
        success: false,
        output: 'present_files requires a "files" array parameter with at least one file.',
        error: 'Invalid arguments: expected { files: [{ path: string, description: string }] }'
      };
    }

    if (files.length === 0) {
      return {
        success: false,
        output: 'No files provided to present.',
        error: 'Empty files array'
      };
    }

    // Determine artifacts directory to copy files to
    const sessionId = runner?.currentConversationId || 'default';
    let artifactsDir: string;
    if (runner?.workspaceDir) {
      artifactsDir = path.join(runner.workspaceDir, '.everfern', 'artifacts');
    } else {
      artifactsDir = path.join(os.homedir(), '.everfern', 'artifacts', sessionId);
    }

    // Auto-save files to the artifacts directory
    for (const f of files) {
      if (!f.path) continue;
      
      const fileName = path.basename(f.path);
      const targetPath = path.join(artifactsDir, fileName);
      
      // If already in target path, skip copying
      if (f.path === targetPath) continue;

      let fileCopied = false;

      if (process.platform === 'win32') {
        // Check if the path is a WSL-internal path (e.g. starts with / and not /mnt/)
        const isWslInternal = f.path.startsWith('/') && !f.path.startsWith('/mnt/');
        if (isWslInternal) {
          try {
            // Translate target path to WSL
            const wslTargetPath = translateWindowsPathToLinux(targetPath);
            // Ensure target directory exists on host first
            fs.mkdirSync(artifactsDir, { recursive: true });
            // Copy file from WSL to the Windows mount
            await runInLinuxVM(`cp "${f.path}" "${wslTargetPath}"`);
            fileCopied = true;
            console.log(`[PresentFiles] Copied WSL file ${f.path} to host artifacts at ${targetPath}`);
          } catch (err) {
            console.warn(`[PresentFiles] Failed to copy WSL file via VM:`, err);
          }
        }
      } else if (process.platform === 'darwin') {
        // Check if the path is Docker-container-internal (e.g. /home/... or non-/host/Users/)
        const isDockerInternal = f.path.startsWith('/') && !f.path.startsWith('/host/Users/') && !f.path.startsWith('/mnt/');
        if (isDockerInternal) {
          try {
            fs.mkdirSync(artifactsDir, { recursive: true });
            const { execSync } = require('child_process');
            execSync(`docker cp everfern-ubuntu:"${f.path}" "${targetPath}"`, { timeout: 30000 });
            fileCopied = true;
            console.log(`[PresentFiles] Copied Docker file ${f.path} to host artifacts at ${targetPath}`);
          } catch (err) {
            console.warn(`[PresentFiles] Failed to copy Docker file via docker cp:`, err);
          }
        }
      }

      if (!fileCopied) {
        // Standard copy (handles /mnt/c/ translation via translateLinuxPathToHost)
        try {
          const hostPath = translateLinuxPathToHost(f.path);
          if (fs.existsSync(hostPath)) {
            fs.mkdirSync(artifactsDir, { recursive: true });
            fs.copyFileSync(hostPath, targetPath);
            fileCopied = true;
            console.log(`[PresentFiles] Copied file from ${hostPath} to artifacts at ${targetPath}`);
          } else {
            console.warn(`[PresentFiles] Source file not found: ${hostPath}`);
          }
        } catch (err) {
          console.warn(`[PresentFiles] Failed to copy host file to artifacts:`, err);
        }
      }

      if (fileCopied) {
        f.path = targetPath;
      }
    }

    const formatted = files
      .filter((f: any) => f && f.path)
      .map((f: PresentFile) => {
        const desc = f.description || f.title || `File: ${f.path.split(/[\\/]/).pop()}`;
        return `📄 **${desc}**\n   Path: \`${f.path}\``;
      }).join('\n\n');

    const count = files.filter((f: any) => f && f.path).length;
    onUpdate?.(`🎁 Presenting ${count} artifact${count !== 1 ? 's' : ''} to the user...`);

    return {
      success: true,
      output: `Files presented to the user:\n\n${formatted}\n\nTask complete.`,
      data: { 
        files: files.filter((f: any) => f && f.path), 
        type: 'present_files',
        title: args.title
      }
    };
  }
});

export const presentFilesTool = createPresentFilesTool();
