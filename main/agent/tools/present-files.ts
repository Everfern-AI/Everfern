import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { execFile } from 'child_process';
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
      },
      _narrative: {
        type: 'string',
        description: 'A single, high-polish active-voice sentence explaining what you are presenting (e.g. "Presenting finalized PDF report in the chat.")'
      },
      taskName: {
        type: 'string',
        description: 'A clean human-friendly Title Case task group name (e.g. "Delivering Final Documents")'
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

    const sessionId = runner?.currentConversationId || 'default';
    let artifactsDir: string;
    if (runner?.workspaceDir) {
      artifactsDir = path.join(runner.workspaceDir, '.everfern', 'artifacts');
    } else {
      artifactsDir = path.join(os.homedir(), '.everfern', 'artifacts', sessionId);
    }

    // Helper: Search across all possible host locations
    const hostCandidates = (rawPath: string, name: string): string[] => {
      // 1. Direct and translated linux path
      const candidates = [translateLinuxPathToHost(rawPath), path.resolve(rawPath)];

      // 3. Direct Windows UNC paths for WSL / Linux VM
      if (process.platform === 'win32') {
        const uncCandidates = [
          `\\\\wsl.localhost\\EverFern-Alpine\\everfern\\${name}`,
          `\\\\wsl.localhost\\EverFern-Alpine\\everfern\\workspace\\${name}`,
          `\\\\wsl.localhost\\EverFern-Alpine\\everfern\\artifacts\\${name}`,
          `\\\\wsl.localhost\\EverFern-Alpine\\root\\.everfern\\${name}`,
          `\\\\wsl.localhost\\EverFern-Alpine\\root\\.everfern\\workspace\\${name}`,
          `\\\\wsl.localhost\\EverFern-Alpine\\root\\${name}`,
          `\\\\wsl.localhost\\EverFern-Alpine\\tmp\\${name}`,
          `\\\\wsl.localhost\\EverFern-Alpine\\tmp\\everfern\\${name}`,
          `\\\\wsl$\\EverFern-Alpine\\everfern\\${name}`,
          `\\\\wsl$\\EverFern-Alpine\\root\\.everfern\\${name}`,
          `\\\\wsl$\\EverFern-Alpine\\tmp\\${name}`,
        ];
        candidates.push(...uncCandidates);
      }

      // 4. Search common host directories
      const searchDirs: (string | undefined | null)[] = [
        runner?.workspaceDir,
        artifactsDir,
        path.join(os.homedir(), '.everfern'),
        path.join(os.homedir(), '.everfern', 'workspace'),
        path.join(os.homedir(), '.everfern', 'exec'),
        path.join(os.homedir(), '.everfern', 'artifacts', sessionId),
        path.join(os.homedir(), '.everfern', 'artifacts'),
        path.join(os.homedir(), 'Downloads'),
        path.join(os.homedir(), 'Desktop'),
        path.join(os.homedir(), 'Documents'),
        os.homedir(),
        process.cwd(),
      ];

      for (const dir of searchDirs) {
        if (dir) candidates.push(path.join(dir, name));
      }

      return candidates;
    };

    const missingFiles: string[] = [];

    // Auto-save files to the artifacts directory and verify existence
    for (const f of files) {
      if (!f.path) continue;

      const fileName = path.basename(f.path);
      const targetPath = path.join(artifactsDir, fileName);
      const hostEverfernRoot = path.join(os.homedir(), '.everfern');
      const hostEverfernFallback = path.join(hostEverfernRoot, fileName);

      // If already in target path and exists, continue
      if (f.path === targetPath && fs.existsSync(targetPath)) continue;

      let fileCopied = false;

      // 1. Check if the file is already available in any host path or WSL UNC path
      const executable = process.env.EVERFERN_SHELL === 'tauri' && process.env.EF_NATIVE_EXE;
      const foundHost = executable ? undefined : hostCandidates(f.path, fileName).find(candidate => {
        try { return fs.statSync(candidate).isFile(); } catch { return false; }
      });
      if (executable || foundHost) {
        try {
          if (executable) {
            fileCopied = await new Promise<boolean>((resolve, reject) => {
              const child = execFile(executable, ['--ef-present-host-file'], {
                encoding: 'utf8', windowsHide: true,
              }, (error, stdout) => error ? reject(error) : resolve(stdout.trim() === 'true'));
              child.stdin?.once('error', reject);
              child.stdin?.end(JSON.stringify({
                candidates: [path.resolve(f.path)], original: f.path, name: fileName,
                target: targetPath, fallback: hostEverfernFallback,
                workspace: runner?.workspaceDir, artifacts: artifactsDir, home: os.homedir(), session: sessionId,
              }));
            });
          } else if (foundHost) {
            fs.mkdirSync(artifactsDir, { recursive: true });
            fs.mkdirSync(hostEverfernRoot, { recursive: true });
            if (foundHost !== targetPath) {
              fs.copyFileSync(foundHost, targetPath);
            }
            if (foundHost !== hostEverfernFallback && !fs.existsSync(hostEverfernFallback)) {
              try { fs.copyFileSync(foundHost, hostEverfernFallback); } catch {}
            }
            fileCopied = true;
          }
          if (fileCopied && foundHost) {
            console.log(`[PresentFiles] Found host/UNC file at ${foundHost}, synced to ${targetPath}`);
          }
        } catch (err) {
          console.warn(`[PresentFiles] Failed to copy host file ${foundHost}:`, err);
        }
      }

      // 2. If not found on host, actively search and transfer from Linux VM / WSL on Windows
      if (!fileCopied && !executable && process.platform === 'win32') {
        const wslCandidates = [
          f.path.startsWith('/') ? f.path : null,
          `/everfern/${fileName}`,
          `/everfern/workspace/${fileName}`,
          `/everfern/artifacts/${fileName}`,
          `~/.everfern/${fileName}`,
          `~/.everfern/workspace/${fileName}`,
          `~/.everfern/artifacts/${fileName}`,
          `~/everfern/${fileName}`,
          `~/workspace/${fileName}`,
          `~/${fileName}`,
          `/tmp/${fileName}`,
          `/tmp/everfern/${fileName}`,
          `/var/tmp/${fileName}`,
        ].filter(Boolean) as string[];

        // Try direct WSL copy
        for (const wslPath of wslCandidates) {
          try {
            fs.mkdirSync(artifactsDir, { recursive: true });
            const wslTargetPath = translateWindowsPathToLinux(targetPath);
            const checkCmd = `if [ -f ${wslPath} ]; then cp "${wslPath}" "${wslTargetPath}" 2>/dev/null && echo "EVERFERN_COPIED"; fi`;
            const res = await runInLinuxVM(checkCmd);
            if (res && res.stdout && res.stdout.includes('EVERFERN_COPIED') && fs.existsSync(targetPath)) {
              fileCopied = true;
              console.log(`[PresentFiles] Found WSL file ${wslPath}, copied to ${targetPath}`);
              break;
            }
          } catch (err) {
            // continue checking
          }
        }

        // If still not found, execute a fast find command in WSL
        if (!fileCopied) {
          try {
            const findCmd = `find /everfern /tmp /home -maxdepth 4 -name "${fileName}" 2>/dev/null | head -n 1`;
            const findRes = await runInLinuxVM(findCmd);
            const foundWslPath = findRes?.stdout?.trim();
            if (foundWslPath && foundWslPath.startsWith('/')) {
              fs.mkdirSync(artifactsDir, { recursive: true });
              const wslTargetPath = translateWindowsPathToLinux(targetPath);
              const copyCmd = `cp "${foundWslPath}" "${wslTargetPath}" 2>/dev/null && echo "EVERFERN_COPIED"`;
              const copyRes = await runInLinuxVM(copyCmd);
              if (copyRes && copyRes.stdout && copyRes.stdout.includes('EVERFERN_COPIED') && fs.existsSync(targetPath)) {
                fileCopied = true;
                console.log(`[PresentFiles] Found via WSL search: ${foundWslPath}, copied to ${targetPath}`);
              }
            }
          } catch (findErr) {
            console.warn(`[PresentFiles] WSL find search failed:`, findErr);
          }
        }
      }

      // 3. If not found on host, try Docker on macOS
      if (!fileCopied && !executable && process.platform === 'darwin') {
        try {
          fs.mkdirSync(artifactsDir, { recursive: true });
          const { execFileSync } = require('child_process');
          const dockerPaths = [
            f.path.startsWith('/') ? f.path : null,
            `/everfern/${fileName}`,
            `/root/.everfern/${fileName}`,
            `/root/.everfern/workspace/${fileName}`,
            `/tmp/${fileName}`
          ].filter(Boolean) as string[];

          for (const dp of dockerPaths) {
            try {
              execFileSync('docker', ['cp', `everfern-alpine:${dp}`, targetPath], { timeout: 15000, stdio: 'pipe', maxBuffer: 10 * 1024 * 1024 });
              if (fs.existsSync(targetPath)) {
                fileCopied = true;
                console.log(`[PresentFiles] Copied Docker file ${dp} to host artifacts at ${targetPath}`);
                break;
              }
            } catch {}
          }
        } catch {}
      }

      // 4. Also mirror to host .everfern root directory so all viewers can access it
      if (!executable && fileCopied && fs.existsSync(targetPath)) {
        try {
          fs.mkdirSync(hostEverfernRoot, { recursive: true });
          if (!fs.existsSync(hostEverfernFallback)) {
            fs.copyFileSync(targetPath, hostEverfernFallback);
          }
        } catch {}
      }

      // 4. Auto-Execution Fallback: Check if a generator script exists in ~/.everfern or workspace
      if (!fileCopied) {
        try {
          const checkDirs = [
            path.join(os.homedir(), '.everfern'),
            path.join(os.homedir(), '.everfern', 'workspace'),
            runner?.workspaceDir
          ].filter(Boolean) as string[];

          for (const cDir of checkDirs) {
            if (!fs.existsSync(cDir)) continue;
            const dirFiles = fs.readdirSync(cDir);
            const scriptCandidates = dirFiles.filter(name => 
              name.endsWith('.py') || name.endsWith('.js') || name.endsWith('.ts')
            );

            for (const script of scriptCandidates) {
              const scriptPath = path.join(cDir, script);
              try {
                const content = fs.readFileSync(scriptPath, 'utf8');
                if (content.includes(fileName) || content.includes(fileName.split('.')[0])) {
                  console.log(`[PresentFiles] Auto-running generator script ${scriptPath} for ${fileName}...`);
                  const { execSync } = require('child_process');
                  if (script.endsWith('.py')) {
                    execSync(`python "${scriptPath}"`, { cwd: cDir, timeout: 30000, stdio: 'pipe' });
                  } else if (script.endsWith('.js')) {
                    execSync(`node "${scriptPath}"`, { cwd: cDir, timeout: 30000, stdio: 'pipe' });
                  }
                  // Check if target was produced
                  const produced = hostCandidates(path.join(cDir, fileName), fileName).find(candidate => {
                    try { return fs.statSync(candidate).isFile(); } catch { return false; }
                  });
                  if (produced) {
                    fs.mkdirSync(artifactsDir, { recursive: true });
                    fs.copyFileSync(produced, targetPath);
                    fileCopied = true;
                    console.log(`[PresentFiles] Successfully generated ${fileName} via ${script}`);
                    break;
                  }
                }
              } catch (execErr) {
                console.warn(`[PresentFiles] Attempt to run ${script} failed:`, execErr);
              }
            }
            if (fileCopied) break;
          }
        } catch {}
      }

      if (fileCopied) {
        f.path = targetPath;
      } else {
        missingFiles.push(f.path);
      }
    }

    const count = files.filter((f: any) => f && f.path).length;
    const notifyPresentation = () => onUpdate?.(`🎁 Presenting ${count} artifact${count !== 1 ? 's' : ''} to the user...`);
    const executable = process.env.EVERFERN_SHELL === 'tauri' && process.env.EF_NATIVE_EXE;
    if (executable) {
      const result = await new Promise<ToolResult | null>(resolve => {
        const child = execFile(executable, ['--ef-present-files-result'], {
          encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024,
        }, (error, output) => {
          if (error) return resolve(null);
          try { resolve(JSON.parse(output)); } catch { resolve(null); }
        });
        child.stdin?.once('error', () => resolve(null));
        child.stdin?.end(JSON.stringify({ files, missingFiles, title: args.title }));
      });
      if (result) {
        if (result.success) notifyPresentation();
        return result;
      }
    }
    if (missingFiles.length > 0 && missingFiles.length === files.length) {
      return {
        success: false,
        output: `Error: Could not find deliverable file(s) on disk:\n${missingFiles.map(m => `- ${m}`).join('\n')}\n\nSearched directories: ~/.everfern/, ~/.everfern/workspace/, current workspace, user home, and Linux VM/WSL.\n\nNote: If you wrote a generation script (e.g. .py or .js), execute it using the terminal tool (e.g. 'python generate_pdf_script.py') to create the deliverable file before presenting.`,
        error: `Files not found: ${missingFiles.join(', ')}`
      };
    }
    notifyPresentation();
    for (const file of files) {
      if (!file?.path) continue;
      const ext = path.extname(file.path).toLowerCase();
      if (['.py', '.js', '.ts', '.sh', '.bat', '.ps1'].includes(ext) && !file.type) file.type = 'code';
      if (!file.title) {
        const base = path.basename(file.path, ext).replace(/[_-]+/g, ' ');
        file.title = base.charAt(0).toUpperCase() + base.slice(1);
      }
    }
    const formatted = files
      .filter((f: any) => f && f.path)
      .map((f: PresentFile) => {
        const desc = f.description || f.title || `File: ${f.path.split(/[\\/]/).pop()}`;
        return `📄 **${desc}**\n   Path: \`${f.path}\``;
      }).join('\n\n');


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
